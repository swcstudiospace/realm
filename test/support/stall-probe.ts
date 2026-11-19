// The stall probe (Phase 45, OMPV-02): measures whether code running on the event loop blocks it, in CPU time per synchronous
// slice. A slice is the stretch of work between two consecutive ticks of a 1 ms timer loop: everything that ran on the loop
// thread between them (I/O callbacks, other timers, microtasks). A slice that is long in CPU time is code that held the loop; the
// loop could answer nothing else while it ran.
//
// The tick is a 1 ms timer and not a setImmediate spin: a spin turns the loop tens of thousands of times a second and every turn
// allocates the CPU reading, so the probe's own garbage triggered scavenges and mark-compacts whose pauses (70 to 190 ms on a
// loaded host, where the parallel GC threads wait for descheduled helpers and the waiting counts as CPU) showed up as slices
// that the extension did not cause. About a thousand ticks a second leaves the probe's own allocation negligible.
//
// Why CPU and not wall time: CPU time does not grow while the thread is descheduled, to first order, so a loaded shared host
// moves the CPU number only by the few percent that cache and SMT contention cost, while it can stretch a wall slice by any
// factor. Wall time per slice and the perf_hooks event-loop delay histogram are recorded as secondary readings, for the test
// diagnostics only. They are load-sensitive and no test asserts them.
//
// What this probe answers: whether the extension attach path itself blocks the loop, when it runs in process against a scripted
// control socket. What it does not answer: whether a real Omp answers get_state within the Phase 38 thresholds on a cold attach.
// It cannot close OMPR-01, OMPR-06 or OI-11 alone (45-CONTEXT D-45-12).
//
// The recorder takes its clock, its CPU reader and its scheduler as arguments, so the unit test runs it on manual ones with no
// event loop. realSliceRecorder builds one over performance.now, process.threadCpuUsage and a 1 ms timer. The thread CPU reader is
// the calling thread's own: process.cpuUsage counts every thread of the process, so a CPU burner running as a worker thread
// beside the probe would move it. No read of process, clock or environment happens at import time.
//
// Why the verdict of a case is confirmed over several runs: on a virtual machine with steal the thread CPU clock is not
// load-independent. An empty timer loop in plain node, with no extension, shows slices of about 70 ms CPU (40 user, 25 system) at
// 70 to 270 ms wall in roughly one quiet 3 s window in three, and once 52 ms of CPU inside 5 ms of wall (observed on the shared
// host, load about 28 on 8 CPUs, about 70 percent steal). A single run's largest slice therefore cannot be bounded below 100 ms.
// Code that blocks the loop blocks it in every run, because the attach path is deterministic; a steal spike lands in a random
// run. confirmedBlockingVerdict calls a case blocking only when the largest slice of each of its runs is above the limit, so
// one spike cannot fail a case and a real block cannot hide. A single report is still judged by blockingVerdict.
//
// STALL_SLICE_CPU_MAX_MS is derived from observation, never tuned to a verdict: three times the largest slice the current
// extension showed over 20 quiet runs, at least 25 ms, at most 100 ms, rounded up to a multiple of 5. A larger observed maximum
// than 50 ms stops the plan as a finding (45-02-PLAN Task 3; see STALL_BOUND_RULE for how that was met); here the observed
// value is the smallest per-run maximum of the confirming runs (see above). The derivation and the maxima are in 45-02-SUMMARY.md.

import { monitorEventLoopDelay, performance } from "node:perf_hooks";

// The rule that turns the observation into the bound: factor times the worst observed smallest-per-run maximum (over the loops
// of 45-02 Task 3), at least minMs, at most maxMs, rounded up to a multiple of roundMs. Frozen; the bound is never raised to
// make an extension pass. The plan's stop value (an observation above 50 ms stops the plan as a finding) was exceeded by the
// observation below, 64.63 ms; the cause is the host (see above: an empty loop in plain node shows the same slices), and the
// orchestrator approved going on with the rule as written, which caps the bound at its maximum.
export const STALL_BOUND_RULE = Object.freeze({ factor: 3, minMs: 25, maxMs: 100, roundMs: 5 });

export function deriveStallBound(observedMaxMs: number): number {
  const { factor, minMs, maxMs, roundMs } = STALL_BOUND_RULE;
  const rounded = Math.ceil((factor * observedMaxMs) / roundMs) * roundMs;
  return Math.min(maxMs, Math.max(minMs, rounded));
}

