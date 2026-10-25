// The compute driver process (phase 9.4, PD-05; phase 9.5 adds the isolation backend). It runs as its own process under the
// realm account's user unit (HC-04). This module is the only place the driver reads process.env. It reads the configuration
// once, validates it, reads the gateway public key, runs the startup sweep, and only then binds the sockets, so no request is
// accepted ahead of the sweep (PRD-CTR-03). The isolation backend shares the driver's boundary registry, so a DeleteSandbox
// invalidates the handles the backend holds.

import { readFileSync, statSync, type Stats } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDirectEntry, podmanSocketPath } from "../host-paths.js";
import { makeRealmError, RealmError } from "../../core/errors.js";
import { LibpodClient } from "../libpod-client.js";
import {
  ComputeDriver,
  computeDriverImplementation,
  isImplementationVersion,
  loadComputeDriverService,
  type ComputeDriverConfig,
} from "./compute-driver.js";
import { DriverLifecycle } from "./lifecycle.js";
import { SupervisorBearerVerifier } from "./isolation/bearer.js";
import { startIsolationBackend } from "./isolation/backend.js";
import { BoundaryRegistry } from "./isolation/boundary.js";
import { startSocketServer, type SocketServer } from "./server.js";

export const DRIVER_ENV = Object.freeze({
  name: "REALM_DRIVER_NAME",
  socket: "REALM_DRIVER_SOCKET",
  image: "REALM_DRIVER_SANDBOX_IMAGE",
  stateRoot: "REALM_DRIVER_STATE_ROOT",
  secretRoot: "REALM_DRIVER_SECRET_ROOT",
  workspaceRoot: "REALM_DRIVER_WORKSPACE_ROOT",
  isolationSocket: "REALM_DRIVER_ISOLATION_SOCKET",
  gatewayPublicKey: "REALM_DRIVER_GATEWAY_PUBLIC_KEY",
});

// A driver name is a short lowercase token. The gateway's [openshell.drivers.<name>] table names it.
const DRIVER_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
// The same digest-pinned form the runtime config accepts (D-52).
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;
// The package manifest sits four levels above the built module, dist/src/runtime/driver/main.js. The driver runs from dist.
// The release job bumps the manifest, so the version is read at startup, never copied into source.
const PACKAGE_JSON_RELATIVE_PATH = "../../../../package.json";
// A PEM Ed25519 public key is under 100 bytes. A larger file is not a key this driver accepts, so it is refused unread.
const MAX_GATEWAY_PUBLIC_KEY_BYTES = 4096;

export interface DriverProcessConfig {
  readonly socketPath: string;
  readonly isolationSocketPath: string;
  readonly gatewayPublicKeyPath: string;
  readonly libpodSocketPath: string;
  readonly secretRoot: string;
  readonly driver: ComputeDriverConfig;
}

// The two sockets the process serves: the compute driver's and the isolation backend's.
export interface DriverServers {
  readonly driver: SocketServer;
  readonly isolation: SocketServer;
}

type Environment = Readonly<Record<string, string | undefined>>;

