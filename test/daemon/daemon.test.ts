// Daemon tests (CLI-01, RT-06, P6-D1, P6-D4, P6-D12). Every test drives the
// real module: single-owner start over a live Unix socket, the startup reap
// before serving, all five CONTROL_METHODS over the channel, and graceful
// shutdown on down. No live Podman, OpenShell, or Anda engine is started: the
// adapter seam carries the existing fakes and scripted probes.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { appendAudit } from "../../src/audit/log.js";
import { reconcileAuditLogs } from "../../src/audit/reconcile.js";
import { makeRealmError, RealmError, type ErrorCode } from "../../src/core/errors.js";
import { displayStatus, STATUS_LABELS } from "../../src/core/status.js";
import {
  MAX_CONTROL_LINE_BYTES,
  sendRequest,
  type ControlReply,
  type ControlRequest,
} from "../../src/daemon/channel.js";
import {
  buildDaemonHandle,
  startDaemon,
  type StartedDaemon,
  type StartDaemonOptions,
} from "../../src/daemon/daemon.js";
import { type BuildDaemonHandleOptions, probeSocketAlive } from "../../src/daemon/seams.js";
import { sweepRootsOf, type StartupReport } from "../../src/daemon/startup.js";
import { selectionOf } from "../../src/daemon/client.js";
import type { SessionEntry } from "../../src/daemon/sessions.js";
import type { CheckResult } from "../../src/doctor/checks.js";
import { createLogger, nullLogger, type Logger } from "../../src/observe/logger.js";
import { connectDaemon } from "../../src/daemon/client.js";
import { ERROR_CATALOGUE } from "../../src/core/errors.js";
import { renameSync } from "node:fs";
import { SessionStore } from "../../src/session/store.js";
import { listWorkspaceEntryIds, workspaceRegistryDirOf, writeWorkspaceEntry } from "../../src/session/workspace-registry.js";
import { HYDRATE_CONCURRENCY } from "../../src/lifecycle/bounds.js";
import { bindRoot, PinnedRoot } from "../../src/fs/root.js";
import type { PodmanProbeResult } from "../../src/runtime/podman-probe.js";
import { controlSocketPath } from "../../src/session/paths.js";
import { currentBootId } from "../../src/session/proc-identity.js";
import { writeRunnerRecord } from "../../src/session/runner-record.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import { FakeBridge } from "../support/fake-bridge.js";
import { FakeExecutionService } from "../support/fake-execution.js";
import { FakeContainerStore, FakeLibpod } from "../support/fake-libpod.js";
import { FakeOpenShell } from "../support/fake-openshell.js";
import { boundedWait, pollUntil, scaledMs } from "../support/timing.js";
import { HARDENING_PROFILE, RUNTIME_ARGV, RUNTIME_BINARY, scratchVolumeNameOf, tmpfsOptionsOf } from "../../src/runtime/hardening.js";
import {
  OPENSHELL_MANAGED_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_VALUE,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
  realmSandboxName,
} from "../../src/runtime/openshell.js";
import { sandboxBindingOf, type SandboxRoots } from "../../src/runtime/driver/sandbox-binding.js";
import { CONFORMING_PROC_STATUS, RUNTIME_OCI_CONFIG_TEXT } from "../runtime/hardening-fixtures.js";
import { OCI_CONFIG_PATH, STATIC_DIR } from "../runtime/seccomp-fixtures.js";
import type { LibpodInspect } from "../../src/runtime/libpod-client.js";
import type { SessionContainers } from "../../src/runtime/session-execution.js";
import type { State } from "../../src/core/states.js";

// The digest the test image is pinned to. A survivor's inspect reports it as its image digest.
const IMAGE_DIGEST = `sha256:${"0".repeat(64)}`;
const IMAGE = `registry.example.com/realm/workload@${IMAGE_DIGEST}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";

interface Fixture {
  readonly base: string;
  readonly ws: string;
  readonly stateDir: string;
  // Policy files live here, outside `base`: a policy file inside a workspace root is refused (POLICY_DENIED).
  readonly policyDir: string;
}

// The resolver of a promise that carries no value. A test holds a listing open until it calls the resolver.
type Resolve = (value: void | PromiseLike<void>) => void;

// A libpod container the libpod double holds: its id, its labels, and what its inspect reports.
interface ContainerSeed {
  readonly id: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly inspect: LibpodInspect;
}

// A listing the libpod double holds open until the test releases it.
interface HeldListing {
  readonly entered: Promise<void>;
  release(): void;
}

// The libpod double of a start: the containers it holds, and the switches a test flips to fail or hold its listings.
interface ContainerDouble {
  readonly libpod: SessionContainers;
  seed(container: ContainerSeed): void;
  present(): string[];
  failListingsFrom(from: number, code: ErrorCode): void;
  holdNextListing(code: ErrorCode): HeldListing;
}

interface DaemonParts {
  readonly options: StartDaemonOptions;
  readonly exec: FakeExecutionService;
  readonly bridge: FakeBridge;
  readonly events: string[];
  readonly containers: ContainerDouble;
}

// Scratch directories are removed once the whole file has run. A test's daemon is stopped by its own t.after
// hook, and t.after hooks run in registration order, so removing a directory at the end of its test would delete
// the socket that hook must still reach.
const scratchDirs: string[] = [];
after(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDirs(): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-daemon-")));
  scratchDirs.push(base);
  const ws = join(base, "ws");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "doc.txt"), "original");
  const policyDir = realpathSync(mkdtempSync(join(tmpdir(), "realm-daemon-policy-")));
  scratchDirs.push(policyDir);
  return { base, ws, stateDir: join(base, "state"), policyDir };
}

function writePolicy(fixture: Fixture, name: string, policy: Record<string, unknown>): string {
  const path = join(fixture.policyDir, name);
  writeFileSync(path, JSON.stringify(policy));
  return path;
}

// The libpod double a start reads its containers through. Every call is recorded in events. A listing can be failed from a given
// call on, or held until the test releases it.
function containerDoubleOf(events: string[]): ContainerDouble {
  const containers = new Map<string, ContainerSeed>();
  let listings = 0;
  let failure: { readonly from: number; readonly code: ErrorCode } | undefined;
  let hold: { readonly code: ErrorCode; readonly enter: Resolve; readonly gate: Promise<void> } | undefined;
  const libpod: SessionContainers = {
    info: () => {
      events.push("info");
      return Promise.resolve({ rootless: true, version: "5.0.0" });
    },
    listContainersByLabel: async (key: string, value: string) => {
      events.push("list");
      listings += 1;
      if (hold !== undefined) {
        const held = hold;
        hold = undefined;
        held.enter();
        await held.gate;
        throw makeRealmError(held.code);
      }
      if (failure !== undefined && listings >= failure.from) {
        throw makeRealmError(failure.code);
      }
      return [...containers.values()]
        .filter((container) => container.labels[key] === value)
        .map((container) => ({ id: container.id, labels: container.labels }));
    },
    inspectContainer: (id: string) => {
      events.push(`inspect:${id}`);
      return Promise.resolve(containers.get(id)?.inspect ?? null);
    },
    stopContainer: () => {
      events.push("stop");
      return Promise.resolve();
    },
    removeContainer: (id: string) => {
      events.push(`remove:${id}`);
      containers.delete(id);
      return Promise.resolve();
    },
  };
  return {
    libpod,
    seed: (container) => {
      containers.set(container.id, container);
    },
    present: () => [...containers.keys()],
    failListingsFrom: (from, code) => {
      failure = { from, code };
    },
    holdNextListing: (code) => {
      let enter: Resolve = () => undefined;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      let open: Resolve = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      hold = { code, enter, gate };
      return {
        entered,
        release: () => {
          open();
        },
      };
    },
  };
}

function daemonParts(fixture: Fixture, overrides?: Partial<StartDaemonOptions>): DaemonParts {
  const events: string[] = [];
  const exec = new FakeExecutionService();
  const bridge = new FakeBridge();
  const containers = containerDoubleOf(events);
  exec.beforeCall("create", () => {
    events.push("create");
  });
  const options: StartDaemonOptions = {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
    },
    // The policy names the workspace as a root, the same shape the compose
    // tests use: the daemon refuses a workspace outside every root. It names
    // advisory mode because the tests below that write while the realm is not
    // active expect the advisory warning; the default is fail-closed.
    policyPath: writePolicy(fixture, "daemon-policy.json", { mode: "advisory", workspaceRoots: [fixture.ws] }),
    exec,
    bridge,
    libpod: containers.libpod,
    clock: () => new Date(CLOCK_ISO),
    runOpenShell: () =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    probe: () => {
      events.push("probe");
      return Promise.resolve<PodmanProbeResult>({ ok: true, version: "5.0.0" });
    },
    ...overrides,
  };
  return { options, exec, bridge, events, containers };
}

function snapshotStateOf(reply: ControlReply): unknown {
  if (typeof reply.result === "object" && reply.result !== null && "snapshot" in reply.result) {
    const snapshot: unknown = reply.result.snapshot;
    if (typeof snapshot === "object" && snapshot !== null && "state" in snapshot) {
      return snapshot.state;
    }
  }
  return undefined;
}

// The notice a status, up or down reply carries, or undefined when the result has no `notice` key.
function noticeOf(reply: ControlReply): unknown {
  if (typeof reply.result === "object" && reply.result !== null && "notice" in reply.result) {
    return reply.result.notice;
  }
  return undefined;
}

// The root a status or up reply names as the daemon's pinned workspace, or undefined when the result has no `boundRoot` key.
function boundRootOf(reply: ControlReply): unknown {
  if (typeof reply.result === "object" && reply.result !== null && "boundRoot" in reply.result) {
    return reply.result.boundRoot;
  }
  return undefined;
}

function hasNoticeKey(reply: ControlReply): boolean {
  return typeof reply.result === "object" && reply.result !== null && "notice" in reply.result;
}

// The parsed lines of one audit file under the state directory.
function auditLinesOf(fixture: Fixture, sessionId: string): Record<string, unknown>[] {
  return readFileSync(join(fixture.stateDir, "audit", `${sessionId}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function displayLabelOf(reply: ControlReply): unknown {
  if (typeof reply.result === "object" && reply.result !== null && "display" in reply.result) {
    const display: unknown = reply.result.display;
    if (typeof display === "object" && display !== null && "label" in display) {
      return display.label;
    }
  }
  return undefined;
}

// Resolves when down finishes teardown; fails fast instead of hanging the suite.
function awaitDone(daemon: StartedDaemon): Promise<void> {
  return boundedWait(daemon.done, "daemon done");
}

// Stops the daemon and waits for its done, each within a bound, so a teardown that does not finish fails here instead of hanging
// the file. A case that holds a start releases it before this runs, so no teardown waits on a held call.
async function cleanupDaemon(daemon: StartedDaemon): Promise<void> {
  try {
    await boundedWait(daemon.stop(), "daemon stop during cleanup");
  } catch {
    // A teardown that failed still leaves the daemon stopped; its failure is reported through done.
  }
  await boundedWait(daemon.done, "daemon done during cleanup").catch(() => undefined);
}

function sendRawLine(socketPath: string, line: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let text = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("raw read timed out"));
    }, scaledMs(15_000));
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      const end = text.indexOf("\n");
      if (end !== -1) {
        clearTimeout(timer);
        socket.destroy();
        resolve(text.slice(0, end));
      }
    });
    socket.once("error", (cause: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(cause);
    });
    socket.write(line);
  });
}

// Writes one request line on a socket that is already open and resolves with the reply line.
function replyOn(socket: Socket, line: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let text = "";
    socket.on("data", (chunk: Buffer) => {
      text += chunk.toString();
      const end = text.indexOf("\n");
      if (end !== -1) {
        resolve(text.slice(0, end));
      }
    });
    socket.once("error", reject);
    socket.write(line);
  });
}

// The control selection of a project directory, as the control channel carries it (C4).
function selectedBy(dir: string) {
  return { selection: selectionOf(dir) };
}

// The session id the daemon derives for the fixture's workspace.
function sessionOf(fixture: Fixture): string {
  return selectionOf(fixture.ws).sessionId;
}

// The admitted session of the fixture's workspace. It exists once an up has admitted it.
function entryOf(daemon: StartedDaemon, fixture: Fixture): SessionEntry {
  const entry = daemon.session(sessionOf(fixture));
  assert.ok(entry !== undefined, "the workspace's session is admitted");
  return entry;
}

// The first startup report of a start. A start that recorded none fails the test here, with a clear message.
function firstReport(reports: readonly StartupReport[]): StartupReport {
  const report: StartupReport | undefined = reports[0];
  assert.ok(report !== undefined, "the startup recorded a report");
  return report;
}

void test("CLI-01: buildDaemonHandle wires the shared composition root and answers snapshot plus dispatcher status (P6-D12)", async () => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const handle = buildDaemonHandle({ ...options, sessionId: sessionOf(fixture) });
  const snapshot = handle.controller.snapshot();
  assert.equal(snapshot.state, "unbound");
  assert.equal(displayStatus(snapshot).label, STATUS_LABELS.disconnected);

  const outcome = await handle.dispatcher.call({ status: {} });
  assert.equal(outcome.outcome, "done");
  if (outcome.tool !== "status") {
    assert.fail("expected a done status");
  }
  assert.deepEqual(outcome.value.snapshot, snapshot);
  assert.equal(outcome.value.display.label, STATUS_LABELS.disconnected);
  await handle.close();
});

void test("RT-04, D-47: buildDaemonHandle builds with no AgentOS driver, and an up is refused with AGENTOS_NOT_CONFIGURED while no container is created", async (t) => {
  const fixture = makeDirs();
  const socketPath = join(fixture.base, "podman.sock");
  const store = new FakeContainerStore();
  const libpod = new FakeLibpod({ store, rootless: true });
  await libpod.start(socketPath);
  t.after(() => libpod.stop());
  const openshell = new FakeOpenShell(store);
  const options: BuildDaemonHandleOptions = {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
    },
    policyPath: writePolicy(fixture, "no-driver-policy.json", { workspaceRoots: [fixture.ws] }),
    sessionId: sessionOf(fixture),
    bridge: new FakeBridge(),
    libpodSocketPath: socketPath,
    runOpenShell: openshell.runner,
    clock: () => new Date(CLOCK_ISO),
  };
  const handle = buildDaemonHandle(options);
  t.after(async () => {
    await handle.close();
  });

  const snapshot = await handle.controller.create(fixture.ws);
  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "AGENTOS_NOT_CONFIGURED");
  assert.equal(openshell.callCount(), 0, "no OpenShell run starts");
  assert.equal(store.list().length, 0, "no container is created");
});

void test("C4: with no andaUrl the session reaches active with no bridge handshake, and exec and write proceed", async (t) => {
  const fixture = makeDirs();
  const { options, bridge } = daemonParts(fixture);
  const handle = buildDaemonHandle({ ...options, sessionId: sessionOf(fixture) });
  t.after(async () => {
    await handle.close();
  });

  const snapshot = await handle.controller.create(fixture.ws);
  assert.equal(snapshot.state, "active");
  assert.equal(bridge.callCount("connect"), 0, "no andaUrl means no handshake, even with a bridge injected");

  const write = await handle.dispatcher.call({ write: { path: "doc.txt", content: "changed" } });
  if (write.outcome !== "done" || write.tool !== "write") {
    assert.fail(`expected a done write, got ${JSON.stringify(write)}`);
  }
  assert.equal(write.value.warning, null);
  assert.equal(readFileSync(join(fixture.ws, "doc.txt"), "utf8"), "changed", "the write lands with no bridge");

  const exec = await handle.dispatcher.call({ exec: { argv: ["ls"] } });
  assert.equal(exec.outcome, "done", `expected a done exec, got ${JSON.stringify(exec)}`);

  const read = await handle.dispatcher.call({ read: { path: "doc.txt", maxBytes: 1024 } });
  assert.equal(read.outcome, "done", `read needs no bridge, got ${JSON.stringify(read)}`);

  const list = await handle.dispatcher.call({ list: { path: ".", depth: 1 } });
  assert.equal(list.outcome, "done", `list needs no bridge, got ${JSON.stringify(list)}`);

  const status = await handle.dispatcher.call({ status: {} });
  if (status.outcome !== "done" || status.tool !== "status") {
    assert.fail(`expected a done status, got ${JSON.stringify(status)}`);
  }
  assert.equal(status.value.snapshot.state, "active");

  const retry = await handle.dispatcher.call({ retry: {} });
  if (retry.outcome !== "done" || retry.tool !== "retry") {
    assert.fail(`expected a done retry, got ${JSON.stringify(retry)}`);
  }
  assert.equal(retry.value.state, "active");
});

