import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs from dist/test/anda, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NOTE_PATH = join(ROOT, "docs", "integration", "anda-decision.md");

function readNote(): string {
  return readFileSync(NOTE_PATH, "utf8");
}

void test("ANDA-01: decision note records the HTTP boundary (S-12): a TypeScript client over the Anda Engine HTTP API", () => {
  const text = readNote();
  assert.match(text, /S-12/);
  assert.match(text, /TypeScript client/);
  assert.match(text, /Anda Engine HTTP API/);
  assert.match(text, /Not used: `POST \/\{id\}`[^\n]*deferred \(OQ-P3-10\)/, "the note must state that the RPC route is not used in Phase 3");
});

void test("ANDA-01: decision note cites its evidence: anda.md Q1 and the documented anonymous route", () => {
  const text = readNote();
  assert.match(text, /anda\.md[^\n]*Q1/);
  assert.match(text, /GET \/\.well-known\/information/);
});

void test("ANDA-01: decision note records the shape-handshake limitation (D-61, OQ-P3-09) and says it is not a version check", () => {
  const text = readNote();
  assert.match(text, /D-61/);
  assert.match(text, /OQ-P3-09/);
  assert.match(text, /shape handshake/i);
  assert.match(text, /not a protocol version/i);
  assert.match(text, /ANDA_VERSION_MISMATCH/);
});

void test("ANDA-01: decision note records the no-shim decision (D-66)", () => {
  const text = readNote();
  assert.match(text, /D-66/);
  assert.match(text, /no shim|no Rust shim/i);
});

void test("ANDA-01: decision note records the licence conflict (OQ-P3-11) as open and non-blocking for Phase 3", () => {
  const text = readNote();
  assert.match(text, /OQ-P3-11/);
  assert.match(text, /licen[cs]e/i);
  assert.match(text, /conflict/i);
  assert.match(text, /Status: \*\*open\*\*/, "the note must state the licence conflict is open");
  assert.match(text, /It does \*\*not\*\* block Phase 3/, "the note must state the conflict does not block Phase 3");
  assert.match(text, /MIT OR Apache-2\.0/);
});

void test("ANDA-01: decision note states that no credentials are produced in Phase 3 (OQ-P3-10)", () => {
  const text = readNote();
  assert.match(text, /OQ-P3-10/);
  assert.match(text, /no credential/i);
});
