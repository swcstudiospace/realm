import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
import {
  buildCreateArgv,
  buildExecArgv,
  runOpenShellCreate,
  type SandboxCreateRequest,
} from "../../src/runtime/openshell.js";
import { FakeContainerStore, FakeLibpod } from "../support/fake-libpod.js";
import { FakeOpenShell } from "../support/fake-openshell.js";

const OPENSHELL_MANAGED_KEY = "openshell.managed";
const SANDBOX_NAME_KEY = "openshell.ai/sandbox-name";
const SESSION = "sess-01";
const POLICY_PATH = "/state/realm/runtime/sess-01.policy.json";
// Flag-looking elements in the workload must stay after the -- separator.
const WORKLOAD = ["/usr/bin/agent", "--serve", "--env", "--provider"];
const REQUEST: SandboxCreateRequest = {
  sessionId: SESSION,
  policyPath: POLICY_PATH,
  cpus: 2,
  memory: "1Gi",
};

// The flags the pinned 0.1.5 create verb accepts before the separator (S-10, D-55).
const PINNED_FLAGS: readonly string[] = [
  "--name",
  "--policy",
  "--no-auto-providers",
  "--detach",
  "--cpu",
  "--memory",
];

async function startLibpod(t: TestContext, store: FakeContainerStore): Promise<LibpodClient> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-openshell-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const socketPath = join(dir, "podman.sock");
  const fake = new FakeLibpod({ store });
  await fake.start(socketPath);
  t.after(() => fake.stop());
  return new LibpodClient(socketPath);
}

async function assertCode(work: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RealmError && error.code === code);
}

void test("RT-03: the create argv is exactly the pinned 0.1.5 verb sequence, with no command", () => {
  assert.deepEqual(buildCreateArgv(REQUEST), [
    "openshell",
    "sandbox",
    "create",
    "--name",
    `realm-${SESSION}`,
    "--policy",
    POLICY_PATH,
    "--no-auto-providers",
    "--detach",
    "--cpu",
    "2",
    "--memory",
    "1Gi",
  ]);
});

void test("AUD-02: the create argv carries no --env and no --provider element and no prefixed form of either", () => {
  const argv = buildCreateArgv(REQUEST);
  assert.equal(argv.includes("--env"), false);
  assert.equal(argv.includes("--provider"), false);
  assert.equal(
    argv.some((element) => element.startsWith("--env=") || element.startsWith("--provider=")),
    false,
  );
});

void test("RT-03: the create argv carries no command: no separator and no workload element", () => {
  const argv = buildCreateArgv(REQUEST);
  assert.equal(argv.includes("--"), false);
  for (const element of WORKLOAD) {
    assert.equal(argv.includes(element), false, `${element} must not appear in the create argv`);
  }
});

void test("RT-03: every flag of the create argv belongs to the pinned 0.1.5 flag set", () => {
  const argv = buildCreateArgv(REQUEST);
  assert.deepEqual(argv.slice(0, 3), ["openshell", "sandbox", "create"]);
  // No value in the pinned argv starts with "--", so every such element is a flag name.
  for (const element of argv.filter((item) => item.startsWith("--"))) {
    assert.ok(PINNED_FLAGS.includes(element), `unexpected flag in the create argv: ${element}`);
  }
});

void test("RT-03: a session id outside the safe set, a relative policy path, or a bad memory value is refused with SCHEMA_INVALID", async (t) => {
  const bad: readonly SandboxCreateRequest[] = [
    { ...REQUEST, sessionId: "../escape" },
    { ...REQUEST, sessionId: "" },
    { ...REQUEST, policyPath: "runtime/sess-01.policy.json" },
    { ...REQUEST, memory: "--env=FOO" },
    { ...REQUEST, cpus: 0 },
  ];
  const store = new FakeContainerStore();
  const client = await startLibpod(t, store);
  for (const request of bad) {
    const openshell = new FakeOpenShell(store);
    assert.throws(
      () => buildCreateArgv(request),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
    );
    await assertCode(runOpenShellCreate({ containers: client, runner: openshell.runner }, request, 500), "SCHEMA_INVALID");
    assert.equal(openshell.callCount(), 0, "no OpenShell run starts for a refused request");
  }
});

void test("CORE-06: a repeated create for the same session runs the OpenShell runner once and returns the same container", async (t) => {
  const store = new FakeContainerStore();
  const client = await startLibpod(t, store);
  const openshell = new FakeOpenShell(store);
  const deps = { containers: client, runner: openshell.runner };

  const first = await runOpenShellCreate(deps, REQUEST, 2000);
  const second = await runOpenShellCreate(deps, REQUEST, 2000);

  assert.equal(first, second);
  assert.equal(openshell.callCount(), 1, "the labelled container exists, so the second create runs nothing");
  assert.equal(store.list().length, 1);
});

void test("RT-03: the runner receives the exact pinned argv on the first create", async (t) => {
  const store = new FakeContainerStore();
  const client = await startLibpod(t, store);
  const openshell = new FakeOpenShell(store);

  await runOpenShellCreate({ containers: client, runner: openshell.runner }, REQUEST, 2000);

  assert.deepEqual(openshell.calls()[0]?.argv, buildCreateArgv(REQUEST));
});

