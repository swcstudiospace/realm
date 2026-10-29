import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ORPHAN_TEMP_MIN_AGE_MS,
  sweepOrphanTempFiles,
  type TempSweepAuditEntry,
  type TempSweepOptions,
} from "../../src/fs/temp-sweep.js";

const HEX = "0123456789abcdef";
const OLD_MS = 10 * ORPHAN_TEMP_MIN_AGE_MS;

function uid(): number {
  const value = process.getuid?.();
  if (value === undefined) {
    throw new Error("process.getuid is required: the sweep tests run on Linux");
  }
  return value;
}

// A real directory tree in a temporary directory; nothing is mocked.
function setup(t: TestContext): { base: string; root: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-sweep-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const root = join(base, "root");
  mkdirSync(root);
  return { base, root };
}

// Writes a file and sets its mtime ageMs in the past.
function plant(path: string, ageMs: number, content = "orphan"): void {
  writeFileSync(path, content);
  const when = (Date.now() - ageMs) / 1000;
  utimesSync(path, when, when);
}

function sweepOptions(audit: TempSweepAuditEntry[], overrides: Partial<TempSweepOptions> = {}): TempSweepOptions {
  return {
    now: Date.now(),
    minAgeMs: ORPHAN_TEMP_MIN_AGE_MS,
    ownerUid: uid(),
    audit: (entry) => {
      audit.push(entry);
    },
    ...overrides,
  };
}

void test("the sweep removes an aged exact-pattern file and audits it before the unlink (CRASH-01)", (t) => {
  const { root } = setup(t);
  const orphan = join(root, `.target.txt.realm-tmp-${HEX}`);
  plant(orphan, OLD_MS, "twelve bytes");
  const audit: TempSweepAuditEntry[] = [];
  let existedAtAudit: boolean | undefined;
  const result = sweepOrphanTempFiles([root], {
    ...sweepOptions(audit),
    audit: (entry) => {
      existedAtAudit = existsSync(orphan);
      audit.push(entry);
    },
  });
  assert.equal(existsSync(orphan), false);
  assert.equal(existedAtAudit, true, "the audit line is written while the file still exists");
  assert.deepEqual(result.removed, [{ path: orphan, bytes: 12 }]);
  assert.deepEqual(audit, [{ tool: "temp-sweep", outcome: "ok", path: orphan, bytes: 12 }]);
  assert.equal(result.skipped, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.unfinishedRoots, []);
});

void test("the sweep removes an aged orphan in a nested directory and in a second root (CRASH-01)", (t) => {
  const { base, root } = setup(t);
  const nested = join(root, "a", "b");
  mkdirSync(nested, { recursive: true });
  const second = join(base, "second");
  mkdirSync(second);
  const one = join(nested, `.deep.realm-tmp-${HEX}`);
  const two = join(second, `.other.realm-tmp-${HEX}`);
  plant(one, OLD_MS);
  plant(two, OLD_MS);
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root, second], sweepOptions(audit));
  assert.equal(existsSync(one), false);
  assert.equal(existsSync(two), false);
  assert.deepEqual(result.removed.map((entry) => entry.path).sort(), [one, two].sort());
  assert.equal(audit.length, 2);
});

void test("the sweep keeps a file younger than the age bound (CRASH-01)", (t) => {
  const { root } = setup(t);
  const young = join(root, `.target.txt.realm-tmp-${HEX}`);
  plant(young, ORPHAN_TEMP_MIN_AGE_MS / 2);
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit));
  assert.equal(existsSync(young), true);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(audit, []);
});

void test("the sweep keeps every name that is not exactly the temp pattern (CRASH-01)", (t) => {
  const { root } = setup(t);
  const names = [
    ".hidden",
    `.x.realm-tmp-${HEX.slice(0, 15)}`,
    `.x.realm-tmp-${HEX}0`,
    `.x.realm-tmp-${HEX.toUpperCase()}`,
    `x.realm-tmp-${HEX}`,
    `.realm-tmp-${HEX}`,
    `.x.realm-tmp-${HEX}.bak`,
  ];
  for (const name of names) {
    plant(join(root, name), OLD_MS);
  }
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit));
  for (const name of names) {
    assert.equal(existsSync(join(root, name)), true, `${name} must be kept`);
  }
  assert.deepEqual(result.removed, []);
  assert.deepEqual(audit, []);
});

