// Host-binary and kernel-hardening doctor items (phase 9.7, A18, A10 F1). The caller in checks.ts hands in every input: the host
// environment, the pins, both timeouts, the version runner and the ptrace reader. This module applies no default of its own and
// runs no process itself, so it imports nothing from checks.ts. A detail names a binary, a version or a short digest prefix,
// never a path.

import { createHash } from "node:crypto";
import { accessSync, constants, createReadStream, readFileSync, statSync, type ReadStream } from "node:fs";
import { isAbsolute, join } from "node:path";
import { withTimeout } from "../core/timeout.js";
import type { RunCommand } from "../runtime/podman-probe.js";
import type { EnvironmentLike } from "../session/paths.js";

type HostBinaryName = "supervisor" | "openshell" | "openshell-gateway" | "podman";

// What a host binary is expected to be. Every field is optional. path is the location the binary must resolve to, version is the
// version its --version output reports, and sha256 is the lowercase hex digest of its file.
interface HostBinaryPin {
  readonly path?: string;
  readonly version?: string;
  readonly sha256?: string;
}

export type HostBinaryPins = Readonly<Partial<Record<HostBinaryName, HostBinaryPin>>>;

// The inputs of the host-binaries item. The caller has applied every default: the pins, both timeouts and the runner.
export interface HostBinaryInput {
  readonly env: EnvironmentLike;
  readonly pins: HostBinaryPins;
  readonly runCommand: RunCommand;
  readonly probeTimeoutMs: number;
  readonly hashTimeoutMs: number;
}

// The result of either host item. Its id is one of the two items of this module.
export interface HostCheckResult {
  readonly id: "host-binaries" | "kernel-hardening";
  readonly status: "pass" | "warn" | "fail";
  readonly detail: string;
  readonly fix: string | null;
}

// ---- Phase 9.7 items. Neither fails: a host that differs from its pins, or whose kernel allows same-uid ptrace, still runs, and
// the item says what to record or tighten.

const HOST_BINARY_NAMES: readonly HostBinaryName[] = ["supervisor", "openshell", "openshell-gateway", "podman"];
// The host supervisor is not on PATH: the driver is configured with its absolute path under this name.
const SUPERVISOR_BINARY_ENV = "REALM_DRIVER_SUPERVISOR_BINARY";
// The driver reads its supervisor digest pin from this variable. The doctor falls back to it, so one variable pins both.
const DRIVER_SUPERVISOR_SHA256_ENV = "REALM_DRIVER_SUPERVISOR_SHA256";
const HOST_PIN_ENV_PREFIX = "REALM_HOST_PIN_";
// The only host environment names that reach a version command, the same set the Podman probe passes.
const HOST_BINARY_ENV_NAMES = ["PATH", "HOME", "XDG_RUNTIME_DIR"] as const;
const SHA_PREFIX_LENGTH = 12;
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?/;
const FIX_HOST_BINARIES =
  "Install any missing binary on PATH (the supervisor path comes from REALM_DRIVER_SUPERVISOR_BINARY). To record a pin, run each binary with --version, take the sha256 of its file with sha256sum, and set REALM_HOST_PIN_<NAME>_VERSION and REALM_HOST_PIN_<NAME>_SHA256, where NAME is SUPERVISOR, OPENSHELL, OPENSHELL_GATEWAY or PODMAN. Compare the --version output and the digest, never the package manager's database: a binary can be overwritten in place.";
const FIX_SUPERVISOR_UNPINNED = "set REALM_DRIVER_SUPERVISOR_SHA256 to the sha256 shown above";
const FIX_PIN_FORMAT = "a pin must be 64 lowercase hex characters";
// The driver accepts a digest pin only in this form, so the doctor does not normalise case: an upper-case pin would pass here and
// leave a driver that refuses to start.
const PIN_SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FIX_PTRACE_SCOPE =
  "Set kernel.yama.ptrace_scope to 1 or higher (sysctl kernel.yama.ptrace_scope=1, persisted under /etc/sysctl.d), and check that the Yama security module is enabled.";