void test("C4: with andaUrl set, a bridge that goes down moves active to degraded and exec and write are refused", async (t) => {
  const fixture = makeDirs();
  const { options, bridge } = daemonParts(fixture, {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
      andaUrl: "http://127.0.0.1:9/",
    },
    policyPath: writePolicy(fixture, "fail-closed-policy.json", { workspaceRoots: [fixture.ws], mode: "fail-closed" }),
  });
  const handle = buildDaemonHandle({ ...options, sessionId: sessionOf(fixture) });
  t.after(async () => {
    await handle.close();
  });

  assert.equal((await handle.controller.create(fixture.ws)).state, "active");
  bridge.emit({ kind: "down", code: "ANDA_UNREACHABLE" });
  assert.equal(handle.controller.snapshot().state, "degraded");
  assert.equal(handle.controller.snapshot().reason, "ANDA_UNREACHABLE");

  const write = await handle.dispatcher.call({ write: { path: "doc.txt", content: "changed" } });
  if (write.outcome !== "refused") {
    assert.fail(`expected a refused write, got ${JSON.stringify(write)}`);
  }
  assert.equal(write.code, "REALM_NOT_ACTIVE");
  assert.equal(readFileSync(join(fixture.ws, "doc.txt"), "utf8"), "original", "the refused write changes nothing");
  const exec = await handle.dispatcher.call({ exec: { argv: ["ls"] } });
  if (exec.outcome !== "refused") {
    assert.fail(`expected a refused exec, got ${JSON.stringify(exec)}`);
  }
  assert.equal(exec.code, "REALM_NOT_ACTIVE");
});

void test("B2: under advisory policy a write in error proceeds with the advisory warning", async (t) => {
  const fixture = makeDirs();
  const { options, bridge } = daemonParts(fixture, {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
      andaUrl: "http://127.0.0.1:9/",
    },
  });
  bridge.failNext("connect", "ANDA_UNREACHABLE");
  const handle = buildDaemonHandle({ ...options, sessionId: sessionOf(fixture) });
  t.after(async () => {
    await handle.close();
  });

  const snapshot = await handle.controller.create(fixture.ws);
  assert.equal(snapshot.state, "error");

  const write = await handle.dispatcher.call({ write: { path: "doc.txt", content: "changed" } });
  if (write.outcome !== "done" || write.tool !== "write") {
    assert.fail(`expected a done write, got ${JSON.stringify(write)}`);
  }
  assert.equal(write.value.warning, "realm is error; the write proceeds under advisory policy");
  assert.equal(readFileSync(join(fixture.ws, "doc.txt"), "utf8"), "changed", "the advisory write in error lands");
});

void test("C4: with andaUrl set and the bridge unreachable, the start refuses with ANDA_UNREACHABLE", async (t) => {
  const fixture = makeDirs();
  const { options, bridge } = daemonParts(fixture, {
    runtimeInput: {
      image: IMAGE,
      stateDir: fixture.stateDir,
      workspaceRoot: fixture.ws,
      andaUrl: "http://127.0.0.1:9/",
    },
  });
  bridge.failNext("connect", "ANDA_UNREACHABLE");
  const handle = buildDaemonHandle({ ...options, sessionId: sessionOf(fixture) });
  t.after(async () => {
    await handle.close();
  });

  const snapshot = await handle.controller.create(fixture.ws);
  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.reason, "ANDA_UNREACHABLE");
  assert.equal(bridge.callCount("connect"), 1, "a configured engine is handshaken at start");
});

void test("RT-06: startDaemon with no owner binds the socket and answers status over a real socket pair", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, { id: "s1", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(reply.id, "s1");
  assert.equal(snapshotStateOf(reply), "unbound");
  assert.equal(displayLabelOf(reply), STATUS_LABELS.disconnected);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.equal(down.id, "d1");
  assert.equal(snapshotStateOf(down), "unbound");
  await awaitDone(daemon);
});

