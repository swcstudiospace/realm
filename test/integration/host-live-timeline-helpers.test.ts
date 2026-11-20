// The always-running hermetic test of the timeline extension of the wire recorder (Phase 47, plan 47-01; test/support/host-live-session.ts):
// marks, the error and meta flags, the lifecycle lines, the stderr copy, and four scripted child servers that produce the four classes of
// test/support/wire-timeline.ts through the real recorder. No host CLI, no Podman, no network: the only processes are Node and the scripts
// this test writes. The existing pins of host-live-session-helpers.test.ts are not edited; they must pass beside this file.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { readFakeServerLog, readWireLog, writeFakeMcpServer, writeWireRecorder } from "../support/host-live-session.js";
import { classifyToolsList, readWireTimeline, SIX_TOOLS } from "../support/wire-timeline.js";
import { boundedWait, pollUntil } from "../support/timing.js";

const PLANTED_PARAMS = "PLANTED-PARAMS-MARKER";
const PLANTED_META = "PLANTED-META-MARKER";
const ERROR_MESSAGE = "SCRIPTED-ERROR-MESSAGE-MARKER";
const STDERR_MARKER = "SCRIPTED-STDERR-MARKER";

function tempDir(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlt-test-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const frame = (message: object): string => `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`;
const HANDSHAKE_INPUT = frame({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", marker: PLANTED_PARAMS } }) + frame({ method: "notifications/initialized" });
const LIST_INPUT = frame({ id: 2, method: "tools/list", params: { _meta: { marker: PLANTED_META } } });

// A scripted child server: `answer` replies at once, `error` replies to tools/list with an error, `late` replies after the delay
// (milliseconds, argument 2), `never` exits 3 at tools/list without a reply, `stderr` writes a marker to stderr first and then answers.
const SCRIPT = [
  'import { createInterface } from "node:readline";',
  "const mode = process.argv[2];",
  "const delay = Number(process.argv[3] ?? 0);",
  `const TOOLS = ${JSON.stringify(SIX_TOOLS)};`,
  `if (mode === "stderr") { process.stderr.write(${JSON.stringify(`${STDERR_MARKER}\n`)}); }`,
  'const write = (message) => { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n"); };',
  "const list = (id) => { write({ id, result: { tools: TOOLS.map((name) => ({ name, inputSchema: { type: \"object\" } })) } }); };",
  "const rl = createInterface({ input: process.stdin });",
  'rl.on("line", (line) => {',
  "  let message;",
  "  try { message = JSON.parse(line); } catch { return; }",
  "  if (message === null || typeof message !== \"object\" || message.id === undefined) { return; }",
  '  if (message.method !== "tools/list") { write({ id: message.id, result: {} }); return; }',
  '  if (mode === "never") { setTimeout(() => { process.exit(3); }, 100); return; }',
  `  if (mode === "error") { write({ id: message.id, error: { code: -32000, message: ${JSON.stringify(ERROR_MESSAGE)} } }); return; }`,
  '  if (mode === "late") { setTimeout(() => { list(message.id); }, delay); return; }',
  "  list(message.id);",
  "});",
  "",
].join("\n");

interface Rig {
  readonly dir: string;
  readonly shim: string;
  readonly wireLog: string;
}

// A recorder in front of the scripted server in `mode`.
function scriptedRig(t: TestContext, mode: string, delay = 0, options: { readonly stderrFile?: string } = {}): Rig {
  const dir = tempDir(t);
  const bin = join(dir, "bin");
  const script = join(dir, "scripted.mjs");
  writeFileSync(script, SCRIPT);
  const wireLog = join(dir, "wire.log");
  const shim = writeWireRecorder(bin, { nodePath: process.execPath, target: [process.execPath, script, mode, String(delay)], logFile: wireLog, ...options });
  return { dir, shim, wireLog };
}

interface Driven {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

// Runs the shim as a host would: writes `input`, then ends stdin at once ("now") or only after the response to request id 2 arrived
// ("response"), and waits (bounded) for the shim to close.
async function drive(shim: string, input: string, endWhen: "now" | "response"): Promise<Driven> {
  const child = spawn(shim, [], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code);
    });
  });
  child.stdin.on("error", () => {
    // The shim may close its stdin first; the run still ends by its close.
  });
  child.stdin.write(input);
  if (endWhen === "now") {
    child.stdin.end();
  } else {
    await pollUntil(() => stdout.includes('"id":2'), "the response to request 2", { timeoutMs: 20_000, intervalMs: 10 });
    child.stdin.end();
  }
  try {
    const code = await boundedWait(closed, "a hermetic recorder run", 30_000);
    return { stdout, stderr, code };
  } finally {
    child.kill("SIGKILL");
  }
}

