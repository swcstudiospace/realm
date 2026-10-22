import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { CREDENTIAL_PATTERNS, isCredentialAllowed, isCredentialDenied } from "../../src/fs/credentials.js";
import { listDir } from "../../src/fs/list.js";
import { LockTable } from "../../src/fs/locks.js";
import { readFileCapped, type ReadFound, type ReadResult } from "../../src/fs/read.js";
import { bindRoot } from "../../src/fs/root.js";
import { lockedWrite } from "../../src/fs/write.js";

// Real files under a temporary base. Nothing is mocked: the files and symlinks exist on
// disk, and each test removes its base when it ends.
function tempBase(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-deny-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

function putFile(dir: string, relPath: string, content: string): void {
  const path = join(dir, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
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

function readOptions(credentialAllow: readonly string[] = []) {
  return { maxBytes: 4096, credentialAllow };
}

function writeOptions(owner: string, locks: LockTable, credentialAllow: readonly string[] = []) {
  return { owner, locks, credentialAllow };
}

// The D-31 list in its frozen order. The test pins it as literals, so a change to the
// constant is a visible diff here.
const D31_SHAPES: readonly string[] = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  "**/.ssh/**",
  "**/id_rsa",
  "**/id_rsa.*",
  "**/id_dsa",
  "**/id_ecdsa",
  "**/id_ed25519",
  "**/id_ed25519.*",
  "**/.aws/credentials",
  "**/.aws/config",
  "**/.config/gcloud/**",
  "**/.azure/**",
  "**/.kube/config",
  "**/.docker/config.json",
  "**/.netrc",
  "**/.git-credentials",
  "**/.gnupg/**",
];

// One sample path per D-31 shape. Every sample is a real file in the fixture, so reads and
// writes hit an existing object.
const DENIED_SAMPLES: readonly { readonly shape: string; readonly path: string }[] = [
  { shape: ".env", path: ".env" },
  { shape: ".env.*", path: ".env.local" },
  { shape: "**/.env", path: "app/.env" },
  { shape: "**/.env.*", path: "app/.env.production" },
  { shape: "**/.ssh/**", path: ".ssh/config" },
  { shape: "**/id_rsa", path: "deploy/id_rsa" },
  { shape: "**/id_rsa.*", path: "id_rsa.pub" },
  { shape: "**/id_dsa", path: "id_dsa" },
  { shape: "**/id_ecdsa", path: "id_ecdsa" },
  { shape: "**/id_ed25519", path: "id_ed25519" },
  { shape: "**/id_ed25519.*", path: "keys/id_ed25519.pub" },
  { shape: "**/.aws/credentials", path: ".aws/credentials" },
  { shape: "**/.aws/config", path: "home/.aws/config" },
  { shape: "**/.config/gcloud/**", path: ".config/gcloud/credentials.db" },
  { shape: "**/.azure/**", path: ".azure/accessTokens.json" },
  { shape: "**/.kube/config", path: ".kube/config" },
  { shape: "**/.docker/config.json", path: ".docker/config.json" },
  { shape: "**/.netrc", path: "work/.netrc" },
  { shape: "**/.git-credentials", path: ".git-credentials" },
  { shape: "**/.gnupg/**", path: ".gnupg/secring.gpg" },
];

function fixture(t: TestContext) {
  const base = tempBase(t);
  const rootDir = join(base, "ws");
  const outside = join(base, "outside");
  mkdirSync(rootDir);
  mkdirSync(outside);
  writeFileSync(join(outside, ".env"), "OUTSIDE_SECRET=1");
  writeFileSync(join(outside, "secret.txt"), "outside");
  for (const sample of DENIED_SAMPLES) {
    putFile(rootDir, sample.path, `credential ${sample.shape}`);
  }
  return { base, rootDir, outside, root: bindRoot(rootDir) };
}

void test("the denied list is exactly the D-31 shapes and each shape denies its sample (FS-03)", () => {
  assert.deepEqual([...CREDENTIAL_PATTERNS], D31_SHAPES);
  assert.deepEqual(
    DENIED_SAMPLES.map((sample) => sample.shape),
    D31_SHAPES,
  );
  for (const sample of DENIED_SAMPLES) {
    assert.equal(isCredentialDenied(sample.path), true, sample.shape);
  }
});

void test("paths that only resemble a denied shape are not denied (FS-03)", () => {
  for (const path of [
    "environment.ts",
    "src/env.ts",
    ".envrc",
    "config.ts",
    ".kube/configs",
    "docs/.ssh-notes.md",
    "keys/id_rsa_notes.md",
  ]) {
    assert.equal(isCredentialDenied(path), false, path);
  }
});

void test("the allow helper matches only the canonical relative path (FS-03)", () => {
  assert.equal(isCredentialAllowed(["**/.env.example"], "app/.env.example"), true);
  assert.equal(isCredentialAllowed(["**/.env.example"], "app/.env"), false);
  assert.equal(isCredentialAllowed([], ".env"), false);
});

void test("every denied shape fails with CREDENTIAL_PATH_DENIED on read (FS-03)", (t) => {
  const { root } = fixture(t);
  for (const sample of DENIED_SAMPLES) {
    assertRejectsWith(
      () => readFileCapped(root, sample.path, readOptions()),
      "CREDENTIAL_PATH_DENIED",
    );
  }
});

void test("every denied shape fails with CREDENTIAL_PATH_DENIED on write and leaves the file unchanged (FS-03)", (t) => {
  const { root, rootDir } = fixture(t);
  const locks = new LockTable();
  for (const sample of DENIED_SAMPLES) {
    assertRejectsWith(
      () => lockedWrite(root, sample.path, "overwritten", writeOptions("writer", locks)),
      "CREDENTIAL_PATH_DENIED",
    );
    assert.equal(readFileSync(join(rootDir, sample.path), "utf8"), `credential ${sample.shape}`);
  }
});

void test("a denied shape that does not exist yet is denied on read and on write (FS-03)", (t) => {
  const { root, rootDir } = fixture(t);
  assertRejectsWith(() => readFileCapped(root, ".env.new", readOptions()), "CREDENTIAL_PATH_DENIED");
  assertRejectsWith(
    () => lockedWrite(root, ".env.new", "created", writeOptions("writer", new LockTable())),
    "CREDENTIAL_PATH_DENIED",
  );
  assert.equal(existsSync(join(rootDir, ".env.new")), false);
});

void test("nested credential shapes are denied at any depth (FS-03)", (t) => {
  const { root, rootDir } = fixture(t);
  putFile(rootDir, "a/b/c/.ssh/known_hosts", "host");
  putFile(rootDir, "a/b/c/id_ed25519.pub", "key");
  putFile(rootDir, "x/.env.staging", "stage");
  for (const path of ["a/b/c/.ssh/known_hosts", "a/b/c/id_ed25519.pub", "x/.env.staging"]) {
    assertRejectsWith(() => readFileCapped(root, path, readOptions()), "CREDENTIAL_PATH_DENIED");
  }
});

void test("credentialAllow permits the matching denied path for read and write and nothing else (FS-03)", (t) => {
  const { root, rootDir } = fixture(t);
  putFile(rootDir, "app/.env.example", "EXAMPLE=1");
  const allow = ["**/.env.example"];

  const found = expectFound(readFileCapped(root, "app/.env.example", readOptions(allow)));
  assert.equal(Buffer.from(found.content).toString("utf8"), "EXAMPLE=1");

  assertRejectsWith(
    () => readFileCapped(root, "app/.env.example", readOptions()),
    "CREDENTIAL_PATH_DENIED",
  );
  assertRejectsWith(() => readFileCapped(root, "app/.env", readOptions(allow)), "CREDENTIAL_PATH_DENIED");

  lockedWrite(root, "app/.env.example", "EXAMPLE=2", writeOptions("writer", new LockTable(), allow));
  assert.equal(readFileSync(join(rootDir, "app/.env.example"), "utf8"), "EXAMPLE=2");
});

void test("an escaping credential path reports PATH_ESCAPE before any credential check (FS-01, FS-03)", (t) => {
  const { root, rootDir, outside } = fixture(t);
  // The canonical path of each of these lies outside the root and matches a credential
  // shape. Only the escape check stands between them and a CREDENTIAL_PATH_DENIED answer.
  symlinkSync(join(outside, ".env"), join(rootDir, "link"));
  symlinkSync(outside, join(rootDir, "out"));
  const everything = ["**"];

  assertRejectsWith(() => readFileCapped(root, "link", readOptions()), "PATH_ESCAPE");
  assertRejectsWith(() => readFileCapped(root, "out/.env", readOptions()), "PATH_ESCAPE");
  assertRejectsWith(() => readFileCapped(root, "../outside/.env", readOptions()), "PATH_ESCAPE");
  assertRejectsWith(() => readFileCapped(root, "link", readOptions(everything)), "PATH_ESCAPE");
  assertRejectsWith(
    () => lockedWrite(root, "link", "x", writeOptions("writer", new LockTable(), everything)),
    "PATH_ESCAPE",
  );
  assertRejectsWith(
    () => lockedWrite(root, "out/.env", "x", writeOptions("writer", new LockTable())),
    "PATH_ESCAPE",
  );
  assert.equal(readFileSync(join(outside, ".env"), "utf8"), "OUTSIDE_SECRET=1");
});

void test("a symlink inside the root into a credential path is denied on read (FS-03)", (t) => {
  const { root, rootDir } = fixture(t);
  symlinkSync(join(rootDir, ".ssh"), join(rootDir, "cfg"));
  symlinkSync(join(rootDir, ".env"), join(rootDir, "notes.txt"));
  assertRejectsWith(() => readFileCapped(root, "cfg/config", readOptions()), "CREDENTIAL_PATH_DENIED");
  assertRejectsWith(() => readFileCapped(root, "notes.txt", readOptions()), "CREDENTIAL_PATH_DENIED");
});

void test("listing a denied directory fails with CREDENTIAL_PATH_DENIED (FS-03, D-36)", (t) => {
  const { root } = fixture(t);
  assertRejectsWith(() => listDir(root, ".ssh", { credentialAllow: [] }), "CREDENTIAL_PATH_DENIED");
  assertRejectsWith(
    () => listDir(root, ".config/gcloud", { credentialAllow: [] }),
    "CREDENTIAL_PATH_DENIED",
  );
});

void test("the credential check runs before the lock: a held path is still CREDENTIAL_PATH_DENIED (D-34)", (t) => {
  const { root, rootDir } = fixture(t);
  const locks = new LockTable();
  const otherHandle = locks.acquire(join(rootDir, ".env"), "other");
  assertRejectsWith(
    () => lockedWrite(root, ".env", "x", writeOptions("me", locks)),
    "CREDENTIAL_PATH_DENIED",
  );
  // The failed write never took the lock, so the other owner still holds it.
  assert.throws(
    () => locks.acquire(join(rootDir, ".env"), "third"),
    (error: unknown) => error instanceof RealmError && error.code === "LOCK_CONFLICT",
  );
  locks.release(otherHandle);
});
