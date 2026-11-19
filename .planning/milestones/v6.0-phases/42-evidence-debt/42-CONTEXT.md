# Phase 42: Evidence debt - Context

**Gathered:** 2026-11-18, from `.planning/MILESTONE-CONTEXT.md` (decision D-v6-6), the v6.0 block of `.planning/REQUIREMENTS.md` (DEBT-01 to DEBT-03), the Phase 42 block of `.planning/ROADMAP.md`, the archived v5.0 records (`.planning/milestones/v5.0-phases/34-capability-tokens-enforce-by-default/34-VERIFICATION.md` and `34-CONTEXT.md` D-34-10; `35-capability-token-evidence/35-VERIFICATION.md`, `35-CONTEXT.md` D-35-02 and `35-01-PLAN.md`; `.planning/milestones/v5.0-MILESTONE-AUDIT.md`), and a read of the code on the branch `gsd/v6-plan` (`.github/workflows/ci.yml`, `package.json`, `scripts/release/changelog.mjs`, `scripts/check/*`, `eslint.config.js`, `AGENTS.md`, `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/integration/capability-token-evidence.md`, `test/docs/capability-token-evidence.test.ts`, `docs/integration/runtime-decision.md`) and of the local git history (the commits of PR 162 and PR 168).
**Status:** Planned (three plans, nothing executed). Requirement ids DEBT-01 to DEBT-03 are already in `.planning/REQUIREMENTS.md`. This phase does not edit ROADMAP, STATE or REQUIREMENTS; the orchestrator registers the results (see "Hand-off to the orchestrator").
**Precondition:** the guard (plan 42-01) and the records (plan 42-02) may be built at any time, earlier than the other v6.0 phases. The whole-suite window (plan 42-03) runs last: Phases 38, 39, 40, 41 and 43 are merged into the commit under test, because the run has to cover the code they change. Where one of them is not merged the window waits, or the owner accepts a run on the current main and the page names the phases it does not cover.

<domain>
## Phase Boundary

Two pieces of evidence debt came out of v5.0 and one record gap goes with them.

- **DEBT-01 (EVID-01 Set B).** Phase 35 ran the capability tests (Set A, 24 compiled test files, 494 tests, twice) as uid 5002 and recorded them in `docs/integration/capability-token-evidence.md`. The whole unit suite (Set B) was never run as a regular user; the page says so in its Not shown section and `35-VERIFICATION.md` lists it under `behavior_unverified` and R3. CI runs the suite as a regular user, but no recorded local run exists. DEBT-01 is that run: `node --test` over `dist/test`, as uid 5002, from a copy of the built tree readable by the account, with the live environment scrubbed, with the totals and every failure written down.
- **DEBT-02 (the breaking-change guard).** The release notes are generated from `git log --no-merges` subjects (`scripts/release/changelog.mjs`). A commit is listed as breaking only when its own subject carries `!`; a pull request that lands as a squash is one entry whose subject is the pull request title. The convention (D-34-10: the commits carry `!`, and the pull request lands as a merge commit, or if squashed with a title of the same form) was only a plan rule. Phase 34's PR 168 (plan 34-03) was squashed with a title that has no marker, and the verifier recorded ENF-04 as met in its intent and partial in its letter. DEBT-02 is a script under `scripts/check`, with tests, that checks a pull request range against that convention.
- **DEBT-03 (closing the ENF-04 partial in the records).** The script is wired into the gate conventions where they allow it, stays report-only where enforcement would need a change under `.github/workflows/**`, and the needed change is written down for human review. The records say precisely what the guard proves and what it cannot.

The phase changes no product behaviour: no file under `src/` changes, no error code (the catalogue stays at 29), no schema key, no default. New files are a script, its test, a decision record and a test-page row; edited files are the documents that describe the gates and the merge flow, `package.json` (one script entry) and, if the whole-suite run exposes one, test files that only worked as root.

