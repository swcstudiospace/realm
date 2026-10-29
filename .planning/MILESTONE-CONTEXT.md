# Milestone v3.0 context: Containment by Default

Scope source: `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/`. In `IMPROVEMENT-PROPOSALS.md` every "Proposed change" list of proposals 1 to 8 is in scope and every "Success measure" is the acceptance test. `SANDBOX-LIFECYCLE-FINDINGS.md`, `ABRUPT-END-PERSISTENCE-FINDINGS.md` and `LIVE-VERIFICATION.md` hold the evidence. Planners and executors read those files; they do not work from memory.

## Goal

A model working through Omp does its file mutations and commands inside the sandbox by default. The sandbox and the files in it survive crashes. An operator can see what happened, prove the audit log is intact, and ship the product with provenance and a rollback path.

## Owner decisions (2026-10-29, answering the Selection section of the proposals)

- **D1, all proposals:** all eight proposals are in this milestone, including the ones the proposals document suggested for the backlog (3, 5 and part D of 8).
- **D2, yes:** the scripted-provider evidence changes the status of OMP-05. When the Phase 12 harness passes live, OMP-05 is recorded complete in the traceability table, with the basis stated (scripted provider through Omp's own `write` tool, not an LLM-driven run).
- **D3, yes:** in fail-closed mode the Omp extension may remove or block Omp's built-in `write`, `edit` and `bash`, by the mechanism the spike proves. If the extension API cannot enforce removal, fail-closed stays a guard and the product claim and the docs say exactly that.
- **D4, yes:** the default policy `mode` changes from `advisory` to `fail-closed`. A policy file with no `mode` means fail-closed. Advisory stays available by explicit opt-in. This supersedes the earlier decision to keep advisory as the default. The schema default, the loader, `docs/policy-reference.md`, the README, the Omp notes, the doctor output, the `init` templates and every test that relied on the old default change together.
- **D5, add them:**
  - New runtime decisions are recorded in `docs/integration/runtime-decision.md` before the code that needs them: (i) the daemon holds one session per project workspace, a descendant of a configured root, superseding "one session per daemon"; (ii) the startup reaper re-adopts a running container that passes the create-time hardening verifier and removes what cannot be proven good, superseding the "remove everything" form of D-84, D-86 and RT-08 while keeping the no-orphan guarantee in a precise form; (iii) RT-01's mount list gains the session-owned scratch volume.
  - Two error catalogue additions are allowed: a distinct code for gateway or driver loss (TD-05), and one for audit reconciliation if no existing code fits. Each addition updates every table, doc and test that enumerates codes in the same pull request. Any other catalogue or schema change needs a reason recorded in the phase CONTEXT and is limited to what that phase's requirements need.
- **D6, signing off:** the owner signs off the changes this milestone needs under `.github/workflows/**`, `release/**` and `scripts/release/**`: the milestone minor bump, CI steps, Dependabot configuration, the scheduled mutation workflow, the release job split, provenance attestation, the rollback workflow and the changelog filter. Each such pull request cites D6 in its body. Repository settings (TD-10: secret scanning, push protection, branch protection, `sha_pinning_required`) stay the owner's and cannot be changed from the repository.

## Scope: eight proposals in nine phases (numbering continues at 12)

| Phase | Name | Proposal | Carries |
|---|---|---|---|
| 12 | Scripted-provider harness and Omp enforcement spike | 6 and the spike of 1 | OMP-05 per D2; OQ-P5-01, OQ-P5-02 |
| 13 | Quality ratchet | 8 parts A, B and C | TD-07, TD-09 |
| 14 | Crash-safety pack | 4 | TD-01, TD-04, FS-05, AUD-01; one catalogue code (D5) |
| 15 | Zero-config onboarding and fail-closed default | 2 and D4 | TD-03, CLI-03; TD-02 coordination note |
| 16 | Omp runs in the sandbox | 1 | D3 |
| 17 | Observability and tamper-evident audit | 7 | TD-05 (catalogue code, D5), AUD-01, QUAL-03 |
| 18 | Per-project sandboxes | 3 | runtime decision (D5 i); PRD-DRV-01 handling only as far as the phase needs |
| 19 | Resume and checkpoint | 5 | runtime decisions (D5 ii, iii) |
| 20 | Release pipeline hardening | 8 part D | TD-08, TD-10 (job split and attestation only), D6 |

## Ordering and dependencies

- Three lanes share no mutable state and may run in parallel: **Omp** 12, 15, 16; **runtime** 14, 17, 18, 19; **pipeline** 13, 20. Inside a lane the order is strict.
- 12 gives 16 its test bed and its enforcement answer. 14 comes before 17 because reconciliation appends audit lines that the hash chain must cover. 18 comes before 19 because adoption is per session. 20 comes last because it changes the release path that every earlier pull request ships through.
- Each phase ships through the ship flow (pull request, Greptile 5 of 5, squash merge, release on the `0.3.x` line). A phase may ship as several pull requests.
- The live production stack on the realm account is shared. The startup reap is account-wide, so only one live run may be active at a time; live runs take a lock.

## Constraints for every phase

- The rules of `AGENTS.md` apply: strict TypeScript, `RealmError` with catalogue codes, a timeout on every async boundary, no silent catch, no suppression comments, `process.env` read only at the three entry edges, no new dependency without the justification, licence check and maintenance check that `CONTRIBUTING.md` requires, no host-local absolute paths in committed files.
- Tests assert observable behaviour. No source-text tests. A change to a frozen contract updates its enumerating tests in the same pull request.
- `docs/specs/realm-spec.xml`, `LICENSE` and `NOTICE` are not modified. Version fields and `CHANGELOG.md` belong to the release job.
- Clean cutover: migrate every caller and remove the obsolete code in the same pull request. No compatibility shims.
- Every claim in a document carries an evidence label and is checked against the code or a run.

## Out of scope

FS-02 closure (the owner's status call; the property tests of Phase 13 add confidence only), ANDA-01 to ANDA-04 (engine licence), UI-01, TD-06, the TD-10 repository settings, and any change to the product spec.
