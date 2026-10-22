import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { findHostPaths } from "./host-paths.mjs";

// Built at runtime so this file contains no literal host-path forms.
const absolute = (...segments) => `/${segments.join("/")}`;

async function withFixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), "host-paths-"));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const target = join(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("flags root, tmp, Users, and home host paths with location", async () => {
  const content = [
    `cache at ${absolute("root", "x")}`,
    `scratch ${absolute("tmp", "x")}`,
    `mac ${absolute("Users", "x")}`,
    `linux ${absolute("home", "x", "")}`,
    "",
  ].join("\n");

  await withFixture({ "README.md": content }, async (root) => {
    const hits = await findHostPaths({ root });
    assert.deepEqual(
      hits.map((hit) => [hit.file, hit.line, hit.match]),
      [
        ["README.md", 1, absolute("root", "x")],
        ["README.md", 2, absolute("tmp", "x")],
        ["README.md", 3, absolute("Users", "x")],
        ["README.md", 4, absolute("home", "x", "")],
      ],
    );
    assert.equal(hits[0].column, "cache at ".length + 1);
  });
});

test("does not flag bare mentions or non-host system paths", async () => {
  const content = [
    `bare ${absolute("root", ",")}`,
    `code span ${absolute("root", "`")}`,
    `trailing ${absolute("root", "")}`,
    `system ${absolute("usr", "bin", "node")}`,
    "",
  ].join("\n");

  await withFixture({ "docs/notes.md": content }, async (root) => {
    assert.deepEqual(await findHostPaths({ root }), []);
  });
});

test("skips files under dist, node_modules, and .git in the fixture tree", async () => {
  const flagged = `${absolute("root", "x")}\n`;
  await withFixture(
    {
      "docs/dist/build.md": flagged,
      "docs/node_modules/pkg/readme.md": `${absolute("tmp", "x")}\n`,
      "docs/.git/notes.md": `${absolute("Users", "x")}\n`,
      "docs/guide.md": `${absolute("home", "x", "")}\n`,
    },
    async (root) => {
      const hits = await findHostPaths({ root });
      assert.deepEqual(
        hits.map((hit) => [hit.file, hit.line, hit.match]),
        [["docs/guide.md", 1, absolute("home", "x", "")]],
      );
    },
  );
});

test("scans assets only for svg files", async () => {
  await withFixture(
    {
      "assets/logo.svg": `<text>${absolute("root", "x")}</text>\n`,
      "assets/notes.md": `${absolute("tmp", "x")}\n`,
    },
    async (root) => {
      const hits = await findHostPaths({ root });
      assert.deepEqual(
        hits.map((hit) => [hit.file, hit.match]),
        [["assets/logo.svg", absolute("root", "x")]],
      );
    },
  );
});
