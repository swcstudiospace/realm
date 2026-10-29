// The compute driver process (phase 9.4, PD-05; phase 9.5 starts the sandbox runtime on the built-in path). It runs as its own
// process under the realm account's user unit (HC-04). This module is the only place the driver reads process.env. It reads the
// configuration once, validates it, writes the sandbox seccomp profile, claims the driver's socket, and runs the startup sweep before
// any request can act on a container or a secret (PRD-CTR-03).

import { accessSync, constants, readFileSync, statSync } from "node:fs";
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
  type RuntimeHost,
} from "./compute-driver.js";
import { awaitRuntimeListener } from "./channel.js";
import { installSeccompProfile } from "./seccomp-delivery.js";
import { DriverLifecycle } from "./lifecycle.js";
import { GATEWAY_ID_PATTERN } from "../gateway-config.js";
import { assertSha256OfFile, spawnSupervisor } from "./supervisor.js";
import { startSocketServer, type SocketServer } from "./server.js";

export const DRIVER_ENV = Object.freeze({
  name: "REALM_DRIVER_NAME",
  socket: "REALM_DRIVER_SOCKET",
  image: "REALM_DRIVER_SANDBOX_IMAGE",
  stateRoot: "REALM_DRIVER_STATE_ROOT",
  secretRoot: "REALM_DRIVER_SECRET_ROOT",
  workspaceRoot: "REALM_DRIVER_WORKSPACE_ROOT",
  gatewayId: "REALM_DRIVER_GATEWAY_ID",
  gatewayCa: "REALM_DRIVER_GATEWAY_CA",
  supervisorBinary: "REALM_DRIVER_SUPERVISOR_BINARY",
  gatewayEndpoint: "REALM_DRIVER_GATEWAY_ENDPOINT",
  // Optional: the lowercase hex sha256 the host supervisor file must have. Every other name here is required.
  supervisorSha256: "REALM_DRIVER_SUPERVISOR_SHA256",
});

// A driver name is a short lowercase token. The gateway's [openshell.drivers.<name>] table names it.
const DRIVER_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
// The same digest-pinned form the runtime config accepts (D-52).
const IMAGE_PATTERN = /^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
// The package manifest sits four levels above the built module, dist/src/runtime/driver/main.js. The driver runs from dist.
// The release job bumps the manifest, so the version is read at startup, never copied into source.
const PACKAGE_JSON_RELATIVE_PATH = "../../../../package.json";

