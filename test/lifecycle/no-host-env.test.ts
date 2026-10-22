import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { appendAudit } from "../../src/audit/log.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { LifecycleController } from "../../src/lifecycle/controller.js";
import { SessionStore } from "../../src/session/store.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { FakeBridge } from "../support/fake-bridge.js";

const SESSION = "session-1";
const CLOCK_TIME = "2026-10-21T09:30:00.000Z";
const SENTINEL_NAME = "REALM_PHASE2_HOST_SENTINEL";
const CREATE_REQUEST_KEYS = ["idempotencyKey", "workspaceRoot"];

function policyFor(workspaceRoots: readonly string[]): Policy {
  return {
    mode: "advisory",
    workspaceRoots,
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs: 10000,
    toolQueueMs: 2000,
  };
}

function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-no-host-env-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  mkdirSync(workspace);
  const stateDir = join(base, "state");
  const store = new SessionStore(stateDir);
  const exec = new FakeExecutionService();
  const bridge = new FakeBridge();
  const controller = new LifecycleController({
    sessionId: SESSION,
    policy: policyFor([workspace]),
    pinnedRoot: bindWorkspaceUnderPolicy([workspace], workspace),
    store,
    exec,
    bridge,
    clock: () => new Date(CLOCK_TIME),
  });
  return { workspace, stateDir, store, exec, controller };
}

test("a sentinel host environment value never reaches the fake, the session record, or any audit line (AUD-02, D-43)", async (t) => {
  const sentinel = `sentinel-${randomUUID()}`;
  const previous = process.env[SENTINEL_NAME];
  process.env[SENTINEL_NAME] = sentinel;
  t.after(() => {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, SENTINEL_NAME);
    } else {
      process.env[SENTINEL_NAME] = previous;
    }
  });
  const { workspace, stateDir, exec, controller } = fixture(t);
  assert.equal(process.env[SENTINEL_NAME], sentinel);

  const recordPath = join(stateDir, "sessions", `${SESSION}.json`);
  const auditPath = join(stateDir, "audit", `${SESSION}.jsonl`);
  const audit = (tool: string): void => {
    appendAudit(stateDir, { sessionId: SESSION, tool, outcome: "ok" });
  };
  const recordTexts: string[] = [];

  await controller.create(workspace);
  audit("create");
  recordTexts.push(readFileSync(recordPath, "utf8"));
  controller.attach("host-a");
  audit("attach");
  controller.detach("host-a");
  audit("detach");
  await controller.probe();
  audit("probe");
  await controller.stop();
  audit("stop");
  recordTexts.push(readFileSync(recordPath, "utf8"));
  await controller.destroy();
  audit("destroy");

  assert.equal(recordTexts.length, 2);
  for (const text of recordTexts) {
    assert.equal(text.includes(sentinel), false);
  }
  assert.equal(JSON.stringify(exec.calls()).includes(sentinel), false);
  assert.equal(JSON.stringify(exec.resources()).includes(sentinel), false);

  const auditLines = readFileSync(auditPath, "utf8").split("\n").filter((line) => line.length > 0);
  assert.equal(auditLines.length, 6);
  assert.equal(readFileSync(auditPath, "utf8").includes(sentinel), false);
});

test("the port request and the fake carry no environment field, by runtime key-set check (AUD-02, F-7)", async (t) => {
  const { workspace, exec, controller } = fixture(t);
  await controller.create(workspace);
  await controller.destroy();

  const creates = exec.calls().filter((call) => call.operation === "create");
  assert.equal(creates.length, 1);
  for (const call of exec.calls()) {
    if (call.request !== undefined) {
      assert.deepEqual(Object.keys(call.request).sort(), CREATE_REQUEST_KEYS);
    }
  }
  assert.deepEqual(
    Object.keys(exec).filter((key) => /env/i.test(key)),
    [],
  );
});
