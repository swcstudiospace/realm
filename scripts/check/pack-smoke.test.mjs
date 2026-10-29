import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_VERSION_FILES } from "../release/sync-version.mjs";
import {
  ADAPTER_FILES,
  WALKED_DIRECTORIES,
  buildInstallArgs,
  buildPackArgs,
  missingAdapterFiles,
  missingDeclaredEntries,
  missingWalkedFiles,
  parseArgs,
  tarballFromPackOutput,
  versionMismatches,
} from "./pack-smoke.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function writeFixture(root, path, content = "{}\n") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function withTempRoots(prefix, count, body) {
  const roots = Array.from({ length: count }, (_, index) => mkdtempSync(join(tmpdir(), `${prefix}${index}-`)));
  try {
    body(...roots);
  } finally {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

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

test("ADAPTER_FILES names the four snippet and guide files besides the manifests, and each exists in the source tree", () => {
  for (const path of [
    "adapters/hermes-agent/mcp.snippet.yaml",
    "adapters/muse-code/mcp-settings.snippet.json",
    "adapters/prime-agent/MCP.md",
    "adapters/prime-agent/skills/realm/SKILL.md",
  ]) {
    assert.ok(ADAPTER_FILES.includes(path), `${path} is listed`);
  }
  assert.equal(new Set(ADAPTER_FILES).size, ADAPTER_FILES.length, "no duplicate entries");
  for (const path of ADAPTER_FILES) {
    assert.ok(existsSync(join(REPO_ROOT, path)), `${path} exists in the source tree`);
  }
});

test("the explicit list covers every file the walk finds under adapters/ in the source tree", () => {
  // An empty package root makes every walked file "missing", so the result is the walk itself.
  withTempRoots("realm-pack-walk-self-", 1, (emptyPackage) => {
    const walked = missingWalkedFiles(REPO_ROOT, emptyPackage, ["adapters"]);
    assert.deepEqual(
      [...ADAPTER_FILES].sort(),
      walked,
    );
  });
});

test("missingAdapterFiles reports every adapter file absent from the package root", () => {
  withTempRoots("realm-pack-manifests-", 1, (root) => {
    assert.deepEqual(missingAdapterFiles(root), ADAPTER_FILES);
    for (const path of ADAPTER_FILES) {
      writeFixture(root, path);
    }
    assert.deepEqual(missingAdapterFiles(root), []);
  });
});

test("missingWalkedFiles lists the source files under the walked directories that the package lacks", () => {
  withTempRoots("realm-pack-walk-", 2, (source, installed) => {
    writeFixture(source, "adapters/a/one.json");
    writeFixture(source, "adapters/a/deep/two.md");
    writeFixture(source, "adapters/.hidden/three.json");
    writeFixture(source, "licenses/Apache-2.0.txt");
    writeFixture(source, "licenses/NEW-LICENSE.txt");
    writeFixture(source, "docs/not-walked.md");
    writeFixture(installed, "adapters/a/one.json");
    writeFixture(installed, "licenses/Apache-2.0.txt");
    writeFixture(installed, "extra/only-in-package.md");

    assert.deepEqual(missingWalkedFiles(source, installed), [
      "adapters/.hidden/three.json",
      "adapters/a/deep/two.md",
      "licenses/NEW-LICENSE.txt",
    ]);

    writeFixture(installed, "adapters/.hidden/three.json");
    writeFixture(installed, "adapters/a/deep/two.md");
    writeFixture(installed, "licenses/NEW-LICENSE.txt");
    assert.deepEqual(missingWalkedFiles(source, installed), []);
  });
});

test("missingWalkedFiles walks exactly adapters and licenses by default and fails when a source directory is absent", () => {
  assert.deepEqual(WALKED_DIRECTORIES, ["adapters", "licenses"]);
  withTempRoots("realm-pack-walk-absent-", 2, (source, installed) => {
    writeFixture(source, "adapters/a.json");
    assert.throws(() => missingWalkedFiles(source, installed), /source directory licenses is missing/);
  });
});

test("missingDeclaredEntries lists each declared bin or Omp entry that is absent, and clears when it appears", () => {
  withTempRoots("realm-pack-entries-", 1, (root) => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ bin: { realm: "./dist/src/cli/main.js" }, omp: { extensions: ["./dist/src/omp/extension.js"] } }),
    );
    assert.deepEqual(missingDeclaredEntries(root), ["./dist/src/cli/main.js", "./dist/src/omp/extension.js"]);
    mkdirSync(join(root, "dist", "src", "cli"), { recursive: true });
    writeFileSync(join(root, "dist", "src", "cli", "main.js"), "");
    assert.deepEqual(missingDeclaredEntries(root), ["./dist/src/omp/extension.js"]);
  });
});

