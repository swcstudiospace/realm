---
phase: 48-grok-attribution-and-production-tiers
plan: "04"
subsystem: host-docs-registry
tags: [muse-code, prime-agent, grok-build, production-tier, attribution, HTIER-01, HTIER-02, HTIER-03, HTIER-04, HTIER-05, OD-48-1]
requires: ["48-01", "48-02", "48-03"]
provides:
  - "A registry, matrix, contract, gaps, boot matrix and host pages that record the Phase 48 window of 2026-11-19: Muse passed cold, Grok failed on a harness defect, Prime is blocked by B-48-02"
  - "Muse Code promoted to tier proven under owner decision OD-48-1 (yes); Grok Build and Prime Agent stay config-only"
  - "The carried harness fix (create the grok config home in productionOverrides) as GAP-48-03; Prime Agent B-48-02 stays as GAP-48-04"
affects: []
key-files:
  created:
    - .planning/phases/48-grok-attribution-and-production-tiers/48-04-SUMMARY.md
  modified:
    - test/support/host-registry.ts
    - test/support/host-live.ts
    - test/host/runtimes.test.ts
    - test/host/muse-code-recipe.test.ts
    - test/host/adapters-labelled.test.ts
    - test/docs/host-gaps.test.ts
    - test/docs/capability-token-doc.test.ts
    - test/docs/wave1-boot-matrix.test.ts
    - docs/integration/host-support-matrix.md
    - docs/integration/wave1-boot-matrix.md
    - docs/integration/host-plugin-gaps.md
    - docs/integration/host-plugin-contract.md
    - docs/integration/hosts.md
    - docs/hosts/snippets/grok-build.md
    - docs/hosts/snippets/muse-code.md
    - docs/hosts/snippets/prime-agent.md
    - src/host/runtimes.ts
duration: one session
completed: 2026-11-19
---

# Phase 48 Plan 04: Record the window in the registry, matrix, gaps and host pages

No live run, no host command, no recipe change. Every statement is copied from 48-01-SUMMARY.md, 48-03-SUMMARY.md and 48-WINDOW.md in this directory. Owner decision OD-48-1 was answered **yes**: a passing production tier promotes the host to `proven`. Only Muse Code passed, so only its runtime tier changed; the Grok failure and the Prime Agent blocker are recorded as gaps and both tiers stay `config-only`.

## 1. Result table (from 48-01 and 48-03 only)

| Host | Tier | Outcome under D-48-06 | Version (recorded) | Date | Counts and marks | Blocker kind |
| --- | --- | --- | --- | --- | --- | --- |
| muse-code | production | passed | 1.4.24 (1.4.23) | 2026-11-19 | 1 passed, 0 failed; host command 5891 ms against the 300000 ms failure bound; full wire (initialize, notifications/initialized, tools/list, six tools); zero live sessions; real settings byte-equal | none; B-48-01 for the version difference only (a circumstance) |
| prime-agent | production | blocked, B-48-02 | 0.10.2 | 2026-11-19 | 1 skipped with the fixed sentence; no drive run | host property |
| grok-build | production | failed | 1.0.77 | 2026-11-19 | 1 failed at `realm host install grok-build --dry-run` (exit 1, `config-home-missing`, catalogue `POLICY_DENIED`); no host command ran, no wire, no audit line | harness defect, owning plan 48-02 (a circumstance, carried as GAP-48-03) |
| grok-build | attribution, both files | failed (same defect) | 1.0.77 | 2026-11-19 | same first failing assertion | harness defect, GAP-48-03 |
| grok-build | attribution, Claude alone (control) | failed its mandatory audit | 1.0.77 | 2026-11-19 | `grok mcp doctor` exit 0 after 1595 ms; full wire and the six tools; presence `claude-active`; audit no attach line; 0 attached boot reports | cold doctor leaves before the attach settles (48-02 deviation 2 predicted) |
| grok-build | attribution, validator matrix (48-01) | passed | 1.0.77 | 2026-11-19 | cells a to i, each run twice; both-files cell carried `grok-build`, Claude-alone cell carried `claude`; gated step 1 of 1 | none |

