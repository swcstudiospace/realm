---
phase: 29-mcp-tool-annotations
verified: 2026-11-17
verdict: passed
status: passed
score: "2/2 requirements covered (MCPA-01, MCPA-02); the claims rest on repository files read on 2026-11-17 and on CI of PR 134, not on a build, test or live run by the verifier; 5 items outside the evidence reach, listed as behavior_unverified"
ref: "origin/main 63f89c0 (PR 134 squash: plans 29-01 and 29-02)"
behavior_unverified: 5
overrides_applied: 0
covered_files:
  - ".planning/phases/29-mcp-tool-annotations/29-CONTEXT.md"
  - ".planning/phases/29-mcp-tool-annotations/29-01-PLAN.md"
  - ".planning/phases/29-mcp-tool-annotations/29-01-SUMMARY.md"
  - ".planning/phases/29-mcp-tool-annotations/29-02-PLAN.md"
  - ".planning/phases/29-mcp-tool-annotations/29-02-SUMMARY.md"
  - "src/mcp/protocol.ts"
  - "src/mcp/server.ts"
  - "src/contract/tools.schema.json"
  - "test/support/mcp-annotation-pins.ts"
  - "test/mcp/annotations.test.ts"
  - "test/mcp/descriptors.test.ts"
  - "test/mcp/server.test.ts"
  - "scripts/check/mcp-smoke.mjs"
  - "scripts/check/mcp-smoke.test.mjs"
  - "docs/integration/mcp.md"
  - "test/docs/tool-annotations-doc.test.ts"
  - "test/integration/production-driver.test.ts"
  - "AGENTS.md"
  - "CONTRIBUTING.md"
covered_digest: "v3:sha256:a44946cd2400c80b5a6eab78690af27bdaa9413cb5c8ef801e27d9e9340ab33e"
---

# Phase 29 Verification: MCP tool annotations

Method: read-only read of `origin/main` at `63f89c0` on 2026-11-17 (the annotation table and the descriptor construction in `src/mcp/server.ts`, the `McpToolAnnotations` type in `src/mcp/protocol.ts`, the exports of the pin module, the mutant-count assertions in `test/mcp/annotations.test.ts` and `scripts/check/mcp-smoke.test.mjs`, the MCPA test titles in `test/mcp/server.test.ts`, the cross-pin test, `EXPECTED_ANNOTATIONS` and `checkAnnotations` in `scripts/check/mcp-smoke.mjs`, the Q9 section and its markers in `docs/integration/mcp.md`, the live assertion in `test/integration/production-driver.test.ts`, the `check:mcp` lines of `AGENTS.md` and `CONTRIBUTING.md`), the file list of the PR 134 squash, and the CI result of PR 134 (green after one fix round). The verifier did not run the build, lint, tests, `npm run check:mcp` or the live suite. Phase 29 changes tool metadata only: the diff is 14 files, with no change to enforcement, to the frozen tool schema, to a result shape or to an error code.

