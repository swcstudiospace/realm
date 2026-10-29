// The runtime's listener, its key removal, the TLS work-directory removal, and the control socket path limit (phase 9.5, waves 2
// and 3). The listener is confirmed by a completed TLS handshake, never by a socket file or a plain connection: a socket that
// accepts a connection and does not finish TLS does not confirm, and neither does a socket with no listener behind it. A removal
// that cannot finish raises a catalogue error that names no path. A control socket path longer than a unix socket address holds is
// refused before any write or libpod call. No test reads source text.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createServer as createTlsServer } from "node:tls";
import { RealmError, type ErrorCode } from "../../../src/core/errors.js";
import { assertSocketPathsFit, awaitRuntimeListener, removeKeyFile, removeTlsWorkDirectory, type ListenerTrust } from "../../../src/runtime/driver/channel.js";
import { ComputeDriver } from "../../../src/runtime/driver/compute-driver.js";
import { FakeLibpod, FakeRuntime, diskLifecycle, driverConfig, validSandbox } from "./fakes.js";

const SANDBOX = "realm-session-1";
// The bytes of the control socket path after the secret root: "/<sandbox>/channel/control.sock".
const TAIL_BYTES = Buffer.byteLength(`/${SANDBOX}/channel/control.sock`, "utf8");
const SOCKET_LIMIT_BYTES = 107;
const SERVER_NAME = "sandbox.test-session.openshell.internal";

function scratchDirectory(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-listen-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function codeIs(code: ErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof RealmError && error.code === code;
}

// A self-signed leaf for the server name, with its key. Node trusts it when it is given as the CA.
function tlsFixture(t: TestContext): ListenerTrust & { readonly keyPem: string } {
  const dir = scratchDirectory(t);
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
      "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", `/CN=${SERVER_NAME}`,
      "-addext", `subjectAltName=DNS:${SERVER_NAME}`, "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,digitalSignature,keyCertSign",
    ],
    { stdio: "ignore" },
  );
  return {
    caPem: readFileSync(certPath, "utf8"),
    keyPem: readFileSync(keyPath, "utf8"),
    serverName: SERVER_NAME,
  };
}

// Starts a server on the path and closes it, with every connection it accepted, when the test ends. Each socket is tracked so a
// stalled connection cannot hold the close.
async function startListener(t: TestContext, server: Server, path: string): Promise<void> {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {
      socket.destroy();
    });
    socket.once("close", () => {
      sockets.delete(socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  t.after(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => {
          resolve();
        });
      }),
  );
}

void test("a regular file at the control socket path is not confirmed, and the wait gives up at its deadline (phase 9.5, wave 3)", async (t) => {
  const trust = tlsFixture(t);
  const socketPath = join(scratchDirectory(t), "control.sock");
  writeFileSync(socketPath, "");
  await assert.rejects(awaitRuntimeListener(socketPath, trust, 0), codeIs("OPENSHELL_START_FAILED"));
});

void test("a fake TLS listener is confirmed by a completed handshake, even when the wait starts before it binds (phase 9.5, wave 3)", async (t) => {
  const trust = tlsFixture(t);
  const socketPath = join(scratchDirectory(t), "control.sock");
  const confirmed = awaitRuntimeListener(socketPath, trust, 5000);
  await startListener(t, createTlsServer({ key: trust.keyPem, cert: trust.caPem }), socketPath);
  await confirmed;
  assert.equal(lstatSync(socketPath).isSocket(), true);
});

void test("a socket that accepts connections but never completes TLS does not confirm, and the wait gives up at its deadline (phase 9.5, wave 3)", async (t) => {
  const trust = tlsFixture(t);
  const socketPath = join(scratchDirectory(t), "control.sock");
  // The connection is accepted and read nothing back: the client's handshake never completes.
  await startListener(t, createServer(() => undefined), socketPath);
  await assert.rejects(awaitRuntimeListener(socketPath, trust, 300), codeIs("OPENSHELL_START_FAILED"));
});

void test("a socket that accepts and resets every connection does not confirm, and the wait gives up at its deadline (phase 9.5, wave 3)", async (t) => {
  const trust = tlsFixture(t);
  const socketPath = join(scratchDirectory(t), "control.sock");
  await startListener(
    t,
    createServer((socket) => {
      socket.destroy();
    }),
    socketPath,
  );
  await assert.rejects(awaitRuntimeListener(socketPath, trust, 300), codeIs("OPENSHELL_START_FAILED"));
});

void test("a TLS listener whose certificate does not match the expected server name does not confirm (phase 9.5, wave 3)", async (t) => {
  const trust = tlsFixture(t);
  const socketPath = join(scratchDirectory(t), "control.sock");
  await startListener(t, createTlsServer({ key: trust.keyPem, cert: trust.caPem }), socketPath);
  await assert.rejects(
    awaitRuntimeListener(socketPath, { caPem: trust.caPem, serverName: "other.test-session.openshell.internal" }, 300),
    codeIs("OPENSHELL_START_FAILED"),
  );
});

