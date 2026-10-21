import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  type SchemaInvalidError,
  type ValidationResult,
} from "../../src/contract/validate.js";

function value<T>(result: ValidationResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a value, got ${result.error.message}`);
  }
  return result.value;
}

function rejection<T>(result: ValidationResult<T>): SchemaInvalidError {
  if (result.ok) {
    throw new Error("expected SCHEMA_INVALID, got a value");
  }
  return result.error;
}

const HEX64 = "a".repeat(64);

test("exec argv form is accepted", () => {
  const call = { exec: { argv: ["ls", "-la"] } };
  assert.deepEqual(value(validate("tools", call)), call);
});

test("exec shell form is accepted (policy gating is Phase 2)", () => {
  const call = { exec: { shell: true, script: "ls | wc -l" } };
  assert.deepEqual(value(validate("tools", call)), call);
});

test("exec with an empty argv is rejected and the path is named", () => {
  const error = rejection(validate("tools", { exec: { argv: [] } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/exec\/argv/);
});

test("exec with neither argv nor shell form is rejected", () => {
  const error = rejection(validate("tools", { exec: {} }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/exec/);
});

test("exec shell form with shell not true is rejected", () => {
  const error = rejection(validate("tools", { exec: { shell: false, script: "ls" } }));
  assert.match(error.detail, /\/exec/);
});

test("exec mixing argv and shell forms is rejected", () => {
  const error = rejection(
    validate("tools", { exec: { argv: ["ls"], shell: true, script: "ls" } }),
  );
  assert.match(error.detail, /\/exec/);
});

test("exec with an unknown key is rejected and the key is named", () => {
  const error = rejection(validate("tools", { exec: { argv: ["ls"], cwd: "/" } }));
  assert.match(error.detail, /cwd/);
});

test("exec argv form with a script key is rejected and the key is named", () => {
  const error = rejection(
    validate("tools", { exec: { argv: ["ls"], script: "rm -rf /tmp/x" } }),
  );
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/exec\/script/);
});

test("exec argv form with shell true and no script is rejected", () => {
  const error = rejection(validate("tools", { exec: { argv: ["ls"], shell: true } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/exec/);
});

test("exec argv form with shell false is rejected", () => {
  const error = rejection(validate("tools", { exec: { argv: ["ls"], shell: false } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/exec/);
});

// Key presence decides the exec form. A key whose value is undefined still counts,
// because the input is copied with structuredClone, which keeps such keys.
const EXEC_PRESENCE_CASES: readonly (readonly [string, unknown, RegExp])[] = [
  ["an argv form with a script key holding undefined", { exec: { argv: ["ls"], script: undefined } }, /\/exec\/script/],
  ["an argv form with a shell key holding undefined", { exec: { argv: ["ls"], shell: undefined } }, /\/exec\/shell/],
  ["a bare script key holding undefined", { exec: { script: undefined } }, /\/exec/],
  ["a bare shell key holding undefined", { exec: { shell: undefined } }, /\/exec/],
  ["a shell form with an argv key holding undefined", { exec: { shell: true, script: "ls", argv: undefined } }, /\/exec\/argv/],
];

for (const [label, call, pointer] of EXEC_PRESENCE_CASES) {
  test(`exec with ${label} is rejected with SCHEMA_INVALID`, () => {
    const error = rejection(validate("tools", call));
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.match(error.detail, pointer);
  });
}

test("read, write, list, status and retry are each addressable by name", () => {
  assert.deepEqual(value(validate("tools", { read: { path: "a.txt", maxBytes: 16 } })), {
    read: { path: "a.txt", maxBytes: 16 },
  });
  assert.deepEqual(value(validate("tools", { write: { path: "a.txt", content: "x" } })), {
    write: { path: "a.txt", content: "x" },
  });
  assert.deepEqual(value(validate("tools", { list: { path: ".", depth: 1 } })), {
    list: { path: ".", depth: 1 },
  });
  assert.deepEqual(value(validate("tools", { status: {} })), { status: {} });
  assert.deepEqual(value(validate("tools", { retry: {} })), { retry: {} });
});

test("an unknown tool name is rejected and named", () => {
  const error = rejection(validate("tools", { delete: { path: "a.txt" } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/delete/);
});

test("an empty object selects no tool and is rejected", () => {
  const error = rejection(validate("tools", {}));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\(root\)/);
});

test("an envelope holding two tools is rejected", () => {
  const error = rejection(
    validate("tools", { status: {}, retry: {} }),
  );
  assert.equal(error.code, "SCHEMA_INVALID");
});

const WORKSPACE_PATH_CASES = [
  "../escape",
  "a/../../etc",
  "x/..",
  "..",
  "/etc/passwd",
  "\\\\server\\share",
  "C:\\secret",
  "a\\..\\b",
  "",
];

for (const path of WORKSPACE_PATH_CASES) {
  test(`read rejects path ${JSON.stringify(path)} at schema level`, () => {
    const error = rejection(validate("tools", { read: { path, maxBytes: 16 } }));
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.match(error.detail, /\/read\/path/);
  });

  test(`write rejects path ${JSON.stringify(path)} at schema level`, () => {
    const error = rejection(validate("tools", { write: { path, content: "" } }));
    assert.match(error.detail, /\/write\/path/);
  });

  test(`list rejects path ${JSON.stringify(path)} at schema level`, () => {
    const error = rejection(validate("tools", { list: { path, depth: 1 } }));
    assert.match(error.detail, /\/list\/path/);
  });
}

test("write rejects ../escape and names the path", () => {
  const error = rejection(validate("tools", { write: { path: "../escape", content: "x" } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/write\/path/);
});

test("paths that merely contain dots are accepted", () => {
  for (const path of ["a.txt", "dir/file.txt", "a..b", "..hidden", "dir/..x", "x/."]) {
    value(validate("tools", { read: { path, maxBytes: 1 } }));
  }
});

test("write ifMatchSha256 as 64 lowercase hex is accepted", () => {
  const call = { write: { path: "a.txt", content: "x", ifMatchSha256: HEX64 } };
  assert.deepEqual(value(validate("tools", call)), call);
});

test("write ifMatchSha256 with uppercase hex is rejected", () => {
  const error = rejection(
    validate("tools", { write: { path: "a.txt", content: "x", ifMatchSha256: "A".repeat(64) } }),
  );
  assert.match(error.detail, /ifMatchSha256/);
});

test("write ifMatchSha256 of 63 characters is rejected", () => {
  const error = rejection(
    validate("tools", { write: { path: "a.txt", content: "x", ifMatchSha256: "a".repeat(63) } }),
  );
  assert.match(error.detail, /ifMatchSha256/);
});

test("read maxBytes at its 1048576 maximum is accepted", () => {
  value(validate("tools", { read: { path: "a.txt", maxBytes: 1048576 } }));
});

test("read maxBytes of 1048577 is rejected and named", () => {
  const error = rejection(validate("tools", { read: { path: "a.txt", maxBytes: 1048577 } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/read\/maxBytes/);
});

test("read maxBytes of zero is rejected", () => {
  const error = rejection(validate("tools", { read: { path: "a.txt", maxBytes: 0 } }));
  assert.match(error.detail, /\/read\/maxBytes/);
});

test("read maxBytes that is not an integer is rejected", () => {
  const error = rejection(validate("tools", { read: { path: "a.txt", maxBytes: 1.5 } }));
  assert.match(error.detail, /\/read\/maxBytes/);
});

test("read with an unknown key is rejected and the key is named", () => {
  const error = rejection(validate("tools", { read: { path: "a.txt", maxBytes: 16, extra: 1 } }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/read\/extra/);
});

test("read without maxBytes is rejected because the field is required", () => {
  const error = rejection(validate("tools", { read: { path: "a.txt" } }));
  assert.match(error.detail, /maxBytes/);
});

test("read with an empty object is rejected", () => {
  const error = rejection(validate("tools", { read: {} }));
  assert.match(error.detail, /\/read\/path/);
});

test("list with a negative depth is rejected", () => {
  const error = rejection(validate("tools", { list: { path: ".", depth: -1 } }));
  assert.match(error.detail, /\/list\/depth/);
});

test("status with an extra key is rejected", () => {
  const error = rejection(validate("tools", { status: { verbose: true } }));
  assert.match(error.detail, /verbose/);
});

test("retry with an extra key is rejected", () => {
  const error = rejection(validate("tools", { retry: { force: true } }));
  assert.match(error.detail, /force/);
});
