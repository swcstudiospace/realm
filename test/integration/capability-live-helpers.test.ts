// Hermetic tests of the helpers of the live enforce proof (plan 35-03 Task 3): the audit check and the leak check run over the real
// enforce-mode audit files, daemon log and keyring of the Phase 32 rig (a real daemon on a real socket, a real client with host
// claude), with seeded defects; the tampered copies are fed to the real realm audit verify; the stub MCP server runs as a real
// process. No Podman, no host binary and no root are needed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { redactString } from "../../src/audit/redact.js";
import { keyringPathOf } from "../../src/capability/keyring.js";
import { mintToken, TOKEN_CAPABILITIES } from "../../src/capability/token.js";
import { runAuditCommand } from "../../src/cli/audit.js";
import { RealmError } from "../../src/core/errors.js";
import { connectDaemon, type DaemonClient } from "../../src/daemon/client.js";
import { startRig, type Rig } from "../support/capability-harness.js";
import {
  auditCountsOf,
  CLAUDE_STATUS_TOOL,
  CLAUDE_TURN_VARIABLES,
  checkCapabilityAudit,
  claudePrintArgs,
  claudeTurnEnv,
  doctorItemOf,
  keyringFactOf,
  keyringSecrets,
  leakProblems,
  parseAuditLines,
  readStubCalls,
  sinksUnder,
  tamperedCopies,
  TOKEN_SECRET,
  TOKEN_SHAPE,
  writeStatusStubServer,
  type AuditLine,
  type Secret,
} from "../support/capability-live.js";
import { boundedWait, testTimeout } from "../support/timing.js";

const READ = { read: { path: "doc.txt", maxBytes: 64 } };
const LIST = { list: { path: ".", depth: 1 } };
const STATUS = { status: {} };

function clientFor(rig: Rig, host: "claude" | undefined, workspace?: string): DaemonClient {
  return connectDaemon(rig.socketPath, rig.selection(workspace), host === undefined ? {} : { host, now: () => rig.nowMs() });
}

// A real labelled session: three calls, so the file holds one attach line and six call lines.
async function claudeSession(t: Parameters<typeof startRig>[0]): Promise<{ readonly rig: Rig; readonly lines: readonly AuditLine[]; readonly sessionId: string }> {
  const rig = await startRig(t);
  await rig.up();
  const client = clientFor(rig, "claude");
  for (const call of [READ, LIST, STATUS]) {
    assert.equal((await client.call(call)).outcome, "done");
  }
  return { rig, lines: rig.auditLines(), sessionId: rig.selection().sessionId };
}

function withoutMember(line: AuditLine, member: string): AuditLine {
  return Object.fromEntries(Object.entries(line).filter(([name]) => name !== member));
}

const EXPECTED = (sessionId: string) => ({ sessionId, host: "claude", kid: "k1", calls: 3 });

void test("the audit check accepts the real lines of an enforce session with host claude and the active kid", testTimeout(60_000), async (t) => {
  const { lines, sessionId } = await claudeSession(t);
  assert.equal(lines.filter((line) => line["tool"] === "capability.attach").length, 1);
  assert.deepEqual(checkCapabilityAudit(lines, EXPECTED(sessionId)), []);
  assert.deepEqual(auditCountsOf(lines), { lines: 7, attach: 1, admission: 3, result: 3, refusal: 0, other: 0 });
  assert.deepEqual(auditCountsOf([...lines, { sessionId, tool: "status", outcome: "POLICY_DENIED" }, { sessionId, tool: "x", outcome: "ok" }]), { lines: 9, attach: 1, admission: 3, result: 3, refusal: 1, other: 1 });
});

