import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AuditEntryInput } from "../../src/audit/log.js";
import { createCapabilityGate } from "../../src/capability/gate.js";
import { keyringPathOf, readKeyring, rotateKeyring } from "../../src/capability/keyring.js";
import { TOKEN_CAPABILITIES, verifyToken } from "../../src/capability/token.js";
import { validate, type Policy } from "../../src/contract/validate.js";
import { RealmError } from "../../src/core/errors.js";
import { createLogger } from "../../src/observe/logger.js";

// The gate in isolation (CAPT-06, CAPT-07): attach, check, the audit bound and the keyring reload, with an injected
// clock, an injected audit append and a captured log. The wire matrix drives the same gate over a real socket.

type Gate = NonNullable<ReturnType<typeof createCapabilityGate>>;

const SESSION = "p0123456789ab";
const START_MS = 1_700_000_000_000;

function policyOf(capabilityTokens: unknown): Policy {
  const parsed = validate("policy", { workspaceRoots: ["/tmp"], ...(capabilityTokens === undefined ? {} : { capabilityTokens }) });
  assert.ok(parsed.ok);
  return parsed.value;
}

interface Rig {
  readonly gate: Gate;
  readonly stateDir: string;
  readonly audit: AuditEntryInput[];
  readonly logs: () => Record<string, unknown>[];
  readonly clock: { ms: number };
}

function rig(t: TestContext, capabilityTokens: unknown, failAudit = false, prepare?: (stateDir: string) => void): Rig {
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "realm-gate-")));
  t.after(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });
  prepare?.(stateDir);
  const audit: AuditEntryInput[] = [];
  const raw: string[] = [];
  const clock = { ms: START_MS };
  const logger = createLogger({
    sink: {
      write: (line) => {
        raw.push(line);
        return true;
      },
    },
    level: "debug",
    now: () => new Date(clock.ms),
  });
  const gate = createCapabilityGate({
    stateDir,
    policy: policyOf(capabilityTokens),
    now: () => clock.ms,
    logger,
    appendAudit: (_dir, entry) => {
      if (failAudit) {
        throw new RealmError("AUDIT_WRITE_FAILED");
      }
      audit.push(entry);
    },
  });
  assert.ok(gate !== undefined);
  const logs = (): Record<string, unknown>[] => raw.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { gate, stateDir, audit, logs, clock };
}

function deniedWith(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

const ENFORCE = { mode: "enforce", profiles: { cursor: ["fs.read", "fs.list"] } };

void test("CAPT-06: with the mode off no gate is built", (t) => {
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "realm-gate-")));
  t.after(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });
  const options = { stateDir, now: () => START_MS, logger: createLogger({ sink: { write: () => true }, level: "debug", now: () => new Date() }) };
  assert.equal(createCapabilityGate({ ...options, policy: policyOf({ mode: "off" }) }), undefined);
  assert.equal(existsSync(keyringPathOf(stateDir)), false);
});

void test("CAPT-06: attach creates the keyring, mints a token that verifies, writes its audit line and logs no token", (t) => {
  const r = rig(t, ENFORCE);
  const { token, expiresAt } = r.gate.attach({ sessionId: SESSION, host: "cursor" });
  assert.equal(expiresAt, START_MS / 1000 + 3600);
  const keyring = readKeyring(r.stateDir);
  assert.ok(keyring.present);
  const verdict = verifyToken(token, keyring.snapshot.lookup, SESSION, "fs.read", START_MS / 1000);
  assert.ok(verdict.ok);
  assert.equal(verdict.claims.host, "cursor");
  assert.equal(verdict.claims.kid, "k1");
  assert.deepEqual(verdict.claims.caps, ["fs.list", "fs.read"]);
  assert.deepEqual(r.audit, [{ sessionId: SESSION, tool: "capability.attach", outcome: "ok", host: "cursor", kid: "k1" }]);
  const attached = r.logs().filter((line) => line["event"] === "capability.attached");
  assert.equal(attached.length, 1);
  assert.equal(attached[0]?.["host"], "cursor");
  assert.equal(attached[0]["kid"], "k1");
  assert.equal(JSON.stringify(r.logs()).includes(token), false);
});

