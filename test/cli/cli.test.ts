// CLI tests (CLI-01, CLI-02; P6-D1, P6-D5, P6-D7, P6-D9, P6-D12, P6-D13). Every test
// drives the real runCli with injected seams: the spawn fake records the exact argv (no
// process starts), the send fake answers the control socket, the connect fake stands in for
// the daemon client (liveness probes and the mcp dispatcher), and the probe runs against fake
// runCommand/connectSocket. Test titles cite their requirement ID.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ERROR_CATALOGUE, RealmError } from "../../src/core/errors.js";
import {
  CLI_COMMANDS,
  runCli,
  type CliDeps,
  type CliResult,
  type ConnectDaemon,
  type SendControlRequest,
  type SpawnDaemon,
} from "../../src/cli/main.js";
import { CONTROL_TIMEOUT_MS, type ControlReply, type ControlRequest } from "../../src/daemon/channel.js";
import type { EnvironmentLike } from "../../src/session/paths.js";
import type { DaemonStatus } from "../../src/daemon/client.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";

// This file runs from dist/test/cli, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// The CLI names its state directory from the runtime config file, the file the daemon reads. This file
// writes one into a scratch XDG_CONFIG_HOME and removes it when the file's tests finish.
const CONFIG_HOME = mkdtempSync(join(tmpdir(), "realm-cli-config-"));
const RUNTIME_STATE_DIR = join(CONFIG_HOME, "state");
mkdirSync(join(CONFIG_HOME, "realm"));
writeFileSync(
  join(CONFIG_HOME, "realm", "config.json"),
  JSON.stringify({
    image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
    stateDir: RUNTIME_STATE_DIR,
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

const DAEMON_ENTRY = `${RUNTIME_STATE_DIR}/daemon/daemon.js`;

interface SpawnCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly detached: boolean;
  readonly stdio: readonly (string | number)[];
}

function makeSpawn(spawns: SpawnCall[]): SpawnDaemon {
  return (file, args, options) => {
    spawns.push({ file, args: [...args], detached: options.detached, stdio: options.stdio });
    return { unref: () => undefined };
  };
}

function refuseConnect(): Promise<void> {
  return Promise.reject(new Error("no daemon socket"));
}

// The probe dials the Podman API socket through connectSocket; it accepts here so up
// reaches the control socket, which the send fake refuses until the daemon is spawned.
function acceptConnect(): Promise<void> {
  return Promise.resolve();
}

function okVersion(): Promise<{ exitCode: number; stdout: string }> {
  return Promise.resolve({ exitCode: 0, stdout: "podman version 5.5.0\n" });
}

// Fakes for the daemon client seam. Each status probe answers in order (true: a daemon answers;
// false: the socket is absent); the last answer repeats. up and call settle with STATUS and
// REFUSED_STATUS unless a test overrides them.
const STATUS = { mode: "advisory" } as DaemonStatus;
// The up reply every successful realm returns: its lifecycle snapshot reports active.
const ACTIVE_RESULT = { snapshot: { state: "active", reason: "" } };
const REFUSED_STATUS: ToolOutcome = {
  outcome: "refused",
  tool: "status",
  code: "REALM_NOT_ACTIVE",
  retryable: ERROR_CATALOGUE.REALM_NOT_ACTIVE.retryable,
};

// One status answer per probe: true (a daemon answers), false (the socket is absent), or "timeout"
// (the daemon has not served within the bound yet).
type ProbeAnswer = boolean | "timeout";

interface FakeDaemonOptions {
  readonly probes: readonly ProbeAnswer[];
  readonly up?: () => Promise<DaemonStatus>;
  readonly call?: (tool: unknown) => Promise<ToolOutcome>;
}

interface FakeDaemonRecord {
  connects: number;
  closes: number;
  readonly upRoots: string[];
}

interface FakeDaemon {
  readonly connect: ConnectDaemon;
  readonly record: FakeDaemonRecord;
}

function fakeDaemon(options: FakeDaemonOptions): FakeDaemon {
  const record: FakeDaemonRecord = { connects: 0, closes: 0, upRoots: [] };
  let statusCalls = 0;
  const connect: ConnectDaemon = () => {
    record.connects += 1;
    return {
      status: () => {
        const answer = options.probes[Math.min(statusCalls, options.probes.length - 1)];
        statusCalls += 1;
        if (answer === "timeout") {
          return Promise.reject(new RealmError("TOOL_TIMEOUT"));
        }
        if (answer !== true) {
          return Promise.reject(new RealmError("REALM_NOT_ACTIVE"));
        }
        return Promise.resolve(STATUS);
      },
      up: async (workspaceRoot: string) => {
        record.upRoots.push(workspaceRoot);
        return options.up === undefined ? STATUS : options.up();
      },
      call: async (tool: unknown) => (options.call === undefined ? REFUSED_STATUS : options.call(tool)),
      close: () => {
        record.closes += 1;
      },
    };
  };
  return { connect, record };
}

function captureDiagnostics(): { readonly stream: Writable; readonly text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return { stream, text: () => chunks.join("") };
}

// Waits for runCli to return after stdin closes, failing the test if the server never shuts down,
// then lets the buffered stdout data events flush.
async function untilShutdown(pending: Promise<CliResult>): Promise<CliResult> {
  const result = await Promise.race([
    pending,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error("the server did not shut down after stdin closed"));
      }, 2000).unref();
    }),
  ]);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  return result;
}

