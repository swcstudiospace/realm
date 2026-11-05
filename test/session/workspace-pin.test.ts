import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { bindRoot } from "../../src/fs/root.js";
import { recordFileName, sessionIdOfWorkspace } from "../../src/session/paths.js";
import {
  readWorkspacePin,
  verifyWorkspacePin,
  workspacePinDirOf,
  writeWorkspacePin,
} from "../../src/session/workspace-pin.js";
import { readWorkspaceEntry, removeWorkspaceEntry, writeWorkspaceEntry } from "../../src/session/workspace-registry.js";

// Real directories under a temporary base, removed when the test ends. Nothing is mocked.
function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-pin-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  const ws = join(base, "ws");
  const other = join(base, "other");
  mkdirSync(stateDir);
  mkdirSync(ws);
  mkdirSync(other);
  return { base, stateDir, ws, other, pinDir: workspacePinDirOf(stateDir) };
}

function assertRejectsWith(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

void test("a written pin reads back equal to what was written, at mode 0600 in a 0700 directory", (t) => {
  const { stateDir, ws, pinDir } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  const written = writeWorkspacePin(stateDir, pinned, id);
  assert.deepEqual(written, {
    schema: 1,
    sessionId: id,
    workspaceRoot: ws,
    realPath: ws,
    dev: pinned.dev,
    ino: pinned.ino,
  });
  assert.deepEqual(readWorkspacePin(stateDir, id), written);
  assert.equal(modeOf(pinDir), 0o700);
  assert.equal(modeOf(join(pinDir, recordFileName(id))), 0o600);
  assert.equal(verifyWorkspacePin(written).realPath, ws);
});

void test("a second write with the same identity returns an equal pin and leaves the record unchanged", (t) => {
  const { stateDir, ws, pinDir } = fixture(t);
  const id = sessionIdOfWorkspace(bindRoot(ws).realPath);
  const first = writeWorkspacePin(stateDir, bindRoot(ws), id);
  const file = join(pinDir, recordFileName(id));
  const before = readFileSync(file, "utf8");
  const second = writeWorkspacePin(stateDir, bindRoot(ws), id);
  assert.deepEqual(second, first);
  assert.equal(readFileSync(file, "utf8"), before);
});

void test("a root replaced at the pinned path is bound again by a second write, and the pin holds the new identity", (t) => {
  const { base, stateDir, ws } = fixture(t);
  const id = sessionIdOfWorkspace(bindRoot(ws).realPath);
  const first = writeWorkspacePin(stateDir, bindRoot(ws), id);
  renameSync(ws, join(base, "ws-aside"));
  mkdirSync(ws);
  const replacement = bindRoot(ws);
  const rebound = writeWorkspacePin(stateDir, replacement, id);
  assert.notEqual(rebound.ino, first.ino);
  assert.deepEqual(rebound, {
    schema: 1,
    sessionId: id,
    workspaceRoot: ws,
    realPath: ws,
    dev: replacement.dev,
    ino: replacement.ino,
  });
  assert.deepEqual(readWorkspacePin(stateDir, id), rebound);
  assert.equal(verifyWorkspacePin(rebound).realPath, ws);
});

void test("a root moved away from the pinned path is refused by a write for its old session id with SCHEMA_INVALID, and the pin is unchanged", (t) => {
  const { base, stateDir, ws } = fixture(t);
  const id = sessionIdOfWorkspace(bindRoot(ws).realPath);
  const first = writeWorkspacePin(stateDir, bindRoot(ws), id);
  const moved = join(base, "moved");
  renameSync(ws, moved);
  assertRejectsWith(() => writeWorkspacePin(stateDir, bindRoot(moved), id), "SCHEMA_INVALID");
  assert.deepEqual(readWorkspacePin(stateDir, id), first);
});

void test("a first write under an id that does not derive from the pinned path is SCHEMA_INVALID and writes nothing", (t) => {
  const { stateDir, ws, other } = fixture(t);
  const wrongId = sessionIdOfWorkspace(bindRoot(other).realPath);
  assertRejectsWith(() => writeWorkspacePin(stateDir, bindRoot(ws), wrongId), "SCHEMA_INVALID");
  assert.equal(readWorkspacePin(stateDir, wrongId), null);
  assert.equal(readWorkspacePin(stateDir, sessionIdOfWorkspace(bindRoot(ws).realPath)), null);
});

void test("removing the registry entry leaves the pin readable and verifiable", (t) => {
  const { stateDir, ws } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  writeWorkspaceEntry(stateDir, pinned, id);
  const pin = writeWorkspacePin(stateDir, pinned, id);
  removeWorkspaceEntry(stateDir, id);
  assert.equal(readWorkspaceEntry(stateDir, id), null);
  assert.deepEqual(readWorkspacePin(stateDir, id), pin);
  assert.equal(verifyWorkspacePin(pin).realPath, ws);
});

void test("a malformed pin record is refused with SCHEMA_INVALID on read and on write, and the write does not overwrite it", (t) => {
  const { stateDir, ws, other, pinDir } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  writeWorkspacePin(stateDir, pinned, id);
  const file = join(pinDir, recordFileName(id));
  const valid = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const malformed = [
    "{not json",
    JSON.stringify({ ...valid, extra: true }),
    JSON.stringify({ ...valid, sessionId: sessionIdOfWorkspace(bindRoot(other).realPath) }),
    JSON.stringify({ ...valid, workspaceRoot: other }),
    JSON.stringify({ ...valid, schema: 2 }),
    JSON.stringify({ ...valid, dev: "1" }),
  ];
  for (const text of malformed) {
    writeFileSync(file, text);
    assertRejectsWith(() => readWorkspacePin(stateDir, id), "SCHEMA_INVALID");
    assertRejectsWith(() => writeWorkspacePin(stateDir, pinned, id), "SCHEMA_INVALID");
    assert.equal(readFileSync(file, "utf8"), text);
  }
});

void test("verifyWorkspacePin refuses a pinned root that moved, with POLICY_DENIED", (t) => {
  const { base, stateDir, ws } = fixture(t);
  const id = sessionIdOfWorkspace(bindRoot(ws).realPath);
  const pin = writeWorkspacePin(stateDir, bindRoot(ws), id);
  renameSync(ws, join(base, "moved"));
  assertRejectsWith(() => verifyWorkspacePin(pin), "POLICY_DENIED");
});

void test("verifyWorkspacePin refuses a directory replaced at the pinned path, with POLICY_DENIED", (t) => {
  const { base, stateDir, ws } = fixture(t);
  const id = sessionIdOfWorkspace(bindRoot(ws).realPath);
  const pin = writeWorkspacePin(stateDir, bindRoot(ws), id);
  renameSync(ws, join(base, "ws-aside"));
  mkdirSync(ws);
  assertRejectsWith(() => verifyWorkspacePin(pin), "POLICY_DENIED");
});

void test("verifyWorkspacePin refuses a pinned root that moved and is reached through a link, with POLICY_DENIED", (t) => {
  const { base, stateDir, ws } = fixture(t);
  const id = sessionIdOfWorkspace(bindRoot(ws).realPath);
  const pin = writeWorkspacePin(stateDir, bindRoot(ws), id);
  const moved = join(base, "moved");
  renameSync(ws, moved);
  symlinkSync(moved, ws);
  assertRejectsWith(() => verifyWorkspacePin(pin), "POLICY_DENIED");
});
