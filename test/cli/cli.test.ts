// CLI tests (CLI-01, CLI-02; P6-D1, P6-D5, P6-D7, P6-D9, P6-D12, P6-D13). Every test
// drives the real runCli with injected seams: the spawn fake records the exact argv (no
// process starts), the send fake answers the control socket, the connect fake stands in for
// the daemon client (liveness probes and the mcp dispatcher), and the probe runs against fake
// runCommand/connectSocket. Test titles cite their requirement ID.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ERROR_CATALOGUE, RealmError } from "../../src/core/errors.js";
import {
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
const CLI_SOURCE = join(ROOT, "src", "cli", "main.ts");

const ENV: EnvironmentLike = {
  PATH: "/usr/bin",
  HOME: "/root",
  XDG_RUNTIME_DIR: "/run/user/0",
  XDG_STATE_HOME: "/tmp/realm-cli-test-state",
};

const DAEMON_ENTRY = "/tmp/realm-cli-test-state/daemon/daemon.js";

interface SpawnCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly detached: boolean;
  readonly stdio: string;
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

async function okVersion(): Promise<{ exitCode: number; stdout: string }> {
  return { exitCode: 0, stdout: "podman version 5.5.0\n" };
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
      status: async () => {
        const answer = options.probes[Math.min(statusCalls, options.probes.length - 1)];
        statusCalls += 1;
        if (answer === "timeout") {
          throw new RealmError("TOOL_TIMEOUT");
        }
        if (answer !== true) {
          throw new RealmError("REALM_NOT_ACTIVE");
        }
        return STATUS;
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
      setTimeout(() => reject(new Error("realm mcp did not shut down after stdin closed")), 2000).unref();
    }),
  ]);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  return result;
}

test("realm up with no daemon spawns the detached child then reports over the socket (CLI-01)", async () => {
  const spawns: SpawnCall[] = [];
  const daemon = fakeDaemon({ probes: [false, true] });
  const sent: ControlRequest[] = [];
  const send: SendControlRequest = async (_socketPath, request) => {
    sent.push(request);
    const reply: ControlReply = { id: request.id, result: ACTIVE_RESULT };
    return reply;
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
  assert.equal(spawns[0]?.file, process.execPath);
  assert.deepEqual(spawns[0]?.args, [DAEMON_ENTRY]);
  assert.equal(spawns[0]?.detached, true);
  assert.equal(spawns[0]?.stdio, "ignore");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.method, "up");
  assert.deepEqual(sent[0]?.params, { workspaceRoot: "/srv/realm-ws" });
});

test("realm up sends the --workspace root as the up params and spawns nothing when the daemon answers (CLI-01)", async () => {
  const sent: ControlRequest[] = [];
  const spawns: SpawnCall[] = [];
  const result = await runCli(["up", "--workspace", "/srv/other-ws"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    connect: fakeDaemon({ probes: [true] }).connect,
    spawn: makeSpawn(spawns),
    send: async (_socketPath, request) => {
      sent.push(request);
      return { id: request.id, result: ACTIVE_RESULT };
    },
    runCommand: okVersion,
    connectSocket: acceptConnect,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]?.params, { workspaceRoot: "/srv/other-ws" });
  assert.equal(spawns.length, 0);
});

