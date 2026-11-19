// F-46-1 (Phase 46): a session end whose libpod container stop (or force removal) request misses its request bound while the
// container is still stopping must not report AGENTOS_STOP_FAILED when the container then ends inside a bounded confirmation
// wait. The wait is fail closed: a container still live at its bound, an unreadable state, and a failure that is not a missed
// bound all keep the failed step. In-process stand-ins and a mock setTimeout clock only: no Podman, no gateway, no real sleep.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { makeRealmError, RealmError, type ErrorCode } from "../../src/core/errors.js";
import type { LibpodInspect } from "../../src/runtime/libpod-client.js";
import { TEARDOWN_TIMEOUT_MS } from "../../src/lifecycle/bounds.js";
import { realmSandboxName, type OpenShellRunner } from "../../src/runtime/openshell.js";
import { SessionExecution, type SessionContainers } from "../../src/runtime/session-execution.js";
import {
  CONTAINER_CONFIRM_POLL_MS,
  CONTAINER_END_CONFIRM_MS,
  SESSION_END_WORST_CASE_MS,
} from "../../src/runtime/teardown-stages.js";

const SESSION = "session-confirm";
const CONTAINER = "container-under-test";
const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CONFIRM_BOUND_MS = CONTAINER_END_CONFIRM_MS;

type InspectAnswer = LibpodInspect | null | "reject";

function status(value: string): LibpodInspect {
  return { State: { Status: value, Running: value === "running" || value === "stopping" } };
}

function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

interface Rig {
  readonly exec: SessionExecution;
  readonly inspectCalls: () => number;
  readonly deleteCalls: () => number;
  readonly settleWith: (work: Promise<unknown>) => { readonly done: () => boolean; readonly error: () => unknown; readonly atMs: () => number };
  readonly advance: (ms: number) => Promise<void>;
}

// answers: what inspectContainer returns on each call in turn (the last repeats). requestFailure: what the stop or removal
// request rejects with, or undefined when it succeeds.
function rig(t: TestContext, answers: readonly InspectAnswer[], requestFailure: ErrorCode | undefined): Rig {
  let inspects = 0;
  let deletes = 0;
  const libpod: SessionContainers = {
    info: () => Promise.reject(new Error("the stop path called info")),
    listContainersByLabel: () => Promise.reject(new Error("the stop path called listContainersByLabel")),
    inspectContainer: () => {
      const answer = answers[Math.min(inspects, answers.length - 1)];
      inspects += 1;
      return answer === "reject" ? Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN")) : Promise.resolve(answer ?? null);
    },
    stopContainer: () => (requestFailure === undefined ? Promise.resolve() : Promise.reject(makeRealmError(requestFailure))),
    removeContainer: () => (requestFailure === undefined ? Promise.resolve() : Promise.reject(makeRealmError(requestFailure))),
  };
  const runner: OpenShellRunner = () => {
    deletes += 1;
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false });
  };
  const exec = new SessionExecution({ libpod, runner, config: { image: IMAGE, stateDir: "/unused" }, egressAllow: [] });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let virtualMs = 0;
  const advance = async (ms: number): Promise<void> => {
    for (let left = ms; left > 0; left -= 500) {
      t.mock.timers.tick(Math.min(500, left));
      virtualMs += Math.min(500, left);
      await flush();
      await flush();
    }
  };
  const settleWith = (work: Promise<unknown>) => {
    const state = { done: false, error: undefined as unknown, atMs: -1 };
    void work.then(
      () => {
        state.done = true;
        state.atMs = virtualMs;
      },
      (error: unknown) => {
        state.done = true;
        state.error = error;
        state.atMs = virtualMs;
      },
    );
    return { done: () => state.done, error: () => state.error, atMs: () => state.atMs };
  };
  return { exec, inspectCalls: () => inspects, deleteCalls: () => deletes, settleWith, advance };
}

void test("F-46-1: a stop request that missed its bound while the container was stopping is a success once the container ends", async (t) => {
  // The first inspect (before the stop) finds it running; two polls find it stopping; the third finds it exited.
  const r = rig(t, [status("running"), status("stopping"), status("stopping"), status("exited")], "PODMAN_MACHINE_DOWN");
  const end = r.settleWith(r.exec.stop(CONTAINER, realmSandboxName(SESSION)));
  await flush();
  await r.advance(CONFIRM_BOUND_MS);
  assert.ok(end.done(), "the stop settled inside the confirmation bound");
  assert.equal(end.error(), undefined, "the container ended, so the stop reports no failure");
  assert.equal(r.deleteCalls(), 1, "the sandbox delete still ran once");
  assert.ok(r.inspectCalls() >= 4, `the state was read until the container ended (${String(r.inspectCalls())} reads)`);
});

