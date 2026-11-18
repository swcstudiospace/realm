// Cold attach end to end (Phase 33, COLD-01 to COLD-03): the real stdio entry (runCli with mcp) over a real client and a real daemon
// on a real socket, with the sandbox create held. In the window the handshake and tools/list are answered, the daemon's own
// status is not active, and a tool call is refused REALM_NOT_ACTIVE (retryable) without a daemon request. After the create is
// released the same connection forwards calls, and the audit lines of those calls carry the host and the kid under capability
// enforce (and neither for an unlabelled session with capability tokens off).

import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { runCli, type CliDeps, type CliResult } from "../../src/cli/main.js";
import { connectDaemon } from "../../src/daemon/client.js";
import { META_PROTOCOL_VERSION, MCP_MODERN_VERSION } from "../../src/mcp/protocol.js";
import { FakeTimers } from "../support/fake-host-daemon.js";
import { startRig, type Rig } from "../support/capability-harness.js";
import { capture, FakeSignals, frame, listTools, toolOutcomeOf, untilPresence, untilReplyOn, type Capture } from "../support/stdio-host-harness.js";
import { boundedWait, pollUntil, testTimeout } from "../support/timing.js";

const ENFORCE = { mode: "enforce", profiles: { cursor: ["fs.read", "fs.list"] } } as const;
const TOOL_NAMES: readonly unknown[] = ["exec", "read", "write", "list", "status", "retry"];
const WINDOW_REPLY_MS = 5_000;

interface Launched {
  readonly input: PassThrough;
  readonly output: Capture;
  readonly diagnostics: Capture;
  readonly result: Promise<CliResult>;
  readonly done: () => boolean;
}

// The real stdio entry on scripted streams, signals and fake timers, dialling the rig's daemon.
function launch(rig: Rig, argv: readonly string[]): Launched {
  const input = new PassThrough();
  const output = capture();
  const diagnostics = capture();
  const timers = new FakeTimers();
  const deps: CliDeps = {
    env: rig.cli.env,
    cwd: rig.workspace,
    daemonEntry: rig.cli.daemonEntry,
    timeoutMs: 5000,
    spawn: () => ({ unref: () => undefined }),
    mcpInput: input,
    mcpOutput: output.stream,
    acpInput: input,
    acpOutput: output.stream,
    diagnostics: diagnostics.stream,
    signals: new FakeSignals(),
    bootTimers: timers,
    random: timers.random,
    now: timers.now,
  };
  const result = runCli(argv, deps);
  let settled = false;
  void result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return { input, output, diagnostics, result, done: () => settled };
}

const replyWithin = (launched: Launched, id: number, what: string): Promise<Record<string, unknown>> =>
  boundedWait(untilReplyOn(launched.output, id), `the reply to ${what} while the create is held`, WINDOW_REPLY_MS);

const call = (id: number, name: string, args: unknown): string => frame(id, "tools/call", { name, arguments: args });

// The daemon's own view of the rig's workspace: the state and the label a `realm status` would print.
async function daemonView(rig: Rig): Promise<{ readonly state: string; readonly label: string }> {
  const probe = connectDaemon(rig.socketPath, rig.selection());
  try {
    const status = await probe.status();
    return { state: status.snapshot.state, label: status.display.label };
  } finally {
    probe.close();
  }
}

const toolLines = (rig: Rig): Record<string, unknown>[] => rig.auditLines().filter((line) => TOOL_NAMES.includes(line["tool"]));

