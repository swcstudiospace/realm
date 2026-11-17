---
phase: 16-omp-runs-in-the-sandbox
verified: 2026-11-14
verdict: passed
status: passed
ref: origin/main 191293b (includes PR 77 and PR 80; OMPX-05 live pass recorded in <home>/realmlive/realm-evidence/phase14/16-ompx05-live.txt)
supersedes: 16-VERIFICATION.md at origin/main 06a3e40 (2026-11-14, human_needed; criterion 4 open)
---

# Phase 16: Omp runs in the sandbox: Final verification at 191293b

**Goal:** A model working through Omp does its file mutations and commands through Realm's tools in the sandbox, and in fail-closed mode its built-in host `write`, `edit` and `bash` are gone or refused.

**verdict: passed.** All four roadmap success criteria have code, test and evidence on `origin/main` 191293b. Criterion 4 (OMPX-05) is closed by the production live run recorded in `<home>/realmlive/realm-evidence/phase14/16-ompx05-live.txt` (`# tests 1`, `# pass 1`, `# fail 0`). The 2026-11-14 `human_needed` report at 06a3e40 is superseded.

**Method.** Worktree `<tmp>/wt-p16f` on branch `gsd/phase-16-verify-final` from `origin/main` 191293b. Static reads, greps, `git log` and one read of the live evidence file. No tests, lint, typecheck, build, formatters or live operations were run by this verification. Line numbers are at 191293b. Nothing was committed.

## Goal Achievement: Roadmap Success Criteria

Criteria text: `.planning/ROADMAP.md` Phase 16 section.

| # | Criterion | Status | Evidence on main (191293b) |
| --- | --- | --- | --- |
| 1 | Extension registers `exec`, `read`, `write`, `list`, `status` as Omp tools, each calling the daemon client with the frozen `ToolCall`; `retry` stays the `realm-retry` command; no `glob` tool; frozen tool schema tests unchanged (OMPX-02) | VERIFIED (static) | Names: `src/omp/tools.ts:16` (`REALM_TOOL_NAMES`). Tool specs: `src/omp/tools.ts:137-205`. Definitions: `realmToolDefinitions` `src/omp/tools.ts:211`. Frozen single-key call: `callOf` `src/omp/tools.ts:233`, one `ToolCall` per tool. Registration: `src/omp/plugin.ts:688-689` (`for ... pi.registerTool(tool)`). `retry` as command: `src/omp/plugin.ts:694`. No glob: `src/omp/tools.ts:8`, test `test/omp/tools.test.ts:60`. Per-call and per-tool-input tests: `test/omp/tools.test.ts:91`, `:114`, `:126`. Frozen schema files `src/contract/tools.schema.json` and `test/contract/tool-input-gate.test.ts` carry no Phase 16 commit (last change Phase 1 and earlier), so the frozen tests are unchanged. Not run here. |
| 2 | Fail-closed: built-in `write`, `edit`, `bash` removed or blocked by the spike-proven mechanism; `tool_call` guard kept as backstop; model `bash` refused with catalogue code; guard-not-containment stated in status text and docs (OMPX-03) | VERIFIED (static) | Keep-list: `src/omp/tools.ts:37` (`FAIL_CLOSED_KEEP` = read-only built-ins, Realm tools, `bash`), `failClosedToolNames` `:39-41`. Removal plan: `planHostTools` `src/omp/tools.ts:67-79`; setter and read-back `applyHostMode` `src/omp/host-tools.ts:76`, `setHostMode` `:58`. `bash` refusal: `src/omp/plugin.ts:814-815` (fail-closed returns `POLICY_DENIED`). Backstop hook: `src/omp/plugin.ts:692`, `guardHostToolCall` `:731`. Status text: `src/omp/plugin.ts:178` appends "(Omp host-tool guard; not host process containment)". Docs: `docs/integration/omp.md:150`, spike `:242`. Tests: `test/omp/tools.test.ts:143`, `:257`; `test/omp/plugin.test.ts:1080` (removal, read-back), `:1094` (removal that does not hold refuses bash), `:1128` (backstop refuses `bash` with `POLICY_DENIED`, passes read-only tools), `:1447`, `:1455` (bash refused whatever state, and when status unreadable). Status-text constants `test/omp/plugin.test.ts:66-67`. |
| 3 | Advisory: Realm tools registered; built-ins other than same-name `read` and `write` stay available; existing notice shows; registered Realm `read` and `write` displace built-ins by name-shadowing (OMPX-04) | VERIFIED (static) | Advisory plan: `src/omp/tools.ts:73-78` (keeps every reported tool, restores owed ones, owes nothing). Realm `write` is never hidden: `src/omp/plugin.ts:664`, guard pass-through `src/omp/plugin.ts:746`. Advisory notice: `src/omp/plugin.ts:875` (`the write proceeds under advisory policy`). Name-shadowing exception recorded: `docs/integration/omp.md:150`; spike S1 `docs/integration/omp.md:242`. Tests: `test/omp/tools.test.ts:184` (advisory plans every tool and owes nothing), `:251`; `test/omp/plugin.test.ts:1147` (advisory with realm not active changes no tool, `bash` passes, guarded edit keeps the notice), `:1469`. |
| 4 | In the Phase 12 harness with the realm active, a model-issued write through the registered tool lands in the sandbox `/workspace` and appears in the host root, and the audit log holds an admission and a result line for it (OMPX-05) | VERIFIED (code, test, live evidence) | Code path: `src/omp/tools.ts:170-186` (`write` spec), `src/omp/plugin.ts:689`. Test: `test/integration/omp-ompx05.test.ts:122` (the one scenario, skips unless both `REALM_LIVE_OMP=1` and `REALM_LIVE_PRODUCTION=1` are set). Assertions: host file equals written bytes, `:226-231`; sandbox `cat` and `sha256sum` under `/workspace` equal the written bytes, `:240-258`; container identity and session naming, `:262-269`; audit file holds one admission line and one result line for the path, with matching `correlationId` and sha256, `:293-311`. Live evidence: `<home>/realmlive/realm-evidence/phase14/16-ompx05-live.txt` contains the TAP line `ok 1 - Omp's registered Realm write reaches the production daemon: the host file, the sandbox copy and the audit pair agree`; read in this verification: `# tests 1`, `# pass 1`, `# fail 0`, `# skipped 0`, one `ok` line and zero `not ok` lines. |

