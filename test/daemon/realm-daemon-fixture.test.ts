// The realm-state fixture of the scripted-provider harness (HARN-02, D-1202): the in-process real daemon
// and the scripted control server. No Omp, Podman or network; no spawnSync (it would stall the in-process daemon).

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { displayStatus } from "../../src/core/status.js";
import type { State } from "../../src/core/states.js";
import { connectDaemon } from "../../src/daemon/client.js";
import {
  startRealmDaemon,
  startScriptedControlServer,
  type RealmDaemonFixture,
  type ScriptedControlServer,
  type ScriptedReply,
} from "../support/realm-daemon-fixture.js";
import type { PolicyMode } from "../../src/contract/validate.js";

const AT = "2026-10-21T09:30:00.000Z";

// A short prefix keeps the socket path under the 107-byte sun_path limit.
function makeBase(): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "rlv-")));
  mkdirSync(join(base, "ws"));
  return base;
}

async function startFixture(t: TestContext, mode: PolicyMode): Promise<{ base: string; daemon: RealmDaemonFixture }> {
  const base = makeBase();
  const started: RealmDaemonFixture[] = [];
  // One teardown: the daemon goes down while its socket exists, then the directory is removed.
  t.after(async () => {
    for (const running of started) {
      try {
        await running.down();
      } catch {
        // Already down by the test, or never served.
      }
    }
    rmSync(base, { recursive: true, force: true });
  });
  const daemon = await startRealmDaemon({ stateDir: join(base, "realm"), workspace: join(base, "ws"), mode });
  started.push(daemon);
  return { base, daemon };
}

async function failureCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error: unknown) {
    assert.ok(error instanceof RealmError);
    return error.code;
  }
  assert.fail("expected a RealmError");
}

void test("HARN-02: status is active through the real client, then down removes the socket", async (t) => {
  const { base, daemon } = await startFixture(t, "advisory");
  assert.equal(existsSync(daemon.socketPath), true);
  const client = connectDaemon(daemon.socketPath);
  const up = await client.up(join(base, "ws"));
  assert.equal(up.snapshot.state, "active");
  const status = await client.status();
  assert.equal(status.snapshot.state, "active");
  assert.equal((await daemon.status()).error, undefined);

  await daemon.down();
  await daemon.done;
  assert.equal(existsSync(daemon.socketPath), false);
  // What the plugin sees once the realm is down: the peer is absent, REALM_NOT_ACTIVE.
  assert.equal(await failureCode(client.status()), "REALM_NOT_ACTIVE");
});

for (const mode of ["advisory", "fail-closed"] as const) {
  void test(`HARN-02: the policy.json mode ${mode} is reported by the status reply`, async (t) => {
    const { daemon } = await startFixture(t, mode);
    assert.equal((JSON.parse(readFileSync(daemon.policyPath, "utf8")) as { mode: string }).mode, mode);
    const client = connectDaemon(daemon.socketPath);
    assert.equal((await client.status()).mode, mode);
  });
}

void test("HARN-02: the scripted control server serves each scripted state", async (t) => {
  const base = makeBase();
  const servers: ScriptedControlServer[] = [];
  t.after(async () => {
    for (const opened of servers) await opened.close();
    rmSync(base, { recursive: true, force: true });
  });
  const snapshotFor = (state: State, reason: string): unknown => {
    const snapshot = { state, reason, lastTransitionAt: AT };
    return { snapshot, display: displayStatus(snapshot), mode: "fail-closed" };
  };
  let current: () => ScriptedReply = () => ({ kind: "hang" });
  const server = await startScriptedControlServer(join(base, "c.sock"), () => current());
  servers.push(server);
  const client = connectDaemon(server.socketPath);

  current = () => ({ kind: "reply", result: snapshotFor("connecting", "connecting") });
  const connecting = await client.status();
  assert.equal(connecting.snapshot.state, "connecting");
  assert.equal(connecting.mode, "fail-closed");

  current = () => ({ kind: "reply", result: snapshotFor("active", "realm active"), delayMs: 20 });
  assert.equal((await client.status()).snapshot.state, "active");

  current = () => ({ kind: "reply", error: { code: "POLICY_DENIED" } });
  assert.equal(await failureCode(client.status()), "POLICY_DENIED");

  current = () => ({ kind: "reply", result: { nonsense: true } });
  assert.equal(await failureCode(client.status()), "SCHEMA_INVALID");

  current = () => ({ kind: "raw", line: "not json\n" });
  assert.equal(await failureCode(client.status()), "SCHEMA_INVALID");

  current = () => ({
    kind: "reply",
    result: { outcome: "done", tool: "write", value: { path: "a.txt" } },
  });
  const outcome = await client.call({ tool: "write", path: "a.txt", content: "x" });
  assert.equal(outcome.outcome, "done");

  assert.deepEqual(server.requests, ["status", "status", "status", "status", "status", "tool"]);
});
