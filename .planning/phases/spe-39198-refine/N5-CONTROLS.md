# N5 Risk Controls — SPE-39198: Refine risk controls and quality gates

Issue: SPE-39198 `n5-refine-risk-controls-and-quality-gates` — https://linear.app/swcstudio/issue/SPE-39198/n5-refine-risk-controls-and-quality-gates  
Node: n5 of SPE-39194→39198 chain. Inputs (sole sources, not re-derived):
`N1-INVENTORY.md` (SPE-39194, `.planning/phases/spe-39194-inventory/`),
`N2-WORKSTREAMS.md` (SPE-39196, `.planning/phases/spe-39196-decompose/`),
`N3-COMPOSITION.md` (SPE-39197, `.planning/phases/spe-39197-compare/`),
`N4-CLARIFICATIONS.md` (SPE-39195, `.planning/phases/spe-39195-clarify/`).
Scope: this file only. No gates/tests/lint/format run. Date: 2026-11-28. All paths repo-relative.
Marks: FACT = stated in an input file; CONTROL = refined rule this file imposes; GATE = the
Unit-A command (from `package.json:52-70` via N1 §3 / N2 §4) that evidences it, or the smallest
credible new check where no existing gate covers the risk.

## 0. Inherited decisions (FACT — applied, not re-litigated)

| # | Decision | Source |
|---|---|---|
| D-B | **Composition B is the leader:** daemon-led controller (`SessionExecution` + per-session `AgentOsSupervisor` over OpenShell), one container/sandbox per worktree, pinned to `workspaceRoot`. Ordering B > A > C (24/25 vs 14/25 vs 8/25). | N3 §1, §3 |
| D-P2 | **Plugin mechanism P2 is the default:** receipted per-agent configs (`planRecipe` pure, `resumeDecision = done\|apply\|conflict`) + `resolveBoot`/boot-driver attach. P1 kept as hook *vocabulary* only; P3 PATH shim is launch-resolution fallback only. Ordering P2 > P1 > P3. | N3 §2, §3 |
| D-U2 | **Teardown = auto-recreate (unhealthy).** `realm down`/teardown is non-final; next `up` recreates. Hosts never send `down` on exit (teardown-never-down). Healthy state persists (D3); *unhealthy* state auto-recreates. | N4 §4 U2, §1 D3; N2 §0; N1 §7 |
| D-U3 | **Boot scope = global, all hosts.** Install `--global` at user level (no sudo, no system-wide), per-runtime `*_CONFIG_DIR` + `XDG_CONFIG_HOME`/`HOME`; no per-project opt-in. | N4 §4 U3, §1 D2 |
| D-U4 | **GSD source of truth = highest-confidence `github.com/open-gsd/gsd-core`.** In-repo `src/host/runtimes.ts` (22 hosts = 18 GSD flags + `omp` + 3 Realm-only) is a dated mirror (2026-11-16, `69d604e`); upstream HEAD wins on drift. | N4 §4 U4, §2 B2; N1 §4, §7 |
| D-D4 | **One session per worktree** (concurrency bound; Phase 59 multi-attach out of scope until owner ratification). 150+ worktrees registered registry-wide; canonical worktree = main checkout until C10 resolves otherwise. | N4 §1 D4, §3 C5/C10 |
| D-D1 | **Podman is the sole container runtime.** Docker/Kubernetes out of scope. Podman ≥5.x tier for OpenShell/live paths (PATH `4.9.3` is below tier). | N4 §1 D1, §3 C2 |

Units (file-disjoint, N2 §1): **A = quality** (configs/CI/`scripts/check/*`, owns `package.json`,
`eslint.config.js`, `tsconfig*.json`, `test/` quality harnesses); **B = sandbox lifecycle**
(`sandbox/*`, `src/runtime/*`, `src/daemon/*`, `src/lifecycle/*`, `src/core/*`, `src/doctor/*`);
**C = plugin-on-boot** (`src/host/*`, `src/cli/host.ts|stdio-host.ts|stdio-settle.ts|main.ts`, adapters);
**D = Omp proof** (`src/omp/*`, `adapters/omp/`, evidence only). Contract order B → C → D; A parallel
(N2 §3). This file *refines* controls inside those ownerships; it moves no file between units.

