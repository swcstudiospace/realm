// realm mcp attach test (CLI-01; P6-D9; Phase 33). realm mcp ensures the shared daemon and claims the workspace with up behind a
// server that already reads and answers MCP frames: tools/list is answered while up is pending, a tool call is refused until the
// attach settles. The test drives runCli with the injected seams: the spawn fake records the detached launch, the connect fake
// gates up on a promise the test releases.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { runCli, type ConnectDaemon } from "../../src/cli/main.js";
import type { SpawnDaemon } from "../../src/daemon/launch.js";
import { selectionOf, type DaemonStatus } from "../../src/daemon/client.js";
import type { ControlSelection } from "../../src/daemon/channel.js";
import { makeRealmError } from "../../src/core/errors.js";
import { controlSocketPath, type EnvironmentLike } from "../../src/session/paths.js";
import { pollUntil } from "../support/timing.js";

/** A promise with its resolver exposed; Promise.withResolvers is not in this target lib (ES2023). */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolveFn: ((value: T) => void) | undefined;
  const promise = new Promise<T>((done) => {
    resolveFn = done;
  });
  if (resolveFn === undefined) {
    throw new Error("promise executor did not run synchronously");
  }
  return { promise, resolve: resolveFn };
}
const CONFIG_HOME = mkdtempSync(join(tmpdir(), "realm-mcp-attach-config-"));
const STATE_DIR = join(CONFIG_HOME, "state");
mkdirSync(join(CONFIG_HOME, "realm"));
writeFileSync(
  join(CONFIG_HOME, "realm", "config.json"),
  JSON.stringify({
    image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
    stateDir: STATE_DIR,
    workspaceRoot: "/srv/realm-ws",
  }),
);
after(() => {
  rmSync(CONFIG_HOME, { recursive: true, force: true });
});

const ENV: EnvironmentLike = {
  PATH: "/usr/bin",
  HOME: "/root",
  XDG_RUNTIME_DIR: "/run/user/0",
  XDG_CONFIG_HOME: CONFIG_HOME,
};

const DAEMON_ENTRY = `${STATE_DIR}/daemon/daemon.js`;
// A real directory for the workspace root the attach names. selectionOf canonicalizes it, so it must exist.
const WORKSPACE = realpathSync(mkdtempSync(join(tmpdir(), "realm-mcp-attach-ws-")));
after(() => {
  rmSync(WORKSPACE, { recursive: true, force: true });
});
const AT = "2026-10-22T00:00:00.000Z";
// The complete status a daemon bound to the selection's root answers: the shape the real client validates, naming that root and
// its session. The boot readback after up reads it.
function statusFor(selection: ControlSelection): DaemonStatus {
  return {
    snapshot: { state: "active", reason: "realm active", lastTransitionAt: AT },
    display: { label: "realm active", reason: "realm active", lastTransitionAt: AT },
    mode: "advisory",
    boundRoot: selection.workspaceRoot,
    sessionId: selection.sessionId,
  };
}

// Collects written text. Each write resolves any waiter whose marker has arrived, so tests await
// events rather than wall-clock durations.
function captureWriter(): {
  readonly stream: Writable;
  readonly text: () => string;
  readonly until: (marker: string) => Promise<void>;
} {
  let buffer = "";
  let waiter: { readonly marker: string; readonly resolve: (value: undefined) => void } | undefined;
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      buffer += chunk.toString("utf8");
      if (waiter !== undefined && buffer.includes(waiter.marker)) {
        waiter.resolve(undefined);
        waiter = undefined;
      }
      done();
    },
  });
  const until = (marker: string): Promise<void> => {
    if (buffer.includes(marker)) {
      return Promise.resolve();
    }
    const { promise, resolve } = deferred<undefined>();
    waiter = { marker, resolve };
    return promise;
  };
  return { stream, text: () => buffer, until };
}

