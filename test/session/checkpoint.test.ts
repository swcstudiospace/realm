import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ErrorCode, RealmError } from "../../src/core/errors.js";
import { bindRoot } from "../../src/fs/root.js";
import { restoreWorkspace, type SandboxRunning, snapshotWorkspace } from "../../src/session/checkpoint.js";
import { checkpointDirOf, checkpointSessionDirOf, sessionIdOfWorkspace } from "../../src/session/paths.js";
import { writeWorkspaceEntry, type WorkspaceEntry } from "../../src/session/workspace-registry.js";

// A pid that cannot be alive: above any pid_max the kernel allows, so kill(pid, 0) reports ESRCH.
const DEAD_PID = 4194303;

interface Fixture {
  readonly base: string;
  readonly ws: string;
  readonly state: string;
  readonly entry: WorkspaceEntry;
}

// Real directories under a temporary base, removed when the test ends. Nothing is mocked. The workspace is base/ws,
// registered through the real registry under base/state. The state root lies outside the workspace root.
function fixture(t: TestContext): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-checkpoint-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  mkdirSync(ws);
  const state = join(base, "state");
  const entry = writeWorkspaceEntry(state, bindRoot(ws), sessionIdOfWorkspace(ws));
  return { base, ws, state, entry };
}

function scope(f: Fixture, sandboxRunning: SandboxRunning = () => false) {
  return { entry: f.entry, stateRoot: f.state, sandboxRunning };
}

function checkpointPath(f: Fixture, checkpointId: string): string {
  return checkpointDirOf(f.state, f.entry.sessionId, checkpointId);
}

function sessionDirOf(f: Fixture): string {
  return checkpointSessionDirOf(f.state, f.entry.sessionId);
}

function workDirsOf(f: Fixture): string[] {
  return readdirSync(sessionDirOf(f)).filter((name) => name.startsWith(".restore-"));
}

function codeIs(code: ErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof RealmError && error.code === code;
}

// Replaces the directory at the workspace path with a new directory, so the pinned identity no longer matches.
function replaceWorkspaceDir(ws: string): void {
  renameSync(ws, `${ws}-old`);
  mkdirSync(ws);
  writeFileSync(join(ws, "replacement.txt"), "replacement");
}

// The start time (field 22) and boot id of this test process, as the library records them.
function ownStartTicks(): string {
  const text = readFileSync("/proc/self/stat", "utf8");
  return text.slice(text.lastIndexOf(")") + 2).split(" ")[19] ?? "";
}

function bootId(): string {
  return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
}

function lockText(owner: { pid: number; startTicks: string; bootId: string }): string {
  return `${JSON.stringify({ schema: 1, ...owner })}\n`;
}

