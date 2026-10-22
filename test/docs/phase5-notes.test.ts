import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs from dist/test/docs, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function readIntegrationNote(name: string): string {
  return readFileSync(join(ROOT, "docs", "integration", name), "utf8");
}

// Slice a "### Qn" or "## n." section: from the heading to the next heading
// of the same or higher level, or to end of file.
function sectionOf(text: string, heading: string): string {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `missing heading ${heading}`);
  const tail = text.slice(start + heading.length);
  const next = tail.search(/\n## |\n### /);
  return next === -1 ? text.slice(start) : text.slice(start, start + heading.length + next);
}

test("TOOL-05: mcp.md Q5 records revision 2026-07-28 with the server/discover probe and the initialize handshake", () => {
  const q5 = sectionOf(readIntegrationNote("mcp.md"), "### Q5");
  assert.ok(q5.includes("2026-07-28"), "Q5 must name revision 2026-07-28");
  assert.ok(q5.includes("server/discover"), "Q5 must name the server/discover probe");
  assert.ok(q5.includes("initialize"), "Q5 must name the initialize handshake");
});

test("TOOL-05: mcp.md Q5 introduces no revision string other than 2026-07-28", () => {
  const q5 = sectionOf(readIntegrationNote("mcp.md"), "### Q5");
  const found = q5.match(/20\d\d-\d\d-\d\d/g) ?? [];
  assert.ok(found.length > 0, "Q5 must cite at least one revision string");
  for (const rev of found) {
    assert.equal(rev, "2026-07-28", `unexpected revision string in Q5: ${rev}`);
  }
});

test("TOOL-05: acp.md records protocol generation v1 with the realm/tool Realm extension", () => {
  const text = readIntegrationNote("acp.md");
  assert.ok(text.includes("protocol generation v1"), "must name protocol generation v1");
  assert.ok(text.includes('"protocolVersion": 1'), "must name protocolVersion 1");
  assert.ok(text.includes("clientInfo"), "must name clientInfo");
  assert.ok(text.includes("agentInfo"), "must name agentInfo");
  assert.ok(text.includes("realm/tool"), "must name the realm/tool method");
  assert.ok(text.includes("Realm extension"), "must mark realm/tool as a Realm extension");
  assert.ok(text.includes("not standard ACP"), "must mark realm/tool as not standard ACP");
});

test("TOOL-05: anda.md and anda-decision.md record that Anda consumes Realm over MCP", () => {
  const anda = readIntegrationNote("anda.md");
  const decision = readIntegrationNote("anda-decision.md");
  assert.ok(anda.includes("Anda consumes Realm over MCP"), "anda.md must record the MCP-consumption path");
  assert.ok(decision.includes("Anda consumes Realm over MCP"), "anda-decision.md must record the MCP-consumption path");
  assert.ok(decision.includes("docs/integration/mcp.md"), "anda-decision.md must cite the mcp.md Q5 evidence");
});

test("OMP-01: omp.md Q1 names the verified manifest field and carries a source URL plus read date", () => {
  const q1 = sectionOf(readIntegrationNote("omp.md"), "### Q1");
  assert.ok(q1.includes('"omp": { "extensions": ["./src/index.ts"] }'), "Q1 must name the omp.extensions field");
  assert.ok(q1.includes("pi.extensions"), "Q1 must name the compatible pi.extensions field");
  assert.ok(q1.includes("pi.registerCommand"), "Q1 must name the verified registerCommand call");
  assert.ok(q1.includes("https://omp.sh/docs/extension-authoring"), "Q1 must cite the official URL");
  assert.ok(q1.includes("2026-10-22"), "Q1 must carry the Phase 5 read date");
});

test("OMP-01: omp.md Q2 names the verified lifecycle calls and carries a source URL plus read date", () => {
  const q2 = sectionOf(readIntegrationNote("omp.md"), "### Q2");
  assert.ok(q2.includes("pi.on(event, handler)"), "Q2 must name the verified event registration call");
  assert.ok(q2.includes("session_start"), "Q2 must name session_start");
  assert.ok(q2.includes("session_shutdown"), "Q2 must name session_shutdown");
  assert.ok(q2.includes("extensionHandlers.toolCallTimeoutMs"), "Q2 must name the verified timeout setting");
  assert.ok(q2.includes("ctx.setInterval"), "Q2 must name the verified managed timer call");
  assert.ok(q2.includes("ctx.clearTimer"), "Q2 must name the verified timer clearing call");
  assert.ok(q2.includes("https://omp.sh/docs/hooks"), "Q2 must cite the official URL");
  assert.ok(q2.includes("2026-10-22"), "Q2 must carry the Phase 5 read date");
});

test("OMP-01: omp.md Q3 names the status surface and marks the signature limit with a source URL plus read date", () => {
  const q3 = sectionOf(readIntegrationNote("omp.md"), "### Q3");
  assert.ok(q3.includes("ctx.ui.setStatus(key, text)"), "Q3 must name the key-plus-text signature");
  assert.ok(q3.includes("not documented"), "Q3 must mark the missing endpoint as not documented");
  assert.ok(q3.includes("https://omp.sh/docs/extension-authoring"), "Q3 must cite the official URL");
  assert.ok(q3.includes("2026-10-22"), "Q3 must carry the Phase 5 read date");
});

test("OMP-01: omp.md Q4 stays OPEN with the enforcement gap marked not documented", () => {
  const q4 = sectionOf(readIntegrationNote("omp.md"), "### Q4");
  assert.ok(q4.includes("setActiveTools"), "Q4 must name setActiveTools");
  assert.ok(q4.includes("tool_call"), "Q4 must name the tool_call hook");
  assert.ok(q4.includes("OPEN"), "Q4 must carry the OPEN status forward");
  assert.ok(q4.includes("not documented"), "Q4 must mark enforcement as not documented");
  assert.ok(q4.includes("2026-10-22"), "Q4 must carry the Phase 5 read date");
});
