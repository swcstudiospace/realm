// The always-running hermetic test of test/support/host-live-session.ts (BOOTP-01): no host CLI, no Podman, no network beyond loopback.
// It pins the refusing provider, the Codex argument list, the fake MCP server, the wire recorder (bytes, EOF, exit code, signals, no
// content in the log), and the until-ready process-group runner. The only processes it starts are Node and the scripts it writes itself.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { MCP_TOOL_DESCRIPTORS } from "../../src/mcp/server.js";
import { processAlive, shellQuote } from "../support/host-live.js";
import {
  CODEX_FORWARDED_ENV,
  codexSessionArgs,
  isLoopbackPeer,
  readFakeServerLog,
  readRecorderStarts,
  readWireLog,
  REALM_TOOL_NAMES,
  runHostUntil,
  SESSION_PROMPT,
  startRefusingProvider,
  withoutShellNames,
  wireSummary,
  writeFakeMcpServer,
  writeWireRecorder,
} from "../support/host-live-session.js";
import { boundedWait, pollUntil, scaledMs } from "../support/timing.js";

const PLANTED_PARAMS = "PLANTED-PARAMS-MARKER";
const FAKE_DESCRIPTION = "FAKE-DESCRIPTION-MARKER";
const PLANTED_BEARER = "PLANTED-BEARER-TEXT";

// A temporary directory removed when the test ends.
function tempDir(t: TestContext, prefix = "rls-test-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// Three requests a host sends: initialize, the initialized notification and tools/list. The parameters carry a planted marker.
const HOST_INPUT = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", marker: PLANTED_PARAMS } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: { marker: PLANTED_PARAMS } },
]
  .map((message) => `${JSON.stringify(message)}\n`)
  .join("");

interface RunEnd {
  readonly stdout: string;
  readonly code: number | null;
}

// Runs a command with `input` on stdin, ends stdin, and waits (bounded) for it to close.
async function runToEnd(command: string, args: readonly string[], input: string): Promise<RunEnd> {
  const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "ignore"] });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code);
    });
  });
  child.stdin.on("error", () => {
    // The child may close its stdin first; the run still ends by its close.
  });
  child.stdin.end(input);
  try {
    const code = await boundedWait(closed, "a hermetic child run", 30_000);
    return { stdout: Buffer.concat(chunks).toString("utf8"), code };
  } finally {
    child.kill("SIGKILL");
  }
}

interface RecorderRig {
  readonly dir: string;
  readonly shim: string;
  readonly serverLog: string;
  readonly wireLog: string;
  readonly server: string;
}

// A recorder in front of the fake MCP server; `serverArgs` follow the server script in the target prefix.
function recorderRig(t: TestContext, serverArgs: readonly string[] = []): RecorderRig {
  const dir = tempDir(t);
  const serverLog = join(dir, "server.log");
  const wireLog = join(dir, "wire.log");
  const server = writeFakeMcpServer(join(dir, "bin"), serverLog);
  const shim = writeWireRecorder(join(dir, "bin"), { nodePath: process.execPath, target: [process.execPath, server, ...serverArgs], logFile: wireLog });
  return { dir, shim, serverLog, wireLog, server };
}

void test("REALM_TOOL_NAMES equals the sorted names of the tools realm mcp lists", () => {
  assert.deepEqual([...REALM_TOOL_NAMES], MCP_TOOL_DESCRIPTORS.map((descriptor) => descriptor.name).sort());
  assert.deepEqual([...REALM_TOOL_NAMES], [...REALM_TOOL_NAMES].sort(), "the constant is sorted");
  assert.equal(REALM_TOOL_NAMES.length, 6);
  assert.deepEqual([...CODEX_FORWARDED_ENV], ["XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "REALM_DRIVER_SOCKET"]);
  assert.equal(SESSION_PROMPT, "Reply with the single word ready.");
});

void test("the refusing provider answers 503 to everything on loopback, records no header value, and refuses connections once closed", async (t) => {
  const provider = await startRefusingProvider();
  t.after(() => provider.close());
  assert.match(provider.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);

  const get = await fetch(`${provider.baseUrl}/models`);
  assert.equal(get.status, 503);
  assert.equal(await get.text(), "{}");
  const withBearer = await fetch(`${provider.baseUrl}/responses`, { method: "POST", headers: { Authorization: `Bearer ${PLANTED_BEARER}` }, body: "{}" });
  assert.equal(withBearer.status, 503);
  await withBearer.text();
  const without = await fetch(`${provider.baseUrl}/responses`, { method: "POST", body: "{}" });
  assert.equal(without.status, 503);
  await without.text();

  const seen = provider.requests();
  assert.deepEqual(
    seen.map((request) => [request.method, request.path, request.authorization]),
    [
      ["GET", "/v1/models", false],
      ["POST", "/v1/responses", true],
      ["POST", "/v1/responses", false],
    ],
  );
  assert.equal(JSON.stringify(seen).includes(PLANTED_BEARER), false, "no header value is ever recorded");
  for (const request of seen) {
    assert.ok(isLoopbackPeer(request.peer), `a loopback peer: ${request.peer}`);
  }
  const copy = provider.requests();
  assert.notEqual(copy, seen, "requests() returns a copy");

  const port = Number(new URL(provider.baseUrl).port);
  await provider.close();
  const outcome = await new Promise<string>((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      resolve(error.code ?? "error");
    });
  });
  assert.equal(outcome, "ECONNREFUSED", "a connection attempt after close() is refused");
});

