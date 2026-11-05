// The up path writes the workspace pin, down keeps it, and an up after down binds the directory at the path again (RES-04). The
// scripted-provider fixture runs the real daemon in process; it does not expose its execution double, so the
// no-start observable here is the registry entry, which is written only after the pin is written and before create.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordFileName, sessionIdOfWorkspace } from "../../src/session/paths.js";
import { readWorkspacePin, workspacePinDirOf } from "../../src/session/workspace-pin.js";
import { listWorkspaceEntryIds } from "../../src/session/workspace-registry.js";
import { startRealmDaemon, type RealmDaemonFixture } from "../support/realm-daemon-fixture.js";

interface Harness {
  readonly base: string;
  readonly workspace: string;
  readonly stateDir: string;
  start(): Promise<RealmDaemonFixture>;
  stop(): Promise<void>;
}

// One realm under a fresh temporary directory. At most one daemon runs at a time. Teardown stops a daemon the test
// left running, then removes the directory.
function harness(t: TestContext): Harness {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "rlp-")));
  const workspace = join(base, "ws");
  const stateDir = join(base, "realm");
  mkdirSync(workspace);
  let live: RealmDaemonFixture | undefined;
  t.after(async () => {
    try {
      await live?.down();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
  return {
    base,
    workspace,
    stateDir,
    async start(): Promise<RealmDaemonFixture> {
      const daemon = await startRealmDaemon({ stateDir, workspace, mode: "advisory" });
      live = daemon;
      return daemon;
    },
    async stop(): Promise<void> {
      const daemon = live;
      live = undefined;
      await daemon?.down();
    },
  };
}

// An up that must succeed: the typed client throws on an error reply, and the reply's snapshot is active.
async function upActive(daemon: RealmDaemonFixture, workspace: string): Promise<void> {
  const up = await daemon.connectFor(workspace).up();
  assert.equal(up.snapshot.state, "active");
}

void test("RES-04: the first up writes the workspace pin for the pinned root", async (t) => {
  const h = harness(t);
  const daemon = await h.start();
  await upActive(daemon, h.workspace);
  const sessionId = sessionIdOfWorkspace(h.workspace);
  assert.equal(existsSync(join(workspacePinDirOf(h.stateDir), recordFileName(sessionId))), true);
  const pin = readWorkspacePin(h.stateDir, sessionId);
  assert.equal(pin?.realPath, h.workspace);
  assert.equal(pin.workspaceRoot, h.workspace);
  await h.stop();
});

void test("RES-04: down removes the registry entry and keeps the pin, and an up after down with the same root succeeds", async (t) => {
  const h = harness(t);
  const sessionId = sessionIdOfWorkspace(h.workspace);
  const pinFile = join(workspacePinDirOf(h.stateDir), recordFileName(sessionId));
  const first = await h.start();
  await upActive(first, h.workspace);
  const pinText = readFileSync(pinFile, "utf8");
  await h.stop();
  assert.deepEqual(listWorkspaceEntryIds(h.stateDir), []);
  assert.equal(existsSync(pinFile), true);

  const second = await h.start();
  await upActive(second, h.workspace);
  assert.equal(readFileSync(pinFile, "utf8"), pinText);
  assert.deepEqual(listWorkspaceEntryIds(h.stateDir), [sessionId]);
  await h.stop();
});

void test("RES-04: an up after down with a replaced root binds the replacement: the pin holds its inode and the registry entry is written", async (t) => {
  const h = harness(t);
  const sessionId = sessionIdOfWorkspace(h.workspace);
  const first = await h.start();
  await upActive(first, h.workspace);
  const pinBefore = readWorkspacePin(h.stateDir, sessionId);
  await h.stop();
  // The root is replaced at the same path. The original directory is renamed away first, so the new one cannot
  // reuse its inode and the pin's identity check sees a different directory.
  renameSync(h.workspace, join(h.base, "ws-replaced"));
  mkdirSync(h.workspace);
  const replacedIno = statSync(h.workspace).ino;

  const second = await h.start();
  await upActive(second, h.workspace);
  const pinAfter = readWorkspacePin(h.stateDir, sessionId);
  assert.equal(pinAfter?.ino, replacedIno);
  assert.notEqual(pinAfter.ino, pinBefore?.ino);
  assert.deepEqual(listWorkspaceEntryIds(h.stateDir), [sessionId]);
  await h.stop();
});
