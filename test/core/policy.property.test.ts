import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { SchemaInvalidError, type ExecParams, type Policy, type PolicyMode } from "../../src/contract/validate.js";
import { RealmError } from "../../src/core/errors.js";
import { checkExecPolicy, decideMutation, loadPolicyFile } from "../../src/core/policy.js";
import { STATES } from "../../src/core/states.js";
import { errnoOf } from "../../src/fs/canonicalize.js";
import { bindWorkspaceUnderPolicy } from "../../src/fs/root.js";
import { assertProperty } from "../support/property.js";

// QR-07 (D-1307): properties of the policy loader and the mutation and exec decisions. Every
// default, enum and bound is read from src/core/policy.schema.json, so a schema change (the
// default mode flips in Phase 15) moves these properties with it.
interface SchemaProperty {
  readonly default?: unknown;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
}
interface PolicySchema {
  readonly properties: Readonly<Record<string, SchemaProperty>>;
  readonly $defs: { readonly egressRule: { readonly properties: Readonly<Record<string, SchemaProperty>> } };
}

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const schema = JSON.parse(readFileSync(join(PACKAGE_ROOT, "src", "core", "policy.schema.json"), "utf8")) as PolicySchema;
const POLICY_KEYS = [
  "mode",
  "workspaceRoots",
  "credentialAllow",
  "egressAllow",
  "shellEnabled",
  "startupBudgetMs",
  "toolQueueMs",
] as const satisfies readonly (keyof Policy)[];
const MODES = schema.properties["mode"]?.enum as readonly PolicyMode[];
const PORT = schema.$defs.egressRule.properties["port"] ?? {};
const DEFAULTS = Object.fromEntries(Object.entries(schema.properties).map(([key, property]) => [key, property.default]));
const MAX_BUDGET = 2 ** 31 - 1;

const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-policy-prop-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
// Workspace roots never contain the policy file, which lives in <base>/pol.
const ROOTS = [0, 1, 2, 3].map((index) => join(base, "roots", `r${String(index)}`));
for (const dir of ROOTS) {
  mkdirSync(dir, { recursive: true });
}
mkdirSync(join(base, "pol"));
const POLICY_DIR = join(base, "pol");
// Each policy is written to a fresh path: rewriting one file in place makes this host's filesystem
// flush on close, which costs about 20 ms per input.
let policyCount = 0;
function writePolicy(dir: string, text: string): string {
  policyCount += 1;
  const path = join(dir, `policy-${String(policyCount)}.json`);
  writeFileSync(path, text);
  return path;
}

// Control characters and NUL come from the "binary-ascii" unit; the unit "binary" builds a million-entry table
// on first use, so non-ASCII text comes from a fixed pool instead.
const UNICODE = ["\u00e9", "e\u0301", "\u{1F600}", "\ud800", "\u202e", "\uff0e"];
const textArb = (maxLength: number): fc.Arbitrary<string> =>
  fc.oneof(fc.string({ unit: "binary-ascii", maxLength }), fc.constantFrom(...UNICODE));
// fast-check builds records with a null prototype by default; a loaded policy is a plain object.
const PLAIN = { noNullPrototype: true };
const egressRuleArb = fc.record(
  {
    host: fc.string({ minLength: 1, maxLength: 12 }),
    port: fc.integer({ min: PORT.minimum ?? 1, max: PORT.maximum ?? 65535 }),
  },
  PLAIN,
);
const policyArb: fc.Arbitrary<Policy> = fc.record(
  {
    mode: fc.constantFrom(...MODES),
    workspaceRoots: fc.array(fc.constantFrom(...ROOTS), { maxLength: 3 }),
    credentialAllow: fc.array(textArb(8), { maxLength: 4 }),
    egressAllow: fc.array(egressRuleArb, { maxLength: 3 }),
    shellEnabled: fc.boolean(),
    startupBudgetMs: fc.integer({ min: schema.properties["startupBudgetMs"]?.minimum ?? 1, max: MAX_BUDGET }),
    toolQueueMs: fc.integer({ min: schema.properties["toolQueueMs"]?.minimum ?? 1, max: MAX_BUDGET }),
  },
  PLAIN,
);
// Every key of a policy in a random order, so the order of keys in the file cannot matter.
const keyOrder = fc.shuffledSubarray([...POLICY_KEYS], { minLength: POLICY_KEYS.length });