// ---- 1. Marks ----------------------------------------------------------------------------------------------------------------

void test("every logged line carries an integer mark, non-decreasing in file order, and the old reader returns what it returned before", async (t) => {
  const dir = tempDir(t);
  const serverLog = join(dir, "server.log");
  const wireLog = join(dir, "wire.log");
  const server = writeFakeMcpServer(join(dir, "bin"), serverLog);
  const shim = writeWireRecorder(join(dir, "bin"), { nodePath: process.execPath, target: [process.execPath, server], logFile: wireLog });
  const driven = await drive(shim, HANDSHAKE_INPUT + LIST_INPUT, "response");
  assert.equal(driven.code, 0);

  const lines = readFileSync(wireLog, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { t?: unknown });
  assert.ok(lines.length >= 7, "the wire lines and the lifecycle lines");
  let last = -1;
  for (const line of lines) {
    assert.ok(typeof line.t === "number" && Number.isInteger(line.t) && line.t >= 0, `an integer mark: ${JSON.stringify(line)}`);
    assert.ok(line.t >= last, "marks never decrease in file order");
    last = line.t;
  }
  // The old reader: exactly the events it returned before the marks, with no new field and no lifecycle line.
  assert.deepEqual(readWireLog(wireLog), [
    { dir: "host-to-realm", kind: "request", method: "initialize", id: 1 },
    { dir: "host-to-realm", kind: "notification", method: "notifications/initialized" },
    { dir: "host-to-realm", kind: "request", method: "tools/list", id: 2 },
    { dir: "realm-to-host", kind: "response", id: 1 },
    { dir: "realm-to-host", kind: "response", id: 2, toolNames: [...SIX_TOOLS] },
  ]);
  const timeline = readWireTimeline(wireLog);
  assert.deepEqual(
    timeline.filter((event) => event.kind === "lifecycle").map((event) => event.event),
    ["child-start", "host-stdin-end", "child-exit"],
    "the lifecycle lines of a clean run, in order",
  );
  assert.equal(timeline.find((event) => event.event === "child-exit")?.exitCode, 0);
  assert.equal(readFakeServerLog(serverLog).starts.length, 1);
});

// ---- 2. The error flag, the meta flag, the invalid flag and what is never logged -----------------------------------------------

void test("an error response logs the flag and the numeric code and never the message; a result logs no error member; a request with _meta logs the flag and never the content", async (t) => {
  const rig = scriptedRig(t, "error");
  const driven = await drive(rig.shim, HANDSHAKE_INPUT + LIST_INPUT, "response");
  assert.equal(driven.code, 0);
  assert.ok(driven.stdout.includes(ERROR_MESSAGE), "the host still receives the message on the wire");

  const text = readFileSync(rig.wireLog, "utf8");
  for (const planted of [ERROR_MESSAGE, PLANTED_PARAMS, PLANTED_META]) {
    assert.equal(text.includes(planted), false, `${planted} never reaches the log`);
  }
  const timeline = readWireTimeline(rig.wireLog);
  const toHost = timeline.filter((event) => event.dir === "realm-to-host");
  assert.deepEqual(
    toHost.map((event) => ({ id: event.id, error: event.error, errorCode: event.errorCode })),
    [
      { id: 1, error: undefined, errorCode: undefined },
      { id: 2, error: true, errorCode: -32000 },
    ],
  );
  const result = text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((line) => line["dir"] === "realm-to-host" && line["id"] === 1);
  assert.ok(result !== undefined);
  assert.equal("error" in result, false, "a result response has no error member");
  assert.equal("errorCode" in result, false);

  const fromHost = timeline.filter((event) => event.dir === "host-to-realm");
  assert.deepEqual(
    fromHost.map((event) => ({ method: event.method, meta: event.meta })),
    [
      { method: "initialize", meta: undefined },
      { method: "notifications/initialized", meta: undefined },
      { method: "tools/list", meta: true },
    ],
  );
});

