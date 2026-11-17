// findNodeBinary resolves a Node for a Bun host: only an absolute PATH directory holding a regular, executable `node`.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { findNodeBinary } from "../../src/daemon/node-runtime.js";

function withScratch(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "realm-node-runtime-"));
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function makeDir(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir);
  return dir;
}

function makeNode(dir: string, mode: number): string {
  const file = join(dir, "node");
  writeFileSync(file, "#!/bin/sh\n", { mode });
  chmodSync(file, mode);
  return file;
}

void test("an executable node in an absolute PATH directory is found", () => {
  withScratch((root) => {
    const dir = makeDir(root, "bin");
    const file = makeNode(dir, 0o755);
    assert.equal(findNodeBinary(dir), file);
  });
});

void test("undefined, empty and skipped-only values give null", () => {
  assert.equal(findNodeBinary(undefined), null);
  assert.equal(findNodeBinary(""), null);
  assert.equal(findNodeBinary(["", "relative", "./bin", "../bin"].join(delimiter)), null);
});

void test("relative and empty entries are skipped without touching the file system", () => {
  const probed: string[] = [];
  const probe = (path: string): boolean => {
    probed.push(path);
    return true;
  };
  const absolute = join(tmpdir(), "realm-never-read");
  assert.equal(findNodeBinary(["", "bin", ".", absolute].join(delimiter), probe), join(absolute, "node"));
  assert.deepEqual(probed, [join(absolute, "node")]);
});

void test("a directory named node, a non-executable file and a dangling symlink are skipped", () => {
  withScratch((root) => {
    const asDirectory = makeDir(root, "dir");
    mkdirSync(join(asDirectory, "node"));
    const notExecutable = makeDir(root, "plain");
    makeNode(notExecutable, 0o644);
    const dangling = makeDir(root, "dangling");
    symlinkSync(join(root, "missing"), join(dangling, "node"));
    const good = makeDir(root, "good");
    const goodFile = makeNode(good, 0o755);
    assert.equal(findNodeBinary([asDirectory, notExecutable, dangling, good].join(delimiter)), goodFile);
    assert.equal(findNodeBinary([asDirectory, notExecutable, dangling].join(delimiter)), null);
  });
});

void test("a symlink to an executable file is accepted", () => {
  withScratch((root) => {
    const real = makeDir(root, "real");
    const target = makeNode(real, 0o755);
    const linked = makeDir(root, "linked");
    symlinkSync(target, join(linked, "node"));
    assert.equal(findNodeBinary(linked), join(linked, "node"));
  });
});

void test("the first match in PATH order wins", () => {
  withScratch((root) => {
    const first = makeDir(root, "first");
    const second = makeDir(root, "second");
    const firstFile = makeNode(first, 0o755);
    makeNode(second, 0o755);
    assert.equal(findNodeBinary([first, second].join(delimiter)), firstFile);
    assert.equal(findNodeBinary([second, first].join(delimiter)), join(second, "node"));
  });
});

void test("a probe that throws skips its entry and never throws", () => {
  const first = join(tmpdir(), "realm-probe-first");
  const second = join(tmpdir(), "realm-probe-second");
  const probe = (path: string): boolean => {
    if (path === join(first, "node")) {
      throw new Error("stat failed");
    }
    return true;
  };
  assert.equal(findNodeBinary([first, second].join(delimiter), probe), join(second, "node"));
});
