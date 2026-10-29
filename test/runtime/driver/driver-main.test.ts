import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RealmError } from "../../../src/core/errors.js";
import {
  DRIVER_ENV,
  loadDriverProcessConfig,
  readPackageVersion,
  runtimeHostOf,
  startDriver,
  type DriverProcessConfig,
} from "../../../src/runtime/driver/main.js";
import { GATEWAY_ID } from "../isolation/supervisor-token.js";
import { ComputeDriver } from "../../../src/runtime/driver/compute-driver.js";
import { DriverLifecycle } from "../../../src/runtime/driver/lifecycle.js";
import { LibpodClient } from "../../../src/runtime/libpod-client.js";
import { LIBPOD_API_VERSION_HEADER, matchLibpodRoute, PING_PATH } from "../../../src/runtime/libpod-routes.js";
import { FakeLibpod, FakeRuntime, GATEWAY_ENDPOINT, IMPLEMENTATION_VERSION, SANDBOX_IMAGE, driverConfig, realmLabels, validSandbox } from "./fakes.js";

interface Fixtures {
  readonly ca: string;
  readonly supervisor: string;
}

// A readable gateway CA and an executable supervisor, in a directory removed when the test ends.
function fixturesFor(t: TestContext): Fixtures {
  const dir = mkdtempSync(join(tmpdir(), "realm-driver-env-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const ca = join(dir, "gateway-ca.pem");
  const supervisor = join(dir, "openshell-supervisor");
  writeFileSync(ca, "fixture certificate authority\n");
  writeFileSync(supervisor, "fixture supervisor\n");
  chmodSync(supervisor, 0o755);
  return { ca, supervisor };
}

function completeEnv(fixtures: Fixtures): Readonly<Record<string, string>> {
  return {
    [DRIVER_ENV.name]: "realm",
    [DRIVER_ENV.socket]: "/run/realm/driver.sock",
    [DRIVER_ENV.image]: SANDBOX_IMAGE,
    [DRIVER_ENV.stateRoot]: "/var/lib/realm/state",
    [DRIVER_ENV.secretRoot]: "/var/lib/realm/secrets",
    [DRIVER_ENV.workspaceRoot]: "/var/lib/realm/workspaces",
    [DRIVER_ENV.gatewayId]: GATEWAY_ID,
    [DRIVER_ENV.gatewayCa]: fixtures.ca,
    [DRIVER_ENV.supervisorBinary]: fixtures.supervisor,
    [DRIVER_ENV.gatewayEndpoint]: GATEWAY_ENDPOINT,
    XDG_RUNTIME_DIR: "/run/user/1001",
  };
}

function refusedWithSchemaInvalid(): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID";
}

// The refusal is SCHEMA_INVALID, and neither its message nor its reason names the configured value.
function refusedWithoutValue(value: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof RealmError &&
    error.code === "SCHEMA_INVALID" &&
    !error.message.includes(value) &&
    !error.reason.includes(value);
}

void test("PD-05: a complete environment yields the sockets, the libpod socket, and the driver config with its roots, gateway id and supervisor", (t) => {
  const fixtures = fixturesFor(t);
  const config = loadDriverProcessConfig(completeEnv(fixtures), IMPLEMENTATION_VERSION);
  assert.equal(config.socketPath, "/run/realm/driver.sock");
  assert.equal(config.libpodSocketPath, "/run/user/1001/podman/podman.sock");
  assert.deepEqual(config.driver, {
    driverName: "realm",
    sandboxImage: SANDBOX_IMAGE,
    sandboxStateRoot: "/var/lib/realm/state",
    secretRoot: "/var/lib/realm/secrets",
    workspaceRoot: "/var/lib/realm/workspaces",
    implementationVersion: IMPLEMENTATION_VERSION,
    gatewayId: GATEWAY_ID,
    supervisor: {
      binary: fixtures.supervisor,
      gatewayEndpoint: GATEWAY_ENDPOINT,
      gatewayCaPath: fixtures.ca,
    },
  });
});

const OPTIONAL_KEYS: readonly string[] = [DRIVER_ENV.supervisorSha256];
// The digest of the supervisor fixture's contents (fixturesFor).
const SUPERVISOR_SHA256 = createHash("sha256").update("fixture supervisor\n").digest("hex");

for (const key of Object.values(DRIVER_ENV).filter((candidate) => !OPTIONAL_KEYS.includes(candidate))) {
  void test(`PD-05: a missing ${key} refuses with SCHEMA_INVALID`, (t) => {
    const env = { ...completeEnv(fixturesFor(t)), [key]: undefined };
    assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
  });
}

void test("a supervisor digest pin that matches the file is accepted and carried on the process config", (t) => {
  const env = { ...completeEnv(fixturesFor(t)), [DRIVER_ENV.supervisorSha256]: SUPERVISOR_SHA256 };
  assert.equal(loadDriverProcessConfig(env, IMPLEMENTATION_VERSION).supervisorSha256, SUPERVISOR_SHA256);
});

void test("an unset supervisor digest pin loads as before and carries no pin", (t) => {
  const config = loadDriverProcessConfig(completeEnv(fixturesFor(t)), IMPLEMENTATION_VERSION);
  assert.equal(config.supervisorSha256, undefined);
  assert.equal("supervisorSha256" in config, false);
});

// The driver's runtime host is what startDriver hands the compute driver, so a spawn through it carries the process config's pin.
// A create cannot be driven through startDriver itself here: it needs a live libpod socket and a TLS listener in the sandbox.
void test("a supervisor file changed after the config was loaded is refused at spawn with SCHEMA_INVALID, naming neither digest nor path", async (t) => {
  const fixtures = fixturesFor(t);
  const env = { ...completeEnv(fixtures), [DRIVER_ENV.supervisorSha256]: SUPERVISOR_SHA256 };
  const config = loadDriverProcessConfig(env, IMPLEMENTATION_VERSION);
  writeFileSync(fixtures.supervisor, "#!/bin/sh\nexit 0\n");
  await assert.rejects(runtimeHostOf(config).spawnSupervisor({ binary: fixtures.supervisor, args: [], env: {} }), (error: unknown) => {
    return (
      refusedWithoutValue(SUPERVISOR_SHA256)(error) &&
      refusedWithoutValue(fixtures.supervisor)(error) &&
      error instanceof RealmError &&
      !error.reason.includes(fixtures.supervisor)
    );
  });
});

void test("a config with no digest pin spawns the supervisor file as it is", async (t) => {
  const fixtures = fixturesFor(t);
  const config = loadDriverProcessConfig(completeEnv(fixtures), IMPLEMENTATION_VERSION);
  writeFileSync(fixtures.supervisor, "#!/bin/sh\nexit 0\n");
  const handle = await runtimeHostOf(config).spawnSupervisor({ binary: fixtures.supervisor, args: [], env: {} });
  await handle.exited;
  assert.equal(handle.hasExited(), true);
});

void test("a supervisor digest pin that does not match the file refuses with SCHEMA_INVALID and echoes neither digest nor path", (t) => {
  const fixtures = fixturesFor(t);
  const wrong = "0".repeat(64);
  const env = { ...completeEnv(fixtures), [DRIVER_ENV.supervisorSha256]: wrong };
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithoutValue(wrong));
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithoutValue(SUPERVISOR_SHA256));
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithoutValue(fixtures.supervisor));
});

