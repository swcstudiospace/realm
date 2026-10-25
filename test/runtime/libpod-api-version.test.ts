import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { LibpodClient } from "../../src/runtime/libpod-client.js";
import { FakeLibpod, type FakeLibpodOptions } from "../support/fake-libpod.js";

const LABEL_KEY = "openshell.managed";

async function startFake(
  t: TestContext,
  options: FakeLibpodOptions = {},
): Promise<{ readonly fake: FakeLibpod; readonly socketPath: string }> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-libpod-version-")));
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

void test("RT-03: each libpod route is sent under the API version the server reports on /_ping", async (t) => {
  const { fake, socketPath } = await startFake(t, { libpodApiVersion: "5.7.1" });
  await new LibpodClient(socketPath).listContainersByLabel(LABEL_KEY, "true");
  const listed = fake.requests().filter((request) => request.route === "listContainers");
  assert.equal(listed.length, 1);
  assert.match(listed[0]?.target ?? "", /^\/v5\.7\.1\/libpod\/containers\/json\?/);
});

void test("RT-03: the API version is read once from /_ping and reused by later calls", async (t) => {
  const { fake, socketPath } = await startFake(t);
  const client = new LibpodClient(socketPath);
  await client.listContainersByLabel(LABEL_KEY, "true");
  await client.listContainersByLabel(LABEL_KEY, "true");
  const pings = fake.requests().filter((request) => request.target === "/_ping");
  assert.equal(pings.length, 1);
});

void test("RT-03: a /_ping reply that carries no API version fails closed with SCHEMA_INVALID", async (t) => {
  const { socketPath } = await startFake(t, { omitApiVersionHeader: true });
  await assertCode(new LibpodClient(socketPath).listContainersByLabel(LABEL_KEY, "true"), "SCHEMA_INVALID");
});

void test("RT-08: a route-level 404 from the list call is a contract failure, not an empty listing", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.respondNext("listContainers", { status: 404, body: "Not Found" });
  await assertCode(new LibpodClient(socketPath).listContainersByLabel(LABEL_KEY, "true"), "SCHEMA_INVALID");
});

void test("RT-08: inspect reads a route-level 404 as a failure, not as a missing container", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.respondNext("inspectContainer", { status: 404, body: "Not Found" });
  await assertCode(new LibpodClient(socketPath).inspectContainer("abc123"), "SCHEMA_INVALID");
});

void test("RT-08: inspect returns null for Podman's no-such-container error", async (t) => {
  const { socketPath } = await startFake(t);
  assert.equal(await new LibpodClient(socketPath).inspectContainer("abc123"), null);
});

void test("RT-08: remove reads a route-level 404 as a failure, not as an already removed container", async (t) => {
  const { fake, socketPath } = await startFake(t);
  fake.respondNext("removeContainer", { status: 404, body: "Not Found" });
  await assertCode(new LibpodClient(socketPath).removeContainer("abc123", { force: true }), "SCHEMA_INVALID");
});
