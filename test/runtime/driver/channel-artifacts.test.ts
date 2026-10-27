// What a create writes and where, what a failed create leaves behind, and what a delete ends. The runtime's files sit in the
// sandbox's secret directory, outside the state root and the workspace. A failure after the container exists removes what the
// call made and rethrows the original error, and a delete ends the host supervisor. No test reads source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { makeRealmError, RealmError } from "../../../src/core/errors.js";
import { ComputeDriver, type DriverSandboxMessage } from "../../../src/runtime/driver/compute-driver.js";
import type { ListenerTrust } from "../../../src/runtime/driver/channel.js";
import { FakeLibpod, FakeLifecycle, FakeRuntime, diskLifecycle, driverConfig, validSandbox } from "./fakes.js";
import { LAUNCH_SESSION_ID } from "../isolation/supervisor-token.js";

const SANDBOX_NAME = "realm-session-1";
const RUNTIME_FILE_NAMES = ["bootstrap.json", "descriptor.json", "auth.json"];

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

// The name of every entry under a directory, at any depth. A missing directory has none.
function namesUnder(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    names.push(entry.name);
    if (entry.isDirectory()) {
      names.push(...namesUnder(join(root, entry.name)));
    }
  }
  return names;
}

void test("a create writes the bootstrap at 0600 in a 0700 channel, and the descriptor and auth bundle at 0600 beside it, none under the state root or the workspace", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(config, {
    lifecycle: await diskLifecycle(config, libpod),
    libpod,
    runtime: new FakeRuntime(),
  });
  await driver.createSandbox(validSandbox());
  const secretDir = join(config.secretRoot, SANDBOX_NAME);
  const channelDir = join(secretDir, "channel");
  assert.equal(modeOf(channelDir), 0o700);
  assert.equal(modeOf(join(channelDir, "bootstrap.json")), 0o600);
  assert.equal(modeOf(join(secretDir, "descriptor.json")), 0o600);
  assert.equal(modeOf(join(secretDir, "auth.json")), 0o600);
  const descriptor = JSON.parse(readFileSync(join(secretDir, "descriptor.json"), "utf8")) as { readonly session_id?: unknown };
  assert.equal(descriptor.session_id, LAUNCH_SESSION_ID);
  for (const root of [config.sandboxStateRoot, config.workspaceRoot]) {
    const names = namesUnder(root);
    for (const name of RUNTIME_FILE_NAMES) {
      assert.equal(names.includes(name), false, `${name} under ${root}`);
    }
  }
});

for (const step of ["listenerError", "spawnError"] as const) {
  void test(`a failed runtime step (${step}) removes the container, the state directory and the secret entries, and rethrows the original error`, async () => {
    const config = driverConfig();
    const libpod = new FakeLibpod();
    const lifecycle = await diskLifecycle(config, libpod);
    const runtime = new FakeRuntime();
    const failure = new Error("runtime step failed");
    runtime[step] = failure;
    const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
    await assert.rejects(driver.createSandbox(validSandbox()), (error: unknown) => error === failure);
    assert.deepEqual(lifecycle.deletes, [SANDBOX_NAME]);
    assert.equal(libpod.containers.has(SANDBOX_NAME), false);
    assert.equal(runtime.supervisors.length, 0);
    assert.equal(existsSync(join(config.sandboxStateRoot, SANDBOX_NAME)), false);
    assert.equal(existsSync(join(config.secretRoot, SANDBOX_NAME)), false);
  });
}

void test("DeleteSandbox ends the host supervisor, then removes the container, the state directory and the secret entries", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const lifecycle = await diskLifecycle(config, libpod);
  const runtime = new FakeRuntime();
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  await driver.createSandbox(validSandbox());
  const [supervisor] = runtime.supervisors;
  assert.ok(supervisor !== undefined);
  assert.equal(supervisor.stops, 0);
  assert.deepEqual(await driver.deleteSandbox({ name: SANDBOX_NAME }), { deleted: true });
  assert.equal(supervisor.stops, 1);
  assert.deepEqual(lifecycle.deletes, [SANDBOX_NAME]);
  assert.equal(libpod.containers.has(SANDBOX_NAME), false);
  assert.equal(existsSync(join(config.sandboxStateRoot, SANDBOX_NAME)), false);
  assert.equal(existsSync(join(config.secretRoot, SANDBOX_NAME)), false);
});

