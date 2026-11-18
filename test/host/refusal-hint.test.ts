// The one-time diagnostic of a refused capability token (Phase 34, D-34-05): two texts, written once per process, on the first
// POLICY_DENIED outcome only, carrying no token, key, path or policy value.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRefusalHint } from "../../src/host/refusal-hint.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";

const denied: ToolOutcome = { outcome: "refused", tool: "status", code: "POLICY_DENIED", retryable: false };
const notActive: ToolOutcome = { outcome: "refused", tool: "status", code: "REALM_NOT_ACTIVE", retryable: true };
// Only the discriminant matters to the hint; the value of a done outcome is never read.
const done = { outcome: "done", tool: "status", value: {} } as unknown as ToolOutcome;

function rig(hostId: "claude" | null): { readonly lines: string[]; readonly observe: (outcome: ToolOutcome) => void } {
  const lines: string[] = [];
  const hint = createRefusalHint(hostId, (text) => {
    lines.push(text);
  });
  return { lines, observe: hint.observe };
}

void test("an unlabelled session names the missing host id, the enforced default, the host flag and the opt-out", () => {
  const { lines, observe } = rig(null);
  observe(denied);
  assert.equal(lines.length, 1);
  const line = lines[0] ?? "";
  assert.ok(line.startsWith("realm: "));
  assert.ok(line.endsWith("\n"));
  assert.equal(line.indexOf("\n"), line.length - 1, "one line");
  assert.ok(line.includes("no host id"));
  assert.ok(line.includes("enforced by default"));
  assert.ok(line.includes("host flag"));
  assert.ok(line.includes("realm host list"));
  assert.ok(line.includes("capabilityTokens.mode to off"));
  assert.ok(line.includes("docs/integration/mcp.md"));
});

void test("a labelled session names the host, the likely causes and realm doctor", () => {
  const { lines, observe } = rig("claude");
  observe(denied);
  assert.equal(lines.length, 1);
  const line = lines[0] ?? "";
  assert.ok(line.startsWith("realm: "));
  assert.ok(line.endsWith("\n"));
  assert.equal(line.indexOf("\n"), line.length - 1, "one line");
  assert.ok(line.includes("claude"));
  assert.ok(line.includes("POLICY_DENIED"));
  assert.ok(line.includes("revoked or rotated"));
  assert.ok(line.includes("expired"));
  assert.ok(line.includes("capabilityTokens.profiles"));
  assert.ok(line.includes("realm doctor"));
});

void test("the line is written once: a second refusal writes nothing", () => {
  const { lines, observe } = rig("claude");
  observe(denied);
  observe(denied);
  observe(denied);
  assert.equal(lines.length, 1);
});

void test("a done outcome and another refusal code write nothing and do not use up the line", () => {
  const { lines, observe } = rig(null);
  observe(done);
  observe(notActive);
  assert.deepEqual(lines, []);
  observe(denied);
  assert.equal(lines.length, 1);
  observe(done);
  observe(notActive);
  assert.equal(lines.length, 1, "later outcomes write nothing, whatever their code");
});

void test("neither text carries a token-shaped string, a path or a key", () => {
  for (const hostId of [null, "claude"] as const) {
    const { lines, observe } = rig(hostId);
    observe(denied);
    const text = lines.join("");
    assert.doesNotMatch(text, /[A-Za-z0-9_-]{32,}/u, "no long token-shaped run");
    assert.doesNotMatch(text, /(^|\s)\/(root|home|tmp|run|var|etc)\b/u, "no absolute path");
    assert.ok(!text.includes("keyring"), "no key file named");
  }
});
