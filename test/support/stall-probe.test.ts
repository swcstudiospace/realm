import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STALL_SLICE_CPU_MAX_MS,
  STALL_BOUND_RULE,
  STALL_CONFIRMING_RUNS,
  STALL_OBSERVED_WORST_MIN_OF_MAX_MS,
  STALL_SEED_MARGIN_FACTOR,
  assertNoBlockingSlice,
  assertNoConfirmedBlocking,
  blockingVerdict,
  confirmedBlockingVerdict,
  createSliceRecorder,
  deriveStallBound,
  realSliceRecorder,
  type SliceReport,
} from "./stall-probe.js";

// A manual wall clock, CPU reader and scheduler: one tick runs only when the test runs it, so no event loop is involved.
function manualRig(): {
  readonly clock: { readonly now: () => number; readonly cpu: () => number; readonly schedule: (callback: () => void) => void };
  readonly advance: (wallMs: number, cpuMs: number) => void;
  readonly runTick: () => boolean;
} {
  let wall = 1_000;
  let cpu = 50;
  let pending: (() => void) | undefined;
  return {
    clock: {
      now: () => wall,
      cpu: () => cpu,
      schedule: (callback) => {
        pending = callback;
      },
    },
    advance: (wallMs, cpuMs) => {
      wall += wallMs;
      cpu += cpuMs;
    },
    runTick: () => {
      const callback = pending;
      pending = undefined;
      if (callback === undefined) {
        return false;
      }
      callback();
      return true;
    },
  };
}

void test("the recorder records one slice per tick, in order, with the largest CPU and wall slices and the total CPU", () => {
  const rig = manualRig();
  const recorder = createSliceRecorder(rig.clock);
  recorder.start();
  rig.advance(2, 1);
  assert.ok(rig.runTick());
  rig.advance(400, 400);
  assert.ok(rig.runTick());
  rig.advance(3, 2);
  assert.ok(rig.runTick());
  const report = recorder.stop();
  assert.equal(report.count, 3);
  assert.deepEqual([...report.cpuMs], [1, 400, 2]);
  assert.deepEqual([...report.wallMs], [2, 400, 3]);
  assert.equal(report.maxCpuMs, 400);
  assert.equal(report.maxCpuIndex, 1);
  assert.equal(report.maxWallMs, 400);
  assert.equal(report.totalCpuMs, 403);
  assert.equal(report.delay, null);
});

void test("a stopped recorder records no further slice, and its pending tick ends the loop", () => {
  const rig = manualRig();
  const recorder = createSliceRecorder(rig.clock);
  recorder.start();
  rig.advance(1, 1);
  rig.runTick();
  const report = recorder.stop();
  rig.advance(900, 900);
  assert.ok(rig.runTick(), "the pending tick still runs");
  assert.equal(rig.runTick(), false, "and schedules nothing");
  assert.equal(report.count, 1);
  assert.equal(report.maxCpuMs, 1);
});

void test("the recorder grows past its first buffer without losing a slice", () => {
  const rig = manualRig();
  const recorder = createSliceRecorder(rig.clock);
  recorder.start();
  for (let index = 0; index < 3000; index += 1) {
    rig.advance(1, index % 7);
    rig.runTick();
  }
  const report = recorder.stop();
  assert.equal(report.count, 3000);
  assert.equal(report.cpuMs[2999], 2999 % 7);
  assert.equal(report.maxCpuMs, 6);
});

void test("starting twice, stopping before starting and stopping twice are errors", () => {
  const rig = manualRig();
  const recorder = createSliceRecorder(rig.clock);
  assert.throws(() => recorder.stop(), /not running/);
  recorder.start();
  assert.throws(() => {
    recorder.start();
  }, /already started/);
  recorder.stop();
  assert.throws(() => recorder.stop(), /not running/);
  assert.throws(() => {
    recorder.start();
  }, /already started/);
});

void test("CPU and wall are independent: descheduled time is not CPU", () => {
  const rig = manualRig();
  const recorder = createSliceRecorder(rig.clock);
  recorder.start();
  rig.advance(5000, 3);
  rig.runTick();
  rig.advance(400, 400);
  rig.runTick();
  const report = recorder.stop();
  assert.equal(report.cpuMs[0], 3);
  assert.equal(report.wallMs[0], 5000);
  assert.equal(report.cpuMs[1], 400);
  assert.equal(report.maxCpuMs, 400);
  assert.equal(report.maxWallMs, 5000);
});

function reportWithMax(maxCpuMs: number): SliceReport {
  return {
    count: 3,
    cpuMs: Float64Array.of(1, maxCpuMs, 2),
    wallMs: Float64Array.of(1, maxCpuMs, 2),
    maxCpuMs,
    maxCpuIndex: 1,
    maxWallMs: maxCpuMs,
    totalCpuMs: 3 + maxCpuMs,
    delay: null,
  };
}

