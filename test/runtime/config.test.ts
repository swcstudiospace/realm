import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { describeRuntimeConfigProblems, loadRuntimeConfig, retiredKeyNotes, runtimeRootsOf } from "../../src/runtime/config.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `ghcr.io/example/realm-agent@${DIGEST}`;
// The one sentence the retired andaUrl key adds to the problem list and to the CLI refusal (D-28-02).
const RETIRED_ANDA_URL_SENTENCE = "andaUrl was removed in the 0.4 release line, with the Anda bridge: delete it from config.json";

function validInput(): Record<string, unknown> {
  return {
    image: IMAGE,
    stateDir: "/var/lib/realm/state",
    workspaceRoot: "/srv/workspace",
  };
}

// The error code of a rejected load. Fails the test when the load is accepted.
function rejectionCode(input: unknown): string {
  try {
    loadRuntimeConfig(input);
  } catch (error: unknown) {
    if (error instanceof RealmError) {
      return error.code;
    }
    throw error;
  }
  throw new Error("expected loadRuntimeConfig to reject the input");
}

void test("a digest-pinned image is accepted (RT-01)", () => {
  const config = loadRuntimeConfig(validInput());
  assert.equal(config.image, IMAGE);
});

void test("a tag-only image reference is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(
    rejectionCode({ ...validInput(), image: "ghcr.io/example/realm-agent:1.2.3" }),
    "SCHEMA_INVALID",
  );
  assert.equal(rejectionCode({ ...validInput(), image: "realm-agent" }), "SCHEMA_INVALID");
});

void test("a digest that is not 64 lowercase hex characters is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(
    rejectionCode({ ...validInput(), image: `ghcr.io/example/realm-agent@sha256:${"a".repeat(63)}` }),
    "SCHEMA_INVALID",
  );
  assert.equal(
    rejectionCode({ ...validInput(), image: `ghcr.io/example/realm-agent@sha256:${"A".repeat(64)}` }),
    "SCHEMA_INVALID",
  );
  assert.equal(
    rejectionCode({ ...validInput(), image: `ghcr.io/example/realm-agent@md5:${"a".repeat(32)}` }),
    "SCHEMA_INVALID",
  );
});

void test("an andaUrl key is refused with SCHEMA_INVALID whatever its value, as any key outside the closed set is (RT-01, D-28-02)", () => {
  for (const value of ["http://127.0.0.1:7777/", "https://anda.example.com/engine", "http://user:secret@127.0.0.1:7777/", "", 7, null, undefined]) {
    assert.equal(rejectionCode({ ...validInput(), andaUrl: value }), "SCHEMA_INVALID");
  }
});

void test("a loaded config carries no andaUrl property (RT-01)", () => {
  const config = loadRuntimeConfig(validInput());
  assert.equal("andaUrl" in config, false);
});

void test("a config that carries workloadArgv is refused as an unknown key, so the removed key cannot be silently accepted (RT-01)", () => {
  assert.equal(rejectionCode({ ...validInput(), workloadArgv: ["/usr/bin/agent", "--serve"] }), "SCHEMA_INVALID");
});

void test("a relative stateDir is rejected with SCHEMA_INVALID (RT-01, D-73)", () => {
  assert.equal(rejectionCode({ ...validInput(), stateDir: "state/realm" }), "SCHEMA_INVALID");
  assert.equal(rejectionCode({ ...validInput(), stateDir: "" }), "SCHEMA_INVALID");
});

void test("a relative workspaceRoot is rejected with SCHEMA_INVALID (RT-01, D-73)", () => {
  assert.equal(rejectionCode({ ...validInput(), workspaceRoot: "workspace" }), "SCHEMA_INVALID");
});

void test("missing required fields are rejected with SCHEMA_INVALID (RT-01)", () => {
  for (const key of ["image", "stateDir", "workspaceRoot"]) {
    const input = { ...validInput(), [key]: undefined };
    assert.equal(rejectionCode(input), "SCHEMA_INVALID", `missing ${key}`);
  }
});

void test("an unknown key is rejected with SCHEMA_INVALID so a typo cannot drop a setting (RT-01)", () => {
  assert.equal(rejectionCode({ ...validInput(), imagee: IMAGE }), "SCHEMA_INVALID");
});

void test("a non-object input is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(rejectionCode(null), "SCHEMA_INVALID");
  assert.equal(rejectionCode("config"), "SCHEMA_INVALID");
  assert.equal(rejectionCode([validInput()]), "SCHEMA_INVALID");
});