export interface DriverProcessConfig {
  readonly socketPath: string;
  readonly libpodSocketPath: string;
  readonly driver: ComputeDriverConfig;
  // The sha256 the host supervisor file must have, checked at load and again right before each spawn. Absent means no pin.
  readonly supervisorSha256?: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

// Builds the process configuration from the environment. Every value is required except the supervisor digest pin, and the gateway
// id must be the form the gateway configuration renders. A refusal names no value and no path, so no configured path, digest or
// identity reaches a log.
export function loadDriverProcessConfig(env: Environment, implementationVersion: string): DriverProcessConfig {
  const name = requiredValue(env, DRIVER_ENV.name);
  const socketPath = requiredAbsolute(env, DRIVER_ENV.socket);
  const sandboxImage = requiredValue(env, DRIVER_ENV.image);
  const sandboxStateRoot = requiredAbsolute(env, DRIVER_ENV.stateRoot);
  const secretRoot = requiredAbsolute(env, DRIVER_ENV.secretRoot);
  const workspaceRoot = requiredAbsolute(env, DRIVER_ENV.workspaceRoot);
  const gatewayId = requiredValue(env, DRIVER_ENV.gatewayId);
  const gatewayCaPath = requiredReadableFile(env, DRIVER_ENV.gatewayCa);
  const supervisorBinary = requiredExecutableFile(env, DRIVER_ENV.supervisorBinary);
  const gatewayEndpoint = requiredHttpsEndpoint(env, DRIVER_ENV.gatewayEndpoint);
  const supervisorSha256 = optionalSha256(env, DRIVER_ENV.supervisorSha256);
  if (supervisorSha256 !== undefined) {
    assertSha256OfFile(supervisorBinary, supervisorSha256);
  }
  const libpodSocketPath = podmanSocketPath(env);
  if (!DRIVER_NAME_PATTERN.test(name) || !IMAGE_PATTERN.test(sandboxImage) || !GATEWAY_ID_PATTERN.test(gatewayId)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (libpodSocketPath === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return {
    socketPath,
    libpodSocketPath,
    driver: {
      driverName: name,
      sandboxImage,
      sandboxStateRoot,
      secretRoot,
      workspaceRoot,
      implementationVersion,
      gatewayId,
      supervisor: { binary: supervisorBinary, gatewayEndpoint, gatewayCaPath },
    },
    ...(supervisorSha256 === undefined ? {} : { supervisorSha256 }),
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

// An absolute path to a regular file the driver can read (the gateway CA).
function requiredReadableFile(env: Environment, key: string): string {
  const value = requiredAbsolute(env, key);
  try {
    if (!statSync(value).isFile()) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    accessSync(value, constants.R_OK);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return value;
}

// An absolute path to a regular file the driver can execute (the host supervisor).
function requiredExecutableFile(env: Environment, key: string): string {
  const value = requiredAbsolute(env, key);
  try {
    if (!statSync(value).isFile()) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    accessSync(value, constants.X_OK);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return value;
}

// A lowercase hex sha256 digest, or undefined when the variable is unset. A set value that is not that form refuses, empty included.
function optionalSha256(env: Environment, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) {
    return undefined;
  }
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return value;
}

// An https URL with a host: the gateway's gRPC endpoint.
function requiredHttpsEndpoint(env: Environment, key: string): string {
  const value = requiredValue(env, key);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (url.protocol !== "https:" || url.hostname === "") {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return value;
}

// The runtime host the driver uses for the listener check and the supervisor spawn. When the process configuration carries a
// supervisor digest pin, every spawn hashes the supervisor file again and refuses with SCHEMA_INVALID on a mismatch.
export function runtimeHostOf(config: DriverProcessConfig): RuntimeHost {
  return {
    awaitListener: (controlSocket, trust) => awaitRuntimeListener(controlSocket, trust),
    spawnSupervisor: (options) =>
      spawnSupervisor(config.supervisorSha256 === undefined ? options : { ...options, expectedSha256: config.supervisorSha256 }),
  };
}

// Builds the driver. It first writes the sandbox seccomp profile next to the driver's socket, and the libpod client names that file in
// every create. It then validates the configuration without touching libpod, claims the driver's socket, and sweeps.
// The socket is claimed first: startSocketServer refuses with LOCK_CONFLICT when a live driver listens on the path and removes only
// a stale socket, so a second driver started on the same configuration is refused before it removes anything. The sweep then removes
// every realm container and every sandbox's secret entries left by a previous generation. The sweep runs while the socket accepts
// connections, so no request is served ahead of it by construction: the lifecycle refuses create, delete and stop with
// REALM_NOT_ACTIVE until the sweep has resolved, the compute driver refuses CreateSandbox the same way before it writes anything,
// and the remaining RPCs only read or answer without touching a container or a secret (PRD-CTR-03). A failed sweep closes the server,
// which removes the socket, and rethrows, so no half-started driver stays bound. The host supervisors of the previous generation
// exited when its driver's stdin pipes closed.
export async function startDriver(config: DriverProcessConfig): Promise<SocketServer> {
  const seccompProfilePath = installSeccompProfile(config.socketPath);
  const libpod = new LibpodClient(config.libpodSocketPath, { seccompProfilePath });
  const lifecycle = new DriverLifecycle({
    libpod,
    sandboxStateRoot: config.driver.sandboxStateRoot,
    secretRoot: config.driver.secretRoot,
  });
  const driver = new ComputeDriver(config.driver, {
    lifecycle,
    requireSwept: () => {
      lifecycle.requireSwept();
    },
    libpod,
    runtime: runtimeHostOf(config),
  });
  const server = await startSocketServer(config.socketPath, [
    { service: loadComputeDriverService(), implementation: computeDriverImplementation(driver) },
  ]);
  try {
    await lifecycle.startupSweep();
  } catch (error: unknown) {
    // The sweep's own failure is the one reported; a close that also fails must not replace it.
    await server.close().catch(() => undefined);
    throw error;
  }
  return server;
}

export async function main(): Promise<void> {
  const implementationVersion = readPackageVersion(fileURLToPath(new URL(PACKAGE_JSON_RELATIVE_PATH, import.meta.url)));
  const config = loadDriverProcessConfig({ ...process.env }, implementationVersion);
  const server = await startDriver(config);
  process.stdout.write(`realm compute driver ${config.driver.driverName} listening on ${server.socketPath}\n`);
  const stop = (): void => {
    server.close().then(
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