void test("realm up with no daemon spawns the detached child then reports over the socket (CLI-01)", async () => {
  const spawns: SpawnCall[] = [];
  const daemon = fakeDaemon({ probes: [false, true] });
  const sent: ControlRequest[] = [];
  const send: SendControlRequest = (_socketPath, request) => {
    sent.push(request);
    const reply: ControlReply = { id: request.id, result: ACTIVE_RESULT };
    return Promise.resolve(reply);
  };
  const result = await runCli(["up"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn(spawns),
    connect: daemon.connect,
    send,
    runCommand: okVersion,
    connectSocket: acceptConnect,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `${JSON.stringify(ACTIVE_RESULT)}\n`);
  assert.equal(daemon.record.connects, 2);
  assert.equal(spawns.length, 1);
  const spawnCall = spawns[0];
  assert.ok(spawnCall !== undefined, "up spawns exactly one child");
  assert.equal(spawnCall.file, process.execPath);
  assert.deepEqual(spawnCall.args, [DAEMON_ENTRY]);
  assert.equal(spawnCall.detached, true);
  assert.equal(spawnCall.stdio[0], "ignore");
  assert.equal(sent.length, 1);
  const upRequest = sent[0];
  assert.ok(upRequest !== undefined, "up sends one control request");
  assert.equal(upRequest.method, "up");
  assert.deepEqual(upRequest.params, { workspaceRoot: "/srv/realm-ws" });
});

void test("realm up sends the --workspace root as the up params and spawns nothing when the daemon answers (CLI-01)", async () => {
  const sent: ControlRequest[] = [];
  const spawns: SpawnCall[] = [];
  const result = await runCli(["up", "--workspace", "/srv/other-ws"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    connect: fakeDaemon({ probes: [true] }).connect,
    spawn: makeSpawn(spawns),
    send: (_socketPath, request) => {
      sent.push(request);
      return Promise.resolve({ id: request.id, result: ACTIVE_RESULT });
    },
    runCommand: okVersion,
    connectSocket: acceptConnect,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.params, { workspaceRoot: "/srv/other-ws" });
  assert.equal(spawns.length, 0);
});

void test("realm up defaults the workspace root to the current directory when --workspace is absent (CLI-01)", async () => {
  const sent: ControlRequest[] = [];
  const result = await runCli(["up"], {
    env: ENV,
    timeoutMs: 500,
    connect: fakeDaemon({ probes: [true] }).connect,
    send: (_socketPath, request) => {
      sent.push(request);
      return Promise.resolve({ id: request.id, result: ACTIVE_RESULT });
    },
    runCommand: okVersion,
    connectSocket: acceptConnect,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(sent[0]?.params, { workspaceRoot: process.cwd() });
});

void test("realm up treats a status timeout as a daemon that is busy: it waits and succeeds once the daemon answers, and spawns no second daemon (CLI-01)", async () => {
  const spawns: SpawnCall[] = [];
  const daemon = fakeDaemon({ probes: ["timeout", true] });
  const sent: ControlRequest[] = [];
  const send: SendControlRequest = (_socketPath, request) => {
    sent.push(request);
    const reply: ControlReply = { id: request.id, result: ACTIVE_RESULT };
    return Promise.resolve(reply);
  };
  const result = await runCli(["up"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn(spawns),
    connect: daemon.connect,
    send,
    runCommand: okVersion,
    connectSocket: acceptConnect,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(daemon.record.connects, 2);
  assert.equal(spawns.length, 0, "a timeout means a daemon holds the socket; a second one would only refuse with LOCK_CONFLICT");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.method, "up");
});

void test("realm up exits 1 with the catalogue line when the realm is not active (CLI-01)", async () => {
  const errorState = { snapshot: { state: "error", reason: "AGENTOS_NOT_CONFIGURED" } };
  const send: SendControlRequest = (_socketPath, request) => {
    const reply: ControlReply = { id: request.id, result: errorState };
    return Promise.resolve(reply);
  };
  const result = await runCli(["up", "--workspace", "/srv/realm-ws"], {
    env: ENV,
    timeoutMs: 500,
    connect: fakeDaemon({ probes: [true] }).connect,
    send,
    runCommand: okVersion,
    connectSocket: acceptConnect,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, `${JSON.stringify(errorState)}\n`);
  assert.equal(result.stderr, `AGENTOS_NOT_CONFIGURED: ${ERROR_CATALOGUE.AGENTOS_NOT_CONFIGURED.reason}\n`);
});

void test("realm up and mcp refuse a non-absolute or missing --workspace value before probing or dialing (CLI-01)", async () => {
  let probes = 0;
  let sends = 0;
  const deps: CliDeps = {
    env: ENV,
    cwd: "/srv/realm-ws",
    runCommand: () => {
      probes += 1;
      return Promise.resolve({ exitCode: 0, stdout: "podman version 5.5.0\n" });
    },
    connectSocket: () => {
      probes += 1;
      return Promise.resolve();
    },
    send: () => {
      sends += 1;
      return Promise.reject(new Error("the socket must not be dialed for a refused workspace"));
    },
    connect: () => {
      throw new Error("the daemon must not be dialed for a refused workspace");
    },
  };
  const refused = [
    ["up", "--workspace", "relative/ws"],
    ["mcp", "--workspace", "relative/ws"],
    ["up", "--workspace", ""],
    ["up", "--workspace"],
  ];
  for (const argv of refused) {
    const result = await runCli(argv, deps);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  }
  assert.equal(probes, 0);
  assert.equal(sends, 0);
});

void test("realm down sends down over the socket (CLI-01)", async () => {
  const seen: string[] = [];
  const send: SendControlRequest = (_socketPath, request) => {
    seen.push(request.method);
    const reply: ControlReply = { id: request.id, result: "torn-down" };
    return Promise.resolve(reply);
  };
  const result = await runCli(["down"], {
    env: ENV,
    timeoutMs: 500,
    send,
    runCommand: okVersion,
    connectSocket: refuseConnect,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(seen, ["down"]);
  assert.equal(result.stdout, "torn-down\n");
});

void test("realm down with no daemon is idempotent and says already down (CORE-06)", async () => {
  const absent: SendControlRequest = () => {
    return Promise.reject(new RealmError("REALM_NOT_ACTIVE"));
  };
  const result = await runCli(["down"], { env: ENV, timeoutMs: 500, send: absent });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "disconnected\n");
  assert.equal(result.stderr, "already down\n");
  const failing: SendControlRequest = () => {
    return Promise.reject(new RealmError("TOOL_TIMEOUT"));
  };
  const other = await runCli(["down"], { env: ENV, timeoutMs: 500, send: failing });
  assert.equal(other.exitCode, 1);
  assert.equal(other.stdout, "TOOL_TIMEOUT\n");
});

void test("realm doctor with no daemon runs local checks and says the daemon is absent (CLI-01)", async () => {
  const send: SendControlRequest = () => {
    return Promise.reject(new RealmError("REALM_NOT_ACTIVE"));
  };
  const result = await runCli(["doctor"], {
    env: ENV,
    timeoutMs: 500,
    send,
    runCommand: () => {
      return Promise.reject(new Error("podman not installed"));
    },
    connectSocket: refuseConnect,
  });
  assert.equal(result.exitCode, 0);
  const checks = JSON.parse(result.stdout) as unknown[];
  assert.ok(Array.isArray(checks));
  assert.ok(checks.length > 0);
  assert.ok(result.stderr.includes("absent"));
});

void test("realm doctor with no daemon reads <stateDir>/policy.json for the policy-file check (D-1501)", async () => {
  mkdirSync(RUNTIME_STATE_DIR, { recursive: true });
  writeFileSync(join(RUNTIME_STATE_DIR, "policy.json"), JSON.stringify({ mode: "advisory" }));
  try {
    const result = await runCli(["doctor"], {
      env: ENV,
      timeoutMs: 500,
      send: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
      runCommand: () => Promise.reject(new Error("podman not installed")),
      connectSocket: refuseConnect,
    });
    assert.equal(result.exitCode, 0);
    const checks = JSON.parse(result.stdout) as { id: string; status: string; detail: string }[];
    const policy = checks.find((check) => check.id === "policy-file");
    assert.ok(policy, "the report carries a policy-file check");
    assert.equal(policy.status, "warn");
    assert.match(policy.detail, /mode advisory \(explicit\)/);
  } finally {
    rmSync(RUNTIME_STATE_DIR, { recursive: true, force: true });
  }
});

void test("unknown argv exits 2 with usage on stderr (CLI-01)", async () => {
  for (const argv of [["frobnicate"], [], ["up", "extra"]]) {
    const result = await runCli(argv, { env: ENV });
    assert.equal(result.exitCode, 2);
    const words = new Set(result.stderr.split(/[^A-Za-z]+/));
    for (const command of CLI_COMMANDS) {
      assert.ok(words.has(command), `usage on stderr must name the ${command} command`);
    }
    assert.equal(result.stdout, "");
  }
});

void test("realm up with Podman missing reports PODMAN_MISSING and exits promptly with no spawn (CLI-02)", async () => {
  const spawns: SpawnCall[] = [];
  let sends = 0;
  let connects = 0;
  const send: SendControlRequest = () => {
    sends += 1;
    return Promise.reject(new Error("the socket must not be dialed without Podman"));
  };
  const started = Date.now();
  const result = await runCli(["up"], {
    env: ENV,
    timeoutMs: 50,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn(spawns),
    send,
    runCommand: () => {
      return Promise.reject(new Error("spawn podman ENOENT"));
    },
    connectSocket: () => {
      connects += 1;
      return Promise.resolve();
    },
  });
  const elapsed = Date.now() - started;
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "PODMAN_MISSING\n");
  assert.ok(result.stderr.includes(ERROR_CATALOGUE.PODMAN_MISSING.reason));
  assert.equal(spawns.length, 0);
  assert.equal(sends, 0);
  assert.equal(connects, 0);
  assert.ok(elapsed < 2000, `up with missing Podman must return promptly, took ${String(elapsed)} ms`);
});

void test("realm mcp attaches to the daemon, claims the current directory, and serves tools through its client (CLI-01; CLI-04 entry)", async () => {
  const seen: unknown[] = [];
  const daemon = fakeDaemon({
    probes: [false, true],
    call: (raw) => {
      seen.push(raw);
      return Promise.resolve(REFUSED_STATUS);
    },
  });
  const spawns: SpawnCall[] = [];
  const input = new PassThrough();
  const output = new PassThrough();
  const diagnostics = captureDiagnostics();
  let stdout = "";
  output.on("data", (chunk) => {
    stdout += String(chunk);
  });
  const pending = runCli(["mcp"], {
    env: ENV,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn(spawns),
    connect: daemon.connect,
    mcpInput: input,
    mcpOutput: output,
    diagnostics: diagnostics.stream,
  });
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);
  input.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } })}\n`,
  );
  input.end();
  const result = await untilShutdown(pending);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(spawns.map((spawned) => spawned.args), [[DAEMON_ENTRY]]);
  assert.deepEqual(daemon.record.upRoots, [process.cwd()]);
  assert.deepEqual(seen, [{ status: {} }]);
  const lines = stdout === "" ? [] : stdout.slice(0, -1).split("\n");
  assert.equal(lines.length, 2);
  const byId = new Map<number, Record<string, unknown>>();
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed["jsonrpc"], "2.0");
    byId.set(parsed["id"] as number, parsed);
  }
  assert.ok("result" in (byId.get(1) ?? {}), "tools/list answers with a result");
  const statusResult = (byId.get(2) ?? {})["result"] as Record<string, unknown>;
  assert.deepEqual(statusResult["structuredContent"], REFUSED_STATUS, "the dispatcher outcome crosses as structuredContent");
  assert.equal(statusResult["isError"], true, "a refused outcome is a tool error the model can see");
  assert.equal(diagnostics.text(), "", "a healthy session writes nothing to diagnostics");
  assert.equal(daemon.record.connects, 3, "two liveness probes and one mcp client");
  assert.equal(daemon.record.closes, 3, "every client is closed once the session ends");
});

void test("realm mcp --workspace claims the named root and attaches without spawning when a daemon answers (CLI-01)", async () => {
  const spawns: SpawnCall[] = [];
  const daemon = fakeDaemon({ probes: [true] });
  const diagnostics = captureDiagnostics();
  const input = new PassThrough();
  input.end();
  const result = await runCli(["mcp", "--workspace", "/srv/other-ws"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    spawn: makeSpawn(spawns),
    connect: daemon.connect,
    mcpInput: input,
    mcpOutput: new PassThrough(),
    diagnostics: diagnostics.stream,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(spawns.length, 0);
  assert.deepEqual(daemon.record.upRoots, ["/srv/other-ws"]);
  assert.equal(diagnostics.text(), "");
});

void test("realm mcp still serves when up is refused and writes the refusal code to stderr (CLI-01)", async () => {
  const seen: unknown[] = [];
  const spawns: SpawnCall[] = [];
  const daemon = fakeDaemon({
    probes: [true],
    up: () => {
      return Promise.reject(new RealmError("SCHEMA_INVALID"));
    },
    call: (raw) => {
      seen.push(raw);
      return Promise.resolve(REFUSED_STATUS);
    },
  });
  const input = new PassThrough();
  const output = new PassThrough();
  const diagnostics = captureDiagnostics();
  let stdout = "";
  output.on("data", (chunk) => {
    stdout += String(chunk);
  });
  const pending = runCli(["mcp", "--workspace", "/srv/realm-ws"], {
    env: ENV,
    spawn: makeSpawn(spawns),
    connect: daemon.connect,
    mcpInput: input,
    mcpOutput: output,
    diagnostics: diagnostics.stream,
  });
  input.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } })}\n`,
  );
  input.end();
  const result = await untilShutdown(pending);
  assert.equal(result.exitCode, 0);
  assert.equal(spawns.length, 0);
  assert.deepEqual(daemon.record.upRoots, ["/srv/realm-ws"]);
  assert.deepEqual(seen, [{ status: {} }]);
  const reply = JSON.parse(stdout) as { result: Record<string, unknown> };
  assert.deepEqual(reply.result["structuredContent"], REFUSED_STATUS);
  assert.equal(reply.result["isError"], true);
  assert.ok(diagnostics.text().startsWith("SCHEMA_INVALID: "), diagnostics.text());
});