function textOf(policy: Policy, keys: readonly (keyof Policy)[]): string {
  return JSON.stringify(Object.fromEntries(keys.map((key) => [key, policy[key]])));
}

function loadText(text: string): Policy {
  return loadPolicyFile(writePolicy(POLICY_DIR, text));
}

// The error loadPolicyFile throws for the text, or a failure when it loads.
function loadError(text: string): unknown {
  try {
    loadText(text);
  } catch (error: unknown) {
    return error;
  }
  throw new Error(`policy text loaded: ${text}`);
}

function assertSchemaInvalid(error: unknown): SchemaInvalidError {
  assert.ok(error instanceof SchemaInvalidError, "expected a SchemaInvalidError");
  assert.equal(error.code, "SCHEMA_INVALID");
  return error;
}

function pointerSegment(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

const SECRET = "s3cr3t-";

void test("QR-07: the generator covers exactly the keys of the policy schema", () => {
  assert.deepEqual([...POLICY_KEYS].sort(), Object.keys(schema.properties).sort());
});

void test("QR-07: a generated valid policy round-trips through a file to an equal policy, whatever the key order", () => {
  assertProperty(
    fc.property(policyArb, keyOrder, (policy, order) => {
      assert.deepEqual(loadText(textOf(policy, order)), policy);
    }),
  );
});

void test("QR-07: a missing policy file and every omitted key take the default from the schema file", () => {
  assert.deepEqual(loadPolicyFile(join(base, "pol", "absent.json")), DEFAULTS);
  assertProperty(
    fc.property(policyArb, fc.subarray([...POLICY_KEYS]), (policy, given) => {
      const expected = { ...DEFAULTS, ...Object.fromEntries(given.map((key) => [key, policy[key]])) };
      assert.deepEqual(loadText(textOf(policy, given)), expected);
    }),
  );
});

void test("QR-07: a policy with an unknown top-level key is rejected, naming the key and never echoing its value", () => {
  const special = ["__proto__", "constructor", "prototype", "toString", "$schema", "Mode", "mode ", "workspace_roots", "m\u043ede", "\u200bmode"];
  const unknownKey = fc
    .oneof(fc.constantFrom(...special), textArb(8).filter((key) => key !== ""))
    .filter((key) => !Object.hasOwn(schema.properties, key));
  assertProperty(
    fc.property(policyArb, unknownKey, fc.stringMatching(/^[a-z0-9]{4,10}$/), (policy, key, token) => {
      const entries = [...POLICY_KEYS.map((name) => [name, policy[name]] as const), [key, SECRET + token] as const];
      const error = assertSchemaInvalid(loadError(JSON.stringify(Object.fromEntries(entries))));
      assert.ok(error.detail.includes(`/${pointerSegment(key)}`), "the detail does not name the key");
      assert.ok(!error.message.includes(SECRET + token), "the message echoes the value");
    }),
  );
});

void test("QR-07: an unknown key inside an egressAllow entry is rejected at that entry", () => {
  const egress = fc.record({ host: fc.string({ minLength: 1, maxLength: 8 }), port: fc.integer({ min: 1, max: 65535 }) });
  const key = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,8}$/).filter((name) => name !== "host" && name !== "port");
  assertProperty(
    fc.property(policyArb, fc.array(egress, { minLength: 1, maxLength: 3 }), key, fc.nat(), (policy, rules, extra, pick) => {
      const index = pick % rules.length;
      const polluted = rules.map((rule, at) => (at === index ? { ...rule, [extra]: SECRET } : rule));
      const error = assertSchemaInvalid(loadError(JSON.stringify({ ...policy, egressAllow: polluted })));
      assert.ok(error.detail.startsWith(`/egressAllow/${String(index)}/${extra}`), error.detail);
      assert.ok(!error.message.includes(SECRET));
    }),
  );
});

