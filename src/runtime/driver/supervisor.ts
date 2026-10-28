// The host supervisor of one sandbox (phase 9.5, wave 2). The driver starts the supervisor binary with an exact argument array
// and an exact environment (runtime-channel.ts builds both), with its stdin held open as a pipe. The supervisor exits when that
// pipe closes, so the driver's exit ends every supervisor it started. Its stdout and stderr go to nowhere: the supervisor
// handles launch secrets, and the driver never copies its output into a log.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { makeRealmError, RealmError } from "../../core/errors.js";

// How long a supervisor gets to exit after SIGTERM before it is killed.
const STOP_GRACE_MS = 5000;

export interface SupervisorSpawn {
  // The absolute path of the supervisor executable.
  readonly binary: string;
  readonly args: readonly string[];
  // The whole environment of the supervisor. It is not merged with the driver's.
  readonly env: Readonly<Record<string, string>>;
  // The lowercase hex sha256 the supervisor file must have. When set, the file is hashed by path immediately before the spawn and a
  // mismatch refuses with SCHEMA_INVALID. The pin protects against drift and against an accidental or out-of-band replacement of
  // the file. It does not protect against a writer with the same uid: the file is hashed by path and spawned by path, so a swap
  // between the hash and the spawn is not detected.
  readonly expectedSha256?: string;
}

// A started supervisor. stop ends it: SIGTERM, then SIGKILL after a bounded wait. Stopping an exited supervisor does nothing.
// exited resolves when the process exits, however it exits, and hasExited reports whether it already has. The driver uses both to
// refuse a sandbox whose supervisor exits before Ready, and to report a failed sandbox when it exits after.
export interface SupervisorHandle {
  readonly exited: Promise<void>;
  hasExited(): boolean;
  stop(): Promise<void>;
}

// The sha256 of a file as lowercase hex. A file that cannot be read refuses with SCHEMA_INVALID and names no path.
function sha256OfFile(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// Refuses with SCHEMA_INVALID unless the file's sha256 equals the expected lowercase hex digest. The refusal names neither the
// digest nor the path.
export function assertSha256OfFile(path: string, expectedSha256: string): void {
  if (sha256OfFile(path) !== expectedSha256) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// Starts the supervisor. Resolves when the process has spawned, and refuses when it cannot be started or when its file no longer
// matches the expected digest. An error after start is not reported here: the process is already running and the driver stops it
// by signal.
export function spawnSupervisor(options: SupervisorSpawn): Promise<SupervisorHandle> {
  return new Promise<SupervisorHandle>((resolve, reject) => {
    if (options.expectedSha256 !== undefined) {
      try {
        assertSha256OfFile(options.binary, options.expectedSha256);
      } catch (error: unknown) {
        reject(error instanceof RealmError ? error : makeRealmError("SCHEMA_INVALID"));
        return;
      }
    }
    const child = spawn(options.binary, [...options.args], {
      env: { ...options.env },
      stdio: ["pipe", "ignore", "ignore"],
      shell: false,
      windowsHide: true,
    });
    let exitedNow = false;
    const exited = new Promise<void>((resolveExit) => {
      child.once("exit", () => {
        exitedNow = true;
        resolveExit();
      });
    });
    child.on("error", () => {
      reject(makeRealmError("OPENSHELL_START_FAILED"));
    });
    child.once("spawn", () => {
      resolve({
        exited,
        hasExited: () => exitedNow,
        stop: async () => {
          if (child.exitCode !== null || child.signalCode !== null) {
            return;
          }
          child.kill("SIGTERM");
          const exitedInGrace = await settledWithin(exited, STOP_GRACE_MS);
          if (!exitedInGrace) {
            child.kill("SIGKILL");
            await exited;
          }
        },
      });
    });
  });
}

// Resolves true when the promise settles within the given time, and false when the time runs out first.
function settledWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
