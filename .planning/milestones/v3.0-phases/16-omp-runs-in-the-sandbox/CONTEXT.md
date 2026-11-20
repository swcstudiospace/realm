# Phase 16 — Omp runs in the sandbox: CONTEXT (consolidation)

Canonical detail reused: `16-CONTEXT.md` incl. P16-D1..D6, `16-01..16-04-PLAN.md`,
`16-SUMMARY.md`, `16-VERIFICATION.md`. Depends on Phase 12 harness/spike —
reused, not rewritten: `../12-scripted-provider-harness-and-omp-enforcement-spike/12-02-PLAN.md`
and `12-03-PLAN.md` (12-01 also exists). Phase 12 is not rewritten here.

## Goal
Register the five frozen Realm tools, enforce the proved host policy in
fail-closed mode, keep advisory natives except same-name read/write
replacement, and prove a real Omp write through the production sandbox+audit.

## Owner decisions D1–D6 relevance
- D3: proved removal OR blocking; keep `tool_call` guard; native
  "Tool bash not found" is NOT catalogue-code acceptance (P16-D5:
  bash stays active and is guard-refused `POLICY_DENIED`; docs must say
  guard, not containment). D2: scripted-provider basis only, never LLM.
- D4: fail-closed default (Phase 15) is the mode this phase enforces.
  D1: proposal 1. D5/D6: no catalogue addition, no workflow change here.

## Honest status
OMPX-02 IU (successful-read regression/model-visible proof incomplete);
OMPX-03 MC (active-set/lifetime correctness + actual catalogue bash proof
missing); OMPX-04 IU shadowing, MC safe restore/mode publication;
OMPX-05 MC + live-gated (no real production /workspace+host+audit pair).
Never claim Podman/live proof from fake-backed fixtures.

## Grey areas (decisions, NOT plans to fake)
- HARN-03 (Phase 12) stays FAILED / owner-blocked: warm 44 offenders,
  cold skip 49, proxy lever 0/0/7 is narrower. Recorded here as a
  grey-area decision; this phase does not repair it and does not relax
  zero-external/zero-DNS acceptance.
- O4 bounded re-attach is a Phase 16 unit (P16-D1), default off
  (`REALM_OMP_REATTACH`), host-side only — not a new requirement ID.
- Phase 16 starts with Phase 12 dependency waived (owner, 2026-11-01);
  live window not approved → OMPX-05 live step is human-needed checkpoint.

## Success criteria (verbatim, REQUIREMENTS OMPX-02..05)
- OMPX-02: The extension registers `exec`, `read`, `write`, `list` and `status` as Omp tools; each calls the daemon client with the frozen `ToolCall` shape, so validation, locking, audit and the state gate stay in the shared dispatcher (`retry` stays the existing `realm-retry` command; no `glob` tool is added)
- OMPX-03: In fail-closed mode the built-in `write`, `edit` and `bash` are removed or blocked by the mechanism the OMPX-01 spike proves, the existing `tool_call` guard stays as a backstop, and a model-issued `bash` call is refused with a catalogue code; if the API cannot enforce removal, the status text and the docs say that fail-closed is a guard and not containment (owner decision D3)
- OMPX-04: In advisory mode the Realm tools are registered and the built-in tools other than `read` and `write` stay available, with the existing notice; the registered Realm `read` and `write` displace the built-in `read` and `write` because they share their names (owner decision, the one exception)
- OMPX-05: On a live Omp with the realm active, a model-issued write through the registered tool lands in the sandbox's `/workspace` and appears in the host root, and the audit log holds an admission line and a result line for it; this runs through the Phase 12 harness
