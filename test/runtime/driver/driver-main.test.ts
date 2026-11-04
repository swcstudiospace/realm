import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { credentials, makeClientConstructor, status, type ServiceError } from "@grpc/grpc-js";
import { makeRealmError, RealmError } from "../../../src/core/errors.js";
import {
  DRIVER_ENV,
  loadDriverProcessConfig,
  readPackageVersion,
  runtimeHostOf,
  startDriver,
  type DriverProcessConfig,
  type DriverStartSeams,
} from "../../../src/runtime/driver/main.js";
import { GATEWAY_ID } from "../isolation/supervisor-token.js";
import { COMPUTE_DRIVER_SERVICE_NAME, ComputeDriver, loadComputeDriverService, type ComputeDriverConfig, type SandboxRecord } from "../../../src/runtime/driver/compute-driver.js";
import { DriverLifecycle, type LifecycleLibpod } from "../../../src/runtime/driver/lifecycle.js";
import type { RegistryRebuildDeps } from "../../../src/runtime/driver/registry-rebuild.js";
import { LibpodClient } from "../../../src/runtime/libpod-client.js";
import { LIBPOD_API_VERSION_HEADER, matchLibpodRoute, PING_PATH } from "../../../src/runtime/libpod-routes.js";
import { FakeLibpod, FakeRuntime, FakeSupervisor, GATEWAY_ENDPOINT, IMPLEMENTATION_VERSION, SANDBOX_IMAGE, driverConfig, realmLabels, validSandbox, writeSandboxWorkspaceEntry } from "./fakes.js";

interface Fixtures {
  readonly dir: string;
  readonly ca: string;
  readonly supervisor: string;
  readonly configHome: string;
}

const SECRET_ROOT = "/var/lib/realm/secrets";
const WORKSPACE_ROOT = "/var/lib/realm/workspaces";
const SANDBOX_STATE_ROOT = "/var/lib/realm/state";

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
  const configHome = join(dir, "xdg");
  mkdirSync(join(configHome, "realm"), { recursive: true });
  writeFileSync(
    join(configHome, "realm", "config.json"),
    JSON.stringify({
      image: SANDBOX_IMAGE,
      stateDir: "/var/lib/realm/daemon-state",
      workspaceRoot: WORKSPACE_ROOT,
      secretRoot: SECRET_ROOT,
      sandboxStateRoot: SANDBOX_STATE_ROOT,
    }),
  );
  return { dir, ca, supervisor, configHome };
}

