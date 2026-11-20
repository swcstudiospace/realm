---
phase: 50-grok-harness-fix-and-production-rerun
plan: "01"
subsystem: host-live-harness
tags: [grok-build, harness-fix, production-tier, GAP-48-03, HTIER-01, HTIER-04]
requires: ["48-03"]
provides:
  - "The GAP-48-03 harness fix: productionOverrides creates <grok-home>/.grok so realm host install grok-build runs instead of refusing config-home-missing"
  - "A hermetic row pinning the fix (red shown before, green after)"
  - "A live window record of the Grok production tier (passed) and the both-files attribution plus the Claude-alone control (failed on the mandatory audit, cold)"
affects: []
key-files:
  created:
    - .planning/phases/50-grok-harness-fix-and-production-rerun/50-WINDOW.md
    - .planning/phases/50-grok-harness-fix-and-production-rerun/50-SUMMARY.md
  modified:
    - test/support/host-live.ts
    - test/integration/host-live-helpers.test.ts
    - test/support/host-registry.ts
    - docs/integration/host-support-matrix.md
    - docs/integration/host-plugin-gaps.md
    - docs/hosts/snippets/grok-build.md
completed: 2026-11-19
---

# Phase 50 Plan 01: Grok harness fix and production re-run

The harness defect of GAP-48-03 is fixed and the Grok production tier passed cold. The both-files attribution and the Claude-alone control failed only the mandatory audit (the cold doctor leaves before the attach settles), which the harness predicts and Phase 48 already saw; the install defect is closed, the audit residual is not.

## 1. Hermetic fix (red first)

The new row `productionOverrides of Grok Build creates the .grok config home below the isolated HOME, and no other host creates it or points at the operator's real home` (`test/integration/host-live-helpers.test.ts`) failed before the fix with an `ENOENT` stat on the grok config home below the isolated HOME (1 failed), and passes after it. The fix is one line in `productionOverrides` (`test/support/host-live.ts`): the `grok-build` case now also `mkdirSync(join(scenarioRoot, GROK_HOME_DIR, ".grok"), { recursive: true })`, so `<grok-home>/.grok` exists before `realm host install grok-build` runs. The row also pins: the override still names only the isolated `HOME`; the Grok config home lies inside the temporary directory and is never the operator's `~/.grok`; for every other production host (`claude`, `codex`, `opencode`, `kimi`, `kimi-code`, `muse-code`) no override names the operator's real home, every override stays inside the scenario, and no `.grok` appears below the scenario root or the scenario config home. The comment above `productionOverrides` now says the `.grok` home is created here so the plan-time refusal does not fire. No `src/host/install.ts` change: once `.grok` exists the product runs (step 2).

## 2. Product-side refusal absent

`node --test dist/test/integration/host-live-helpers.test.js dist/test/docs/host-support-matrix.test.js dist/test/host/runtimes.test.js` (98 passed) and `node --test dist/test/host/grok-build-recipe.test.js dist/test/host/install.test.js` (63 passed), plus `node scripts/check/host-paths.mjs` (`host paths: ok`) and `node --test dist/test/integration/enforce-default.test.js` (11 passed, unedited). If `src/host/install.ts` still refused once `.grok` exists it would have been recorded as a finding with the owning plan; it did not, so no finding and no patch in the window. `npm run build` passed.

## 3. Live re-run (window record `50-WINDOW.md`)

Run as the `realmlive` account under the shared live lock, serial, cold, new project directories, evidence outside the repository. Grok Build 1.0.77, node v24.18.0, Podman 5.7.1, digest-pinned image already present. The checkout under test is worktree HEAD `9d2a085` plus the uncommitted fix; the copied `dist` carries it. The operator's real Grok config and Claude file were `absent` before and after, the policy file SHA-256 is unchanged, and residue is 0 containers, 0 sandboxes, empty workspace, no daemon and no receipt before and after.

