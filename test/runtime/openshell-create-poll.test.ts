import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { ERROR_CATALOGUE, RealmError, type ErrorCode } from "../../src/core/errors.js";
import type { LibpodClient } from "../../src/runtime/libpod-client.js";
import {
  runOpenShellCreate,
  type SandboxCreateRequest,
} from "../../src/runtime/openshell.js";

// The create poll under scripted libpod answers. openshell.ts has no clock or delay parameter, so
// the test replaces the two sources it reads: performance.now (the deadline) and the global
// setTimeout (the 250 ms poll wait and the per-lookup bound). Each advance moves both clocks by the
// same amount, so no real time passes and every wait is driven by the test.

type LookupAnswer = readonly { readonly id: string }[] | Error;

const REQUEST: SandboxCreateRequest = {
  sessionId: "sess-poll",
  policyPath: "/state/runtime/sess-poll.policy.json",
  cpus: 1,
  memory: "512Mi",
  imageRef: "example.invalid/realm-sandbox@sha256:0000000000000000000000000000000000000000000000000000000000000000",
};

// A workload container of this session as OpenShell labels it: the sandbox role under the session's sandbox name.
function workloadOf(id: string): { readonly id: string; readonly labels: Readonly<Record<string, string>> } {
  return { id, labels: { "openshell.ai/isolation-role": "sandbox", "openshell.ai/sandbox-name": "realm-sess-poll" } };
}
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
      listContainersByLabel: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve([]);
        }
        const found = answer(calls - 1);
        if (found instanceof Error) {
          return Promise.reject(found);
        }
        // Each entry keeps its labels, as libpod reports them, so the lookup can select by sandbox name.
        return Promise.resolve([...found]);
      },
    },
    calls: () => calls,
  };
}

interface Run {
  value?: string;
  error?: unknown;
  readonly createCalls: () => number;
}

// Starts one create and records how it settles. The sandbox create succeeds at once and is counted.
function startCreate(containers: Pick<LibpodClient, "listContainersByLabel">, deadlineMs: number): Run {
  let createCalls = 0;
  const createSandbox = (): Promise<void> => {
    createCalls += 1;
    return Promise.resolve();
  };
  const run: Run = { createCalls: () => createCalls };
  runOpenShellCreate({ containers, createSandbox }, REQUEST, deadlineMs).then(
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

// Checks a refusal against its catalogue entry: the code, the catalogue reason text and the
// catalogue retryable flag. No custom reason or retryable value is allowed.
function assertCatalogued(refusal: RealmError, code: ErrorCode): void {
  const entry = ERROR_CATALOGUE[code];
  assert.equal(refusal.code, code);
  assert.equal(refusal.reason, entry.reason);
  assert.equal(refusal.retryable, entry.retryable);
}

// causeCode is present only when a libpod code was involved, so it is never an own property otherwise.
function assertNoCause(refusal: RealmError): void {
  assert.equal(
    Object.hasOwn(refusal, "causeCode"),
    false,
    "causeCode must be absent when no libpod code was involved",
  );
}

// The fields a caller reads (code, reason, causeCode) hold no forbidden text such as a container id
// or raw libpod text.
function assertNoLeak(refusal: RealmError, forbidden: readonly string[]): void {
  const surfaces: readonly string[] = [refusal.code, refusal.reason, refusal.causeCode ?? ""];
  for (const surface of surfaces) {
    for (const text of forbidden) {
      assert.ok(!surface.includes(text), `a refusal field must not carry "${text}"`);
    }
  }
}

void test("RT-03: an ambiguous label match is refused at once with no further poll and no container ids", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod(() => [workloadOf("ctr-secret-a"), workloadOf("ctr-secret-b")]);
  const run = startCreate(libpod.containers, 60_000);

  await settle();
  const refusal = refusalOf(run);
  assertCatalogued(refusal, "OPENSHELL_LABEL_AMBIGUOUS");
  assert.equal(refusal.retryable, false, "an ambiguous match must not be retryable");
  assertNoLeak(refusal, ["ctr-"]);
  assertNoCause(refusal);
  assert.equal(libpod.calls(), 2, "one pre-create lookup and exactly one poll");

  await advance(POLL_STEP_MS * 20);
  assert.equal(libpod.calls(), 2, "no poll runs after the ambiguity refusal");
});

void test("RT-03: an ambiguous match already present before create is refused without running the runner", async (t) => {
  useVirtualClock(t);
  const libpod = {
    containers: {
      listContainersByLabel: () => Promise.resolve([workloadOf("ctr-secret-a"), workloadOf("ctr-secret-b")]),
    },
  };
  const run = startCreate(libpod.containers, 60_000);

  await settle();
  const refusal = refusalOf(run);
  assertCatalogued(refusal, "OPENSHELL_LABEL_AMBIGUOUS");
  assertNoLeak(refusal, ["ctr-"]);
  assertNoCause(refusal);
  assert.equal(run.createCalls(), 0, "the create must not run when the session is already ambiguous");
});

void test("RT-03: a non-transient libpod error ends the poll at once and carries the last error code as causeCode", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod(() => new RealmError("SCHEMA_INVALID"));
  const run = startCreate(libpod.containers, 60_000);

  await settle();
  const refusal = refusalOf(run);
  assertCatalogued(refusal, "OPENSHELL_START_FAILED");
  assert.equal(refusal.causeCode, "SCHEMA_INVALID", "causeCode is the last libpod code");
  assertNoLeak(refusal, ["ctr-"]);
  assert.equal(libpod.calls(), 2, "the failing poll is the only poll");

  await advance(POLL_STEP_MS * 20);
  assert.equal(libpod.calls(), 2, "no poll runs after a non-transient failure");
});