Frozen contracts it refines (N2 §2, B-owned): lifecycle `State` (5 names, 9 transitions), `BootLink`
(5 names), `HostBootEvent.phase` (6 names); error catalogue 29 codes incl. `POLICY_DENIED`,
`PATH_ESCAPE`, `CREDENTIAL_PATH_DENIED`, `LOCK_CONFLICT`, `PODMAN_MISSING`,
`PODMAN_MACHINE_DOWN`, `PODMAN_UNSUPPORTED_VERSION`, `OPENSHELL_START_FAILED`,
`OPENSHELL_LABEL_AMBIGUOUS`, `AGENTOS_NOT_CONFIGURED`, `AGENTOS_CRASH_LOOP`,
`OPENSHELL_GATEWAY_LOST`; CLI exit codes `0` ok / `1` refusal-failure / `2` usage-error;
`CheckResult {id, status: pass|warn|fail, detail, fix}`; `HostLinkStatus` shape. Every CONTROL
below maps to one of these existing codes — **no new exit codes are invented**; "distinct exit
codes" (R5) means distinct *catalogue codes* per failure leg, all surfaced under CLI exit `1`
(except usage `2`).

Unit-A gate command set used below (verbatim from `package.json:52-70`, N1 §3):

```
npm run typecheck            # tsc -p tsconfig.json --noEmit
npm run lint                 # eslint .
npm run test                 # tsc -p tsconfig.json && node --test "dist/test/**/*.test.js"
npm run test:scripts         # node --test "scripts/**/*.test.mjs"
npm run check:gates          # gate-closure + module-size + export-usage-gate + lockfile-integrity
npm run check:image-digests  # node scripts/check/verify-image-digests.mjs
npm run check:docs           # host-paths + agents-sync + default-mode
npm run check:mcp            # node scripts/check/mcp-smoke.mjs
npm run check:pack           # node scripts/check/pack-smoke.mjs
npm run check:breaking       # node scripts/check/breaking-change-guard.mjs
npm run build                # tsc -p tsconfig.json
```

## 1. R1 — Isolation (escape / cross-worktree contamination)

Threat: a session writes outside its worktree, reads another worktree's files, reaches host
credentials, or escapes the container (privileged/host-network). N3 scored this composition B 5/5
vs A 1/5 vs C 1/5 precisely on per-worktree pinning (S-02: record binds `containerId → workspaceRoot`,
foreign-workspace reuse refused `POLICY_DENIED`, hydration never creates).

CONTROL R1.1 — *One persistent container per worktree.* Each git worktree maps to exactly one
`realm-<id>` container/sandbox (N3 §0 naming: `realm-` + session id, 19-char gateway cap). The
container is *persistent*: `start()`/re-attach reuses the stored `containerId`; label lookup is a
pure read returning the existing container without re-create; warm create/start is a snapshot no-op.
Re-creation happens only on unhealthy auto-recreate (D-U2) or explicit `realm down` + `up` —
never on host exit (hosts never send `down`).

CONTROL R1.2 — *Own working directory + own volume.* Per worktree: one workdir (its own
`workspaceRoot`) and one named volume (scratch/build cache) bound 1:1 to that container. A volume
is never shared, mounted read-write, or re-bound across worktrees; cross-worktree reuse is
`POLICY_DENIED` at the `LifecycleController` binding check (before any state change), not repaired
after the fact.

CONTROL R1.3 — *Minimal mounts.* Container mounts = exactly { the bound project worktree root,
its named volume, the read-only policy document written before create }. Nothing else is mounted.
Explicitly forbidden: `/`, `$HOME`, `~/.config`, `~/.ssh`, `~/.local/share`, any store or socket
dir outside the project root, the daemon socket (reached over the supervisor channel, never via
mount), and any credential path (see R2). Bind mounts are absolute, canonicalized (R3), and
verified present inside `policy.workspaceRoots` before create; a mount outside that set refuses
`PATH_ESCAPE`/`POLICY_DENIED` and creates no container.

CONTROL R1.4 — *No privilege, no host network.* Every container runs unprivileged (no
`--privileged`, no `SYS_ADMIN`/`NET_ADMIN`/`SYS_PTRACE` caps beyond the shipped hardening set in
`src/runtime/hardening.ts`), with host networking disabled (isolated bridge/netavark namespace;
` sandbox/resolv.conf` is the only resolver config). Egress goes through `src/runtime/egress.ts`
policy only. Any profile requesting privileged/host-net is a `POLICY_DENIED` refusal, surfaced in
doctor output — never silently downgraded to a weaker profile.