void test("realm mcp writes an ensure failure code to stderr and exits 1 without serving (CLI-01)", async () => {
  const spawns: SpawnCall[] = [];
  const daemon = fakeDaemon({ probes: [false] });
  const output = new PassThrough();
  let stdout = "";
  output.on("data", (chunk) => {
    stdout += String(chunk);
  });
  const result = await runCli(["mcp"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 50,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn(spawns),
    connect: daemon.connect,
    mcpInput: new PassThrough(),
    mcpOutput: output,
    diagnostics: captureDiagnostics().stream,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith("DAEMON_START_TIMEOUT: "), result.stderr);
  assert.equal(stdout, "");
  assert.equal(spawns.length, 1);
  assert.deepEqual(daemon.record.upRoots, []);
});

void test("realm mcp exits 1 with MCP_INPUT_FAILED on stderr when its input stream fails, and writes no frames to stdout (CLI-01)", async () => {
  const daemon = fakeDaemon({ probes: [true] });
  const input = new PassThrough();
  const output = captureDiagnostics();
  const pending = runCli(["mcp", "--workspace", "/srv/realm-ws"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn([]),
    connect: daemon.connect,
    mcpInput: input,
    mcpOutput: output.stream,
    diagnostics: captureDiagnostics().stream,
  });
  input.destroy(new Error("input stream broke"));
  const result = await untilShutdown(pending);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith("MCP_INPUT_FAILED: "), result.stderr);
  assert.equal(output.text(), "");
});

