// Control channel tests (RT-06, P6-D2, P6-D3, P6-D10, P6-D11). Every test drives the
// real module: NDJSON framing over live Unix sockets, catalogue-code-only failures,
// timeout bounds, and the 0700/0600 filesystem guards. No live daemon is started.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RealmError, ERROR_CATALOGUE, type ErrorCode } from "../../src/core/errors.js";
import {
  CONTROL_METHODS,
  MAX_CONTROL_LINE_BYTES,
  oversizedLineReply,
  readControlLine,
  CONTROL_TIMEOUT_MS,
  SOCKET_TIMEOUT_MS,
  chmodSocket,
  decodeReply,
  decodeRequest,
  describeRunDirRefusal,
  encodeReply,
  encodeRequest,
  ensureSocketDir,
  isControlMethod,
  replyForMalformedLine,
  sendRequest,
  unknownMethodReply,
} from "../../src/daemon/channel.js";
import { TOOL_CALL_TIMEOUT_MS } from "../../src/tools/dispatch.js";

// This file runs from dist/test/daemon, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CHANNEL_SOURCE = join(ROOT, "src", "daemon", "channel.ts");

const SECRET = "sk-test-0123456789abcdefghijkl";

function assertRefusesSchemaInvalid(action: () => unknown): void {
  assert.throws(
    action,
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
}

async function assertRejectsSchemaInvalid(action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(
    action(),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
}

function scratchBase(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-channel-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

async function listenUnix(t: TestContext, server: Server): Promise<string> {
  const socketPath = join(scratchBase(t), "control.sock");
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
  });
  t.after(() => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve();
    });
  });
  return socketPath;
}

async function startServer(t: TestContext, respond: (line: string) => string): Promise<string> {
  return listenUnix(
    t,
    createServer((socket) => {
      let text = "";
      socket.on("data", (chunk) => {
        text += String(chunk);
        const end = text.indexOf("\n");
        if (end === -1) {
          return;
        }
        const line = text.slice(0, end);
        text = text.slice(end + 1);
        socket.write(respond(line));
        socket.end();
      });
    }),
  );
}

test("RT-06: requests and replies round-trip over a live socket with matching ids for every control method (P6-D2)", async (t) => {
  const socketPath = await startServer(t, (line) => {
    const request = decodeRequest(line);
    if (!isControlMethod(request.method)) {
      return encodeReply(unknownMethodReply(request.id));
    }
    return encodeReply({ id: request.id, result: { method: request.method } });
  });
  let nextId = 1;
  for (const method of CONTROL_METHODS) {
    const id = nextId;
    nextId += 1;
    const reply = await sendRequest(socketPath, { id, method });
    assert.equal(reply.id, id);
    assert.deepEqual(reply.result, { method });
  }
});

test("RT-06: the control methods are exactly status, up, down, doctor, and tool, and tool outlasts one dispatcher call (P6-D2, P6-D12)", () => {
  assert.deepEqual([...CONTROL_METHODS].sort(), ["doctor", "down", "status", "tool", "up"]);
  assert.ok(
    CONTROL_TIMEOUT_MS.tool > TOOL_CALL_TIMEOUT_MS,
    "a tool request must outlast one dispatcher call",
  );
});

test("RT-06: a request line over MAX_CONTROL_LINE_BYTES is refused with a null-id SCHEMA_INVALID and never reaches the dispatcher (P6-D2, P6-D12)", async (t) => {
  const dispatched: string[] = [];
  const socketPath = await listenUnix(
    t,
    createServer((socket) => {
      // The same read-then-dispatch order the daemon uses: an oversized line is refused before any dispatch.
      void readControlLine(socket, SOCKET_TIMEOUT_MS)
        .then((read) => {
          if (!read.ok) {
            socket.end(encodeReply(oversizedLineReply()));
            return;
          }
          dispatched.push(read.line);
          socket.end(encodeReply({ id: 1, result: {} }));
        })
        .catch(() => {
          socket.destroy();
        });
    }),
  );
  const raw = await new Promise<string>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let text = "";
    socket.on("data", (chunk) => {
      text += String(chunk);
      const end = text.indexOf("\n");
      if (end !== -1) {
        socket.destroy();
        resolve(text.slice(0, end));
      }
    });
    socket.once("error", reject);
    socket.write(`${"x".repeat(MAX_CONTROL_LINE_BYTES + 1)}\n`);
  });
  assert.deepEqual(decodeReply(raw), { id: null, error: { code: "SCHEMA_INVALID" } });
  assert.deepEqual(dispatched, []);
});

