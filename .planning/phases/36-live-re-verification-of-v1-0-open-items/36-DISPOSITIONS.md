# Phase 36 dispositions: the 14 open items of the v1.0 re-verification

Recorded 2026-11-18 by Plan 36-02 (the date of the runs below). Plan 36-03 completes the seven live rows and Part C.

Status vocabulary (36-CONTEXT D-36-08): Dropped (owner decision D-27-01); Closed: moot, not resolved (OI-04 only, no legal determination); Re-verified (dated run, command, commit); Closed by test (hermetic, dated); Re-verified, current contract form (OI-09 only); Closed: owner decision (accepted) (OI-13 only, if the owner accepts); Carried (named reason); Needs the owner (decision text proposed). Interim labels while a plan is open: Pending run, Pending owner, Pending Plan 36-03. No interim label may remain when Plan 36-03 ends.

Evidence tiers (36-CONTEXT): O observed by reading a repository file or by command, R a recorded owner statement or verification record, M measured on this host in a run, I inference (also marked as such).

No label is stronger than its evidence: a result that rests on a record and not on a run says so, and a skipped test is never recorded as a pass. The archived v1.0 reports are history and are not edited.

## Part A. The ledger

| Id | Original id | Item (verbatim) | Status | Evidence |
| --- | --- | --- | --- | --- |
| OI-01 | 03 re-verification row 9 | `Live-gated item 5 (part): "ANDA-02 ... live RPC handshake"` | Dropped (owner decision D-27-01) | R: Part A rows ANDA-01 to ANDA-04 of `.planning/milestones/v4.0-phases/27-anda-disposition-and-v4-0-requirement-closure/27-DISPOSITIONS.md` (ANDA-02 row) and the Phase 3 report re-verification rows 9, 10 and 11. O: see the Anda bridge checks below. |
| OI-02 | 03 row 10 | `Live-gated item 5 (part): "ANDA-03 live RPC ... retry" (unreachable gives ANDA_UNREACHABLE, degraded, bounded backoff with jitter)` | Dropped (owner decision D-27-01) | R: the ANDA-03 row of the same Phase 27 file and Phase 3 re-verification row 10. O: see the Anda bridge checks below. |
| OI-03 | 03 row 11 | `SC4 and requirements ANDA-01 and ANDA-04 (reported "SATISFIED (unit)")` | Dropped (owner decision D-27-01) | R: the ANDA-01 and ANDA-04 rows of the same Phase 27 file and Phase 3 re-verification row 11. O: see the Anda bridge checks below. |
| OI-04 | 03 row 18 | `OQ-P3-11 (Open): "Anda licence conflict (anda.md Q6)"` | Closed: moot, not resolved | R: the OQ-P3-11 row of the same Phase 27 file (Closed: moot, not resolved; no legal determination). No legal determination is made here; the question reopens only if a later decision vendors Anda code. |
| OI-05 | 06 row 6 | `Human Verification 3, sub-claim: daemon-down yields warn, not fail, on control-channel` | Pending Plan 36-03 | Method in the Class notes below. |
| OI-06 | 06 row 12 | `Human Verification 6 and the tail of 1: stat on STATE_DIR/run (700) and STATE_DIR/run/control.sock (600) after a live realm up; socket removed after down` | Pending Plan 36-03 | Method in the Class notes below. |
| OI-07 | 06 row 10 | `Human Verification 5, Muse Code ~/.config/muse/settings.json entry` | Pending Plan 36-03 | Plan 36-01 builds and runs the validator tier and writes its run record; Plan 36-03 records the result here. |
| OI-08 | 06 row 11 | `Human Verification 5, Hermes Agent ~/.hermes/config.yaml entry` | Pending Plan 36-03 | Plan 36-01 fixes the gate and runs the wave 2 validator tier and writes its run record; Plan 36-03 records the result here. |
| OI-09 | 04 Human Verification 3 | `Live crash reap on the next start (SC1)` | Pending Plan 36-03 | Live half in the window (production live 5 and 11). Hermetic half already run, see Part B, section OI-09 hermetic half. |
| OI-10 | 04 Human Verification 5 | `Live policy acceptance and hung-exec timeout (SC2, SC4)` | Pending Plan 36-03 | Method in the Class notes below. |
| OI-11 | 05 re-verification 1b | `The session UI stays responsive during startup (handler returned without awaiting)` (UI-01) | Pending Plan 36-03 | Plan 36-01 builds the test; Plan 36-03 measures on a quiet host. UI-01 as a requirement status stays the owner's call. |
| OI-12 | 07 re-verification row 7 | `Human item 3 (MCP half): "notifications take no reply, unusable ids diagnose only"` (security review 5.8) | Closed by test (hermetic, dated) | M: the two tests of `test/mcp/server.test.ts`, 2 of 2 passed on 2026-11-18, base commit e32bb057a9f6. Details in Part B. |
| OI-13 | 07 row 10 | `Human item 3: "stdin-writer trust boundary (5.8 residual) accepted or mitigated"` | Needs the owner (decision text proposed) | No owner answer in this run (OQ-36-01). No docs file was changed. The proposed text and the lift condition are in Part B. |
| OI-14 | 07 row 12 | `Human item 4: "npm audit signatures, recompute each direct tarball SHA-512 against the lockfile integrity"` | Re-verified (dated run, command, commit) | M: scratch run of 2026-11-18, base commit e32bb057a9f6: `npm ci` exit 0, 145 verified registry signatures, 39 verified attestations, 10 of 10 direct tarballs equal. Details in Part B. |

