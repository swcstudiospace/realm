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
  DaemonAbsentError,
  CONTROL_METHODS,
  MAX_CONTROL_LINE_BYTES,
  oversizedLineReply,
  readControlLine,
  CONTROL_TIMEOUT_MS,
  SOCKET_TIMEOUT_MS,
  chmodSocket,
  decodeReply,
  decodeRequest,
  encodeReply,
  encodeRequest,
  ensureSocketDir,
  isControlMethod,
  replyForMalformedLine,
  sendRequest,
  unknownMethodReply,
  parseControlSelection,
} from "../../src/daemon/channel.js";
import { validate } from "../../src/contract/validate.js";
import { TOOL_CALL_TIMEOUT_MS } from "../../src/tools/dispatch.js";

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

void test("RT-06: requests and replies round-trip over a live socket with matching ids for every control method (P6-D2)", async (t) => {
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

void test("RT-06: the control methods are exactly status, up, down, doctor, tool, and metrics, and tool outlasts one dispatcher call (P6-D2, P6-D12)", () => {
  assert.deepEqual([...CONTROL_METHODS].sort(), ["doctor", "down", "metrics", "status", "tool", "up"]);
  assert.ok(
    CONTROL_TIMEOUT_MS.tool > TOOL_CALL_TIMEOUT_MS,
    "a tool request must outlast one dispatcher call",
  );
});

void test("RT-06: the up request outlasts the policy startup budget by a positive margin, and the other methods keep their bounds", () => {
  const policy = validate("policy", {});
  assert.ok(policy.ok, "an empty policy resolves to the schema defaults");
  assert.ok(
    CONTROL_TIMEOUT_MS.up > policy.value.startupBudgetMs,
    "an up request must not time out inside the default startup budget",
  );
  assert.equal(CONTROL_TIMEOUT_MS.status, 5_000);
  assert.equal(CONTROL_TIMEOUT_MS.down, 45_000);
  assert.equal(CONTROL_TIMEOUT_MS.doctor, 60_000);
  assert.equal(CONTROL_TIMEOUT_MS.tool, TOOL_CALL_TIMEOUT_MS + 10_000);
});

void test("RT-06: the schema maximum of startupBudgetMs equals its default and the channel's mirrored default, and the up request outlasts it plus the reply margin", () => {
  // Mirrors UP_REPLY_MARGIN_MS in src/daemon/channel.ts (not exported there).
  const UP_REPLY_MARGIN_MS = 30_000;
  // The compiled test lives in dist/test/daemon, so three levels up is the repository root.
  const schemaPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "src",
    "core",
    "policy.schema.json",
  );
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
    properties: { startupBudgetMs: { maximum: number; default: number } };
  };
  const { maximum, default: budgetDefault } = schema.properties.startupBudgetMs;
  assert.equal(maximum, budgetDefault);
  assert.equal(CONTROL_TIMEOUT_MS.up - UP_REPLY_MARGIN_MS, maximum);
  assert.ok(maximum + UP_REPLY_MARGIN_MS <= CONTROL_TIMEOUT_MS.up);
});