test("RT-06: an unknown method replies with a catalogue code, never a raw message (P6-D2)", async (t) => {
  const socketPath = await startServer(t, (line) => {
    const request = decodeRequest(line);
    if (!isControlMethod(request.method)) {
      return encodeReply(unknownMethodReply(request.id));
    }
    return encodeReply({ id: request.id, result: {} });
  });
  const reply = await sendRequest(socketPath, { id: 41, method: "restart-everything" });
  assert.equal(reply.id, 41);
  assert.equal(reply.result, undefined);
  assert.ok(reply.error !== undefined, "unknown method must answer with an error reply");
  assert.equal(reply.error.code, "SCHEMA_INVALID");
  assert.ok(reply.error.code in ERROR_CATALOGUE, "error code must come from the catalogue");
  assert.deepEqual(Object.keys(reply).sort(), ["error", "id"]);
  assert.deepEqual(Object.keys(reply.error).sort(), ["code"]);
});

test("RT-06: encoding a reply with a non-catalogue code is refused, and decoding one throws SCHEMA_INVALID (P6-D2)", () => {
  const bogus = "BOGUS" as unknown as ErrorCode;
  assertRefusesSchemaInvalid(() => {
    encodeReply({ id: 1, error: { code: bogus } });
  });
  assertRefusesSchemaInvalid(() => {
    decodeReply('{"id":1,"error":{"code":"BOGUS"}}\n');
  });
  assertRefusesSchemaInvalid(() => {
    decodeReply('{"id":1,"result":1,"error":{"code":"SCHEMA_INVALID"}}\n');
  });
});

test("RT-06: an error reply carries a catalogue causeCode when it has one, and decoding refuses any other error field (P6-D2)", () => {
  const withCause = encodeReply({
    id: 1,
    error: { code: "OPENSHELL_START_FAILED", causeCode: "PODMAN_MACHINE_DOWN" },
  });
  assert.deepEqual(decodeReply(withCause), {
    id: 1,
    error: { code: "OPENSHELL_START_FAILED", causeCode: "PODMAN_MACHINE_DOWN" },
  });
  const withoutCause = encodeReply({ id: 2, error: { code: "TOOL_TIMEOUT" } });
  const decoded = decodeReply(withoutCause);
  assert.deepEqual(decoded, { id: 2, error: { code: "TOOL_TIMEOUT" } });
  assert.equal(Object.hasOwn(decoded.error ?? {}, "causeCode"), false);
  assertRefusesSchemaInvalid(() => {
    encodeReply({ id: 3, error: { code: "TOOL_TIMEOUT", causeCode: "BOGUS" as unknown as ErrorCode } });
  });
  assertRefusesSchemaInvalid(() => {
    decodeReply('{"id":4,"error":{"code":"TOOL_TIMEOUT","causeCode":"BOGUS"}}\n');
  });
  assertRefusesSchemaInvalid(() => {
    decodeReply('{"id":5,"error":{"code":"TOOL_TIMEOUT","message":"raw text"}}\n');
  });
});

test("RT-06: a malformed line is rejected with fixed text and never throws a raw error across the boundary (P6-D2)", () => {
  const fixed = ERROR_CATALOGUE["SCHEMA_INVALID"].reason;
  for (const line of [`not json {{{ ${SECRET}`, `["an", "array"]`, `{"method":"status"}`, ""]) {
    assert.throws(
      () => {
        decodeRequest(line);
      },
      (error: unknown) =>
        error instanceof RealmError &&
        error.code === "SCHEMA_INVALID" &&
        error.message === fixed &&
        !error.message.includes(SECRET),
    );
    assert.throws(
      () => {
        decodeReply(line);
      },
      (error: unknown) =>
        error instanceof RealmError &&
        error.code === "SCHEMA_INVALID" &&
        error.message === fixed &&
        !error.message.includes(SECRET),
    );
  }
  assert.equal(replyForMalformedLine(`garbage {{{ ${SECRET}`), null);
  assert.equal(replyForMalformedLine('{"method":"status"}'), null);
  assert.equal(
    replyForMalformedLine(encodeRequest({ id: 9, method: "status" })),
    null,
    "a well-formed line is not malformed",
  );
  const recovered = replyForMalformedLine('{"id":7,"method":42}');
  assert.deepEqual(recovered, { id: 7, error: { code: "SCHEMA_INVALID" } });
});

