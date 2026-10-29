// Podman gate (RT-02).
//
// This file holds the Podman version probe and the one test that asserts the host reports Podman 5.x or
// newer. The test skips with a reason that names the detected version (or PODMAN_MISSING) below 5.x.
// The live production scenarios (hardening, session naming, egress, down sweep) are in
// production-driver.test.ts.

import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePodmanVersion, podmanSkipReason, type PodmanProbe } from "../../src/runtime/podman-version.js";

// `podman --version` is local and fast; the timeout keeps a hung binary from hanging the run.
const PROBE_TIMEOUT_MS = 5_000;

// Runs `podman --version`. Any failure (ENOENT, non-zero exit, timeout) is reported as
// "unavailable" and is mapped to PODMAN_MISSING by podmanSkipReason.
function probePodman(): Promise<PodmanProbe> {
  return new Promise((resolve) => {
    execFile("podman", ["--version"], { timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
      if (error !== null) {
        resolve({ kind: "unavailable" });
        return;
      }
      resolve({ kind: "output", stdout });
    });
  });
}

const probe = await probePodman();
const gate = podmanSkipReason(probe);

// Below Podman 5.x the test is skipped with a reason that names the detected version; the skip is the
// gate, not a suppression.
void test("Podman gate: the host reports Podman 5.x or newer (RT-02)", { skip: gate }, () => {
  if (probe.kind !== "output") {
    assert.fail("the gate ran the suite without a successful podman --version probe");
  }
  const parsed = parsePodmanVersion(probe.stdout);
  if (!parsed.ok) {
    assert.fail(`podman --version output did not parse: ${parsed.reason}`);
  }
  assert.ok(parsed.major >= 5, `expected Podman 5.x or newer, found ${parsed.version}`);
});
