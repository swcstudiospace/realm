// CLI tests (CLI-01, CLI-02; P6-D1, P6-D5, P6-D7, P6-D9, P6-D12, P6-D13). Every test
// drives the real runCli with injected seams: the spawn fake records the exact argv (no
// process starts), the send fake answers the control socket, the connect fake stands in for
// the daemon client (liveness probes and the mcp dispatcher), and the probe runs against fake
// runCommand/connectSocket. Test titles cite their requirement ID.

import { after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { appendAudit } from "../../src/audit/log.js";
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
import { boundedWait, pollUntil, scaledMs, testTimeout } from "../support/timing.js";

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
      metrics: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
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
  const result = await boundedWait(pending, "the server shutting down after stdin closed", 15_000);
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

void test("OBS-03: realm metrics with no daemon exits 1 and names REALM_NOT_ACTIVE", async () => {
  const absent: SendControlRequest = () => Promise.reject(new RealmError("REALM_NOT_ACTIVE"));
  const result = await runCli(["metrics"], { env: ENV, timeoutMs: 500, send: absent });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "REALM_NOT_ACTIVE\n");
  assert.equal(result.stderr.includes("REALM_NOT_ACTIVE"), true);
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

void test("OBS-01: general CLI usage advertises the checkpoint selectors, not the removed positional interface", async () => {
  const result = await runCli([], { env: {} });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.ok(result.stderr.includes(
    "realm audit verify [--session <id> | --file <absolute path>] [--anchor <record.json>] [--head <seq>:<sha256>]",
  ));
  assert.equal(result.stderr.includes("realm audit verify <file>"), false);
});

void test("OBS-01: the real CLI process verifies configured sessions, exported anchors and retained heads with exact exits", testTimeout(120_000), (t) => {
  const root = mkdtempSync(join(tmpdir(), "realm-cli-audit-process-"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const stateDir = join(root, "state");
  const configHome = join(root, "config");
  const home = join(root, "home");
  mkdirSync(join(configHome, "realm"), { recursive: true });
  mkdirSync(home);
  writeFileSync(join(configHome, "realm", "config.json"), JSON.stringify({
    image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
    stateDir,
    workspaceRoot: join(root, "workspace"),
  }));
  const sessionId = "cli-checkpoint-session";
  appendAudit(stateDir, { sessionId, tool: "write", outcome: "ok", phase: "admission" });
  appendAudit(stateDir, { sessionId, tool: "write", outcome: "ok", phase: "result" });
  const file = join(stateDir, "audit", `${sessionId}.jsonl`);
  const entry = join(ROOT, "dist", "src", "cli", "main.js");
  const options = {
    cwd: root,
    env: { PATH: join(root, "no-binaries"), HOME: home, XDG_CONFIG_HOME: configHome },
    encoding: "utf8" as const,
    timeout: scaledMs(20_000),
  };
  const selected = spawnSync(process.execPath, [entry, "audit", "verify", "--session", sessionId], options);
  assert.equal(selected.error, undefined);
  assert.equal(selected.status, 0, selected.stderr);
  const report = JSON.parse(selected.stdout) as {
    ok: boolean;
    files: { sessionId: string; ok: boolean; head: { seq: number; lineSha256: string }; unparsedLines: number[] }[];
  };
  assert.equal(report.ok, true);
  assert.equal(report.files.length, 1);
  const selectedFile = report.files[0];
  assert.ok(selectedFile);
  assert.equal(selectedFile.sessionId, sessionId);
  assert.equal(selectedFile.ok, true);
  assert.deepEqual(selectedFile.unparsedLines, []);
  const head = `${String(selectedFile.head.seq)}:${selectedFile.head.lineSha256}`;
  const all = spawnSync(process.execPath, [entry, "audit", "verify"], options);
  assert.equal(all.status, 0, all.stderr);
  assert.deepEqual(JSON.parse(all.stdout) as unknown, report);
  const exported = spawnSync(process.execPath, [entry, "anchor", "--session", sessionId], options);
  assert.equal(exported.status, 0, exported.stderr);
  const anchor = JSON.parse(exported.stdout) as { record: unknown };
  const anchorFile = join(root, "anchor.json");
  writeFileSync(anchorFile, JSON.stringify(anchor.record));
  const flags = ["--file", file, "--anchor", anchorFile, "--head", head];
  // No account configuration is available here: --file must remain independently usable.
  const offline = { ...options, env: { PATH: join(root, "no-binaries") } };
  const checkpointed = spawnSync(process.execPath, [entry, "audit", "verify", ...flags], offline);
  assert.equal(checkpointed.status, 0, checkpointed.stderr);
  const checkpointedReport: unknown = JSON.parse(checkpointed.stdout);
  assert.ok(typeof checkpointedReport === "object" && checkpointedReport !== null && "ok" in checkpointedReport);
  assert.equal(checkpointedReport.ok, true);
  assert.match(checkpointed.stderr, /origin is not authenticated here/);
  const invalid = spawnSync(process.execPath, [entry, "audit", "verify", "--session", sessionId, "--file", file], options);
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /usage: realm audit verify/);
  const oldPositional = spawnSync(process.execPath, [entry, "audit", "verify", file], options);
  assert.equal(oldPositional.status, 2);
  assert.equal(oldPositional.stdout, "");
  const unconfigured = spawnSync(process.execPath, [entry, "audit", "verify", "--session", sessionId], offline);
  assert.equal(unconfigured.status, 2);
  assert.equal(unconfigured.stdout, "");
  assert.match(unconfigured.stderr, /cannot resolve a state directory/);
  writeFileSync(file, "");
  for (const [checkpointFlags, reason] of [
    [["--head", head], "shorter-than-head"],
    [["--anchor", anchorFile], "shorter-than-anchor"],
  ] as const) {
    const truncated = spawnSync(process.execPath, [entry, "audit", "verify", "--file", file, ...checkpointFlags], offline);
    assert.equal(truncated.status, 1);
    const failure = JSON.parse(truncated.stdout) as { ok: boolean; files: { broken: { reason: string } }[] };
    assert.equal(failure.ok, false);
    assert.equal(failure.files[0]?.broken.reason, reason);
  }
  const link = join(root, "audit-link.jsonl");
  symlinkSync(file, link);
  const symlink = spawnSync(process.execPath, [entry, "audit", "verify", "--file", link], offline);
  assert.equal(symlink.status, 1);
  const symlinkReport: unknown = JSON.parse(symlink.stdout);
  assert.ok(typeof symlinkReport === "object" && symlinkReport !== null && "ok" in symlinkReport);
  assert.equal(symlinkReport.ok, false);
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


function failedRecord(text: string, code: string): boolean {
  return text.split("\n").some((line) => {
    if (line.length === 0) {
      return false;
    }
    try {
      const value = JSON.parse(line) as { event?: unknown; code?: unknown };
      return value.event === "daemon.failed" && value.code === code;
    } catch {
      return false;
    }
  });
}
void test("a detached daemon that fails startup writes its error to <stateDir>/daemon.log, owner-only, and realm up names that log (CLI-01, RT-06)", testTimeout(90_000), async () => {
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
      // A real daemon entry is started detached. runUp stops waiting the moment the daemon's own failure line reaches the
      // log, so this bound is only the ceiling for a host too starved to start it, not a time the test waits.
      timeoutMs: scaledMs(60_000),
      daemonEntry: join(ROOT, "dist", "src", "daemon", "main.js"),
      runCommand: okVersion,
      connectSocket: acceptConnect,
    });
    const logPath = join(stateDir, "daemon.log");
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "SCHEMA_INVALID\n");
    assert.ok(result.stderr.includes(logPath), "the failure names the daemon log");
    // The log is the daemon's own output and is written by another process: wait for its line, never for a fixed time.
    await pollUntil(
      () => existsSync(logPath) && failedRecord(readFileSync(logPath, "utf8"), "SCHEMA_INVALID"),
      "the startup error to reach the daemon log",
      { timeoutMs: 30_000, intervalMs: 25 },
    );
    assert.equal(statSync(logPath).mode & 0o777, 0o600);
    assert.equal(failedRecord(readFileSync(logPath, "utf8"), "SCHEMA_INVALID"), true);
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

void test("a runtime config that cannot be read makes status exit 2 before any daemon is dialled (CLI-01, OMP-01)", async () => {
  const daemon = fakeDaemon({ probes: [true] });
  const result = await runCli(["status"], {
    env: { ...ENV, XDG_CONFIG_HOME: join(CONFIG_HOME, "absent") },
    connect: daemon.connect,
  });
  assert.equal(result.exitCode, 2);
  assert.ok(result.stderr.startsWith("realm status: cannot resolve a state directory"), result.stderr);
  assert.equal(daemon.record.connects, 0);
});

void test("realm doctor with no config returns the init check and does not dial a daemon", async () => {
  const daemon = fakeDaemon({ probes: [true] });
  const result = await runCli(["doctor"], {
    env: { ...ENV, XDG_CONFIG_HOME: join(CONFIG_HOME, "absent") },
    connect: daemon.connect,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(daemon.record.connects, 0);
  const checks = JSON.parse(result.stdout) as { id: string; status: string; fix: string }[];
  assert.equal(checks.length, 1);
  const check = checks[0];
  assert.ok(check);
  assert.equal(check.id, "runtime-roots");
  assert.equal(check.status, "fail");
  assert.match(check.fix, /realm init/);
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

const STARTUP_NOTICE =
  "A previous daemon's sandbox was destroyed at startup: 1 container(s), 0 session record(s). Files in the workspace were kept; state outside it was lost.";

void test("realm mcp writes the up notice to diagnostics once, and nothing when up carries none (CRASH-04)", async () => {
  for (const notice of [STARTUP_NOTICE, undefined]) {
    const daemon = fakeDaemon({
      probes: [true],
      up: () => Promise.resolve(notice === undefined ? STATUS : { ...STATUS, notice }),
    });
    const input = new PassThrough();
    input.end();
    const diagnostics = captureDiagnostics();
    const result = await untilShutdown(
      runCli(["mcp", "--workspace", "/srv/realm-ws"], {
        env: ENV,
        spawn: makeSpawn([]),
        connect: daemon.connect,
        mcpInput: input,
        mcpOutput: new PassThrough(),
        diagnostics: diagnostics.stream,
      }),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(diagnostics.text(), notice === undefined ? "" : `${STARTUP_NOTICE}\n`);
  }
});

void test("realm acp writes the up notice to diagnostics once, and nothing when up carries none (CRASH-04)", async () => {
  for (const notice of [STARTUP_NOTICE, undefined]) {
    const daemon = fakeDaemon({
      probes: [true],
      up: () => Promise.resolve(notice === undefined ? ACTIVE_DAEMON_STATUS : { ...ACTIVE_DAEMON_STATUS, notice }),
    });
    const input = new PassThrough();
    input.end();
    const output = captureDiagnostics();
    const diagnostics = captureDiagnostics();
    const result = await untilShutdown(
      runCli(["acp", "--workspace", "/srv/acp-ws"], {
        env: ENV,
        timeoutMs: 500,
        spawn: makeSpawn([]),
        connect: daemon.connect,
        acpInput: input,
        acpOutput: output.stream,
        diagnostics: diagnostics.stream,
      }),
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "", "the notice never reaches stdout");
    assert.equal(output.text(), "", "no frame carries the notice");
    assert.equal(diagnostics.text(), notice === undefined ? "" : `${STARTUP_NOTICE}\n`);
  }
});

void test("realm status prints the daemon's notice inside the JSON result with no new flag (CRASH-04)", async () => {
  const send: SendControlRequest = (_socketPath, request) => {
    const reply: ControlReply = {
      id: request.id,
      result: { ...ACTIVE_DAEMON_STATUS, notice: STARTUP_NOTICE },
    };
    return Promise.resolve(reply);
  };
  const result = await runCli(["status"], { env: ENV, timeoutMs: 500, send, runCommand: okVersion, connectSocket: refuseConnect });
  assert.equal(result.exitCode, 0);
  const printed = JSON.parse(result.stdout) as Record<string, unknown>;
  assert.equal(printed["notice"], STARTUP_NOTICE);
});

function doctorFixFixture(t: TestContext): {
  readonly root: string;
  readonly stateDir: string;
  readonly workspace: string;
  readonly home: string;
  readonly deps: CliDeps;
  readonly effects: string[];
} {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "realm-cli-fix-")));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const stateDir = join(root, "state");
  mkdirSync(home);
  mkdirSync(workspace);
  const effects: string[] = [];
  const deps: CliDeps = {
    env: { HOME: home, XDG_CONFIG_HOME: join(root, "config") },
    cwd: join(root, "not-the-configured-workspace"),
    readConfig: () => ({
      image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
      stateDir,
      workspaceRoot: workspace,
    }),
    send: (_socketPath, request) => {
      effects.push(`send:${request.method}`);
      return Promise.resolve({ id: request.id, result: [] });
    },
    connect: () => {
      effects.push("connect");
      return fakeDaemon({ probes: [true] }).connect("");
    },
    spawn: () => {
      effects.push("spawn");
      return { unref: () => undefined };
    },
    runCommand: () => Promise.reject(new Error("not installed")),
    connectSocket: refuseConnect,
  };
  return { root, stateDir, workspace, home, deps, effects };
}

function readFixReport(text: string): { readonly dryRun: unknown; readonly fixes: readonly unknown[]; readonly checks: readonly unknown[] } {
  const report: unknown = JSON.parse(text);
  assert.ok(typeof report === "object" && report !== null && "dryRun" in report && "fixes" in report && "checks" in report);
  assert.equal(typeof report.dryRun, "boolean");
  assert.ok(Array.isArray(report.fixes));
  assert.ok(Array.isArray(report.checks));
  const fixes: readonly unknown[] = report.fixes;
  const checks: readonly unknown[] = report.checks;
  return { dryRun: report.dryRun, fixes, checks };
}

void test("ONB-02: doctor --fix repairs locally even when a daemon answers, reports actions and is idempotent", async (t) => {
  const { root, stateDir, deps, effects } = doctorFixFixture(t);
  mkdirSync(stateDir);
  chmodSync(stateDir, 0o755);
  writeFileSync(join(stateDir, "keep.txt"), "untouched");
  const unrelated = join(root, "unrelated");
  mkdirSync(unrelated);
  chmodSync(unrelated, 0o755);
  const ordinary = await runCli(["doctor"], deps);
  assert.equal(ordinary.exitCode, 0);
  assert.deepEqual(effects, ["send:doctor"]);
  effects.length = 0;

  const first = await runCli(["doctor", "--fix"], deps);
  assert.equal(first.exitCode, 0, first.stderr);
  const report = readFixReport(first.stdout);
  assert.equal(report.dryRun, false);
  const expectedPaths = [stateDir, join(stateDir, "run"), join(stateDir, "sessions")];
  assert.deepEqual(report.fixes, [
    { kind: "set-mode", path: stateDir, previousMode: 0o755, mode: 0o700 },
    { kind: "create-directory", path: join(stateDir, "run"), mode: 0o700 },
    { kind: "create-directory", path: join(stateDir, "sessions"), mode: 0o700 },
  ]);
  for (const path of expectedPaths) {
    assert.equal(statSync(path).mode & 0o777, 0o700);
    assert.ok(first.stderr.includes(path));
  }
  assert.ok(report.checks.some((check) => typeof check === "object" && check !== null && "id" in check && check.id === "runtime-roots"));
  assert.deepEqual(effects, [], "repair never asks, starts or connects to the daemon");
  assert.equal(readFileSync(join(stateDir, "keep.txt"), "utf8"), "untouched");
  assert.equal(statSync(unrelated).mode & 0o777, 0o755);
  assert.equal(existsSync(join(stateDir, "secrets")), false, "private-root provisioning is not a repair action");
  assert.equal(existsSync(join(stateDir, "sandboxes")), false);

  const second = await runCli(["doctor", "--fix"], deps);
  assert.equal(second.exitCode, 0);
  assert.deepEqual(readFixReport(second.stdout).fixes, []);
  assert.deepEqual(effects, []);
});

void test("ONB-02: doctor --fix --dry-run reports proposed actions without creating or changing anything", async (t) => {
  const { stateDir, deps, effects } = doctorFixFixture(t);
  const missing = await runCli(["doctor", "--fix", "--dry-run"], deps);
  assert.equal(missing.exitCode, 0, missing.stderr);
  assert.equal(readFixReport(missing.stdout).dryRun, true);
  assert.equal(existsSync(stateDir), false);
  mkdirSync(stateDir);
  chmodSync(stateDir, 0o755);
  const planned = await runCli(["doctor", "--fix", "--dry-run"], deps);
  assert.equal(planned.exitCode, 0, planned.stderr);
  assert.equal(statSync(stateDir).mode & 0o777, 0o755);
  assert.equal(existsSync(join(stateDir, "run")), false);
  assert.equal(existsSync(join(stateDir, "sessions")), false);
  assert.match(planned.stderr, /would/);
  const applied = await runCli(["doctor", "--fix"], deps);
  assert.deepEqual(readFixReport(applied.stdout).fixes, readFixReport(planned.stdout).fixes);
  assert.deepEqual(effects, []);
});

void test("ONB-02: invalid doctor flags are usage errors before reading config or contacting the daemon", async () => {
  for (const words of [
    ["--dry-run"], ["--fix", "--fix"], ["--fix", "--dry-run", "--dry-run"],
    ["--dry-run", "--fix"], ["--fix", "extra"], ["--fix=true"], ["--force"], ["--workspace", "/tmp"],
  ]) {
    const result = await runCli(["doctor", ...words], {
      env: {},
      readConfig: () => assert.fail("invalid flags must not read config"),
      send: () => assert.fail("invalid flags must not contact a daemon"),
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /doctor.*--fix.*--dry-run/);
  }
  for (const command of ["up", "status", "down", "metrics", "mcp", "acp"]) {
    assert.equal((await runCli([command, "--fix"], { env: {} })).exitCode, 2);
  }
});

void test("ONB-02: doctor --fix protects configured workspace and HOME rather than the CLI cwd", async (t) => {
  const { workspace, home, deps, effects } = doctorFixFixture(t);
  for (const stateDir of [workspace, home, dirname(workspace)]) {
    const before = statSync(stateDir).mode;
    for (const words of [["--fix"], ["--fix", "--dry-run"]]) {
      const result = await runCli(["doctor", ...words], {
        ...deps,
        readConfig: () => ({
          image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
          stateDir,
          workspaceRoot: workspace,
        }),
      });
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.stdout, "SCHEMA_INVALID\n");
      assert.ok(result.stderr.includes(ERROR_CATALOGUE.SCHEMA_INVALID.reason));
      assert.equal(statSync(stateDir).mode, before);
      assert.equal(existsSync(join(stateDir, "run")), false);
    }
  }
  assert.deepEqual(effects, []);
});

void test("ONB-02: doctor --fix refuses symlink children before tightening the state directory", async (t) => {
  const { root, stateDir, deps, effects } = doctorFixFixture(t);
  const outside = join(root, "outside");
  mkdirSync(outside);
  chmodSync(outside, 0o755);
  mkdirSync(stateDir);
  chmodSync(stateDir, 0o755);
  symlinkSync(outside, join(stateDir, "sessions"));
  for (const words of [["--fix"], ["--fix", "--dry-run"]]) {
    const result = await runCli(["doctor", ...words], deps);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "SCHEMA_INVALID\n");
    assert.ok(result.stderr.includes(ERROR_CATALOGUE.SCHEMA_INVALID.reason));
    assert.match(result.stderr, /symlink/);
    assert.equal(statSync(stateDir).mode & 0o777, 0o755);
    assert.equal(statSync(outside).mode & 0o777, 0o755);
    assert.equal(existsSync(join(stateDir, "run")), false);
  }
  assert.deepEqual(effects, []);
});

void test("ONB-02: doctor --fix refuses missing config with an init hint while ordinary doctor stays diagnostic", async (t) => {
  const { deps, effects } = doctorFixFixture(t);
  const unreadable = { ...deps, readConfig: () => { throw new RealmError("SCHEMA_INVALID"); } };
  const fix = await runCli(["doctor", "--fix"], unreadable);
  assert.equal(fix.exitCode, 1);
  assert.equal(fix.stdout, "SCHEMA_INVALID\n");
  assert.match(fix.stderr, /realm init/);
  const ordinary = await runCli(["doctor"], unreadable);
  assert.equal(ordinary.exitCode, 0);
  assert.deepEqual(effects, []);
});

void test("ONB-02: the real CLI process exposes dry-run, repair, idempotency, refusal and strict usage", testTimeout(120_000), (t) => {
  const { root, stateDir, workspace, home } = doctorFixFixture(t);
  const configHome = join(root, "config");
  mkdirSync(join(configHome, "realm"), { recursive: true });
  writeFileSync(join(configHome, "realm", "config.json"), JSON.stringify({
    image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
    stateDir,
    workspaceRoot: workspace,
  }));
  mkdirSync(stateDir);
  chmodSync(stateDir, 0o755);
  const entry = join(ROOT, "dist", "src", "cli", "main.js");
  const options = {
    cwd: root,
    // An empty PATH and isolated account config keep the real diagnostic probes off the host stack.
    env: { PATH: join(root, "no-binaries"), HOME: home, XDG_CONFIG_HOME: configHome },
    encoding: "utf8" as const,
    timeout: scaledMs(20_000),
  };
  const dry = spawnSync(process.execPath, [entry, "doctor", "--fix", "--dry-run"], options);
  assert.equal(dry.error, undefined);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(readFixReport(dry.stdout).dryRun, true);
  assert.equal(statSync(stateDir).mode & 0o777, 0o755);
  assert.equal(existsSync(join(stateDir, "sessions")), false);
  const fixed = spawnSync(process.execPath, [entry, "doctor", "--fix"], options);
  assert.equal(fixed.error, undefined);
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.equal(statSync(stateDir).mode & 0o777, 0o700);
  assert.equal(statSync(join(stateDir, "sessions")).mode & 0o777, 0o700);
  assert.deepEqual(readFixReport(fixed.stdout).fixes, readFixReport(dry.stdout).fixes);
  const again = spawnSync(process.execPath, [entry, "doctor", "--fix"], options);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(readFixReport(again.stdout).fixes, []);
  const invalid = spawnSync(process.execPath, [entry, "doctor", "--dry-run"], options);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /Usage:/);
  rmSync(join(stateDir, "sessions"), { recursive: true });
  symlinkSync(workspace, join(stateDir, "sessions"));
  const refused = spawnSync(process.execPath, [entry, "doctor", "--fix"], options);
  assert.equal(refused.status, 1);
  assert.equal(refused.stdout, "SCHEMA_INVALID\n");
  assert.ok(refused.stderr.includes(ERROR_CATALOGUE.SCHEMA_INVALID.reason));
  const diagnostic = spawnSync(process.execPath, [entry, "doctor"], options);
  assert.equal(diagnostic.status, 0, diagnostic.stderr);
});

function hasUidReader(value: NodeJS.Process): value is NodeJS.Process & { getuid: () => number } {
  return typeof value.getuid === "function";
}

void test("ONB-02: doctor --fix refuses foreign ownership with a catalogue code and no mutation", async (t) => {
  const { stateDir, deps, effects } = doctorFixFixture(t);
  mkdirSync(stateDir);
  chmodSync(stateDir, 0o755);
  assert.ok(hasUidReader(process), "foreign ownership test requires the Linux UID reader");
  const uid = process.getuid();
  t.mock.method(process, "getuid", () => uid === 0 ? 1 : 0);
  for (const words of [["--fix"], ["--fix", "--dry-run"]]) {
    const result = await runCli(["doctor", ...words], deps);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "SCHEMA_INVALID\n");
    assert.match(result.stderr, /foreign-owner/);
    assert.equal(statSync(stateDir).mode & 0o777, 0o755);
    assert.equal(existsSync(join(stateDir, "run")), false);
  }
  assert.deepEqual(effects, []);
});
