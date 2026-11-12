import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";
import { currentBootId } from "../../src/session/proc-identity.js";
import { groupHasMembers, runnerRecordOf, stopRecordedRunner } from "../../src/session/runner-record.js";

// The leader starts a grandchild that stays in the leader's group, then exits after 0.5 s. The record is taken right after
// spawn, while the leader is still alive, so the grandchild outlives the leader the stop path sees.
const LEADER_SCRIPT = "sleep 600 & sleep 0.5";
const GRACE_MS = 200;

void test("stopping a recorded runner kills group members that outlive their exited leader", async () => {
  const leader = spawn("sh", ["-c", LEADER_SCRIPT], { detached: true, stdio: "ignore" });
  const pid = leader.pid;
  assert.ok(pid !== undefined);
  try {
    const record = runnerRecordOf(pid, currentBootId() ?? "test-boot");
    assert.ok(record !== null);
    await once(leader, "exit");
    assert.equal(groupHasMembers(pid), true, "the grandchild is still in the group once the leader has exited");

    assert.equal(await stopRecordedRunner(record, GRACE_MS, groupHasMembers), true);
    assert.equal(groupHasMembers(pid), false, "no member of the recorded group survives the stop");
  } finally {
    if (groupHasMembers(pid)) {
      process.kill(-pid, "SIGKILL");
    }
  }
});