void test("RT-03: a runner that exits non-zero gives OPENSHELL_START_FAILED after a single run and no container", async (t) => {
  const store = new FakeContainerStore();
  const client = await startLibpod(t, store);
  const openshell = new FakeOpenShell(store);
  openshell.next("exit-1");

  await assertCode(runOpenShellCreate({ containers: client, runner: openshell.runner }, REQUEST, 2000), "OPENSHELL_START_FAILED");
  assert.equal(openshell.callCount(), 1);
  assert.equal(store.list().length, 0);
});

void test("RT-03: a runner that cannot be started gives OPENSHELL_START_FAILED with no raw error text", async (t) => {
  const store = new FakeContainerStore();
  const client = await startLibpod(t, store);
  const openshell = new FakeOpenShell(store);
  openshell.next("reject");

  await assert.rejects(
    runOpenShellCreate({ containers: client, runner: openshell.runner }, REQUEST, 2000),
    (error: unknown) =>
      error instanceof RealmError && error.code === "OPENSHELL_START_FAILED" && !error.message.includes("ENOENT"),
  );
});

void test("RT-03: a runner that reports success but produces no labelled container fails at the caller deadline", async (t) => {
  const store = new FakeContainerStore();
  const client = await startLibpod(t, store);
  const openshell = new FakeOpenShell(store);
  openshell.next("silent");
  const started = Date.now();

  await assertCode(runOpenShellCreate({ containers: client, runner: openshell.runner }, REQUEST, 600), "OPENSHELL_START_FAILED");
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 550, `the poll runs until the deadline (elapsed ${String(elapsed)} ms)`);
  assert.ok(elapsed < 5000, `the poll stops at the deadline (elapsed ${String(elapsed)} ms)`);
});

void test("RT-03: a hung runner is bounded by the caller deadline and gives OPENSHELL_START_FAILED", async (t) => {
  const store = new FakeContainerStore();
  const client = await startLibpod(t, store);
  const openshell = new FakeOpenShell(store);
  openshell.next("hang");

  await assertCode(runOpenShellCreate({ containers: client, runner: openshell.runner }, REQUEST, 300), "OPENSHELL_START_FAILED");
  const handed = openshell.calls()[0]?.timeoutMs;
  assert.ok(handed !== undefined && handed > 0 && handed <= 300, `the runner is told its bound (${String(handed)} ms)`);
});

void test("CORE-06: two labelled containers for one session fail closed with OPENSHELL_LABEL_AMBIGUOUS and no run", async (t) => {
  const store = new FakeContainerStore();
  const labels = { [OPENSHELL_MANAGED_KEY]: "true", [SANDBOX_NAME_KEY]: `realm-${SESSION}`, "openshell.ai/isolation-role": "sandbox" };
  store.add({ id: "fake-a", labels, running: true });
  store.add({ id: "fake-b", labels, running: true });
  const client = await startLibpod(t, store);
  const openshell = new FakeOpenShell(store);

  await assertCode(runOpenShellCreate({ containers: client, runner: openshell.runner }, REQUEST, 2000), "OPENSHELL_LABEL_AMBIGUOUS");
  assert.equal(openshell.callCount(), 0);
});

// The D-80 flags no builder may emit before the -- separator. Each name is pinned by its own assertion.
const FORBIDDEN_FLAGS: readonly string[] = [
  "--driver-config-json",
  "--forward",
  "--expose",
  "--template",
  "--provider",
  "--env",
  "--auto-providers",
];

void test("RT-03, AUD-02: the exec argv is exactly the pinned D-92 form with the workload after --, and it is frozen", () => {
  const argv = buildExecArgv(SESSION, WORKLOAD);
  assert.deepEqual(argv, [
    "openshell",
    "sandbox",
    "exec",
    "--name",
    `realm-${SESSION}`,
    "--workdir",
    "/workspace",
    "--no-tty",
    "--no-login-shell",
    "--",
    ...WORKLOAD,
  ]);
  assert.equal(Object.isFrozen(argv), true);
});

void test("RT-03: the exec argv names the same sandbox that the create argv names", () => {
  const create = buildCreateArgv(REQUEST);
  const exec = buildExecArgv(SESSION, WORKLOAD);
  assert.equal(exec[exec.indexOf("--name") + 1], create[create.indexOf("--name") + 1]);
});

void test("RT-05: neither builder emits any D-80 forbidden flag, as an element or as a prefixed form, before the separator", () => {
  for (const argv of [buildCreateArgv(REQUEST), buildExecArgv(SESSION, WORKLOAD)]) {
    const separator = argv.indexOf("--");
    const head = separator === -1 ? argv : argv.slice(0, separator);
    for (const flag of FORBIDDEN_FLAGS) {
      assert.equal(head.includes(flag), false, `${flag} must not appear before the separator`);
      assert.equal(
        head.some((element) => element.startsWith(`${flag}=`)),
        false,
        `${flag}= must not appear before the separator`,
      );
    }
  }
});

void test("RT-05: a session id outside the safe set, an empty argv, or an empty element is refused by buildExecArgv with SCHEMA_INVALID", () => {
  const refused: readonly (readonly [string, readonly string[]])[] = [
    ["../escape", WORKLOAD],
    ["", WORKLOAD],
    [SESSION, []],
    [SESSION, [""]],
  ];
  for (const [sessionId, argv] of refused) {
    assert.throws(
      () => buildExecArgv(sessionId, argv),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
      `refused exec for session "${sessionId}"`,
    );
  }
});
