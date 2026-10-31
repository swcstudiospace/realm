import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { applySafeFixes, FixRefusal, type FixAction, type ProtectedLocations } from "../../src/doctor/fix.js";

// A temporary base that is removed when the test ends. Before removal, owner read, write and search access is restored under it, so a test that set a locked mode (0300 or 0000) leaves nothing a non-root user cannot remove. Every mode the tests depend on is set with chmod, so the umask does not decide it.
function base(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-doctor-fix-")));
  t.after(() => {
    restoreOwnerAccess(dir);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// Gives the owner read, write and search access to a directory and to every directory beneath it. Symbolic links are not followed, so nothing outside the tree changes.
function restoreOwnerAccess(path: string): void {
  if (!lstatSync(path).isDirectory()) return;
  chmodSync(path, 0o700);
  for (const name of readdirSync(path)) restoreOwnerAccess(join(path, name));
}

// A home directory at mode 0755 with a workspace two levels below it, so the workspace has an ancestor that is not the home directory.
function locationsUnder(root: string): ProtectedLocations {
  const home = join(root, "home");
  directoryAt(home, 0o755);
  const workspace = join(home, "work", "project");
  mkdirSync(workspace, { recursive: true });
  return { home, workspace };
}

function fixture(t: TestContext): { readonly root: string; readonly places: ProtectedLocations } {
  const root = base(t);
  return { root, places: locationsUnder(root) };
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

// The error a refusal raises, as values that can be compared. A call that is not refused fails the test.
function refusalOf(action: () => unknown): { readonly name: string; readonly code: string; readonly message: string } {
  try {
    action();
  } catch (error: unknown) {
    assert.ok(error instanceof RealmError);
    return { name: error.name, code: error.code, message: error.message };
  }
  return assert.fail("the action was not refused");
}

// As root, permission bits do not restrict reads or changes, so a locked directory cannot be reproduced and such a test would pass on any code.
const LOCKED_SKIP =
  process.getuid?.() === 0 ? "running as root: permission bits do not restrict root, so a locked directory cannot be reproduced" : false;

void test("a state directory at mode 0755 is set to 0700, and the action names the previous mode (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o755);
  directoryAt(join(stateDir, "run"), 0o700);
  directoryAt(join(stateDir, "sessions"), 0o700);

  const actions = applySafeFixes(stateDir, false, places);

  assert.deepEqual(actions, [{ kind: "set-mode", path: stateDir, previousMode: 0o755, mode: 0o700 }]);
  assert.equal(modeOf(stateDir), 0o700);
});

void test("missing run and sessions directories are created at 0700 beside the state directory (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o700);

  const actions = applySafeFixes(stateDir, false, places);

  assert.deepEqual(actions, [
    { kind: "create-directory", path: join(stateDir, "run"), mode: 0o700 },
    { kind: "create-directory", path: join(stateDir, "sessions"), mode: 0o700 },
  ]);
  assert.equal(modeOf(join(stateDir, "run")), 0o700);
  assert.equal(modeOf(join(stateDir, "sessions")), 0o700);
});

void test("a missing state directory is created at 0700 with its run and sessions directories (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");

  const actions = applySafeFixes(stateDir, false, places);

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
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o755);

  const first = applySafeFixes(stateDir, false, places);
  const modesAfterFirst = [stateDir, join(stateDir, "run"), join(stateDir, "sessions")].map(modeOf);
  const second = applySafeFixes(stateDir, false, places);

  assert.equal(first.length, 3);
  assert.deepEqual(second, []);
  assert.deepEqual([stateDir, join(stateDir, "run"), join(stateDir, "sessions")].map(modeOf), modesAfterFirst);
});

void test("a dry run reports the same actions as a real run and writes nothing to disk (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o755);

  const planned = applySafeFixes(stateDir, true, places);

  assert.equal(planned.length, 3);
  assert.equal(modeOf(stateDir), 0o755);
  assert.equal(existsSync(join(stateDir, "run")), false);
  assert.equal(existsSync(join(stateDir, "sessions")), false);
  assert.deepEqual(applySafeFixes(stateDir, false, places), planned);
});

void test("a dry run over a missing state directory reports its creation and creates nothing (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");

  const planned: readonly FixAction[] = applySafeFixes(stateDir, true, places);

  assert.equal(planned[0]?.kind, "create-directory");
  assert.equal(existsSync(stateDir), false);
});