void test("isLoopbackPeer accepts the three loopback spellings and nothing else", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackPeer(address), true, address);
  }
  for (const address of ["", "10.0.0.5", "192.168.1.9", "::ffff:10.0.0.5", "localhost"]) {
    assert.equal(isLoopbackPeer(address), false, address);
  }
});

void test("codexSessionArgs builds the provider table, the model, the env_vars override and the prompt, and carries no credential field", () => {
  const baseUrl = "http://127.0.0.1:4242/v1";
  const provider = `model_providers.rehearsal={name="Realm rehearsal",base_url="${baseUrl}",wire_api="responses",request_max_retries=0,stream_max_retries=0}`;
  const head = ["exec", "--json", "--skip-git-repo-check", "-c", 'model_provider="rehearsal"', "-c", provider, "-c", 'model="rehearsal-model"'];
  const forwarded = codexSessionArgs({ baseUrl });
  assert.deepEqual(forwarded, [...head, "-c", 'mcp_servers.realm.env_vars=["XDG_RUNTIME_DIR","XDG_CONFIG_HOME","REALM_DRIVER_SOCKET"]', SESSION_PROMPT]);
  assert.deepEqual(codexSessionArgs({ baseUrl, forwardEnv: true }), forwarded);
  const plain = codexSessionArgs({ baseUrl, forwardEnv: false });
  assert.deepEqual(plain, [...head, SESSION_PROMPT]);
  for (const args of [forwarded, plain]) {
    assert.equal(args.at(-1), SESSION_PROMPT, "the prompt is last");
    for (const arg of args) {
      const lower = arg.toLowerCase();
      for (const word of ["env_key", "auth", "bearer", "api_key", "token"]) {
        assert.equal(lower.includes(word), false, `no argument carries ${word}: ${arg}`);
      }
    }
  }
});

void test("the recorder forwards the stream byte for byte, logs method names and tool names only, and never the parameters or descriptions", async (t) => {
  const rig = recorderRig(t);
  const direct = await runToEnd(process.execPath, [rig.server], HOST_INPUT);
  assert.equal(direct.code, 0);
  assert.equal(direct.stdout.split("\n").filter((line) => line !== "").length, 2, "the fake server answers the two requests and ignores the notification");
  assert.ok(direct.stdout.includes(FAKE_DESCRIPTION), "the fake tool descriptions carry the marker on the wire");

  const recorded = await runToEnd(rig.shim, [], HOST_INPUT);
  assert.equal(recorded.code, 0);
  assert.equal(recorded.stdout, direct.stdout, "the bytes the host receives equal a direct run of the server");

  const events = readWireLog(rig.wireLog);
  const toHost = events.filter((event) => event.dir === "realm-to-host");
  const fromHost = events.filter((event) => event.dir === "host-to-realm");
  assert.deepEqual(fromHost, [
    { dir: "host-to-realm", kind: "request", method: "initialize", id: 1 },
    { dir: "host-to-realm", kind: "notification", method: "notifications/initialized" },
    { dir: "host-to-realm", kind: "request", method: "tools/list", id: 2 },
  ]);
  assert.deepEqual(toHost, [
    { dir: "realm-to-host", kind: "response", id: 1 },
    { dir: "realm-to-host", kind: "response", id: 2, toolNames: [...REALM_TOOL_NAMES] },
  ]);
  const summary = wireSummary(events);
  assert.deepEqual([...summary.hostMethods], ["initialize", "notifications/initialized", "tools/list"]);
  assert.deepEqual([...summary.toolNames], [...REALM_TOOL_NAMES]);
  assert.equal(summary.answered, true);

  const text = readFileSync(rig.wireLog, "utf8");
  assert.equal(text.includes(PLANTED_PARAMS), false, "no parameter reaches the log");
  assert.equal(text.includes(FAKE_DESCRIPTION), false, "no result content reaches the log");
});

