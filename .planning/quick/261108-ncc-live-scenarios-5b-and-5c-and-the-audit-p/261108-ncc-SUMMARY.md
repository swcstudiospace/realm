---
quick_id: 261108-ncc
slug: live-scenarios-5b-and-5c-and-the-audit-pair-validator
date: 2026-11-08
status: complete
commit: 9cdbe8e
files_modified:
  - test/support/production-live.ts
  - test/integration/production-live-helpers.test.ts
  - test/integration/omp-ompx05.test.ts
  - test/integration/production-driver.test.ts
---

# Quick task 261108-ncc: live scenarios 5b and 5c and the audit-pair validator

## Outcome

One code commit, `9cdbe8e`, with the four files in scope and nothing else. The live scenarios stay gated and were not run.

## What changed

- **`auditPairProblems(records, expected)`** (`test/support/production-live.ts`): a pure validator for the audit lines of one tool call. It returns problem strings; empty means the pair is as expected. It checks exactly one admission line and exactly one result line, admission before result, the same non-empty string `correlationId` on both (and the expected one when given), and the expected `tool` and `sessionId` on each. Only the result line's `outcome` is compared with the expected outcome, because the admission line always carries `"ok"`.
- **`parseSessionVolumeNames` and `listSessionVolumes`**: the first filters `podman volume ls` output by exact name `scratchVolumeNameOf(sessionId)`, imported from `src/runtime/hardening.ts`. The second runs `podman volume ls --format {{.Name}}` the way `listSandboxContainers` runs its listing. The filter is exact because `--filter name=` is a substring match.
- **Omp write test** (`omp-ompx05.test.ts`): the admission and result count checks, the result `correlationId` check, the admission/result correlation equality and the result `outcome` check are replaced by one `auditPairProblems` assertion. The byte-count and sha256 assertions on the result and admission lines are unchanged.
- **Production live 6** (`production-driver.test.ts`): the join assertion (count of two and phase inclusion) is replaced by `auditPairProblems` with tool `write`, the scenario's session id, outcome `ok` and the correlation id. The `requests.log` parse check and `realm audit verify` are unchanged.
- **Production live 5b** (SIGTERM destroy path): the single daemon is signalled with SIGTERM, and the scenario waits up to `RESIDUE_TIMEOUT_MS` for the daemon to exit and its sandbox container to be removed. It then runs `realm up` and asserts:
  - exactly one new container, not prefix-matching the removed one;
  - the status notice says "destroyed at startup" with 0 containers and at least 1 session record;
  - the restart's `daemon.startup` line, read from the bytes of `daemon.log` after the pre-restart offset, has `adopted 0` and `containersRemoved 0` (checked by `startupLineWith`), and its parsed `recordsDeleted` is at least 1 (asserted on the parsed value; the helper's equality is not loosened);
  - `realm audit verify` reports ok.
- **Production live 5c** (scratch volume): an MCP `exec` writes a marker to `/scratch` as positional shell arguments. The scenario checks the session has exactly one scratch volume, SIGKILLs the daemon, runs `realm up`, and checks the volume survives. A second `exec` reads the marker back with identical bytes. Then `realm down` runs, the residue wait passes, and a volume poll (failed listings count as failures) confirms the volume is gone.
- **Hermetic tests** (`production-live-helpers.test.ts`): 17 new cases. Each failure case asserts the exact problem text. They cover the ok pair, the result-outcome comparison, the missing, duplicate and reversed pairs, the correlation id mismatch and missing or non-string ids, the wrong session id, the wrong tool and outcome, unexpected phases, the empty record list, and the volume-name parser.

## Preconditions and decisions

- Quick task L1 (261108-ncb, commit a833ece) had landed. `startupLineWith(log, expected)` and `adoptedCountOfNotice(notice)` were exported with the signatures the orchestrator notes describe; no `containerId` parameter was added.
- `reapCountsOfNotice` was kept in `production-live.ts` and its import was re-added to `production-driver.test.ts` for scenario 5b.
- Scenario 5c has no `assertDownAndClean` at its end: the `startScenario` cleanup hook already asserts residue. The scenario calls `down` and `waitForNoResidue` inline, as the plan describes.
- `describeValue` JSON-encodes its output a second time, so string values appear with escaped quotes in problem text. The hermetic tests build their expected text with `describeValue` for that reason. The helper itself is unchanged.

## Verification (run by this task)

| Command | Result |
|---|---|
| `npm run typecheck` (through the heavy lock) | exit 0 |
| `npm run lint` (through the heavy lock) | exit 0 |
| `npm run check:gates` (through the heavy lock) | exit 0: gate closure no violations, module size 107 files checked, no violations |
| `npm run build && node --test dist/test/integration/production-live-helpers.test.js` (through the heavy lock) | exit 0: 96 pass, 0 fail, 0 skipped |
| `npm run check:docs` (through the heavy lock) | exit 0: host paths ok, agents sync ok, default-mode check ok |

The gated suites (`production-driver.test.js`, `omp-ompx05.test.js`) were compiled by typecheck and build but not executed. No live stack was touched: no podman, openshell or systemctl invocation, nothing under the live account's home.

## Follow-up for the orchestrator (not edited here)

- `AGENTS.md` (Commands) says the production live suite has "ten scenarios", and `README.md` and `docs/integration/openshell.md` cite dated evidence of ten. This change adds 5b and 5c, so the suite's scenario count is now twelve. Those files are outside this task's scope and were left untouched.
- `.planning/config.json` carries the orchestrator's uncommitted change. It was never staged or reverted.