Attribution outcome: **A** (the recipe's own `config.toml` entry closes the attribution half in the validator tier). Because the live both-files attach failed at install and never reached the host, GAP-40-01 stays **accepted-residual, accepted**: the first-source-wins behavior is an observation of version 1.0.77 and the documented order of that version, not a guarantee for later versions; the missing Grok Build feature (a way to name the host in a shared file, or a per-vendor MCP switch that works, OD-48-4) and the verified workaround (`realm host install grok-build`) are named in the row. A live both-files attach with the audit line is a lift condition after the harness fix.

## 2. Files changed

| File | Change |
| --- | --- |
| `src/host/runtimes.ts` | muse-code tier `config-only` to `proven` (OD-48-1 yes; the only src change) |
| `test/host/runtimes.test.ts` | `EXPECTED_TIERS`: muse-code `proven` |
| `test/host/muse-code-recipe.test.ts` | tier pin `proven` |
| `test/support/host-registry.ts` | muse-code T3 `not-run` to `rehearsed` with the dated cold pass note; grok-build T3 `not-run` to `gap` with a note starting `rehearsal failed` naming the first failing assertion, the catalogue code and the carried fix; prime-agent T3 stays `gap` (B-48-02); source comments updated; WAVE2_T3 comment matches the corrected contract wording |
| `test/support/host-live.ts` | header comment: the wave-2 hosts other than Grok Build (production tier) and Muse Code (own gated file) stay config-only; Prime Agent B-48-02 sentence kept |
| `test/host/adapters-labelled.test.ts` | comment: the shared Claude bundle stays labelled `claude` (GAP-40-01, accepted-residual) |
| `test/docs/host-gaps.test.ts` | phase bound widened 43 to 48; header comment names the Phase 48 rows |
| `test/docs/capability-token-doc.test.ts` | per-page tier check: muse-code page must carry `` `proven` ``, the other two `` `config-only` ``; gap-id check also accepts `GAP-48-01`; GAP-40-01 row test also pins the named missing feature; new GAP-48-01 row test (accepted-residual, accepted, names Grok Build and the Claude configuration) |
| `test/docs/wave1-boot-matrix.test.ts` | host list widened to the eight hosts in order (five wave 1, then muse-code, prime-agent, grok-build); header and test title updated |
| `docs/integration/host-support-matrix.md` | generated block regenerated from the table, registry and live specs; hand text now says Phase 48 defined a T3 tier for three config-only hosts by owner decision D-v7-5 and the other config-only hosts still have none-defined by OQ-25-09 |
| `docs/integration/wave1-boot-matrix.md` | introduction names the Phase 48 hosts and D-v7-5; one row each for muse-code (rehearsed), prime-agent (gap) and grok-build (failed), each with eight cells, version, date and at least one GAP id; boot paragraphs for the three hosts; the Phase 48 window paragraph (account, Podman 5.7.1, commit `999cb2f`, lock held, serial, cold, evidence outside the repository, the before and after comparison); the Not shown bullet now says the remaining wave 2 hosts have no production tier |
| `docs/integration/host-plugin-gaps.md` | GAP-40-01 stays accepted-residual/accepted with the Phase 48 disposition (the no-model-turn clause moved to GAP-48-01); new GAP-48-01 (accepted-residual, accepted: the Claude-file-alone attribution and no model turn), GAP-48-02 (accepted-residual, accepted: the three CLIs' own network use not contained or measured), GAP-48-03 (unverified-behavior, open: the Grok harness defect and its fix), GAP-48-04 (accepted-residual, accepted: Prime Agent B-48-02); GAP-25-07 narrowed; GAP-34-01 evidence lists the three production results by id and date; the intro names the Phase 48 rows |
| `docs/integration/host-plugin-contract.md` | the wave 2 gaps statement now reads "no wave 2 host other than Muse Code, Prime Agent and Grok Build has a production tier"; the Phase 40 recipes and evidence sections say the tier is `config-only` for Prime Agent and Grok Build and `proven` for Muse Code since Phase 48 (OD-48-1); the tier table row of muse-code is `proven`; each of the three evidence rows gains the production result or blocker; a Phase 48 paragraph records the attribution cells, the version and date, the first-source-wins observation caveat, and what an attach by doctor is and is not |
| `docs/integration/hosts.md` | the Phase 40 note of Grok Build gains the Phase 48 outcome sentence (version, date, `config-home-missing`, GAP-48-03); the Phase 40 observation is not rewritten |
| `docs/hosts/snippets/muse-code.md` | tier `proven` with the dated cold pass (Muse Code 1.4.24, 5891 ms, full wire) and OD-48-1; Not shown corrected |
| `docs/hosts/snippets/prime-agent.md` | the production tier is named as blocked by B-48-02 (GAP-48-04), not as an undefined tier |
| `docs/hosts/snippets/grok-build.md` | production result recorded as rehearsal failed at install (`config-home-missing`, `POLICY_DENIED`), the harness fix carried as GAP-48-03, the attribution result (source-matrix cells, verified workaround, the Claude `mcps` switch documented as not working on 1.0.77 and not set by the recipe per OD-48-4, `adapters/claude-plugin` stays labelled `claude`) |

Not changed: `docs/integration/mcp.md` (Outcome A; the Q10 migration table row is unchanged), `test/support/host-live-wave2.ts` (no live-spec change needed: Grok Build already has `productionTier: true` and Prime Agent already has the B-48-02 sentence), `test/integration/host-live-helpers.test.ts` (the production-capable list of the six hosts and the blocker sentence are already correct; no row deleted), no ROADMAP, STATE or REQUIREMENTS edit, no archived planning record.

## 3. OD-48-1 and the runtime tiers

The owner answered **yes**: a passing production tier promotes the host to `proven`. Only Muse Code passed its production tier, so `src/host/runtimes.ts` changes one row: muse-code `config-only` to `proven`. Grok Build and Prime Agent stay `config-only`, with their T3 records as gap (rehearsal failed, Prime Agent blocker). `git status --short -- src package.json package-lock.json` shows only `src/host/runtimes.ts`. The planned commit subjects are `feat(host)` for the src tier promotion, `test(host)` for the registry, specs and pinning tests, and `docs(host)` for the pages; none has a breaking marker.

## 4. Requirement and success-criterion statements

- HTIER-01: met by the honest alternative the requirement names. The live both-files attach was not reproduced (harness defect at install, never reached the host; a legal VOID/not-reproduced result under D-48-05, never relabelled). The attribution half rests on the passed 48-01 source matrix (Outcome A) and its gated validator step, which passed again in the window; the Claude-file-alone attribution and the no-model-turn limit are carried by GAP-48-01. GAP-40-01 stays accepted-residual with the missing Grok Build feature named.
- HTIER-02: met by a live result. Muse Code 1.4.24 passed its production tier cold on 2026-11-19 (full wire, 5891 ms, zero live sessions) and is `proven` under OD-48-1.
- HTIER-03: met by the named blocker the requirement names. B-48-02 (a property of the host) satisfies the "or a named blocker" clause; the registry, the live spec and GAP-48-04 hold it as a gap.
- HTIER-04: not met, and not blocked: Grok Build 1.0.77 failed honestly at install (`config-home-missing`, `POLICY_DENIED`). It is recorded as a failed rehearsal with the owning plan and the fix (create the grok config home in `productionOverrides`, plan 48-02 owns the wiring) carried as GAP-48-03; the tier stays `config-only`. No live window was re-run in this plan.
- HTIER-05: met. The registry, the generated block, the live specs, the contract page, the gaps page, the boot page, the host pages and the pinning tests agree (the checks below); `test/integration/enforce-default.test.ts` passes unedited; no launcher was added, so the labelled-launcher guard needed no entry.
- ROADMAP success criterion 1 (the registry, matrix, contract page and gaps page record the window): met, with the checks below.
- ROADMAP success criterion 2 (GAP-40-01 at its true disposition with version and date): met; the row is accepted-residual with the missing feature named, and GAP-48-01 carries the claude-only cell and the no-model-turn clause.
- ROADMAP success criterion 3 (GAP-48-01 and GAP-48-02 exist and GAP-25-07 is narrowed): met.
- ROADMAP success criterion 4 (enforce-default attaches every host id; no claim exceeds its evidence): met; enforce-default passes unedited, and the re-read of the written statements against the result table of section 1 found every claim backed by a row, every date and version present, and no blocked, failed or not-reproduced result written as a pass.

## 5. Checks run

All from the worktree root. The worktree had no `node_modules`; it was linked from the main checkout for the build (no install, no network).

| Check | Result |
| --- | --- |
| `npm run build` (tsc) | passed |
| `REALM_WRITE_HOST_MATRIX=1 node --test dist/test/docs/host-support-matrix.test.js` (with CI unset, as the test refuses to write when CI is set) | 8 passed; generated block regenerated from the table, registry and live specs |
| `node --test` on the docs, host and live-helper suites (host-support-matrix, wave1-boot-matrix, host-gaps, capability-token-doc, host-docs, runtimes, adapters-labelled, muse-code-recipe, grok-build-recipe, prime-agent-recipe, host-live-helpers, enforce-default) | 293 passed, 0 failed |
| `node --test` on host-live-muse-helpers, host-live-session-helpers, host-live-wave2, host-live-muse, host-live-wave2-production (no opt-in set) | 31 passed, 17 skipped, 0 failed |
| `node scripts/check/host-paths.mjs` | host paths: ok |
| `npm run check:docs` | host paths, agents sync and check:default-mode ok (48 files scanned, no advisory-default claim) |
| `npm run lint` on the changed test files plus `src/host/runtimes.ts` | no issues |
| `npm run check:gates` | gate closure, module size, export usage and lockfile integrity passed |

`git status --short -- src package.json package-lock.json` shows only `M src/host/runtimes.ts`, as expected under OD-48-1 yes. No test was deleted or weakened to pass; every edited test states the true disposition, and the two widened lists (the gaps phase bound and the boot-matrix host list) only grow.
