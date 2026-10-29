import { after, test } from "node:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import fc from "fast-check";
import { RealmError } from "../../src/core/errors.js";
import { canonicalize, errnoOf, type CanonicalPath } from "../../src/fs/canonicalize.js";
import { bindRoot, isInsideRoot } from "../../src/fs/root.js";
import { LockTable } from "../../src/fs/locks.js";
import { lockedWrite } from "../../src/fs/write.js";
import { assertProperty } from "../support/property.js";

// QR-07 (D-1307): properties of canonicalize over a real directory tree under the temporary
// directory. The tree is built once; every property only reads it. Layout under <base>:
//   ws/            the pinned root: a/, a/b/, a/f (file), the links below, and two unicode spellings
//   ws2/x          a sibling whose name starts with the root's name
//   outside/s      a file outside the root
const NFC = "\u00e9";
const NFD = "e\u0301";

const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-canon-prop-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
const rootDir = join(base, "ws");
mkdirSync(rootDir);
mkdirSync(join(rootDir, "a", "b"), { recursive: true });
writeFileSync(join(rootDir, "a", "f"), "f");
mkdirSync(join(rootDir, NFC));
writeFileSync(join(rootDir, NFC, "k"), "k");
writeFileSync(join(rootDir, NFD), "d");
mkdirSync(join(base, "ws2"));
writeFileSync(join(base, "ws2", "x"), "x");
mkdirSync(join(base, "outside"));
writeFileSync(join(base, "outside", "s"), "s");
const LINKS: Readonly<Record<string, string>> = {
  in: "a",
  fl: "a/f",
  up: "..",
  up2: "../ws2",
  abs: join(base, "outside"),
  rel: "../outside/s",
  loop1: "loop2",
  loop2: "loop1",
  self: "self",
  chain0: "chain1",
};
for (const [name, target] of Object.entries(LINKS)) {
  symlinkSync(target, join(rootDir, name));
}
// A chain of 45 links ends at a directory inside the root: it exceeds MAX_SYMLINK_HOPS (40).
for (let i = 1; i < 45; i += 1) {
  symlinkSync(`chain${String(i + 1)}`, join(rootDir, `chain${String(i)}`));
}
symlinkSync("a", join(rootDir, "chain45"));
const root = bindRoot(rootDir);

// Links that stay inside the root resolve to their target; every other link is rejected.
const INSIDE_LINKS: Readonly<Record<string, string>> = { in: join(rootDir, "a"), fl: join(rootDir, "a", "f") };
// Prefixes that walk back to the root, so a link name placed after one is looked up in the root.
const ROOT_PREFIXES = ["", "./", "a/../", "in/../", "a/b/../../", "in//..//", "../ws/", "..//ws//./"];

const NAMES = ["a", "b", "f", "in", "fl", "up", "up2", "abs", "rel", "loop1", "self", "chain0", "new", "s", "ws2", "outside", "x", NFC, NFD];
// NUL bytes, backslashes, look-alike dots and slashes, bidi marks, percent-encoded separators.
const WEIRD = [
  "\0", "..\0", ".\0.", "a\0b", "\\", "..\\", "\\..", "a\\..\\..", "\uff0e\uff0e", "\u2024\u2024", "\u2025", "\u2026",
  "\uff0f", "\u2215", "\u200f", "..\u202e", ".\u200b.", "%2e%2e", "%2f", "..%2f", "~", "-", " ", ".. ", " ..",
];
const segment = fc.oneof(
  { weight: 6, arbitrary: fc.constant("..") },
  { weight: 3, arbitrary: fc.constant(".") },
  { weight: 2, arbitrary: fc.constant("") },
  { weight: 14, arbitrary: fc.constantFrom(...NAMES) },
  { weight: 3, arbitrary: fc.constantFrom(...WEIRD) },
  { weight: 1, arbitrary: fc.integer({ min: 200, max: 2000 }).map((n) => "n".repeat(n)) },
  // "binary" would cover every code point, but fast-check builds a million-entry table for it on first use.
  { weight: 2, arbitrary: fc.string({ unit: "binary-ascii", maxLength: 6 }) },
);
const separator = fc.constantFrom("/", "//", "///");
const relPath = fc
  .tuple(fc.array(fc.tuple(segment, separator), { maxLength: 8 }), fc.boolean())
  .map(([parts, trailing]) =>
    parts.map(([name, sep], index) => (index === parts.length - 1 && !trailing ? name : name + sep)).join(""),
  );