void test("CAPT-06: a host with no profile entry gets all six capabilities, and an empty profile gets none", (t) => {
  const r = rig(t, { mode: "enforce", profiles: { codex: [] } });
  const keyring = r.gate.attach({ sessionId: SESSION, host: "claude" });
  const lookup = readKeyring(r.stateDir);
  assert.ok(lookup.present);
  for (const capability of TOKEN_CAPABILITIES) {
    assert.ok(verifyToken(keyring.token, lookup.snapshot.lookup, SESSION, capability, START_MS / 1000).ok, capability);
  }
  const empty = r.gate.attach({ sessionId: SESSION, host: "codex" });
  assert.ok(verifyToken(empty.token, lookup.snapshot.lookup, SESSION, null, START_MS / 1000).ok);
  assert.equal(verifyToken(empty.token, lookup.snapshot.lookup, SESSION, "fs.read", START_MS / 1000).ok, false);
});

void test("CAPT-06: attach refuses a host outside HOST_IDS with POLICY_DENIED and writes nothing", (t) => {
  const r = rig(t, ENFORCE);
  for (const host of ["nobody", "Claude", "", "claude ", "omp2"]) {
    deniedWith(() => r.gate.attach({ sessionId: SESSION, host }), "POLICY_DENIED");
  }
  assert.deepEqual(r.audit, []);
  assert.equal(readKeyring(r.stateDir).present, true, "the keyring was created at construction, not by the refused host");
});

void test("CAPT-07: an attach whose audit line cannot be written is AUDIT_WRITE_FAILED and returns no token", (t) => {
  const r = rig(t, ENFORCE, true);
  deniedWith(() => r.gate.attach({ sessionId: SESSION, host: "cursor" }), "AUDIT_WRITE_FAILED");
  assert.equal(r.logs().some((line) => line["event"] === "capability.attached"), false);
});

void test("CAPT-07: the 61st attach in the same millisecond is POLICY_DENIED, and the bound refills with the clock", (t) => {
  const r = rig(t, ENFORCE);
  for (let index = 0; index < 60; index += 1) {
    r.gate.attach({ sessionId: SESSION, host: "claude" });
  }
  deniedWith(() => r.gate.attach({ sessionId: SESSION, host: "claude" }), "POLICY_DENIED");
  assert.equal(r.audit.length, 60);
  assert.equal(r.logs().some((line) => line["event"] === "capability.audit_dropped"), true);
  r.clock.ms += 1000;
  r.gate.attach({ sessionId: SESSION, host: "claude" });
  assert.equal(r.audit.length, 61);
});

void test("CAPT-06: check admits a token that grants the call and names the verified principal", (t) => {
  const r = rig(t, ENFORCE);
  const { token } = r.gate.attach({ sessionId: SESSION, host: "cursor" });
  const read = r.gate.check({ tool: { read: { path: "a" } }, token, sessionId: SESSION });
  assert.deepEqual(read, { ok: true, principal: { host: "cursor", kid: "k1" } });
  const status = r.gate.check({ tool: { status: {} }, token, sessionId: SESSION });
  assert.equal(status.ok, true);
  // An unmapped or malformed call needs no capability: a valid token is enough for the check, the dispatcher refuses it.
  assert.equal(r.gate.check({ tool: { nothing: {} }, token, sessionId: SESSION }).ok, true);
  assert.equal(r.gate.check({ tool: 7, token, sessionId: SESSION }).ok, true);
  // Admission writes no capability line.
  assert.equal(r.audit.length, 1);
});