void test("a malformed supervisor digest pin refuses with SCHEMA_INVALID, empty and upper-case included", (t) => {
  const fixtures = fixturesFor(t);
  for (const malformed of ["", "abc123", SUPERVISOR_SHA256.toUpperCase(), `${SUPERVISOR_SHA256}0`, `sha256:${SUPERVISOR_SHA256}`]) {
    const env = { ...completeEnv(fixtures), [DRIVER_ENV.supervisorSha256]: malformed };
    assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
  }
});

void test("PD-05: a missing XDG_RUNTIME_DIR refuses, because the libpod socket cannot be found", (t) => {
  const env = { ...completeEnv(fixturesFor(t)), XDG_RUNTIME_DIR: undefined };
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
});

void test("PD-05: a relative socket, root, CA or supervisor path refuses", (t) => {
  const fixtures = fixturesFor(t);
  for (const key of [
    DRIVER_ENV.socket,
    DRIVER_ENV.stateRoot,
    DRIVER_ENV.secretRoot,
    DRIVER_ENV.workspaceRoot,
    DRIVER_ENV.gatewayCa,
    DRIVER_ENV.supervisorBinary,
  ]) {
    const env = { ...completeEnv(fixtures), [key]: "relative/path" };
    assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
  }
});

void test("PRD-DRV-01: a gateway CA that is not a readable file refuses, and the path is not echoed", (t) => {
  const fixtures = fixturesFor(t);
  const missing = join(tmpdir(), "realm-no-such-dir", "gateway-ca-secret.pem");
  const env = { ...completeEnv(fixtures), [DRIVER_ENV.gatewayCa]: missing };
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithoutValue(missing));
});