void test("a symbolic link at the state directory is refused with a RealmError, and its target is not changed (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const target = join(root, "real-state");
  directoryAt(target, 0o755);
  const link = join(root, "state");
  symlinkSync(target, link);

  assertRefused(() => applySafeFixes(link, false, places));
  assertRefused(() => applySafeFixes(link, true, places));
  assert.equal(modeOf(target), 0o755);
  assert.equal(existsSync(join(target, "run")), false);
});

void test("a symbolic link at a subdirectory is refused before the state directory is changed (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o755);
  const elsewhere = join(root, "elsewhere");
  directoryAt(elsewhere, 0o700);
  symlinkSync(elsewhere, join(stateDir, "run"));

  assertRefused(() => applySafeFixes(stateDir, false, places));
  assert.equal(modeOf(stateDir), 0o755);
});

void test("a regular file at the state directory path is refused with a RealmError (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  writeFileSync(stateDir, "not a directory");

  assertRefused(() => applySafeFixes(stateDir, false, places));
});

void test("a state directory whose parent is missing is refused with a RealmError (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "missing-parent", "state");

  assertRefused(() => applySafeFixes(stateDir, false, places));
  assert.equal(existsSync(join(stateDir, "..")), false);
});

void test("a state directory that is already 0700 with its subdirectories needs no action (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o700);
  directoryAt(join(stateDir, "run"), 0o700);
  directoryAt(join(stateDir, "sessions"), 0o700);

  assert.deepEqual(applySafeFixes(stateDir, false, places), []);
});

void test("a symbolic link to a directory is refused under a trailing separator or a final dot, and its target is not changed (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const target = join(root, "real-state");
  directoryAt(target, 0o755);
  const link = join(root, "state");
  symlinkSync(target, link);

  for (const spelling of [`${link}/`, `${link}//`, `${link}/.`, `${link}/..`, `${root}/x/../state`]) {
    assertRefused(() => applySafeFixes(spelling, true, places));
    assertRefused(() => applySafeFixes(spelling, false, places));
  }
  assert.equal(modeOf(target), 0o755);
  assert.equal(existsSync(join(target, "run")), false);
  assert.equal(existsSync(join(target, "sessions")), false);
});

void test("an unreadable 0300 state directory is refused rather than using a path chmod fallback (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o300);

  assertRefused(() => applySafeFixes(stateDir, true, places));
  assertRefused(() => applySafeFixes(stateDir, false, places));
  assert.equal(modeOf(stateDir), 0o300);
});

void test("a state directory at mode 0000 is refused, and its mode is not changed (ONB-02)", { skip: LOCKED_SKIP }, (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o000);

  assertRefused(() => applySafeFixes(stateDir, true, places));
  assertRefused(() => applySafeFixes(stateDir, false, places));
  assert.equal(modeOf(stateDir), 0o000);
});

void test("a state directory at mode 0300 with a symbolic link child is refused, and its mode is not changed (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o300);
  const elsewhere = join(root, "elsewhere");
  directoryAt(elsewhere, 0o700);
  symlinkSync(elsewhere, join(stateDir, "run"));

  assertRefused(() => applySafeFixes(stateDir, true, places));
  assertRefused(() => applySafeFixes(stateDir, false, places));
  assert.equal(modeOf(stateDir), 0o300);
  assert.equal(modeOf(elsewhere), 0o700);
});

void test("a state directory at mode 0300 with a regular file child is refused, and its mode is not changed (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o300);
  writeFileSync(join(stateDir, "sessions"), "not a directory");

  assertRefused(() => applySafeFixes(stateDir, true, places));
  assertRefused(() => applySafeFixes(stateDir, false, places));
  assert.equal(modeOf(stateDir), 0o300);
});

void test("a dry run refuses a locked state directory with the same error as a real run (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const linked = join(root, "linked-state");
  directoryAt(linked, 0o300);
  symlinkSync(root, join(linked, "run"));
  const filed = join(root, "filed-state");
  directoryAt(filed, 0o300);
  writeFileSync(join(filed, "sessions"), "not a directory");

  for (const stateDir of [linked, filed]) {
    const dry = refusalOf(() => applySafeFixes(stateDir, true, places));
    const real = refusalOf(() => applySafeFixes(stateDir, false, places));
    assert.equal(dry.code, "SCHEMA_INVALID");
    assert.deepEqual(dry, real);
    assert.equal(modeOf(stateDir), 0o300);
  }
});