void test("a host line that is not a JSON-RPC 2.0 message object is flagged invalid, and no host line text is logged", async (t) => {
  const rig = scriptedRig(t, "answer");
  const bad = 'PLANTED-NOT-JSON-LINE\n{"id":3,"method":"ping"}\n';
  const driven = await drive(rig.shim, HANDSHAKE_INPUT + bad + LIST_INPUT, "response");
  assert.equal(driven.code, 0);
  const text = readFileSync(rig.wireLog, "utf8");
  assert.equal(text.includes("PLANTED-NOT-JSON-LINE"), false);
  const flagged = readWireTimeline(rig.wireLog).filter((event) => event.invalid === true);
  assert.deepEqual(
    flagged.map((event) => [event.dir, event.kind, event.method]),
    [
      ["host-to-realm", "other", undefined],
      ["host-to-realm", "request", "ping"],
    ],
  );
  assert.equal(classifyToolsList(readWireTimeline(rig.wireLog)).invalidRequestLine, true);
  assert.equal(readWireTimeline(rig.wireLog).some((event) => event.dir === "realm-to-host" && event.invalid === true), false, "only the host's lines are judged");
});

// ---- 3. Lifecycle lines ------------------------------------------------------------------------------------------------------

void test("a SIGTERM or SIGINT sent to the recorder is logged as host-signal with its name before the child exit", async (t) => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const rig = scriptedRig(t, "answer");
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
    await pollUntil(() => readWireTimeline(rig.wireLog).some((event) => event.event === "child-start"), `${signal}: the target started`, { timeoutMs: 20_000, intervalMs: 20 });
    child.kill(signal);
    await boundedWait(closed, `the recorder after ${signal}`, 20_000);
    const lifecycle = readWireTimeline(rig.wireLog).filter((event) => event.kind === "lifecycle");
    const names = lifecycle.map((event) => event.event);
    assert.ok(names.includes("host-signal"), `${signal}: a host-signal line is logged; saw [${names.join(", ")}]`);
    assert.equal(lifecycle.find((event) => event.event === "host-signal")?.signal, signal);
    assert.ok(names.indexOf("host-signal") < names.indexOf("child-exit"), `${signal}: the signal is logged before the child exit`);
    assert.ok(names.indexOf("child-start") < names.indexOf("host-signal"));
    const exit = lifecycle.find((event) => event.event === "child-exit");
    assert.ok(exit !== undefined && (exit.signal === signal || exit.exitCode !== undefined), `${signal}: the child exit is logged with its code or signal`);
    assert.deepEqual(readWireLog(rig.wireLog), [], "lifecycle lines are foreign to the old reader");
  }
});

// ---- 4. The four scripted servers, four classes ---------------------------------------------------------------------------------

void test("the four scripted servers are classified ANSWERED, ERROR, WRITTEN-AFTER-CLOSE and NEVER-WRITTEN through the recorder", async (t) => {
  const answered = scriptedRig(t, "answer");
  await drive(answered.shim, HANDSHAKE_INPUT + LIST_INPUT, "response");
  const a = classifyToolsList(readWireTimeline(answered.wireLog));
  assert.equal(a.valid, true);
  assert.equal(a.class, "ANSWERED");
  assert.equal(a.sixTools, true);

  const failed = scriptedRig(t, "error");
  await drive(failed.shim, HANDSHAKE_INPUT + LIST_INPUT, "response");
  const e = classifyToolsList(readWireTimeline(failed.wireLog));
  assert.equal(e.class, "ERROR");
  assert.equal(e.errorCode, -32000);

  // The host ends its stdin right after tools/list and keeps reading; the server answers 600 ms later.
  const late = scriptedRig(t, "late", 600);
  const lateRun = await drive(late.shim, HANDSHAKE_INPUT + LIST_INPUT, "now");
  assert.ok(lateRun.stdout.includes('"id":2'), "the late response still reaches the host's open stdout");
  const w = classifyToolsList(readWireTimeline(late.wireLog));
  assert.equal(w.class, "WRITTEN-AFTER-CLOSE");
  assert.equal(w.responseKind, "result");
  assert.ok(w.L !== undefined && w.G !== undefined && w.L >= 550 && w.G < w.L, `L ${String(w.L)} and G ${String(w.G)}`);

  const never = scriptedRig(t, "never");
  await drive(never.shim, HANDSHAKE_INPUT + LIST_INPUT, "now");
  const n = classifyToolsList(readWireTimeline(never.wireLog));
  assert.equal(n.class, "NEVER-WRITTEN");
  assert.equal(n.childExit?.code, 3, "the child's exit code is logged");
  assert.ok(n.tRequest !== undefined && n.childExit.t >= n.tRequest, "the exit is after the request");
});