void test("F-46-1: a container still stopping at the confirmation bound keeps the failed step, with its cause, and the delete still runs", async (t) => {
  const r = rig(t, [status("running"), status("stopping")], "PODMAN_MACHINE_DOWN");
  const end = r.settleWith(r.exec.stop(CONTAINER, realmSandboxName(SESSION)));
  await flush();
  await r.advance(CONFIRM_BOUND_MS + 1_000);
  assert.ok(end.done(), "the stop settled at the bound, it did not wait for ever");
  const error = end.error();
  assert.ok(error instanceof RealmError, "the stop failed with a catalogue error");
  assert.equal(error.code, "AGENTOS_STOP_FAILED");
  assert.equal(error.causeCode, "PODMAN_MACHINE_DOWN");
  assert.ok(end.atMs() <= CONFIRM_BOUND_MS + 1_000);
  assert.equal(r.deleteCalls(), 1);
});

void test("F-46-1: a state that cannot be read is not an end: the failed step stays at the bound", async (t) => {
  const r = rig(t, [status("running"), "reject"], "PODMAN_MACHINE_DOWN");
  const end = r.settleWith(r.exec.stop(CONTAINER, realmSandboxName(SESSION)));
  await flush();
  await r.advance(CONFIRM_BOUND_MS + 1_000);
  assert.ok(end.done());
  const error = end.error();
  assert.ok(error instanceof RealmError && error.code === "AGENTOS_STOP_FAILED" && error.causeCode === "PODMAN_MACHINE_DOWN");
});

void test("F-46-1: a failure that is not a missed bound is not confirmed: one state read, then the failed step", async (t) => {
  const r = rig(t, [status("running"), status("exited")], "SCHEMA_INVALID");
  const end = r.settleWith(r.exec.stop(CONTAINER, realmSandboxName(SESSION)));
  await flush();
  await r.advance(1_000);
  assert.ok(end.done(), "no confirmation wait ran");
  const error = end.error();
  assert.ok(error instanceof RealmError && error.code === "AGENTOS_STOP_FAILED" && error.causeCode === "SCHEMA_INVALID");
  assert.equal(r.inspectCalls(), 1);
});

void test("F-46-1: a destroy whose force removal missed its bound is a success once the container is gone", async (t) => {
  const r = rig(t, [status("running"), status("stopping"), null], "PODMAN_MACHINE_DOWN");
  const end = r.settleWith(r.exec.destroy(CONTAINER, realmSandboxName(SESSION)));
  await flush();
  await r.advance(CONFIRM_BOUND_MS);
  assert.ok(end.done());
  assert.equal(end.error(), undefined);
  assert.equal(r.deleteCalls(), 1);
});

void test("F-46-1: a destroy whose container is exited but not removed keeps the failed step", async (t) => {
  const r = rig(t, [status("running"), status("exited")], "PODMAN_MACHINE_DOWN");
  const end = r.settleWith(r.exec.destroy(CONTAINER, realmSandboxName(SESSION)));
  await flush();
  await r.advance(CONFIRM_BOUND_MS + 1_000);
  assert.ok(end.done());
  const error = end.error();
  assert.ok(error instanceof RealmError && error.code === "AGENTOS_STOP_FAILED" && error.causeCode === "PODMAN_MACHINE_DOWN");
});

void test("F-46-1: a stop that succeeds on its own makes no confirmation read", async (t) => {
  const r = rig(t, [status("running"), status("exited")], undefined);
  const end = r.settleWith(r.exec.stop(CONTAINER, realmSandboxName(SESSION)));
  await flush();
  await r.advance(1_000);
  assert.ok(end.done());
  assert.equal(end.error(), undefined);
  assert.equal(r.inspectCalls(), 1);
});

void test("F-46-1: the confirmation wait is a stage of the teardown worst case, and the teardown bound still covers it", () => {
  assert.equal(CONTAINER_END_CONFIRM_MS, 10_000);
  // The worst case before Phase 46 was 57 000 ms: 15 000 + 15 000 + 12 000 + 15 000.
  assert.equal(SESSION_END_WORST_CASE_MS, 57_000 + CONTAINER_END_CONFIRM_MS);
  assert.ok(TEARDOWN_TIMEOUT_MS >= SESSION_END_WORST_CASE_MS);
  assert.equal(CONTAINER_CONFIRM_POLL_MS, 500);
});