test("RT-06: a peer that never answers rejects with TOOL_TIMEOUT inside the injected bound (P6-D2)", async (t) => {
  assert.equal(SOCKET_TIMEOUT_MS, 5000, "the default bound stays 5000 ms per OQ-P6-01");
  const socketPath = await listenUnix(
    t,
    createServer(() => {
      // Accept and hold silent: the client must bound the wait itself.
    }),
  );
  const start = Date.now();
  await assert.rejects(
    sendRequest(socketPath, { id: 1, method: "status" }, { timeoutMs: 50 }),
    (error: unknown) => error instanceof RealmError && error.code === "TOOL_TIMEOUT",
  );
  assert.ok(Date.now() - start < 2000, "the bounded wait must return promptly, never hang");
});

test("RT-06: garbage bytes and an id mismatch from the peer surface SCHEMA_INVALID, never a raw error (P6-D2)", async (t) => {
  const garbagePath = await listenUnix(
    t,
    createServer((socket) => {
      socket.write(`not json {{{ ${SECRET}\n`);
      socket.end();
    }),
  );
  await assert.rejects(
    sendRequest(garbagePath, { id: 1, method: "status" }),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "SCHEMA_INVALID" &&
      error.message === ERROR_CATALOGUE["SCHEMA_INVALID"].reason &&
      !error.message.includes(SECRET),
  );
  const mismatchPath = await startServer(t, () => encodeReply({ id: 999, result: {} }));
  await assertRejectsSchemaInvalid(() => sendRequest(mismatchPath, { id: 1, method: "status" }));
});

test("RT-06: ensureSocketDir creates stateDir/run at mode 0700 when absent and accepts it on return (P6-D3)", (t) => {
  const stateDir = join(scratchBase(t), "state");
  const runDir = ensureSocketDir(stateDir);
  assert.equal(runDir, join(stateDir, "run"));
  assert.equal(statSync(runDir).mode & 0o777, 0o700);
  assert.equal(ensureSocketDir(stateDir), runDir, "a compliant directory is accepted again");
});

test("RT-06: a fresh state directory is created at mode 0700, and so is its run directory (P6-D3)", (t) => {
  const stateDir = join(scratchBase(t), "state");
  const runDir = ensureSocketDir(stateDir);
  assert.equal(statSync(stateDir).mode & 0o777, 0o700, "the fresh state directory must not keep the default mode");
  assert.equal(statSync(runDir).mode & 0o777, 0o700, "the fresh run directory must be 0700");
});

test("RT-06: ensureSocketDir refuses a wrong mode, a foreign owner, or a non-directory with SCHEMA_INVALID (P6-D3, P6-D11)", (t) => {
  const stateDir = join(scratchBase(t), "state");
  const runDir = ensureSocketDir(stateDir);
  chmodSync(runDir, 0o755);
  assertRefusesSchemaInvalid(() => {
    ensureSocketDir(stateDir);
  });
  chmodSync(runDir, 0o700);

  const foreignOwner = {
    stat: () => ({ mode: 0o40700, uid: 11111, isDirectory: () => true }),
    getuid: () => 22222,
  };
  assertRefusesSchemaInvalid(() => {
    ensureSocketDir(stateDir, foreignOwner);
  });
  const wrongMode = {
    stat: () => ({ mode: 0o40755, uid: 22222, isDirectory: () => true }),
    getuid: () => 22222,
  };
  assertRefusesSchemaInvalid(() => {
    ensureSocketDir(stateDir, wrongMode);
  });
  const notDirectory = {
    stat: () => ({ mode: 0o100700, uid: 22222, isDirectory: () => false }),
  };
  assertRefusesSchemaInvalid(() => {
    ensureSocketDir(stateDir, notDirectory);
  });
  const unreadable = {
    stat: (): never => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    },
  };
  assertRefusesSchemaInvalid(() => {
    ensureSocketDir(stateDir, unreadable);
  });
  const missingStat = {
    stat: (): never => {
      throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    },
    mkdir: (): never => {
      throw new Error("cannot create");
    },
  };
  assertRefusesSchemaInvalid(() => {
    ensureSocketDir(join(scratchBase(t), "elsewhere"), missingStat);
  });
});