Rule recorded by this phase: annotations are hints for a host that chooses to use them, never a security control. No code in `src` reads them; the real controls are unchanged (the dispatcher's schema check, the shell gate, policy mode, the mutation gate, path locks, the sandbox).

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| MCPA-01 | Every one of the six tools advertises `title` and `annotations` with the four hints in both protocol eras (legacy `initialize` era, 2025-11-25 and 2025-06-18, and revision 2026-07-28), with the values of D-29-03 | SATISFIED by repository evidence and CI | `src/mcp/server.ts` (frozen table with the six rows; `MCP_TOOL_DESCRIPTORS` built from it); `src/mcp/protocol.ts` (`McpToolAnnotations` with five required keys; descriptor fields `title`, `annotations`); `test/mcp/server.test.ts` ("MCPA-01" tests for a legacy session, a 2025-11-25 session, a modern `tools/list`, and identical tool objects in both eras); `test/mcp/annotations.test.ts` (behavior honesty: read, list and status leave workspace bytes unchanged, write is idempotent, retry in `active` changes nothing); `docs/integration/mcp.md` Q9 (sources read 2026-11-17: the ToolAnnotations fields are identical in the three revisions) |
| MCPA-02 | A test pins the annotations per tool against the tool contract and observed behavior, runs on the wire in both eras, and a mutation of any annotation fails a test; the smoke gate and the docs table are pinned to the same table | SATISFIED by repository evidence and CI | `test/support/mcp-annotation-pins.ts` (independent pin table, `annotationViolations`, rules derived from `src/contract/tools.schema.json`); `test/mcp/annotations.test.ts` (mutation test asserting 93 mutants, each reported with the mutated tool named; cross-pin test comparing the smoke table with the pins); `scripts/check/mcp-smoke.mjs` (`EXPECTED_ANNOTATIONS`, `checkAnnotations`, run per era) and `scripts/check/mcp-smoke.test.mjs` (90 seeded faults); `test/docs/tool-annotations-doc.test.ts` (docs table equals the pins) |

"Satisfied by repository evidence and CI" means the artifacts exist with the content described and CI of PR 134 passed. It does not mean the verifier ran them, and it says nothing about what any host does with the hints.

## Key facts checked

- The six rows of the table in `src/mcp/server.ts` match D-29-03: exec (readOnly false, destructive true, idempotent false, openWorld true); read, list and status (true, false, true, false); write (false, true, true, false); retry (false, false, true, false). Each row also carries `title`, and the descriptor's top-level `title` is taken from the same row.
- The table is `Object.freeze` per row, static for the process, and its comment states that no code reads the hints and names the real enforcement.
- `test/support/mcp-annotation-pins.ts` is a separate literal from the `src` table; `scripts/check/mcp-smoke.mjs` holds a third, hand-written copy; the docs table between the Q9 markers is the fourth representation. The cross-pin test and the docs test tie them together.
- `docs/integration/mcp.md` Q9 records the read date 2026-11-17, the shape per revision, the rule that clients must treat annotations as untrusted unless they come from trusted servers, and the host-dependence statement; Q3 points to Q9.
- The docs test file is `test/docs/tool-annotations-doc.test.ts`. The first CI run failed because the stale Phase 2 taxonomy test forbids a test file name containing `mcp`; the file was renamed from `test/docs/mcp-annotations-doc.test.ts` and the plan paths were updated. CI was green after that single fix round.
- The PR changes no file under `src` other than `src/mcp/protocol.ts` and `src/mcp/server.ts`, and does not touch `src/contract/tools.schema.json`, `package.json`, the CHANGELOG, `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md` (the squash file list shows 14 files).

## behavior_unverified

1. **No client or host behavior with the hints was observed.** What Claude Code, Grok Build, Omp or any other host does with `readOnlyHint`, `destructiveHint`, `idempotentHint` or `openWorldHint` (auto-approve, prompt, plan mode, ignore) is host-dependent and not verified (OQ-29-05). Q9 says so. MCPA-01 and MCPA-02 do not require it.
2. **The production-driver live assertion was not run.** `test/integration/production-driver.test.ts` checks the shape of each descriptor on the `tools/list` of a real `realm mcp` (title, annotations object, four boolean hints, `annotations.title` equal to `title`); it needs Podman 5.x, the compute driver and the other prerequisites of that file and is skipped by a default `npm test`. It checks shape only; exact values are pinned by the unit and smoke layers.
3. **The 93 and 90 mutant counts were not independently recounted.** They are the figures asserted in `test/mcp/annotations.test.ts` and `scripts/check/mcp-smoke.test.mjs`; the verifier read the assertions but did not run the generators or inspect each mutant.
4. **Tests, the build and `npm run check:mcp` were not run by the verifier.** Their results rest on CI of PR 134. The plan's manual acceptance step (edit one value in `src/mcp/server.ts`, rebuild, see the tests fail, revert) was not repeated.
5. **Owner choices OQ-29-01 to OQ-29-05 stand at their defaults, not confirmed by the owner:** retry is not destructive (OQ-29-01); exec is open world although the default policy keeps it offline (OQ-29-02); `title` appears at the top level and in `annotations` (OQ-29-03); write is destructive and idempotent, so a host that prompts on destructive tools will prompt on every write, including the creation of a new file (OQ-29-04); host behavior is documented as host-dependent (OQ-29-05).

## Residuals (not verdict-blocking)

- **R1: planning bookkeeping.** This verification does not edit `ROADMAP.md`, `STATE.md` or `REQUIREMENTS.md`; marking Phase 29 complete and MCPA-01 and MCPA-02 satisfied is the orchestrator's step through GSD commands.
- **R2: hints can be wrong in the safe direction.** Where a value depends on something the descriptor cannot see (policy), Realm states the broader one, so a host may ask for one prompt more than needed and never one fewer. A create-only write variant, or a policy-derived `openWorldHint`, would be a contract or design change and is out of scope.
- **R3: a hostile sibling MCP server steering calls to `exec` or `write` is not addressed by annotations** (Q9 says so); containment and the host's consent duty are the controls.

## Verdict

passed: the annotation table, the type, the pin module, the wire, mutation, behavior, smoke-gate, cross-pin and docs tests, the Q9 section and the two one-line gate descriptions exist on `main` at `63f89c0`, the values match the D-29-03 table, the Phase 29 change is limited to tool metadata and tests and docs, and CI on PR 134 passed after one fix round (the docs test file rename). Nothing in the phase is FAILED. The five items above are not proven and must not be claimed beyond what is stated; in particular nothing here says any host changes its behavior because of the hints, and the live production-driver assertion has not run.