void test("realm mcp spawns the detached daemon when none answers, claims the workspace with up, answers tools/list while up is pending and refuses calls until up settles (CLI-01)", async () => {
  const spawns: string[] = [];
  const upRoots: string[] = [];
  const served: unknown[] = [];
  let statusCalls = 0;
  const upCalled = deferred<undefined>();
  const upSettled = deferred<DaemonStatus>();
  const connect: ConnectDaemon = (_socketPath, selection) => ({
    status: () => {
      statusCalls += 1;
      // The first liveness probe finds no daemon; the probe after the spawn finds one.
      return statusCalls === 1 ? Promise.reject(makeRealmError("REALM_NOT_ACTIVE")) : Promise.resolve(statusFor(selection));
    },
    up: () => {
      upRoots.push(selection.workspaceRoot);
      upCalled.resolve(undefined);
      return upSettled.promise;
    },
    call: (tool: unknown) => {
      served.push(tool);
      return Promise.resolve({ outcome: "refused", tool: null, code: "REALM_NOT_ACTIVE", retryable: false });
    },
    metrics: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    close: () => undefined,
  });
  const spawn: SpawnDaemon = (_file, args) => {
    spawns.push(...args);
    return { unref: () => undefined };
  };
  const input = new PassThrough();
  const output = captureWriter();
  const diagnostics = captureWriter();
  const pending = runCli(["mcp", "--workspace", WORKSPACE], {
    env: ENV,
    daemonEntry: DAEMON_ENTRY,
    spawn,
    connect,
    mcpInput: input,
    mcpOutput: output.stream,
    diagnostics: diagnostics.stream,
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);

  await upCalled.promise;
  assert.deepEqual(spawns, [DAEMON_ENTRY], "exactly one detached daemon is spawned");
  assert.deepEqual(upRoots, [WORKSPACE], "up claims the named workspace");
  await output.until('"id":1');
  assert.match(output.text(), /"tools"/, "tools/list is answered while up is pending");
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } })}\n`);
  await output.until('"id":2');
  assert.match(output.text(), /REALM_NOT_ACTIVE/, "a call made while up is pending is refused");
  assert.deepEqual(served, [], "and never dispatched");

  upSettled.resolve(statusFor(selectionOf(WORKSPACE)));
  await pollUntil(() => statusCalls >= 3, "the readback after up");
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "status", arguments: {} } })}\n`);
  await output.until('"id":3');
  assert.equal(served.length, 1, "the next call is forwarded once up has settled");
  input.end();
  const result = await pending;

  assert.equal(result.exitCode, 0);
  assert.equal(diagnostics.text(), "", "a successful attach writes nothing to diagnostics");
});

void test("realm mcp waits for a daemon that holds its socket but has not answered, and never spawns over it (startup race)", async () => {
  // The first probe reads what a daemon gives while it is still binding its socket (a reply cut short) or busy with its
  // startup reap (a timeout): a daemon is there. A second daemon spawned over it would only refuse with LOCK_CONFLICT, and
  // neither reply may abort the wait; the next probe answers.
  for (const code of ["SCHEMA_INVALID", "TOOL_TIMEOUT"] as const) {
    const spawns: string[] = [];
    let statusCalls = 0;
    const connect: ConnectDaemon = (_socketPath, selection) => ({
      status: () => {
        statusCalls += 1;
        return statusCalls === 1 ? Promise.reject(makeRealmError(code)) : Promise.resolve(statusFor(selection));
      },
      up: () => Promise.resolve(statusFor(selection)),
      call: () => Promise.resolve({ outcome: "refused", tool: null, code: "REALM_NOT_ACTIVE", retryable: false }),
      metrics: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
      close: () => undefined,
    });
    const spawn: SpawnDaemon = (_file, args) => {
      spawns.push(...args);
      return { unref: () => undefined };
    };
    const input = new PassThrough();
    const output = captureWriter();
    const diagnostics = captureWriter();
    const pending = runCli(["mcp", "--workspace", WORKSPACE], {
      env: ENV,
      daemonEntry: DAEMON_ENTRY,
      spawn,
      connect,
      mcpInput: input,
      mcpOutput: output.stream,
      diagnostics: diagnostics.stream,
      timeoutMs: 2000,
    });
    await pollUntil(() => statusCalls >= 3, `${code}: the readback after up`);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    input.end();
    const result = await pending;

    assert.equal(result.exitCode, 0, `${code}: the attach completes once the daemon answers`);
    assert.deepEqual(spawns, [], `${code}: no daemon is spawned over one that holds the socket`);
    assert.equal(diagnostics.text(), "", `${code}: a startup race writes nothing to diagnostics`);
  }
});

void test("realm mcp with no daemon that ever answers serves, writes DAEMON_START_TIMEOUT (not SCHEMA_INVALID) to stderr and exits 1 at stdin end", async () => {
  const spawns: string[] = [];
  const connect: ConnectDaemon = () => ({
    status: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    up: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    call: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    metrics: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    close: () => undefined,
  });
  const spawn: SpawnDaemon = (_file, args) => {
    spawns.push(...args);
    return { unref: () => undefined };
  };
  const input = new PassThrough();
  const diagnostics = captureWriter();
  const pending = runCli(["mcp", "--workspace", WORKSPACE], {
    env: ENV,
    daemonEntry: DAEMON_ENTRY,
    spawn,
    connect,
    mcpInput: input,
    mcpOutput: captureWriter().stream,
    diagnostics: diagnostics.stream,
    timeoutMs: 50,
  });
  await diagnostics.until("DAEMON_START_TIMEOUT: ");
  input.end();
  const result = await pending;

  assert.equal(result.exitCode, 1);
  assert.deepEqual(spawns, [DAEMON_ENTRY], "one spawn is attempted before the bounded wait");
  assert.match(diagnostics.text(), /^DAEMON_START_TIMEOUT: /, "the refusal names the daemon start timeout");
});

