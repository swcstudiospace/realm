# N6 Proof — SPE-39199: N6 design: omp end-to-end proof and verification

Issue: SPE-39199 `n6-design-omp-end-to-end-proof-and-verification` — https://linear.app/swcstudio/issue/SPE-39199/n6-design-omp-end-to-end-proof-and-verification
Node: n6 of SPE-39194→39199 chain. Inputs (sole sources, not re-derived):
`N1-INVENTORY.md` (SPE-39194, `.planning/phases/spe-39194-inventory/`),
`N3-COMPOSITION.md` (SPE-39197, `.planning/phases/spe-39197-compare/`),
`N5-CONTROLS.md` (SPE-39198, `.planning/phases/spe-39198-refine/`).
Scope: this file only. No gates/tests/lint/format run. Date: 2026-11-28. All paths repo-relative.
Marks: FACT = stated in an input file; PLAN = concrete step this file imposes. Every command below is
N1-discovered (recorded probe or gate in N1 §3/§5/§6, or a N5 §0 verbatim gate) — no command is invented.

## 0. Fixed frame (FACT — applied, not re-litigated)

| # | Fact | Source |
|---|---|---|
| F1 | `realm` is ABSENT from PATH (`command -v realm` → 127). The CLI is `node dist/src/cli/main.js` (built, `dist/` 16M). Every Realm invocation uses that form. | N1 §5/§6, N5 §0/§5 |
| F2 | CLI verbs discovered: `init up down status doctor mcp acp anchor audit metrics checkpoint host` (`src/cli/main.js`, usage: `realm <init\|up\|down\|status\|doctor\|mcp\|acp\|...>`); `realm host list \| detect \| status \| install \| uninstall \| token status \| token rotate`. | N1 §2/§3 |
| F3 | `init` takes `--image <name@sha256:digest>`, `--workspace <abs path>`, `--state-dir <abs path>`; `up/status/down/metrics` take `--workspace <abs path>`; `mcp/acp` take `--workspace`, `--host`, `--reattach`; `doctor` takes `--workspace`. | N1 §2, `src/cli/main.ts:61` |
| F4 | Podman tier: PATH `/usr/bin/podman` = 4.9.3 (BELOW the 5.x OpenShell/live tier, D-D1); `/usr/local/bin/podman` = 5.7.1 (live tier, off-PATH). OpenShell `/usr/bin/openshell` = 0.1.5. AgentOS CLI absent (`@rivet-dev/agentos-core 0.4.7` in `node_modules`); no `localhost/realm-agentos` image (N4 C9). | N1 §5–§6, N5 D-D1 |
| F5 | Omp installed: `$HOME/.local/bin/omp`, `omp/19.2.1`; `-p/--print` = non-interactive mode; `--cwd` sets start dir; `--no-session` = ephemeral. | N1 §5; `omp --help` 2026-11-28 |
| F6 | Omp host entry: integration `extension` (not `mcp-config`), flag `--omp`, home `.omp/agent`, env override `PI_CODING_AGENT_DIR`, binary `omp`, recipe `{kind:"bundle-copy", source:"omp", dest:"extensions/realm"}`, conflict `.omp/plugins/node_modules/agent-realm`. 22 hosts total. | N1 §4, `src/host/runtimes.ts:98-108`, N3 §0 |
| F7 | Composition B + P2 is the target: daemon leader → `SessionExecution` label-idempotent OpenShell create → one `realm-<sessionId>` container (19-char gateway cap) pinned to `workspaceRoot`; hosts attach via recepts/`resolveBoot`; hosts never send `down` on exit (sandbox outlives host). | N3 §1–§3, N5 D-B/D-P2 |
| F8 | Unit-A gate set verbatim from `package.json:52-70`: `typecheck lint test test:integration test:coverage test:scripts check:docs check:mcp check:pack check:image-digests build build:image release:* check:gates check:breaking`. | N1 §3, N5 §0 |
| F9 | Frozen contracts: CLI exit codes `0` ok / `1` refusal-failure / `2` usage-error; error catalogue incl. `POLICY_DENIED`, `PATH_ESCAPE`, `LOCK_CONFLICT`, `PODMAN_*`, `OPENSHELL_*`, `AGENTOS_*`; tools `exec/read/write/list/status/retry`, with `exec` argv-form `{argv}` preferred over shell-form. | N5 §0, `src/contract/tools.schema.json` |
| F10 | Worktree selection: ONE worktree. Main checkout `$WORKTREE` (151 registered worktrees; canonical = main until C10 resolves otherwise). `WT=$WORKTREE`. | N1 §1/§8-G1, N5 D-D4/A2 |
| F11 | Secrets never in evidence: evidence records presence/absence only; logs redacted; refusal texts are 11 fixed texts, never carrying file content. | N5 R2.3 |

