import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import {
  atomicWriteFile,
  sha256Hex,
  syncDirectory,
  WriteNotAtomicError,
  type AtomicWriteStage,
} from "../../src/fs/atomic-write.js";

const ORIGINAL = "original bytes\n";

const STAGES: readonly AtomicWriteStage[] = ["after-temp-write", "after-fsync", "before-rename", "after-recheck"];

// Real files in a temporary directory. Nothing is mocked; the stage hook is the test seam
// that D-35 defines for fault injection.
function tempBase(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-atomic-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

function setup(t: TestContext) {
  const dir = join(tempBase(t), "dir");
  mkdirSync(dir);
  const target = join(dir, "target.txt");
  writeFileSync(target, ORIGINAL);
  return { dir, target };
}

// Leftover temp files from an interrupted atomic write. Must be empty after every failure.
function tempFiles(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes(".realm-tmp-"));
}

// An open that blocks never returns in this process, so observeSha256 on a FIFO runs in a
// child process. The parent asserts that the child exits by itself; a timeout kill fails.
const CHILD_TIMEOUT_MS = 5000;

// Creates a FIFO with coreutils mkfifo. A missing or failing mkfifo fails the test.
function createFifo(path: string): void {
  const made = spawnSync("mkfifo", [path], { encoding: "utf8" });
  if (made.error !== undefined || made.status !== 0) {
    throw new Error(
      `mkfifo (coreutils) is required to create ${path}: ${made.error?.message ?? made.stderr}`,
    );
  }
}

// Runs a script in a fresh Node process with the payload in REALM_CHILD_PAYLOAD.
function runChild(script: string, payload: Record<string, string>): { code: string } {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, REALM_CHILD_PAYLOAD: JSON.stringify(payload) },
    timeout: CHILD_TIMEOUT_MS,
  });
  assert.equal(run.error, undefined, `child process did not exit on its own: ${run.error?.message ?? ""}`);
  assert.equal(run.signal, null, "child process was killed by a signal instead of exiting");
  assert.equal(run.status, 0, `child process exited with an error: ${run.stderr}`);
  return JSON.parse(run.stdout) as { code: string };
}

// Child process body, run by node -e. Its import loads the compiled module by URL inside a
// separate process, which cannot share this test's module graph, so a static import cannot
// express it.
const OBSERVE_FIFO_SCRIPT = `
const p = JSON.parse(process.env.REALM_CHILD_PAYLOAD);
const { observeSha256 } = await import(p.observeUrl);
let code = "RETURNED";
try {
  observeSha256(p.fifo);
} catch (error) {
  code = error?.code ?? "UNEXPECTED";
}
process.stdout.write(JSON.stringify({ code }));
`;

// Child process body for syncDirectory, run by node -e for the same reason as
// OBSERVE_FIFO_SCRIPT: a blocking open must be bounded by the child timeout.
const SYNC_DIRECTORY_SCRIPT = `
const p = JSON.parse(process.env.REALM_CHILD_PAYLOAD);
const { syncDirectory } = await import(p.atomicWriteUrl);
let code = "RETURNED";
try {
  syncDirectory(p.dir);
} catch (error) {
  code = error?.code ?? "UNEXPECTED";
}
process.stdout.write(JSON.stringify({ code }));
`;

for (const stage of STAGES) {
  void test(`a stage-hook failure at ${stage} leaves the original byte-identical with no temp file and reports WRITE_NOT_ATOMIC (FS-05)`, (t) => {
    const { dir, target } = setup(t);
    assert.throws(
      () => {
        atomicWriteFile(target, "replacement", {
          expectedPriorSha256: sha256Hex(ORIGINAL),
          stageHook: (current) => {
            if (current === stage) {
              throw new Error(`injected fault at ${stage}`);
            }
          },
        });
      },
      (error: unknown) =>
        error instanceof WriteNotAtomicError &&
        error.code === "WRITE_NOT_ATOMIC" &&
        !error.replaced,
    );
    assert.equal(readFileSync(target, "utf8"), ORIGINAL);
    assert.deepEqual(tempFiles(dir), []);
  });
}

