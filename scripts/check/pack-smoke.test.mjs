import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

// Packs a fixture package that holds every adapter file except `omitted` with the real npm, then runs pack-smoke on that
// tarball. Resolves to the exit status and stderr of the run; the temporary directories are removed afterwards.
const PACK_SMOKE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "pack-smoke.mjs");

async function runPackSmokeWithoutAdapterFile(omitted) {
  let result;
  await withTempRootsAsync("realm-pack-adapter-", 2, async (fixtureRoot, scratch) => {
    for (const path of ADAPTER_FILES.filter((entry) => entry !== omitted)) {
      writeFixture(fixtureRoot, path);
    }
    writeFixture(fixtureRoot, "package.json", `${JSON.stringify({ name: "agent-realm", version: "1.0.0" })}\n`);
    const packed = spawnSync("npm", buildPackArgs(scratch), { cwd: fixtureRoot, encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    const tarball = tarballFromPackOutput(packed.stdout, scratch);
    const smoke = spawnSync(
      process.execPath,
      [PACK_SMOKE_SCRIPT, "--tarball", tarball, "--expect-version", "1.0.0"],
      { encoding: "utf8" },
    );
    result = { status: smoke.status, stderr: smoke.stderr };
  });
  return result;
}

test("pack-smoke fails a real tarball that omits adapters/hermes-agent/mcp.snippet.yaml", async () => {
  const { status, stderr } = await runPackSmokeWithoutAdapterFile("adapters/hermes-agent/mcp.snippet.yaml");
  assert.equal(status, 1, stderr);
  assert.ok(stderr.includes("missing adapter files: adapters/hermes-agent/mcp.snippet.yaml"), stderr);
});

test("pack-smoke fails a real tarball that omits adapters/muse-code/mcp-settings.snippet.json", async () => {
  const { status, stderr } = await runPackSmokeWithoutAdapterFile("adapters/muse-code/mcp-settings.snippet.json");
  assert.equal(status, 1, stderr);
  assert.ok(stderr.includes("missing adapter files: adapters/muse-code/mcp-settings.snippet.json"), stderr);
});

test("pack-smoke fails a real tarball that omits adapters/prime-agent/MCP.md", async () => {
  const { status, stderr } = await runPackSmokeWithoutAdapterFile("adapters/prime-agent/MCP.md");
  assert.equal(status, 1, stderr);
  assert.ok(stderr.includes("missing adapter files: adapters/prime-agent/MCP.md"), stderr);
});

test("pack-smoke fails a real tarball that omits adapters/prime-agent/skills/realm/SKILL.md", async () => {
  const { status, stderr } = await runPackSmokeWithoutAdapterFile("adapters/prime-agent/skills/realm/SKILL.md");
  assert.equal(status, 1, stderr);
  assert.ok(stderr.includes("missing adapter files: adapters/prime-agent/skills/realm/SKILL.md"), stderr);
});

// Execute the checked-in shell block with local command fakes. The fixture "tarball" is a JSON
// archive: fake npm installs its actual bytes without a registry, while runCheck and its probe are real.
function milestoneBuildBlock() {
  const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  const matches = [...workflow.matchAll(/^ {6}- name: Build milestone files\n(?:(?! {6}- name:)[\s\S])*? {8}run: \|\n((?: {10}.*\n|\n)+)/gm)];
  assert.equal(matches.length, 1, "expected exactly one milestone build block");
  const block = matches[0][1].replace(/^ {10}/gm, "");
  assert.doesNotMatch(block, /\$\{\{/);
  return block;
}

function fixtureArchive(root) {
  const files = {};
  function visit(dir, prefix = "") {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(dir, entry.name), name);
      else files[name] = readFileSync(join(dir, entry.name), "utf8");
    }
  }
  visit(root);
  return JSON.stringify(files);
}

function runMilestoneFixture(options = {}) {
  let result;
  withTempRoots("realm-milestone-workflow-", 1, (root) => {
    const workspace = join(root, "workspace");
    const historical = join(root, "historical");
    const packageRoot = join(root, "package");
    const bin = join(root, "bin");
    const temp = join(root, "runner");
    const events = join(root, "events");
    const version = "0.3.42";
    for (const dir of [workspace, historical, packageRoot, bin, temp]) mkdirSync(dir, { recursive: true });
    for (const file of ["scripts/check/pack-smoke.mjs", "scripts/release/sync-version.mjs"]) {
      mkdirSync(dirname(join(workspace, file)), { recursive: true });
      cpSync(join(REPO_ROOT, file), join(workspace, file));
    }
    writeFixture(workspace, "adapters/current-only.txt", "not in the tag\n");
    writePackageTree(historical, version);
    writePackageTree(packageRoot, options.packageVersion ?? version);
    writeFixture(packageRoot, "package.json", JSON.stringify({
      name: "agent-realm", type: "module", version: options.packageVersion ?? version,
      bin: { realm: "./dist/src/cli/main.js" }, omp: { extensions: ["./dist/src/omp/extension.js"] },
    }));
    writeFixture(packageRoot, "dist/src/contract/validate.js", "export function validate() { return { ok: true }; }\n");
    if (options.adapterVersion) writeFixture(packageRoot, "adapters/hermes-agent/plugin.json", JSON.stringify({ version: options.adapterVersion }));
    if (options.omit) rmSync(join(packageRoot, options.omit));
    if (options.sourceExtra) writeFixture(historical, "adapters/tag-only.txt", "required by the tag\n");
    if (options.oldChecker) writeFixture(historical, "scripts/check/pack-smoke.mjs", "export async function runCheck() { return 0; }\n");
    writeFixture(historical, "CHANGELOG.md", `## [${version}]\n`);
    const archive = fixtureArchive(packageRoot);
    const archivePath = join(root, "fixture.tgz");
    writeFileSync(archivePath, archive);
    const fake = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const log = (event) => fs.appendFileSync(process.env.EVENTS, event + "\\n");
const fail = () => { console.error("unexpected " + name + " " + args.join(" ")); process.exit(90); };
if (name === "git") {
  if (args.join(" ") === "worktree prune") log("prune");
  else if (args[0] === "worktree" && args[1] === "add" && args[2] === "--detach" && args[4] === "refs/tags/v0.3.42") {
    fs.cpSync(process.env.HISTORICAL, args[3], { recursive: true }); log("worktree-add");
  } else if (args[0] === "worktree" && args[1] === "remove" && args[2] === "--force" && args.length === 4) {
    fs.rmSync(args[3], { recursive: true, force: true }); log("worktree-remove");
  } else fail();
} else if (name === "npm") {
  if (args.join(" ") === "ci --ignore-scripts") log("ci");
  else if (args.join(" ") === "run build") log("build");
  else if (args.join(" ") === "pack") {
    log("pack");
    if (process.env.MISSING_TARBALL !== "1") fs.copyFileSync(process.env.ARCHIVE, "agent-realm-0.3.42.tgz");
  } else if (args.length === 5 && args.slice(0, 4).join(" ") === "install --no-audit --no-fund --ignore-scripts") {
    log("install:" + args[4]);
    const files = JSON.parse(fs.readFileSync(args[4], "utf8"));
    for (const [file, content] of Object.entries(files)) {
      const dest = path.join(process.cwd(), "node_modules/agent-realm", file);
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, content);
    }
  } else fail();
} else if (name === "node") {
  if (args[0] === "scripts/release/changelog.mjs") {
    log("notes"); fs.writeFileSync("notes.md", "notes\\n");
  } else if (args[0] === path.join(process.env.GITHUB_WORKSPACE, "scripts/release/assets.mjs")) {
    if (args.length !== 7 || args[1] !== "--root" || args[3] !== "--tarball" || args[5] !== "--out") fail();
    log("assets:" + args[4]);
    fs.mkdirSync(args[6], { recursive: true });
    fs.writeFileSync(path.join(args[6], "SHA256SUMS"), "fixture\\n");
    fs.writeFileSync(path.join(args[6], "agent-realm-0.3.42.cdx.json"), "{}\\n");
  } else {
    const child = cp.spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
    process.exit(child.status === null ? 91 : child.status);
  }
} else fail();
`;
    for (const name of ["git", "npm", "node", "gh", "curl", "wget"]) {
      const path = join(bin, name);
      writeFileSync(path, fake);
      chmodSync(path, 0o755);
    }
    if (options.breakChecker) rmSync(join(workspace, "scripts/check/pack-smoke.mjs"));
    const child = spawnSync("/bin/bash", ["-c", milestoneBuildBlock()], {
      cwd: workspace,
      encoding: "utf8",
      timeout: 15000,
      env: {
        PATH: `${bin}:/usr/bin:/bin`, HOME: root, TMPDIR: temp,
        GITHUB_WORKSPACE: workspace, RUNNER_TEMP: temp, TAG: `v${version}`,
        RELEASE_DATE: "2026-11-09", HISTORICAL: historical, ARCHIVE: archivePath, EVENTS: events,
        MISSING_TARBALL: options.missingTarball ? "1" : "0",
      },
    });
    const out = join(temp, "milestone-files");
    result = {
      ...child,
      events: existsSync(events) ? readFileSync(events, "utf8").trim().split("\n") : [],
      handoff: existsSync(out) ? readdirSync(out).sort() : [],
      copied: existsSync(join(out, `agent-realm-${version}.tgz`)) ? readFileSync(join(out, `agent-realm-${version}.tgz`), "utf8") : null,
      archive,
      worktreeExists: existsSync(join(temp, `finish-${version}`)),
      tarball: join(temp, `finish-${version}`, `agent-realm-${version}.tgz`),
    };
  });
  return result;
}

test("milestone build checks the historical package before producing and handing off the same bytes", () => {
  for (const oldChecker of [false, true]) {
    const result = runMilestoneFixture({ oldChecker });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.events, ["prune", "worktree-add", "ci", "build", "pack", `install:${result.tarball}`, "notes", `assets:${result.tarball}`, "worktree-remove"]);
    assert.deepEqual(result.handoff, ["SHA256SUMS", "agent-realm-0.3.42.cdx.json", "agent-realm-0.3.42.tgz", "milestone-tag.txt", "notes.md"]);
    assert.equal(result.copied, result.archive);
    assert.equal(result.worktreeExists, false);
  }
});

test("milestone build fails closed on bad tarballs and checker failures", () => {
  for (const [options, diagnostic] of [
    [{ packageVersion: "0.3.41" }, "packed package is not at version"],
    [{ adapterVersion: "0.3.41" }, "adapters/hermes-agent/plugin.json"],
    [{ omit: "adapters/prime-agent/MCP.md" }, "missing adapter files"],
    [{ missingTarball: true }, "does not exist"],
    [{ sourceExtra: true }, "adapters/tag-only.txt"],
    [{ breakChecker: true }, "pack-smoke.mjs"],
    [{ oldChecker: true, packageVersion: "0.3.41" }, "packed package is not at version"],
  ]) {
    const result = runMilestoneFixture(options);
    assert.notEqual(result.status, 0, JSON.stringify(options));
    assert.ok(result.stderr.includes(diagnostic), result.stderr);
    assert.equal(result.events.some((event) => event === "notes" || event.startsWith("assets:")), false);
    assert.deepEqual(result.handoff, []);
    assert.equal(result.events.at(-1), "worktree-remove");
    assert.equal(result.worktreeExists, false);
  }
});
