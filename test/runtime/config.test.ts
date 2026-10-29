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

void test("an andaUrl with userinfo is rejected with SCHEMA_INVALID (RT-01)", () => {
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

void test("an andaUrl with a non-http(s) scheme is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(rejectionCode({ ...validInput(), andaUrl: "ftp://127.0.0.1/" }), "SCHEMA_INVALID");
  assert.equal(rejectionCode({ ...validInput(), andaUrl: "file:///etc/anda" }), "SCHEMA_INVALID");
  assert.equal(rejectionCode({ ...validInput(), andaUrl: "ws://127.0.0.1:7777/" }), "SCHEMA_INVALID");
});

void test("an andaUrl that does not parse is rejected with SCHEMA_INVALID (RT-01)", () => {
  assert.equal(rejectionCode({ ...validInput(), andaUrl: "not a url" }), "SCHEMA_INVALID");
});

void test("an http or https andaUrl without userinfo is accepted (RT-01)", () => {
  assert.equal(loadRuntimeConfig(validInput()).andaUrl, "http://127.0.0.1:7777/");
  assert.equal(
    loadRuntimeConfig({ ...validInput(), andaUrl: "https://anda.example.com/engine" }).andaUrl,
    "https://anda.example.com/engine",
  );
});

void test("an absent andaUrl is accepted and the config carries no andaUrl (RT-01)", () => {
  const config = loadRuntimeConfig({ ...validInput(), andaUrl: undefined });
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
