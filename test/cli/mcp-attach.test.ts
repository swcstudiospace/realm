// realm mcp attach test (CLI-01; P6-D9). realm mcp must ensure the shared daemon, claim the workspace with
// up, and only then read and answer MCP frames. The test drives runCli with the injected seams: the spawn
// fake records the detached launch, the connect fake gates up on a promise the test releases.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { runCli, type ConnectDaemon, type SpawnDaemon } from "../../src/cli/main.js";
import type { DaemonStatus } from "../../src/daemon/client.js";
import { makeRealmError } from "../../src/core/errors.js";
import type { EnvironmentLike } from "../../src/session/paths.js";

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
const STATUS = { mode: "advisory" } as DaemonStatus;

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

void test("realm mcp spawns the detached daemon when none answers, claims the workspace with up, and serves nothing before up settles (CLI-01)", async () => {
  const spawns: string[] = [];
  const upRoots: string[] = [];
  const served: unknown[] = [];
  let statusCalls = 0;
  const upCalled = deferred<undefined>();
  const upSettled = deferred<DaemonStatus>();
  const connect: ConnectDaemon = () => ({
    status: () => {
      statusCalls += 1;
      // The first liveness probe finds no daemon; the probe after the spawn finds one.
      return statusCalls === 1 ? Promise.reject(makeRealmError("REALM_NOT_ACTIVE")) : Promise.resolve(STATUS);
    },
    up: (workspaceRoot: string) => {
      upRoots.push(workspaceRoot);
      upCalled.resolve(undefined);
      return upSettled.promise;
    },
    call: (tool: unknown) => {
      served.push(tool);
      return Promise.resolve({ outcome: "refused", tool: null, code: "REALM_NOT_ACTIVE", retryable: false });
    },
    close: () => undefined,
  });
  const spawn: SpawnDaemon = (_file, args) => {
    spawns.push(...args);
    return { unref: () => undefined };
  };
  const input = new PassThrough();
  const output = captureWriter();
  const diagnostics = captureWriter();
  const pending = runCli(["mcp", "--workspace", "/srv/realm-ws"], {
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
  assert.deepEqual(upRoots, ["/srv/realm-ws"], "up claims the named workspace");
  assert.equal(output.text(), "", "no MCP reply is written while up is pending");

  upSettled.resolve(STATUS);
  await output.until('"id":1');
  input.end();
  const result = await pending;

  assert.equal(result.exitCode, 0);
  assert.equal(diagnostics.text(), "", "a successful attach writes nothing to diagnostics");
  assert.deepEqual(served, [], "tools/list is answered by the server, not dispatched to the daemon");
  assert.match(output.text(), /"tools"/, "the reply lists the tools");
});

void test("realm mcp keeps polling through a daemon that is still binding its socket (startup race)", async () => {
  // The first probe reads a reply cut short while the daemon binds; the probe after the spawn answers.
  // A cut-short reply must not abort the wait with SCHEMA_INVALID.
  const spawns: string[] = [];
  let statusCalls = 0;
  const connect: ConnectDaemon = () => ({
    status: () => {
      statusCalls += 1;
      return statusCalls === 1
        ? Promise.reject(makeRealmError("SCHEMA_INVALID"))
        : Promise.resolve(STATUS);
    },
    up: () => Promise.resolve(STATUS),
    call: () => Promise.resolve({ outcome: "refused", tool: null, code: "REALM_NOT_ACTIVE", retryable: false }),
    close: () => undefined,
  });
  const spawn: SpawnDaemon = (_file, args) => {
    spawns.push(...args);
    return { unref: () => undefined };
  };
  const input = new PassThrough();
  const output = captureWriter();
  const diagnostics = captureWriter();
  const pending = runCli(["mcp", "--workspace", "/srv/realm-ws"], {
    env: ENV,
    daemonEntry: DAEMON_ENTRY,
    spawn,
    connect,
    mcpInput: input,
    mcpOutput: output.stream,
    diagnostics: diagnostics.stream,
    timeoutMs: 2000,
  });
  input.end();
  const result = await pending;

  assert.equal(result.exitCode, 0, "the attach completes once the daemon answers");
  assert.deepEqual(spawns, [DAEMON_ENTRY], "the detached daemon is spawned once");
  assert.equal(diagnostics.text(), "", "a startup race writes nothing to diagnostics");
});

void test("realm mcp with no daemon that ever answers exits 1 with DAEMON_START_TIMEOUT, not SCHEMA_INVALID", async () => {
  const spawns: string[] = [];
  const connect: ConnectDaemon = () => ({
    status: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    up: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    call: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    close: () => undefined,
  });
  const spawn: SpawnDaemon = (_file, args) => {
    spawns.push(...args);
    return { unref: () => undefined };
  };
  const result = await runCli(["mcp", "--workspace", "/srv/realm-ws"], {
    env: ENV,
    daemonEntry: DAEMON_ENTRY,
    spawn,
    connect,
    mcpInput: new PassThrough(),
    mcpOutput: captureWriter().stream,
    diagnostics: captureWriter().stream,
    timeoutMs: 50,
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(spawns, [DAEMON_ENTRY], "one spawn is attempted before the bounded wait");
  assert.match(result.stderr, /^DAEMON_START_TIMEOUT: /, "the refusal names the daemon start timeout");
});
