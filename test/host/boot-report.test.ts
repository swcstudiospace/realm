import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import {
  BOOT_REPORT_HOSTS,
  HOST_BOOT_PHASES,
  HOST_BOOT_TRANSPORTS,
  isBootPhase,
  isBootReportHost,
  isBootTransport,
  parseHostBootReport,
} from "../../src/host/boot-report.js";
import { HOST_IDS } from "../../src/host/types.js";

const CODED: readonly string[] = ["refused", "failed", "link-lost"];

function report(over: Record<string, unknown> = {}): Record<string, unknown> {
  const phase = typeof over["phase"] === "string" ? over["phase"] : "attached";
  return {
    schemaVersion: 1,
    bootId: "boot-0123456789abcdef",
    hostId: "claude",
    transport: "mcp",
    phase: "attached",
    code: CODED.includes(phase) ? "POLICY_DENIED" : null,
    attempt: 1,
    durationMs: 120,
    state: "active",
    ...over,
  };
}

function without(key: string): Record<string, unknown> {
  const copy = report();
  Reflect.deleteProperty(copy, key);
  return copy;
}

function assertRefused(input: unknown, label: string): void {
  assert.throws(
    () => parseHostBootReport(input),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
    label,
  );
}

void test("BOOT-06: the vocabulary lists are the documented closed sets", () => {
  assert.deepEqual([...HOST_BOOT_PHASES], ["attached", "refused", "failed", "link-lost", "reattached", "closed"]);
  assert.deepEqual([...HOST_BOOT_TRANSPORTS], ["extension", "mcp", "acp"]);
  assert.deepEqual([...BOOT_REPORT_HOSTS], [...HOST_IDS, "unlabelled"]);
  assert.equal(BOOT_REPORT_HOSTS.length, 23);
  assert.equal(isBootPhase("attached"), true);
  assert.equal(isBootPhase("nope"), false);
  assert.equal(isBootPhase(1), false);
  assert.equal(isBootTransport("acp"), true);
  assert.equal(isBootTransport("stdio"), false);
  assert.equal(isBootReportHost("unlabelled"), true);
  assert.equal(isBootReportHost("alias"), false);
});

void test("BOOT-06: every phase is accepted for each host and transport pairing", () => {
  const pairings: readonly (readonly [string, string])[] = [
    ["omp", "extension"],
    ["claude", "mcp"],
    ["claude", "acp"],
    ["unlabelled", "mcp"],
    ["unlabelled", "acp"],
  ];
  for (const [hostId, transport] of pairings) {
    for (const phase of HOST_BOOT_PHASES) {
      const parsed = parseHostBootReport(report({ hostId, transport, phase }));
      assert.equal(parsed.hostId, hostId);
      assert.equal(parsed.transport, transport);
      assert.equal(parsed.phase, phase);
      assert.equal(parsed.code === null, !CODED.includes(phase));
    }
  }
  for (const hostId of HOST_IDS) {
    parseHostBootReport(report({ hostId, transport: hostId === "omp" ? "extension" : "mcp" }));
  }
});

void test("BOOT-06: the parsed report is a frozen copy and the largest one stays under 512 bytes", () => {
  const input = report();
  const parsed = parseHostBootReport(input);
  assert.notEqual(parsed, input);
  assert.equal(Object.isFrozen(parsed), true);
  const largest = parseHostBootReport(
    report({
      bootId: "b".repeat(64),
      hostId: "kimi-code",
      transport: "acp",
      phase: "link-lost",
      code: "OPENSHELL_GATEWAY_LOST",
      attempt: 9,
      durationMs: 600_000,
      state: "connecting",
    }),
  );
  assert.ok(JSON.stringify(largest).length < 512);
  const nulls = parseHostBootReport(report({ state: null, durationMs: 0 }));
  assert.equal(nulls.state, null);
  assert.equal(nulls.durationMs, 0);
});