void test("a create whose launch material does not decode is refused before any directory is made or libpod call", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const lifecycle = new FakeLifecycle(libpod);
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime: new FakeRuntime() });
  const base = validSandbox();
  const sandbox: DriverSandboxMessage = {
    ...base,
    spec: { ...base.spec, launch_authentication: Buffer.from('{"supervisor":', "utf8") },
  };
  await assert.rejects(
    driver.createSandbox(sandbox),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.deepEqual(lifecycle.creates, []);
  assert.equal(libpod.inspectCalls, 0);
  assert.equal(libpod.containers.size, 0);
  assert.equal(existsSync(join(config.sandboxStateRoot, SANDBOX_NAME)), false);
  assert.equal(existsSync(join(config.secretRoot, SANDBOX_NAME)), false);
  assert.deepEqual(readdirSync(config.workspaceRoot), []);
});

void test("after the runtime's listener is confirmed, server.key and the CA private key are gone, and the descriptor keeps the CA certificate", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const runtime = new FakeRuntime();
  const driver = new ComputeDriver(config, { lifecycle: await diskLifecycle(config, libpod), libpod, runtime });
  await driver.createSandbox(validSandbox());
  const secretDir = join(config.secretRoot, SANDBOX_NAME);
  const [confirmation] = runtime.confirmations;
  assert.ok(confirmation !== undefined);
  assert.equal(confirmation.keyPresent, true, "server.key was still on disk when the listener was confirmed");
  assert.equal(existsSync(join(secretDir, "channel", "server.key")), false, "server.key is removed after the confirmation");
  assert.equal(namesUnder(secretDir).includes("ca.key"), false, "the CA private key is gone");
  assert.equal(existsSync(join(secretDir, "tls")), false, "the TLS work directory is gone");
  assert.equal(existsSync(join(secretDir, "channel", "server.crt")), true, "the leaf certificate is kept");
  const descriptor = JSON.parse(readFileSync(join(secretDir, "descriptor.json"), "utf8")) as {
    readonly tls?: { readonly trust_anchor_pem?: unknown };
  };
  assert.match(String(descriptor.tls?.trust_anchor_pem), /BEGIN CERTIFICATE/);
});

void test("a failed create whose container delete failed says the container was not removed, when a lookup still finds it (phase 9.5, E)", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const disk = await diskLifecycle(config, libpod);
  const lifecycle = { ...disk, delete: (): Promise<void> => Promise.reject(makeRealmError("CLEANUP_FAILED")) };
  const runtime = new FakeRuntime();
  runtime.listenerError = makeRealmError("OPENSHELL_START_FAILED");
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  await assert.rejects(
    driver.createSandbox(validSandbox()),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "OPENSHELL_START_FAILED" &&
      error.message.endsWith("Cleanup failed: The container was not removed.") &&
      !error.message.includes("could not be confirmed"),
  );
  assert.equal(libpod.containers.has(SANDBOX_NAME), true, "the container is still present");
  assert.equal(existsSync(join(config.secretRoot, SANDBOX_NAME)), false, "the files are removed although the delete failed");
});

void test("a failed create whose container is gone reports no container problem and no cleanup note (phase 9.5, E)", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const disk = await diskLifecycle(config, libpod);
  const lifecycle = {
    ...disk,
    delete: (name: string): Promise<void> => {
      libpod.containers.delete(name);
      return Promise.reject(makeRealmError("CLEANUP_FAILED"));
    },
  };
  const runtime = new FakeRuntime();
  runtime.listenerError = makeRealmError("OPENSHELL_START_FAILED");
  const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
  await assert.rejects(
    driver.createSandbox(validSandbox()),
    (error: unknown) =>
      error instanceof RealmError && error.code === "OPENSHELL_START_FAILED" && !error.message.includes("Cleanup failed"),
  );
});

// A runtime whose server.key cannot be removed once the listener is confirmed: the key path is replaced by a directory, so its
// unlink fails and the driver must not report Ready.
class UnremovableKeyRuntime extends FakeRuntime {
  override awaitListener(controlSocket: string, trust: ListenerTrust): Promise<void> {
    const key = join(dirname(controlSocket), "server.key");
    rmSync(key);
    mkdirSync(key);
    return super.awaitListener(controlSocket, trust);
  }
}

void test("a server.key that cannot be removed after the listener is confirmed refuses Ready and removes the container (phase 9.5, N2)", async () => {
  const config = driverConfig();
  const libpod = new FakeLibpod();
  const runtime = new UnremovableKeyRuntime();
  const driver = new ComputeDriver(config, { lifecycle: await diskLifecycle(config, libpod), libpod, runtime });
  await assert.rejects(
    driver.createSandbox(validSandbox()),
    (error: unknown) => error instanceof RealmError && error.code === "CLEANUP_FAILED",
  );
  assert.equal(libpod.containers.has(SANDBOX_NAME), false, "the container is removed");
  assert.equal(runtime.supervisors.length, 0, "no host supervisor is started");
  assert.deepEqual(await driver.listSandboxes(), { sandboxes: [] }, "no sandbox is reported");
  assert.equal(existsSync(join(config.secretRoot, SANDBOX_NAME)), false, "the secret directory is removed");
});
