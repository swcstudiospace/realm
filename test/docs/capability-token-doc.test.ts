// CAPT-09: the honesty statements and the tables of the capability-token documentation are pinned. The first paragraph of the Q10
// section of docs/integration/mcp.md states the same-user limit before anything else; its policy table equals the schema (defaults,
// bounds, host ids and capability names); its mapping table equals requiredCapability; D32-1 exists with the override date; section 9
// of the spike note exists and sections 1 to 8 are byte-identical to the text Phase 30 left; AGENTS.md carries the bullet; and no
// file among these holds a host path. Reads files only; no process starts and no network is used.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { requiredCapability } from "../../src/capability/admit.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FILES = {
  mcp: "docs/integration/mcp.md",
  contract: "docs/integration/host-plugin-contract.md",
  decision: "docs/integration/runtime-decision.md",
  spike: "docs/integration/capability-token-spike.md",
  agents: "AGENTS.md",
} as const;

// The SHA-256 of sections 1 to 8 of the spike note as Phase 30 left them, computed before plan 32-03 appended section 9.
const SPIKE_SECTIONS_1_TO_8_SHA256 = "17a35c83807feb68491dacc0611087c6b26c5563e0423714792f757aa7273243";

const POLICY_HEADER = "| Member | Values | Default |";
const MAPPING_HEADER = "| Tool call | Capability needed |";

// The same patterns scripts/check/host-paths.mjs scans for.
const HOST_PATHS: readonly RegExp[] = [/\/root\/[A-Za-z0-9._-]+/, /\/tmp\/[A-Za-z0-9._-]+/, /\/Users\/[A-Za-z0-9._-]+/, /\/home\/[A-Za-z0-9._-]+/];

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

// The table whose header row is exactly `header`, present once: the header row, the delimiter row and every row after them.
function tableOf(text: string, header: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(header);
  assert.ok(at >= 0, `${header} is in the section`);
  assert.equal(lines.indexOf(header, at + 1), -1, `${header} appears once`);
  const rows: string[] = [];
  for (const line of lines.slice(at)) {
    if (!line.startsWith("|")) {
      break;
    }
    rows.push(line);
  }
  return rows.join("\n");
}

function cellsOf(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function rowsOf(block: string): string[][] {
  return block
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map(cellsOf);
}

// Every backticked token of a cell.
function codeItems(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
}

// The Q10 section: from its heading to the next heading of the same or a higher level.
function q10Section(): string {
  const text = read(FILES.mcp);
  const start = text.indexOf("### Q10. Capability tokens");
  assert.ok(start >= 0, "mcp.md has the Q10 section");
  const rest = text.slice(start + 1);
  const next = rest.search(/\n#{1,3} /);
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next);
}

function strings(value: unknown): string[] {
  assert.ok(Array.isArray(value), "an array");
  return value.map((item: unknown) => {
    assert.equal(typeof item, "string");
    return String(item);
  });
}

function record(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), "a JSON object");
  return Object.fromEntries(Object.entries(value));
}

function schemaMembers(): Record<string, unknown> {
  const schema = record(JSON.parse(read("src/core/policy.schema.json")) as unknown);
  const tokens = record(record(schema["properties"])["capabilityTokens"]);
  return record(tokens["properties"]);
}

void test("CAPT-09: Q10 comes after Q9, before the closing sections, and its first paragraph states the same-user limit", () => {
  const text = read(FILES.mcp);
  assert.ok(text.indexOf("### Q9.") < text.indexOf("### Q10."), "Q10 follows Q9");
  assert.ok(text.indexOf("### Q10.") < text.indexOf("## Blocked module"), "Q10 precedes the closing sections");
  const section = q10Section();
  const [heading, , first] = section.split("\n");
  assert.equal(heading, "### Q10. Capability tokens");
  assert.ok(first !== undefined, "a first paragraph follows the heading");
  assert.ok(
    first.includes("a process of the same user that can read the token or the key file is not stopped"),
    "the first paragraph says a same-user reader is not stopped",
  );
  assert.ok(first.includes("a model with a native shell in its host is such a process"), "the first paragraph names the shell model");
  assert.ok(first.includes("not an authentication of the host"), "the first paragraph says the token is not an authentication");
  assert.ok(first.includes("signed label"), "the first paragraph calls the token a signed label");
});