void test("the recorder ends the target's stdin at EOF and mirrors its exit code", async (t) => {
  const plain = recorderRig(t);
  const ended = await runToEnd(plain.shim, [], "");
  assert.equal(ended.code, 0, "EOF reaches the server and it exits 0");
  assert.equal(readFakeServerLog(plain.serverLog).eofCount, 1, "the fake server saw EOF");
  assert.deepEqual(readWireLog(plain.wireLog), [], "nothing was said, so nothing was logged");

  const failing = recorderRig(t, ["--exit-on-eof", "3"]);
  const code = await runToEnd(failing.shim, [], "");
  assert.equal(code.code, 3, "the recorder exits with the target's exit code");
  assert.equal(readFakeServerLog(failing.serverLog).eofCount, 1);
});

void test("a SIGTERM sent to the recorder ends the target as well, and the recorder exits 128 plus the signal number", async (t) => {
  const rig = recorderRig(t);
  const child = spawn(rig.shim, [], { stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => {
    child.kill("SIGKILL");
  });
  child.stdout.resume();
  child.stdin.on("error", () => {
    // The recorder is about to be signalled; its stdin may close under us.
  });
  const closed = new Promise<number | null>((resolve) => {
    child.once("close", (code) => {
      resolve(code);
    });
  });
  await pollUntil(() => readFakeServerLog(rig.serverLog).starts.length > 0, "the fake server started", { timeoutMs: 20_000, intervalMs: 50 });
  const [start] = readFakeServerLog(rig.serverLog).starts;
  assert.ok(start !== undefined);
  assert.equal(processAlive(start.pid), true, "the target runs while the recorder runs");
  child.kill("SIGTERM");
  assert.equal(await boundedWait(closed, "the recorder after SIGTERM", 20_000), 143);
  await pollUntil(() => !processAlive(start.pid), "the fake server ended with the recorder", { timeoutMs: 10_000, intervalMs: 50 });
});

void test("a tools/list error response logs no tool names and the summary is not answered", async (t) => {
  const rig = recorderRig(t, ["--tools-error"]);
  const ended = await runToEnd(rig.shim, [], HOST_INPUT);
  assert.equal(ended.code, 0);
  const events = readWireLog(rig.wireLog);
  const listed = events.find((event) => event.dir === "realm-to-host" && event.id === 2);
  assert.ok(listed !== undefined, "the error response is logged as a response");
  assert.equal(listed.kind, "response");
  assert.equal(listed.toolNames, undefined);
  const summary = wireSummary(events);
  assert.equal(summary.answered, false);
  assert.deepEqual([...summary.toolNames], []);
  assert.deepEqual([...summary.hostMethods], ["initialize", "notifications/initialized", "tools/list"]);
});

void test("readWireLog and readFakeServerLog skip malformed lines and read a missing file as empty", (t) => {
  const dir = tempDir(t);
  assert.deepEqual(readWireLog(join(dir, "absent.log")), []);
  assert.deepEqual(readFakeServerLog(join(dir, "absent.log")), { starts: [], eofCount: 0 });
  const wire = join(dir, "wire.log");
  writeFileSync(
    wire,
    [
      "not json",
      "[]",
      JSON.stringify({ dir: "sideways", kind: "request" }),
      JSON.stringify({ dir: "host-to-realm", kind: "request", method: "ping", id: 7 }),
      JSON.stringify({ dir: "realm-to-host", kind: "response", id: 7, toolNames: ["a", 3] }),
      "",
    ].join("\n"),
  );
  assert.deepEqual(readWireLog(wire), [
    { dir: "host-to-realm", kind: "request", method: "ping", id: 7 },
    { dir: "realm-to-host", kind: "response", id: 7 },
  ]);
  const server = join(dir, "server.log");
  writeFileSync(server, ["oops", JSON.stringify({ event: "start", pid: 12, argv: ["mcp"], env: ["HOME"], cwd: "proj" }), JSON.stringify({ event: "start", pid: "x" }), JSON.stringify({ event: "EOF" }), ""].join("\n"));
  assert.deepEqual(readFakeServerLog(server), { starts: [{ pid: 12, argv: ["mcp"], env: ["HOME"], cwd: "proj" }], eofCount: 1 });
  assert.deepEqual(withoutShellNames(["HOME", "PWD", "OLDPWD", "SHLVL", "_", "PATH"]), ["HOME", "PATH"]);
});

void test("runHostUntil ends a running host when the predicate holds, and no grandchild survives", async (t) => {
  const dir = tempDir(t);
  const marker = join(dir, "ready");
  const pidFile = join(dir, "grandchild.pid");
  const script = join(dir, "child.mjs");
  writeFileSync(
    script,
    [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      `writeFileSync(${JSON.stringify(pidFile)}, String(grandchild.pid));`,
      `writeFileSync(${JSON.stringify(marker)}, "ready");`,
      "setInterval(() => {}, 1000);",
      "",
    ].join("\n"),
  );
  const result = await runHostUntil(process.execPath, [script], {}, dir, { ready: () => Promise.resolve(existsSync(marker)), timeoutMs: scaledMs(30_000), pollMs: 50 });
  assert.equal(result.endedBy, "ready");
  assert.equal(result.timedOut, false);
  const grandchild = Number(readFileSync(pidFile, "utf8"));
  assert.ok(Number.isInteger(grandchild) && grandchild > 0);
  await pollUntil(() => !processAlive(grandchild), "the grandchild was killed with the group", { timeoutMs: 10_000, intervalMs: 50 });
});

void test("runHostUntil reports a host that exits on its own, and a host that never becomes ready times out with no process left", async (t) => {
  const dir = tempDir(t);
  const exited = await runHostUntil(process.execPath, ["-e", "process.exit(0)"], {}, dir, { ready: () => Promise.resolve(false), timeoutMs: scaledMs(30_000), pollMs: 50 });
  assert.equal(exited.endedBy, "exit");
  assert.equal(exited.exitCode, 0);
  assert.equal(exited.timedOut, false);

  const pidFile = join(dir, "sleeper.pid");
  const script = join(dir, "sleeper.mjs");
  writeFileSync(script, ['import { writeFileSync } from "node:fs";', `writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`, "setInterval(() => {}, 1000);", ""].join("\n"));
  const bound = scaledMs(1_000);
  const startedAt = Date.now();
  const stuck = await runHostUntil(process.execPath, [script], {}, dir, { ready: () => Promise.resolve(false), timeoutMs: bound, pollMs: 50 });
  assert.equal(stuck.endedBy, "timeout");
  assert.equal(stuck.timedOut, true);
  assert.equal(stuck.exitCode, undefined);
  assert.ok(Date.now() - startedAt < bound + scaledMs(15_000), "the run returns within the bound plus the kill grace");
  const sleeper = Number(readFileSync(pidFile, "utf8"));
  await pollUntil(() => !processAlive(sleeper), "the sleeper was killed", { timeoutMs: 10_000, intervalMs: 50 });
});

void test("writeWireRecorder and writeFakeMcpServer write only under the given directory, with the stated modes, and quote every argument", async (t) => {
  const dir = join(tempDir(t), "it's a dir");
  const serverLog = join(dir, "fake log.log");
  const wireLog = join(dir, "wire log's.log");
  const server = writeFakeMcpServer(dir, serverLog);
  const shim = writeWireRecorder(dir, { nodePath: process.execPath, target: [process.execPath, server], logFile: wireLog });
  assert.deepEqual(readdirSync(dir).sort(), ["fake-mcp-server.mjs", "realm", "wire-tee.mjs"]);
  assert.equal(shim, join(dir, "realm"));
  assert.equal(server, join(dir, "fake-mcp-server.mjs"));
  assert.equal(statSync(shim).mode & 0o777, 0o755);
  assert.equal(statSync(server).mode & 0o777, 0o644);
  assert.equal(statSync(join(dir, "wire-tee.mjs")).mode & 0o777, 0o644);

  const script = readFileSync(shim, "utf8");
  const quoted = [process.execPath, join(dir, "wire-tee.mjs"), wireLog, process.execPath, server].map((word) => shellQuote(word)).join(" ");
  assert.equal(script, `#!/bin/sh\nexec ${quoted} "$@"\n`);

  const ended = await runToEnd(shim, [], HOST_INPUT);
  assert.equal(ended.code, 0, "a path with a space and a single quote round-trips");
  assert.equal(wireSummary(readWireLog(wireLog)).answered, true);
  assert.equal(readFakeServerLog(serverLog).starts.length, 1);
});

// ---- The fixed-key provider ------------------------------------------------------------------------------------------------

void test("the refusing provider with an expected key records, per header, whether it equals Bearer plus the key, and never a value", async (t) => {
  const key = "FIXED-NON-SECRET-KEY";
  const other = "SOME-OTHER-KEY";
  const provider = await startRefusingProvider({ expectedKey: key });
  t.after(() => provider.close());
  for (const headers of [{ Authorization: `Bearer ${key}` }, { Authorization: `Bearer ${other}` }, { Authorization: key }, {}]) {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", headers, body: "{}" });
    assert.equal(response.status, 503);
    await response.text();
  }
  const seen = provider.requests();
  assert.deepEqual(
    seen.map((request) => [request.authorization, request.matchesKey]),
    [
      [true, true],
      [true, false],
      [true, false],
      [false, undefined],
    ],
  );
  assert.equal("matchesKey" in (seen[3] ?? {}), false, "a request without a header has no matchesKey member");
  const text = JSON.stringify(seen);
  assert.equal(text.includes(key), false, "the key is never recorded");
  assert.equal(text.includes(other), false, "no header value is ever recorded");

  const plain = await startRefusingProvider();
  t.after(() => plain.close());
  const response = await fetch(`${plain.baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: "{}" });
  await response.text();
  assert.deepEqual(
    plain.requests().map((request) => Object.keys(request).sort()),
    [["authorization", "method", "path", "peer"]],
    "without an expected key the record shape is unchanged",
  );
});

// ---- The recorder environment restore --------------------------------------------------------------------------------------

// Like runToEnd, with an explicit environment for the command.
async function runToEndWithEnv(command: string, env: Readonly<Record<string, string>>): Promise<RunEnd> {
  const child = spawn(command, [], { stdio: ["pipe", "pipe", "ignore"], env: { ...env } });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code);
    });
  });
  child.stdin.on("error", () => {
    // The child may close its stdin first; the run still ends by its close.
  });
  child.stdin.end("");
  try {
    const code = await boundedWait(closed, "a hermetic child run", 30_000);
    return { stdout: Buffer.concat(chunks).toString("utf8"), code };
  } finally {
    child.kill("SIGKILL");
  }
}

// A target that writes the values of two environment variables to a file and ends at EOF.
function writeProbeTarget(dir: string, outFile: string): string {
  const script = join(dir, "probe-target.mjs");
  writeFileSync(
    script,
    [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ restored: process.env.RESTORED_NAME ?? null, forwarded: process.env.FORWARDED_NAME ?? null }));`,
      "process.stdin.resume();",
      "",
    ].join("\n"),
  );
  return script;
}

void test("the recorder restores absent names into the target, keeps a forwarded one, logs only the sorted names and writes the pairs with mode 0600", async (t) => {
  const dir = tempDir(t);
  const outFile = join(dir, "probe.json");
  const wireLog = join(dir, "wire.log");
  const target = writeProbeTarget(dir, outFile);
  const bin = join(dir, "bin");
  const shim = writeWireRecorder(bin, {
    nodePath: process.execPath,
    target: [process.execPath, target],
    logFile: wireLog,
    restoreEnv: { RESTORED_NAME: "restored-value-marker", FORWARDED_NAME: "file-value-marker", ANOTHER_RESTORED: "another-value-marker" },
  });
  assert.deepEqual(readdirSync(bin).sort(), ["realm", "wire-restore.json", "wire-tee.mjs"]);
  assert.equal(statSync(join(bin, "wire-restore.json")).mode & 0o777, 0o600);
  assert.equal(readFileSync(shim, "utf8").includes("restored-value-marker"), false, "no value in the shim");
  assert.equal(readFileSync(join(bin, "wire-tee.mjs"), "utf8").includes("restored-value-marker"), false, "no value in the tee script");

  const ended = await runToEndWithEnv(shim, { PATH: process.env["PATH"] ?? "/usr/bin:/bin", FORWARDED_NAME: "host-value-marker" });
  assert.equal(ended.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(outFile, "utf8")), { restored: "restored-value-marker", forwarded: "host-value-marker" });

  const events = readWireLog(wireLog);
  assert.deepEqual(events, [{ dir: "host-to-realm", kind: "other", restored: ["ANOTHER_RESTORED", "RESTORED_NAME"] }]);
  assert.deepEqual([...wireSummary(events).restoredNames], ["ANOTHER_RESTORED", "RESTORED_NAME"]);
  const text = readFileSync(wireLog, "utf8");
  for (const value of ["restored-value-marker", "file-value-marker", "another-value-marker", "host-value-marker"]) {
    assert.equal(text.includes(value), false, "no environment value reaches the log");
  }
});