void test("RT-06: a second startDaemon against the same state directory refuses with LOCK_CONFLICT (single owner)", async (t) => {
  const fixture = makeDirs();
  const first = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(first));

  await assert.rejects(
    startDaemon(daemonParts(fixture).options),
    (error: unknown) => error instanceof RealmError && error.code === "LOCK_CONFLICT",
  );

  // The first owner still serves.
  const reply = await sendRequest(first.socketPath, { id: "s1", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(reply.id, "s1");
  assert.ok(reply.result !== undefined);

  const down = await sendRequest(first.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.equal(down.id, "d1");
  assert.ok(down.result !== undefined);
  await awaitDone(first);
});

void test("item 12: a timed-out socket probe refuses the start with LOCK_CONFLICT and keeps the socket path", async () => {
  const fixture = makeDirs();
  const socketPath = controlSocketPath(fixture.stateDir);
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  writeFileSync(socketPath, "held by a slow owner");

  await assert.rejects(
    startDaemon(daemonParts(fixture, { probeSocket: () => Promise.resolve("unknown") }).options),
    (error: unknown) =>
      error instanceof RealmError && error.code === "LOCK_CONFLICT" && error.causeCode === "DAEMON_START_TIMEOUT",
  );
  assert.equal(readFileSync(socketPath, "utf8"), "held by a slow owner");
});

void test("item 12: an absent socket probe removes the stale socket path and the start serves", async (t) => {
  const fixture = makeDirs();
  const socketPath = controlSocketPath(fixture.stateDir);
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  writeFileSync(socketPath, "stale");
  const started = await startDaemon(daemonParts(fixture, { probeSocket: () => Promise.resolve("absent") }).options);
  t.after(() => cleanupDaemon(started));

  const reply = await sendRequest(started.socketPath, { id: "s1", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(reply.id, "s1");
  assert.ok(reply.result !== undefined);

  const down = await sendRequest(started.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.equal(down.id, "d1");
  assert.ok(down.result !== undefined);
  await awaitDone(started);
});

void test("item 12: probeSocketAlive reports absent for a missing path and alive for a live owner", async (t) => {
  const fixture = makeDirs();
  const socketPath = controlSocketPath(fixture.stateDir);
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  assert.equal(await probeSocketAlive(socketPath, 1000), "absent");
  const owner = createServer();
  const listening = once(owner, "listening");
  owner.listen(socketPath);
  await listening;
  t.after(async () => {
    const closed = once(owner, "close");
    owner.close();
    await closed;
  });
  assert.equal(await probeSocketAlive(socketPath, 1000), "alive");
});

void test("item 12: probeSocketAlive reports unknown on a dial timeout and absent on any other dial failure", async () => {
  const timedOut = (): Promise<never> => Promise.reject(makeRealmError("DAEMON_START_TIMEOUT"));
  const refused = (): Promise<never> => Promise.reject(new Error("connect ECONNREFUSED"));
  assert.equal(await probeSocketAlive("/unused/control.sock", 1, timedOut), "unknown");
  assert.equal(await probeSocketAlive("/unused/control.sock", 1, refused), "absent");
});

void test("CLI-01: startDaemon runs the startup reap before serving and deletes pre-existing records (P6-D4)", async (t) => {
  const fixture = makeDirs();
  const { options, events } = daemonParts(fixture);
  mkdirSync(join(fixture.stateDir, "sessions"), { recursive: true });
  const stale = join(fixture.stateDir, "sessions", "stale-session.json");
  writeFileSync(stale, JSON.stringify({ sessionId: "stale-session" }));

  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  // The reap listed the realm containers before the daemon began serving, and it created nothing.
  assert.equal(events.includes("list"), true, "the startup reap listed the realm containers");
  assert.equal(events.includes("create"), false, "nothing is created before serving");
  assert.equal(existsSync(stale), false);

  const reply = await sendRequest(daemon.socketPath, { id: "s1", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(snapshotStateOf(reply), "unbound");

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CRASH-01, CRASH-02, CRASH-04: startDaemon sweeps orphan temp files, reconciles the audit log and reports both before serving", async (t) => {
  const fixture = makeDirs();
  const sessions = join(fixture.stateDir, "sessions");
  mkdirSync(sessions, { recursive: true });
  const hourAgo = new Date(Date.now() - 3_600_000);
  const workspaceOrphan = join(fixture.ws, ".doc.txt.realm-tmp-0123456789abcdef");
  const sessionsOrphan = join(sessions, ".rec.json.realm-tmp-fedcba9876543210");
  for (const orphan of [workspaceOrphan, sessionsOrphan]) {
    writeFileSync(orphan, "partial");
    utimesSync(orphan, hourAgo, hourAgo);
  }
  const record = join(sessions, "stale-session.json");
  writeFileSync(record, JSON.stringify({ sessionId: "stale-session" }));
  // An admission whose result line was never written: the daemon that wrote it was killed in between.
  appendAudit(fixture.stateDir, { sessionId: "sess-old", tool: "write", outcome: "ok", phase: "admission", path: "doc.txt" });

  const reports: StartupReport[] = [];
  const parts = daemonParts(fixture, {
    onStartup: (report) => {
      reports.push(report);
    },
  });
  // A realm container that no record names: the reap removes it, and it is the one container this start destroys.
  parts.containers.seed(orphanContainer("orphan-container-01"));
  const { options } = parts;
  const first = await startDaemon(options);
  t.after(() => cleanupDaemon(first));

  // Everything below is observed before the first request is answered.
  assert.equal(existsSync(workspaceOrphan), false, "the aged orphan in the workspace root is removed");
  assert.equal(existsSync(sessionsOrphan), false, "the aged orphan in the sessions directory is removed");
  assert.equal(existsSync(record), false);
  assert.equal(readFileSync(join(fixture.ws, "doc.txt"), "utf8"), "original", "a file that is not an orphan is kept");
  const reconciled = auditLinesOf(fixture, "sess-old").filter((line) => line["phase"] === "reconciliation");
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0]?.["outcome"], "AUDIT_OUTCOME_UNKNOWN");
  assert.equal(
    existsSync(join(fixture.stateDir, "audit", "daemon.jsonl")),
    false,
    "no removal is written to the daemon's own session log until plan 09 attributes it",
  );
  assert.deepEqual(reports, [
    {
      containerIds: ["orphan-container-01"],
      containersRemoved: 1,
      recordsDeleted: 1,
      adopted: 0,
      tempFilesRemoved: 2,
      unattributedTempFiles: 2,
      unattributedRecords: 1,
      registryEntriesRemoved: 0,
      auditLinesReconciled: 1,
      truncated: false,
      unfinishedSweepRoots: [],
      unfinishedAuditFiles: [],
      auditListingTruncated: false,
      maintenanceComplete: true,
      failures: 0,
      failureCodes: [],
      unattributedRecordCodes: ["SCHEMA_INVALID"],
    },
  ]);

  const notice =
    "A previous daemon's sandbox was destroyed at startup: 1 container(s), 1 session record(s). Files in the workspace were kept; state outside it was lost.";
  const status = await sendRequest(first.socketPath, { id: "s1", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(noticeOf(status), notice);
  const again = await sendRequest(first.socketPath, { id: "s2", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(noticeOf(again), notice, "the notice is kept for the daemon's lifetime, not consumed by a read");
  const down = await sendRequest(first.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.equal(noticeOf(down), notice);
  await awaitDone(first);

  // A second start over the same state directory has nothing left to destroy, sweep or reconcile.
  const second = await startDaemon(options);
  t.after(() => cleanupDaemon(second));
  assert.equal(reports.length, 2);
  assert.equal(reports[1]?.containersRemoved, 0);
  assert.equal(reports[1].recordsDeleted, 0);
  assert.equal(reports[1].tempFilesRemoved, 0);
  assert.equal(reports[1].auditLinesReconciled, 0, "a second start appends no reconciliation line");
  assert.equal(auditLinesOf(fixture, "sess-old").filter((line) => line["phase"] === "reconciliation").length, 1);
  const quiet = await sendRequest(second.socketPath, { id: "s3", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(snapshotStateOf(quiet), "unbound");
  assert.equal(hasNoticeKey(quiet), false, "with nothing destroyed the reply has no notice key");
  const stopped = await sendRequest(second.socketPath, { id: "d2", method: "down", params: selectedBy(fixture.ws) });
  assert.equal(hasNoticeKey(stopped), false);
  await awaitDone(second);
});

void test("STARTUP budget: with a zero budget the gate still opens, the report says the maintenance is unfinished, and a restart with the normal budget completes it", async (t) => {
  const fixture = makeDirs();
  const sessions = join(fixture.stateDir, "sessions");
  mkdirSync(sessions, { recursive: true });
  const orphan = join(fixture.ws, ".doc.txt.realm-tmp-0123456789abcdef");
  writeFileSync(orphan, "partial");
  const hourAgo = new Date(Date.now() - 3_600_000);
  utimesSync(orphan, hourAgo, hourAgo);
  appendAudit(fixture.stateDir, { sessionId: "sess-old", tool: "write", outcome: "ok", phase: "admission", path: "doc.txt" });

  const reports: StartupReport[] = [];
  const onStartup = (report: StartupReport): void => {
    reports.push(report);
  };
  // A fixed clock: the deadline equals the start time, so every budgeted step is already out of time. No real wait.
  const { options } = daemonParts(fixture, { onStartup, startupMaintenanceBudgetMs: 0, monotonicNow: () => 5 });
  const first = await startDaemon(options);
  t.after(() => cleanupDaemon(first));

  // The gate opened: a status request is answered.
  const status = await sendRequest(first.socketPath, { id: "s1", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(snapshotStateOf(status), "unbound");
  assert.equal(hasNoticeKey(status), false, "unfinished maintenance does not change the notice");
  assert.equal(existsSync(orphan), true, "the sweep had no time, so the orphan is kept");
  assert.equal(reports.length, 1);
  const unfinished = firstReport(reports);
  assert.equal(unfinished.maintenanceComplete, false);
  assert.equal(unfinished.truncated, true);
  assert.equal(unfinished.auditLinesReconciled, 0);
  assert.deepEqual(unfinished.unfinishedAuditFiles, ["sess-old.jsonl"]);
  assert.ok(unfinished.unfinishedSweepRoots.includes(fixture.ws), "the workspace root is reported as unfinished");
  await sendRequest(first.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  await awaitDone(first);

  // The next start has the normal budget and finishes the work.
  const second = await startDaemon({ ...options, startupMaintenanceBudgetMs: 60_000, monotonicNow: () => 5 });
  t.after(() => cleanupDaemon(second));
  assert.equal(existsSync(orphan), false);
  assert.equal(reports.length, 2);
  const finished = reports[1];
  assert.ok(finished !== undefined, "the second start reported");
  assert.equal(finished.maintenanceComplete, true);
  assert.equal(finished.tempFilesRemoved, 1);
  assert.equal(finished.auditLinesReconciled, 1);
  assert.deepEqual(finished.unfinishedAuditFiles, []);
  assert.deepEqual(finished.unfinishedSweepRoots, []);
  await sendRequest(second.socketPath, { id: "d2", method: "down", params: selectedBy(fixture.ws) });
  await awaitDone(second);
});

void test("CRASH-04: a reap that fails after removing a container still reports the removal, and the start fails with the same error", async () => {
  const fixture = makeDirs();
  const reports: StartupReport[] = [];
  const parts = daemonParts(fixture, {
    onStartup: (report) => {
      reports.push(report);
    },
  });
  parts.containers.seed(orphanContainer("0123abcd"));
  // The first listing finds the container and its removal resolves; the second listing, the removal proof, then fails.
  parts.containers.failListingsFrom(2, "PODMAN_MACHINE_DOWN");

  await assert.rejects(
    startDaemon(parts.options),
    (error: unknown) =>
      error instanceof RealmError && error.code === "REALM_STOPPING" && error.causeCode === "PODMAN_MACHINE_DOWN",
  );
  assert.deepEqual(reports, [
    {
      containerIds: ["0123abcd"],
      containersRemoved: 1,
      recordsDeleted: 0,
      adopted: 0,
      tempFilesRemoved: 0,
      unattributedTempFiles: 0,
      unattributedRecords: 0,
      registryEntriesRemoved: 0,
      auditLinesReconciled: 0,
      truncated: false,
      unfinishedSweepRoots: [],
      unfinishedAuditFiles: [],
      auditListingTruncated: false,
      maintenanceComplete: false,
      failureCodes: [],
      unattributedRecordCodes: [],
      reapFailure: "REALM_STOPPING",
      failures: 1,
    },
  ]);
});

void test("D-1401: a nested sweep root on another device is kept, one on the same device is dropped, and an unreadable device keeps it", () => {
  const fixture = makeDirs();
  const child = join(fixture.ws, "ssd");
  mkdirSync(child);
  const tail = [join(fixture.stateDir, "sessions"), join(fixture.stateDir, "runtime"), join(fixture.stateDir, "audit")];
  // The tail roots exist: an absent root is skipped by the sweep, so these assertions need them on disk.
  for (const dir of tail) {
    mkdirSync(dir, { recursive: true });
  }

  assert.deepEqual(
    sweepRootsOf([fixture.ws, child], fixture.stateDir, () => 7).roots,
    [fixture.ws, ...tail],
    "the same device: the parent walk reaches the child",
  );
  assert.deepEqual(
    sweepRootsOf([fixture.ws, child], fixture.stateDir, (path) => (path === child ? 8 : 7)).roots,
    [fixture.ws, child, ...tail],
    "another device: the parent walk stops at the mount, so the child is a root of its own",
  );
  assert.deepEqual(
    sweepRootsOf([fixture.ws, child], fixture.stateDir, (path) => {
      if (path === child) {
        throw new Error("stat failed");
      }
      return 7;
    }).roots,
    [fixture.ws, child, ...tail],
    "an unreadable device: the root is kept",
  );
  assert.deepEqual(
    sweepRootsOf([fixture.ws, fixture.ws], fixture.stateDir, () => 7).roots,
    [fixture.ws, ...tail],
    "a repeated root is still dropped",
  );
});

void test("D-1401: the sweep roots return the code of a root that does not bind and of a device that cannot be read", () => {
  const fixture = makeDirs();
  const child = join(fixture.ws, "ssd");
  mkdirSync(child);
  // The refused root is a regular file: it exists and is not a directory, so it does not bind (POLICY_DENIED).
  const refused = join(fixture.base, "refused");
  writeFileSync(refused, "not a directory");
  assert.equal(statSync(refused).isFile(), true, "the refused root is a file, so it exists and does not bind");
  const sessions = join(fixture.stateDir, "sessions");
  const runtime = join(fixture.stateDir, "runtime");
  const audit = join(fixture.stateDir, "audit");
  for (const dir of [sessions, runtime, audit]) {
    mkdirSync(dir, { recursive: true });
  }
  const result = sweepRootsOf([fixture.ws, refused, child], fixture.stateDir, (path) => {
    if (path === child) {
      throw new Error("stat failed");
    }
    return 7;
  });
  assert.deepEqual(result.failureCodes, ["POLICY_DENIED", "SCHEMA_INVALID"], "a root that does not bind, then a device that cannot be read");
  assert.deepEqual(result.roots, [fixture.ws, refused, child, sessions, runtime, audit], "every failed root is kept and walked");
});

void test("D-1401: a state directory whose runtime root is absent sweeps the other roots with no failure code, and omits that root", () => {
  const fixture = makeDirs();
  const sessions = join(fixture.stateDir, "sessions");
  const runtime = join(fixture.stateDir, "runtime");
  const audit = join(fixture.stateDir, "audit");
  for (const dir of [sessions, audit]) {
    mkdirSync(dir, { recursive: true });
  }
  assert.equal(existsSync(runtime), false, "the runtime root is absent");
  const result = sweepRootsOf([fixture.ws], fixture.stateDir, () => 7);
  assert.deepEqual(result.failureCodes, [], "an absent root is skipped, not a failure");
  assert.deepEqual(result.roots, [fixture.ws, sessions, audit], "the absent runtime root is omitted");
});

void test("CRASH-02: the startup sweep removes an aged orphan temp file of the progress record in the audit directory, and never the record itself", async (t) => {
  const fixture = makeDirs();
  const audit = join(fixture.stateDir, "audit");
  mkdirSync(audit, { recursive: true });
  // The state directory is outside the workspace root, so only the audit root reaches this directory.
  const orphan = join(audit, "..reconciled.json.realm-tmp-0123456789abcdef");
  const record = join(audit, ".reconciled.json");
  const young = join(audit, "..reconciled.json.realm-tmp-fedcba9876543210");
  const hourAgo = new Date(Date.now() - 3_600_000);
  for (const file of [orphan, record]) {
    writeFileSync(file, file === record ? "{}" : "partial");
    utimesSync(file, hourAgo, hourAgo);
  }
  writeFileSync(young, "in flight");

  const reports: StartupReport[] = [];
  const { options } = daemonParts(fixture, {
    onStartup: (report) => {
      reports.push(report);
    },
  });
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  assert.equal(existsSync(orphan), false, "the aged orphan is removed");
  assert.equal(existsSync(young), true, "a temp file younger than the age bound is kept");
  assert.equal(firstReport(reports).tempFilesRemoved, 1);
  assert.equal(existsSync(join(fixture.stateDir, "audit", "daemon.jsonl")), false, "no removal is written to the daemon's log until plan 09");
  // The record was not removed by the sweep: it is still a regular file (the reconciliation may have rewritten it).
  assert.equal(statSync(record).isFile(), true);
  await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  await awaitDone(daemon);
});

void test("CRASH-04: the up reply carries the startup notice when the reap destroyed a container", async (t) => {
  const fixture = makeDirs();
  const parts = daemonParts(fixture);
  parts.containers.seed(orphanContainer("orphan-container-a"));
  parts.containers.seed(orphanContainer("orphan-container-b"));
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));

  const up = await sendRequest(daemon.socketPath, { id: "u1", method: "up", params: { workspaceRoot: fixture.ws } });
  assert.equal(snapshotStateOf(up), "active");
  assert.equal(
    noticeOf(up),
    "A previous daemon's sandbox was destroyed at startup: 2 container(s), 0 session record(s). Files in the workspace were kept; state outside it was lost.",
  );
});

void test("CLI-01: a failed reap rejects startup before any record is touched (P6-D4)", async () => {
  const fixture = makeDirs();
  mkdirSync(join(fixture.stateDir, "sessions"), { recursive: true });
  const kept = join(fixture.stateDir, "sessions", "kept-session.json");
  writeFileSync(kept, "{}");
  const parts = daemonParts(fixture);
  parts.containers.failListingsFrom(1, "REALM_STOPPING");

  await assert.rejects(
    startDaemon(parts.options),
    (error: unknown) => error instanceof RealmError && error.code === "REALM_STOPPING",
  );
  assert.equal(existsSync(kept), true);
  await assert.rejects(
    sendRequest(controlSocketPath(fixture.stateDir), { id: "s1", method: "status" }),
  );
});

void test("CLI-01: up with a failing probe answers the probe code without starting (P6-D5)", async (t) => {
  const fixture = makeDirs();
  const { options, exec, events } = daemonParts(fixture, {
    probe: () => Promise.resolve<PodmanProbeResult>({ ok: false, code: "PODMAN_MISSING", reason: "podman is missing" }),
  });
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, {
    id: "up-1",
    method: "up",
    params: { workspaceRoot: fixture.ws },
  });
  assert.deepEqual(reply, { id: "up-1", error: { code: "PODMAN_MISSING" } });
  assert.equal(exec.callCount("create"), 0);
  assert.equal(events.includes("list"), true, "the startup reap listed the realm containers before the up");

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CLI-01: up with a healthy probe starts the session and answers the active snapshot", async (t) => {
  const fixture = makeDirs();
  const { options, events } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, {
    id: "up-1",
    method: "up",
    params: { workspaceRoot: fixture.ws },
  });
  assert.equal(reply.id, "up-1");
  assert.equal(snapshotStateOf(reply), "active");
  assert.equal(displayLabelOf(reply), STATUS_LABELS.active);
  assert.deepEqual(events.filter((event) => event === "probe" || event === "create"), ["probe", "create"]);
  assert.ok(events.indexOf("list") < events.indexOf("probe"), "the startup reap ran before the probe");

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.equal(snapshotStateOf(down), "unbound");
  await awaitDone(daemon);
});

void test("RT-06: the status and up replies name the root the daemon is pinned to as a realpath (boundRoot); down names none", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const status = await sendRequest(daemon.socketPath, { id: "s1", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(boundRootOf(status), fixture.ws, "status names the pinned workspace");
  const up = await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  assert.equal(boundRootOf(up), fixture.ws, "up names the pinned workspace");
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.equal(boundRootOf(down), fixture.ws, "down names the pinned workspace too");
  await awaitDone(daemon);
});

void test("CLI-01: up with a missing workspaceRoot refuses with SCHEMA_INVALID", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const empty = await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: {} });
  assert.deepEqual(empty, { id: "up-1", error: { code: "SCHEMA_INVALID" } });
  const absent = await sendRequest(daemon.socketPath, { id: "up-2", method: "up" });
  assert.deepEqual(absent, { id: "up-2", error: { code: "SCHEMA_INVALID" } });

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CLI-01: doctor dispatches runChecks over the socket", async (t) => {
  const fixture = makeDirs();
  const report: readonly CheckResult[] = [
    { id: "policy-file", status: "pass", detail: "policy file ok", fix: null },
  ];
  const { options } = daemonParts(fixture, {
    runChecks: (doctorOptions) =>
      new Promise<readonly CheckResult[]>((resolve) => {
        assert.equal(doctorOptions.stateDir, fixture.stateDir);
        resolve(report);
      }),
  });
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, { id: "doc-1", method: "doctor" });
  assert.equal(reply.id, "doc-1");
  assert.deepEqual(reply.result, report);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

interface DispatcherRecord {
  readonly raws: unknown[];
  readonly outcomes: ToolOutcome[];
}

// Wraps the daemon's own dispatcher instance so each raw tool object and the outcome it produced
// are recorded. With no replacement the real pipeline runs; with one, the replacement answers.
function recordDispatcherCalls(
  entry: SessionEntry,
  replacement?: (raw: unknown) => Promise<ToolOutcome>,
): DispatcherRecord {
  const dispatcher = entry.handle.dispatcher;
  const real = dispatcher.call.bind(dispatcher);
  const record: DispatcherRecord = { raws: [], outcomes: [] };
  dispatcher.call = async (raw: unknown, context?: { readonly correlationId?: string }): Promise<ToolOutcome> => {
    record.raws.push(raw);
    const outcome = await (replacement === undefined ? real(raw, context) : replacement(raw));
    record.outcomes.push(outcome);
    return outcome;
  };
  return record;
}

void test("RT-06: a tool request reaches the dispatcher exactly once and answers its outcome (P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  const record = recordDispatcherCalls(entryOf(daemon, fixture));

  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-1",
    method: "tool",
    params: { ...selectedBy(fixture.ws), tool: { status: {} } },
  });
  assert.equal(reply.id, "tool-1");
  assert.equal(reply.error, undefined);
  assert.deepEqual(record.raws, [{ status: {} }]);
  const [outcome] = record.outcomes;
  assert.ok(outcome !== undefined, "the dispatcher must answer exactly one outcome");
  assert.deepEqual(reply.result, JSON.parse(JSON.stringify(outcome)));

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("OBS-02: a tool call's log correlation id is the id on both audit lines", async (t) => {
  const lines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => { lines.push(line); return true; } },
    level: "info",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon({ ...options, logger });
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });

  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-cid",
    method: "tool",
    params: { ...selectedBy(fixture.ws), tool: { status: {} } },
  });
  assert.equal(reply.error, undefined);
  const logged = lines.map((line) => JSON.parse(line) as { event?: string; correlationId?: string }).find((row) => row.event === "tool.result");
  assert.equal(typeof logged?.correlationId, "string");
  const correlationId = logged?.correlationId ?? "";
  const audit = auditLinesOf(fixture, sessionOf(fixture)).filter((row) => row["correlationId"] === correlationId);
  assert.deepEqual(audit.map((row) => row["phase"]).sort(), ["admission", "result"]);
  appendAudit(fixture.stateDir, {
    sessionId: sessionOf(fixture),
    tool: "status",
    outcome: "ok",
    phase: "admission",
    correlationId,
  });
  assert.equal(reconcileAuditLogs(fixture.stateDir).appended, 1);
  const closed = auditLinesOf(fixture, sessionOf(fixture)).filter((row) => row["phase"] === "reconciliation");
  assert.equal(closed.length, 1);
  assert.equal(closed[0]?.["correlationId"], correlationId);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("OBS-02: an unknown tool key is logged as unknown, not copied into the line", async (t) => {
  const lines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => { lines.push(line); return true; } },
    level: "info",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon({ ...options, logger });
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  const key = "not-a-tool-".repeat(20);
  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-unknown",
    method: "tool",
    params: { ...selectedBy(fixture.ws), tool: { [key]: {} } },
  });
  assert.equal(reply.error?.code, "SCHEMA_INVALID");
  const logged = lines.map((line) => JSON.parse(line) as { event?: string; tool?: string }).find((row) => row.event === "tool.result");
  assert.equal(logged?.tool, "unknown");
  assert.equal(lines.some((line) => line.includes(key)), false);
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("OBS-02: the up correlation id is on the admission and result audit lines of a tool call in that session", async (t) => {
  const lines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => { lines.push(line); return true; } },
    level: "info",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon({ ...options, logger });
  t.after(() => cleanupDaemon(daemon));

  const up = await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  assert.equal(snapshotStateOf(up), "active");
  const upEnd = lines
    .map((line) => JSON.parse(line) as { event?: string; upId?: string })
    .find((row) => row.event === "up.end");
  const upId = upEnd?.upId ?? "";
  assert.match(upId, /^[A-Za-z0-9_-]{1,64}$/);

  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-up",
    method: "tool",
    params: { ...selectedBy(fixture.ws), tool: { status: {} } },
  });
  assert.equal(reply.error, undefined);
  const logged = lines.map((line) => JSON.parse(line) as { event?: string; correlationId?: string }).find((row) => row.event === "tool.result");
  const correlationId = logged?.correlationId ?? "";
  const audit = auditLinesOf(fixture, sessionOf(fixture)).filter((row) => row["correlationId"] === correlationId);
  assert.deepEqual(audit.map((row) => row["phase"]).sort(), ["admission", "result"]);
  for (const row of audit) {
    assert.equal(row["upId"], upId, "each audit line of the call names the up that admitted it");
  }

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("OBS-02: up logs the catalogue code when create returns an error snapshot", async (t) => {
  const lines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => { lines.push(line); return true; } },
    level: "info",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon({
    ...options,
    logger,
    buildHandle: (handleOptions) => {
      const handle = buildDaemonHandle(handleOptions);
      handle.controller.create = () =>
        Promise.resolve({
          state: "error",
          reason: "OPENSHELL_START_FAILED",
          lastTransitionAt: CLOCK_ISO,
        });
      return handle;
    },
  });
  t.after(() => cleanupDaemon(daemon));
  const reply = await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  assert.equal(reply.error, undefined);
  const logged = lines.map((line) => JSON.parse(line) as { event?: string; code?: string; state?: string }).find((row) => row.event === "up.end");
  assert.equal(logged?.code, "OPENSHELL_START_FAILED");
  assert.equal(logged.state, "error");
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("OBS-02: a probe that resolves in error is logged", async (t) => {
  const lines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => { lines.push(line); return true; } },
    level: "warn",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon({ ...options, logger });
  t.after(() => cleanupDaemon(daemon));
  const up = await sendRequest(daemon.socketPath, { id: "u1", method: "up", params: { workspaceRoot: fixture.ws } });
  assert.equal(snapshotStateOf(up), "active");
  entryOf(daemon, fixture).handle.controller.probe = () => Promise.resolve({
    state: "error",
    reason: "OPENSHELL_GATEWAY_LOST",
    lastTransitionAt: CLOCK_ISO,
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 12_000);
  });
  const logged = lines.map((line) => JSON.parse(line) as { event?: string; code?: string }).find((row) => row.event === "health.probe_failed");
  assert.equal(logged?.code, "OPENSHELL_GATEWAY_LOST");
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

// Each log line parsed to its object, in order.
function logRowsOf(lines: readonly string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

void test("OBS-02: lifecycle.transition logs from and to for each state change, and no free-text reason", async (t) => {
  const lines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => { lines.push(line); return true; } },
    level: "info",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon({ ...options, logger });
  t.after(() => cleanupDaemon(daemon));
  const up = await sendRequest(daemon.socketPath, { id: "u1", method: "up", params: { workspaceRoot: fixture.ws } });
  assert.equal(snapshotStateOf(up), "active");

  const transitions = logRowsOf(lines).filter((row) => row["event"] === "lifecycle.transition");
  assert.deepEqual(transitions.map((row) => [row["from"], row["to"]]), [
    ["unbound", "connecting"],
    ["connecting", "active"],
  ]);
  for (const row of transitions) {
    assert.equal("reason" in row, false, "the free-text reason is never logged");
    assert.equal("code" in row, false, "a transition whose reason is not a catalogue code carries no code");
  }
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("OBS-02: control.refused warns with the code of a refused tool call, and control.request is logged once per request", async (t) => {
  const lines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => { lines.push(line); return true; } },
    level: "debug",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon({ ...options, logger });
  t.after(() => cleanupDaemon(daemon));
  const refused = await sendRequest(daemon.socketPath, {
    id: "tool-refused",
    method: "tool",
    params: { ...selectedBy(fixture.ws), tool: "PARAM-MARKER" },
  });
  assert.equal(refused.error?.code, "SCHEMA_INVALID");
  const status = await sendRequest(daemon.socketPath, { id: "status-1", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(status.error, undefined);

  const rows = logRowsOf(lines);
  const requested = rows.filter((row) => row["event"] === "control.request");
  assert.deepEqual(requested.map((row) => [row["method"], row["level"]]), [
    ["tool", "debug"],
    ["status", "debug"],
  ]);
  const warned = rows.filter((row) => row["event"] === "control.refused");
  assert.deepEqual(warned.map((row) => [row["method"], row["level"], row["code"]]), [["tool", "warn", "SCHEMA_INVALID"]]);
  const [requestRow] = requested;
  const [warnRow] = warned;
  assert.deepEqual(Object.keys(requestRow ?? {}).sort(), ["event", "level", "method", "ts"]);
  assert.deepEqual(Object.keys(warnRow ?? {}).sort(), ["code", "event", "level", "method", "ts"]);
  assert.equal(lines.some((line) => line.includes("PARAM-MARKER")), false, "request params are never logged");
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("OBS-02: an unknown control method is refused as a warn with method unrecognized, and its text is never logged", async (t) => {
  const lines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => { lines.push(line); return true; } },
    level: "debug",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon({ ...options, logger });
  t.after(() => cleanupDaemon(daemon));
  const unknown = await sendRequest(daemon.socketPath, { id: "unknown-1", method: "METHOD-MARKER" });
  const code = unknown.error?.code;
  assert.ok(code !== undefined, "an unknown method is refused");
  const warned = logRowsOf(lines).filter((row) => row["event"] === "control.refused");
  assert.deepEqual(warned.map((row) => [row["method"], row["level"], row["code"]]), [["unrecognized", "warn", code]]);
  assert.equal(lines.some((line) => line.includes("METHOD-MARKER")), false, "an unknown method name is never logged");
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("OBS-02: daemon.starting, daemon.listening, daemon.stopping and daemon.stopped each appear once, in order, and daemon.listening has no socket path", async (t) => {
  const lines: string[] = [];
  const logger = createLogger({
    sink: { write: (line) => { lines.push(line); return true; } },
    level: "info",
    now: () => new Date(CLOCK_ISO),
  });
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon({ ...options, logger });
  t.after(() => cleanupDaemon(daemon));
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);

  const names = ["daemon.starting", "daemon.listening", "daemon.stopping", "daemon.stopped"];
  const lifecycle = logRowsOf(lines).filter((row) => names.includes(String(row["event"])));
  assert.deepEqual(lifecycle.map((row) => row["event"]), names);
  const listening = lifecycle[1];
  assert.deepEqual(Object.keys(listening ?? {}).sort(), ["event", "level", "ts"]);
  const listeningLine = lines.find((line) => line.includes("\"event\":\"daemon.listening\""));
  assert.ok(listeningLine !== undefined);
  assert.equal(listeningLine.includes(daemon.socketPath), false);
});

void test("RT-06: a tool request without a tool object refuses with SCHEMA_INVALID and never reaches the dispatcher (P6-D2, P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  const record = recordDispatcherCalls(entryOf(daemon, fixture));

  const withoutTool: ControlRequest[] = [
    { id: "t-1", method: "tool" },
    { id: "t-2", method: "tool", params: {} },
    { id: "t-3", method: "tool", params: { tool: null } },
    { id: "t-4", method: "tool", params: { tool: "status" } },
    { id: "t-5", method: "tool", params: { tool: [] } },
    { id: "t-6", method: "tool", params: [] },
  ];
  for (const request of withoutTool) {
    const reply = await sendRequest(daemon.socketPath, request);
    assert.deepEqual(reply, { id: request.id, error: { code: "SCHEMA_INVALID" } });
  }
  assert.deepEqual(record.raws, []);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("RT-06: a dispatcher that throws a RealmError answers that error's catalogue code (P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  const record = recordDispatcherCalls(entryOf(daemon, fixture), () => Promise.reject(makeRealmError("TOOL_TIMEOUT")));

  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-2",
    method: "tool",
    params: { ...selectedBy(fixture.ws), tool: { status: {} } },
  });
  assert.deepEqual(reply, { id: "tool-2", error: { code: "TOOL_TIMEOUT" } });
  assert.equal(record.raws.length, 1);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("RT-06: a refused outcome answers its catalogue code and no other field (P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  recordDispatcherCalls(
    entryOf(daemon, fixture),
    () =>
      Promise.resolve<ToolOutcome>({
        outcome: "refused",
        tool: "read",
        code: "POLICY_DENIED",
        retryable: false,
      }),
  );

  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-3",
    method: "tool",
    params: { ...selectedBy(fixture.ws), tool: { read: { path: "doc.txt", maxBytes: 16 } } },
  });
  assert.deepEqual(reply, { id: "tool-3", error: { code: "POLICY_DENIED" } });

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CRASH-06: a refused outcome that carries a causeCode answers its code and that causeCode (D-1406)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  recordDispatcherCalls(
    entryOf(daemon, fixture),
    () =>
      Promise.resolve<ToolOutcome>({
        outcome: "refused",
        tool: "retry",
        code: "OPENSHELL_START_FAILED",
        retryable: true,
        causeCode: "PODMAN_MACHINE_DOWN",
      }),
  );

  const reply = await sendRequest(daemon.socketPath, {
    id: "tool-4",
    method: "tool",
    params: { ...selectedBy(fixture.ws), tool: { retry: {} } },
  });
  assert.deepEqual(reply, { id: "tool-4", error: { code: "OPENSHELL_START_FAILED", causeCode: "PODMAN_MACHINE_DOWN" } });

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("RT-06: an oversized request line is refused with a null-id SCHEMA_INVALID, and the dispatcher never sees it (P6-D2, P6-D12)", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  const record = recordDispatcherCalls(entryOf(daemon, fixture));

  const padding = "x".repeat(MAX_CONTROL_LINE_BYTES);
  const oversized = `{"id":"big-1","method":"tool","params":{"tool":{"status":{}},"pad":"${padding}"}}`;
  const raw = await sendRawLine(daemon.socketPath, `${oversized}\n`);
  assert.deepEqual(JSON.parse(raw), { id: null, error: { code: "SCHEMA_INVALID" } });
  assert.deepEqual(record.raws, []);

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CLI-01: a status reply carries the policy mode the daemon loaded (P6-D12)", async (t) => {
  const fixture = makeDirs();
  const policyPath = writePolicy(fixture, "fail-closed-policy.json", {
    mode: "fail-closed",
    workspaceRoots: [fixture.ws],
  });
  const { options } = daemonParts(fixture, { policyPath });
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const status = await sendRequest(daemon.socketPath, { id: "s1", method: "status", params: selectedBy(fixture.ws) });
  const result: unknown = status.result;
  const mode = typeof result === "object" && result !== null && "mode" in result ? result.mode : undefined;
  assert.equal(mode, "fail-closed");

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("RT-06: unknown methods and malformed lines refuse with SCHEMA_INVALID and carry the id", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const unknown = await sendRequest(daemon.socketPath, { id: "u1", method: "nope" });
  assert.deepEqual(unknown, { id: "u1", error: { code: "SCHEMA_INVALID" } });

  const raw = await sendRawLine(daemon.socketPath, '{"id":"raw-1","method":42}\n');
  assert.deepEqual(JSON.parse(raw), { id: "raw-1", error: { code: "SCHEMA_INVALID" } });

  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("CLI-01: down drains, closes, removes the socket, and resolves done", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const before = await sendRequest(daemon.socketPath, { id: "s1", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(snapshotStateOf(before), "unbound");

  const reply = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.equal(reply.id, "d1");
  assert.equal(snapshotStateOf(reply), "unbound");
  await awaitDone(daemon);
  assert.equal(existsSync(daemon.socketPath), false);
  await assert.rejects(sendRequest(daemon.socketPath, { id: "after", method: "status" }));
});

void test("CLI-01: a second down is a no-op that still answers", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));

  const [first, second] = await Promise.all([
    sendRequest(daemon.socketPath, { id: "down-1", method: "down", params: selectedBy(fixture.ws) }),
    sendRequest(daemon.socketPath, { id: "down-2", method: "down", params: selectedBy(fixture.ws) }),
  ]);
  assert.equal(first.id, "down-1");
  assert.ok(first.result !== undefined && first.error === undefined);
  assert.equal(second.id, "down-2");
  assert.ok(second.result !== undefined && second.error === undefined);
  await awaitDone(daemon);
  assert.equal(existsSync(daemon.socketPath), false);
});

void test("QUAL-01: a connection that waits on a failed start is answered with the start's refusal code", async () => {
  const fixture = makeDirs();
  let connectionAccepted!: () => void;
  const accepted = new Promise<void>((resolve) => {
    connectionAccepted = resolve;
  });
  const parts = daemonParts(fixture, {
    onServer: (server) => {
      server.once("connection", () => {
        connectionAccepted();
      });
    },
  });
  // The start's reap is held inside its first listing, with the server already listening, until the test fails it.
  const held = parts.containers.holdNextListing("REALM_STOPPING");
  const starting = startDaemon(parts.options);
  await boundedWait(held.entered, "the start reap");
  const waiting = sendRawLine(controlSocketPath(fixture.stateDir), '{"id":"early","method":"status"}\n');
  // The start fails only once the server has accepted this connection. Closing the listening socket first would
  // reset the connection still in the accept queue, and the client would see a reset rather than the refusal.
  await boundedWait(accepted, "the early connection");
  held.release();
  await boundedWait(
    assert.rejects(starting, (error: unknown) => error instanceof RealmError && error.code === "REALM_STOPPING"),
    "the failed start",
  );
  assert.deepEqual(JSON.parse(await boundedWait(waiting, "the refusal")), { id: null, error: { code: "REALM_STOPPING" } });
});

void test("QUAL-01: a connection that never completes its request line is answered TOOL_TIMEOUT", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture, { timeoutMs: 100 });
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  const raw = await sendRawLine(daemon.socketPath, '{"id":"partial"');
  assert.deepEqual(JSON.parse(raw), { id: null, error: { code: "TOOL_TIMEOUT" } });
});

void test("QUAL-01: a down whose socket file cannot be removed answers SCHEMA_INVALID and still stops", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  // Connected before the swap, so the down request reaches the daemon over this connection.
  const client = createConnection(daemon.socketPath);
  t.after(() => {
    client.destroy();
  });
  await boundedWait(
    new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    }),
    "the client connection",
  );
  // A non-empty directory where the socket file was: removing it without recursion fails.
  rmSync(daemon.socketPath, { force: true });
  mkdirSync(daemon.socketPath);
  writeFileSync(join(daemon.socketPath, "kept"), "not a socket");
  const raw = await boundedWait(
    replyOn(client, `${JSON.stringify({ id: "down-1", method: "down", params: selectedBy(fixture.ws) })}\n`),
    "the down reply",
  );
  const downReply: unknown = JSON.parse(raw);
  assert.equal(typeof downReply === "object" && downReply !== null && "error" in downReply ? downReply.error : undefined, undefined, "the down is answered with the unbound snapshot");
  await assert.rejects(
    awaitDone(daemon),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
    "a socket file that cannot be removed fails done",
  );
});

void test("QUAL-01: a failed start whose socket file cannot be removed keeps its code and names the removal cause", async () => {
  const fixture = makeDirs();
  const socketPath = controlSocketPath(fixture.stateDir);
  const parts = daemonParts(fixture);
  const held = parts.containers.holdNextListing("REALM_STOPPING");
  const starting = startDaemon(parts.options);
  await boundedWait(held.entered, "the start reap");
  // The socket is listening here: a non-empty directory takes its file's place, then the start fails.
  rmSync(socketPath, { force: true });
  mkdirSync(socketPath);
  writeFileSync(join(socketPath, "kept"), "not a socket");
  held.release();
  await boundedWait(
    assert.rejects(
      starting,
      (error: unknown) =>
        error instanceof RealmError && error.code === "REALM_STOPPING" && error.causeCode === "SCHEMA_INVALID",
    ),
    "the failed start",
  );
});

void test("QUAL-01: a reply that cannot be encoded is answered SCHEMA_INVALID, not a silent close", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  // A BigInt cannot be JSON-encoded, so the outcome cannot be written as dispatched.
  const unencodable: unknown = { outcome: "done", tool: "status", value: { size: BigInt(1) } };
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  recordDispatcherCalls(entryOf(daemon, fixture), () => Promise.resolve(unencodable as ToolOutcome));
  const reply = await sendRequest(daemon.socketPath, { id: "big-1", method: "tool", params: { ...selectedBy(fixture.ws), tool: { status: {} } } });
  assert.deepEqual(reply, { id: "big-1", error: { code: "SCHEMA_INVALID" } });
});

void test("QUAL-01: a listening server that fails stops the daemon, and done rejects with that error's code", async (t) => {
  const fixture = makeDirs();
  const servers: Server[] = [];
  const { options } = daemonParts(fixture, {
    onServer: (server) => {
      servers.push(server);
    },
  });
  const daemon = await startDaemon(options);
  const listening = servers[0];
  assert.ok(listening !== undefined, "the daemon hands out its listening server");
  t.after(() => {
    listening.close();
  });
  const stopped = daemon.done.then(
    () => "resolved",
    (cause: unknown) => (cause instanceof RealmError ? cause.code : "not a RealmError"),
  );
  listening.emit("error", makeRealmError("REALM_NOT_ACTIVE"));
  const outcome = await boundedWait(stopped, "the daemon stopping after its listening server failed", 15_000);
  assert.equal(outcome, "REALM_NOT_ACTIVE");
});

void test("CLI-01: a fresh start makes the state and run directories 0700 and leaves a missing ancestor at the default mode (P6-D3)", async (t) => {
  const fixture = makeDirs();
  const ancestor = join(fixture.base, "ancestor");
  const stateDir = join(ancestor, "state");
  const { options } = daemonParts({ ...fixture, stateDir });
  const probe = join(fixture.base, "default-mode-probe");
  mkdirSync(probe);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(statSync(stateDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(stateDir, "run")).mode & 0o777, 0o700);
  assert.equal(statSync(ancestor).mode & 0o777, statSync(probe).mode & 0o777, "the missing ancestor keeps the default mode");
});

void test("a connection error on a served socket is that connection's failure and never stops the daemon", async (t) => {
  // A client killed in the middle of its request leaves an error on the socket the daemon serves it on, after the daemon read
  // the request line (the read helper no longer listens for errors by then). Without a listener on the served socket Node
  // rethrows the error as an uncaught exception and the daemon dies.
  const fixture = makeDirs();
  const { options, exec } = daemonParts(fixture);
  const accepted: Socket[] = [];
  const release = exec.holdNext("create");
  const daemon = await startDaemon({
    ...options,
    onServer: (server) => {
      server.on("connection", (socket: Socket) => {
        accepted.push(socket);
      });
    },
  });
  t.after(async () => {
    release();
    await cleanupDaemon(daemon);
  });

  const client = createConnection(daemon.socketPath);
  await boundedWait(
    new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    }),
    "the client connects",
  );
  client.write(`${JSON.stringify({ id: "gone", method: "up", params: { workspaceRoot: fixture.ws } })}\n`);
  await pollUntil(() => exec.callCount("create") === 1, "the daemon is inside the create call of the up request");
  const served = accepted[0];
  assert.ok(served !== undefined, "the daemon accepted the client's connection");

  served.destroy(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }));
  client.destroy();

  // The request the client left behind keeps running, and the daemon still answers other clients.
  release();
  await exec.settled();
  await pollUntil(async () => {
    const reply = await sendRequest(daemon.socketPath, { id: "alive", method: "status", params: selectedBy(fixture.ws) });
    return reply.id === "alive" && snapshotStateOf(reply) === "active";
  }, "the daemon answers a new client and the abandoned up completed");
});