test("realm up defaults the workspace root to the current directory when --workspace is absent (CLI-01)", async () => {
  const sent: ControlRequest[] = [];
  const result = await runCli(["up"], {
    env: ENV,
    timeoutMs: 500,
    connect: fakeDaemon({ probes: [true] }).connect,
    send: async (_socketPath, request) => {
      sent.push(request);
      return { id: request.id, result: ACTIVE_RESULT };
    },
    runCommand: okVersion,
    connectSocket: acceptConnect,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(sent[0]?.params, { workspaceRoot: process.cwd() });
});

test("realm up treats a status timeout as not ready and succeeds once the daemon answers (CLI-01)", async () => {
  const spawns: SpawnCall[] = [];
  const daemon = fakeDaemon({ probes: ["timeout", true] });
  const sent: ControlRequest[] = [];
  const send: SendControlRequest = async (_socketPath, request) => {
    sent.push(request);
    const reply: ControlReply = { id: request.id, result: ACTIVE_RESULT };
    return reply;
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
  assert.equal(spawns.length, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.method, "up");
});

test("realm up exits 1 with the catalogue line when the realm is not active (CLI-01)", async () => {
  const errorState = { snapshot: { state: "error", reason: "AGENTOS_NOT_CONFIGURED" } };
  const send: SendControlRequest = async (_socketPath, request) => {
    const reply: ControlReply = { id: request.id, result: errorState };
    return reply;
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

test("realm up and mcp refuse a non-absolute or missing --workspace value before probing or dialing (CLI-01)", async () => {
  let probes = 0;
  let sends = 0;
  const deps: CliDeps = {
    env: ENV,
    cwd: "/srv/realm-ws",
    runCommand: async () => {
      probes += 1;
      return { exitCode: 0, stdout: "podman version 5.5.0\n" };
    },
    connectSocket: async () => {
      probes += 1;
    },
    send: async () => {
      sends += 1;
      throw new Error("the socket must not be dialed for a refused workspace");
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

test("realm down sends down over the socket (CLI-01)", async () => {
  const seen: string[] = [];
  const send: SendControlRequest = async (_socketPath, request) => {
    seen.push(request.method);
    const reply: ControlReply = { id: request.id, result: "torn-down" };
    return reply;
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

test("realm down with no daemon is idempotent and says already down (CORE-06)", async () => {
  const absent: SendControlRequest = async () => {
    throw new RealmError("REALM_NOT_ACTIVE");
  };
  const result = await runCli(["down"], { env: ENV, timeoutMs: 500, send: absent });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "disconnected\n");
  assert.equal(result.stderr, "already down\n");
  const failing: SendControlRequest = async () => {
    throw new RealmError("TOOL_TIMEOUT");
  };
  const other = await runCli(["down"], { env: ENV, timeoutMs: 500, send: failing });
  assert.equal(other.exitCode, 1);
  assert.equal(other.stdout, "TOOL_TIMEOUT\n");
});

test("realm doctor with no daemon runs local checks and says the daemon is absent (CLI-01)", async () => {
  const send: SendControlRequest = async () => {
    throw new RealmError("REALM_NOT_ACTIVE");
  };
  const result = await runCli(["doctor"], {
    env: ENV,
    timeoutMs: 500,
    send,
    runCommand: async () => {
      throw new Error("podman not installed");
    },
    connectSocket: refuseConnect,
  });
  assert.equal(result.exitCode, 0);
  const checks = JSON.parse(result.stdout) as unknown[];
  assert.ok(Array.isArray(checks));
  assert.ok(checks.length > 0);
  assert.ok(result.stderr.includes("absent"));
});

test("unknown argv exits 2 with usage on stderr (CLI-01)", async () => {
  for (const argv of [["frobnicate"], [], ["up", "extra"]]) {
    const result = await runCli(argv, { env: ENV });
    assert.equal(result.exitCode, 2);
    assert.ok(result.stderr.includes("Usage: realm <up|down|status|doctor|mcp>"));
    assert.equal(result.stdout, "");
  }
});

test("realm up with Podman missing reports PODMAN_MISSING and exits promptly with no spawn (CLI-02)", async () => {
  const spawns: SpawnCall[] = [];
  let sends = 0;
  let connects = 0;
  const send: SendControlRequest = async () => {
    sends += 1;
    throw new Error("the socket must not be dialed without Podman");
  };
  const started = Date.now();
  const result = await runCli(["up"], {
    env: ENV,
    timeoutMs: 50,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn(spawns),
    send,
    runCommand: async () => {
      throw new Error("spawn podman ENOENT");
    },
    connectSocket: async () => {
      connects += 1;
    },
  });
  const elapsed = Date.now() - started;
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "PODMAN_MISSING\n");
  assert.ok(result.stderr.includes(ERROR_CATALOGUE.PODMAN_MISSING.reason));
  assert.equal(spawns.length, 0);
  assert.equal(sends, 0);
  assert.equal(connects, 0);
  assert.ok(elapsed < 2000, `up with missing Podman must return promptly, took ${elapsed} ms`);
});

test("realm mcp attaches to the daemon, claims the current directory, and serves tools through its client (CLI-01; CLI-04 entry)", async () => {
  const seen: unknown[] = [];
  const daemon = fakeDaemon({
    probes: [false, true],
    call: async (raw) => {
      seen.push(raw);
      return REFUSED_STATUS;
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
    mcpDiagnostics: diagnostics.stream,
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
  assert.deepEqual((byId.get(2) ?? {})["result"], REFUSED_STATUS);
  assert.equal(diagnostics.text(), "", "a healthy session writes nothing to diagnostics");
  assert.equal(daemon.record.connects, 3, "two liveness probes and one mcp client");
  assert.equal(daemon.record.closes, 3, "every client is closed once the session ends");
});

test("realm mcp --workspace claims the named root and attaches without spawning when a daemon answers (CLI-01)", async () => {
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
    mcpDiagnostics: diagnostics.stream,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(spawns.length, 0);
  assert.deepEqual(daemon.record.upRoots, ["/srv/other-ws"]);
  assert.equal(diagnostics.text(), "");
});

test("realm mcp still serves when up is refused and writes the refusal code to stderr (CLI-01)", async () => {
  const seen: unknown[] = [];
  const spawns: SpawnCall[] = [];
  const daemon = fakeDaemon({
    probes: [true],
    up: async () => {
      throw new RealmError("SCHEMA_INVALID");
    },
    call: async (raw) => {
      seen.push(raw);
      return REFUSED_STATUS;
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
    mcpDiagnostics: diagnostics.stream,
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
  const reply = JSON.parse(stdout) as Record<string, unknown>;
  assert.deepEqual(reply["result"], REFUSED_STATUS);
  assert.ok(diagnostics.text().startsWith("SCHEMA_INVALID: "), diagnostics.text());
});

test("realm mcp writes an ensure failure code to stderr and exits 1 without serving (CLI-01)", async () => {
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
    mcpDiagnostics: captureDiagnostics().stream,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.startsWith("TOOL_TIMEOUT: "), result.stderr);
  assert.equal(stdout, "");
  assert.equal(spawns.length, 1);
  assert.deepEqual(daemon.record.upRoots, []);
});

test("cli module stays inside its runtime allowlist with argv-form spawn and no env reads (CLI-01)", () => {
  const source = readFileSync(CLI_SOURCE, "utf8");
  const runtimeImports = [...source.matchAll(/from\s+"(node:[^"]+)"/g)].map((match) => match[1]);
  assert.ok(runtimeImports.length > 0);
  for (const specifier of runtimeImports) {
    assert.ok(
      specifier === "node:net" || specifier === "node:fs" || specifier === "node:child_process",
      `runtime import outside the P6-D7 allowlist: ${specifier}`,
    );
  }
  const envReads = source.match(/process\.env/g) ?? [];
  assert.equal(envReads.length, 1, "the only process.env read is the main entry handoff");
  assert.ok(source.includes('detached: true'));
  assert.ok(source.includes('stdio: "ignore"'));
  assert.ok(!source.includes("shell: true"));
});

test("cli module builds no in-process mcp handle and needs no runtime configuration (CLI-01)", () => {
  const source = readFileSync(CLI_SOURCE, "utf8");
  const forbidden = ["buildDaemonHandle", "BuildDaemonHandle", "buildHandle", "defaultBuildHandle", "runtimeInput"];
  for (const name of forbidden) {
    assert.ok(!source.includes(name), `${name} must not reach the CLI`);
  }
});

test("the default daemon spawn targets daemon/main.js beside the compiled CLI for up and mcp (CLI-01)", async () => {
  const send: SendControlRequest = async (_socketPath, request) => {
    const reply: ControlReply = { id: request.id, result: ACTIVE_RESULT };
    return reply;
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
      mcpDiagnostics: captureDiagnostics().stream,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(spawns.length, 1);
    assert.deepEqual(spawns[0]?.args, [join(ROOT, "dist", "src", "daemon", "main.js")]);
  }
});

test("each control request is bounded by its own CONTROL_TIMEOUT_MS entry (CLI-01)", async () => {
  const seen: { method: string; timeoutMs: number }[] = [];
  const send: SendControlRequest = async (_socketPath, request, timeoutMs) => {
    seen.push({ method: request.method, timeoutMs });
    const reply: ControlReply = { id: request.id, result: ACTIVE_RESULT };
    return reply;
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
