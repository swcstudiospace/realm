import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli/main.js";
import realmExtension from "../../src/omp/extension.js";
import type { OmpExtensionApi, OmpSessionContext } from "../../src/omp/plugin.js";
import type { HostToolDefinition } from "../../src/omp/tools.js";
import { controlSocketPath } from "../../src/session/paths.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const AT = "2026-10-22T00:00:00.000Z";
// The status every stand-in control socket answers with: an active, advisory daemon.
const ACTIVE_STATUS = {
  snapshot: { state: "active", reason: "realm active", lastTransitionAt: AT },
  display: { label: "realm active", degraded: false, reason: "realm active", lastTransitionAt: AT },
  mode: "advisory",
};

// The status a daemon reports while no realm is bound: inactive, advisory.
const INACTIVE_STATUS = {
  snapshot: { state: "unbound", reason: "no realm bound", lastTransitionAt: AT },
  display: { label: "realm disconnected", degraded: false, reason: "no realm bound", lastTransitionAt: AT },
  mode: "advisory",
};
// The refusal a stand-in daemon gives a forwarded write while its realm is not active. It touches no file.
const REFUSED_WRITE = { outcome: "refused", tool: "write", code: "REALM_NOT_ACTIVE", retryable: true };

interface Hit {
  readonly socketPath: string;
  readonly method: string;
}

// One request as the host sends it: the NDJSON frame the channel writes.
interface StubRequest {
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

// What a stand-in daemon answers: a result, or a catalogue error code.
type StubReply = { readonly result: unknown } | { readonly error: { readonly code: string } };

// A stand-in daemon on one control socket. It answers each NDJSON request with respond(request) and reports the request with
// the socket it arrived on. By default it answers every request with an active status.
function startStub(
  socketPath: string,
  onRequest: (hit: Hit) => void,
  respond: (request: StubRequest) => StubReply = () => ({ result: ACTIVE_STATUS }),
): Promise<Server> {
  const server = createServer((socket) => {
    let text = "";
    socket.on("data", (chunk) => {
      text += String(chunk);
      const end = text.indexOf("\n");
      if (end === -1) {
        return;
      }
      const request = JSON.parse(text.slice(0, end)) as StubRequest;
      onRequest({ socketPath, method: request.method });
      socket.end(`${JSON.stringify({ id: request.id, ...respond(request) })}\n`);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve(server);
    });
  });
}

// A stand-in daemon pinned to one project. Its status is the given status, up answers for the workspace the host asked for
// through upReply, and every tool call is refused with REALM_NOT_ACTIVE.
function pinnedDaemon(status: object, upReply: (workspaceRoot: string) => StubReply): (request: StubRequest) => StubReply {
  return (request) => {
    if (request.method === "up") {
      const params: unknown = request.params;
      if (typeof params !== "object" || params === null || !("workspaceRoot" in params) || typeof params.workspaceRoot !== "string") {
        throw new Error("an up request names no workspaceRoot");
      }
      return upReply(params.workspaceRoot);
    }
    if (request.method === "tool") {
      return { result: REFUSED_WRITE };
    }
    return { result: status };
  };
}

// Serves one stand-in daemon on socketPath for the rest of the test. Every request it receives is recorded in hits.
async function serveDaemon(
  t: TestContext,
  socketPath: string,
  hits: Hit[],
  respond: (request: StubRequest) => StubReply,
): Promise<void> {
  const server = await startStub(
    socketPath,
    (hit) => {
      hits.push(hit);
    },
    respond,
  );
  t.after(() => {
    server.close();
  });
}

// A scratch directory for one test, removed when the test ends.
function scratchDir(t: TestContext): string {
  const base = mkdtempSync(join(tmpdir(), "omp-extension-"));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

// Writes the runtime config that names the state directory and workspaceRoot, and points the process environment at it. Returns
// the control socket of that state directory, where the stand-in daemon listens.
function configure(t: TestContext, base: string, workspaceRoot: string): string {
  const stateDir = join(base, "state");
  mkdirSync(join(base, "config", "realm"), { recursive: true });
  writeFileSync(join(base, "config", "realm", "config.json"), JSON.stringify({ image: IMAGE, stateDir, workspaceRoot }));
  mkdirSync(join(stateDir, "run"), { recursive: true });
  setProcessEnv(t, { XDG_CONFIG_HOME: join(base, "config"), XDG_STATE_HOME: join(base, "xdg-state") });
  return controlSocketPath(stateDir);
}

// The Omp host surface the extension registers on. The Realm tools are recorded by name and start active, as Omp reports them.
interface Host {
  readonly pi: OmpExtensionApi;
  readonly handlers: Map<string, (...args: unknown[]) => unknown>;
  readonly tools: Map<string, HostToolDefinition>;
}

function createHost(): Host {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const tools = new Map<string, HostToolDefinition>();
  let activeTools: string[] = [];
  const pi = {
    on(event: string, handler: (...args: unknown[]) => unknown): void {
      handlers.set(event, handler);
    },
    registerCommand(): void {},
    registerTool(tool: HostToolDefinition): void {
      tools.set(tool.name, tool);
      activeTools.push(tool.name);
    },
    getAllTools(): { readonly name: string }[] {
      return [...tools.keys()].map((name) => ({ name }));
    },
    getActiveTools(): string[] {
      return [...activeTools];
    },
    setActiveTools(names: string[]): Promise<void> {
      activeTools = [...names];
      return Promise.resolve();
    },
  } as unknown as OmpExtensionApi;
  return { pi, handlers, tools };
}

// The Realm write the extension registered. It replaces Omp's built-in write, so the test calls the Realm write directly.
function realmWrite(host: Host): HostToolDefinition {
  const write = host.tools.get("write");
  assert.ok(write, "the extension registers the Realm write");
  return write;
}

// A promise settled from outside. The status paint that arrives later calls settle, so the test waits on that event.
function settleLater(): { readonly promise: Promise<void>; readonly settle: () => void } {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    settle = () => {
      resolve();
    };
  });
  return { promise, settle };
}

