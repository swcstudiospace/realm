import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";
import { startScriptedControlSocket, type ScriptedControlSocketOptions } from "./scripted-control-socket.js";
import { boundedWait } from "./timing.js";

const WORKSPACE = "/ws/project";

// One request over a fresh connection, as the host does: one line out, one line back.
function ask(socketPath: string, id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let text = "";
    socket.on("data", (chunk) => {
      text += String(chunk);
    });
    socket.on("end", () => {
      if (text.trim() === "") {
        reject(new Error("the connection closed without a reply"));
        return;
      }
      resolve(JSON.parse(text.trim()) as Record<string, unknown>);
    });
    socket.on("error", reject);
    socket.write(`${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`);
  });
}

async function serve(
  t: TestContext,
  extra: Omit<ScriptedControlSocketOptions, "socketPath"> = {},
): Promise<{ readonly socketPath: string; readonly requests: readonly string[] }> {
  const base = mkdtempSync(join(tmpdir(), "scripted-socket-"));
  const socketPath = join(base, "c.sock");
  const socket = await startScriptedControlSocket({ socketPath, ...extra });
  t.after(async () => {
    await socket.close();
    rmSync(base, { recursive: true, force: true });
  });
  return { socketPath, requests: socket.requests };
}

void test("the default responder answers status and up as active for the workspace the request names, and host-boot as recorded", async (t) => {
  const { socketPath, requests } = await serve(t);
  const status = await boundedWait(ask(socketPath, 1, "status", { selection: { workspaceRoot: WORKSPACE } }), "status reply");
  assert.equal(status.id, 1);
  const statusResult = status.result as { snapshot: { state: string }; sessionId: string };
  assert.equal(statusResult.snapshot.state, "active");
  assert.equal(statusResult.sessionId, sessionIdOfWorkspace(WORKSPACE));
  const up = await boundedWait(ask(socketPath, 2, "up", { workspaceRoot: WORKSPACE }), "up reply");
  assert.equal((up.result as { sessionId: string }).sessionId, sessionIdOfWorkspace(WORKSPACE));
  const boot = await boundedWait(ask(socketPath, 3, "host-boot", {}), "host-boot reply");
  assert.deepEqual(boot, { id: 3, result: { recorded: true } });
  assert.deepEqual(requests, ["status", "up", "host-boot"], "requests are recorded in arrival order");
});

void test("a refused up is answered with the catalogue code, the next up succeeds, and an override replaces the default reply", async (t) => {
  const { socketPath } = await serve(t, {
    upRefusals: ["REALM_NOT_ACTIVE"],
    respond: (request) => (request.method === "custom" ? { result: { custom: true } } : undefined),
  });
  const refused = await boundedWait(ask(socketPath, 1, "up", { workspaceRoot: WORKSPACE }), "first up");
  assert.deepEqual(refused, { id: 1, error: { code: "REALM_NOT_ACTIVE" } });
  const accepted = await boundedWait(ask(socketPath, 2, "up", { workspaceRoot: WORKSPACE }), "second up");
  assert.ok("result" in accepted);
  assert.deepEqual(await boundedWait(ask(socketPath, 3, "custom"), "custom"), { id: 3, result: { custom: true } });
});

void test("latencies are consumed in request order, the last value repeats, and an empty series means no delay", async (t) => {
  const { socketPath } = await serve(t, { latenciesMs: { up: [0, 60], status: [] } });
  const timed = async (method: string, id: number): Promise<number> => {
    const began = performance.now();
    await boundedWait(ask(socketPath, id, method, { workspaceRoot: WORKSPACE, selection: { workspaceRoot: WORKSPACE } }), method);
    return performance.now() - began;
  };
  const first = await timed("up", 1);
  const second = await timed("up", 2);
  const third = await timed("up", 3);
  const unscripted = await timed("status", 4);
  assert.ok(first < 50, "the first up has no delay");
  assert.ok(second >= 55, "the second up waits its scripted latency");
  assert.ok(third >= 55, "the last latency repeats");
  assert.ok(unscripted < 50, "an empty series answers at once");
});

void test("close removes the socket file and clears pending replies", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "scripted-socket-"));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const socketPath = join(base, "c.sock");
  const socket = await startScriptedControlSocket({ socketPath, latenciesMs: { up: [60_000] } });
  assert.ok(existsSync(socketPath));
  const pending = ask(socketPath, 1, "up", { workspaceRoot: WORKSPACE }).then(
    () => "answered",
    () => "closed",
  );
  await boundedWait(
    new Promise<void>((resolve) => {
      const poll = (): void => {
        if (socket.requests.length > 0) {
          resolve();
          return;
        }
        setImmediate(poll);
      };
      poll();
    }),
    "the up request arriving",
  );
  await boundedWait(socket.close(), "close");
  assert.equal(existsSync(socketPath), false, "the socket file is gone");
  assert.equal(await boundedWait(pending, "the pending ask"), "closed", "a pending reply never arrives");
});
