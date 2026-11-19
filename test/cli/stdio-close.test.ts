// realm mcp against a client that closes early or reads slowly (Phase 47, plan 47-01; 47-CONTEXT D-47-02 item 6, E-47-04): a hermetic,
// in-process characterization with the injected seams of test/cli/mcp-attach.test.ts (the spawn fake, the connect fake whose up is gated on
// a promise the test controls, a PassThrough input and a Writable output). Every case asserts that each request frame the client sent
// gets exactly one reply frame, that the reply was handed to the output before the process settled, and that the process settles (the
// runCli promise resolves) inside a bound.
//
// What this proves: realm mcp, in process, answers a client that sends everything in one chunk and ends its input in the same turn, one
// that ends its input and only then sees the attach fail, a reader that drains slowly, and a reader that goes away.
// What it does NOT show: a real pipe and a real process exit are not exercised here (the bytes go to an in-memory stream and the process
// never exits), so a loss at process exit remains a hypothesis for the window.
//
// The window case itself (the handshake and tools/list answered while up is held, and stdin end with up held exits 0) is pinned exactly
// by test/cli/stdio-cold-attach.test.ts and is not repeated here; these cases add the one-chunk early close and the output side.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { after, test, type TestContext } from "node:test";
import { runCli, type CliResult, type ConnectDaemon } from "../../src/cli/main.js";
import { exitCodeAfterClose } from "../../src/cli/stdio-settle.js";
import type { DaemonStatus } from "../../src/daemon/client.js";
import type { ControlSelection } from "../../src/daemon/channel.js";
import { makeRealmError } from "../../src/core/errors.js";
import { MCP_TOOL_DESCRIPTORS } from "../../src/mcp/server.js";
import type { EnvironmentLike } from "../../src/session/paths.js";
import { boundedWait, pollUntil } from "../support/timing.js";

const CONFIG_HOME = mkdtempSync(join(tmpdir(), "realm-stdio-close-config-"));
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
const WORKSPACE = realpathSync(mkdtempSync(join(tmpdir(), "realm-stdio-close-ws-")));
after(() => {
  rmSync(CONFIG_HOME, { recursive: true, force: true });
  rmSync(WORKSPACE, { recursive: true, force: true });
});

const ENV: EnvironmentLike = { PATH: "/usr/bin", HOME: "/root", XDG_RUNTIME_DIR: "/run/user/0", XDG_CONFIG_HOME: CONFIG_HOME };
const DAEMON_ENTRY = `${STATE_DIR}/daemon/daemon.js`;
const AT = "2026-10-22T00:00:00.000Z";
const PLANTED = "PLANTED-PARAM-MARKER";
const TOOL_NAMES = MCP_TOOL_DESCRIPTORS.map((descriptor) => descriptor.name).sort();

function statusFor(selection: ControlSelection): DaemonStatus {
  return {
    snapshot: { state: "active", reason: "realm active", lastTransitionAt: AT },
    display: { label: "realm active", reason: "realm active", lastTransitionAt: AT },
    mode: "advisory",
    boundRoot: selection.workspaceRoot,
    sessionId: selection.sessionId,
  };
}

// A promise the test settles later: the attach is held on it.
interface Gate {
  readonly promise: Promise<void>;
  readonly open: () => void;
  readonly fail: (error: Error) => void;
}