void test("a recorder with restoreEnv that restores nothing logs an empty list, and one without restoreEnv logs no restored event", async (t) => {
  const withRestore = tempDir(t);
  const outFile = join(withRestore, "probe.json");
  const wireLog = join(withRestore, "wire.log");
  const shim = writeWireRecorder(join(withRestore, "bin"), {
    nodePath: process.execPath,
    target: [process.execPath, writeProbeTarget(withRestore, outFile)],
    logFile: wireLog,
    restoreEnv: { FORWARDED_NAME: "file-value-marker" },
  });
  await runToEndWithEnv(shim, { PATH: process.env["PATH"] ?? "/usr/bin:/bin", FORWARDED_NAME: "host-value-marker" });
  assert.deepEqual(readWireLog(wireLog), [{ dir: "host-to-realm", kind: "other", restored: [] }]);
  assert.deepEqual([...wireSummary(readWireLog(wireLog)).restoredNames], []);

  const plain = recorderRig(t);
  const ended = await runToEnd(plain.shim, [], HOST_INPUT);
  assert.equal(ended.code, 0);
  const events = readWireLog(plain.wireLog);
  assert.equal(events.some((event) => event.restored !== undefined), false, "no restored event without restoreEnv");
  assert.deepEqual([...wireSummary(events).restoredNames], []);
  assert.equal(existsSync(join(plain.dir, "bin", "wire-restore.json")), false, "and no pair file");
});

