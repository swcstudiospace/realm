---
phase: 47-legacy-kimi-production-tier-and-env-forwarding
plan: "04"
subsystem: docs
tags: [kimi, registry, gaps, matrix, records]
requires:
  - phase: 47-legacy-kimi-production-tier-and-env-forwarding
    provides: 47-WINDOW.md (the window record of 2026-11-19) and the branch decision of plan 47-03 (Branch D and E-B, no code change)
provides:
  - the registry, the gap rows, the wave 1 page, the snippet, the contract page, the hosts page and the generated matrix block at one dated result
affects: [phase 48]
requirements-completed: [KIMV-04]
---

# Plan 47-04 summary: the records

Recording only. Nothing under src changed, no recipe, manifest or golden changed (plan 47-03 took no code branch), no new gap id was added, and
the phase bound of the gaps test did not move. No live command was run by this plan; the window and the stack comparison are those of plan 47-02.
Nothing was committed here.

## What the records now say (one result everywhere)

- **The tier did NOT pass its bound.** On 2026-11-19 three default cold runs of the legacy kimi-cli 1.51.0 (`kimi mcp test realm`, all three names
  restored) were ANSWERED with the six tool names and the recorder logged the six names, and each exceeded the test's own 25000 ms cold connect bound
  (28804, 31393 and 32301 ms, on a loaded host; the legacy client alone against a fake MCP server takes about 30 s). No record says passed.
- **Reproduction NOT-REPRODUCED; cause NOT-ESTABLISHED** (KIMV-02 carried; GAP-43-03 narrowed and never closed). The failure of 2026-11-18 (18225 ms, no tool
  names) stays named in the registry note, the wave 1 row, the gap rows, the snippet, the contract page and the hosts page. The recorder-kill-order
  candidate is stated as an inference only, in the gap row, the wave 1 window paragraph and the snippet.
- **Ablation (diagnostic variants, never the tier):** `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR` needed, `REALM_DRIVER_SOCKET` not needed, nothing restored not
  reached, for the one non-default production stack; the config-home verdict is stated as not shown for a default config location.
- **The client does not expand references** (probe; both spellings arrive as the reference text, a literal unchanged). GAP-43-01: no recipe env block is
  possible; manual workaround `kimi mcp add --transport stdio --env NAME=VALUE realm -- realm mcp --host kimi` with the exact names, or the `env` object by
  hand; an install-time capture capability is planned in its own later phase (OD-47-1 option a, owner, 2026-11-19). The host's own writer returned exit
  0 (the 2026-11-17 hang was not seen again and stays unexplained); it writes `command`, `args`, `env`, indent 2, no trailing newline.

## Registry (test/support/host-registry.ts, the kimi record)

- t3: status `gap`, the note starts `rehearsal failed:` (the wave 1 test reads that as the failed disposition) and carries both dates, the three durations, the
  "did NOT pass its bound" statement, NOT-REPRODUCED, cause not established, the ablation, the no-env-block statement and the workaround.
- t2: date 2026-11-19, version 1.51.0; the result keeps its wording and says 2 of 2 passed on 2026-11-18 and again on 2026-11-19 (the validator test and
  the validator session test passed in the window).
- The source comment above the record is updated.

## Gap rows (docs/integration/host-plugin-gaps.md; no new id)

| Row | Class | Status | Statement |
| --- | --- | --- | --- |
| GAP-24-02 | unverified-behavior | narrowed (unchanged) | the legacy production tier did not pass: failure of 2026-11-18, three answered runs over their own bound on 2026-11-19; the lift condition says within its bound |
| GAP-24-03 | unverified-behavior | narrowed (unchanged) | the same dated result in the legacy sentence and in what remains |
| GAP-43-01 | accepted-residual (was unverified-behavior) | accepted (was open) | no recipe env block possible; the verdicts, the expansion probe, the exact names, the workaround, the lift condition (the capture capability, owner decision of 2026-11-19, or dropping the archived row) |
| GAP-43-03 | unverified-behavior | narrowed (was open) | NOT-REPRODUCED, NOT-ESTABLISHED, the dated runs, the inference labelled as one; what would decide it |