void test("OBS-03: metrics answers over the control socket and counts the tool call", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, { id: "up-1", method: "up", params: { workspaceRoot: fixture.ws } });
  const tool = await sendRequest(daemon.socketPath, { id: "tool-1", method: "tool", params: { ...selectedBy(fixture.ws), tool: { status: {} } } });
  assert.equal(tool.error, undefined);
  const reply = await sendRequest(daemon.socketPath, { id: "m1", method: "metrics", params: selectedBy(fixture.ws) });
  assert.equal(reply.error, undefined);
  const snap = reply.result as { schema?: number; toolCalls?: { tool?: string; outcome?: string; count?: number }[]; controlRequests?: { method?: string }[] };
  assert.equal(snap.schema, 1);
  assert.equal(snap.toolCalls?.some((row) => row.tool === "status" && row.outcome === "done" && row.count === 1), true);
  assert.equal(snap.controlRequests?.some((row) => row.method === "tool"), true);
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

function ownSocketInodes(): Set<string> {
  const inodes = new Set<string>();
  for (const name of readdirSync("/proc/self/fd")) {
    let link: string;
    try {
      link = readlinkSync(`/proc/self/fd/${name}`);
    } catch {
      continue;
    }
    const match = /^socket:\[(\d+)\]$/.exec(link);
    if (match?.[1] !== undefined) {
      inodes.add(match[1]);
    }
  }
  return inodes;
}