Anda bridge checks (tier O, run 2026-11-18 on the base commit, for OI-01 to OI-04). Nothing Anda was run and no Anda behaviour is claimed:

- The directory `src/anda` does not exist (`test ! -e src/anda` holds).
- A case-insensitive word-boundary search of `src` for `anda` and for the codes `ANDA_UNREACHABLE` and `ANDA_VERSION_MISMATCH` (generated protocol files excluded) finds no bridge code. The only hit is `src/runtime/config.ts` line 53, a refusal message for the removed config key `andaUrl`: "andaUrl was removed in the 0.4 release line, with the Anda bridge: delete it from config.json".

Count: 7 rows final (OI-01, OI-02, OI-03, OI-04, OI-12, OI-13, OI-14; OI-13 is final as Needs the owner), 7 rows Pending Plan 36-03 (OI-05 to OI-11).

### Class notes

Why OI-13 has its own possible label: a decision is recorded, not re-verified, so if the owner accepts the proposal the row reads Closed: owner decision (accepted). This label exists for OI-13 only.

Methods of the live rows, copied in short from 36-CONTEXT D-36-02 to D-36-06 so that this file alone says what will be run:

- OI-05 (06 row 6). Run `live closeout A` of `test/integration/live-closeout.test.ts`, unchanged, as the `realmlive` account in the window. Pass: `realm doctor` exits 0 with no daemon, stderr says `realm doctor: daemon absent (REALM_NOT_ACTIVE); ran N local checks`, and the `control-channel` row is `warn` with a detail starting `control socket is absent` and the fix `Run realm up to start the daemon, then rerun doctor.` A skip (a daemon of the account is running) is recorded as a skip and is not a pass.
- OI-06 (06 row 12). Run `live closeout B` of the same file. Pass: after `realm up` the run directory is mode 0700 and `control.sock` is a socket of mode 0600, both owned by the invoking user, with exactly one daemon for the project; after `realm down` the socket is gone and no daemon of the account remains within 60 s.
- OI-07 (06 row 10). New gated test `test/integration/host-live-muse.test.ts` (helpers in `test/support/host-live-muse.ts`, hermetic test `test/integration/host-live-muse-helpers.test.ts`), opt-in `REALM_LIVE_MUSE=1`, in an isolated home: record the version, run `muse plugins validate` on `adapters/muse-code`, write the snippet entry (command `realm`, args `mcp`) as `settings.json` with a wire recorder named `realm` first on `PATH`, require the entry in `muse mcp list --json` and `muse mcp get realm --json` with no launch, then `muse exec --provider echo --trust-workspace` must launch the recorder once with argv `mcp` and show the handshake and the six Realm tool names; a missing target must fail with `failed during startup` (control). Pass: the test passes on this host. Named gap, not built: the production-stack boot from Muse (no recipe, no registry record, 30 s default start timeout; rehearse after Phase 33).
- OI-08 (06 row 11). Plan 36-01 gives the host-live gate an optional data-root preparation step for hermes (a fresh data root makes `hermes --version` fail until the first bootstrap), then the existing wave 2 hermes scenario of `test/integration/host-live-wave2.test.ts` runs (opt-in `REALM_LIVE_HERMES=1`). Pass: the hermes scenario passes (recipe installed, `hermes mcp list` prints the `realm` row, `hermes mcp test realm` launches the stub, the stub argv is recorded, uninstall restores the file, the real `config.yaml` is byte-equal).
- OI-09 (04 Human Verification 3). The current contract (RES-01, D5) re-adopts a container that passes the hardening verifier and removes what cannot be proven good, so the Phase 04 wording is superseded. Live checks: `production live 5:` (daemon killed with SIGKILL; the next `realm up` keeps the sandbox and its container and destroys a stray) and `production live 11:` (a container whose pids limit no longer matches is destroyed at the next start). Pass: both scenarios pass. Status on a pass: Re-verified, current contract form.
- OI-10 (04 Human Verification 5). Run `live closeout C`: an exec of `sleep 47` through `realm mcp` answers `TOOL_TIMEOUT`, the sleeper is visible while it runs (positive control), and none remains after the reply. The policy-acceptance half is cited from earlier production runs (scenario 3), not rerun.
- OI-11 (05 re-verification 1b). New gated measurement `test/integration/omp-responsiveness.test.ts` with pure helpers in `test/support/responsiveness.ts`: a quiet-host check (load average per CPU at most 0.5, recorded before, between and after), a baseline with `--no-extensions`, then an extension session with a cold attach and a `get_state` every 250 ms until `realm active`. Verdict: all probes answered, maximum at most 1000 ms, 95th percentile at most 500 ms, at least 40 probes and a window of at least 10 s. A loaded host gives Carried (measured under load); a failure on a quiet host gives Carried (not demonstrated). UI-01 stays the owner's call.