function writeVersionedPackage(root, version, overrides = {}) {
  for (const file of RELEASE_VERSION_FILES) {
    if (file === "package-lock.json") {
      continue;
    }
    writeFixture(root, file, `${JSON.stringify({ name: "x", version: overrides[file] ?? version })}\n`);
  }
}

test("versionMismatches is empty when package.json and every shipped adapter manifest carry the version", () => {
  withTempRoots("realm-pack-version-ok-", 1, (root) => {
    writeVersionedPackage(root, "0.3.0");
    assert.deepEqual(versionMismatches(root, "0.3.0"), []);
  });
});

test("versionMismatches names each file with another or no version, and skips files absent from the tarball", () => {
  withTempRoots("realm-pack-version-bad-", 1, (root) => {
    writeVersionedPackage(root, "0.3.0", { "adapters/hermes-agent/plugin.json": "0.2.0" });
    writeFixture(root, "adapters/prime-agent/package.json", `${JSON.stringify({ name: "x" })}\n`);
    assert.deepEqual(versionMismatches(root, "0.3.0"), [
      "adapters/hermes-agent/plugin.json: 0.2.0",
      "adapters/prime-agent/package.json: no version",
    ]);
    rmSync(join(root, "adapters", "hermes-agent", "plugin.json"));
    rmSync(join(root, "adapters", "prime-agent", "package.json"));
    assert.deepEqual(versionMismatches(root, "0.3.0"), []);
    assert.deepEqual(versionMismatches(root, "0.4.0"), [
      "package.json: 0.3.0",
      "adapters/claude-plugin/.claude-plugin/plugin.json: 0.3.0",
      "adapters/muse-code/.muse-plugin/plugin.json: 0.3.0",
    ]);
  });
});

test("versionMismatches reports a missing package.json and rejects an unparsable manifest", () => {
  withTempRoots("realm-pack-version-missing-", 1, (root) => {
    assert.deepEqual(versionMismatches(root, "0.3.0"), ["package.json: missing"]);
    writeFixture(root, "package.json", "not json");
    assert.throws(() => versionMismatches(root, "0.3.0"), /cannot read the version from package\.json/);
  });
});

test("parseArgs accepts no arguments, either option, or both in any order", () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(["--tarball", "out/agent-realm-0.3.0.tgz"]), { tarball: "out/agent-realm-0.3.0.tgz" });
  assert.deepEqual(parseArgs(["--expect-version", "0.3.0"]), { expectVersion: "0.3.0" });
  assert.deepEqual(parseArgs(["--expect-version", "0.3.0", "--tarball", "a.tgz"]), {
    tarball: "a.tgz",
    expectVersion: "0.3.0",
  });
});

test("parseArgs rejects unknown flags, positional arguments, missing values, repeats and malformed versions with the usage", () => {
  assert.throws(() => parseArgs(["--nope"]), /unknown argument "--nope"; usage: pack-smoke\.mjs/);
  assert.throws(() => parseArgs(["a.tgz"]), /unknown argument "a\.tgz"/);
  assert.throws(() => parseArgs(["--tarball=a.tgz"]), /unknown argument/);
  assert.throws(() => parseArgs(["--tarball"]), /--tarball needs a value; usage:/);
  assert.throws(() => parseArgs(["--tarball", "--expect-version", "0.3.0"]), /--tarball needs a value/);
  assert.throws(() => parseArgs(["--expect-version"]), /--expect-version needs a value/);
  assert.throws(() => parseArgs(["--expect-version", ""]), /--expect-version needs a value/);
  assert.throws(() => parseArgs(["--tarball", "a.tgz", "--tarball", "b.tgz"]), /--tarball given more than once/);
  assert.throws(() => parseArgs(["--expect-version", "v0.3.0"]), /must look like x\.y\.z/);
  assert.throws(() => parseArgs(["--expect-version", "0.3"]), /must look like x\.y\.z/);
  assert.throws(() => parseArgs(["--tarball", "a.tgz", "extra"]), /unknown argument "extra"/);
});
