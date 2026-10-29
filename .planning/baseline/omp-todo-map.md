# Omp TODO readiness map

Written 2026-10-28 from the evidence of phase 9.7. The repository has no TODO files and no TODO or FIXME markers (checked at the baseline and again on the diff). By the clarification recorded in STATE.md, the TODO items are the ultrathink tracker rows (36 prior items: 23 done, 13 blocked, each mapped to phase 9, 10 or 11 or to a blocker) and the blockers B-001 to B-005. Classification: READY (live evidence), READY WITH LIMIT (works, with a stated limit), UNKNOWN (cannot be shown here), BLOCKED (needs an owner or external action).

## The blockers
| Blocker | Then | Now | Class |
|---|---|---|---|
| B-001 AgentOS unbound, so `realm up` refused | open | Resolved in phases 9.1 to 9.6: the driver is bound from the configured image, `realm up` reaches active, and the nine-scenario live suite passes (31 of 31, twice) | READY |
| B-002 no pinned live image or workload | open | Resolved: the sandbox image is pinned by digest, rebuilt from the committed tree with `npm run build:image`, and its digests are recorded and verified | READY |
| B-003 Anda Engine not installed, licence conflict OQ-P3-11 | open | Unchanged. ANDA-01 to ANDA-04 stay live-gated | BLOCKED (owner) |
| B-004 Podman 4.9.3 resolves first on PATH, 5.7.1 is under /usr/local/bin | open | Worked around where it matters: the realm account's units and every live run put /usr/local/bin first. The runtime probe refuses a Podman older than 5.x (PODMAN_UNSUPPORTED_VERSION) and `realm doctor` reports the version it found. The host's default PATH is unchanged, so any other account or shell that runs realm needs the same PATH | READY WITH LIMIT |
| B-005 Linear free-issue limit | open | Unchanged: tracking is Notion only | BLOCKED (owner) |

## The Omp requirements
| Item | Class | Evidence (2026-10-28, Omp 18.12.6, Podman 5.7.1) |
|---|---|---|
| OMP-01 autostart under a startup budget | READY | The plugin attached at launch and the item read `realm active`; the daemon survived Omp quitting; the daemon-side budget overrun settles to STARTUP_BUDGET_EXCEEDED (suite scenario 9). The plugin's own 200 s timer is unit-verified only |
| OMP-02 one label, text plus marker | READY | One label through connecting, active, error and disconnected; marker glyph and label read in a text pane. The colour cue was not captured |
| OMP-03 reason and time in the item | READY | Accepted approximation (one status item, detail in its text) |
| OMP-04 retry command | READY | From `error` and from `disconnected` the retry command went to connecting and then active in the same session (4 s and 24 s) |
| OMP-05 guard when disconnected | UNKNOWN | Unit-verified for write and edit; a live check needs a model call, and the model provider is out of quota. Paths that do not go through the extension are unproven |
| OMP-LIVE-01, -03, -04 | READY | Re-run on the final build |
| OMP-LIVE-02 | READY | Met earlier and unchanged |
| UI-01 not blocking the session | READY WITH LIMIT | Accepted limitation (owner, 2026-10-23, kept on 2026-10-28). Measured: through a 24 s cold attach on a loaded host, keystrokes echoed within 0.2 to 1.2 s (the earlier finding was a `get_state` answered after 6 s). A bound, not a proof |
| The status item after the runner dies | READY | New in phase 9.7: the item moves to `realm disconnected` with AGENTOS_CRASH_LOOP within the 10 s health interval (7.6 s measured), then recovers through the retry command |

## Operational notes for the next Omp session
- On the first launch of an isolated Omp profile the setup wizard has five steps and needs one Escape per step.
- The Omp model provider is out of quota, so nothing that needs a model call (OMP-05, any agent-driven check) can be verified now.
- A detached daemon outlives its Omp session by design; if its state directory is deleted while it runs it becomes an orphan (found while testing; stop it with `realm down` before removing a state directory).

## What this map does not say
It does not say any phase or the milestone is complete. Phase 9.7 is closed; Phase 10 plan 04 (PR, merge, release) and Phase 11 (milestone confirmation) are the owner's gates, and the owner decided that the milestone is archived after the PR merges.
