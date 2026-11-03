// The doctor's default dialers return the outcome of the shared dial helper (Q0-003), and every rejection they make
// for a configuration or dial failure is a RealmError with a catalogue code (Q0-016).

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { ERROR_CODES, RealmError } from "../../src/core/errors.js";
import { defaultConnectSocket } from "../../src/doctor/checks.js";
import { defaultConnectDriver, defaultConnectGateway } from "../../src/doctor/runtime-checks.js";
import { testTimeout } from "../support/timing.js";

function socketDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-doctor-dial-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function listenAt(path: string): Promise<Server> {
  return new Promise<Server>((resolve) => {
    const server = createServer();
    server.listen(path, () => {
      resolve(server);
    });
  });
}

function closeAfter(t: TestContext, server: Server): void {
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );
}

function assertCatalogueError(error: unknown, code: (typeof ERROR_CODES)[number]): void {
  assert.ok(error instanceof RealmError, "the rejection must be a RealmError");
  assert.ok(ERROR_CODES.includes(error.code), "its code is in the catalogue");
  assert.equal(error.code, code);
}

void test("Q0-003: the doctor socket dialer resolves when a listener accepts the connection", async (t) => {
  const path = join(socketDir(t), "control.sock");
  const server = await listenAt(path);
  closeAfter(t, server);
  await assert.doesNotReject(defaultConnectSocket(path, 1000));
});

void test("Q0-003: the doctor socket dialer rejects with the socket's own ENOENT error when the socket is absent", async (t) => {
  const path = join(socketDir(t), "absent.sock");
  await assert.rejects(defaultConnectSocket(path, 1000), (error: unknown) => {
    assert.equal(error instanceof RealmError, false, "a missing socket is not a timeout");
    assert.ok(error instanceof Error && "code" in error && error.code === "ENOENT");
    return true;
  });
});

void test("Q0-016: the doctor socket dialer's missed deadline is a RealmError with a catalogue code", testTimeout(30_000), async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  const path = join(socketDir(t), "silent.sock");
  const server = await listenAt(path);
  closeAfter(t, server);
  const dialed = defaultConnectSocket(path, 50);
  t.mock.timers.tick(50);
  await assert.rejects(dialed, (error: unknown) => {
    assertCatalogueError(error, "PODMAN_MACHINE_DOWN");
    return true;
  });
});

void test("Q0-003: the driver dialer resolves when the driver socket accepts the connection", async (t) => {
  const path = join(socketDir(t), "driver.sock");
  const server = await listenAt(path);
  closeAfter(t, server);
  await assert.doesNotReject(defaultConnectDriver(path, 1000));
});

void test("Q0-016: a driver socket that is absent rejects with OPENSHELL_GATEWAY_LOST", async (t) => {
  const path = join(socketDir(t), "absent-driver.sock");
  await assert.rejects(defaultConnectDriver(path, 1000), (error: unknown) => {
    assertCatalogueError(error, "OPENSHELL_GATEWAY_LOST");
    return true;
  });
});

void test("Q0-016: a driver socket that misses its deadline rejects with OPENSHELL_GATEWAY_LOST", testTimeout(30_000), async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  const path = join(socketDir(t), "silent-driver.sock");
  const server = await listenAt(path);
  closeAfter(t, server);
  const dialed = defaultConnectDriver(path, 50);
  t.mock.timers.tick(50);
  await assert.rejects(dialed, (error: unknown) => {
    assertCatalogueError(error, "OPENSHELL_GATEWAY_LOST");
    return true;
  });
});

void test("Q0-016: a gateway endpoint that is not a URL rejects with SCHEMA_INVALID", async (t) => {
  const caPath = join(socketDir(t), "ca.pem");
  await assert.rejects(defaultConnectGateway("not a url", caPath, 1000), (error: unknown) => {
    assertCatalogueError(error, "SCHEMA_INVALID");
    return true;
  });
});

void test("Q0-016: a gateway endpoint that is not https rejects with SCHEMA_INVALID", async (t) => {
  const caPath = join(socketDir(t), "ca.pem");
  await assert.rejects(defaultConnectGateway("http://127.0.0.1:443", caPath, 1000), (error: unknown) => {
    assertCatalogueError(error, "SCHEMA_INVALID");
    return true;
  });
});

void test("Q0-016: a gateway CA file that cannot be read rejects with SCHEMA_INVALID", async (t) => {
  const caPath = join(socketDir(t), "missing-ca.pem");
  await assert.rejects(defaultConnectGateway("https://127.0.0.1:443", caPath, 1000), (error: unknown) => {
    assertCatalogueError(error, "SCHEMA_INVALID");
    return true;
  });
});
