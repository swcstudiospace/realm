# Phase 57 Summary — HTIER-01 attribution retest

**Outcome: HTIER-01 carried, not met.** The live both-files audit line was not produced. GAP-40-01 and GAP-48-01 remain accepted-residual. No code changes were made in this phase.

## Goal

Retest the live Grok Build both-files attribution (HTIER-01) on the production stack with the Phase 50 harness fix in place: a Grok Build session launching `realm mcp --host grok-build`, handshake, `tools/list`, six tools on the wire, and an audit line attributed `grok-build` with a `realm` server present in both `config.toml` and the Claude files — cold, then warm if the cold mandatory audit is the blocker (D-57-2).

## Final live run (2026-11-27, HEAD 7517be6)

This run supersedes the 2026-11-22/2026-11-25 gate-blocked reading (production gate closed, no driver/gateway). On the fully provisioned stack (podman 5.7.1, driver/daemon/gateway running, rebuilt sandbox image `sha256:6272a3ac...`), the gated Grok Build tier ran under the shared live lock, cold and warm (`REALM_LIVE_GROK_WARM=1`):

- **`grok mcp doctor` (trace/diagnostic drive): PASS both variants.** Grok 1.0.89 launches `realm mcp --host grok-build` on the production stack; handshake OK; the wire carries initialize, notifications-initialized, tools-list and the six tools `[exec list read retry status write]`.
- **Attribution (both files → `grok-build`) and control (Claude file alone → `claude`): FAIL both variants identically.** The host command returns after 2.3–3.7 s cold (doctor 3684 ms, attribution 3094 ms, control 2303 ms) and 1.3–2.4 s warm, and has left before the realm attach settles: no audit line, no presence directory created, 0 attached boot reports.
- **The warm variant does not change the outcome** (recorded either way, per D-57-2). The failure is unchanged in kind between cold and warm.

Evidence (outside the repo): `~/realm-evidence/z57-20261127/` (`z57.log` cold, `z57warm.log`).

## Disposition

- **HTIER-01: carried.** The retest converts the earlier gate-block into live evidence of the Phase 50 residual — the host leaves before the attach completes — now reproduced on the provisioned stack in both cold and warm form.
- **GAP-40-01: stays accepted-residual.** Missing host feature unchanged (no Grok Build feature names the host in a shared file; source priority `config.toml` → Claude → Cursor → `.mcp.json`); verified workaround unchanged (`realm host install grok-build`).
- **GAP-48-01: stays accepted-residual** — no audit line was produced, so nothing proves otherwise.
- **Lift condition (unchanged):** the attach must complete inside the host's few-second window (cold-attach responsiveness), not another retest.
- **No code changes.** Docs agreement and `enforce-default.test.ts` unedited stand from `57-VERIFICATION.md`; criteria 2–3 unchanged.

## Verification

None (skipped, per assignment). Results above are drawn from `57-WINDOW.md` ("2026-11-27 final live run") and `57-VERIFICATION-UPDATE-20261127.md`.