function inetListeners(): string[] {
  const owned = ownSocketInodes();
  const rows: string[] = [];
  for (const name of ["tcp", "tcp6", "udp", "udp6"]) {
    let text: string;
    try {
      text = readFileSync(`/proc/self/net/${name}`, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      const local = parts[1];
      const state = parts[3];
      const inode = parts[9];
      if (local === undefined || state === undefined || inode === undefined || !owned.has(inode)) {
        continue;
      }
      if (name.startsWith("udp") || state === "0A") {
        rows.push(`${name} ${local} ${state}`);
      }
    }
  }
  return rows.sort();
}

function unixPaths(): string[] {
  const owned = ownSocketInodes();
  return readFileSync("/proc/self/net/unix", "utf8")
    .split("\n")
    .slice(1)
    .flatMap((line) => {
      const parts = line.trim().split(/\s+/);
      const inode = parts[6];
      const path = parts.at(-1) ?? "";
      return inode !== undefined && owned.has(inode) && path.startsWith("/") ? [path] : [];
    })
    .sort();
}

void test("OBS-03: starting the daemon adds no TCP or UDP listener, only the Unix control socket", async (t) => {
  const beforeInet = inetListeners();
  const beforeUnix = new Set(unixPaths());
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  assert.deepEqual(inetListeners(), beforeInet);
  const added = unixPaths().filter((path) => !beforeUnix.has(path));
  assert.deepEqual(added, [daemon.socketPath]);
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

void test("OBS-03: a probe that returns probe failed is counted", async (t) => {
  const fixture = makeDirs();
  const { options } = daemonParts(fixture);
  const daemon = await startDaemon(options);
  t.after(() => cleanupDaemon(daemon));
  const up = await sendRequest(daemon.socketPath, { id: "u1", method: "up", params: { workspaceRoot: fixture.ws } });
  assert.equal(snapshotStateOf(up), "active");
  entryOf(daemon, fixture).handle.controller.probe = () => Promise.resolve({
    state: "error",
    reason: "probe failed",
    lastTransitionAt: "2026-01-01T00:00:00.000Z",
  });
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 12_000);
  });
  const reply = await sendRequest(daemon.socketPath, { id: "m1", method: "metrics", params: selectedBy(fixture.ws) });
  const snap = reply.result as { healthProbeFailures?: { code?: string; count?: number }[] };
  assert.equal(snap.healthProbeFailures?.some((row) => row.code === "probe failed" && row.count === 1), true);
  const down = await sendRequest(daemon.socketPath, { id: "d1", method: "down", params: selectedBy(fixture.ws) });
  assert.ok(down.result !== undefined);
  await awaitDone(daemon);
});

// ---- Plan 18-06 (H1): admission (T1) and selected dispatch and session down (T2). Each case names its done-when letter. ----

const OK_PROBE: PodmanProbeResult = { ok: true, version: "5.0.0" };

// Options under which sibling projects below the fixture's base directory can all be admitted by one daemon.
function wideOptions(fixture: Fixture): Partial<StartDaemonOptions> {
  return {
    runtimeInput: { image: IMAGE, stateDir: fixture.stateDir, workspaceRoot: fixture.base },
    policyPath: writePolicy(fixture, "wide-policy.json", { mode: "advisory", workspaceRoots: [fixture.base] }),
  };
}

// A sibling project directory below the fixture's base.
function projectDir(fixture: Fixture, name: string): string {
  const dir = join(fixture.base, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function upRequest(id: string, workspaceRoot: string): ControlRequest {
  return { id, method: "up", params: { workspaceRoot } };
}

// A probe whose first call holds until release() runs, then answers `first`. Later calls answer OK.
function heldFirstProbe(first: PodmanProbeResult): {
  readonly probe: () => Promise<PodmanProbeResult>;
  readonly release: () => void;
  readonly calls: () => number;
} {
  let count = 0;
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    probe: async (): Promise<PodmanProbeResult> => {
      count += 1;
      if (count === 1) {
        await gate;
        return first;
      }
      return OK_PROBE;
    },
    release: (): void => {
      open();
    },
    calls: (): number => count,
  };
}

function sessionIdOfReply(reply: ControlReply): unknown {
  return typeof reply.result === "object" && reply.result !== null && "sessionId" in reply.result
    ? reply.result.sessionId
    : undefined;
}

// A real delay, used only to let a request reach the daemon over its live socket before the test releases a held call. The
// cases that use it wait on the observable state they need, so no assertion depends on the length of the delay.
function pause(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

void test("T1 (a): up for a directory outside every policy root is refused POLICY_DENIED before any probe, container or record write", async (t) => {
  const fixture = makeDirs();
  const outside = join(fixture.base, "outside");
  mkdirSync(outside);
  const parts = daemonParts(fixture);
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, upRequest("ua", outside));
  assert.equal(reply.error?.code, "POLICY_DENIED");
  assert.equal(parts.events.includes("probe"), false, "no probe ran");
  assert.equal(parts.exec.callCount("create"), 0, "no container was created");
  assert.deepEqual(new SessionStore(fixture.stateDir).list(), [], "no record was written");
});

void test("T1 (b): up for a directory under a policy root but outside the configured workspace root is refused POLICY_DENIED", async (t) => {
  const fixture = makeDirs();
  const sibling = projectDir(fixture, "sibling");
  const parts = daemonParts(fixture, {
    policyPath: writePolicy(fixture, "base-policy.json", { mode: "advisory", workspaceRoots: [fixture.base] }),
  });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, upRequest("ub", sibling));
  assert.equal(reply.error?.code, "POLICY_DENIED");
  assert.equal(parts.events.includes("probe"), false, "no probe ran");
  assert.equal(parts.exec.callCount("create"), 0, "no container was created");
  assert.deepEqual(new SessionStore(fixture.stateDir).list(), [], "no record was written");
});

void test("T1 (c): up for the configured workspace root itself succeeds (equality is accepted)", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));

  const reply = await sendRequest(daemon.socketPath, upRequest("uc", fixture.ws));
  assert.equal(snapshotStateOf(reply), "active");
  assert.equal(boundRootOf(reply), fixture.ws);
});

void test("T1 (d): after up of directory A, renaming A makes status with the old selection POLICY_DENIED", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  const id = sessionOf(fixture);
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("u1", fixture.ws))), "active");

  renameSync(fixture.ws, join(fixture.base, "moved"));
  const reply = await sendRequest(daemon.socketPath, {
    id: "s-old",
    method: "status",
    params: { selection: { workspaceRoot: fixture.ws, sessionId: id } },
  });
  assert.equal(reply.error?.code, "POLICY_DENIED");
});

void test("T1 (e): with maxSessions 2 a third distinct up is POLICY_DENIED and a fourth up for an admitted id succeeds", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture, { ...wideOptions(fixture), maxSessions: 2 }).options);
  t.after(() => cleanupDaemon(daemon));
  const [a, b, c]: [string, string, string] = [projectDir(fixture, "a"), projectDir(fixture, "b"), projectDir(fixture, "c")];
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("ea", a))), "active");
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("eb", b))), "active");
  assert.equal((await sendRequest(daemon.socketPath, upRequest("ec", c))).error?.code, "POLICY_DENIED");
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("ea2", a))), "active");
});

void test("T1 (f): a record persisted for B's id that names A makes up of B SANDBOX_NAME_IN_USE with no container call", async (t) => {
  const fixture = makeDirs();
  const parts = daemonParts(fixture, wideOptions(fixture));
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  const a = projectDir(fixture, "a");
  const b = projectDir(fixture, "b");
  new SessionStore(fixture.stateDir).save({
    realmId: "realm-f",
    sessionId: selectionOf(b).sessionId,
    workspaceRoot: a,
    state: "unbound",
    controlSocketPath: controlSocketPath(fixture.stateDir),
    containerId: null,
  });

  const reply = await sendRequest(daemon.socketPath, upRequest("uf", b));
  assert.equal(reply.error?.code, "SANDBOX_NAME_IN_USE");
  assert.equal(parts.exec.callCount("create"), 0, "no container call");
});

void test("T1 (g): after up, renaming the directory makes status, tool and down with the old selection POLICY_DENIED and changes nothing", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  const id = sessionOf(fixture);
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("g1", fixture.ws))), "active");
  const committed = daemon.committedCount();
  const records = new SessionStore(fixture.stateDir).list();

  renameSync(fixture.ws, join(fixture.base, "moved"));
  const old = { workspaceRoot: fixture.ws, sessionId: id };
  for (const request of [
    { id: "g-status", method: "status", params: { selection: old } },
    { id: "g-tool", method: "tool", params: { selection: old, tool: { status: {} } } },
    { id: "g-down", method: "down", params: { selection: old } },
  ]) {
    assert.equal((await sendRequest(daemon.socketPath, request)).error?.code, "POLICY_DENIED", request.id);
  }
  assert.equal(daemon.committedCount(), committed);
  assert.deepEqual(new SessionStore(fixture.stateDir).list(), records);
  assert.notEqual(daemon.session(id), undefined);
});

void test("T1 (h): a re-up of a live project returns the same bound root and session id, adds no entry and builds no second handle", async (t) => {
  const fixture = makeDirs();
  let built = 0;
  const daemon = await startDaemon(
    daemonParts(fixture, {
      buildHandle: (options) => {
        built += 1;
        return buildDaemonHandle(options);
      },
    }).options,
  );
  t.after(() => cleanupDaemon(daemon));
  const first = await sendRequest(daemon.socketPath, upRequest("h1", fixture.ws));
  const second = await sendRequest(daemon.socketPath, upRequest("h2", fixture.ws));
  assert.equal(boundRootOf(second), boundRootOf(first));
  assert.equal(sessionIdOfReply(second), sessionIdOfReply(first));
  assert.equal(built, 1, "buildHandle ran once for the id");
  assert.equal(daemon.committedCount(), 1);
});

void test("T1 (i): with maxSessions 2 and a first probe refusal, two concurrent ups for X serialize; X then admits, Y admits, Z is POLICY_DENIED", async (t) => {
  const fixture = makeDirs();
  const [x, y, z]: [string, string, string] = [projectDir(fixture, "x"), projectDir(fixture, "y"), projectDir(fixture, "z")];
  const held = heldFirstProbe({ ok: false, code: "PODMAN_MISSING", reason: "podman is missing" });
  const parts = daemonParts(fixture, { ...wideOptions(fixture), maxSessions: 2, probe: held.probe });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));

  const first = sendRequest(daemon.socketPath, upRequest("i1", x));
  const second = sendRequest(daemon.socketPath, upRequest("i2", x));
  await pause(50);
  held.release();
  assert.equal((await first).error?.code, "PODMAN_MISSING");
  assert.equal(snapshotStateOf(await second), "active");
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("i3", y))), "active");
  assert.equal((await sendRequest(daemon.socketPath, upRequest("i4", z))).error?.code, "POLICY_DENIED");
  assert.equal(parts.exec.callCount("create"), 2, "X and Y each create once, Z never");
  assert.ok(parts.exec.callCount("create") - parts.exec.callCount("destroy") <= 2, "at most two live containers");
});

void test("T1 (j): two concurrent ups for one new id: the second waits, both attach, buildHandle runs once, one entry, one create", async (t) => {
  const fixture = makeDirs();
  const held = heldFirstProbe(OK_PROBE);
  let built = 0;
  const parts = daemonParts(fixture, {
    probe: held.probe,
    buildHandle: (options) => {
      built += 1;
      return buildDaemonHandle(options);
    },
  });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));

  const first = sendRequest(daemon.socketPath, upRequest("j1", fixture.ws));
  const second = sendRequest(daemon.socketPath, upRequest("j2", fixture.ws));
  await pause(50);
  held.release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(sessionIdOfReply(a), sessionOf(fixture));
  assert.equal(sessionIdOfReply(b), sessionOf(fixture));
  assert.equal(boundRootOf(a), boundRootOf(b));
  assert.equal(built, 1, "buildHandle once");
  assert.equal(parts.exec.callCount("create"), 1, "one create");
  assert.equal(daemon.committedCount(), 1, "one entry");
});

void test("T1 (k): a down for Q queued behind an up of Q runs after the up, destroys the session, and leaves no container, entry or slot", async (t) => {
  const fixture = makeDirs();
  const held = heldFirstProbe(OK_PROBE);
  const parts = daemonParts(fixture, { probe: held.probe });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  const id = sessionOf(fixture);

  const up = sendRequest(daemon.socketPath, upRequest("k-up", fixture.ws));
  await pause(50);
  const down = sendRequest(daemon.socketPath, { id: "k-down", method: "down", params: selectedBy(fixture.ws) });
  await pause(50);
  held.release();
  assert.equal(snapshotStateOf(await up), "active");
  assert.equal(snapshotStateOf(await down), "unbound");
  assert.equal(parts.exec.callCount("destroy"), 1, "the session's container is destroyed");
  assert.equal(daemon.session(id), undefined, "no registry entry");
  assert.equal(daemon.isCommitted(id), false, "no admission slot");
});

void test("T1 (l): with maxSessions 2, a down of W while Y's admission is in flight does not arm the stop; down of Y after it completes does", async (t) => {
  const fixture = makeDirs();
  const [w, y]: [string, string] = [projectDir(fixture, "w"), projectDir(fixture, "y")];
  let hold: Promise<void> | undefined;
  let open: () => void = () => undefined;
  const parts = daemonParts(fixture, {
    ...wideOptions(fixture),
    maxSessions: 2,
    probe: async () => {
      if (hold !== undefined) {
        await hold;
        hold = undefined;
      }
      return OK_PROBE;
    },
  });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  let doneResolved = false;
  daemon.done.then(() => {
    doneResolved = true;
  }, () => undefined);
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("l-w", w))), "active");

  hold = new Promise<void>((resolve) => {
    open = resolve;
  });
  const yUp = sendRequest(daemon.socketPath, upRequest("l-y", y));
  await pause(50);
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, { id: "l-dw", method: "down", params: selectedBy(w) })), "unbound");
  await pause(50);
  assert.equal(doneResolved, false, "reservedCount is 1, so the stop is not armed");
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, { id: "l-sw", method: "status", params: selectedBy(w) })), "unbound");

  open();
  assert.equal(snapshotStateOf(await yUp), "active");
  assert.equal(parts.exec.callCount("create"), 2, "W and Y each create once");
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, { id: "l-sy", method: "status", params: selectedBy(y) })), "active");
  await sendRequest(daemon.socketPath, { id: "l-dy", method: "down", params: selectedBy(y) });
  await awaitDone(daemon);
});

void test("T1 (m): with scaled client bounds, an up and a down queued behind a held up expire with TOOL_TIMEOUT, call no probe or destroy, and Q stays registered", async (t) => {
  const fixture = makeDirs();
  const held = heldFirstProbe(OK_PROBE);
  const parts = daemonParts(fixture, {
    probe: held.probe,
    probeTimeoutMs: 20,
    replyAllowanceMs: 20,
    clientBoundMs: { up: 300, down: 300 },
  });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  const id = sessionOf(fixture);

  const holder = sendRequest(daemon.socketPath, upRequest("m-holder", fixture.ws));
  await pollUntil(() => held.calls() === 1, "the holder's probe is held");
  const queuedUp = await sendRequest(daemon.socketPath, upRequest("m-up", fixture.ws));
  const queuedDown = await sendRequest(daemon.socketPath, { id: "m-down", method: "down", params: selectedBy(fixture.ws) });
  assert.equal(queuedUp.error?.code, "TOOL_TIMEOUT");
  assert.equal(queuedDown.error?.code, "TOOL_TIMEOUT");
  assert.equal(held.calls(), 1, "the waiters ran no probe");
  assert.equal(parts.exec.callCount("destroy"), 0, "the waiters ran no destroy");
  // Q is not yet in the registry: its entry is set after the probe (step 6). Its reservation is what the waiters must not drop.
  assert.equal(daemon.committedCount(), 1, "Q keeps its reservation");

  held.release();
  assert.equal(snapshotStateOf(await holder), "active");
  assert.notEqual(daemon.session(id), undefined, "Q is registered once its probe has passed");
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, { id: "m-later", method: "down", params: selectedBy(fixture.ws) })), "unbound");
});

void test("T1 (n): a create failing with a code other than REALM_STOPPING keeps its slot unproven until down releases it", async (t) => {
  const fixture = makeDirs();
  const [x, y, z]: [string, string, string] = [projectDir(fixture, "x"), projectDir(fixture, "y"), projectDir(fixture, "z")];
  const parts = daemonParts(fixture, { ...wideOptions(fixture), maxSessions: 2 });
  parts.exec.failNext("create", "PODMAN_MISSING");
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));

  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("n1", x))), "error");
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("n2", y))), "active");
  assert.equal((await sendRequest(daemon.socketPath, upRequest("n3", z))).error?.code, "POLICY_DENIED");
  await sendRequest(daemon.socketPath, { id: "n4", method: "down", params: selectedBy(x) });
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("n5", z))), "active");
});

