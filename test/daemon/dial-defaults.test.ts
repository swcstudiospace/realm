// The daemon's default socket dialer returns the same outcome as the shared dial helper (Q0-003), and a missed
// deadline is a RealmError with a catalogue code (Q0-016).

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, Socket, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { RealmError } from "../../src/core/errors.js";
import { defaultConnectSocket } from "../../src/daemon/seams.js";
import { testTimeout } from "../support/timing.js";

function socketDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-daemon-dial-"));
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

void test("Q0-003: the daemon dialer resolves when a listener accepts the connection", async (t) => {
  const path = join(socketDir(t), "control.sock");
  const server = await listenAt(path);
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );
  const accepted = new Promise<Socket>((resolve) => {
    server.once("connection", resolve);
  });
  await defaultConnectSocket(path, 1000);
  assert.ok((await accepted) instanceof Socket);
});

void test("Q0-003: the daemon dialer rejects with the socket's own ENOENT error when the socket is absent", async (t) => {
  const path = join(socketDir(t), "absent.sock");
  await assert.rejects(defaultConnectSocket(path, 1000), (error: unknown) => {
    assert.equal(error instanceof RealmError, false, "a missing socket is not a timeout");
    assert.ok(error instanceof Error && "code" in error && error.code === "ENOENT");
    return true;
  });
});

void test("Q0-016: the daemon dialer's missed deadline is a RealmError with a catalogue code", testTimeout(30_000), async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  const path = join(socketDir(t), "silent.sock");
  const server = await listenAt(path);
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );
  const dialed = defaultConnectSocket(path, 50);
  t.mock.timers.tick(50);
  await assert.rejects(dialed, (error: unknown) => {
    assert.ok(error instanceof RealmError, "the missed deadline must be a RealmError");
    assert.equal(error.code, "PODMAN_MACHINE_DOWN");
    return true;
  });
});
