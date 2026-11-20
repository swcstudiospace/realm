import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { integrationCeiling } from "../../src/host/capabilities.js";
import { HOST_IDS } from "../../src/host/types.js";
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

// D-15 defaults, pinned as literals so the test does not read the schema under test.
const DEFAULTS = {
  mode: "fail-closed",
  workspaceRoots: [],
  credentialAllow: [],
  egressAllow: [],
  shellEnabled: false,
  startupBudgetMs: 200000,
  toolQueueMs: 2000,
  capabilityTokens: { mode: "enforce", ttlSeconds: 3600, profiles: {} },
};

void test("an empty object resolves to the D-15 defaults", () => {
  assert.deepEqual(value(validate("policy", {})), DEFAULTS);
});

void test("defaults are fresh per call and the caller's input is not mutated", () => {
  const input: Record<string, unknown> = {};
  const first = value(validate("policy", input));
  (first.workspaceRoots as string[]).push("/leaked");
  assert.deepEqual(value(validate("policy", {})).workspaceRoots, []);
  assert.deepEqual(input, {});
});

void test("D4: the schema default mode is fail-closed, and advisory still loads as advisory when named", () => {
  assert.equal(value(validate("policy", {})).mode, "fail-closed");
  assert.equal(value(validate("policy", { workspaceRoots: ["/ws"] })).mode, "fail-closed");
  assert.equal(value(validate("policy", { mode: "advisory" })).mode, "advisory");
});

void test("D-1501: the schema file itself declares fail-closed as the only mode default", () => {
  // The compiled test lives in dist/test/core, so three levels up is the repository root.
  const schemaPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "src",
    "core",
    "policy.schema.json",
  );
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as {
    properties: { mode: { default: unknown; enum: unknown } };
  };
  assert.equal(schema.properties.mode.default, "fail-closed");
  assert.deepEqual(schema.properties.mode.enum, ["advisory", "fail-closed"]);
  assert.equal(value(validate("policy", {})).mode, schema.properties.mode.default);
});

void test("mode fail-closed is accepted", () => {
  assert.equal(value(validate("policy", { mode: "fail-closed" })).mode, "fail-closed");
});

