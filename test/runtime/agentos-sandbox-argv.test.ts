import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import {
  buildAgentOsSandboxArgv,
  buildCreateArgv,
  OPENSHELL_BINARY,
  type AgentOsSandboxRequest,
} from "../../src/runtime/openshell.js";

const REQUEST: AgentOsSandboxRequest = {
  sessionId: "agentos",
  policyPath: "/realm-state/agentos/policy.json",
  cpus: 2,
  memory: "4Gi",
  imageRef: `localhost/realm-agentos@sha256:${"b".repeat(64)}`,
  runnerPath: "/opt/realm/agentos-runner.js",
  probePath: "/opt/realm/agentos-probe.js",
};

function refusedWith(code: ErrorCode): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

void test("the create argv carries the image through --from, before the workload separator", () => {
  const { create } = buildAgentOsSandboxArgv(REQUEST);
  const from = create.indexOf("--from");
  assert.notEqual(from, -1);
  assert.equal(create[from + 1], REQUEST.imageRef);
  assert.ok(from < create.indexOf("--"));
});

void test("the probe and delete argv name the same sandbox as the create argv", () => {
  const argv = buildAgentOsSandboxArgv(REQUEST);
  assert.equal(argv.create[argv.create.indexOf("--name") + 1], "realm-agentos");
  assert.ok(argv.probe.includes("realm-agentos"));
  assert.deepEqual(argv.delete, [OPENSHELL_BINARY, "sandbox", "delete", "realm-agentos"]);
});

void test("a session create argv carries no --from when no image is given", () => {
  const argv = buildCreateArgv({
    sessionId: "agentos",
    policyPath: REQUEST.policyPath,
    cpus: 2,
    memory: "4Gi",
    workloadArgv: ["node", "/app/session.js"],
  });
  assert.equal(argv.includes("--from"), false);
});

void test("an empty image reference is refused with SCHEMA_INVALID by both builders", () => {
  assert.throws(() => buildAgentOsSandboxArgv({ ...REQUEST, imageRef: "" }), refusedWith("SCHEMA_INVALID"));
  assert.throws(
    () =>
      buildCreateArgv({
        sessionId: "agentos",
        policyPath: REQUEST.policyPath,
        cpus: 2,
        memory: "4Gi",
        imageRef: "",
        workloadArgv: ["node", "/x.js"],
      }),
    refusedWith("SCHEMA_INVALID"),
  );
});
