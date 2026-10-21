import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { RealmError } from "../../src/core/errors.js";
import type { LibpodClient } from "../../src/runtime/libpod-client.js";
import {
  runOpenShellCreate,
  type OpenShellRunner,
  type SandboxCreateRequest,
} from "../../src/runtime/openshell.js";

// The create poll under scripted libpod answers. openshell.ts has no clock or delay parameter, so
// the test replaces the two sources it reads: performance.now (the deadline) and the global
// setTimeout (the 250 ms poll wait and the per-lookup bound). Each advance moves both clocks by the
// same amount, so no real time passes and every wait is driven by the test.

type LookupAnswer = readonly { readonly id: string }[] | RealmError;

const REQUEST: SandboxCreateRequest = {
  sessionId: "sess-poll",
  policyPath: "/state/runtime/sess-poll.policy.json",
  cpus: 1,
  memory: "512m",
  workloadArgv: ["/usr/bin/agent", "--serve"],
};
const POLL_STEP_MS = 250;
const LOOKUP_CAP = 100;

// The Promise executor form is used because tsconfig's ES2023 lib has no Promise.withResolvers.
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

// Installs the virtual clock for one test. The returned advance moves time and fires any poll wait
// that is now due, then lets the resulting promise chain run to its next await.
function useVirtualClock(t: TestContext): (ms: number) => Promise<void> {
  let nowMs = 0;
  t.mock.method(performance, "now", () => nowMs);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return async (ms: number): Promise<void> => {
    nowMs += ms;
    t.mock.timers.tick(ms);
    await settle();
  };
}

// The lookup script. Call 1 is the pre-create lookup, which finds nothing. Call n+1 is poll n and
// takes answer(n). Every call is counted, so a test can prove exactly how many polls ran.
function scriptedLibpod(answer: (poll: number) => LookupAnswer): {
  readonly containers: Pick<LibpodClient, "listContainersByLabel">;
  readonly calls: () => number;
} {
  let calls = 0;
  return {
    containers: {
      listContainersByLabel: async () => {
        calls += 1;
        if (calls === 1) {
          return [];
        }
        const found = answer(calls - 1);
        if (found instanceof RealmError) {
          throw found;
        }
        return found.map((entry) => ({ id: entry.id }));
      },
    },
    calls: () => calls,
  };
}

interface Run {
  value?: string;
  error?: unknown;
  readonly runnerCalls: () => number;
}

// Starts one create and records how it settles. The runner succeeds at once and is counted.
function startCreate(containers: Pick<LibpodClient, "listContainersByLabel">, deadlineMs: number): Run {
  let runnerCalls = 0;
  const runner: OpenShellRunner = async () => {
    runnerCalls += 1;
    return { exitCode: 0 };
  };
  const run: Run = { runnerCalls: () => runnerCalls };
  runOpenShellCreate({ containers, runner }, REQUEST, deadlineMs).then(
    (value) => {
      run.value = value;
    },
    (error: unknown) => {
      run.error = error;
    },
  );
  return run;
}

// Advances in poll-sized steps until the create settles or the step cap is reached.
async function advanceUntilSettled(run: Run, advance: (ms: number) => Promise<void>): Promise<void> {
  await settle();
  for (let step = 0; step < LOOKUP_CAP && run.value === undefined && run.error === undefined; step += 1) {
    await advance(POLL_STEP_MS);
  }
}

function refusalOf(run: Run): RealmError {
  assert.ok(run.error instanceof RealmError, "the create must be refused with a typed error");
  return run.error;
}

test("RT-03: an ambiguous label match is refused at once with no further poll and no container ids", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod(() => [{ id: "ctr-secret-a" }, { id: "ctr-secret-b" }]);
  const run = startCreate(libpod.containers, 60_000);

  await settle();
  const refusal = refusalOf(run);
  assert.equal(refusal.code, "OPENSHELL_START_FAILED");
  assert.equal(refusal.retryable, false, "an ambiguous match must not be retryable");
  assert.match(refusal.reason, /more than one container matches this session's label/);
  assert.ok(!refusal.reason.includes("ctr-secret"), "the reason must not name container ids");
  assert.equal(libpod.calls(), 2, "one pre-create lookup and exactly one poll");

  await advance(POLL_STEP_MS * 20);
  assert.equal(libpod.calls(), 2, "no poll runs after the ambiguity refusal");
});

