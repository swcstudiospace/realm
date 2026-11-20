import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import realmExtension from "../../src/omp/extension.js";
import type { OmpExtensionApi, OmpSessionContext } from "../../src/omp/plugin.js";
import type { HostToolDefinition } from "../../src/omp/tools.js";
import { controlSocketPath } from "../../src/session/paths.js";
import { startCpuBurners } from "../support/cpu-burner.js";
import { startScriptedControlSocket } from "../support/scripted-control-socket.js";
import {
  STALL_CONFIRMING_RUNS,
  STALL_SEED_MARGIN_FACTOR,
  STALL_SLICE_CPU_MAX_MS,
  assertNoConfirmedBlocking,
  confirmedBlockingVerdict,
  realSliceRecorder,
  threadCpuMs,
  type SliceReport,
} from "../support/stall-probe.js";
import { boundedWait, testTimeout } from "../support/timing.js";

// OMPV-02: the hermetic stall probe. It loads the real Omp extension entry and runs its real attach path in this process against
// a scripted control socket with scripted up latencies; no Omp, no Podman, no daemon, no child process. The measure is CPU time per
// synchronous slice of the event loop (test/support/stall-probe.ts). It answers whether the extension blocks the loop. It does not
// answer whether a real Omp answers get_state within the Phase 38 thresholds, so it closes none of OMPR-01, OMPR-06 or OI-11.

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const ACTIVE_PAINT = "realm active";
const PAINT_BOUND_MS = 15_000;
// The extension module the seeded burn must land in: a stack naming this file is the extension's own attach path.
const EXTENSION_STACK_MARK = "/src/omp/extension.js";
const SEEDED_BURN_MS = 400;
const SETTLE_MS = 2;

interface Host {
  readonly pi: OmpExtensionApi;
  readonly handlers: Map<string, (...args: unknown[]) => unknown>;
}

// The Omp host surface the extension registers on, as test/omp/extension.test.ts fakes it.
function createHost(): Host {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const tools = new Map<string, HostToolDefinition>();
  let activeTools: string[] = [];
  const pi = {
    on(event: string, handler: (...args: unknown[]) => unknown): void {
      handlers.set(event, handler);
    },
    registerCommand(): void {},
    registerTool(tool: HostToolDefinition): void {
      tools.set(tool.name, tool);
      activeTools.push(tool.name);
    },
    getAllTools(): { readonly name: string }[] {
      return [...tools.keys()].map((name) => ({ name }));
    },
    getActiveTools(): string[] {
      return [...activeTools];
    },
    setActiveTools(names: string[]): Promise<void> {
      activeTools = [...names];
      return Promise.resolve();
    },
  } as unknown as OmpExtensionApi;
  return { pi, handlers };
}

// The Omp entry reads process.env at load, so the run sets it and restores every key after. Returns the restore function.
function setProcessEnv(values: Readonly<Record<string, string | undefined>>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  };
}

// One settle turn of the recorder: its tick is a 1 ms timer, so a 2 ms timer set now fires after at least one more tick. Without it a
// run that finishes inside a millisecond (up answered at once) could close its window before any slice was recorded.
function turn(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, SETTLE_MS);
  });
}

// Burns CPU on this thread until its CPU time has advanced ms. The loop reads no Date.now.
function burnCpu(ms: number): void {
  const began = threadCpuMs();
  while (threadCpuMs() - began < ms) {
    // spin
  }
}

// The seed: a one-shot synchronous burn inside the extension's own attach start. Date.now is read by attachDaemon of
// src/omp/extension.ts as the attach begins, so the first Date.now call whose stack names that module burns burnMs of CPU, then
// the patch disarms itself. Returns the restore function.
function armSeededBurn(burnMs: number): () => void {
  const original = Date.now.bind(Date);
  const saved = Date.now;
  let armed = true;
  Date.now = (): number => {
    if (armed && (new Error().stack ?? "").includes(EXTENSION_STACK_MARK)) {
      armed = false;
      burnCpu(burnMs);
    }
    return original();
  };
  return () => {
    Date.now = saved;
  };
}

interface RunOptions {
  // Scripted reply latencies of up, in request order.
  readonly upLatenciesMs: readonly number[];
  // Catalogue codes the first up requests are refused with; a refusal turns the re-attach switch on so the second up is sent.
  readonly upRefusals?: readonly (string | undefined)[];
  // The seeded synchronous burn, in CPU milliseconds; absent means the current extension as shipped.
  readonly seedBurnMs?: number;
  // Burner threads running beside the run; absent means none.
  readonly burners?: number;
}

