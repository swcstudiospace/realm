// Presence markers: strict, bounded, symlink-safe writes and reads under <stateDir>/hosts/<host>-active.
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RealmError } from "../../src/core/errors.js";
import { readPresence, removePresence, writePresence } from "../../src/host/presence.js";

const STARTED = "2026-11-17T10:00:00.000Z";

function record(pid: number, extra: { sessionId?: string; attach?: "attached" | "failed"; code?: string | null } = {}) {
  return {
    pid,
    startedAt: STARTED,
    sessionId: extra.sessionId ?? "p0123456789ab",
    attach: extra.attach ?? "attached",
    code: extra.code === undefined ? null : extra.code,
  } as const;
}

function withState(run: (stateDir: string, dir: string) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "realm-presence-"));
    try {
      await run(stateDir, join(stateDir, "hosts", "omp-active"));
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  };
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

const everyoneAlive = (): boolean => true;
const nobodyAlive = (): boolean => false;

void test(
  "a written marker is read back as live for this process and is mode 0600 in a 0700 directory",
  withState(async (stateDir, dir) => {
    writePresence(stateDir, "omp", record(process.pid));
    assert.deepEqual(await readPresence(stateDir, "omp"), { live: 1, stale: 0, unreadable: 0 });
    assert.equal(lstatSync(join(dir, `${String(process.pid)}.json`)).mode & 0o777, 0o600);
    assert.equal(lstatSync(dir).mode & 0o777, 0o700);
    assert.equal(lstatSync(join(stateDir, "hosts")).mode & 0o777, 0o700);
  }),
);

void test(
  "an absent directory reads as all zeros",
  withState(async (stateDir) => {
    assert.deepEqual(await readPresence(stateDir, "omp"), { live: 0, stale: 0, unreadable: 0 });
    mkdirSync(join(stateDir, "hosts"));
    assert.deepEqual(await readPresence(stateDir, "omp"), { live: 0, stale: 0, unreadable: 0 });
  }),
);

void test(
  "a dead pid is counted stale on read and pruned by the next write",
  withState(async (stateDir, dir) => {
    writePresence(stateDir, "omp", record(4000001), { isAlive: everyoneAlive });
    assert.deepEqual(await readPresence(stateDir, "omp", { isAlive: nobodyAlive }), { live: 0, stale: 1, unreadable: 0 });
    writePresence(stateDir, "omp", record(process.pid), { isAlive: nobodyAlive });
    assert.deepEqual(readdirSync(dir), [`${String(process.pid)}.json`]);
  }),
);

void test(
  "a write prunes at most 64 entries",
  withState((stateDir, dir) => {
    mkdirSync(dir, { recursive: true });
    for (let pid = 1000; pid < 1100; pid += 1) {
      writeFileSync(join(dir, `${String(pid)}.json`), "{}\n", { mode: 0o600 });
    }
    writePresence(stateDir, "omp", record(4000000), { isAlive: nobodyAlive });
    // 100 stale markers, 64 examined: 36 remain besides the one just written.
    assert.equal(readdirSync(dir).length, 37);
  }),
);

void test(
  "a read examines at most 64 entries",
  withState(async (stateDir, dir) => {
    mkdirSync(dir, { recursive: true });
    for (let pid = 1000; pid < 1100; pid += 1) {
      writeFileSync(join(dir, `${String(pid)}.json`), "{}\n", { mode: 0o600 });
    }
    const counts = await readPresence(stateDir, "omp", { isAlive: everyoneAlive });
    assert.equal(counts.live + counts.stale + counts.unreadable, 64);
  }),
);

void test(
  "a file over 4096 bytes is unreadable",
  withState(async (stateDir, dir) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "1234.json"), " ".repeat(4097), { mode: 0o600 });
    assert.deepEqual(await readPresence(stateDir, "omp", { isAlive: everyoneAlive }), { live: 0, stale: 0, unreadable: 1 });
  }),
);

