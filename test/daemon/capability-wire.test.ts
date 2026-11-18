// The seeded refusal matrix over a real socket (CAPT-06, CAPT-07, D-32-13 item 4). A real daemon in mode enforce, a read-only
// profile for cursor and none for claude, an injected clock, fake runtime seams and a recording runner. Every token defect is
// presented in a real tool request after a real capability-attach, and must be answered with exactly
// { id, error: { code: POLICY_DENIED } }, with no dispatcher work, no admission line and no effect, and one capability.refused
// log line that names the internal class and carries no token text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { keyringPathOf } from "../../src/capability/keyring.js";
import { TOKEN_CAPABILITIES } from "../../src/capability/token.js";
import { startRig, type Rig } from "../support/capability-harness.js";
import { testTimeout } from "../support/timing.js";

const ENFORCE = { mode: "enforce", profiles: { cursor: ["fs.read", "fs.list"] } } as const;
const SIX = [...TOKEN_CAPABILITIES];
const WRITE = { write: { path: "doc.txt", content: "overwritten" } };
const READ = { read: { path: "doc.txt", maxBytes: 64 } };

function sessionIdOf(rig: Rig, workspace?: string): string {
  return rig.selection(workspace).sessionId;
}

// The payload object of a good token for the rig's first session, with members replaced (key order is kept).
function canon(rig: Rig, over: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const iat = Math.floor(rig.nowMs() / 1000);
  return { v: 1, kid: "k1", sid: sessionIdOf(rig), host: "claude", caps: SIX, iat, exp: iat + 3600, ...over };
}

function refusedLines(rig: Rig): Record<string, unknown>[] {
  return rig.logLines().filter((line) => line["event"] === "capability.refused");
}

function admissions(rig: Rig): number {
  return rig.auditLines().filter((line) => line["phase"] === "admission").length;
}

interface Row {
  readonly name: string;
  readonly refusal: string;
  readonly tool: unknown;
  readonly toolName: string;
  // The token member to send; undefined sends none.
  readonly token: (rig: Rig) => Promise<string | undefined> | string | undefined;
  // True when a token member is sent at all (an empty string is a member).
  readonly sends?: boolean;
}

function flipPayloadHost(token: string): string {
  const [prefix, payload, tag] = token.split(".");
  const text = Buffer.from(payload ?? "", "base64url").toString("utf8").replace('"cursor"', '"claude"');
  return `${prefix ?? ""}.${Buffer.from(text, "utf8").toString("base64url")}.${tag ?? ""}`;
}

function flipTagByte(token: string): string {
  const [prefix, payload, tag] = token.split(".");
  const bytes = Buffer.from(tag ?? "", "base64url");
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return `${prefix ?? ""}.${payload ?? ""}.${bytes.toString("base64url")}`;
}