void test("RT-05: each D-80 denylist name is refused at load with SCHEMA_INVALID (D-80)", () => {
  for (const key of ["network", "networkMode", "hostNetwork", "netns", "driverConfig", "driverConfigJson"]) {
    assert.equal(rejectionCode({ ...validInput(), [key]: "host" }), "SCHEMA_INVALID", `denied key ${key}`);
  }
});

void test("RT-05: an egressAllow key is refused at load, because the allowlist is validated where the runtime is built (D-106)", () => {
  assert.equal(
    rejectionCode({ ...validInput(), egressAllow: [{ host: "api.example.com", port: 443 }] }),
    "SCHEMA_INVALID",
  );
});

void test("optional secretRoot and sandboxStateRoot are accepted when absolute and refused when relative", () => {
  const loaded = loadRuntimeConfig({
    ...validInput(),
    secretRoot: "/var/lib/realm/secrets",
    sandboxStateRoot: "/var/lib/realm/sandboxes",
  });
  assert.equal(loaded.secretRoot, "/var/lib/realm/secrets");
  assert.equal(loaded.sandboxStateRoot, "/var/lib/realm/sandboxes");
  assert.equal(rejectionCode({ ...validInput(), secretRoot: "secrets" }), "SCHEMA_INVALID");
  assert.equal(rejectionCode({ ...validInput(), sandboxStateRoot: "sandboxes" }), "SCHEMA_INVALID");
});

void test("runtimeRootsOf derives the omitted roots under stateDir and keeps an explicit workspaceRoot", () => {
  const config = loadRuntimeConfig(validInput());
  assert.deepEqual(runtimeRootsOf(config), {
    secretRoot: "/var/lib/realm/state/secrets",
    workspaceRoot: "/srv/workspace",
    sandboxStateRoot: "/var/lib/realm/state/sandboxes",
    stateDir: "/var/lib/realm/state",
  });
  assert.equal(runtimeRootsOf(config).stateDir, config.stateDir);
  const explicit = loadRuntimeConfig({
    ...validInput(),
    secretRoot: "/srv/secrets",
    sandboxStateRoot: "/srv/sandboxes",
  });
  assert.equal(runtimeRootsOf(explicit).secretRoot, "/srv/secrets");
  assert.equal(runtimeRootsOf(explicit).sandboxStateRoot, "/srv/sandboxes");
});

void test("ONB-03: an explicit secretRoot equal to sandboxStateRoot is refused with SCHEMA_INVALID", () => {
  const input = { ...validInput(), secretRoot: "/srv/realm/state", sandboxStateRoot: "/srv/realm/state" };
  assert.equal(rejectionCode(input), "SCHEMA_INVALID");
});

void test("ONB-03: an explicit secretRoot inside sandboxStateRoot is refused, and the reverse is refused", () => {
  const secretInside = { ...validInput(), secretRoot: "/srv/realm/sandboxes/secrets", sandboxStateRoot: "/srv/realm/sandboxes" };
  const sandboxInside = { ...validInput(), secretRoot: "/srv/realm/secrets", sandboxStateRoot: "/srv/realm/secrets/sandboxes" };
  assert.equal(rejectionCode(secretInside), "SCHEMA_INVALID");
  assert.equal(rejectionCode(sandboxInside), "SCHEMA_INVALID");
});

void test("ONB-03: an explicit root that equals or contains the workspaceRoot, or lies inside it, is refused", () => {
  const sandboxEqualsWorkspace = { ...validInput(), sandboxStateRoot: "/srv/workspace" };
  const secretInsideWorkspace = { ...validInput(), secretRoot: "/srv/workspace/secrets" };
  const workspaceInsideSecret = { ...validInput(), workspaceRoot: "/srv/secrets/workspace", secretRoot: "/srv/secrets" };
  assert.equal(rejectionCode(sandboxEqualsWorkspace), "SCHEMA_INVALID");
  assert.equal(rejectionCode(secretInsideWorkspace), "SCHEMA_INVALID");
  assert.equal(rejectionCode(workspaceInsideSecret), "SCHEMA_INVALID");
});

void test("ONB-03: a prefix sibling is not an overlap", () => {
  const siblingRoots = loadRuntimeConfig({
    ...validInput(),
    secretRoot: "/srv/realm/secrets-old",
    sandboxStateRoot: "/srv/realm/secrets",
  });
  assert.equal(siblingRoots.secretRoot, "/srv/realm/secrets-old");
  const siblingWorkspace = loadRuntimeConfig({
    ...validInput(),
    secretRoot: "/srv/realm/secrets",
    workspaceRoot: "/srv/realm/secrets-workspace",
  });
  assert.equal(siblingWorkspace.workspaceRoot, "/srv/realm/secrets-workspace");
});

