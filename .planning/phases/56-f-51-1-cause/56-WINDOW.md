# Phase 56: F-51-1 capture window — outcome (2026-11-22)

**Outcome: WINDOW NOT RUN (blocked at the production gate).** No variant-c capture window ran, no dirty stop's failed step or cause code was captured, no fix was made and no 20-iteration clean run was made. F-51-1 is **carried with evidence, cause not established**; STOP-05 and STOP-06 are carried, not met. Nothing is relabelled as a pass.

## What was attempted (OBSERVED, 2026-11-22T18:58Z)

The window was attempted as `realmlive` (uid 5002) under the shared live lock (`the realm-live lock file`, free: no holder). The production gate (`productionSkipReason` in `test/support/production-live.ts`) cannot open for the account:

| Gate prerequisite | Observed (as realmlive, XDG_RUNTIME_DIR=/run/user/5002) |
| --- | --- |
| Operator opt-in (`REALM_LIVE_PRODUCTION=1`, `REALM_LIVE_RAPID=1`) | Not set; irrelevant, the gate fails first below |
| Rootless Podman API socket under XDG_RUNTIME_DIR | **Absent**: `podman.socket` inactive (dead); `/run/user/5002/podman/podman.sock` does not exist |
| OpenShell gateway running | **Down**: `openshell-gateway.service` inactive (dead) |
| Compute driver running (socket + config + pinned image) | **No compute-driver unit exists for the account** (`systemctl --user list-unit-files` shows no realm/compute unit); nothing to point `REALM_DRIVER_SOCKET` / `REALM_LIVE_DRIVER_CONFIG` / `REALM_LIVE_IMAGE` at |
| The running realm stack | Is **root's**: `realm-root-compute-driver`, `realm-root-openshell-gateway` (`--config <realm-state-dir>/gateway/gateway.toml`), `realm-root-podman` (Podman 5.7.1). `<realm-state-dir>` and `<realm-state-dir>/gateway` are mode 0700 and `driver.sock` mode 0600, owned by root — unreachable as `realmlive` |

Host facts (read-only): Podman 5.7.1 (`/usr/local/bin/podman --version`), OpenShell 0.1.5, node available to the account. Bringing up the account's stack (podman socket, gateway, compute driver with pinned image and driver config) is an operator action outside this assignment; it was not improvised.

## Timeline

No live timeline exists because no window ran: no daemon, gateway, compute-driver, supervisor or Podman timeline was collected (the plan keeps such timelines outside the repository in any case). The only timeline of this attempt is the check sequence above, executed 2026-11-22T18:58Z, in order: live-lock holder check (free), account unit check (podman.socket dead, openshell-gateway dead, no realm units), socket check (absent), root-stack check (running, 0700). No `summary.txt` / `iterations.txt` evidence directory was created.

## What this window does not show

- Any dirty stop's failed step or cause code (the Phase 51 gap for the product is now closed by the additive `causeCode` emission in `src/daemon/teardown.ts` + `src/daemon/daemon.ts`, but nothing has exercised it live).
- Any fix, bound, or 20 consecutive variant-c iterations with `failedTeardowns` 0.
- Whether F-51-1's cause is any particular failing step: not established.
## Reversal for a future window

Once the account's stack is up (podman socket, gateway and compute driver running, gate variables fillable), run the variant-c window from a fresh build of this tree as `realmlive` under the held lock with `REALM_RAPID_VARIANTS=c`; every dirty stop must then carry `causeCode` on its `daemon.stopped` row (readable by `stopCauseOf`), and the captured cause goes into `docs/integration/runtime-decision.md` replacing the inference, or F-51-1 is carried again with the new evidence.
## Checks

Builds, lint, tests and gates were skipped per the assignment; the orchestrator verifies. The only source edits are the additive emission (2 files below) and the docs/records in this phase.

## 2026-11-27 re-attempt (realmlive, HEAD 7517be6)

Provisioning fixed the prior gaps: rootless Podman 5.7.1 restored via user-unit override (/usr/local/bin/podman instead of /usr/bin/podman 4.9.3 apiserver), gateway id aligned (gateway.toml has no gateway_id line; driver REALM_DRIVER_GATEWAY_ID=openshell is the proven pairing -- realm-live produced launch.gateway_id SCHEMA_INVALID on 2026-11-27 04:50), driver/daemon/gateway units started and listening, realm doctor green on podman/podman-service.

Variant-c window run under shared lock (REALM_LIVE_RAPID=1, REALM_RAPID_VARIANTS=c, evidence z56-20261127): outcome=VOID, iterations=0, hostStop=1 reason=chain-abort. First create did not reach start: image absent in account store (REALM_DRIVER_SANDBOX_IMAGE=...24fa37... pinned, store holds only rust/node bases after prune of stale base image; /usr/local/lib/realm/openshell-sandbox missing in any local image). One create attempt with aligned openshell id reached past launch.gateway_id (no SCHEMA_INVALID refusal) and failed on the missing image / OpenShell start -- alignment proven, image is the remaining blocker. No dirty stop captured; no 20-iteration run. F-51-1/STOP-05/STOP-06 remain carried.

## 2026-11-27 final live run (realmlive, HEAD 7517be6, image sha256:6272a3ac...)

Stack fully provisioned: podman 5.7.1 (user-unit override), gateway id `openshell` (gateway.toml carries no `gateway_id` line; coupling documented), policy at stateDir/policy.json (fail-closed, workspace pin), sandbox image `localhost/realm-agentos@sha256:6272a3ac4a84a49b52bd716309212d44786874f48c7551407a6c280baa362b5b` (rebuilt 2026-11-27; `check:image-digests` ok; openshell-sandbox b5f8bd5e..., runner af6dbf98..., probe 524dcf1c... verified; stage-1 binary built by cargo in the podman build and reused from cache, final stage hand-assembled from verified artifacts because host disk hit 100% mid-build; pinned in config + driver unit consistently). Manual `realm up/down` smoke reached active with the pinned image before the window.

Variant-c window under shared lock (TMPDIR=/dev/shm; evidence `z56-20261127`): `outcome=OTHER-FAILURE (failure-cap)`, 36 iterations, 33 clean, peak 26 consecutive clean, 3 failed, 0 startFailed. All 33 clean iterations: up ok, active yes, execOk yes, down ok, stop clean. No failed teardown is ever recorded (clean iterations show failedTeardowns=none; the 3 failures also show failedTeardowns=none but are row-absent, so their teardown state is unknown, not zero). The 3 failures are identical: `kind=row-absent` -- the signaled daemon exits in 77-209 ms writing no `daemon.stopping`/`daemon.stopped` row (stopMs < 210, stoppingSeen/startupSeen/notice all none), then the next up's gap is ~226000 ms (200 s daemon-start wait) before up succeeds (upMs 27-32 s). No causeCode exists to capture: F-51-1's dirty-stop cause (AGENTOS_STOP_FAILED with failedTeardowns 1) did not occur once in this window. The row-absent pattern (daemon killed before its logger writes the stopping row) is new, distinct evidence, its own cause not established here. STOP-05/STOP-06 remain carried; the ">=20 consecutive clean" shape was shown for 26 iterations, but the window as a whole failed at cap 3.
