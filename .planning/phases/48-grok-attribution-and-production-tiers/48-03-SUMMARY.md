---
phase: 48-grok-attribution-and-production-tiers
plan: "03"
subsystem: host-live-window
tags: [muse-code, prime-agent, grok-build, production-tier, attribution, HTIER-01, HTIER-02, HTIER-03, HTIER-04, live-window]
requires: ["48-01", "48-02"]
provides:
  - "A dated live-window record of one validator step, two attribution cells and three production tiers (passed, failed or skipped under D-48-06), with the before and after comparison"
  - "The named failure of the Grok production installs (config-home-missing at install --dry-run, owning plan 48-02) and the cold control's missing attach audit line"
affects: [48-04]
key-files:
  created:
    - .planning/phases/48-grok-attribution-and-production-tiers/48-WINDOW.md
    - .planning/phases/48-grok-attribution-and-production-tiers/48-03-SUMMARY.md
  modified: []
completed: 2026-11-19
---

# Phase 48 Plan 03: Live window (Grok attribution and Muse, Prime Agent, Grok production tiers)

No file under `src`, `adapters`, `docs` or `test` changed; `git status --short` for them is empty and `node scripts/check/host-paths.mjs` answers `host paths: ok`. No credential, no login and no model turn was used. No prompt relabeling: the Grok evidence below is a `grok mcp doctor` health-check attach (it starts `realm mcp --host ID` and talks to it over stdio), not a model session and not a tool call through a model loop. The full window record is `48-WINDOW.md` in this directory; the raw evidence (per-command output, `before.txt`, `after.txt`) stayed outside the repository.

## 1. Commit and versions

Commit under test: `999cb2f28bd6812139825dedd89b04f512ef8f45` (branch `gsd/exec-48-d`),
built in the worktree (`rm -rf dist`, `npm run build`, exit 0) and copied without `.git`
to the account's home as the runnable checkout. Window: 2026-11-19T12:18:38Z to
12:20:47Z, under the shared live lock, serial, one test at a time, cold, a new project
directory per attach, nothing patched. Host load at preflight: load average 16.38, CPU
pressure `some` about 50 percent avg10; the window was run on a loaded host and no quiet
is claimed. Credential-looking environment names at preflight: 0.

| Fact | Value |
| --- | --- |
| node / npm | v24.18.0 / 11.16.0 |
| Podman | 5.7.1 (`/usr/local/bin` first on PATH) |
| Stack | gateway and compute-driver user units active; `openshell status` connected; rootless Podman socket present; digest-pinned image already present (no cold pull) |
| Muse Code | 1.4.24, via the override variable (`REALM_MUSE_BIN`), run as the account in a throwaway home; recorded 1.4.23; the different version ran and is recorded here |
| Prime Agent | 0.10.2 |
| Grok Build | 1.0.77 (the recorded version) |

The runbook was copied from 48-02-SUMMARY section 6 (production variables, host opt-ins,
executable overrides, files under `dist`, name patterns) and run unchanged. An earlier
attempt in this window aborted at module load (`Cannot find package 'ajv'`, because the
checkout copy lacked `node_modules`); it never started a test and touched nothing on the
stack (kept in the evidence as `window-aborted-mo.log`), and the window then ran once
with the dependencies present.

## 2. Outcomes (D-48-06 rule)

| Step | Outcome | Counts and marks |
| --- | --- | --- |
| A validator | passed | 1 passed, 0 failed, 0 skipped; test 2621.9 ms; both-files cell carried `grok-build`, Claude-alone cell carried `claude` (validator-tier probe matrix of 48-01, no Podman) |
| B attribution, both files | failed | assert `realm host install grok-build --dry-run` exit 1, `"realm host install: config-home-missing: the host config home does not exist"`; no host command ran, no wire, no audit line |
| C attribution control, Claude file alone | failed | `grok mcp doctor` exit 0, 1595 ms against the 300000 ms failure bound; wire `[initialize, notifications/initialized, tools/list]` and the six tools; presence `[claude-active]` named `claude`; audit no attach line; attached boot reports 0; first failing assertion: the audit line must name `claude` and the daemon must hold an attached boot report for `claude` |
| D Muse production | passed | 1 passed, 0 failed; `muse exec --provider echo --trust-workspace` returned after 5891 ms against the 300000 ms failure bound; wire `[initialize, notifications/initialized, tools/list]` and the six tools; restored names `[REALM_DRIVER_SOCKET, XDG_CONFIG_HOME, XDG_RUNTIME_DIR]`; zero live sessions; real settings file byte-equal; Muse 1.4.24 |
| E Prime Agent production | skipped, blocker B-48-02 | 1 skipped with the fixed sentence (Prime Agent 0.10.2); no drive run |
| F Grok production | failed | same first failing assertion as Step B (`config-home-missing` at install `--dry-run`); no host command ran |

