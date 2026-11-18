// Gate, isolation and runner pieces of the host live rehearsals (ADPT-08; decisions D-24-07 and D-24-08 of phase 24; BOOTP-01 of phase 31).
//
// Thirteen hosts are in the table. Four have a gated live file of their own: claude, codex, opencode and kimi. Each file has a validator
// tier (the host's own commands parse, and for three hosts launch, what the real recipe wrote into an isolated home) and, for claude,
// codex and opencode, a production tier. The production tier of claude and opencode is the host's own health check (`<host> mcp list`),
// which performs a real MCP initialize against `realm mcp --host <id>` on the production stack. The production tier of codex is a session
// drive (`codex exec` against a refusing loopback provider, no credential; 31-CONTEXT D-31-02) that makes Codex launch the registered
// server and list its tools. In every production run the registered `realm` is a wire recorder (test/support/host-live-session.ts) that
// logs method names and tool names. The nine wave-2 hosts (qwen, pi, hermes, cursor, kilo, copilot, augment, codebuddy, cline) share one
// table-driven validator file, test/integration/host-live-wave2.test.ts, and have no production tier (config-only, 25-CONTEXT D-25-08).
// Antigravity has no live file at all (ANTIGRAVITY_GAP).
//
// Gate order of hostLiveSkipReason, the first failing check names the skip (no test ever sets a gate variable):
//   1. the host's opt-in variable is exactly 1 (REALM_LIVE_<HOST>, for example REALM_LIVE_CLAUDE or REALM_LIVE_QWEN)
//   2. the platform is Linux
//   3. the host executable exists: REALM_<HOST>_BIN (an absolute path) or the default name on PATH
//   4. `<bin> --version` runs and prints an x.y.z version (a broken install, such as the Hermes one of E-HM2, fails here)
//   5. the host has a minimum version (`minVersion`, pi 1.3.0) and the installed one is older
//   6. kimi only: the installed kimi is not the archived Python stub
//   7. the built CLI dist/src/cli/main.js exists
//   8. production tier only: the host has a production tier, then productionSkipReason (Podman, image, driver, sockets), then
//      no Realm receipt for the host in the shared state directory
//
// Nothing here reads the process environment or touches the host at import time: every function takes what it needs as a
// parameter. The pure pieces (skip reasons, version parsing, the stub realm, the isolated environment, the process-group kill)
// are covered by test/integration/host-live-helpers.test.ts, which always runs without a host CLI, Podman or a network.
//
// Exports (the live files and the helper test import exactly these names):
//   HOST_LIVE, LIVE_HOST_IDS, type LiveHostId          the frozen per-host table (KIMI_CODE_GAP, ANTIGRAVITY_GAP, CONFIG_ONLY_GAP: its fixed gap sentences)
//   hostLiveSkipReason, collectHostLiveGate            the pure gate and the probe-and-decide wrapper the live files call
//   parseHostVersion, compareVersions, resolveExecutable   version parsing and comparison, and executable lookup
//   writeStubRealm, readStubArgv                       the stub `realm` that records its argv, and the reader of that record
//   isolatedHostEnv, isUnderTemp                       the allowlisted environment and the temporary-directory guard
//   runHost, describeRun, requireReturned              the bounded process-group runner and its result helpers
//   Capture, signalGroup, shellQuote, the two grace constants   the runner pieces test/support/host-live-session.ts reuses
//   createHostRig                                      one isolated root with the stub, a state directory and the realm CLI
//   runHostProduction                                  the shared production-tier scenario of claude, codex and opencode
//   fileSha256, stripAnsi, cliJson, refusalReasonOf, ownedTableOf, processAlive   small helpers of the live files

import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import type { TestContext } from "node:test";
import { runCli, type CliResult } from "../../src/cli/main.js";
import { locateTomlTable } from "../../src/host/toml-table.js";
import type { EnvironmentLike } from "../../src/session/paths.js";
import { createCleanups, isRecord } from "./omp-live.js";
import {
  type CommandResult,
  createScenarioEnvironment,
  describeResult,
  describeValue,
  isDirectory,
  isSocket,
  listSandboxContainers,
  LIVE_PRODUCTION_VARIABLE,
  type LiveInputs,
  onPath,
  pollUntil,
  probePodman,
  productionSkipReason,
  readLiveInputs,
  realmCli,
  realmCliWithWorkspace,
  removeSharedStateCreatedBy,
  restoreSharedPolicy,
  sandboxNameFor,
  type ScenarioEnvironment,
  stateOfStatus,
  waitForNoResidue,
} from "./production-live.js";
import { isLoopbackPeer, readWireLog, REALM_TOOL_NAMES, runHostUntil, type RefusingProvider, wireSummary, writeWireRecorder } from "./host-live-session.js";
import { scaledMs } from "./timing.js";

// ---- The per-host table ----------------------------------------------------------------------------------------------------

export type LiveHostId = "claude" | "codex" | "opencode" | "kimi" | "qwen" | "pi" | "hermes" | "cursor" | "kilo" | "copilot" | "augment" | "codebuddy" | "cline";
export const LIVE_HOST_IDS: readonly LiveHostId[] = Object.freeze(["claude", "codex", "opencode", "kimi", "qwen", "pi", "hermes", "cursor", "kilo", "copilot", "augment", "codebuddy", "cline"] as const);
export type HostLiveTier = "validator" | "production";

export interface HostLiveSpec {
  readonly optIn: string;
  readonly binOverride: string;
  readonly defaultBinary: string;
  readonly displayName: string;
  readonly versionArgs: readonly string[];
  // The version the context documents observed. Informational: a newer or older version runs and is recorded, never skipped.
  readonly recordedVersion: string;
  // The first version that can use the recipe, or null for a host without a floor. An older version is skipped (the only skip a version causes).
  readonly minVersion: string | null;
  // Whether the host's own validator commands launch the registered command (the stub realm records the argv).
  readonly launchesOnValidate: boolean;
  readonly productionTier: boolean;
  // The fixed sentence of a host without a production tier; null for a host that has one.
  readonly productionGap: string | null;
}

// The production-tier gap of every wave-2 host.
export const CONFIG_ONLY_GAP = "config-only host: no production tier is defined for it (25-CONTEXT D-25-08)";

interface Wave2SpecInit {
  readonly optIn: string;
  readonly binOverride: string;
  readonly defaultBinary: string;
  readonly displayName: string;
  readonly recordedVersion: string;
  readonly minVersion?: string;
  readonly launchesOnValidate: boolean;
}