void test("PRD-DRV-01: a supervisor binary that is not executable refuses, and the path is not echoed", (t) => {
  const fixtures = fixturesFor(t);
  chmodSync(fixtures.supervisor, 0o644);
  const env = completeEnv(fixtures);
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithoutValue(fixtures.supervisor));
});

void test("PRD-DRV-01: a gateway endpoint that is not https, or has no host, refuses, and the endpoint is not echoed", (t) => {
  const fixtures = fixturesFor(t);
  for (const endpoint of ["http://gateway.invalid:8443", "https://", "not a url"]) {
    const env = { ...completeEnv(fixtures), [DRIVER_ENV.gatewayEndpoint]: endpoint };
    assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithoutValue(endpoint));
  }
});

void test("PRD-ISO-02: a gateway id outside the configured form refuses at startup, and an empty one is missing", (t) => {
  const fixtures = fixturesFor(t);
  for (const gatewayId of ["", " realm", "realm name", "-realm", "realm/x", "a".repeat(65)]) {
    const env = { ...completeEnv(fixtures), [DRIVER_ENV.gatewayId]: gatewayId };
    assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
  }
});

void test("PRD-ISO-02: a refused gateway id is not echoed in the refusal", (t) => {
  const env = { ...completeEnv(fixturesFor(t)), [DRIVER_ENV.gatewayId]: "bad id secret-value" };
  try {
    loadDriverProcessConfig(env, IMPLEMENTATION_VERSION);
    assert.fail("expected a refusal");
  } catch (error: unknown) {
    assert.ok(error instanceof RealmError);
    assert.ok(!error.message.includes("secret-value"));
    assert.ok(!error.reason.includes("secret-value"));
  }
});

void test("PRD-DRV-02: an image that is not digest-pinned refuses at startup", (t) => {
  const env = { ...completeEnv(fixturesFor(t)), [DRIVER_ENV.image]: "registry.invalid/realm/sandbox:latest" };
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
});

void test("PD-05: a driver name outside the short lowercase form refuses", (t) => {
  const env = { ...completeEnv(fixturesFor(t)), [DRIVER_ENV.name]: "Realm Driver" };
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
});

void test("a refusal names no configured value", (t) => {
  const env = { ...completeEnv(fixturesFor(t)), [DRIVER_ENV.image]: "registry.invalid/realm/secret-tag:latest" };
  try {
    loadDriverProcessConfig(env, IMPLEMENTATION_VERSION);
    assert.fail("expected a refusal");
  } catch (error: unknown) {
    assert.ok(error instanceof RealmError);
    assert.ok(!error.message.includes("secret-tag"));
    assert.ok(!error.reason.includes("secret-tag"));
  }
});

function packageJsonWith(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-driver-manifest-"));
  const path = join(dir, "package.json");
  writeFileSync(path, contents);
  return path;
}

