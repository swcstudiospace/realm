import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ADAPTER_MANIFESTS,
  buildInstallArgs,
  buildPackArgs,
  missingAdapterManifests,
  tarballFromPackOutput,
} from "./pack-smoke.mjs";

test("buildPackArgs packs to the given destination as JSON", () => {
  assert.deepEqual(buildPackArgs("pack-dest"), ["pack", "--json", "--pack-destination", "pack-dest"]);
});

test("buildInstallArgs installs the tarball without scripts or audit", () => {
  assert.deepEqual(buildInstallArgs("pack-dest/agent-realm-0.0.0.tgz"), [
    "install",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    "pack-dest/agent-realm-0.0.0.tgz",
  ]);
});

test("tarballFromPackOutput joins the single reported filename onto the destination", () => {
  const stdout = JSON.stringify([{ filename: "agent-realm-0.0.0.tgz", name: "agent-realm" }]);
  assert.equal(tarballFromPackOutput(stdout, "pack-dest"), join("pack-dest", "agent-realm-0.0.0.tgz"));
});

test("tarballFromPackOutput rejects output without exactly one tarball", () => {
  assert.throws(() => tarballFromPackOutput("[]", "pack-dest"), /exactly one tarball/);
  assert.throws(
    () => tarballFromPackOutput(JSON.stringify([{ filename: "a.tgz" }, { filename: "b.tgz" }]), "pack-dest"),
    /exactly one tarball/,
  );
  assert.throws(() => tarballFromPackOutput(JSON.stringify([{ name: "agent-realm" }]), "pack-dest"), /exactly one tarball/);
});

test("ADAPTER_MANIFESTS names one manifest for each host bundle under adapters/", () => {
  assert.deepEqual(ADAPTER_MANIFESTS, [
    "adapters/claude-plugin/.claude-plugin/plugin.json",
    "adapters/claude-plugin/.mcp.json",
    "adapters/muse-code/.muse-plugin/plugin.json",
    "adapters/hermes-agent/plugin.yaml",
    "adapters/prime-agent/package.json",
  ]);
});

test("missingAdapterManifests reports every manifest absent from the package root", () => {
  const root = mkdtempSync(join(tmpdir(), "realm-pack-manifests-"));
  try {
    assert.deepEqual(missingAdapterManifests(root), ADAPTER_MANIFESTS);
    for (const path of ADAPTER_MANIFESTS) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "{}\n");
    }
    assert.deepEqual(missingAdapterManifests(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