const ROWS: readonly Row[] = [
  { name: "no token member", refusal: "format", tool: WRITE, toolName: "write", token: () => undefined, sends: false },
  { name: "an empty token", refusal: "format", tool: WRITE, toolName: "write", token: () => "" },
  { name: "a string that is not a token", refusal: "format", tool: WRITE, toolName: "write", token: () => "not-a-token" },
  {
    name: "a truncated MAC",
    refusal: "format",
    tool: WRITE,
    toolName: "write",
    token: async (rig) => (await rig.attach("claude")).token.slice(0, -6),
  },
  {
    name: "a tampered payload",
    refusal: "bad-mac",
    tool: WRITE,
    toolName: "write",
    token: async (rig) => flipPayloadHost((await rig.attach("cursor")).token),
  },
  {
    name: "a tampered MAC",
    refusal: "bad-mac",
    tool: WRITE,
    toolName: "write",
    token: async (rig) => flipTagByte((await rig.attach("claude")).token),
  },
  {
    name: "the wrong key under a known kid",
    refusal: "bad-mac",
    tool: WRITE,
    toolName: "write",
    token: (rig) => forgeWith(randomBytes(32), canon(rig)),
  },
  { name: "an unknown kid", refusal: "unknown-kid", tool: WRITE, toolName: "write", token: (rig) => rig.forge("k1", canon(rig, { kid: "k7" })) },
  { name: "version 2", refusal: "bad-version", tool: WRITE, toolName: "write", token: (rig) => rig.forge("k1", canon(rig, { v: 2 })) },
  { name: "an extra payload key", refusal: "bad-payload", tool: WRITE, toolName: "write", token: (rig) => rig.forge("k1", { ...canon(rig), extra: 1 }) },
  { name: "exp as a string", refusal: "bad-payload", tool: WRITE, toolName: "write", token: (rig) => rig.forge("k1", canon(rig, { exp: "9999999999" })) },
  { name: "unsorted caps", refusal: "bad-payload", tool: WRITE, toolName: "write", token: (rig) => rig.forge("k1", canon(rig, { caps: [...SIX].reverse() })) },
  { name: "duplicate caps", refusal: "bad-payload", tool: WRITE, toolName: "write", token: (rig) => rig.forge("k1", canon(rig, { caps: ["fs.write", "fs.write"] })) },
  { name: "caps outside the six", refusal: "bad-payload", tool: WRITE, toolName: "write", token: (rig) => rig.forge("k1", canon(rig, { caps: ["fs.write", "net.egress"] })) },
  { name: "a host outside the list", refusal: "bad-payload", tool: WRITE, toolName: "write", token: (rig) => rig.forge("k1", canon(rig, { host: "nobody" })) },
  {
    name: "exp in the past",
    refusal: "time-window",
    tool: WRITE,
    toolName: "write",
    token: (rig) => {
      const now = Math.floor(rig.nowMs() / 1000);
      return rig.forge("k1", canon(rig, { iat: now - 7200, exp: now - 3600 }));
    },
  },
  {
    name: "iat ahead of the clock",
    refusal: "time-window",
    tool: WRITE,
    toolName: "write",
    token: (rig) => {
      const now = Math.floor(rig.nowMs() / 1000);
      return rig.forge("k1", canon(rig, { iat: now + 3600, exp: now + 7200 }));
    },
  },
  {
    name: "a lifetime over the maximum",
    refusal: "time-window",
    tool: WRITE,
    toolName: "write",
    token: (rig) => {
      const now = Math.floor(rig.nowMs() / 1000);
      return rig.forge("k1", canon(rig, { iat: now, exp: now + 86_401 }));
    },
  },
  {
    name: "a token minted for another admitted session",
    refusal: "wrong-session",
    tool: WRITE,
    toolName: "write",
    token: async (rig) => (await rig.attach("claude", rig.otherWorkspace)).token,
  },
  { name: "a read-only token for write", refusal: "capability-not-granted", tool: WRITE, toolName: "write", token: async (rig) => (await rig.attach("cursor")).token },
  {
    name: "a read-only token for exec argv",
    refusal: "capability-not-granted",
    tool: { exec: { argv: ["/bin/true"] } },
    toolName: "exec",
    token: async (rig) => (await rig.attach("cursor")).token,
  },
  {
    name: "a read-only token for exec shell",
    refusal: "capability-not-granted",
    tool: { exec: { shell: true, script: "id" } },
    toolName: "exec",
    token: async (rig) => (await rig.attach("cursor")).token,
  },
  { name: "a read-only token for retry", refusal: "capability-not-granted", tool: { retry: {} }, toolName: "retry", token: async (rig) => (await rig.attach("cursor")).token },
  {
    name: "a token without fs.read for read",
    refusal: "capability-not-granted",
    tool: READ,
    toolName: "read",
    token: (rig) => rig.forge("k1", canon(rig, { caps: ["fs.write"] })),
  },
];

// A token signed with a key the daemon does not hold, under a kid it does: the construction of src/capability/token.ts.
function forgeWith(key: Buffer, payload: Record<string, unknown>): string {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  const tag = createHmac("sha256", key).update("realm-capt-v1\u0000").update(bytes).digest();
  return `rcap1.${bytes.toString("base64url")}.${tag.toString("base64url")}`;
}

