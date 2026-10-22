import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli/main.js";
import realmExtension from "../../src/omp/extension.js";
import type { OmpExtensionApi, OmpSessionContext } from "../../src/omp/plugin.js";
import { controlSocketPath } from "../../src/session/paths.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const AT = "2026-10-22T00:00:00.000Z";
// The status every stand-in control socket answers with: an active, advisory daemon.
const ACTIVE_STATUS = {
  snapshot: { state: "active", reason: "realm active", lastTransitionAt: AT },
  display: { label: "realm active", degraded: false, reason: "realm active", lastTransitionAt: AT },
  mode: "advisory",
};

interface Hit {
  readonly socketPath: string;
  readonly method: string;
}

// A stand-in daemon on one control socket. It answers each NDJSON request with an active status and
// reports the request with the socket it arrived on.
function startStub(socketPath: string, onRequest: (hit: Hit) => void): Promise<Server> {
  const server = createServer((socket) => {
    let text = "";
    socket.on("data", (chunk) => {
      text += String(chunk);
      const end = text.indexOf("\n");
      if (end === -1) {
        return;
      }
      const request = JSON.parse(text.slice(0, end)) as { id: number; method: string };
      onRequest({ socketPath, method: request.method });
      socket.end(`${JSON.stringify({ id: request.id, result: ACTIVE_STATUS })}\n`);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve(server);
    });
  });
}

// The Omp entry reads process.env once at load, so the test sets it for that call and restores it after.
function setProcessEnv(t: TestContext, values: Readonly<Record<string, string>>): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  });
}

// A failure bound only. The awaited signal arrives on its own and the timer is cleared as soon as it does, so the timer never sets the pace of the test.
async function within<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    clearTimeout(timer);
  }
}

void test("OMP-01: the Omp entry and the CLI dial one control socket, the state directory the runtime config names (G-07)", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "omp-extension-"));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  const xdgStateHome = join(base, "xdg-state");
  const env = { XDG_CONFIG_HOME: join(base, "config"), XDG_STATE_HOME: xdgStateHome };
  mkdirSync(join(base, "config", "realm"), { recursive: true });
  writeFileSync(
    join(base, "config", "realm", "config.json"),
    JSON.stringify({ image: IMAGE, workloadArgv: ["/usr/bin/agent"], stateDir, workspaceRoot: base }),
  );
  const configSocket = controlSocketPath(stateDir);
  const decoySocket = controlSocketPath(join(xdgStateHome, "realm"));
  mkdirSync(join(stateDir, "run"), { recursive: true });
  mkdirSync(join(xdgStateHome, "realm", "run"), { recursive: true });
  setProcessEnv(t, env);

  const hits: Hit[] = [];
  let resolveUp: (hit: Hit) => void = () => undefined;
  const firstUp = new Promise<Hit>((resolve) => {
    resolveUp = resolve;
  });
  const onRequest = (hit: Hit): void => {
    hits.push(hit);
    if (hit.method === "up") {
      resolveUp(hit);
    }
  };
  const servers = [await startStub(configSocket, onRequest), await startStub(decoySocket, onRequest)];
  t.after(() => {
    for (const server of servers) {
      server.close();
    }
  });

  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const pi = {
    on(event: string, handler: (...args: unknown[]) => unknown): void {
      handlers.set(event, handler);
    },
    registerCommand(): void {},
  } as unknown as OmpExtensionApi;
  t.after(() => {
    handlers.get("session_shutdown")?.();
  });
  realmExtension(pi);

  const ctx: OmpSessionContext = {
    cwd: base,
    ui: { setStatus(): void {}, notify(): void {} },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearTimer: (handle) => {
      clearTimeout(handle as NodeJS.Timeout);
    },
  };
  const sessionStart = handlers.get("session_start");
  assert.ok(sessionStart, "the extension registers a session_start handler");
  sessionStart(ctx);
  const upHit = await within(firstUp, 5_000, "no control socket received an up request");
  assert.equal(upHit.socketPath, configSocket, "the Omp entry attaches to the state directory the runtime config names");

  const beforeCli = hits.length;
  const cli = await runCli(["status"], { env });
  const cliHits = hits.slice(beforeCli);
  assert.doesNotMatch(cli.stderr, /daemon absent/, "the CLI reaches a daemon rather than reporting it absent");
  assert.ok(cliHits.length > 0, "the CLI sends a request to a control socket");
  assert.ok(
    cliHits.every((hit) => hit.socketPath === configSocket),
    "the CLI dials the same control socket as the Omp entry",
  );
  assert.deepEqual(
    hits.filter((hit) => hit.socketPath === decoySocket),
    [],
    "no client dials the socket under XDG_STATE_HOME",
  );
});
