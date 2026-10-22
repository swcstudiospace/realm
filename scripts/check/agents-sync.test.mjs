import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkAgentsSync } from "./agents-sync.mjs";

const VALID_AGENTS = [
  "# Agents",
  "",
  "## Commands",
  "",
  "- npm test",
  "",
  "## Versioning and release",
  "",
  "Version is owned by the release job.",
  "",
  "## Merge and release flow",
  "",
  "Merge after the gates are green.",
  "",
].join("\n");

const VALID_CLAUDE = ["# Claude", "", "  @AGENTS.md  ", ""].join("\n");

async function withFiles(files, run) {
  const root = await mkdtemp(join(tmpdir(), "agents-sync-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(root, name), content, "utf8");
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("passes for a valid AGENTS.md and CLAUDE.md pair", async () => {
  await withFiles({ "AGENTS.md": VALID_AGENTS, "CLAUDE.md": VALID_CLAUDE }, async (root) => {
    assert.deepEqual(await checkAgentsSync({ root }), []);
  });
});

test("reports a missing required heading", async () => {
  const agents = VALID_AGENTS.replace("## Merge and release flow", "## Merge flow");
  await withFiles({ "AGENTS.md": agents, "CLAUDE.md": VALID_CLAUDE }, async (root) => {
    assert.deepEqual(await checkAgentsSync({ root }), [
      'AGENTS.md must contain "## Merge and release flow" exactly once (found 0)',
    ]);
  });
});

test("reports a CLAUDE.md without the @AGENTS.md line", async () => {
  await withFiles(
    { "AGENTS.md": VALID_AGENTS, "CLAUDE.md": "# Claude\n\nSee @AGENTS.md for details.\n" },
    async (root) => {
      assert.deepEqual(await checkAgentsSync({ root }), [
        'CLAUDE.md must contain a line "@AGENTS.md"',
      ]);
    },
  );
});

test("reports a CLAUDE.md that repeats the Commands heading", async () => {
  const claude = `${VALID_CLAUDE}\n## Commands\n\n- npm test\n`;
  await withFiles({ "AGENTS.md": VALID_AGENTS, "CLAUDE.md": claude }, async (root) => {
    assert.deepEqual(await checkAgentsSync({ root }), [
      'CLAUDE.md must not contain "## Commands"',
    ]);
  });
});

test("reports missing AGENTS.md and CLAUDE.md files", async () => {
  await withFiles({}, async (root) => {
    assert.deepEqual(await checkAgentsSync({ root }), [
      "AGENTS.md is missing",
      "CLAUDE.md is missing",
    ]);
  });
});