Run variables (set once, prefix every command):
```
export WT=$WORKTREE
export REALM="node dist/src/cli/main.js"
export POD=/usr/local/bin/podman     # 5.7.1 live tier (F4); PATH podman 4.9.3 used only as a deliberate negative probe in 5c
export TOKEN="N6-$(cat /proc/sys/kernel/random/uuid)"   # canary nonce; recorded in evidence, never a secret (F11)
```

Abort rule (PLAN, from N3 §4 item 3 and N5 R5): any refusal or non-zero gate exit stops the sequence at
that step — no degraded host execution, no retrying around a catalogue code, no partial stdout frames.

## 1. Step 1 — Build + quality gates (N5 Unit-A set, F8)

Run in repo root, in this order; every leg must exit 0 before the next:

```
npm run typecheck            # tsc -p tsconfig.json --noEmit (R1/R3 types cannot widen silently)
npm run lint                 # eslint . (shell-injection rules at the CLI edge, R3)
npm run build                # tsc -p tsconfig.json -> dist/ (F1: CLI must exist before Step 2)
npm run test                 # tsc + node --test "dist/test/**/*.test.js" (hardening, controller, reap, binding, doctor fail-path suites)
npm run test:scripts         # node --test "scripts/**/*.test.mjs" (incl. secret-scan cover, R2)
npm run check:gates          # gate-closure + module-size + export-usage-gate + lockfile-integrity (R5/R6 wiring)
npm run check:docs           # host-paths + agents-sync + default-mode
npm run check:mcp            # mcp-smoke (refusal-before-frames path, R5)
npm run check:pack           # pack-smoke (pinned set ships, R6)
npm run check:breaking       # breaking-change-guard (catalogue/lock surface, R4)
npm run check:image-digests  # verify-image-digests vs sandbox/expected-digests.json (R6.1)
```

Pass criteria: each exits 0. Evidence: exit code + elapsed time per leg (generated output, not hand-written — N5 R6.3).
Also `npm run build:image` is permitted once here if `localhost/realm-agentos` is still absent (R6.1:
built-by-`build:image` with pinning, or absent-but-refused). Record which alternative was taken.

Note (SKIP per assignment): this node designs the sequence; none of the above were run here.

## 2. Step 2 — Provision via composition B (daemon + per-worktree container), twice + health check twice

Precondition: Step 1 green (REALM binary exists from `npm run build`).

```
$REALM doctor --workspace $WT
```
Expect: pre-attach health gate prints per-leg verdicts (N5 R5.1: Podman/OpenShell/AgentOS/Mount legs).
With the 5.7.1 `podman` on the daemon's resolution and the built image present, every leg `pass`.
If the AgentOS leg reports `AGENTOS_NOT_CONFIGURED`, run `npm run build:image` once, then re-run doctor —
never proceed to `up` on a failed leg.

