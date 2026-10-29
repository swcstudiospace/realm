import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManualClock, pollUntil, scaledMs } from "../support/timing.js";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import {
  DEFAULT_INFO_TIMEOUT_MS,
  DEFAULT_INFO_TTL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  FORCE_REMOVE_STOP_GRACE_SECONDS,
  LibpodClient,
} from "../../src/runtime/libpod-client.js";
import { LIBPOD_ROUTES, type LibpodRouteName } from "../../src/runtime/libpod-routes.js";
import { FakeLibpod, type FakeLibpodOptions, type RecordedRequest } from "../support/fake-libpod.js";

const LABEL_KEY = "openshell.managed";

async function startFake(
  t: TestContext,
  options: FakeLibpodOptions = {},
): Promise<{ readonly fake: FakeLibpod; readonly socketPath: string }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-libpod-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const socketPath = join(dir, "podman.sock");
  const fake = new FakeLibpod(options);
  await fake.start(socketPath);
  t.after(() => fake.stop());
  return { fake, socketPath };
}

async function assertCode(work: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RealmError && error.code === code);
}

// FakeLibpod records a request only after it parses it, and it offers no change notification. The wait
// therefore re-reads the recorded log every 5 ms until the route appears, and fails at its deadline.
async function waitForRecorded(fake: FakeLibpod, route: LibpodRouteName, timeoutMs: number): Promise<RecordedRequest> {
  const find = (): RecordedRequest | undefined =>
    fake
      .requests()
      .filter((request) => request.route === route)
      .at(-1);
  await pollUntil(() => find() !== undefined, `fake libpod to record a ${route} request`, { timeoutMs });
  const last = find();
  if (last === undefined) {
    throw new Error(`fake libpod did not record a ${route} request`);
  }
  return last;
}

void test("RT-03: the client exposes exactly the seven D-54 methods, and no other instance member", () => {
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
  const client = new LibpodClient("/run/user/1000/podman/podman.sock");
  assert.deepEqual(
    Object.getOwnPropertyNames(client),
    ["transport", "seccompProfilePath", "infoTtlMs", "infoCache"],
    "the instance holds only its transport, its seccomp profile path and its info cache (data fields, no function members)",
  );
  for (const name of Object.getOwnPropertyNames(client)) {
    assert.notEqual(typeof Reflect.get(client, name), "function", `instance member ${name} must not be a function`);
  }
  for (const name of methods) {
    assert.equal(typeof Reflect.get(LibpodClient.prototype, name), "function", `${name} must be a prototype method`);
  }
});

void test("RT-03: the route table has no attach route and no exec route, and the only start route is the container start", () => {
  const routes = Object.values(LIBPOD_ROUTES);
  assert.equal(
    routes.some((route) => /attach/i.test(route.path)),
    false,
  );
  assert.equal(
    routes.some((route) => /exec/i.test(route.path)),
    false,
    "no route starts a process inside a container",
  );
  for (const route of routes) {
    if (/start/i.test(route.path)) {
      assert.equal(route.path, "/libpod/containers/{id}/start");
    }
  }
});

void test("RT-09: list, inspect, stop, and remove round-trip against the fake socket server", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const store = fake.store;
  store.add({ id: "realm-a", labels: { [LABEL_KEY]: "true", "openshell.ai/sandbox-name": "realm-a" }, running: true });
  store.add({ id: "realm-b", labels: { [LABEL_KEY]: "true", "openshell.ai/sandbox-name": "realm-b" }, running: false });
  store.add({ id: "foreign", labels: { owner: "someone-else" }, running: true });
  const client = new LibpodClient(socketPath);

  const listed = await client.listContainersByLabel(LABEL_KEY, "true");
  assert.deepEqual(listed.map((entry) => entry.id).sort(), ["realm-a", "realm-b"]);

  const inspect = await client.inspectContainer("realm-a");
  assert.ok(inspect !== null);
  assert.equal((inspect["State"] as { readonly Status?: unknown } | undefined)?.Status, "running");

  await client.stopContainer("realm-a", 1000);
  const stopped = await client.inspectContainer("realm-a");
  assert.equal((stopped?.["State"] as { readonly Status?: unknown } | undefined)?.Status, "exited");

  await client.removeContainer("realm-a", { force: false });
  assert.equal(await client.inspectContainer("realm-a"), null, "an inspect of a removed container is null");
  const remaining = await client.listContainersByLabel(LABEL_KEY, "true");
  assert.deepEqual(remaining.map((entry) => entry.id), ["realm-b"]);
});

