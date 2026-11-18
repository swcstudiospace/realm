// End to end with the real client (CAPT-06, CAPT-07, D-32-13 items 5 and 6): a real DaemonClient and the real stdio entry against
// a real daemon on a real socket. The token a client holds is recomputed here from the daemon's keyring and the same claims
// (the HMAC is deterministic for fixed claims and a frozen clock), and that exact text and the key text are searched for in
// every sink the plan names.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runCli, type CliDeps } from "../../src/cli/main.js";
import { keyringPathOf } from "../../src/capability/keyring.js";
import { TOKEN_CAPABILITIES, type MintClaims } from "../../src/capability/token.js";
import { RealmError } from "../../src/core/errors.js";
import { connectDaemon, type DaemonClient } from "../../src/daemon/client.js";
import type { HostId } from "../../src/host/types.js";
import { FakeTimers } from "../support/fake-host-daemon.js";
import { startRig, type Rig } from "../support/capability-harness.js";
import { capture, FakeSignals, frame, listTools, toolOutcomeOf, untilReplyOn } from "../support/stdio-host-harness.js";
import { boundedWait, pollUntil, testTimeout } from "../support/timing.js";

const ENFORCE = { mode: "enforce", profiles: { cursor: ["fs.read", "fs.list"] } } as const;
const READ = { read: { path: "doc.txt", maxBytes: 64 } };
const LIST = { list: { path: ".", depth: 1 } };
const STATUS = { status: {} };

function clientFor(rig: Rig, host: HostId | undefined): DaemonClient {
  return connectDaemon(rig.socketPath, rig.selection(), host === undefined ? {} : { host, now: () => rig.nowMs() });
}

async function refusedWith(action: Promise<unknown>, code: string): Promise<RealmError> {
  try {
    await action;
  } catch (error: unknown) {
    assert.ok(error instanceof RealmError, "a catalogue refusal");
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`expected ${code}`);
}

function claimsOf(rig: Rig, host: HostId): MintClaims {
  const iat = Math.floor(rig.nowMs() / 1000);
  return { kid: "k1", sid: rig.selection().sessionId, host, caps: TOKEN_CAPABILITIES, iat, exp: iat + 3600 };
}

// Every regular file under a directory, as path and text.
function filesUnder(dir: string): { readonly path: string; readonly text: string }[] {
  const found: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(path));
    } else if (entry.isFile()) {
      found.push({ path, text: readFileSync(path, "utf8") });
    }
  }
  return found;
}

void test("CAPT-06: a real client with host claude reads, lists, writes and gets status; its lines carry host claude and the active kid; one attach line exists", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  const client = clientFor(rig, "claude");
  assert.equal((await client.call(READ)).outcome, "done");
  assert.equal((await client.call(LIST)).outcome, "done");
  assert.equal((await client.call({ write: { path: "doc.txt", content: "from claude" } })).outcome, "done");
  assert.equal((await client.call(STATUS)).outcome, "done");
  assert.equal(readFileSync(rig.docPath, "utf8"), "from claude");

  const lines = rig.auditLines();
  const attaches = lines.filter((line) => line["tool"] === "capability.attach");
  assert.equal(attaches.length, 1, "the token is carried for four calls: one attach");
  assert.equal(attaches[0]?.["host"], "claude");
  for (const line of lines.filter((entry) => entry["phase"] !== undefined)) {
    assert.equal(line["host"], "claude", String(line["tool"]));
    assert.equal(line["kid"], "k1", String(line["tool"]));
  }
  assert.equal(lines.filter((line) => line["phase"] !== undefined).length, 8, "an admission and a result line per call");
});