| Step | Outcome |
| --- | --- |
| A Grok production (`grok-build production:`) | passed: 1 passed, 0 failed; `grok mcp doctor` exited 0 after 525 ms, checks [command found, server started, handshake OK, N tools discovered], wire [initialize, notifications/initialized, tools/list] and the six tools, one start `mcp --host grok-build`, recorder restored [HOME]; attribution diagnostic left before ready by design |
| B both-files attribution | failed (cold, mandatory audit): the install succeeded and the wire was complete (host command 303 ms), but no attach line, no presence directories, 0 attached boot reports |
| C Claude-alone control | failed (cold, mandatory audit): the same complete wire (402 ms), presence [claude-active], but no audit line and 0 attached boot reports |

Step A is the pass the plan names: the host launched `realm mcp --host grok-build`, the handshake and `tools/list` are on the wire, and the six tools are listed. Steps B and C are honest failures under D-50-4, never relabelled: with `realm` in both `config.toml` and the Claude files the audit line could not be read because the cold doctor left in about 300 ms before the attach settled; the Claude-alone control stays attributed `claude` by presence (GAP-40-01 and GAP-48-01 residual unchanged). The warm diagnostic variant was not run (it is not the production tier, and the window is cold). No credential, no model turn, no prompt at any step; the stack is as found.

## 4. Records agreed (only what the evidence supports)

- `test/support/host-registry.ts`: Grok Build T3 is `rehearsed` with the dated 2026-11-19 note (production pass, the two cold audit failures, clean before and after, evidence outside the repository), and its source comment names `50-WINDOW.md`. The matrix was regenerated with `REALM_WRITE_HOST_MATRIX=1` (with `CI` unset; the test refuses to write when `CI` is set) and `node --test dist/test/docs/host-support-matrix.test.js` passes 8 of 8; the generated block now carries the rehearsed Grok cell.
- `docs/integration/host-plugin-gaps.md`: GAP-48-03 is `closed` (the harness fix and the cold production pass in `50-WINDOW.md`, the registry T3 rehearsed; the cold-audit residual stays with GAP-40-01 and GAP-48-01); GAP-40-01 and GAP-48-01 stay `accepted` with the Phase 50 control wording (presence `claude-active` again, no audit line, 402 ms); GAP-25-07 now says Grok passed its production tier in the Phase 50 window. `node --test dist/test/docs/host-gaps.test.js dist/test/docs/host-support-matrix.test.js dist/test/docs/host-docs.test.js dist/test/host/host-registry.test.js` passes 40 of 40.
- `docs/hosts/snippets/grok-build.md`: the attribution paragraph keeps the Phase 48 source matrix and adds the Phase 50 rerun (install succeeded, wire complete, no audit line, 303 ms; control 402 ms); the evidence paragraph now records the Phase 50 production pass. The tier stays `config-only` (no promotion decision).

Nothing the window did not show is claimed: the live audit line for the both-files attach remains open, first-source-wins remains an observation of 1.0.77, and no model-driven tool call was made (GAP-31-02).

## Checks

- `npm run build && node --test dist/test/integration/host-live-helpers.test.js dist/test/docs/host-support-matrix.test.js dist/test/host/runtimes.test.js` (98 passed) and `node scripts/check/host-paths.mjs` (`host paths: ok`); `test/integration/enforce-default.test.ts` still attaches and completes a call for every host id under the default (11 passed, unedited).
- Live: production passed; the two attribution tests failed on the mandatory audit (named cold finding, logs outside the repository); the operator's real Grok config and Claude file were `absent` before and after; stack as found.
- `git status` for `src`, `package.json`, `package-lock.json`: nothing.

## Requirement status

- HTIER-04: the Grok production tier ran and passed cold after the harness fix (50-WINDOW.md Step A, registry T3 `rehearsed`); the GAP-48-03 harness defect is closed.
- HTIER-01: the production wire carries `grok-build` with `realm` in `config.toml`; the live both-files audit line was not reproduced (the cold doctor leaves early, GAP-40-01 and GAP-48-01 unchanged and accepted; the Phase 50 control again named presence `claude-active`).

Plan 50-01 is complete; the files above are the change, and the window evidence stays outside the repository.