### What this phase must not claim (read this before the rest)

1. **The guard does not detect a breaking change.** It cannot read intent from a diff. A pull request none of whose commits, whose body or whose declaration says "breaking" is not breaking as far as the guard can tell. PR 168 is the example: its three commits (`feat(capability): ...`, `fix(test): ...`, `fix(test): ...`) carried no marker, and neither did its title. The guard's replay of that range finds no signal and passes (plan 42-02 records the observed result). What the guard closes is the gap between a declared breaking change and its markers: a marked or declared change whose title or commits lose the marker at the merge. The new pull request template line (D-42-03) is the human declaration that gives the guard something to check; ticking it is a person's step.
2. **The guard checks the inputs of the merge, not the merge.** The merge method is chosen by the ship flow from the Ultrathink user configuration, which is not in this repository. GitHub can also pre-fill a squash title from the single commit's subject instead of the pull request title, and the committer can edit it at the merge box. The guard proves "the title and commit subjects offered satisfy the convention"; it does not prove that the commit that reached `main` has the marker. The ship flow must squash with the pull request title; that part stays a process rule.
3. **Report-only is not enforcement.** Locally, and in the repository's existing CI as it stands, the guard reports and exits 0. Where it is run with `--enforce` (by the ship flow, or by a CI step the owner approves) it fails. A CI step needs history that the current `verify` job does not fetch (E-42-02), so enforcement in CI needs a workflow change, and `main` has no branch protection, so even a red check is read by the ship flow, not enforced by GitHub.
4. **The history stays as it was.** The 0.5.x release notes are published and `CHANGELOG.md` is release-owned; PR 168's entry is not rewritten. The record says the partial is closed for new pull requests and open as a historical fact (OQ-42-06).
5. **A skipped test is `not-run`, never a pass** (the rule of D-35-01 carries over to the whole-suite record). A run that was root, or that had a live gate variable set, is invalid.

### Out of scope

Semantic detection of breaking changes (diffing contract files); a required status check or branch protection (TD-10 repository settings, out of scope for v6.0); changing the release job, `scripts/release/changelog.mjs` or any file under `.github/workflows/**` (human review); rewriting a published changelog; a second Node version for the whole-suite run (CI covers 22.x and 24.x as a regular user; only the Node on this machine runs); a live production-stack run (the whole-suite window starts no stack and uses no credential); Phases 38 to 41 and 43 content.
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below: source, read date 2026-11-18, tier)

Tiers: **Observed** (a read-only command or file read in this planning session), **From code** (read in the named file), **From record** (a planning or docs file). No test, build or live run was started while planning.