void test("any other mode string is rejected and the key is named", () => {
  const error = rejection(validate("policy", { mode: "strict" }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/mode/);
});

void test("startupBudgetMs of zero is rejected as non-positive", () => {
  const error = rejection(validate("policy", { startupBudgetMs: 0 }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/startupBudgetMs/);
});

void test("toolQueueMs of zero is rejected as non-positive", () => {
  const error = rejection(validate("policy", { toolQueueMs: 0 }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/toolQueueMs/);
});

void test("a positive integer budget is accepted", () => {
  const policy = value(validate("policy", { startupBudgetMs: 1, toolQueueMs: 1 }));
  assert.equal(policy.startupBudgetMs, 1);
  assert.equal(policy.toolQueueMs, 1);
});

void test("startupBudgetMs accepts the bounds 1 and 200000", () => {
  assert.equal(value(validate("policy", { startupBudgetMs: 1 })).startupBudgetMs, 1);
  assert.equal(value(validate("policy", { startupBudgetMs: 200000 })).startupBudgetMs, 200000);
});

void test("startupBudgetMs above the client up wait is rejected and the key is named", () => {
  const error = rejection(validate("policy", { startupBudgetMs: 200001 }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/startupBudgetMs/);
});

void test("startupBudgetMs rejects a non-integer, a string and null", () => {
  for (const bad of [1.5, "1", null]) {
    const error = rejection(validate("policy", { startupBudgetMs: bad }));
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.match(error.detail, /\/startupBudgetMs/);
  }
});

void test("an unknown key is rejected and named", () => {
  const error = rejection(validate("policy", { allowAll: true }));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.match(error.detail, /\/allowAll/);
});

void test("egressAllow accepts host and port objects", () => {
  const policy = value(
    validate("policy", { egressAllow: [{ host: "api.example.com", port: 443 }] }),
  );
  assert.deepEqual(policy.egressAllow, [{ host: "api.example.com", port: 443 }]);
});

void test("egressAllow rejects an unknown key inside a rule", () => {
  const error = rejection(
    validate("policy", { egressAllow: [{ host: "a.example", port: 1, scheme: "https" }] }),
  );
  assert.match(error.detail, /scheme/);
});

void test("egressAllow rejects a port outside 1 to 65535", () => {
  const error = rejection(validate("policy", { egressAllow: [{ host: "a.example", port: 70000 }] }));
  assert.match(error.detail, /\/port/);
});

// CAPT-04: the capabilityTokens key.
interface TokenSchema {
  properties: {
    capabilityTokens: {
      default: unknown;
      properties: {
        mode: { enum: string[]; default: unknown };
        ttlSeconds: { minimum: number; maximum: number; default: unknown };
        profiles: {
          default: unknown;
          propertyNames: { enum: string[] };
          additionalProperties: { items: { enum: string[] } };
        };
      };
    };
  };
}

function tokenSchema(): TokenSchema["properties"]["capabilityTokens"] {
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "core", "policy.schema.json");
  return (JSON.parse(readFileSync(schemaPath, "utf8")) as TokenSchema).properties.capabilityTokens;
}

// A sentinel in each refused value: the failure detail names the pointer, never the value.
const SENTINEL = "sentinel-zq7";

void test("an empty policy yields capabilityTokens mode enforce, ttlSeconds 3600 and empty profiles", () => {
  const policy = value(validate("policy", {}));
  assert.deepEqual(policy.capabilityTokens, { mode: "enforce", ttlSeconds: 3600, profiles: {} });
});

void test("capabilityTokens defaults fill member by member inside a given object", () => {
  assert.deepEqual(value(validate("policy", { capabilityTokens: {} })).capabilityTokens, { mode: "enforce", ttlSeconds: 3600, profiles: {} });
  assert.deepEqual(value(validate("policy", { capabilityTokens: { mode: "enforce" } })).capabilityTokens, {
    mode: "enforce",
    ttlSeconds: 3600,
    profiles: {},
  });
  assert.deepEqual(value(validate("policy", { capabilityTokens: { ttlSeconds: 60 } })).capabilityTokens, {
    mode: "enforce",
    ttlSeconds: 60,
    profiles: {},
  });
});

void test("an explicit capabilityTokens mode off is kept, and a profiles-only object keeps the enforce default", () => {
  assert.deepEqual(value(validate("policy", { capabilityTokens: { mode: "off" } })).capabilityTokens, {
    mode: "off",
    ttlSeconds: 3600,
    profiles: {},
  });
  assert.deepEqual(value(validate("policy", { capabilityTokens: { profiles: { cursor: ["fs.read"] } } })).capabilityTokens, {
    mode: "enforce",
    ttlSeconds: 3600,
    profiles: { cursor: ["fs.read"] },
  });
});

void test("capabilityTokens defaults are fresh per call", () => {
  const first = value(validate("policy", {}));
  (first.capabilityTokens?.profiles as Record<string, unknown>)["cursor"] = [];
  assert.deepEqual(value(validate("policy", {})).capabilityTokens?.profiles, {});
});

void test("a policy with mode enforce and two profiles round-trips", () => {
  const input = {
    capabilityTokens: {
      mode: "enforce",
      ttlSeconds: 600,
      profiles: { cursor: ["fs.read", "fs.list"], claude: [] },
    },
  };
  assert.deepEqual(value(validate("policy", input)).capabilityTokens, input.capabilityTokens);
});

void test("ttlSeconds accepts the bounds 60 and 86400", () => {
  assert.equal(value(validate("policy", { capabilityTokens: { ttlSeconds: 60 } })).capabilityTokens?.ttlSeconds, 60);
  assert.equal(value(validate("policy", { capabilityTokens: { ttlSeconds: 86400 } })).capabilityTokens?.ttlSeconds, 86400);
});

const REFUSED: readonly { name: string; input: unknown; pointer: RegExp }[] = [
  { name: "an unknown key under capabilityTokens", input: { capabilityTokens: { extraKey: SENTINEL } }, pointer: /\/capabilityTokens\/extraKey/ },
  { name: "a host id outside HOST_IDS", input: { capabilityTokens: { profiles: { [SENTINEL]: [] } } }, pointer: /\/capabilityTokens\/profiles/ },
  { name: "net.egress in a profile", input: { capabilityTokens: { profiles: { cursor: ["net.egress"] } } }, pointer: /\/capabilityTokens\/profiles\/cursor\/0/ },
  { name: "credential.read in a profile", input: { capabilityTokens: { profiles: { cursor: ["fs.read", "credential.read"] } } }, pointer: /\/capabilityTokens\/profiles\/cursor\/1/ },
  { name: "host.tools.restrict in a profile", input: { capabilityTokens: { profiles: { cursor: ["host.tools.restrict"] } } }, pointer: /\/capabilityTokens\/profiles\/cursor\/0/ },
  { name: "a capability outside the six", input: { capabilityTokens: { profiles: { cursor: [SENTINEL] } } }, pointer: /\/capabilityTokens\/profiles\/cursor\/0/ },
  { name: "a duplicate capability", input: { capabilityTokens: { profiles: { cursor: ["fs.read", "fs.read"] } } }, pointer: /\/capabilityTokens\/profiles\/cursor/ },
  { name: "a profile that is not an array", input: { capabilityTokens: { profiles: { cursor: SENTINEL } } }, pointer: /\/capabilityTokens\/profiles\/cursor/ },
  { name: "profiles that is an array", input: { capabilityTokens: { profiles: [] } }, pointer: /\/capabilityTokens\/profiles/ },
  { name: "a mode outside off and enforce", input: { capabilityTokens: { mode: SENTINEL } }, pointer: /\/capabilityTokens\/mode/ },
  { name: "ttlSeconds 59", input: { capabilityTokens: { ttlSeconds: 59 } }, pointer: /\/capabilityTokens\/ttlSeconds/ },
  { name: "ttlSeconds 86401", input: { capabilityTokens: { ttlSeconds: 86401 } }, pointer: /\/capabilityTokens\/ttlSeconds/ },
  { name: "a non-integer ttlSeconds", input: { capabilityTokens: { ttlSeconds: 90.5 } }, pointer: /\/capabilityTokens\/ttlSeconds/ },
  { name: "a string ttlSeconds", input: { capabilityTokens: { ttlSeconds: "3600" } }, pointer: /\/capabilityTokens\/ttlSeconds/ },
  { name: "capabilityTokens that is not an object", input: { capabilityTokens: SENTINEL }, pointer: /\/capabilityTokens/ },
  { name: "capabilityTokens null", input: { capabilityTokens: null }, pointer: /\/capabilityTokens/ },
];

for (const row of REFUSED) {
  void test(`capabilityTokens: ${row.name} is SCHEMA_INVALID, names the pointer and never the value`, () => {
    const error = rejection(validate("policy", row.input));
    assert.equal(error.code, "SCHEMA_INVALID");
    assert.match(error.detail, row.pointer);
    assert.equal(error.message.includes(SENTINEL), false, "the message echoes the value");
  });
}

void test("the capabilityTokens schema: host ids equal HOST_IDS and capabilities equal the mcp-config ceiling, as sets", () => {
  const schema = tokenSchema();
  assert.equal(schema.properties.profiles.propertyNames.enum.length, 22);
  assert.deepEqual(new Set(schema.properties.profiles.propertyNames.enum), new Set<string>(HOST_IDS));
  assert.equal(schema.properties.profiles.propertyNames.enum.length, HOST_IDS.length);
  const capabilities = schema.properties.profiles.additionalProperties.items.enum;
  assert.equal(capabilities.length, 6);
  assert.deepEqual(new Set(capabilities), new Set<string>(integrationCeiling("mcp-config")));
});

void test("the capabilityTokens schema declares mode default enforce, ttlSeconds 3600 within 60 to 86400, and object defaults", () => {
  const schema = tokenSchema();
  assert.deepEqual(schema.default, {});
  assert.deepEqual(schema.properties.mode.enum, ["off", "enforce"]);
  assert.equal(schema.properties.mode.default, "enforce");
  assert.equal(schema.properties.ttlSeconds.default, 3600);
  assert.equal(schema.properties.ttlSeconds.minimum, 60);
  assert.equal(schema.properties.ttlSeconds.maximum, 86400);
  assert.deepEqual(schema.properties.profiles.default, {});
});

void test("every host id of the schema is accepted with every capability of the ceiling", () => {
  for (const host of HOST_IDS) {
    const profiles = { [host]: [...integrationCeiling("mcp-config")] };
    assert.deepEqual(value(validate("policy", { capabilityTokens: { profiles } })).capabilityTokens?.profiles, profiles);
  }
});
