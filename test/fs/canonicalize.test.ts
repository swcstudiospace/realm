import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError, type ErrorCode } from "../../src/core/errors.js";
import { canonicalize, openCanonical, openVerified } from "../../src/fs/canonicalize.js";
import { bindRoot } from "../../src/fs/root.js";

// Real directories under a temporary base. Nothing here is mocked: the symlinks and
// files are created on disk, and each test removes its base when it ends.
function tempBase(t: TestContext): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-canon-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  return base;
}

function fixture(t: TestContext) {
  const base = tempBase(t);
  const rootDir = join(base, "ws");
  const outside = join(base, "outside");
  mkdirSync(rootDir);
  mkdirSync(outside);
  mkdirSync(join(rootDir, "a"));
  writeFileSync(join(rootDir, "real.txt"), "inside");
  writeFileSync(join(rootDir, "a", "f.txt"), "nested");
  writeFileSync(join(outside, "secret.txt"), "outside");
  return { base, rootDir, outside, root: bindRoot(rootDir) };
}

function assertRejectsWith(action: () => unknown, code: ErrorCode): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

// An open of a FIFO blocks until a writer appears, so the open runs in a child process.
// The parent asserts that the child exits by itself; a timeout kill fails the test.
const CHILD_TIMEOUT_MS = 5000;

// Creates a FIFO with coreutils mkfifo. A missing or failing mkfifo fails the test.
function createFifo(path: string): void {
  const made = spawnSync("mkfifo", [path], { encoding: "utf8" });
  if (made.error !== undefined || made.status !== 0) {
    throw new Error(
      `mkfifo (coreutils) is required to create ${path}: ${made.error?.message ?? made.stderr}`,
    );
  }
}

// Runs a script in a fresh Node process with the payload in REALM_CHILD_PAYLOAD.
function runChild(script: string, payload: Record<string, string>): { code: string } {
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: { ...process.env, REALM_CHILD_PAYLOAD: JSON.stringify(payload) },
    timeout: CHILD_TIMEOUT_MS,
  });
  assert.equal(run.error, undefined, `child process did not exit on its own: ${run.error?.message ?? ""}`);
  assert.equal(run.signal, null, "child process was killed by a signal instead of exiting");
  assert.equal(run.status, 0, `child process exited with an error: ${run.stderr}`);
  return JSON.parse(run.stdout) as { code: string };
}

// Child process body, run by node -e. Its imports load the compiled modules by URL inside a
// separate process, which cannot share this test's module graph, so a static import cannot
// express it. The swap happens at the resolve-to-open boundary: after the pre-open check,
// the regular file is replaced by the FIFO, and the open then runs on it.
const FIFO_SWAP_SCRIPT = `
const p = JSON.parse(process.env.REALM_CHILD_PAYLOAD);
const { bindRoot } = await import(p.rootUrl);
const { openCanonical } = await import(p.canonicalizeUrl);
const { renameSync } = await import("node:fs");
let code = "OPENED";
try {
  const opened = openCanonical(bindRoot(p.rootDir), p.rel, {
    onResolveBoundary: (realPath) => renameSync(p.fifo, realPath),
  });
  code = opened.status;
} catch (error) {
  code = error?.code ?? "UNEXPECTED";
}
process.stdout.write(JSON.stringify({ code }));
`;

test("bindRoot returns the canonical real path of a root reached through a symlink (FS-01)", (t) => {
  const { base, rootDir } = fixture(t);
  const link = join(base, "ws-link");
  symlinkSync(rootDir, link);
  assert.equal(bindRoot(link).realPath, rootDir);
});

test("bindRoot refuses a relative path, a missing path, and a regular file with POLICY_DENIED (FS-01)", (t) => {
  const { base, rootDir } = fixture(t);
  assertRejectsWith(() => bindRoot("ws"), "POLICY_DENIED");
  assertRejectsWith(() => bindRoot(join(base, "missing")), "POLICY_DENIED");
  assertRejectsWith(() => bindRoot(join(rootDir, "real.txt")), "POLICY_DENIED");
});