GAP-43-01 is `accepted`, not `closed`: the plan's rule for an environment that is needed and not expanded (E-B) is accepted-residual with the named manual workaround,
and the legend reserves closed for a gap the evidence lifts. GAP-21-03, GAP-31-03 and GAP-43-02 carry no stale statement and are unchanged.

## Files edited

- `test/support/host-registry.ts`: the kimi record (above).
- `docs/integration/host-plugin-gaps.md`: GAP-24-02, GAP-24-03, GAP-43-01, GAP-43-03.
- `docs/integration/wave1-boot-matrix.md`: the kimi row (disposition failed, date 2026-11-19), the cold paragraph, the kimi bullet of How a host is booted, a new
  Phase 47 window paragraph, and the two limits bullets.
- `docs/integration/host-support-matrix.md`: the generated block only; the diff is the kimi row's T2 date (the T3 text of the row is a view of the registry note
  and the registry note changed, so the block was regenerated from it); no other host row differs.
- `docs/integration/host-plugin-contract.md`: the Kimi paragraph and the Phase 24 evidence row; the bare-recipe sentence is not edited (no recipe change).
- `docs/integration/hosts.md`: the Kimi Q5 paragraph.
- `docs/hosts/snippets/kimi.md`: the introduction, the archived-CLI paragraph (the `kimi mcp add` observation), the shape sentence, the manual
  registration sentence, a new section for the legacy CLI observed 2026-11-19, the evidence table, a workaround section, the known limits.

## Migration note

Not needed: the recipe did not change, so no existing install needs a refresh and no migration section was written. The workaround section is the
guidance for the environment names.

## Commands run

- Build of `dist` from a clean tree with the project compiler: no errors.
- `env -u CI REALM_WRITE_HOST_MATRIX=1` with the host-support-matrix test: 8 of 8 passed, block regenerated; the diff shows only the kimi row.
- Host-support-matrix, host-gaps, wave1-boot-matrix, host-docs, host-contract-matrix, recipes-bare, host-registry and kimi-recipe compiled tests: 187 of
  187 passed, 0 failed, 0 skipped.
- Lint of the changed test file: no issues. Host-path check: ok. `check:docs` (host paths, agents sync, default mode): ok. `check:gates` (gate closure, module size, export usage with 0 stale allowlist entries, lockfile integrity): no violations.

## Removal and stack (Task 3)

- The scratch directory of the phase is absent (confirmed by command on 2026-11-19: the path does not exist), as plan 47-02 recorded at its end. No throwaway
  home of the phase remains. The package cache was kept inside the scratch directory and went with it.
- The default user uv cache holds an index metadata file for kimi-cli dated 2026-11-18 (the Phase 43 window, before the Phase 47 install); the phase wrote
  nothing outside its scratch cache, and that file was left as found.
- The stack comparison (0 containers, 0 sandboxes, empty workspace, no daemon, no kimi presence or receipt, same policy digest, real Kimi config absent before
  and after) is the one recorded in 47-02-SUMMARY.md; this plan ran no live command and does not repeat it. The evidence directory is outside the repository and
  named nowhere in it (the host-path check runs over the tree).
- `package.json` and `package-lock.json` are unchanged; nothing under src changed.

## ROADMAP success criteria and requirements

1. Met: the legacy CLI was reinstalled outside the repository, the production tier rerun cold, every run classified (KIMV-01 met as recorded).
2. Not met as a cause (carried): the failure was not reproduced and the cause is not established (KIMV-02 carried; OD-47-3 default).
3. Met as recording: the needed names and the no-expansion fact are recorded, with the accepted residual and the manual workaround (KIMV-03 met as accepted-residual by OD-47-1 option a).
4. Met: the registry, the four gap rows, the wave 1 page, the matrix block, the snippet, the contract page and the hosts page agree (KIMV-04 met).

Owner decisions: OD-47-1 answered (option a, 2026-11-19); OD-47-3 (KIMV-02 recorded as carried when not reproduced) keeps its default, carried; OD-47-2 and
OD-47-5 take their defaults (no recipe change, no new gap id). The verification file and the registration of the requirements are orchestrator steps. Phase 48
reads the registry t3 status `gap`; its promotion rule applies when a production tier passes its bound.