CONTROL R1.5 — *(Global-boot corollary, D-U3.)* "Global" applies to *host config installation*
(user-level, per-host config homes), never to container mounts: all 22 hosts installing `--global`
does not widen any sandbox's mount set. P2 receipts own only their config block; runtime binding
(`workspaceRoot` readback) is what confines the session.

Owner: B (`sandbox/*`, `src/runtime/hardening.ts`, `src/runtime/session-execution.ts`,
`src/driver/isolation/launch.ts`, `src/lifecycle/controller.ts`).
GATE (existing, binding): `npm run test` (hardening + controller + session-execution suites under
`test/runtime/`, `test/lifecycle/` — mount/privilege/network assertions live there; a hardening
regression fails the suite) + `npm run typecheck` (launch/profile types cannot widen caps without
compile-visible change) + `npm run check:gates` (`gate-closure` proves the hardening check list is
still wired into doctor). Runtime evidence (not a Unit-A gate): `node dist/src/cli/main.js doctor
--workspace $WORKTREE` must list each hardening check `pass` before any attach.
NEW check (smallest credible, only if the existing suites lack a profile assertion): a
`test/runtime/isolation-profile.test.ts` parametrized over the launch profiles asserting
`privileged=false`, `network≠host`, mount-set equality with R1.3 — run by the *same*
`npm run test`; no new script, no new command.

## 2. R2 — Secrets (leakage into mounts, logs, receipts, evidence)

Threat: API keys/tokens (tracker, Notion, provider, host credentials) end up in container mounts,
daemon/audit logs, install receipts, or committed evidence. N4 B5 already forbids raw credential
material in repo; N2 §2.3 forbids `src/host` reading `process.env` directly (`HostEnv` filled at
the CLI edge).

CONTROL R2.1 — *Env/secret-store only.* Secrets enter the system exclusively as (a) environment
variables injected at the CLI edge into `HostEnv`, or (b) a named secret-store reference
(`REALM_ANCHOR_KEY_FILE` pattern) resolved in-sandbox at use time. No secret is ever written into
a P2 receipt, a config block, a mount, a volume, or a planning/evidence file. Config homes
(`~/.config/`, `*_CONFIG_DIR`) receive *config*, never secret values; a receipt entry whose
planned content matches a secret pattern is refused (`recipe-pending`/`unparseable`-family refusal
vocabulary, N3 §2) rather than written.

CONTROL R2.2 — *No credential mounts.* `CREDENTIAL_PATH_DENIED` is a first-class refusal: any
requested mount of a credential path (`~/.ssh`, `~/.aws`, `~/.config/gh`, tracker/Notion token
files, the daemon state dir) is refused before create, even if the path is inside
`policy.workspaceRoots`. Combined with R1.3 this is belt-and-braces: the mount set is closed
(allowlists R1.3) *and* credential paths are denylisted explicitly.

CONTROL R2.3 — *Redacted logs.* Daemon logs (`<stateDir>/daemon.log`, `requests.log`,
`audit/<sessionId>.jsonl`), boot-report, doctor `detail` strings, and any tool output that could
carry a value pass through the redaction seam before write: known secret env values, `Bearer …`,
`token=…`/`api[_-]?key=…` assignments, and high-entropy blobs are replaced with `[REDACTED]`.
Refusal reasons stay within the 11 fixed texts (N3 §2) and never echo file content or secret
values. Evidence files written by D (Omp proof) record *presence/absence* (`set`/`unset`), never
values (N4 B5 probe pattern).

CONTROL R2.4 — *Secret-scan gate (new, smallest credible).* A committed, tracked-file scan that
fails CI on known secret prefixes (`sk-`, `ghp_`, `gho_`, `xox[baprs]-`, `AKIA…`, `-----BEGIN …
PRIVATE KEY-----`, PEM/DER headers) plus the same assignment-regex as R2.3 applied to staged/
tracked text. No external scanner dependency: one Node script, allowlisted by path (test fixtures
that intentionally contain fake prefixes are listed in a checked-in allowlist, same convention as
`scripts/check/export-usage-allowlist.json`).

