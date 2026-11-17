import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../src/cli/main.js";
import realmExtension, { reattachEnabledOf } from "../../src/omp/extension.js";
import type { OmpExtensionApi, OmpSessionContext } from "../../src/omp/plugin.js";
import type { HostToolDefinition } from "../../src/omp/tools.js";
import { controlSocketPath, sessionIdOfWorkspace } from "../../src/session/paths.js";
import { RealmError } from "../../src/core/errors.js";
import { BOOT_BOUNDS, resolveBoot } from "../../src/host/boot.js";
import { defaultManifestFor, parseHostPluginManifest } from "../../src/host/manifest.js";
import { parseHostBootReport, type HostBootReport } from "../../src/host/boot-report.js";
import { isCorrelationId } from "../../src/observe/ids.js";
import { pollUntil } from "../support/timing.js";

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

// The host-boot reports the extension sends after an attach and at session end. The stand-in answers them itself, before
// respond sees them: a report names no workspace, so a respond built on a workspace would throw on one. A test that cares reads
// requests and sets reply; every test that does restores both through hostBootRecorder's cleanup.
const hostBoot: { requests: StubRequest[]; reply: StubReply } = { requests: [], reply: { result: { recorded: true } } };

function hostBootRecorder(t: TestContext): void {
  hostBoot.requests = [];
  hostBoot.reply = { result: { recorded: true } };
  t.after(() => {
    hostBoot.requests = [];
    hostBoot.reply = { result: { recorded: true } };
  });
}

// A stand-in daemon on one control socket. It answers each NDJSON request with respond(request) and reports the request with
// the socket it arrived on. By default it answers every request with an active status.
function startStub(
  socketPath: string,
  onRequest: (hit: Hit) => void,
  respond: (request: StubRequest) => StubReply = (request) => answeredFor(request, ACTIVE_STATUS),
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
      if (request.method === "host-boot") {
        hostBoot.requests.push(request);
        socket.end(`${JSON.stringify({ id: request.id, ...hostBoot.reply })}\n`);
        return;
      }
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

// The session id a stand-in daemon answers with for a request: the id of the canonical workspace root the request names,
// derived the way the daemon derives it. The derivation is pure, so a reply that lands after the project directory has been
// removed still answers and throws nothing. up names its workspace in workspaceRoot; every selected request names it in its
// selection, and the client always sends the realpath.
function sessionIdOfRequest(request: StubRequest): string {
  const params = request.params as { readonly workspaceRoot?: string; readonly selection?: { readonly workspaceRoot: string } } | undefined;
  const root = params?.workspaceRoot ?? params?.selection?.workspaceRoot;
  if (root === undefined) {
    throw new Error("the request names no workspace");
  }
  return sessionIdOfWorkspace(root);
}

// The reply a stand-in daemon gives: the result, stamped with the session id of the workspace the request named. The
// client refuses an up reply whose session id is not its own, so the stamp is what a real daemon would report.
function answeredFor(request: StubRequest, result: unknown): StubReply {
  return { result: { ...(result as object), sessionId: sessionIdOfRequest(request) } };
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
      const reply = upReply(params.workspaceRoot);
      return "result" in reply ? answeredFor(request, reply.result) : reply;
    }
    if (request.method === "tool") {
      return { result: REFUSED_WRITE };
    }
    return answeredFor(request, status);
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
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
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

// The Omp entry reads its environment at load. These helpers run one load under a chosen environment and restore every key the
// load touched, whatever the load did. undefined removes a key.
function withProcessEnv<T>(values: Readonly<Record<string, string | undefined>>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
  }
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  }
}

// A temp base holding a runtime config, so the Omp entry can load its config.
function configBase(t: TestContext): string {
  const base = mkdtempSync(join(tmpdir(), "omp-reattach-"));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  mkdirSync(join(base, "config", "realm"), { recursive: true });
  mkdirSync(join(base, "state"), { recursive: true });
  writeFileSync(
    join(base, "config", "realm", "config.json"),
    JSON.stringify({ image: IMAGE, stateDir: join(base, "state"), workspaceRoot: base }),
  );
  return base;
}

