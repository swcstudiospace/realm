# Phase 17 summary (lane B, 2026-11-02)

Branch `gsd/v3-lane-b`, from `gsd/v3-autonomous` at `a47016f`. Phase 17 is not passed. The live items (scenarios 5, 6 and 10, and spike S17-b) have not run. Plan 17-05 stays HELD-OWNER for the owner's live window. Owner decision O-h stays open.

## Done in this lane

- **O-g, `up` correlation id on an audit line (OBS-02, D-1703).** A tool call made over an attached session now carries that session's `up` correlation id as an optional `upId` on its admission and result audit lines. Commit `3a6decc`, touching `src/audit/log.ts`, `src/tools/dispatch.ts`, `src/daemon/daemon.ts`, `test/daemon/daemon.test.ts` and `docs/integration/runtime-decision.md`.
  - Failing before: `OBS-02: the up correlation id is on the admission and result audit lines of a tool call in that session` failed with `upId` undefined on the admission line (`AssertionError`, `dist/test/daemon/daemon.test.js:807`).
  - Passing after: the daemon, dispatcher and audit suites run together (`node --test dist/test/daemon/daemon.test.js dist/test/tools/dispatch.test.js dist/test/audit/*.test.js`) give 236 tests, 236 pass, 0 fail, 0 skipped.
  - ESLint on the four changed source and test files: exit 0.
  - Scope note: the O-g text in `17-VERIFICATION.md` asks the owner to confirm whether the OBS-02 join is required for tool calls only, which would make an `up` audit line unnecessary. This lane implemented the lane directive (the id lands on audit lines). The owner should confirm or overrule this; it is the only O-g decision open.

## Not done (owner or later phase)

- O-h (plan 17-02 open question 2, whether `audit.head` is kept): open, needs an explicit owner ruling.
- 17-05 (U6 live; scenarios 5, 6, 10, S17-b): HELD-OWNER, batched with the owner's live window.
- O-g confirmation (above).

## Gate evidence

Gate set run once on commit `3a6decc` (code tree). Exit codes and counts:

| Gate | Exit | Counts |
|---|---|---|
| `npm run typecheck` | 0 | n/a |
| `npm run lint` | 0 | n/a |
| `npm test` | 0 | 2538 tests, 2505 pass, 0 fail, 33 skipped |
| `npm run build` | 0 | n/a |
| `npm run test:integration` | 0 | 202 tests, 171 pass, 0 fail, 31 skipped |
| `npm run test:scripts` | 0 | 282 pass, 0 fail |
| `npm run check:docs` | 0 | host paths, agents sync, default mode ok |
| `npm run check:gates` | 0 | 4 modules, no violations |
| `npm run check:pack` | 0 | schemas, adapter, driver protos, legal present |
| `npm run check:mcp` | 0 | mcp smoke ok |

Podman: the PATH `podman` is 4.9.3 (`/usr/bin/podman`). The 5.7.1 binary is only at `/usr/local/bin/podman`, which the integration run did not use. The integration skips carry the codes `PODMAN_UNSUPPORTED_VERSION`, `PODMAN_MACHINE_DOWN` and `PODMAN_MISSING`. They are not counted as passed.

omp version: UNVERIFIED in this lane. The shell guard refused `omp --version` with `BLOCKED needs: human-approval (mcp: nested-agent)`. The lane brief reports 18.15.0 on PATH; that is not re-checked here.

Site build (`npm ci` and `npm run build` in `site/`, after the docs change): exit 0, with a `TypeError` logged while rendering `planning/phases/13-quality-ratchet/13-RESEARCH.md`. That page is not changed by this lane. Whether the error predates this lane is UNVERIFIED. The build also generates `site/content/src/`, which is untracked and was left uncommitted because the shell guard refused its removal (`rm -rf`); the owner or main agent should remove it.
