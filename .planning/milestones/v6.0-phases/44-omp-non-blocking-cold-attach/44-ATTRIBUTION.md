# Phase 44: attribution of the cold-attach stall (written 2026-11-19)

This record reads the evidence that already exists. It was written from `38-MEASUREMENT.md` and `44-CONTEXT.md` only. Nothing was run, nothing was recomputed from the evidence directory (it lies outside the repository), and no sample file was re-read. Every fact carries its source and a tier: Measured (a number a run recorded), Derived (arithmetic on recorded numbers), INFERENCE (a reading the numbers suggest and do not prove).

## 1. The override, and what it does not change

Owner override of the VOID outcome (D-44-01); the evidence is one valid run and loaded-host runs; no quiet-host verdict was reached.

The Phase 38 frozen rule (`38-CONTEXT.md` D-38-02) produced `VOID`: one valid run in six attempts, fewer than the three it needs. That outcome stands as recorded in `38-MEASUREMENT.md` and `38-VERIFICATION.md`. OMPR-01 stays unmet. OI-11 stays `Carried (no quiet slot)`. The status of UI-01 is not changed here. Plans 38-02 and 38-03 did not run by the rule and are marked superseded; they are not executed. The override authorizes the Omp change and a paired loaded re-proof. It does not relabel the outcome, and no document may say the rule produced `CODE`.

## 2. The one valid run (Phase 38, attempt 1)

Source: `38-MEASUREMENT.md` attempt 1. Tier: Measured, one run, quiet readings (0.25 and 0.16 load per CPU), baseline passed, no daemon at the start, `realm active` reached, control answered. The commit under test was not recorded.

| Fact | Value | Tier |
| --- | --- | --- |
| Probes sent, answered, unanswered | 151, 141, 10 | Measured |
| Window (first send to last send) | 37 500 ms | Measured |
| Maximum, median, 95th percentile latency | 9906 ms, 201 ms, 8213 ms | Measured |
| Longest gap between answers | 12 498 ms | Measured |
| Omp `ready` frame, from process start | 11 320 ms | Measured |
| First realm status paint | 11 396 ms | Measured |
| First answered probe | 12 498 ms | Measured |
| Last realm status paint and `realm active` | 37 804 ms | Measured |
| Serving verdict (probes sent at or after the first answer): maximum, 95th percentile | 1403 ms, 705 ms | Measured |
| Control of the same attempt (Omp with no extension): ready, first answer | 8999 ms, 9394 ms | Measured |
| Boot excess (cold first answer minus control first answer) | 3104 ms | Measured |
| One-minute load on 8 CPUs: before the baseline, after it, before the session, after the session | 1.99, 1.43, 1.31, 26.35 | Measured |

Case under the Phase 38 rule: `serving-stall`. That case is a classification of one run. It is not a window outcome.

### The two components of the boot excess

Tier: Derived (arithmetic on the numbers above; frame times are taken from the session's construction, a few milliseconds after the probe loop origin).

- Before ready: cold ready 11 320 minus control ready 8999 is 2321 ms.
- After ready: the first answer came 12 498 minus 11 320 = 1178 ms after ready in the cold run, against 9394 minus 8999 = 395 ms in the control. The excess is 783 ms.
- Together: 2321 + 783 = 3104 ms, the recorded boot excess.

## 3. The shape of the samples

Source: `38-MEASUREMENT.md` attempt 1, samples reading. Tier: Measured for the numbers, Derived for the arithmetic.

- The first answered probe is the one sent at 2592 ms and answered after 9906 ms (2592 + 9906 = 12 498).
- The ten unanswered probes were sent between 0 and 2292 ms. Each times out 10 000 ms after its send, so each ran out before 12 498 ms: Omp had not started reading its input.
- Probes sent after 2592 ms were answered in a burst from 12 498 ms on.
- After the first answer the latencies fall with the probe interval (1403, 1110, 890, 614, 416 ms, then 14 ms for the probe sent at 13 903 ms). A stall remains after Omp started answering and ends near 13 900 ms.

## 4. The corrected window on the recorded numbers

Source: arithmetic on the recorded numbers of sections 2 and 3. Tier: Derived. This is arithmetic on recorded numbers; the samples file was not re-read.

Probes are sent every 250 ms from process start. The first probe tick at or after ready (11 320 ms) is at 11 500 ms; it was answered at 12 498 ms, a latency of 998 ms. The probe sent at 12 499 ms was answered after 1403 ms. So the window that starts at ready still holds a latency over 1000 ms. The corrected verdict for this run is not a pass, and the correction cannot make this run pass. The stall from about 12.5 s to about 13.9 s is inside the window under both definitions: it is real under the process-start window and under the ready window. The harness correction changes which samples the verdict reads; it does not change what the verdict demands.

## 5. What the evidence does not show

- That the 2.3 s before ready is the extension and not run-to-run variation of Omp's own boot. The four controls with no extension, probed from process start, answered first at 9394, 15 396, 10 616 and 10 892 ms, a spread larger than the excess (Measured; the reading is INFERENCE).
- That the 0.8 s after ready and the stall are the attach's synchronous prefix and not Omp-side work after the tool set changed (INFERENCE).
- Anything about a host that is quiet in the sense of CPU pressure: one run, on one commit that was not recorded, on a shared host.

## 6. Finding F-44-01: the baseline instability

Source: `38-MEASUREMENT.md` observations. Tier: Measured for the numbers, INFERENCE for the reading.

Five of nine in-test baselines (Omp with no extension, probed after ready for 10 s) missed the 500 ms 95th percentile bound at 0.17 to 0.36 load per CPU: 1001, 512, 599, 791 and 1312 ms. Maxima reached 1587 ms, over the 1000 ms bound in two. The cause is not established. The host's CPU pressure stall information (the "some" line of the CPU pressure file) read avg10 47.90, avg60 32.01, avg300 36.53 at planning time, with a load average of 11.5 on 8 CPUs (Observed). [INFERENCE] The load average per CPU does not describe the contention Omp sees on this shared host.

Handling: no threshold is edited. The baseline assertion of the quiet-window tests is not loosened; a baseline that misses its bounds still invalidates the run. The CPU pressure numbers are now recorded at every load reading, as the diagnostic. What would close the finding (a CPU-pinned baseline, or a quiet window) is deferred and is not claimed here.

## 7. What each change is a hypothesis about, and what the paired window can separate

- K1 (plan 44-02, moving the daemon launch code out of the command-line entry module so the Omp extension loads a smaller module closure) is a hypothesis about the before-ready component, 2321 ms in section 2.
- K2 (plan 44-02, an injected deferral of the start of the attach) is a hypothesis about the after-ready component, 783 ms in section 2, and about the stall in section 3.

The paired loaded window of plan 44-03 measures, per arm and against that arm's own no-extension control, the boot excess X, its two components X1 (before ready) and X2 (after ready), and the serving stall S. It can say whether the AFTER build reduced X, and whether X1, X2 and S moved, on this host in that window, labelled `loaded, paired`. It cannot separate K1 from K2 individually, because both change together (OQ-44-01), and it makes no quiet-host claim. No outcome of it closes OI-11.
