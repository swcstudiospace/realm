// Unix-socket dial with a deadline (Q0-003). Each of the four outcomes is asserted on what the caller observes:
// the connected socket, the socket's own error, or the RealmError the caller gave for a missed deadline.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { dialWithin } from "../../src/core/timeout.js";
import { RealmError } from "../../src/core/errors.js";
import { testTimeout } from "../support/timing.js";

function socketDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-dial-"));
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

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

function errnoCodeOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

void test("Q0-003: dialWithin rejects with the socket's own ENOENT error when no socket file exists, not a RealmError", async (t) => {
  const path = join(socketDir(t), "absent.sock");
  await assert.rejects(dialWithin(path, 1000, "TOOL_TIMEOUT"), (error: unknown) => {
    assert.equal(error instanceof RealmError, false, "a missing socket is not a timeout");
    assert.equal(errnoCodeOf(error), "ENOENT");
    return true;
  });
});

void test("Q0-003: dialWithin rejects with the socket's own ECONNREFUSED error when the path is not a listening socket", async (t) => {
  const path = join(socketDir(t), "refused.sock");
  writeFileSync(path, "");
  await assert.rejects(dialWithin(path, 1000, "TOOL_TIMEOUT"), (error: unknown) => {
    assert.equal(error instanceof RealmError, false, "a refused socket is not a timeout");
    assert.equal(errnoCodeOf(error), "ECONNREFUSED");
    return true;
  });
});

void test("Q0-003: dialWithin resolves with an open, connected socket when a listener accepts", async (t) => {
  const path = join(socketDir(t), "accepting.sock");
  const server = await listenAt(path);
  t.after(() => closeServer(server));
  const socket = await dialWithin(path, 1000, "TOOL_TIMEOUT");
  assert.equal(socket.destroyed, false, "a connected socket is handed to the caller open");
  socket.destroy();
});

void test("Q0-003: dialWithin rejects with the given RealmError when the timer fires first, and destroys its socket", testTimeout(30_000), async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  const path = join(socketDir(t), "silent.sock");
  const server = await listenAt(path);
  t.after(() => closeServer(server));
  // The server-side end of the connection closes only once the client has destroyed its socket.
  const serverSideClosed = new Promise<void>((resolve) => {
    server.on("connection", (accepted) => {
      accepted.on("close", () => {
        resolve();
      });
      accepted.resume();
    });
  });
  // The timer is ticked before the connect event can be delivered, so the deadline wins the race.
  const dialed = dialWithin(path, 50, "TOOL_TIMEOUT");
  t.mock.timers.tick(50);
  await assert.rejects(dialed, (error: unknown) => {
    assert.ok(error instanceof RealmError, "a missed deadline is a RealmError");
    assert.equal(error.code, "TOOL_TIMEOUT");
    return true;
  });
  await serverSideClosed;
});