test("RT-06: chmodSocket applies mode 0600 after listen, and the injected seam observes the call (P6-D3)", (t) => {
  const base = scratchBase(t);
  const socketPath = join(base, "control.sock");
  writeFileSync(socketPath, "");
  chmodSocket(socketPath);
  assert.equal(statSync(socketPath).mode & 0o777, 0o600);
  const seen: Array<{ path: string; mode: number }> = [];
  chmodSocket(socketPath, {
    chmod: (path, mode) => {
      seen.push({ path, mode });
    },
  });
  assert.deepEqual(seen, [{ path: socketPath, mode: 0o600 }]);
  assertRefusesSchemaInvalid(() => {
    chmodSocket(join(base, "missing.sock"));
  });
});

test("RT-06: describeRunDirRefusal names the expected mode and the observed state (P6-D11)", () => {
  const modeRefusal = describeRunDirRefusal({ mode: 0o40755, uid: 1000, isDirectory: true }, 1000);
  assert.ok(modeRefusal.includes("755"), "observed mode is named");
  assert.ok(modeRefusal.includes("700"), "expected mode is named");
  const ownerRefusal = describeRunDirRefusal({ mode: 0o40700, uid: 1000, isDirectory: true }, 2000);
  assert.ok(ownerRefusal.includes("1000"), "observed uid is named");
  assert.ok(ownerRefusal.includes("2000"), "expected uid is named");
  const dirRefusal = describeRunDirRefusal({ mode: 0o100700, uid: 1000, isDirectory: false }, 1000);
  assert.ok(dirRefusal.includes("700"), "expected mode is named for a non-directory");
});

test("RT-06: the channel module imports only its five allowlisted modules and touches no foreign socket surface (P6-D10)", () => {
  const source = readFileSync(CHANNEL_SOURCE, "utf8");
  const specifiers = [...source.matchAll(/^import .* from "([^"]+)";/gm)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
  assert.deepEqual(specifiers.sort(), [
    "../core/errors.js",
    "../core/timeout.js",
    "../session/paths.js",
    "node:fs",
    "node:net",
  ]);
  for (const word of ["podman", "docker", "container", "child_process", "spawn(", "process.env"]) {
    assert.ok(
      !source.toLowerCase().includes(word),
      `channel source must not mention ${word}`,
    );
  }
  const withoutControlSock = source.replaceAll("control.sock", "");
  assert.ok(!withoutControlSock.includes(".sock"), "no socket path literal besides control.sock");
  assert.ok(source.includes("encodeRequest"), "sanity: the read source is the channel module");
});

test("RT-06: a reply longer than MAX_CONTROL_LINE_BYTES is refused with SCHEMA_INVALID, and its socket closes (P6-D2)", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-reply-cap-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const socketPath = join(dir, "stub.sock");
  // A valid reply about 2 MiB long: a client that read it whole would accept it.
  const payload = `${JSON.stringify({ id: "big-1", result: "x".repeat(2 * 1024 * 1024) })}\n`;
  const stub = createServer((socket) => {
    // The client refuses the reply and closes, so the stub's write may fail after that.
    socket.on("error", () => undefined);
    socket.once("data", () => {
      socket.end(payload);
    });
  });
  await new Promise<void>((resolve) => {
    stub.listen(socketPath, resolve);
  });
  t.after(() => {
    stub.close();
  });
  const failure: unknown = await sendRequest(socketPath, { id: "big-1", method: "status" }).then(
    () => undefined,
    (error: unknown) => error,
  );
  assert.ok(failure instanceof RealmError && failure.code === "SCHEMA_INVALID");
});