void test("round trip is byte-exact across every byte value, deep nesting, modes and links", async (t) => {
  const f = fixture(t);
  const allBytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
  const deepLevels = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "l9"];
  const deepDir = join(f.ws, ...deepLevels);
  mkdirSync(deepDir, { recursive: true });
  writeFileSync(join(deepDir, "deep.txt"), "nine levels down");
  writeFileSync(join(f.ws, "bytes.bin"), allBytes);
  writeFileSync(join(f.ws, "empty.bin"), Buffer.alloc(0));
  writeFileSync(join(f.ws, "private.txt"), "owner only");
  chmodSync(join(f.ws, "private.txt"), 0o600);
  writeFileSync(join(f.ws, "run.sh"), "#!/bin/sh\necho ok\n");
  chmodSync(join(f.ws, "run.sh"), 0o755);
  symlinkSync("bytes.bin", join(f.ws, "rel-link"));
  symlinkSync(join(f.ws, "bytes.bin"), join(f.ws, "abs-link"));

  const snapshot = await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  assert.equal(statSync(checkpointPath(f, "c1")).mode & 0o777, 0o700);

  rmSync(join(f.ws, "bytes.bin"));
  writeFileSync(join(f.ws, "extra.txt"), "added after the snapshot");
  writeFileSync(join(deepDir, "deep.txt"), "changed after the snapshot");
  chmodSync(join(f.ws, "run.sh"), 0o644);

  const restored = await restoreWorkspace({ ...scope(f), checkpointId: "c1" });

  assert.deepStrictEqual(restored, snapshot);
  assert.deepEqual(readFileSync(join(f.ws, "bytes.bin")), allBytes);
  assert.equal(readFileSync(join(f.ws, "empty.bin")).length, 0);
  assert.equal(readFileSync(join(deepDir, "deep.txt"), "utf8"), "nine levels down");
  assert.equal(readFileSync(join(f.ws, "run.sh"), "utf8"), "#!/bin/sh\necho ok\n");
  assert.equal(statSync(join(f.ws, "private.txt")).mode & 0o777, 0o600);
  assert.equal(statSync(join(f.ws, "run.sh")).mode & 0o777, 0o755);
  assert.equal(readlinkSync(join(f.ws, "rel-link")), "bytes.bin");
  assert.equal(readlinkSync(join(f.ws, "abs-link")), join(f.ws, "bytes.bin"));
  assert.equal(existsSync(join(f.ws, "extra.txt")), false);
});

void test("restore removes extra files and restores deleted files", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "keep.txt"), "kept");
  writeFileSync(join(f.ws, "gone.txt"), "deleted later");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });

  rmSync(join(f.ws, "gone.txt"));
  writeFileSync(join(f.ws, "extra.txt"), "extra");

  await restoreWorkspace({ ...scope(f), checkpointId: "c1" });

  assert.equal(readFileSync(join(f.ws, "gone.txt"), "utf8"), "deleted later");
  assert.equal(readFileSync(join(f.ws, "keep.txt"), "utf8"), "kept");
  assert.equal(existsSync(join(f.ws, "extra.txt")), false);
  assert.deepEqual(readdirSync(f.ws).sort(), ["gone.txt", "keep.txt"]);
});

void test("a corrupt checkpoint is refused and the workspace keeps its content", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "original");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });

  writeFileSync(join(checkpointPath(f, "c1"), "tree", "a.txt"), "tampered");
  writeFileSync(join(f.ws, "a.txt"), "current");

  await assert.rejects(restoreWorkspace({ ...scope(f), checkpointId: "c1" }), codeIs("SCHEMA_INVALID"));
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "current");
});

void test("a colliding checkpoint id is refused and the first checkpoint is untouched", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "first");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  const manifestPath = join(checkpointPath(f, "c1"), "manifest.json");
  const manifestBefore = readFileSync(manifestPath, "utf8");

  writeFileSync(join(f.ws, "a.txt"), "second");
  await assert.rejects(snapshotWorkspace({ ...scope(f), checkpointId: "c1" }), codeIs("SCHEMA_INVALID"));

  assert.equal(readFileSync(manifestPath, "utf8"), manifestBefore);
  await restoreWorkspace({ ...scope(f), checkpointId: "c1" });
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "first");
});

void test("a staging directory inside the root is refused, and so is a state root inside the workspace", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "original");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  writeFileSync(join(f.ws, "a.txt"), "current");

  // The base directory is registered as a workspace. Its state root, base/state, lies inside it, so the staging
  // directory would lie inside the root too.
  const baseEntry = writeWorkspaceEntry(f.state, bindRoot(f.base), sessionIdOfWorkspace(f.base));
  await assert.rejects(
    restoreWorkspace({ entry: baseEntry, stateRoot: f.state, sandboxRunning: () => false, checkpointId: "c1" }),
    codeIs("POLICY_DENIED"),
  );
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "current");
  assert.equal(existsSync(checkpointPath(f, "c1")), true);

  // A checkpoint whose state root sits inside the workspace would copy the state directory into itself.
  await assert.rejects(
    snapshotWorkspace({ ...scope(f), stateRoot: join(f.ws, "state"), checkpointId: "c2" }),
    codeIs("POLICY_DENIED"),
  );
  assert.equal(existsSync(join(f.ws, "state")), false);
});