void test("a detached daemon that fails startup writes its error to <stateDir>/daemon.log, owner-only, and realm up names that log (CLI-01, RT-06)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "realm-cli-detached-"));
  try {
    const configHome = join(dir, "config");
    const stateDir = join(dir, "state");
    mkdirSync(join(configHome, "realm"), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      join(configHome, "realm", "config.json"),
      JSON.stringify({
        image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
        stateDir,
        workspaceRoot: "/srv/realm-ws",
      }),
    );
    // The CLI never reads the policy file, but the daemon parses it at startup, so this makes the real
    // daemon entry fail after the CLI has spawned it detached.
    writeFileSync(join(stateDir, "policy.json"), "not json");
    const result = await runCli(["up", "--workspace", "/srv/realm-ws"], {
      env: {
        PATH: "/usr/bin",
        HOME: "/root",
        XDG_RUNTIME_DIR: "/run/user/0",
        XDG_CONFIG_HOME: configHome,
      },
      // Long enough for a loaded machine to start the real daemon entry and write its failure to the log.
      timeoutMs: 6000,
      daemonEntry: join(ROOT, "dist", "src", "daemon", "main.js"),
      runCommand: okVersion,
      connectSocket: acceptConnect,
    });
    const logPath = join(stateDir, "daemon.log");
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(logPath), "the failure names the daemon log");
    assert.equal(statSync(logPath).mode & 0o777, 0o600);
    assert.ok(readFileSync(logPath, "utf8").includes("realm daemon: SCHEMA_INVALID"), "the startup error reached the log");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});