// MULTI-03 (plan 08 T2): realm mcp and realm acp attach their client to the selection of their workspace.
void test("realm mcp --workspace attaches its client to the selection of that workspace and calls up with no argument (MULTI-03)", async () => {
  const connected: { readonly socketPath: string; readonly selection: ControlSelection }[] = [];
  const upArgs: unknown[][] = [];
  const connect: ConnectDaemon = (socketPath, selection) => {
    connected.push({ socketPath, selection });
    return {
      status: () => Promise.resolve(statusFor(selection)),
      up: (...args: unknown[]) => {
        upArgs.push(args);
        return Promise.resolve(statusFor(selection));
      },
      call: () => Promise.resolve({ outcome: "refused", tool: null, code: "REALM_NOT_ACTIVE", retryable: false }),
      metrics: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
      close: () => undefined,
    };
  };
  const input = new PassThrough();
  const pending = runCli(["mcp", "--workspace", WORKSPACE], {
    env: ENV,
    cwd: WORKSPACE,
    daemonEntry: DAEMON_ENTRY,
    connect,
    mcpInput: input,
    mcpOutput: new PassThrough(),
    diagnostics: captureWriter().stream,
  });
  // The boot runs behind the server: wait for up before the session ends.
  await pollUntil(() => upArgs.length > 0, "up being called");
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  input.end();
  const result = await pending;
  assert.equal(result.exitCode, 0);
  assert.ok(connected.length > 0, "the client is connected");
  for (const call of connected) {
    assert.equal(call.socketPath, controlSocketPath(STATE_DIR));
    assert.deepEqual(call.selection, selectionOf(WORKSPACE));
  }
  assert.deepEqual(upArgs, [[]], "up is called once, with no argument");
});

void test("realm acp --workspace attaches its client to the selection of that workspace and calls up with no argument (MULTI-03)", async () => {
  const connected: { readonly socketPath: string; readonly selection: ControlSelection }[] = [];
  const upArgs: unknown[][] = [];
  const connect: ConnectDaemon = (socketPath, selection) => {
    connected.push({ socketPath, selection });
    return {
      status: () => Promise.resolve(statusFor(selection)),
      up: (...args: unknown[]) => {
        upArgs.push(args);
        return Promise.resolve(statusFor(selection));
      },
      call: () => Promise.resolve({ outcome: "refused", tool: null, code: "REALM_NOT_ACTIVE", retryable: false }),
      metrics: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
      close: () => undefined,
    };
  };
  const input = new PassThrough();
  input.end();
  await runCli(["acp", "--workspace", WORKSPACE], {
    env: ENV,
    cwd: WORKSPACE,
    daemonEntry: DAEMON_ENTRY,
    connect,
    acpInput: input,
    acpOutput: new PassThrough(),
    diagnostics: captureWriter().stream,
  });
  assert.ok(connected.length > 0, "the client is connected");
  for (const call of connected) {
    assert.equal(call.socketPath, controlSocketPath(STATE_DIR));
    assert.deepEqual(call.selection, selectionOf(WORKSPACE));
  }
  assert.deepEqual(upArgs, [[]], "up is called once, with no argument");
});

void test("realm acp --workspace refuses an up whose reply names another session: SCHEMA_INVALID on stderr, exit 1, no frames (MULTI-03)", async () => {
  // The real client throws SCHEMA_INVALID for an up reply that names another session; this fake throws the same code.
  const connect: ConnectDaemon = (_socketPath, selection) => ({
    status: () => Promise.resolve(statusFor(selection)),
    up: () => Promise.reject(makeRealmError("SCHEMA_INVALID")),
    call: () => Promise.resolve({ outcome: "refused", tool: null, code: "REALM_NOT_ACTIVE", retryable: false }),
    metrics: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    close: () => undefined,
  });
  const input = new PassThrough();
  input.end();
  const output = captureWriter();
  const result = await runCli(["acp", "--workspace", WORKSPACE], {
    env: ENV,
    cwd: WORKSPACE,
    daemonEntry: DAEMON_ENTRY,
    spawn: () => ({ unref: () => undefined }),
    connect,
    acpInput: input,
    acpOutput: output.stream,
    diagnostics: captureWriter().stream,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith("SCHEMA_INVALID: "), result.stderr);
  assert.equal(output.text(), "", "no frames are written");
});