void test("the root's st_dev and st_ino are the same before and after a restore", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "original");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  rmSync(join(f.ws, "a.txt"));
  writeFileSync(join(f.ws, "b.txt"), "other");
  const before = statSync(f.ws);

  await restoreWorkspace({ ...scope(f), checkpointId: "c1" });

  const after = statSync(f.ws);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "original");
});

void test("a writer that changes a file during the snapshot makes the snapshot refused", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "stable");
  let calls = 0;
  // The second predicate call runs after the copy and before the closing scan, so the writer lands in between.
  const writer = (): boolean => {
    calls += 1;
    if (calls === 2) {
      writeFileSync(join(f.ws, "late.txt"), "written during the snapshot");
    }
    return false;
  };

  await assert.rejects(snapshotWorkspace({ ...scope(f, writer), checkpointId: "c1" }), codeIs("LOCK_CONFLICT"));

  assert.equal(calls, 2);
  assert.equal(existsSync(checkpointPath(f, "c1")), false);
  assert.equal(readFileSync(join(f.ws, "late.txt"), "utf8"), "written during the snapshot");
});

void test("a host writer that changes and reverts a file during the copy makes the snapshot refused", async (t) => {
  const f = fixture(t);
  const file = join(f.ws, "a.txt");
  writeFileSync(file, "stable");
  // An old mtime, so the rewrite below moves the mtime even when it lands in the same clock tick.
  utimesSync(file, new Date("2001-01-01T00:00:00Z"), new Date("2001-01-01T00:00:00Z"));
  let calls = 0;
  const changeAndRevert = (): boolean => {
    calls += 1;
    if (calls === 2) {
      writeFileSync(file, "changed");
      writeFileSync(file, "stable");
    }
    return false;
  };

  await assert.rejects(
    snapshotWorkspace({ ...scope(f, changeAndRevert), checkpointId: "c1" }),
    codeIs("LOCK_CONFLICT"),
  );

  assert.equal(calls, 2);
  assert.equal(readFileSync(file, "utf8"), "stable");
  assert.equal(existsSync(checkpointPath(f, "c1")), false);
});

void test("a running sandbox makes both snapshot and restore refused", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "original");
  const running = (): boolean => true;

  await assert.rejects(snapshotWorkspace({ ...scope(f, running), checkpointId: "c1" }), codeIs("LOCK_CONFLICT"));
  assert.equal(existsSync(checkpointPath(f, "c1")), false);

  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  writeFileSync(join(f.ws, "a.txt"), "current");

  await assert.rejects(restoreWorkspace({ ...scope(f, running), checkpointId: "c1" }), codeIs("LOCK_CONFLICT"));
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "current");
});

void test("a symlink whose target escapes the root makes the snapshot refused", async (t) => {
  const f = fixture(t);
  const outside = join(f.base, "outside.txt");
  writeFileSync(outside, "outside the workspace");
  writeFileSync(join(f.ws, "a.txt"), "inside");
  symlinkSync(outside, join(f.ws, "escape"));

  await assert.rejects(snapshotWorkspace({ ...scope(f), checkpointId: "c1" }), codeIs("PATH_ESCAPE"));
  assert.equal(existsSync(checkpointPath(f, "c1")), false);
  assert.equal(readFileSync(outside, "utf8"), "outside the workspace");
});

