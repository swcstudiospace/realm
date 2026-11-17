import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { makeRealmError, RealmError, type ErrorCode } from "../../src/core/errors.js";
import type { StateSnapshot } from "../../src/core/state-machine.js";
import { displayStatus } from "../../src/core/status.js";
import type { ControlSelection } from "../../src/daemon/channel.js";
import type { DaemonClient, DaemonStatus } from "../../src/daemon/client.js";
import { daemonLogPath } from "../../src/daemon/ensure.js";
import { createDaemonAttach, type RefusalRetention } from "../../src/host/attach.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";

const STAMP = "2026-01-01T00:00:00.000Z";

function statusFor(root: string, over: Partial<{ boundRoot: string | null; sessionId: string }> = {}): DaemonStatus {
  const snapshot: StateSnapshot = { state: "active", reason: "stub", lastTransitionAt: STAMP };
  const base = { snapshot, display: displayStatus(snapshot), mode: "fail-closed" as const, sessionId: over.sessionId ?? sessionIdOfWorkspace(root) };
  const boundRoot = over.boundRoot === undefined ? root : over.boundRoot;
  return boundRoot === null ? base : { ...base, boundRoot };
}

// A client whose status and up are scripted. close() is counted.
class Stub implements DaemonClient {
  statusCalls = 0;
  upCalls = 0;
  closeCalls = 0;
  constructor(
    private readonly onStatus: () => Promise<DaemonStatus>,
    private readonly onUp: () => Promise<DaemonStatus> = () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
  ) {}
  status(): Promise<DaemonStatus> {
    this.statusCalls += 1;
    return this.onStatus();
  }
  up(): Promise<DaemonStatus> {
    this.upCalls += 1;
    return this.onUp();
  }
  call(): Promise<ToolOutcome> {
    return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
  }
  metrics(): Promise<never> {
    return Promise.reject(makeRealmError("REALM_NOT_ACTIVE"));
  }
  close(): void {
    this.closeCalls += 1;
  }
}

