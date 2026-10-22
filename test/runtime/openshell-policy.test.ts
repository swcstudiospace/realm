import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import type { EgressRule } from "../../src/contract/validate.js";
import { buildPolicyDocument, writePolicyDocument } from "../../src/runtime/openshell.js";
import { renderNetworkPolicies } from "../../src/runtime/egress.js";

const SESSION = "sess-01";
const BINARY = "/usr/bin/agent";
const DENY: readonly EgressRule[] = [];
const ALLOW: readonly EgressRule[] = [{ host: "api.example.com", port: 443 }];

function stateDirFor(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-policy-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

void test("RT-03: the policy document round-trips through JSON unchanged", () => {
  const document = buildPolicyDocument(DENY, BINARY);
  const parsed: unknown = JSON.parse(JSON.stringify(document));
  assert.deepEqual(parsed, document);
});

void test("RT-03: the policy declares version 1, a hard-requirement Landlock, and a non-root run user", () => {
  const document = buildPolicyDocument(DENY, BINARY);
  assert.equal(document.version, 1);
  assert.deepEqual(document.landlock, { compatibility: "hard_requirement" });
  assert.equal(document.process.run_as_user, "sandbox");
  assert.equal(document.process.run_as_group, "sandbox");
  assert.notEqual(document.process.run_as_user, "root");
  assert.notEqual(document.process.run_as_user, "0");
});

void test("RT-03: the policy grants the in-sandbox workspace read-write and nothing read-only", () => {
  const document = buildPolicyDocument(DENY, BINARY);
  assert.deepEqual(document.filesystem_policy, { read_only: [], read_write: ["/workspace"] });
});

void test("RT-03: an empty allowlist renders network_policies as an empty map, which is deny-all egress (D-103)", () => {
  assert.deepEqual(buildPolicyDocument(DENY, BINARY).network_policies, {});
});

void test("RT-05: a non-empty allowlist renders network_policies to the exact D-78 shape for the workload binary", () => {
  const document = buildPolicyDocument(ALLOW, BINARY);
  assert.deepEqual(document.network_policies, {
    egress_0: {
      name: "api.example.com:443",
      endpoints: [{ host: "api.example.com", port: 443 }],
      binaries: [{ path: BINARY }],
    },
  });
  assert.deepEqual(document.network_policies, renderNetworkPolicies(ALLOW, BINARY));
});

void test("RT-05: a non-empty allowlist leaves version, filesystem_policy, landlock, and process at their D-57 values", () => {
  const withRules = buildPolicyDocument(ALLOW, BINARY);
  const denied = buildPolicyDocument(DENY, BINARY);
  assert.equal(withRules.version, denied.version);
  assert.deepEqual(withRules.filesystem_policy, denied.filesystem_policy);
  assert.deepEqual(withRules.landlock, denied.landlock);
  assert.deepEqual(withRules.process, denied.process);
});

void test("RT-03: the policy file lands at <stateDir>/runtime/<sessionId>.policy.json with mode 0600", (t) => {
  const stateDir = stateDirFor(t);
  const path = writePolicyDocument(stateDir, SESSION, DENY, BINARY);

  assert.equal(path, join(stateDir, "runtime", `${SESSION}.policy.json`));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), buildPolicyDocument(DENY, BINARY));
});

void test("RT-05: a non-empty allowlist is written as JSON at mode 0600 with its rendered network_policies", (t) => {
  const stateDir = stateDirFor(t);
  const path = writePolicyDocument(stateDir, SESSION, ALLOW, BINARY);

  assert.equal(statSync(path).mode & 0o777, 0o600);
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(parsed, buildPolicyDocument(ALLOW, BINARY));
});

void test("RT-05: an allowlist entry that is refused, or a relative workload binary, writes no file and creates no runtime directory", (t) => {
  const stateDir = stateDirFor(t);
  const schemaInvalid = (error: unknown): boolean => error instanceof RealmError && error.code === "SCHEMA_INVALID";
  assert.throws(() => writePolicyDocument(stateDir, SESSION, [{ host: "localhost", port: 80 }], BINARY), schemaInvalid);
  assert.throws(() => writePolicyDocument(stateDir, SESSION, [{ host: "2001:db8::1", port: 443 }], BINARY), schemaInvalid);
  assert.throws(() => writePolicyDocument(stateDir, SESSION, ALLOW, "agent"), schemaInvalid);
  assert.equal(existsSync(join(stateDir, "runtime")), false);
});

void test("RT-03: a second write replaces the file with identical content and keeps mode 0600", (t) => {
  const stateDir = stateDirFor(t);
  const path = writePolicyDocument(stateDir, SESSION, ALLOW, BINARY);
  const first = readFileSync(path, "utf8");

  const again = writePolicyDocument(stateDir, SESSION, ALLOW, BINARY);

  assert.equal(again, path);
  assert.equal(readFileSync(path, "utf8"), first);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

void test("RT-03: the deny-all policy holds exactly the documented top-level keys and no secret, environment, or endpoint", () => {
  const document = buildPolicyDocument(DENY, BINARY);
  assert.deepEqual(Object.keys(document).sort(), [
    "filesystem_policy",
    "landlock",
    "network_policies",
    "process",
    "version",
  ]);
  assert.doesNotMatch(JSON.stringify(document), /PATH|HOME|TOKEN|SECRET|PASSWORD|CREDENTIAL|endpoint|binaries/i);
});

void test("RT-03: an invalid session id or a relative state directory is refused with SCHEMA_INVALID and no runtime directory is created", (t) => {
  const stateDir = stateDirFor(t);
  assert.throws(
    () => writePolicyDocument(stateDir, "../escape", DENY, BINARY),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.throws(
    () => writePolicyDocument("relative/state", SESSION, DENY, BINARY),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.equal(existsSync(join(stateDir, "runtime")), false);
});
