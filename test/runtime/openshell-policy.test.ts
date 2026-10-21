import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { buildPolicyDocument, writePolicyDocument } from "../../src/runtime/openshell.js";

const SESSION = "sess-01";

function stateDirFor(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-policy-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test("RT-03: the policy document round-trips through JSON unchanged", () => {
  const document = buildPolicyDocument();
  const parsed: unknown = JSON.parse(JSON.stringify(document));
  assert.deepEqual(parsed, document);
});

test("RT-03: the policy declares version 1, a hard-requirement Landlock, and a non-root run user", () => {
  const document = buildPolicyDocument();
  assert.equal(document.version, 1);
  assert.deepEqual(document.landlock, { compatibility: "hard_requirement" });
  assert.equal(document.process.run_as_user, "sandbox");
  assert.equal(document.process.run_as_group, "sandbox");
  assert.notEqual(document.process.run_as_user, "root");
  assert.notEqual(document.process.run_as_user, "0");
});

test("RT-03: the policy grants the in-sandbox workspace read-write and nothing read-only", () => {
  const document = buildPolicyDocument();
  assert.deepEqual(document.filesystem_policy, { read_only: [], read_write: ["/workspace"] });
});

test("RT-03: the policy has an empty network_policies map, which is deny-all egress", () => {
  assert.deepEqual(buildPolicyDocument().network_policies, {});
});

test("RT-03: the policy file lands at <stateDir>/runtime/<sessionId>.policy.json with mode 0600", (t) => {
  const stateDir = stateDirFor(t);
  const path = writePolicyDocument(stateDir, SESSION);

  assert.equal(path, join(stateDir, "runtime", `${SESSION}.policy.json`));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), buildPolicyDocument());
});

test("RT-03: a second write replaces the file with identical content and keeps mode 0600", (t) => {
  const stateDir = stateDirFor(t);
  const path = writePolicyDocument(stateDir, SESSION);
  const first = readFileSync(path, "utf8");

  const again = writePolicyDocument(stateDir, SESSION);

  assert.equal(again, path);
  assert.equal(readFileSync(path, "utf8"), first);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("RT-03: the policy holds exactly the documented top-level keys and no secret, environment, or endpoint", () => {
  const document = buildPolicyDocument();
  assert.deepEqual(Object.keys(document).sort(), [
    "filesystem_policy",
    "landlock",
    "network_policies",
    "process",
    "version",
  ]);
  assert.doesNotMatch(JSON.stringify(document), /PATH|HOME|TOKEN|SECRET|PASSWORD|CREDENTIAL|endpoint|binaries/i);
});

test("RT-03: an invalid session id or a relative state directory is refused with SCHEMA_INVALID and no runtime directory is created", (t) => {
  const stateDir = stateDirFor(t);
  assert.throws(
    () => writePolicyDocument(stateDir, "../escape"),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.throws(
    () => writePolicyDocument("relative/state", SESSION),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.equal(existsSync(join(stateDir, "runtime")), false);
});