void test("CAPT-06: every token defect is POLICY_DENIED with no dispatcher work, no admission line and no effect (the seeded refusal matrix)", testTimeout(120_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  await rig.up(rig.otherWorkspace);
  // A real attach first: it creates the keyring, as the first mint does in production.
  const seen = new Set<string>([(await rig.attach("claude")).token]);
  const original = readFileSync(rig.docPath);
  for (const row of ROWS) {
    await t.test(row.name, async () => {
      // One second per row refills the audit bound, so the matrix never meets it.
      rig.setNowMs(rig.nowMs() + 1000);
      const token = await row.token(rig);
      if (token !== undefined && token !== "") {
        seen.add(token);
      }
      const dispatchedBefore = rig.dispatched.length;
      const runsBefore = rig.runs.length;
      const admissionsBefore = admissions(rig);
      const refusedBefore = refusedLines(rig).length;

      const reply = await rig.tool(row.tool, row.sends === false ? {} : { token });

      assert.deepEqual(Object.keys(reply).sort(), ["error", "id"], "the reply carries exactly an id and an error");
      assert.deepEqual(reply.error, { code: "POLICY_DENIED" }, "no cause code and no detail");
      assert.equal(rig.dispatched.length, dispatchedBefore, "the dispatcher was not called");
      assert.equal(rig.runs.length, runsBefore, "the runner was not called");
      assert.equal(admissions(rig), admissionsBefore, "no admission line was written");
      assert.ok(readFileSync(rig.docPath).equals(original), "the workspace is unchanged");
      const refused = refusedLines(rig);
      assert.equal(refused.length, refusedBefore + 1, "one capability.refused line");
      assert.equal(refused.at(-1)?.["refusal"], row.refusal);
      assert.equal(refused.at(-1)?.["tool"], row.toolName);
      for (const text of seen) {
        assert.equal(rig.logText().includes(text), false, "no token text in the daemon log");
      }
    });
  }
});

void test("CAPT-06: a token expired by the clock, and a token after a revoke, are POLICY_DENIED", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE, shellEnabled: false });
  await rig.up();
  const expiring = await rig.attach("claude");
  assert.equal((await rig.tool(READ, { token: expiring.token })).error, undefined, "the fresh token reads");
  rig.setNowMs(rig.nowMs() + 3601 * 1000);
  const late = await rig.tool(READ, { token: expiring.token });
  assert.deepEqual(late.error, { code: "POLICY_DENIED" });
  assert.equal(refusedLines(rig).at(-1)?.["refusal"], "time-window");

  const live = await rig.attach("claude");
  assert.equal((await rig.tool(READ, { token: live.token })).error, undefined);
  rig.rotate(true);
  const revoked = await rig.tool(READ, { token: live.token });
  assert.deepEqual(revoked.error, { code: "POLICY_DENIED" });
  assert.equal(refusedLines(rig).at(-1)?.["refusal"], "unknown-kid");
  const renewed = await rig.attach("claude");
  assert.equal((await rig.tool(READ, { token: renewed.token })).error, undefined, "a new attach after the revoke works");
});

void test("CAPT-06: a planned rotation keeps an old token verifying for its grace", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  const old = await rig.attach("claude");
  rig.rotate(false);
  assert.equal((await rig.tool(READ, { token: old.token })).error, undefined);
  const fresh = await rig.attach("claude");
  assert.equal(JSON.stringify(rig.auditLines().filter((line) => line["tool"] === "capability.attach").map((line) => line["kid"])), '["k1","k2"]');
  assert.equal((await rig.tool(READ, { token: fresh.token })).error, undefined);
});

