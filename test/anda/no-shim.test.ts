import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs from dist/test/anda, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NATIVE_DIR = join(ROOT, "src", "anda", "native");
const NOTE_PATH = join(ROOT, "docs", "integration", "anda-decision.md");

test("ANDA-04: no Rust shim directory exists (src/anda/native is absent)", () => {
  assert.equal(existsSync(NATIVE_DIR), false, "src/anda/native must not exist: ANDA-04 needs no shim");
});

test("ANDA-04: decision note cites the documented HTTP surface GET /.well-known/information as the reason for no shim", () => {
  const text = readFileSync(NOTE_PATH, "utf8");
  assert.match(text, /GET \/\.well-known\/information/);
  assert.match(text, /D-66/);
  assert.match(text, /documented HTTP surface/i);
});