function completeEnv(fixtures: Fixtures): Readonly<Record<string, string>> {
  return {
    [DRIVER_ENV.name]: "realm",
    [DRIVER_ENV.socket]: "/run/realm/driver.sock",
    [DRIVER_ENV.image]: SANDBOX_IMAGE,
    [DRIVER_ENV.gatewayId]: GATEWAY_ID,
    [DRIVER_ENV.gatewayCa]: fixtures.ca,
    [DRIVER_ENV.supervisorBinary]: fixtures.supervisor,
    [DRIVER_ENV.gatewayEndpoint]: GATEWAY_ENDPOINT,
    XDG_RUNTIME_DIR: "/run/user/1001",
    XDG_CONFIG_HOME: fixtures.configHome,
    HOME: fixtures.dir,
    REALM_DRIVER_SECRET_ROOT: "/stale/secret",
    REALM_DRIVER_WORKSPACE_ROOT: "/stale/workspace",
    REALM_DRIVER_STATE_ROOT: "/stale/state",
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
    sandboxStateRoot: SANDBOX_STATE_ROOT,
    stateDir: "/var/lib/realm/daemon-state",
    secretRoot: SECRET_ROOT,
    workspaceRoot: WORKSPACE_ROOT,
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

void test("PD-05: a relative socket, CA or supervisor path refuses", (t) => {
  const fixtures = fixturesFor(t);
  for (const key of [DRIVER_ENV.socket, DRIVER_ENV.gatewayCa, DRIVER_ENV.supervisorBinary]) {
    const env = { ...completeEnv(fixtures), [key]: "relative/path" };
    assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
  }
});

void test("a stale REALM_DRIVER_*_ROOT variable is ignored; the roots come from config.json", (t) => {
  const fixtures = fixturesFor(t);
  const config = loadDriverProcessConfig(completeEnv(fixtures), IMPLEMENTATION_VERSION);
  assert.equal(config.driver.secretRoot, SECRET_ROOT);
  assert.equal(config.driver.workspaceRoot, WORKSPACE_ROOT);
  assert.equal(config.driver.sandboxStateRoot, SANDBOX_STATE_ROOT);
});

void test("an absent config file refuses with SCHEMA_INVALID and does not fall back to the stale root variables", (t) => {
  const fixtures = fixturesFor(t);
  const env = { ...completeEnv(fixtures), XDG_CONFIG_HOME: undefined, HOME: undefined };
  assert.throws(() => loadDriverProcessConfig(env, IMPLEMENTATION_VERSION), refusedWithSchemaInvalid());
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

// A process configuration whose libpod socket does not exist. A start that reached adoption would fail on that socket, so a
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

void test("PRD-ISO-02: startup refuses an invalid gateway id with SCHEMA_INVALID before adoption", async () => {
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
  // The volumes the engine holds, by name, with the labels each was created with (the driver's scratch volumes).
  const volumes = new Map<string, Readonly<Record<string, string>>>();
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://engine.invalid");
    if (url.pathname === PING_PATH) {
      res.writeHead(200, { [LIBPOD_API_VERSION_HEADER]: "5.7.1" });
      res.end();
      return;
    }
    const matched = matchLibpodRoute(req.method ?? "", url.pathname);
    engine.routes.push(matched?.name ?? "unmatched");
    if (matched?.name === "createVolume") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on("end", () => {
        const spec = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { readonly Name: string; readonly Labels: Record<string, string> };
        if (volumes.has(spec.Name)) {
          res.writeHead(409, { "content-type": "application/json" });
          res.end(JSON.stringify({ message: "volume already exists" }));
          return;
        }
        volumes.set(spec.Name, { ...spec.Labels });
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ Name: spec.Name, Labels: spec.Labels }));
      });
      return;
    }
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
    if (matched?.name === "info") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ host: { security: { rootless: true } }, version: { Version: "5.7.1" } }));
      return;
    }
    if (matched?.name === "inspectContainer" && matched.containerId !== null) {
      const name = engine.containers.get(matched.containerId);
      if (name === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ cause: "no such container", message: "no such container", response: 404 }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Id: matched.containerId, Name: `/${name}` }));
      return;
    }
    if (matched?.name === "removeContainer" && matched.containerId !== null && options.refuseRemoval !== true) {
      engine.containers.delete(matched.containerId);
      res.writeHead(200);
      res.end();
      return;
    }
    if (matched?.name === "inspectVolume") {
      const volume = matched.containerId === null ? undefined : volumes.get(matched.containerId);
      if (volume === undefined) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ cause: "no such volume", message: "no such volume", response: 404 }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Name: matched.containerId, Labels: volume }));
      return;
    }
    if (matched?.name === "listVolumes") {
      const filters = JSON.parse(url.searchParams.get("filters") ?? "{}") as { readonly label?: readonly string[] };
      const terms = filters.label ?? [];
      const listed = [...volumes]
        .filter(([, labels]) => terms.every((term) => labels[term.slice(0, term.indexOf("="))] === term.slice(term.indexOf("=") + 1)))
        .map(([name, labels]) => ({ Name: name, Labels: labels }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(listed));
      return;
    }
    if (matched?.name === "removeVolume") {
      if (matched.containerId === null || !volumes.delete(matched.containerId)) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ cause: "no such volume", message: "no such volume", response: 404 }));
        return;
      }
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

// A process configuration with a socket in its own directory and no libpod engine behind it. The seams stand in for the engine. Removed
// when the test ends.
function unboundStartConfig(t: TestContext): DriverProcessConfig {
  const base = mkdtempSync(join(tmpdir(), "realm-driver-start-"));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  mkdirSync(join(base, "run"));
  return {
    socketPath: join(base, "run", "driver.sock"),
    libpodSocketPath: join(base, "podman.sock"),
    driver: driverConfig(),
  };
}