void test("CAPT-06: the oracle rows: a malformed call with no token is POLICY_DENIED, with a valid token it reaches the dispatcher and is SCHEMA_INVALID", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  const { token } = await rig.attach("claude");
  for (const malformed of [{ nothing: {} }, { read: {}, write: {} }, 7, "read", [], null]) {
    const before = rig.dispatched.length;
    const anonymous = await rig.tool(malformed, { token: undefined, extra: {} });
    assert.deepEqual(anonymous.error, { code: "POLICY_DENIED" }, JSON.stringify(malformed));
    assert.equal(rig.dispatched.length, before);
    const tokened = await rig.tool(malformed, { token });
    assert.deepEqual(tokened.error, { code: "SCHEMA_INVALID" }, JSON.stringify(malformed));
  }
  // A malformed call that is an object reached the dispatcher with the token; a non-object never does.
  assert.equal(rig.dispatched.length, 2);
});

void test("CAPT-06: rows with their own codes: extra host and principal keys are SCHEMA_INVALID from the channel, a host outside HOST_IDS is POLICY_DENIED, an unadmitted session is REALM_NOT_ACTIVE", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  const { token } = await rig.attach("claude");
  const dispatchedBefore = rig.dispatched.length;
  const withHost = await rig.tool(READ, { token, extra: { host: "cursor" } });
  assert.deepEqual(withHost.error, { code: "SCHEMA_INVALID" });
  const withPrincipal = await rig.tool(READ, { token, extra: { principal: { host: "cursor", kid: "k1" } } });
  assert.deepEqual(withPrincipal.error, { code: "SCHEMA_INVALID" });
  assert.equal(rig.dispatched.length, dispatchedBefore);

  const outside = await rig.attachReply("nobody");
  assert.deepEqual(outside.error, { code: "POLICY_DENIED" });
  const unadmitted = await rig.attachReply("claude", rig.otherWorkspace);
  assert.deepEqual(unadmitted.error, { code: "REALM_NOT_ACTIVE" });
  const badShape = await rig.send("capability-attach", { selection: rig.selection(), host: "Claude" });
  assert.deepEqual(badShape.error, { code: "SCHEMA_INVALID" });
});

void test("CAPT-06: token AND policy: a full token under shellEnabled false still gets SHELL_NOT_ALLOWED, and argv exec and write succeed", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE, shellEnabled: false });
  await rig.up();
  const { token } = await rig.attach("claude");
  const shell = await rig.tool({ exec: { shell: true, script: "id" } }, { token });
  assert.deepEqual(shell.error, { code: "SHELL_NOT_ALLOWED" });
  assert.equal(rig.runs.length, 0, "the policy refused before the runner");
  const argv = await rig.tool({ exec: { argv: ["/bin/true"] } }, { token });
  assert.equal(argv.error, undefined);
  assert.equal(rig.runs.length, 1);
  const write = await rig.tool({ write: { path: "doc.txt", content: "by claude" } }, { token });
  assert.equal(write.error, undefined);
  assert.equal(readFileSync(rig.docPath, "utf8"), "by claude");
});

void test("CAPT-06: a read-only profile reads, lists and gets status", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  const { token } = await rig.attach("cursor");
  for (const call of [READ, { list: { path: ".", depth: 1 } }, { status: {} }]) {
    const reply = await rig.tool(call, { token });
    assert.equal(reply.error, undefined, JSON.stringify(call));
  }
  assert.equal(rig.dispatched.length, 3);
});