void test("RT-03: an untyped libpod error ends the poll at once with no causeCode and no raw text", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod(() => new Error("raw libpod text naming ctr-raw"));
  const run = startCreate(libpod.containers, 60_000);

  await settle();
  const refusal = refusalOf(run);
  assertCatalogued(refusal, "OPENSHELL_START_FAILED");
  assertNoCause(refusal);
  assertNoLeak(refusal, ["ctr-", "raw libpod text"]);
  assert.equal(libpod.calls(), 2, "the failing poll is the only poll");

  await advance(POLL_STEP_MS * 20);
  assert.equal(libpod.calls(), 2, "no poll runs after a non-transient failure");
});

void test("RT-09: a transient libpod error followed by a found container succeeds with that container id", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod((poll) =>
    poll < 3 ? new RealmError("PODMAN_MACHINE_DOWN") : [workloadOf("ctr-found")],
  );
  const run = startCreate(libpod.containers, 60_000);

  await advanceUntilSettled(run, advance);
  assert.equal(run.error, undefined);
  assert.equal(run.value, "ctr-found");
  assert.equal(libpod.calls(), 4, "pre-create lookup, two transient polls, and the found poll");
  assert.equal(run.createCalls(), 1, "the create runs once");
});

void test("RT-09: a persistent transient libpod error ends at the deadline with the last error code as causeCode", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod(() => new RealmError("PODMAN_MACHINE_DOWN"));
  const run = startCreate(libpod.containers, 1000);

  await advanceUntilSettled(run, advance);
  const refusal = refusalOf(run);
  assertCatalogued(refusal, "OPENSHELL_START_FAILED");
  assert.equal(refusal.causeCode, "PODMAN_MACHINE_DOWN", "causeCode is the last libpod code");
  assertNoLeak(refusal, ["ctr-"]);
  assert.equal(libpod.calls(), 5, "pre-create lookup plus polls at 0, 250, 500 and 750 ms; none at the deadline");
});

void test("RT-09: a deadline with no libpod error names no libpod code", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod(() => []);
  const run = startCreate(libpod.containers, 500);

  await advanceUntilSettled(run, advance);
  const refusal = refusalOf(run);
  assertCatalogued(refusal, "OPENSHELL_START_FAILED");
  assertNoCause(refusal);
  assertNoLeak(refusal, ["ctr-"]);
});

void test("RT-09: an error code that appeared earlier is still carried as causeCode when the poll reaches the deadline", async (t) => {
  const advance = useVirtualClock(t);
  const libpod = scriptedLibpod((poll) => (poll === 1 ? new RealmError("PODMAN_MACHINE_DOWN") : []));
  const run = startCreate(libpod.containers, 1000);

  await advanceUntilSettled(run, advance);
  const refusal = refusalOf(run);
  assertCatalogued(refusal, "OPENSHELL_START_FAILED");
  assert.equal(refusal.causeCode, "PODMAN_MACHINE_DOWN", "causeCode is the earlier libpod code");
  assertNoLeak(refusal, ["ctr-"]);
});