void test("RT-09: removeContainer treats a 404 as success and forwards the force flag", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const client = new LibpodClient(socketPath);
  await client.removeContainer("never-created", { force: true });
  const removal = fake.requests().find((request) => request.route === "removeContainer");
  assert.ok(removal !== undefined);
  assert.equal(removal.method, "DELETE");
  const [path, search] = removal.target.split("?");
  assert.match(path ?? "", /\/libpod\/containers\/never-created$/);
  assert.equal(new URLSearchParams(search).get("force"), "true");
});

void test("RT-08: a force removal sends the short stop grace as the timeout query, and nothing else beyond force", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.store.add({ id: "realm-x", labels: {}, running: true });
  await new LibpodClient(socketPath).removeContainer("realm-x", { force: true });
  const removal = fake.requests().find((request) => request.route === "removeContainer");
  assert.ok(removal !== undefined);
  assert.equal(removal.target.split("?")[1], "force=true&timeout=2", "the exact query of a force removal");
  assert.equal(FORCE_REMOVE_STOP_GRACE_SECONDS, 2);
});

void test("RT-08: a non-force removal sends no timeout query", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.store.add({ id: "realm-x", labels: {}, running: false });
  await new LibpodClient(socketPath).removeContainer("realm-x", { force: false });
  const removal = fake.requests().find((request) => request.route === "removeContainer");
  assert.ok(removal !== undefined);
  assert.equal(removal.target.split("?")[1], "force=false", "the exact query of a non-force removal");
});

void test("RT-08: a force removal whose reply comes after the request bound but within the stop grace succeeds", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.store.add({ id: "realm-x", labels: {}, running: true });
  // The request bound is 1000 ms and the force bound is 3000 ms (the bound plus the 2 s grace). The 1500 ms reply is past
  // the first and well inside the second.
  fake.setDelay("removeContainer", 1500);
  const client = new LibpodClient(socketPath, { requestTimeoutMs: 1000 });
  await client.removeContainer("realm-x", { force: true });
  assert.equal(fake.store.get("realm-x"), undefined, "the container is removed");
});

void test("RT-08: a non-force removal keeps the plain request bound, so the same late reply fails it", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.store.add({ id: "realm-x", labels: {}, running: false });
  fake.setDelay("removeContainer", 1500);
  const client = new LibpodClient(socketPath, { requestTimeoutMs: 1000 });
  await assertCode(client.removeContainer("realm-x", { force: false }), "PODMAN_MACHINE_DOWN");
});

void test("RT-08: a force removal whose reply never comes fails with PODMAN_MACHINE_DOWN only after the extended bound", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.store.add({ id: "realm-x", labels: {}, running: true });
  fake.hangNext("removeContainer");
  // The extended bound is 3000 ms. A client that kept the plain 1000 ms bound would fail near 1000 ms, so the floor sits at
  // 2500 ms.
  const client = new LibpodClient(socketPath, { requestTimeoutMs: 1000 });
  const started = Date.now();
  await assertCode(client.removeContainer("realm-x", { force: true }), "PODMAN_MACHINE_DOWN");
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 2500, `the force removal failed after ${String(elapsed)} ms, not clearly past the 1000 ms request bound`);
  const hung = await waitForRecorded(fake, "removeContainer", 5000);
  await fake.waitForSocketClose(hung.seq, scaledMs(2000));
});

void test("RT-09: list asks for all containers filtered by the exact label pair", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const client = new LibpodClient(socketPath);
  await client.listContainersByLabel(LABEL_KEY, "true");
  const listing = fake.requests().find((request) => request.route === "listContainers");
  assert.ok(listing !== undefined);
  const query = new URLSearchParams(listing.target.split("?")[1] ?? "");
  assert.equal(query.get("all"), "true", "stopped containers must be visible to the sweep");
  assert.deepEqual(JSON.parse(query.get("filters") ?? "null"), { label: [`${LABEL_KEY}=true`] });
});

void test("RT-09: a timed-out request rejects with PODMAN_MACHINE_DOWN and destroys its socket", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.hangNext("inspectContainer");
  // The timeout only creates the hung request. 1000 ms keeps it clear of scheduling stalls under load.
  const client = new LibpodClient(socketPath, { requestTimeoutMs: 1000 });
  await assertCode(client.inspectContainer("realm-a"), "PODMAN_MACHINE_DOWN");
  const hung = await waitForRecorded(fake, "inspectContainer", 5000);
  await fake.waitForSocketClose(hung.seq, scaledMs(2000));
});

