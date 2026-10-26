import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentOsSupervisor } from "../../src/runtime/agentos.js";
import { HARDENING_PROFILE } from "../../src/runtime/hardening.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
import { buildExecArgv, OPENSHELL_BINARY, realmSandboxName } from "../../src/runtime/openshell.js";
import { SessionExecution } from "../../src/runtime/session-execution.js";
import { FakeAgentOsDriver } from "../support/fake-agentos.js";
import { FakeContainerStore, FakeLibpod } from "../support/fake-libpod.js";
import { FakeOpenShell } from "../support/fake-openshell.js";
import {
  makeHarness,
  SESSION as DISPATCH_SESSION,
  WORKLOAD as DISPATCH_WORKLOAD,
} from "../support/fake-tools.js";

// Structural no-bypass proof (D-46, RT-03) with the dispatcher routing half (D-99, TOOL-03).
// These tests read the call logs of the fakes and the method sets of the clients. They touch
// no live process, socket, or container.

const DIGEST = `sha256:${"b".repeat(64)}`;
const IMAGE = `registry.example.com/realm/session@${DIGEST}`;
const SESSION = "sess-route";
const LIBPOD_ROUTE_NAMES: readonly string[] = [
  "info",
  "listContainers",
  "inspectContainer",
  "createContainer",
  "startContainer",
  "stopContainer",
  "removeContainer",
];

interface Fixture {
  readonly libpod: FakeLibpod;
  readonly store: FakeContainerStore;
  readonly openshell: FakeOpenShell;
  readonly driver: FakeAgentOsDriver;
  readonly exec: SessionExecution;
  readonly supervisor: AgentOsSupervisor;
  readonly stateDir: string;
  readonly workspaceRoot: string;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-routing-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const socketPath = join(base, "podman.sock");
  const store = new FakeContainerStore();
  const libpod = new FakeLibpod({ store });
  await libpod.start(socketPath);
  t.after(() => libpod.stop());
  const openshell = new FakeOpenShell(store);
  const driver = new FakeAgentOsDriver(openshell.runner);
  const agentos = new AgentOsSupervisor({
    driver,
    sessionId: SESSION,
    callTimeoutMs: 1000,
    random: () => 0,
    sleep: () => Promise.resolve(),
    now: () => 0,
  });
  const stateDir = join(base, "state");
  const exec = new SessionExecution({
    libpod: new LibpodClient(socketPath),
    runner: openshell.runner,
    agentosFor: () => agentos,
    readProcStatus: () => "CapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\n",
    config: { image: IMAGE, stateDir },
    egressAllow: [],
  });
  return { libpod, store, openshell, driver, supervisor: agentos, exec, stateDir, workspaceRoot: join(base, "workspace") };
}

// Creates the session. The create-time verification reads one inspect, so a conforming one is scripted.
async function createSession(f: Fixture): Promise<{ readonly containerId: string }> {
  const inspect = {
    ImageDigest: DIGEST,
    State: { Running: true, Status: "running", Pid: 4242 },
    HostConfig: {
      Privileged: false,
      CapAdd: [],
      SecurityOpt: ["no-new-privileges"],
      ReadonlyRootfs: true,
      Tmpfs: { "/tmp": "rw", "/run": "rw" },
      PidsLimit: HARDENING_PROFILE.pidsLimit,
      Memory: HARDENING_PROFILE.memoryBytes,
      NanoCpus: HARDENING_PROFILE.nanoCpus,
      NetworkMode: HARDENING_PROFILE.networkMode,
    },
    Mounts: [
      { Type: "bind", Source: f.workspaceRoot, Destination: "/workspace", RW: true },
      { Type: "bind", Source: f.stateDir, Destination: "/realm-state", RW: false },
    ],
  };
  f.libpod.respondNext("inspectContainer", { status: 200, body: JSON.stringify(inspect) });
  return f.exec.create({ idempotencyKey: SESSION, workspaceRoot: f.workspaceRoot });
}

void test("RT-03: the session create argv names no workload command, and the OpenShell runs are the create and one sandbox delete", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.start(containerId, realmSandboxName(SESSION));
  await f.exec.probe(containerId, realmSandboxName(SESSION));
  await f.exec.stop(containerId, realmSandboxName(SESSION));
  await f.exec.destroy(containerId, realmSandboxName(SESSION));

  const calls = f.openshell.calls();
  // stop deletes the session sandbox once (B2); destroy after it finds that delete done and runs no second one.
  assert.deepEqual(calls.map((call) => call.argv[2]), ["create", "delete"], "one create, then exactly one sandbox delete");
  const argv = calls[0]?.argv ?? [];
  assert.deepEqual(argv.slice(0, 3), ["openshell", "sandbox", "create"]);
  assert.equal(argv.includes("--"), false, "the create argv names no command");
  assert.deepEqual(calls[1]?.argv, [OPENSHELL_BINARY, "sandbox", "delete", realmSandboxName(SESSION)]);
});