void test("the verdict is blocking above the limit and not at it, and names the slice, the CPU and the limit", () => {
  const limit = 100;
  const at = blockingVerdict(reportWithMax(limit), limit);
  assert.equal(at.blocking, false);
  assert.doesNotThrow(() => {
    assertNoBlockingSlice(reportWithMax(limit), limit);
  });
  const above = blockingVerdict(reportWithMax(limit + 1), limit);
  assert.equal(above.blocking, true);
  assert.equal(above.maxCpuMs, limit + 1);
  assert.equal(above.limitMs, limit);
  assert.equal(above.index, 1);
  assert.match(above.message, /slice 1 used 101\.0 ms of CPU, above the limit of 100 ms/);
  assert.throws(
    () => {
      assertNoBlockingSlice(reportWithMax(limit + 1), limit);
    },
    (error: unknown) => error instanceof Error && error.message === above.message,
  );
});

void test("the bound rule, the confirming run count and the seed margin are frozen", () => {
  assert.deepEqual({ ...STALL_BOUND_RULE }, { factor: 3, minMs: 25, maxMs: 100, roundMs: 5 });
  assert.equal(Object.isFrozen(STALL_BOUND_RULE), true);
  assert.equal(STALL_SEED_MARGIN_FACTOR, 2.5);
});

void test("the bound is three times the observation, at least 25 ms, at most 100 ms, rounded up to a multiple of 5 ms", () => {
  assert.equal(deriveStallBound(0), 25, "the floor");
  assert.equal(deriveStallBound(8.3), 25, "24.9 rounds up to 25");
  assert.equal(deriveStallBound(8.4), 30, "25.2 rounds up to 30");
  assert.equal(deriveStallBound(10), 30);
  assert.equal(deriveStallBound(20), 60);
  assert.equal(deriveStallBound(33), 100, "99 rounds up to 100");
  assert.equal(deriveStallBound(40), 100, "the cap");
  assert.equal(deriveStallBound(1000), 100, "the cap is never exceeded");
});

void test("STALL_SLICE_CPU_MAX_MS is the rule applied to the recorded observation, and the seeded burn clears it by the margin", () => {
  assert.equal(STALL_OBSERVED_WORST_MIN_OF_MAX_MS, 64.63);
  assert.equal(STALL_SLICE_CPU_MAX_MS, deriveStallBound(STALL_OBSERVED_WORST_MIN_OF_MAX_MS));
  assert.equal(STALL_SLICE_CPU_MAX_MS, 100);
  // The seeded burn of test/omp/attach-stall.test.ts is 400 ms of CPU: it must stay above margin times the bound.
  assert.ok(400 >= STALL_SEED_MARGIN_FACTOR * STALL_SLICE_CPU_MAX_MS);
});

void test("the real recorder starts and stops on the real loop and reports the thread CPU of the window", async () => {
  const recorder = realSliceRecorder();
  recorder.start();
  // The tick is a 1 ms timer, so a 20 ms timer set after it always fires after at least one tick.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 20);
  });
  const report = recorder.stop();
  assert.ok(report.count > 0, "the loop turned at least once");
  assert.ok(report.cpuMs.length === report.count && report.wallMs.length === report.count);
  assert.ok(report.maxCpuMs >= 0 && report.totalCpuMs >= 0);
});

void test("a case is blocking only when every run's largest slice is above the limit: one steal spike cannot fail it, a real block cannot hide", () => {
  const limit = 50;
  const spike = [reportWithMax(70), reportWithMax(3), reportWithMax(2), reportWithMax(4), reportWithMax(3)];
  const spiked = confirmedBlockingVerdict(spike, limit);
  assert.equal(spiked.blocking, false);
  assert.equal(spiked.minOfMaxCpuMs, 2);
  assert.equal(spiked.runs, 5);
  assert.doesNotThrow(() => {
    assertNoConfirmedBlocking(spike, limit);
  });
  const real = [reportWithMax(420), reportWithMax(431), reportWithMax(405), reportWithMax(450), reportWithMax(433)];
  const blocked = confirmedBlockingVerdict(real, limit);
  assert.equal(blocked.blocking, true);
  assert.equal(blocked.minOfMaxCpuMs, 405);
  assert.match(blocked.message, /blocked in every one of 5 runs: the smallest per-run maximum slice used 405\.0 ms of CPU, above the limit of 50 ms/);
  assert.throws(
    () => {
      assertNoConfirmedBlocking(real, limit);
    },
    (error: unknown) => error instanceof Error && error.message === blocked.message,
  );
  assert.equal(confirmedBlockingVerdict([reportWithMax(limit)], limit).blocking, false, "a run exactly at the limit is not blocking");
  assert.equal(confirmedBlockingVerdict([reportWithMax(limit + 1)], limit).blocking, true);
  assert.throws(() => confirmedBlockingVerdict([], limit), /at least one run/);
  assert.equal(STALL_CONFIRMING_RUNS, 5);
});
