import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { bindRoot } from "../../src/fs/root.js";
import { snapshotWorkspace } from "../../src/session/checkpoint.js";
import { checkpointDirOf, sessionIdOfWorkspace } from "../../src/session/paths.js";
import { readWorkspacePin, writeWorkspacePin } from "../../src/session/workspace-pin.js";

interface Fixture {
  readonly base: string;
  readonly ws: string;
  readonly state: string;
  readonly id: string;
}

// Real directories under a temporary base, removed when the test ends. Nothing is mocked. The state root lies outside
// the workspace. The session is unbound: no registry entry is written, so only its pin is known.
function fixture(t: TestContext): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-rebind-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  mkdirSync(ws);
  const state = join(base, "state");
  mkdirSync(state);
  return { base, ws, state, id: sessionIdOfWorkspace(ws) };
}

// Replaces the directory at the workspace path. The original is renamed away first, so the new directory cannot reuse
// its inode.
function replaceWorkspaceDir(f: Fixture): void {
  renameSync(f.ws, join(f.base, "ws-replaced"));
  mkdirSync(f.ws);
  writeFileSync(join(f.ws, "replacement.txt"), "replacement");
}

void test("a directory replaced at the pinned path and bound again by a pin write takes a checkpoint through the unbound scope", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "original.txt"), "original");
  writeWorkspacePin(f.state, bindRoot(f.ws), f.id);
  replaceWorkspaceDir(f);
  const rebound = writeWorkspacePin(f.state, bindRoot(f.ws), f.id);
  assert.equal(rebound.ino, statSync(f.ws).ino);

  const snapshot = await snapshotWorkspace({
    entry: null,
    sessionId: f.id,
    stateRoot: f.state,
    checkpointId: "c1",
  });

  assert.deepEqual(snapshot.manifest.entries.map((entry) => entry.path), ["replacement.txt"]);
  assert.equal(existsSync(join(checkpointDirOf(f.state, f.id, "c1"), "manifest.json")), true);
  assert.equal(readWorkspacePin(f.state, f.id)?.ino, rebound.ino);
});

void test("a directory replaced at the pinned path without a bind is refused by create through the unbound scope, and writes no checkpoint", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "original.txt"), "original");
  const pin = writeWorkspacePin(f.state, bindRoot(f.ws), f.id);
  replaceWorkspaceDir(f);

  await assert.rejects(
    snapshotWorkspace({ entry: null, sessionId: f.id, stateRoot: f.state, checkpointId: "c1" }),
    (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
  );

  assert.equal(existsSync(checkpointDirOf(f.state, f.id, "c1")), false);
  assert.deepEqual(readWorkspacePin(f.state, f.id), pin);
});