void test("T1 (o): a down whose destroy holds, with an up queued behind it: after the destroy the stop is armed and the queued up is REALM_STOPPING with no probe or create", async (t) => {
  const fixture = makeDirs();
  const parts = daemonParts(fixture);
  const releaseDestroy = parts.exec.holdNext("destroy");
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("o-up", fixture.ws))), "active");
  const probesBefore = parts.events.filter((event) => event === "probe").length;

  const down = sendRequest(daemon.socketPath, { id: "o-down", method: "down", params: selectedBy(fixture.ws) });
  await pause(50);
  const queued = sendRequest(daemon.socketPath, upRequest("o-queued", fixture.ws));
  await pause(50);
  releaseDestroy();
  assert.equal(snapshotStateOf(await down), "unbound");
  assert.equal((await queued).error?.code, "REALM_STOPPING");
  assert.equal(parts.events.filter((event) => event === "probe").length, probesBefore, "no probe for the queued up");
  assert.equal(parts.exec.callCount("create"), 1, "no create for the queued up");
  await awaitDone(daemon);
});

void test("T1 (p): two concurrent ups for one id while the first create is held: both attach, buildHandle once, create once (lock cap 1.94 s, longer than the 100 ms hold)", async (t) => {
  const fixture = makeDirs();
  let built = 0;
  const parts = daemonParts(fixture, {
    clientBoundMs: { up: 2000 },
    probeTimeoutMs: 20,
    replyAllowanceMs: 20,
    buildHandle: (options) => {
      built += 1;
      return buildDaemonHandle(options);
    },
  });
  const release = parts.exec.holdNext("create");
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));

  const first = sendRequest(daemon.socketPath, upRequest("p1", fixture.ws));
  await pollUntil(() => parts.exec.callCount("create") === 1, "the first create is held");
  const second = sendRequest(daemon.socketPath, upRequest("p2", fixture.ws));
  await pause(100);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(snapshotStateOf(a), "active");
  assert.equal(snapshotStateOf(b), "active", "the second attaches to the live session");
  assert.equal(built, 1, "buildHandle once");
  assert.equal(parts.exec.callCount("create"), 1, "controller.create ran once");
});

void test("T1 (q): a waiter granted after a failed holder, with budget below 2 probeTimeoutMs + startupBudgetMs, is STARTUP_BUDGET_EXCEEDED before any reservation", async (t) => {
  const fixture = makeDirs();
  const held = heldFirstProbe({ ok: false, code: "PODMAN_MISSING", reason: "podman is missing" });
  const parts = daemonParts(fixture, { probe: held.probe, probeTimeoutMs: 20, replyAllowanceMs: 20, clientBoundMs: { up: 400 } });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));

  const holder = sendRequest(daemon.socketPath, upRequest("q1", fixture.ws));
  await pollUntil(() => held.calls() === 1, "the holder's probe is held");
  const waiter = sendRequest(daemon.socketPath, upRequest("q2", fixture.ws));
  await pause(50);
  held.release();
  assert.equal((await holder).error?.code, "PODMAN_MISSING");
  assert.equal((await waiter).error?.code, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(held.calls(), 1, "the waiter ran no probe");
  assert.equal(parts.exec.callCount("create"), 0, "no create");
  assert.equal(daemon.committedCount(), 0, "registry and slots unchanged");
});

void test("T1 (r): a down granted when its entry is already absent replies the unbound snapshot and calls no destroy", async (t) => {
  const fixture = makeDirs();
  const held = heldFirstProbe({ ok: false, code: "PODMAN_MISSING", reason: "podman is missing" });
  const parts = daemonParts(fixture, { probe: held.probe });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));

  const holder = sendRequest(daemon.socketPath, upRequest("r1", fixture.ws));
  await pollUntil(() => held.calls() === 1, "the holder's probe is held");
  const down = sendRequest(daemon.socketPath, { id: "r-down", method: "down", params: selectedBy(fixture.ws) });
  await pause(50);
  held.release();
  await holder;
  assert.equal(snapshotStateOf(await down), "unbound");
  assert.equal(parts.exec.callCount("destroy"), 0, "no destroy");
});

void test("T1 (s): a waited down granted with budget below TEARDOWN_TIMEOUT_MS + reply allowance replies TOOL_TIMEOUT before destroy, and Q stays registered", async (t) => {
  const fixture = makeDirs();
  const held = heldFirstProbe(OK_PROBE);
  const parts = daemonParts(fixture, {
    probe: held.probe,
    probeTimeoutMs: 20,
    replyAllowanceMs: 20,
    clientBoundMs: { up: 1000, down: 300 },
  });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  const id = sessionOf(fixture);

  const holder = sendRequest(daemon.socketPath, upRequest("s-up", fixture.ws));
  await pollUntil(() => held.calls() === 1, "the holder's probe is held");
  const down = sendRequest(daemon.socketPath, { id: "s-down", method: "down", params: selectedBy(fixture.ws) });
  await pause(50);
  held.release();
  assert.equal(snapshotStateOf(await holder), "active");
  assert.equal((await down).error?.code, "TOOL_TIMEOUT");
  assert.equal(parts.exec.callCount("destroy"), 0, "no destroy before the refusal");
  assert.notEqual(daemon.session(id), undefined, "Q stays registered");
});

void test("T1 (t): an uncontended up with startupBudgetMs above the client bound still creates and replies the snapshot", async (t) => {
  const fixture = makeDirs();
  const parts = daemonParts(fixture, {
    policyPath: writePolicy(fixture, "budget-policy.json", {
      mode: "advisory",
      workspaceRoots: [fixture.ws],
      startupBudgetMs: 900_000,
    }),
    clientBoundMs: { up: 1000 },
  });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("t1", fixture.ws))), "active");
  assert.equal(parts.exec.callCount("create"), 1);
});

void test("T2 (a): two projects admitted on one daemon answer their own tool calls, and each audit file holds only its own lines", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture, wideOptions(fixture)).options);
  t.after(() => cleanupDaemon(daemon));
  const [a, b]: [string, string] = [projectDir(fixture, "a"), projectDir(fixture, "b")];
  await sendRequest(daemon.socketPath, upRequest("a-up", a));
  await sendRequest(daemon.socketPath, upRequest("b-up", b));
  const idA = selectionOf(a).sessionId;
  const idB = selectionOf(b).sessionId;
  const callsA = recordDispatcherCalls(entryOf(daemon, { ...fixture, ws: a }));
  const callsB = recordDispatcherCalls(entryOf(daemon, { ...fixture, ws: b }));
  assert.equal((await sendRequest(daemon.socketPath, { id: "a-tool", method: "tool", params: { ...selectedBy(a), tool: { status: {} } } })).error, undefined);
  assert.equal((await sendRequest(daemon.socketPath, { id: "b-tool", method: "tool", params: { ...selectedBy(b), tool: { status: {} } } })).error, undefined);
  assert.equal(callsA.raws.length, 1, "A's handle answered A's call");
  assert.equal(callsB.raws.length, 1, "B's handle answered B's call");
  const linesA = auditLinesOf(fixture, idA);
  const linesB = auditLinesOf(fixture, idB);
  assert.ok(linesA.length > 0 && linesB.length > 0);
  assert.equal(linesA.every((row) => row["sessionId"] === idA), true, "A's file holds only A's lines");
  assert.equal(linesB.every((row) => row["sessionId"] === idB), true, "B's file holds only B's lines");
});

void test("T2 (b): down of A returns the unbound snapshot; B stays active and answers tool calls; A's record and entry are gone and B's remain", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture, wideOptions(fixture)).options);
  t.after(() => cleanupDaemon(daemon));
  const [a, b]: [string, string] = [projectDir(fixture, "a"), projectDir(fixture, "b")];
  const idA = selectionOf(a).sessionId;
  const idB = selectionOf(b).sessionId;
  await sendRequest(daemon.socketPath, upRequest("b-up", a));
  await sendRequest(daemon.socketPath, upRequest("b-up2", b));

  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, { id: "b-down-a", method: "down", params: selectedBy(a) })), "unbound");
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, { id: "b-status-b", method: "status", params: selectedBy(b) })), "active");
  assert.equal((await sendRequest(daemon.socketPath, { id: "b-tool-b", method: "tool", params: { ...selectedBy(b), tool: { status: {} } } })).error, undefined);
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, { id: "b-status-a", method: "status", params: selectedBy(a) })), "unbound");
  const store = new SessionStore(fixture.stateDir);
  assert.equal(store.load(idA), null, "A's record is gone");
  assert.notEqual(store.load(idB), null, "B's record remains");
  assert.equal(daemon.session(idA), undefined, "A's entry is gone");
  assert.notEqual(daemon.session(idB), undefined, "B's entry remains");
});

void test("T2 (c): with maxSessions 2, a failed destroy of A keeps A registered and its slot committed, and a third admission is still POLICY_DENIED", async (t) => {
  const fixture = makeDirs();
  const parts = daemonParts(fixture, { ...wideOptions(fixture), maxSessions: 2 });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  const [a, b, c]: [string, string, string] = [projectDir(fixture, "a"), projectDir(fixture, "b"), projectDir(fixture, "c")];
  await sendRequest(daemon.socketPath, upRequest("c-ua", a));
  await sendRequest(daemon.socketPath, upRequest("c-ub", b));
  const idA = selectionOf(a).sessionId;
  parts.exec.failNext("destroy", "REALM_STOPPING");

  assert.equal((await sendRequest(daemon.socketPath, { id: "c-down", method: "down", params: selectedBy(a) })).error?.code, "REALM_STOPPING");
  assert.notEqual(daemon.session(idA), undefined, "A stays registered");
  assert.equal(daemon.isCommitted(idA), true, "A's slot stays committed");
  assert.equal((await sendRequest(daemon.socketPath, upRequest("c-uc", c))).error?.code, "POLICY_DENIED");
  assert.notEqual(new SessionStore(fixture.stateDir).load(idA), null, "A's record is not removed");
});

void test("T2 (e): a down of the last session makes done resolve", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, upRequest("e-up", fixture.ws));
  await sendRequest(daemon.socketPath, { id: "e-down", method: "down", params: selectedBy(fixture.ws) });
  await awaitDone(daemon);
});

void test("T2 (f): stop() on StartedDaemon with two sessions calls controller.stop for each and sends no control request", async (t) => {
  const fixture = makeDirs();
  // Every control request is logged once as control.request (OBS-02), so the count is the number of requests the daemon served.
  let controlRequests = 0;
  const logger: Logger = {
    ...nullLogger,
    debug: (event) => {
      if (event === "control.request") {
        controlRequests += 1;
      }
    },
  };
  const daemon = await startDaemon(daemonParts(fixture, { ...wideOptions(fixture), logger }).options);
  t.after(() => cleanupDaemon(daemon));
  const [a, b]: [string, string] = [projectDir(fixture, "a"), projectDir(fixture, "b")];
  await sendRequest(daemon.socketPath, upRequest("f-ua", a));
  await sendRequest(daemon.socketPath, upRequest("f-ub", b));
  const servedBeforeStop = controlRequests;
  assert.equal(servedBeforeStop, 2, "the two ups were served over the socket");
  let stops = 0;
  for (const dir of [a, b]) {
    const controller = entryOf(daemon, { ...fixture, ws: dir }).handle.controller;
    const stopOnce = controller.stop.bind(controller);
    controller.stop = () => {
      stops += 1;
      return stopOnce();
    };
  }
  await daemon.stop();
  assert.equal(stops, 2, "controller.stop ran for each session");
  assert.equal(controlRequests, servedBeforeStop, "stop sent no control request");
  await awaitDone(daemon);
});

void test("T2 (stop-log): a session whose stop fails is carried as the code on daemon.stopped, and stop() rejects with that code", async (t) => {
  const fixture = makeDirs();
  const stoppedCodes: unknown[] = [];
  const logger: Logger = {
    ...nullLogger,
    info: (event, fields) => {
      if (event === "daemon.stopped") {
        stoppedCodes.push(fields?.["code"]);
      }
    },
  };
  const daemon = await startDaemon(daemonParts(fixture, { logger }).options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, upRequest("i-up", fixture.ws));
  entryOf(daemon, fixture).handle.controller.stop = () => Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN"));

  await assert.rejects(daemon.stop(), (error: unknown) => error instanceof RealmError && error.code === "PODMAN_MACHINE_DOWN");
  assert.deepEqual(stoppedCodes, ["PODMAN_MACHINE_DOWN"]);
});

void test("T2 (h): every status, up and down reply carries the sessionId of its selection", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  const id = sessionOf(fixture);
  assert.equal(sessionIdOfReply(await sendRequest(daemon.socketPath, { id: "h-s", method: "status", params: selectedBy(fixture.ws) })), id);
  assert.equal(sessionIdOfReply(await sendRequest(daemon.socketPath, upRequest("h-u", fixture.ws))), id);
  assert.equal(sessionIdOfReply(await sendRequest(daemon.socketPath, { id: "h-d", method: "down", params: selectedBy(fixture.ws) })), id);
});

void test("T2 (i): onAuditHead is called with A's id on A's create and again on A's destroy", async (t) => {
  const fixture = makeDirs();
  const calls: string[] = [];
  const daemon = await startDaemon(
    daemonParts(fixture, {
      onAuditHead: (sessionId) => {
        calls.push(sessionId);
      },
    }).options,
  );
  t.after(() => cleanupDaemon(daemon));
  const id = sessionOf(fixture);
  await sendRequest(daemon.socketPath, upRequest("i-up", fixture.ws));
  await sendRequest(daemon.socketPath, { id: "i-down", method: "down", params: selectedBy(fixture.ws) });
  assert.deepEqual(calls, [id, id]);
  const destroyLines = auditLinesOf(fixture, id).filter((line) => line["tool"] === "session.destroy");
  assert.equal(destroyLines.length, 1, "the destroy line lands in the session's audit file");
  assert.equal(destroyLines[0]?.["outcome"], "ok");
});

void test("T2 (j): a down that names no live session on an empty daemon resolves done; with B live it does not stop the daemon", async (t) => {
  const fixture = makeDirs();
  const empty = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(empty));
  await sendRequest(empty.socketPath, { id: "j-down", method: "down", params: selectedBy(fixture.ws) });
  await awaitDone(empty);

  const other = makeDirs();
  const [a, b]: [string, string] = [projectDir(other, "a"), projectDir(other, "b")];
  const live = await startDaemon(daemonParts(other, wideOptions(other)).options);
  t.after(() => cleanupDaemon(live));
  await sendRequest(live.socketPath, upRequest("j-b", b));
  let stopped = false;
  live.done.then(() => {
    stopped = true;
  }, () => undefined);
  await sendRequest(live.socketPath, { id: "j-na", method: "down", params: selectedBy(a) });
  await pause(50);
  assert.equal(stopped, false, "B is live, so the daemon keeps running");
  assert.equal(snapshotStateOf(await sendRequest(live.socketPath, { id: "j-sb", method: "status", params: selectedBy(b) })), "active");
});

void test("T2 (k): the object startDaemon resolves to has no handle key, and session(id) returns the entry", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(Object.keys(daemon).includes("handle"), false);
  await sendRequest(daemon.socketPath, upRequest("k-up", fixture.ws));
  const entry = daemon.session(sessionOf(fixture));
  assert.notEqual(entry, undefined);
  assert.equal(entry?.sessionId, sessionOf(fixture));
});

void test("T2 (d): a lock taken through A's handle is absent from B's lock table", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture, wideOptions(fixture)).options);
  t.after(() => cleanupDaemon(daemon));
  const [a, b]: [string, string] = [projectDir(fixture, "a"), projectDir(fixture, "b")];
  await sendRequest(daemon.socketPath, upRequest("d-ua", a));
  await sendRequest(daemon.socketPath, upRequest("d-ub", b));
  const target = join(a, "doc.txt");
  const entryA = entryOf(daemon, { ...fixture, ws: a });
  const entryB = entryOf(daemon, { ...fixture, ws: b });
  entryA.handle.locks.acquire(target, "owner-a");
  assert.equal(entryA.handle.locks.isHeldBy(target, "owner-a"), true, "A's table holds the lock");
  assert.equal(entryB.handle.locks.isHeldBy(target, "owner-a"), false, "B's table does not see it");
});

void test("T2 (g): a status without a selection is refused SCHEMA_INVALID", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  const reply = await sendRequest(daemon.socketPath, { id: "g-bare", method: "status" });
  assert.deepEqual(reply, { id: "g-bare", error: { code: "SCHEMA_INVALID" } });
});