void test("a pin that does not match during a snapshot or restore is refused", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "original");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  writeFileSync(join(f.ws, "a.txt"), "current");

  // The directory is replaced after the lock is taken, during the restore's first sandbox check.
  let swapped = false;
  const swapOnce = (): boolean => {
    if (!swapped) {
      swapped = true;
      replaceWorkspaceDir(f.ws);
    }
    return false;
  };
  await assert.rejects(restoreWorkspace({ ...scope(f, swapOnce), checkpointId: "c1" }), codeIs("POLICY_DENIED"));
  assert.deepEqual(readdirSync(f.ws), ["replacement.txt"]);
  assert.equal(readFileSync(join(f.ws, "replacement.txt"), "utf8"), "replacement");

  // The same replacement during a snapshot's first sandbox check, in a second workspace.
  const g = fixture(t);
  writeFileSync(join(g.ws, "a.txt"), "original");
  let snapshotSwapped = false;
  const swapSnapshot = (): boolean => {
    if (!snapshotSwapped) {
      snapshotSwapped = true;
      replaceWorkspaceDir(g.ws);
    }
    return false;
  };
  await assert.rejects(snapshotWorkspace({ ...scope(g, swapSnapshot), checkpointId: "c1" }), codeIs("POLICY_DENIED"));
  assert.equal(existsSync(checkpointPath(g, "c1")), false);
});

void test("a directory replaced at the project path before the call is refused for snapshot and restore", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "original");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });

  replaceWorkspaceDir(f.ws);

  await assert.rejects(snapshotWorkspace({ ...scope(f), checkpointId: "c2" }), codeIs("POLICY_DENIED"));
  assert.equal(existsSync(checkpointPath(f, "c2")), false);
  await assert.rejects(restoreWorkspace({ ...scope(f), checkpointId: "c1" }), codeIs("POLICY_DENIED"));
  assert.deepEqual(readdirSync(f.ws), ["replacement.txt"]);
});

void test("a failed restore step rolls back and the original tree returns", async (t) => {
  const f = fixture(t);
  mkdirSync(join(f.ws, "sub"));
  writeFileSync(join(f.ws, "sub", "c.bin"), Buffer.from([0, 255, 128]));
  writeFileSync(join(f.ws, "a.txt"), "A-original");
  writeFileSync(join(f.ws, "b.txt"), "B-original");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });

  rmSync(join(f.ws, "sub"), { recursive: true });
  writeFileSync(join(f.ws, "a.txt"), "A-now");
  writeFileSync(join(f.ws, "b.txt"), "B-now");
  writeFileSync(join(f.ws, "z.txt"), "Z-now");

  // The seam fails the second move. The first move has already moved one entry aside by then.
  let moves = 0;
  await assert.rejects(
    restoreWorkspace({
      ...scope(f),
      checkpointId: "c1",
      beforeMove: () => {
        moves += 1;
        if (moves === 2) {
          throw new Error("injected move failure");
        }
      },
    }),
    codeIs("WRITE_NOT_ATOMIC"),
  );

  assert.equal(moves, 2);
  assert.deepEqual(readdirSync(f.ws).sort(), ["a.txt", "b.txt", "z.txt"]);
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "A-now");
  assert.equal(readFileSync(join(f.ws, "b.txt"), "utf8"), "B-now");
  assert.equal(readFileSync(join(f.ws, "z.txt"), "utf8"), "Z-now");
  assert.equal(existsSync(join(f.ws, "sub")), false);
  assert.deepEqual(workDirsOf(f), []);
});

void test("a leftover .restore directory is removed by the next snapshot without touching the workspace", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "kept");
  const leftover = join(sessionDirOf(f), ".restore-0123456789abcdef", "stage");
  mkdirSync(leftover, { recursive: true });
  writeFileSync(join(leftover, "orphan.txt"), "staged copy");
  const inode = statSync(f.ws).ino;

  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });

  assert.deepEqual(workDirsOf(f), []);
  assert.deepEqual(readdirSync(f.ws), ["a.txt"]);
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "kept");
  assert.equal(statSync(f.ws).ino, inode);
  assert.equal(existsSync(checkpointPath(f, "c1")), true);
});

