// Both daemon entry points build their libpod client through one helper (Q0-005). The LibpodClient constructor is
// the only place that refuses a socket path that is not absolute, so a relative path must be refused with the same
// catalogue code by startDaemon and by buildDaemonHandle, and an absolute one must build a handle.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { RealmError } from "../../src/core/errors.js";
import { selectionOf } from "../../src/daemon/client.js";
import { buildDaemonHandle, startDaemon } from "../../src/daemon/daemon.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;

interface Dirs {
  readonly base: string;
  readonly stateDir: string;
  readonly ws: string;
  readonly policyPath: string;
}

function makeDirs(t: TestContext): Dirs {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-libpod-entry-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  const ws = join(base, "ws");
  mkdirSync(stateDir);
  mkdirSync(ws);
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ workspaceRoots: [ws] }));
  return { base, stateDir, ws, policyPath };
}

function isCatalogueRefusal(error: unknown, code: string): boolean {
  return error instanceof RealmError && error.code === code;
}

void test("Q0-005: startDaemon and buildDaemonHandle refuse a relative libpodSocketPath with the same SCHEMA_INVALID", async (t) => {
  const dirs = makeDirs(t);
  const runtimeInput = { image: IMAGE, stateDir: dirs.stateDir, workspaceRoot: dirs.ws };
  const relative = "relative/podman.sock";
  assert.throws(
    () =>
      buildDaemonHandle({
        runtimeInput,
        policyPath: dirs.policyPath,
        sessionId: selectionOf(dirs.ws).sessionId,
        libpodSocketPath: relative,
      }),
    (error: unknown) => isCatalogueRefusal(error, "SCHEMA_INVALID"),
  );
  await assert.rejects(
    startDaemon({ runtimeInput, policyPath: dirs.policyPath, libpodSocketPath: relative }),
    (error: unknown) => isCatalogueRefusal(error, "SCHEMA_INVALID"),
  );
});

void test("Q0-005: buildDaemonHandle builds a handle over an absolute libpodSocketPath through the same helper", (t) => {
  const dirs = makeDirs(t);
  const handle = buildDaemonHandle({
    runtimeInput: { image: IMAGE, stateDir: dirs.stateDir, workspaceRoot: dirs.ws },
    policyPath: dirs.policyPath,
    sessionId: selectionOf(dirs.ws).sessionId,
    libpodSocketPath: join(dirs.base, "podman.sock"),
  });
  t.after(async () => {
    await handle.close();
  });
  assert.equal(handle.controller.snapshot().state, "unbound");
});