// A process configuration over the fake engine, with its own socket directory and roots, removed when the test ends.
function startConfigOver(t: TestContext, engine: FakeEngine): DriverProcessConfig {
  return { ...unboundStartConfig(t), libpodSocketPath: engine.socketPath };
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
  assert.equal(await listening(config.socketPath), true, "the driver serves once the adoption has resolved");
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

void test("PRD-CTR-03: an adoption that fails closes the server, so no socket stays bound", async (t) => {
  const engine = await startFakeEngine(t, { refuseRemoval: true });
  engine.containers.set("0123456789ab", "realm-leftover");
  const config = startConfigOver(t, engine);
  await assert.rejects(startDriver(config), refusedWith("REALM_STOPPING"));
  assert.equal(existsSync(config.socketPath), false, "the failed start left no socket");
  assert.equal(await listening(config.socketPath), false);
});

void test("PRD-CTR-03: a create that arrives before the adoption has resolved is refused before it writes anything", async (t) => {
  const engine = await startFakeEngine(t);
  const config = driverConfig();
  const name = writeSandboxWorkspaceEntry(config, join(config.workspaceRoot, "project-a"));
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

  await assert.rejects(driver.createSandbox(validSandbox({ name })), refusedWith("REALM_NOT_ACTIVE"));

  assert.equal(libpod.listCalls + libpod.inspectCalls, 0, "the refused create made no libpod call");
  assert.deepEqual(engine.routes, []);
  assert.equal(existsSync(join(config.sandboxStateRoot, name)), false, "no state directory was made");
  assert.equal(existsSync(join(config.secretRoot, name)), false, "no launch material was written");

  await lifecycle.adoptSurvivors({
    workspaceStateDir: config.stateDir,
    workspaceCeiling: config.workspaceRoot,
    image: config.sandboxImage,
  });
  assert.doesNotThrow(() => {
    lifecycle.requireSwept();
  });
});

// A libpod for a start over the seams. It answers the info the adoption reads and holds only the containers a test adds.
class StartLibpod extends FakeLibpod {
  info(): Promise<{ rootless: boolean }> {
    return Promise.resolve({ rootless: true });
  }
}

// The seams of a start over that libpod: the runtime fake, and the registry rebuild the test drives in place of rebuildRegistry.
function startSeams(libpod: StartLibpod, rebuild: NonNullable<DriverStartSeams["rebuild"]>): DriverStartSeams {
  return { libpod: libpod as unknown as LifecycleLibpod, runtime: new FakeRuntime(), rebuild };
}

// A promise and the function that settles it, for a test to wait on a point the code under test reaches. The executor form is used
// because tsconfig's ES2023 lib has no Promise.withResolvers (compute-driver.test.ts uses it for the same reason).
interface Milestone {
  readonly reached: Promise<void>;
  readonly fire: () => void;
}

function milestone(): Milestone {
  let fire: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    fire = () => {
      resolve();
    };
  });
  return { reached, fire };
}

// Resolves after the given time. This is a real wait on purpose: the readiness wait the List sits in is a real timer inside the driver
// (a 50 ms poll under a 4 s bound), and the List's answer crosses a real unix socket, so no fake clock reaches either. The test uses it
// only to observe that the List has not answered yet, never to wait for the code under test to finish.
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

// Creates a project directory under the workspace ceiling and the registry entry that pins it. Returns the sandbox name it binds.
function projectOf(config: ComputeDriverConfig, dirName: string): { readonly name: string; readonly workspace: string } {
  const workspace = join(config.workspaceRoot, dirName);
  return { name: writeSandboxWorkspaceEntry(config, workspace), workspace };
}

// The registry entry a rebuild gives a sandbox: its gateway id, its workspace, and the container the test lists under its name.
function recordOf(id: string, name: string, workspace: string): SandboxRecord {
  return { id, workspace, containerName: name, runtimeIdentity: `id-${name}`, supervisorExited: false };
}

// The outcome of a ListSandboxes call: the sandbox names it lists, or the wire code it failed with.
type ListOutcome = { readonly names: readonly string[] } | { readonly code: number };

// The sandbox names a ListSandboxes response carries. A response without a sandbox list names none.
function namesOf(response: unknown): string[] {
  const sandboxes: unknown =
    typeof response === "object" && response !== null && "sandboxes" in response ? response.sandboxes : undefined;
  if (!Array.isArray(sandboxes)) {
    return [];
  }
  return sandboxes.map((sandbox: unknown) =>
    typeof sandbox === "object" && sandbox !== null && "name" in sandbox ? String(sandbox.name) : "",
  );
}

