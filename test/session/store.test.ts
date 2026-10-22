import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRecord } from "../../src/contract/validate.js";
import { RealmError } from "../../src/core/errors.js";
import { SessionStore } from "../../src/session/store.js";

// The frozen D-14 field set, pinned as literals.
const FROZEN_FIELDS = [
  "containerId",
  "controlSocketPath",
  "realmId",
  "sessionId",
  "state",
  "workspaceRoot",
];

const REALM_ID = "7b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";

function fixture(t: TestContext): { store: SessionStore; stateDir: string; sessionsDir: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-store-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  return { store: new SessionStore(stateDir), stateDir, sessionsDir: join(stateDir, "sessions") };
}

function recordFor(stateDir: string, sessionId: string): SessionRecord {
  return {
    realmId: REALM_ID,
    sessionId,
    workspaceRoot: "/srv/workspace",
    state: "connecting",
    controlSocketPath: join(stateDir, "run", "control.sock"),
    containerId: null,
  };
}

function assertRejectsWith(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

void test("a first save writes exactly the frozen fields, with containerId null when none is given (RT-07, D-14)", (t) => {
  const { store, stateDir, sessionsDir } = fixture(t);
  const withoutContainer: SessionRecord = {
    realmId: REALM_ID,
    sessionId: "session-1",
    workspaceRoot: "/srv/workspace",
    state: "connecting",
    controlSocketPath: join(stateDir, "run", "control.sock"),
  };
  store.save(withoutContainer);

  const parsed = JSON.parse(readFileSync(join(sessionsDir, "session-1.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), FROZEN_FIELDS);
  assert.equal(parsed["containerId"], null);
  assert.equal(parsed["controlSocketPath"], join(stateDir, "run", "control.sock"));
});

void test("the sessions directory is created with mode 0700 and the record file with mode 0600 (D-37)", (t) => {
  const { store, stateDir, sessionsDir } = fixture(t);
  store.save(recordFor(stateDir, "session-1"));
  assert.equal(statSync(sessionsDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(sessionsDir, "session-1.json")).mode & 0o777, 0o600);
});

void test("a record carrying an extra token-shaped field is refused, the value is not echoed, and nothing is written (D-14, AUD-02)", (t) => {
  const { store, stateDir } = fixture(t);
  const leaky = { ...recordFor(stateDir, "session-1"), token: "sk-test-0123456789abcdefghijkl" };
  assert.throws(
    () => { store.save(leaky); },
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "SCHEMA_INVALID" &&
      !error.message.includes("sk-test"),
  );
  assert.equal(store.load("session-1"), null);
});

void test("an update replaces the record atomically and leaves no temporary file behind (FS-05, D-37)", (t) => {
  const { store, stateDir, sessionsDir } = fixture(t);
  store.save(recordFor(stateDir, "session-1"));
  const updated: SessionRecord = {
    ...recordFor(stateDir, "session-1"),
    state: "active",
    containerId: "fake-container-1",
  };
  store.save(updated);

  assert.deepEqual(store.load("session-1"), updated);
  assert.deepEqual(readdirSync(sessionsDir), ["session-1.json"]);
});

void test("load returns the stored record and null for a session with no record (D-37)", (t) => {
  const { store, stateDir } = fixture(t);
  assert.equal(store.load("never-saved"), null);
  const record = recordFor(stateDir, "session-1");
  store.save(record);
  assert.deepEqual(store.load("session-1"), record);
});

void test("delete removes the record, and deleting an absent session is a no-op (D-37)", (t) => {
  const { store, stateDir } = fixture(t);
  store.save(recordFor(stateDir, "session-1"));
  store.delete("session-1");
  assert.equal(store.load("session-1"), null);
  store.delete("session-1");
  store.delete("never-saved");
});

void test("a session id that could leave the sessions directory is refused with SCHEMA_INVALID (D-37)", (t) => {
  const { store, stateDir } = fixture(t);
  assertRejectsWith(() => { store.save(recordFor(stateDir, "../escape")); }, "SCHEMA_INVALID");
  assertRejectsWith(() => store.load("../escape"), "SCHEMA_INVALID");
  assertRejectsWith(() => { store.delete("nested/id"); }, "SCHEMA_INVALID");
});

void test("RT-08: list() returns the sorted ids of record files and ignores names that do not match the record pattern (D-85)", (t) => {
  const { store, stateDir, sessionsDir } = fixture(t);
  store.save(recordFor(stateDir, "session-b"));
  store.save(recordFor(stateDir, "session-a"));
  writeFileSync(join(sessionsDir, "notes.txt"), "not a record");
  writeFileSync(join(sessionsDir, ".hidden.json"), "{}");
  writeFileSync(join(sessionsDir, "has space.json"), "{}");
  writeFileSync(join(sessionsDir, "a.b.json"), "{}");
  writeFileSync(join(sessionsDir, "session-c.json.bak"), "{}");
  mkdirSync(join(sessionsDir, "directory-record.json"));
  assert.deepEqual(store.list(), ["session-a", "session-b"]);
});

void test("RT-08: list() includes the id of a record whose contents are corrupt, so the record can still be deleted (D-85)", (t) => {
  const { store, sessionsDir } = fixture(t);
  mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(sessionsDir, "corrupt-1.json"), "{not json");
  assert.deepEqual(store.list(), ["corrupt-1"]);
  store.delete("corrupt-1");
  assert.deepEqual(store.list(), []);
});

void test("RT-08: list() on an absent sessions directory returns an empty array, not null (D-85)", (t) => {
  const { store, sessionsDir } = fixture(t);
  assert.equal(existsSync(sessionsDir), false);
  assert.deepEqual(store.list(), []);
});