void test("QR-07: a value of the wrong type or outside its range is rejected at its key", () => {
  const notAnInteger = fc.oneof(
    fc.integer({ max: 0 }),
    fc.double({ noInteger: true, noNaN: true, min: 1, max: 1e6 }),
    fc.constantFrom("5", null, true, [], {}),
  );
  const bad: fc.Arbitrary<readonly [keyof Policy, unknown]> = fc.oneof(
    fc.constantFrom("", "Advisory", "fail_closed", "advisory ", 0, true, null, [], {}, ["advisory"]).map((value) => ["mode", value] as const),
    fc.constantFrom("/ws", 0, null, {}, [1], [null], [["/ws"]], [{}]).map((value) => ["workspaceRoots", value] as const),
    fc.constantFrom("x", 0, null, {}, [1], [false], [[]]).map((value) => ["credentialAllow", value] as const),
    fc.constantFrom({}, "h", null, [1], ["h:80"], [{ host: "h" }], [{ port: 80 }], [{ host: "", port: 80 }], [{ host: 1, port: 80 }]).map((value) => ["egressAllow", value] as const),
    fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 65536 }), fc.double({ noInteger: true, noNaN: true, min: 1, max: 65535 }), fc.constantFrom("80", null)),
      )
      .map(([host, port]) => ["egressAllow", [{ host, port }]] as const),
    fc.constantFrom("true", 0, 1, null, [], {}).map((value) => ["shellEnabled", value] as const),
    notAnInteger.map((value) => ["startupBudgetMs", value] as const),
    notAnInteger.map((value) => ["toolQueueMs", value] as const),
  );
  assertProperty(
    fc.property(policyArb, bad, (policy, [key, value]) => {
      const error = assertSchemaInvalid(loadError(JSON.stringify({ ...policy, [key]: value })));
      assert.ok(error.detail.startsWith(`/${key}`), `the detail names ${error.detail}, not ${key}`);
    }),
  );
});

void test("QR-07: a relative workspace root is rejected, naming its index and never echoing the value", () => {
  const relativeRoot = fc.oneof(
    fc.string({ maxLength: 10 }).filter((value) => !isAbsolute(value)),
    fc.stringMatching(/^[a-z0-9./]{1,8}$/).map((tail) => `${SECRET}${tail}`),
  );
  assertProperty(
    fc.property(policyArb, relativeRoot, fc.nat(), (policy, bad, pick) => {
      const roots = [...policy.workspaceRoots];
      const index = pick % (roots.length + 1);
      roots.splice(index, 0, bad);
      const error = assertSchemaInvalid(loadError(JSON.stringify({ ...policy, workspaceRoots: roots })));
      assert.ok(error.detail.startsWith(`/workspaceRoots/${String(index)}`), error.detail);
      assert.ok(!error.message.includes(SECRET), "the message echoes the root");
    }),
  );
});

void test("QR-07: any file text loads a policy or fails with a RealmError, never a raw exception", () => {
  const valid = policyArb.map((policy) => textOf(policy, POLICY_KEYS));
  const text = fc.oneof(
    textArb(40),
    fc.jsonValue().map((value) => JSON.stringify(value)),
    valid.chain((whole) => fc.nat({ max: whole.length }).map((cut) => whole.slice(0, cut))),
  );
  assertProperty(
    fc.property(text, (content) => {
      try {
        const policy = loadPolicyFile(writePolicy(POLICY_DIR, content));
        assert.ok(MODES.includes(policy.mode));
      } catch (error: unknown) {
        assert.ok(error instanceof RealmError, `a raw ${String(error)} escaped the loader`);
      }
    }),
  );
});

