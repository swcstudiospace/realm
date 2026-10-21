// TOOL-01 gap cases (D-40, F-6). test/contract/tools.schema.test.ts already covers:
// exec argv and shell acceptance, argv and shell form mixing, unknown keys on exec
// argv and read, empty argv, key-presence on exec, unknown tool names, the empty and
// two-tool envelopes, absolute and ".." paths for read, write, and list, ifMatchSha256
// shape, and maxBytes bounds. The cases below are the D-40 shapes it does not cover.

import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type SchemaInvalidError, type ValidationResult } from "../../src/contract/validate.js";

function rejection<T>(result: ValidationResult<T>): SchemaInvalidError {
  if (result.ok) {
    throw new Error("expected SCHEMA_INVALID, got a value");
  }
  return result.error;
}

test("write with an unknown key is rejected and the key is named (TOOL-01)", () => {
  const error = rejection(
    validate("tools", { write: { path: "a.txt", content: "x", mode: "0777" } }),
  );
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/write\/mode/);
});

test("list with an unknown key is rejected and the key is named (TOOL-01)", () => {
  const error = rejection(validate("tools", { list: { path: ".", depth: 1, follow: true } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/list\/follow/);
});

test("the shell exec form with an unknown key is rejected and the key is named (TOOL-01)", () => {
  const error = rejection(validate("tools", { exec: { shell: true, script: "ls", cwd: "/" } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/exec\/cwd/);
});

test("the shell exec form with no script key is rejected and the missing key is named (TOOL-01)", () => {
  const error = rejection(validate("tools", { exec: { shell: true } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/exec\/script/);
});

test("the shell exec form with an empty script is rejected and the script is named (TOOL-01)", () => {
  const error = rejection(validate("tools", { exec: { shell: true, script: "" } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/exec\/script/);
});

test("write with no content key is rejected and the missing key is named (TOOL-01)", () => {
  const error = rejection(validate("tools", { write: { path: "a.txt" } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/write\/content/);
});

test("list with no depth key is rejected and the missing key is named (TOOL-01)", () => {
  const error = rejection(validate("tools", { list: { path: "." } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/list\/depth/);
});

test("status holding read-shaped params is rejected and the first unknown key is named (TOOL-01)", () => {
  const error = rejection(validate("tools", { status: { path: "a.txt", maxBytes: 16 } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/status\/path/);
});

test("retry holding write-shaped params is rejected and the first unknown key is named (TOOL-01)", () => {
  const error = rejection(validate("tools", { retry: { path: "a.txt", content: "x" } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/retry\/path/);
});

test("an extra top-level key beside a valid tool is rejected at the envelope root (TOOL-01)", () => {
  // The envelope's maxProperties limit is checked before additionalProperties, so the
  // failure is reported at the root pointer rather than by the extra key's name.
  const error = rejection(
    validate("tools", { read: { path: "a.txt", maxBytes: 16 }, extra: true }),
  );
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\(root\)/);
});