async function checkWindow(rig: Rig, launched: Launched): Promise<void> {
  launched.input.write(frame(1, "server/discover", { _meta: { [META_PROTOCOL_VERSION]: MCP_MODERN_VERSION } }));
  launched.input.write(frame(2, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
  launched.input.write(listTools(3));
  await replyWithin(launched, 1, "server/discover");
  await replyWithin(launched, 2, "initialize");
  await replyWithin(launched, 3, "tools/list");

  await pollUntil(() => rig.exec.callCount("create") === 1, "the daemon is inside up (the create is logged)");
  const view = await daemonView(rig);
  assert.notEqual(view.state, "active", `the daemon's own status in the window is ${view.state} (${view.label})`);
  assert.equal(view.label, "realm disconnected", "the existing status vocabulary");
  const observed = view.state;
  assert.ok(observed === "unbound" || observed === "connecting", `observed daemon state in the window: ${observed}`);

  launched.input.write(call(10, "status", {}));
  launched.input.write(call(11, "read", { path: "doc.txt", maxBytes: 64 }));
  for (const [id, name] of [
    [10, "status"],
    [11, "read"],
  ] as const) {
    const reply = await replyWithin(launched, id, `tools/call ${name}`);
    assert.deepEqual(toolOutcomeOf(reply), { outcome: "refused", tool: name, code: "REALM_NOT_ACTIVE", retryable: true });
  }
  assert.deepEqual(rig.dispatched, [], "no tool reached a dispatcher");
  assert.deepEqual(toolLines(rig), [], "no audit line names a tool: the refusal made no daemon request");
  assert.equal(launched.done(), false, "the process is still serving");
}

async function checkTransition(rig: Rig, launched: Launched, release: () => void, host: string | null): Promise<void> {
  release();
  if (host !== null) {
    await untilPresence(rig.stateDir, host);
  } else {
    // An unlabelled session writes no marker; the daemon's own log of the attached boot report is the same signal: the observer
    // sends it only after the driver adopted a verified client.
    await pollUntil(
      () => rig.logLines().some((line) => line["event"] === "host.boot" && line["phase"] === "attached"),
      "the daemon logging the attached boot report",
    );
  }
  let id = 20;
  const forwarded: Record<string, unknown>[] = [];
  const wanted = [
    { name: "read", args: { path: "doc.txt", maxBytes: 64 } },
    { name: "list", args: { path: ".", depth: 1 } },
  ];
  for (const entry of wanted) {
    launched.input.write(call(id, entry.name, entry.args));
    const reply = await boundedWait(untilReplyOn(launched.output, id), `the reply to ${entry.name} after ready`, WINDOW_REPLY_MS);
    forwarded.push(toolOutcomeOf(reply));
    id += 1;
  }
  assert.deepEqual(
    forwarded.map((outcome) => outcome["outcome"]),
    ["done", "done"],
    "the same connection forwards calls once ready",
  );
  assert.equal(launched.done(), false, "no restart: the same process, the same stream");
}

void test("cold attach, capability enforce with a labelled host: window, refusal, transition and audit lines on a real daemon", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  const release = rig.exec.holdNext("create");
  const launched = launch(rig, ["mcp", "--host", "claude", "--workspace", rig.workspace]);
  await checkWindow(rig, launched);
  assert.equal(launched.diagnostics.text(), "", "the default level writes nothing");

  await checkTransition(rig, launched, release, "claude");
  const lines = rig.auditLines();
  const audited = lines.filter((line) => line["phase"] !== undefined && TOOL_NAMES.includes(line["tool"]));
  assert.ok(audited.length >= 2, "the forwarded calls are audited");
  assert.deepEqual(
    [...new Set(audited.map((line) => line["tool"]))].sort(),
    ["list", "read"],
    "only the two forwarded calls are audited: the refused calls in the window are not",
  );
  for (const line of lines.filter((entry) => entry["phase"] !== undefined)) {
    assert.equal(line["host"], "claude", "the audit line carries the host");
    assert.equal(line["kid"], "k1", "the audit line carries the kid");
  }

  launched.input.end();
  const result = await boundedWait(launched.result, "the session ending after stdin closed", 10_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal((await daemonView(rig)).state, "active", "no down was sent: the session is still active");
  assert.equal(rig.exec.callCount("create"), 1, "one create");
});

void test("cold attach with no --host and capability tokens off: the same window and transition, and the audit lines carry no host and no kid", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: { mode: "off" } });
  const release = rig.exec.holdNext("create");
  const launched = launch(rig, ["mcp", "--workspace", rig.workspace]);
  await checkWindow(rig, launched);
  await checkTransition(rig, launched, release, null);
  const audited = rig.auditLines().filter((line) => line["phase"] !== undefined);
  assert.ok(audited.length >= 2, "the forwarded calls are audited");
  for (const line of audited) {
    assert.equal(line["host"], undefined, "an unlabelled session names no host");
    assert.equal(line["kid"], undefined, "and no kid");
  }
  launched.input.end();
  assert.equal((await boundedWait(launched.result, "the session ending", 10_000)).exitCode, 0);
});