```
$REALM init --image <name@sha256:digest> --workspace $WT
```
`<name@sha256:digest>` is the pinned digest from `sandbox/expected-digests.json` (F8/R6.1) — no floating tag.
Expect: config written for workspaceRoot `$WT`; refusal `POLICY_DENIED` (digest mismatch) stops here.

```
$REALM up --workspace $WT          # up #1 (cold)
$REALM up --workspace $WT          # up #2 (warm)
$REALM status --workspace $WT      # status #1
$REALM status --workspace $WT      # status #2
```
Expect (B warm idempotence, N3 §0/§1): up #1 creates exactly one `realm-<sessionId>` container
(19-char cap, label lookup pure read); up #2 returns the same `containerId` as a snapshot — no second
container, no startup budget applied; status #1/#2 report `active` with identical `containerId` and
`workspaceRoot == $WT` (pinned readback). Record `containerId` from all four invocations.

Named-layer failures, observed green (not simulated beyond probes already in F4):
- Leader missing: `ensureDaemon` spawn at most once; no socket before spawn, live socket after. Evidence: doctor daemon leg.
- Component missing: PATH `podman 4.9.3` instead of `/usr/local/bin/podman` → `PODMAN_UNSUPPORTED_VERSION`
  and **no container created** (`$POD ps -a --filter 'label=…'` empty / `podman ps -a | grep realm-` empty).
- Gateway silent → `OPENSHELL_GATEWAY_LOST` (classified, never retried); ambiguous label → `OPENSHELL_LABEL_AMBIGUOUS`.

## 3. Step 3 — Omp enablement (plugin-on-boot config)

```
$REALM host install omp
$REALM host status omp
```
Expect (F6/P2): install applies the `bundle-copy` recipe into `PI_CODING_AGENT_DIR` (default `~/.omp/agent`,
i.e. `$PI_CODING_AGENT_DIR/extensions/realm` = the shim: strict JSON string literal `import("file:///...")`,
backslash/encoded-separator paths refused `unsupported-path`); receipt records before/after hashes;
`host status omp` reports entry `ok`, extension shim `present`, `launch: on-path`, and no
`.omp/plugins/node_modules/agent-realm` conflict (double-load refused, `already-loaded`). A second
`host install omp` must be a `done`/`noopChange` (pure `planRecipe`, `resumeDecision=done`) — record both outcomes.
Do NOT hand-edit config homes (R2.1); config is received only through the receipt.

Headless boot twice (F5):
```
PI_CODING_AGENT_DIR=$PI_CODING_AGENT_DIR $HOME/.local/bin/omp --cwd $WT -p "say ready" --no-session
PI_CODING_AGENT_DIR=$PI_CODING_AGENT_DIR $HOME/.local/bin/omp --cwd $WT -p "say ready" --no-session
```
Expect: the `extension` plugin loads on boot (`session_start` fires), attaches through the boot driver to the
same daemon (idempotent up, no second container — F7), hook errors/timeouts fail closed (`plugin.ts` guard).
If the sandbox provider auth is absent, the invocation still exercises plugin load; record exit code and
whether the failure is provider-side or Realm-side — a provider-side failure with a clean Realm attach is a
pass for this step's purpose (record it as such). Interactive boot (`omp --cwd $WT` in a PTY) is optional:
expect the AUI widget paint + retry command when the persisted toggle is on (`enabled:false` registers exactly
0 tools/paints, ADR-0001). Mark interactive as `feasibility:` result — TTY evidence is the known gap N3 §5-G1.

Plugin health: `$REALM doctor --workspace $WT` again — Omp plugin health check leg `pass` (STATE focus F-51-1).
No `omp plugin install` link may exist (conflict target, F6).

## 4. Step 4 — New Omp session: attach through daemon/driver to sandbox in ONE worktree + canary

