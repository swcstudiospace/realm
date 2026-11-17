import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkLockfile, main } from "./lockfile-integrity.mjs";

const SCRIPT = fileURLToPath(new URL("./lockfile-integrity.mjs", import.meta.url));
const INTEGRITY = `sha512-${"A".repeat(86)}==`;

function registry(name, version) {
  return `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
}

function goodPackage(name, extra = {}) {
  return { version: "1.0.0", resolved: registry(name, "1.0.0"), integrity: INTEGRITY, ...extra };
}

function lockOf(packages) {
  return { name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", version: "1.0.0" }, ...packages } };
}

async function withLockfile(lock, run) {
  const dir = await mkdtemp(join(tmpdir(), "lockfile-integrity-"));
  try {
    const path = join(dir, "package-lock.json");
    await writeFile(path, JSON.stringify(lock), "utf8");
    return await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Runs main with console captured, so a test can assert on the lines it prints.
function runMain(path) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (line) => out.push(String(line));
  console.error = (line) => err.push(String(line));
  try {
    return { code: main(path), out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test("a clean lockfile passes, and the count covers only entries with a resolved URL", () => {
  const lock = lockOf({
    "node_modules/a": goodPackage("a"),
    "node_modules/b": goodPackage("b", { dependencies: { a: "^1.0.0", c: "npm:a@1.0.0" } }),
  });
  assert.deepEqual(checkLockfile(lock), { checked: 2, violations: [] });
});

test("an entry with a resolved URL and no integrity fails", () => {
  const lock = lockOf({ "node_modules/a": { version: "1.0.0", resolved: registry("a", "1.0.0") } });
  const { checked, violations } = checkLockfile(lock);
  assert.equal(checked, 1);
  assert.deepEqual(violations, [{ entry: "node_modules/a", reason: "resolved entry has no integrity value" }]);
});

test("an integrity that is not a sha512 SRI value fails", () => {
  const sha1 = "sha1-2jCcwmPfFZlMaIypAheco8fNfH4=";
  const lock = lockOf({ "node_modules/a": goodPackage("a", { integrity: sha1 }), "node_modules/b": goodPackage("b", { integrity: "sha512-short" }) });
  assert.deepEqual(
    checkLockfile(lock).violations.map(({ entry, reason }) => [entry, reason]),
    [
      ["node_modules/a", "integrity is not a sha512 SRI value"],
      ["node_modules/b", "integrity is not a sha512 SRI value"],
    ],
  );
});

test("an entry resolved to a host other than registry.npmjs.org fails, including a git URL and a plain-http registry", () => {
  const lock = lockOf({
    "node_modules/mirror": goodPackage("mirror", { resolved: "https://registry.example.test/mirror/-/mirror-1.0.0.tgz" }),
    "node_modules/gitdep": goodPackage("gitdep", { resolved: "git+ssh://git@github.com/example/gitdep.git#0123456789abcdef" }),
    "node_modules/insecure": goodPackage("insecure", { resolved: "http://registry.npmjs.org/insecure/-/insecure-1.0.0.tgz" }),
  });
  const { violations } = checkLockfile(lock);
  assert.deepEqual(
    violations.map((violation) => violation.entry),
    ["node_modules/mirror", "node_modules/gitdep", "node_modules/insecure"],
  );
  assert.match(violations[0].reason, /registry\.example\.test, not https:\/\/registry\.npmjs\.org/);
  assert.match(violations[1].reason, /git\+ssh:\/\/github\.com/);
  assert.match(violations[2].reason, /http:\/\/registry\.npmjs\.org/);
});

test("a resolved value that is not a URL fails", () => {
  const lock = lockOf({ "node_modules/a": goodPackage("a", { resolved: "../local/a" }) });
  assert.deepEqual(checkLockfile(lock).violations, [{ entry: "node_modules/a", reason: "resolved is not a URL: ../local/a" }]);
});

test("a link entry (a file: workspace or path dependency) fails once, not also as a missing integrity", () => {
  const lock = lockOf({ "node_modules/local": { resolved: "packages/local", link: true }, "packages/local": { version: "1.0.0" } });
  assert.deepEqual(checkLockfile(lock), {
    checked: 0,
    violations: [{ entry: "node_modules/local", reason: "link entry (local path dependency) to packages/local" }],
  });
});

test("a dependency declared with a file:, link: or git spec fails, in any dependency field and in the root entry", () => {
  const lock = lockOf({ "node_modules/a": goodPackage("a", { optionalDependencies: { x: "file:../x" } }) });
  lock.packages[""] = {
    name: "fixture",
    dependencies: { g1: "git+https://github.com/example/g1.git", g2: "github:example/g2", g3: "git@github.com:example/g3.git", t: "https://example.test/t.tgz", l: "link:../l", ok: "^2.0.0" },
    devDependencies: { f: "file:./f" },
    peerDependencies: { g4: "git://github.com/example/g4.git" },
  };
  const { violations } = checkLockfile(lock);
  assert.deepEqual(
    violations.map(({ entry, reason }) => `${entry === "" ? "(root)" : entry}: ${reason.split(" is a non-registry")[0]}`),
    [
      "(root): dependencies.g1",
      "(root): dependencies.g2",
      "(root): dependencies.g3",
      "(root): dependencies.t",
      "(root): dependencies.l",
      "(root): devDependencies.f",
      "(root): peerDependencies.g4",
      "node_modules/a: optionalDependencies.x",
    ],
  );
});

test("a lockfile without a packages map fails rather than passing an empty check", () => {
  assert.deepEqual(checkLockfile({ lockfileVersion: 1, dependencies: {} }).violations.length, 1);
  assert.deepEqual(checkLockfile(null).violations.length, 1);
});

test("main prints the count and returns 0 for a clean lockfile", async () => {
  await withLockfile(lockOf({ "node_modules/a": goodPackage("a"), "node_modules/b": goodPackage("b") }), (path) => {
    const { code, out, err } = runMain(path);
    assert.equal(code, 0);
    assert.deepEqual(out, ["lockfile integrity: 2 resolved entries checked, no violations"]);
    assert.deepEqual(err, []);
    return Promise.resolve();
  });
});

test("main names every violating entry, prints the count, and returns 1", async () => {
  const lock = lockOf({
    "node_modules/a": { version: "1.0.0", resolved: registry("a", "1.0.0") },
    "node_modules/b": goodPackage("b", { resolved: "https://registry.example.test/b.tgz" }),
  });
  await withLockfile(lock, (path) => {
    const { code, out, err } = runMain(path);
    assert.equal(code, 1);
    assert.deepEqual(out, []);
    assert.equal(err.length, 3);
    assert.match(err[0], /node_modules\/a: resolved entry has no integrity value/);
    assert.match(err[1], /node_modules\/b: resolves to https:\/\/registry\.example\.test/);
    assert.equal(err[2], "lockfile integrity: 2 resolved entries checked, 2 violations");
    return Promise.resolve();
  });
});

test("main returns 1 for an unreadable lockfile", async () => {
  await withLockfile(lockOf({}), (path) => {
    const { code, err } = runMain(`${path}.missing`);
    assert.equal(code, 1);
    assert.match(err[0], /lockfile integrity: cannot read /);
    return Promise.resolve();
  });
});

test("the script run as a command exits 0 on a clean lockfile and 1 on a violation", async () => {
  await withLockfile(lockOf({ "node_modules/a": goodPackage("a") }), (path) => {
    const clean = spawnSync(process.execPath, [SCRIPT, path], { encoding: "utf8" });
    assert.equal(clean.status, 0);
    assert.match(clean.stdout, /1 resolved entries checked, no violations/);
    return Promise.resolve();
  });
  await withLockfile(lockOf({ "node_modules/a": { version: "1.0.0", resolved: registry("a", "1.0.0") } }), (path) => {
    const dirty = spawnSync(process.execPath, [SCRIPT, path], { encoding: "utf8" });
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /resolved entry has no integrity value/);
    return Promise.resolve();
  });
});