## Part B. Run records

Plan 36-02 fills OI-12, OI-14 and OI-13 and the OI-09 hermetic half; Plan 36-03 fills the rest.

### OI-12

- Date 2026-11-18. Base commit e32bb057a9f6 (origin main at the start of the run); this plan changes no file under `src` or `test`. Node v24.18.0, npm 11.16.0.
- Commands: `npm run build`, then `node --test --test-name-pattern="a JSON-RPC notification|neither a string" dist/test/mcp/server.test.js`.
- Result: 2 tests, 2 pass, 0 fail, 0 skipped.
- Test titles: "TOOL-05: a JSON-RPC notification (no id) takes no reply and no diagnostic, and a tools/call notification is never dispatched" and "TOOL-05: a request whose id is neither a string, number, nor null is diagnosed on stderr only, takes no reply and is never dispatched".
- What the tests pin, as the code is: a notification (no id), including a `tools/call` notification, gets no reply line and no stderr diagnostic and never reaches the dispatcher; a request whose id is neither a string, a number nor null gets the fixed stderr line `mcp: rejected invalid request`, no stdout line, and never reaches the dispatcher. This is a deliberate difference from the ACP agent, which answers `-32600` with a null id: an unusable id on MCP is diagnosed on stderr and answered with nothing, as the test comment states.
- Status: Closed by test (hermetic, dated). This replaces the "no named test" finding of the 2026-11-17 re-verification (PR 132, commit 842d5ca, added both tests).

### OI-09 hermetic half

- Same date, commit and toolchain as OI-12.
- Command: `node --test --test-name-pattern="null containerId|null-containerId" dist/test/session/reap.test.js`.
- Result: 2 tests, 2 pass, 0 fail, 0 skipped. Titles begin with D19-1 D-86: "a record with a null containerId and no live container is deleted with cause no-container, with no removal and no proof listing" and "a null-containerId record never reaches the verdict, and the live labelled container left by the crash is removed as no-record before the record is deleted".
- This is the hermetic half only. The live half (production live 5 and 11) is Plan 36-03; the OI-09 row stays Pending Plan 36-03.

