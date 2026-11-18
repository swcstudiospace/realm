// The direct cold attach probe against the production stack (33-03 Task 2; COLD-02, COLD-04).
//
// `realm mcp --host claude` is started for a new project directory that nothing has started: no daemon of this scenario, no sandbox.
// One connection is held open and three things are shown on it (test/support/cold-attach-probe.ts):
//   1  the handshake (server/discover, initialize, tools/list) is answered within seconds while `realm status` is not active;
//   2  tool calls sent in the window are refused REALM_NOT_ACTIVE, an error with retryable true;
//   3  the same process serves a call once the session is active (status polled every 2 s, then a list of the workspace root),
//      the daemon counts an attached boot report for the host, the presence marker of the child exists, and after the input is
//      closed the child exits 0 and the marker is gone.
// The pure judge of the timeline is covered hermetically by test/integration/cold-attach-probe-helpers.test.ts.
//
// Gate. The file skips, naming the first missing prerequisite, unless REALM_LIVE_PRODUCTION=1 and the production prerequisites hold
// (productionSkipReason): the opt-in, Podman 5.x, the digest-pinned image, the driver config and socket, a rootless Podman socket, the
// openshell CLI and the built CLI. The test never sets any of them. No host binary is needed: the probe starts the realm CLI itself, and
// installs no recipe and writes no receipt.
//
// Removal scope. The scenario builds its own configuration home. The project directory is new and under the pinned workspace root, so
// its sandbox is the only one the run creates. The cleanup runs realm down for the project, restores the operator's shared policy,
// removes the state the run created, removes the presence directory the run created, removes the project directory and waits for
// zero containers and sandboxes of its name. A realm daemon is never signalled.
//
// Diagnostics carry milliseconds, counts, states and catalogue codes: no path, no token, no header value.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { judgeColdTimeline, runColdAttachProbe } from "../support/cold-attach-probe.js";
import { createCleanups } from "../support/omp-live.js";
import {
  createScenarioEnvironment,
  describeResult,
  describeValue,
  isDirectory,
  isSocket,
  listSandboxContainers,
  onPath,
  probePodman,
  productionSkipReason,
  readLiveInputs,
  realmCliWithWorkspace,
  removeSharedStateCreatedBy,
  restoreSharedPolicy,
  sandboxNameFor,
  waitForNoResidue,
  type LiveInputs,
} from "../support/production-live.js";

// The compiled CLI beside the compiled tests: this file runs from dist/test/integration, the CLI from dist/src/cli.
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));

const gate = productionSkipReason({
  env: process.env,
  podman: await probePodman(),
  isSocket,
  onPath: (name) => onPath(name, process.env["PATH"]),
  exists: existsSync,
  isDirectory,
  cliPath: CLI_PATH,
});
const live: LiveInputs | undefined = gate === false ? readLiveInputs(process.env, CLI_PATH) : undefined;

// The probe's own bounds sum to under this: the handshake wait, the 240 s ready bound, the boot report wait and the exit wait.
const PROBE_TEST_TIMEOUT_MS = 900_000;
const DOWN_TIMEOUT_MS = 120_000;
const PROBE_HOST = "claude";

