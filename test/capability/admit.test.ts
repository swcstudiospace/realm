import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilityPolicyOf, profileFor, requiredCapability } from "../../src/capability/admit.js";
import { TOKEN_CAPABILITIES } from "../../src/capability/token.js";
import { validate, type Policy } from "../../src/contract/validate.js";
import { HOST_IDS } from "../../src/host/types.js";

// CAPT-02 (mapping) and CAPT-04 (policy default and profile function).

const LITERAL: Policy = {
  mode: "fail-closed",
  workspaceRoots: [],
  credentialAllow: [],
  egressAllow: [],
  shellEnabled: false,
  startupBudgetMs: 200000,
  toolQueueMs: 2000,
};

function policyOf(input: unknown): Policy {
  const result = validate("policy", input);
  if (!result.ok) {
    throw new Error(`expected a policy, got ${result.error.message}`);
  }
  return result.value;
}

void test("requiredCapability maps the six tools", () => {
  assert.equal(requiredCapability({ read: { path: "a", maxBytes: 1 } }), "fs.read");
  assert.equal(requiredCapability({ list: { path: "a", depth: 1 } }), "fs.list");
  assert.equal(requiredCapability({ write: { path: "a", content: "x" } }), "fs.write");
  assert.equal(requiredCapability({ exec: { argv: ["ls"] } }), "exec.argv");
  assert.equal(requiredCapability({ exec: { shell: true, script: "ls" } }), "exec.shell");
  assert.equal(requiredCapability({ retry: {} }), "daemon.attach");
  assert.equal(requiredCapability({ status: {} }), "none");
});

void test("requiredCapability reads the key only: the member of a mapped tool is never validated", () => {
  for (const [name, expected] of [
    ["read", "fs.read"],
    ["list", "fs.list"],
    ["write", "fs.write"],
    ["retry", "daemon.attach"],
    ["status", "none"],
  ] as const) {
    for (const member of [null, undefined, 5, "x", [], {}, { unexpected: true }]) {
      assert.equal(requiredCapability({ [name]: member }), expected);
    }
  }
});

void test("requiredCapability reads a JSON-parsed tool object", () => {
  assert.equal(requiredCapability(JSON.parse('{"exec":{"shell":true,"script":"x"}}')), "exec.shell");
  assert.equal(requiredCapability(JSON.parse('{"exec":{"argv":["x"]}}')), "exec.argv");
  assert.equal(requiredCapability(JSON.parse('{"read":{"path":"p","maxBytes":1}}')), "fs.read");
});

void test("requiredCapability treats exec as shell only for the boolean true", () => {
  for (const shell of ["true", "TRUE", 1, 0, false, null, undefined, [], {}, [true]]) {
    assert.equal(requiredCapability({ exec: { shell, script: "x" } }), "exec.argv");
  }
  for (const exec of [null, undefined, 5, "shell", [], [true], {}, { argv: [] }, { shell: false }]) {
    assert.equal(requiredCapability({ exec }), "exec.argv");
  }
});

void test("requiredCapability does not read an inherited shell member or run a getter", () => {
  assert.equal(requiredCapability({ exec: Object.create({ shell: true }) as object }), "exec.argv");
  let reads = 0;
  const exec = {};
  Object.defineProperty(exec, "shell", {
    enumerable: true,
    get: () => {
      reads += 1;
      return true;
    },
  });
  assert.equal(requiredCapability({ exec }), "exec.argv");
  const tool = {};
  Object.defineProperty(tool, "exec", {
    enumerable: true,
    get: () => {
      reads += 1;
      return { shell: true };
    },
  });
  assert.equal(requiredCapability(tool), "exec.argv");
  assert.equal(reads, 0, "no getter ran");
});

void test("requiredCapability returns unmapped for anything that is not a one-key plain object of a known tool", () => {
  const inherited = Object.create({ read: {} }) as object;
  class Holder {
    read = {};
  }
  const unmapped: readonly unknown[] = [
    undefined,
    null,
    5,
    true,
    "read",
    [],
    [{ read: {} }],
    {},
    { read: {}, list: {} },
    { read: {}, extra: 1 },
    { unknown: {} },
    { Read: {} },
    { " read": {} },
    { toString: {} },
    { constructor: {} },
    { hasOwnProperty: {} },
    JSON.parse('{"__proto__":{}}') as unknown,
    inherited,
    new Holder(),
    () => ({ read: {} }),
  ];
  for (const tool of unmapped) {
    assert.equal(requiredCapability(tool), "unmapped");
  }
});

void test("requiredCapability accepts a null-prototype plain object", () => {
  const tool = Object.assign(Object.create(null) as object, { read: {} });
  assert.equal(requiredCapability(tool), "fs.read");
});

void test("capabilityPolicyOf returns the default for a policy with no member, and the member when present", () => {
  assert.deepEqual(capabilityPolicyOf(LITERAL), { mode: "off", ttlSeconds: 3600, profiles: {} });
  const configured = { mode: "enforce", ttlSeconds: 600, profiles: { cursor: ["fs.read"] } } as const;
  assert.deepEqual(capabilityPolicyOf({ ...LITERAL, capabilityTokens: configured }), configured);
  assert.deepEqual(capabilityPolicyOf(policyOf({})), { mode: "off", ttlSeconds: 3600, profiles: {} });
});

void test("profileFor gives all six sorted for a host with no entry, for every host", () => {
  const policy = policyOf({ capabilityTokens: { mode: "enforce", profiles: { cursor: ["fs.read"] } } });
  for (const host of HOST_IDS) {
    if (host === "cursor") {
      continue;
    }
    assert.deepEqual(profileFor(policy, host), TOKEN_CAPABILITIES);
  }
  assert.deepEqual(profileFor(LITERAL, "claude"), TOKEN_CAPABILITIES);
  assert.equal(TOKEN_CAPABILITIES.length, 6);
});

void test("profileFor gives the empty list for an empty entry and the sorted configured list otherwise", () => {
  const policy = policyOf({
    capabilityTokens: { profiles: { claude: [], cursor: ["fs.write", "fs.read", "daemon.attach"], codex: ["fs.list"] } },
  });
  assert.deepEqual(profileFor(policy, "claude"), []);
  assert.deepEqual(profileFor(policy, "cursor"), ["daemon.attach", "fs.read", "fs.write"]);
  assert.deepEqual(profileFor(policy, "codex"), ["fs.list"]);
});

void test("profileFor does not reorder the policy's own list", () => {
  const policy = policyOf({ capabilityTokens: { profiles: { cursor: ["fs.write", "fs.read"] } } });
  profileFor(policy, "cursor");
  assert.deepEqual(capabilityPolicyOf(policy).profiles.cursor, ["fs.write", "fs.read"]);
});
