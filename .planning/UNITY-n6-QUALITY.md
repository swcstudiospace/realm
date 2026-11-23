# UNITY n6 — Quality and Pattern Baseline (SPE-37103..37108)

Date: 2026-11-23. Branch: `swarm/Tb559r-fe`. HEAD: `4f379da`.
Graph: `ut-aec293bb48` (node n6).
tests, no gates. Sole fact base: n1 `.planning/UNITY-n1-GROUND-TRUTH.md`,
n2 `.planning/UNITY-n2-DECOMPOSITION.md` (with n3/n4 where cited).
Status: provisioning design (§5) is conditional on owner gates A1
(topology) and A3 (Hosted-vs-Library), n4 §8 L137-141 — marked
`[PENDING A1]` / `[PENDING A3]`; nothing below presents a pending
gate as decided. Steps: n6.1 §1, n6.2 §2, n6.3 §3, n6.4 §4,
n6.5 §5, n6.6 §6.

## 1. Anchor (n6.1 / SPE-37103)

Verified layout (n1 §1 L16-22): `src/` (acp, audit, capability, cli,
contract, core, daemon, doctor, fs, host, lifecycle, mcp, observe, omp,
realm, runtime, session, tools), `test/`, `scripts/`, `docs/`,
`adapters/` (5), `sandbox/`, `release/`, `site/`, `assets/`,
`licenses/`; remote `https://github.com/swcstudiospace/realm.git`
(n1 §1 L22).

