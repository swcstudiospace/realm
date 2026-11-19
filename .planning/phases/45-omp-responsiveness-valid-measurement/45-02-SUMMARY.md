---
phase: 45-omp-responsiveness-valid-measurement
plan: "02"
status: complete
requirements: [OMPV-02]
---

# Plan 45-02 summary: the hermetic in-process stall probe

Executed 2026-11-19. Nothing live was run. No file under `src` changed. `test/omp/extension.test.ts` and `test/omp/attach-window.test.ts` are unedited and the whole Omp suite passes (220 tests with the probe).

## What the probe is, and what it is not

`test/omp/attach-stall.test.ts` loads the real extension entry (`realmExtension`) in the test process, under an environment that points at a temporary state directory, and runs its real attach path against an in-process stand-in control socket with scripted `up` latencies. The Omp host API is the same fake the extension tests use. No Omp, no Podman, no daemon, no child process. It answers whether the extension's own synchronous work blocks the event loop. It does not answer whether a real Omp answers `get_state` within the Phase 38 thresholds, so it closes none of OMPR-01, OMPR-06 or OI-11 (D-45-12). The probe is **load-resistant, not load-independent** on this VM (see Deviations 3 and 4).

## Files

| File | Change |
| --- | --- |
| `test/support/stall-probe.ts` | New. `createSliceRecorder` (injected clock, CPU reader and scheduler), `realSliceRecorder` (performance.now, `process.threadCpuUsage`, a 1 ms timer, plus a `monitorEventLoopDelay` histogram as the secondary reading), `threadCpuMs`, `blockingVerdict` / `assertNoBlockingSlice` (one report), `confirmedBlockingVerdict` / `assertNoConfirmedBlocking` (five runs), and the frozen constants `STALL_BOUND_RULE`, `deriveStallBound`, `STALL_OBSERVED_WORST_MIN_OF_MAX_MS`, `STALL_SLICE_CPU_MAX_MS`, `STALL_SEED_MARGIN_FACTOR`, `STALL_CONFIRMING_RUNS` |
| `test/support/stall-probe.test.ts` | New. Manual-scheduler cases for the recorder (order, largest slices, CPU independent of wall, growth past the first buffer, start/stop errors, a stopped recorder records nothing), the single-report verdict at and one above the limit, the confirmed verdict (a spike in one run does not block, a block in every run does), one test per frozen constant, and one real-loop smoke case |
| `test/support/scripted-control-socket.ts` and `.test.ts` | New. NDJSON stand-in daemon, per-method latency series (consumed in order, last value repeats, empty means none), default responder mirroring the `startStub` shapes (status and up active and stamped with the workspace's session id, host-boot recorded, capability-attach mode off), `upRefusals` (catalogue codes for the first up requests), recorded request order, `close` clears timers, destroys sockets, removes the socket file. Separate module because `startStub` in `extension.test.ts` is entangled with a per-file host-boot recorder |
| `test/support/cpu-burner.ts` and `.test.ts` | New. `startCpuBurners(count)` starts worker threads that spin; the returned stop terminates them within a bound with a named message; zero starts none; stopping twice is harmless |
| `test/omp/attach-stall.test.ts` | New. Cases below |
| `docs/integration/omp.md` | One dated paragraph (method, what it measures, red on the seed, what it answers and does not) after the Phase 44 paragraphs; the UI-01 row is untouched |
| `AGENTS.md` | The `test/support/` Layout bullet names the three new support modules and the probe test; ten headings kept; `CLAUDE.md` untouched |
| `45-CONTEXT.md` | OD-45-1 recorded as approved by the owner on 2026-11-19 (root-assisted isolation, cpuset delegation and CPU reservation allowed for windows; plan 45-01's feasibility record and design must include that option; windows are run by the owner or the orchestrator); D-45-04 amendment with the steal evidence |

## The cases of `test/omp/attach-stall.test.ts`

Each case is five fresh runs (`STALL_CONFIRMING_RUNS`); each run has its own temporary root, state directory, socket, environment and burners, cleaned in a `finally`. The window opens just before `session_start`, closes after the paint that reads active plus one settle turn, and must show at least one slice and a `status` then `up` request order at the socket.

1. Current extension, quiet: up latencies 0, 100, 600 and 2000 ms, and a run where the first up is refused with a catalogue code and the second succeeds (re-attach switch on).
2. Seeded blocking attach: a one-shot 400 ms CPU burn injected through a test-local `Date.now` patch that burns on the first call whose stack names the extension module (`attachDaemon`), disarms itself, and is restored. Every run must show a slice of at least 90 percent of the burn and at least 2.5 times the bound.
3. Red first, then the expectation: see below.
4. A simulated one-off steal spike: the 400 ms burn in one run of five. The case is not blocking.
5. Load invariance: the current extension and the seeded attach again, with one burner thread per available CPU. Verdicts equal the quiet ones.

## Red output (kept verbatim, before the seeded case became an expectation)

First, with a single-run assertion (before the confirmed rule existed), the same `assertNoBlockingSlice` that passes for the current extension:

```
✖ OMPV-02: a seeded blocking attach is a blocking slice (1001.660157ms)
ℹ stall-probe seeded quiet: maxCpuMs=431.53 maxWallMs=874.4 handlerCpuMs=0.00 delayMaxMs=875.0 ms slices=7300
  Error: event-loop slice 1 used 431.5 ms of CPU, above the limit of 100 ms
      at assertNoBlockingSlice (file:///.../dist/test/support/stall-probe.js:147:15)
```

Then under the confirmed (minimum of five) rule, with the same `assertNoConfirmedBlocking` as the current-extension cases:

```
✖ OMPV-02: a seeded blocking attach is a blocking case (4898.23917ms)
  Error: event-loop blocked in every one of 5 runs: the smallest per-run maximum slice used 405.1 ms of CPU, above the limit of 100 ms (per-run maxima 461.0, 445.2, 419.1, 432.3, 405.1)
      at assertNoConfirmedBlocking (file:///.../dist/test/support/stall-probe.js:195:15)
```

The case then asserts that exact failure with `assert.throws` and a message pattern, and asserts `confirmedBlockingVerdict(reports).blocking` is true. Task 1 was red before the module existed (`error TS2307: Cannot find module './stall-probe.js'`); the unit cases of the socket and the burner were written together with their modules and were not observed red first.

## Evidence: the CPU clock of this VM is noisy, with no extension involved

An empty 1 ms timer loop in plain node, no extension, reading `process.threadCpuUsage` per tick (eight runs of a 4 s script): slices of about 70 ms CPU (user about 40, system about 25) at 68 to 268 ms wall in most runs; in one slice 52.7 ms of CPU inside 5.1 ms of wall; a second variant that also read the event-loop utilization showed CPU deltas of 64 to 70 ms in slices of 1.3 to 1.7 ms wall (CPU above wall is impossible for one thread) and in slices that were 99 percent idle. A single-threaded GC flag did not change it. `/proc/stat` over 5 s showed about 28 s of steal across 8 CPUs (about 70 percent); the host is a KVM guest at a load of about 28 on 8 CPUs. The thread CPU clock therefore includes time taken from the guest. Conclusion: the first design's single-run maximum slice cannot be bounded below 100 ms here, and the cause is the host, not the extension.

## Observation of the current extension (45-02 Task 3 B and C)

Twenty loops of the whole probe file, quiet and beside eight burners, twice. Cell: the smallest per-run maximum CPU slice of the five runs of a case (the value the verdict compares to the bound), worst over the 20 loops.

| Case | Set 1 worst | Set 2 worst |
| --- | --- | --- |
| quiet, up 0 ms | 1.09 | 3.42 |
| quiet, up 100 ms | 1.00 | 3.15 |
| quiet, up 600 ms | 1.24 | 2.47 |
| quiet, up 2000 ms | 4.65 | 64.63 |
| quiet, refused then up | 2.46 | 2.75 |
| burners, current extension | 1.42 | 2.74 |
| one seeded run of five | 1.75 | 2.03 |
| seeded, quiet (smallest per-run maximum, range) | 400.0 to 417.2 | 400.0 to 410.2 |
| seeded, burners (range) | 400.2 to 416.0 | 400.0 to 414.8 |

Set 1 ran before a probe defect was fixed (an attach that answers at once could close its window before the 1 ms tick recorded a slice, so one case in one loop saw zero slices; the window now ends with a settle timer of 2 ms). Set 2 is the final probe code. In set 2, loop 9, all five 2 s runs of the 2000 ms case each met one spike (per-run maxima 64.6, 67.6, 71.9, 71.6, 67.6 ms): about half of all runs of that case contain one. The raw per-run maxima of the current extension reached 142.3 ms (set 1, up 0 ms) and 110.1 ms (set 2, up 0 ms). Verdicts under burners equalled the quiet verdicts in all 40 loops (current not blocking, seeded blocking). No loop of set 2 failed on the final code other than loop 9 under the bound of 25 ms that was in place then; the bound below was fixed after it.

## The frozen constants and the bound

`STALL_BOUND_RULE` = factor 3, floor 25 ms, cap 100 ms, round up to 5 ms; `STALL_CONFIRMING_RUNS` = 5; `STALL_SEED_MARGIN_FACTOR` = 2.5; each pinned by a test. The worst observation is 64.63 ms, so `STALL_SLICE_CPU_MAX_MS` = `deriveStallBound(64.63)` = 100 ms (the cap; the bound was 25 ms until set 2 showed loop 9 and was never raised for a verdict). The seeded burn (400 ms, observed 400.0 at the least) clears 2.5 times the bound (250 ms) in every run. **The plan's stop rule (an observation above 50 ms stops the plan) was exceeded by 64.63 ms.** It was met by the evidence above (the host produces the same slices with no extension), reported to the orchestrator, and the plan went on with the rule as written under the approved deviation.

## Deviations from the plan

1. **CPU reader is `process.threadCpuUsage`, not `process.cpuUsage`.** The burners are worker threads of the same process, and the process total counts them. Needs Node 22.19 or later; the CI matrix is 22.x and 24.x.
2. **The tick is a 1 ms timer, not a `setImmediate` loop.** The spin allocated enough to trigger scavenge and mark-compact pauses (tens of ms on this host) that counted as slices and were the probe's doing. A report stores its slices as two typed arrays (a spin recorded tens of thousands a second) instead of a list of objects.
3. **The verdict of a case is the minimum, over five fresh runs, of the per-run maximum slice** (`confirmedBlockingVerdict`). Approved by the orchestrator on the owner's behalf under the conditions that the constants are frozen in code with a test each, that the seeded attach stays red under the rule, and that a hermetic case shows one spiked run does not fail it (all three met). A deterministic block recurs in every run; a steal spike lands in one. Residual: a case fails on noise alone only if all five runs spike (observed once in about 360 case-loops, in the 2000 ms case, which was why the bound is 100 ms); on a host without steal it does not occur.
4. **The probe is load-resistant, not load-independent on this VM**: its verdict says no block that recurs in every run was found, not that no slice ever exceeded the bound.
5. **The stop rule above was exceeded and the plan went on** (see above).
6. The red output was observed first on a single-run assertion, then again under the confirmed rule (both kept above).
7. A temporary `tsconfig.stall.json` (to compile only the new files) and the `node_modules` link were used and removed.

## Checks run

- `npx tsc -p tsconfig.json`: clean.
- `npx eslint` on the new test and support files: no issues.
- `node --test` on `dist/test/omp/*.test.js` plus the new support tests: 220 tests, 220 pass. The new files as the regular account `omprunner` under `env -i`: 25 of 25 pass.
- `npm run check:gates` (gate closure, module size, export usage with 0 failing and 0 stale, lockfile integrity), `node scripts/check/host-paths.mjs` and `npm run check:docs` (host paths, agents sync, default mode): all pass.

## What plan 45-04 Task 8 can rely on

- Add a case in `test/omp/attach-stall.test.ts` with `runCase(t, label, (runIndex) => ({ upLatenciesMs: [...], upRefusals?, seedBurnMs?, burners? }))`, which returns five reports, then `assertNoConfirmedBlocking(reports, STALL_SLICE_CPU_MAX_MS)` for a case that must not block, or `assert.throws` over it (with `confirmedBlockingVerdict(reports).blocking`) for a seeded one. A red-first fix case is written as the seeded case first, observed failing, then the fix.
- The seed is `armSeededBurn(ms)` (a `Date.now` patch armed for one call whose stack names the extension module); to seed a different spot, change the stack mark.
- Helper names: `createSliceRecorder`, `realSliceRecorder`, `threadCpuMs`, `blockingVerdict`, `assertNoBlockingSlice`, `confirmedBlockingVerdict`, `assertNoConfirmedBlocking`, `deriveStallBound`, `startScriptedControlSocket`, `startCpuBurners`.
- The probe answers only whether the extension blocks the loop on this path; it cannot close OMPR-01, OMPR-06 or OI-11 alone.
