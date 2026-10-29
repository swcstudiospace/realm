import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex, TEMP_NAME_PATTERN, type AtomicWriteStage } from "../../src/fs/atomic-write.js";
import { ORPHAN_TEMP_MIN_AGE_MS, sweepOrphanTempFiles, type TempSweepAuditEntry } from "../../src/fs/temp-sweep.js";

// CRASH-05. A child process writes through atomicWriteFile and SIGKILLs itself from the stage hook,
// so the death is real and deterministic: no signal race. The four hookable stages all precede
// the rename. A kill after the rename cannot be hooked (the writer has no stage there), so that
// outcome is not tested here; by rename(2) atomicity the target holds the old or the new bytes and
// no temp file remains (INFERENCE, not exercised).

const ORIGINAL = "original bytes\n";
const REPLACEMENT = "replacement bytes\n";
const CHILD_TIMEOUT_MS = 30_000;

const STAGES: readonly AtomicWriteStage[] = ["after-temp-write", "after-fsync", "before-rename", "after-recheck"];

// Child body, run by node -e. The module is loaded by URL in a separate process, which cannot
// share this test's module graph, so a static import cannot express it.
const KILL_SCRIPT = `
const p = JSON.parse(process.env.REALM_CHILD_PAYLOAD);
const { atomicWriteFile } = await import(p.atomicWriteUrl);
atomicWriteFile(p.target, p.content, {
  expectedPriorSha256: p.prior,
  stageHook: (stage) => {
    if (stage === p.killAt) {
      process.kill(process.pid, "SIGKILL");
    }
  },
});
process.stdout.write("completed");
`;

const ATOMIC_WRITE_URL = new URL("../../src/fs/atomic-write.js", import.meta.url).href;

function setup(t: TestContext): { dir: string; target: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-sigkill-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const target = join(dir, "target.txt");
  writeFileSync(target, ORIGINAL);
  return { dir, target };
}

function runWriter(target: string, killAt: AtomicWriteStage | "none") {
  return spawnSync(process.execPath, ["--input-type=module", "-e", KILL_SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      REALM_CHILD_PAYLOAD: JSON.stringify({
        atomicWriteUrl: ATOMIC_WRITE_URL,
        target,
        content: REPLACEMENT,
        prior: sha256Hex(ORIGINAL),
        killAt,
      }),
    },
    timeout: CHILD_TIMEOUT_MS,
  });
}

function orphans(dir: string): string[] {
  return readdirSync(dir).filter((name) => TEMP_NAME_PATTERN.test(name));
}

function ownerUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error("process.getuid is required: the SIGKILL tests run on Linux");
  }
  return uid;
}

for (const stage of STAGES) {
  void test(`a SIGKILL at ${stage} keeps the original, leaves one orphan, and the sweep removes it (CRASH-05)`, (t) => {
    const { dir, target } = setup(t);
    const run = runWriter(target, stage);
    assert.equal(run.error, undefined, `child did not end by itself: ${run.error?.message ?? ""}`);
    assert.equal(run.signal, "SIGKILL");
    assert.equal(run.status, null);
    assert.ok(!run.stdout.includes("completed"));

    assert.equal(readFileSync(target, "utf8"), ORIGINAL);
    const found = orphans(dir);
    assert.equal(found.length, 1, `expected one orphan, found ${found.join(", ")}`);
    const [name] = found;
    assert.ok(name !== undefined && name.startsWith(".target.txt.realm-tmp-"));
    const orphanPath = join(dir, name);
    assert.equal(readFileSync(orphanPath, "utf8"), REPLACEMENT);

    const audit: TempSweepAuditEntry[] = [];
    const result = sweepOrphanTempFiles([dir], {
      now: Date.now(),
      minAgeMs: 0,
      ownerUid: ownerUid(),
      audit: (entry) => {
        audit.push(entry);
      },
    });
    assert.deepEqual(orphans(dir), []);
    assert.deepEqual(result.removed, [{ path: orphanPath, bytes: Buffer.byteLength(REPLACEMENT) }]);
    assert.deepEqual(audit, [
      { tool: "temp-sweep", outcome: "ok", path: orphanPath, bytes: Buffer.byteLength(REPLACEMENT) },
    ]);
    assert.equal(readFileSync(target, "utf8"), ORIGINAL);
  });
}

void test("a write that is not killed completes and leaves no temp file (CRASH-05 control)", (t) => {
  const { dir, target } = setup(t);
  const run = runWriter(target, "none");
  assert.equal(run.error, undefined);
  assert.equal(run.signal, null);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "completed");
  assert.equal(readFileSync(target, "utf8"), REPLACEMENT);
  assert.deepEqual(orphans(dir), []);
});

void test("the production age bound keeps a fresh orphan (CRASH-05, D-1401)", (t) => {
  const { dir, target } = setup(t);
  const run = runWriter(target, "after-fsync");
  assert.equal(run.signal, "SIGKILL");
  const audit: TempSweepAuditEntry[] = [];
  const result = sweepOrphanTempFiles([dir], {
    now: Date.now(),
    minAgeMs: ORPHAN_TEMP_MIN_AGE_MS,
    ownerUid: ownerUid(),
    audit: (entry) => {
      audit.push(entry);
    },
  });
  assert.equal(orphans(dir).length, 1, "a seconds-old orphan is inside the 60 s bound");
  assert.deepEqual(result.removed, []);
  assert.deepEqual(audit, []);
  assert.equal(readFileSync(target, "utf8"), ORIGINAL);
});