// A host double that records each event the entry registers, and accepts every other registration the plugin makes.
function recordingPi(): { readonly pi: OmpExtensionApi; readonly events: string[] } {
  const events: string[] = [];
  const pi = {
    on(event: string): void {
      events.push(event);
    },
    registerCommand(): void {},
    registerTool(): void {},
    getAllTools(): { readonly name: string }[] {
      return [];
    },
    getActiveTools(): string[] {
      return [];
    },
    setActiveTools(): Promise<void> {
      return Promise.resolve();
    },
  } as unknown as OmpExtensionApi;
  return { pi, events };
}

// Loads the Omp entry with REALM_OMP_REATTACH set to value (undefined leaves it unset).
function loadEntry(base: string, value: string | undefined, pi: OmpExtensionApi): void {
  withProcessEnv({ XDG_CONFIG_HOME: join(base, "config"), REALM_OMP_REATTACH: value }, () => {
    realmExtension(pi);
  });
}

const REGISTERED_EVENTS = ["session_start", "session_switch", "session_shutdown", "tool_call"];

void test("O4 edge: REALM_OMP_REATTACH unset or 0 loads the entry with re-attach off", (t) => {
  const base = configBase(t);
  for (const value of [undefined, "0"]) {
    const { pi, events } = recordingPi();
    loadEntry(base, value, pi);
    assert.deepEqual(events, REGISTERED_EVENTS, `REALM_OMP_REATTACH=${String(value)} loads`);
  }
  assert.equal(reattachEnabledOf(undefined), false, "unset is off");
  assert.equal(reattachEnabledOf("0"), false, "0 is off");
});

void test("O4 edge: REALM_OMP_REATTACH 1 loads the entry with re-attach on", (t) => {
  const base = configBase(t);
  const { pi, events } = recordingPi();
  loadEntry(base, "1", pi);
  assert.deepEqual(events, REGISTERED_EVENTS, "1 loads");
  assert.equal(reattachEnabledOf("1"), true, "1 is on");
});

