import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindRoot } from "../../src/fs/root.js";
import { checkpointSessionDirOf, sessionIdOfWorkspace } from "../../src/session/paths.js";
import { writeWorkspacePin } from "../../src/session/workspace-pin.js";
import { scaledMs, testTimeout } from "../support/timing.js";

// The bound on the snapshot child. A read that blocks on a FIFO never returns, so the child is killed here and the test fails
// instead of hanging the runner. A synchronous block would also stop the test's own timer, so the bound must be a process.
const CHILD_TIMEOUT_MS = 10_000;

// Child process body, run by node -e. The compiled checkpoint module is loaded by URL in a separate process, as in
// atomic-write.test.ts, because a static import cannot express a child that may never return.
const SNAPSHOT_SCRIPT = `
const p = JSON.parse(process.env.REALM_CHILD_PAYLOAD);
const { snapshotWorkspace } = await import(p.checkpointUrl);
let code = "RETURNED";
try {
  await snapshotWorkspace(p.request);
} catch (error) {
  code = error?.code ?? "UNEXPECTED";
}
process.stdout.write(JSON.stringify({ code }));
`;

// Runs the snapshot in a fresh Node process. The child must exit by itself, with status 0 and a typed code on stdout.
function runSnapshotChild(payload: Record<string, unknown>): { code: string } {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", SNAPSHOT_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, REALM_CHILD_PAYLOAD: JSON.stringify(payload) },
    timeout: scaledMs(CHILD_TIMEOUT_MS),
  });
  assert.equal(run.error, undefined, `snapshot did not return on its own: ${run.error?.message ?? ""}`);
  assert.equal(run.signal, null, "snapshot process was killed by a signal instead of returning");
  assert.equal(run.status, 0, `snapshot process exited with an error: ${run.stderr}`);
  return JSON.parse(run.stdout) as { code: string };
}

// Creates a FIFO with coreutils mkfifo. A missing or failing mkfifo fails the test.
function createFifo(path: string): void {
  const made = spawnSync("mkfifo", [path], { encoding: "utf8" });
  if (made.error !== undefined || made.status !== 0) {
    throw new Error(`mkfifo (coreutils) is required to create ${path}: ${made.error?.message ?? made.stderr}`);
  }
}

// An unbound session: a pin names the workspace, and no registry entry exists. The lock path of its session directory is a
// FIFO with no writer. A lock read that opened the FIFO would block forever; the verified read refuses it instead.
void test(
  "a snapshot whose lock path is a FIFO is refused with LOCK_CONFLICT and never blocks",
  testTimeout(30_000),
  (t) => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-nonblock-")));
    t.after(() => {
      rmSync(base, { recursive: true, force: true });
    });
    const ws = join(base, "ws");
    mkdirSync(ws);
    const state = join(base, "state");
    const pinned = bindRoot(ws);
    const sessionId = sessionIdOfWorkspace(pinned.realPath);
    writeWorkspacePin(state, pinned, sessionId);
    const sessionDir = checkpointSessionDirOf(state, sessionId);
    mkdirSync(sessionDir, { recursive: true });
    // checkpoint-lock.ts names its lock file .lock in the session directory.
    createFifo(join(sessionDir, ".lock"));

    const outcome = runSnapshotChild({
      checkpointUrl: new URL("../../src/session/checkpoint.js", import.meta.url).href,
      request: { entry: null, sessionId, stateRoot: state, checkpointId: "c1" },
    });

    assert.equal(outcome.code, "LOCK_CONFLICT");
  },
);
