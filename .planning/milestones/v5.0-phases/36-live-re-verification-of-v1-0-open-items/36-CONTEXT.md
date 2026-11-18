# Phase 36: Live re-verification of the v1.0 open items - Context

**Gathered:** 2026-11-18, from the Phase 36 block of `.planning/ROADMAP.md`, V1LIVE-01 and V1LIVE-02 in `.planning/REQUIREMENTS.md`, decision D-v5-5 in `.planning/MILESTONE-CONTEXT.md`, the re-verification sections of the archived v1.0 reports (`.planning/milestones/v1.0-phases/03-container-runtime-and-bridges/03-VERIFICATION.md`, `04-reaper-egress-guard-and-shared-dispatcher/04-VERIFICATION.md`, `05-omp-plugin-mcp-and-acp-surfaces/05-VERIFICATION.md`, `06-cli-daemon-and-host-packaging/06-VERIFICATION.md`, `07-policy-reference-and-security-review/07-VERIFICATION.md`), the v3.0 audit (`.planning/milestones/v3.0-MILESTONE-AUDIT.md`, line 39), the Phase 27 dispositions (`.planning/milestones/v4.0-phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md`), the Phase 31 window plan (`.planning/milestones/v4.0-phases/31-production-stack-boot-rehearsals-for-wave-1-hosts/31-02-PLAN.md`), the live tests named below, and a measurement pass on this host on 2026-11-18 (isolated homes, a fake MCP server, no production stack touched).
**Status:** Planned (three plans, nothing executed). V1LIVE-01 and V1LIVE-02 are registered in `.planning/REQUIREMENTS.md` and mapped to Phase 36; the orchestrator updates the ROADMAP plan list and closes the requirements after verification.

<domain>
## Phase Boundary

Decisions fixed elsewhere and not reopened here: D-v5-5 (re-verify what this host can run, with dated evidence kept outside the repository, or carry with a named reason), D-27-01 (the Anda bridge is dropped, so the Anda live handshake and licence items are closed, not run), and the owner authorization of 2026-11-18 that live windows are authorized when a phase needs them, under the same rules as before (shared live lock, `realmlive` account, residue checks, evidence outside the repository, a person runs every production-stack step).

This phase is an evidence phase. It adds three test files and two small test-support changes (Plan 36-01), records the items that need no production stack (Plan 36-02), and runs one owner-supervised window plus the recording of every result (Plan 36-03). It changes no file under `src`. It changes no product behaviour. A defect the runs expose becomes a finding and a new plan, never a patch inside this phase.