interface RunResult {
  readonly report: SliceReport;
  readonly requests: readonly string[];
  readonly handlerCpuMs: number;
}

// One attach run in its own temporary state directory: the window opens just before session_start is called, and closes after the
// status paint that reads active and one more settle turn. Everything the run creates is cleaned in its finally block.
async function runAttach(options: RunOptions): Promise<RunResult> {
  const cleanups: (() => void | Promise<void>)[] = [];
  try {
    const base = mkdtempSync(join(tmpdir(), "stall-"));
    cleanups.push(() => {
      rmSync(base, { recursive: true, force: true });
    });
    const stateDir = join(base, "state");
    const project = join(base, "project");
    mkdirSync(join(base, "config", "realm"), { recursive: true });
    mkdirSync(join(stateDir, "run"), { recursive: true });
    mkdirSync(project);
    writeFileSync(join(base, "config", "realm", "config.json"), JSON.stringify({ image: IMAGE, stateDir, workspaceRoot: project }));
    cleanups.push(
      setProcessEnv({
        XDG_CONFIG_HOME: join(base, "config"),
        XDG_STATE_HOME: join(base, "xdg-state"),
        REALM_OMP_REATTACH: options.upRefusals === undefined ? undefined : "1",
      }),
    );

    const socket = await startScriptedControlSocket({
      socketPath: controlSocketPath(stateDir),
      latenciesMs: { up: options.upLatenciesMs },
      ...(options.upRefusals === undefined ? {} : { upRefusals: options.upRefusals }),
    });
    cleanups.push(() => socket.close());

    const stopBurners = startCpuBurners(options.burners ?? 0);
    cleanups.push(() => stopBurners());

    const host = createHost();
    realmExtension(host.pi);
    cleanups.push(() => {
      host.handlers.get("session_shutdown")?.();
    });
    let paintedActive: () => void = () => undefined;
    const painted = new Promise<void>((resolve) => {
      paintedActive = resolve;
    });
    const ctx: OmpSessionContext = {
      cwd: project,
      ui: {
        setStatus(_key: string, text: string): void {
          if (text.includes(ACTIVE_PAINT)) {
            paintedActive();
          }
        },
        notify(): void {},
      },
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      setInterval: (callback, ms) => setInterval(callback, ms),
      clearTimer: (handle) => {
        clearTimeout(handle as NodeJS.Timeout);
      },
    };
    const sessionStart = host.handlers.get("session_start");
    assert.ok(sessionStart, "the extension registers a session_start handler");

    const restoreNow = options.seedBurnMs === undefined ? (): void => undefined : armSeededBurn(options.seedBurnMs);
    cleanups.push(restoreNow);

    const recorder = realSliceRecorder();
    recorder.start();
    const handlerBegan = threadCpuMs();
    sessionStart({ type: "session_start" }, ctx);
    const handlerCpuMs = threadCpuMs() - handlerBegan;
    let report: SliceReport;
    try {
      await boundedWait(painted, `a status paint containing ${ACTIVE_PAINT}`, PAINT_BOUND_MS);
      await turn();
    } finally {
      report = recorder.stop();
    }
    return { report, requests: socket.requests, handlerCpuMs };
  } finally {
    for (const cleanup of cleanups.reverse()) {
      await cleanup();
    }
  }
}

// The window is meaningful: a slice was recorded, and the stand-in saw the status probe and then the up request, so the real
// attach path ran and not a no-op.
function assertRealAttachPath(result: RunResult): void {
  assert.ok(result.report.count >= 1, "at least one slice was recorded in the window");
  const status = result.requests.indexOf("status");
  const up = result.requests.indexOf("up");
  assert.ok(status !== -1 && up !== -1 && status < up, `the stand-in saw status before up (saw ${result.requests.join(",")})`);
}

// A case is STALL_CONFIRMING_RUNS fresh runs; optionsOf says what run index runs. Each run's largest slice goes to the test
// diagnostics; the verdict is confirmedBlockingVerdict over the reports (see test/support/stall-probe.ts).
async function runCase(t: TestContext, label: string, optionsOf: (runIndex: number) => RunOptions): Promise<readonly SliceReport[]> {
  const reports: SliceReport[] = [];
  for (let runIndex = 0; runIndex < STALL_CONFIRMING_RUNS; runIndex += 1) {
    const result = await runAttach(optionsOf(runIndex));
    const { report } = result;
    const delay = report.delay === null ? "none" : `${report.delay.maxMs.toFixed(1)} ms`;
    t.diagnostic(
      `stall-probe ${label} run=${String(runIndex)}: maxCpuMs=${report.maxCpuMs.toFixed(2)} maxWallMs=${report.maxWallMs.toFixed(1)} handlerCpuMs=${result.handlerCpuMs.toFixed(2)} delayMaxMs=${delay} slices=${String(report.count)}`,
    );
    assertRealAttachPath(result);
    reports.push(report);
  }
  const verdict = confirmedBlockingVerdict(reports);
  t.diagnostic(`stall-probe ${label}: minOfMaxCpuMs=${verdict.minOfMaxCpuMs.toFixed(2)} limit=${String(verdict.limitMs)}`);
  return reports;
}

