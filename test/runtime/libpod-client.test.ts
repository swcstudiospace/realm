import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
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
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const last = fake
      .requests()
      .filter((request) => request.route === route)
      .at(-1);
    if (last !== undefined) {
      return last;
    }
    if (Date.now() >= deadline) {
      throw new Error(`fake libpod did not record a ${route} request within ${String(timeoutMs)} ms`);
    }
    await sleep(5);
  }
}

void test("RT-03: the client exposes exactly the five D-54 methods and no other instance member", () => {
  const methods = Object.getOwnPropertyNames(LibpodClient.prototype)
    .filter((name) => name !== "constructor")
    .sort();
  assert.deepEqual(methods, [
    "info",
    "inspectContainer",
    "listContainersByLabel",
    "removeContainer",
    "stopContainer",
  ]);
  const client = new LibpodClient("/run/user/1000/podman/podman.sock");
  assert.deepEqual(Object.getOwnPropertyNames(client), ["transport"], "the instance holds only its transport");
  for (const name of Object.getOwnPropertyNames(client)) {
    assert.notEqual(typeof Reflect.get(client, name), "function", `instance member ${name} must not be a function`);
  }
  for (const name of methods) {
    assert.equal(typeof Reflect.get(LibpodClient.prototype, name), "function", `${name} must be a prototype method`);
  }
});

void test("RT-03: no exec, attach, or start-exec route appears in the route table", () => {
  for (const route of Object.values(LIBPOD_ROUTES)) {
    assert.doesNotMatch(route.path, /exec|attach|\/start/i);
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
  assert.equal(removal?.method, "DELETE");
  assert.match(removal.target, /\/libpod\/containers\/never-created\?force=true$/);
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
  await fake.waitForSocketClose(hung.seq, 2000);
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

  fake.respondNext("info", { status: 200, body: '{"version":{"Version":"5.2.0"}}' });
  await assertCode(client.info(), "SCHEMA_INVALID");
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