void test(
  "the cold attach probe: the handshake is answered while the realm is not active, calls in the window are refused retryable, and the same connection serves after ready",
  { skip: gate, timeout: PROBE_TEST_TIMEOUT_MS },
  async (t) => {
    if (live === undefined) {
      throw new Error("the cold attach probe ran although its gate is closed");
    }
    const inputs = live;
    const hostsDir = inputs.driverStateDir === undefined ? undefined : join(inputs.driverStateDir, "hosts");
    const hostsDirExisted = hostsDir !== undefined && existsSync(hostsDir);
    const presenceDirExisted = hostsDir !== undefined && existsSync(join(hostsDir, `${PROBE_HOST}-active`));

    const scenario = createScenarioEnvironment(inputs, { image: inputs.image });
    const projectDir = join(inputs.workspaceRoot, `cold-probe-${randomBytes(6).toString("hex")}`);
    // The directory must exist first: sandboxNameFor resolves its real path. The cleanup runs realm down only while it exists.
    mkdirSync(projectDir);
    const sandboxes = [sandboxNameFor(projectDir)];

    const cleanups = createCleanups();
    t.after(() => cleanups.run());
    cleanups.add(async () => {
      // Every step runs even when an earlier one fails; the failures are reported together at the end.
      const failures: unknown[] = [];
      const step = async (work: () => void | Promise<void>): Promise<void> => {
        try {
          await work();
        } catch (error) {
          failures.push(error);
        }
      };
      await step(async () => {
        if (existsSync(projectDir)) {
          const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
          assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
        }
      });
      await step(() => {
        restoreSharedPolicy(scenario);
      });
      await step(() => {
        removeSharedStateCreatedBy(scenario);
      });
      await step(() => {
        if (hostsDir !== undefined) {
          // Only what this run created: nothing that existed before is removed.
          if (!presenceDirExisted) {
            rmSync(join(hostsDir, `${PROBE_HOST}-active`), { recursive: true, force: true });
          }
          if (!hostsDirExisted) {
            rmSync(hostsDir, { recursive: true, force: true });
          }
        }
      });
      await step(() => {
        rmSync(projectDir, { recursive: true, force: true });
        rmSync(scenario.root, { recursive: true, force: true });
      });
      await step(async () => {
        const residue = await waitForNoResidue(inputs, sandboxes);
        assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
      });
      if (failures.length > 0) {
        throw new AggregateError(failures, `cold attach probe cleanup: ${failures.map((failure) => (failure instanceof Error ? failure.message : String(failure))).join("; ")}`);
      }
    });

    const result = await runColdAttachProbe({ inputs, scenario, projectDir });
    for (const entry of result.marks) {
      t.diagnostic(`cold probe: ${entry.step} at ${String(entry.ms)} ms`);
    }
    const { timeline } = result;
    t.diagnostic(
      `cold probe timeline: handshake replies [${String(timeline.replyMs.discover)}, ${String(timeline.replyMs.initialize)}, ${String(timeline.replyMs.toolsList)}] ms, ` +
        `status at reply ${timeline.statusAtReply ?? "none"}, ${String(timeline.refusals.length)} refusals, first success ${String(timeline.firstSuccessMs)} ms, ` +
        `${String(timeline.polls)} polls, child exited early ${String(timeline.childExited)}, elapsed ${String(timeline.elapsedMs)} ms`,
    );

    const verdict = judgeColdTimeline(timeline);
    if (verdict.pass) {
      for (const fact of verdict.facts) {
        t.diagnostic(`cold probe fact: ${fact}`);
      }
    }
    assert.ok(verdict.pass, `${verdict.pass ? "" : verdict.message}; realm mcp stderr ${JSON.stringify(result.stderr)}`);

    const { afterReady } = result;
    assert.ok(afterReady !== undefined, "the probe must have run its after-ready steps");
    t.diagnostic(`cold probe after ready: list ${afterReady.listOutcome}, boot reports ${JSON.stringify(afterReady.bootPhases)}`);
    assert.equal(afterReady.listOutcome, "done", "the same connection must serve a list of the workspace root once the session is active");
    assert.ok(afterReady.attachedBoots >= 1, `the daemon must count an attached boot report for ${PROBE_HOST}: ${JSON.stringify(afterReady.bootPhases)}`);
    assert.equal(afterReady.presenceMarkerPresent, true, "the presence marker of the child must exist while the session is attached");
    assert.deepEqual(afterReady.exit, { code: 0, signal: null }, `the child must exit 0 within 10 s of its input closing: ${describeValue(afterReady.exit)}`);
    assert.equal(afterReady.presenceMarkerGone, true, "the presence marker must be gone once the child has exited");

    const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
    assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
    rmSync(projectDir, { recursive: true, force: true });
    const residue = await waitForNoResidue(inputs, sandboxes);
    assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
    for (const sandbox of sandboxes) {
      const containers = await listSandboxContainers(inputs, sandbox);
      assert.ok(containers.ok, `list the containers of ${sandbox} after realm down: ${describeValue(containers)}`);
      assert.deepEqual(containers.items, [], `no container of ${sandbox} may remain after realm down`);
    }
  },
);