// A ListSandboxes call on the driver's socket, as the gateway makes it. Each call resolves with the names it lists, or with the wire code
// of its failure.
function listOver(t: TestContext, socketPath: string): () => Promise<ListOutcome> {
  const service = loadComputeDriverService();
  const Constructor = makeClientConstructor(service, COMPUTE_DRIVER_SERVICE_NAME);
  const client = new Constructor(`unix:${socketPath}`, credentials.createInsecure());
  t.after(() => {
    client.close();
  });
  const definition = service["ListSandboxes"];
  assert.ok(definition !== undefined);
  return () =>
    new Promise<ListOutcome>((resolve) => {
      client.makeUnaryRequest(
        definition.path,
        definition.requestSerialize,
        definition.responseDeserialize,
        {},
        (error: ServiceError | null, response: unknown) => {
          resolve(error === null ? { names: namesOf(response) } : { code: error.code });
        },
      );
    });
}

// How long a List is held while a rebuild is part-way. A List that did not wait would have answered within this time over a real socket.
// It is a real wait for the reason given at delay().
const HOLD_MS = 200;
// The least time a List that waits for the readiness bound takes to fail. The bound is 4 s (READY_WAIT_MS in compute-driver.ts). It is
// observed in real time for the same reason as delay(); a refusal at once would be a connection failure, not the readiness wait.
const MIN_BOUND_WAIT_MS = 3_000;

void test("PRD-CTR-03: a List that starts while the registry rebuild is part-way waits for the rebuild, then returns every sandbox", { timeout: 15_000 }, async (t) => {
  const config = unboundStartConfig(t);
  const libpod = new StartLibpod();
  const first = projectOf(config.driver, "project-a");
  const second = projectOf(config.driver, "project-b");
  const firstRegistered = milestone();
  const releaseRebuild = milestone();
  const rebuild = async ({ driver }: RegistryRebuildDeps): Promise<void> => {
    libpod.add(first.name, true);
    driver.adoptSandbox(first.name, recordOf("sandbox-a", first.name, first.workspace), new FakeSupervisor(false));
    firstRegistered.fire();
    await releaseRebuild.reached;
    libpod.add(second.name, true);
    driver.adoptSandbox(second.name, recordOf("sandbox-b", second.name, second.workspace), new FakeSupervisor(false));
  };
  const starting = startDriver(config, startSeams(libpod, rebuild));
  t.after(async () => {
    const server = await starting.catch(() => undefined);
    await server?.close();
  });
  await firstRegistered.reached;
  const list = listOver(t, config.socketPath);
  let answered = false;
  const listing = list().then((outcome) => {
    answered = true;
    return outcome;
  });
  await delay(HOLD_MS);
  assert.equal(answered, false, "the List does not answer while the rebuild is part-way");
  releaseRebuild.fire();
  await starting;
  assert.deepEqual(await listing, { names: [first.name, second.name] }, "the List returns the complete registry");
});

void test("PRD-CTR-03: a failed registry rebuild leaves the driver not ready, so a List that waits fails UNAVAILABLE once the bound passes", { timeout: 15_000 }, async (t) => {
  const config = unboundStartConfig(t);
  const libpod = new StartLibpod();
  const first = projectOf(config.driver, "project-a");
  const rebuildHeld = milestone();
  const listFailed = milestone();
  const rebuild = async ({ driver }: RegistryRebuildDeps): Promise<void> => {
    libpod.add(first.name, true);
    driver.adoptSandbox(first.name, recordOf("sandbox-a", first.name, first.workspace), new FakeSupervisor(false));
    rebuildHeld.fire();
    await listFailed.reached;
    throw makeRealmError("SCHEMA_INVALID");
  };
  const starting = startDriver(config, startSeams(libpod, rebuild));
  t.after(async () => {
    const server = await starting.catch(() => undefined);
    await server?.close();
  });
  await rebuildHeld.reached;
  const startedAt = Date.now();
  const outcome = await listOver(t, config.socketPath)();
  const waitedMs = Date.now() - startedAt;
  listFailed.fire();
  await assert.rejects(starting, refusedWith("SCHEMA_INVALID"));
  assert.deepEqual(outcome, { code: status.UNAVAILABLE }, "the List fails UNAVAILABLE and never returns the partial registry");
  assert.ok(waitedMs >= MIN_BOUND_WAIT_MS, "the List waited for the readiness bound before it failed");
  assert.equal(await listening(config.socketPath), false, "the failed start left no socket");
});