void test("writeWireRecorder refuses a bad restore pair before it writes anything", (t) => {
  const dir = join(tempDir(t), "bin");
  const options = { nodePath: process.execPath, target: [process.execPath, "server.mjs"], logFile: join(dir, "wire.log") };
  assert.throws(() => writeWireRecorder(dir, { ...options, restoreEnv: { "": "x" } }), /restoreEnv holds a pair/);
  assert.throws(() => writeWireRecorder(dir, { ...options, restoreEnv: { "A=B": "x" } }), /restoreEnv holds a pair/);
  assert.throws(() => writeWireRecorder(dir, { ...options, restoreEnv: { GOOD: "x", BAD: 5 as unknown as string } }), /restoreEnv holds a pair/);
  assert.equal(existsSync(dir), false, "a refused call created nothing");
});

void test("readWireLog and wireSummary carry the restored names, sorted, and skip a malformed restored member", (t) => {
  const dir = tempDir(t);
  const wire = join(dir, "wire.log");
  writeFileSync(
    wire,
    [
      "not json",
      JSON.stringify({ dir: "host-to-realm", kind: "other", restored: ["B", "A"] }),
      JSON.stringify({ dir: "host-to-realm", kind: "other", restored: ["Z"] }),
      JSON.stringify({ dir: "host-to-realm", kind: "other", restored: ["C", 3] }),
      JSON.stringify({ dir: "host-to-realm", kind: "request", method: "tools/list", id: 1 }),
      "",
    ].join("\n"),
  );
  const events = readWireLog(wire);
  assert.deepEqual(events, [
    { dir: "host-to-realm", kind: "other", restored: ["B", "A"] },
    { dir: "host-to-realm", kind: "other", restored: ["Z"] },
    { dir: "host-to-realm", kind: "other" },
    { dir: "host-to-realm", kind: "request", method: "tools/list", id: 1 },
  ]);
  assert.deepEqual([...wireSummary(events).restoredNames], ["A", "B"], "the first restored event, sorted");
  assert.deepEqual([...wireSummary(events).hostMethods], ["tools/list"]);
});