// One wave-2 table entry: a config-only host whose validator runs `<bin> --version` and has no production tier.
function wave2Spec(init: Wave2SpecInit): HostLiveSpec {
  return Object.freeze({
    optIn: init.optIn,
    binOverride: init.binOverride,
    defaultBinary: init.defaultBinary,
    displayName: init.displayName,
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: init.recordedVersion,
    minVersion: init.minVersion ?? null,
    launchesOnValidate: init.launchesOnValidate,
    productionTier: false,
    productionGap: CONFIG_ONLY_GAP,
  });
}

export const HOST_LIVE: Readonly<Record<LiveHostId, HostLiveSpec>> = Object.freeze({
  claude: Object.freeze({
    optIn: "REALM_LIVE_CLAUDE",
    binOverride: "REALM_CLAUDE_BIN",
    defaultBinary: "claude",
    displayName: "Claude Code",
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: "2.1.322",
    minVersion: null,
    launchesOnValidate: true,
    productionTier: true,
    productionGap: null,
  }),
  codex: Object.freeze({
    optIn: "REALM_LIVE_CODEX",
    binOverride: "REALM_CODEX_BIN",
    defaultBinary: "codex",
    displayName: "Codex",
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: "0.154.0",
    minVersion: null,
    launchesOnValidate: false,
    productionTier: true,
    productionGap: null,
  }),
  opencode: Object.freeze({
    optIn: "REALM_LIVE_OPENCODE",
    binOverride: "REALM_OPENCODE_BIN",
    defaultBinary: "opencode",
    displayName: "OpenCode",
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: "1.19.5",
    minVersion: null,
    launchesOnValidate: true,
    productionTier: true,
    productionGap: null,
  }),
  kimi: Object.freeze({
    optIn: "REALM_LIVE_KIMI",
    binOverride: "REALM_KIMI_BIN",
    defaultBinary: "kimi",
    displayName: "Kimi CLI",
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: "1.51.0",
    minVersion: null,
    launchesOnValidate: true,
    productionTier: false,
    productionGap: "the Python Kimi CLI is archived: its last release is a deprecation stub, so no session can run",
  }),
  qwen: wave2Spec({ optIn: "REALM_LIVE_QWEN", binOverride: "REALM_QWEN_BIN", defaultBinary: "qwen", displayName: "Qwen Code", recordedVersion: "0.22.0", launchesOnValidate: true }),
  // pi below 1.3.0 has no MCP and ignores mcp.json (E-PI2): the floor skips it.
  pi: wave2Spec({ optIn: "REALM_LIVE_PI", binOverride: "REALM_PI_BIN", defaultBinary: "pi", displayName: "Pi", recordedVersion: "1.5.2", minVersion: "1.3.0", launchesOnValidate: true }),
  hermes: wave2Spec({ optIn: "REALM_LIVE_HERMES", binOverride: "REALM_HERMES_BIN", defaultBinary: "hermes", displayName: "Hermes Agent", recordedVersion: "0.23.2", launchesOnValidate: true }),
  cursor: wave2Spec({ optIn: "REALM_LIVE_CURSOR", binOverride: "REALM_CURSOR_BIN", defaultBinary: "cursor-agent", displayName: "Cursor", recordedVersion: "2026.11.13", launchesOnValidate: true }),
  kilo: wave2Spec({ optIn: "REALM_LIVE_KILO", binOverride: "REALM_KILO_BIN", defaultBinary: "kilo", displayName: "Kilo Code", recordedVersion: "7.8.27", launchesOnValidate: true }),
  copilot: wave2Spec({ optIn: "REALM_LIVE_COPILOT", binOverride: "REALM_COPILOT_BIN", defaultBinary: "copilot", displayName: "GitHub Copilot CLI", recordedVersion: "1.0.112", launchesOnValidate: false }),
  augment: wave2Spec({ optIn: "REALM_LIVE_AUGMENT", binOverride: "REALM_AUGMENT_BIN", defaultBinary: "auggie", displayName: "Augment (Auggie)", recordedVersion: "1.2.1", launchesOnValidate: false }),
  codebuddy: wave2Spec({ optIn: "REALM_LIVE_CODEBUDDY", binOverride: "REALM_CODEBUDDY_BIN", defaultBinary: "codebuddy", displayName: "CodeBuddy Code", recordedVersion: "2.185.0", launchesOnValidate: true }),
  cline: wave2Spec({ optIn: "REALM_LIVE_CLINE", binOverride: "REALM_CLINE_BIN", defaultBinary: "cline", displayName: "Cline CLI", recordedVersion: "3.0.74", launchesOnValidate: false }),
});

// The sentence of the Kimi Code gap, written once so the live file and the helper test agree.
export const KIMI_CODE_GAP = "Kimi Code documents no validator command and no listing command (24-CONTEXT E-K5); its recipe is proven on a fixture host only";

// The sentence of the Antigravity gap: no live file exists for it, because `agy` was never observed.
export const ANTIGRAVITY_GAP =
  "Antigravity's CLI `agy` was never installed or run: its MCP file is documented by three Google pages and no listing command was observed (25-CONTEXT E-AG2); its recipe is proven on a fixture host only";

// The text the archived Python kimi prints for any invocation.
const KIMI_STUB_MARKER = "no longer maintained";

// ---- Version ---------------------------------------------------------------------------------------------------------------

const VERSION_PATTERN = /(?<!\d)(\d+\.\d+\.\d+)(?!\d)/;

// Compares two x.y.z versions numerically, part by part: negative when `left` is older, 0 when equal, positive when newer. A part that
// is not a number counts as 0, so a malformed string never throws.
export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

// A product word only for a host whose `--version` prints another x.y.z before the product's own; none of the nine wave-2 hosts does
// (a date or a commit hash follows the version: `2026.11.13-eacade1`, `v0.23.2 (2026.11.13)`).
const PRODUCT_WORDS: Readonly<Record<LiveHostId, RegExp | undefined>> = Object.freeze({
  claude: /Claude Code/i,
  codex: /codex-cli/i,
  opencode: undefined,
  kimi: /kimi/i,
  qwen: undefined,
  pi: undefined,
  hermes: undefined,
  cursor: undefined,
  kilo: undefined,
  copilot: undefined,
  augment: undefined,
  codebuddy: undefined,
  cline: undefined,
});