test("a relative path inside the root resolves to its real path (FS-01)", (t) => {
  const { root, rootDir } = fixture(t);
  assert.deepEqual(canonicalize(root, "real.txt"), { status: "found", realPath: join(rootDir, "real.txt") });
  assert.deepEqual(canonicalize(root, "a/f.txt"), { status: "found", realPath: join(rootDir, "a", "f.txt") });
});

test("a symlink that resolves inside the root is followed (FS-01)", (t) => {
  const { root, rootDir } = fixture(t);
  symlinkSync("real.txt", join(rootDir, "alias.txt"));
  symlinkSync(join(rootDir, "a", "f.txt"), join(rootDir, "abs-alias.txt"));
  assert.deepEqual(canonicalize(root, "alias.txt"), { status: "found", realPath: join(rootDir, "real.txt") });
  assert.deepEqual(canonicalize(root, "abs-alias.txt"), {
    status: "found",
    realPath: join(rootDir, "a", "f.txt"),
  });
});

test("a symlink that escapes the root is rejected with PATH_ESCAPE, relative or absolute (FS-01)", (t) => {
  const { root, rootDir, outside } = fixture(t);
  symlinkSync(join(outside, "secret.txt"), join(rootDir, "escape.txt"));
  symlinkSync("../outside/secret.txt", join(rootDir, "rel-escape.txt"));
  assertRejectsWith(() => canonicalize(root, "escape.txt"), "PATH_ESCAPE");
  assertRejectsWith(() => canonicalize(root, "rel-escape.txt"), "PATH_ESCAPE");
});

test("containment is checked on path segments, so a sibling sharing the root name prefix is an escape (FS-01)", (t) => {
  const { base, root, rootDir } = fixture(t);
  const sibling = join(base, "ws2");
  mkdirSync(sibling);
  writeFileSync(join(sibling, "file.txt"), "sibling");
  symlinkSync("../ws2/file.txt", join(rootDir, "sibling.txt"));
  assertRejectsWith(() => canonicalize(root, "sibling.txt"), "PATH_ESCAPE");
});

test("a chain of exactly 40 symlink hops resolves; 41 hops fail with PATH_ESCAPE (FS-01)", (t) => {
  const { root, rootDir } = fixture(t);
  for (const links of [40, 41]) {
    const dir = join(rootDir, `chain-${links}`);
    mkdirSync(dir);
    for (let i = 1; i <= links; i += 1) {
      const target = i === links ? "../real.txt" : `link-${i + 1}`;
      symlinkSync(target, join(dir, `link-${i}`));
    }
  }
  assert.deepEqual(canonicalize(root, "chain-40/link-1"), {
    status: "found",
    realPath: join(rootDir, "real.txt"),
  });
  assertRejectsWith(() => canonicalize(root, "chain-41/link-1"), "PATH_ESCAPE");
});

test("a symlink loop fails with PATH_ESCAPE through the hop limit (FS-01)", (t) => {
  const { root, rootDir } = fixture(t);
  symlinkSync("loop-b", join(rootDir, "loop-a"));
  symlinkSync("loop-a", join(rootDir, "loop-b"));
  assertRejectsWith(() => canonicalize(root, "loop-a"), "PATH_ESCAPE");
});

test("a missing final segment is an absent result with the existing parent (FS-01)", (t) => {
  const { root, rootDir } = fixture(t);
  assert.deepEqual(canonicalize(root, "a/new.txt"), {
    status: "absent",
    nearest: join(rootDir, "a"),
    missing: ["new.txt"],
  });
});

test("a missing intermediate segment makes the whole path absent (FS-01)", (t) => {
  const { root, rootDir } = fixture(t);
  assert.deepEqual(canonicalize(root, "missing-dir/inner/new.txt"), {
    status: "absent",
    nearest: rootDir,
    missing: ["missing-dir", "inner", "new.txt"],
  });
});

