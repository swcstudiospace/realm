import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { applySafeFixes, type FixAction } from "../../src/doctor/fix.js";

// A temporary base that is removed when the test ends. Every mode the tests depend on is set with chmod, so the umask does not decide it.
function base(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-doctor-fix-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function directoryAt(path: string, mode: number): void {
  mkdirSync(path);
  chmodSync(path, mode);
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

function assertRefused(action: () => unknown): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID");
}

void test("a state directory at mode 0755 is set to 0700, and the action names the previous mode (ONB-02)", (t) => {
  const stateDir = join(base(t), "state");
  directoryAt(stateDir, 0o755);
  directoryAt(join(stateDir, "run"), 0o700);
  directoryAt(join(stateDir, "sessions"), 0o700);

  const actions = applySafeFixes(stateDir, false);

  assert.deepEqual(actions, [{ kind: "set-mode", path: stateDir, previousMode: 0o755, mode: 0o700 }]);
  assert.equal(modeOf(stateDir), 0o700);
});

void test("missing run and sessions directories are created at 0700 beside the state directory (ONB-02)", (t) => {
  const stateDir = join(base(t), "state");
  directoryAt(stateDir, 0o700);

  const actions = applySafeFixes(stateDir, false);

  assert.deepEqual(actions, [
    { kind: "create-directory", path: join(stateDir, "run"), mode: 0o700 },
    { kind: "create-directory", path: join(stateDir, "sessions"), mode: 0o700 },
  ]);
  assert.equal(modeOf(join(stateDir, "run")), 0o700);
  assert.equal(modeOf(join(stateDir, "sessions")), 0o700);
});

void test("a missing state directory is created at 0700 with its run and sessions directories (ONB-02)", (t) => {
  const stateDir = join(base(t), "state");

  const actions = applySafeFixes(stateDir, false);

  assert.deepEqual(actions, [
    { kind: "create-directory", path: stateDir, mode: 0o700 },
    { kind: "create-directory", path: join(stateDir, "run"), mode: 0o700 },
    { kind: "create-directory", path: join(stateDir, "sessions"), mode: 0o700 },
  ]);
  assert.equal(modeOf(stateDir), 0o700);
  assert.equal(modeOf(join(stateDir, "run")), 0o700);
  assert.equal(modeOf(join(stateDir, "sessions")), 0o700);
});

void test("a second run changes nothing: it returns no actions and leaves every mode as the first run left it (ONB-02)", (t) => {
  const stateDir = join(base(t), "state");
  directoryAt(stateDir, 0o755);

  const first = applySafeFixes(stateDir, false);
  const modesAfterFirst = [stateDir, join(stateDir, "run"), join(stateDir, "sessions")].map(modeOf);
  const second = applySafeFixes(stateDir, false);

  assert.equal(first.length, 3);
  assert.deepEqual(second, []);
  assert.deepEqual([stateDir, join(stateDir, "run"), join(stateDir, "sessions")].map(modeOf), modesAfterFirst);
});

void test("a dry run reports the same actions as a real run and writes nothing to disk (ONB-02)", (t) => {
  const stateDir = join(base(t), "state");
  directoryAt(stateDir, 0o755);

  const planned = applySafeFixes(stateDir, true);

  assert.equal(planned.length, 3);
  assert.equal(modeOf(stateDir), 0o755);
  assert.equal(existsSync(join(stateDir, "run")), false);
  assert.equal(existsSync(join(stateDir, "sessions")), false);
  assert.deepEqual(applySafeFixes(stateDir, false), planned);
});

void test("a dry run over a missing state directory reports its creation and creates nothing (ONB-02)", (t) => {
  const stateDir = join(base(t), "state");

  const planned: readonly FixAction[] = applySafeFixes(stateDir, true);

  assert.equal(planned[0]?.kind, "create-directory");
  assert.equal(existsSync(stateDir), false);
});

void test("a symbolic link at the state directory is refused with a RealmError, and its target is not changed (ONB-02)", (t) => {
  const root = base(t);
  const target = join(root, "real-state");
  directoryAt(target, 0o755);
  const link = join(root, "state");
  symlinkSync(target, link);

  assertRefused(() => applySafeFixes(link, false));
  assertRefused(() => applySafeFixes(link, true));
  assert.equal(modeOf(target), 0o755);
  assert.equal(existsSync(join(target, "run")), false);
});

void test("a symbolic link at a subdirectory is refused before the state directory is changed (ONB-02)", (t) => {
  const root = base(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o755);
  const elsewhere = join(root, "elsewhere");
  directoryAt(elsewhere, 0o700);
  symlinkSync(elsewhere, join(stateDir, "run"));

  assertRefused(() => applySafeFixes(stateDir, false));
  assert.equal(modeOf(stateDir), 0o755);
});

void test("a regular file at the state directory path is refused with a RealmError (ONB-02)", (t) => {
  const stateDir = join(base(t), "state");
  writeFileSync(stateDir, "not a directory");

  assertRefused(() => applySafeFixes(stateDir, false));
});

void test("a state directory whose parent is missing is refused with a RealmError (ONB-02)", (t) => {
  const stateDir = join(base(t), "missing-parent", "state");

  assertRefused(() => applySafeFixes(stateDir, false));
  assert.equal(existsSync(join(stateDir, "..")), false);
});

void test("a state directory that is already 0700 with its subdirectories needs no action (ONB-02)", (t) => {
  const stateDir = join(base(t), "state");
  directoryAt(stateDir, 0o700);
  directoryAt(join(stateDir, "run"), 0o700);
  directoryAt(join(stateDir, "sessions"), 0o700);

  assert.deepEqual(applySafeFixes(stateDir, false), []);
});