void test("PD-05: the package version is read from the manifest it is given", () => {
  assert.equal(readPackageVersion(packageJsonWith('{"name":"agent-realm","version":"9.8.7"}')), "9.8.7");
});

void test("PD-05: the entry resolves this package's own manifest four levels above the module", () => {
  const version = readPackageVersion(fileURLToPath(new URL("../../../../package.json", import.meta.url)));
  assert.match(version, /^\d+\.\d+\.\d+/);
});

void test("PD-05: a manifest without a usable version refuses with SCHEMA_INVALID", () => {
  for (const contents of ['{"name":"agent-realm"}', '{"version":""}', '{"version":"   "}', '{"version":7}', "null", "not json"]) {
    assert.throws(() => readPackageVersion(packageJsonWith(contents)), refusedWithSchemaInvalid());
  }
});

void test("PD-05: a manifest that cannot be read refuses with SCHEMA_INVALID", () => {
  assert.throws(() => readPackageVersion(join(tmpdir(), "realm-no-such-package.json")), refusedWithSchemaInvalid());
});

// A process configuration whose libpod socket does not exist. A start that reached the sweep would fail on that socket, so a
// refusal with SCHEMA_INVALID shows the gateway id was checked first, before any container was touched.
function startConfigWithGatewayId(gatewayId: string): DriverProcessConfig {
  const base = mkdtempSync(join(tmpdir(), "realm-driver-start-"));
  mkdirSync(join(base, "run"));
  return {
    socketPath: join(base, "run", "driver.sock"),
    libpodSocketPath: join(base, "missing", "podman.sock"),
    driver: driverConfig({ gatewayId }),
  };
}

void test("PRD-ISO-02: startup refuses an invalid gateway id with SCHEMA_INVALID before the sweep", async () => {
  await assert.rejects(startDriver(startConfigWithGatewayId("-invalid")), refusedWithSchemaInvalid());
});

// An in-process libpod engine on a unix socket. It lists the containers it holds under the realm labels, removes one on request
// (unless it is told to refuse), and records each libpod route a client asked for, so a test can show which calls a start made.
interface FakeEngine {
  readonly socketPath: string;
  readonly routes: string[];
  // Container id to container name.
  readonly containers: Map<string, string>;
}

async function startFakeEngine(t: TestContext, options: { readonly refuseRemoval?: boolean } = {}): Promise<FakeEngine> {
  const dir = mkdtempSync(join(tmpdir(), "realm-engine-"));
  const engine: FakeEngine = { socketPath: join(dir, "podman.sock"), routes: [], containers: new Map() };
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://engine.invalid");
    if (url.pathname === PING_PATH) {
      res.writeHead(200, { [LIBPOD_API_VERSION_HEADER]: "5.7.1" });
      res.end();
      return;
    }
    const matched = matchLibpodRoute(req.method ?? "", url.pathname);
    engine.routes.push(matched?.name ?? "unmatched");
    if (matched?.name === "listContainers") {
      const listed = [...engine.containers].map(([id, name]) => ({
        Id: id,
        Names: [`/${name}`],
        Labels: realmLabels(name),
        State: "running",
      }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(listed));
      return;
    }
    if (matched?.name === "removeContainer" && matched.containerId !== null && options.refuseRemoval !== true) {
      engine.containers.delete(matched.containerId);
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "route not served by this fake" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(engine.socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    rmSync(dir, { recursive: true, force: true });
  });
  return engine;
}

// A process configuration over the fake engine, with its own socket directory and roots, removed when the test ends.
function startConfigOver(t: TestContext, engine: FakeEngine): DriverProcessConfig {
  const base = mkdtempSync(join(tmpdir(), "realm-driver-start-"));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  mkdirSync(join(base, "run"));
  return {
    socketPath: join(base, "run", "driver.sock"),
    libpodSocketPath: engine.socketPath,
    driver: driverConfig(),
  };
}

// Leaves a sandbox's launch material under the secret root, as a previous generation would, and returns its path.
function leaveSecret(config: DriverProcessConfig): string {
  const dir = join(config.driver.secretRoot, "realm-leftover");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(config.driver.secretRoot, 0o700);
  chmodSync(dir, 0o700);
  const file = join(dir, "launch.json");
  writeFileSync(file, "{}", { mode: 0o600 });
  return file;
}

function listening(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => {
      probe.destroy();
      resolve(false);
    });
  });
}