// The seeded blocking attach must show a largest CPU slice of at least this many times the bound, in every pass.
export const STALL_SEED_MARGIN_FACTOR = 2.5;

// The worst smallest-per-run maximum CPU slice (milliseconds) the current extension showed over 20 loops of every case of
// test/omp/attach-stall.test.ts, quiet and beside burners, in the two observations of 45-02 (4.65 ms before the settle-turn fix
// of the window, 64.63 ms after it, in a loop whose five 2 s runs each met one steal spike; 45-02-SUMMARY.md holds the tables).
// It is a record of an observation; it changes only by repeating the observation, never to make an extension pass.
export const STALL_OBSERVED_WORST_MIN_OF_MAX_MS = 64.63;

// The bound a slice of the real extension attach path must stay under, in CPU milliseconds: the rule applied to the observation.
export const STALL_SLICE_CPU_MAX_MS = deriveStallBound(STALL_OBSERVED_WORST_MIN_OF_MAX_MS);

export interface SliceClock {
  // Wall-clock milliseconds.
  readonly now: () => number;
  // Cumulative CPU milliseconds of the measured thread.
  readonly cpu: () => number;
  // Runs the callback on a later turn of the loop.
  readonly schedule: (callback: () => void) => void;
}

// The wall-clock reading of the event-loop delay histogram, in milliseconds. Secondary: it depends on host load.
export interface DelaySnapshot {
  readonly minMs: number;
  readonly meanMs: number;
  readonly maxMs: number;
  readonly p99Ms: number;
}

// Every slice in order, as two parallel arrays (a spinning loop records many thousands of slices a second).
export interface SliceReport {
  readonly count: number;
  readonly cpuMs: Float64Array;
  readonly wallMs: Float64Array;
  readonly maxCpuMs: number;
  // Index of the largest CPU slice; -1 when no slice was recorded.
  readonly maxCpuIndex: number;
  readonly maxWallMs: number;
  readonly totalCpuMs: number;
  readonly delay: DelaySnapshot | null;
}

export interface SliceRecorder {
  start(): void;
  // Ends the loop (the pending tick records nothing) and returns the report.
  stop(): SliceReport;
}

type RecorderState = "idle" | "running" | "stopped";

export function createSliceRecorder(clock: SliceClock): SliceRecorder {
  let state: RecorderState = "idle";
  let lastWall = 0;
  let lastCpu = 0;
  let capacity = 1024;
  let wall = new Float64Array(capacity);
  let cpu = new Float64Array(capacity);
  let count = 0;
  let maxCpuMs = 0;
  let maxCpuIndex = -1;
  let maxWallMs = 0;
  let totalCpuMs = 0;

  const record = (wallMs: number, cpuMs: number): void => {
    if (count === capacity) {
      capacity *= 2;
      const nextWall = new Float64Array(capacity);
      const nextCpu = new Float64Array(capacity);
      nextWall.set(wall);
      nextCpu.set(cpu);
      wall = nextWall;
      cpu = nextCpu;
    }
    wall[count] = wallMs;
    cpu[count] = cpuMs;
    if (maxCpuIndex === -1 || cpuMs > maxCpuMs) {
      maxCpuMs = cpuMs;
      maxCpuIndex = count;
    }
    maxWallMs = Math.max(maxWallMs, wallMs);
    totalCpuMs += cpuMs;
    count += 1;
  };

  const tick = (): void => {
    if (state !== "running") {
      return;
    }
    const nowWall = clock.now();
    const nowCpu = clock.cpu();
    record(nowWall - lastWall, nowCpu - lastCpu);
    lastWall = nowWall;
    lastCpu = nowCpu;
    clock.schedule(tick);
  };

  return {
    start(): void {
      if (state !== "idle") {
        throw new Error("the slice recorder was already started");
      }
      state = "running";
      lastWall = clock.now();
      lastCpu = clock.cpu();
      clock.schedule(tick);
    },
    stop(): SliceReport {
      if (state !== "running") {
        throw new Error("the slice recorder is not running");
      }
      state = "stopped";
      return {
        count,
        cpuMs: cpu.slice(0, count),
        wallMs: wall.slice(0, count),
        maxCpuMs,
        maxCpuIndex,
        maxWallMs,
        totalCpuMs,
        delay: null,
      };
    },
  };
}

const NANOSECONDS_PER_MILLISECOND = 1e6;
const MICROSECONDS_PER_MILLISECOND = 1e3;
const DELAY_RESOLUTION_MS = 10;
const TICK_MS = 1;

