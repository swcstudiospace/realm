import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { listDir, type ListFound, type ListResult } from "../../src/fs/list.js";
import { readFileCapped, type ReadFound, type ReadResult } from "../../src/fs/read.js";
import { bindRoot } from "../../src/fs/root.js";

// Real files and symlinks under a temporary base. Nothing is mocked.
function tempBase(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-readlist-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

function fixture(t: TestContext) {
  const base = tempBase(t);
  const ws = join(base, "ws");
  const outside = join(base, "outside");
  mkdirSync(ws);
  mkdirSync(outside);
  writeFileSync(join(ws, "a.txt"), "alpha");
  mkdirSync(join(ws, "d"));
  writeFileSync(join(ws, "d", "inner.txt"), "inner");
  symlinkSync("d", join(ws, "link"));
  symlinkSync(outside, join(ws, "outlink"));
  symlinkSync("missing-target", join(ws, "dangling"));
  writeFileSync(join(outside, "secret.txt"), "outside");
  return { base, ws, outside, root: bindRoot(ws) };
}

function assertRejectsWith(action: () => unknown, code: ErrorCode): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

function expectFound(result: ReadResult): ReadFound {
  if (result.status !== "found") {
    throw new Error("expected a found read");
  }
  return result;
}

function expectListed(result: ListResult): ListFound {
  if (result.status !== "found") {
    throw new Error("expected a listed directory");
  }
  return result;
}

function sha256Of(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

test("read returns the content, a full-file sha256, and truncated false at or under maxBytes (FS-01, D-36)", (t) => {
  const { root } = fixture(t);
  const found = expectFound(readFileCapped(root, "a.txt", { maxBytes: 100, credentialAllow: [] }));
  assert.equal(Buffer.from(found.content).toString("utf8"), "alpha");
  assert.equal(found.sha256, sha256Of("alpha"));
  assert.equal(found.truncated, false);

  const exact = expectFound(readFileCapped(root, "a.txt", { maxBytes: 5, credentialAllow: [] }));
  assert.equal(Buffer.from(exact.content).toString("utf8"), "alpha");
  assert.equal(exact.truncated, false);
});

test("read stops at maxBytes, sets truncated, and still hashes the whole file across chunks (D-36)", (t) => {
  const { ws, root } = fixture(t);
  const big = Buffer.alloc(150_000, 97);
  writeFileSync(join(ws, "big.bin"), big);
  const found = expectFound(readFileCapped(root, "big.bin", { maxBytes: 100, credentialAllow: [] }));
  assert.equal(found.content.byteLength, 100);
  assert.deepEqual(Buffer.from(found.content), big.subarray(0, 100));
  assert.equal(found.truncated, true);
  assert.equal(found.sha256, sha256Of(big));
});

test("a missing final segment and a missing intermediate segment are both absent (D-36, FS-01)", (t) => {
  const { root } = fixture(t);
  assert.deepEqual(readFileCapped(root, "missing.txt", { maxBytes: 10, credentialAllow: [] }), {
    status: "absent",
  });
  assert.deepEqual(readFileCapped(root, "nope/deeper/x.txt", { maxBytes: 10, credentialAllow: [] }), {
    status: "absent",
  });
});

test("a directory and a FIFO are non-regular and rejected with PATH_ESCAPE, without blocking (D-36)", (t) => {
  const { ws, root } = fixture(t);
  execFileSync("mkfifo", [join(ws, "pipe")]);
  assertRejectsWith(() => readFileCapped(root, "d", { maxBytes: 10, credentialAllow: [] }), "PATH_ESCAPE");
  assertRejectsWith(
    () => readFileCapped(root, "pipe", { maxBytes: 10, credentialAllow: [] }),
    "PATH_ESCAPE",
  );
});

test("list reports each entry's kind and symlink targets without following them (D-36, FS-01)", (t) => {
  const { outside, root } = fixture(t);
  const listing = expectListed(listDir(root, "", { credentialAllow: [] }));
  assert.deepEqual(listing.entries, [
    { name: "a.txt", kind: "file" },
    { name: "d", kind: "dir" },
    { name: "dangling", kind: "symlink", target: "missing-target" },
    { name: "link", kind: "symlink", target: "d" },
    { name: "outlink", kind: "symlink", target: outside },
  ]);
  assert.equal(listing.truncated, false);
});

test("list caps its output at 1000 entries in name order and sets truncated (D-36)", (t) => {
  const { ws, root } = fixture(t);
  const many = join(ws, "many");
  mkdirSync(many);
  for (let i = 0; i < 1005; i += 1) {
    writeFileSync(join(many, `f${String(i).padStart(4, "0")}`), "");
  }
  const listing = expectListed(listDir(root, "many", { credentialAllow: [] }));
  assert.equal(listing.entries.length, 1000);
  assert.equal(listing.truncated, true);
  assert.equal(listing.entries[0]?.name, "f0000");
  assert.equal(listing.entries[999]?.name, "f0999");
});

test("listing a regular file is PATH_ESCAPE and listing a missing directory is absent (D-36)", (t) => {
  const { root } = fixture(t);
  assertRejectsWith(() => listDir(root, "a.txt", { credentialAllow: [] }), "PATH_ESCAPE");
  assert.deepEqual(listDir(root, "missing", { credentialAllow: [] }), { status: "absent" });
});