void test("BOOT-06: every violated rule is SCHEMA_INVALID", () => {
  const rows: readonly (readonly [string, unknown])[] = [
    ["null", null],
    ["undefined", undefined],
    ["array", []],
    ["string", "report"],
    ["number", 7],
    ["class instance", new Map()],
    ["schemaVersion 2", report({ schemaVersion: 2 })],
    ["schemaVersion string", report({ schemaVersion: "1" })],
    ["missing schemaVersion", without("schemaVersion")],
    ["missing bootId", without("bootId")],
    ["missing state", without("state")],
    ["missing code", without("code")],
    ["extra key", report({ extra: 1 })],
    ["__proto__ key", JSON.parse('{"__proto__":{"x":1}}') as unknown],
    ["bootId empty", report({ bootId: "" })],
    ["bootId 65 characters", report({ bootId: "x".repeat(65) })],
    ["bootId with a space", report({ bootId: "boot id" })],
    ["bootId with a slash", report({ bootId: "../etc" })],
    ["bootId number", report({ bootId: 7 })],
    ["hostId alias", report({ hostId: "alias" })],
    ["hostId gemini", report({ hostId: "gemini" })],
    ["hostId number", report({ hostId: 1 })],
    ["omp with mcp", report({ hostId: "omp", transport: "mcp" })],
    ["omp with acp", report({ hostId: "omp", transport: "acp" })],
    ["claude with extension", report({ hostId: "claude", transport: "extension" })],
    ["unlabelled with extension", report({ hostId: "unlabelled", transport: "extension" })],
    ["transport stdio", report({ transport: "stdio" })],
    ["phase unknown", report({ phase: "nope" })],
    ["phase number", report({ phase: 1 })],
    ["code set on attached", report({ phase: "attached", code: "POLICY_DENIED" })],
    ["code set on reattached", report({ phase: "reattached", code: "POLICY_DENIED" })],
    ["code set on closed", report({ phase: "closed", code: "POLICY_DENIED" })],
    ["code null on failed", report({ phase: "failed", code: null })],
    ["code null on refused", report({ phase: "refused", code: null })],
    ["code null on link-lost", report({ phase: "link-lost", code: null })],
    ["code outside the catalogue", report({ phase: "failed", code: "NOPE" })],
    ["code number", report({ phase: "failed", code: 7 })],
    ["attempt 0", report({ attempt: 0 })],
    ["attempt 10", report({ attempt: 10 })],
    ["attempt 1.5", report({ attempt: 1.5 })],
    ["attempt NaN", report({ attempt: Number.NaN })],
    ["attempt string", report({ attempt: "1" })],
    ["durationMs -1", report({ durationMs: -1 })],
    ["durationMs 600001", report({ durationMs: 600_001 })],
    ["durationMs 1.5", report({ durationMs: 1.5 })],
    ["durationMs Infinity", report({ durationMs: Number.POSITIVE_INFINITY })],
    ["state outside the machine", report({ state: "nope" })],
    ["state number", report({ state: 1 })],
    ["state undefined", report({ state: undefined })],
  ];
  for (const [label, input] of rows) {
    assertRefused(input, label);
  }
});

void test("BOOT-06: an accessor, a symbol key and a prototype-carrying object are refused", () => {
  const accessor = report();
  Object.defineProperty(accessor, "hostId", { get: () => "claude", enumerable: true });
  assertRefused(accessor, "accessor");
  const symbol = report();
  Object.defineProperty(symbol, Symbol("extra"), { value: 1, enumerable: true });
  assertRefused(symbol, "symbol key");
  const inherited = Object.create(report()) as unknown;
  assertRefused(inherited, "inherited fields");
  const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, report());
  assert.equal(parseHostBootReport(nullPrototype).hostId, "claude");
});

void test("BOOT-06: a refusal never echoes the offending input", () => {
  // Constructed at runtime so the source carries no token-shaped literal (SEC-369e6581); the parsed input still holds a
  // token-shaped value, which is what the refusal-echo check below needs.
  const secret = `ghp_${"x".repeat(36)}`;
  for (const over of [{ bootId: `${secret} ${secret}` }, { hostId: secret }, { phase: secret }, { transport: secret }, { state: secret }]) {
    try {
      parseHostBootReport(report(over));
      assert.fail("expected a refusal");
    } catch (error: unknown) {
      assert.ok(error instanceof RealmError);
      assert.equal(error.code, "SCHEMA_INVALID");
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.reason.includes(secret), false);
    }
  }
});
