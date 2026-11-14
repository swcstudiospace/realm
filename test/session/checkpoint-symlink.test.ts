import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindRoot } from "../../src/fs/root.js";
import { snapshotWorkspace } from "../../src/session/checkpoint.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";
import { writeWorkspaceEntry } from "../../src/session/workspace-registry.js";

// Real directories under a temporary base, removed when the test ends. The workspace is base/ws, registered through the
// real registry under base/state, which lies outside the workspace root.
function fixture(t: TestContext) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-checkpoint-symlink-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  mkdirSync(ws);
  const stateRoot = join(base, "state");
  const entry = writeWorkspaceEntry(stateRoot, bindRoot(ws), sessionIdOfWorkspace(ws));
  return { ws, stateRoot, entry };
}

void test("a symlink whose target climbs through a regular file or loops is recorded by its literal target", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.ws, "a.txt"), "content");
  symlinkSync("a.txt/child", join(f.ws, "through-file"));
  symlinkSync("loop-b", join(f.ws, "loop-a"));
  symlinkSync("loop-a", join(f.ws, "loop-b"));

  const snapshot = await snapshotWorkspace({
    entry: f.entry,
    stateRoot: f.stateRoot,
    sandboxRunning: () => false,
    checkpointId: "c1",
  });

  const links = snapshot.manifest.entries.filter((entry) => entry.type === "symlink");
  assert.deepEqual(
    links.map((entry) => [entry.path, entry.linkTarget]),
    [
      ["loop-a", "loop-b"],
      ["loop-b", "loop-a"],
      ["through-file", "a.txt/child"],
    ],
  );
});