void test("the next restore first returns a crashed restore's tree to its original content", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "A-saved");
  writeFileSync(join(f.ws, "b.txt"), "B-saved");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });

  // The state a crash leaves: every original moved into the backup, and only some restored entries in the root.
  const workDir = join(sessionDirOf(f), ".restore-feedfacefeedface");
  const backup = join(workDir, "backup");
  const stage = join(workDir, "stage");
  mkdirSync(backup, { recursive: true });
  mkdirSync(stage);
  writeFileSync(join(backup, "a.txt"), "A-current");
  writeFileSync(join(backup, "b.txt"), "B-current");
  writeFileSync(join(backup, "c.txt"), "C-current");
  rmSync(join(f.ws, "b.txt"));
  writeFileSync(join(f.ws, "a.txt"), "A-saved");
  writeFileSync(join(stage, "b.txt"), "B-saved");

  // The checkpoint is corrupted, so the next restore is refused once recovery has run. The root is then read without the
  // restore's own writes over it.
  writeFileSync(join(checkpointPath(f, "c1"), "tree", "a.txt"), "tampered");

  await assert.rejects(restoreWorkspace({ ...scope(f), checkpointId: "c1" }), codeIs("SCHEMA_INVALID"));

  assert.deepEqual(readdirSync(f.ws).sort(), ["a.txt", "b.txt", "c.txt"]);
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "A-current");
  assert.equal(readFileSync(join(f.ws, "b.txt"), "utf8"), "B-current");
  assert.equal(readFileSync(join(f.ws, "c.txt"), "utf8"), "C-current");
  assert.deepEqual(workDirsOf(f), []);
});

// The halt point of a crash child. The child halts before it moves `name`, once every name in `present` is in the root and
// no name in `absent` is.
interface HaltPoint {
  readonly name: string;
  readonly present: readonly string[];
  readonly absent: readonly string[];
}

const HALTED = "halted\n";

// Runs as `node -e`. It restores through the compiled module that dist/ provides, and halts at the requested point by
// writing a line and blocking. The parent SIGKILLs it there, so no in-process rollback runs.
const CRASH_CHILD = `
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const request = JSON.parse(process.argv[1]);
const { halt, root } = request;
function beforeMoveHalts(name) {
  if (name !== halt.name) {
    return false;
  }
  return halt.present.every((entry) => existsSync(join(root, entry))) && !halt.absent.some((entry) => existsSync(join(root, entry)));
}
function beforeMove(name) {
  if (beforeMoveHalts(name)) {
    process.stdout.write("halted\\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
}
import(pathToFileURL(request.modulePath).href)
  .then(({ restoreWorkspace }) =>
    restoreWorkspace({
      entry: request.entry,
      stateRoot: request.stateRoot,
      checkpointId: request.checkpointId,
      sandboxRunning: () => false,
      beforeMove,
    }),
  )
  .catch((error) => {
    process.stderr.write(String(error));
    process.exit(1);
  });
`;

// Runs a restore in a child process, waits until it reaches the halt point, then SIGKILLs it. The kill leaves the root and
// the work directory as a crash leaves them, and the session lock with a dead owner.
async function crashRestoreAt(f: Fixture, checkpointId: string, halt: HaltPoint): Promise<void> {
  const request = JSON.stringify({
    modulePath: fileURLToPath(new URL("../../src/session/checkpoint.js", import.meta.url)),
    entry: f.entry,
    stateRoot: f.state,
    checkpointId,
    root: f.ws,
    halt,
  });
  const child = spawn(process.execPath, ["-e", CRASH_CHILD, request], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const halted = new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes(HALTED)) {
        resolve();
      }
    });
    void exited.then(({ code, signal }) => {
      reject(new Error(`restore child ended before its halt point: code ${String(code)}, signal ${String(signal)}: ${stderr}`));
    });
  });
  await halted;
  child.kill("SIGKILL");
  assert.equal((await exited).signal, "SIGKILL");
}

