// Gate and shared constants for the Omp live harness (HARN-01, HARN-03; decisions D-1201, D-1203, D-1206 of phase 12).
//
// The pure pieces (version parsing and comparison, the skip-reason selection, the extension path resolver) are covered by the
// hermetic file test/integration/omp-live-helpers.test.ts, which always runs without Omp, strace or Podman. The probes that touch
// the host (ompVersion, probeStrace, collectOmpGateInputs) are the only functions here that start a process, and they start it
// asynchronously, so a test process that hosts the in-process daemon is never blocked (D-1203).
//
// Nothing here reads the process environment or touches the host at import time: every function takes what it needs as a
// parameter, so the hermetic file can import this module on any host. `isDirectory`, `onPath`, `runCommand` and `pollUntil` stay in
// test/support/production-live.ts and are imported from there, not copied.
//
// Frozen interface (other units import exactly these names):
//   LIVE_OMP_VARIABLE, OMP_BIN_VARIABLE, OMP_NET_TRACE_VARIABLE   the three gate variable names (D-1201)
//   MIN_OMP_VERSION                                              "18.12.6", the lowest version the harness accepts (D-1206)
//   OMP_READY_TIMEOUT_MS (180 s), OMP_PROMPT_TIMEOUT_MS (60 s), OMP_SCENARIO_TIMEOUT_MS (300 s)   the shared bounds (D-1203)
//   EXTENSION_PATH: string                                       the built extension, dist/src/omp/extension.js
//   resolveExtensionPath(moduleUrl: string): string              how EXTENSION_PATH is derived from a module URL
//   ompBinary(env, cwd?): string                                 REALM_OMP_BIN (a path is resolved to absolute once, against cwd), else "omp"
//   ompVersion(bin, env): Promise<OmpVersionProbe>               runs `<bin> --version`; never rejects
//   parseOmpVersion(stdout): OmpVersion | undefined              "omp/18.12.6" -> { major: 18, minor: 12, patch: 6, text: "18.12.6" }
//   compareOmpVersions(a, b): number                             negative, zero or positive
//   probeStrace(env): Promise<StraceProbe>                       strace on PATH and able to trace; never rejects
//   ompSkipReason(inputs: OmpGateInputs): string | undefined     the FIRST missing prerequisite, or undefined when all hold
//   collectOmpGateInputs(env, options): Promise<OmpGateInputs>   the host facts for ompSkipReason (probes only after the opt-in)
//   isRecord(value): value is Record<string, unknown>           the shared object guard of the harness files
//   within(promise, ms, label): Promise<T>                       failure bound: rejects after ms, clears its timer as soon as either side settles
//   ompVersionOnce(bin, env, options?): Promise<OmpVersionProbe> ompVersion once per binary path for the process (the gate never repeats a probe)
//   OMP_VERSION_PROBE_TIMEOUT_MS                                 the version probe's bound: 60 s times REALM_TEST_TIMEOUT_SCALE
//   createCleanups(), writeEvidence(dir, files), closeWithEvidence(parts)   a teardown that runs every step, and evidence saving that reports instead of throwing

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EnvironmentLike } from "../../src/session/paths.js";
import { describeResult, onPath, runCommand } from "./production-live.js";
import { scaledMs } from "./timing.js";

// ---- Gate variables and bounds ---------------------------------------------------------------------------------------------

// Opts in to any test that starts a real Omp process. Hermetic: no Podman, no image, no openshell. A test never sets it.
export const LIVE_OMP_VARIABLE = "REALM_LIVE_OMP";
// Optional path of the Omp executable; default `omp` on PATH.
export const OMP_BIN_VARIABLE = "REALM_OMP_BIN";
// Opts in to the strace-based network assertion.
export const OMP_NET_TRACE_VARIABLE = "REALM_OMP_NET_TRACE";

// The lowest Omp version the harness was written for. Newer versions run and are recorded (D-1206).
export const MIN_OMP_VERSION = "18.12.6";
const DEFAULT_OMP_BINARY = "omp";

// D-1203: Omp ready 180 s, one prompt 60 s, one scenario 300 s.
export const OMP_READY_TIMEOUT_MS = 180_000;
export const OMP_PROMPT_TIMEOUT_MS = 60_000;
export const OMP_SCENARIO_TIMEOUT_MS = 300_000;

// `omp --version` and `strace ... true` are local and fast; the bound keeps a hung binary from hanging the run.
const PROBE_TIMEOUT_MS = 15_000;
// The `omp --version` probe is Omp starting up (25 s at a load average of 100), so its bound is a base of 60 s stretched by
// REALM_TEST_TIMEOUT_SCALE like every other fixed bound of the tests (test/support/timing.ts). A failure bound only.
export const OMP_VERSION_PROBE_TIMEOUT_MS = scaledMs(60_000);