// The first x.y.z of `<bin> --version`: the one on the line that names the product when there is one (`2.1.322 (Claude Code)`,
// `codex-cli 0.154.0`, `kimi, version 1.51.0`), else the first in the output (`1.19.5`). Undefined when there is none.
export function parseHostVersion(host: LiveHostId, stdout: string): string | undefined {
  const word = PRODUCT_WORDS[host];
  if (word !== undefined) {
    for (const line of stdout.split("\n")) {
      if (word.test(line)) {
        const named = VERSION_PATTERN.exec(line)?.[1];
        if (named !== undefined) {
          return named;
        }
      }
    }
  }
  return VERSION_PATTERN.exec(stdout)?.[1];
}

// ---- Gate ------------------------------------------------------------------------------------------------------------------

// The result of `<bin> --version`: its stdout, or "unavailable" when it could not start, timed out or exited non-zero.
export type HostVersionProbe = { readonly kind: "output"; readonly stdout: string } | { readonly kind: "unavailable" };

// The host facts the gate decides from. Each is injected, so the hermetic test can cover every branch.
export interface HostLiveGateInputs {
  readonly platform: string;
  readonly env: EnvironmentLike;
  // The absolute path of the executable a name (looked up on PATH) or an absolute path names, or undefined.
  readonly resolveBinary: (nameOrPath: string) => string | undefined;
  readonly versionProbe: HostVersionProbe;
  // Whether dist/src/cli/main.js exists.
  readonly cliBuilt: boolean;
  // Whether the shared state directory already holds a Realm receipt for this host (production tier only).
  readonly receiptExists: boolean;
  // productionSkipReason of the production gate, consulted for the production tier only.
  readonly production: string | false;
}

// The reason the live rehearsal of `host` at `tier` cannot run, or false when every prerequisite holds. The reason names the FIRST
// missing prerequisite in the order of the header. A version newer than the recorded one never skips.
export function hostLiveSkipReason(host: LiveHostId, tier: HostLiveTier, inputs: HostLiveGateInputs): string | false {
  const spec = HOST_LIVE[host];
  const { env } = inputs;
  if (env[spec.optIn] !== "1") {
    return `${spec.optIn}=1 is not set; the live ${spec.displayName} rehearsal needs an explicit operator opt-in`;
  }
  if (inputs.platform !== "linux") {
    return `the live host rehearsals are verified on Linux only; this host is ${inputs.platform}`;
  }
  const override = env[spec.binOverride];
  const overridden = override !== undefined && override !== "";
  if (overridden && !isAbsolute(override)) {
    return `${spec.binOverride} must be an absolute path to the ${spec.defaultBinary} executable; a relative path is refused`;
  }
  const named = overridden ? override : spec.defaultBinary;
  if (inputs.resolveBinary(named) === undefined) {
    return `no ${spec.displayName} executable ${named}; install ${spec.defaultBinary} or point ${spec.binOverride} at it`;
  }
  if (inputs.versionProbe.kind === "unavailable") {
    return `${named} --version did not run to a successful exit`;
  }
  const parsed = parseHostVersion(host, inputs.versionProbe.stdout);
  if (parsed === undefined) {
    return `${named} --version printed no x.y.z version`;
  }
  if (spec.minVersion !== null && compareVersions(parsed, spec.minVersion) < 0) {
    return `${spec.displayName} ${parsed} is below ${spec.minVersion}, the first release with built-in MCP; a recipe for it would be silently ignored (25-CONTEXT E-PI2)`;
  }
  if (host === "kimi" && inputs.versionProbe.stdout.includes(KIMI_STUB_MARKER)) {
    return "the installed kimi is the archived Python stub, which writes no configuration and answers no subcommand";
  }
  if (!inputs.cliBuilt) {
    return "the built CLI dist/src/cli/main.js is missing; run npm run build first";
  }
  if (tier === "validator") {
    return false;
  }
  if (spec.productionGap !== null) {
    return spec.productionGap;
  }
  if (inputs.production !== false) {
    return inputs.production;
  }
  if (inputs.receiptExists) {
    return `the shared state directory already holds a Realm host receipt for ${host}; refusing to touch a real install`;
  }
  return false;
}