test("RT-03: an ambiguous match already present before create is refused without running the runner", async (t) => {
  useVirtualClock(t);
  const libpod = {
    containers: {
      listContainersByLabel: async () => [{ id: "ctr-secret-a" }, { id: "ctr-secret-b" }],
    },
  };
  const run = startCreate(libpod.containers, 60_000);

  await settle();
  const refusal = refusalOf(run);
  assert.equal(refusal.code, "OPENSHELL_START_FAILED");
  assert.equal(refusal.retryable, false);
  assert.equal(run.runnerCalls(), 0, "the create argv must not run when the session is already ambiguous");
});

test("RT-03: a non-transient libpod error ends the poll at once and names the last error code", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod(() => new RealmError("SCHEMA_INVALID"));
  const run = startCreate(libpod.containers, 60_000);

  await settle();
  const refusal = refusalOf(run);
  assert.equal(refusal.code, "OPENSHELL_START_FAILED");
  assert.equal(
    refusal.reason,
    "OpenShell start stopped: the libpod container lookup failed and retrying will not help. Last libpod error: SCHEMA_INVALID, kind non-transient.",
  );
  assert.equal(libpod.calls(), 2, "the failing poll is the only poll");

  await advance(POLL_STEP_MS * 20);
  assert.equal(libpod.calls(), 2, "no poll runs after a non-transient failure");
});

test("RT-09: a transient libpod error followed by a found container succeeds with that container id", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod((poll) =>
    poll < 3 ? new RealmError("PODMAN_MACHINE_DOWN") : [{ id: "ctr-found" }],
  );
  const run = startCreate(libpod.containers, 60_000);

  await advanceUntilSettled(run, advance);
  assert.equal(run.error, undefined);
  assert.equal(run.value, "ctr-found");
  assert.equal(libpod.calls(), 4, "pre-create lookup, two transient polls, and the found poll");
  assert.equal(run.runnerCalls(), 1, "the create argv runs once");
});

test("RT-09: a persistent transient libpod error ends at the deadline with the last error code in the reason", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod(() => new RealmError("PODMAN_MACHINE_DOWN"));
  const run = startCreate(libpod.containers, 1000);

  await advanceUntilSettled(run, advance);
  const refusal = refusalOf(run);
  assert.equal(refusal.code, "OPENSHELL_START_FAILED");
  assert.equal(
    refusal.reason,
    "OpenShell start did not show its container before the deadline. Last libpod error: PODMAN_MACHINE_DOWN, kind transient.",
  );
  assert.equal(libpod.calls(), 5, "pre-create lookup plus polls at 0, 250, 500 and 750 ms; none at the deadline");
});

test("RT-09: a deadline with no libpod error names no libpod code", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod(() => []);
  const run = startCreate(libpod.containers, 500);

  await advanceUntilSettled(run, advance);
  const refusal = refusalOf(run);
  assert.equal(refusal.code, "OPENSHELL_START_FAILED");
  assert.equal(refusal.reason, "OpenShell start did not show its container before the deadline.");
});

test("RT-09: an error code that appeared earlier is still named when the poll later reaches the deadline", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod((poll) => (poll === 1 ? new RealmError("PODMAN_MACHINE_DOWN") : []));
  const run = startCreate(libpod.containers, 1000);

  await advanceUntilSettled(run, advance);
  const refusal = refusalOf(run);
  assert.equal(
    refusal.reason,
    "OpenShell start did not show its container before the deadline. Last libpod error: PODMAN_MACHINE_DOWN, kind transient.",
  );
});