// Waits until the fake has recorded `count` requests of the route. The loop yields on setImmediate, which the mocked setTimeout
// leaves alone (pollUntil sleeps on setTimeout, so it cannot run under the mock), and a real-clock deadline (Date.now is not
// mocked) makes a request that never arrives fail the test instead of spinning. The fake logs a request and schedules its
// delayed reply in one synchronous step, so once the request is recorded its reply timer is registered.
async function recordedCount(fake: FakeLibpod, route: LibpodRouteName, count: number): Promise<void> {
  const limit = Date.now() + scaledMs(10_000);
  while (fake.requests().filter((request) => request.route === route).length < count) {
    if (Date.now() >= limit) {
      throw new Error(`fake libpod did not record ${String(count)} ${route} request(s)`);
    }
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

void test("RT-09: info has its own bound; every other route keeps the request bound", async (t) => {
  const { fake, socketPath } = await startFake(t);
  // Every bound and every delayed reply is a timer on node's mocked setTimeout, so the test decides when each fires and no
  // real time passes: the API-version ping and the loopback I/O cannot trip a bound on a loaded host. The fake delay
  // (3000 ms) exceeds the request bound (1000 ms) and stays below the info bound (8000 ms).
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  const client = new LibpodClient(socketPath, { requestTimeoutMs: 1000, infoTimeoutMs: 8000 });
  fake.setDelay("info", 3000);
  fake.setDelay("listContainers", 3000);

  const infoCall = client.info();
  await recordedCount(fake, "info", 1);
  // The reply timer (3000 ms) fires; the info bound (8000 ms) has not been reached.
  t.mock.timers.tick(3000);
  const info = await infoCall;
  assert.equal(info.rootless, true);

  const listCall = client.listContainersByLabel(LABEL_KEY, "true");
  const rejected = assertCode(listCall, "PODMAN_MACHINE_DOWN");
  await recordedCount(fake, "listContainers", 1);
  // The request bound (1000 ms) fires before the reply timer (3000 ms) of the same request.
  t.mock.timers.tick(1000);
  await rejected;
});

void test("RT-09: an info reply that never comes fails with PODMAN_MACHINE_DOWN only after the info bound", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.hangNext("info");
  // The ping runs under the request bound (1000 ms) and succeeds. A client that ignored the info bound would fail near
  // 1000 ms, so the floor sits at 1500 ms, well below the 3000 ms info bound.
  const client = new LibpodClient(socketPath, { requestTimeoutMs: 1000, infoTimeoutMs: 3000 });
  const started = Date.now();
  await assertCode(client.info(), "PODMAN_MACHINE_DOWN");
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 1500, `info failed after ${String(elapsed)} ms, not clearly past the 1000 ms request bound`);
  const hung = await waitForRecorded(fake, "info", 5000);
  await fake.waitForSocketClose(hung.seq, scaledMs(2000));
});

void test("RT-09: the default bounds are 5000 ms for requests and 30000 ms for info", () => {
  assert.equal(DEFAULT_REQUEST_TIMEOUT_MS, 5000);
  assert.equal(DEFAULT_INFO_TIMEOUT_MS, 30000);
});

void test("RT-09: an invalid infoTimeoutMs is refused with SCHEMA_INVALID", () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new LibpodClient("/run/user/1000/podman/podman.sock", { infoTimeoutMs: bad }),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
    );
  }
});

function infoRequests(fake: FakeLibpod): number {
  return fake.requests().filter((request) => request.route === "info").length;
}

void test("info cache: the default TTL is 60000 ms, and an invalid infoTtlMs is refused with SCHEMA_INVALID", () => {
  assert.equal(DEFAULT_INFO_TTL_MS, 60000);
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => new LibpodClient("/run/user/1000/podman/podman.sock", { infoTtlMs: bad }),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
    );
  }
});

void test("info cache: two sequential calls make one request and return the same value", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const client = new LibpodClient(socketPath);
  const first = await client.info();
  const second = await client.info();
  assert.deepEqual(second, first);
  assert.equal(first.rootless, true);
  assert.equal(infoRequests(fake), 1, "the second call is served from the cache");
});

void test("info cache: concurrent calls share one in-flight request", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const client = new LibpodClient(socketPath);
  fake.setDelay("info", 300);
  const calls = [client.info(), client.info(), client.info()];
  const replies = await Promise.all(calls);
  assert.equal(infoRequests(fake), 1, "three callers, one request");
  assert.deepEqual(replies[1], replies[0]);
  assert.deepEqual(replies[2], replies[0]);
});

