import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
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
import { sessionIdOfWorkspace } from "../../src/session/paths.js";
import {
  listWorkspaceEntryIds,
  readWorkspaceEntry,
  removeWorkspaceEntry,
  verifyWorkspaceEntry,
  workspaceRegistryDirOf,
  writeWorkspaceEntry,
  type WorkspaceEntry,
} from "../../src/session/workspace-registry.js";

// Real directories under a temporary base, removed when the test ends. Nothing is mocked.
function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-registry-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  const ws = join(base, "ws");
  const other = join(base, "other");
  mkdirSync(stateDir);
  mkdirSync(ws);
  mkdirSync(other);
  const registry = workspaceRegistryDirOf(stateDir);
  return { base, stateDir, ws, other, registry };
}

function assertRejectsWith(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

void test("a written entry reads back equal to what was written, at mode 0600 in a 0700 directory (MULTI-02, C3)", (t) => {
  const { stateDir, ws, registry } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  const written = writeWorkspaceEntry(stateDir, pinned, id);
  assert.deepEqual(written, { schema: 1, sessionId: id, workspaceRoot: ws, dev: pinned.dev, ino: pinned.ino });
  assert.deepEqual(readWorkspaceEntry(stateDir, id), written);
  assert.equal(modeOf(registry), 0o700);
  assert.equal(modeOf(join(registry, `${id}.json`)), 0o600);
  assert.equal(verifyWorkspaceEntry(written).realPath, ws);
});

void test("the file holds exactly the five fields of the contract (C3)", (t) => {
  const { stateDir, ws, registry } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  writeWorkspaceEntry(stateDir, pinned, id);
  const parsed = JSON.parse(readFileSync(join(registry, `${id}.json`), "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ["dev", "ino", "schema", "sessionId", "workspaceRoot"]);
});

void test("writing an entry under an id that is not the id of the pinned path is SCHEMA_INVALID and writes nothing (C3)", (t) => {
  const { stateDir, ws, registry } = fixture(t);
  const pinned = bindRoot(ws);
  assertRejectsWith(() => writeWorkspaceEntry(stateDir, pinned, "p000000000000"), "SCHEMA_INVALID");
  assert.equal(existsSync(registry), false);
});

void test("a registry directory at another mode is POLICY_DENIED and no entry is written (C3)", (t) => {
  const { stateDir, ws, registry } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  mkdirSync(registry, { recursive: true, mode: 0o700 });
  chmodSync(registry, 0o755);
  assertRejectsWith(() => writeWorkspaceEntry(stateDir, pinned, id), "POLICY_DENIED");
  assert.equal(existsSync(join(registry, `${id}.json`)), false);
});

void test("an entry renamed to another session's file name is SCHEMA_INVALID when read under that name (C3)", (t) => {
  const { stateDir, ws, other, registry } = fixture(t);
  const pinnedWs = bindRoot(ws);
  const idWs = sessionIdOfWorkspace(pinnedWs.realPath);
  writeWorkspaceEntry(stateDir, pinnedWs, idWs);
  const pinnedOther = bindRoot(other);
  const idOther = sessionIdOfWorkspace(pinnedOther.realPath);
  renameSync(join(registry, `${idWs}.json`), join(registry, `${idOther}.json`));
  assertRejectsWith(() => readWorkspaceEntry(stateDir, idOther), "SCHEMA_INVALID");
});

void test("an entry whose workspaceRoot was moved after writing is POLICY_DENIED by verifyWorkspaceEntry (MULTI-02)", (t) => {
  const { base, stateDir, ws } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  const entry = writeWorkspaceEntry(stateDir, pinned, id);
  renameSync(ws, join(base, "ws-moved"));
  assert.equal(readWorkspaceEntry(stateDir, id)?.workspaceRoot, ws);
  assertRejectsWith(() => verifyWorkspaceEntry(entry), "POLICY_DENIED");
});

void test("a directory replaced at the entry's path is POLICY_DENIED by verifyWorkspaceEntry (rename-aside, MULTI-02)", (t) => {
  const { base, stateDir, ws } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  const entry = writeWorkspaceEntry(stateDir, pinned, id);
  // The original directory is renamed aside, not removed, so its inode stays allocated and the new
  // directory cannot take the same device and inode.
  renameSync(ws, join(base, "ws-aside"));
  mkdirSync(ws);
  assertRejectsWith(() => verifyWorkspaceEntry(entry), "POLICY_DENIED");
});

void test("a symbolic link planted at the entry file name is refused with PATH_ESCAPE and the file outside is not read (C3)", (t) => {
  const { base, stateDir, ws, registry } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  const entryPath = join(registry, `${id}.json`);
  writeWorkspaceEntry(stateDir, pinned, id);
  // The file outside holds a well-formed entry, so only the link check can refuse it.
  const outside = join(base, "outside.json");
  writeFileSync(outside, readFileSync(entryPath, "utf8"));
  rmSync(entryPath);
  symlinkSync(outside, entryPath);
  assertRejectsWith(() => readWorkspaceEntry(stateDir, id), "PATH_ESCAPE");
});

void test("an entry whose workspaceRoot names another directory is SCHEMA_INVALID under its own id (C3)", (t) => {
  const { stateDir, ws, other, registry } = fixture(t);
  const idWs = sessionIdOfWorkspace(realpathSync(ws));
  const pinnedOther = bindRoot(other);
  mkdirSync(registry, { recursive: true, mode: 0o700 });
  const forged: WorkspaceEntry = {
    schema: 1,
    sessionId: idWs,
    workspaceRoot: pinnedOther.realPath,
    dev: pinnedOther.dev,
    ino: pinnedOther.ino,
  };
  writeFileSync(join(registry, `${idWs}.json`), `${JSON.stringify(forged, null, 2)}\n`);
  assertRejectsWith(() => readWorkspaceEntry(stateDir, idWs), "SCHEMA_INVALID");
});

void test("an entry whose schema is not 1 is SCHEMA_INVALID (C3)", (t) => {
  const { stateDir, ws, registry } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  mkdirSync(registry, { recursive: true, mode: 0o700 });
  const wrongSchema = { schema: 2, sessionId: id, workspaceRoot: ws, dev: pinned.dev, ino: pinned.ino };
  writeFileSync(join(registry, `${id}.json`), `${JSON.stringify(wrongSchema, null, 2)}\n`);
  assertRejectsWith(() => readWorkspaceEntry(stateDir, id), "SCHEMA_INVALID");
});

void test("an entry with an extra field is SCHEMA_INVALID (C3)", (t) => {
  const { stateDir, ws, registry } = fixture(t);
  const pinned = bindRoot(ws);
  const id = sessionIdOfWorkspace(pinned.realPath);
  mkdirSync(registry, { recursive: true, mode: 0o700 });
  const extra = { schema: 1, sessionId: id, workspaceRoot: ws, dev: pinned.dev, ino: pinned.ino, token: "x" };
  writeFileSync(join(registry, `${id}.json`), `${JSON.stringify(extra, null, 2)}\n`);
  assertRejectsWith(() => readWorkspaceEntry(stateDir, id), "SCHEMA_INVALID");
});

void test("reading an absent entry returns null, and an absent registry directory also returns null (C3)", (t) => {
  const { stateDir, ws } = fixture(t);
  const id = sessionIdOfWorkspace(realpathSync(ws));
  assert.equal(readWorkspaceEntry(stateDir, id), null);
  writeWorkspaceEntry(stateDir, bindRoot(ws), id);
  assert.equal(readWorkspaceEntry(stateDir, "p000000000000"), null);
});

void test("removeWorkspaceEntry on an absent id is a no-op, with or without a registry directory (C3)", (t) => {
  const { stateDir, ws } = fixture(t);
  const id = sessionIdOfWorkspace(realpathSync(ws));
  assert.doesNotThrow(() => removeWorkspaceEntry(stateDir, id));
  writeWorkspaceEntry(stateDir, bindRoot(ws), id);
  removeWorkspaceEntry(stateDir, id);
  assert.equal(readWorkspaceEntry(stateDir, id), null);
  assert.doesNotThrow(() => removeWorkspaceEntry(stateDir, id));
});

void test("listWorkspaceEntryIds ignores non-.json files, directories and stems that fail isSessionId, and sorts the rest (C3)", (t) => {
  const { stateDir, ws, other, registry } = fixture(t);
  const idWs = sessionIdOfWorkspace(realpathSync(ws));
  const idOther = sessionIdOfWorkspace(realpathSync(other));
  writeWorkspaceEntry(stateDir, bindRoot(ws), idWs);
  writeWorkspaceEntry(stateDir, bindRoot(other), idOther);
  writeFileSync(join(registry, `${idWs}.txt`), "not an entry");
  writeFileSync(join(registry, ".hidden.json"), "{}");
  writeFileSync(join(registry, "not valid.json"), "{}");
  mkdirSync(join(registry, "pdeadbeef0000.json"));
  assert.deepEqual(listWorkspaceEntryIds(stateDir), [idWs, idOther].sort());
});

void test("listWorkspaceEntryIds lists nothing when the registry directory is absent (C3)", (t) => {
  const { stateDir } = fixture(t);
  assert.deepEqual(listWorkspaceEntryIds(stateDir), []);
});
