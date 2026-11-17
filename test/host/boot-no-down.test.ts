import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The boot path never sends the control method `down`: the sandbox outlives every host (AGENTS.md). Each source file below
// is on the boot path and must not contain the string literal "down". Later plans append their own boot files here.
const BOOT_PATH_FILES: readonly string[] = ["src/host/attach.ts", "src/host/boot-driver.ts"];

void test("no boot-path source file names the control method down", () => {
  for (const file of BOOT_PATH_FILES) {
    // This test runs from dist/test/host, so the repository root is three levels up.
    const text = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    assert.ok(!text.includes('"down"'), `${file} contains the literal "down"`);
    assert.ok(!text.includes("'down'"), `${file} contains the literal 'down'`);
  }
});

void test("the boot-path list names files that exist and are not empty", () => {
  for (const file of BOOT_PATH_FILES) {
    assert.ok(readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8").length > 0, file);
  }
});