const UP_LATENCIES_MS = [0, 100, 600, 2000];

for (const latency of UP_LATENCIES_MS) {
  void test(`OMPV-02: the current extension does not block the loop while up takes ${String(latency)} ms`, testTimeout(120_000), async (t) => {
    const reports = await runCase(t, `quiet up=${String(latency)}`, () => ({ upLatenciesMs: [latency] }));
    assertNoConfirmedBlocking(reports, STALL_SLICE_CPU_MAX_MS);
  });
}

void test("OMPV-02: the current extension does not block the loop when the first up is refused and the second succeeds", testTimeout(120_000), async (t) => {
  const reports = await runCase(t, "quiet refused-then-up", () => ({ upLatenciesMs: [0, 100], upRefusals: ["REALM_NOT_ACTIVE"] }));
  assertNoConfirmedBlocking(reports, STALL_SLICE_CPU_MAX_MS);
});

// A deterministic block recurs in every run, so the seeded blocking attach is blocking under the confirmed rule. The red output
// (the same assertion as the current extension's, failing on the seeded attach) is kept in 45-02-SUMMARY.md.
async function seededPass(t: TestContext, label: string, burners: number): Promise<readonly SliceReport[]> {
  const reports = await runCase(t, label, () => ({ upLatenciesMs: [100], seedBurnMs: SEEDED_BURN_MS, burners }));
  for (const report of reports) {
    assert.ok(report.maxCpuMs >= 0.9 * SEEDED_BURN_MS, "the seed landed in the measured window of every run");
    assert.ok(report.maxCpuMs >= STALL_SEED_MARGIN_FACTOR * STALL_SLICE_CPU_MAX_MS, "the seeded slice exceeds the bound by the margin");
  }
  return reports;
}

const BLOCKING_MESSAGE = /event-loop blocked in every one of 5 runs: the smallest per-run maximum slice used \d+\.\d ms of CPU, above the limit of \d+ ms/;

void test("OMPV-02: a seeded blocking attach is a blocking case (red first: the same assertion that passes for the current extension fails)", testTimeout(120_000), async (t) => {
  const reports = await seededPass(t, "seeded quiet", 0);
  assert.throws(
    () => {
      assertNoConfirmedBlocking(reports, STALL_SLICE_CPU_MAX_MS);
    },
    (error: unknown) => error instanceof Error && BLOCKING_MESSAGE.test(error.message),
  );
  assert.equal(confirmedBlockingVerdict(reports).blocking, true);
});

void test("OMPV-02: a one-off block in a single run (a simulated steal spike) does not make the case blocking", testTimeout(120_000), async (t) => {
  const spikeRun = 2;
  const reports = await runCase(t, "one-off spike", (runIndex) => ({
    upLatenciesMs: [100],
    ...(runIndex === spikeRun ? { seedBurnMs: SEEDED_BURN_MS } : {}),
  }));
  const spiked = reports[spikeRun];
  assert.ok(spiked && spiked.maxCpuMs >= 0.9 * SEEDED_BURN_MS, "the spike landed in its run");
  assert.equal(confirmedBlockingVerdict(reports).blocking, false);
  assertNoConfirmedBlocking(reports, STALL_SLICE_CPU_MAX_MS);
});

// Load invariance: the same two verdicts with one burner thread per available CPU running beside the run. The numbers may move;
// the verdicts may not.
void test("OMPV-02: with CPU burners beside it the current extension still does not block and the seeded attach still does", testTimeout(180_000), async (t) => {
  const burners = availableParallelism();
  const current = await runCase(t, `burners=${String(burners)} current`, () => ({ upLatenciesMs: [100], burners }));
  assertNoConfirmedBlocking(current, STALL_SLICE_CPU_MAX_MS);
  const seeded = await seededPass(t, `burners=${String(burners)} seeded`, burners);
  assert.equal(confirmedBlockingVerdict(seeded).blocking, true);
  assert.equal(confirmedBlockingVerdict(current).blocking, false);
});