void test("a SIGKILL after a snapshot-only name moves into the root recovers the pre-restore tree", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "A-saved");
  writeFileSync(join(f.ws, "b.txt"), "B-saved");
  writeFileSync(join(f.ws, "c.txt"), "C-saved");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });

  // b.txt is in the snapshot only: the workspace has deleted it since.
  rmSync(join(f.ws, "b.txt"));
  writeFileSync(join(f.ws, "a.txt"), "A-now");
  writeFileSync(join(f.ws, "c.txt"), "C-now");
  writeFileSync(join(f.ws, "extra.txt"), "E-now");
  await snapshotWorkspace({ ...scope(f), checkpointId: "pre" });
  const preManifest = readFileSync(join(checkpointPath(f, "pre"), "manifest.json"));

  // The restore has moved a.txt and the snapshot-only b.txt into the root when it is killed, before c.txt moves.
  await crashRestoreAt(f, "c1", { name: "c.txt", present: ["b.txt"], absent: [] });
  assert.equal(readFileSync(join(f.ws, "b.txt"), "utf8"), "B-saved");
  assert.equal(workDirsOf(f).length, 1);

  await snapshotWorkspace({ ...scope(f), checkpointId: "post" });
  assert.deepEqual(readFileSync(join(checkpointPath(f, "post"), "manifest.json")), preManifest);
  assert.deepEqual(readdirSync(f.ws).sort(), ["a.txt", "c.txt", "extra.txt"]);
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "A-now");
  assert.equal(readFileSync(join(f.ws, "c.txt"), "utf8"), "C-now");
  assert.deepEqual(workDirsOf(f), []);
});

void test("a SIGKILL during the backup phase, before the backed-up marker exists, recovers the pre-restore tree", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "A-saved");
  writeFileSync(join(f.ws, "b.txt"), "B-saved");
  writeFileSync(join(f.ws, "c.txt"), "C-saved");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });

  rmSync(join(f.ws, "b.txt"));
  writeFileSync(join(f.ws, "a.txt"), "A-now");
  writeFileSync(join(f.ws, "c.txt"), "C-now");
  writeFileSync(join(f.ws, "extra.txt"), "E-now");
  await snapshotWorkspace({ ...scope(f), checkpointId: "pre" });
  const preManifest = readFileSync(join(checkpointPath(f, "pre"), "manifest.json"));

  // a.txt has moved into the backup when the restore is killed, before c.txt moves. No phase-B move has started.
  await crashRestoreAt(f, "c1", { name: "c.txt", present: [], absent: ["a.txt"] });
  assert.equal(existsSync(join(f.ws, "a.txt")), false);
  assert.equal(workDirsOf(f).length, 1);

  await snapshotWorkspace({ ...scope(f), checkpointId: "post" });
  assert.deepEqual(readFileSync(join(checkpointPath(f, "post"), "manifest.json")), preManifest);
  assert.deepEqual(readdirSync(f.ws).sort(), ["a.txt", "c.txt", "extra.txt"]);
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "A-now");
  assert.equal(readFileSync(join(f.ws, "c.txt"), "utf8"), "C-now");
  assert.deepEqual(workDirsOf(f), []);
});

void test("a failure after the backed-up marker rolls back, and the original tree returns", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "A-saved");
  writeFileSync(join(f.ws, "b.txt"), "B-saved");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  writeFileSync(join(f.ws, "a.txt"), "A-now");
  writeFileSync(join(f.ws, "b.txt"), "B-now");
  writeFileSync(join(f.ws, "z.txt"), "Z-now");

  // Calls 1 to 3 move the three originals aside. Call 4 moves a.txt in. Call 5 fails before b.txt moves in, so the
  // rollback runs with the marker written and one staged entry in the root.
  const calls: string[] = [];
  await assert.rejects(
    restoreWorkspace({
      ...scope(f),
      checkpointId: "c1",
      beforeMove: (name) => {
        calls.push(name);
        if (calls.length === 5) {
          throw new Error("injected move failure");
        }
      },
    }),
    codeIs("WRITE_NOT_ATOMIC"),
  );

  assert.deepEqual(calls, ["a.txt", "b.txt", "z.txt", "a.txt", "b.txt"]);
  assert.deepEqual(readdirSync(f.ws).sort(), ["a.txt", "b.txt", "z.txt"]);
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "A-now");
  assert.equal(readFileSync(join(f.ws, "b.txt"), "utf8"), "B-now");
  assert.equal(readFileSync(join(f.ws, "z.txt"), "utf8"), "Z-now");
  assert.deepEqual(workDirsOf(f), []);
});