void test("ONB-03: a config with both roots omitted loads and the roots derive under stateDir", () => {
  const config = loadRuntimeConfig(validInput());
  assert.equal(config.secretRoot, undefined);
  assert.equal(config.sandboxStateRoot, undefined);
  assert.equal(runtimeRootsOf(config).secretRoot, "/var/lib/realm/state/secrets");
  assert.equal(runtimeRootsOf(config).sandboxStateRoot, "/var/lib/realm/state/sandboxes");
});

void test("ONB-03: a layout with the private roots as siblings under stateDir and the workspace elsewhere loads", () => {
  const config = loadRuntimeConfig({
    image: IMAGE,
    stateDir: "/srv/realm/acct/state",
    workspaceRoot: "/srv/realm/acct/workspace",
    secretRoot: "/srv/realm/acct/state/secrets",
    sandboxStateRoot: "/srv/realm/acct/state/sandboxes",
  });
  assert.deepEqual(runtimeRootsOf(config), {
    secretRoot: "/srv/realm/acct/state/secrets",
    workspaceRoot: "/srv/realm/acct/workspace",
    sandboxStateRoot: "/srv/realm/acct/state/sandboxes",
    stateDir: "/srv/realm/acct/state",
  });
});

void test("ONB-03: describeRuntimeConfigProblems returns nothing for an input that loads", () => {
  assert.deepEqual(describeRuntimeConfigProblems(validInput()), []);
});

void test("ONB-03: describeRuntimeConfigProblems names the failing keys and carries no value or unknown key name", () => {
  const problems = describeRuntimeConfigProblems({
    image: "bogus-VALUE-XYZ",
    stateDir: "relative/x",
    workspaceRoot: "/w",
    extraKey: 1,
  });
  assert.deepEqual(problems, [
    "config.json has a key that is not accepted",
    "image is absent or not a digest-pinned reference",
    "stateDir is absent or not an absolute path",
  ]);
  const joined = problems.join("\n");
  assert.ok(!joined.includes("VALUE-XYZ"));
  assert.ok(!joined.includes("relative/x"));
  assert.ok(!joined.includes("extraKey"));
});

void test("D-28-02: describeRuntimeConfigProblems adds the fixed retired-key sentence for andaUrl and never echoes its value", () => {
  const problems = describeRuntimeConfigProblems({ ...validInput(), andaUrl: "http://user:secret@127.0.0.1:7777/" });
  assert.deepEqual(problems, ["config.json has a key that is not accepted", RETIRED_ANDA_URL_SENTENCE]);
  for (const problem of problems) {
    assert.doesNotMatch(problem, /secret|127\.0\.0\.1|user/);
  }
});

void test("D-28-02: a different unknown key adds only the generic line, so no key name is echoed", () => {
  assert.deepEqual(describeRuntimeConfigProblems({ ...validInput(), imagee: IMAGE }), [
    "config.json has a key that is not accepted",
  ]);
});

void test("D-28-02: retiredKeyNotes returns one sentence for an input with andaUrl and nothing for any other input", () => {
  assert.deepEqual(retiredKeyNotes({ ...validInput(), andaUrl: "http://127.0.0.1:7777/" }), [RETIRED_ANDA_URL_SENTENCE]);
  assert.deepEqual(retiredKeyNotes({ hostNetwork: true }), []);
  assert.deepEqual(retiredKeyNotes("text"), []);
  assert.deepEqual(retiredKeyNotes(null), []);
  assert.deepEqual(retiredKeyNotes(undefined), []);
  assert.deepEqual(retiredKeyNotes([]), []);
});

void test("ONB-03: describeRuntimeConfigProblems names the overlap for explicit overlapping roots and the non-object input", () => {
  assert.deepEqual(
    describeRuntimeConfigProblems({ ...validInput(), secretRoot: "/srv/realm/a", sandboxStateRoot: "/srv/realm/a/b" }),
    ["secretRoot overlaps sandboxStateRoot"],
  );
  assert.deepEqual(
    describeRuntimeConfigProblems({ ...validInput(), secretRoot: "/srv/workspace", sandboxStateRoot: "/srv/workspace/x" }),
    ["secretRoot overlaps sandboxStateRoot", "secretRoot overlaps workspaceRoot", "sandboxStateRoot overlaps workspaceRoot"],
  );
  assert.deepEqual(describeRuntimeConfigProblems("not an object"), ["config.json is not a JSON object"]);
  assert.deepEqual(describeRuntimeConfigProblems(null), ["config.json is not a JSON object"]);
});
