# Phase 50 window record (2026-11-19)

Serial, cold, under the shared live lock (held by `flock` per command) as the `realmlive` account from its home (the worktree built and `dist` copied without `.git`; `node_modules` already present with `ajv`, so no module-load abort). Evidence outside the repository in a mode 0700 directory under the account's `realm-evidence` root (`z50-20261119`). Window 2026-11-19T21:18Z to 21:22Z. One test at a time, no warm-up, a new project directory per attach (the harness creates it), nothing patched in the window. Host load at preflight: load average 8.43; no quiet is claimed. No login, no API key, no token, no model turn at any step.

The runbook is the one of Phase 48 plan 48-02 section 6, unchanged: `REALM_LIVE_PRODUCTION=1`, `REALM_LIVE_GROK_BUILD=1`, `REALM_GROK_BUILD_BIN=/usr/local/bin/grok`, `REALM_LIVE_IMAGE` (the digest-pinned image the running driver was given, `localhost/realm-agentos@sha256:951192…`), `REALM_LIVE_DRIVER_CONFIG` (the `config.json` the running driver reads), `REALM_DRIVER_SOCKET` (the driver socket), `XDG_RUNTIME_DIR` with the rootless Podman socket, Podman 5.x first on PATH, `openshell` on PATH, and the built CLI (`dist/src/cli/main.js`). The tests set none of them. The checkout under test is worktree HEAD `9d2a085` plus the uncommitted GAP-48-03 harness fix (two files, `test/support/host-live.ts` and `test/integration/host-live-helpers.test.ts`); the copied `dist` carries the fix (`productionOverrides` creates `<grok-home>/.grok`).

Versions of the day (as the `realmlive` account): node v24.18.0, Podman 5.7.1, Grok Build 1.0.77 (the recorded version, `/usr/local/bin/grok`). Stack: gateway and compute-driver user units active, `openshell status` connected, digest-pinned image already present (no cold pull), rootless Podman socket present. No receipt file for `claude` in the shared state directory (so both attribution tests ran), and the operator's real Grok `config.toml` and Claude file were `absent` before and after.

## Steps

| Step | Test | Outcome | Evidence |
| --- | --- | --- | --- |
| A | Grok production (`grok-build production:`) | passed: 1 passed, 0 failed, 0 skipped; test 1375 ms | `grok-production.txt` |
| B | Grok both-files attribution (`grok-build production attribution`) | failed (cold, mandatory audit): 1 failed; wire complete, no audit line, no presence, 0 attached boot reports; host command 303 ms | `grok-attribution.txt` |
| C | Grok control, Claude file alone (`grok-build production control`) | failed (cold, mandatory audit): 1 failed; wire complete, presence `claude-active`, no audit line, 0 attached boot reports; host command 402 ms | `grok-control.txt` |

Residue was checked before and after: 0 containers, 0 realm sandboxes, empty workspace root, the two pre-existing empty presence directories (`claude-active`, `omp-active`, dated before this window) untouched, no realm daemon of the account, no Grok leader process, no receipt file, the real Grok config and Claude file `absent` before and after, and the policy file SHA-256 unchanged (`e66c787…`). Snapshots: `before.txt`, `after.txt`.

## Details kept per test (names, counts, millisecond marks; never values or paths)

Step A: Grok Build 1.0.77 (the recorded version); `grok mcp doctor` exited 0 (accepted exit codes [0, 1]) after 525 ms against the 300000 ms failure bound, printed the checks [command found, server started, handshake OK, N tools discovered]; wire host methods [initialize, notifications/initialized, tools/list], tools [exec, list, read, retry, status, write] (the six Realm tools); the recorder restored [HOME]; attribution diagnostic: audit no attach line, no presence directories, 0 attached boot reports (the host left before the realm was ready, judged from the wire, as for the other health-check hosts). One server start with the arguments `mcp --host grok-build`. The install that failed in Phase 48 with `config-home-missing` now runs: the harness creates `<grok-home>/.grok`.

Step B: `grok mcp doctor` exited 0 after 303 ms, the same checks and the same complete wire (initialize, notifications/initialized, tools/list, six tools); the mandatory audit failed: no attach line, no presence directories, 0 attached boot reports (first failing assertion: the attach audit line must name `grok-build`). This is the cold case the harness predicts (48-02 deviation 2): the cold doctor leaves in about 300 ms before the attach settles, so there is no audit line to read. Not a harness defect: the install succeeded and the host ran.

Step C: `grok mcp doctor` exited 0 after 402 ms, the same complete wire; the mandatory audit failed on the audit line and the boot report (found none, 0 attached boot reports for `claude`), while the presence directories named [claude-active] (the pre-existing directory, read by the created-presence diff). Same cold case as Step B; the Claude-alone residual (GAP-40-01, GAP-48-01) is unchanged in kind and was not reproduced as an audit line.

The warm diagnostic variant (`REALM_LIVE_GROK_WARM=1`, labelled `[warm diagnostic variant]`) was not run: it is not the production tier, and the window is cold. No step was retried silently; each name pattern ran once.

## After snapshot

Identical to `before.txt`: 0 containers, 0 realm sandboxes, empty workspace root, the same two pre-existing empty presence directories, no realm daemon of the account, no host or leader process, no receipt file, the real host configuration files `absent` before and after, the policy file SHA-256 unchanged. `after.txt` holds the full after snapshot.
