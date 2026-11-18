---
phase: 29-mcp-tool-annotations
plan: "02"
subsystem: mcp-annotation-gate-and-docs
tags: [mcp, tool-annotations, smoke-gate, check-mcp, docs, cross-pin, live-assertion]
requires: ["29-01"]
provides:
  - "scripts/check/mcp-smoke.mjs: EXPECTED_ANNOTATIONS (a hand-written literal table), checkAnnotations, and per-era annotation checks inside checkEras: exactly the six tools, a top-level title equal to the expected one and to annotations.title, exactly the five annotation keys, each hint the expected boolean, in the legacy session and the modern session of the built realm mcp"
  - "scripts/check/mcp-smoke.test.mjs: a conforming fixture with annotations plus 90 seeded faults (as asserted in the test; not recounted by the closer) that each make checkEras throw"
  - "docs/integration/mcp.md: Q9 Tool annotations with the read date 2026-11-17, the specification and blog URLs that were read, the shape per served revision, the per-tool table between the markers mcp-tool-annotations:begin and mcp-tool-annotations:end, the rule that annotations are hints and never a control, the basis notes (a) to (e), host dependence and the list of checks"
  - "test/docs/tool-annotations-doc.test.ts: the Q9 table equals the pins and the section's required statements, links and escapes are present"
  - "test/mcp/annotations.test.ts: a cross-pin test that imports the smoke script and requires EXPECTED_ANNOTATIONS to deep-equal ANNOTATION_PINS, so the pin module, the smoke table and the docs table cannot drift alone"
  - "AGENTS.md and CONTRIBUTING.md: the check:mcp description now includes the title and annotations check"
  - "test/integration/production-driver.test.ts: a live assertion on the tools/list of a real realm mcp that each descriptor has a title, an annotations object, four boolean hints and annotations.title equal to title; it runs only when the Podman gate of that file holds"
affects: [scripts/check/mcp-smoke.mjs, scripts/check/mcp-smoke.test.mjs, docs/integration/mcp.md, test/docs/tool-annotations-doc.test.ts, test/mcp/annotations.test.ts, test/integration/production-driver.test.ts, AGENTS.md, CONTRIBUTING.md]
key-files:
  created:
    - test/docs/tool-annotations-doc.test.ts
  modified:
    - scripts/check/mcp-smoke.mjs
    - scripts/check/mcp-smoke.test.mjs
    - docs/integration/mcp.md
    - test/mcp/annotations.test.ts
    - test/integration/production-driver.test.ts
    - AGENTS.md
    - CONTRIBUTING.md
decisions:
  - "The docs table is delimited by HTML comment markers so a test can parse it and require equality with the pins"
  - "Q9 records the specification sources read on 2026-11-17: the ToolAnnotations fields are identical in revisions 2025-06-18, 2025-11-25 and 2026-07-28, and clients must treat annotations as untrusted unless they come from trusted servers"
  - "The live production-driver assertion checks shape only; the exact values are pinned by the unit and smoke layers"
  - "The docs test file is named test/docs/tool-annotations-doc.test.ts, not mcp-annotations-doc.test.ts: the stale Phase 2 taxonomy test forbids a test file name containing mcp"
  - "No src change, no package.json script change, no CHANGELOG or version edit, no edit of docs/integration/anda-replacement-research.md"
requirements: [MCPA-01, MCPA-02]
metrics:
  tasks: 4
  completed: 2026-11-17
status: merged
---

# Phase 29 Plan 02: Gate, document and cross-pin the annotations Summary

Merged to main in PR 134 (squash `63f89c0`, plans 29-01 and 29-02 together). After this plan `npm run check:mcp` checks the title and annotations of the built server in both protocol eras, `docs/integration/mcp.md` documents them with their sources, and one test requires the three copies of the table (pins, smoke script, docs) to agree.

## What shipped

- `scripts/check/mcp-smoke.mjs`: `EXPECTED_ANNOTATIONS`, `checkAnnotations(tools, label)` and calls to it for the `tools/list` of each era, so a missing, extra or duplicate tool, a wrong title, a wrong key set or a wrong hint value makes the gate fail with a message naming the era, the tool and the key.
- `scripts/check/mcp-smoke.test.mjs`: the conforming fixture now carries annotations; a generator makes mutants of it and asserts `mutants.length` is 90, each making `checkEras` throw.
- `docs/integration/mcp.md`: Q9 (Tool annotations), between Q8 and "Blocked module". It lists the schema and tools pages of the three revisions, the shape per revision, the per-tool table, the rules (a) what a hint is, (b) what "environment" means (Realm's audit chain and metric rows are excluded), (c) why exec is open world although the default policy has no egress, (d) why retry is not destructive and write is destructive and idempotent, (e) the mistake direction (state the broader value), the host-dependence paragraph and the checks. Q3 gained a pointer to Q9.
- `test/docs/tool-annotations-doc.test.ts`: parses the text between the two markers (each present once, in order) and requires equality with the pins, plus required statements, links and escapes.
- `test/mcp/annotations.test.ts`: the cross-pin test (imports `scripts/check/mcp-smoke.mjs`, deep-equals `EXPECTED_ANNOTATIONS` with `ANNOTATION_PINS`).
- `AGENTS.md` and `CONTRIBUTING.md`: one line each, the `check:mcp` description.
- `test/integration/production-driver.test.ts`: the live assertion described under `provides`.

## Observed

- Read of `origin/main` at `63f89c0` on 2026-11-17: the files above exist; `mcp-smoke.mjs` exports `EXPECTED_ANNOTATIONS` and `checkAnnotations`; `mcp-smoke.test.mjs` contains `assert.equal(mutants.length, 90, ...)`; `docs/integration/mcp.md` has `### Q9. Tool annotations` and the begin marker; `AGENTS.md` and `CONTRIBUTING.md` mention the annotations in the `check:mcp` line; `production-driver.test.ts` carries the annotation assertions after the `tools/list` shape check.
- CI on PR 134 passed after one fix round (see Deviations).

## Not verified here

- The production-driver assertion needs Podman 5.x, the compute driver and the other prerequisites listed at the top of that test file; a default `npm test` skips it. It was not run by anyone in this phase.
- The 90-fault count of the smoke test is the figure asserted in the file; the closer did not recount it or run the script.
- `npm run check:mcp` against a built artifact was not run by the closer; the claim rests on CI of PR 134.
- No host behavior with the hints was observed (host-dependent; OQ-29-05).

## Deviations from plan

- The plan named the docs test `test/docs/mcp-annotations-doc.test.ts`. CI failed on the stale Phase 2 taxonomy test, which forbids a test file name containing `mcp`. The file was renamed `test/docs/tool-annotations-doc.test.ts` in a fix round and the plan text was updated to the new name (the PR also touches `29-02-PLAN.md`). CI was green afterwards.