Out of scope: the Anda live handshake and licence (dropped), FS-02 and UI-01 as requirement statuses (UI-01 stays the owner's call; this phase supplies the measurement the owner asked for in v1.0, nothing more), a model-driven tool call through any host, kimi and kimi-code, any change to `docs/specs/realm-spec.xml` (Phase 37), and any edit of the archived v1.0 reports (they are history; Phase 27 set that rule).
</domain>

<decisions>
## Implementation Decisions

### Evidence (each fact: source, read or observed date 2026-11-18, tier)

Tiers: **O** observed by reading a repository file, **R** a recorded owner statement or verification record, **M** measured on this host in this planning pass, **I** inference (also marked [INFERENCE]).

- **E-36-01 (O).** The 14 open items come from the re-verification sections that PR 126 (commit `cae9172`, 2026-11-18) added to the Phase 03, 05, 06 and 07 reports. Counts by report: Phase 03 `reverify_open: 4`, Phase 05 `reverify_open: 1`, Phase 06 `reverify_open: 4`, Phase 07 `reverify_open: 3`; that is 12. The PR body and the v3.0 audit say 14 and name "two reaper live checks". Phase 04 was not edited by PR 126 and has no re-verification section.
- **E-36-02 (O).** The Phase 04 report (`status: human_needed`) lists five live items. Items 1 and 2 (egress allowed; egress denied and IPv6) are covered by later live evidence (Phase 07 re-verification row 3; production scenario 3, 33 of 33 on 2026-10-30), and item 4 (exec through the dispatcher in the live sandbox) by production scenario 6 ("realm mcp serves exec, write and read over stdio against the live sandbox"). Item 3 (live crash reap on the next start) and item 5 (live policy acceptance and hung-exec timeout) are the two Phase 04 items with no recorded live result in the current form. PR 129 (commit `379c9a5`) names "04-VERIFICATION.md human item 5" in the header of `test/integration/live-closeout.test.ts`. [INFERENCE] The "two reaper live checks" of the PR 126 body are Phase 04 items 3 and 5, the only Phase 04 items still open; Phase 04 is the reaper phase by name.
- **E-36-03 (O).** `test/integration/live-closeout.test.ts` (PR 129) holds scenarios A (doctor with no daemon), B (control socket modes and daemon stop after `down`) and C (a timed-out exec leaves no process). No document, changelog line or STATE entry records a run of it; [INFERENCE] it has never run live.
- **E-36-04 (O).** PR 132 (commit `842d5ca`, 2026-11-18) added hermetic closure for three items: `test/mcp/server.test.ts` lines 134 and 150 (a JSON-RPC notification takes no reply and no diagnostic; a request whose id is neither string, number nor null is diagnosed on stderr only, takes no reply and is never dispatched), `test/session/reap.test.ts` (two cases: a null-containerId record), and `scripts/check/lockfile-integrity.mjs` (the lockfile gate; its header says re-hashing a tarball is out of scope because `npm ci` does it on every install). The Phase 07 re-verification row 7 ("no named test") is therefore stale.
- **E-36-05 (R).** Phase 07 re-verification addendum: `npm audit signatures` on the lockfile of 2026-11-17 reported 145 packages with verified registry signatures and 39 with verified attestations; a tarball re-hash is not recorded. `package.json` lists 4 dependencies and 6 devDependencies, all exact pins.
- **E-36-06 (M).** Muse Code 1.4.23 (`muse --version`). `muse mcp list --json` and `muse mcp get realm --json` read `settings.json` from the user configuration home and start nothing (a stub recorded no launch). `muse exec --provider echo --trust-workspace` starts the required `realm` entry, sends `initialize`, `notifications/initialized` and `tools/list`, and ends with exit 0 in about 1.4 s against a fake server that answers the handshake. The same run with a stub that does not speak MCP ends with `Required MCP server realm failed during startup: the transport closed unexpectedly`. Without `--trust-workspace` the entry was not launched (the stub log stayed empty). `MUSE_EXPERIMENTAL_PLUGINS=1 muse plugins validate adapters/muse-code` prints `valid realm native skills=0 commands=0 hooks=0 mcp=0 reminders=0 diagnostics=0`, exit 0. The installed `muse` is a wrapper that defaults `MUSE_EXPERIMENTAL_PLUGINS` on.
- **E-36-07 (M).** Hermes Agent v0.23.1 (2026.9.24) (the Phase 25 record says v0.23.2; informational, the table has no floor for hermes). In a fresh data root `hermes --version` exits 1 in 0.1 to 0.3 s with `no dependency environment is committed for this install; run hermes pm repair`. Any other command bootstraps the root first (measured 20 to 36 s here; Phase 24 OQ-24-06 records up to 230 s on a loaded host); after that `--version` prints the version. [INFERENCE] The Phase 25 gate (`versionOnce` in `test/support/host-live.ts`, which runs `--version` in a throwaway home with a 120 s bound) therefore skips with "did not run to a successful exit" on a Hermes of this kind, which is the "CLI was broken on the verification machine" of GAP-25-04 and E-HM2. With a bootstrapped isolated `HERMES_HOME`: `hermes mcp list` prints the `realm` row as enabled; `hermes mcp test realm` against a fake server that answers the handshake prints `Connected` and `Tools discovered: 6`, exit 0, 3 s.
- **E-36-08 (M).** Installed hosts on 2026-11-18: Muse Code 1.4.23, Hermes Agent v0.23.1, Omp 18.22.2 (the brief said 18.22.0; `MIN_OMP_VERSION` is 18.12.6). The three launchers live under the root account's local binary directory. The root account's home directory is mode 0701 (others may traverse, not list), so a `realmlive` process can reach the launchers; whether each launcher runs as `realmlive` was not tested (the preflight in Plan 36-03 Task 2 checks it).
- **E-36-09 (M).** Load average at planning time was 12.0, 14.6, 11.8 on 8 CPUs: the host is not quiet now. The Omp measurement needs a quiet slot (D-36-06).
- **E-36-10 (O).** `docs/integration/omp.md` "UI-01 detail": 2026-10-23 a `get_state` sent one second after launch was answered only after the attach failure (about 6 s); 2026-10-28 (Omp 18.12.6, load near 30) keystrokes echoed within 0.2 to 1.2 s through a 24 s cold attach, "a measurement and not a proof". `test/integration/omp-boot-install.test.ts` shows the plugin starts the daemon itself on a cold attach (`BOOT_ACTIVE_TIMEOUT_MS` 360 s). No file in `test` or `scripts` sends `get_state`.
- **E-36-11 (O).** Reaper live scenarios in `test/integration/production-driver.test.ts`: "production live 5: after the daemon is killed, the next realm up keeps the sandbox and its container, and destroys a stray" and "production live 11: a container whose pids limit no longer matches its profile is destroyed at the next start, and the sandbox is created again". Recorded live passes: scenario 5 on 2026-10-28 (`RT-08` row of the v2.0 requirements), on 2026-11-02 (the Phase 14 window recorded in `.planning/STATE.md`), and the production file as a whole 37 of 37 on 2026-11-15 (Phase 14 verification) and 40 of 40 on 2026-11-16 (Phase 19 verification). The v3.0 amendment (D5, RES-01) replaced "remove everything" by "re-adopt what passes the hardening verifier, remove what cannot be proven good", so the Phase 04 wording of item 3 is superseded in form and its current live form is scenarios 5 and 11.
- **E-36-12 (O).** The production gate (`productionSkipReason` in `test/support/production-live.ts`) needs `REALM_LIVE_PRODUCTION=1`, `REALM_LIVE_IMAGE`, `REALM_LIVE_DRIVER_CONFIG`, `REALM_DRIVER_SOCKET`, `XDG_RUNTIME_DIR`, Podman 5.x, the `openshell` CLI and the built CLI. The live-closeout file also skips scenarios A and B while any realm daemon of the account runs. Evidence directories: `REALM_CLOSEOUT_EVIDENCE_DIR` (live-closeout), `REALM_OMP_EVIDENCE_DIR` (Omp files).
- **E-36-13 (O).** Phase 27 set the vocabulary and the rule: `27-DISPOSITIONS.md` lists the Anda items as dropped or closed, and the archived v1.0 reports are not edited. UI-01 is "Accepted limitation, the status stays the owner's call" (`27-CONTEXT.md` D-27-08).

### D-36-01. The open-item ledger (V1LIVE-01, V1LIVE-02)

Ids OI-01 to OI-14 are assigned here; the original id is the report and the row or item number inside it. Quoted text is the item as the re-verification or the report states it.

| Id | Original id and item (verbatim) | Class | Disposition path |
| --- | --- | --- | --- |
| OI-01 | 03 re-verification row 9: `Live-gated item 5 (part): "ANDA-02 ... live RPC handshake"` | dropped | D-27-01, closed in Plan 36-02 |
| OI-02 | 03 row 10: `Live-gated item 5 (part): "ANDA-03 live RPC ... retry" (unreachable gives ANDA_UNREACHABLE, degraded, bounded backoff with jitter)` | dropped | D-27-01, Plan 36-02 |
| OI-03 | 03 row 11: `SC4 and requirements ANDA-01 and ANDA-04 (reported "SATISFIED (unit)")` | dropped | D-27-01, Plan 36-02 |
| OI-04 | 03 row 18: `OQ-P3-11 (Open): "Anda licence conflict (anda.md Q6)"` | dropped (closed: moot, not resolved) | D-27-01, Plan 36-02 |
| OI-05 | 06 row 6: `Human Verification 3, sub-claim: daemon-down yields warn, not fail, on control-channel` | doable now | live-closeout A, Plan 36-03 window |
| OI-06 | 06 row 12: `Human Verification 6 and the tail of 1: stat on STATE_DIR/run (700) and STATE_DIR/run/control.sock (600) after a live realm up; socket removed after down` | doable now | live-closeout B, Plan 36-03 window |
| OI-07 | 06 row 10: `Human Verification 5, Muse Code ~/.config/muse/settings.json entry` | doable now (new test) | Plan 36-01 builds and runs the validator tier; Plan 36-03 records |
| OI-08 | 06 row 11: `Human Verification 5, Hermes Agent ~/.hermes/config.yaml entry` | doable now (existing test, gate fix) | Plan 36-01 fixes the gate and runs it; Plan 36-03 records |
| OI-09 | 04 Human Verification 3: `Live crash reap on the next start (SC1)` | doable now (current form) | production live 5 (and 11), Plan 36-03 window |
| OI-10 | 04 Human Verification 5: `Live policy acceptance and hung-exec timeout (SC2, SC4)` | doable now | live-closeout C, Plan 36-03 window |
| OI-11 | 05 re-verification 1b: `The session UI stays responsive during startup (handler returned without awaiting)` (UI-01) | doable now on a quiet host (new test) | Plan 36-01 builds; Plan 36-03 window measures |
| OI-12 | 07 re-verification row 7: `Human item 3 (MCP half): "notifications take no reply, unusable ids diagnose only"` (security review 5.8) | closed by tests since 2026-11-18 | Plan 36-02 runs the two tests and records |
| OI-13 | 07 row 10: `Human item 3: "stdin-writer trust boundary (5.8 residual) accepted or mitigated"` | needs the owner | Plan 36-02 decision checkpoint |
| OI-14 | 07 row 12: `Human item 4: "npm audit signatures, recompute each direct tarball SHA-512 against the lockfile integrity"` | doable now (no production stack) | Plan 36-02 runs it in a scratch copy |

Nothing in the ledger needs hardware. The only item that needs a person other than the window operator is OI-13 (an owner decision). Per-item methods, reuse and pass criteria are D-36-02 to D-36-07. The status vocabulary is D-36-08.

### D-36-02. Doctor and control-socket live modes (OI-05, OI-06) and the hung exec (OI-10): run `live-closeout` as it is

Reuse `test/integration/live-closeout.test.ts` unchanged. Run scenarios one at a time with `--test-name-pattern` set to `live closeout A`, `live closeout B`, `live closeout C`, serially, in the window, as the `realmlive` account, with `REALM_CLOSEOUT_EVIDENCE_DIR` set to the evidence directory outside the repository.

- **A (OI-05).** Pass: the test passes; `realm doctor` exits 0 with no daemon; stderr says `realm doctor: daemon absent (REALM_NOT_ACTIVE); ran N local checks`; the `control-channel` row has status `warn`, a detail starting `control socket is absent`, and the fix `Run realm up to start the daemon, then rerun doctor.` (`FIX_CONTROL_ABSENT`, `src/doctor/checks.ts` line 505). Evidence files: `live-closeout.A.control-channel-row.json`, `doctor.stdout.json`, `doctor.stderr.txt`, `commands.txt`. A needs no daemon of the account to be running; if one is, the test skips naming it and the window stops (the person records the skip, it is not a pass).
- **B (OI-06).** Pass: after `realm up` the run directory is mode 0700 and `control.sock` is a socket of mode 0600, both owned by the invoking user, exactly one daemon serves the project; after `realm down` the socket is gone and no daemon of the account remains within 60 s. Evidence files: the `stat -c` lines in the commands transcript and `live-closeout.B.after-down.txt`.
- **C (OI-10).** Pass: an exec of `sleep 47` through `realm mcp` answers `TOOL_TIMEOUT`; while it runs the sandbox shows the sleeper (positive control); after the reply no `sleep 47` remains in the sandbox. This is the "hung exec returns TOOL_TIMEOUT with no surviving sandbox process" half of Phase 04 item 5. The "gateway accepts the network_policies document" half is covered by every production run since 2026-10-28 (the create call carries the policy; scenario 3 asserts the allowlist behaviour, passed 33 of 33 on 2026-10-30 and 40 of 40 on 2026-11-16); Plan 36-03 cites it, it does not rerun it.

Why no code change: the test already asserts the original claims and was written for these rows. If a scenario fails, the failure is the result (D-36-09).

### D-36-03. The reaper live checks (OI-09 and its second face)

OI-09 is Phase 04 human item 3. Its expected text ("reapStartup removes the container and deletes the record") describes the pre-D5 reaper. The current contract (RES-01, `docs/integration/runtime-decision.md`) re-adopts a container that passes the hardening verifier and removes what cannot be proven good. The live checks of the current contract are two existing production scenarios:

- **Scenario 5.** The daemon is killed with SIGKILL; the next `realm up` keeps the sandbox and its container (workspace marker survives, exactly one container) and destroys a stray container. Pass: the scenario passes (TAP `ok`, zero failures). Evidence: the TAP output kept in the evidence directory; the scenario removes its own state, so the output is the record.
- **Scenario 11.** A container whose pids limit no longer matches its profile is destroyed at the next start and the sandbox is created again; the startup record names the container with cause `pids-limit` and the status notice reads `destroyed at startup: 1 container(s), 1 session record(s)`. Pass: the scenario passes.

Both run through `node --test --test-concurrency=1 --test-name-pattern="production live 5:" dist/test/integration/production-driver.test.js` and the same with `production live 11:` (the pattern `production live 5:` does not match `production live 5c:`). The hermetic half (a null-containerId record) is PR 132's two cases in `test/session/reap.test.ts`; Plan 36-02 runs them. The recorded status of OI-09 is "re-verified, current contract form" with a sentence that the Phase 04 wording is superseded by D5.

### D-36-04. Muse Code loading (OI-07): a new validator-tier test; no production tier (named gap)

Muse Code is not in the host registry (`test/support/host-registry.ts` has no muse record), has no recipe and no `--host` id; it is configured by hand with the snippet `adapters/muse-code/mcp-settings.snippet.json` (`docs/hosts/snippets/muse-code.md`). A new gated test, `test/integration/host-live-muse.test.ts`, with pure helpers in `test/support/host-live-muse.ts` and their hermetic test `test/integration/host-live-muse-helpers.test.ts`, does the following in an isolated home (opt-in `REALM_LIVE_MUSE=1`, optional `REALM_MUSE_BIN` as an absolute path): record the version; run `muse plugins validate` on `adapters/muse-code` (the tier-2 line); write the snippet entry verbatim (command `realm`, args `mcp`) as `settings.json` and put a wire recorder named `realm` (existing `writeWireRecorder`, target the existing fake MCP server from `writeFakeMcpServer`) first on `PATH`; run `muse mcp list --json` and `muse mcp get realm --json` and require the entry (name `realm`, enabled, stdio, required, source user, args ending `mcp`) with no launch recorded; run `muse exec --provider echo --trust-workspace` with the fixed sentence in a scratch workspace and require exit 0, one launch with argv `mcp`, the handshake (`initialize` or `server/discover`, then `tools/list`) and the six Realm tool names on the wire; run the same with a missing target and require the failure text `failed during startup` (a control showing a broken entry is visible); and require the operator's real Muse `settings.json` to be byte-equal before and after.

This is the claim OI-07 asks for ("a Muse Code run with that entry applied showing the realm server"): the host reads the entry, resolves `realm` through `PATH`, starts it, completes the MCP handshake and lists the tools. `/mcp` is an interactive inventory and is not driven; `muse mcp list` is its non-interactive counterpart. Pass criterion: the validator-tier test passes on this host (Muse 1.4.23) with the dated TAP output kept outside the repository.

**Production tier: named gap, not built.** A boot of `realm mcp --host` against the production stack from Muse would need Muse's environment forwarding for stdio servers (unmeasured), and Muse's default `startup_timeout_sec` is 30 s, which a cold stack exceeds until Phase 33 lands (GAP-31-04). The gap is recorded in `docs/hosts/snippets/muse-code.md` and `docs/integration/hosts.md` as "Muse Code production-stack boot not rehearsed: no recipe, no registry record, 30 s default start timeout; rehearse after Phase 33". V1LIVE-01 asks for loading, which the validator tier proves; the carry is the T3 boot, named.

### D-36-05. Hermes loading (OI-08): fix the gate, then run the existing wave 2 validator tier

The existing test (`test/integration/host-live-wave2.test.ts`, host `hermes`, opt-in `REALM_LIVE_HERMES=1`) already runs `hermes mcp list` and `hermes mcp test realm` against the stub realm in an isolated `HERMES_HOME`. It cannot run today because the gate's version probe fails on a fresh data root (E-36-07). The change (Plan 36-01 Task 3) is test support only: `HostLiveSpec` gains an optional `versionRoot` (the data-root variable and a preparation argument list); for hermes it is `HERMES_HOME` and `mcp list`; `versionOnce` sets the variable to a directory inside its throwaway home, runs the preparation command once with a 300 s bound (scaled), ignores its exit, then runs `--version` as before. The hermes validators in `WAVE2_LIVE` get `timeoutMs` 300000 for the first bootstrap. Hermetic pins: a fake hermes script that fails `--version` until its data root exists proves the gate now passes; the table pins for the hermes timeouts. Run with `REALM_TEST_TIMEOUT_SCALE=3` so the 120 s bounds elsewhere in the rig stretch to 360 s.

Pass criterion: the hermes scenario of the wave 2 file passes (installed recipe, `hermes mcp list` prints the `realm` row, `hermes mcp test realm` launches the stub and ends with exit 0 or 1 as the table allows, the stub argv `mcp --host hermes` is recorded, uninstall restores the file, the operator's real `config.yaml` is byte-equal). The wave 2 table accepts exit 1 because the stub does not speak MCP; the E-36-07 measurement of a handshaking server (`Connected`, six tools) is recorded in the summary as supporting evidence, not as the pass criterion. After the run Plan 36-03 sets the hermes `t2` record in the registry (date, version, result, command, "covers this version only") and regenerates the support matrix block with `REALM_WRITE_HOST_MATRIX=1`, as Phase 31 did.

### D-36-06. Omp responsiveness (OI-11): a new gated measurement; the verdict needs a quiet host

New: `test/integration/omp-responsiveness.test.ts` (opt-in `REALM_LIVE_OMP_RESPONSIVENESS=1` plus the existing Omp gate and the production gate), `test/support/responsiveness.ts` (pure: summary of latency samples, the quiet-host check, the verdict) and `test/support/responsiveness.test.ts` (hermetic). Method, in an isolated Omp profile on the production stack with no daemon running:

1. Quiet check. One-minute load average per CPU (`os.loadavg` over `os.cpus`) at most 0.5 before the baseline and before the extension session; both values and the value after are recorded. Above the ceiling the test fails with a message that says the host is not quiet and that no verdict is possible, unless `REALM_OMP_RESPONSIVENESS_ALLOW_LOADED=1`, which lets it run, records `loaded`, and makes the result non-citable as an unloaded measurement.
2. Baseline (positive control). Omp with `--no-extensions` and the same profile and environment, 10 s, `get_state` every 250 ms. The baseline answers every probe within the bound, otherwise the host is not quiet and the test fails before the extension session.
3. Extension session. Omp with the built extension loaded with `-e`, cold (the plugin starts the daemon itself). From process start until the status item reads `realm active` (a cold attach measured at 24 s in 2026-10-28), a `get_state` is sent every 250 ms with its own id; the latency is the time from send to the `response` frame with that id.
4. Verdict. All probes answered; maximum latency at most 1000 ms (the plugin-free probes of 2026-10-23 answered within about one second); 95th percentile at most 500 ms; at least 40 probes sent and an attach window of at least 10 s (otherwise the result is "window too short", a failure, never a pass); the status item reached `realm active`.

Evidence: `omp-responsiveness.samples.csv` (send time, latency), `omp-responsiveness.summary.txt` (counts, maximum, 95th percentile, longest gap, the three load values, the Omp version), the transcript, all in `REALM_OMP_EVIDENCE_DIR`. Pass criterion for "re-verified": the test passes with the quiet check satisfied. If the host was loaded, the item is "carried: measured under load" with the numbers; if the test fails on latency on a quiet host, the item is "carried: not demonstrated" with the numbers and a finding. Either way the status of UI-01 stays the owner's call; this phase does not change it.

### D-36-07. Phase 07 items (OI-12, OI-13, OI-14)

- **OI-12.** Run the two existing tests in `test/mcp/server.test.ts` (names above) and record the commit and the pass. Status: closed by tests (hermetic), dated. No code.
- **OI-13.** An owner decision; no run can close it. The proposed text, for the owner to accept or change, in `docs/integration/mcp.md` (a short subsection after Q10, and one sentence in `docs/integration/acp.md`): the stdin of `realm mcp` and `realm acp` is trusted exactly as far as the process that launches the server; any process that can write to that pipe is the client; Realm adds no authentication on the pipe; the capability token of Phase 32 limits what a labelled stdio host may call but is not a defence against a same-uid writer (the Phase 30 and 32 limit, restated in `.planning/MILESTONE-CONTEXT.md`). If the owner declines or does not answer, OI-13 is carried as "needs the owner" and nothing is written to the docs.
- **OI-14.** In a scratch copy outside the repository (the lockfile and `package.json` only): `npm ci --ignore-scripts` (npm verifies every tarball against `integrity`; any mismatch fails with EINTEGRITY), `npm audit signatures`, and for each of the 10 direct dependencies `npm pack NAME@VERSION --json` into the scratch directory, comparing the `integrity` it reports with the lockfile entry. Pass: install succeeds, `npm audit signatures` reports no invalid or missing signature, and all 10 integrity values are equal. The run is network-bound; if the registry is unreachable the item is carried with that reason, not passed. No script is added to the repository: PR 132 kept the re-hash out of the gate on purpose.

### D-36-08. Status vocabulary (extends Phase 27 D-27-07)

Only these labels, in `36-DISPOSITIONS.md` and in the docs this phase edits: **Dropped (owner decision D-27-01)**, **Closed: moot, not resolved** (OI-04, no legal determination), **Re-verified (dated run, command, commit)**, **Closed by test (hermetic, dated)**, **Re-verified, current contract form** (OI-09 only), **Closed: owner decision (accepted)** (OI-13 only, if the owner accepts: a decision is recorded, not re-verified), **Carried (named reason)**, **Needs the owner (decision text proposed)**. Interim labels while a plan is open: Pending run, Pending owner, Pending Plan 36-03; no interim label may remain when Plan 36-03 ends. A label is never stronger than its evidence: a result that rests on a record and not on a run says so, and a skipped test is never recorded as a pass.

### D-36-09. Failure and skip handling

A failing run is a result. The person or the executor keeps the output, names the first failing assertion and the catalogue code if one is printed, records the item as Carried with that reason, and patches nothing. A skip is recorded as a skip with its printed reason; the item stays open. Residue after a failure is cleaned with `realm down` for that scenario's project from the same checkout, and the cleanup is recorded.

### D-36-10. Window design (blocking-human)

One window, after Plans 36-01 and 36-02 are merged, run by a person as the `realmlive` account under the shared live lock, serially: closeout A, B, C; production live 5 and 11; the Omp responsiveness test last, in a quiet slot the owner picks. Every window step is a checkpoint for a person: no agent starts the daemon, the gateway or a container on the production stack. The owner authorization of 2026-11-18 is cited, not re-asked; Task 1 of Plan 36-03 records the date, the person and the lock holder. The window may run before or after the Phase 33 and Phase 35 windows; the stack is shared and the startup reap is account-wide, so one live run at a time, and the commit under test is recorded. If a production run fails because of a Phase 33 to 35 change (for example a stdio harness path under enforce), the failure is recorded as a finding for that phase, not patched here. Muse and Hermes run in Plan 36-01 (no production stack, no daemon); Plan 36-03 transcribes their results.

### Threat model: the re-verification itself (summary; each plan carries STRIDE rows)

The runs touch a real stack (window) and real host binaries (Muse, Hermes, Omp). Main risks: a test mutating an operator's real configuration (every test hashes the real files before and after, and runs with an isolated home and an environment allowlist); residue on the shared stack (before and after snapshots, `realm down` on failure); recording a skip or a loaded-host number as a pass (D-36-08, D-36-09); evidence leaking a secret or a host path (evidence stays outside the repository; docs cite names, counts, hashes and dates, never paths or environment values); a quiet-host claim resting on a single reading (three load readings are recorded); an owner decision invented by an agent (OI-13 is a checkpoint, nothing is written without the answer).

### Verification posture

Plan 36-01: typecheck, lint, build, the hermetic tests, the validator-tier runs of Muse and Hermes on this host, and `npm run check:gates` (no `src` file changes, so the gate closure, module size and export usage are unaffected, and the plan states it). Plan 36-02: the two hermetic tests, the scratch supply-chain run, the docs checks. Plan 36-03: the window evidence is the verification of the live results; the parent re-reads the evidence summary against `36-DISPOSITIONS.md` and the docs before closing V1LIVE-01 and V1LIVE-02.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/MILESTONE-CONTEXT.md` (D-v5-5), `.planning/REQUIREMENTS.md` (V1LIVE-01, V1LIVE-02), `.planning/ROADMAP.md` (Phase 36 block).
- `.planning/milestones/v1.0-phases/` reports 03, 04, 05, 06, 07 (the ledger sources) and `.planning/milestones/v1.0-MILESTONE-AUDIT.md`, `.planning/milestones/v3.0-MILESTONE-AUDIT.md` line 39.
- `.planning/milestones/v4.0-phases/27-anda-disposition-and-v4-0-requirement-closure/27-CONTEXT.md` (D-27-01, D-27-07, D-27-08) and `27-DISPOSITIONS.md`.
- `.planning/milestones/v4.0-phases/31-production-stack-boot-rehearsals-for-wave-1-hosts/31-02-PLAN.md` (window pattern) and `31-CONTEXT.md` D-31-08.
- `.planning/milestones/v3.0-phases/18-per-project-sandboxes/18-14-PLAN.md` (window rules, stop rule).
- `docs/integration/openshell.md` ("Running the production live suite"), `docs/integration/runtime-decision.md` (C5 down rule, Directory modes, reaper decision), `docs/integration/omp.md` ("UI-01 detail"), `docs/integration/hosts.md` (Muse Code, Hermes Agent), `docs/hosts/snippets/muse-code.md`, `docs/hosts/snippets/hermes-agent.md`, `docs/integration/host-plugin-gaps.md` (GAP-25-01, GAP-25-04, GAP-25-05), `docs/integration/mcp.md` (Q7, Q10).
- Code and tests: `test/integration/live-closeout.test.ts`, `test/integration/production-driver.test.ts`, `test/integration/host-live-wave2.test.ts`, `test/integration/omp-boot-install.test.ts`, `test/support/host-live.ts`, `test/support/host-live-wave2.ts`, `test/support/host-live-session.ts`, `test/support/production-live.ts`, `test/support/omp-rpc.ts`, `test/support/omp-profile.ts`, `test/support/omp-live.ts`, `src/doctor/checks.ts`, `src/daemon/daemon.ts`, `src/mcp/server.ts`.
</canonical_refs>

<code_context>
## Existing Code Insights

- `writeWireRecorder`, `writeFakeMcpServer`, `readWireLog`, `wireSummary`, `REALM_TOOL_NAMES` (`test/support/host-live-session.ts`) are the building blocks of the Muse test; `runHost`, `resolveExecutable`, `fileSha256`, `describeRun`, `stripAnsi`, `requireReturned`, `VALIDATOR_TIMEOUT_MS` come from `test/support/host-live.ts`. The recorder is a `realm` shim, so the snippet entry stays byte-identical (command `realm`).
- `startOmp`, `OmpSession` (`send`, `waitFor`, `status`, `frames`, `close`), `createOmpProfile`, `ScriptedProvider`, `EXTENSION_PATH`, `ompSkipReason`, `collectOmpGateInputs`, `writeEvidence`, `createCleanups` carry the Omp test; the boot rehearsal in `omp-boot-install.test.ts` (scenario environment merge near line 357, `waitFor` on `realm active`) is the model for the production environment and the teardown (`cleanupScenario`-style: `realm down`, `restoreSharedPolicy`, `removeSharedStateCreatedBy`, `waitForNoResidue`).
- Test file names: the taxonomy test forbids a basename containing mcp or acp except `cli/mcp-attach.test.ts`; the new names (`host-live-muse`, `omp-responsiveness`, `responsiveness`) pass. Test support imports no `src` module that reaches `node:child_process` in a way the gate closure checks (the gate covers `src`).
- No `src` file changes: the module-size ratchet (`src/daemon/daemon.ts` 986, `src/cli/main.ts` 922) and the export-usage gate are untouched.
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | Contents | Autonomous |
| --- | --- | --- | --- |
| 1 | 36-01 | Muse test and helpers, Hermes gate fix, Omp responsiveness test and helper; hermetic tests; the Muse and Hermes validator runs on this host | yes |
| 1 | 36-02 | Items that need no production stack: OI-01 to OI-04 closure, OI-12, OI-14, the OI-13 owner decision; the ledger file `36-DISPOSITIONS.md` | no (one decision checkpoint) |
| 2 | 36-03 | The window (closeout A, B, C; production live 5 and 11; Omp responsiveness), then recording every result and the V1LIVE-02 reconciliation | no (blocking-human) |

Plans 36-01 and 36-02 touch disjoint files and run in parallel.

## Requirement IDs

V1LIVE-01 (Plans 36-01, 36-03 and, for OI-12, OI-13, OI-14, Plan 36-02), V1LIVE-02 (Plans 36-02 and 36-03).

## Open Questions (owner decisions or unverified; none blocks Plans 36-01 and 36-02 except where stated)

- **OQ-36-01.** OI-13: does the owner accept the stdin trust boundary as proposed (D-36-07)? Plan 36-02 Task 4 asks. A no or no answer leaves OI-13 carried as "needs the owner".
- **OQ-36-02.** The window date, the person and the quiet slot for the Omp measurement (Plan 36-03 Task 1). The Omp item cannot be re-verified on a loaded host (E-36-09).
- **OQ-36-03.** [INFERENCE] The identity of the "two reaper live checks" (E-36-02). If the owner meant other items, the ledger row for them is added with the same method; nothing already planned changes.
- **OQ-36-04 (unverified).** Whether the `muse`, `hermes` and `omp` launchers run as the `realmlive` account (E-36-08). Plan 36-03 Task 2 checks it; if they do not, the Omp step runs as the account that can run it and the evidence says so.
- **OQ-36-05 (unverified).** Whether a cold attach in the window is long enough (at least 10 s) for the Omp measurement; the test fails with "window too short" rather than passing vacuously. If the stack is already warm, the person stops the daemon first (`realm down`) before the Omp step.

## Deferred Ideas

- A Muse Code production-stack boot rehearsal (after Phase 33 and a measurement of Muse's environment forwarding for stdio servers).
- A model-driven tool call through Muse or Hermes (needs a model credential; out of scope for all hosts).
- Wiring the supply-chain re-hash into `npm run check:gates` (PR 132 kept it out on purpose; would need network in CI).
</specifics>

<deferred>
## Deferred Ideas

See Deferred Ideas under the specifics block above.
</deferred>