void test("the recorder forces a name to the given value even when the host forwarded another, logs only the names, and writes the pairs with mode 0600", async (t) => {
  const dir = tempDir(t);
  const outFile = join(dir, "probe.json");
  const wireLog = join(dir, "wire.log");
  const bin = join(dir, "bin");
  const shim = writeWireRecorder(bin, {
    nodePath: process.execPath,
    target: [process.execPath, writeProbeTarget(dir, outFile)],
    logFile: wireLog,
    restoreEnv: { RESTORED_NAME: "restored-value-marker" },
    forceEnv: { FORWARDED_NAME: "forced-value-marker" },
  });
  assert.deepEqual(readdirSync(bin).sort(), ["realm", "wire-force.json", "wire-restore.json", "wire-tee.mjs"]);
  assert.equal(statSync(join(bin, "wire-force.json")).mode & 0o777, 0o600);
  for (const file of ["realm", "wire-tee.mjs"]) {
    assert.equal(readFileSync(join(bin, file), "utf8").includes("forced-value-marker"), false, `no forced value in ${file}`);
  }

  const ended = await runToEndWithEnv(shim, { PATH: process.env["PATH"] ?? "/usr/bin:/bin", FORWARDED_NAME: "host-value-marker" });
  assert.equal(ended.code, 0);
  assert.deepEqual(JSON.parse(readFileSync(outFile, "utf8")), { restored: "restored-value-marker", forwarded: "forced-value-marker" }, "the forced value replaces the forwarded one");
  assert.deepEqual(readWireLog(wireLog), [{ dir: "host-to-realm", kind: "other", restored: ["FORWARDED_NAME", "RESTORED_NAME"] }], "the restored and the forced names, sorted");
  const text = readFileSync(wireLog, "utf8");
  for (const value of ["restored-value-marker", "forced-value-marker", "host-value-marker"]) {
    assert.equal(text.includes(value), false, "no environment value reaches the log");
  }
});