void test("the success path replaces the content and leaves no temp file (FS-05)", (t) => {
  const { dir, target } = setup(t);
  atomicWriteFile(target, "replacement", { expectedPriorSha256: sha256Hex(ORIGINAL) });
  assert.equal(readFileSync(target, "utf8"), "replacement");
  assert.deepEqual(tempFiles(dir), []);
});

void test("an absent target is created when the expected prior state is absent (FS-05)", (t) => {
  const { dir } = setup(t);
  const fresh = join(dir, "fresh.txt");
  atomicWriteFile(fresh, "created", { expectedPriorSha256: null });
  assert.equal(readFileSync(fresh, "utf8"), "created");
  assert.deepEqual(tempFiles(dir), []);
});

void test("an atomic replace keeps the prior rwx bits and drops its setuid bit (FS-05)", (t) => {
  const { dir, target } = setup(t);
  chmodSync(target, 0o4755);
  assert.equal(statSync(target).mode & 0o7777, 0o4755, "the fixture must carry the setuid bit before the replace");
  atomicWriteFile(target, "replacement", { expectedPriorSha256: sha256Hex(ORIGINAL) });
  const mode = statSync(target).mode & 0o7777;
  assert.equal(readFileSync(target, "utf8"), "replacement");
  assert.equal(mode & 0o4000, 0, `setuid bit leaked into the replacement: mode ${mode.toString(8)}`);
  assert.equal(mode & 0o777, 0o755);
  assert.deepEqual(tempFiles(dir), []);
});

void test("observeSha256 on a FIFO returns PATH_ESCAPE within a bounded time (FS-02)", (t) => {
  const { dir } = setup(t);
  const fifo = join(dir, "fifo");
  createFifo(fifo);
  const outcome = runChild(OBSERVE_FIFO_SCRIPT, {
    observeUrl: new URL("../../src/fs/atomic-write.js", import.meta.url).href,
    fifo,
  });
  assert.deepEqual(outcome, { code: "PATH_ESCAPE" });
});

void test("syncDirectory on a regular file at the parent path throws PATH_ESCAPE (FS-02)", (t) => {
  const { target } = setup(t);
  assert.throws(
    () => {
      syncDirectory(target);
    },
    (error: unknown) => error instanceof RealmError && error.code === "PATH_ESCAPE",
  );
});

void test("syncDirectory on a FIFO at the parent path returns PATH_ESCAPE without blocking (FS-02)", (t) => {
  const { dir } = setup(t);
  const fifo = join(dir, "fifo");
  createFifo(fifo);
  try {
    const outcome = runChild(SYNC_DIRECTORY_SCRIPT, {
      atomicWriteUrl: new URL("../../src/fs/atomic-write.js", import.meta.url).href,
      dir: fifo,
    });
    assert.deepEqual(outcome, { code: "PATH_ESCAPE" });
  } finally {
    rmSync(fifo, { force: true });
  }
});

// The temp file is swapped for a directory after the verified write, so the cleanup that follows
// the injected fault cannot remove it. The original fault stays the error thrown, and the failed
// cleanup is recorded as its cause.
void test("a failed temp-file cleanup keeps the write failure and records CLEANUP_FAILED as its cause (QUAL-01)", (t) => {
  const { dir, target } = setup(t);
  assert.throws(
    () => {
      atomicWriteFile(target, "replacement\n", {
        expectedPriorSha256: sha256Hex(ORIGINAL),
        stageHook: (stage) => {
          if (stage !== "before-rename") {
            return;
          }
          const [temp] = tempFiles(dir);
          if (temp === undefined) {
            throw new Error("expected a temp file before the rename");
          }
          unlinkSync(join(dir, temp));
          mkdirSync(join(dir, temp));
          throw new Error("injected fault at before-rename");
        },
      });
    },
    (error: unknown) =>
      error instanceof WriteNotAtomicError &&
      error.code === "WRITE_NOT_ATOMIC" &&
      error.causeCode === "CLEANUP_FAILED",
  );
  assert.equal(readFileSync(target, "utf8"), ORIGINAL);
});