void test("CAPT-06: a real client with host cursor and a read-only profile reads and lists, and write, both exec forms and retry are refused POLICY_DENIED with the workspace unchanged", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  const client = clientFor(rig, "cursor");
  assert.equal((await client.call(READ)).outcome, "done");
  assert.equal((await client.call(LIST)).outcome, "done");
  const before = readFileSync(rig.docPath);
  const dispatched = rig.dispatched.length;
  const refused: readonly unknown[] = [
    { write: { path: "doc.txt", content: "nope" } },
    { exec: { argv: ["/bin/true"] } },
    { exec: { shell: true, script: "id" } },
    { retry: {} },
  ];
  for (const call of refused) {
    await refusedWith(client.call(call), "POLICY_DENIED");
  }
  assert.ok(readFileSync(rig.docPath).equals(before), "the workspace is unchanged");
  assert.equal(rig.dispatched.length, dispatched, "no refused call reached the dispatcher");
  assert.equal(rig.runs.length, 0);
});

void test("CAPT-06: a real client built without a host is refused POLICY_DENIED on every call, and only capability lines within the bound reach the audit file", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  await rig.attach("claude");
  const client = clientFor(rig, undefined);
  for (const call of [READ, LIST, STATUS, { write: { path: "doc.txt", content: "x" } }, { exec: { argv: ["/bin/true"] } }]) {
    await refusedWith(client.call(call), "POLICY_DENIED");
  }
  const lines = rig.auditLines();
  assert.equal(lines.filter((line) => line["phase"] !== undefined).length, 0, "no admission or result line");
  assert.equal(lines.length, 6, "the attach line and one refusal line per call");
  assert.equal(rig.dispatched.length, 0);
  assert.equal(readFileSync(rig.docPath, "utf8"), "original");
});

void test("CAPT-06: after a revoke the same client's next call is POLICY_DENIED (it does not guess), and a new client works", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  const client = clientFor(rig, "claude");
  assert.equal((await client.call(READ)).outcome, "done");
  rig.rotate(true);
  await refusedWith(client.call(READ), "POLICY_DENIED");
  await refusedWith(client.call(READ), "POLICY_DENIED");
  assert.equal(rig.auditLines().filter((line) => line["tool"] === "capability.attach").length, 1, "the client did not re-attach on its own");
  const fresh = clientFor(rig, "claude");
  assert.equal((await fresh.call(READ)).outcome, "done");
});

void test("CAPT-07: mode off by explicit opt-out: no keyring, no capability line, and the lines of a client with a host equal the lines of a client with none", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: { mode: "off" } });
  await rig.up();
  const run = async (host: HostId | undefined): Promise<Record<string, unknown>[]> => {
    const before = rig.auditLines().length;
    const client = clientFor(rig, host);
    // The write comes first, so the read of each run sees the same bytes.
    for (const call of [{ write: { path: "doc.txt", content: "same" } }, READ, LIST, { exec: { argv: ["/bin/true"] } }, STATUS]) {
      assert.equal((await client.call(call)).outcome, "done");
    }
    return rig.auditLines().slice(before);
  };
  // The timestamp, the chain fields and the random correlation id differ by construction; every other member must not.
  const normal = (lines: Record<string, unknown>[]): unknown[] =>
    lines.map((line) => {
      const { at, prev, seq, correlationId, ...rest } = line;
      assert.equal(typeof at, "string");
      assert.equal(typeof prev, "string");
      assert.equal(typeof seq, "number");
      assert.equal(typeof correlationId, "string");
      return rest;
    });
  const withHost = await run("claude");
  const without = await run(undefined);
  assert.equal(withHost.length, 10);
  assert.deepEqual(normal(withHost), normal(without));
  assert.equal(existsSync(keyringPathOf(rig.stateDir)), false, "no keyring file is created");
  assert.equal(rig.auditLines().some((line) => String(line["tool"]).startsWith("capability")), false);
  assert.equal(rig.logLines().some((line) => String(line["event"]).startsWith("capability")), false);
  for (const line of withHost) {
    assert.equal("host" in line, false);
    assert.equal("kid" in line, false);
  }
});