void test("CAPT-06: check refuses a missing capability, another session and a missing token, with the internal class in the log only", (t) => {
  const r = rig(t, ENFORCE);
  const { token } = r.gate.attach({ sessionId: SESSION, host: "cursor" });
  r.audit.length = 0;
  const cases: readonly { readonly name: string; readonly input: { tool: unknown; token: unknown; sessionId: string }; readonly refusal: string; readonly tool: string; readonly authentic: boolean }[] = [
    { name: "write without fs.write", input: { tool: { write: { path: "a", content: "b" } }, token, sessionId: SESSION }, refusal: "capability-not-granted", tool: "write", authentic: true },
    { name: "shell exec", input: { tool: { exec: { shell: true, script: "id" } }, token, sessionId: SESSION }, refusal: "capability-not-granted", tool: "exec", authentic: true },
    { name: "retry", input: { tool: { retry: {} }, token, sessionId: SESSION }, refusal: "capability-not-granted", tool: "retry", authentic: true },
    { name: "other session", input: { tool: { read: { path: "a" } }, token, sessionId: "p999999999999" }, refusal: "wrong-session", tool: "read", authentic: true },
    { name: "no token", input: { tool: { read: { path: "a" } }, token: undefined, sessionId: SESSION }, refusal: "format", tool: "read", authentic: false },
    { name: "garbage tool", input: { tool: "write", token: "nope", sessionId: SESSION }, refusal: "format", tool: "unknown", authentic: false },
  ];
  for (const row of cases) {
    r.audit.length = 0;
    const verdict = r.gate.check(row.input);
    assert.deepEqual(verdict, { ok: false, tool: row.tool }, row.name);
    assert.equal(r.audit.length, 1, row.name);
    const line = r.audit[0];
    assert.equal(line?.tool, row.tool);
    assert.equal(line.outcome, "POLICY_DENIED");
    assert.equal("phase" in line, false);
    assert.equal(line.host, row.authentic ? "cursor" : undefined, row.name);
    assert.equal(line.kid, row.authentic ? "k1" : undefined, row.name);
    const refused = r.logs().filter((entry) => entry["event"] === "capability.refused").at(-1);
    assert.equal(refused?.["refusal"], row.refusal, row.name);
    assert.equal(refused["tool"], row.tool);
    assert.equal(refused["sessionId"], row.input.sessionId);
  }
  assert.equal(JSON.stringify(r.logs()).includes(token), false);
});

void test("CAPT-06: with the keyring file removed after construction check refuses every call and creates nothing", (t) => {
  const r = rig(t, ENFORCE);
  rmSync(keyringPathOf(r.stateDir));
  const verdict = r.gate.check({ tool: { status: {} }, token: "rcap1.a.b", sessionId: SESSION });
  assert.deepEqual(verdict, { ok: false, tool: "status" });
  assert.equal(existsSync(keyringPathOf(r.stateDir)), false, "the verify path never creates the keyring");
  assert.equal(r.logs().filter((entry) => entry["event"] === "capability.refused").at(-1)?.["refusal"], "keyring");
});

void test("D34-1: the gate creates the keyring when it is built, logs capability.keyring_ready with the kid only, and the files have the safe modes", (t) => {
  const r = rig(t, undefined);
  const path = keyringPathOf(r.stateDir);
  assert.ok(existsSync(path), "the keyring exists before any attach");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(path)).mode & 0o777, 0o700);
  const ready = r.logs().filter((line) => line["event"] === "capability.keyring_ready");
  assert.equal(ready.length, 1);
  assert.equal(ready[0]?.["kid"], "k1");
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as { keys: { key: string }[] };
  const logged = JSON.stringify(r.logs());
  for (const entry of parsed.keys) {
    assert.equal(logged.includes(entry.key), false, "no log line carries key material");
  }
  assert.equal(r.logs().some((line) => line["event"] === "capability.keyring_unavailable"), false);
});

void test("D34-1: two gates built on one state directory leave one keyring with one active key", (t) => {
  const first = rig(t, undefined);
  const logger = createLogger({ sink: { write: () => true }, level: "debug", now: () => new Date(START_MS) });
  const second = createCapabilityGate({ stateDir: first.stateDir, policy: policyOf(undefined), now: () => START_MS, logger });
  assert.ok(second !== undefined);
  const keyring = readKeyring(first.stateDir);
  assert.ok(keyring.present);
  assert.equal(keyring.snapshot.active, "k1");
  const stored = JSON.parse(readFileSync(keyringPathOf(first.stateDir), "utf8")) as { keys: unknown[] };
  assert.equal(stored.keys.length, 1);
  const { token } = second.attach({ sessionId: SESSION, host: "claude" });
  assert.equal(first.gate.check({ tool: { status: {} }, token, sessionId: SESSION }).ok, true, "both gates share one key");
});