### OI-14

- Date 2026-11-18. Base commit e32bb057a9f6 (the lockfile under test is the one of that commit). Node v24.18.0, npm 11.16.0. Network reachable.
- Method: a throwaway directory outside the repository (mode 0700) held copies of `package.json` and `package-lock.json` only; the repository tree was never installed into. The output of each step was kept in an evidence directory outside the repository (mode 0700), not named here. The directory with the install was removed afterwards. No script was added to the repository: the recomputation script lived only in the throwaway directory.
- Step 1: `npm ci --ignore-scripts --no-audit --no-fund`. Exit 0, 145 packages added (npm verifies each tarball against the lockfile `integrity` and fails with EINTEGRITY on a mismatch; none failed).
- Step 2: `npm audit signatures`. Exit 0. 145 packages audited, 145 verified registry signatures, 39 verified attestations; no invalid and no missing signature reported.
- Step 3: for each of the 4 dependencies and 6 devDependencies (all exact pins), `npm pack NAME@VERSION --json --ignore-scripts` into the throwaway directory, SHA-512 of the written tarball computed with Node crypto, base64 with the `sha512-` prefix, compared with the lockfile `integrity` of `node_modules/NAME` (version also compared). Result: 10 of 10 equal, exit 0: `@grpc/grpc-js` 1.14.6, `@grpc/proto-loader` 0.8.1, `@rivet-dev/agentos-core` 0.4.7, `ajv` 8.20.0, `@eslint/js` 10.0.1, `@types/node` 22.20.5, `eslint` 10.13.0, `fast-check` 4.10.2, `typescript` 6.0.3, `typescript-eslint` 8.72.0.
- Residual (threat model): the transitive tree is covered by `npm ci` and `npm audit signatures`, not by an independent recomputation. The result covers the lockfile of the commit under test on the date of the run.
- Status: Re-verified (dated run, command, commit). After the run `git status` showed no change to `package.json`, `package-lock.json` or `src`.

### OI-13

- Item (07 re-verification row 10): "stdin-writer trust boundary (5.8 residual) accepted or mitigated". The Phase 07 security review records it as a residual: the trust boundary is the process that launches the server. No later record states an acceptance or a mitigation.
- Owner answer: none in this run (option d of the checkpoint; this is OQ-36-01). The executor decides nothing. No docs file was changed: `docs/integration/mcp.md` has no Q11 and `docs/integration/acp.md` is unchanged.
- Proposed text, for the owner to accept, change or decline:

  The stdin of `realm mcp` and `realm acp` is trusted exactly as far as the process that launches the server. Whatever can write to that pipe is the client: Realm adds no authentication on the pipe. Where the capability token is checked, it limits what a labelled stdio host may call, but it is not a defence against another process of the same user that can write to the pipe, read the process environment or read the key file. This is the same-user limit already stated for capability tokens. Mitigation is outside the pipe: the launching host and the file modes of the control socket and state directories.

- Options: (a) accept as proposed; (b) accept with changes (the owner supplies the text); (c) decline (the owner wants a mitigation, which becomes a requirement and a later phase, not part of this one); (d) no answer.
- On (a) or (b): add subsection Q11. Stdin trust boundary to `docs/integration/mcp.md` after Q10 and before the Blocked module heading, with a line naming the date and the decision (owner decision of this phase, OQ-36-01) and the sources (Phase 07 security review item 5.8, Phase 07 re-verification row 10); add one sentence to the stdio paragraph of Q2 in `docs/integration/acp.md` pointing to it; no policy default or mode stated; then set the row to Closed: owner decision (accepted) with the date.
- Lift condition for the carry: the owner accepts, or states a mitigation as a requirement.

## Part C. Reconciliation

Plan 36-03 fills this section: every one of the 14 rows with its final label, the window record and the reconciliation against V1LIVE-01 and V1LIVE-02.