void test("a umask that prevents opening new directory descriptors is refused before any creation (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  const previous = process.umask(0o777);
  try {
    assertRefused(() => applySafeFixes(stateDir, true, places));
    assertRefused(() => applySafeFixes(stateDir, false, places));
    assert.equal(existsSync(stateDir), false);
  } finally {
    process.umask(previous);
  }
});

void test("the home directory is refused as a state directory, even when it is owned and at mode 0755 (ONB-02)", (t) => {
  const { places } = fixture(t);

  assertRefused(() => applySafeFixes(places.home, false, places));
  assertRefused(() => applySafeFixes(places.home, true, places));
  assert.equal(modeOf(places.home), 0o755);
  assert.equal(existsSync(join(places.home, "run")), false);
  assert.equal(existsSync(join(places.home, "sessions")), false);
});

void test("the workspace root is refused as a state directory, and its mode is not changed (ONB-02)", (t) => {
  const { places } = fixture(t);
  chmodSync(places.workspace, 0o755);

  assertRefused(() => applySafeFixes(places.workspace, false, places));
  assert.equal(modeOf(places.workspace), 0o755);
  assert.equal(existsSync(join(places.workspace, "run")), false);
});

void test("an ancestor of the workspace root is refused as a state directory, and its mode is not changed (ONB-02)", (t) => {
  const { places } = fixture(t);
  const ancestor = join(places.home, "work");
  chmodSync(ancestor, 0o755);

  assertRefused(() => applySafeFixes(ancestor, false, places));
  assert.equal(modeOf(ancestor), 0o755);
  assert.equal(existsSync(join(ancestor, "run")), false);
});

void test("the filesystem root is refused as a state directory (ONB-02)", (t) => {
  const { places } = fixture(t);

  // A dry run is used so that the root cannot be changed even if the refusal were missing.
  assertRefused(() => applySafeFixes("/", true, places));
});

function hasUidReader(value: NodeJS.Process): value is NodeJS.Process & { getuid: () => number } {
  return typeof value.getuid === "function";
}

void test("foreign-owned state or child directories refuse dry-run and repair before any writes (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o755);
  directoryAt(join(stateDir, "run"), 0o700);
  assert.ok(hasUidReader(process), "foreign ownership test requires the Linux UID reader");
  const uid = process.getuid();
  for (const foreignChild of [false, true]) {
    for (const dryRun of [true, false]) {
      let ownerChecks = 0;
      const reading = t.mock.method(process, "getuid", () => {
        ownerChecks += 1;
        return foreignChild && ownerChecks === 1 ? uid : uid === 0 ? 1 : 0;
      });
      assertRefused(() => applySafeFixes(stateDir, dryRun, places));
      reading.mock.restore();
    }
  }
  assert.equal(modeOf(stateDir), 0o755);
  assert.equal(existsSync(join(stateDir, "sessions")), false);
});

void test("existing run and sessions modes are repaired without touching unrelated directories (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o700);
  const run = join(stateDir, "run");
  const sessions = join(stateDir, "sessions");
  const unrelated = join(stateDir, "other");
  for (const path of [run, sessions, unrelated]) directoryAt(path, 0o755);
  const planned = applySafeFixes(stateDir, true, places);
  assert.deepEqual(planned.map((action) => action.path), [run, sessions]);
  assert.equal(modeOf(run), 0o755);
  assert.deepEqual(applySafeFixes(stateDir, false, places), planned);
  assert.equal(modeOf(run), 0o700);
  assert.equal(modeOf(sessions), 0o700);
  assert.equal(modeOf(unrelated), 0o755);
  assert.deepEqual(applySafeFixes(stateDir, false, places), []);
});

void test("a directory swapped for a symlink between observation and open cannot redirect chmod (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o755);
  const outside = join(root, "outside");
  directoryAt(outside, 0o755);
  const moved = join(root, "moved");
  assertRefused(() => applySafeFixes(stateDir, false, places, {
    stageHook: (stage, path) => {
      if (stage === "before-open" && path === stateDir) {
        renameSync(stateDir, moved);
        symlinkSync(outside, stateDir);
      }
    },
  }));
  assert.equal(modeOf(outside), 0o755);
  assert.equal(modeOf(moved), 0o755);
  assert.equal(existsSync(join(outside, "run")), false);
});