const modes = fc.constantFrom("read", "write");

type Outcome = { readonly kind: "ok"; readonly result: CanonicalPath } | { readonly kind: "rejected" };

// PATH_ESCAPE is the only accepted refusal; any other error fails the property.
function attempt(path: string, mode: "read" | "write"): Outcome {
  try {
    return { kind: "ok", result: canonicalize(root, path, { mode }) };
  } catch (error: unknown) {
    if (error instanceof RealmError && error.code === "PATH_ESCAPE") {
      return { kind: "rejected" };
    }
    throw error;
  }
}

// Independent of isInsideRoot: a literal prefix test on a path that holds no ".." segment.
function insideOracle(path: string): boolean {
  if (path === root.realPath) {
    return true;
  }
  const prefix = `${root.realPath}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).split("/").includes("..");
}

function acceptedTarget(result: CanonicalPath): string {
  return result.status === "found" ? result.realPath : join(result.nearest, ...result.missing);
}

// Names, types, link targets, sizes and modification times of everything under <base>, never following a link.
function snapshot(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      const stats = lstatSync(path);
      const kind = stats.isSymbolicLink()
        ? `link:${readlinkSync(path)}`
        : stats.isDirectory()
          ? "dir"
          : `file:${String(stats.size)}`;
      return [`${relative(base, path)} ${kind} ${String(stats.mtimeMs)}`, ...(stats.isDirectory() ? snapshot(path) : [])];
    });
}

void test("QR-07: no accepted path escapes the root, in read or write mode", () => {
  assertProperty(
    fc.property(relPath, modes, (path, mode) => {
      const outcome = attempt(path, mode);
      if (outcome.kind === "ok") {
        assert.ok(insideOracle(acceptedTarget(outcome.result)), `accepted a path outside the root for ${JSON.stringify(path)}`);
      }
    }),
  );
});

void test("QR-07: an absolute relPath is always rejected", () => {
  assertProperty(fc.property(relPath, modes, (path, mode) => {
    assert.equal(attempt(`/${path}`, mode).kind, "rejected");
  }));
});

void test("QR-07: canonicalize agrees with the kernel's realpath wherever the kernel resolves the path", () => {
  assertProperty(
    fc.property(relPath, (path) => {
      fc.pre(!isAbsolute(path));
      const outcome = attempt(path, "read");
      let kernel: string;
      try {
        // realpath(3) takes the string as written, so "up/.." is resolved by the kernel, not by path.join.
        kernel = realpathSync.native(`${root.realPath}/${path}`);
      } catch (error: unknown) {
        // A loop is the one failure with a fixed expectation: the walk must refuse it too.
        if (errnoOf(error) === "ELOOP") {
          assert.equal(outcome.kind, "rejected");
        }
        return;
      }
      if (insideOracle(kernel)) {
        assert.deepEqual(outcome, { kind: "ok", result: { status: "found", realPath: kernel } });
      } else {
        assert.equal(outcome.kind, "rejected");
      }
    }),
  );
});

void test("QR-07: a NUL in a segment that the walk looks up is rejected", () => {
  const word = fc.stringMatching(/^[a-z0-9]{0,4}$/);
  const nulName = fc.tuple(word, word).map(([head, tail]) => `${head}\0${tail}`);
  assertProperty(
    fc.property(fc.constantFrom("", "a/", "a/b/", "in/", "./", "a/../"), nulName, modes, (prefix, name, mode) => {
      assert.equal(attempt(`${prefix}${name}`, mode).kind, "rejected");
    }),
  );
});

void test("QR-07: a NUL after a missing segment is reported absent and is never a write target", () => {
  // FINDING (see the pull request): the walk does not look a segment up once an earlier one is missing,
  // so "new/\0x" is accepted as absent with two missing segments. Nothing reaches a system call, and
  // lockedWrite creates only when exactly one segment is missing, so the input cannot create anything.
  assert.deepEqual(attempt("new/\0x", "read"), {
    kind: "ok",
    result: { status: "absent", nearest: root.realPath, missing: ["new", "\0x"] },
  });
  const before = snapshot(base);
  assertProperty(
    fc.property(
      fc.constantFrom("new", "nope", "a/new", "in/new", "a/b/new"),
      fc.stringMatching(/^[a-z0-9]{0,4}$/),
      (missing, tail) => {
        assert.throws(
          () => lockedWrite(root, `${missing}/\0${tail}`, "data", { owner: "A", locks: new LockTable(), credentialAllow: [] }),
          (error: unknown) => error instanceof RealmError && error.code === "PATH_ESCAPE",
        );
      },
    ),
    { numRuns: 100 },
  );
  assert.deepEqual(snapshot(base), before);
});

void test("QR-07: an absent result names a real directory inside the root and clean missing segments", () => {
  assertProperty(
    fc.property(relPath, modes, (path, mode) => {
      const outcome = attempt(path, mode);
      if (outcome.kind !== "ok" || outcome.result.status !== "absent") {
        return;
      }
      const { nearest, missing } = outcome.result;
      assert.ok(insideOracle(nearest), "nearest lies outside the root");
      assert.equal(realpathSync(nearest), nearest, "nearest is not a real path");
      assert.ok(missing.length > 0, "an absent result with no missing segment");
      for (const [index, name] of missing.entries()) {
        assert.ok(name !== "" && name !== "." && name !== ".." && !name.includes("/"), `bad missing segment ${JSON.stringify(name)}`);
        // Only a segment after the first missing one skips the lookup, so only there may a NUL survive.
        assert.ok(!name.includes("\0") || index > 0, "the first missing segment holds a NUL");
      }
    }),
  );
});

void test("QR-07: canonicalizing an accepted result's relative form returns the same result", () => {
  assertProperty(
    fc.property(relPath, modes, (path, mode) => {
      const outcome = attempt(path, mode);
      if (outcome.kind !== "ok") {
        return;
      }
      const again = attempt(relative(root.realPath, acceptedTarget(outcome.result)), mode);
      assert.deepEqual(again, outcome);
    }),
  );
});

void test("QR-07: a link at the final segment is refused in write mode and followed only inside the root in read mode", () => {
  const prefix = fc.constantFrom(...ROOT_PREFIXES);
  assertProperty(
    fc.property(prefix, fc.constantFrom(...Object.keys(LINKS)), (head, link) => {
      assert.equal(attempt(`${head}${link}`, "write").kind, "rejected");
      const outcome = attempt(`${head}${link}`, "read");
      const target = INSIDE_LINKS[link];
      if (target === undefined) {
        assert.equal(outcome.kind, "rejected");
      } else {
        assert.deepEqual(outcome, { kind: "ok", result: { status: "found", realPath: target } });
      }
    }),
  );
});

void test("QR-07: unicode spellings are bytewise, so NFC and NFD name different entries", () => {
  assert.deepEqual(attempt(NFC, "read"), { kind: "ok", result: { status: "found", realPath: join(rootDir, NFC) } });
  assert.deepEqual(attempt(NFD, "read"), { kind: "ok", result: { status: "found", realPath: join(rootDir, NFD) } });
  assert.deepEqual(attempt(`${NFC}/k`, "read"), { kind: "ok", result: { status: "found", realPath: join(rootDir, NFC, "k") } });
  // The NFD spelling is a file, so nothing lies below it.
  const below = attempt(`${NFD}/k`, "read");
  assert.ok(below.kind === "ok" && below.result.status === "absent");
});

void test("QR-07: isInsideRoot is true for the root and its descendants and false for siblings and escapes", () => {
  const name = fc.stringMatching(/^[a-z0-9]{1,8}$/).filter((value) => value !== "ws");
  const suffix = fc.stringMatching(/^[a-z0-9._-]{1,5}$/);
  assertProperty(
    fc.property(name, suffix, (child, extra) => {
      assert.equal(isInsideRoot(root, root.realPath), true);
      assert.equal(isInsideRoot(root, `${root.realPath}/${child}`), true);
      assert.equal(isInsideRoot(root, `${root.realPath}${extra}`), false);
      assert.equal(isInsideRoot(root, `${root.realPath}/../${child}`), false);
    }),
  );
});

void test("QR-07: rejected and accepted inputs leave the whole temporary tree untouched", () => {
  const before = snapshot(base);
  assertProperty(
    fc.property(relPath, modes, (path, mode) => {
      attempt(path, mode);
    }),
  );
  assert.deepEqual(snapshot(base), before);
});