function gate(): Gate {
  let open: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

const frame = (message: object): string => `${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`;
const INITIALIZE = frame({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1", marker: PLANTED } } });
const INITIALIZED = frame({ method: "notifications/initialized" });
const LIST = (id: number): string => frame({ id, method: "tools/list", params: { marker: PLANTED } });

interface Reply {
  readonly id: unknown;
  readonly result?: { readonly tools?: readonly { readonly name: string }[] };
  readonly error?: unknown;
}

function repliesOf(text: string): Reply[] {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Reply);
}

function idsOf(replies: readonly Reply[]): unknown[] {
  return replies.map((reply) => reply.id);
}

function toolNamesOf(reply: Reply | undefined): string[] | undefined {
  return reply?.result?.tools?.map((tool) => tool.name).sort();
}

// A Writable that collects what reaches it and counts the write calls it was handed, whatever the speed it drains at.
class CountingSink extends Writable {
  public handed = 0;
  public text = "";
  private readonly firstWrite: (() => void) | undefined;

  public constructor(options: { readonly holdMs?: number; readonly highWaterMark?: number; readonly onFirst?: () => void } = {}) {
    super({
      ...(options.highWaterMark === undefined ? {} : { highWaterMark: options.highWaterMark }),
      write: (chunk: Buffer, _encoding, done) => {
        this.text += chunk.toString("utf8");
        if (options.holdMs === undefined) {
          done();
          return;
        }
        // A reader that holds each write for a real interval: the slow drain is the point of the case.
        setTimeout(done, options.holdMs);
      },
    });
    this.firstWrite = options.onFirst;
  }

  public override write(chunk: unknown, encoding?: BufferEncoding | ((error: Error | null | undefined) => void), callback?: (error: Error | null | undefined) => void): boolean {
    this.handed += 1;
    const accepted = typeof encoding === "function" ? super.write(chunk, encoding) : super.write(chunk, encoding ?? "utf8", callback);
    if (this.handed === 1) {
      this.firstWrite?.();
    }
    return accepted;
  }
}

function sink(options: { readonly holdMs?: number; readonly highWaterMark?: number; readonly onFirst?: () => void } = {}): CountingSink {
  return new CountingSink(options);
}

function textSink(): CountingSink {
  return sink();
}

interface Launch {
  readonly input: PassThrough;
  readonly pending: Promise<CliResult>;
  readonly diagnostics: CountingSink;
  readonly settled: () => boolean;
}

// Starts realm mcp in process. The attach is held on `up` until the gate opens (or fails).
function launch(options: { readonly up: Gate | undefined; readonly output: Writable }): Launch {
  const input = new PassThrough();
  const diagnostics = textSink();
  const connect: ConnectDaemon = (_socketPath, selection) => ({
    status: () => Promise.resolve(statusFor(selection)),
    up: async () => {
      await options.up?.promise;
      return statusFor(selection);
    },
    call: () => Promise.resolve({ outcome: "refused", tool: null, code: "REALM_NOT_ACTIVE", retryable: false }),
    metrics: () => Promise.reject(makeRealmError("REALM_NOT_ACTIVE")),
    close: () => undefined,
  });
  const pending = runCli(["mcp", "--workspace", WORKSPACE], {
    env: ENV,
    daemonEntry: DAEMON_ENTRY,
    spawn: () => ({ unref: () => undefined }),
    connect,
    mcpInput: input,
    mcpOutput: options.output,
    diagnostics,
  });
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  return { input, pending, diagnostics, settled: () => settled };
}

// Counts the unhandled rejections and uncaught exceptions of the process while the test runs.
function watchFailures(t: TestContext): () => number {
  const seen: unknown[] = [];
  const record = (reason: unknown): void => {
    seen.push(reason);
  };
  process.on("unhandledRejection", record);
  process.on("uncaughtException", record);
  t.after(() => {
    process.off("unhandledRejection", record);
    process.off("uncaughtException", record);
  });
  return () => seen.length;
}

// Lets timers and microtasks that were queued by the code under test run.
async function quiesce(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

void test("one chunk, input ended in the same turn, attach held: the initialize and tools/list replies are written and the process settles", async (t) => {
  const failures = watchFailures(t);
  const held = gate();
  const output = sink();
  const run = launch({ up: held, output });
  run.input.write(INITIALIZE + INITIALIZED + LIST(2));
  run.input.end();
  const result = await boundedWait(run.pending, "realm mcp after an early close with the attach held", 20_000);
  held.open();
  await quiesce();

  const replies = repliesOf(output.text);
  assert.deepEqual(idsOf(replies), [1, 2], "exactly one reply per request, none for the notification, in order");
  assert.ok(replies[0]?.result !== undefined, "the initialize reply is a result");
  assert.deepEqual(toolNamesOf(replies[1]), TOOL_NAMES, "the tools/list reply carries the six tools");
  assert.equal(output.handed, 2, "both replies were handed to the output before the process settled");
  assert.equal(result.exitCode, 0);
  assert.equal(output.text.includes(PLANTED), false, "no request parameter is echoed");
  assert.equal(failures(), 0, "no unhandled rejection or exception");
});

void test("tools/list sent, the input ended, and only then the held attach fails: the reply was already written and the exit code follows the settle rule", async (t) => {
  const failures = watchFailures(t);
  const held = gate();
  const output = sink();
  const run = launch({ up: held, output });
  run.input.write(INITIALIZE + INITIALIZED);
  run.input.write(LIST(2));
  await pollUntil(() => output.text.includes('"id":2'), "the tools/list reply", { timeoutMs: 20_000, intervalMs: 5 });
  run.input.end();
  const result = await boundedWait(run.pending, "realm mcp after the input ended with the attach held", 20_000);
  const writtenAtSettle = output.handed;

  // Only now does the attach fail. The session had already ended, so it is no client-less boot: the rule of stdio-settle.ts decides.
  held.fail(makeRealmError("DAEMON_START_TIMEOUT"));
  await quiesce();
  assert.equal(result.exitCode, exitCodeAfterClose(false, { kind: "failed", status: null, retrying: false, daemonAnswered: false }));
  assert.deepEqual(idsOf(repliesOf(output.text)), [1, 2]);
  assert.equal(output.handed, writtenAtSettle, "nothing is written after the process settled");
  assert.equal(toolNamesOf(repliesOf(output.text)[1])?.length, TOOL_NAMES.length);
  assert.equal(failures(), 0, "the late attach failure is handled: no unhandled rejection or exception");
});

void test("a reader that drains slowly still gets every reply, in order, and the process settles", async (t) => {
  const failures = watchFailures(t);
  const output = sink({ holdMs: 1500, highWaterMark: 1 });
  const run = launch({ up: undefined, output });
  run.input.write(INITIALIZE + INITIALIZED + LIST(2));
  run.input.end();
  const result = await boundedWait(run.pending, "realm mcp with a slow reader", 30_000);
  assert.equal(output.handed, 2, "both replies were handed to the output before the process settled, whatever the drain speed");
  assert.equal(result.exitCode, 0);

  // The bytes still leave in order once the reader drains: the process had not dropped them.
  await pollUntil(() => repliesOf(output.text).length === 2, "the slow reader's replies", { timeoutMs: 30_000, intervalMs: 50 });
  const replies = repliesOf(output.text);
  assert.deepEqual(idsOf(replies), [1, 2]);
  assert.deepEqual(toolNamesOf(replies[1]), TOOL_NAMES);
  assert.equal(failures(), 0);
});

void test("a reader that goes away after the first reply: the process settles within a bound with no unhandled rejection and only fixed-text diagnostics", async (t) => {
  const failures = watchFailures(t);
  const output: CountingSink = sink({
    onFirst: () => {
      // The reader leaves right after the first reply was handed over.
      output.destroy();
    },
  });
  const run = launch({ up: undefined, output });
  run.input.write(INITIALIZE + INITIALIZED);
  await pollUntil(() => output.handed >= 1, "the first reply", { timeoutMs: 20_000, intervalMs: 5 });
  run.input.write(LIST(2) + LIST(3));
  run.input.end();
  const result = await boundedWait(run.pending, "realm mcp after its reader went away", 20_000);
  await quiesce();

  assert.equal(result.exitCode, 0, "the settle rule: a destroyed output is not a failed boot");
  assert.equal(repliesOf(output.text).length, 1, "only the reply written before the reader left reached it");
  assert.equal(output.handed, 3, "the server still produced one reply for each request it read");
  assert.equal(failures(), 0, "no unhandled rejection or exception");
  const diagnostics = run.diagnostics.text;
  assert.equal(diagnostics.includes(PLANTED), false, "diagnostics never carry request content");
  for (const line of diagnostics.split("\n").filter((entry) => entry !== "")) {
    assert.match(line, /^(mcp: [a-z =_A-Z]+|[A-Z][A-Z_]+: .*)$/, `a fixed-text diagnostic line, saw ${JSON.stringify(line)}`);
  }
});

void test("a request that arrives after the input ended is never answered and never throws", async (t) => {
  const failures = watchFailures(t);
  const output = sink();
  const run = launch({ up: undefined, output });
  run.input.write(INITIALIZE);
  run.input.end();
  const result = await boundedWait(run.pending, "realm mcp after the input ended", 20_000);
  const writtenAtSettle = output.handed;
  // A real pipe cannot deliver bytes after its end (a write to the ended in-memory stream is an error of its own, not of the server), so
  // the late frame is emitted on the ended stream as a raw data event: the server has stopped reading and must neither answer nor throw.
  run.input.emit("data", Buffer.from(LIST(99)));
  await quiesce();

  assert.deepEqual(idsOf(repliesOf(output.text)), [1], "the late request got no reply and the early one got exactly one");
  assert.equal(output.handed, writtenAtSettle, "nothing is written after the process settled");
  assert.equal(result.exitCode, 0);
  assert.equal(run.diagnostics.text, "", "a late frame writes no diagnostic");
  assert.equal(failures(), 0, "no unhandled rejection or exception");
});
