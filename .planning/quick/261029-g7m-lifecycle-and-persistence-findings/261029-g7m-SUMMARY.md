---
quick_id: 261029-g7m
slug: lifecycle-and-persistence-findings
date: 2026-10-29
status: complete
completed: 2026-10-29
---

# Summary of quick task 261029-g7m

## Answers

**Does the plugin create the sandbox when Omp opens a new session? Conditionally yes for the attach, no for use of the sandbox by Omp's tools.**

- Opening an Omp session starts a background attach with no user step: the extension spawns the daemon if none answers, then calls `up` for the session directory. The first session creates the sandbox container; later sessions attach to the same one. Observed live: `● realm active · container running` about 57 s after Omp's ready frame at a host load of about 68 (L1, L7).
- It needs the production stack, a digest-pinned image, `config.json`, `policy.json` and three `REALM_DRIVER_*` roots in the daemon's environment. Without them the status item shows a stable code (`POLICY_DENIED`, `SCHEMA_INVALID`, `PODMAN_*`, `STARTUP_BUDGET_EXCEEDED`).
- The session directory must be exactly the configured workspace root; any other directory, including a subdirectory, is refused with `POLICY_DENIED`.
- Omp's own tools do not run in the sandbox. With the extension loaded the model was offered `read, bash, edit, ask, eval, glob, grep, task, wait, todo, web_search, write` and no Realm tool (L2). The extension only gates `write` and `edit` on the realm's state: allowed in advisory mode with a notice, blocked with `REALM_NOT_ACTIVE` in fail-closed mode (L3, L4).

**Are files kept if the session ends abruptly? Yes for work in the workspace, no for state inside the sandbox.** Details per class and scenario are in `ABRUPT-END-PERSISTENCE-FINDINGS.md`.

- A closed terminal (SIGHUP) and a SIGKILL of Omp left the daemon, the container and the written file untouched; the next session reattached to the same container (L7).
- A daemon SIGKILL left the workspace files intact and the container running as an orphan; the next `realm up` destroyed it and created a new one, so anything outside `/workspace` was lost (L5).
- Realm's atomic write leaves the target old or new, never torn. A SIGKILL at each of the four hookable stages, all of which fire before the rename, left the old content and one orphan temp file that nothing removes (L6a); a kill after the rename leaves the new file (not run). Omp's own write is an in-place overwrite with no `fsync` and no rename (L6b).

**Outstanding work.** No ROADMAP phase or milestone is incomplete, no TODO, FIXME, HACK or XXX marker exists, and the next GSD step is `/gsd-new-milestone`. Carried items are FS-02, ANDA-01 to ANDA-04, OMP-05, PRD-DRV-01, UI-01 and tech debt TD-01 to TD-10; those reachable by engineering alone are listed in `OUTSTANDING-WORK-INVENTORY.md`, section 5. Nothing was implemented, because no phase authorizes it and the request asked for suggestions.

## Verification

The baseline gates were run once at main 00e0003 before anything was written: typecheck, lint, `test:scripts`, `check:docs`, `check:pack` and `check:mcp` exit 0; `npm test` exit 0 with 1872 tests, 1862 passed, 0 failed, 10 skipped (equal to the final run of pull request 7). No source, test, script, workflow or release file was changed, so they were not run again. The live runs are recorded in `LIVE-VERIFICATION.md`.

## Pending decisions and validation requests (none blocks anything)

Status 2026-10-29: the owner answered D1 to D6 (all proposals; D2 yes; D3 yes; D4 yes; D5 add them; D6 signed off). The answers and their meaning are recorded in `.planning/MILESTONE-CONTEXT.md`, and the defaults in the table below are superseded by them.

| Id | Kind | Question | Default if unanswered |
|---|---|---|---|
| D1 | decision | Which of the eight proposals become the next milestone (`IMPROVEMENT-PROPOSALS.md`, "Selection needed") | none started |
| D2 | decision | Does the scripted-provider observation (L3, L4) change the status of OMP-05, or is an LLM-driven run required? | OMP-05 stays partial |
| D3 | decision | May fail-closed mode disable Omp's built-in `write`, `edit` and `bash` (prerequisite of proposal 1)? | no |
| D4 | decision | Should the default policy mode change from advisory, which lets Omp's writes proceed while the realm is disconnected? | no, the default stays advisory |
| D5 | decision | Runtime decisions that proposals 3 and 5 need (one workspace per daemon; reaper destroys instead of adopting), and catalogue additions (TD-05, audit reconciliation) | no change to the settled decisions or the frozen catalogue |
| D6 | decision | Sign-off for changes under `.github/workflows` and `release` (proposal 8, part D) | no change |
| V1 | validation | An LLM-driven Omp session, which needs the owner's provider key | not run |
| V2 | validation | The persistent `omp plugin install --scope=user` path | not run |
| V3 | validation | The status text of an Omp session opened in a directory other than the pinned root | not run |

## Deviations from the GSD quick workflow

- The workflow's planner and executor agents were not spawned. The deliverable is this task's own investigation, produced and checked in the session; the task id, directory and STATE.md row come from the GSD tooling.
- Two of the five documents (the inventory and the proposals) were drafted by documentation agents from verified facts, then reviewed, corrected and extended with the live results; the sandbox, persistence and live-verification documents were written in the session. Every cited line was checked against the repository.
- The ship flow's GSD gate reports the archived roadmap as incomplete and was waived with `--ignore-gsd`, as for the previous three pull requests.