// Reads the pins an operator recorded in the host environment: REALM_HOST_PIN_<NAME>_PATH, _VERSION and _SHA256, where NAME is
// the binary's name in upper case with dashes as underscores. For these variables an empty value is no pin. The supervisor's
// digest pin falls back to REALM_DRIVER_SUPERVISOR_SHA256, the variable the driver reads, when REALM_HOST_PIN_SUPERVISOR_SHA256 is
// unset. That variable is taken exactly as set: the driver refuses a padded or empty value, so either one is a pin the doctor
// reports as malformed, not as no pin.
export function hostBinaryPinsFromEnv(env: EnvironmentLike): HostBinaryPins {
  const pins: Partial<Record<HostBinaryName, HostBinaryPin>> = {};
  for (const name of HOST_BINARY_NAMES) {
    const stem = `${HOST_PIN_ENV_PREFIX}${name.toUpperCase().replace(/-/g, "_")}`;
    const path = pinValue(env, `${stem}_PATH`);
    const version = pinValue(env, `${stem}_VERSION`);
    const sha256 = pinValue(env, `${stem}_SHA256`) ?? (name === "supervisor" ? env[DRIVER_SUPERVISOR_SHA256_ENV] : undefined);
    if (path !== undefined || version !== undefined || sha256 !== undefined) {
      pins[name] = {
        ...(path === undefined ? {} : { path }),
        ...(version === undefined ? {} : { version }),
        ...(sha256 === undefined ? {} : { sha256 }),
      };
    }
  }
  return pins;
}

