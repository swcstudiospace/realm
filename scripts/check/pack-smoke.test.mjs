import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_VERSION_FILES } from "../release/sync-version.mjs";
import {
  ADAPTER_FILES,
  DRIVER_PROTO_FILES,
  LEGAL_FILES,
  WALKED_DIRECTORIES,
  buildInstallArgs,
  buildPackArgs,
  missingAdapterFiles,
  missingDeclaredEntries,
  missingWalkedFiles,
  parseArgs,
  runCheck,
  tarballFromPackOutput,
  versionMismatches,
} from "./pack-smoke.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function writeFixture(root, path, content = "{}\n") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

async function withTempRootsAsync(prefix, count, body) {
  const roots = Array.from({ length: count }, (_, index) => mkdtempSync(join(tmpdir(), `${prefix}${index}-`)));
  try {
    await body(...roots);
  } finally {
    for (const root of roots) {
      rmSync(root, { recursive: true, force: true });
    }
  }
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

test("every ADAPTER_FILES entry appears in the walk of the real adapters/ tree; unlisted tree files are left to the walk check", () => {
  // An empty package root makes every walked file "missing", so the result is the walk itself.
  withTempRoots("realm-pack-walk-self-", 1, (emptyPackage) => {
    const walked = new Set(missingWalkedFiles(REPO_ROOT, emptyPackage, ["adapters"]));
    for (const path of ADAPTER_FILES) {
      assert.ok(walked.has(path), `${path} is listed but absent from the adapters/ tree`);
    }
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

// Writes a complete package tree (also usable as the source tree: it holds dist/.../validate.js) at the given version.
function writePackageTree(root, version) {
  const entries = ["dist/src/cli/main.js", "dist/src/omp/extension.js", "dist/src/contract/validate.js"];
  writeFixture(
    root,
    "package.json",
    `${JSON.stringify({ name: "agent-realm", version, bin: { realm: `./${entries[0]}` }, omp: { extensions: [`./${entries[1]}`] } })}\n`,
  );
  for (const path of entries) {
    writeFixture(root, path, "");
  }
  for (const path of [...ADAPTER_FILES, ...DRIVER_PROTO_FILES, ...LEGAL_FILES]) {
    const carriesVersion = RELEASE_VERSION_FILES.includes(path);
    writeFixture(root, path, carriesVersion ? `${JSON.stringify({ version })}\n` : "{}\n");
  }
}

// Runs the command with a fake npm: `npm pack` reports a tarball, `npm install` materialises a package at installedVersion
// in the consumer, and the probe prints one line. No process is spawned and nothing touches the network.
async function runWithFakeNpm(argv, { installedVersion, sourceRoot }) {
  const calls = [];
  const out = [];
  const err = [];
  const code = await runCheck(argv, {
    root: sourceRoot,
    run: async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd });
      if (file === "npm" && args[0] === "pack") {
        return { stdout: JSON.stringify([{ filename: "agent-realm-1.0.0.tgz" }]) };
      }
      if (file === "npm" && args[0] === "install") {
        writePackageTree(join(options.cwd, "node_modules", "agent-realm"), installedVersion);
        return { stdout: "" };
      }
      return { stdout: "schemas loaded: policy, tools, sessionRecord\n" };
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { code, calls, out: out.join(""), err: err.join("") };
}

test("runCheck with --tarball makes no npm pack call and installs the given tarball", () =>
  withTempRootsAsync("realm-pack-cmd-tarball-", 2, async (sourceRoot, scratch) => {
    writePackageTree(sourceRoot, "1.0.0");
    const tarball = join(scratch, "given.tgz");
    writeFileSync(tarball, "");
    const result = await runWithFakeNpm(["--tarball", tarball], { installedVersion: "1.0.0", sourceRoot });
    assert.equal(result.code, 0, result.err);
    assert.equal(result.calls.some((call) => call.file === "npm" && call.args[0] === "pack"), false);
    const install = result.calls.find((call) => call.file === "npm" && call.args[0] === "install");
    assert.equal(install?.args.at(-1), tarball);
    assert.match(result.out, /schemas loaded/);
  }));

test("runCheck without --tarball packs the source tree and installs the packed tarball", () =>
  withTempRootsAsync("realm-pack-cmd-pack-", 1, async (sourceRoot) => {
    writePackageTree(sourceRoot, "1.0.0");
    const result = await runWithFakeNpm([], { installedVersion: "1.0.0", sourceRoot });
    assert.equal(result.code, 0, result.err);
    const pack = result.calls.find((call) => call.file === "npm" && call.args[0] === "pack");
    assert.ok(pack, "npm pack was called");
    assert.equal(pack.cwd, sourceRoot);
    const destination = pack.args[pack.args.indexOf("--pack-destination") + 1];
    const install = result.calls.find((call) => call.file === "npm" && call.args[0] === "install");
    assert.equal(install?.args.at(-1), join(destination, "agent-realm-1.0.0.tgz"));
  }));

test("runCheck without --tarball fails before any npm call when the build output is absent", () =>
  withTempRootsAsync("realm-pack-cmd-nobuild-", 1, async (sourceRoot) => {
    const result = await runWithFakeNpm([], { installedVersion: "1.0.0", sourceRoot });
    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, []);
    assert.match(result.err, /validate\.js is missing; run "npm run build"/);
  }));

test("runCheck with --tarball skips the build-output precheck and rejects a tarball that does not exist", () =>
  withTempRootsAsync("realm-pack-cmd-missing-", 1, async (sourceRoot) => {
    const result = await runWithFakeNpm(["--tarball", join(sourceRoot, "nope.tgz")], {
      installedVersion: "1.0.0",
      sourceRoot,
    });
    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, []);
    assert.match(result.err, /does not exist/);
  }));

test("runCheck with --expect-version fails and names the mismatching files when the installed version differs", () =>
  withTempRootsAsync("realm-pack-cmd-bad-version-", 2, async (sourceRoot, scratch) => {
    writePackageTree(sourceRoot, "1.0.0");
    const tarball = join(scratch, "given.tgz");
    writeFileSync(tarball, "");
    const result = await runWithFakeNpm(["--tarball", tarball, "--expect-version", "9.9.9"], {
      installedVersion: "1.0.0",
      sourceRoot,
    });
    assert.equal(result.code, 1);
    assert.match(result.err, /not at version 9\.9\.9/);
    assert.match(result.err, /package\.json: 1\.0\.0/);
    assert.match(result.err, /adapters\/hermes-agent\/plugin\.json: 1\.0\.0/);
    assert.doesNotMatch(result.out, /version: 9\.9\.9/);
  }));

test("runCheck with --expect-version ends with zero when the installed version matches", () =>
  withTempRootsAsync("realm-pack-cmd-good-version-", 2, async (sourceRoot, scratch) => {
    writePackageTree(sourceRoot, "1.0.0");
    const tarball = join(scratch, "given.tgz");
    writeFileSync(tarball, "");
    const result = await runWithFakeNpm(["--tarball", tarball, "--expect-version", "9.9.9"], {
      installedVersion: "9.9.9",
      sourceRoot,
    });
    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /version: 9\.9\.9/);
  }));

test("runCheck reports bad arguments with the usage and a non-zero result before any work", async () => {
  const result = await runWithFakeNpm(["--nope"], { installedVersion: "1.0.0", sourceRoot: tmpdir() });
  assert.equal(result.code, 1);
  assert.deepEqual(result.calls, []);
  assert.match(result.err, /unknown argument "--nope"; usage: pack-smoke\.mjs/);
});

test("runCheck removes its temporary directories after a failed run", () =>
  withTempRootsAsync("realm-pack-cmd-cleanup-", 2, async (sourceRoot, scratch) => {
    writePackageTree(sourceRoot, "1.0.0");
    const tarball = join(scratch, "given.tgz");
    writeFileSync(tarball, "");
    const removed = [];
    const created = [];
    const code = await runCheck(["--tarball", tarball, "--expect-version", "9.9.9"], {
      root: sourceRoot,
      run: async (file, args, options) => {
        if (args[0] === "install") {
          writePackageTree(join(options.cwd, "node_modules", "agent-realm"), "1.0.0");
        }
        return { stdout: "" };
      },
      mkdtemp: async (prefix) => {
        const dir = mkdtempSync(join(tmpdir(), prefix));
        created.push(dir);
        return dir;
      },
      rm: async (dir) => {
        removed.push(dir);
        rmSync(dir, { recursive: true, force: true });
      },
      stderr: () => {},
    });
    assert.equal(code, 1);
    assert.equal(created.length, 1);
    assert.deepEqual(removed, created);
    assert.equal(existsSync(created[0]), false);
  }));
