---
phase: 28-remove-the-anda-bridge
verified: 2026-11-22
verdict: passed
status: passed
score: "3/3 requirements covered (ANDAX-03, ANDAX-04, ANDAX-05); the claims rest on repository files read on 2026-11-17 and on CI of PR 138, not on a build, test or live run by the verifier; 6 items outside the evidence reach, listed as behavior_unverified"
ref: "origin/main 29d2f2f (PR 138 merge commit b7fc985: plans 28-01, 28-02 and 28-03; PR head 54b6b41)"
behavior_unverified: 6
overrides_applied: 0
covered_files:
  - ".planning/phases/28-remove-the-anda-bridge/28-CONTEXT.md"
  - ".planning/phases/28-remove-the-anda-bridge/28-01-PLAN.md"
  - ".planning/phases/28-remove-the-anda-bridge/28-01-SUMMARY.md"
  - ".planning/phases/28-remove-the-anda-bridge/28-02-PLAN.md"
  - ".planning/phases/28-remove-the-anda-bridge/28-02-SUMMARY.md"
  - ".planning/phases/28-remove-the-anda-bridge/28-03-PLAN.md"
  - ".planning/phases/28-remove-the-anda-bridge/28-03-SUMMARY.md"
  - "src/runtime/config.ts"
  - "src/core/states.ts"
  - "src/core/status.ts"
  - "src/core/errors.ts"
  - "src/doctor/checks.ts"
  - "src/cli/main.ts"
  - "src/lifecycle/controller.ts"
  - "docs/integration/anda-decision.md"
  - "docs/policy-reference.md"
  - "scripts/check/export-usage-allowlist.json"
  - "scripts/check/module-size-allowlist.json"
  - "test/runtime/config.test.ts"
  - "test/core/states.test.ts"
  - "test/core/state-machine.test.ts"
  - "test/core/errors.test.ts"
  - "test/lifecycle/adopt-hydrate.test.ts"
  - "test/session/reap.test.ts"
  - "test/session/store.test.ts"
  - "test/daemon/client.test.ts"
  - "test/cli/cli.test.ts"
  - "test/contract/session-record.schema.test.ts"
  - "test/doctor/checks.test.ts"
covered_digest: "v3:sha256:4a4136cf4752927b66e76735e80ab236a74cc1b8ee50568c96dff093161c1068"
---

# Phase 28 Verification: Remove the Anda bridge

Method: read-only read of `origin/main` at `29d2f2f` on 2026-11-17 (the merge commit `b7fc985` of PR 138 and its four commits `2dda45d`, `a56bc15`, `8827afd` and `54b6b41`; the existence of `src/anda` and `docs/integration/anda.md`; `RETIRED_KEYS`, `retiredKeyNotes`, `loadRuntimeConfig` and `describeRuntimeConfigProblems` in `src/runtime/config.ts`; the retired-key lines of `src/cli/main.ts`; `STATES` and `ALLOWED_TRANSITIONS` in `src/core/states.ts`; `displayStatus` in `src/core/status.ts`; `CATALOGUE_SIZE` in `src/core/errors.ts`; `REGISTERED` in `src/doctor/checks.ts`; the two allowlist files; the Retired keys paragraph of `docs/policy-reference.md`; the head of `docs/integration/anda-decision.md`; the titles of the removal tests named below; the diff stats of the four commits; `CHANGELOG.md`), and the CI result of PR 138 as reported to the verifier (first run failed one export-usage gate, then green: Verify on Node 22.x and 24.x, the docs site, the audit). No test, build or gate script was run by the verifier.

Rule recorded by this phase: Realm no longer dials an Anda engine and has no Anda code, config key, error code, doctor item or lifecycle state. Anda, like any MCP client that speaks stdio, can still launch `realm mcp`. The removal is a breaking change of the 0.4 release line with no shim: the old key is refused, and a fixed sentence says what to delete.

## Requirements coverage

| Req | Statement | Status | Evidence |
| --- | --- | --- | --- |
| ANDAX-03 | The Anda bridge code, the `andaUrl` config key, `ANDA_UNREACHABLE`, `ANDA_VERSION_MISMATCH`, the degraded state, the Anda doctor check and the Anda tests are removed with no shim | SATISFIED by repository evidence and CI | `src/anda/` does not exist; `src/core/errors.ts` has `CATALOGUE_SIZE = 29` (was 31) and no `src` or `test` file names the two codes; `src/doctor/checks.ts` has `REGISTERED` with 10 items and no `anda-bridge`; `src/core/states.ts` has the five states and the nine edges, and `degraded` appears under `src` only in a comment of that file; `test/runtime/config.test.ts` pins that a loaded config has no `andaUrl`; the removal commits `2dda45d` (60 files, 3502 deletions) and `a56bc15` (36 files, 158 deletions) delete the Anda tests and fakes with the code. |
| ANDAX-04 | The state machine, status labels, schemas, policy reference, README and integration docs no longer mention the removed surface, and the `check:docs` and `check:gates` gates pass | SATISFIED by repository evidence and CI, with the residuals under Not verified | `src/core/states.ts` and `src/core/status.ts` (five states, two labels, no `degraded` field); `docs/integration/anda.md` is deleted; `docs/integration/anda-decision.md` is a superseded tombstone; `docs/policy-reference.md` has no bridge or degraded row; the docs commit `8827afd` touches README, AGENTS.md, `policy-reference.md`, the deleted `anda.md`, the tombstone and 9 other integration and checkpoint documents; CI of PR 138 ran the gates and was green after one allowlist fix. `docs/specs/realm-spec.xml` still describes Anda by decision (OQ-28-01), outside the gate. |
| ANDAX-05 | The removal is a documented breaking change: release note text and a config migration note (an `andaUrl` key is refused with a clear message) | SATISFIED by repository evidence and CI | `src/runtime/config.ts` holds the one fixed sentence in `RETIRED_KEYS`; `loadRuntimeConfig` refuses any key outside its closed set, so `andaUrl` gets `SCHEMA_INVALID` with any value; `src/cli/main.ts` prints the sentence on a following stderr line; `docs/policy-reference.md` quotes the same sentence and the instruction to delete the key; the three feature commits carry the bang marker and `CHANGELOG.md` lists them under 0.4.3. |