function refusedWith(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

void test("PRD-CTR-03: a start removes the previous generation's containers and secret entries, then serves", async (t) => {
  const engine = await startFakeEngine(t);
  engine.containers.set("0123456789ab", "realm-leftover");
  const config = startConfigOver(t, engine);
  const secret = leaveSecret(config);
  assert.equal(existsSync(secret), true);
  const server = await startDriver(config);
  t.after(async () => {
    await server.close();
  });
  assert.equal(engine.containers.size, 0, "the leftover container was removed");
  assert.equal(existsSync(secret), false, "the leftover secret entry was removed");
  assert.equal(await listening(config.socketPath), true, "the driver serves once the sweep has finished");
});

void test("PRD-CTR-03: a second start against a live driver's socket refuses with LOCK_CONFLICT and removes nothing", async (t) => {
  const engine = await startFakeEngine(t);
  const config = startConfigOver(t, engine);
  const live = await startDriver(config);
  t.after(async () => {
    await live.close();
  });
  // The live driver now owns containers and secrets the second start must not touch.
  engine.containers.set("0123456789ab", "realm-live");
  const secret = leaveSecret(config);
  const callsBefore = engine.routes.length;

  await assert.rejects(startDriver(config), refusedWith("LOCK_CONFLICT"));

  assert.deepEqual(engine.routes.slice(callsBefore), [], "the refused start made no libpod call");
  assert.equal(engine.containers.has("0123456789ab"), true, "the live driver's container was not removed");
  assert.equal(existsSync(secret), true, "the live driver's secret entry was not removed");
  assert.equal(await listening(config.socketPath), true, "the live driver still serves");
});

void test("PRD-CTR-03: a sweep that fails closes the server, so no socket stays bound", async (t) => {
  const engine = await startFakeEngine(t, { refuseRemoval: true });
  engine.containers.set("0123456789ab", "realm-leftover");
  const config = startConfigOver(t, engine);
  await assert.rejects(startDriver(config), refusedWith("REALM_STOPPING"));
  assert.equal(existsSync(config.socketPath), false, "the failed start left no socket");
  assert.equal(await listening(config.socketPath), false);
});

void test("PRD-CTR-03: a create that arrives before the sweep has resolved is refused before it writes anything", async (t) => {
  const engine = await startFakeEngine(t);
  const config = driverConfig();
  t.after(() => {
    rmSync(join(config.sandboxStateRoot, ".."), { recursive: true, force: true });
  });
  const lifecycle = new DriverLifecycle({
    libpod: new LibpodClient(engine.socketPath),
    sandboxStateRoot: config.sandboxStateRoot,
    secretRoot: config.secretRoot,
  });
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(config, {
    lifecycle,
    requireSwept: () => {
      lifecycle.requireSwept();
    },
    libpod,
    runtime: new FakeRuntime(),
  });

  await assert.rejects(driver.createSandbox(validSandbox()), refusedWith("REALM_NOT_ACTIVE"));

  assert.equal(libpod.listCalls + libpod.inspectCalls, 0, "the refused create made no libpod call");
  assert.deepEqual(engine.routes, []);
  assert.equal(existsSync(join(config.sandboxStateRoot, "realm-session-1")), false, "no state directory was made");
  assert.equal(existsSync(join(config.secretRoot, "realm-session-1")), false, "no launch material was written");

  await lifecycle.startupSweep();
  assert.doesNotThrow(() => {
    lifecycle.requireSwept();
  });
});