// A10 F6: the parent directory is swapped for a symlink to another directory after the canonical
// check. The write must stay in the directory that was verified, so nothing lands in `elsewhere`.
function swappableFixture(t: TestContext) {
  const { dir, target } = setup(t);
  const base = join(dir, "..");
  const elsewhere = join(base, "elsewhere");
  const moved = join(base, "moved");
  mkdirSync(elsewhere);
  writeFileSync(join(elsewhere, "target.txt"), "elsewhere original");
  const swap = (): string => {
    const [temp] = tempFiles(dir);
    if (temp === undefined) {
      throw new Error("expected a temp file before the swap");
    }
    renameSync(dir, moved);
    symlinkSync(elsewhere, dir);
    return temp;
  };
  return { dir, target, elsewhere, moved, swap };
}

void test("a directory swapped for a symlink between the check and the rename leaves the other directory untouched (A10 F6)", (t) => {
  const { target, elsewhere, moved, swap } = swappableFixture(t);
  assert.throws(
    () => {
      atomicWriteFile(target, "replacement", {
        expectedPriorSha256: sha256Hex(ORIGINAL),
        stageHook: (stage) => {
          if (stage === "before-rename") {
            swap();
          }
        },
      });
    },
    (error: unknown) => error instanceof RealmError && error.code === "PATH_ESCAPE",
  );
  assert.equal(readFileSync(join(elsewhere, "target.txt"), "utf8"), "elsewhere original");
  assert.deepEqual(readdirSync(elsewhere), ["target.txt"]);
  assert.deepEqual(tempFiles(moved), []);
  assert.equal(readFileSync(join(moved, "target.txt"), "utf8"), ORIGINAL);
});

void test("a directory swap during the failure path removes the temp file from the original directory and spares a decoy in the other (A10 F6)", (t) => {
  const { target, elsewhere, moved, swap } = swappableFixture(t);
  assert.throws(
    () => {
      atomicWriteFile(target, "replacement", {
        expectedPriorSha256: sha256Hex(ORIGINAL),
        stageHook: (stage) => {
          if (stage === "before-rename") {
            const temp = swap();
            writeFileSync(join(elsewhere, temp), "decoy");
            throw new Error("injected fault at before-rename");
          }
        },
      });
    },
    (error: unknown) => error instanceof WriteNotAtomicError && error.code === "WRITE_NOT_ATOMIC" && !error.replaced,
  );
  const decoys = readdirSync(elsewhere).filter((name) => name.includes(".realm-tmp-"));
  assert.equal(decoys.length, 1);
  assert.equal(readFileSync(join(elsewhere, decoys[0] ?? ""), "utf8"), "decoy");
  assert.equal(readFileSync(join(elsewhere, "target.txt"), "utf8"), "elsewhere original");
  assert.deepEqual(tempFiles(moved), []);
  assert.equal(readFileSync(join(moved, "target.txt"), "utf8"), ORIGINAL);
});

// The swap lands after the pin and prior-hash re-check, immediately before the rename. The rename
// acts through the pinned descriptor, so the write completes in the directory that was verified.
void test("a directory swapped for a symlink after the pin re-check and before the rename leaves the other directory untouched (A10 F6)", (t) => {
  const { target, elsewhere, moved, swap } = swappableFixture(t);
  atomicWriteFile(target, "replacement", {
    expectedPriorSha256: sha256Hex(ORIGINAL),
    stageHook: (stage) => {
      if (stage === "after-recheck") {
        swap();
      }
    },
  });
  assert.equal(readFileSync(join(elsewhere, "target.txt"), "utf8"), "elsewhere original");
  assert.deepEqual(readdirSync(elsewhere), ["target.txt"]);
  assert.equal(readFileSync(join(moved, "target.txt"), "utf8"), "replacement");
  assert.deepEqual(tempFiles(moved), []);
});

void test("without /proc/self/fd the atomic write fails closed with PATH_ESCAPE and leaves the target untouched (A10 F6)", (t) => {
  const { dir, target } = setup(t);
  assert.throws(
    () => {
      atomicWriteFile(target, "replacement", {
        expectedPriorSha256: sha256Hex(ORIGINAL),
        procFdDir: join(dir, "no-proc-fd"),
      });
    },
    (error: unknown) => error instanceof RealmError && error.code === "PATH_ESCAPE",
  );
  assert.equal(readFileSync(target, "utf8"), ORIGINAL);
  assert.deepEqual(tempFiles(dir), []);
});
