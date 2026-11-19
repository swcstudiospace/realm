---
phase: 47-legacy-kimi-production-tier-and-env-forwarding
plan: "02"
subsystem: testing
tags: [kimi, window, reproduction, ablation, probes]
requires:
  - phase: 47-legacy-kimi-production-tier-and-env-forwarding
    provides: plan 47-01 instrument (timeline recorder, frozen rules, evidence and reach support, probes)
provides:
  - the dated window record 47-WINDOW.md computed by the frozen rules
affects: [47-03, 47-04]
requirements-completed: [KIMV-01]
---

# Plan 47-02 summary: the window

One window on 2026-11-19, serial, under the shared live lock, on the production stack, owner authorization of 2026-11-19 (HITL; OD-47-4: the
window, split not needed). The commit under test is the merge of plan 47-01 (v0.7.3). No file under src, test, docs, package.json or
package-lock.json changed; only the phase directory holds new files (47-WINDOW.md and this summary). Nothing was committed. The evidence is
outside the repository (placeholder EVIDENCE_DIR, named nowhere in it); a copy is kept with the orchestrator.

## Install record

kimi-cli 1.51.0, a virtual environment on the system Python 3.12 (named explicitly), uv with the package cache inside the scratch directory
(SCRATCH_DIR), exact pin kimi-cli equal to 1.51.0, on 2026-11-19; installed size 250 MB; free space 8.0 GB before and 7.7 GB after. The wheel
re-downloaded with the same pin has the same SHA-256 as the registry value (ffb9d0d4725844d36d6c78e8d3914a96b2d6a17678c217f3abe7336fb7e02d0e,
uploaded 2026-09-21); 1.52.0 is the deprecation stub (archived). `kimi --version` prints kimi, version 1.51.0 in a throwaway home with a
cleared environment, and as the live account; no text saying the product is unmaintained. 127 frozen dependencies, not hash-pinned (accepted
residual); fastmcp 3.2.4 and mcp 1.30.0 resolved. The O-tier source notes of the installed version are in section 6 of 47-WINDOW.md.

## Steps, runs and outcomes (all O, 2026-11-19)

| Step | Runs | Outcome |
| --- | --- | --- |
| A, control C1 and the two probes | 1 test run (validator, validator session, expansion probe, writer probe: 4 of 4 passed) | C1 ANSWERED with the six tools (30497 ms for the whole client command); expansion probe: references NOT expanded (brace and bare spellings both arrive as the reference text, the literal arrives unchanged); writer probe: returned exit 0 and wrote an mcp.json with members command, args, env, indent 2, no trailing newline |
| B, control C2 | 1 | handshake replies at 1720 ms (bound 10000 ms); first success at 27940 ms; attached 1 |
| C, cold reproduction (default drive) | 3 | 3 valid cold runs, all ANSWERED with the six names; rule D-47-04: **NOT-REPRODUCED** (stop rule held after the third). The tests failed their own 25000 ms cold connect bound (28804, 31393 and 32301 ms on a loaded host), which is outside the frozen classification |
| D, ablation | 7 (none; minus each name twice) | XDG_CONFIG_HOME **NEEDED**, XDG_RUNTIME_DIR **NEEDED**, REALM_DRIVER_SOCKET **NOT-NEEDED** (for this non-default stack); S0 (nothing restored) **not reached**, the client exited 1 because `realm mcp` exited at start with SCHEMA_INVALID |
| E, warm control C3 | 0 | not run: Step C did not end REPRODUCED |

Cause by D-47-05: **NOT-ESTABLISHED**. GAP-43-03 stays open with the narrowing in 47-WINDOW.md. An I-tier candidate for the instrument of
2026-11-18 is recorded there as an inference only: the legacy client sends SIGKILL to the stdio server process a few milliseconds after the
tools/list response (a direct process trace, no stack), the recorder writes its log line after it forwards, and ablation folder 10 shows a
client that printed all six tools while the recorder log has no response (18294 ms, exit 0, the same shape as the 18225 ms run of 2026-11-18).

Blockers: none. No catalogue-coded failure of a step; the failures are test assertions that are data (the 25000 ms bound in the default runs,
the exit code and wire assertions in the diagnostic variants).

## Answers to the open questions

- OQ-47-01: the legacy client does not expand `${NAME}` or `$NAME` in an env value (probe, three names, two spellings, plus a literal control).
- OQ-47-02: the host's own `kimi mcp add --transport stdio --env` returns (exit 0) in the isolated home and writes an mcp.json; it differs from
  the recipe output by the env member and by having no trailing newline.
- OQ-47-03: where the client's time goes is not measured beyond the marks: the client alone against the fake server takes 30497 ms in total while
  the wire marks are within about 1.2 s of the recorder start, so most of the time is the client's own on a loaded host (no claim beyond that).

## Owner decisions and what plan 47-03 and 47-04 take from this

- OD-47-1 (answered 2026-11-19, option a): the names are needed and the client does not expand references, so branch E-B applies; an install-time
  capture capability in its own phase (CAPT-09 amendment later) is noted, not implemented here. Until then GAP-43-01 carries the manual
  workaround with the exact names (XDG_CONFIG_HOME and XDG_RUNTIME_DIR for this stack; REALM_DRIVER_SOCKET was not needed).
- OD-47-3 (default applies): NOT-REPRODUCED, KIMV-02 carried, GAP-43-03 narrowed and never closed on this evidence.
- Needs a decision from the owner or the orchestrator for plan 47-04: the production test itself failed its 25000 ms cold connect bound in all
  three default runs because the legacy client alone takes 28 to 32 s on this loaded host, while the wire classification is ANSWERED with the six
  names. 47-WINDOW.md records both facts; whether the registry note says the tier passed, failed on a bound, or stays as it was, is the choice of
  plan 47-04 and is not made here.
- Plan 47-03: Branch D and E-B only; no change that the production tier exercises, so its live re-run is skipped by its own rule.

## State of SCRATCH_DIR and the stack

SCRATCH_DIR, including the virtual environment and the package cache, was **removed at the end of this run** because plan 47-03 takes no branch
that needs it (absence confirmed); plan 47-04 Task 3 therefore only confirms it is absent. The built tree copy in the account home was removed.
The before and after snapshots are equal (0 containers, 0 sandboxes, empty workspace root, no daemon, no kimi presence or receipt, same policy
digest, real Kimi config absent). The shared live lock was held per command and is released. One slip, restored within the minute: the account home
directory mode was changed once during result reading and set back to its original mode (no content changed).

## Success criteria (ROADMAP Phase 47)

1. Met: the legacy CLI was reinstalled outside the repository and its production tier rerun cold, with the wire log and full command output kept
   outside the repository and every run classified.
2. Half met: the cause is recorded as NOT-ESTABLISHED (not reproduced); the fix or variant is plan 47-03, which takes no code branch.
3. Half met: the live evidence says which names are needed and that references are not expanded; the recipe or the accepted-residual is plan 47-03.
4. Plan 47-04.