void test("info cache: a failure is not cached, and concurrent callers share the failure and then the next call asks again", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const client = new LibpodClient(socketPath);
  fake.respondNext("info", { status: 500 });
  fake.setDelay("info", 200);
  const outcomes = await Promise.allSettled([client.info(), client.info()]);
  for (const outcome of outcomes) {
    const reason: unknown = outcome.status === "rejected" ? outcome.reason : undefined;
    assert.ok(reason instanceof RealmError && reason.code === "SCHEMA_INVALID", `a caller settled as ${outcome.status}`);
  }
  assert.equal(infoRequests(fake), 1, "both callers saw the one failed request");
  const recovered = await client.info();
  assert.equal(recovered.rootless, true);
  assert.equal(infoRequests(fake), 2, "the failure was not kept, so the next call made a new request");
  await client.info();
  assert.equal(infoRequests(fake), 2, "the success is kept");
});

void test("info cache: after the TTL a new request is made", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const clock = new ManualClock();
  const client = new LibpodClient(socketPath, { infoTtlMs: 400, now: clock.now });
  await client.info();
  clock.advance(399);
  await client.info();
  assert.equal(infoRequests(fake), 1, "a call inside the TTL is served from the cache");
  clock.advance(1);
  await client.info();
  assert.equal(infoRequests(fake), 2, "a call after the TTL asks again");
});

void test("RT-09: a socket that does not exist gives PODMAN_MACHINE_DOWN, not a raw transport error", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-libpod-absent-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const client = new LibpodClient(join(dir, "missing.sock"));
  await assertCode(client.info(), "PODMAN_MACHINE_DOWN");
});

void test("RT-03: a malformed or unexpected response gives SCHEMA_INVALID and never a raw throw", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const client = new LibpodClient(socketPath);

  fake.respondNext("info", { status: 200, body: "this is not json" });
  await assertCode(client.info(), "SCHEMA_INVALID");

  fake.respondNext("listContainers", { status: 500, body: '{"message":"internal detail"}' });
  await assertCode(client.listContainersByLabel(LABEL_KEY, "true"), "SCHEMA_INVALID");

  fake.respondNext("listContainers", { status: 200, body: '[{"Names":["no-id"]}]' });
  await assertCode(client.listContainersByLabel(LABEL_KEY, "true"), "SCHEMA_INVALID");
});

void test("RT-03: info fails closed when the rootless field is missing", async (t) => {
  const { fake, socketPath } = await startFake(t, { version: "5.2.0" });
  const client = new LibpodClient(socketPath);
  const info = await client.info();
  assert.deepEqual(info, { rootless: true, version: "5.2.0" });

  // A second client has no cached reply, so it asks the engine again and sees the malformed one.
  fake.respondNext("info", { status: 200, body: '{"version":{"Version":"5.2.0"}}' });
  await assertCode(new LibpodClient(socketPath).info(), "SCHEMA_INVALID");
});

void test("RT-03: stopContainer accepts only the documented success statuses and rejects anything else", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.store.add({ id: "realm-x", labels: {}, running: true });
  const client = new LibpodClient(socketPath);
  fake.respondNext("stopContainer", { status: 404 });
  await assertCode(client.stopContainer("realm-x", 1000), "SCHEMA_INVALID");
});

void test("RT-03: a container id outside the safe pattern is rejected before any socket request", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const client = new LibpodClient(socketPath);
  for (const id of ["", "../escape", "a/b", "c?all=true", "-leading", "x".repeat(200)]) {
    await assertCode(client.inspectContainer(id), "SCHEMA_INVALID");
    await assertCode(client.removeContainer(id, { force: true }), "SCHEMA_INVALID");
  }
  assert.equal(fake.requests().length, 0, "no malformed id may reach the socket");
});

void test("RT-03: a list label key containing '=' or an empty key is rejected before any socket request", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const client = new LibpodClient(socketPath);
  await assertCode(client.listContainersByLabel("a=b", "true"), "SCHEMA_INVALID");
  await assertCode(client.listContainersByLabel("", "true"), "SCHEMA_INVALID");
  assert.equal(fake.requests().length, 0);
});

void test("RT-03: the client refuses a socket path that is not absolute", () => {
  assert.throws(
    () => new LibpodClient("podman.sock"),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
});

void test("RT-09: removeContainer succeeds on the 200 reply Podman 5.7.1 sends, which carries the removed id", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.store.add({ id: "realm-x", labels: {}, running: true });
  await new LibpodClient(socketPath).removeContainer("realm-x", { force: true });
  assert.equal(fake.store.get("realm-x"), undefined, "the container is removed");
  assert.equal(
    fake.requests().filter((request) => request.route === "removeContainer").length,
    1,
    "one delete request reached the fake",
  );
});
