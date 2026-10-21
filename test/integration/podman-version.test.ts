import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES } from "../../src/core/errors.js";
import { parsePodmanVersion, podmanSkipReason } from "./podman-version.js";

test("parses Podman 4.9.3 as major 4", () => {
  assert.deepEqual(parsePodmanVersion("podman version 4.9.3\n"), {
    ok: true,
    version: "4.9.3",
    major: 4,
  });
});

test("parses Podman 5.0.0 as major 5", () => {
  assert.deepEqual(parsePodmanVersion("podman version 5.0.0\n"), {
    ok: true,
    version: "5.0.0",
    major: 5,
  });
});

test("parses a 5.x release line such as 5.3.1 as major 5", () => {
  assert.deepEqual(parsePodmanVersion("podman version 5.3.1"), {
    ok: true,
    version: "5.3.1",
    major: 5,
  });
});

test("reports missing (empty) output as a parse failure", () => {
  const parsed = parsePodmanVersion("");
  assert.equal(parsed.ok, false);
});

test("reports whitespace-only output as a parse failure", () => {
  const parsed = parsePodmanVersion("   \n");
  assert.equal(parsed.ok, false);
});

test("reports malformed output as a parse failure", () => {
  assert.equal(parsePodmanVersion("podman version banana").ok, false);
  assert.equal(parsePodmanVersion("podman version 5").ok, false);
  assert.equal(parsePodmanVersion("docker version 5.0.0").ok, false);
});

test("a probe that could not run maps to a skip reason naming PODMAN_MISSING", () => {
  const reason = podmanSkipReason({ kind: "unavailable" });
  assert.equal(typeof reason, "string");
  assert.ok(typeof reason === "string" && reason.includes("PODMAN_MISSING"));
});

test("Podman 4.9.3 maps to a skip reason naming the detected version and PODMAN_UNSUPPORTED_VERSION", () => {
  const reason = podmanSkipReason({ kind: "output", stdout: "podman version 4.9.3\n" });
  assert.equal(
    reason,
    "Podman 4.9.3 detected; OpenShell requires Podman 5.x; PODMAN_UNSUPPORTED_VERSION",
  );
});

test("Podman 5.0.0 and 5.3.1 map to no skip reason", () => {
  assert.equal(podmanSkipReason({ kind: "output", stdout: "podman version 5.0.0\n" }), false);
  assert.equal(podmanSkipReason({ kind: "output", stdout: "podman version 5.3.1\n" }), false);
});

test("unparseable output fails closed with a skip reason naming PODMAN_UNSUPPORTED_VERSION", () => {
  const reason = podmanSkipReason({ kind: "output", stdout: "garbage" });
  assert.equal(typeof reason, "string");
  assert.ok(typeof reason === "string" && reason.includes("PODMAN_UNSUPPORTED_VERSION"));
});

test("the codes named in the skip reasons are catalogue codes", () => {
  assert.ok(ERROR_CODES.includes("PODMAN_MISSING"));
  assert.ok(ERROR_CODES.includes("PODMAN_UNSUPPORTED_VERSION"));
});