Owner: B (redaction seam in `src/daemon/`, `src/host/boot-report.ts` redaction call-site owned by
C but the seam by B), C (`src/host/env.ts`, `src/host/recipe.ts`, `src/host/install.ts`),
A (scan script + CI wiring).
GATE (new, minimal): `node scripts/check/secret-scan.mjs` — wired as a fourth leg of
`npm run check:gates` and covered by `npm run test:scripts` (`scripts/check/secret-scan.test.mjs`
with positive/negative fixtures). If maintainers prefer no `check:gates` change, the same script
runs standalone in CI before `check:gates`; either way the *command* is the script above, not a
new framework. Existing binding in the meantime: `npm run test` (env/credential-path suites) +
`npm run check:docs` (`host-paths` guards config-home writes).

## 3. R3 — Input validation (injection / traversal / shell escape)

Threat: a crafted worktree name, project path, or identifier escapes the project root, collides
with another worktree's container, or injects shell syntax into exec paths. The 150+ worktree
fleet (`$WORKTREE**|v*|x*|y*|z*`, N1 §1) makes name/path hygiene load-bearing.

CONTROL R3.1 — *Allowlist + canonicalize every external identifier.* Worktree names, session ids,
project paths, and host ids are validated against a closed allowlist (ASCII `[A-Za-z0-9._-]`,
no leading `-` or `.`, no `/`, no `\`, no NUL, no `..` segments, no empty) and canonicalized
(`path.resolve` + `realpath` for existing roots; symlink targets resolved before the
`policy.workspaceRoots` membership test). Anything outside the allowlist refuses `SCHEMA_INVALID`
or `PATH_ESCAPE` before any daemon state change. `workspaceRoot` must be absolute and inside a
workspace root (`bindRoot`, N2 §2.5); relative or escaping paths never reach create.

CONTROL R3.2 — *Argv exec, never shell interpolation.* All process execution uses
`execFile`/`spawn` argv-form (`child_process` only in `src/host/attach.ts`-injected spawns and
`src/cli/*`, never in `src/host` — N3 §0). User-derived strings are passed as single argv
elements, never concatenated into a shell string, never through `sh -c`, never re-expanded by a
template. The Omp shim token substitution (`@realm:extension-url@` → strict JSON string literal,
backslash/encoded-separator refusal `unsupported-path`, N3 §0) is the reference pattern: values are
*encoded* into their sink, not interpolated raw.

CONTROL R3.3 — *Gateway name budget enforced at validation, not at the gateway.* The 19-char
`GATEWAY_SANDBOX_NAME_MAX_LENGTH` cap is checked during identifier canonicalization (R3.1): an
over-long or ambiguous derived name refuses `OPENSHELL_LABEL_AMBIGUOUS`/`SCHEMA_INVALID` at the
validation seam, before any libpod/OpenShell call (N3 §4 reversal condition 1 depends on this:
collisions must surface as refusals, not as gateway rejections).

Owner: B (`src/session/paths.ts`, `src/runtime/config.ts`, `src/runtime/openshell.ts` naming),
C (`src/host/env.ts`, `src/host/recipe.ts`, `src/cli/host.ts` arg parsing), A (test harness only).
GATE (existing): `npm run test` (path/identifier validation suites — traversal, `..`, symlink,
allowlist cases) + `npm run typecheck` (branded/canonical path types at the CLI edge) +
`npm run lint` (`no-shell-injection`-adjacent rules: bans `exec`/`execSync` string forms outside
the CLI edge). NEW check only if coverage is missing: `test/session/path-validation.test.ts`
table-driven cases (allowlist accept/reject × canonicalize × gateway-length), run by the same
`npm run test` — no new command.

## 4. R4 — Collision lock (two sessions, one worktree)

Threat: two concurrent sessions bind the same worktree → two containers race on `realm-<id>`,
mount the same root/volume, or one kills the other's execution. D-D4 already fixes the policy
(one session per worktree, N4); this control makes it a *refusal*, not a convention.

CONTROL R4.1 — *One session per worktree, enforced by lock.* Session binding acquires an atomic
per-worktree lock (daemon-side session record under `<stateDir>` + `LOCK_CONFLICT` on contention)
keyed by canonicalized `workspaceRoot`. A second `up`/attach for the same worktree while a live
session holds the lock refuses `LOCK_CONFLICT` (terminal, not retryable — it is not in
`retryableAttachCodes`, N2 §2.2) and creates no second container. Concurrent sessions are valid
only across *distinct* worktrees (D-D4); Phase 59 multi-attach remains gated out (N4 C5).

CONTROL R4.2 — *Naming-collider refusal.* If the derived `realm-<id>` name or label lookup
collides with a foreign record (container bound to another `workspaceRoot`, or label lookup
returns >1 match), the bind refuses `OPENSHELL_LABEL_AMBIGUOUS` (ambiguous label, never retried —
only the stale-recovery path under `OPENSHELL_START_FAILED` may recover, N3 §0) or `POLICY_DENIED`
(foreign-workspace container, S-02). The collider is never force-reused, renamed-over, or
deleted to make room; the operator resolves it explicitly (`realm down` for the owning session).

CONTROL R4.3 — *Lock lifetime = session lifetime.* The lock releases only on session `stopping →
unbound` (the 9 allowed transitions, N2 §2.1) or on unhealthy auto-recreate handoff (R5), which
transfers — never duplicates — the binding. A crashed holder's lock is reaped by the existing
reap seam (`src/session/reap.ts`) with the same `LOCK_CONFLICT` semantics; reaping never creates
a container by itself (hydration-never-creates, N3 §0). Teardown-never-down still holds: host
exit does not release the lock; only daemon-side session teardown does.

Owner: B (`src/lifecycle/controller.ts`, `src/session/*`, `src/daemon/sessions.ts`).
GATE (existing): `npm run test` (`test/lifecycle/controller.test.ts`,
`test/session/reap.test.ts`, `test/session/workspace-binding.test.ts` — concurrent-bind and
name-collider cases) + `npm run check:breaking` (lock/code catalogue changes are breaking-surface).
NEW check only if missing: a concurrency case in `test/session/workspace-binding.test.ts` (two
parallel binds, same canonical root → exactly one `active`, one terminal `LOCK_CONFLICT`), same
`npm run test` command.

## 5. R5 — Fail-closed health (unhealthy sandbox must not serve)

Threat: an unhealthy leg (Podman down, AgentOS unconfigured, OpenShell gateway silent, mounts
missing) is bypassed "best-effort", routing traffic to a broken sandbox, or the failure response
destroys the worktree's files. N3 §1 (graceful degradation, B 5/5) and the failure taxonomy are
the baseline; this control pins the *pre-attach gate* that B's proofs assume.

CONTROL R5.1 — *Pre-attach health gate, all legs, before attach and before exec.* Before any
host attach or tool exec, the daemon verifies, in order: (1) Podman leg — `podman version` ≥5.x
tier and machine reachable (`PODMAN_MISSING` / `PODMAN_MACHINE_DOWN` /
`PODMAN_UNSUPPORTED_VERSION`); (2) OpenShell leg — gateway answers (`OPENSHELL_GATEWAY_LOST` if
silent); (3) AgentOS leg — driver config bound and supervisor healthy
(`AGENTOS_NOT_CONFIGURED` if no driver bound → *no container ever created*, N3 §0;
`AGENTOS_CRASH_LOOP` on 5th consecutive failure); (4) Mount leg — every R1.3 mount present,
canonicalized, and still inside `policy.workspaceRoots` (`PATH_ESCAPE`/`POLICY_DENIED` if not).
Any leg failing = attach/exec refuses with that leg's catalogue code. **No leg is advisory
during attach**; `warn` is a doctor-only status and never satisfies this gate.

CONTROL R5.2 — *Stop routing unhealthy; keep worktree files.* Once a leg fails post-attach
(runner exit, failed probe, gateway silent, mount vanished), the supervisor holds the session in
`error` with the classified code, never auto-restarts a runner (N3 §0), and stops all routing
(attach refuses retryable `REALM_NOT_ACTIVE`/`TOOL_TIMEOUT` only where the taxonomy allows —
everything else terminal). The worktree files and the named volume are *preserved exactly*:
unhealthy auto-recreate (D-U2) recreates the *container* on next `up` reusing the survivor where
identity checks pass, and never deletes, wipes, or re-inits the worktree root or volume. Delete/
wipe of worktree data requires explicit user-initiated `realm down` with the data-bearing fields
named — there is no automatic cleanup path that touches worktree files (sweep removes only
stale *container/session records*, per `src/runtime/sweep.ts` ownership).

CONTROL R5.3 — *Distinct codes per leg (no new exit codes).* Each leg maps to its existing
catalogue code so operators can tell legs apart without new surface: Podman → `PODMAN_*`,
AgentOS → `AGENTOS_*`, OpenShell → `OPENSHELL_*`, mounts/policy → `PATH_ESCAPE` /
`POLICY_DENIED` / `CREDENTIAL_PATH_DENIED`, contention → `LOCK_CONFLICT`, budget/timeout →
`STARTUP_BUDGET_EXCEEDED` / `DAEMON_START_TIMEOUT` / `TOOL_TIMEOUT`. All surface under the frozen
CLI semantics (`1` refusal, catalogue code on stdout, reason on stderr; `2` only for usage
errors — N2 §2.2). A health failure never exits `0`, never emits partial protocol frames on
stdout (stdio-host frames-only rule, N3 §0), and never degrades to host execution (composition C
remains rejected as a default, N3 §4).

Owner: B (`src/doctor/checks.ts|runtime-checks.ts|checks-host.ts`, `src/runtime/agentos.ts`,
`src/runtime/openshell.ts`, `src/runtime/session-execution.ts` probes, `src/lifecycle/controller.ts`),
C (boot-driver consume-only: respects the daemon refusal, never re-probes around it).
GATE (existing): `npm run test` (doctor `fail`-path + supervisor hold + refusal-code suites) +
`npm run check:gates` (`gate-closure` proves each leg check is registered, so a dropped leg fails
A's gate) + `npm run check:mcp` (mcp-smoke asserts the refusal-before-frames path). Runtime
evidence (N2 §4 B/D, not Unit-A): `node dist/src/cli/main.js doctor --workspace
$WORKTREE` + `status` per-unit commands, plus `podman version` /
`openshell --version` for the runtime tier. NEW check only if missing: `test/doctor/health-gate.test.ts`
asserting each leg's code + "no container created on `AGENTOS_NOT_CONFIGURED`" (already the
`session-execution.ts:460-464` contract) — same `npm run test`.

## 6. R6 — Supply chain (pin or refuse)

Threat: drift between what was tested and what runs — floating base images, unpinned npm deps,
an AgentOS package version that no longer matches the in-sandbox runner, or a host matrix built
from the stale GSD mirror. N1 §6 already records the live probes (Podman 5.7.1 tier, OpenShell
0.1.5, `@rivet-dev/agentos-core 0.4.7`); this control turns those probes into *pins*.

CONTROL R6.1 — *Pinned digests for images.* Every container image reference is pinned by digest
(`image@sha256:…`) in `sandbox/expected-digests.json` and verified at build and at create time by
`check:image-digests`; `sandbox/Dockerfile` builds `FROM <image>@sha256:…` only — no `:latest`,
no unpinned tags. A digest mismatch refuses create (`POLICY_DENIED`-family at the admission seam,
`compute-driver` admission) rather than pulling a replacement. The absent `localhost/realm-agentos`
image (N1 §6, N4 C9) is built by `npm run build:image` with the same pinning, or absent-but-refused
(`AGENTOS_NOT_CONFIGURED`) — never substituted with a floating image.

CONTROL R6.2 — *Pinned versions for runtimes and packages.* (a) npm: `package.json` versions +
`package-lock.json` integrity (lockfile-integrity leg of `check:gates`) are the pin; no
dependency is introduced without a locked, versioned entry. (b) Runtime tier: the ≥5.x Podman
binary path and OpenShell version are recorded in doctor output and refused below tier
(`PODMAN_UNSUPPORTED_VERSION`); bumping them is an explicit, reviewed version change, not an
ambient PATH resolution (P3 stays fallback-only, N3 §2). (c) AgentOS: the in-sandbox runner/probe
version must equal the `@rivet-dev/agentos-core` package version; mismatch refuses
`AGENTOS_NOT_CONFIGURED` rather than running a skewed runner.

CONTROL R6.3 — *Versions recorded where reviewers can see them.* Every build/verify run records
the resolved pin set — image digests (`expected-digests.json`), lockfile hash, Podman/OpenShell/
AgentOS versions (doctor output), and the GSD upstream revision checked against the `runtimes.ts`
mirror (D-U4 / N4 C8 drift check) — in the run's evidence (doctor output / boot-report / CI
artifact). The record is generated, not hand-written: it is the output of the gate commands above,
so a stale record is itself a gate failure.

Owner: A (`sandbox/expected-digests.json`, `scripts/check/verify-image-digests.mjs`,
`scripts/image/build-image.mjs`, `package-lock.json`, CI pinning), B (admission-time digest
enforcement, doctor version recording), C (`src/host/runtimes.ts` mirror + drift evidence only).
GATE (existing, binding): `npm run check:image-digests` (R6.1) + `npm run check:gates`
(`lockfile-integrity` for R6.2a; `gate-closure` for R6.3 doctor registration) +
`npm run build` + `npm run check:pack` (pack-smoke proves the shipped artifact carries the pinned
set) + `npm run check:breaking` (mirror/matrix drift is a breaking-surface change). NEW check
only if missing: test-scoped digest-mismatch refusal case under `npm run test` (fake digest →
create refused, no pull) — same command, no new tooling.

## 7. Gate-binding summary (one row per risk)

| Risk | Owner | Binding gate(s) — Unit-A command(s) verbatim, or smallest new check | Evidence artifact |
|---|---|---|---|
| R1 Isolation | B | `npm run test` + `npm run typecheck` + `npm run check:gates` · new-if-missing: `test/runtime/isolation-profile.test.ts` via same `npm run test` | doctor hardening checks `pass`; launch-profile assertions |
| R2 Secrets | B+C, script by A | NEW (minimal): `node scripts/check/secret-scan.mjs` in `npm run check:gates`, covered by `npm run test:scripts` · existing: `npm run test`, `npm run check:docs` | scan clean on tracked files; `[REDACTED]` in logs; refusal texts carry no content |
| R3 Input validation | B+C | `npm run test` + `npm run typecheck` + `npm run lint` · new-if-missing: `test/session/path-validation.test.ts` via same `npm run test` | table-driven accept/reject + canonicalize + 19-char budget cases |
| R4 Collision lock | B | `npm run test` + `npm run check:breaking` · new-if-missing: concurrency case in `test/session/workspace-binding.test.ts` via same `npm run test` | one `active` + one terminal `LOCK_CONFLICT`; collider refusals |
| R5 Fail-closed health | B (C consumes) | `npm run test` + `npm run check:gates` + `npm run check:mcp` · new-if-missing: `test/doctor/health-gate.test.ts` via same `npm run test` · runtime (N2 §4, not A): `node dist/src/cli/main.js doctor|status --workspace …` | per-leg distinct catalogue codes; no container on `AGENTOS_NOT_CONFIGURED`; worktree files survive recreate |
| R6 Supply chain | A (B enforces, C mirrors) | `npm run check:image-digests` + `npm run check:gates` + `npm run build` + `npm run check:pack` + `npm run check:breaking` | `sandbox/expected-digests.json` verified; lockfile integrity; doctor-recorded versions + GSD drift check |

All "new-if-missing" checks are *test files executed by the existing `npm run test`* (R1, R3, R4,
R5) — the only genuinely new *command* is the R2 secret-scan script, kept to the smallest credible
form (one file, allowlist-by-path, no external dependency). No risk above invents a new catalogue
code, exit code, state name, or boot bound; each maps onto the frozen N2 §2 contracts.

## 8. Assumptions / gaps carried forward (NOT new facts)

| # | Item | Origin |
|---|---|---|
| A1 | Per-worktree name compression inside the 19-char gateway budget (hash of `workspaceRoot`) still has no scheme in code. | N3 §5 A1 — R3.3/R4.2 assume it lands; until then over-long names refuse rather than collide. |
| A2 | Canonical worktree for implementation (main vs `$WORKTREE*`) undecided. | N1 G1 → N4 C10. Controls are stated per canonicalized root, so either choice satisfies them. |
| A3 | All 21 `mcp-config` hosts can consume P2 receipts; per-runtime MCP capability unprobed. | N3 §5 A3. R2/R3 receipt controls assume P2; reversal path is N3 §4 item 2. |
| B1 | Explicit 22-host build list, B3 OpenShell/AgentOS layering verdict, B5 credential presence, B6 Omp-via-`realm host install` confirmation still need owner/design answers before build (N4 §5). | N4 §2/§5. This file's controls do not depend on their answers except host-matrix breadth (R6.3). |