void test(
  "a symlinked hosts directory or presence directory is PATH_ESCAPE",
  withState(async (stateDir, dir) => {
    const elsewhere = mkdtempSync(join(tmpdir(), "realm-presence-else-"));
    try {
      symlinkSync(elsewhere, join(stateDir, "hosts"));
      await assert.rejects(readPresence(stateDir, "omp"), expectCode("PATH_ESCAPE"));
      assert.throws(() => {
        writePresence(stateDir, "omp", record(process.pid));
      }, expectCode("PATH_ESCAPE"));
      rmSync(join(stateDir, "hosts"));
      mkdirSync(join(stateDir, "hosts"));
      symlinkSync(elsewhere, dir);
      await assert.rejects(readPresence(stateDir, "omp"), expectCode("PATH_ESCAPE"));
      assert.throws(() => {
        writePresence(stateDir, "omp", record(process.pid));
      }, expectCode("PATH_ESCAPE"));
      assert.throws(() => {
        removePresence(stateDir, "omp", process.pid);
      }, expectCode("PATH_ESCAPE"));
      assert.deepEqual(readdirSync(elsewhere), []);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  }),
);

void test(
  "a symlinked marker and a directory named 1.json are unreadable",
  withState(async (stateDir, dir) => {
    mkdirSync(dir, { recursive: true });
    const real = join(stateDir, "real.json");
    writeFileSync(real, `${JSON.stringify({ schemaVersion: 1, ...record(55) })}\n`);
    symlinkSync(real, join(dir, "55.json"));
    mkdirSync(join(dir, "1.json"));
    assert.deepEqual(await readPresence(stateDir, "omp", { isAlive: everyoneAlive }), { live: 0, stale: 0, unreadable: 2 });
  }),
);

function markerWith(stateDir: string, pid: number, body: unknown): void {
  const dir = join(stateDir, "hosts", "omp-active");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${String(pid)}.json`), typeof body === "string" ? body : `${JSON.stringify(body)}\n`, { mode: 0o600 });
}

const VALID = { schemaVersion: 1, ...record(77) };

void test(
  "a strictly valid marker is live; every deviation is unreadable",
  withState(async (stateDir) => {
    const cases: readonly unknown[] = [
      { ...VALID, extra: 1 },
      { schemaVersion: 1, pid: 77, startedAt: STARTED, sessionId: "p0123456789ab", attach: "attached" },
      { ...VALID, schemaVersion: 2 },
      { ...VALID, pid: "77" },
      { ...VALID, pid: 78 },
      { ...VALID, startedAt: "yesterday" },
      { ...VALID, startedAt: "2026-13-45T99:99:99Z" },
      { ...VALID, sessionId: "../escape" },
      { ...VALID, attach: "maybe" },
      { ...VALID, code: "NOT_A_CODE" },
      { ...VALID, code: 5 },
      [VALID],
      "not json",
    ];
    for (const [index, body] of cases.entries()) {
      markerWith(stateDir, 77, body);
      assert.deepEqual(
        await readPresence(stateDir, "omp", { isAlive: everyoneAlive }),
        { live: 0, stale: 0, unreadable: 1 },
        `case ${String(index)}`,
      );
    }
    markerWith(stateDir, 77, { ...VALID, attach: "failed", code: "REALM_NOT_ACTIVE" });
    assert.deepEqual(await readPresence(stateDir, "omp", { isAlive: everyoneAlive }), { live: 1, stale: 0, unreadable: 0 });
  }),
);

void test(
  "an out-of-range pid or an invalid record is refused on write",
  withState((stateDir) => {
    for (const bad of [record(0), record(4_194_305), record(1.5), record(5, { sessionId: "bad/id" }), record(5, { code: "NOPE" })]) {
      assert.throws(() => {
        writePresence(stateDir, "omp", bad);
      }, expectCode("SCHEMA_INVALID"));
    }
    assert.throws(() => {
      writePresence(stateDir, "omp", { ...record(5), startedAt: "now" });
    }, expectCode("SCHEMA_INVALID"));
    assert.equal(existsSync(join(stateDir, "hosts")), false);
  }),
);

void test(
  "removePresence removes only that pid and ignores absence",
  withState((stateDir, dir) => {
    removePresence(stateDir, "omp", 99);
    writePresence(stateDir, "omp", record(process.pid), { isAlive: everyoneAlive });
    writePresence(stateDir, "omp", record(4000002), { isAlive: everyoneAlive });
    removePresence(stateDir, "omp", process.pid);
    removePresence(stateDir, "omp", process.pid);
    assert.deepEqual(readdirSync(dir), ["4000002.json"]);
  }),
);

void test(
  "a failed atomic write leaves no file behind",
  withState((stateDir, dir) => {
    assert.throws(() => {
      writePresence(stateDir, "omp", record(process.pid), {
        stageHook: (stage) => {
          if (stage === "before-rename") {
            throw new Error("injected");
          }
        },
      });
    });
    assert.deepEqual(readdirSync(dir), []);
  }),
);

void test(
  "a scan that outlasts the bound is TOOL_TIMEOUT",
  withState(async (stateDir) => {
    markerWith(stateDir, 77, VALID);
    // The liveness check blocks past the bound, so the scan cannot settle before the timer fires.
    const slow = (): boolean => {
      const until = Date.now() + 50;
      while (Date.now() < until) {
        // Busy wait: a synchronous stall is the one way to outlast a timer deterministically.
      }
      return true;
    };
    await assert.rejects(readPresence(stateDir, "omp", { readTimeoutMs: 10, isAlive: slow }), expectCode("TOOL_TIMEOUT"));
  }),
);

void test(
  "the default liveness check treats this process as live and a vanished pid as stale",
  withState(async (stateDir) => {
    markerWith(stateDir, process.pid, { ...VALID, pid: process.pid });
    markerWith(stateDir, 4194303, { ...VALID, pid: 4194303 });
    const counts = await readPresence(stateDir, "omp");
    assert.equal(counts.live, 1);
    assert.equal(counts.stale + counts.unreadable, 1);
    assert.equal(readFileSync(join(stateDir, "hosts", "omp-active", `${String(process.pid)}.json`), "utf8").length > 0, true);
  }),
);
