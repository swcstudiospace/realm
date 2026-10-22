// CLI tests (CLI-01, CLI-02; P6-D1, P6-D5, P6-D7, P6-D9, P6-D12, P6-D13). Every test
// drives the real runCli with injected seams: the spawn fake records the exact argv (no
// process starts), the send fake answers the control socket, and the probe runs against
// fake runCommand/connectSocket. Test titles cite their requirement ID.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { ERROR_CATALOGUE, RealmError } from "../../src/core/errors.js";
import {
  runCli,
  type McpHandleRequest,
  type CliDeps,
  type SendControlRequest,
  type SpawnDaemon,
} from "../../src/cli/main.js";
import type { ControlReply, ControlRequest } from "../../src/daemon/channel.js";
import type { McpDispatcher } from "../../src/mcp/server.js";
import type { EnvironmentLike } from "../../src/session/paths.js";
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

test("realm up with no daemon spawns the detached child then reports over the socket (CLI-01)", async () => {
  const spawns: SpawnCall[] = [];
  let calls = 0;
  const send: SendControlRequest = async (_socketPath, request) => {
    calls += 1;
    assert.equal(request.method, "up");
    assert.deepEqual(request.params, { workspaceRoot: "/srv/realm-ws" });
    if (calls === 1) {
      throw new RealmError("REALM_NOT_ACTIVE");
    }
    const reply: ControlReply = { id: request.id, result: "active" };
    return reply;
  };
  const result = await runCli(["up"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn(spawns),
    send,
    runCommand: okVersion,
    connectSocket: acceptConnect,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "active\n");
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0]?.file, process.execPath);
  assert.deepEqual(spawns[0]?.args, [DAEMON_ENTRY]);
  assert.equal(spawns[0]?.detached, true);
  assert.equal(spawns[0]?.stdio, "ignore");
});

test("realm up sends the --workspace root as the up params and spawns nothing when the daemon answers (CLI-01)", async () => {
  const sent: ControlRequest[] = [];
  const spawns: SpawnCall[] = [];
  const result = await runCli(["up", "--workspace", "/srv/other-ws"], {
    env: ENV,
    cwd: "/srv/realm-ws",
    timeoutMs: 500,
    daemonEntry: DAEMON_ENTRY,
    spawn: makeSpawn(spawns),
    send: async (_socketPath, request) => {
      sent.push(request);
      return { id: request.id, result: "active" };
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
    send: async (_socketPath, request) => {
      sent.push(request);
      return { id: request.id, result: "active" };
    },
    runCommand: okVersion,
    connectSocket: acceptConnect,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(sent[0]?.params, { workspaceRoot: process.cwd() });
});

test("realm up refuses a non-absolute or missing --workspace value before probing or dialing (CLI-01)", async () => {
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
  };
  for (const argv of [["up", "--workspace", "relative/ws"], ["up", "--workspace", ""], ["up", "--workspace"]]) {
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

test("realm mcp serves the Phase 5 server over stdio from the shared handle (CLI-01; CLI-04 entry)", async () => {
  const seen: unknown[] = [];
  const requests: McpHandleRequest[] = [];
  const runtimeInput = { image: "example.com/realm@localhost", workloadArgv: ["work"] };
  const outcome: ToolOutcome = {
    outcome: "refused",
    tool: "status",
    code: "REALM_NOT_ACTIVE",
    retryable: ERROR_CATALOGUE.REALM_NOT_ACTIVE.retryable,
  };
  const dispatcher = {
    call: async (raw: unknown) => {
      seen.push(raw);
      return outcome;
    },
  } as unknown as McpDispatcher;
  const input = new PassThrough();
  const output = new PassThrough();
  const stderrChunks: string[] = [];
  const diagnostics = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(String(chunk));
      callback();
    },
  });
  let stdout = "";
  output.on("data", (chunk) => {
    stdout += String(chunk);
  });
  const pending = runCli(["mcp"], {
    env: ENV,
    runtimeInput,
    buildHandle: (request) => {
      requests.push(request);
      return { dispatcher };
    },
    mcpInput: input,
    mcpOutput: output,
    mcpDiagnostics: diagnostics,
  });
  input.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`,
  );
  input.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "status", arguments: {} } })}\n`,
  );
  input.end();
  const result = await Promise.race([
    pending,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("realm mcp did not shut down after stdin closed")), 2000).unref();
    }),
  ]);
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(seen, [{ status: {} }]);
  const lines = stdout === "" ? [] : stdout.slice(0, -1).split("\n");
  assert.equal(lines.length, 2);
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed["jsonrpc"], "2.0");
  }
  const byId = new Map<number, Record<string, unknown>>();
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    byId.set(parsed["id"] as number, parsed);
  }
  assert.ok("result" in (byId.get(1) ?? {}), "tools/list answers with a result");
  assert.deepEqual((byId.get(2) ?? {})["result"], outcome);
  assert.ok(!stderrChunks.join("").includes("jsonrpc"), "stdout carries only MCP messages");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.runtimeInput, runtimeInput);
  assert.equal(requests[0]?.env, ENV);
  assert.equal(requests[0]?.stateDir, "/tmp/realm-cli-test-state/realm");
  assert.equal(requests[0]?.policyPath, "/tmp/realm-cli-test-state/realm/policy.json");
  assert.equal(requests[0]?.sessionId, "mcp");
});

test("realm mcp without runtime configuration refuses instead of inventing it (CLI-01)", async () => {
  let built = 0;
  const result = await runCli(["mcp"], {
    env: ENV,
    buildHandle: () => {
      built += 1;
      throw new Error("buildHandle must not run without runtime configuration");
    },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "SCHEMA_INVALID\n");
  assert.equal(built, 0);
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
