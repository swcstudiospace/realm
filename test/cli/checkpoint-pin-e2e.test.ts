// RES-04 end to end through the real control path. The daemon runs in this process (startRealmDaemon, the in-process
// harness the daemon e2e and HARN-02 tests share), the CLI is the real runCli entry, and the control socket is the real
// one. The scenario is: up for a workspace root holding one file, down, checkpoint create, change the workspace,
// checkpoint restore, up again. Each step asserts its own outcome, and the test stops at the first step that fails, so
// its message names that step.
//
// The checkpoint library proceeds only when the sandbox reports stopped, while the registry entry that names the session
// exists only while that session is live. Down removes the entry, so a checkpoint taken after a release has no success path.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliDeps } from "../../src/cli/main.js";
import { RealmError } from "../../src/core/errors.js";
import type { ControlReply } from "../../src/daemon/channel.js";
import { startRealmDaemon, type RealmDaemonFixture } from "../support/realm-daemon-fixture.js";
import { boundedWait, testTimeout } from "../support/timing.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CHECKPOINT_ID = "before-edit";
const SCENARIO_BOUND_MS = 60_000;
const DONE_BOUND_MS = 15_000;

interface Layout {
  readonly base: string;
  readonly workspace: string;
  readonly stateDir: string;
  readonly configHome: string;
  readonly daemons: RealmDaemonFixture[];
}

// One scratch directory holds the workspace (one file), the state directory outside it, and the runtime config that names
// the state directory. Every daemon started for the test is brought down before the directory is removed.
function layoutOf(t: TestContext): Layout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "rck-")));
  const daemons: RealmDaemonFixture[] = [];
  t.after(async () => {
    for (const running of daemons) {
      try {
        await running.down();
      } catch {
        // Already stopped by the test: its socket is gone, so the release is refused.
      }
    }
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "ws");
  const stateDir = join(base, "realm");
  const configHome = join(base, "config");
  mkdirSync(workspace);
  mkdirSync(join(configHome, "realm"), { recursive: true });
  writeFileSync(join(workspace, "a.txt"), "alpha\n");
  writeFileSync(
    join(configHome, "realm", "config.json"),
    JSON.stringify({ image: IMAGE, stateDir, workspaceRoot: workspace }),
  );
  return { base, workspace, stateDir, configHome, daemons };
}

// Runs one step's daemon call. A RealmError from the daemon fails the test with the step named and the catalogue code.
async function atStep<T>(step: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error: unknown) {
    const reason = error instanceof RealmError ? error.code : String(error);
    assert.fail(`${step}: ${reason}`);
  }
}

// The snapshot state a status-shaped reply names, or undefined when the reply carries none.
function stateOfReply(reply: ControlReply): unknown {
  const result: unknown = reply.result;
  if (typeof result !== "object" || result === null || !("snapshot" in result)) {
    return undefined;
  }
  const snapshot: unknown = result.snapshot;
  if (typeof snapshot !== "object" || snapshot === null || !("state" in snapshot)) {
    return undefined;
  }
  return snapshot.state;
}

void test("RES-04 e2e: up, down, checkpoint create, change, checkpoint restore, up again through the real control path", testTimeout(SCENARIO_BOUND_MS), async (t) => {
  const fx = layoutOf(t);
  const deps: CliDeps = { env: { HOME: join(fx.base, "home"), XDG_CONFIG_HOME: fx.configHome } };

  // Step 1: the realm comes up for the workspace root.
  const first = await startRealmDaemon({ stateDir: fx.stateDir, workspace: fx.workspace, mode: "advisory" });
  fx.daemons.push(first);
  const upClient = first.connectFor(fx.workspace);
  const up = await atStep("step 1 (up)", () => upClient.up());
  upClient.close();
  assert.equal(up.snapshot.state, "active", "step 1 (up): the realm must be active");

  // Step 2: the realm is released with down, and the daemon stops once its reply is written.
  const released = await atStep("step 2 (down)", () => first.release(fx.workspace));
  assert.equal(released.error, undefined, `step 2 (down): the daemon refused the release: ${JSON.stringify(released.error)}`);
  assert.equal(stateOfReply(released), "unbound", "step 2 (down): the release must answer unbound");
  await atStep("step 2 (down): the daemon stops after its reply", () => boundedWait(first.done, "daemon done", DONE_BOUND_MS));

  // Step 3: a checkpoint of the released session, through the CLI command the operator runs. This is the first step that
  // cannot succeed today: the CLI refuses before any daemon call.
  const created = await runCli(["checkpoint", "create", "--workspace", fx.workspace, "--id", CHECKPOINT_ID], deps);
  assert.equal(
    created.exitCode,
    0,
    `step 3 (checkpoint create after down): exit ${String(created.exitCode)}, stdout ${JSON.stringify(created.stdout)}, stderr ${JSON.stringify(created.stderr)}`,
  );
  assert.deepEqual(
    JSON.parse(created.stdout),
    { command: "create", checkpointId: CHECKPOINT_ID, entries: 1 },
    "step 3 (checkpoint create after down): the success line",
  );

  // Step 4: the workspace changes after the checkpoint.
  writeFileSync(join(fx.workspace, "a.txt"), "edited\n");
  writeFileSync(join(fx.workspace, "added.txt"), "new\n");
  assert.equal(readFileSync(join(fx.workspace, "a.txt"), "utf8"), "edited\n", "step 4 (change the workspace): the edit must land");

  // Step 5: the checkpoint is restored, and the workspace returns to the bytes it had when the checkpoint was taken.
  const restored = await runCli(["checkpoint", "restore", "--workspace", fx.workspace, "--id", CHECKPOINT_ID], deps);
  assert.equal(
    restored.exitCode,
    0,
    `step 5 (checkpoint restore): exit ${String(restored.exitCode)}, stdout ${JSON.stringify(restored.stdout)}, stderr ${JSON.stringify(restored.stderr)}`,
  );
  assert.deepEqual(
    JSON.parse(restored.stdout),
    { command: "restore", checkpointId: CHECKPOINT_ID, entries: 1 },
    "step 5 (checkpoint restore): the success line",
  );
  assert.equal(readFileSync(join(fx.workspace, "a.txt"), "utf8"), "alpha\n", "step 5 (checkpoint restore): the edited file must return");
  assert.equal(existsSync(join(fx.workspace, "added.txt")), false, "step 5 (checkpoint restore): the added file must be gone");

  // Step 6: the realm comes up again on a daemon started over the same state directory.
  const second = await startRealmDaemon({ stateDir: fx.stateDir, workspace: fx.workspace, mode: "advisory" });
  fx.daemons.push(second);
  const againClient = second.connectFor(fx.workspace);
  const upAgain = await atStep("step 6 (up again)", () => againClient.up());
  againClient.close();
  assert.equal(upAgain.snapshot.state, "active", "step 6 (up again): the realm must be active");
});
