# SANDBOX n4 — Scope and Ambiguity Ledger (SPE-38094..38100)

Date: 2026-11-25. Branch: `swarm/Tb559r-fe`. Graph: `ut-4b4c9b9f07` (node n4).
Sole inputs: n1b trio (`.planning/SANDBOX-n1b-MANIFEST.md`,
`.planning/SANDBOX-n1b-ISOLATION.md`, `.planning/SANDBOX-n1b-LIFECYCLE.md`),
n2 `.planning/SANDBOX-n2-UNITS.md`, n3 `.planning/SANDBOX-n3-OPTIONS.md`.
Trigger payload SETTLED: edits + argv commands (`src/contract/tools.schema.json`
argv/shell split; `SHELL_NOT_ALLOWED` when `shellEnabled=false`).

## 1. Repo-verifiable unknowns → answered from disk (n4.1)

| Question | Answer (evidence) |
|---|---|
| Language/runtime/structure | TypeScript ESM, Node >=22.13.0, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (n1b MANIFEST) |
| Sandbox entry point | Daemon `main.ts` boot; `up` is idempotent, sandbox must be `down`-ed; no `agentos` host binary (n1b ISOLATION) |
| Isolation mechanism | Rootless Podman container + OpenShell gateway on host, AgentOS runner in-sandbox (`runtime-decision.md`, n1b ISOLATION §1) |
| Threat model | Deny-by-default filesystem roots; credential-path denial; payload validated at schema layer then workspace-canonicalized |
| Allowlist location | Policy file `policy.schema.json` + fs canonicalize/credentials (n1b ISOLATION) |
| Verification commands | `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:scripts` (MANIFEST, CI verify job verbatim) |
| U-file sets | n2 §B/U1-U5 (session-execution.ts, daemon.ts, timeout.ts single-owner; overlap resolved) |

## 2. Genuine user decisions (n4.2/n4.3)

| # | Decision | Recommended default | Consequence of alternative |
|---|---|---|---|
| D1 | Allowlist widening | NO — keep deny-by-default, existing allowlist | Widening is a security decision; must be explicit + SUMMARY-recorded |
| D2 | New runtime/dependency | NO — extend in place (Option A) | Violates continuation/quality constraints; escalate as blocker |
| D3 | Public interface change beyond phase plan | NO | Interface changes are breaking; gated by check:breaking green |
| D4 | Linear/Notion sync direction | Verified local state wins; sync queued as pending/failed on unavailability | Never reported as synced when not synced |

## 3. Grey areas for n5 (n4.5)

Allowlist widening, new runtime/dependency, public-interface change,
sandbox-escape acceptance — all require explicit user approval.
Default: deny; fail closed; no unsandboxed fallback ever.

## 4. Coding gate (n4.7)

Before code: cat `.planning/STATE.md` + `.planning/ROADMAP.md`; grep
sandbox entry points, state definitions (`STATES`, `checkTransition`),
limit/allowlist locations, logging surfaces; run the MANIFEST commands;
grep logs for `rcap1` shape. Owner questions may be asked via the
ask tool only; otherwise proceed.

## 5. Defaults matrix → states (n4.6, n6.6-pre)

| Default | Effect |
|---|---|
| Skills unavailable → direct execution | Record substitution in phase artifacts |
| Linear/Notion unavailable | Local work continues; sync = pending/failed with error |
| Verification unrunnable | Phase = blocked (not complete) with exact failure output |
| Roadmap/state corrupt | Stop, surface blocker, never invent phases |

Counts: repo-answerable 7 groups; user-decisions 4; security grey areas 4.
Owner decisions needed before implementation wave: D1 (allowlist) only if
asked to widen — none asked here.