void test("D34-1: a keyring that cannot be created is logged at error level with no detail, the gate is still returned, and every attach and check is refused", (t) => {
  const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), "realm-gate-target-")));
  t.after(() => {
    rmSync(elsewhere, { recursive: true, force: true });
  });
  const r = rig(t, undefined, false, (stateDir) => {
    mkdirSync(join(elsewhere, "real"), { mode: 0o700 });
    symlinkSync(join(elsewhere, "real"), join(stateDir, "capability"));
  });
  const unavailable = r.logs().filter((line) => line["event"] === "capability.keyring_unavailable");
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0]?.["level"], "error");
  assert.deepEqual(Object.keys(unavailable[0]).filter((key) => !["ts", "level", "event"].includes(key)), []);
  assert.equal(r.logs().some((line) => line["event"] === "capability.keyring_ready"), false);
  deniedWith(() => r.gate.attach({ sessionId: SESSION, host: "claude" }), "POLICY_DENIED");
  assert.deepEqual(r.gate.check({ tool: { status: {} }, token: "rcap1.a.b", sessionId: SESSION }), { ok: false, tool: "status" });
  assert.equal(r.audit.some((entry) => entry.tool === "capability.attach"), false, "no token was minted, so no attach line");
});

void test("D34-1: with the keyring removed after construction a check refuses and the next attach re-creates it and mints", (t) => {
  const r = rig(t, undefined);
  rmSync(keyringPathOf(r.stateDir));
  assert.equal(r.gate.check({ tool: { status: {} }, token: "rcap1.a.b", sessionId: SESSION }).ok, false);
  assert.equal(existsSync(keyringPathOf(r.stateDir)), false, "the verify path does not create the file");
  const { token } = r.gate.attach({ sessionId: SESSION, host: "claude" });
  assert.ok(existsSync(keyringPathOf(r.stateDir)));
  assert.equal(r.gate.check({ tool: { status: {} }, token, sessionId: SESSION }).ok, true);
});

void test("CAPT-06: a rotation is noticed on the next request, and a revoke refuses the old token at once", (t) => {
  const r = rig(t, ENFORCE);
  const { token } = r.gate.attach({ sessionId: SESSION, host: "cursor" });
  const call = { tool: { read: { path: "a" } }, token, sessionId: SESSION };
  rotateKeyring(r.stateDir, { revokePrevious: false }, { now: () => Math.floor(r.clock.ms / 1000) });
  assert.equal(r.gate.check(call).ok, true, "a planned rotation keeps the old key verifying");
  const fresh = r.gate.attach({ sessionId: SESSION, host: "cursor" });
  assert.equal(r.gate.check({ ...call, token: fresh.token }).ok, true);
  rotateKeyring(r.stateDir, { revokePrevious: true }, { now: () => Math.floor(r.clock.ms / 1000) });
  assert.equal(r.gate.check(call).ok, false);
  assert.equal(r.logs().filter((entry) => entry["event"] === "capability.refused").at(-1)?.["refusal"], "unknown-kid");
  assert.equal(r.gate.check({ ...call, token: fresh.token }).ok, false);
});

void test("CAPT-07: after the bound is spent a refusal is still answered, writes no line and logs the running dropped count", (t) => {
  const r = rig(t, ENFORCE);
  r.gate.attach({ sessionId: SESSION, host: "cursor" });
  r.audit.length = 0;
  let refused = 0;
  for (let index = 0; index < 70; index += 1) {
    if (!r.gate.check({ tool: { read: { path: "a" } }, token: undefined, sessionId: SESSION }).ok) {
      refused += 1;
    }
  }
  assert.equal(refused, 70, "the refusal itself is never bound");
  assert.equal(r.audit.length, 59, "the attach used one line of the bucket of 60");
  const dropped = r.logs().filter((entry) => entry["event"] === "capability.audit_dropped");
  assert.equal(dropped.length, 11);
  assert.equal(dropped.at(-1)?.["dropped"], 11);
});

void test("CAPT-06: check never throws, whatever its input", (t) => {
  const r = rig(t, ENFORCE);
  r.gate.attach({ sessionId: SESSION, host: "cursor" });
  const inputs: readonly unknown[] = [undefined, null, 0, "x", [], {}, { read: 1, write: 2 }, Object.create(null) as object];
  for (const tool of inputs) {
    for (const token of inputs) {
      assert.equal(r.gate.check({ tool, token, sessionId: SESSION }).ok, false);
    }
  }
});
