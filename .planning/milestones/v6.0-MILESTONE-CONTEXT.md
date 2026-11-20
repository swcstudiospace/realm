# Milestone v6.0 context: Responsiveness, exec kill proof, host ids and evidence debt

The v5.0 context is archived at `.planning/milestones/v5.0-MILESTONE-CONTEXT.md`; the v3.0 context (owner decisions D1 to D6 of 2026-10-29) is at `.planning/milestones/v3.0-MILESTONE-CONTEXT.md`. This file holds v6.0 only.

Scope source: the owner's decisions of 2026-11-18 (below); the v5.0 audit (`.planning/milestones/v5.0-MILESTONE-AUDIT.md`: finding F-3, OI-11, EVID-01 Set B, the Phase 34 and 36 limitations); the gap rows `GAP-34-01` and `GAP-24-02` in `docs/integration/host-plugin-gaps.md`; and the "v5.1 candidates" the v5.0 close-out named. Planners and executors read those files; they do not work from memory.

## Goal

The Omp cold attach is measured on a quiet host and fixed if it blocks. A timed-out exec is proved dead, not merely finished. Muse Code, Prime Agent and Grok Build work under the enforce default. A daemon stop with a sandbox container no longer reports a failed teardown without cause. The evidence debt of v5.0 (the whole-suite non-root run, the breaking-change marker guard) is paid, and kimi and kimi-code are rehearsed or have named blockers.

## Release line

The release line is 0.6.x. `release/milestone.json` is `{"milestone":"v6.0","minor":6}`; the owner approved that exact one-line change on 2026-11-18. A phase that changes a documented contract incompatibly uses `!` in its commit subjects so the release notes list it (Phase 40 is the likely case if a launcher label changes what an existing install must do).

## Owner decisions (2026-11-18, HITL)

- **D-v6-1, start milestone v6.0** "Responsiveness, exec kill proof, host ids and evidence debt", phases 38 to 43, numbering continues from Phase 37.
- **D-v6-2, Omp responsiveness (Phase 38; Linear SPE-34662):** measure `get_state` across the Omp cold attach on a quiet host with the existing harness `test/integration/omp-responsiveness.test.ts`, waiting until the one-minute load per CPU is below 0.5. If the measurement shows blocking over the harness thresholds, make the Omp extension path non-blocking (answer before `up` completes, as Phase 33 did for `realm mcp`) and re-prove. Record the numbers either way. OI-11 closes on a quiet-host result, not on a loaded-host run.
- **D-v6-3, exec kill proof (Phase 39; Linear SPE-34663):** a live closeout test where a sleeper outlives the timeout window must show the sleeper dead (not merely finished) after `TOOL_TIMEOUT`, within a bound, with a proof independent of the sleeper's own run time (for example a sleeper longer than the observation window and a process-state check inside the sandbox). If the sleeper survives, fix the kill path. This settles finding F-3.
- **D-v6-4, host ids (Phase 40):** Muse Code, Prime Agent and Grok Build get host ids and manifests, recipes or launcher labels so that they work under the enforce default; `GAP-34-01` closes. The contract checker, the support matrix and the docs follow. A host with no verifiable config surface stays config-only, with a label in its launcher.
- **D-v6-5, daemon teardown (Phase 41):** reproduce `daemon.stopped code=REALM_STOPPING failedTeardowns=1` after about 30 s in a stop with a sandbox container, find the cause, fix or bound it, and prove it with a hermetic test and a live run.
- **D-v6-6, evidence debt (Phase 42):** the whole unit suite as a non-root user (EVID-01 Set B) recorded as uid 5002; a guard that every commit subject in a pull request range that is breaking carries the `!` marker, or the pull request lands as a merge commit (a script under `scripts/check` with tests, wired where the repo's gate conventions allow). If enforcement needs a workflow change, the guard stays report-only, because workflow files need human review.
- **D-v6-7, kimi and kimi-code (Phase 43):** install both CLIs in a scratch location outside the repository, run the validator and production tiers as for claude, opencode and codex, and record results or named blockers (`GAP-24-02`).
- **D-v6-8, supported versions:** the latest release line is supported. `SECURITY.md` and the Safety bullet of `AGENTS.md` (and the README status bullet that said the same) say so: currently 0.5.x, and 0.6.x from its first release.

## Scope: six phases (numbering continues at 38)

| Phase | Name | Requirements | Carries |
|-------|------|--------------|---------|
| 38 | Omp responsiveness during cold attach | OMPR-01..03 | OI-11 (loaded-host run of Phase 36); SPE-34662 |
| 39 | Timed-out exec kill proof | EXEC-01..03 | finding F-3; SPE-34663 |
| 40 | Host ids for Muse Code, Prime Agent and Grok Build | HOSTID-01..03 | GAP-34-01 |
| 41 | Daemon teardown flake | TEAR-01..02 | `daemon.stopped` with `failedTeardowns=1` and `REALM_STOPPING` after about 30 s |
| 42 | Evidence debt | DEBT-01..03 | EVID-01 Set B; breaking-change marker |
| 43 | Kimi and kimi-code rehearsal | KIMI-01..02 | GAP-24-02 |

## Ordering and dependencies

- 38, 39, 40, 41 and 43 are independent of each other. 42 comes after the others, because its whole-suite non-root run must cover the code they change; the guard script itself may be built earlier.
- Each phase ships through the ship flow (pull request, Greptile 5 of 5, squash merge, release on the `0.6.x` line). A phase may ship as several pull requests.
- The live production stack on the realm account is shared. The startup reap is account-wide, so only one live run may be active at a time; live runs take a lock. Phases 38, 39, 41 and 43 each need a live window; they queue.

## Constraints for every phase

- The rules of `AGENTS.md` apply: strict TypeScript, `RealmError` with catalogue codes, a timeout on every async boundary, no silent catch, no suppression comments, `process.env` read only at the three entry edges, no new dependency without the justification, licence check and maintenance check that `CONTRIBUTING.md` requires, no host-local absolute paths in committed files.
- Tests assert observable behaviour. No source-text tests. A change to a frozen contract updates its enumerating tests in the same pull request.
- `LICENSE`, `NOTICE` and `docs/specs/realm-spec.xml` are not modified. Version fields and `CHANGELOG.md` belong to the release job. Files under `.github/workflows/**` change only with human review.
- Clean cutover: migrate every caller and remove the obsolete code in the same pull request. No compatibility shims.
- Fail closed is kept: a non-blocking Omp path never runs a mutation before the session is ready, and a kill fix never weakens the timeout contract.
- Every claim in a document carries an evidence label and is checked against the code or a run. Live evidence is kept outside the repository and cited by date. A measurement that fails its thresholds is recorded as a finding, never relabelled as a pass.

## Limits

- Live phases depend on this host: rootless Podman 5.7.1, the OpenShell gateway, and the installed host CLIs. An item that cannot run is carried with a named reason, not claimed.
- Phase 38 needs a quiet host (load per CPU below 0.5); the harness refuses to run otherwise, and that refusal is not a result.
- Capability tokens still give no defence against a same-uid reader (Phases 30, 32 and 35 records); enforce for the three new host ids does not change that.

## Open owner questions

None blocking. Defaults taken: a host id is added to the closed host-id list and the policy `profiles` schema together; a host with no verifiable config surface keeps a launcher label and stays config-only; the breaking-change guard is report-only unless enforcement is possible without a workflow change.

## Out of scope

FS-02 closure (accepted limitation), UI-01 (accepted limitation), TD-06, the TD-10 repository settings, a model-driven tool call through a host, and any change to the product spec.
