# Plan 02-06 Summary: Suite taxonomy gate and requirement-to-test coverage

**Status:** test written; gates not run in this lane (the orchestrator runs `tsc`, lint, and `node --test` after the wave). Requirement claimed: QUAL-02, taxonomy and category part only. The MCP and ACP clause of QUAL-02 is deferred to Phase 5 (Q-4).

## Files

Created (repo-relative):

- `test/quality/suite-taxonomy.test.ts`: the taxonomy gate (node:test, node:assert/strict, no skip, todo, `.only`, or suppression markers).
- `.planning/phases/02-policy-state-and-filesystem-lockdown/02-06-SUMMARY.md` (this file).

No other file was created or edited. No frozen file, no dependency, no existing `.planning/` file was touched.

## What the taxonomy test asserts

1. **D-45 files exist.** Each of the 24 D-45 files (`test/quality/suite-taxonomy.test.ts` included) must be present.
2. **Category directories hold tests.** One test per directory: `core`, `fs`, `session`, `audit`, `lifecycle`, `contract`, `doctor`, `integration`. Each must hold at least one `*.test.ts` file (`readdirSync`).
3. **F-5 category map.** `state-machine` → `core/state-machine.test.ts`; `path and symlink` → `fs/canonicalize.test.ts`, `fs/toctou.test.ts`; `schema rejection` → `contract/tools.schema.test.ts`, `contract/tool-input-gate.test.ts`; `audit redaction` → `audit/redaction.test.ts`; `integration` → `integration/podman-gate.test.ts`. Each listed file must exist.
4. **Podman skip reason.** The test calls the exported `podmanSkipReason` mapping from `test/integration/podman-version.ts` (not a hardcoded string):
   - an unavailable probe yields a reason naming `PODMAN_MISSING`;
   - `podman version 4.9.3` yields a reason naming `PODMAN_UNSUPPORTED_VERSION`;
   - `podman version 5.0.0` yields `false` (the suite may run).

   It also reads `test/integration/podman-gate.test.ts` and asserts that the gate applies `podmanSkipReason(probe)` and passes the result to the suite.
5. **MCP and ACP deferral.** The test title states that MCP and ACP contract tests are Phase 5 deliverables (Q-4; ROADMAP Phase 5 success criterion 5). The body asserts that no test file under `test/` has an `mcp` or `acp` name segment, so no placeholder transport test exists in Phase 2.
6. **16 requirement IDs.** Each of CORE-01, CORE-02, CORE-03, CORE-04, CORE-06, FS-01, FS-02, FS-03, FS-04, FS-05, RT-07, TOOL-01, TOOL-02, AUD-01, AUD-02, QUAL-02 must appear as a string in at least one D-45 file. The test reads file contents at runtime and fails with the uncovered IDs named. The list matches plan 02-06 and `.planning/REQUIREMENTS.md`.

Path resolution: the test runs from `dist/test/quality`, so `TEST_DIR` is three levels up plus `test`. This follows the `SRC_DIR` pattern in `test/contract/exec-policy.test.ts`.

## Requirement-to-test coverage (16/16 by textual check)

Each row lists the D-45 files whose test titles or bodies carry the ID. Evidence comes from grepping `test/` for the ID.

| Requirement | D-45 test file(s) that cite it |
|---|---|
| CORE-01 | `core/state-machine.test.ts` |
| CORE-02 | `core/status.test.ts` |
| CORE-03 | `core/policy.test.ts`, `core/fail-closed.test.ts`, `lifecycle/controller.test.ts` |
| CORE-04 | `core/events.test.ts` |
| CORE-06 | `lifecycle/controller.test.ts`, `lifecycle/idempotent.test.ts` |
| FS-01 | `fs/canonicalize.test.ts`, `fs/deny-credentials.test.ts` |
| FS-02 | `fs/canonicalize.test.ts`, `fs/toctou.test.ts` |
| FS-03 | `fs/deny-credentials.test.ts` |
| FS-04 | `fs/lock.test.ts`, `fs/write.test.ts`, `lifecycle/idempotent.test.ts` |
| FS-05 | `fs/atomic-write.test.ts`, `session/store.test.ts` |
| RT-07 | `session/store.test.ts`, `lifecycle/controller.test.ts`, `lifecycle/idempotent.test.ts` |
| TOOL-01 | `contract/tool-input-gate.test.ts` |
| TOOL-02 | `contract/exec-policy.test.ts` |
| AUD-01 | `audit/redaction.test.ts`, `audit/log.test.ts` |
| AUD-02 | `lifecycle/no-host-env.test.ts`, `lifecycle/controller.test.ts`, `session/store.test.ts` |
| QUAL-02 | `quality/suite-taxonomy.test.ts` only (see residual risk 1) |

Result: all 16 IDs are found by the textual check, so the coverage test is expected to pass. This is a static textual result. The test was not executed in this lane.

## Deviations and interpretations (each with the default applied)

1. **Podman probe is not exported.** `probePodman` in `podman-gate.test.ts` is a private function that runs `podman --version`. The taxonomy test therefore drives the exported `podmanSkipReason` mapping and asserts the gate's wiring by text. It does not run `podman --version` itself, which keeps the taxonomy test free of host-binary dependence.
2. **Schema-rejection category.** The F-5 map lists both `contract/tools.schema.test.ts` (Phase 1) and `contract/tool-input-gate.test.ts` (plan 02-04) under this category, since both carry schema-rejection cases.
3. **Requirement-ID check is a plain substring match.** The plan specified a textual check, so the test uses `String.includes` on each D-45 file's contents. It does not parse test titles, so an ID cited anywhere in a file (title, body, or comment) counts. A stricter title-only match would need the same file reads and would fail for FS-01 and FS-02 only if their citations moved out of titles; they are in titles today, so the stricter form would also pass. The substring form was kept because the plan specified it.
4. **MCP and ACP check uses file names.** The "no placeholder MCP or ACP test" assertion checks basenames for an `mcp` or `acp` segment. This is stricter than the plan text but matches Q-4 and the threat-model entry T-02-14.

## Residual risks and open questions

1. **QUAL-02 is cited only by the taxonomy file.** The ID appears in no other D-45 test. The 16th check therefore passes on the taxonomy file's own ID list and titles, so it proves the citation exists but not that another test exercises QUAL-02's contract clause. The plan's coverage claim for QUAL-02 is limited to the taxonomy and category part, as stated in its acceptance criteria.
2. **QUAL-02 MCP and ACP clause is not met in Phase 2.** `.planning/REQUIREMENTS.md` QUAL-02 names MCP and ACP contract tests. They are deferred to Phase 5 (Q-4; ROADMAP Phase 5 success criterion 5). The taxonomy test states this in its title and enforces the absence of placeholder files. The orchestrator should carry Q-4 into the phase decision record.
3. **Not executed.** Per the lane rules, `tsc`, `node --test`, lint, and typecheck were not run. The first real verification is the orchestrator's gate run. The compiler concerns to watch are the `as const` readonly tuple `D45_FILES` used in `.filter`, and `readdirSync` with `{ recursive: true, encoding: "utf8" }`, which the existing `exec-policy.test.ts` already uses.
4. **Category check depends on directory layout.** A category directory that is renamed or removed makes `readdirSync` throw ENOENT, so that test fails. It does not pass silently.
