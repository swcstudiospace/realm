import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { createOpenShellAgentOsDriver, type OpenShellAgentOsDriverOptions } from "../../src/runtime/agentos-driver.js";
import { OPENSHELL_BINARY, type OpenShellRunner } from "../../src/runtime/openshell.js";

const IMAGE = `localhost/realm-agentos@sha256:${"a".repeat(64)}`;
const POLICY = "/realm-state/agentos/policy.json";
const RUNNER = "/usr/local/lib/realm/agentos-runner.js";
const PROBE = "/usr/local/lib/realm/agentos-probe.js";
const TIMEOUT_MS = 2500;

interface Recorded {
  readonly argv: readonly string[];
  readonly timeoutMs: number;
}

type Scripted = { readonly exitCode: number } | { readonly reject: Error };

// A runner that records every call and answers from a script, in order. Running past the script is a
// test failure, never a silent success.
function scriptedRunner(script: readonly Scripted[]): { readonly runner: OpenShellRunner; readonly calls: Recorded[] } {
  const calls: Recorded[] = [];
  const queue = [...script];
  const runner: OpenShellRunner = (argv, options) => {
    calls.push({ argv, timeoutMs: options.timeoutMs });
    const next = queue.shift();
    if (next === undefined) {
      return Promise.reject(new Error("the runner received more calls than the test scripted"));
    }
    if ("reject" in next) {
      return Promise.reject(next.reject);
    }
    return Promise.resolve({ exitCode: next.exitCode });
  };
  return { runner, calls };
}

function optionsWith(
  runner: OpenShellRunner,
  overrides: Partial<OpenShellAgentOsDriverOptions> = {},
): OpenShellAgentOsDriverOptions {
  return {
    runner,
    imageRef: IMAGE,
    policyPath: POLICY,
    cpus: 2,
    memory: "4Gi",
    runnerPath: RUNNER,
    probePath: PROBE,
    startTimeoutMs: TIMEOUT_MS,
    callTimeoutMs: TIMEOUT_MS,
    ...overrides,
  };
}

function callAt(calls: readonly Recorded[], index: number): Recorded {
  const call = calls[index];
  assert.ok(call !== undefined, `expected runner call ${String(index)}`);
  return call;
}

async function assertCode(work: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RealmError && error.code === code);
}

function refusedWith(code: ErrorCode): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

void test("start creates the sandbox with the derived image through --from and the runner as workload", async () => {
  const { runner, calls } = scriptedRunner([{ exitCode: 0 }]);
  await createOpenShellAgentOsDriver(optionsWith(runner)).start();
  const argv = callAt(calls, 0).argv;
  assert.equal(argv[argv.indexOf("--name") + 1], "realm-agentos");
  assert.equal(argv[argv.indexOf("--from") + 1], IMAGE);
  assert.deepEqual(argv.slice(argv.indexOf("--") + 1), ["node", RUNNER]);
});

void test("start rejects with OPENSHELL_START_FAILED when the create exits non-zero", async () => {
  const { runner } = scriptedRunner([{ exitCode: 1 }]);
  await assertCode(createOpenShellAgentOsDriver(optionsWith(runner)).start(), "OPENSHELL_START_FAILED");
});

void test("start propagates a runner rejection unchanged", async () => {
  const boom = new Error("spawn failed");
  const { runner } = scriptedRunner([{ reject: boom }]);
  await assert.rejects(createOpenShellAgentOsDriver(optionsWith(runner)).start(), (error: unknown) => error === boom);
});

void test("alive is true when the probe exits 0, running the probe through the pinned exec form", async () => {
  const { runner, calls } = scriptedRunner([{ exitCode: 0 }]);
  assert.equal(await createOpenShellAgentOsDriver(optionsWith(runner)).alive(), true);
  assert.deepEqual(callAt(calls, 0).argv.slice(-2), ["node", PROBE]);
});

void test("alive is false when the probe exits non-zero, which is an answer and not a failure", async () => {
  const { runner } = scriptedRunner([{ exitCode: 1 }]);
  assert.equal(await createOpenShellAgentOsDriver(optionsWith(runner)).alive(), false);
});

void test("alive propagates a runner rejection unchanged", async () => {
  const boom = new Error("timed out");
  const { runner } = scriptedRunner([{ reject: boom }]);
  await assert.rejects(createOpenShellAgentOsDriver(optionsWith(runner)).alive(), (error: unknown) => error === boom);
});

void test("stop deletes the named sandbox and resolves on exit 0", async () => {
  const { runner, calls } = scriptedRunner([{ exitCode: 0 }]);
  await createOpenShellAgentOsDriver(optionsWith(runner)).stop();
  assert.deepEqual(callAt(calls, 0).argv, [OPENSHELL_BINARY, "sandbox", "delete", "realm-agentos"]);
});

void test("stop rejects with AGENTOS_STOP_FAILED when the delete exits non-zero", async () => {
  const { runner } = scriptedRunner([{ exitCode: 1 }]);
  await assertCode(createOpenShellAgentOsDriver(optionsWith(runner)).stop(), "AGENTOS_STOP_FAILED");
});

void test("every runner call is bounded by the configured call timeout", async () => {
  const { runner, calls } = scriptedRunner([{ exitCode: 0 }, { exitCode: 0 }, { exitCode: 0 }]);
  const driver = createOpenShellAgentOsDriver(optionsWith(runner));
  await driver.start();
  await driver.alive();
  await driver.stop();
  assert.deepEqual(
    calls.map((call) => call.timeoutMs),
    [TIMEOUT_MS, TIMEOUT_MS, TIMEOUT_MS],
  );
});

void test("an empty image reference is refused at construction with SCHEMA_INVALID", () => {
  const { runner } = scriptedRunner([]);
  assert.throws(() => createOpenShellAgentOsDriver(optionsWith(runner, { imageRef: "" })), refusedWith("SCHEMA_INVALID"));
});

void test("a sandbox name outside the realm- prefix is refused with SCHEMA_INVALID", () => {
  const { runner } = scriptedRunner([]);
  assert.throws(
    () => createOpenShellAgentOsDriver(optionsWith(runner, { sandboxName: "agentos" })),
    refusedWith("SCHEMA_INVALID"),
  );
});

void test("a non-positive or non-finite call timeout is refused with RangeError", () => {
  const { runner } = scriptedRunner([]);
  for (const callTimeoutMs of [0, -1, Number.POSITIVE_INFINITY, Number.NaN]) {
    assert.throws(() => createOpenShellAgentOsDriver(optionsWith(runner, { callTimeoutMs })), RangeError);
  }
});

void test("the create argv carries no privileged flag, no mount, and no host socket", async () => {
  const { runner, calls } = scriptedRunner([{ exitCode: 0 }]);
  await createOpenShellAgentOsDriver(optionsWith(runner)).start();
  const argv = callAt(calls, 0).argv;
  for (const forbidden of ["--privileged", "--cap-add", "-v", "--volume", "--mount"]) {
    assert.equal(argv.includes(forbidden), false, `the create argv must not carry ${forbidden}`);
  }
  assert.equal(
    argv.some((token) => token.includes("podman.sock") || token.includes("docker.sock")),
    false,
  );
});