// The real stdio entry over a real client and a real daemon, with scripted streams and signals. It returns the diagnostics text.
async function runStdio(rig: Rig, host: HostId): Promise<{ readonly diagnostics: string; readonly outcomes: Record<string, unknown>[] }> {
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
  const result = runCli(["mcp", "--host", host, "--workspace", rig.workspace], deps);
  input.write(listTools(1));
  await untilReplyOn(output, 1);
  input.write(frame(2, "tools/call", { name: "read", arguments: { path: "doc.txt", maxBytes: 64 } }));
  input.write(frame(3, "tools/call", { name: "write", arguments: { path: "doc.txt", content: "by the stdio host" } }));
  const read = await untilReplyOn(output, 2);
  const write = await untilReplyOn(output, 3);
  input.end();
  await boundedWait(result, "the stdio session ending", 10_000);
  return { diagnostics: diagnostics.text(), outcomes: [toolOutcomeOf(read), toolOutcomeOf(write)] };
}

void test("CAPT-06: the real stdio entry attaches as its --host id and its calls carry the verified host", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  const first = await runStdio(rig, "claude");
  assert.deepEqual(first.outcomes.map((outcome) => outcome["outcome"]), ["done", "done"]);
  assert.equal(readFileSync(rig.docPath, "utf8"), "by the stdio host");
  const lines = rig.auditLines();
  assert.deepEqual(lines.filter((line) => line["tool"] === "capability.attach").map((line) => line["host"]), ["claude"]);
  for (const line of lines.filter((entry) => entry["phase"] !== undefined)) {
    assert.equal(line["host"], "claude");
    assert.equal(line["kid"], "k1");
  }
});

void test("CAPT-06: no leak: the token and the key appear in no sink, and the key only in keys.json", testTimeout(120_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  const client = clientFor(rig, "claude");
  await rig.up();
  const thrown: unknown[] = [];
  assert.equal((await client.call(READ)).outcome, "done");
  assert.equal((await client.call({ write: { path: "doc.txt", content: "leak probe" } })).outcome, "done");
  try {
    await client.call({ write: { path: "../escape.txt", content: "x" } });
  } catch (error: unknown) {
    thrown.push(error);
  }
  const cursor = clientFor(rig, "cursor");
  try {
    await cursor.call({ write: { path: "doc.txt", content: "x" } });
  } catch (error: unknown) {
    thrown.push(error);
  }
  const stdio = await runStdio(rig, "claude");

  // The token the client holds: recomputed from the daemon's keyring and the same claims. The daemon accepts the text, which
  // proves the claims are the ones the client received.
  const token = rig.recompute(claimsOf(rig, "claude"));
  const cursorToken = rig.recompute({ ...claimsOf(rig, "cursor"), caps: ["fs.list", "fs.read"] });
  assert.equal((await rig.tool(READ, { token })).error, undefined, "the recomputed text is the held text");
  assert.equal((await rig.tool(READ, { token: cursorToken })).error, undefined);
  const key = rig.keyOf("k1").toString("base64url");
  const secrets: readonly (readonly [string, string])[] = [
    ["the claude token", token],
    ["the cursor token", cursorToken],
    ["the key", key],
  ];

  const sinks: [string, string][] = [
    ["the daemon log", rig.logText()],
    ["the metrics snapshot", JSON.stringify((await rig.send("metrics", { selection: rig.selection() })).result)],
    ["the doctor result", JSON.stringify((await rig.send("doctor")).result)],
    ["the stdio diagnostics", stdio.diagnostics],
    ["process.env", JSON.stringify(process.env)],
    ["process.argv", JSON.stringify(process.argv)],
    ["every error the client threw", thrown.map((error) => (error instanceof Error ? `${error.message}\n${String(error.stack)}\n${JSON.stringify(error)}` : String(error))).join("\n")],
  ];
  const audits = filesUnder(join(rig.stateDir, "audit"));
  assert.ok(audits.length >= 1, "the audit files exist");
  for (const file of audits) {
    sinks.push([`the audit file ${file.path}`, file.text]);
  }
  const keyring = keyringPathOf(rig.stateDir);
  for (const file of filesUnder(rig.stateDir)) {
    if (file.path !== keyring) {
      sinks.push([`the state file ${file.path}`, file.text]);
    }
  }
  for (const workspace of [rig.workspace, rig.otherWorkspace]) {
    for (const file of filesUnder(workspace)) {
      sinks.push([`the workspace file ${file.path}`, file.text]);
    }
  }
  assert.ok(thrown.length >= 1, "the client threw at least one error to scan");
  assert.ok(sinks.length > 12, "the sweep covered the state and workspace files");
  for (const [sink, text] of sinks) {
    for (const [name, secret] of secrets) {
      assert.equal(text.includes(secret), false, `${name} appears in ${sink}`);
    }
  }
  const keyFile = rig.keyringText();
  assert.ok(keyFile.includes(key), "the key is in keys.json");
  assert.equal(keyFile.includes(token), false, "keys.json holds no token");
});