"Satisfied by repository evidence and CI" means the artifacts exist with the content described and CI of PR 138 passed. It does not mean the verifier ran them.

## Key facts checked

- The retired-key sentence is "andaUrl was removed in the 0.4 release line, with the Anda bridge: delete it from config.json". It is a literal in a closed table, so no key name and no value from the file reaches the output. The string in `src/runtime/config.ts`, the string in the Retired keys paragraph of `docs/policy-reference.md` and the constants in `test/runtime/config.test.ts` and `test/cli/cli.test.ts` are the same.
- `test/runtime/config.test.ts`: the refusal of `andaUrl` with any value, no `andaUrl` property on a loaded config, the problem list with the sentence for a hostile credential-looking value (the value, host and user do not appear), another unknown key adding only the generic line, and `retiredKeyNotes` returning nothing for any other input. `test/cli/cli.test.ts`: `status`, `doctor` and `doctor --fix` with the retired key, ending with the sentence on the line after the `SCHEMA_INVALID` text.
- `test/core/states.test.ts`: the state set is the five states; every edge naming `degraded` is refused with `REALM_INVALID_TRANSITION`. `test/session/store.test.ts`: a record with stored state `degraded` fails `load` with `SCHEMA_INVALID` and is still listed. `test/session/reap.test.ts`: such a record is deleted as unreadable and its container is removed as `no-record`. `test/daemon/client.test.ts`: a status reply without `display.degraded`, a reply from a 0.3 daemon carrying `degraded: false`, and a reply whose snapshot state is `degraded` (refused). `test/cli/cli.test.ts`: `realm up` exits 1 with `REALM_NOT_ACTIVE` for that reply.
- `scripts/check/export-usage-allowlist.json` holds `DEFAULT_REQUEST_TIMEOUT_MS` as a test seam (commit `54b6b41`, five lines). `scripts/check/module-size-allowlist.json` holds `src/lifecycle/controller.ts` at 1069, equal to the 1069 lines of the file at the read.
- The PR is 101 files, 575 insertions and 3889 deletions in four commits, not the eight commits the context planned (three feature commits and one gate fix).
- Release order on main: `v0.4.2` (`07c523d`) is the first parent of the merge commit; the release that followed the merge is `v0.4.3` (`29d2f2f`), and its changelog entry lists the three bang-marked subjects. [INFERENCE] The 0.4.3 entry is therefore the first release note that carries the breaking change.
- The orchestrator ran the built CLI on the PR head and reported that a `config.json` with `andaUrl` made `realm status` exit 2 with the sentence and `realm doctor` print it, and that `status` worked without the key. The evidence is not in the repository; the verifier did not repeat it.

## Not verified here

- `npm test` and `npm run test:coverage` were not run locally; the claim rests on CI of PR 138. Nobody ran the suites on a developer machine.
- The stale stored `degraded` records are covered by tests only (store, reap, client, CLI). No record written by a real 0.3 daemon was read by a 0.4 build, and the reap was not run against a real Podman container.
- The rewritten `test/lifecycle/adopt-hydrate.test.ts` cases were the riskiest edit (the hydrate tail lost its bridge step) and passed only in CI.
- The built-CLI smoke run is the orchestrator's observation and is not stored in the repository.
- `docs/specs/realm-spec.xml` still describes Anda (52 matches; OQ-28-01, the default is no edit). The owner has not answered. The other documents that still name Anda (the research note, the Phase 27 decision record, `mcp.md`, `hosts.md` and others) were not each classified by the verifier as history, "Anda as an MCP client" or stale.
- Still open and owned by the closure pull request of the orchestrator: the QUAL-01 silent-catch exceptions (a) and (b) in the requirement text still name the bridge, and the Anda rows of `.planning/PROJECT.md` (opening description, the "bridge is removed in Phase 28" line, the Anda boundary row) have not been updated. They are recorded here, not fixed here.

## Deviations from plan

- The plans named eight commits with set subjects; the PR kept four (see Key facts). The plan 28-02 task 3 and plan 28-03 tasks 2 and 3 produced no repository artifact of their own: the closure search output and the PR title and body are in GitHub or in the orchestrator's report, not in the repository.
- One CI failure: the export-usage gate, because `DEFAULT_REQUEST_TIMEOUT_MS` became test-only after the bridge removal. Fixed by the allowlist commit `54b6b41`. No other deviation was found in the files read.


## Re-verification at main 7ae9afc (2026-11-22, autonomous)

Full local suite executed on main 7ae9afc: 5945 tests, 5849 pass, 0 fail, 96 skipped (Podman-gated). Prior verdict (passed) stands; covered files changed only by later merged phases.

_Re-verifier: Omp (main session)_
