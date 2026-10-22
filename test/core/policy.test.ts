import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchemaInvalidError } from "../../src/contract/validate.js";
import { RealmError } from "../../src/core/errors.js";
import { loadPolicyFile } from "../../src/core/policy.js";

function withTempDir(body: (dir: string) => void): void {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-policy-")));
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeJson(path: string, value: unknown): string {
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to throw");
}

function codeOf(error: unknown): string {
  assert.ok(error instanceof RealmError, "expected a RealmError");
  return error.code;
}

void test("CORE-03: a missing policy file yields the default policy (advisory, no roots, shell disabled)", () => {
  withTempDir((dir) => {
    assert.deepEqual(loadPolicyFile(join(dir, "absent.json")), {
      mode: "advisory",
      workspaceRoots: [],
      credentialAllow: [],
      egressAllow: [],
      shellEnabled: false,
      startupBudgetMs: 10000,
      toolQueueMs: 2000,
    });
  });
});

void test("CORE-03: keys missing from a policy file take the validated defaults", () => {
  withTempDir((dir) => {
    const policy = loadPolicyFile(writeJson(join(dir, "policy.json"), { mode: "fail-closed" }));
    assert.equal(policy.mode, "fail-closed");
    assert.equal(policy.shellEnabled, false);
    assert.equal(policy.startupBudgetMs, 10000);
    assert.equal(policy.toolQueueMs, 2000);
    assert.deepEqual(policy.workspaceRoots, []);
  });
});

void test("CORE-03: an unknown key in a policy file fails SCHEMA_INVALID and names the key", () => {
  withTempDir((dir) => {
    const error = thrown(() =>
      loadPolicyFile(writeJson(join(dir, "policy.json"), { mode: "advisory", bogus: true })),
    );
    assert.ok(error instanceof SchemaInvalidError);
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.match(error.detail, /\/bogus/);
  });
});

void test("CORE-03: a policy file that is not JSON fails SCHEMA_INVALID without echoing its content", () => {
  withTempDir((dir) => {
    const path = join(dir, "policy.json");
    writeFileSync(path, "{ not-json secret-token-value");
    const error = thrown(() => loadPolicyFile(path));
    assert.equal(codeOf(error), "SCHEMA_INVALID");
    assert.ok(error instanceof SchemaInvalidError);
    assert.doesNotMatch(error.detail, /secret-token-value/);
  });
});

void test("CORE-03: a relative workspace root fails SCHEMA_INVALID, names the index, and never echoes the value", () => {
  withTempDir((dir) => {
    const error = thrown(() =>
      loadPolicyFile(writeJson(join(dir, "policy.json"), { workspaceRoots: ["relative-secret-dir"] })),
    );
    assert.ok(error instanceof SchemaInvalidError);
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.match(error.detail, /\/workspaceRoots\/0/);
    assert.doesNotMatch(error.detail, /relative-secret-dir/);
  });
});

void test("CORE-03: a policy file outside its workspace roots loads with the declared values", () => {
  withTempDir((dir) => {
    const root = join(dir, "ws");
    mkdirSync(root);
    const policy = loadPolicyFile(
      writeJson(join(dir, "policy.json"), { mode: "fail-closed", workspaceRoots: [root] }),
    );
    assert.equal(policy.mode, "fail-closed");
    assert.deepEqual(policy.workspaceRoots, [root]);
  });
});

void test("CORE-03: a policy file directly inside its own workspace root fails POLICY_DENIED", () => {
  withTempDir((dir) => {
    const root = join(dir, "ws");
    mkdirSync(root);
    const path = writeJson(join(root, "policy.json"), { workspaceRoots: [root] });
    assert.equal(codeOf(thrown(() => loadPolicyFile(path))), "POLICY_DENIED");
  });
});

void test("CORE-03: a policy file nested below its own workspace root fails POLICY_DENIED", () => {
  withTempDir((dir) => {
    const root = join(dir, "ws");
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    const path = writeJson(join(nested, "policy.json"), { workspaceRoots: [root] });
    assert.equal(codeOf(thrown(() => loadPolicyFile(path))), "POLICY_DENIED");
  });
});

void test("CORE-03: a policy path that reaches its own workspace root through a symlink fails POLICY_DENIED", () => {
  withTempDir((dir) => {
    const root = join(dir, "ws");
    const outside = join(dir, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    const real = writeJson(join(root, "policy.json"), { workspaceRoots: [root] });
    const link = join(outside, "link.json");
    symlinkSync(real, link);
    assert.equal(codeOf(thrown(() => loadPolicyFile(link))), "POLICY_DENIED");
  });
});

void test("CORE-03: a sibling whose name only shares a prefix with a root is not inside it", () => {
  withTempDir((dir) => {
    const root = join(dir, "ws");
    const sibling = join(dir, "ws-other");
    mkdirSync(root);
    mkdirSync(sibling);
    const policy = loadPolicyFile(
      writeJson(join(sibling, "policy.json"), { workspaceRoots: [root] }),
    );
    assert.deepEqual(policy.workspaceRoots, [root]);
  });
});

void test("CORE-03: a workspace root that cannot be canonicalized fails POLICY_DENIED", () => {
  withTempDir((dir) => {
    const path = writeJson(join(dir, "policy.json"), {
      workspaceRoots: [join(dir, "missing-root")],
    });
    assert.equal(codeOf(thrown(() => loadPolicyFile(path))), "POLICY_DENIED");
  });
});

void test("CORE-03: a policy path that cannot be read as a file fails POLICY_DENIED", () => {
  withTempDir((dir) => {
    const asDirectory = join(dir, "policy-dir");
    mkdirSync(asDirectory);
    assert.equal(codeOf(thrown(() => loadPolicyFile(asDirectory))), "POLICY_DENIED");
  });
});