void test("CAPT-07: two hosts on one session: each line carries its own verified host and kid, each attach has a line, and no request member can change the host", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  const cursor = await rig.attach("cursor");
  assert.equal((await rig.tool(READ, { token: cursor.token })).error, undefined);
  rig.rotate(false);
  const claude = await rig.attach("claude");
  assert.equal((await rig.tool({ write: { path: "doc.txt", content: "w" } }, { token: claude.token })).error, undefined);
  assert.equal((await rig.tool({ status: {} }, { token: claude.token, extra: { host: "cursor" } })).error?.code, "SCHEMA_INVALID");

  const lines = rig.auditLines();
  const attaches = lines.filter((line) => line["tool"] === "capability.attach");
  assert.deepEqual(
    attaches.map((line) => [line["host"], line["kid"], line["outcome"], "phase" in line]),
    [
      ["cursor", "k1", "ok", false],
      ["claude", "k2", "ok", false],
    ],
  );
  const reads = lines.filter((line) => line["tool"] === "read");
  assert.equal(reads.length, 2, "admission and result");
  for (const line of reads) {
    assert.equal(line["host"], "cursor");
    assert.equal(line["kid"], "k1");
  }
  const writes = lines.filter((line) => line["tool"] === "write");
  assert.equal(writes.length, 2);
  for (const line of writes) {
    assert.equal(line["host"], "claude");
    assert.equal(line["kid"], "k2");
  }
  assert.equal(lines.filter((line) => line["tool"] === "status").length, 0, "the frame with an extra key reached nothing");
});

void test("CAPT-07: 60 capability lines are the bound: the 61st refusal is still POLICY_DENIED, writes no line and raises the dropped count, and an attach at an empty bucket is POLICY_DENIED", testTimeout(60_000), async (t) => {
  const rig = await startRig(t, { capabilityTokens: ENFORCE });
  await rig.up();
  await rig.attach("claude");
  const capabilityLines = (): number => rig.auditLines().filter((line) => line["phase"] === undefined).length;
  assert.equal(capabilityLines(), 1);
  for (let index = 0; index < 59; index += 1) {
    const reply = await rig.tool(READ, { token: "x" });
    assert.deepEqual(reply.error, { code: "POLICY_DENIED" });
  }
  assert.equal(capabilityLines(), 60);
  const dropped = (): Record<string, unknown>[] => rig.logLines().filter((line) => line["event"] === "capability.audit_dropped");
  assert.equal(dropped().length, 0);
  const over = await rig.tool(READ, { token: "x" });
  assert.deepEqual(over.error, { code: "POLICY_DENIED" });
  assert.equal(capabilityLines(), 60, "the 61st line was not written");
  assert.equal(dropped().length, 1);
  assert.equal(dropped()[0]?.["dropped"], 1);
  await rig.tool(READ, { token: "x" });
  assert.equal(dropped().at(-1)?.["dropped"], 2, "the count runs");
  assert.deepEqual((await rig.attachReply("claude")).error, { code: "POLICY_DENIED" });
  rig.setNowMs(rig.nowMs() + 1000);
  assert.equal((await rig.attachReply("claude")).error, undefined, "one second refills one line");
});

void test("CAPT-06: with the default policy (mode off) a tokenless call is admitted, the attach answers mode off, no keyring is created and no capability line is written", testTimeout(60_000), async (t) => {
  const rig = await startRig(t);
  await rig.up();
  const attach = await rig.attachReply("claude");
  assert.deepEqual(attach.result, { mode: "off" });
  assert.equal((await rig.attachReply("nobody")).error, undefined, "mode off does not even look at the host");
  assert.deepEqual((await rig.attachReply("claude", rig.otherWorkspace)).error, { code: "REALM_NOT_ACTIVE" });

  const read = await rig.tool(READ);
  assert.equal(read.error, undefined);
  const ignored = await rig.tool(READ, { token: "a token the daemon must not look at" });
  assert.equal(ignored.error, undefined, "an incoming token member is ignored and not verified");

  assert.equal(existsSync(keyringPathOf(rig.stateDir)), false);
  const lines = rig.auditLines();
  assert.equal(lines.some((line) => String(line["tool"]).startsWith("capability")), false);
  assert.equal(rig.logLines().some((line) => String(line["event"]).startsWith("capability")), false);
  for (const line of lines.filter((entry) => entry["tool"] === "read")) {
    const known = ["at", "bytes", "correlationId", "outcome", "path", "phase", "prev", "seq", "sessionId", "sha256", "tool", "upId"];
    assert.deepEqual(Object.keys(line).filter((key) => !known.includes(key)), [], "only the 0.4.3 members");
    assert.equal("host" in line, false);
    assert.equal("kid" in line, false);
  }
});