Step B and Step F share one defect: the scenario creates the isolated `grok-home`
directory, but `Realm never creates a host home` (`src/host/install.ts`), so an install
into the empty home is refused `config-home-missing` (catalogue `POLICY_DENIED`). Owning
plan: 48-02 (`productionOverrides` for `grok-build` in `test/support/host-live.ts` does
not create the `<grok-home>/.grok` config home). That is a harness wiring gap, not a
product behavior change; nothing was patched in the window and the steps were not
retried silently. Step C is the cold case 48-02 deviation 2 predicted: the cold doctor
left in 1595 ms before the attach settled, so there is no audit line and no attached
boot report. The harness warm diagnostic variant (`REALM_LIVE_GROK_WARM=1`, labelled
`[warm diagnostic variant]`) was deliberately not run: it is not the production tier,
and the window is cold. The pre-existing empty presence directories `claude-active` and
`omp-active` in the shared state directory's `hosts` directory (both dated before this
window) were present in `before.txt` and in `after.txt`, were never touched, and do not
affect created-presence accounting; the control named `claude-active` correctly.

## 3. Answers to the open questions

- OQ-48-1: `grok mcp doctor` sends `tools/list`. The Grok wire is the full wire
(handshake, `tools/list`, the six tools), never handshake only.
- OQ-48-2: Muse sent `tools/list`. The session ended by exit (the host left before the
realm was ready), judged from the wire, as codex is.
- OQ-48-4: no Grok leader socket or process survived any run. The default leader socket
did not exist before the window and does not exist after it; every run used a per-run
leader socket inside its scenario.

## 4. Before and after

Identical on every residue field: 0 containers; 0 OpenShell sandboxes of the run; the
workspace root empty; the same two pre-existing empty presence directories; no receipt
file for any host; no realm daemon of the account; no host or Grok leader process; the
gateway and compute-driver units still active (the stack itself was not restarted); no
control socket. The operator's real host configuration files were `absent` before and
after (the account has no Muse settings file, no Grok `config.toml` and no Claude file),
and the policy file SHA-256 is unchanged (`e66c7871...`). The home's top-level entry
names differ by `node_modules` only, added between the two snapshots as part of the
checkout setup (dependencies needed to run the built tests), not by any run; the evidence
directory lives outside the repository. No throwaway home remains.

## 5. Requirement status

- HTIER-01: the live half is not reproduced (a legal VOID/not-reproduced result under
D-48-05, never relabelled). The both-files attach never reached the host (harness
defect at install), and the Claude-alone control showed the right attribution by
presence but wrote no audit line and no attached boot report (cold doctor leaves early).
HTIER-01 rests on the 48-01 probe matrix (Outcome A) and its gated validator step,
which passed again in Step A. The live demonstration of the audit line remains open and
carried.
- HTIER-02: met by a live result. Muse Code 1.4.24 passed its production tier cold on
2026-11-19 (full wire, 5891 ms, zero live sessions, byte-identical real settings).
- HTIER-03: met by the named blocker the requirement names. B-48-02 (a host property:
no credential-free command starts the registered server on Prime Agent 0.10.2) satisfies
the "or a named blocker" clause per D-48-06; the registry and the test hold it as a gap.
- HTIER-04: failed, honestly. Grok Build 1.0.77's production tier ran and failed at
`realm host install grok-build --dry-run` (`config-home-missing`, catalogue
`POLICY_DENIED`); the owning plan is 48-02. It is not met and not blocked.

Plan 48-04 copies these outcomes into the registry T3 records and the documents; it
writes nothing the summary does not hold.