void test("the audit check rejects each seeded defect with a sentence naming the line and the member, never a value", testTimeout(60_000), async (t) => {
  const { lines, sessionId } = await claudeSession(t);
  const attachAt = lines.findIndex((line) => line["tool"] === "capability.attach");
  const firstCall = lines.findIndex((line) => line["phase"] === "admission");
  assert.ok(attachAt >= 0 && firstCall > attachAt);
  const replaced = (index: number, line: AuditLine): readonly AuditLine[] => lines.map((entry, at) => (at === index ? line : entry));
  const call = lines[firstCall] ?? {};

  const missingKid = checkCapabilityAudit(replaced(firstCall, withoutMember(call, "kid")), EXPECTED(sessionId));
  assert.deepEqual(missingKid, [`line ${String(firstCall + 1)} (tool ${String(call["tool"])}): the kid member is missing`]);

  const missingHost = checkCapabilityAudit(replaced(firstCall, withoutMember(call, "host")), EXPECTED(sessionId));
  assert.deepEqual(missingHost, [`line ${String(firstCall + 1)} (tool ${String(call["tool"])}): the host member is missing`], "an admission line without a host");

  const wrongHost = checkCapabilityAudit(replaced(firstCall, { ...call, host: "codex" }), EXPECTED(sessionId));
  assert.deepEqual(wrongHost, [`line ${String(firstCall + 1)} (tool ${String(call["tool"])}): the host member differs from the expected host claude`]);
  assert.equal(JSON.stringify(wrongHost).includes("codex"), false, "the wrong value is not repeated");

  const wrongKid = checkCapabilityAudit(replaced(firstCall, { ...call, kid: "k9" }), EXPECTED(sessionId));
  assert.deepEqual(wrongKid, [`line ${String(firstCall + 1)} (tool ${String(call["tool"])}): the kid member differs from the expected kid k1`]);

  const reordered = [...lines.slice(0, attachAt), ...lines.slice(attachAt + 1)];
  reordered.splice(0, 0, call);
  reordered.splice(1, 0, lines[attachAt] ?? {});
  const early = checkCapabilityAudit(reordered, EXPECTED(sessionId));
  assert.equal(early.length, 1, JSON.stringify(early));
  assert.match(early[0] ?? "", /a call line comes before the first attach line/);

  const noAttach = checkCapabilityAudit(lines.filter((line) => line["tool"] !== "capability.attach"), EXPECTED(sessionId));
  assert.deepEqual(noAttach, ["no attach line with outcome ok, host claude and kid k1 exists"]);

  const refusalWithHost: AuditLine = { sessionId, tool: "status", outcome: "POLICY_DENIED", host: "claude", kid: "k1" };
  const carried = checkCapabilityAudit([...lines, refusalWithHost], EXPECTED(sessionId));
  assert.deepEqual(carried, [`line ${String(lines.length + 1)} (tool status): a refusal line must not carry a host or a kid`]);
  assert.deepEqual(checkCapabilityAudit([...lines, refusalWithHost], { ...EXPECTED(sessionId), refusalsCarryPrincipal: true, refusals: 1 }), [], "allowed when the expectation lists it");

  assert.deepEqual(checkCapabilityAudit(lines, { ...EXPECTED(sessionId), calls: 4 }), ["expected at least 4 admission lines, found 3", "expected at least 4 result lines, found 3"]);
  assert.deepEqual(checkCapabilityAudit(lines, { ...EXPECTED(sessionId), refusals: 1 }), ["expected at least 1 refusal lines, found 0"]);
  assert.deepEqual(checkCapabilityAudit(lines, { ...EXPECTED(sessionId), sessionId: "another" }).length, lines.length, "every line names another session");
  assert.deepEqual(
    checkCapabilityAudit(replaced(attachAt, { ...(lines[attachAt] ?? {}), outcome: "POLICY_DENIED" }), EXPECTED(sessionId)).slice(0, 1),
    [`line ${String(attachAt + 1)} (tool capability.attach): the attach line must have outcome ok, host claude and kid k1`],
  );
});

