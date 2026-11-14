---
phase: 15
plan: 16
subsystem: docs
tags: [onboarding, omp, isolated-profile, quickstart, evidence]
requires: ["15-15"]
provides:
  - "L-C2 init/up/status/down exit codes and L-D/L-D2 isolated Omp install, list and rpc-ui load, recorded as evidence"
  - "--workspace check: status/down without the flag from outside the workspace are POLICY_DENIED; with it both succeed"
affects: [README.md, docs/hosts/snippets/omp.md, docs/integration/hosts.md, docs/integration/omp.md]
key-files:
  created: []
  modified: [README.md, docs/hosts/snippets/omp.md, docs/integration/hosts.md]
decisions:
  - "Q2 applied: rpc-ui session uses isolated HOME and Realm XDG_CONFIG_HOME; L-D records disconnected/REALM_NOT_ACTIVE (no daemon), L-D2 records active"
requirements: [ONB-05, ONB-06]
metrics:
  tasks: 3
  commits: 3
status: partial
---

# Phase 15 Plan 16: isolated Omp install evidence and quickstart (ONB-05, ONB-06) Summary

Evidence for L-C2, L-D, L-D2 and the --workspace check is recorded and checked against the files. Task 3 docs are only partly landed (see Verification). Commits: 1f80f7a, 727391f, e84b39c.

## Tasks

| Task | Result | Evidence |
| ---- | ------ | -------- |
| 1 L-C2 transcript | exit codes PASS; host-path check FAIL | 15-16-transcript-evidence.txt |
| 2 L-D install, list, rpc-ui | install/list/load PASS; host-path check FAIL | 15-16-L-D-evidence.txt |
| 3 docs | PARTIAL | README, snippet, hosts.md edited; omp.md untouched |

## Evidence

- L-C2 (transcript-evidence): checkout 1ddfc45, package 0.3.29, Podman 5.7.1. `init` exit 0 with `"mode":"fail-closed"`; `up` exit 0 active; `status` exit 0 active; `down` exit 0 unbound. Containers 0 before and 0 after; the count while active is not recorded. Stderr is not recorded.
- L-D (L-D-evidence:5-61): omp 18.20.0 (plan expected 18.12.6). `plugin install --dry-run`, `plugin install`, `plugin list --json` all exit 0; list shows agent-realm enabled, extension `./dist/src/omp/extension.js`, under the isolated `.omp/plugins`. `plugin doctor` exit 0, 0 errors, 1 warning. Session command recorded: `env HOME=<isolated> PI_CODING_AGENT_DIR=<isolated>/agent XDG_CONFIG_HOME=<config-home> omp --mode=rpc-ui`, with no `-e` and no `--no-extensions`. Realm status frames: connecting, then `○ realm disconnected · REALM_NOT_ACTIVE`. `realm-retry` listed; `extension_error` 0. `down` "already down" exit 0; `status` exit 0, daemon absent. Restore hashes match (config 1838f4c8acdc7ba6, policy e66c7871df0f3eaa); isolated home deleted.
- L-D2 (L-D2-evidence:1-20): `realm up` from the workspace exit 0 active; rpc-ui frames: connecting, then `● realm active · container running · applied mode: fail-closed`; `realm-retry` listed; `extension_error` 0. The active line is cut off in the file (line 14 ends mid-text), so its full status text is not recorded. `down` exit 0 unbound. Session command not recorded verbatim; no status after `down`. Restore hashes match.
- --workspace (workspace-flag-evidence:6-22): `realm status` with no flag from an outside probe directory: `POLICY_DENIED`, exit 1. `status --workspace` exit 0 active; `down --workspace` exit 0 unbound; cleanup status from the workspace exit 0 disconnected. This check is not among plan 15-16's listed tasks; it is recorded here as an extra check.

## Verification

- PASS: init/up/status/down exit codes; L-D install, dry run and list exit codes; no `-e` in the recorded session command; restore hashes; --workspace results.
- FAIL, plan hermetic check: `/home/realmlive/` paths remain unnormalized in the evidence files (transcript 4 lines, L-D 4, L-D2 3, workspace-flag 1). Plan steps 9 required normalization before saving.
- Task 3 not done (grep of tree): README has no clean-host sentence (P15-O2) and no `podman images --digests` line (P15-O1); README line 99 keeps the 2026-10-31 digest sentence; the 0.3.26 capture heading is absent (capture removed, not kept). Snippet still duplicates `doctor --fix` (lines 263-264); the 0.3.24 record was removed, not kept as historical; the heading is still `Live install record (ONB-05)`; line 326 still says the guard refuses `bash`/`eval` unless advisory. `docs/integration/omp.md` has no `## Plugin install under an isolated profile (ONB-05)` section.
- Not run by me: `npm run check:docs`, `npm run build`.

## Deviations

1. Omp 18.20.0 used; plan expected 18.12.6 (recorded in the evidence).
2. Build is checkout 1ddfc45, package 0.3.29; plan text said 0.3.26. Acceptance allows the version the checkout reports.
3. Owner-authorised P15-O4 driver change for L-B: host kept main build 1ddfc45 with the edited unit (roots removed, XDG_CONFIG_HOME set). No permanent provisioning. Config and policy restored after L-D and again after L-D2.

## Not verified

- One-container count while active; stderr for L-C2; full active status text in L-D2.
- Env used for the install commands: the L-D header records only the commands. The isolated path in the list output is the only evidence of isolation.
- Tarball or registry install (Q3). No containment claim (D3, Phase 16).