void test("a pinned directory replaced just before applying a repair is refused without following its replacement (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o755);
  const outside = join(root, "outside");
  directoryAt(outside, 0o755);
  const moved = join(root, "moved");
  assertRefused(() => applySafeFixes(stateDir, false, places, {
    stageHook: (stage, path) => {
      if (stage === "before-apply" && path === stateDir) {
        renameSync(stateDir, moved);
        symlinkSync(outside, stateDir);
      }
    },
  }));
  assert.equal(modeOf(outside), 0o755);
  assert.equal(modeOf(moved), 0o755);
  assert.equal(existsSync(join(outside, "run")), false);
});

void test("a parent swapped after preflight cannot redirect missing state-directory creation (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const parent = join(root, "parent");
  directoryAt(parent, 0o700);
  const stateDir = join(parent, "state");
  const outside = join(root, "outside");
  directoryAt(outside, 0o755);
  const moved = join(root, "moved");
  assertRefused(() => applySafeFixes(stateDir, false, places, {
    stageHook: (stage, path) => {
      if (stage === "before-apply" && path === stateDir) {
        renameSync(parent, moved);
        symlinkSync(outside, parent);
      }
    },
  }));
  assert.equal(existsSync(join(outside, "state")), false);
  assert.equal(existsSync(join(moved, "state")), false);
  assert.equal(modeOf(outside), 0o755);
});

void test("symlinked ancestors, relative paths and a state directory inside the workspace are unsafe (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const realParent = join(root, "real-parent");
  directoryAt(realParent, 0o700);
  const linkedParent = join(root, "linked-parent");
  symlinkSync(realParent, linkedParent);
  for (const path of [join(linkedParent, "state"), "relative-state", join(places.workspace, "state")]) {
    assertRefused(() => applySafeFixes(path, true, places));
    assertRefused(() => applySafeFixes(path, false, places));
    assert.equal(existsSync(path), false);
  }
});

void test("special permission bits are cleared by descriptor mode repair (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o1700);
  directoryAt(join(stateDir, "run"), 0o700);
  directoryAt(join(stateDir, "sessions"), 0o700);
  assert.deepEqual(applySafeFixes(stateDir, false, places), [
    { kind: "set-mode", path: stateDir, previousMode: 0o1700, mode: 0o700 },
  ]);
  assert.equal(statSync(stateDir).mode & 0o7777, 0o700);
});

void test("a symlink swapped into the chmod check/use window cannot redirect the descriptor mutation (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  const moved = join(root, "moved");
  const outside = join(root, "outside");
  directoryAt(stateDir, 0o755);
  directoryAt(outside, 0o755);
  assert.throws(() => applySafeFixes(stateDir, false, places, {
    stageHook: (stage, path) => {
      if (stage === "before-chmod" && path === stateDir) {
        renameSync(stateDir, moved);
        symlinkSync(outside, stateDir);
      }
    },
  }), (error: unknown) => {
    assert.ok(error instanceof FixRefusal);
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.deepEqual(error.applied, [
      { kind: "set-mode", path: stateDir, previousMode: 0o755, mode: 0o700 },
    ], "the completed descriptor chmod is retained even though the path replacement refuses further actions");
    return true;
  });
  assert.equal(modeOf(outside), 0o755, "the symlink target must never be chmodded");
  assert.equal(modeOf(moved), 0o700, "only the originally pinned inode was changed");
  assert.equal(existsSync(join(outside, "run")), false);
  assert.equal(existsSync(join(moved, "sessions")), false);
});

void test("a regular-file child is refused before creating siblings or changing state mode (ONB-02)", (t) => {
  const { root, places } = fixture(t);
  const stateDir = join(root, "state");
  directoryAt(stateDir, 0o755);
  writeFileSync(join(stateDir, "sessions"), "keep these bytes");
  assertRefused(() => applySafeFixes(stateDir, true, places));
  assertRefused(() => applySafeFixes(stateDir, false, places));
  assert.equal(modeOf(stateDir), 0o755);
  assert.equal(existsSync(join(stateDir, "run")), false);
});