void test("a recorder with only forceEnv writes no restore file, and writeWireRecorder refuses a bad force pair before it writes anything", (t) => {
  const dir = join(tempDir(t), "bin");
  const options = { nodePath: process.execPath, target: [process.execPath, "server.mjs"], logFile: join(dir, "wire.log") };
  assert.throws(() => writeWireRecorder(dir, { ...options, forceEnv: { "": "x" } }), /forceEnv holds a pair/);
  assert.throws(() => writeWireRecorder(dir, { ...options, forceEnv: { "A=B": "x" } }), /forceEnv holds a pair/);
  assert.throws(() => writeWireRecorder(dir, { ...options, forceEnv: { GOOD: "x", BAD: 5 as unknown as string } }), /forceEnv holds a pair/);
  assert.equal(existsSync(dir), false, "a refused call created nothing");
  writeWireRecorder(dir, { ...options, forceEnv: { HOME: "/account" } });
  assert.deepEqual(readdirSync(dir).sort(), ["realm", "wire-force.json", "wire-tee.mjs"]);
});

void test("readRecorderStarts returns the argument list of each server start the recorder logged, and nothing for a missing, foreign or argument-less log", async (t) => {
  const rig = recorderRig(t);
  assert.deepEqual(readRecorderStarts(rig.wireLog), [], "a missing log has no start");
  assert.equal((await runToEnd(rig.shim, ["mcp", "--host", "grok-build"], HOST_INPUT)).code, 0);
  assert.deepEqual(readRecorderStarts(rig.wireLog), [["mcp", "--host", "grok-build"]]);
  assert.equal((await runToEnd(rig.shim, ["mcp", "--host", "claude"], HOST_INPUT)).code, 0);
  assert.deepEqual(readRecorderStarts(rig.wireLog), [["mcp", "--host", "grok-build"], ["mcp", "--host", "claude"]], "one entry per start, in order");
  assert.equal(readFileSync(rig.wireLog, "utf8").includes(PLANTED_PARAMS), false, "the argument list is the only new content: no parameter reaches the log");
  const foreign = join(rig.dir, "foreign.log");
  writeFileSync(foreign, ["not json", JSON.stringify({ kind: "lifecycle", event: "child-exit" }), JSON.stringify({ kind: "lifecycle", event: "child-start" }), JSON.stringify({ kind: "lifecycle", event: "child-start", argv: ["a", 5] }), ""].join("\n"));
  assert.deepEqual(readRecorderStarts(foreign), [[], []], "a start without a string list has the empty list; a malformed or foreign line is skipped");
});