void test("a stale socket file that nothing listens on does not confirm, and the wait gives up at once (phase 9.5, N2)", async (t) => {
  const trust = tlsFixture(t);
  const socketPath = join(scratchDirectory(t), "control.sock");
  // A child process binds the socket and is killed while it listens, so the socket file stays with no listener behind it.
  const child = spawn(process.execPath, ["-e", "require('node:net').createServer().listen(process.env.SOCK, () => process.stdout.write('ready\\n'));"], {
    env: { ...process.env, SOCK: socketPath },
    stdio: ["ignore", "pipe", "ignore"],
  });
  await once(child.stdout, "data");
  child.kill("SIGKILL");
  await once(child, "exit");
  assert.equal(lstatSync(socketPath).isSocket(), true, "the stale socket file is present");
  await assert.rejects(awaitRuntimeListener(socketPath, trust, 0), codeIs("OPENSHELL_START_FAILED"));
});

void test("a key is removed and confirmed gone; a key already absent counts as removed; a key that cannot be removed is CLEANUP_FAILED with no path (phase 9.5, C and E)", (t) => {
  const dir = scratchDirectory(t);
  const key = join(dir, "server.key");
  writeFileSync(key, "key");
  removeKeyFile(key);
  assert.equal(existsSync(key), false);
  removeKeyFile(key);
  const asDirectory = join(dir, "server.key.d");
  mkdirSync(asDirectory);
  assert.throws(
    () => {
      removeKeyFile(asDirectory);
    },
    (error: unknown) => error instanceof RealmError && error.code === "CLEANUP_FAILED" && !error.message.includes(dir),
  );
});

void test("a TLS work directory that cannot be removed raises CLEANUP_FAILED, and its message names no path (phase 9.5, E)", (t) => {
  const dir = scratchDirectory(t);
  const blocker = join(dir, "not-a-directory");
  writeFileSync(blocker, "");
  const tlsDir = join(blocker, "tls");
  assert.throws(
    () => {
      removeTlsWorkDirectory(tlsDir);
    },
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "CLEANUP_FAILED" &&
      !error.message.includes(tlsDir) &&
      !error.message.includes(dir),
  );
});

// The host path of control.sock is the secret root joined with the sandbox's tail. A secret root of the given length makes the
// host path exactly that many bytes.
void test("a control socket host path of 107 bytes is accepted, and 108 bytes is refused before any write or libpod call (phase 9.5, G)", async (t) => {
  const base = scratchDirectory(t);
  for (const length of [SOCKET_LIMIT_BYTES, SOCKET_LIMIT_BYTES + 1]) {
    const secretRoot = join(base, "s".repeat(length - TAIL_BYTES - base.length - 1));
    assert.equal(Buffer.byteLength(join(secretRoot, SANDBOX, "channel", "control.sock"), "utf8"), length);
    const config = driverConfig({ secretRoot });
    const libpod = new FakeLibpod();
    const lifecycle = await diskLifecycle(config, libpod);
    const runtime = new FakeRuntime();
    const driver = new ComputeDriver(config, { lifecycle, libpod, runtime });
    if (length === SOCKET_LIMIT_BYTES) {
      await driver.createSandbox(validSandbox());
      assert.equal(runtime.confirmations.length, 1);
      continue;
    }
    assert.throws(() => driver.validateSandboxCreate(validSandbox()), codeIs("SCHEMA_INVALID"));
    await assert.rejects(driver.createSandbox(validSandbox()), codeIs("SCHEMA_INVALID"));
    assert.deepEqual(lifecycle.creates, []);
    assert.equal(libpod.inspectCalls, 0);
    assert.equal(existsSync(secretRoot), false, "no secret directory is written");
    assert.equal(existsSync(join(config.sandboxStateRoot, SANDBOX)), false, "no state directory is written");
  }
});

// assertSocketPathsFit takes the list of paths, so an SSH-only overflow is built directly: the control and container paths fit and
// only the SSH path is longer than a unix socket address holds.
void test("an SSH socket path of 107 bytes is accepted, and 108 bytes is refused while the other paths fit (phase 9.6)", () => {
  const fitting = "/run/control.sock";
  assert.doesNotThrow(() => {
    assertSocketPathsFit([fitting, "/" + "s".repeat(SOCKET_LIMIT_BYTES - 1)]);
  });
  assert.throws(
    () => {
      assertSocketPathsFit([fitting, "/" + "s".repeat(SOCKET_LIMIT_BYTES)]);
    },
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
});
