# Phase 57 window record — HTIER-01 attribution retest (2026-11-22)

**Outcome: HTIER-01 carried, not met.** No audit line was produced. GAP-40-01 stays accepted-residual and GAP-48-01 stays accepted-residual.

**Window:** 2026-11-22T19:00:21Z to 19:00:24Z, under the shared live lock (`flock -w 1800 <live-lock-path>`, held for the whole window including cleanup), as the `realmlive` account (`su`), from its home directory (the built tree with `dist`, run without `.git`). Evidence outside the repository in a mode 0700 directory under the account's `realm-evidence` root (`z57-20261122`): `preflight.txt`, `grok-attribution.txt`, `grok-attribution-warm.txt`. No login, no API key, no token, no model turn at any step. Load average at preflight: 12.25 (1 min); no quiet is claimed.

**Step 1 — Phase 50 instrument confirmed, no edit made.** `productionOverrides` in `test/support/host-live.ts` (lines 1112–1115) has the `grok-build` case creating `<grok-home>/.grok` and setting `HOME` to the scenario `grok-home`; the built `dist` copy held in the window account's home carries the same fix. The variant is present, so nothing was added.

**Versions of the day (as `realmlive`):** node v24.18.0, Podman 5.7.1 (`/usr/local/bin/podman`), openshell 0.1.5, Grok Build 1.0.89 (28be5bb1bf65) — newer than the recorded 1.0.77; a different version runs and is recorded, never skipped for version. Stack as found: rootless Podman socket present under `XDG_RUNTIME_DIR=/run/user/5002` (started for the window; the account had no user session before it), `openshell status` reports `not_configured`, no gateway or compute-driver user unit active for the account, no Realm receipt or daemon of the account. The operator's real Grok `config.toml` and Claude file were `absent` before and after. Residue before and after: 0 containers, 0 images in the account's Podman store, real host files absent.

**Runbook (from 50-WINDOW.md, unchanged):** `REALM_LIVE_PRODUCTION=1`, `REALM_LIVE_GROK_BUILD=1`, `REALM_GROK_BUILD_BIN=/usr/local/bin/grok`, `REALM_LIVE_IMAGE` (the digest-pinned image the running driver was given in the Phase 50 window), `XDG_RUNTIME_DIR` with the rootless Podman socket, Podman 5.x first on PATH, `openshell` on PATH, and the built CLI (`dist/src/cli/main.js`). `REALM_LIVE_DRIVER_CONFIG` and `REALM_DRIVER_SOCKET` were not set: no running compute driver of the account exists whose config and socket could be named. The tests set no gate variable.

## Steps

| Step | Test | Outcome | Evidence |
| --- | --- | --- | --- |
| A | Grok both-files attribution, cold (`grok-build production attribution`) | skipped at the production gate: 1 skipped, 0 failed; `REALM_LIVE_DRIVER_CONFIG is not an absolute path to an existing file; it must be the config.json the running driver reads` | `grok-attribution.txt` |
| B | Grok both-files attribution, warm diagnostic variant (`REALM_LIVE_GROK_WARM=1`, same pattern) | skipped at the same gate, same named prerequisite: 1 skipped, 0 failed | `grok-attribution-warm.txt` |

A skipped test is not a pass. Neither variant reached the host command, so no handshake, no `tools/list`, no six tools on the wire, and no audit line — in either variant. No step was retried with a different prerequisite set, and nothing was patched in the window.

## Why

The production stack the Phase 50 window ran against (gateway and compute-driver user units of the `realmlive` account, with a digest-pinned image in the account's Podman store) is not running for the account today: `openshell status` reports `not_configured`, and there is no user unit, driver config or driver socket to name. Provisioning that stack (user units for the gateway and compute driver, the account's `config.json`, the pinned image in the account's store) is host setup outside this phase's edit scope, and the phase leaves the stack as found. The Phase 50 cold-audit residual is therefore neither reproduced nor lifted by this window: it stands as recorded, and no line exists to settle it.

## What stays

- **Missing host feature (GAP-40-01, unchanged):** no Grok Build feature names the host in a shared file — Grok Build documents a source priority of its own `config.toml`, then Claude, then Cursor, then the project `.mcp.json`, first source winning by name, and the Claude `mcps` switch does not stop the Claude file being loaded. The verified workaround is unchanged: `realm host install grok-build`, which puts `realm` in Grok's own `config.toml`, shadowing the `claude`-labelled entry of the same name.
- **GAP-48-01 stays accepted-residual** unless a live audit line proves otherwise; this window produced no line, so it proves nothing either way.
- **HTIER-01 is carried**, not met. The lift condition is unchanged: a live Grok Build session on the production stack with the host launching `realm mcp --host grok-build`, the handshake, `tools/list` and the six tools on the wire, and the audit line attributed `grok-build` with a `realm` server present in both `config.toml` and the Claude files.