test("a dot-dot walk out of the root and an absolute relative path are rejected with PATH_ESCAPE (FS-01)", (t) => {
  const { root, outside } = fixture(t);
  assertRejectsWith(() => canonicalize(root, "../outside/secret.txt"), "PATH_ESCAPE");
  assertRejectsWith(() => canonicalize(root, join(outside, "secret.txt")), "PATH_ESCAPE");
});

test("write mode refuses a symlink at the target even when it resolves inside the root (D-34)", (t) => {
  const { root, rootDir } = fixture(t);
  symlinkSync("real.txt", join(rootDir, "alias.txt"));
  assertRejectsWith(() => canonicalize(root, "alias.txt", { mode: "write" }), "PATH_ESCAPE");
  assert.deepEqual(canonicalize(root, "real.txt", { mode: "write" }), {
    status: "found",
    realPath: join(rootDir, "real.txt"),
  });
});

test("write mode still follows a symlink that is an intermediate directory (D-34)", (t) => {
  const { root, rootDir } = fixture(t);
  symlinkSync("a", join(rootDir, "dirlink"));
  assert.deepEqual(canonicalize(root, "dirlink/f.txt", { mode: "write" }), {
    status: "found",
    realPath: join(rootDir, "a", "f.txt"),
  });
});

test("openVerified refuses a symlink at the final component with PATH_ESCAPE (FS-02)", (t) => {
  const { rootDir } = fixture(t);
  symlinkSync("real.txt", join(rootDir, "alias.txt"));
  assertRejectsWith(() => openVerified(join(rootDir, "alias.txt")), "PATH_ESCAPE");
});

test("openCanonical opens an inside file whose descriptor reads its content (FS-01, FS-02)", (t) => {
  const { root } = fixture(t);
  const opened = openCanonical(root, "real.txt");
  if (opened.status !== "found") {
    throw new Error("expected the inside file to be found");
  }
  try {
    assert.equal(readFileSync(opened.fd, "utf8"), "inside");
  } finally {
    closeSync(opened.fd);
  }
});

test("a symlink swapped in at the resolve-to-open boundary is refused with PATH_ESCAPE (FS-02)", (t) => {
  const { root, outside } = fixture(t);
  const swapForSymlink = (realPath: string): void => {
    unlinkSync(realPath);
    symlinkSync(join(outside, "secret.txt"), realPath);
  };
  assertRejectsWith(
    () => openCanonical(root, "real.txt", { onResolveBoundary: swapForSymlink }),
    "PATH_ESCAPE",
  );
});

test("without /proc/self/fd the descriptor check fails closed with PATH_ESCAPE and is never skipped (FS-02)", (t) => {
  const { base, root } = fixture(t);
  const absentProc = join(base, "no-proc-fd");
  assertRejectsWith(() => openCanonical(root, "real.txt", { procFdDir: absentProc }), "PATH_ESCAPE");
  assertRejectsWith(
    () => openVerified(join(root.realPath, "real.txt"), absentProc),
    "PATH_ESCAPE",
  );
});

test("a FIFO swapped in at the resolve-to-open boundary is refused with PATH_ESCAPE and the open returns (FS-02)", (t) => {
  const { base, rootDir } = fixture(t);
  const fifo = join(base, "swap.fifo");
  createFifo(fifo);
  const outcome = runChild(FIFO_SWAP_SCRIPT, {
    rootUrl: new URL("../../src/fs/root.js", import.meta.url).href,
    canonicalizeUrl: new URL("../../src/fs/canonicalize.js", import.meta.url).href,
    rootDir,
    rel: "real.txt",
    fifo,
  });
  assert.deepEqual(outcome, { code: "PATH_ESCAPE" });
});

test("a failed descriptor close keeps the verification failure and records CLEANUP_FAILED as its cause (QUAL-01)", (t) => {
  const base = tempBase(t);
  const file = join(base, "inside.txt");
  writeFileSync(file, "inside");
  const absentProc = join(base, "no-proc-fd");
  assert.throws(
    () =>
      openVerified(file, absentProc, (fd) => {
        closeSync(fd);
        throw new Error("injected close failure");
      }),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "PATH_ESCAPE" &&
      error.causeCode === "CLEANUP_FAILED",
  );
});
