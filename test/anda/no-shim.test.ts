import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file runs from dist/test/anda, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const NATIVE_DIR = join(ROOT, "src", "anda", "native");

void test("ANDA-04: no Rust shim directory exists (src/anda/native is absent)", () => {
  assert.equal(existsSync(NATIVE_DIR), false, "src/anda/native must not exist: ANDA-04 needs no shim");
});