void test("QR-07: a policy file at any depth below one of its own roots fails POLICY_DENIED", () => {
  const dirs = fc.array(fc.constantFrom("a", "b", "c"), { maxLength: 4 });
  assertProperty(
    fc.property(fc.constantFrom(...ROOTS), dirs, fc.subarray(ROOTS), (root, nested, others) => {
      const dir = join(root, ...nested);
      mkdirSync(dir, { recursive: true });
      const file = writePolicy(dir, JSON.stringify({ workspaceRoots: [...others, root] }));
      assert.throws(
        () => loadPolicyFile(file),
        (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
      );
    }),
  );
});

void test("QR-07: decideMutation allows an active realm only, or any state under advisory with a warning", () => {
  assertProperty(
    fc.property(policyArb, fc.constantFrom(...STATES), (policy, state) => {
      const decision = decideMutation(policy, state);
      assert.deepEqual(decideMutation(policy, state), decision);
      if (state === "active") {
        assert.equal(decision.decision, "allow");
      } else if (policy.mode === "fail-closed") {
        assert.ok(decision.decision === "deny");
        assert.ok(["REALM_UNBOUND", "REALM_STOPPING", "REALM_NOT_ACTIVE"].includes(decision.code));
      } else {
        assert.equal(decision.decision, "allow-with-warning");
      }
    }),
  );
});

void test("QR-07: checkExecPolicy accepts every argv form and refuses the shell form exactly when the shell is disabled", () => {
  const exec: fc.Arbitrary<ExecParams> = fc.oneof(
    fc.array(fc.string(), { maxLength: 4 }).map((argv) => ({ argv })),
    fc.string().map((script) => ({ shell: true as const, script })),
  );
  assertProperty(
    fc.property(policyArb, exec, (policy, params) => {
      if ("argv" in params || policy.shellEnabled) {
        assert.doesNotThrow(() => {
          checkExecPolicy(policy, params);
        });
        return;
      }
      assert.throws(
        () => {
          checkExecPolicy(policy, params);
        },
        (error: unknown) => error instanceof RealmError && error.code === "SHELL_NOT_ALLOWED",
      );
    }),
  );
});

// decideMutation takes a policy and a state, never a path; the question "is this path inside a
// configured root" is answered by bindWorkspaceUnderPolicy, which is what binds a requested workspace.
const TREE = join(base, "tree");
for (const dir of ["r1/x/y", "r2", "r1-sibling", "outside"]) {
  mkdirSync(join(TREE, dir), { recursive: true });
}
writeFileSync(join(TREE, "file"), "f");
symlinkSync("../outside", join(TREE, "r1", "escape"));
symlinkSync("../r1/x", join(TREE, "outside", "back"));
const PATHS = [
  "", "r1", "r1/x", "r1/x/y", "r2", "r1-sibling", "outside", "r1/escape", "outside/back", "r1/x/..", "r1/x/../../outside",
  "r1//x/", "missing", "file", "r1/\0", "r1/x/y/..", "r1/escape/..", "outside/back/y",
].map((path) => `${TREE}/${path}`);
const CANDIDATES = [...PATHS, "r1", "", ".", "..", "r1/x"];

// A directory's real path, or the errno that made it unusable. Independent of the code under test.
function directoryOf(path: string): { readonly real: string } | { readonly failed: string } {
  try {
    const real = realpathSync(path);
    return statSync(real).isDirectory() ? { real } : { failed: "ENOTDIR" };
  } catch (error: unknown) {
    return { failed: errnoOf(error) ?? "UNKNOWN" };
  }
}

void test("QR-07: a requested workspace is bound only when it is inside a configured root, and every root must resolve", () => {
  assertProperty(
    fc.property(fc.array(fc.constantFrom(...CANDIDATES), { maxLength: 3 }), fc.constantFrom(...CANDIDATES), (roots, requested) => {
      const resolved = roots.map((root) => (isAbsolute(root) ? directoryOf(root) : { failed: "RELATIVE" }));
      const target = isAbsolute(requested) ? directoryOf(requested) : { failed: "RELATIVE" };
      const realRoots = resolved.flatMap((entry) => ("real" in entry ? [entry.real] : []));
      const expected =
        "real" in target &&
        realRoots.length === roots.length &&
        realRoots.some((root) => target.real === root || target.real.startsWith(`${root}/`))
          ? target.real
          : undefined;
      if (expected !== undefined) {
        assert.equal(bindWorkspaceUnderPolicy(roots, requested).realPath, expected);
        return;
      }
      assert.throws(
        () => bindWorkspaceUnderPolicy(roots, requested),
        (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
      );
    }),
  );
});