function pinValue(env: EnvironmentLike, key: string): string | undefined {
  const value = env[key]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

interface HostBinaryInspection {
  // "name version sha-prefix" for a binary that was found.
  readonly summary?: string;
  // Set for a supervisor that was found but has no digest pin; it names the digest the operator can pin.
  readonly unpinnedNote?: string;
  // Set when a digest pin is not exactly 64 lowercase hex characters, the only form the driver accepts.
  readonly malformedPin?: boolean;
  readonly problems: readonly string[];
}

// host-binaries (phase 9.7, A18). The supervisor, the openshell CLI, the gateway and podman each report their --version and the
// sha256 of their executable. A set pin that does not match, a binary that is missing, and a reading that fails each warn, and so
// does a supervisor with no digest pin: it handles launch secrets and its file is writable by the realm account. The package
// manager's database is never consulted: a binary can be overwritten in place, so only the binary itself is compared.
export async function hostBinariesCheck(input: HostBinaryInput): Promise<HostCheckResult> {
  const id = "host-binaries";
  const inspections = await Promise.all(
    HOST_BINARY_NAMES.map((name) => inspectHostBinary(name, hostBinaryLocation(name, input.env), input.pins[name], input)),
  );
  const problems = inspections.flatMap((inspection) => inspection.problems);
  const unpinned = inspections.flatMap((inspection) => (inspection.unpinnedNote === undefined ? [] : [inspection.unpinnedNote]));
  const summaries = inspections.flatMap((inspection) => (inspection.summary === undefined ? [] : [inspection.summary]));
  if (problems.length === 0 && unpinned.length === 0) {
    return { id, status: "pass", detail: summaries.join("; "), fix: null };
  }
  const observed = summaries.length === 0 ? "" : `. Observed: ${summaries.join("; ")}`;
  const fixes = [
    ...(problems.length === 0 ? [] : [FIX_HOST_BINARIES]),
    ...(inspections.some((inspection) => inspection.malformedPin === true) ? [FIX_PIN_FORMAT] : []),
    ...(unpinned.length === 0 ? [] : [FIX_SUPERVISOR_UNPINNED]),
  ];
  return { id, status: "warn", detail: `${[...problems, ...unpinned].join("; ")}${observed}`, fix: fixes.join(" ") };
}

async function inspectHostBinary(
  name: HostBinaryName,
  location: string | undefined,
  pin: HostBinaryPin | undefined,
  input: HostBinaryInput,
): Promise<HostBinaryInspection> {
  if (location === undefined) {
    return { problems: [name === "supervisor" ? "supervisor is not configured or not executable" : `${name} was not found on PATH`] };
  }
  const [version, sha256] = await Promise.all([
    readBinaryVersion(location, input.runCommand, input.env, input.probeTimeoutMs),
    sha256OfBinary(location, input.hashTimeoutMs),
  ]);
  const problems: string[] = [];
  if (version === undefined) {
    problems.push(`${name} version could not be read`);
  } else if (pin?.version !== undefined && version !== pin.version) {
    problems.push(`${name} reports ${version} but its pin says ${pin.version}`);
  }
  const pinMalformed = pin?.sha256 !== undefined && !PIN_SHA256_PATTERN.test(pin.sha256);
  if (pinMalformed) {
    problems.push(`${name} sha256 pin is not 64 lowercase hex characters`);
  }
  if (sha256 === undefined) {
    problems.push(`${name} sha256 could not be computed`);
  } else if (pin?.sha256 !== undefined && !pinMalformed && sha256 !== pin.sha256) {
    problems.push(`${name} sha256 differs from its pin`);
  }
  if (pin?.path !== undefined && location !== pin.path) {
    problems.push(`${name} does not resolve to its pinned location`);
  }
  return {
    summary: `${name} ${version ?? "unknown"} ${sha256?.slice(0, SHA_PREFIX_LENGTH) ?? "unknown"}`,
    ...(name === "supervisor" && sha256 !== undefined && pin?.sha256 === undefined
      ? { unpinnedNote: `supervisor has no sha256 pin (sha256 ${sha256})` }
      : {}),
    ...(pinMalformed ? { malformedPin: true } : {}),
    problems,
  };
}

// The supervisor is the absolute path the driver is configured with. The other binaries are the first executable of that name on
// the PATH the caller handed in. The file at that path is run and hashed by path, so the check cannot tell whether two reads of the
// path saw the same inode: it reports drift, not a swap between reads.
function hostBinaryLocation(name: HostBinaryName, env: EnvironmentLike): string | undefined {
  if (name === "supervisor") {
    const configured = env[SUPERVISOR_BINARY_ENV];
    return configured !== undefined && isAbsolute(configured) && isExecutableFile(configured) ? configured : undefined;
  }
  for (const directory of (env["PATH"] ?? "").split(":")) {
    if (isAbsolute(directory)) {
      const candidate = join(directory, name);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// The version a binary reports for --version, or undefined when it cannot run, exits non-zero, does not finish in time, or prints no
// version. Each of those is reported as a warning by the caller, with no output text.
async function readBinaryVersion(
  location: string,
  runCommand: RunCommand,
  hostEnv: EnvironmentLike,
  timeoutMs: number,
): Promise<string | undefined> {
  const env: Record<string, string> = {};
  for (const key of HOST_BINARY_ENV_NAMES) {
    const value = hostEnv[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  try {
    const outcome = await withTimeout(runCommand(location, ["--version"], { env, timeoutMs }), timeoutMs, "OPENSHELL_START_FAILED");
    return outcome.exitCode === 0 ? VERSION_PATTERN.exec(outcome.stdout)?.[0] : undefined;
  } catch {
    return undefined;
  }
}

// The lowercase hex sha256 of an executable, or undefined when it cannot be read within the bound.
async function sha256OfBinary(location: string, timeoutMs: number): Promise<string | undefined> {
  const stream = createReadStream(location);
  try {
    return await withTimeout(digestOfStream(stream), timeoutMs, "OPENSHELL_START_FAILED");
  } catch {
    return undefined;
  } finally {
    stream.destroy();
  }
}

function digestOfStream(stream: ReadStream): Promise<string> {
  const hash = createHash("sha256");
  return new Promise<string>((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(chunk);
    });
    stream.once("error", reject);
    stream.once("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

// kernel-hardening (phase 9.7, A10 F1). With the Yama ptrace scope at 0, a process may ptrace any process of its own uid, so a
// workload could reach the in-container runtime if the runtime's own filters were absent. Scope 1 or higher restricts it. The item
// never fails: it reports what the kernel allows. read is the text reader of the scope, and the caller applies the default.
export function kernelHardeningCheck(read: () => string): HostCheckResult {
  const id = "kernel-hardening";
  let scope: number | undefined;
  try {
    const text = read().trim();
    scope = /^\d+$/.test(text) ? Number(text) : undefined;
  } catch {
    scope = undefined;
  }
  if (scope === undefined) {
    return {
      id,
      status: "warn",
      detail: "kernel.yama.ptrace_scope is unknown: the Yama setting could not be read",
      fix: FIX_PTRACE_SCOPE,
    };
  }
  if (scope === 0) {
    return {
      id,
      status: "warn",
      detail:
        "kernel.yama.ptrace_scope is 0: same-uid ptrace is unrestricted, so a workload could reach the in-container runtime if the runtime's own filters were absent",
      fix: FIX_PTRACE_SCOPE,
    };
  }
  return { id, status: "pass", detail: `kernel.yama.ptrace_scope is ${String(scope)}`, fix: null };
}

export function defaultReadPtraceScope(): string {
  return readFileSync("/proc/sys/kernel/yama/ptrace_scope", "utf8");
}
