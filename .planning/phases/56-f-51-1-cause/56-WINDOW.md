# Phase 56: F-51-1 capture window — outcome (2026-11-22)

**Outcome: WINDOW NOT RUN (blocked at the production gate).** No variant-c capture window ran, no dirty stop's failed step or cause code was captured, no fix was made and no 20-iteration clean run was made. F-51-1 is **carried with evidence, cause not established**; STOP-05 and STOP-06 are carried, not met. Nothing is relabelled as a pass.

## What was attempted (OBSERVED, 2026-11-22T18:58Z)

The window was attempted as `realmlive` (uid 5002) under the shared live lock (in the scratch directory, free: no holder). The production gate (`productionSkipReason` in `test/support/production-live.ts`) cannot open for the account:

| Gate prerequisite | Observed (as realmlive, XDG_RUNTIME_DIR=/run/user/5002) |
| --- | --- |
| Operator opt-in (`REALM_LIVE_PRODUCTION=1`, `REALM_LIVE_RAPID=1`) | Not set; irrelevant, the gate fails first below |
| Rootless Podman API socket under XDG_RUNTIME_DIR | **Absent**: `podman.socket` inactive (dead); `/run/user/5002/podman/podman.sock` does not exist |
| OpenShell gateway running | **Down**: `openshell-gateway.service` inactive (dead) |
| Compute driver running (socket + config + pinned image) | **No compute-driver unit exists for the account** (`systemctl --user list-unit-files` shows no realm/compute unit); nothing to point `REALM_DRIVER_SOCKET` / `REALM_LIVE_DRIVER_CONFIG` / `REALM_LIVE_IMAGE` at |
| The running realm stack | Is **root's**: `realm-root-compute-driver`, `realm-root-openshell-gateway` (`--config <stateDir>/gateway/gateway.toml`), `realm-root-podman` (Podman 5.7.1). `<stateDir>` and `<stateDir>/gateway` are mode 0700 and `driver.sock` mode 0600, owned by root — unreachable as `realmlive` |

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