- **E-42-01 (From record).** The Set A record: 24 compiled test files, two runs, 494 tests each, 494 passed, 0 failed, 0 skipped, uid 5002, `ptrace_scope` 1, commit 7c44538, Node v24.18.0, Linux 6.8.0-149-generic, 2026-11-18 (`docs/integration/capability-token-evidence.md`, section EVID-01). Its Not shown bullet reads "The whole unit suite (Set B) as the same user: not run in the window". `docs/integration/runtime-decision.md` D35-1 says the same in one sentence. The account `realmlive` is uid 5002 with no supplementary groups; its home directory is mode 750; the harness account is root and its home is mode 701, so a test run as the account needs a copy of the built tree owned by the account (the pattern of `35-01-PLAN.md` Task 3: tar the checkout without `.git` and without `node_modules`, copy `node_modules` beside it, chown the result).
- **E-42-02 (From code).** `.github/workflows/ci.yml` runs on `push` to main, `pull_request` into main and `workflow_dispatch`. The pull request event uses the default activity types (opened, synchronize, reopened): editing a pull request title does not start a run. The `verify` job (Node 22.x and 24.x) checks out with `actions/checkout` and no `fetch-depth`, so the history is one commit deep (for a pull request, the merge commit of the head into the base); the base and the head commits are not present. Its steps include `npm run test:scripts` (which runs `node --test "scripts/**/*.test.mjs"`) and `npm run check:docs` and `npm run check:gates`. `persist-credentials: false` is set on the checkouts, so a step cannot fetch with credentials; a fetch of a public repository would work unauthenticated but is a network call inside a gate (see D-42-04). The job `permissions` are `contents: read`. Third-party actions are pinned by commit SHA with a version comment; the checkout pin is `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1` and the Node pin is `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`.
- **E-42-03 (From code).** `scripts/release/changelog.mjs`: `CONVENTIONAL_HEADER = /^([a-z]+)(?:\(([^)]*)\))?(!)?:/`; the commit list is `git log --no-merges` over the range since the previous tag, with the format subject and body; an entry is `- SUBJECT (SHA)`; commits scoped `planning` are left out unless the subject carries `!`; the body is read only for `This reverts commit` and `Removes:` trailers. **A `BREAKING CHANGE:` footer in a body has no effect on the notes.** The module does not export the header pattern. Files under `scripts/release/**` need human review to change, so the guard keeps its own copy of the pattern and a parity test pins it to the generator's behaviour (D-42-02).
- **E-42-04 (Observed).** In the local history: PR 162 is the merge commit 4ce8462 with parents 5baf9ae (main before) and df6ecec (the pull request head); the range 5baf9ae..df6ecec holds the flip commit 2637d9a, `feat(capability)!: enforce capability tokens by default; ...`, and the test-only df6ecec, `fix(test): drop the redundant nullish fallback`, with no marker. PR 168 is the single-parent squash commit e4f7bea whose parent is ad10c08 (the v0.5.4 release commit); its subject is `feat(capability): per-client enforce proofs, refusal hint, labelled launchers, migration docs (34-03) (#168)` and its body lists three commit subjects: `feat(capability): per-client enforce proofs, stderr refusal hint, labelled launchers, migration docs (34-03)`, `fix(test): drop optional chains on a narrowed element`, `fix(test): correct the index access syntax`. **None of the three carries `!`**, although D-34-10 said every commit of plans 34-02 and 34-03 would. So the PR 168 defect was a missing marker on the commits and on the squash title.
- **E-42-05 (From code).** `AGENTS.md` and `CONTRIBUTING.md` say how the merge method decides the release notes (Merge and release flow step 5; CONTRIBUTING Branches and pull requests step 5 and Commit messages) and that `!` keeps a planning-scoped commit in the notes. Neither states the rule that a breaking change carries `!` in its commit subjects and in a squash title; that rule was only in `34-CONTEXT.md` D-34-10. `.github/PULL_REQUEST_TEMPLATE.md` has no breaking-change line. The Commands list of `AGENTS.md` and the table of `CONTRIBUTING.md` list the `npm run check:*` scripts; no test pins that list to `package.json`.
- **E-42-06 (From code).** `package.json` scripts: `check:docs` is `host-paths.mjs && agents-sync.mjs && default-mode.mjs`; `check:gates` is `gate-closure.mjs && module-size.mjs && export-usage-gate.mjs && lockfile-integrity.mjs`; `test:scripts` is `node --test "scripts/**/*.test.mjs"`. The module-size ratchet, the export-usage gate and the gate-closure check analyse `src/**/*.ts` only, so a new file under `scripts/` is outside all three; `check:docs` reads documents (`host-paths.mjs` scans `.md`, `.json`, `.yml`, `.xml`, `.txt`, `.svg` under `docs`, `.planning`, `.github` and the root documents; `agents-sync.mjs` requires the Commands, Versioning and release and Merge and release flow headings once each in `AGENTS.md`; `default-mode.mjs` reads the prose).
- **E-42-07 (From code).** `eslint.config.js` lints `scripts/**/*.mjs` with the untyped preset and declares only `console` and `process` as globals: a script that uses `Buffer`, `URL` or a timer imports it from a `node:` module. Existing check scripts and tests follow one shape: a `main()` returning an exit code, an entry guard comparing `process.argv[1]` with the module URL, injected inputs for tests, temp fixtures built with `mkdtemp` (`gate-closure.test.mjs`, `host-paths.test.mjs`) or temp git repositories with an explicit identity through `-c user.name=... -c user.email=... -c commit.gpgsign=false` (`scripts/release/changelog.test.mjs`).
- **E-42-08 (Observed).** `find test -name "*.test.ts"` lists 266 files on this branch. Test files that read the uid or reason about root (the likely differences between a root run and a uid 5002 run): `test/cli/init.test.ts`, `test/doctor/fix.test.ts`, `test/doctor/runtime-root-checks.test.ts`, `test/doctor/capability-checks.test.ts`, `test/fs/temp-sweep.test.ts`, `test/fs/atomic-write-sigkill.test.ts`, `test/observe/log-file.test.ts`, `test/cli/audit.test.ts`, `test/cli/cli.test.ts`, `test/daemon/channel.test.ts`, `test/runtime/driver/seccomp-delivery.test.ts`, `test/capability/keyring.test.ts`. The docs tests `test/docs/host-docs.test.ts` and `test/docs/host-gaps.test.ts` read `.planning/` when it is present and skip with a diagnostic when it is archived, so the copy for the window carries `.planning/`. Live and integration files are gated by `REALM_LIVE_*` variables and skip without them; the scrubbed environment keeps them skipped. [INFERENCE] which of these differ as non-root is not known until the run.
- **E-42-09 (From record).** The live-window rules of the earlier windows (Phase 31, 35): the owner opens the window and names the runner, one live run at a time under the shared live lock because the startup reap is account-wide, a before and after snapshot (containers, sandboxes, state-root entries, the account's node processes, hashes of the real host files and `policy.json`), a stop rule, evidence outside the repository, no push or merge from a window. The owner's authorization of 2026-11-18 for live windows in this milestone covers the window of plan 42-03; it starts no stack and uses no credential.

### D-42-01. The guard's contract (plan 42-01)

`scripts/check/breaking-change-guard.mjs` reads a pull request (title, body, base, head) and the commits of the range, and reports findings. It is the one place that says what "breaking by the repository's own rules" means.

**Signals.** A pull request is breaking when at least one holds, and the report names which:

1. **commit-marker:** a non-merge commit in the range whose subject matches the header pattern with `!` (the same test the changelog uses).
2. **commit-footer:** a non-merge commit whose body has a line that starts with `BREAKING CHANGE: ` or `BREAKING-CHANGE: ` followed by text (the Conventional Commits footer; line start only, so a sentence that merely mentions the words is not a footer).
3. **body-footer:** the pull request body has such a line.
4. **declared:** the pull request body has the checked line of the template: a list item with `[x]` or `[X]` followed by `Breaking change` (D-42-03).

**Landing.** `merge` (each non-merge commit becomes a note), `squash` (the pull request title becomes the one note), or `unknown` (the default; the ship flow decides later). It is given by `--merge-method` or by the `merge_method` member of the flat JSON; the guard never reads the repository settings.

**Rules** (only when a signal is present; a range with no signal has nothing to check and reports `ok`):

| Landing | Rule | Finding code |
| --- | --- | --- |
| merge | at least one commit subject carries `!`, and every commit that has a footer also carries `!` | `commit-unmarked` |
| squash | the pull request title matches the header pattern with `!` | `title-unmarked` |
| unknown | both rows above | `commit-unmarked`, `title-unmarked` |

When the title is needed (squash, unknown) and not supplied: `title-not-supplied`. When the range cannot be computed (a base or head that does not resolve, a shallow checkout without the commits, an empty ref): `range-unavailable`. These two are **unproven** findings, the others are **violations**. Report-only mode prints all findings and exits 0; `--enforce` (or `REALM_BREAKING_GUARD=enforce`) exits 1 on any violation or unproven finding (fail closed: a guard that could not look does not pass). A usage or input error (an unknown flag, an invalid merge method, a ref that starts with `-`, a PR JSON that does not parse) exits 2 in both modes. `--no-merges` is used for the log, as the changelog does, so a merge of main into the branch contributes no commit.

**Why unknown requires both.** In `unknown` a title without the marker is a violation even if the pull request will in the end land as a merge commit, where the title never reaches the notes. A title with `!` is correct in both worlds and costs one character; the strict reading removes the need to know the merge method in CI. A person who knows the method says so with `--merge-method merge`.

**Inputs.** Precedence: flags, then `REALM_PR_JSON` (a JSON text in the environment), then, when `GITHUB_EVENT_NAME` is `pull_request`, the file named by `GITHUB_EVENT_PATH`. Two JSON shapes are read: the GitHub event (`pull_request.title`, `pull_request.body`, `pull_request.base.sha`, `pull_request.head.sha`) and a flat object (`title`, `body`, `base`, `head`, `merge_method`). A flag overrides a field. With no base and no head from any source, the range is `origin/main..HEAD`. The JSON is capped at 1 MiB. The script reads the environment only in its entry function and passes values down; the git calls use `execFileSync` with an argument array and a timeout (no shell).

**Output.** One header line `breaking-change guard: RESULT (mode MODE, landing LANDING, range BASE..HEAD, N commits, B breaking)`, then the signals, then one line per finding. Every untrusted string (a title, a subject, a ref) is printed as a JSON string literal truncated to 200 characters, so it cannot start a line, and a title that contains a newline followed by two colons cannot inject a workflow command into a CI log. The result word is `ok`, `violations`, or `unproven`.

### D-42-02. The header pattern is copied and pinned, not imported

`scripts/release/changelog.mjs` does not export `CONVENTIONAL_HEADER`, and changing `scripts/release/**` needs human review. The guard keeps its own constant, identical in text, and a parity test builds a temporary repository with `chore(planning)!: ...` and `chore(planning): ...` (and `docs`) commits, runs `generateChangelog`, and asserts that the guard's marker decision for each subject equals whether the generator kept the planning-scoped commit. The test fails if the generator's rule changes and the copy does not. The test imports the generator; it does not edit it.

### D-42-03. The pull request template declaration

`.github/PULL_REQUEST_TEMPLATE.md` gets one checklist line: `- [ ] Breaking change: a documented contract, default, wire shape or schema changes incompatibly. The pull request title and the breaking commits carry the ! marker (AGENTS.md, Merge and release flow).` The unticked line is no signal; the ticked line is the `declared` signal. This is the only way the guard learns of a breaking change that nobody marked, and it depends on the author. The template is not under `.github/workflows/**`, so it does not need the workflow review, but the owner sees it in the diff.

### D-42-04. Wiring: a script and documentation now, CI only on the owner's word

Wired now, inside the gate conventions and without a workflow change: `package.json` gets `check:breaking` (`node scripts/check/breaking-change-guard.mjs`; arguments after `--`), `AGENTS.md` (Commands, Conventions, Merge and release flow step 5), `CONTRIBUTING.md` (table row, Commit messages) and the pull request template describe it, and `npm run test:scripts`, which CI already runs on Node 22.x and 24.x, runs its tests. It is **not** added to `check:gates` or `check:docs`: those run in CI with a one-commit history and no pull request context, so a guard inside them would either always report "range unavailable" and exit 0 (a gate that proves nothing) or fail every run. The ship flow, which reads the merge method, runs `node scripts/check/breaking-change-guard.mjs --enforce --base BASE --head HEAD --title TITLE --merge-method METHOD` before the merge; that is outside this repository and is handed to the owner (plan 42-02).

CI enforcement needs two things the workflow does not do today: the base and the head commits (`fetch-depth: 0`, or a fetch step) and a run when the title is edited (the activity type `edited`). Both are changes under `.github/workflows/**`. Plan 42-02 writes the exact change as a proposal and stops for the owner (a checkpoint, not a task an agent performs). Two shapes are proposed: a new small workflow file (recommended: a title edit re-runs only the guard, not the 30-minute verify matrix), or a step and an activity type in `ci.yml`. The pull request title and body reach the script through the event file, never through an expression in a shell command (script injection through a title).

### D-42-05. DEBT-01: the whole-suite window (plan 42-03)

**Set B.** `node --test --test-reporter=tap "dist/test/**/*.test.js"` as uid 5002, with the concurrency that `npm test` uses (the Node default), from a copy of the built tree owned by the account that carries `.planning/`, with `env -i` and exactly HOME, TMPDIR, PATH set, no `REALM_` variable, no `XDG_` variable. **HOME is a fresh empty directory owned by the account, not the account's real home** (a deliberate difference from the Set A window): the account owns the production stack, a hermetic test that wrote under the real home could touch it, and a suite that is hermetic passes with an empty home. The page records the difference. Before the run: the host facts (kernel, `ptrace_scope`, uid and gid, Node, git version, `nproc`, load), the before snapshot, the lock. One run. If it has failures, each failing file is rerun alone with `--test-concurrency=1` (diagnostic only, to separate load interference from a deterministic failure), and the table says which.

**Set C (recorded, not gating).** `node --test "scripts/**/*.test.mjs"` as the same user, same environment: the script tests include the new guard tests and must pass as a regular user (the suite's own rule). A failure is triaged like a Set B failure. It is not part of the DEBT-01 statement ("the whole unit suite").

**Triage.** Each failure is classified once, with the test file and the first assertion message: (a) a fixture or assumption that only works as root (a uid constant, an owner, a mode, an unreadable path, a hard-coded home): fixed in that test file keeping the assertion's meaning, and the window repeated; (b) an environment cause for this account (the socket path limit of 108 bytes, a missing system tool, a read-only HOME): fixed in the test if the test is wrong to assume it, otherwise recorded as a finding with the cause; (c) a product failure: not patched here, recorded with the catalogue code and the owning phase and reported to the owner; (d) a failure that passes alone and fails under load: recorded as a load finding with the test name. A finding is never hidden by a skip or by weakening an assertion.

**What "recorded" means.** The page row for the final run carries the commit, the Node version, uid and gid, the totals (tests, suites, pass, fail, cancelled, skipped, todo), the skip count with reasons grouped (a gate variable not set, a platform, a tool absent), and the status: `recorded` when the final run has zero failures, `failed` when it has a failure of kind (c) (named, with its owner), `partial` when it ran but a failure of kind (b) or (d) is carried with a named reason. DEBT-01 is met when the row is written with every failure as a finding, whichever status it has.

**The page.** `docs/integration/capability-token-evidence.md` gets a Set B row in the EVID-01 table and a paragraph under it; its Not shown bullet about Set B is replaced by the recorded result. The page test is extended only if its rules need it (the executor reads it first).

### D-42-06. The records (plan 42-02)

A section "Evidence debt (Phase 42, DATE)" is appended at the end of `docs/integration/runtime-decision.md` as record **D42-1**: what the guard checks (signals, landings, rules), what it proves and what it cannot (the five items of "What this phase must not claim"), its wiring and the CI state (report-only; the proposal and the owner's answer), the replay results (Observed) and, after plan 42-03, the DEBT-01 result. `AGENTS.md` and `CONTRIBUTING.md` (plan 42-01) carry the how-to; the decision record carries the why and the limits. No new document file (no site navigation change).

### D-42-07. Hygiene constraints for every plan

- `AGENTS.md` applies: strict TypeScript where TypeScript is touched (only a root-only test fixture fix could), a timeout on every async boundary (the script's `execFileSync` calls have a timeout), no silent catch, no suppression comments (a lint complaint is fixed in the code), no new dependency (Node built-ins only, as the other check scripts), no host-local absolute path in any committed file.
- Lint traps for any test file touched: no unnecessary conditions after an assertion narrows, `restrict-template-expressions` (convert numbers with `String(...)`), `no-base-to-string`, `prefer-const`, `void test(...)` in `.ts` tests. The new `.mjs` files use only the `console` and `process` globals and import the rest.
- Tests assert observable behaviour (exit code, printed lines), no source-text tests, and pass as a regular non-root user with no dependency on a git identity, a global git config or a home directory (every git call in a test sets the identity with `-c` and runs with `GIT_CONFIG_GLOBAL` pointing at the null device and `GIT_CONFIG_NOSYSTEM=1`).
- The default-mode docs guard (`scripts/check/default-mode.mjs`) reads the prose of every edited page: no sentence may say advisory is the default (the default of capability tokens is `enforce`).
- Markdown written for this phase: no raw angle tokens outside code fences (write `&lt;..&gt;`), no host-local absolute paths.
- Gates the parent runs after each plan lands: `npm run typecheck`, `npx eslint .`, `npm run build`, `npm test`, `npm run test:scripts`, `npm run check:docs`, `npm run check:gates`, `node scripts/check/host-paths.mjs`.

### Open questions (defaults taken; none blocks planning)

- **OQ-42-01.** Should `unknown` require the title marker (the strict default of D-42-01)? Default: yes. If the owner prefers a different default the change is the one constant in the script and one test row.
- **OQ-42-02.** CI wiring: option A (a new workflow file), option B (a step and the activity type in `ci.yml`) or option C (none; the ship flow runs the command)? Default: the plan stops at the owner's answer; with no answer the guard stays report-only and the proposal is the record (DEBT-03's second branch).
- **OQ-42-03.** Is the checked template line an acceptable declaration, and is the wording of D-42-03 right? Default: yes.
- **OQ-42-04.** Does the ship flow run the guard with `--enforce` before the merge? That is a user-configuration change outside the repository; the owner is told the exact command and decides. Default: recorded as a hand-off, not assumed.
- **OQ-42-05.** The window date and the person who runs it, and whether Set C runs. Default: the owner opens the window and names the runner at the first checkpoint of plan 42-03; Set C runs.
- **OQ-42-06.** Should a follow-up marked commit or a changelog note be added for PR 168's unlisted changes (`34-VERIFICATION.md` R1)? Default: no. The 0.5.x notes are published, `CHANGELOG.md` is release-owned, and a follow-up commit would only add a misleading entry in a later release. The record states the partial as a closed process gap and an open historical fact.
- **OQ-42-07.** If the whole-suite run exposes a product failure, who owns it? Default: reported to the owner with the catalogue code and the phase that owns the behaviour; not patched in this phase.

## Requirement coverage

| Requirement | Plan | Result form |
| --- | --- | --- |
| DEBT-01 whole unit suite as uid 5002 recorded | 42-03 | page row, counts, skips, findings; D42-1 sentence |
| DEBT-02 script under `scripts/check` with tests, reporting a breaking range whose marker is missing unless it lands as a merge commit; wired into the gate conventions | 42-01 | the script, its tests (seeded breaking commit without the marker fails; marker present or merge landing passes), `check:breaking`, the documents |
| DEBT-03 enforcing where the conventions allow, report-only where a workflow change is needed, the change written down; the ENF-04 partial closed in the records | 42-02 | the proposal, the owner's answer, the replay, D42-1, the hand-off for the traceability row |
</decisions>

<specifics>
## Success Criteria (from the roadmap, made observable)

1. The whole unit suite ran as uid 5002 from a copy of the built tree, with the live environment scrubbed, on a recorded host; the page holds the pass and fail counts, the skip count and its reasons, the host facts, and every failure as a finding.
2. `node --test scripts/check/breaking-change-guard.test.mjs` fails on a seeded breaking commit without the marker (under enforce, with merge, squash and unknown landings as the rules state) and passes when the marker is present or the range lands as a merge commit; the parity test ties the header pattern to the changelog generator.
3. `npm run check:breaking` exists and is documented in `AGENTS.md` and `CONTRIBUTING.md`; the template carries the declaration line; the proposal for CI enforcement is written, with the exact change and the owner's answer recorded; the guard is report-only in CI unless the owner applied the change.
4. `npm run check:docs` and `npm run check:gates` exit 0 with the new script present.
5. D42-1 states what the guard proves and what it cannot; the ENF-04 partial is closed as a process gap and carried as a historical fact.
6. No file under `src/` changed in this phase, no file under `.github/workflows/**` was changed by an agent.

## Threats (summarised; each plan carries its own register)

| Threat | Mitigation |
| --- | --- |
| The guard is read as proof that a change is not breaking | the five-item limits list in this file, D42-1, the AGENTS.md sentence; the replay of PR 168 is recorded as a pass with no signal |
| A pull request title injects a workflow command into a CI log or a shell | untrusted strings printed as JSON literals, no shell, event file instead of expression interpolation in the proposal |
| The copied header pattern drifts from the changelog | the parity test over the generator |
| The guard silently does nothing in CI (shallow history) | `range-unavailable` is an unproven finding that fails under `--enforce`; it is not wired into `check:gates`, where it would always be unproven |
| The whole-suite run was root or had a live gate open | `id` printed at the start, `env -i`, no `REALM_` variable; a skip caused by root invalidates the run |
| The whole-suite run touches the production stack of the account | the lock, a scratch HOME, before and after snapshots, the stop rule |
| A root-only fixture is hidden by weakening its assertion | the triage rule keeps the assertion's meaning; the parent reviews the diff of every fixed test file |

## Plan map

| Plan | Wave | Depends on | Content |
| --- | --- | --- | --- |
| 42-01 | 1 | none (may land before Phases 38 to 41 and 43) | The guard script, its tests with the parity test, `check:breaking`, the documents and the template line |
| 42-02 | 2 | 42-01 | Replay on recorded history, the CI proposal and the owner's stop, D42-1 and the ENF-04 closure record |
| 42-03 | 3 | 42-02; external gate: Phases 38 to 41 and 43 merged | The whole-suite window as uid 5002 (blocking human), the page row, the triage and the DEBT-01 record |

## Hand-off to the orchestrator

This phase does not edit `.planning/ROADMAP.md`, `.planning/STATE.md` or `.planning/REQUIREMENTS.md`. When the plans are executed, the orchestrator registers: DEBT-01 to DEBT-03 as satisfied (DEBT-03 in the form recorded by plan 42-02), the traceability row of ENF-04 in the archived v5.0 requirements read as "Complete; the partial closed as a process gap by Phase 42, historical entry unchanged", and a Phase 42 verification record. It also tells the owner the exact ship-flow command (OQ-42-04) and the open CI proposal if it was not applied.
</specifics>

<deferred>
## Deferred Ideas

- Running the guard in the release job against the range since the previous tag (a post-merge check of the landed notes): a change under `.github/workflows/**` and `scripts/release/**`, human review.
- Detecting a breaking change from a diff of the frozen contract files (the host-id list, the policy schema, the error catalogue, the control wire): a semantic gate with its own false-positive cost; the declaration line is the cheap stand-in.
- A required status check or branch protection so that GitHub enforces the guard (TD-10 settings, out of scope).
- A Node 22.x run of the whole-suite record: CI covers it as a regular user.
- Pairing a revert with the breaking commit it undoes, as the changelog does: the guard stays strict, and a revert pair in a range needs the marker anyway.
</deferred>