void test("O4 edge: any other REALM_OMP_REATTACH value fails the load with SCHEMA_INVALID before anything registers", (t) => {
  const base = configBase(t);
  for (const value of ["", "true", "yes", "2", " 1", "01"]) {
    const { pi, events } = recordingPi();
    assert.throws(
      () => {
        loadEntry(base, value, pi);
      },
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
      `REALM_OMP_REATTACH=${JSON.stringify(value)} fails the load`,
    );
    assert.deepEqual(events, [], "nothing is registered");
    assert.throws(
      () => reattachEnabledOf(value),
      (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
    );
  }
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

// MULTI-02 and MULTI-03 (plan 10 T1): the attach names its directory's session, and a refused up is kept only for that session.
// A stand-in daemon answers status normally until it has seen up, so the attach's probe finds a daemon; after the refused up it
// answers the raw status the test names.
function raisedAfterUp(status: object): (request: StubRequest) => StubReply {
  let upSeen = false;
  return (request) => {
    if (request.method === "up") {
      upSeen = true;
      return { error: { code: "AGENTOS_NOT_CONFIGURED" } };
    }
    return upSeen ? { result: status } : answeredFor(request, status);
  };
}

void test("an attach for a directory sends up with its realpath, and the status requests carry that directory's session id (MULTI-02)", async (t) => {
  const base = scratchDir(t);
  const project = join(base, "project");
  mkdirSync(project);
  const root = realpathSync(project);
  const socketPath = configure(t, base, project);
  const seen: StubRequest[] = [];
  await serveDaemon(t, socketPath, [], (request) => {
    seen.push(request);
    return answeredFor(request, ACTIVE_STATUS);
  });
  const host = createHost();
  const paints: string[] = [];
  await startOmpSession(t, host, paints, project, "realm active");

  assert.deepEqual(seen.find((request) => request.method === "up")?.params, { workspaceRoot: root });
  const statuses = seen.filter((request) => request.method === "status");
  assert.ok(statuses.length > 0, "the attach read the status");
  for (const request of statuses) {
    assert.equal((request.params as { selection?: { sessionId?: string } }).selection?.sessionId, sessionIdOfWorkspace(root));
  }
});

void test("a refused up whose status names another session closes the client: the refusal is rethrown and no tool call reaches the daemon (MULTI-03)", async (t) => {
  const base = scratchDir(t);
  const project = join(base, "project");
  const elsewhere = join(base, "elsewhere");
  mkdirSync(project);
  mkdirSync(elsewhere);
  const boundRoot = realpathSync(project);
  const socketPath = configure(t, base, project);
  const status = { ...INACTIVE_STATUS, boundRoot, sessionId: sessionIdOfWorkspace(realpathSync(elsewhere)) };
  const hits: Hit[] = [];
  await serveDaemon(t, socketPath, hits, raisedAfterUp(status));
  const host = createHost();
  const paints: string[] = [];
  await startOmpSession(t, host, paints, project, "AGENTOS_NOT_CONFIGURED");

  const result = await realmWrite(host).execute("call-1", { path: "notes.txt", content: "hello" });
  assert.deepEqual(
    result.details,
    { outcome: "refused", tool: "write", code: "REALM_NOT_ACTIVE", retryable: true },
    "with no client the write is refused before any daemon call",
  );
  assert.deepEqual(hits.filter((hit) => hit.method === "tool"), [], "no tool call reaches the daemon");
});

void test("a refused up whose status reports no session id closes the client and rethrows the refusal (MULTI-03)", async (t) => {
  const base = scratchDir(t);
  const project = join(base, "project");
  mkdirSync(project);
  const socketPath = configure(t, base, project);
  const status = { ...INACTIVE_STATUS, boundRoot: realpathSync(project) };
  const hits: Hit[] = [];
  await serveDaemon(t, socketPath, hits, raisedAfterUp(status));
  const host = createHost();
  const paints: string[] = [];
  await startOmpSession(t, host, paints, project, "AGENTOS_NOT_CONFIGURED");

  const result = await realmWrite(host).execute("call-1", { path: "notes.txt", content: "hello" });
  assert.deepEqual(
    result.details,
    { outcome: "refused", tool: "write", code: "REALM_NOT_ACTIVE", retryable: true },
    "with no client the write is refused before any daemon call",
  );
  assert.deepEqual(hits.filter((hit) => hit.method === "tool"), [], "no tool call reaches a daemon that names no session");
});

void test("an attach for a directory that does not exist is refused with POLICY_DENIED before any socket is opened (MULTI-02)", async (t) => {
  const base = scratchDir(t);
  const socketPath = configure(t, base, base);
  const hits: Hit[] = [];
  await serveDaemon(t, socketPath, hits, () => ({ result: ACTIVE_STATUS }));
  const host = createHost();
  const paints: string[] = [];
  await startOmpSession(t, host, paints, join(base, "missing"), "POLICY_DENIED");

  assert.deepEqual(hits, [], "no socket is opened for a directory that does not exist");
});

// ---- presence marker and manifest bounds ----------------------------------------------------------------------------------------

// A session context whose status paints are recorded; its timers are real and the plugin clears them at shutdown.
function recordingCtx(cwd: string, statuses: string[]): OmpSessionContext {
  return {
    cwd,
    ui: {
      setStatus(_key: string, text: string): void {
        statuses.push(text);
      },
      notify(): void {},
    },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearTimer: (handle) => {
      clearTimeout(handle as NodeJS.Timeout);
    },
  };
}

function markerFile(base: string): string {
  return join(base, "state", "hosts", "omp-active", `${String(process.pid)}.json`);
}

void test("OMPB-07: the extension writes a presence marker after an attach and removes it on session_shutdown", async (t) => {
  const base = scratchDir(t);
  const socketPath = configure(t, base, base);
  await serveDaemon(t, socketPath, [], (request) => answeredFor(request, ACTIVE_STATUS));
  const host = createHost();
  realmExtension(host.pi);
  const statuses: string[] = [];
  const start = host.handlers.get("session_start");
  assert.ok(start, "the extension registers a session_start handler");
  start({ type: "session_start" }, recordingCtx(base, statuses));
  await pollUntil(() => existsSync(markerFile(base)), "the presence marker is written");
  const record = JSON.parse(readFileSync(markerFile(base), "utf8")) as Record<string, unknown>;
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.pid, process.pid);
  assert.equal(record.attach, "attached");
  assert.equal(record.code, null);
  assert.equal(record.sessionId, sessionIdOfWorkspace(realpathSync(base)));
  assert.ok(statuses.some((text) => text.includes("realm active")), "the status was painted before the marker");
  const shutdown = host.handlers.get("session_shutdown");
  assert.ok(shutdown, "the extension registers a session_shutdown handler");
  shutdown({ type: "session_shutdown" }, recordingCtx(base, statuses));
  await pollUntil(() => !existsSync(markerFile(base)), "the presence marker is removed");
});

void test("OMPB-07: a presence failure writes one stderr line with only a code and changes no attach outcome", async (t) => {
  const base = scratchDir(t);
  const socketPath = configure(t, base, base);
  // A regular file where the hosts directory belongs: the marker cannot be created.
  writeFileSync(join(base, "state", "hosts"), "blocked");
  await serveDaemon(t, socketPath, [], (request) => answeredFor(request, ACTIVE_STATUS));
  const lines: string[] = [];
  t.mock.method(process.stderr, "write", (chunk: string | Uint8Array): boolean => {
    lines.push(String(chunk));
    return true;
  });
  const host = createHost();
  realmExtension(host.pi);
  const statuses: string[] = [];
  const start = host.handlers.get("session_start");
  assert.ok(start);
  start({ type: "session_start" }, recordingCtx(base, statuses));
  await pollUntil(() => lines.some((line) => line.startsWith("realm: presence marker not updated")), "the presence failure is reported");
  assert.deepEqual(
    lines.filter((line) => line.startsWith("realm: presence marker not updated")),
    ["realm: presence marker not updated: PATH_ESCAPE\n"],
  );
  assert.ok(statuses.some((text) => text.includes("realm active")), "the attach still ends active");
  assert.equal(statuses.some((text) => /error|refus/i.test(text)), false, "no failure is painted");
  host.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, recordingCtx(base, statuses));
});

void test("OMPB-06: the omp manifest default resolves to BOOT_BOUNDS, and REALM_OMP_REATTACH=1 turns only re-attach on", () => {
  const manifest = defaultManifestFor("omp", "1.2.3");
  const off = resolveBoot(parseHostPluginManifest({ ...manifest, boot: { reattach: { enabled: reattachEnabledOf(undefined) } } }));
  assert.deepEqual(off, BOOT_BOUNDS);
  const on = resolveBoot(parseHostPluginManifest({ ...manifest, boot: { reattach: { enabled: reattachEnabledOf("1") } } }));
  assert.equal(on.reattach.enabled, true);
  assert.deepEqual({ ...on, reattach: { ...on.reattach, enabled: false } }, BOOT_BOUNDS);
});

// ---- boot observability through the shared observer ----------------------------------------------------------------------------

// The report a host-boot request carries, parsed through the daemon's own parser.
function bootReportOf(request: StubRequest | undefined): HostBootReport {
  assert.ok(request, "a host-boot request was recorded");
  assert.equal(request.method, "host-boot");
  const params = request.params;
  assert.ok(typeof params === "object" && params !== null && "report" in params, "params carry a report");
  assert.deepEqual(Object.keys(params), ["report"]);
  return parseHostBootReport(params.report);
}

// Captures what the process writes to stderr for the rest of the test.
function captureStderr(t: TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(process.stderr, "write", (chunk: string | Uint8Array): boolean => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

void test("BOOT-08: one attach sends one host-boot report for omp and session_shutdown sends closed, under one boot id", async (t) => {
  const base = scratchDir(t);
  const socketPath = configure(t, base, base);
  hostBootRecorder(t);
  await serveDaemon(t, socketPath, [], (request) => answeredFor(request, ACTIVE_STATUS));
  const host = createHost();
  await startOmpSession(t, host, [], base, "realm active");
  await pollUntil(() => hostBoot.requests.length === 1, "the attached report reaches the daemon");
  const attached = bootReportOf(hostBoot.requests[0]);
  assert.equal(attached.hostId, "omp");
  assert.equal(attached.transport, "extension");
  assert.equal(attached.phase, "attached");
  assert.equal(attached.code, null);
  assert.equal(attached.state, "active");
  assert.equal(isCorrelationId(attached.bootId), true);
  assert.equal(attached.attempt, 1);
  host.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, recordingCtx(base, []));
  await pollUntil(() => hostBoot.requests.length === 2, "the closed report reaches the daemon");
  const closed = bootReportOf(hostBoot.requests[1]);
  assert.equal(closed.phase, "closed");
  assert.equal(closed.bootId, attached.bootId);
  assert.equal(closed.hostId, "omp");
});

void test("BOOT-08: a failed attach that is not kept sends failed with its catalogue code", async (t) => {
  const base = scratchDir(t);
  const project = join(base, "project");
  const elsewhere = join(base, "elsewhere");
  mkdirSync(project);
  mkdirSync(elsewhere);
  const socketPath = configure(t, base, project);
  hostBootRecorder(t);
  const status = { ...INACTIVE_STATUS, boundRoot: realpathSync(project), sessionId: sessionIdOfWorkspace(realpathSync(elsewhere)) };
  await serveDaemon(t, socketPath, [], raisedAfterUp(status));
  const host = createHost();
  await startOmpSession(t, host, [], project, "AGENTOS_NOT_CONFIGURED");
  await pollUntil(() => hostBoot.requests.length >= 1, "the failed report reaches the daemon");
  const failed = bootReportOf(hostBoot.requests[0]);
  assert.equal(failed.phase, "failed");
  assert.equal(failed.code, "AGENTOS_NOT_CONFIGURED");
  assert.equal(failed.hostId, "omp");
  const marker = JSON.parse(readFileSync(markerFile(base), "utf8")) as Record<string, unknown>;
  assert.equal(marker.attach, "failed");
  assert.equal(marker.code, "AGENTOS_NOT_CONFIGURED");
});

void test("BOOT-08: a default-level session writes nothing to stderr; REALM_LOG_LEVEL=debug shows host.boot lines with one correlation id", async (t) => {
  const quietBase = scratchDir(t);
  const quietSocket = configure(t, quietBase, quietBase);
  hostBootRecorder(t);
  await serveDaemon(t, quietSocket, [], (request) => answeredFor(request, ACTIVE_STATUS));
  const lines = captureStderr(t);
  const quiet = createHost();
  await startOmpSession(t, quiet, [], quietBase, "realm active");
  await pollUntil(() => hostBoot.requests.length === 1, "the attached report reaches the daemon");
  quiet.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, recordingCtx(quietBase, []));
  await pollUntil(() => hostBoot.requests.length === 2, "the closed report reaches the daemon");
  assert.deepEqual(lines, [], "a default-level session adds nothing to stderr");

  const loudBase = scratchDir(t);
  const loudSocket = configure(t, loudBase, loudBase);
  setProcessEnv(t, { REALM_LOG_LEVEL: "debug" });
  await serveDaemon(t, loudSocket, [], (request) => answeredFor(request, ACTIVE_STATUS));
  const loud = createHost();
  await startOmpSession(t, loud, [], loudBase, "realm active");
  await pollUntil(() => hostBoot.requests.length === 3, "the attached report of the debug session reaches the daemon");
  loud.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, recordingCtx(loudBase, []));
  await pollUntil(() => hostBoot.requests.length === 4, "the closed report of the debug session reaches the daemon");
  // assert.deepEqual earlier in this test narrows `lines` to never[]; widen it back before reading it.
  const stderrLines: readonly string[] = lines;
  const bootLines = stderrLines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((line) => {
      const event = line["event"];
      return typeof event === "string" && event.startsWith("host.boot.");
    });
  const events = bootLines.map((line) => line.event);
  assert.ok(events.includes("host.boot.attached"));
  assert.ok(events.includes("host.boot.closed"));
  const bootId = bootReportOf(hostBoot.requests[2]).bootId;
  for (const line of bootLines.filter((entry) => entry.event === "host.boot.attached" || entry.event === "host.boot.closed")) {
    assert.equal(line.correlationId, bootId, "the log line and the report share one boot id");
  }
});

void test("BOOT-08: a daemon that answers SCHEMA_INVALID to host-boot changes no outcome and adds no stderr line", async (t) => {
  const base = scratchDir(t);
  const socketPath = configure(t, base, base);
  hostBootRecorder(t);
  hostBoot.reply = { error: { code: "SCHEMA_INVALID" } };
  await serveDaemon(t, socketPath, [], (request) => answeredFor(request, ACTIVE_STATUS));
  const lines = captureStderr(t);
  const host = createHost();
  const paints: string[] = [];
  await startOmpSession(t, host, paints, base, "realm active");
  await pollUntil(() => hostBoot.requests.length === 1, "the report was sent and refused");
  host.handlers.get("session_shutdown")?.({ type: "session_shutdown" }, recordingCtx(base, []));
  await pollUntil(() => hostBoot.requests.length === 2, "the closed report was sent and refused");
  assert.equal(paints.some((text) => /error|refus/i.test(text)), false, "no failure is painted");
  assert.deepEqual(lines, [], "a refused report adds no stderr line");
});