void test("the CLI creates missing ancestors of a fresh state path at the default mode and the state directory at 0700 (CLI-01)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "realm-cli-modes-"));
  try {
    const configHome = join(dir, "config");
    const ancestor = join(dir, "fresh");
    const stateDir = join(ancestor, "state");
    mkdirSync(join(configHome, "realm"), { recursive: true });
    // A directory made with default options gets the process default mode, which the CLI's ancestors get too.
    const defaultMode = join(dir, "default-mode");
    mkdirSync(defaultMode);
    writeFileSync(
      join(configHome, "realm", "config.json"),
      JSON.stringify({
        image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
        stateDir,
        workspaceRoot: "/srv/realm-ws",
      }),
    );
    const daemon = fakeDaemon({ probes: [false, true] });
    const send: SendControlRequest = (_socketPath, request) => Promise.resolve({ id: request.id, result: ACTIVE_RESULT });
    const result = await runCli(["up"], {
      env: { PATH: "/usr/bin", HOME: "/root", XDG_RUNTIME_DIR: "/run/user/0", XDG_CONFIG_HOME: configHome },
      cwd: "/srv/realm-ws",
      timeoutMs: 500,
      daemonEntry: DAEMON_ENTRY,
      spawn: makeSpawn([]),
      send,
      connect: daemon.connect,
      runCommand: okVersion,
      connectSocket: acceptConnect,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(statSync(ancestor).mode & 0o777, statSync(defaultMode).mode & 0o777);
    assert.equal(statSync(stateDir).mode & 0o777, 0o700);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("a failed realm acp up prints the code and the daemon log path on stderr (CLI-01, TOOL-05)", async () => {
  const daemon = fakeDaemon({ probes: [true], up: () => Promise.reject(new RealmError("PODMAN_MISSING")) });
  const input = new PassThrough();
  input.end();
  const result = await runCli(["acp"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn([]),
    connect: daemon.connect,
    acpInput: input,
    acpOutput: captureDiagnostics().stream,
    diagnostics: captureDiagnostics().stream,
  });
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.startsWith("PODMAN_MISSING: "), result.stderr);
  assert.ok(result.stderr.includes(`${RUNTIME_STATE_DIR}/daemon.log`), result.stderr);
});

void test("a failed realm mcp up writes the code and the daemon log path to stderr and keeps serving (CLI-01)", async () => {
  const daemon = fakeDaemon({ probes: [true], up: () => Promise.reject(new RealmError("PODMAN_MISSING")) });
  const input = new PassThrough();
  input.end();
  const diagnostics = captureDiagnostics();
  const result = await untilShutdown(
    runCli(["mcp", "--workspace", "/srv/realm-ws"], {
      env: ENV,
      cwd: "/srv/realm-ws",
      timeoutMs: 500,
      daemonEntry: DAEMON_ENTRY,
      spawn: makeSpawn([]),
      connect: daemon.connect,
      mcpInput: input,
      mcpOutput: captureDiagnostics().stream,
      diagnostics: diagnostics.stream,
    }),
  );
  assert.equal(result.exitCode, 0);
  assert.ok(diagnostics.text().startsWith("PODMAN_MISSING: "), diagnostics.text());
  assert.ok(diagnostics.text().includes(`${RUNTIME_STATE_DIR}/daemon.log`), diagnostics.text());
});

// The up reply an active realm returns, in the DaemonStatus shape the client validates.
const ACTIVE_DAEMON_STATUS: DaemonStatus = {
  snapshot: { state: "active", reason: "realm active", lastTransitionAt: "2026-10-22T00:00:00.000Z" },
  display: { label: "realm active", degraded: false, reason: "realm active", lastTransitionAt: "2026-10-22T00:00:00.000Z" },
  mode: "advisory",
};

void test("realm acp attaches with up for the workspace, forwards _realm/tool to the daemon, and writes only ACP frames to stdout (CLI-01, TOOL-05)", async () => {
  const forwarded: unknown[] = [];
  const daemon = fakeDaemon({
    probes: [true],
    up: () => Promise.resolve(ACTIVE_DAEMON_STATUS),
    call: (tool) => {
      forwarded.push(tool);
      return Promise.resolve(REFUSED_STATUS);
    },
  });
  const input = new PassThrough();
  input.end(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } })}\n` +
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "_realm/tool", params: { tool: { status: {} } } })}\n`,
  );
  const output = captureDiagnostics();
  const diagnostics = captureDiagnostics();
  const result = await untilShutdown(
    runCli(["acp", "--workspace", "/srv/acp-ws"], {
      env: ENV,
      cwd: "/srv/realm-ws",
      timeoutMs: 500,
      daemonEntry: DAEMON_ENTRY,
      spawn: makeSpawn([]),
      connect: daemon.connect,
      acpInput: input,
      acpOutput: output.stream,
      diagnostics: diagnostics.stream,
    }),
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(diagnostics.text(), "");
  assert.deepEqual(daemon.record.upRoots, ["/srv/acp-ws"]);
  assert.deepEqual(forwarded, [{ status: {} }]);
  const frames = output
    .text()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.deepEqual(
    frames.map((frame) => frame["id"]),
    [1, 2],
    "every frame on stdout is a protocol reply to a request",
  );
  assert.deepEqual(frames[1]?.["result"], REFUSED_STATUS);
});

