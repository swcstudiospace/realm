import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import {
  buildAgentOsSandboxArgv,
  buildCreateArgv,
  buildSandboxDeleteArgv,
  OPENSHELL_BINARY,
  realmSandboxName,
  type AgentOsSandboxRequest,
} from "../../src/runtime/openshell.js";

const POLICY = "/state/runtime/daemon.policy.json";
const IMAGE = `localhost/realm-agentos@sha256:${"b".repeat(64)}`;
const REQUEST: AgentOsSandboxRequest = {
  sessionId: "daemon",
  runnerPath: "/usr/local/lib/realm/agentos-runner.js",
  probePath: "/usr/local/lib/realm/agentos-probe.js",
};

function refusedWith(code: ErrorCode): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

void test("the session create argv names realm-<sessionId>, carries the image through --from, and has no command", () => {
  const create = buildCreateArgv({ sessionId: "daemon", policyPath: POLICY, cpus: 2, memory: "4Gi", imageRef: IMAGE });
  assert.equal(create[create.indexOf("--name") + 1], "realm-daemon");
  assert.equal(create[create.indexOf("--from") + 1], IMAGE);
  assert.equal(create.includes("--"), false);
});

void test("the runner argv is the pinned exec form that runs the runner in the session's sandbox", () => {
  const { runner } = buildAgentOsSandboxArgv(REQUEST);
  assert.deepEqual(runner, [
    OPENSHELL_BINARY,
    "sandbox",
    "exec",
    "--name",
    "realm-daemon",
    "--workdir",
    "/workspace",
    "--no-tty",
    "--no-login-shell",
    "--",
    "node",
    REQUEST.runnerPath,
  ]);
});

void test("the probe argv names the session's sandbox, and the delete argv names the same sandbox", () => {
  const { probe } = buildAgentOsSandboxArgv(REQUEST);
  assert.equal(probe[probe.indexOf("--name") + 1], "realm-daemon");
  assert.deepEqual(buildSandboxDeleteArgv(realmSandboxName(REQUEST.sessionId)), [
    OPENSHELL_BINARY,
    "sandbox",
    "delete",
    "realm-daemon",
  ]);
});

void test("a session id outside the safe set is refused with SCHEMA_INVALID by the AgentOS argv builder", () => {
  assert.throws(() => buildAgentOsSandboxArgv({ ...REQUEST, sessionId: "../escape" }), refusedWith("SCHEMA_INVALID"));
});

void test("an empty image reference is refused with SCHEMA_INVALID by the create builder", () => {
  assert.throws(
    () => buildCreateArgv({ sessionId: "daemon", policyPath: POLICY, cpus: 2, memory: "4Gi", imageRef: "" }),
    refusedWith("SCHEMA_INVALID"),
  );
});