void test("an unlabelled session under enforce is refused POLICY_DENIED; its refusal lines carry no host and no kid, and the check accepts them under the unlabelled expectation", testTimeout(60_000), async (t) => {
  const rig = await startRig(t);
  await rig.up();
  const refused = clientFor(rig, undefined);
  await assert.rejects(refused.call(STATUS), (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED");
  const lines = rig.auditLines();
  const sessionId = rig.selection().sessionId;
  assert.equal(lines.length, 1, "one refusal line and nothing else");
  const [refusal] = lines;
  assert.ok(refusal !== undefined, "the refusal line exists");
  assert.equal(refusal["outcome"], "POLICY_DENIED");
  assert.equal("host" in refusal, false);
  assert.equal("kid" in refusal, false);
  assert.deepEqual(checkCapabilityAudit(lines, { sessionId, calls: 0, refusals: 1 }), []);
  assert.notDeepEqual(checkCapabilityAudit(lines, { sessionId, host: "claude", kid: "k1", calls: 0, refusals: 1 }), [], "it is not a labelled session");
  assert.notDeepEqual(checkCapabilityAudit([{ ...refusal, host: "claude" }], { sessionId, calls: 0 }), [], "a refusal that carries a host is a defect of the unlabelled form");
});

void test("a labelled session and an unlabelled one on one workspace share the file: the refusal lines carry no principal and the call lines still carry host and kid", testTimeout(60_000), async (t) => {
  const rig = await startRig(t);
  await rig.up();
  assert.equal((await clientFor(rig, "claude").call(STATUS)).outcome, "done");
  await assert.rejects(clientFor(rig, undefined).call(STATUS), (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED");
  const lines = rig.auditLines();
  assert.deepEqual(checkCapabilityAudit(lines, { sessionId: rig.selection().sessionId, host: "claude", kid: "k1", calls: 1, refusals: 1 }), []);
});

void test("the leak check finds a planted token shape and a planted key text in any sink, and nothing in the clean real sinks; its answer holds neither secret", testTimeout(60_000), async (t) => {
  const { rig } = await claudeSession(t);
  const { secrets, note } = keyringSecrets(keyringPathOf(rig.stateDir));
  assert.equal(note, undefined);
  assert.ok(secrets.length >= 2, "at least the stored form and the hex form");
  const all: readonly Secret[] = [TOKEN_SECRET, ...secrets];
  const cleanSinks = [
    { name: "audit", text: rig.auditText() },
    { name: "daemon log", text: rig.logText() },
    { name: "metrics", text: JSON.stringify((await rig.send("metrics", { selection: rig.selection() })).result ?? null) },
  ];
  assert.deepEqual(leakProblems(cleanSinks, all), []);

  const key = rig.keyOf("k1");
  const iat = Math.floor(rig.nowMs() / 1000);
  const token = mintToken(key, { kid: "k1", sid: rig.selection().sessionId, host: "claude", caps: TOKEN_CAPABILITIES, iat, exp: iat + 3600 });
  const planted = leakProblems(
    [
      { name: "sink-a", text: `before ${token} after` },
      { name: "sink-b", text: `the key is ${key.toString("base64url")} here` },
      { name: "sink-c", text: `hex ${key.toString("hex")}` },
      { name: "sink-d", text: "nothing here" },
    ],
    all,
  );
  assert.deepEqual(planted, [
    "sink sink-a holds a capability token shape",
    "sink sink-b holds the keyring key k1 (stored form)",
    "sink sink-c holds the keyring key k1 (hex form)",
  ]);
  const answer = JSON.stringify(planted);
  assert.equal(answer.includes(token), false);
  assert.equal(answer.includes(key.toString("base64url")), false);
  assert.equal(answer.includes(key.toString("hex")), false);
  assert.equal(JSON.stringify(secrets.map((secret) => secret.label)).includes(key.toString("base64url")), false, "no label holds a key");
});

void test("the token shape agrees with the audit redactor, and a cut token still matches", () => {
  const token = mintToken(randomBytes(32), { kid: "k1", sid: "s", host: "claude", caps: TOKEN_CAPABILITIES, iat: 1, exp: 2 });
  assert.equal(TOKEN_SHAPE.test(token), true);
  assert.equal(redactString(token).includes("rcap1."), false, "the redactor treats the same text as a token");
  const [prefix, payload] = token.split(".");
  assert.equal(TOKEN_SHAPE.test(`${String(prefix)}.${String(payload)}`), true, "a token with its MAC cut off");
  assert.equal(TOKEN_SHAPE.test("rcap1.short"), false);
  assert.equal(TOKEN_SHAPE.test("rcap2.abcdefghijkl"), false);
});

void test("the leak check refuses a global or sticky pattern, an empty text and a secret that is both or neither", () => {
  assert.throws(() => leakProblems([], [{ label: "g", pattern: /x/g }]), /global or sticky/);
  assert.throws(() => leakProblems([], [{ label: "y", pattern: /x/y }]), /global or sticky/);
  assert.throws(() => leakProblems([], [{ label: "e", text: "" }]), /empty/);
  assert.throws(() => leakProblems([], [{ label: "n" }]), /pattern or a text/);
  assert.throws(() => leakProblems([], [{ label: "b", pattern: /x/, text: "x" }]), /pattern or a text/);
});

void test("keyringSecrets reports an absent, unreadable or empty keyring as a note and no secret, and builds the three forms of each key of a real one", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlk-")));
  try {
    assert.deepEqual(keyringSecrets(join(dir, "none.json")), { secrets: [], note: "the keyring is absent or unreadable: the key sweep was skipped" });
    writeFileSync(join(dir, "bad.json"), "not json");
    assert.equal(keyringSecrets(join(dir, "bad.json")).secrets.length, 0);
    writeFileSync(join(dir, "empty.json"), JSON.stringify({ version: 1, active: "k1", keys: [] }));
    assert.match(keyringSecrets(join(dir, "empty.json")).note ?? "", /no usable key/);
    writeFileSync(join(dir, "nolist.json"), JSON.stringify({ version: 1 }));
    assert.match(keyringSecrets(join(dir, "nolist.json")).note ?? "", /no key list/);
    const raw = Buffer.from(Array.from({ length: 32 }, (_, index) => 250 - index));
    writeFileSync(join(dir, "keys.json"), JSON.stringify({ version: 1, active: "k2", keys: [{ kid: "k1", key: raw.toString("base64url"), createdAt: 1, retiredAt: 2 }, { kid: "k2", key: randomBytes(32).toString("base64url"), createdAt: 3 }] }));
    const built = keyringSecrets(join(dir, "keys.json"));
    assert.equal(built.note, undefined);
    const forms = built.secrets.filter((secret) => secret.label.includes("key k1"));
    assert.deepEqual(forms.map((secret) => secret.text), [raw.toString("base64url"), raw.toString("base64"), raw.toString("hex")]);
    assert.equal(built.secrets.length, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("the tampered copies differ from the real audit file in exactly one member each, the real file verifies and both copies fail realm audit verify --file", testTimeout(60_000), async (t) => {
  const { rig, sessionId } = await claudeSession(t);
  const original = rig.auditText();
  const copies = tamperedCopies(original);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlt-")));
  try {
    const noState = (): { readonly code: "SCHEMA_INVALID" } => ({ code: "SCHEMA_INVALID" });
    const verify = (text: string, name: string): { readonly exitCode: number; readonly stdout: string } => {
      const file = join(dir, `${name}.jsonl`);
      writeFileSync(file, text, { mode: 0o600 });
      return runAuditCommand(["verify", "--file", file], noState);
    };
    assert.equal(verify(original, sessionId).exitCode, 0, "the unedited copy verifies");
    assert.equal(verify(copies.hostEdited, `${sessionId}-h`).exitCode, 1, "the host edit is detected");
    assert.equal(verify(copies.kidEdited, `${sessionId}-k`).exitCode, 1, "the kid edit is detected");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const base = parseAuditLines(original);
  for (const [text, member] of [[copies.hostEdited, "host"], [copies.kidEdited, "kid"]] as const) {
    const edited = parseAuditLines(text);
    assert.equal(edited.length, base.length);
    const differing: string[] = [];
    edited.forEach((line, index) => {
      for (const name of new Set([...Object.keys(line), ...Object.keys(base[index] ?? {})])) {
        if (JSON.stringify(line[name]) !== JSON.stringify((base[index] ?? {})[name])) {
          differing.push(`${String(index)}:${name}`);
        }
      }
    });
    assert.deepEqual(differing.length, 1, `${member}: ${differing.join(",")}`);
    assert.ok(differing[0]?.endsWith(`:${member}`));
  }
  assert.throws(() => tamperedCopies('{"a":1}\n'), /no audit line has a host member/);
});

void test("parseAuditLines names the line that is not a JSON object and keeps the cause", () => {
  assert.equal(parseAuditLines('{"a":1}\n{"b":2}\n').length, 2);
  assert.throws(() => parseAuditLines('{"a":1}\nnope\n'), /audit line 2 is not JSON/);
  assert.throws(() => parseAuditLines("[1]\n"), /audit line 1 is not a JSON object/);
});

void test("the audit check refuses an expectation that names a host without a kid", () => {
  assert.throws(() => checkCapabilityAudit([], { sessionId: "s", host: "claude", calls: 0 }), /both the host and the kid, or neither/);
});

void test("doctorItemOf finds the capability-tokens item anywhere in the JSON of realm doctor, and nothing otherwise", () => {
  const document = { ok: true, checks: [{ id: "other", status: "pass", detail: "x" }, { id: "capability-tokens", status: "pass", detail: "mode enforce, active key k1", fix: null }] };
  assert.deepEqual(doctorItemOf(JSON.stringify(document)), { status: "pass", detail: "mode enforce, active key k1" });
  assert.deepEqual(doctorItemOf(JSON.stringify({ result: { items: [{ id: "capability-tokens", status: "warn" }] } })), { status: "warn", detail: "" });
  assert.equal(doctorItemOf("not json"), undefined);
  assert.equal(doctorItemOf(JSON.stringify({ checks: [{ id: "other", status: "pass" }] })), undefined);
});

void test("keyringFactOf records presence and the sha256 of the keyring file, never its content", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlf-")));
  try {
    assert.deepEqual(keyringFactOf(dir), { present: false, sha256: null });
    mkdirSync(join(dir, "capability"), { mode: 0o700 });
    writeFileSync(keyringPathOf(dir), "k", { mode: 0o600 });
    assert.deepEqual(keyringFactOf(dir), { present: true, sha256: createHash("sha256").update("k").digest("hex") });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("sinksUnder returns every regular file by its relative name and does not follow a symbolic link", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rls-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "rlo-")));
  try {
    mkdirSync(join(dir, "a", "b"), { recursive: true });
    writeFileSync(join(dir, "top.txt"), "top");
    writeFileSync(join(dir, "a", "b", "deep.txt"), "deep");
    writeFileSync(join(outside, "secret.txt"), "outside");
    symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"));
    const sinks = sinksUnder(dir, "scenario");
    assert.deepEqual(sinks.map((sink) => sink.name).sort(), ["scenario/a/b/deep.txt", "scenario/top.txt"]);
    assert.equal(sinks.find((sink) => sink.name === "scenario/top.txt")?.text, "top");
    assert.deepEqual(sinksUnder(join(dir, "missing"), "none"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

void test("the stub MCP server answers the handshake, the six tools and a status call as a real process, and records method and tool names only", testTimeout(60_000), async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlz-")));
  try {
    const log = join(dir, "stub.log");
    const script = writeStatusStubServer(dir, log);
    chmodSync(script, 0o644);
    const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    const closed = once(child, "close");
    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "status", arguments: { secret: "TEXT-NOT-LOGGED" } } },
    ];
    child.stdin.end(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);
    await boundedWait(closed, "the stub server ending", 15_000);
    const replies = output.trim().split("\n").map((row) => JSON.parse(row) as { id: number; result: Record<string, unknown> });
    assert.deepEqual(replies.map((reply) => reply.id), [1, 2, 3]);
    assert.equal(replies[0]?.result["protocolVersion"], "2025-06-18");
    assert.deepEqual((replies[1]?.result["tools"] as { name: string }[]).map((tool) => tool.name), ["exec", "list", "read", "retry", "status", "write"]);
    assert.ok(Array.isArray(replies[2]?.result["content"]));
    assert.deepEqual(readStubCalls(log), [{ method: "initialize" }, { method: "notifications/initialized" }, { method: "tools/list" }, { method: "tools/call", tool: "status" }]);
    assert.equal(readFileSync(log, "utf8").includes("TEXT-NOT-LOGGED"), false, "arguments are never logged");
    assert.deepEqual(readStubCalls(join(dir, "absent.log")), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test("the claude turn: the arguments allow the one status tool and bound the turns, and the environment is the isolated one plus the loopback provider and a placeholder key", () => {
  assert.deepEqual(claudePrintArgs("go"), ["-p", "go", "--allowedTools", CLAUDE_STATUS_TOOL, "--max-turns", "3", "--output-format", "json"]);
  assert.equal(CLAUDE_STATUS_TOOL, "mcp__realm__status");
  const env = claudeTurnEnv({ HOME: "/h", PATH: "/p" }, "http://127.0.0.1:4321", "placeholder");
  assert.deepEqual(env, { HOME: "/h", PATH: "/p", ...CLAUDE_TURN_VARIABLES, ANTHROPIC_BASE_URL: "http://127.0.0.1:4321", ANTHROPIC_API_KEY: "placeholder" });
  assert.equal(CLAUDE_TURN_VARIABLES["ENABLE_TOOL_SEARCH"], "false");
  for (const origin of ["http://localhost:4321", "https://127.0.0.1:4321", "http://127.0.0.1", "http://127.0.0.1:4321/v1", "http://10.0.0.1:80", "http://127.0.0.1.evil.test:80"]) {
    assert.throws(() => claudeTurnEnv({}, origin, "k"), /literal loopback origin/, origin);
  }
  assert.throws(() => claudeTurnEnv({}, "http://127.0.0.1:4321", ""), /placeholder key/);
});
