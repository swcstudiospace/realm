import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { loadRuntimeConfig } from "../../src/runtime/config.js";

const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `ghcr.io/example/realm-agent@${DIGEST}`;

function validInput(): Record<string, unknown> {
  return {
    image: IMAGE,
    andaUrl: "http://127.0.0.1:7777/",
    workloadArgv: ["/usr/bin/agent", "--serve"],
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

test("a digest-pinned image is accepted (RT-01)", () => {
  const config = loadRuntimeConfig(validInput());
  assert.equal(config.image, IMAGE);
});

test("a tag-only image reference is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(
    rejectionCode({ ...validInput(), image: "ghcr.io/example/realm-agent:1.2.3" }),
    "SCHEMA_INVALID",
  );
  assert.equal(rejectionCode({ ...validInput(), image: "realm-agent" }), "SCHEMA_INVALID");
});

test("a digest that is not 64 lowercase hex characters is rejected with SCHEMA_INVALID (RT-01)", () => {
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

test("an andaUrl with userinfo is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(
    rejectionCode({ ...validInput(), andaUrl: "http://user:secret@127.0.0.1:7777/" }),
    "SCHEMA_INVALID",
  );
  assert.equal(
    rejectionCode({ ...validInput(), andaUrl: "https://token@anda.example.com/" }),
    "SCHEMA_INVALID",
  );
  assert.equal(
    rejectionCode({ ...validInput(), andaUrl: "http://:@127.0.0.1:7777/" }),
    "SCHEMA_INVALID",
  );
});

test("an andaUrl with a non-http(s) scheme is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(rejectionCode({ ...validInput(), andaUrl: "ftp://127.0.0.1/" }), "SCHEMA_INVALID");
  assert.equal(rejectionCode({ ...validInput(), andaUrl: "file:///etc/anda" }), "SCHEMA_INVALID");
  assert.equal(rejectionCode({ ...validInput(), andaUrl: "ws://127.0.0.1:7777/" }), "SCHEMA_INVALID");
});

test("an andaUrl that does not parse is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(rejectionCode({ ...validInput(), andaUrl: "not a url" }), "SCHEMA_INVALID");
});

test("an http or https andaUrl without userinfo is accepted (RT-01)", () => {
  assert.equal(loadRuntimeConfig(validInput()).andaUrl, "http://127.0.0.1:7777/");
  assert.equal(
    loadRuntimeConfig({ ...validInput(), andaUrl: "https://anda.example.com/engine" }).andaUrl,
    "https://anda.example.com/engine",
  );
});

test("an absent andaUrl is accepted and the config carries no andaUrl (RT-01)", () => {
  const config = loadRuntimeConfig({ ...validInput(), andaUrl: undefined });
  assert.equal("andaUrl" in config, false);
});

test("an empty workloadArgv is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(rejectionCode({ ...validInput(), workloadArgv: [] }), "SCHEMA_INVALID");
});

test("a workloadArgv with a non-string or empty element is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(rejectionCode({ ...validInput(), workloadArgv: ["/usr/bin/agent", 7] }), "SCHEMA_INVALID");
  assert.equal(rejectionCode({ ...validInput(), workloadArgv: [""] }), "SCHEMA_INVALID");
  assert.equal(rejectionCode({ ...validInput(), workloadArgv: "/usr/bin/agent" }), "SCHEMA_INVALID");
});

test("a relative stateDir is rejected with SCHEMA_INVALID (RT-01, D-73)", () => {
  assert.equal(rejectionCode({ ...validInput(), stateDir: "state/realm" }), "SCHEMA_INVALID");
  assert.equal(rejectionCode({ ...validInput(), stateDir: "" }), "SCHEMA_INVALID");
});

test("a relative workspaceRoot is rejected with SCHEMA_INVALID (RT-01, D-73)", () => {
  assert.equal(rejectionCode({ ...validInput(), workspaceRoot: "workspace" }), "SCHEMA_INVALID");
});

test("missing required fields are rejected with SCHEMA_INVALID (RT-01)", () => {
  for (const key of ["image", "workloadArgv", "stateDir", "workspaceRoot"]) {
    const input = { ...validInput(), [key]: undefined };
    assert.equal(rejectionCode(input), "SCHEMA_INVALID", `missing ${key}`);
  }
});

test("an unknown key is rejected with SCHEMA_INVALID so a typo cannot drop a setting (RT-01)", () => {
  assert.equal(rejectionCode({ ...validInput(), imagee: IMAGE }), "SCHEMA_INVALID");
});

test("a non-object input is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(rejectionCode(null), "SCHEMA_INVALID");
  assert.equal(rejectionCode("config"), "SCHEMA_INVALID");
  assert.equal(rejectionCode([validInput()]), "SCHEMA_INVALID");
});

test("the loaded workloadArgv is a copy, so later changes to the caller's array do not reach the config (RT-01)", () => {
  const argv = ["/usr/bin/agent"];
  const config = loadRuntimeConfig({ ...validInput(), workloadArgv: argv });
  argv.push("--injected");
  assert.deepEqual(config.workloadArgv, ["/usr/bin/agent"]);
});