// ---- 5. The stderr copy ------------------------------------------------------------------------------------------------------

void test("with stderrFile the target's stderr is copied to that file (mode 0600) and still forwarded; without it the recorder directory is unchanged", async (t) => {
  const outside = tempDir(t);
  const stderrFile = join(outside, "server-stderr.txt");
  const rig = scriptedRig(t, "stderr", 0, { stderrFile });
  const bin = join(rig.dir, "bin");
  const driven = await drive(rig.shim, HANDSHAKE_INPUT + LIST_INPUT, "response");
  assert.equal(driven.code, 0);
  assert.ok(driven.stderr.includes(STDERR_MARKER), "the stderr is still forwarded to the recorder's own stderr");
  assert.equal(readFileSync(stderrFile, "utf8"), `${STDERR_MARKER}\n`, "the copy holds the stderr bytes");
  assert.equal(statSync(stderrFile).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(bin).sort(), ["realm", "wire-tee.mjs"], "no file is added to the recorder directory");
  assert.equal(readFileSync(join(bin, "wire-tee.mjs"), "utf8").includes(STDERR_MARKER), false);
  assert.equal(readFileSync(rig.wireLog, "utf8").includes(STDERR_MARKER), false, "stderr text never reaches the wire log");

  const plain = scriptedRig(t, "stderr");
  const plainRun = await drive(plain.shim, HANDSHAKE_INPUT + LIST_INPUT, "response");
  assert.ok(plainRun.stderr.includes(STDERR_MARKER), "without the option stderr is inherited and reaches the host");
  assert.deepEqual(readdirSync(join(plain.dir, "bin")).sort(), ["realm", "wire-tee.mjs"]);
  assert.throws(() => writeWireRecorder(join(plain.dir, "other"), { nodePath: process.execPath, target: [process.execPath], logFile: plain.wireLog, stderrFile: "relative.txt" }), /stderrFile must be an absolute path/);
});

// ---- 6. The forward is untouched ---------------------------------------------------------------------------------------------

void test("a log write error is swallowed after the forward, and the forwarded bytes equal a direct run, with and without the stderr copy", async (t) => {
  const dir = tempDir(t);
  const script = join(dir, "scripted.mjs");
  writeFileSync(script, SCRIPT);
  const direct = spawn(process.execPath, [script, "answer"], { stdio: ["pipe", "pipe", "ignore"] });
  let directOut = "";
  direct.stdout.on("data", (chunk: Buffer) => {
    directOut += chunk.toString("utf8");
  });
  const directClosed = new Promise<void>((resolve) => {
    direct.once("close", () => {
      resolve();
    });
  });
  direct.stdin.end(HANDSHAKE_INPUT + LIST_INPUT);
  await boundedWait(directClosed, "the direct run", 30_000);

  const unwritable = join(dir, "no-such-dir", "wire.log");
  for (const stderrFile of [undefined, join(dir, "copy.txt")]) {
    const bin = join(dir, stderrFile === undefined ? "bin-a" : "bin-b");
    const shim = writeWireRecorder(bin, { nodePath: process.execPath, target: [process.execPath, script, "answer"], logFile: unwritable, ...(stderrFile === undefined ? {} : { stderrFile }) });
    const driven = await drive(shim, HANDSHAKE_INPUT + LIST_INPUT, "now");
    assert.equal(driven.code, 0, "an unwritable log never changes the exit code");
    assert.equal(driven.stdout, directOut, "the bytes the host receives equal a direct run of the server");
  }
});