| Item | Verified value | Source |
|------|---------------|--------|
| Node | `>=22.13.0`; observed v24.18.0 | `package.json` L49-51; n1 §2 L47-48 |
| TS | strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals` | n1 §2 L41-42; AGENTS.md L97 |
| ESLint | 10.13.0, typescript-eslint strictTypeChecked | n1 §2 L42-43; `package.json` L74-77 |
| Tests | `node --test` over `dist/test/**`; fast-check 4.10.2 | n1 §2 L43-44; `package.json` L55, L75 |
| CI | matrix 22.x + 24.x; `npm ci`, typecheck, lint, test, test:coverage, test:integration, test:scripts, check:docs, check:gates, build, check:pack, check:mcp + site/audit jobs | n1 §2 L44-47; AGENTS.md L28, L147 |
| Install | npm + `package-lock.json` only; `npm ci` | AGENTS.md L30; n1 §2 L44 |
| Lint arch rules | `child_process` allowlist (6 modules, named static import only; no `import()`, `require()`, re-export, `shell:true`); `spawn(` allowlist (4 modules); D-99 guard-owner + D-88 file-function rules; `OPENSHELL_BINARY` containment | `eslint.config.js` L9-22, L35-48, L54-86 |
| `check:gates` | gate-closure (TOOL-02 import closure) + module-size ratchet (1000-line ceiling, allowlist) + export-usage gate + lockfile-integrity | `package.json` L65; AGENTS.md L48, L105, L52 |
| Suppressions | banned: `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` — fix the cause | AGENTS.md L104 |
| Errors | `RealmError` catalogue, exactly 29 codes in `src/core/errors.ts` L9-39 (frozen; `causeCode` also catalogue-only; raw runtime text never enters) | AGENTS.md L99; `src/core/errors.ts` L1-7 |
| Timeouts | every async boundary via `withTimeout(work, ms, code)` | AGENTS.md L100; `src/core/timeout.ts` L8 |
| No-new-dep rule | justification + licence + maintenance check in PR; scripts = Node built-ins only (2 typescript exceptions) | AGENTS.md L106, L83 |

Measured baseline, restated (n1 §2 L50-60): on the dirty tree 2026-11-23,
typecheck exit 0, lint exit 0, build exit 0, test **5867 pass / 1 fail /
97 skip** (5965 tests), test:scripts 538 pass. **This baseline is
dirty-tree-contaminated by 1**: the single failure is CAPT-09
(`dist/test/docs/capability-token-doc.test.js:190`, matching `/\/root\//`),
root-caused to absolute `/root/src/repos/claude-ultrathink` strings in
UNCOMMITTED docs (`docs/requirements/spec.md`,
`docs/architecture/blueprint.md` diffs); committed tree has none
(prior re-verify b7002a5: 5849 pass at 7ae9afc). The 97 skips are
Podman-gated/live (n1 §2 L60). A clean re-measure after S1 (n2 L46)
is the precondition for any green claim.

No best-in-class claim is made: no external benchmark was run or cited.

Toolchain — Exists (verified): Node 22/24, tsc, eslint 10.13.0,
typescript-eslint, `node --test`, fast-check 4.10.2, npm + lockfile,
Podman 4.9.3/5.7.1 + openshell 0.1.5 (n1 §5 L112-115), `gh` (release
flow, AGENTS.md L134). Toolchain — Absent / not verified: `yq`/`jq`
as repo tooling (only `gh --jq` fakes in script tests; no repo
script invokes them), Stryker (expressly not installed, AGENTS.md
L42), Bun (unverified, AGENTS.md L22), macOS/Windows verification
(out of scope, AGENTS.md L22).

## 2. Audit checklist (n6.2 / SPE-37104)

Audit scope boundary (touched-code only): this audit covers files
changed by the Unity work (U1..U12 scope, n2 §B L66-126) plus their
direct call sites. It is NOT a repo-wide rewrite; pre-existing
violations outside touched code are filed as SUB-ISSUEs, never fixed
inline. Each row: criterion → repo rule → observable verification →
disposition.

| # | Criterion | Repo rule | Observable verification | Disposition |
|---|-----------|-----------|------------------------|-------------|
| Q1 | Structure / module size | Ratchet: >1000 lines fails unless allowlisted (AGENTS.md L105) | `npm run check:gates` (module-size.mjs) | IN-SCOPE-REMEDIATION → U4 (new provisioning module must ship under ceiling) |
| Q2 | Structure / export hygiene | Fail on self-only/test-only exports unless allowlisted (AGENTS.md L48, L52) | `npm run check:gates` (export-usage-gate.mjs) | IN-SCOPE-REMEDIATION → U4, U6 |
| Q3 | Naming / conventions | Conventional Commit subjects; breaking `!` marker (AGENTS.md L107-108) | `npm run check:breaking -- --enforce` | IN-SCOPE-REMEDIATION → U2, U12 |
| Q4 | Error handling | 29-code catalogue only; no raw runtime text (AGENTS.md L99; `errors.ts` L1-7) | `npm run typecheck` + grep: no `throw new Error` in touched `src/` | IN-SCOPE-REMEDIATION → U4..U8 (new codes only via catalogue) |
| Q5 | Testing | `node:test`, observable behaviour, no source-text tests (AGENTS.md L98) | `npm test` + grep for source-text asserts in new tests | IN-SCOPE-REMEDIATION → U5, U6, U8 |
| Q6 | Dependency hygiene | No new dep without justification/licence/maintenance (AGENTS.md L106); lockfile integrity (AGENTS.md L48) | `npm run check:gates`; `npm audit --omit=dev --audit-level=high` (AGENTS.md L53) | IN-SCOPE-REMEDIATION → U12 |
| Q7 | Configuration | `process.env` only at 4 entry edges; others take env as argument (AGENTS.md L102) | grep `process.env` in touched `src/` = only allowlisted edges | IN-SCOPE-REMEDIATION → U4, U7 |
| Q8 | Suppressions / silent catch | No suppression comments (AGENTS.md L104); no empty catch (AGENTS.md L101; QUAL-01 exceptions only) | `npm run lint` | IN-SCOPE-REMEDIATION → all touched units |
| Q9 | Host paths in docs | No host-local absolute paths in committed files (AGENTS.md L109) | `npm run check:docs` (this is the CAPT-09 gate) | SUB-ISSUE-A9 (n4 L155): hygiene of uncommitted docs, S1 |
| Q10 | Coverage floors | `src/fs`, `src/core`, `src/tools` floors; unloaded sources fail (AGENTS.md L43) | `npm run test:coverage` | IN-SCOPE-REMEDIATION → U5, U8 |

Finding dispositions: 10 rows = **9 IN-SCOPE-REMEDIATION** (Q1, Q2, Q3,
Q4, Q5, Q6, Q7, Q8, Q10) + **1 SUB-ISSUE** (Q9 = SUB-ISSUE-A9, n4 L155,
maps to n2 S1 L46). Zero unbounded rewrites authorized.

## 3. Logging and errors (n6.3 / SPE-37105)

Rules (AGENTS.md L99-101; `src/observe/logger.ts` L1-4): leveled
JSON-line logs, first keys `ts, level, event`, then `code`; every
string/secret-looking key redacted via `src/audit/redact.ts`
L16-29 (token/secret/password/api-key/credential patterns +
`rcap1` shape); logger methods never throw.

| Case | Detection | Expected distinct error | Verify by |
|------|-----------|------------------------|-----------|
| Unbound (no realm) | `REALM_UNBOUND` vs `conn refused` | `REALM_NOT_ACTIVE` (retryable) | `grep '"event":.*not.active' daemon.log` + unit: tool call pre-up refused `REALM_NOT_ACTIVE` |
| Connecting timeout | boot budget exceeded | `DAEMON_START_TIMEOUT` / `TOOL_TIMEOUT` | log line `{"level":"error","event":...,"code":"DAEMON_START_TIMEOUT"}`; unit with `withTimeout` |
| Active → error (runtime) | sandbox exec fails | `AGENTOS_CRASH_LOOP` / `OPENSHELL_GATEWAY_LOST` | `grep '"code":"OPENSHELL_GATEWAY_LOST"' requests.log` |
| Stopping / down | `realm down` while calls in flight | `REALM_STOPPING`, then `REALM_NOT_ACTIVE` | unit: `down` mid-call → `REALM_STOPPING`; post-down call → `REALM_NOT_ACTIVE` |
| Invalid transition | illegal state edge | `REALM_INVALID_TRANSITION` | unit: `checkTransition(from,to)` (`states.ts` L51-55) returns error, exit 1 |
| Policy / path refusal | escape or denylist | `PATH_ESCAPE` / `CREDENTIAL_PATH_DENIED` / `POLICY_DENIED` | `grep '"code":"PATH_ESCAPE"' requests.log`; unit per §4 |
| Conflict | concurrent writer | `LOCK_CONFLICT` | unit: second lock acquisition throws `LOCK_CONFLICT`, file untouched |
| Audit / cleanup failure | log write or sweep fails | `AUDIT_WRITE_FAILED` / `CLEANUP_FAILED` | `grep '"code":"AUDIT_WRITE_FAILED"'`; daemon start reconcile line (`reconcile.ts`) |

Note: the brief's "8 states" is inaccurate — the frozen machine has
**5 states** (`unbound, connecting, active, error, stopping`,
`src/core/states.ts` L8-14; 9 allowed edges L33-43). The 8 rows above
are the 8 observable failure/transition cases, not 8 STATES.

Meaningful exit codes (verified in `src/cli/main.ts` L284-298,
L365, L429-482; `src/cli/stdio-host.ts` L128, L339, L374;
`src/daemon/main.ts` L5-6, L317-344): `0` = success (result on
stdout); `1` = catalogue error (`code\n` stdout, `reason\n` stderr)
or unsettled boot at stdin end; `2` = usage/input error
(breaking-guard, AGENTS.md L49; `realm doctor --fix --dry-run`
alone is usage error, AGENTS.md L32). Fail-fast input validation:
schema-validated inputs (`SCHEMA_INVALID`, `src/contract/validate.ts`
via gate modules, `eslint.config.js` L23); `--dry-run` alone and
unknown flags exit 2 before any side effect. Verify: run each
`realm <cmd>` with bad args, assert exit 2 and empty side effects
(no state dir created).

## 4. Security boundaries (n6.4 / SPE-37106)

| Attack | Expected rejection code | Verifying test / evidence | n2 coverage |
|--------|------------------------|---------------------------|-------------|
| Path traversal (`../`, symlink, `/proc` escape) | `PATH_ESCAPE` | unit: canonicalize/write/read/list escape cases (`src/fs/canonicalize.ts` L71-159; `write.ts` L51) | U5 PARTIAL (n2 L88-91) |
| Credential-path read/write | `CREDENTIAL_PATH_DENIED` | unit: `src/fs/credentials.ts` L49-52 | U5 PARTIAL |
| Cross-project write (outside bound worktree) | `PATH_ESCAPE` | unit: out-of-scope edit rejected | U5 PARTIAL |
| Cross-repo mount (repo B path in repo A sandbox) | `PATH_ESCAPE` | unit: scoped-edit confinement | U5/U6 PARTIAL (n2 L92-96) |
| Concurrent double-bind / double-write | `LOCK_CONFLICT` | unit: `src/session/workspace-binding.ts` L156-293; CBIND-03 b3fc8b8 | U6 PARTIAL |
| Missing/invalid capability token | `POLICY_DENIED` | unit: `src/capability/gate.ts` (enforce mode, AGENTS.md L181) | U12 (n2 L125-126) |
| Shell injection via triggered command | refused at lint + runtime (no `shell:true`) | `npm run lint` (TOOL-02 `shellTrue`, `eslint.config.js` L71-74); argv-only exec | U8 PARTIAL (n2 L102-106) |
| Secret leak in logs/audit | redacted (`REDACTED`) | `grep -E 'rcap1\.[A-Za-z0-9_-]{8}' requests.log` = no hits; unit: redact.ts L27-43 | U5/U12 |
| Cross-repo sandbox sharing (isolation break) | refused: repo key mismatch | unit: per-repo isolation — different repos never share a sandbox (n3 §7 L112-115) | U4 MISSING (n2 L84-87) [PENDING A1] |

Env-only secrets (AGENTS.md L102, L178, L184): secrets only via
`REALM_*` env at entry edges; `.env*` git-ignored; no host secrets
in sandbox by default; control socket 0600 in 0700 dir (AGENTS.md
L180). Per-repo isolation: repo-keyed sandbox is the isolation unit
**only if A1 approves 1-per-repo** [PENDING A1]; under settled
1-per-session, isolation is per-session. Trust boundary for triggered
commands: argv + edits per `tools.schema.json` (n2 L23-27); never
`shell:true`; spawn only in the 4 allowlisted modules
(`eslint.config.js` L35-36).

## 5. Clean-state verification sequence (n6.5 / SPE-37107) — CONDITIONAL

Preconditions: S1 done (realmlive up, `openshell status` Connected,
n2 L46); UID/U1 (n2 L68-72) — without it, steps 1-2 skip with the
named prerequisite (AGENTS.md L38-39). Commands from AGENTS.md
L31-33. `REALM_DRIVER_SOCKET/CONFIG/IMAGE` per AGENTS.md L38-39.
n5 is conditional on A1/A3 (see `.planning/UNITY-n5-DESIGN.md`
§1(b), §3–§7 marked `[PENDING A1]`/`[PENDING A3]`), so both
variants below are specified; choose after A1/A3 close.

Variant V1 — 1-per-repo [PENDING A1] (n3-selected, n3 §7 L92-96):

```sh
# 1. provision (repo-keyed; manifest entry created)
realm init --image <name@sha256:digest> --workspace /repo-A --state-dir /state
realm up --workspace /repo-A
# 2. connect + mount two worktrees of repo-A
git -C /repo-A worktree add /repo-A-wt2 -b wt2
# via n5.5 mechanism: register wt1+wt2 to sandbox keyed repo-A (manifest: repo->wt->sandbox, n3 L62)
# 3. trigger an edit + argv command; assert journal key = manifest entry
# 4. disconnect (host shutdown / client close; never sends down, AGENTS.md L113)
# 5. reconnect: realm up --workspace /repo-A -> rebind, no recreate
# 6. verify persistence: edits from steps 3-4 present; sandbox id unchanged
# 7. idempotency: repeat steps 2-3 -> re-attach, zero duplicate sandbox/manifest entries
```

Variant V2 — 1-per-session (settled record) [PENDING A1]:

```sh
realm init --image <name@sha256:digest> --workspace /repo-A --state-dir /state
realm up --workspace /repo-A            # sandbox realm-<sessionId>, AGENTS.md L71
realm up --workspace /repo-A            # second session -> second sandbox; assert distinct ids
# mount wt2 only under the same session key (U6 discovery, n2 L92-96)
# trigger, disconnect (client close, no down), reconnect, verify persistence (U7, n2 L97-101)
# idempotency: repeat up -> same sandbox id (up is idempotent, AGENTS.md L112)
```

Variant V3/V4 — Hosted vs Library arm the runner [PENDING A3]: Hosted
keeps gateway-on-host + in-sandbox `openshell sandbox exec` child
(n1 §5 L120-123); Library changes only the runner placement per the
n5.5 minimal mechanism, keeping the 7-step sequence above verbatim.
Gate: neither V1/V2 nor V3/V4 may be executed as "the design" until
A1 and A3 are owner-closed (n4 §8 L137-141).

## 6. Failure-mode verification matrix (n6.6 / SPE-37108)

| Fault injected | Expected state | Expected log line shape | Expected retry | n2 unit |
|---------------|----------------|------------------------|---------------|---------|
| Sandbox crash (container killed) | `active`→`error`; next `up` rebinds or recreates | `{"level":"error","event":"sandbox.crashed","code":"AGENTOS_CRASH_LOOP",...}` | bounded transient-only, then `CLEANUP_FAILED` if reap fails | U7 (n2 L97-101) |
| Runtime not starting (no `REALM_DRIVER_SOCKET`) | stays `unbound`/`connecting`→`error` | `{"level":"error","event":"daemon.start","code":"DAEMON_START_TIMEOUT"}` | no retry of socket wait; surface + exit 1 | U1 (n2 L68-72) |
| Filesystem full (state dir ENOSPC) | fail-closed; mutation not landed | `{"level":"error","event":"fs.write","code":"WRITE_NOT_ATOMIC"}` (or `AUDIT_WRITE_FAILED`) | no retry; operator frees space | U5 (n2 L88-91) |
| Stale registration (manifest entry, dead sandbox) | reconcile on start; entry reaped or re-bound | `{"level":"warn","event":"registry.rebuild","code":"AUDIT_OUTCOME_UNKNOWN"}` | one rebind attempt via n5.5 mechanism | U6 (n2 L92-96) |
| Dropped connection mid-trigger | tool call fails `OPENSHELL_GATEWAY_LOST`; journal holds trigger key | `{"level":"error","event":"tool.dispatch","code":"OPENSHELL_GATEWAY_LOST"}` | idempotent re-fire with same journal key → no duplicate effect | U8 (n2 L102-106) |
| AgentOS unavailable (`AGENTOS_NOT_CONFIGURED`) | `unbound`; `realm doctor` names missing piece | `{"level":"error","event":"agentos.configure","code":"AGENTOS_NOT_CONFIGURED"}` | none (config fix, not transient) | U3 (n2 L78-82) |

Every retry above is bounded-transient-only (n3 §6 L82): non-transient
codes (`POLICY_DENIED`, `SCHEMA_INVALID`, `AGENTOS_NOT_CONFIGURED`,
CAPT-09-class) are never retried. Verify each row with the named
`grep` pattern on `daemon.log`/`requests.log` plus the unit in §3.