void test("T2 (g): a daemon refusal rejects with a RealmError carrying the daemon's code, message and causeCode over the real socket", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, upRequest("g-up", fixture.ws));
  const raised: RealmError[] = [];
  entryOf(daemon, fixture).handle.dispatcher.call = () => {
    const refusal = makeRealmError("OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN");
    raised.push(refusal);
    return Promise.reject(refusal);
  };
  const client = connectDaemon(daemon.socketPath, selectionOf(fixture.ws));
  const error = await client.call({ exec: {} }).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  client.close();
  assert.ok(error instanceof RealmError, "the refusal arrives as a RealmError");
  assert.equal(error.code, raised[0]?.code);
  assert.equal(error.causeCode, "PODMAN_MACHINE_DOWN");
  assert.equal(error.message, ERROR_CATALOGUE.OPENSHELL_START_FAILED.reason);
});

void test("T2 (g): a daemon refusal without a cause rejects with no causeCode property", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, upRequest("g-up2", fixture.ws));
  entryOf(daemon, fixture).handle.dispatcher.call = () => Promise.reject(makeRealmError("TOOL_TIMEOUT"));
  const client = connectDaemon(daemon.socketPath, selectionOf(fixture.ws));
  const error = await client.call({ status: {} }).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  client.close();
  assert.ok(error instanceof RealmError, "the refusal arrives as a RealmError");
  assert.equal(error.code, "TOOL_TIMEOUT");
  assert.equal(Object.hasOwn(error, "causeCode"), false);
});

void test("T2 (g): a refused tool outcome rejects with its catalogue code", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, upRequest("g-up3", fixture.ws));
  entryOf(daemon, fixture).handle.dispatcher.call = () =>
    Promise.resolve<ToolOutcome>({ outcome: "refused", tool: "read", code: "POLICY_DENIED", retryable: false });
  const client = connectDaemon(daemon.socketPath, selectionOf(fixture.ws));
  const error = await client.call({ read: { path: "doc.txt", maxBytes: 16 } }).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  client.close();
  assert.ok(error instanceof RealmError, "the refusal arrives as a RealmError");
  assert.equal(error.code, "POLICY_DENIED");
  assert.equal(error.message, ERROR_CATALOGUE.POLICY_DENIED.reason);
  assert.equal(Object.hasOwn(error, "causeCode"), false);
});

void test("T2 (g): a refused tool outcome that carries a causeCode rejects with that causeCode", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(daemonParts(fixture).options);
  t.after(() => cleanupDaemon(daemon));
  await sendRequest(daemon.socketPath, upRequest("g-up4", fixture.ws));
  entryOf(daemon, fixture).handle.dispatcher.call = () =>
    Promise.resolve<ToolOutcome>({
      outcome: "refused",
      tool: "retry",
      code: "OPENSHELL_START_FAILED",
      retryable: true,
      causeCode: "PODMAN_MACHINE_DOWN",
    });
  const client = connectDaemon(daemon.socketPath, selectionOf(fixture.ws));
  const error = await client.call({ retry: {} }).then(
    () => undefined,
    (cause: unknown) => cause,
  );
  client.close();
  assert.ok(error instanceof RealmError, "the refusal arrives as a RealmError");
  assert.equal(error.code, "OPENSHELL_START_FAILED");
  assert.equal(error.causeCode, "PODMAN_MACHINE_DOWN");
  assert.equal(error.message, ERROR_CATALOGUE.OPENSHELL_START_FAILED.reason);
});

void test("T2 (g): up refused by the podman probe rejects with the probe code over the real socket", async (t) => {
  const fixture = makeDirs();
  const daemon = await startDaemon(
    daemonParts(fixture, {
      probe: () => Promise.resolve<PodmanProbeResult>({ ok: false, code: "PODMAN_MISSING", reason: "podman is missing" }),
    }).options,
  );
  t.after(() => cleanupDaemon(daemon));
  const client = connectDaemon(daemon.socketPath, selectionOf(fixture.ws));
  const error = await client.up().then(
    () => undefined,
    (cause: unknown) => cause,
  );
  client.close();
  assert.ok(error instanceof RealmError, "the refusal arrives as a RealmError");
  assert.equal(error.code, "PODMAN_MISSING");
  assert.equal(error.message, ERROR_CATALOGUE.PODMAN_MISSING.reason);
});

// MULTI-03 (plan 09 T1, C9): a startup writes each orphan removal to the audit file of the session whose recorded workspace holds
// the path, and writes no line under the id daemon. The owners are read before the reap deletes the records.
void test("MULTI-03: a startup attributes each orphan removal to the session whose recorded workspace holds it, and writes no daemon line", async (t) => {
  const fixture = makeDirs();
  const [a, b]: [string, string] = [projectDir(fixture, "a"), projectDir(fixture, "b")];
  const store = new SessionStore(fixture.stateDir);
  for (const dir of [a, b]) {
    store.save({
      realmId: `realm-${selectionOf(dir).sessionId}`,
      sessionId: selectionOf(dir).sessionId,
      workspaceRoot: dir,
      state: "unbound",
      controlSocketPath: controlSocketPath(fixture.stateDir),
      containerId: null,
    });
  }
  const hourAgo = new Date(Date.now() - 3_600_000);
  const orphanA = join(a, ".fa.txt.realm-tmp-0123456789abcdef");
  const orphanB = join(b, ".fb.txt.realm-tmp-0123456789abcdef");
  const outside = join(fixture.base, ".fo.txt.realm-tmp-0123456789abcdef");
  for (const orphan of [orphanA, orphanB, outside]) {
    writeFileSync(orphan, "partial");
    utimesSync(orphan, hourAgo, hourAgo);
  }
  const reports: StartupReport[] = [];
  const daemon = await startDaemon(
    daemonParts(fixture, {
      ...wideOptions(fixture),
      onStartup: (report) => {
        reports.push(report);
      },
    }).options,
  );
  t.after(() => cleanupDaemon(daemon));

  assert.equal(existsSync(orphanA), false);
  assert.equal(existsSync(orphanB), false);
  assert.equal(existsSync(outside), false);
  assert.deepEqual(auditLinesOf(fixture, selectionOf(a).sessionId).map((line) => line["path"]), [orphanA]);
  assert.deepEqual(auditLinesOf(fixture, selectionOf(b).sessionId).map((line) => line["path"]), [orphanB]);
  assert.equal(existsSync(join(fixture.stateDir, "audit", "daemon.jsonl")), false, "no line is written under the id daemon");
  assert.equal(firstReport(reports).unattributedTempFiles, 1, "the file outside both workspaces is counted, not attributed");
  assert.equal(firstReport(reports).recordsDeleted, 2);
  assert.deepEqual(store.list(), [], "the reap deleted both records, and the attribution was taken before it");
});

void test("MULTI-03: a record the startup cannot read is counted in unattributedRecords and the start completes (C9)", async (t) => {
  const fixture = makeDirs();
  mkdirSync(join(fixture.stateDir, "sessions"), { recursive: true });
  writeFileSync(join(fixture.stateDir, "sessions", "bad-session.json"), "{not json");
  const reports: StartupReport[] = [];
  const daemon = await startDaemon(
    daemonParts(fixture, {
      onStartup: (report) => {
        reports.push(report);
      },
    }).options,
  );
  t.after(() => cleanupDaemon(daemon));

  assert.equal(reports.length, 1, "the startup completed its maintenance");
  assert.equal(firstReport(reports).unattributedRecords, 1);
  assert.equal(firstReport(reports).maintenanceComplete, true);
  assert.equal(snapshotStateOf(await sendRequest(daemon.socketPath, upRequest("bad-s", fixture.ws))), "active");
});

void test("MULTI-03: the startup report names the code of a record it could not read, beside unattributedRecords", async (t) => {
  const fixture = makeDirs();
  mkdirSync(join(fixture.stateDir, "sessions"), { recursive: true });
  writeFileSync(join(fixture.stateDir, "sessions", "bad-session.json"), "{not json");
  const reports: StartupReport[] = [];
  const daemon = await startDaemon(
    daemonParts(fixture, {
      onStartup: (report) => {
        reports.push(report);
      },
    }).options,
  );
  t.after(() => cleanupDaemon(daemon));

  assert.equal(firstReport(reports).unattributedRecords, 1);
  assert.deepEqual(firstReport(reports).unattributedRecordCodes, ["SCHEMA_INVALID"]);
});

void test("MULTI-03: a startup removes the registry entries an earlier generation left, and a second startup removes none", async (t) => {
  const fixture = makeDirs();
  // A daemon that stops without a down keeps its record and its registry entry, as a killed daemon leaves them.
  const first = await startDaemon(daemonParts(fixture).options);
  assert.equal(snapshotStateOf(await sendRequest(first.socketPath, upRequest("g-up", fixture.ws))), "active");
  assert.equal(listWorkspaceEntryIds(fixture.stateDir).length, 1, "the earlier generation left one registry entry");
  await first.stop();
  await awaitDone(first);

  const reports: StartupReport[] = [];
  const second = await startDaemon(
    daemonParts(fixture, {
      onStartup: (report) => {
        reports.push(report);
      },
    }).options,
  );
  t.after(() => cleanupDaemon(second));
  assert.equal(firstReport(reports).registryEntriesRemoved, 1);
  assert.equal(firstReport(reports).recordsDeleted, 1);
  assert.deepEqual(listWorkspaceEntryIds(fixture.stateDir), [], "the entry's file is gone");
  await second.stop();
  await awaitDone(second);

  const third = await startDaemon(
    daemonParts(fixture, {
      onStartup: (report) => {
        reports.push(report);
      },
    }).options,
  );
  t.after(() => cleanupDaemon(third));
  assert.equal(reports[1]?.registryEntriesRemoved, 0, "a second startup removes nothing");
});
// ---- Startup reap and adoption: a survivor is adopted when its record names it and its inspect conforms to the verdict ----
// The secret root and the sandbox state root a startup derives a survivor's binding from. Both are absolute.
function secretRootOf(fixture: Fixture): string {
  return join(fixture.base, "secret");
}

function sandboxStateRootOf(fixture: Fixture): string {
  return join(fixture.base, "sandbox-state");
}

// The roots a survivor in one workspace is bound from, as the startup verdict derives them.
function sandboxRootsOf(fixture: Fixture, workspaceRoot: string): SandboxRoots {
  return { workspaceRoot, stateRoot: sandboxStateRootOf(fixture), secretRoot: secretRootOf(fixture) };
}

// The options a startup needs to judge a survivor: the two roots, and the host readers its conformance check reads.
function survivorOptionsOf(fixture: Fixture): Partial<StartDaemonOptions> {
  return {
    secretRoot: secretRootOf(fixture),
    sandboxStateRoot: sandboxStateRootOf(fixture),
    readOciConfig: () => RUNTIME_OCI_CONFIG_TEXT,
    readProcStatus: () => CONFORMING_PROC_STATUS,
  };
}