void test("the sweep keeps a matching file owned by another uid (CRASH-01)", (t) => {
  const { root } = setup(t);
  const orphan = join(root, `.target.txt.realm-tmp-${HEX}`);
  plant(orphan, OLD_MS);
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit, { ownerUid: uid() + 1 }));
  assert.equal(existsSync(orphan), true);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(audit, []);
});

void test("the sweep does not follow a symlink named like a temp file (CRASH-01)", (t) => {
  const { base, root } = setup(t);
  const outside = join(base, "outside.txt");
  plant(outside, OLD_MS, "keep me");
  const link = join(root, `.link.realm-tmp-${HEX}`);
  symlinkSync(outside, link);
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit));
  assert.equal(existsSync(outside), true);
  assert.equal(statSync(outside).size, "keep me".length);
  assert.equal(lstatSync(link).isSymbolicLink(), true, "the link itself was left in place");
  assert.deepEqual(result.removed, []);
  assert.deepEqual(audit, []);
});

void test("the sweep does not enter a symlinked directory (CRASH-01)", (t) => {
  const { base, root } = setup(t);
  const outsideDir = join(base, "outside");
  mkdirSync(outsideDir);
  const orphan = join(outsideDir, `.victim.realm-tmp-${HEX}`);
  plant(orphan, OLD_MS);
  symlinkSync(outsideDir, join(root, "link"));
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit));
  assert.equal(existsSync(orphan), true);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(audit, []);
});

void test("the sweep does not enter a directory on another device (CRASH-01)", (t) => {
  // /dev is a devtmpfs and /dev/shm a separate tmpfs on a Linux host, so /dev/shm is a directory
  // below the root /dev that lies on another device. Without that layout the case is skipped.
  const shm = "/dev/shm";
  let usable: boolean;
  try {
    usable = statSync(shm).dev !== statSync("/dev").dev;
  } catch {
    usable = false;
  }
  if (!usable) {
    t.skip("/dev/shm is absent or shares /dev's device, so no second device is available without a mount");
    return;
  }
  const orphan = join(shm, `.realm-sweep-probe.realm-tmp-${HEX}`);
  try {
    plant(orphan, OLD_MS);
  } catch {
    t.skip("/dev/shm is not writable by this user");
    return;
  }
  t.after(() => {
    rmSync(orphan, { force: true });
  });
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles(["/dev"], sweepOptions(audit));
  assert.equal(existsSync(orphan), true, "the file on the other device must be kept");
  assert.equal(
    audit.some((entry) => entry.path === orphan),
    false,
  );
  assert.ok(result.skipped >= 1, "the other-device directory is counted as skipped");
});

void test("a failing audit callback keeps the file and counts it (D-1402)", (t) => {
  const { root } = setup(t);
  const orphan = join(root, `.target.txt.realm-tmp-${HEX}`);
  plant(orphan, OLD_MS);
  const result = sweepOrphanTempFiles([root], {
    ...sweepOptions([]),
    audit: () => {
      throw new Error("audit append failed");
    },
  });
  assert.equal(existsSync(orphan), true);
  assert.deepEqual(result.removed, []);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
});

void test("a failed unlink appends a second CLEANUP_FAILED line (D-1402)", (t) => {
  const { root } = setup(t);
  const orphan = join(root, `.target.txt.realm-tmp-${HEX}`);
  plant(orphan, OLD_MS, "abc");
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], {
    ...sweepOptions(audit),
    audit: (entry) => {
      audit.push(entry);
      // The file disappears between the audit line and the unlink, so the unlink fails.
      rmSync(orphan, { force: true });
    },
  });
  assert.deepEqual(audit, [
    { tool: "temp-sweep", outcome: "ok", path: orphan, bytes: 3 },
    { tool: "temp-sweep", outcome: "CLEANUP_FAILED", path: orphan, bytes: 3 },
  ]);
  assert.deepEqual(result.removed, []);
  assert.equal(result.failed, 1);
});