void test("RT-06: a request line over MAX_CONTROL_LINE_BYTES is refused with a null-id SCHEMA_INVALID and never reaches the dispatcher (P6-D2, P6-D12)", async (t) => {
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

void test("RT-06: an unknown method replies with a catalogue code, never a raw message (P6-D2)", async (t) => {
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

void test("RT-06: encoding a reply with a non-catalogue code is refused, and decoding one throws SCHEMA_INVALID (P6-D2)", () => {
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

void test("RT-06: an error reply carries a catalogue causeCode when it has one, and decoding refuses any other error field (P6-D2)", () => {
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
  assert.equal(Object.hasOwn(decoded.error, "causeCode"), false);
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

void test("RT-06: a malformed line is rejected with fixed text and never throws a raw error across the boundary (P6-D2)", () => {
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

void test("RT-06: a peer that never answers rejects with TOOL_TIMEOUT inside the injected bound (P6-D2)", async (t) => {
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

void test("RT-04: a missing socket path and a path that refuses the connection are DaemonAbsentError, still REALM_NOT_ACTIVE", async (t) => {
  const base = scratchBase(t);
  const refusing = join(base, "not-a-socket");
  writeFileSync(refusing, "");
  for (const socketPath of [join(base, "missing.sock"), refusing]) {
    await assert.rejects(
      sendRequest(socketPath, { id: 1, method: "status" }),
      (error: unknown) =>
        error instanceof DaemonAbsentError &&
        error instanceof RealmError &&
        error.code === "REALM_NOT_ACTIVE" &&
        error.message === ERROR_CATALOGUE["REALM_NOT_ACTIVE"].reason &&
        error.causeCode === undefined,
    );
  }
});

void test("RT-04: a silent daemon is TOOL_TIMEOUT and a peer that closes before replying is a plain REALM_NOT_ACTIVE, neither is DaemonAbsentError", async (t) => {
  const silentPath = await listenUnix(t, createServer(() => undefined));
  await assert.rejects(
    sendRequest(silentPath, { id: 1, method: "status" }, { timeoutMs: 50 }),
    (error: unknown) =>
      error instanceof RealmError && !(error instanceof DaemonAbsentError) && error.code === "TOOL_TIMEOUT",
  );
  const droppingPath = await listenUnix(
    t,
    createServer((socket) => {
      socket.on("data", () => {
        socket.destroy();
      });
    }),
  );
  await assert.rejects(
    sendRequest(droppingPath, { id: 1, method: "status" }),
    (error: unknown) =>
      error instanceof RealmError && !(error instanceof DaemonAbsentError) && error.code === "REALM_NOT_ACTIVE",
  );
});

void test("RT-06: garbage bytes and an id mismatch from the peer surface SCHEMA_INVALID, never a raw error (P6-D2)", async (t) => {
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

void test("RT-06: ensureSocketDir creates stateDir/run at mode 0700 when absent and accepts it on return (P6-D3)", (t) => {
  const stateDir = join(scratchBase(t), "state");
  const runDir = ensureSocketDir(stateDir);
  assert.equal(runDir, join(stateDir, "run"));
  assert.equal(statSync(runDir).mode & 0o777, 0o700);
  assert.equal(ensureSocketDir(stateDir), runDir, "a compliant directory is accepted again");
});

void test("RT-06: a fresh state directory is created at mode 0700, and so is its run directory (P6-D3)", (t) => {
  const stateDir = join(scratchBase(t), "state");
  const runDir = ensureSocketDir(stateDir);
  assert.equal(statSync(stateDir).mode & 0o777, 0o700, "the fresh state directory must not keep the default mode");
  assert.equal(statSync(runDir).mode & 0o777, 0o700, "the fresh run directory must be 0700");
});

void test("RT-06: ensureSocketDir refuses a wrong mode, a foreign owner, or a non-directory with SCHEMA_INVALID (P6-D3, P6-D11)", (t) => {
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

void test("RT-06: chmodSocket applies mode 0600 after listen, and the injected seam observes the call (P6-D3)", (t) => {
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

void test("RT-06: a reply longer than MAX_CONTROL_LINE_BYTES is refused with SCHEMA_INVALID, and its socket closes (P6-D2)", async (t) => {
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

const SELECTION_SESSION = "p0123456789ab";
const SELECTION = { workspaceRoot: "/srv/project", sessionId: SELECTION_SESSION };

void test("MULTI-03: up takes only workspaceRoot, and a sessionId on up is refused with SCHEMA_INVALID", () => {
  assert.deepEqual(parseControlSelection("up", { workspaceRoot: "/x" }), { selection: null });
  assertRefusesSchemaInvalid(() => parseControlSelection("up", { workspaceRoot: "/x", sessionId: SELECTION_SESSION }));
  assertRefusesSchemaInvalid(() => parseControlSelection("up", undefined));
  assertRefusesSchemaInvalid(() => parseControlSelection("up", { workspaceRoot: "x" }));
});

void test("MULTI-03: status, down and metrics without a selection are refused with SCHEMA_INVALID", () => {
  for (const method of ["status", "down", "metrics"] as const) {
    assertRefusesSchemaInvalid(() => parseControlSelection(method, undefined));
    assertRefusesSchemaInvalid(() => parseControlSelection(method, {}));
  }
});

void test("MULTI-03: a valid selection is returned as parsed for status, down, metrics and tool", () => {
  for (const method of ["status", "down", "metrics"] as const) {
    assert.deepEqual(parseControlSelection(method, { selection: SELECTION }), { selection: SELECTION });
  }
  assert.deepEqual(parseControlSelection("tool", { tool: { name: "x" }, selection: SELECTION }), {
    selection: SELECTION,
  });
});

void test("MULTI-03: a selection with a missing sessionId or a malformed sessionId is refused", () => {
  assertRefusesSchemaInvalid(() => parseControlSelection("status", { selection: { workspaceRoot: "/x" } }));
  assertRefusesSchemaInvalid(() =>
    parseControlSelection("status", { selection: { workspaceRoot: "/x", sessionId: "p/abc" } }),
  );
  assertRefusesSchemaInvalid(() =>
    parseControlSelection("status", { selection: { workspaceRoot: "/x", sessionId: "p..abc" } }),
  );
  assertRefusesSchemaInvalid(() => parseControlSelection("status", { selection: { workspaceRoot: "/x", sessionId: "" } }));
});

void test("MULTI-03: a relative workspaceRoot, an extra selection key and an extra params key are refused", () => {
  assertRefusesSchemaInvalid(() =>
    parseControlSelection("status", { selection: { workspaceRoot: "x", sessionId: SELECTION_SESSION } }),
  );
  assertRefusesSchemaInvalid(() =>
    parseControlSelection("status", { selection: { ...SELECTION, extra: 1 } }),
  );
  assertRefusesSchemaInvalid(() => parseControlSelection("status", { selection: SELECTION, extra: 1 }));
});

void test("MULTI-03: a workspaceRoot of 4096 characters is accepted and one of 4097 is refused", () => {
  const longest = `/${"a".repeat(4095)}`;
  assert.equal(longest.length, 4096);
  assert.deepEqual(parseControlSelection("up", { workspaceRoot: longest }), { selection: null });
  const tooLong = `/${"a".repeat(4096)}`;
  assert.equal(tooLong.length, 4097);
  assertRefusesSchemaInvalid(() => parseControlSelection("up", { workspaceRoot: tooLong }));
  assertRefusesSchemaInvalid(() =>
    parseControlSelection("status", { selection: { workspaceRoot: tooLong, sessionId: SELECTION_SESSION } }),
  );
});

void test("MULTI-03: doctor with no params returns no selection; a present but malformed selection is refused", () => {
  assert.deepEqual(parseControlSelection("doctor", undefined), { selection: null });
  assert.deepEqual(parseControlSelection("doctor", { selection: SELECTION }), { selection: SELECTION });
  assertRefusesSchemaInvalid(() => parseControlSelection("doctor", {}));
  assertRefusesSchemaInvalid(() => parseControlSelection("doctor", { selection: { workspaceRoot: "x" } }));
});