Start a NEW Omp session in `$WT` (`omp --cwd $WT`, interactive preferred; `-p --no-session` acceptable —
state which). The session attaches via the extension plugin: `ensureDaemon` → idempotent `up --workspace $WT`
(same `containerId` as Step 2, warm) → AgentOS supervisor over OpenShell. Issue the three canary commands
through the daemon/driver surface — `exec` argv-form only (N5 R3.2, F9: single argv elements, never
`sh -c`, never shell interpolation):

```
{"exec":{"argv":["pwd"]}}                                   # expected: $WT
{"exec":{"argv":["git","rev-parse","HEAD"]}}                # expected: HEAD of the $WT checkout
{"exec":{"argv":["echo","$TOKEN"]}}                         # expected: $TOKEN verbatim
```

Capture table (one row per canary):

| sandbox identity | worktree path | agent + version | command | output | exit code |
|---|---|---|---|---|---|
| `realm-<sessionId>` + `containerId` | `$WT` | `omp 19.2.1` (`$HOME/.local/bin/omp`) | `pwd` | `$WT` | `0` |
| (same) | `$WT` | (same) | `git rev-parse HEAD` | `<sha>` | `0` |

Pass criteria: all three canaries exit 0, `pwd` output equals `$WT` (canonicalized), `rev-parse` output equals
`git -C $WT rev-parse HEAD` on the host, echo round-trips `$TOKEN` exactly, sandbox identity/`containerId`
matches Step 2 (same container, not a second one). Evidence: full tool-call inputs/outputs, no secrets (F11).

## 5. Step 5 — Negative probes (N5 controls R1–R5)

All probes run against the live Step 4 session; each refusal must carry its catalogue code and exit 1
(F9) with no partial frames on stdout and no file/container mutation. Sentinel first:
`touch $WT/N6-sentinel` (created by hand in the worktree — the only host-side write in this sequence).

5a. Injection / traversal → `POLICY_DENIED` (R1.3/R3.1). Via the driver surface:
- `{"read":{"path":"../outside","maxBytes":1024}}` → `SCHEMA_INVALID`/`PATH_ESCAPE` (`workspacePath` rejects `..`; F9 schema).
- `{"exec":{"argv":["cat","../outside"]}}` → refused, no content returned.
- `{"exec":{"shell":true,"script":"echo hi; rm -rf /"}}` → `SHELL_NOT_ALLOWED` (shell-form gated, Phase 2).
Expect at minimum a `POLICY_DENIED`-family refusal for the path legs; record the exact code per leg.
Evidence: `ls $WT/N6-sentinel` still present, no file outside `$WT` created.

5b. Collision → `LOCK_CONFLICT` (R4.1). While the Step 4 session holds the per-worktree lock, run a second
concurrent `$REALM up --workspace $WT` from a different session identity. Expect: terminal `LOCK_CONFLICT`,
exactly one `active` session record, no second container. Foreign-workspace variant: bind the same container
to another `workspaceRoot` → `POLICY_DENIED` (S-02, `controller.ts` binding check). Record both.
(Phase 59 multi-attach stays out of scope — D-D4/F10.)

5c. Missing agent reported (R5.1/R6.2). Run `doctor --workspace $WT` with PATH `podman` (4.9.3) shadowing
`/usr/local/bin/podman` (e.g. `PATH=/usr/bin:$PATH $REALM doctor --workspace $WT`). Expect
`PODMAN_UNSUPPORTED_VERSION`, and `$REALM up --workspace $WT` refuses with the same code and creates no
container (`$POD ps -a | grep realm-` empty). Unbind-AgentOS variant (if config allows): `AGENTOS_NOT_CONFIGURED`
with **no container ever created** (`session-execution.ts` contract, N3 §0). Record which variant was feasible.