void test("realm acp exits 1 with the refusal code on stderr when up leaves the realm not active, and writes no frames (CLI-01)", async () => {
  const notActive: DaemonStatus = {
    ...ACTIVE_DAEMON_STATUS,
    snapshot: { state: "error", reason: "AGENTOS_NOT_CONFIGURED", lastTransitionAt: "2026-10-22T00:00:00.000Z" },
  };
  const daemon = fakeDaemon({ probes: [true], up: () => Promise.resolve(notActive) });
  const input = new PassThrough();
  input.end();
  const output = captureDiagnostics();
  const diagnostics = captureDiagnostics();
  const result = await runCli(["acp"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn([]),
    connect: daemon.connect,
    acpInput: input,
    acpOutput: output.stream,
    diagnostics: diagnostics.stream,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, `AGENTOS_NOT_CONFIGURED: ${ERROR_CATALOGUE.AGENTOS_NOT_CONFIGURED.reason}\n`);
  assert.equal(output.text(), "");
});

void test("realm acp exits 1 with the refused up code on stderr and writes no frames (CLI-01)", async () => {
  const daemon = fakeDaemon({ probes: [true], up: () => Promise.reject(new RealmError("PODMAN_MISSING")) });
  const input = new PassThrough();
  input.end();
  const output = captureDiagnostics();
  const result = await runCli(["acp"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn([]),
    connect: daemon.connect,
    acpInput: input,
    acpOutput: output.stream,
    diagnostics: captureDiagnostics().stream,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith("PODMAN_MISSING: "), result.stderr);
  assert.equal(output.text(), "");
});

void test("realm acp writes an ensure failure code to stderr and exits 1 without serving (CLI-01)", async () => {
  const spawns: SpawnCall[] = [];
  const daemon = fakeDaemon({ probes: [false] });
  const input = new PassThrough();
  input.end();
  const output = captureDiagnostics();
  const result = await runCli(["acp"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 50,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn(spawns),
    connect: daemon.connect,
    acpInput: input,
    acpOutput: output.stream,
    diagnostics: captureDiagnostics().stream,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith("DAEMON_START_TIMEOUT: "), result.stderr);
  assert.equal(output.text(), "");
  assert.equal(spawns.length, 1);
  assert.deepEqual(daemon.record.upRoots, []);
});

void test("a runtime config that cannot be read makes every command exit 2 before any daemon is dialled (CLI-01, OMP-01)", async () => {
  const daemon = fakeDaemon({ probes: [true] });
  const result = await runCli(["status"], {
    env: { ...ENV, XDG_CONFIG_HOME: join(CONFIG_HOME, "absent") },
    connect: daemon.connect,
  });
  assert.equal(result.exitCode, 2);
  assert.ok(result.stderr.startsWith("realm status: cannot resolve a state directory"), result.stderr);
  assert.equal(daemon.record.connects, 0);
});

void test("the default daemon spawn targets daemon/main.js beside the compiled CLI for up and mcp (CLI-01)", async () => {
  const send: SendControlRequest = (_socketPath, request) => {
    const reply: ControlReply = { id: request.id, result: ACTIVE_RESULT };
    return Promise.resolve(reply);
  };
  for (const argv of [["up"], ["mcp"]]) {
    const spawns: SpawnCall[] = [];
    const daemon = fakeDaemon({ probes: [false, true] });
    const input = new PassThrough();
    input.end();
    const result = await runCli(argv, {
      env: ENV,
      cwd: "/srv/realm-ws",
      spawn: makeSpawn(spawns),
      send,
      connect: daemon.connect,
      runCommand: okVersion,
      connectSocket: acceptConnect,
      mcpInput: input,
      mcpOutput: new PassThrough(),
      diagnostics: captureDiagnostics().stream,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(spawns.length, 1);
    assert.deepEqual(spawns[0]?.args, [join(ROOT, "dist", "src", "daemon", "main.js")]);
  }
});

void test("each control request is bounded by its own CONTROL_TIMEOUT_MS entry (CLI-01)", async () => {
  const seen: { method: string; timeoutMs: number }[] = [];
  const send: SendControlRequest = (_socketPath, request, timeoutMs) => {
    seen.push({ method: request.method, timeoutMs });
    const reply: ControlReply = { id: request.id, result: ACTIVE_RESULT };
    return Promise.resolve(reply);
  };
  const deps: CliDeps = {
    env: ENV,
    cwd: "/srv/realm-ws",
    send,
    connect: fakeDaemon({ probes: [true] }).connect,
    runCommand: okVersion,
    connectSocket: acceptConnect,
  };
  for (const argv of [["up"], ["down"], ["status"], ["doctor"]]) {
    const result = await runCli(argv, deps);
    assert.equal(result.exitCode, 0);
  }
  assert.deepEqual(seen, [
    { method: "up", timeoutMs: CONTROL_TIMEOUT_MS.up },
    { method: "down", timeoutMs: CONTROL_TIMEOUT_MS.down },
    { method: "status", timeoutMs: CONTROL_TIMEOUT_MS.status },
    { method: "doctor", timeoutMs: CONTROL_TIMEOUT_MS.doctor },
  ]);
});