const absent = (): Stub => new Stub(() => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")));
const answering = (root: string): Stub => new Stub(() => Promise.resolve(statusFor(root)));

interface Rig {
  readonly dir: string;
  readonly root: string;
  readonly spawns: { count: number };
  readonly selections: ControlSelection[];
  readonly events: string[];
  readonly diagnostics: string[];
  // Queues the clients connect() hands out, in order. A drained queue hands out absent probes.
  readonly queue: Stub[];
  attach: (retention: RefusalRetention, extra?: { onUp?: (status: DaemonStatus) => void; upBoundMs?: number; pollMs?: number }) => (root: string) => Promise<{ client: DaemonClient; refusal: RealmError | null }>;
}

function rig(t: TestContext): Rig {
  const dir = mkdtempSync(join(tmpdir(), "realm-attach-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const root = realpathSync(dir);
  const spawns = { count: 0 };
  const selections: ControlSelection[] = [];
  const events: string[] = [];
  const diagnostics: string[] = [];
  const queue: Stub[] = [];
  const connect = (_socketPath: string, selection: ControlSelection): DaemonClient => {
    selections.push(selection);
    events.push("connect");
    return queue.shift() ?? absent();
  };
  return {
    dir,
    root,
    spawns,
    selections,
    events,
    diagnostics,
    queue,
    attach: (retention, extra = {}) =>
      createDaemonAttach({
        socketPath: join(dir, "control.sock"),
        stateDir: dir,
        connect,
        spawnDaemon: () => {
          spawns.count += 1;
          events.push("spawn");
        },
        diagnostics: { write: (text) => { diagnostics.push(text); } },
        upBoundMs: extra.upBoundMs ?? 2_000,
        pollMs: extra.pollMs ?? 2,
        refusalRetention: retention,
        onSelection: (sessionId) => { events.push(`selection:${sessionId}`); },
        ...(extra.onUp === undefined ? {} : { onUp: extra.onUp }),
      }),
  };
}

const upRefused = (code: ErrorCode): (() => Promise<DaemonStatus>) => () => Promise.reject(makeRealmError(code));

void test("a successful up returns the client with no refusal, calls onUp once with the exact reply and never spawns", async (t) => {
  const r = rig(t);
  const reply = statusFor(r.root);
  const seen: DaemonStatus[] = [];
  const client = new Stub(() => Promise.resolve(statusFor(r.root)), () => Promise.resolve(reply));
  r.queue.push(answering(r.root), client);
  const result = await r.attach("verified", { onUp: (status) => { seen.push(status); } })(r.root);
  assert.equal(result.client, client);
  assert.equal(result.refusal, null);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], reply);
  assert.equal(r.spawns.count, 0);
  assert.equal(client.closeCalls, 0);
  assert.equal(client.statusCalls, 0, "a successful up reads no status");
});

void test("onSelection fires before the first probe", async (t) => {
  const r = rig(t);
  r.queue.push(answering(r.root), new Stub(() => Promise.resolve(statusFor(r.root)), () => Promise.resolve(statusFor(r.root))));
  await r.attach("always")(r.root);
  assert.equal(r.events[0], `selection:${sessionIdOfWorkspace(r.root)}`);
  assert.equal(r.events[1], "connect");
});

void test("the daemon is spawned once across an absent-then-answering sequence", async (t) => {
  const r = rig(t);
  const client = new Stub(() => Promise.resolve(statusFor(r.root)), () => Promise.resolve(statusFor(r.root)));
  r.queue.push(absent(), absent(), absent(), answering(r.root), client);
  const result = await r.attach("always")(r.root);
  assert.equal(result.client, client);
  assert.equal(r.spawns.count, 1);
});

void test("a daemon that never answers within the bound is DAEMON_START_TIMEOUT, with one spawn", async (t) => {
  const r = rig(t);
  await assert.rejects(
    r.attach("always", { upBoundMs: 30, pollMs: 5 })(r.root),
    (error: unknown) => error instanceof RealmError && error.code === "DAEMON_START_TIMEOUT",
  );
  assert.equal(r.spawns.count, 1);
});

void test("a daemon.failed line written after the first miss rejects with that code", async (t) => {
  const r = rig(t);
  writeFileSync(daemonLogPath(r.dir), "older line\n");
  const failing = createDaemonAttach({
    socketPath: join(r.dir, "control.sock"),
    stateDir: r.dir,
    connect: () => absent(),
    spawnDaemon: () => {
      r.spawns.count += 1;
      appendFileSync(daemonLogPath(r.dir), `${JSON.stringify({ event: "daemon.failed", code: "PODMAN_MISSING" })}\n`);
    },
    diagnostics: { write: (text) => { r.diagnostics.push(text); } },
    upBoundMs: 2_000,
    pollMs: 2,
    refusalRetention: "always",
  });
  await assert.rejects(failing(r.root), (error: unknown) => error instanceof RealmError && error.code === "PODMAN_MISSING");
  assert.equal(r.spawns.count, 1);
});

void test("verified: a refused up keeps the client when status names this root and session", async (t) => {
  const r = rig(t);
  const client = new Stub(() => Promise.resolve(statusFor(r.root)), upRefused("PODMAN_MISSING"));
  r.queue.push(answering(r.root), client);
  let upSeen = 0;
  const result = await r.attach("verified", { onUp: () => { upSeen += 1; } })(r.root);
  assert.equal(result.client, client);
  assert.equal(result.refusal?.code, "PODMAN_MISSING");
  assert.equal(client.statusCalls, 1);
  assert.equal(client.closeCalls, 0);
  assert.equal(upSeen, 0, "onUp is not called on a refusal");
});

void test("verified: a status that rejects closes the client and rethrows the up error", async (t) => {
  const r = rig(t);
  const refusal = makeRealmError("PODMAN_MISSING");
  const client = new Stub(() => Promise.reject(makeRealmError("TOOL_TIMEOUT")), () => Promise.reject(refusal));
  r.queue.push(answering(r.root), client);
  await assert.rejects(r.attach("verified")(r.root), (error: unknown) => error === refusal);
  assert.equal(client.closeCalls, 1);
});

void test("verified: a reply with no root, another root or another session id closes the client", async (t) => {
  for (const reply of [
    (root: string) => statusFor(root, { boundRoot: null }),
    (root: string) => statusFor(root, { boundRoot: `${root}-other` }),
    (root: string) => statusFor(root, { sessionId: sessionIdOfWorkspace(`${root}-other`) }),
  ]) {
    const r = rig(t);
    const refusal = makeRealmError("PODMAN_MISSING");
    const client = new Stub(() => Promise.resolve(reply(r.root)), () => Promise.reject(refusal));
    r.queue.push(answering(r.root), client);
    await assert.rejects(r.attach("verified")(r.root), (error: unknown) => error === refusal);
    assert.equal(client.closeCalls, 1);
    assert.equal(client.statusCalls, 1);
  }
});

void test("verified: a refusal that is not a RealmError becomes SCHEMA_INVALID", async (t) => {
  const r = rig(t);
  const client = new Stub(() => Promise.resolve(statusFor(r.root)), () => Promise.reject(new Error("boom")));
  r.queue.push(answering(r.root), client);
  const result = await r.attach("verified")(r.root);
  assert.equal(result.refusal?.code, "SCHEMA_INVALID");
  assert.equal(result.client, client);
});

void test("always: a refused up returns the client and never reads status", async (t) => {
  const r = rig(t);
  const client = new Stub(() => Promise.reject(makeRealmError("TOOL_TIMEOUT")), upRefused("POLICY_DENIED"));
  r.queue.push(answering(r.root), client);
  const result = await r.attach("always")(r.root);
  assert.equal(result.client, client);
  assert.equal(result.refusal?.code, "POLICY_DENIED");
  assert.equal(client.statusCalls, 0, "status would have rejected; it is not called");
  assert.equal(client.closeCalls, 0);
});

void test("always: a refusal that is not a RealmError becomes SCHEMA_INVALID", async (t) => {
  const r = rig(t);
  r.queue.push(answering(r.root), new Stub(() => Promise.resolve(statusFor(r.root)), () => Promise.reject(new Error("boom"))));
  const result = await r.attach("always")(r.root);
  assert.equal(result.refusal?.code, "SCHEMA_INVALID");
});

void test("never: a refused up closes the client and rethrows the error as it was", async (t) => {
  const r = rig(t);
  const refusal = makeRealmError("POLICY_DENIED");
  const client = new Stub(() => Promise.resolve(statusFor(r.root)), () => Promise.reject(refusal));
  r.queue.push(answering(r.root), client);
  await assert.rejects(r.attach("never")(r.root), (error: unknown) => error === refusal);
  assert.equal(client.closeCalls, 1);
  assert.equal(client.statusCalls, 0);
});

void test("selection is resolved on every call: a symlink swapped between two calls names the new realpath", async (t) => {
  const r = rig(t);
  const a = join(r.dir, "a");
  const b = join(r.dir, "b");
  mkdirSync(a);
  mkdirSync(b);
  const link = join(r.dir, "link");
  symlinkSync(a, link);
  const ok = (root: string): Stub => new Stub(() => Promise.resolve(statusFor(root)), () => Promise.resolve(statusFor(root)));
  const attach = r.attach("always");
  r.queue.push(answering(realpathSync(a)), ok(realpathSync(a)));
  await attach(link);
  rmSync(link);
  symlinkSync(b, link);
  r.queue.push(answering(realpathSync(b)), ok(realpathSync(b)));
  await attach(link);
  const roots = r.selections.map((selection) => selection.workspaceRoot);
  assert.ok(roots.includes(realpathSync(a)));
  assert.ok(roots.includes(realpathSync(b)));
  assert.equal(roots[0], realpathSync(a));
  assert.equal(roots[roots.length - 1], realpathSync(b));
});

void test("a throwing onUp propagates: the caller's contract, not caught here", async (t) => {
  const r = rig(t);
  r.queue.push(answering(r.root), new Stub(() => Promise.resolve(statusFor(r.root)), () => Promise.resolve(statusFor(r.root))));
  const boom = new Error("onUp failed");
  await assert.rejects(
    r.attach("verified", { onUp: () => { throw boom; } })(r.root),
    (error: unknown) => error === boom,
  );
});

void test("a root that does not resolve is refused before any probe", async (t) => {
  const r = rig(t);
  await assert.rejects(
    r.attach("always")(join(r.dir, "missing")),
    (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
  );
  assert.deepEqual(r.events, []);
});