5d. Unhealthy stops routing, preserves files (R5.2). Kill the sandbox runner/driver (e.g. `$POD stop <containerId>`
or interrupt the gateway). Expect: supervisor holds the session in `error` with the classified code
(`AGENTOS_CRASH_LOOP` / `OPENSHELL_GATEWAY_LOST` / runner exit), never auto-restarts; further canary/attach
refuses (retryable `REALM_NOT_ACTIVE`/`TOOL_TIMEOUT` only where the taxonomy allows, else terminal) — no
partial frames, no host-execution fallback (composition C remains rejected, N3 §4). Evidence:
`ls -l $WT/N6-sentinel` unchanged + `git -C $WT status --porcelain` unchanged (only the sentinel, untracked)
+ named volume still present. Next `$REALM up --workspace $WT` auto-recreates the container (D-U2),
reusing the survivor where identity checks pass.

## 6. Step 6 — Persistence after session exit + teardown report

```
# exit the Omp session (close the host). Hosts never send down (F7).
$POD ps --filter 'name=realm-'      # container still running?
$REALM status --workspace $WT       # still active?
# re-attach and re-run one canary (pwd) -> same containerId, $WT, exit 0
$REALM down --workspace $WT
$REALM up --workspace $WT           # auto-recreate (D-U2)
```

Teardown report (fill from actual output):

| Item | Expected | Observed |
|---|---|---|
| Container after host exit | still running, `containerId` unchanged | |
| `status` after host exit | `active`, same binding | |
| Re-attach canary `pwd` | `$WT`, exit `0`, same container | |
| After `down` | session `stopping → unbound`, lock released, container removed | |
| `up` after `down` | recreated (auto-recreate), new `containerId` | |
| Worktree files after full teardown | `git status` clean except sentinel evidence, named volume retained | |

## 7. Rollback / cleanup (PLAN)

On any failure: stop at the failed step, leave the first failing state inspectable (do not `down` over it),
record the catalogue code + exit code + the command verbatim, and file the finding with the evidence table.
Cleanup once all steps pass: `rm $WT/N6-sentinel`, `$REALM down --workspace $WT`, `$REALM host uninstall omp`
(verify receipt-clean removal via `host status omp`), remove the `N6-proof-*` evidence notes if any are committed
as planning files (they are evidence, not secrets — F11).

## 8. Traceability to N5 controls and N3 ordering

| Step | Controls exercised | B/P2 property proved |
|---|---|---|
| 1 | R1–R6 gates | P2 pure `planRecipe` + typed launch/profile surfaces |
| 2 | R5.1, R6.1, warm idempotence | B: leader, label-idempotent create, inspect-verify |
| 3 | R2.1/R2.3, P2 receipts | P2 > P1 > P3 (receipted config, shim-on-path only) |
| 4 | R1.1–R1.4, R3.2 | per-worktree pinning, argv exec, capability token path |
| 5a | R1.3, R3.1, R4.2 | fail-closed binding (S-02) |
| 5b | R4.1–R4.3 | one session per worktree enforced, not convention |
| 5c | R5.1, R6.2 | catalogue-typed refusal before create, no container |
| 5d | R5.2, D-U2 | stop-routing-hold + auto-recreate, files preserved |
| 6 | D-U2, teardown-never-down | healthy persists / unhealthy auto-recreates |

## 9. Assumptions / gaps carried forward (NOT facts)

| # | Item | Origin |
|---|---|---|
| A1 | Canonical worktree = main checkout `$WT=$WORKTREE` (C10 undecided). | N1 G1, N5 A2 |
| A2 | `localhost/realm-agentos` may need `npm run build:image`; otherwise `AGENTOS_NOT_CONFIGURED` is the honest pre-Step-2 state. | N1 C9, N5 R6.1 |
| A3 | Omp provider auth for headless `-p` calls is assumed present; absent auth is recorded, not treated as Realm failure. | F5 (this node) |
| A4 | Interactive TTY widget evidence is feasibility-only (intro `isTTY` symbol gap stands). | N3 §5-G1 |
| A5 | Per-worktree name-hash compression inside the 19-char budget does not exist yet; over-long names refuse rather than collide (N3 A1). | N3 §5-A1, N5 A1 |