void test("CAPT-09: the Q10 policy table equals the schema: defaults, bounds, host ids and capability names", () => {
  const members = schemaMembers();
  const mode = record(members["mode"]);
  const ttl = record(members["ttlSeconds"]);
  const profiles = record(members["profiles"]);
  const hosts = strings(record(profiles["propertyNames"])["enum"]);
  const capabilities = strings(record(record(profiles["additionalProperties"])["items"])["enum"]);

  const rows = rowsOf(tableOf(q10Section(), POLICY_HEADER));
  const byMember = new Map(rows.map((row) => [(row[0] ?? "").replaceAll("`", ""), row]));
  assert.deepEqual([...byMember.keys()], ["mode", "ttlSeconds", "profiles", "profiles keys", "profiles values"]);

  const modeRow = byMember.get("mode") ?? [];
  assert.deepEqual(codeItems(modeRow[1] ?? "").sort(), [...strings(mode["enum"])].sort());
  assert.deepEqual(codeItems(modeRow[2] ?? ""), [String(mode["default"])]);

  const ttlRow = byMember.get("ttlSeconds") ?? [];
  assert.deepEqual(codeItems(ttlRow[1] ?? ""), [String(ttl["minimum"]), String(ttl["maximum"])]);
  assert.deepEqual(codeItems(ttlRow[2] ?? ""), [String(ttl["default"])]);

  const profilesRow = byMember.get("profiles") ?? [];
  assert.deepEqual(codeItems(profilesRow[2] ?? ""), [JSON.stringify(profiles["default"])]);

  assert.deepEqual(codeItems((byMember.get("profiles keys") ?? [])[1] ?? "").sort(), [...hosts].sort());
  assert.deepEqual(codeItems((byMember.get("profiles values") ?? [])[1] ?? "").sort(), [...capabilities].sort());
  assert.equal(hosts.length, 19);
  assert.equal(capabilities.length, 6);
});

void test("CAPT-09: the Q10 mapping table equals requiredCapability for all six tools and both exec forms", () => {
  const calls: Readonly<Record<string, unknown>> = {
    "`read`": { read: {} },
    "`list`": { list: {} },
    "`write`": { write: {} },
    "`exec`, argv form": { exec: { argv: [] } },
    "`exec`, shell form (`shell` is `true`)": { exec: { shell: true } },
    "`retry`": { retry: {} },
    "`status`": { status: {} },
  };
  const rows = rowsOf(tableOf(q10Section(), MAPPING_HEADER));
  assert.deepEqual(
    rows.map((row) => row[0]),
    Object.keys(calls),
  );
  for (const row of rows) {
    const call = row[0] ?? "";
    const expected = requiredCapability(calls[call]);
    const cell = row[1] ?? "";
    if (expected === "none") {
      assert.ok(cell.startsWith("none"), `${call}: ${cell}`);
    } else {
      assert.equal(cell, `\`${expected}\``, call);
    }
  }
});

void test("CAPT-09: D32-1 exists in the runtime decision note with the override date and the accepted residuals", () => {
  const text = read(FILES.decision);
  const line = text.split("\n").find((candidate) => candidate.startsWith("**D32-1 (2026-11-17)."));
  assert.ok(line !== undefined, "D32-1 with the override date");
  assert.ok(line.includes("Owner directed") || line.includes("owner directed"), "D32-1 is owner directed");
  assert.ok(line.includes("DROP") && line.includes("M1 was not demonstrated"), "D32-1 keeps the Phase 30 outcome");
  assert.ok(text.includes("R-32-01: a process of the same user that can read the token"), "the same-user residual is recorded");
  assert.ok(text.includes("**Deferred.**"), "the deferred items are recorded");
  assert.ok(text.includes("D30-1 (2026-11-17)."), "D30-1 is still there");
});

void test("CAPT-09: the spike note has section 9, and sections 1 to 8 are byte-identical to what Phase 30 left", () => {
  const text = read(FILES.spike);
  const start = text.indexOf("\n## 9. Outcome after the owner override");
  assert.ok(start >= 0, "section 9 exists");
  const hash = createHash("sha256").update(text.slice(0, start)).digest("hex");
  assert.equal(hash, SPIKE_SECTIONS_1_TO_8_SHA256, "sections 1 to 8 changed");
  const section = text.slice(start);
  assert.ok(section.includes("2026-11-17") && section.includes("DROP") && section.includes("D32-1"), "section 9 records the override and points at D32-1");
  assert.ok(section.includes("Q10"), "section 9 points at the Q10 section");
});

void test("CAPT-09: AGENTS.md carries the capability-token bullet and the layout line, and the contract doc points at Q10", () => {
  const agents = read(FILES.agents);
  const bullet = agents.split("\n").find((line) => line.startsWith("- With `capabilityTokens.mode` set to `enforce`"));
  assert.ok(bullet !== undefined, "the control-socket neighbour bullet exists");
  assert.ok(bullet.includes("does not stop a process of the same user"), bullet);
  assert.ok(agents.includes("`capability/`: capability tokens for stdio hosts"), "the layout names src/capability");
  const contract = read(FILES.contract);
  assert.ok(contract.includes("## Capability tokens"), "the contract doc has the section");
  assert.ok(contract.includes("`realm host token status`") && contract.includes("`realm host token rotate [--revoke-previous]`"), "the two rows");
  assert.ok(contract.includes("docs/integration/mcp.md"), "the contract doc points at mcp.md");
});

void test("CAPT-09: none of the five files holds a host path", () => {
  for (const [name, path] of Object.entries(FILES)) {
    const text = read(path);
    for (const pattern of HOST_PATHS) {
      assert.ok(!pattern.test(text), `${name}: matches ${String(pattern)}`);
    }
  }
});