void test("an overlapping restore on the same session is refused and the first restore's result stands", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "first");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  writeFileSync(join(f.ws, "a.txt"), "second");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c2" });
  writeFileSync(join(f.ws, "a.txt"), "current");

  // The first restore holds the lock while its first sandbox check is pending. The executor form is used because
  // tsconfig's ES2023 lib has no Promise.withResolvers.
  let announceHeld!: () => void;
  const held = new Promise<void>((resolve) => {
    announceHeld = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pendingCheck = async (): Promise<boolean> => {
    announceHeld();
    await gate;
    return false;
  };
  const first = restoreWorkspace({ ...scope(f, pendingCheck), checkpointId: "c1" });
  await held;

  await assert.rejects(restoreWorkspace({ ...scope(f), checkpointId: "c2" }), codeIs("LOCK_CONFLICT"));

  release();
  await first;
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "first");
  assert.deepEqual(workDirsOf(f), []);
});

void test("a lock whose owner pid is not alive is taken over, and the restore proceeds", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "saved");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  writeFileSync(join(f.ws, "a.txt"), "current");
  const lock = join(sessionDirOf(f), ".lock");
  writeFileSync(lock, lockText({ pid: DEAD_PID, startTicks: "1", bootId: bootId() }));

  await restoreWorkspace({ ...scope(f), checkpointId: "c1" });

  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "saved");
  assert.equal(existsSync(lock), false);
});

void test("a lock whose owner is alive is never taken over, and its work directory is never removed", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "kept");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c0" });
  const lock = join(sessionDirOf(f), ".lock");
  const owner = lockText({ pid: process.pid, startTicks: ownStartTicks(), bootId: bootId() });
  writeFileSync(lock, owner);
  const liveWork = join(sessionDirOf(f), ".restore-liveowner00000", "stage");
  mkdirSync(liveWork, { recursive: true });
  writeFileSync(join(liveWork, "keep.txt"), "in progress");

  await assert.rejects(snapshotWorkspace({ ...scope(f), checkpointId: "c1" }), codeIs("LOCK_CONFLICT"));
  await assert.rejects(restoreWorkspace({ ...scope(f), checkpointId: "c0" }), codeIs("LOCK_CONFLICT"));

  assert.equal(readFileSync(lock, "utf8"), owner);
  assert.equal(readFileSync(join(liveWork, "keep.txt"), "utf8"), "in progress");
  assert.equal(existsSync(checkpointPath(f, "c1")), false);
  assert.equal(readFileSync(join(f.ws, "a.txt"), "utf8"), "kept");
});

void test("a lock from another boot, or whose pid was reused, is taken over", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "original");
  const lock = join(sessionDirOf(f), ".lock");
  await snapshotWorkspace({ ...scope(f), checkpointId: "c0" });

  writeFileSync(lock, lockText({ pid: process.pid, startTicks: ownStartTicks(), bootId: "another-boot" }));
  await snapshotWorkspace({ ...scope(f), checkpointId: "c1" });
  assert.equal(existsSync(lock), false);

  // Same pid, but a start time that is not this process's: the pid was reused by another process.
  writeFileSync(lock, lockText({ pid: process.pid, startTicks: "1", bootId: bootId() }));
  await snapshotWorkspace({ ...scope(f), checkpointId: "c2" });
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(checkpointPath(f, "c2")), true);
});
