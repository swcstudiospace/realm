// Prerequisite probe for Podman (RT-02, D-53). All I/O is injected: runCommand runs an argv
// with no shell, and connectSocket dials a Unix socket. The probe runs three steps in order
// and stops at the first failure. It never installs or upgrades anything.

import { isAbsolute, join } from "node:path";
import { ERROR_CATALOGUE, RealmError } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import type { EnvironmentLike } from "../session/paths.js";
import { OPENSHELL_MIN_PODMAN_MAJOR, parsePodmanVersion } from "./podman-version.js";

// The only host environment names that reach the version command or the socket dial (T-03-04).
const PASSED_ENV_NAMES = ["PATH", "HOME", "XDG_RUNTIME_DIR"] as const;

const FIX_START_SOCKET = "Fix: run systemctl --user start podman.socket.";

export interface CommandOptions {
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export interface CommandOutcome {
  readonly exitCode: number;
  readonly stdout: string;
}

// Runs file with args as argv, with no shell. Resolves with the exit status. Rejects with a
// plain error when the process cannot be started (for example ENOENT). The probe never copies
// that error's message into a reason.
export type RunCommand = (
  file: string,
  args: readonly string[],
  options: CommandOptions,
) => Promise<CommandOutcome>;

// Dials a Unix socket and resolves once it is connected. Rejects on refusal, a missing socket,
// or any other failure. The probe never copies that error's message into a reason.
export type ConnectSocket = (socketPath: string, timeoutMs: number) => Promise<void>;

export interface PodmanProbeOptions {
  readonly runCommand: RunCommand;
  readonly connectSocket: ConnectSocket;
  readonly env: EnvironmentLike;
  readonly timeoutMs: number;
}

export type PodmanProbeCode = "PODMAN_MISSING" | "PODMAN_UNSUPPORTED_VERSION" | "PODMAN_MACHINE_DOWN";

export interface PodmanProbeFailure {
  readonly ok: false;
  readonly code: PodmanProbeCode;
  readonly reason: string;
}

export type PodmanProbeResult =
  | { readonly ok: true; readonly version: string }
  | PodmanProbeFailure;

export async function probePodman(options: PodmanProbeOptions): Promise<PodmanProbeResult> {
  const env = minimalEnv(options.env);

  const read = await readVersion(options.runCommand, env, options.timeoutMs);
  if (!read.ok) {
    return failure("PODMAN_MISSING", read.detail);
  }

  const parsed = parsePodmanVersion(read.stdout);
  if (!parsed.ok) {
    return failure(
      "PODMAN_UNSUPPORTED_VERSION",
      `Could not read a Podman version (${parsed.reason}); OpenShell requires Podman 5.x. Realm does not install or upgrade Podman.`,
    );
  }
  if (parsed.major < OPENSHELL_MIN_PODMAN_MAJOR) {
    return failure(
      "PODMAN_UNSUPPORTED_VERSION",
      `Detected Podman ${parsed.version}; OpenShell requires Podman 5.x. Realm does not install or upgrade Podman; upgrade Podman yourself.`,
    );
  }

  const socketPath = apiSocketPath(env);
  if (socketPath === undefined) {
    return failure(
      "PODMAN_MACHINE_DOWN",
      `XDG_RUNTIME_DIR is not set to an absolute path, so the rootless Podman API socket cannot be located. ${FIX_START_SOCKET}`,
    );
  }
  const dial = await dialSocket(options.connectSocket, socketPath, options.timeoutMs);
  if (dial === "timed-out") {
    return failure(
      "PODMAN_MACHINE_DOWN",
      `The rootless Podman API socket did not answer a connection within ${options.timeoutMs} ms. ${FIX_START_SOCKET}`,
    );
  }
  if (dial === "refused") {
    return failure(
      "PODMAN_MACHINE_DOWN",
      `The rootless Podman API socket refused the connection or is missing. ${FIX_START_SOCKET}`,
    );
  }

  return { ok: true, version: parsed.version };
}

// The catalogue reason for the code, followed by the specific detail for this failure (D-53).
function failure(code: PodmanProbeCode, detail: string): PodmanProbeFailure {
  return { ok: false, code, reason: `${ERROR_CATALOGUE[code].reason} ${detail}` };
}

function minimalEnv(env: EnvironmentLike): Record<string, string> {
  const passed: Record<string, string> = {};
  for (const name of PASSED_ENV_NAMES) {
    const value = env[name];
    if (value !== undefined) {
      passed[name] = value;
    }
  }
  return passed;
}

// The rootless API socket lives under XDG_RUNTIME_DIR (OQ-P3-13). No other path is dialed.
function apiSocketPath(env: Readonly<Record<string, string>>): string | undefined {
  const runtimeDir = env["XDG_RUNTIME_DIR"];
  if (runtimeDir === undefined || !isAbsolute(runtimeDir)) {
    return undefined;
  }
  return join(runtimeDir, "podman", "podman.sock");
}

type VersionRead =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly detail: string };

// A failure to start (ENOENT), a non-zero exit, and a timeout all mean PODMAN_MISSING.
// withTimeout rejects with a RealmError only when its own timer fires.
async function readVersion(
  runCommand: RunCommand,
  env: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<VersionRead> {
  let outcome: CommandOutcome;
  try {
    outcome = await withTimeout(
      runCommand("podman", ["--version"], { env, timeoutMs }),
      timeoutMs,
      "PODMAN_MISSING",
    );
  } catch (error: unknown) {
    if (error instanceof RealmError) {
      return { ok: false, detail: `podman --version did not finish within ${timeoutMs} ms.` };
    }
    return {
      ok: false,
      detail: "podman could not be started; the binary is missing or not executable. Install Podman 5.x and put it on PATH.",
    };
  }
  if (outcome.exitCode !== 0) {
    return { ok: false, detail: `podman --version exited with status ${outcome.exitCode}.` };
  }
  return { ok: true, stdout: outcome.stdout };
}

// How one dial of the API socket ended. A RealmError is withTimeout's own timer, as in readVersion.
type SocketDial = "accepted" | "timed-out" | "refused";

async function dialSocket(
  connectSocket: ConnectSocket,
  socketPath: string,
  timeoutMs: number,
): Promise<SocketDial> {
  try {
    await withTimeout(connectSocket(socketPath, timeoutMs), timeoutMs, "PODMAN_MACHINE_DOWN");
    return "accepted";
  } catch (error: unknown) {
    return error instanceof RealmError ? "timed-out" : "refused";
  }
}