// ---- Executables and the version probe -------------------------------------------------------------------------------------

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The absolute path of the executable `nameOrPath` names: itself when absolute and executable, else the first absolute PATH entry
// that holds an executable of that name. The file is inspected, never run. Undefined when there is none.
export function resolveExecutable(nameOrPath: string, pathValue: string | undefined): string | undefined {
  if (isAbsolute(nameOrPath)) {
    return isExecutableFile(nameOrPath) ? nameOrPath : undefined;
  }
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (dir === "" || !isAbsolute(dir)) {
      continue;
    }
    const candidate = join(dir, nameOrPath);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const versionProbes = new Map<string, Promise<HostVersionProbe>>();

// `<bin> --version` once per binary for the process, run in a throwaway temporary home so the probe never reads or writes a real
// host configuration. Never rejects.
function versionOnce(host: LiveHostId, bin: string): Promise<HostVersionProbe> {
  const known = versionProbes.get(bin);
  if (known !== undefined) {
    return known;
  }
  const probe = (async (): Promise<HostVersionProbe> => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rlh-ver-")));
    try {
      const env = { PATH: [dirname(bin), dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: home, LANG: "C.UTF-8", TERM: "dumb" };
      const result = await runHost(bin, HOST_LIVE[host].versionArgs, env, home, scaledMs(VALIDATOR_TIMEOUT_MS));
      return result.exitCode === 0 ? { kind: "output", stdout: result.stdout } : { kind: "unavailable" };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  })();
  versionProbes.set(bin, probe);
  return probe;
}

export interface HostLiveGate {
  // The reason the rehearsal skips, or false.
  readonly skip: string | false;
  // The resolved absolute host executable, when the gate found one.
  readonly bin: string | undefined;
  // The observed host version, when the probe ran and printed one.
  readonly version: string | undefined;
}

export interface CollectHostLiveGate {
  readonly env: EnvironmentLike;
  readonly platform: string;
  // dist/src/cli/main.js beside the compiled tests.
  readonly cliPath: string;
}

// Reads the host facts hostLiveSkipReason decides from and decides. Nothing is started until the opt-in is set on Linux, so a plain
// `npm test` never runs a host CLI, `podman --version` or anything else.
export async function collectHostLiveGate(host: LiveHostId, tier: HostLiveTier, options: CollectHostLiveGate): Promise<HostLiveGate> {
  const spec = HOST_LIVE[host];
  const { env, platform, cliPath } = options;
  const resolveBinary = (nameOrPath: string): string | undefined => resolveExecutable(nameOrPath, env["PATH"]);
  const unprobed: HostLiveGateInputs = {
    platform,
    env,
    resolveBinary,
    versionProbe: { kind: "unavailable" },
    cliBuilt: false,
    receiptExists: false,
    production: false,
  };
  if (env[spec.optIn] !== "1" || platform !== "linux") {
    return { skip: hostLiveSkipReason(host, tier, unprobed), bin: undefined, version: undefined };
  }
  const override = env[spec.binOverride];
  const named = override === undefined || override === "" ? spec.defaultBinary : override;
  const relativeOverride = override !== undefined && override !== "" && !isAbsolute(override);
  const bin = relativeOverride ? undefined : resolveBinary(named);
  const versionProbe: HostVersionProbe = bin === undefined ? { kind: "unavailable" } : await versionOnce(host, bin);
  const cliBuilt = existsSync(cliPath);
  let production: string | false = false;
  let receiptExists = false;
  if (tier === "production" && spec.productionGap === null && cliBuilt) {
    production = productionSkipReason({
      env,
      // podmanSkipReason is reached only after the production opt-in, so a run without it never starts `podman --version`.
      podman: env[LIVE_PRODUCTION_VARIABLE] === "1" ? await probePodman() : { kind: "unavailable" },
      isSocket,
      onPath: (name) => onPath(name, env["PATH"]),
      exists: existsSync,
      isDirectory,
      cliPath,
    });
    if (production === false) {
      const stateDir = readLiveInputs(env, cliPath).driverStateDir;
      receiptExists = stateDir !== undefined && existsSync(join(stateDir, "hosts", `${host}.receipt.json`));
    }
  }
  const inputs: HostLiveGateInputs = { platform, env, resolveBinary, versionProbe, cliBuilt, receiptExists, production };
  const version = versionProbe.kind === "output" ? parseHostVersion(host, versionProbe.stdout) : undefined;
  return { skip: hostLiveSkipReason(host, tier, inputs), bin, version };
}

// ---- Stub realm ------------------------------------------------------------------------------------------------------------

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// Writes `<dir>/realm`, mode 0755: a POSIX sh script that appends each argument on its own line followed by a line `--` to
// `logFile` (one printf, so concurrent invocations do not interleave) and exits 0. It reads no environment and no network.
export function writeStubRealm(dir: string, logFile: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "realm");
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" '--' >> ${shellQuote(logFile)}\nexit 0\n`);
  chmodSync(path, 0o755);
  return path;
}

// The invocations the stub recorded, in order, each the list of its arguments. An argument that holds a newline is recorded as
// several lines. A log that does not exist yet is no invocation.
export function readStubArgv(logFile: string): string[][] {
  if (!existsSync(logFile)) {
    return [];
  }
  const invocations: string[][] = [];
  let current: string[] = [];
  const lines = readFileSync(logFile, "utf8").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  for (const line of lines) {
    if (line === "--") {
      invocations.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  return invocations;
}

// ---- Isolation -------------------------------------------------------------------------------------------------------------

// True when `path` lies strictly inside the real temporary directory.
export function isUnderTemp(path: string): boolean {
  const base = realpathSync(tmpdir());
  let real = resolve(path);
  try {
    real = realpathSync(real);
  } catch {
    // Not created yet: the resolved path stands.
  }
  return real.startsWith(`${base}${sep}`);
}

// The override variables each host reads, and the only ones isolatedHostEnv accepts for it.
export const HOST_OVERRIDE_VARIABLES: Readonly<Record<LiveHostId, readonly string[]>> = Object.freeze({
  claude: Object.freeze(["CLAUDE_CONFIG_DIR"]),
  codex: Object.freeze(["CODEX_HOME"]),
  opencode: Object.freeze([] as string[]),
  kimi: Object.freeze(["KIMI_SHARE_DIR"]),
  qwen: Object.freeze(["QWEN_HOME"]),
  pi: Object.freeze(["PI_CODING_AGENT_DIR"]),
  hermes: Object.freeze(["HERMES_HOME"]),
  cursor: Object.freeze([] as string[]),
  // XDG_CONFIG_HOME is already inside the isolated root; the override names the same directory explicitly.
  kilo: Object.freeze(["XDG_CONFIG_HOME"]),
  copilot: Object.freeze(["COPILOT_HOME"]),
  augment: Object.freeze(["AUGMENT_CACHE_DIR"]),
  codebuddy: Object.freeze(["CODEBUDDY_CONFIG_DIR"]),
  cline: Object.freeze(["CLINE_DIR"]),
});

export interface IsolatedHostEnvOptions {
  // The directory that holds the stub `realm`: first on PATH.
  readonly stubDir: string;
  // The directory of the host executable: second on PATH.
  readonly hostBinDir?: string;
  // Further PATH directories after the host's own and before /usr/bin:/bin (for a host that is a script needing `node`).
  readonly extraPathDirs?: readonly string[];
  // The environment LANG and TERM are read from. Nothing else of it is ever copied.
  readonly source?: EnvironmentLike;
  // Override variable -> absolute path under `root`; only the variables of HOST_OVERRIDE_VARIABLES[host].
  readonly overrides?: Readonly<Record<string, string>>;
}

function requireTemp(path: string, what: string): void {
  if (!isUnderTemp(path)) {
    throw new Error(`${what} must lie inside the temporary directory; refusing to build a host environment that could touch a real configuration`);
  }
}

// A fresh environment built from an allowlist, never from the whole process environment: PATH (the stub directory, the host's
// directory, /usr/bin:/bin), LANG, TERM, and HOME, TMPDIR and the four XDG directories inside `root`, plus only the override
// variables the caller names for this host. No credential, token, proxy or *_API_KEY variable ever appears. Throws before it
// creates anything when `root`, the stub directory or an override path is not inside the temporary directory.
export function isolatedHostEnv(root: string, host: LiveHostId, options: IsolatedHostEnvOptions): Record<string, string> {
  requireTemp(root, "the isolated root");
  requireTemp(options.stubDir, "the stub directory");
  const overrides = options.overrides ?? {};
  for (const [name, path] of Object.entries(overrides)) {
    if (!HOST_OVERRIDE_VARIABLES[host].includes(name)) {
      throw new Error(`${name} is not an override variable of ${host}`);
    }
    requireTemp(path, `the override ${name}`);
  }
  const source = options.source ?? {};
  const dirs = { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state") };
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true });
  }
  const pathEntries = [options.stubDir, ...(options.hostBinDir === undefined ? [] : [options.hostBinDir]), ...(options.extraPathDirs ?? []), "/usr/bin", "/bin"];
  return {
    PATH: pathEntries.join(delimiter),
    LANG: source["LANG"] ?? "C.UTF-8",
    TERM: source["TERM"] ?? "dumb",
    ...dirs,
    ...overrides,
  };
}

// ---- Bounded process-group runner ------------------------------------------------------------------------------------------

// Failure bounds only: a pass never waits on them. Scaled by REALM_TEST_TIMEOUT_SCALE.
export const VALIDATOR_TIMEOUT_MS = 120_000;
export const PRODUCTION_TIMEOUT_MS = 300_000;
const OUTPUT_LIMIT_BYTES = 1024 * 1024;
export const GROUP_KILL_GRACE_MS = 2_000;
export const PIPE_CLOSE_GRACE_MS = 1_000;

export interface HostRunResult {
  // Undefined when the command could not start, was signalled or timed out.
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export class Capture {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  push(chunk: Buffer): void {
    const room = OUTPUT_LIMIT_BYTES - this.size;
    if (room <= 0) {
      return;
    }
    const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(piece);
    this.size += piece.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Runs `bin args` with no shell as the leader of its own process group, stdout and stderr capped at 1 MiB each. On timeout the whole
// group gets SIGTERM, then SIGKILL after 2 s; when the command ends on its own the group is swept with SIGKILL as well, so nothing
// the host started outlives the call. Never rejects.
export function runHost(bin: string, args: readonly string[], env: Readonly<Record<string, string>>, cwd: string, timeoutMs: number): Promise<HostRunResult> {
  return new Promise((resolveResult) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(bin, [...args], { env: { ...env }, cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveResult({ exitCode: undefined, stdout: "", stderr: messageOf(error), timedOut: false });
      return;
    }
    const stdout = new Capture();
    const stderr = new Capture();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    const { pid } = child;
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let hardTimer: NodeJS.Timeout | undefined;
    let exitTimer: NodeJS.Timeout | undefined;
    const finish = (exitCode: number | undefined, note?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(hardTimer);
      clearTimeout(exitTimer);
      if (pid !== undefined) {
        signalGroup(pid, "SIGKILL");
      }
      resolveResult({ exitCode, stdout: stdout.text(), stderr: note === undefined ? stderr.text() : `${stderr.text()}${note}`, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (pid === undefined) {
        return;
      }
      signalGroup(pid, "SIGTERM");
      killTimer = setTimeout(() => {
        signalGroup(pid, "SIGKILL");
        hardTimer = setTimeout(() => {
          finish(undefined);
        }, GROUP_KILL_GRACE_MS);
      }, GROUP_KILL_GRACE_MS);
    }, timeoutMs);
    child.on("error", (error) => {
      finish(undefined, messageOf(error));
    });
    child.on("exit", (code) => {
      // The pipes normally close with the process; a grandchild that kept them open is not waited for beyond a short grace.
      exitTimer = setTimeout(() => {
        finish(timedOut ? undefined : (code ?? undefined));
      }, PIPE_CLOSE_GRACE_MS);
    });
    child.on("close", (code) => {
      finish(timedOut ? undefined : (code ?? undefined));
    });
  });
}

const CLIP_LIMIT = 300;

function clip(text: string): string {
  const trimmed = text.trim();
  return JSON.stringify(trimmed.length > CLIP_LIMIT ? `${trimmed.slice(0, CLIP_LIMIT)}...` : trimmed);
}

// One line for an assertion message: the exit, then the clipped output.
export function describeRun(result: Pick<HostRunResult, "exitCode" | "stdout" | "stderr"> & { readonly timedOut?: boolean }): string {
  const exit = result.timedOut === true ? "did not return (timed out)" : result.exitCode === undefined ? "did not exit" : `exit ${String(result.exitCode)}`;
  return `${exit}; stdout ${clip(result.stdout)}; stderr ${clip(result.stderr)}`;
}

// Fails a test with the sentence `did not return` when the command timed out instead of finishing.
export function requireReturned(result: HostRunResult, label: string): void {
  assert.equal(result.timedOut, false, `${label}: did not return within the bound; ${describeRun(result)}`);
}

// Whether a process is alive. A zombie waiting to be reaped is not: a killed grandchild whose parent is gone stays one until init
// reaps it, and the group kill's job is done at the signal.
export function processAlive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    // The state letter follows the last `)` of the command name, which may itself hold one.
    const state = stat.slice(stat.lastIndexOf(")") + 2)[0];
    return state !== undefined && state !== "Z" && state !== "X";
  } catch {
    if (existsSync("/proc/self")) {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---- Small helpers ---------------------------------------------------------------------------------------------------------

// The sha256 of a file, or null when it does not exist. The content is never read into a message.
export function fileSha256(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

const ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;?]*[A-Za-z]`, "g");

// Terminal output without its colour and cursor sequences.
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

// The single JSON object a successful realm command printed on one line. The command must have exited 0.
export function cliJson(result: CliResult, label: string): Record<string, unknown> {
  assert.equal(result.exitCode, 0, `${label}: exit ${String(result.exitCode)}; stderr ${clip(result.stderr)}`);
  const parsed: unknown = JSON.parse(result.stdout.trim());
  assert.ok(isRecord(parsed), `${label} must print one JSON object`);
  return parsed;
}

// The refusal reason of a failed `realm host install|uninstall`: the word after the command in its stderr line, or undefined.
export function refusalReasonOf(result: CliResult): string | undefined {
  return /^realm host (?:install|uninstall): ([a-z-]+):/.exec(result.stderr)?.[1];
}

// The owned `[mcp_servers.realm]` table of a Codex config, byte for byte (its header through its last key line, line endings
// included), or undefined when the table is absent or defined in any other form.
export function ownedTableOf(text: string): string | undefined {
  const found = locateTomlTable(text, ["mcp_servers", "realm"]);
  return found.state === "present" ? text.slice(found.start, found.end) : undefined;
}

// ---- Rig: one isolated root ------------------------------------------------------------------------------------------------

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;

export interface HostRigOptions {
  readonly host: LiveHostId;
  // The resolved absolute host executable.
  readonly bin: string;
  // Override variable -> directory name below the root (created): CLAUDE_CONFIG_DIR, CODEX_HOME or KIMI_SHARE_DIR.
  readonly overrides?: Readonly<Record<string, string>>;
}

export interface HostRig {
  readonly root: string;
  readonly home: string;
  // The project directory the host commands run in.
  readonly cwd: string;
  readonly stateDir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly bin: string;
  // `root`-relative path to an absolute one.
  readonly path: (...parts: readonly string[]) => string;
  // `realm host <words>` in process, on the real table and the real adapters directory, against this rig's own state directory.
  readonly realm: (words: readonly string[]) => Promise<CliResult>;
  // The host's own command, in the isolated environment.
  readonly host: (args: readonly string[], options?: { readonly timeoutMs?: number; readonly cwd?: string }) => Promise<HostRunResult>;
  // The invocations the stub realm recorded.
  readonly stubInvocations: () => string[][];
  // The receipt file of a host in this rig's state directory.
  readonly receiptFile: (host: LiveHostId) => string;
  readonly dispose: () => void;
}

// One isolated root under the temporary directory with an isolated HOME, XDG directories and TMPDIR, the stub realm first on PATH, a
// state directory of its own and a project directory. The root is removed by `t.after` of the caller via dispose().
export function createHostRig(options: HostRigOptions, source: EnvironmentLike): HostRig {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rlh-")));
  const stubDir = join(root, "stub");
  const stubLog = join(root, "stub.log");
  writeStubRealm(stubDir, stubLog);
  const overrides: Record<string, string> = {};
  for (const [name, dir] of Object.entries(options.overrides ?? {})) {
    const absolute = join(root, dir);
    mkdirSync(absolute, { recursive: true });
    overrides[name] = absolute;
  }
  const env = isolatedHostEnv(root, options.host, { stubDir, hostBinDir: dirname(options.bin), extraPathDirs: [dirname(process.execPath)], source, overrides });
  const cwd = join(root, "proj");
  const stateDir = join(root, "realm-state");
  mkdirSync(cwd);
  mkdirSync(stateDir, { mode: 0o700 });
  const home = env["HOME"];
  assert.ok(home !== undefined, "the isolated environment names its HOME");
  return {
    root,
    home,
    cwd,
    stateDir,
    env,
    bin: options.bin,
    path: (...parts) => join(root, ...parts),
    realm: (words) =>
      runCli(["host", ...words], {
        env,
        readConfig: () => ({ image: IMAGE, stateDir, workspaceRoot: join(root, "projects") }),
        now: () => new Date(),
      }),
    host: (args, runOptions = {}) => runHost(options.bin, args, env, runOptions.cwd ?? cwd, runOptions.timeoutMs ?? scaledMs(VALIDATOR_TIMEOUT_MS)),
    stubInvocations: () => readStubArgv(stubLog),
    receiptFile: (host) => join(stateDir, "hosts", `${host}.receipt.json`),
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---- Production tier -------------------------------------------------------------------------------------------------------

const REAL_HOST_TIMEOUT_MS = PRODUCTION_TIMEOUT_MS;
const REALM_COMMAND_TIMEOUT_MS = 60_000;
const DOWN_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

// The session drive: the host command is the host binary run with `args` (a session that never exits by itself, ended once the boot
// is observed) against `provider`, a loopback provider that refuses every request. The default drive (no `drive`) runs `<host> mcp list`.
export interface HostSessionDrive {
  readonly kind: "session";
  readonly provider: RefusingProvider;
  readonly args: readonly string[];
}

export interface HostProductionOptions {
  readonly host: "claude" | "codex" | "opencode";
  // The resolved absolute host executable and the compiled CLI beside the compiled tests.
  readonly bin: string;
  readonly cliPath: string;
  readonly env: EnvironmentLike;
  // The operator's real host configuration file: its sha256 must be equal before and after the run.
  readonly realFile: (home: string) => string;
  readonly drive?: HostSessionDrive;
}

// The line(s) of a host listing that name the realm server.
function realmLines(listing: string): string[] {
  return stripAnsi(listing)
    .split("\n")
    .filter((line) => /(^|[^\w-])realm([^\w-]|$)/.test(line));
}

// The number of boot reports the daemon recorded for `host` in `realm metrics` output, summed over the `attached` rows.
function attachedBootsOf(stdout: string, host: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return 0;
  }
  const rows = isRecord(parsed) ? parsed["hostBoot"] : undefined;
  if (!Array.isArray(rows)) {
    return 0;
  }
  let count = 0;
  for (const row of rows as unknown[]) {
    if (isRecord(row) && row["hostId"] === host && row["phase"] === "attached" && typeof row["count"] === "number") {
      count += row["count"];
    }
  }
  return count;
}

function presenceEntries(stateDir: string, host: string): string[] {
  const dir = join(stateDir, "hosts", `${host}-active`);
  return existsSync(dir) ? readdirSync(dir) : [];
}

// The production-tier scenario of claude, codex and opencode. The default drive is the real host's own health check (`<host> mcp list`):
// it performs a real MCP initialize against `realm mcp --host <id>` on the production stack. The session drive (codex) runs the host as a
// session against a refusing loopback provider and ends it once the daemon shows the boot and the recorder shows the tool listing. The
// registered `realm` is a wire recorder: it forwards the stream to the real CLI and logs method names and tool names. The gate has
// already passed. The host's configuration home is isolated (CLAUDE_CONFIG_DIR, CODEX_HOME, or the scenario's own XDG_CONFIG_HOME for
// opencode); HOME stays the account's, because the daemon the host starts needs it (Phase 22 measured AGENTOS_STOP_FAILED with a profile
// HOME). The operator's real host file must be byte-equal afterwards. No model turn happens and no credential is used.
export async function runHostProduction(t: TestContext, options: HostProductionOptions): Promise<void> {
  const { host } = options;
  const inputs: LiveInputs = readLiveInputs(options.env, options.cliPath);
  const hostsDir = inputs.driverStateDir === undefined ? undefined : join(inputs.driverStateDir, "hosts");
  const hostsDirExisted = hostsDir !== undefined && existsSync(hostsDir);
  const presenceDirExisted = hostsDir !== undefined && existsSync(join(hostsDir, `${host}-active`));

  const scenario: ScenarioEnvironment = createScenarioEnvironment(inputs, { image: inputs.image });
  const hostHome = scenario.cliEnvironment["HOME"];
  assert.ok(hostHome !== undefined, "the scenario environment must name the account home");
  const configHome = scenario.cliEnvironment["XDG_CONFIG_HOME"];
  assert.ok(configHome !== undefined, "the scenario environment must name its configuration home");
  const realFile = options.realFile(hostHome);
  const realBefore = fileSha256(realFile);

  const suffix = randomBytes(6).toString("hex");
  const projectDir = join(inputs.workspaceRoot, `host-boot-${host}-${suffix}`);
  // The directory must exist first: sandboxNameFor resolves its real path. The cleanup below runs `realm down` only while it exists.
  mkdirSync(projectDir);
  const sandboxes = [sandboxNameFor(projectDir)];
  const cleanups = createCleanups();
  t.after(() => cleanups.run());
  cleanups.add(async () => {
    // The body removes projectDir after its own `realm down`; the safety-net down runs only when the body failed before that.
    if (existsSync(projectDir)) {
      const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
      assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
    }
    restoreSharedPolicy(scenario);
    removeSharedStateCreatedBy(scenario);
    if (hostsDir !== undefined) {
      // The receipt and the presence directory of this run. Nothing that existed before the run is removed.
      rmSync(join(hostsDir, `${host}.receipt.json`), { force: true });
      if (!presenceDirExisted) {
        rmSync(join(hostsDir, `${host}-active`), { recursive: true, force: true });
      }
      if (!hostsDirExisted) {
        rmSync(hostsDir, { recursive: true, force: true });
      }
    }
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(scenario.root, { recursive: true, force: true });
    const residue = await waitForNoResidue(inputs, sandboxes);
    assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
  });

  // The host's own configuration home. Claude: a directory of the scenario named by CLAUDE_CONFIG_DIR. Codex: a directory of the
  // scenario named by CODEX_HOME. OpenCode: the `opencode` directory beside the scenario's realm/config.json, so both tools read their
  // own subdirectory of one XDG_CONFIG_HOME.
  const overrides: Record<string, string> = {};
  if (host === "claude") {
    const claudeDir = join(scenario.root, "cfg");
    mkdirSync(claudeDir);
    overrides["CLAUDE_CONFIG_DIR"] = claudeDir;
  } else if (host === "codex") {
    const codexDir = join(scenario.root, "codex");
    mkdirSync(codexDir);
    overrides["CODEX_HOME"] = codexDir;
  } else {
    mkdirSync(join(configHome, "opencode"), { recursive: true });
  }
  const shimDir = join(scenario.root, "shim");
  const wireLog = join(scenario.root, "wire.log");
  writeWireRecorder(shimDir, { nodePath: process.execPath, target: [process.execPath, options.cliPath], logFile: wireLog });
  const pathValue = [shimDir, dirname(options.bin), scenario.cliEnvironment["PATH"]].filter((entry): entry is string => entry !== undefined && entry !== "").join(delimiter);
  const env: Readonly<Record<string, string>> = { ...scenario.cliEnvironment, PATH: pathValue, ...overrides };

  const realmHost = (words: readonly string[]): Promise<CliResult> => runCli(["host", ...words], { env, now: () => new Date() });
  const realmStatus = (): Promise<CommandResult> => realmCliWithWorkspace(inputs, scenario, ["status"], projectDir, REALM_COMMAND_TIMEOUT_MS);
  const liveSessionsOf = async (): Promise<number> => {
    const row = cliJson(await realmHost(["status", host]), `realm host status ${host}`);
    const plugin = row["plugin"];
    const sessions = isRecord(plugin) ? plugin["sessions"] : undefined;
    const live = isRecord(sessions) ? sessions["live"] : undefined;
    return typeof live === "number" ? live : 0;
  };

  // Install through the real table against the scenario's state directory.
  const planned = cliJson(await realmHost(["install", host, "--dry-run"]), `realm host install ${host} --dry-run`);
  assert.equal(planned["dryRun"], true, `the dry run must say so: ${describeValue(planned)}`);
  const installed = cliJson(await realmHost(["install", host]), `realm host install ${host}`);
  assert.equal(installed["status"], "installed", `the install must report installed: ${describeValue(installed)}`);
  const afterInstall = cliJson(await realmHost(["status", host]), `realm host status ${host}`);
  assert.equal(afterInstall["status"], "installed", `realm host status ${host} must report installed: ${describeValue(afterInstall)}`);
  assert.equal(afterInstall["launch"], "on-path", `the shim realm must resolve on PATH: ${describeValue(afterInstall)}`);

  // The host command, from a directory under the pinned workspace root. The recorder's wire summary is what the tool listing is
  // asserted from; the daemon's view (status active, an attached boot report) is asserted beside it.
  const { drive } = options;
  const wireText = (): string => {
    const summary = wireSummary(readWireLog(wireLog));
    return `host methods [${summary.hostMethods.join(", ")}], tools [${summary.toolNames.join(", ")}]`;
  };
  const startedAt = Date.now();
  if (drive === undefined) {
    // The host's own health check.
    const listed = await runHost(options.bin, ["mcp", "list"], env, projectDir, scaledMs(REAL_HOST_TIMEOUT_MS));
    requireReturned(listed, `${host} mcp list`);
    assert.equal(listed.exitCode, 0, `${host} mcp list: ${describeRun(listed)}`);
    const lines = realmLines(listed.stdout);
    assert.ok(lines.length > 0, `${host} mcp list must list realm: ${describeRun(listed)}`);
    const joined = lines.join("\n");
    assert.match(joined, /\bconnected\b/i, `${host} must report realm connected: ${describeRun(listed)}`);
    assert.doesNotMatch(joined, /\bfailed\b/i, `${host} must not report realm failed: ${describeRun(listed)}`);
    t.diagnostic(`${host} mcp list reported: ${JSON.stringify(joined.trim())}`);
  } else {
    // A session never exits by itself: poll for the boot evidence and end the process group once it holds.
    const bootSeen = async (): Promise<boolean> => {
      if (!wireSummary(readWireLog(wireLog)).answered) {
        return false;
      }
      const status = await realmStatus();
      if (status.exitCode !== 0 || stateOfStatus(status.stdout) !== "active") {
        return false;
      }
      const metrics = await realmCli(inputs, scenario, ["metrics", "--workspace", projectDir], REALM_COMMAND_TIMEOUT_MS);
      return metrics.exitCode === 0 && attachedBootsOf(metrics.stdout, host) >= 1;
    };
    const session = await runHostUntil(options.bin, drive.args, env, projectDir, { ready: bootSeen, timeoutMs: scaledMs(REAL_HOST_TIMEOUT_MS), pollMs: POLL_INTERVAL_MS });
    assert.equal(session.endedBy, "ready", `${host} session ended by ${session.endedBy} before the boot was observed; wire: ${wireText()}; ${describeRun(session)}`);
  }
  const elapsedMs = Date.now() - startedAt;

  const summary = wireSummary(readWireLog(wireLog));
  t.diagnostic(`${host} wire: ${wireText()}; the host command took ${String(elapsedMs)} ms`);
  assert.ok(summary.hostMethods.includes("initialize"), `the host must have sent initialize to realm mcp: ${wireText()}`);
  if (host !== "opencode") {
    // OpenCode is recorded only: no OpenCode run has been observed yet (31-CONTEXT D-31-03).
    assert.equal(summary.answered, true, `the host must have listed the Realm tools through the recorder: ${wireText()}`);
    assert.deepEqual([...summary.toolNames], [...REALM_TOOL_NAMES], `the listed tools must be the six Realm tools: ${wireText()}`);
  }

  if (drive === undefined) {
    const active = await pollUntil(
      async () => {
        const status = await realmStatus();
        const state = status.exitCode === 0 ? stateOfStatus(status.stdout) : undefined;
        return state === "active" ? { done: true } : { done: false, detail: `realm status: ${describeResult(status)}` };
      },
      { timeoutMs: scaledMs(POLL_TIMEOUT_MS), intervalMs: POLL_INTERVAL_MS },
    );
    assert.ok(active.ok, `realm status must answer active for the project the host opened: ${active.detail}`);

    const booted = await pollUntil(
      async () => {
        const metrics = await realmCli(inputs, scenario, ["metrics", "--workspace", projectDir], REALM_COMMAND_TIMEOUT_MS);
        const count = metrics.exitCode === 0 ? attachedBootsOf(metrics.stdout, host) : 0;
        return count >= 1 ? { done: true } : { done: false, detail: `attached boot reports for ${host}: ${String(count)}; ${describeResult(metrics)}` };
      },
      { timeoutMs: scaledMs(POLL_TIMEOUT_MS), intervalMs: POLL_INTERVAL_MS },
    );
    assert.ok(booted.ok, `realm metrics must count at least one attached boot report for ${host}: ${booted.detail}`);
  } else {
    // The provider saw no credential and no foreign peer. Counts, flags and addresses only: never a header value.
    const requests = drive.provider.requests();
    const peers = [...new Set(requests.map((request) => request.peer))];
    const withAuthorization = requests.filter((request) => request.authorization).length;
    t.diagnostic(`${host} provider: ${String(requests.length)} request(s), ${String(withAuthorization)} with an Authorization header, peers [${peers.join(", ")}]`);
    assert.equal(withAuthorization, 0, `the refusing provider must never see an Authorization header (${String(withAuthorization)} request(s) carried one)`);
    for (const peer of peers) {
      assert.ok(isLoopbackPeer(peer), `the refusing provider must only see loopback peers; saw ${peer}`);
    }
  }

  // The host command ended, so its realm session ended: no live session and an empty presence directory.
  const quiet = await pollUntil(
    async () => {
      const live = await liveSessionsOf();
      const markers = presenceEntries(scenario.stateDir, host);
      return live === 0 && markers.length === 0 ? { done: true } : { done: false, detail: `live sessions ${String(live)}, presence markers ${String(markers.length)}` };
    },
    { timeoutMs: scaledMs(POLL_TIMEOUT_MS), intervalMs: POLL_INTERVAL_MS },
  );
  assert.ok(quiet.ok, `realm host status ${host} must show 0 live sessions and an empty presence directory after the command ends: ${quiet.detail}`);

  const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
  assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
  rmSync(projectDir, { recursive: true, force: true });
  const residue = await waitForNoResidue(inputs, sandboxes);
  assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
  for (const sandbox of sandboxes) {
    const containers = await listSandboxContainers(inputs, sandbox);
    assert.ok(containers.ok, `list the containers of ${sandbox} after realm down: ${describeValue(containers)}`);
    assert.deepEqual(containers.items, [], `no container of ${sandbox} may remain after realm down`);
  }

  const removed = cliJson(await realmHost(["uninstall", host]), `realm host uninstall ${host}`);
  assert.equal(removed["status"], "removed", `the uninstall must report removed: ${describeValue(removed)}`);
  const afterUninstall = cliJson(await realmHost(["status", host]), `realm host status ${host}`);
  assert.notEqual(afterUninstall["status"], "installed", `realm host status ${host} must no longer report installed: ${describeValue(afterUninstall)}`);
  assert.equal(fileSha256(realFile), realBefore, "the operator's real host configuration must be byte-identical after the run");
}

// ---- Helpers shared by the live files --------------------------------------------------------------------------------------

// The host executable of a gate that is open. A closed gate never reaches a test body, so this throws only on a programming error.
export function gateBin(gate: HostLiveGate): string {
  if (gate.bin === undefined) {
    throw new Error("the live rehearsal ran although its gate is closed");
  }
  return gate.bin;
}

// One diagnostic line: the observed host version against the recorded one. A different version runs and is recorded, never skipped.
export function hostVersionNote(host: LiveHostId, gate: HostLiveGate): string {
  const spec = HOST_LIVE[host];
  const version = gate.version ?? "unknown";
  const same = version === spec.recordedVersion ? "the recorded version" : `a different version than the recorded ${spec.recordedVersion}; it runs and is recorded`;
  return `${spec.displayName} ${version}: ${same}`;
}

// The { path, action } pairs of an install or uninstall result line.
export function actionsOf(line: Record<string, unknown>, label: string): { readonly path: string; readonly action: string }[] {
  const actions = line["actions"];
  assert.ok(Array.isArray(actions), `${label} must name its actions: ${describeValue(line)}`);
  return (actions as unknown[]).map((action) => {
    assert.ok(isRecord(action), `${label}: an action must be an object: ${describeValue(action)}`);
    const path = action["path"];
    const kind = action["action"];
    assert.ok(typeof path === "string" && typeof kind === "string", `${label}: an action must carry a path and an action: ${describeValue(action)}`);
    return { path, action: kind };
  });
}

// The parsed JSON object a file holds.
export function jsonObjectAt(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(isRecord(parsed), "the file must hold a JSON object");
  return parsed;
}

// The `realm host status <host>` line of one host.
export async function hostStatusOf(rig: HostRig, host: LiveHostId): Promise<Record<string, unknown>> {
  return cliJson(await rig.realm(["status", host]), `realm host status ${host}`);
}