// The calling thread's CPU time (user plus system) in milliseconds. process.threadCpuUsage reads this thread only, so worker
// threads and the libuv pool do not move it.
export function threadCpuMs(): number {
  const usage = process.threadCpuUsage();
  return (usage.user + usage.system) / MICROSECONDS_PER_MILLISECOND;
}

// A recorder over the real clock, the thread CPU reader and a 1 ms timer tick, with the event-loop delay histogram running beside it.
export function realSliceRecorder(): SliceRecorder {
  const inner = createSliceRecorder({
    now: () => performance.now(),
    cpu: threadCpuMs,
    schedule: (callback) => {
      setTimeout(callback, TICK_MS);
    },
  });
  const histogram = monitorEventLoopDelay({ resolution: DELAY_RESOLUTION_MS });
  return {
    start(): void {
      inner.start();
      histogram.enable();
    },
    stop(): SliceReport {
      histogram.disable();
      const report = inner.stop();
      const delay: DelaySnapshot | null =
        histogram.count === 0
          ? null
          : {
              minMs: histogram.min / NANOSECONDS_PER_MILLISECOND,
              meanMs: histogram.mean / NANOSECONDS_PER_MILLISECOND,
              maxMs: histogram.max / NANOSECONDS_PER_MILLISECOND,
              p99Ms: histogram.percentile(99) / NANOSECONDS_PER_MILLISECOND,
            };
      return { ...report, delay };
    },
  };
}

export interface BlockingVerdict {
  readonly blocking: boolean;
  readonly maxCpuMs: number;
  readonly limitMs: number;
  readonly index: number;
  readonly message: string;
}

// Blocking means the largest CPU slice is above the limit; a slice exactly at the limit is not blocking.
export function blockingVerdict(report: SliceReport, limitMs: number = STALL_SLICE_CPU_MAX_MS): BlockingVerdict {
  const blocking = report.maxCpuMs > limitMs;
  const message = `event-loop slice ${String(report.maxCpuIndex)} used ${report.maxCpuMs.toFixed(1)} ms of CPU, ${
    blocking ? "above" : "within"
  } the limit of ${String(limitMs)} ms`;
  return { blocking, maxCpuMs: report.maxCpuMs, limitMs, index: report.maxCpuIndex, message };
}

// Throws an Error carrying the verdict message when the report holds a blocking slice.
export function assertNoBlockingSlice(report: SliceReport, limitMs: number = STALL_SLICE_CPU_MAX_MS): void {
  const verdict = blockingVerdict(report, limitMs);
  if (verdict.blocking) {
    throw new Error(verdict.message);
  }
}

// How many fresh runs confirm a case.
export const STALL_CONFIRMING_RUNS = 5;

export interface ConfirmedVerdict {
  readonly blocking: boolean;
  readonly runs: number;
  // The smallest per-run maximum CPU slice: the value that must exceed the limit for the case to block.
  readonly minOfMaxCpuMs: number;
  readonly maxCpuMsByRun: readonly number[];
  readonly limitMs: number;
  readonly message: string;
}

// A case is blocking when the largest CPU slice of every run is above the limit.
export function confirmedBlockingVerdict(reports: readonly SliceReport[], limitMs: number = STALL_SLICE_CPU_MAX_MS): ConfirmedVerdict {
  if (reports.length === 0) {
    throw new Error("a confirmed verdict needs at least one run");
  }
  const maxCpuMsByRun = reports.map((report) => report.maxCpuMs);
  const minOfMaxCpuMs = Math.min(...maxCpuMsByRun);
  const blocking = minOfMaxCpuMs > limitMs;
  const perRun = maxCpuMsByRun.map((ms) => ms.toFixed(1)).join(", ");
  const message = `event-loop ${
    blocking ? "blocked in every one of" : "not blocked in each of"
  } ${String(reports.length)} runs: the smallest per-run maximum slice used ${minOfMaxCpuMs.toFixed(1)} ms of CPU, ${
    blocking ? "above" : "within"
  } the limit of ${String(limitMs)} ms (per-run maxima ${perRun})`;
  return { blocking, runs: reports.length, minOfMaxCpuMs, maxCpuMsByRun, limitMs, message };
}

// Throws an Error carrying the verdict message when every run held a blocking slice.
export function assertNoConfirmedBlocking(reports: readonly SliceReport[], limitMs: number = STALL_SLICE_CPU_MAX_MS): void {
  const verdict = confirmedBlockingVerdict(reports, limitMs);
  if (verdict.blocking) {
    throw new Error(verdict.message);
  }
}