// A libpod container of a session's sandbox that the adoption verdict accepts: the container id, the realm sandbox name, both
// OpenShell labels, running, and every conformance property for the binding the roots derive. A test passes other labels to make
// the verdict refuse the container.
function survivorOf(
  roots: SandboxRoots,
  sessionId: string,
  containerId: string,
  labels?: Readonly<Record<string, string>>,
): ContainerSeed {
  const sandbox = realmSandboxName(sessionId);
  const binding = sandboxBindingOf(roots, sandbox);
  const scratch = scratchVolumeNameOf(sessionId);
  const ownLabels: Readonly<Record<string, string>> = labels ?? {
    [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE,
    [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: sandbox,
  };
  return {
    id: containerId,
    labels: ownLabels,
    inspect: {
      Id: containerId,
      Name: sandbox,
      ImageDigest: IMAGE_DIGEST,
      Path: RUNTIME_BINARY,
      Args: RUNTIME_ARGV.slice(1),
      State: { Running: true, Status: "running", Pid: 4242 },
      StaticDir: STATIC_DIR,
      OCIConfigPath: OCI_CONFIG_PATH,
      Config: { User: HARDENING_PROFILE.workloadUser, Labels: ownLabels },
      HostConfig: {
        Privileged: false,
        CapAdd: [],
        SecurityOpt: ["no-new-privileges"],
        ReadonlyRootfs: true,
        Tmpfs: Object.fromEntries(
          [...HARDENING_PROFILE.tmpfs, HARDENING_PROFILE.supervisorCaDestination].map((destination) => [
            destination,
            tmpfsOptionsOf(destination).join(","),
          ]),
        ),
        PidsLimit: HARDENING_PROFILE.pidsLimit,
        Memory: HARDENING_PROFILE.memoryBytes,
        MemorySwap: HARDENING_PROFILE.memoryBytes,
        NanoCpus: HARDENING_PROFILE.nanoCpus,
        NetworkMode: HARDENING_PROFILE.networkMode,
        Devices: [],
        PidMode: "private",
        IpcMode: "shareable",
        UTSMode: "private",
        CgroupMode: "private",
        UsernsMode: "keep-id:uid=1001,gid=1001",
      },
      Mounts: [
        { Type: "bind", Source: roots.workspaceRoot, Destination: "/workspace", RW: true },
        { Type: "bind", Source: binding.stateDir, Destination: "/realm-state", RW: false },
        { Type: "bind", Source: binding.channelDir, Destination: HARDENING_PROFILE.channelDestination, RW: true },
        { Type: "volume", Name: scratch, Source: `/var/lib/containers/storage/volumes/${scratch}/_data`, Destination: HARDENING_PROFILE.scratchDestination, RW: true, Options: ["rw", "noexec", "nosuid", "nodev"] },
      ],
    },
  };
}

// A realm container that no session record names. The startup reap removes it.
function orphanContainer(containerId: string): ContainerSeed {
  const sandbox = realmSandboxName(containerId);
  return {
    id: containerId,
    labels: { [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE, [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: sandbox },
    inspect: { Id: containerId, Name: sandbox, State: { Running: true, Status: "running", Pid: 4242 } },
  };
}

// A pid no process can hold: Linux caps pids at 4194304, so this names no live runner. The daemon tests run no runner process
// (their exec is a double), so a survivor's runner record names this pid with the current boot id. The hydration proof reads an
// absent leader in an empty group, so the survivor hydrates. The cases that signal a live runner are in adopt-hydrate.test.ts.
const ABSENT_RUNNER_PID = 4194305;

// Writes the runner record a previous daemon leaves for a survivor whose runner is no longer running (see ABSENT_RUNNER_PID).
function recordAbsentRunner(stateDir: string, sessionId: string): void {
  const bootId = currentBootId();
  assert.ok(bootId !== null, "the boot id is readable on this host");
  writeRunnerRecord(stateDir, sessionId, {
    schema: 1,
    pid: ABSENT_RUNNER_PID,
    pgid: ABSENT_RUNNER_PID,
    startTicks: 0,
    bootId,
  });
}

// Makes a session's container a survivor of an earlier daemon: the exec double holds it, the record names it, and the libpod
// double lists it under the session's sandbox. Returns its container id.
async function seedSurvivor(fixture: Fixture, parts: DaemonParts, workspaceRoot: string): Promise<string> {
  const sessionId = selectionOf(workspaceRoot).sessionId;
  const { containerId } = await parts.exec.create({ idempotencyKey: sessionId, workspaceRoot });
  new SessionStore(fixture.stateDir).save({
    realmId: `realm-${sessionId}`,
    sessionId,
    workspaceRoot,
    state: "active",
    controlSocketPath: controlSocketPath(fixture.stateDir),
    containerId,
  });
  writeWorkspaceEntry(fixture.stateDir, bindRoot(workspaceRoot), sessionId);
  recordAbsentRunner(fixture.stateDir, sessionId);
  parts.containers.seed(survivorOf(sandboxRootsOf(fixture, workspaceRoot), sessionId, containerId));
  return containerId;
}

// The state the controller of a registered session reports. The session must be registered.
function stateOf(daemon: StartedDaemon, sessionId: string): State {
  const entry = daemon.session(sessionId);
  assert.ok(entry !== undefined, "the session is registered");
  return entry.handle.controller.snapshot().state;
}

// The startup notice sentences the daemon words. The destroy sentence keeps the wording it has always carried.
function destroyedNoticeOf(containers: number, records: number): string {
  return `A previous daemon's sandbox was destroyed at startup: ${String(containers)} container(s), ${String(records)} session record(s). Files in the workspace were kept; state outside it was lost.`;
}

function adoptedNoticeOf(sessions: number): string {
  return `${String(sessions)} session(s) from the previous daemon were adopted and kept. Their records were kept and each was brought back while the daemon served; a session that did not come back is in error.`;
}

void test("startup with a verified survivor: the session is adopted, its record and registry entry are kept, its controller reaches active, its container is not removed", async (t) => {
  const fixture = makeDirs();
  // A previous daemon admitted the session and stopped without a down, so its record and registry entry remain.
  const earlier = await startDaemon(daemonParts(fixture).options);
  assert.equal(snapshotStateOf(await sendRequest(earlier.socketPath, upRequest("v-up", fixture.ws))), "active");
  await earlier.stop();
  await awaitDone(earlier);
  assert.equal(listWorkspaceEntryIds(fixture.stateDir).length, 1, "the earlier generation left one registry entry");
  const reports: StartupReport[] = [];
  const parts = daemonParts(fixture, {
    ...survivorOptionsOf(fixture),
    onStartup: (report) => {
      reports.push(report);
    },
  });
  const containerId = await seedSurvivor(fixture, parts, fixture.ws);
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(firstReport(reports).adopted, 1, "the verified survivor is adopted");
  assert.equal(firstReport(reports).containersRemoved, 0);
  assert.equal(firstReport(reports).recordsDeleted, 0);
  assert.equal(firstReport(reports).registryEntriesRemoved, 0, "the adopted session's registry entry is kept");
  assert.deepEqual(parts.containers.present(), [containerId], "the survivor's container is not removed");
  assert.equal(parts.events.includes(`remove:${containerId}`), false);
  assert.equal(new SessionStore(fixture.stateDir).load(sessionOf(fixture))?.containerId, containerId, "its record is kept");
  assert.equal(listWorkspaceEntryIds(fixture.stateDir).length, 1, "its registry entry is kept");
  assert.equal(stateOf(daemon, sessionOf(fixture)), "active", "its controller reaches active");
  const status = await sendRequest(daemon.socketPath, { id: "v-status", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(snapshotStateOf(status), "active");
  await sendRequest(daemon.socketPath, { id: "v-down", method: "down", params: selectedBy(fixture.ws) });
  await awaitDone(daemon);
});

void test("the startup notice for an adoption alone is the adoption sentence, with no destroy sentence", async (t) => {
  const fixture = makeDirs();
  const parts = daemonParts(fixture, survivorOptionsOf(fixture));
  await seedSurvivor(fixture, parts, fixture.ws);
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  const status = await sendRequest(daemon.socketPath, { id: "an-status", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(noticeOf(status), adoptedNoticeOf(1));
});

void test("the startup notice names the containers destroyed, then the sessions adopted, joined by one space", async (t) => {
  const fixture = makeDirs();
  const parts = daemonParts(fixture, survivorOptionsOf(fixture));
  await seedSurvivor(fixture, parts, fixture.ws);
  parts.containers.seed(orphanContainer("orphan-container-c"));
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  const status = await sendRequest(daemon.socketPath, { id: "dn-status", method: "status", params: selectedBy(fixture.ws) });
  assert.equal(noticeOf(status), `${destroyedNoticeOf(1, 0)} ${adoptedNoticeOf(1)}`);
});

void test("startup with an unverified container: the container is removed, and its record is deleted", async (t) => {
  const fixture = makeDirs();
  const sessionId = sessionOf(fixture);
  const containerId = "unverified-container-01";
  new SessionStore(fixture.stateDir).save({
    realmId: `realm-${sessionId}`,
    sessionId,
    workspaceRoot: fixture.ws,
    state: "active",
    controlSocketPath: controlSocketPath(fixture.stateDir),
    containerId,
  });
  const reports: StartupReport[] = [];
  const parts = daemonParts(fixture, {
    ...survivorOptionsOf(fixture),
    onStartup: (report) => {
      reports.push(report);
    },
  });
  // The container's sandbox-name label names another sandbox, so the verdict refuses it and the reap removes it.
  parts.containers.seed(
    survivorOf(sandboxRootsOf(fixture, fixture.ws), sessionId, containerId, {
      [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE,
      [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: "realm-another-session",
    }),
  );
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  assert.deepEqual(parts.containers.present(), [], "the unverified container is removed");
  assert.equal(parts.events.includes(`remove:${containerId}`), true);
  assert.equal(new SessionStore(fixture.stateDir).load(sessionId), null, "its record is deleted");
  assert.equal(firstReport(reports).adopted, 0);
  assert.deepEqual(firstReport(reports).containerIds, [containerId]);
  assert.equal(firstReport(reports).containersRemoved, 1);
  assert.equal(firstReport(reports).recordsDeleted, 1);
  assert.equal(daemon.session(sessionId), undefined, "no session is adopted");
});

void test("startup where the reap rejects: startup fails, nothing is served, the registry entries are untouched", async () => {
  const fixture = makeDirs();
  // A previous daemon admitted the session and stopped without a down: its record and registry entry remain.
  const earlier = await startDaemon(daemonParts(fixture).options);
  assert.equal(snapshotStateOf(await sendRequest(earlier.socketPath, upRequest("rj-up", fixture.ws))), "active");
  await earlier.stop();
  await awaitDone(earlier);
  const parts = daemonParts(fixture);
  parts.containers.failListingsFrom(1, "PODMAN_MACHINE_DOWN");
  await assert.rejects(startDaemon(parts.options), (error) => error instanceof RealmError && error.code === "PODMAN_MACHINE_DOWN");
  assert.equal(listWorkspaceEntryIds(fixture.stateDir).length, 1, "the registry entry is untouched");
  assert.equal(new SessionStore(fixture.stateDir).list().length, 1, "no record is deleted");
  await assert.rejects(sendRequest(controlSocketPath(fixture.stateDir), { id: "rj-status", method: "status" }));
});

void test("startup where one adopted session's hydration fails: that session is in error and another adopted session still serves", async (t) => {
  const fixture = makeDirs();
  const [a, b] = [projectDir(fixture, "a"), projectDir(fixture, "b")];
  const reports: StartupReport[] = [];
  const parts = daemonParts(fixture, {
    ...wideOptions(fixture),
    ...survivorOptionsOf(fixture),
    onStartup: (report) => {
      reports.push(report);
    },
  });
  await seedSurvivor(fixture, parts, a);
  await seedSurvivor(fixture, parts, b);
  // The next start the hydration issues fails. Which session that is depends on the order of hydration, so the test reads the
  // states back instead of assuming one.
  parts.exec.failNext("start", "OPENSHELL_START_FAILED");
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(firstReport(reports).adopted, 2, "both survivors are adopted");
  assert.equal(firstReport(reports).failures, 1, "one hydration failed");
  const sessions = [a, b].map((dir) => ({ dir, state: stateOf(daemon, selectionOf(dir).sessionId) }));
  assert.equal(sessions.filter((session) => session.state === "error").length, 1, "the failed session is in error");
  const healthy = sessions.filter((session) => session.state === "active");
  const [survivor] = healthy;
  assert.equal(healthy.length, 1, "the other session came back");
  assert.ok(survivor !== undefined);
  const status = await sendRequest(daemon.socketPath, { id: "hy-status", method: "status", params: selectedBy(survivor.dir) });
  assert.equal(snapshotStateOf(status), "active", "the other adopted session still serves");
});

// ---- Hydration after serve: the stored pin, the refusal of an unproven pin, serve-then-hydrate, bounded concurrency, the budget ----

void test("startup refuses a survivor whose stored pin no longer names its workspace: it is not adopted and nothing starts", async (t) => {
  const fixture = makeDirs();
  const sessionId = sessionOf(fixture);
  const reports: StartupReport[] = [];
  const lines: string[] = [];
  const logger = createLogger({
    sink: {
      write: (line) => {
        lines.push(line);
        return true;
      },
    },
    level: "info",
    now: () => new Date(CLOCK_ISO),
  });
  const parts = daemonParts(fixture, {
    ...survivorOptionsOf(fixture),
    logger,
    onStartup: (report) => {
      reports.push(report);
    },
  });
  const containerId = await seedSurvivor(fixture, parts, fixture.ws);
  // The pin names another inode, so the workspace is not the directory the session was created in.
  const actual = statSync(fixture.ws);
  writeWorkspaceEntry(fixture.stateDir, new PinnedRoot(fixture.ws, actual.dev, actual.ino + 1), sessionId);
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(firstReport(reports).adopted, 0, "the session is not adopted");
  assert.equal(firstReport(reports).containersRemoved, 1, "its container is removed");
  assert.equal(firstReport(reports).recordsDeleted, 1, "its record is deleted");
  assert.deepEqual(parts.containers.present(), [], "the container is not left in place");
  assert.equal(parts.events.includes(`remove:${containerId}`), true);
  assert.equal(parts.exec.callCount("start"), 0, "no start runs for it");
  assert.equal(daemon.session(sessionId), undefined, "no session is registered");
  assert.ok(
    lines.some((line) => line.includes('"event":"startup.adoption_refused"') && line.includes('"code":"POLICY_DENIED"')),
    "the refusal is logged with POLICY_DENIED",
  );
});

void test("startup refuses a survivor whose workspace entry has no device and inode: refused as SCHEMA_INVALID and not adopted", async (t) => {
  const fixture = makeDirs();
  const sessionId = sessionOf(fixture);
  const reports: StartupReport[] = [];
  const lines: string[] = [];
  const logger = createLogger({
    sink: {
      write: (line) => {
        lines.push(line);
        return true;
      },
    },
    level: "info",
    now: () => new Date(CLOCK_ISO),
  });
  const parts = daemonParts(fixture, {
    ...survivorOptionsOf(fixture),
    logger,
    onStartup: (report) => {
      reports.push(report);
    },
  });
  const containerId = await seedSurvivor(fixture, parts, fixture.ws);
  // The entry names the session and the workspace but records no device and inode, so the pin cannot be proven.
  writeFileSync(
    join(workspaceRegistryDirOf(fixture.stateDir), `${sessionId}.json`),
    JSON.stringify({ schema: 1, sessionId, workspaceRoot: fixture.ws }),
  );
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(firstReport(reports).adopted, 0, "the session is not adopted");
  assert.equal(firstReport(reports).containersRemoved, 1, "its container is removed");
  assert.deepEqual(parts.containers.present(), [], "the container is not left in place");
  assert.equal(parts.events.includes(`remove:${containerId}`), true);
  assert.equal(parts.exec.callCount("start"), 0, "no start runs for it");
  assert.equal(daemon.session(sessionId), undefined, "no session is registered");
  assert.ok(
    lines.some((line) => line.includes('"event":"startup.adoption_refused"') && line.includes('"code":"SCHEMA_INVALID"')),
    "the refusal is logged with SCHEMA_INVALID",
  );
});

void test("startup refuses a survivor whose workspace is gone: its container is removed and the refusal is logged with its code", async (t) => {
  const fixture = makeDirs();
  const sessionId = sessionOf(fixture);
  const reports: StartupReport[] = [];
  const lines: string[] = [];
  const logger = createLogger({
    sink: {
      write: (line) => {
        lines.push(line);
        return true;
      },
    },
    level: "info",
    now: () => new Date(CLOCK_ISO),
  });
  const parts = daemonParts(fixture, {
    ...survivorOptionsOf(fixture),
    ...wideOptions(fixture),
    logger,
    onStartup: (report) => {
      reports.push(report);
    },
  });
  const containerId = await seedSurvivor(fixture, parts, fixture.ws);
  // The workspace directory is removed after the container was created, so its record cannot be resolved at startup.
  rmSync(fixture.ws, { recursive: true, force: true });
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(firstReport(reports).adopted, 0, "the session is not adopted");
  assert.equal(firstReport(reports).containersRemoved, 1, "its container is removed");
  assert.deepEqual(parts.containers.present(), [], "the container is not left in place");
  assert.equal(parts.events.includes(`remove:${containerId}`), true);
  assert.equal(parts.exec.callCount("start"), 0, "no start runs for it");
  assert.equal(daemon.session(sessionId), undefined, "no session is registered");
  assert.ok(
    lines.some((line) => line.includes('"event":"startup.adoption_refused"') && line.includes('"code":"POLICY_DENIED"')),
    "the refusal is logged with POLICY_DENIED",
  );
});

void test("a request for an adopted session whose hydration is pending is refused with REALM_NOT_ACTIVE, and a hydrated one still answers", async (t) => {
  const fixture = makeDirs();
  const [a, b] = [projectDir(fixture, "a"), projectDir(fixture, "b")];
  const parts = daemonParts(fixture, { ...wideOptions(fixture), ...survivorOptionsOf(fixture) });
  await seedSurvivor(fixture, parts, a);
  await seedSurvivor(fixture, parts, b);
  // The first start is held until the test releases it, so one session's hydration stays pending while the other settles.
  const release = parts.exec.holdNext("start");
  t.after(release);
  const starting = startDaemon(parts.options);
  starting.catch(() => undefined);
  const socketPath = controlSocketPath(fixture.stateDir);
  await pollUntil(() => existsSync(socketPath), "the control socket is listening");
  // A request waits for the gate, then one session is refused at once and the other answers active.
  await pollUntil(async () => {
    const replies = await Promise.all(
      [a, b].map((dir) => sendRequest(socketPath, { id: "pending-status", method: "status", params: selectedBy(dir) })),
    );
    const refused = replies.filter((reply) => reply.error?.code === "REALM_NOT_ACTIVE");
    const active = replies.filter((reply) => snapshotStateOf(reply) === "active");
    return refused.length === 1 && active.length === 1;
  }, "one session is refused while its hydration is pending and the other is active");
  release();
  const daemon = await starting;
  t.after(() => cleanupDaemon(daemon));
  assert.equal(stateOf(daemon, selectionOf(a).sessionId), "active", "the first session comes back");
  assert.equal(stateOf(daemon, selectionOf(b).sessionId), "active", "the second session comes back");
});

void test("hydration runs at most HYDRATE_CONCURRENCY sessions at once, and all twelve finish", async (t) => {
  const fixture = makeDirs();
  const dirs = Array.from({ length: 12 }, (_, index) => projectDir(fixture, `project-${String(index)}`));
  const reports: StartupReport[] = [];
  const parts = daemonParts(fixture, {
    ...wideOptions(fixture),
    ...survivorOptionsOf(fixture),
    onStartup: (report) => {
      reports.push(report);
    },
  });
  for (const dir of dirs) {
    await seedSurvivor(fixture, parts, dir);
  }
  // Each start takes a while and is counted while in flight, so overlapping hydrations show up in the peak.
  let inFlight = 0;
  let peak = 0;
  const startOne = parts.exec.start.bind(parts.exec);
  parts.exec.start = async (containerId: string, sandbox: string): Promise<void> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await startOne(containerId, sandbox);
    } finally {
      inFlight -= 1;
    }
  };
  parts.exec.setDelay("start", 20);
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  assert.equal(peak, HYDRATE_CONCURRENCY, "at most HYDRATE_CONCURRENCY hydrations are in flight at once");
  assert.equal(firstReport(reports).adopted, 12, "all twelve sessions are adopted");
  assert.equal(firstReport(reports).failures, 0, "all twelve hydrations finish");
  for (const dir of dirs) {
    assert.equal(stateOf(daemon, selectionOf(dir).sessionId), "active");
  }
});

void test("a session whose hydration exceeds startupBudgetMs fails with STARTUP_BUDGET_EXCEEDED, and the other session still hydrates", async (t) => {
  const fixture = makeDirs();
  const [a, b] = [projectDir(fixture, "a"), projectDir(fixture, "b")];
  const reports: StartupReport[] = [];
  const parts = daemonParts(fixture, {
    ...wideOptions(fixture),
    ...survivorOptionsOf(fixture),
    policyPath: writePolicy(fixture, "budget-policy.json", {
      mode: "advisory",
      workspaceRoots: [fixture.base],
      startupBudgetMs: 300,
    }),
    onStartup: (report) => {
      reports.push(report);
    },
  });
  await seedSurvivor(fixture, parts, a);
  await seedSurvivor(fixture, parts, b);
  // The first start never returns until the test releases it, so that session exceeds its budget.
  const release = parts.exec.holdNext("start");
  const daemon = await startDaemon(parts.options);
  t.after(() => cleanupDaemon(daemon));
  // Registered after the cleanup, so it runs first: after tests run last-in, and a held start must be released before the stop.
  t.after(release);
  assert.equal(firstReport(reports).failures, 1, "one hydration failed");
  const entries = [a, b].map((dir) => {
    const entry = daemon.session(selectionOf(dir).sessionId);
    assert.ok(entry !== undefined, "the session is registered");
    return entry;
  });
  // The budget backstop of this session is armed before hydrateAdopted arms its own budget timer, and it sets the error state
  // synchronously. So by the time the report counts the failure, the state is already error. The state is read once, here.
  const snapshots = entries.map((entry) => entry.handle.controller.snapshot());
  const failed = snapshots.filter((snapshot) => snapshot.state === "error");
  const healthy = snapshots.filter((snapshot) => snapshot.state === "active");
  assert.equal(failed.length, 1, "the session that exceeded its budget is in error");
  assert.equal(failed[0]?.reason, "STARTUP_BUDGET_EXCEEDED");
  assert.equal(healthy.length, 1, "the other session is unaffected");
});
