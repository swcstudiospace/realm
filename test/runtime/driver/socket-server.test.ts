import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RealmError } from "../../../src/core/errors.js";
import {
  ComputeDriver,
  COMPUTE_DRIVER_SERVICE_NAME,
  computeDriverImplementation,
  loadComputeDriverService,
} from "../../../src/runtime/driver/compute-driver.js";
import {
  credentials,
  makeClientConstructor,
  status,
  type ServiceError,
  type UntypedServiceImplementation,
} from "@grpc/grpc-js";
import { SHUTDOWN_GRACE_MS, startSocketServer, type SocketServer } from "../../../src/runtime/driver/server.js";
import { FakeLibpod, FakeLifecycle, FakeRuntime, driverConfig, socketDirectory } from "./fakes.js";

async function startOn(socketPath: string): Promise<SocketServer> {
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(driverConfig(), {
    lifecycle: new FakeLifecycle(libpod),
    libpod,
    runtime: new FakeRuntime(),
  });
  return startSocketServer(socketPath, [
    { service: loadComputeDriverService(), implementation: computeDriverImplementation(driver) },
  ]);
}

function modeOf(path: string): number {
  return lstatSync(path).mode & 0o777;
}

function expectCode(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof RealmError && error.code === code;
}

// A child process binds a unix socket and is killed before it can clean up, so the socket file is left with no listener.
// That is the stale socket a crashed driver leaves behind.
async function leaveStaleSocket(socketPath: string): Promise<void> {
  const script = `require("node:net").createServer().listen(process.argv[1], () => process.stdout.write("ready\\n"));`;
  const child = spawn(process.execPath, ["-e", script, socketPath], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => {
      resolve();
    });
    child.once("error", reject);
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  child.kill("SIGKILL");
  await exited;
}

void test("PRD-DRV-01: the parent directory is 0700 and the socket is 0600, and the socket is removed on close", async () => {
  const socketPath = join(socketDirectory(), "run", "driver.sock");
  const server = await startOn(socketPath);
  assert.equal(modeOf(join(socketPath, "..")), 0o700);
  assert.equal(lstatSync(socketPath).isSocket(), true);
  assert.equal(modeOf(socketPath), 0o600);
  await server.close();
  assert.equal(existsSync(socketPath), false);
});

void test("PRD-DRV-01: a regular file at the socket path is refused and left in place", async () => {
  const socketPath = join(socketDirectory(), "driver.sock");
  writeFileSync(socketPath, "not a socket");
  await assert.rejects(startOn(socketPath), expectCode("SCHEMA_INVALID"));
  assert.equal(lstatSync(socketPath).isFile(), true);
});

void test("PRD-DRV-01: a symbolic link as the parent directory is refused and never followed", async () => {
  const dir = socketDirectory();
  const real = join(dir, "real");
  mkdirSync(real, { mode: 0o700 });
  const linked = join(dir, "linked");
  symlinkSync(real, linked);
  await assert.rejects(startOn(join(linked, "driver.sock")), expectCode("SCHEMA_INVALID"));
  assert.equal(existsSync(join(real, "driver.sock")), false);
});

void test("PRD-DRV-01: a stale socket with no listener is removed and replaced by a 0600 socket", async () => {
  const socketPath = join(socketDirectory(), "driver.sock");
  await leaveStaleSocket(socketPath);
  assert.equal(lstatSync(socketPath).isSocket(), true);
  const server = await startOn(socketPath);
  assert.equal(modeOf(socketPath), 0o600);
  await server.close();
});

void test("PRD-DRV-01: a socket with a live listener is refused and not replaced", async () => {
  const socketPath = join(socketDirectory(), "driver.sock");
  const first = await startOn(socketPath);
  await assert.rejects(startOn(socketPath), expectCode("LOCK_CONFLICT"));
  assert.equal(lstatSync(socketPath).isSocket(), true);
  await first.close();
});

void test("PRD-DRV-01: a relative socket path is refused", async () => {
  await assert.rejects(startOn("driver.sock"), expectCode("SCHEMA_INVALID"));
});

interface OpenWatch {
  readonly server: SocketServer;
  readonly socketPath: string;
  readonly finished: Promise<{ readonly code: number }>;
  readonly closeClient: () => void;
}

// A server whose WatchSandboxes handler accepts the call and never ends it, as the gateway's long-lived watch behaves, and a
// real client with that call open. The promise resolves once the server holds the call.
async function openNeverEndingWatch(shutdownGraceMs: number): Promise<OpenWatch> {
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(driverConfig(), {
    lifecycle: new FakeLifecycle(libpod),
    libpod,
    runtime: new FakeRuntime(),
  });
  const service = loadComputeDriverService();
  let markHeld: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  const implementation: UntypedServiceImplementation = {
    ...computeDriverImplementation(driver),
    WatchSandboxes: (): void => {
      markHeld();
    },
  };
  const socketPath = join(socketDirectory(), "driver.sock");
  const server = await startSocketServer(
    socketPath,
    [{ service, implementation }],
    { shutdownGraceMs },
  );
  const Constructor = makeClientConstructor(service, COMPUTE_DRIVER_SERVICE_NAME);
  const client = new Constructor(`unix:${socketPath}`, credentials.createInsecure());
  const watch = service["WatchSandboxes"];
  if (watch === undefined) {
    throw new Error("the service has no WatchSandboxes method");
  }
  const stream = client.makeServerStreamRequest(watch.path, watch.requestSerialize, watch.responseDeserialize, {});
  const finished = new Promise<{ readonly code: number }>((resolve) => {
    stream.once("status", (state: { code: number }) => {
      resolve({ code: state.code });
    });
    stream.once("error", (error: ServiceError) => {
      resolve({ code: error.code });
    });
  });
  await held;
  return { server, socketPath, finished, closeClient: () => { client.close(); } };
}

void test("PRD-DRV-01: close cancels a stream the implementation never ends once the grace passes, and removes the socket", { timeout: 20_000 }, async () => {
  const open = await openNeverEndingWatch(100);
  const started = Date.now();
  await open.server.close();
  assert.ok(Date.now() - started < 5000, "close must not wait for the open stream");
  const outcome = await open.finished;
  assert.notEqual(outcome.code, status.OK);
  assert.equal(existsSync(open.socketPath), false);
  open.closeClient();
});

void test("PRD-DRV-01: close with no open calls resolves at once and removes the socket, and a second close is the same close", { timeout: 20_000 }, async () => {
  const socketPath = join(socketDirectory(), "driver.sock");
  const server = await startOn(socketPath);
  const started = Date.now();
  const first = server.close();
  const second = server.close();
  assert.equal(first, second);
  await first;
  assert.ok(Date.now() - started < SHUTDOWN_GRACE_MS, "an idle server must not wait out the grace");
  assert.equal(existsSync(socketPath), false);
});

void test("PRD-DRV-01: a negative or non-finite shutdown grace is refused before binding", async () => {
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(driverConfig(), {
    lifecycle: new FakeLifecycle(libpod),
    libpod,
    runtime: new FakeRuntime(),
  });
  const bound = [{ service: loadComputeDriverService(), implementation: computeDriverImplementation(driver) }];
  const socketPath = join(socketDirectory(), "driver.sock");
  await assert.rejects(startSocketServer(socketPath, bound, { shutdownGraceMs: -1 }), expectCode("SCHEMA_INVALID"));
  await assert.rejects(startSocketServer(socketPath, bound, { shutdownGraceMs: Number.NaN }), expectCode("SCHEMA_INVALID"));
  assert.equal(existsSync(socketPath), false);
});