// Starts one Omp session in cwd with the entry loaded under the process environment the test set. Returns once the attach has
// painted expectedNeedle, so the realm state is settled before the test acts.
async function startOmpSession(
  t: TestContext,
  host: Host,
  paints: string[],
  cwd: string,
  expectedNeedle: string,
): Promise<void> {
  const painted = settleLater();
  realmExtension(host.pi);
  t.after(() => {
    host.handlers.get("session_shutdown")?.();
  });
  const ctx: OmpSessionContext = {
    cwd,
    ui: {
      setStatus(_key: string, text: string): void {
        paints.push(text);
        if (text.includes(expectedNeedle)) {
          painted.settle();
        }
      },
      notify(): void {},
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearTimer: (handle) => {
      clearTimeout(handle as NodeJS.Timeout);
    },
  };
  const sessionStart = host.handlers.get("session_start");
  assert.ok(sessionStart, "the extension registers a session_start handler");
  sessionStart({ type: "session_start" }, ctx);
  await within(painted.promise, 5_000, `no status paint contains ${expectedNeedle}`);
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
    JSON.stringify({ image: IMAGE, stateDir, workspaceRoot: base }),
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

  const { pi, handlers } = createHost();
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
  sessionStart({ type: "session_start" }, ctx);
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

void test("a refused attach for a subdirectory of the daemon's project keeps no client: a write with no workspace is refused and never reaches the daemon or the project's files", async (t) => {
  const base = scratchDir(t);
  const project = join(base, "project");
  const subdir = join(project, "sub");
  mkdirSync(subdir, { recursive: true });
  writeFileSync(join(project, "notes.txt"), "project A");
  const boundRoot = realpathSync(project);
  const socketPath = configure(t, base, project);
  const status = { ...ACTIVE_STATUS, boundRoot };
  const hits: Hit[] = [];
  await serveDaemon(
    t,
    socketPath,
    hits,
    pinnedDaemon(status, (requested) =>
      realpathSync(requested) === boundRoot ? { result: status } : { error: { code: "POLICY_DENIED" } },
    ),
  );
  const host = createHost();
  const paints: string[] = [];
  await startOmpSession(t, host, paints, subdir, "POLICY_DENIED");

  const result = await realmWrite(host).execute("call-1", { path: "notes.txt", content: "overwritten" });
  assert.deepEqual(
    result.details,
    { outcome: "refused", tool: "write", code: "REALM_NOT_ACTIVE", retryable: true },
    "with no client the write is refused before any daemon call",
  );
  assert.deepEqual(hits.filter((hit) => hit.method === "tool"), [], "no tool call reaches the daemon bound to project A");
  assert.equal(readFileSync(join(project, "notes.txt"), "utf8"), "project A", "project A's file is unchanged");
});

void test("a refused attach whose daemon is bound to the session's own workspace keeps forwarding: a write reaches the reachable daemon while the realm is inactive", async (t) => {
  const base = scratchDir(t);
  const project = join(base, "project");
  mkdirSync(project);
  const boundRoot = realpathSync(project);
  const socketPath = configure(t, base, project);
  const status = { ...INACTIVE_STATUS, boundRoot };
  const hits: Hit[] = [];
  await serveDaemon(
    t,
    socketPath,
    hits,
    pinnedDaemon(status, (requested) =>
      realpathSync(requested) === boundRoot
        ? { error: { code: "AGENTOS_NOT_CONFIGURED" } }
        : { error: { code: "POLICY_DENIED" } },
    ),
  );
  const host = createHost();
  const paints: string[] = [];
  await startOmpSession(t, host, paints, project, "AGENTOS_NOT_CONFIGURED");

  const result = await realmWrite(host).execute("call-1", { path: "notes.txt", content: "hello" });
  assert.deepEqual(result.details, REFUSED_WRITE, "the daemon's own refusal reaches the caller");
  assert.deepEqual(
    hits.filter((hit) => hit.method === "tool"),
    [{ socketPath, method: "tool" }],
    "the write is forwarded to the daemon bound to this workspace",
  );
});

void test("a daemon that reports no bound root, as one that predates the field does, is not kept after a refused up: a write with no workspace is refused", async (t) => {
  const base = scratchDir(t);
  const project = join(base, "project");
  mkdirSync(project);
  const socketPath = configure(t, base, project);
  const hits: Hit[] = [];
  await serveDaemon(
    t,
    socketPath,
    hits,
    pinnedDaemon(INACTIVE_STATUS, () => ({ error: { code: "AGENTOS_NOT_CONFIGURED" } })),
  );
  const host = createHost();
  const paints: string[] = [];
  await startOmpSession(t, host, paints, project, "AGENTOS_NOT_CONFIGURED");

  const result = await realmWrite(host).execute("call-1", { path: "notes.txt", content: "hello" });
  assert.deepEqual(
    result.details,
    { outcome: "refused", tool: "write", code: "REALM_NOT_ACTIVE", retryable: true },
    "with no client the write is refused before any daemon call",
  );
  assert.deepEqual(hits.filter((hit) => hit.method === "tool"), [], "no tool call reaches a daemon whose root is unknown");
});