void test("RT-03: the libpod client has no exec or attach method, and only container create and start among start methods", async (t) => {
  const f = await fixture(t);
  const methods = Object.getOwnPropertyNames(LibpodClient.prototype)
    .filter((name) => name !== "constructor")
    .sort();
  assert.deepEqual(methods, [
    "createContainer",
    "info",
    "inspectContainer",
    "listContainersByLabel",
    "removeContainer",
    "startContainer",
    "stopContainer",
  ]);
  assert.deepEqual(methods.filter((name) => /exec/i.test(name)), [], "the libpod client has no exec method");
  for (const name of methods) {
    assert.equal(/attach/i.test(name), false, `method ${name} must not join a process`);
    assert.equal(/start/i.test(name) && name !== "startContainer", false, `method ${name} is a start other than container start`);
  }

  const { containerId } = await createSession(f);
  await f.exec.start(containerId, realmSandboxName(SESSION));
  await f.exec.probe(containerId, realmSandboxName(SESSION));
  await f.exec.stop(containerId, realmSandboxName(SESSION));
  await f.exec.destroy(containerId, realmSandboxName(SESSION));
  // The version probe on /_ping is the one request outside the route table. It is a read that starts nothing,
  // so it is exempt from the route check and must be a GET. Every other request must still match a route.
  const requests = f.libpod.requests();
  for (const probe of requests.filter((recorded) => recorded.target === "/_ping")) {
    assert.equal(probe.method, "GET", "the version probe is a read");
  }
  for (const request of requests.filter((recorded) => recorded.target !== "/_ping")) {
    assert.notEqual(request.route, null, `request ${request.target} must match a known route`);
    assert.ok(LIBPOD_ROUTE_NAMES.includes(String(request.route)), `route ${String(request.route)} must be a known libpod route`);
    assert.equal(/exec|attach/.test(request.target), false, `request ${request.target} starts or joins a process`);
    assert.equal(
      /\/start/.test(request.target) && !/^\/v[\d.]+\/libpod\/containers\/[^/]+\/start$/.test(request.target),
      false,
      `request ${request.target} is a start other than container start`,
    );
  }
});

void test("RT-03, RT-04: AgentOS is started only through the supervisor, and the driver is reachable from no other session path", async (t) => {
  const f = await fixture(t);
  const { containerId } = await createSession(f);
  await f.exec.start(containerId, realmSandboxName(SESSION));
  assert.deepEqual(f.driver.calls(), ["create", "start"], "the driver is called only by the supervisor: create, then start");
  assert.equal(
    reachesWithout(f.exec, f.driver, f.supervisor),
    false,
    "the session service reaches the driver only through the supervisor",
  );
  assert.equal(reachesWithout(f.supervisor, f.driver), true, "the supervisor holds the driver it starts AgentOS with");
});

// True when target is reachable from root through own properties, never entering barrier. The walk covers
// the whole object graph, so a driver held several levels below root is found too.
function reachesWithout(root: object, target: object, barrier?: object): boolean {
  const seen = new Set<object>();
  const pending: object[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node === target) {
      return true;
    }
    if (seen.has(node) || node === barrier) {
      continue;
    }
    seen.add(node);
    for (const key of Reflect.ownKeys(node)) {
      const value: unknown = Reflect.get(node, key);
      if ((typeof value === "object" && value !== null) || typeof value === "function") {
        pending.push(value);
      }
    }
  }
  return false;
}

void test("TOOL-03: every exec routes through the shared dispatcher and reaches the runner with the pinned exec argv (D-99)", async (t) => {
  const h = makeHarness(t);
  const outcome = await h.dispatcher.call({ exec: { argv: [...DISPATCH_WORKLOAD] } });
  assert.equal(outcome.outcome, "done");
  assert.equal(h.runs.length, 1, "the dispatcher ran the workload once, through the runner");
  assert.deepEqual(h.runs[0]?.argv, [...buildExecArgv(DISPATCH_SESSION, DISPATCH_WORKLOAD)]);
  assert.equal(h.runs[0].options.captureOutput, true);
});

void test("TOOL-03: every file write routes through the dispatcher stages, landing on disk with admission and result audit lines (D-99)", async (t) => {
  const h = makeHarness(t);
  const outcome = await h.dispatcher.call({ write: { path: "doc.txt", content: "routed" } });
  assert.equal(outcome.outcome, "done");
  assert.equal(h.doc(), "routed", "the write landed on disk through the dispatcher");
  assert.deepEqual(h.phases(), ["admission", "result"]);
  const result = h.auditLines()[1] ?? {};
  assert.equal(typeof result["sha256"], "string", "the result line carries the content sha256");
  assert.equal("content" in result, false, "the audit line never carries content");
});

void test("TOOL-03: the session service exposes no tool-call surface, so every tool call routes through the dispatcher (D-99)", () => {
  const methods = Object.getOwnPropertyNames(SessionExecution.prototype).filter((name) => name !== "constructor");
  for (const name of methods) {
    assert.equal(/call|tool|dispatch|exec/i.test(name), false, `SessionExecution.${name} must not be a tool entry point`);
  }
});