void test("CAPT-06: memory probe (Linux, informational): a non-descendant process cannot read the holder's environment, and what its memory read did is recorded", testTimeout(60_000), async (t) => {
  if (process.platform !== "linux") {
    t.skip("not Linux: /proc is not available");
    return;
  }
  if (process.getuid?.() === 0) {
    t.skip("the harness is root: root reads any process, so the probe cannot show the Yama boundary; recorded as not run");
    return;
  }
  let scope: string;
  try {
    scope = readFileSync("/proc/sys/kernel/yama/ptrace_scope", "utf8").trim();
  } catch {
    t.skip("/proc/sys/kernel/yama/ptrace_scope is not readable: recorded as not run");
    return;
  }
  if (Number(scope) < 1) {
    t.skip(`ptrace_scope is ${scope}, below 1: recorded as not run`);
    return;
  }
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  const client = clientFor(rig, "claude");
  assert.equal((await client.call(READ)).outcome, "done");
  const token = rig.recompute(claimsOf(rig, "claude"));

  // The probe is a grandchild: the child starts it detached and exits, so the probe is reparented and is no descendant of
  // this process, which holds the token in the client's closure.
  const dir = mkdtempSync(join(tmpdir(), "realm-capt-probe-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const result = join(dir, "result.json");
  const probe = join(dir, "probe.mjs");
  writeFileSync(
    probe,
    [
      'import { readFileSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";',
      "const [pid, token, out] = process.argv.slice(2);",
      "const report = { environ: null, mem: null };",
      'try { report.environ = readFileSync(`/proc/${pid}/environ`, "utf8").includes(token) ? "found" : "absent"; } catch (error) { report.environ = `denied:${error.code}`; }',
      "try {",
      '  const maps = readFileSync(`/proc/${pid}/maps`, "utf8").split("\\n").filter((line) => line.includes(" rw-p "));',
      '  const fd = openSync(`/proc/${pid}/mem`, "r");',
      '  let found = false;',
      "  for (const line of maps.slice(0, 200)) {",
      '    const [range] = line.split(" ");',
      '    const [from, to] = range.split("-").map((hex) => Number.parseInt(hex, 16));',
      "    const size = Math.min(to - from, 8 * 1024 * 1024);",
      "    const buffer = Buffer.alloc(size);",
      "    try { readSync(fd, buffer, 0, size, from); } catch { continue; }",
      "    if (buffer.includes(token)) { found = true; break; }",
      "  }",
      "  closeSync(fd);",
      '  report.mem = found ? "found" : "absent";',
      "} catch (error) { report.mem = `denied:${error.code}`; }",
      "writeFileSync(out, JSON.stringify(report));",
    ].join("\n"),
  );
  const starter = spawn(
    process.execPath,
    [
      "-e",
      `require("node:child_process").spawn(process.execPath, [${JSON.stringify(probe)}, ${JSON.stringify(String(process.pid))}, ${JSON.stringify(token)}, ${JSON.stringify(result)}], { detached: true, stdio: "ignore" }).unref();`,
    ],
    { stdio: "ignore" },
  );
  await boundedWait(once(starter, "exit"), "the probe starter exiting", 10_000);
  await pollUntil(() => existsSync(result), "the probe wrote its report", { timeoutMs: 20_000 });
  const report = JSON.parse(readFileSync(result, "utf8")) as { environ: string; mem: string };
  t.diagnostic(`ptrace_scope ${scope}; /proc/PID/environ: ${report.environ}; /proc/PID/mem: ${report.mem}; parent ${readlinkSync(`/proc/${String(process.pid)}/exe`)}`);
  assert.notEqual(report.environ, "found", "the token is not in the environment block");
});