void test("the sweep stops at maxEntries and reports truncated (D-1401)", (t) => {
  const { root } = setup(t);
  for (let index = 0; index < 5; index += 1) {
    plant(join(root, `.f${String(index)}.realm-tmp-${HEX}`), OLD_MS);
  }
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit, { maxEntries: 2 }));
  assert.equal(result.truncated, true);
  assert.equal(result.removed.length, 2);
});

void test("a directory larger than maxEntries is read in bounded steps and most orphans stay (D-1401)", (t) => {
  const { root } = setup(t);
  const names: string[] = [];
  for (let index = 0; index < 200; index += 1) {
    const name = `.f${String(index)}.realm-tmp-${HEX}`;
    names.push(name);
    plant(join(root, name), OLD_MS);
  }
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit, { maxEntries: 10 }));
  assert.equal(result.truncated, true);
  assert.ok(result.removed.length <= 10, `examined more than maxEntries: removed ${String(result.removed.length)}`);
  assert.ok(audit.length <= 10);
  const left = names.filter((name) => existsSync(join(root, name)));
  assert.ok(left.length >= 190, `entries beyond the cap must be untouched, ${String(left.length)} left`);
});

void test("an aged orphan whose target name holds a newline is removed; a newline in the suffix is kept (D-1401)", (t) => {
  const { root } = setup(t);
  const orphan = join(root, `.a\nb.txt.realm-tmp-${HEX}`);
  const nearMiss = join(root, `.a.txt.realm-tmp-${HEX}\n`);
  plant(orphan, OLD_MS);
  plant(nearMiss, OLD_MS);
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit));
  assert.equal(existsSync(orphan), false);
  assert.equal(existsSync(nearMiss), true);
  assert.deepEqual(result.removed.map((entry) => entry.path), [orphan]);
});

void test("the sweep stops when the wall budget is spent and reports truncated (D-1401)", (t) => {
  const { root } = setup(t);
  const orphan = join(root, `.target.txt.realm-tmp-${HEX}`);
  plant(orphan, OLD_MS);
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit, { deadlineMs: 0 }));
  assert.equal(result.truncated, true);
  assert.deepEqual(result.unfinishedRoots, [root]);
  assert.deepEqual(result.removed, []);
  assert.equal(existsSync(orphan), true);
});

void test("the sweep never touches the audit progress record, whose name is not a temp name (CRASH-02)", (t) => {
  const { root } = setup(t);
  const record = join(root, ".reconciled.json");
  plant(record, OLD_MS, "{}");
  const orphan = join(root, `.target.txt.realm-tmp-${HEX}`);
  plant(orphan, OLD_MS);
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root], sweepOptions(audit));
  assert.equal(existsSync(record), true, "the record is kept");
  assert.equal(existsSync(orphan), false);
  assert.deepEqual(result.removed.map((entry) => entry.path), [orphan]);
});

void test("a spent budget reports the root being walked and every root not reached as unfinished (D-1401)", (t) => {
  const { base, root } = setup(t);
  const second = join(base, "second");
  mkdirSync(second);
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([root, second], sweepOptions(audit, { deadlineMs: 0 }));
  assert.deepEqual(result.unfinishedRoots, [root, second]);
  const complete = sweepOrphanTempFiles([root, second], sweepOptions(audit));
  assert.deepEqual(complete.unfinishedRoots, []);
});

void test("a root that does not bind is counted and the other roots are still swept (D-1401)", (t) => {
  const { base, root } = setup(t);
  const orphan = join(root, `.target.txt.realm-tmp-${HEX}`);
  plant(orphan, OLD_MS);
  const regular = join(base, "file.txt");
  writeFileSync(regular, "not a directory");
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles(
    [join(base, "missing"), "relative/root", regular, root],
    sweepOptions(audit),
  );
  assert.equal(result.skipped, 3);
  assert.equal(existsSync(orphan), false);
  assert.equal(result.removed.length, 1);
});