// ---- Extension path --------------------------------------------------------------------------------------------------------

// The built extension, found from a module that lives in dist/test/<dir>/ (dist/src/omp/extension.js, package.json omp.extensions).
export function resolveExtensionPath(moduleUrl: string): string {
  return fileURLToPath(new URL("../../src/omp/extension.js", moduleUrl));
}

export const EXTENSION_PATH: string = resolveExtensionPath(import.meta.url);

// The one shared object guard of the harness files: values narrow to Record<string, unknown>, fields stay unknown.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---- Failure bound ---------------------------------------------------------------------------------------------------------

// A failure bound only. The awaited signal arrives on its own and the timer is cleared as soon as either side settles, so the
// timer never sets the pace of a passing test.
export async function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timed out after ${String(ms)} ms: ${label}`));
    }, ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Version ---------------------------------------------------------------------------------------------------------------

export interface OmpVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  // "18.12.6": the three numbers joined, without the `omp/` prefix or any suffix.
  readonly text: string;
}

// The result of running `<bin> --version`: its stdout, or "unavailable" when it could not start, timed out or exited non-zero.
export type OmpVersionProbe = { readonly kind: "output"; readonly stdout: string } | { readonly kind: "unavailable" };

const VERSION_PATTERN = /(?<!\d)(\d+)\.(\d+)\.(\d+)(?!\d)/;

// Reads the first x.y.z in the output (`omp --version` prints `omp/18.12.6`). Undefined when there is none.
export function parseOmpVersion(stdout: string): OmpVersion | undefined {
  const match = VERSION_PATTERN.exec(stdout);
  if (match === null) {
    return undefined;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return { major, minor, patch, text: `${String(major)}.${String(minor)}.${String(patch)}` };
}

// Negative when a is older than b, zero when equal, positive when newer.
export function compareOmpVersions(a: OmpVersion, b: OmpVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

const MIN_VERSION: OmpVersion = (() => {
  const parsed = parseOmpVersion(MIN_OMP_VERSION);
  if (parsed === undefined) {
    throw new Error("MIN_OMP_VERSION is not a version");
  }
  return parsed;
})();

// The Omp executable the harness uses: REALM_OMP_BIN when set and non-empty, otherwise `omp`. A value that contains a slash is a
// path and is resolved ONCE to an absolute path against `cwd` (default: the process's working directory), because Omp is probed
// from one directory and run from another; a bare name stays a name and is looked up on PATH.
export function ompBinary(env: EnvironmentLike, cwd: string = process.cwd()): string {
  const value = env[OMP_BIN_VARIABLE];
  if (value === undefined || value === "") {
    return DEFAULT_OMP_BINARY;
  }
  return value.includes("/") ? resolve(cwd, value) : value;
}

// The command runner the probes use: runCommand, or a test's stand-in.
export type CommandRunner = typeof runCommand;

export interface VersionProbeOptions {
  // The bound of the probe. Defaults to OMP_VERSION_PROBE_TIMEOUT_MS.
  readonly timeoutMs?: number;
  readonly runner?: CommandRunner;
}

// Runs `<bin> --version`. Asynchronous (D-1203) and never rejects.
export async function ompVersion(bin: string, env: Readonly<Record<string, string>>, options: VersionProbeOptions = {}): Promise<OmpVersionProbe> {
  const run = options.runner ?? runCommand;
  const result = await run(bin, ["--version"], { env, timeoutMs: options.timeoutMs ?? OMP_VERSION_PROBE_TIMEOUT_MS, cwd: tmpdir() });
  return result.exitCode === 0 ? { kind: "output", stdout: result.stdout } : { kind: "unavailable" };
}

const versionProbes = new Map<string, Promise<OmpVersionProbe>>();

// ompVersion, once per binary path for the life of the process: every caller gets the same probe. A probe took 25 s on a loaded
// host, so the gate must never repeat it. Keyed by the (resolved) binary path.
export function ompVersionOnce(bin: string, env: Readonly<Record<string, string>>, options: VersionProbeOptions = {}): Promise<OmpVersionProbe> {
  const known = versionProbes.get(bin);
  if (known !== undefined) {
    return known;
  }
  const probe = ompVersion(bin, env, options);
  versionProbes.set(bin, probe);
  return probe;
}

// ---- strace ----------------------------------------------------------------------------------------------------------------

// `missing`: no strace on PATH. `unusable`: strace runs but cannot trace (CI containers often block ptrace); detail is the clipped
// probe result. `ready`: a trivial `strace -e trace=connect true` succeeded.
export type StraceProbe =
  | { readonly kind: "missing" }
  | { readonly kind: "unusable"; readonly detail: string }
  | { readonly kind: "ready" };

// Looks for strace on env.PATH, then traces `true`. Never rejects.
export async function probeStrace(env: Readonly<Record<string, string>>): Promise<StraceProbe> {
  if (!onPath("strace", env["PATH"])) {
    return { kind: "missing" };
  }
  const result = await runCommand("strace", ["-qq", "-e", "trace=connect", "true"], {
    env,
    timeoutMs: PROBE_TIMEOUT_MS,
    cwd: tmpdir(),
  });
  return result.exitCode === 0 ? { kind: "ready" } : { kind: "unusable", detail: describeResult(result) };
}

// ---- Skip reason -----------------------------------------------------------------------------------------------------------

// The host facts the gate decides from. Each is injected, so the hermetic file can cover every branch.
export interface OmpGateInputs {
  readonly env: EnvironmentLike;
  // Node's process.platform of the host.
  readonly platform: string;
  readonly onPath: (name: string) => boolean;
  readonly exists: (path: string) => boolean;
  // The result of `<ompBinary(env)> --version`.
  readonly version: OmpVersionProbe;
  // The built extension beside the compiled tests (EXTENSION_PATH).
  readonly extensionPath: string;
  // The Omp executable, already resolved (ompBinary): collectOmpGateInputs sets it so a relative REALM_OMP_BIN is resolved once.
  // Absent in a hand-built input, where the gate resolves REALM_OMP_BIN itself.
  readonly bin?: string;
  // Present only when the caller asks about the network trace; absent for every other test.
  readonly strace?: StraceProbe;
}

// The reason the live Omp suite cannot run, or undefined when every prerequisite holds. The reason names the FIRST missing
// prerequisite, in this order (D-1201): the opt-in variable, Linux, the Omp executable, a parsable version at least
// MIN_OMP_VERSION, the built extension and, when inputs.strace is given, the trace opt-in and a strace that can trace. The opt-in
// is exactly "1": the test never sets it.
export function ompSkipReason(inputs: OmpGateInputs): string | undefined {
  const { env } = inputs;
  if (env[LIVE_OMP_VARIABLE] !== "1") {
    return `${LIVE_OMP_VARIABLE}=1 is not set; the live Omp suite needs an explicit operator opt-in`;
  }
  if (inputs.platform !== "linux") {
    return `the live Omp suite is verified on Linux only; this host is ${inputs.platform}`;
  }
  const bin = inputs.bin ?? ompBinary(env);
  const present = bin.includes("/") ? inputs.exists(bin) : inputs.onPath(bin);
  if (!present) {
    return `no Omp executable ${bin}; install Omp or point ${OMP_BIN_VARIABLE} at it`;
  }
  if (inputs.version.kind === "unavailable") {
    return `${bin} --version did not run to a successful exit`;
  }
  const version = parseOmpVersion(inputs.version.stdout);
  if (version === undefined) {
    return `${bin} --version printed no x.y.z version`;
  }
  if (compareOmpVersions(version, MIN_VERSION) < 0) {
    return `Omp ${version.text} is older than ${MIN_OMP_VERSION}, the lowest version the harness was written for`;
  }
  if (!inputs.exists(inputs.extensionPath)) {
    return "the built extension dist/src/omp/extension.js is missing; run npm run build first";
  }
  const { strace } = inputs;
  if (strace === undefined) {
    return undefined;
  }
  if (env[OMP_NET_TRACE_VARIABLE] !== "1") {
    return `${OMP_NET_TRACE_VARIABLE}=1 is not set; the network trace needs an explicit operator opt-in`;
  }
  if (strace.kind === "missing") {
    return "no strace on PATH; the network trace runs Omp under strace";
  }
  if (strace.kind === "unusable") {
    return `strace cannot trace on this host (ptrace may be blocked): ${strace.detail}`;
  }
  return undefined;
}

// ---- Host facts ------------------------------------------------------------------------------------------------------------

export interface CollectOptions {
  // Node's process.platform.
  readonly platform: string;
  // True when the caller asks about the network trace: strace is probed, but only when REALM_OMP_NET_TRACE=1 is set.
  readonly trace: boolean;
  // Defaults to EXTENSION_PATH.
  readonly extensionPath?: string;
  // The directory a relative REALM_OMP_BIN is resolved against. Defaults to the process's working directory.
  readonly cwd?: string;
  // The bound of the `--version` probe. Defaults to OMP_VERSION_PROBE_TIMEOUT_MS.
  readonly versionTimeoutMs?: number;
  // The command runner of the `--version` probe; a test injects one to count spawns.
  readonly runner?: CommandRunner;
}

// Reads the host facts ompSkipReason decides from. Nothing is started until the opt-in is set on Linux, so a plain `npm test`
// never runs `omp --version` or strace. The `--version` probe runs once per binary for the whole process (ompVersionOnce), however
// many times this is called, and strace is probed only when the caller asks for the trace AND REALM_OMP_NET_TRACE=1 is set.
export async function collectOmpGateInputs(env: EnvironmentLike, options: CollectOptions): Promise<OmpGateInputs> {
  const hostPath = (name: string): boolean => onPath(name, env["PATH"]);
  const probeEnv: Record<string, string> = { PATH: env["PATH"] ?? "" };
  const home = env["HOME"];
  if (home !== undefined) {
    probeEnv["HOME"] = home;
  }
  const bin = ompBinary(env, options.cwd);
  const optedIn = env[LIVE_OMP_VARIABLE] === "1" && options.platform === "linux";
  const present = bin.includes("/") ? existsSync(bin) : hostPath(bin);
  const version: OmpVersionProbe =
    optedIn && present
      ? await ompVersionOnce(bin, probeEnv, {
          timeoutMs: options.versionTimeoutMs ?? OMP_VERSION_PROBE_TIMEOUT_MS,
          ...(options.runner === undefined ? {} : { runner: options.runner }),
        })
      : { kind: "unavailable" };
  const inputs = {
    env,
    platform: options.platform,
    onPath: hostPath,
    exists: existsSync,
    version,
    extensionPath: options.extensionPath ?? EXTENSION_PATH,
    bin,
  };
  if (!options.trace) {
    return inputs;
  }
  const strace: StraceProbe = optedIn && env[OMP_NET_TRACE_VARIABLE] === "1" ? await probeStrace(probeEnv) : { kind: "missing" };
  return { ...inputs, strace };
}

// ---- Teardown --------------------------------------------------------------------------------------------------------------

type CleanupStep = () => unknown;

export interface Cleanups {
  // Registers a step. Steps run in reverse order of registration, like node:test's `after` hooks.
  add(step: CleanupStep): void;
  // Runs EVERY step, even when an earlier one failed, then rejects: with the one error when a single step failed, with an
  // AggregateError when several did. Steps run once: a second call does nothing.
  run(): Promise<void>;
}

// A teardown that cannot be cut short: a step that throws never stops the steps after it, so Omp, the provider's listener and the
// profile directory are all released whatever failed first.
export function createCleanups(): Cleanups {
  let steps: CleanupStep[] = [];
  return {
    add(step) {
      steps.push(step);
    },
    async run() {
      const pending = steps.reverse();
      steps = [];
      const failures: unknown[] = [];
      for (const step of pending) {
        try {
          await step();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length === 1) {
        throw failures[0];
      }
      if (failures.length > 1) {
        throw new AggregateError(failures, `${String(failures.length)} cleanup steps failed`);
      }
    },
  };
}

// The files of one scenario's evidence, each produced on demand so that a failure to produce one is reported, not thrown.
export type EvidenceFiles = Readonly<Record<string, () => string>>;

// Writes the evidence files into `dir` (created when absent). Best effort and never throws: it returns what went wrong, one line
// per problem, so the caller can report it. An undefined or empty `dir` writes nothing. A `dir` that is a regular file, or cannot
// be created, is a problem; a file that cannot be produced or written is a problem, and the others are still written.
export function writeEvidence(dir: string | undefined, files: EvidenceFiles): string[] {
  if (dir === undefined || dir === "") {
    return [];
  }
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    return [`evidence directory ${dir} could not be created: ${error instanceof Error ? error.message : String(error)}`];
  }
  const problems: string[] = [];
  for (const [name, produce] of Object.entries(files)) {
    try {
      writeFileSync(join(dir, name), produce());
    } catch (error) {
      problems.push(`evidence file ${name} was not written: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}

export interface CloseWithEvidence {
  readonly evidenceDir: string | undefined;
  readonly evidence: EvidenceFiles;
  // Receives each evidence problem (for example t.diagnostic).
  readonly report: (problem: string) => void;
  // Closes Omp. It always runs, after the evidence, whatever happened to the evidence.
  readonly close: () => Promise<unknown>;
}

// The teardown step of one scenario's Omp: save the evidence (reported, never thrown), then close Omp in a `finally`.
export async function closeWithEvidence(parts: CloseWithEvidence): Promise<void> {
  try {
    for (const problem of writeEvidence(parts.evidenceDir, parts.evidence)) {
      parts.report(problem);
    }
  } finally {
    await parts.close();
  }
}