**Score:** 4/4 criteria verified. 0 behavior-unverified, 0 gaps.

## Requirement Coverage (OMPX-02..05)

| Requirement | Status | Evidence |
| --- | --- | --- |
| OMPX-02 | SATISFIED | Criterion 1 rows above. Consumer read proof (UTF-8, byte count, digest, truncation, both Buffer wire forms): `src/omp/tools.ts:254` (`resultOf`) and `:286` (`bytesOf`); tests `test/omp/tools.test.ts:284`, `:300`, `:316`, `:332`, `:348`, `:363`. |
| OMPX-03 | SATISFIED | Criterion 2 rows above. |
| OMPX-04 | SATISFIED | Criterion 3 rows above. |
| OMPX-05 | SATISFIED | Criterion 4 row above, with live pass recorded. |

## Anti-Pattern and Scope Check

- A grep for `TODO`, `FIXME` and `XXX` in `src/omp/tools.ts`, `src/omp/host-tools.ts`, `src/omp/plugin.ts`, `src/omp/extension.ts` and `test/integration/omp-ompx05.test.ts` found no match.
- The Phase 16 wording "removed or blocked" is met by removal of every non-kept built-in plus refusal of `bash` in the guard. `edit` is removed from the active set and also refused by the guard (`src/omp/plugin.ts:741`, `:781`).

## Residuals (not verdict-blocking)

1. **Traceability.** `16-03-PLAN.md:17` and `:53` name `test/integration/production-driver.test.ts`. The OMPX-05 scenario is in `test/integration/omp-ompx05.test.ts:122`, and `production-driver.test.ts` has no OMPX-05 case. The plan names the wrong file; this report cites the actual file.
2. **Live evidence provenance.** `16-ompx05-live.txt` has no commit, tree, date or Omp version header. It does not by itself establish that the run used 191293b. The file's content matches the test name in `omp-ompx05.test.ts` on this tree. The run commit should be recorded in the evidence directory.
3. **Two evidence sidecars not written.** The same file records `EACCES` for `phase14/ompx05.frames.jsonl` and `phase14/ompx05.requests.json`. The test pass stands; the two sidecar artifacts are absent from the evidence directory.
4. **No test re-run in this verification.** Criteria 1 to 3 rest on code reads and test presence plus the recorded Phase 12 and Phase 16 work. Criterion 4 rests on the recorded live pass. The named suites (`test/omp/tools.test.ts`, `test/omp/plugin.test.ts`, `test/integration/omp-guard.test.ts`, `test/contract/tool-input-gate.test.ts`) were not run here.
5. **Guard, not containment.** Fail-closed is an allowlist plus a `tool_call` backstop. Host paths that bypass the extension pipeline are not covered (`docs/integration/omp.md:150`). The status text and docs say so (`src/omp/plugin.ts:178`).
6. **Stale phase summary.** `16-SUMMARY.md` (2026-11-02) states 16-03 is not executed. It is historical; this report supersedes it for OMPX-05.

## Verdict

verdict: passed

All four criteria have code, test and live evidence on `origin/main` 191293b. Residuals 1 to 6 are traceability and provenance notes, not blockers.