// Builds the process configuration from the environment. Every value is required. A refusal names no value, so no
// configured path or digest reaches a log.
export function loadDriverProcessConfig(env: Environment, implementationVersion: string): DriverProcessConfig {
  const name = requiredValue(env, DRIVER_ENV.name);
  const socketPath = requiredAbsolute(env, DRIVER_ENV.socket);
  const sandboxImage = requiredValue(env, DRIVER_ENV.image);
  const sandboxStateRoot = requiredAbsolute(env, DRIVER_ENV.stateRoot);
  const secretRoot = requiredAbsolute(env, DRIVER_ENV.secretRoot);
  const workspaceRoot = requiredAbsolute(env, DRIVER_ENV.workspaceRoot);
  const isolationSocketPath = requiredAbsolute(env, DRIVER_ENV.isolationSocket);
  const gatewayPublicKeyPath = requiredAbsolute(env, DRIVER_ENV.gatewayPublicKey);
  const libpodSocketPath = podmanSocketPath(env);
  if (!DRIVER_NAME_PATTERN.test(name) || !IMAGE_PATTERN.test(sandboxImage) || libpodSocketPath === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return {
    socketPath,
    isolationSocketPath,
    gatewayPublicKeyPath,
    libpodSocketPath,
    secretRoot,
    driver: { driverName: name, sandboxImage, sandboxStateRoot, workspaceRoot, implementationVersion },
  };
}

// Reads the build version from a package manifest. Fails closed when the file is unreadable, is not JSON, or its
// version is not a value the gateway accepts. A refusal names no value and no path.
export function readPackageVersion(packageJsonPath: string): string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const version = typeof manifest === "object" && manifest !== null && "version" in manifest ? manifest.version : undefined;
  if (typeof version !== "string" || !isImplementationVersion(version)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return version;
}

// Reads the gateway public key. Only a regular file of bounded size is read: a directory, a FIFO or other special file, or a
// larger file is refused before it is opened, so startup cannot block on it. Every refusal is SCHEMA_INVALID.
function readGatewayPublicKey(path: string): Uint8Array {
  let info: Stats;
  try {
    info = statSync(path);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (!info.isFile() || info.size > MAX_GATEWAY_PUBLIC_KEY_BYTES) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  try {
    return readFileSync(path);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

function requiredValue(env: Environment, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return value;
}

function requiredAbsolute(env: Environment, key: string): string {
  const value = requiredValue(env, key);
  if (!value.startsWith("/")) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return value;
}

// Checks the key, sweeps, starts the isolation backend, then binds the driver's socket. The key is checked first, so a bad key
// changes no container. The sweep removes every realm container left by a previous generation before any socket exists. If
// the driver's own socket cannot be bound, the isolation backend is closed before the error is thrown.
export async function startDriver(config: DriverProcessConfig): Promise<DriverServers> {
  const verifier = new SupervisorBearerVerifier(readGatewayPublicKey(config.gatewayPublicKeyPath));
  const libpod = new LibpodClient(config.libpodSocketPath);
  const lifecycle = new DriverLifecycle({
    libpod,
    sandboxStateRoot: config.driver.sandboxStateRoot,
    secretRoot: config.secretRoot,
  });
  await lifecycle.startupSweep();
  const boundaries = new BoundaryRegistry();
  const isolation = await startIsolationBackend({
    socketPath: config.isolationSocketPath,
    implementationVersion: config.driver.implementationVersion,
    provisioning: { verifier },
    boundaries,
  });
  try {
    const driver = new ComputeDriver(config.driver, { lifecycle, libpod, boundaries });
    const server = await startSocketServer(config.socketPath, [
      { service: loadComputeDriverService(), implementation: computeDriverImplementation(driver) },
    ]);
    return { driver: server, isolation };
  } catch (error: unknown) {
    await isolation.close().catch(() => undefined);
    throw error;
  }
}

export async function main(): Promise<void> {
  const implementationVersion = readPackageVersion(fileURLToPath(new URL(PACKAGE_JSON_RELATIVE_PATH, import.meta.url)));
  const config = loadDriverProcessConfig({ ...process.env }, implementationVersion);
  const servers = await startDriver(config);
  process.stdout.write(
    `realm compute driver ${config.driver.driverName} listening on ${servers.driver.socketPath}\n`,
  );
  const stop = (): void => {
    Promise.all([servers.driver.close(), servers.isolation.close()]).then(
      () => {
        process.exit(0);
      },
      () => {
        process.exit(1);
      },
    );
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

if (isDirectEntry(import.meta.url, process.argv[1])) {
  main().catch((error: unknown) => {
    // Only the catalogue code is printed. A raw error message can carry a path or a value.
    const code = error instanceof RealmError ? error.code : "SCHEMA_INVALID";
    process.stderr.write(`realm compute driver failed to start: ${code}\n`);
    process.exitCode = 1;
  });
}
