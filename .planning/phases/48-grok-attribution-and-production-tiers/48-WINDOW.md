# Phase 48-03 window record (2026-11-19)

Serial, cold, under the shared live lock as the account's live account from its home
(the commit built and copied there without `.git`); evidence outside the repository in a
mode 0700 directory under the account's `realm-evidence` root. Window 2026-11-19T12:18:38Z
to 12:20:47Z. Host loaded: load average 16.38 and CPU pressure `some` about 50 percent
avg10 at preflight; no quiet is claimed. One aborted attempt before the window (import of
`ajv` missing before `node_modules` was copied into the checkout) never started a test and
touched nothing on the stack; it is kept in the evidence directory as `window-aborted-mo.log`.

Versions of the day (throwaway home, minimal environment): node v24.18.0, npm 11.16.0,
Podman 5.7.1, Muse Code 1.4.24 (recorded 1.4.23; a different version runs and is
recorded), Prime Agent 0.10.2, Grok Build 1.0.77. Credential-looking environment names:
0. Stack: gateway and compute-driver user units active, `openshell status` connected,
digest-pinned image already present, rootless Podman socket present. No login, no API
key, no token, no model turn at any step.

The runbook was copied from 48-02-SUMMARY section 6 (production variables, host opt-ins,
executable overrides, files under `dist`, name patterns) and run unchanged. The validator
step needs no Podman. Binaries by override: Muse from the planning account's local bin
(allowed through the traverse-only root home permission), Grok from the system binary
directory on PATH, Prime Agent from the planning account's local bin; all three ran
`--version` as the live account in a throwaway home.

## Steps

| Step | Test | Outcome | Evidence |
| --- | --- | --- | --- |
| A | Grok Build validator (`WAVE2-07 grok-build`) | passed: 1 passed, 0 failed, 0 skipped, 2621.9 ms test; both-files cell carried `grok-build`, Claude-alone cell carried `claude` | `grok-validator.txt` |
| B | Grok both-files attribution (`grok-build production attribution`) | failed at `realm host install grok-build --dry-run`, exit 1, `config-home-missing` (catalogue `POLICY_DENIED`): never reached the host command | `grok-attribution.txt` |
| C | Grok control, Claude file alone (`grok-build production control`) | failed mandatory audit: wire complete, presence named `claude`, audit no attach line, 0 attached boot reports | `grok-control.txt` |
| D | Muse production (`muse production`) | passed: 1 passed, 0 failed, host command 5891 ms against the 300000 ms failure bound | `muse-production.txt` |
| E | Prime Agent production (`prime-agent production`) | skipped by the fixed sentence `B-48-02`: no credential-free command starts the registered server | `prime-agent-production.txt` |
| F | Grok production (`grok-build production:`) | failed at `realm host install grok-build --dry-run`, exit 1, `config-home-missing`: never reached the host command | `grok-production.txt` |

Residue was checked between every step and compared with `before.txt`: 0 containers,
0 sandboxes, empty workspace root, no realm daemon of the account, no host or leader
process, no receipt files. The two pre-existing empty presence directories in the shared
state directory's `hosts` directory (`claude-active`, `omp-active`, both dated before this
window) were present before and after and were untouched; per `presenceDirsOf` diffing
they do not affect created-presence accounting, and the control run named `claude-active`
correctly.

## Details kept per test (names, counts, millisecond marks; never values or paths)

Step A: Grok Build 1.0.77 (the recorded version); the host's own add step left Realm's
entry value-identical; uninstall removed only what install created.

Step B: first failing assertion `realm host install grok-build --dry-run` exit 1 with
`"realm host install: config-home-missing: the host config home does not exist"`. The
scenario creates the isolated `grok-home` directory, but `Realm never creates a host
home` (`src/host/install.ts`), so the computed config home is refused. Owning plan:
48-02 (`productionOverrides` in `test/support/host-live.ts` does not create
`<grok-home>/.grok`). No wire and no audit line were produced; not retried, nothing
patched.

Step C: `grok mcp doctor` exited 0 (accepted [0, 1]), checks `[command found, server
started, handshake OK, N tools discovered]`, returned after 1595 ms against the 300000 ms
failure bound; recorder restored `[HOME]`; wire host methods `[initialize,
notifications/initialized, tools/list]`, tools `[exec, list, read, retry, status,
write]`; attribution to `claude`: audit no attach line; presence directories
`[claude-active]`; attached boot reports 0. First failing assertion: the attach audit
line must name `claude` (found none) and the daemon must hold an attached boot report
for `claude` (holds 0). The cold doctor left before the attach settled; this is the
case 48-02 deviation 2 predicted. The warm diagnostic variant (`REALM_LIVE_GROK_WARM=1`)
was not run: the plan window is cold and a rerun would not be the production-tier result.

Step D: Muse `exec --provider echo --trust-workspace` printed the echo reply and
returned after 5891 ms against the 300000 ms failure bound; recorder restored
`[REALM_DRIVER_SOCKET, XDG_CONFIG_HOME, XDG_RUNTIME_DIR]`; wire host methods
`[initialize, notifications/initialized, tools/list]`, six tools; attribution diagnostic:
audit no attach line, no new presence directories, 0 attached boot reports (the host
left before the realm was ready, judged from the wire, as for codex); the operator's real
Muse settings file is byte-equal before and after; muse processes 0 before, 0 after;
Muse version observed 1.4.24, recorded 1.4.23.

Step E: 1 skipped with the B-48-02 sentence naming Prime Agent 0.10.2; nothing run.

Step F: same first failing assertion as Step B (`config-home-missing` at install
`--dry-run`); no host command ran.

## Open questions

- OQ-48-1: `grok mcp doctor` sends `tools/list`. The Grok wire is the full wire, never
handshake only (control run plus the validator cells).
- OQ-48-2: Muse sent `tools/list`; the session ended by exit (the host left before the
realm was ready), judged from the wire.
- OQ-48-4: no Grok leader socket or process survived any run; the default leader socket
did not exist before the window and does not exist after it.

## After snapshot

Identical to `before.txt` except for checkout setup (see 48-03-SUMMARY): 0 containers,
0 sandboxes, workspace root empty, the same two pre-existing empty presence directories,
no realm daemon of the account, no host or leader process, no receipt or presence
directory created for the four ids, the real host configuration files `absent` before and
after, the policy file SHA-256 unchanged. `after.txt` holds the full after snapshot.
