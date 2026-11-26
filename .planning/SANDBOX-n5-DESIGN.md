# SANDBOX n5 — Quality, Security, and Verification Design (SPE-38103..38107)

Date: 2026-11-25. Branch: `swarm/Tb559r-fe`. Graph: `ut-4b4c9b9f07` (node n5).
Inputs: n1b trio, n2 `.planning/SANDBOX-n2-UNITS.md`, n3
`.planning/SANDBOX-n3-OPTIONS.md` (Option A selected), n4
`.planning/SANDBOX-n4-SCOPE.md`. Option A: extend in place; Option C rejected.

## 1. Per-unit verification design (n5.2..n5.5)

| Unit | Must always fail on | Failing signature | Gate |
|---|---|---|---|
| U1 Isolation denial | host secret read / out-of-worktree write / denied endpoint reach | `PATH_ESCAPE` / `CREDENTIAL_PATH_DENIED` / egress deny | unit: canonicalize+credentials+egress paths (n2) |
| U2/U3 Lifecycle + limits | budget overrun, illegal transition, timeout | `REALM_NOT_ACTIVE`/`DAEMON_START_TIMEOUT`/`TOOL_TIMEOUT`; distinct Timed-out | `withTimeout` wiring + drive-down edge; `checkTransition` unit |
| U4 Cleanup | crash/orphan sweep | orphan container/record exists post-down | sweep unit; startup reap; `stopSessions` causeCode |
| U5 Observability | secret in log, missing request line | `rcap1.…` hit in `requests.log`; missing `tool.dispatch` | redact unit + log grep shape (`ts, level, event, code`) |

No unit falls back unsandboxed: any isolation-setup error aborts execution.

## 2. Verification gate (n5.6)

Ordered: `npm run typecheck` → `npm run lint` → `npm run build` →
`npm test` (skips allowed only Podman/live-gated, stated) →
`npm run test:scripts` → `npm run check:docs`, `npm run check:gates`,
`npm run check:mcp` — exact commands from SANDBOX-n1b-MANIFEST.md.
Baseline on this tree (2026-11-25): all green except
`npm test 5867 pass / 1 fail / 97 skip` (CAPT-09, dirty docs cause —
committed tree clean; verified 5849 pass at 7ae9afc per pre-existing
record). Any skip must be named; any fail must name the test.

## 3. Guardrails (n5.7)

Small single-purpose units; validate all inputs at trust boundaries
(schema + canonicalization, never pass-through); explicit errors
(`RealmError` 29-code catalogue, never raw runtime text); no empty
catch (QUAL-01 exceptions only); no new dependency without PR
justification/licence/maintenance; scope to touched code + direct
call sites; remove dead code touched; no unsandboxed fallback;
fail closed everywhere.

## 4. Close-out criteria

CONTEXT/PLAN/SUMMARY per phase; STATE/ROADMAP updated per phase;
Linear state moved Done only after verification; Notion mirrors after
verification; milestone audit → complete → cleanup in that order.
Phase = complete ONLY on passing checks above.
