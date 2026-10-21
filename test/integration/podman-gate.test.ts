import { execFile } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePodmanVersion,
  podmanSkipReason,
  type PodmanProbe,
} from "./podman-version.js";

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

// Phase 1 contains only the gate. The Podman-backed suite bodies arrive in Phase 3 and
// extend this file. Below Podman 5.x the suite is skipped with a reason that names the
// detected version; the skip is the gate, not a suppression.
test("Podman gated integration suite (Phase 1: probe only; bodies arrive in Phase 3)", { skip: gate }, () => {
  if (probe.kind !== "output") {
    assert.fail("the gate ran the suite without a successful podman --version probe");
  }
  const parsed = parsePodmanVersion(probe.stdout);
  if (!parsed.ok) {
    assert.fail(`podman --version output did not parse: ${parsed.reason}`);
  }
  assert.ok(parsed.major >= 5, `expected Podman 5.x or newer, found ${parsed.version}`);
});
