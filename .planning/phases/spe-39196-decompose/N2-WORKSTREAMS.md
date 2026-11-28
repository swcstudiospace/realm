# N2 Workstreams — SPE-39196: Decompose into file-disjoint workstreams

Issue: SPE-39196 `n2-decompose-into-file-disjoint-workstreams` — https://linear.app/swcstudio/issue/SPE-39196/n2-decompose-into-file-disjoint-workstreams  
Input: `.planning/phases/spe-39194-inventory/N1-INVENTORY.md` (sole file map). No gates/tests/lint/format run. Date: 2026-11-28.

## 0) Global decisions (from N1 §7, user-answered — not re-derived)

- **Boot scope = global, all hosts.** Install is `--global` for every supported runtime; no per-project opt-in.
- **Teardown = auto-recreate.** `realm down`/`teardown` is non-final; the next `up` recreates. Boot-report invariant "teardown never sends `down`" holds.
- **GSD source of truth** = `github.com/open-gsd/gsd-core` (upstream installer doc); in-repo `src/host/runtimes.ts` is a dated mirror (2026-11-16, commit `69d604e`).

## 1) Units (file-disjoint; every N1-cited path assigned to exactly one unit)

| Unit | Scope | Files owned (exact, from N1) |
|---|---|---|
| **A — quality** | Lint/typecheck/format/build/test configs + flagged files; CI; quality scripts; build artifacts | `package.json` (incl. `:30-34` `omp.extensions` — owned once, read-only by D) `eslint.config.js` `tsconfig.json` `tsconfig.agentos.json` `scripts/check/*` (gate-closure, module-size, export-usage-gate, lockfile-integrity, breaking-change-guard, coverage, host-paths, agents-sync, default-mode, mcp-smoke, pack-smoke, verify-image-digests + `.test.mjs` twins) `scripts/image/build-image.mjs` `dist/src/cli/main.js` (build artifact) `.github/workflows/ci.yml` `.github/workflows/{breaking-change-guard,mutation,pages,rollback}.yml` `AGENTS.md` `CLAUDE.md` `CONTRIBUTING.md` `README.md` `SECURITY.md` `CHANGELOG.md` `LICENSE` `NOTICE` `package-lock.json` `.planning/config.json` `docs/` (non-host docs) `site/` `test/` (quality harnesses only) |
| **B — sandbox lifecycle** | Podman/OpenShell/AgentOS runtime + hardening + daemon/lifecycle + worktree lifecycle; frozen cross-unit contracts | `sandbox/Dockerfile` `sandbox/expected-digests.json` `sandbox/resolv.conf` `src/runtime/podman-probe.ts` `src/runtime/podman-version.ts` `src/runtime/libpod-client.ts` `src/runtime/libpod-routes.ts` `src/runtime/openshell.ts` `src/runtime/agentos.ts` `src/runtime/agentos-driver.ts` `src/runtime/agentos-probe.ts` `src/runtime/agentos-runner.ts` `src/runtime/agentos-workload.ts` `src/runtime/hardening.ts` `src/runtime/session-execution.ts` `src/runtime/driver/compute-driver*.ts` `src/runtime/driver/admission.ts` `src/runtime/driver/channel.ts` `src/runtime/driver/grpc-status.ts` `src/runtime/driver/isolation/launch.ts` `src/runtime/config.ts` `src/runtime/config-file.ts` `src/runtime/egress.ts` `src/runtime/sweep.ts` `src/runtime/teardown-stages.ts` `src/daemon/daemon.ts` `src/daemon/sessions.ts` `src/daemon/startup.ts` `src/daemon/seams.ts` `src/daemon/client.ts` `src/daemon/main.ts` `src/lifecycle/controller.ts` `src/lifecycle/bounds.ts` `src/core/errors.ts` `src/core/states.ts` `src/core/policy.ts` `src/core/status.ts` `src/core/state-machine.ts` `src/contract/` `src/capability/` `src/session/` `src/tools/` `src/mcp/server.ts` `src/acp/` `src/doctor/checks.ts` `src/doctor/checks-host.ts` `src/doctor/runtime-checks.ts` `src/doctor/capability-checks.ts` `src/doctor/fix.ts` `src/doctor/host-checks.ts` `src/cli/checkpoint.ts` `src/cli/init.ts` `src/cli/anchor.ts` `src/cli/audit.ts` |
| **C — plugin-on-boot** | Per-agent boot adapters/manifests (one per GSD-Core agent, incl. Omp/Hermes/Muse/Grok/Claude/Codex) + discovered list; host-neutral boot/install contract | `src/host/types.ts` `src/host/manifest.ts` `src/host/runtimes.ts` `src/host/boot.ts` `src/host/boot-driver.ts` `src/host/boot-observer.ts` `src/host/boot-report.ts` `src/host/adapter.ts` `src/host/attach.ts` `src/host/presence.ts` `src/host/recipe.ts` `src/host/install.ts` `src/host/capabilities.ts` `src/host/env.ts` `src/host/toml-owned.ts` `src/host/toml-table.ts` `src/host/yaml-owned.ts` `src/host/yaml-scan.ts` `src/host/host-audit.ts` `src/host/receipt.ts` `src/host/refusal-hint.ts` `src/cli/host.ts` `src/cli/stdio-host.ts` `src/cli/stdio-settle.ts` `src/cli/main.ts` `adapters/claude-plugin/` `adapters/muse-code/` `adapters/hermes-agent/` `adapters/prime-agent/` `docs/hosts/snippets/` `docs/integration/hosts.md` + boot manifest/recipe rows for the remaining 17 discovered agents |
| **D — Omp proof** | Non-secret config + validation script + evidence only (no runtime logic) | `src/omp/plugin.ts` `src/omp/extension.ts` `src/omp/tools.ts` `src/omp/host-tools.ts` `src/omp/status-paint.ts` `src/omp/status-render.ts` `src/omp/advisory-render.ts` `adapters/omp/` `.claude/` `.agents/` (Omp-relevant entries) `.planning/phases/spe-39194-inventory/N1-INVENTORY.md` (read-only reference) `.planning/phases/spe-39196-decompose/N2-WORKSTREAMS.md` (this file) |

Disjointness rules:

- `package.json` → **A** only. D reads `package.json:30-34` (`omp.extensions: ./dist/src/omp/extension.js`); D never edits it.
- `src/cli/main.ts` → **C** only (host/stdio dispatch). B health is read via daemon socket + `realm status`/`realm doctor` output, not by editing `main.ts`.
- `src/omp/*` + `adapters/omp/` → **D** only. C owns the boot *contract* (`src/host/boot.ts` aggregates `BOOT_BOUNDS`); D consumes it and holds no copy of a bound.
- `src/daemon/*` → **B** only. C's `boot-driver.ts` dials the daemon; it never owns daemon code.
- Planning/history (`.planning/STATE.md` `ROADMAP.md` `PROJECT.md` `REQUIREMENTS.md` `MILESTONES.md` `MILESTONE-CONTEXT.md` `state.json` `quick/` `baseline/` `intel/` `.planning/milestones/v1.0-phases/`…`v6.0-phases/` `.planning/SANDBOX-n1b-*.md` `.planning/SANDBOX-n2-UNITS.md`…`n7-WAVES.md` `.planning/UNITY-n1-GROUND-TRUTH.md`…`n7-WAVE-PLAN.md` per-phase `CONTEXT/PLAN/SUMMARY/VERIFICATION` dirs `RECOVERY-2026-10-31.md`) are **read-only evidence** for all units; only D writes the two phase files above. No unit edits planning history.

### C — per-agent boot adapters (22 discovered, one manifest each)

Source (frozen): `HOST_IDS` in `src/host/types.ts:13-36` = 22 = 18 GSD flags + `omp` (reference) + `muse-code, prime-agent, grok-build` (Realm-only, Phase 40). No `gemini` (retired), no `vscode` (not installable).

| # | Host ID | Flag / evidence (N1 §4–5) | Adapter home |
|---|---|---|---|
| 1 | `omp` | reference, `omp/19.2.1` at `$HOME/.local/bin/omp`; `adapters/omp/` | **D** (`adapters/omp/` + `src/omp/*`) + C contract rows |
| 2 | `claude` | `claude 2.1.322` at `/usr/bin/claude`; `CLAUDE_CONFIG_DIR` | `adapters/claude-plugin/` |
| 3 | `opencode` | `XDG_CONFIG_HOME/opencode` | C recipe row |
| 4 | `kilo` | `XDG_CONFIG_HOME/kilo` | C recipe row |
| 5 | `codex` | `codex-cli 0.154.0` at `/usr/bin/codex` | C recipe row |
| 6 | `copilot` | GSD flag | C recipe row |
| 7 | `antigravity` | GSD flag | C recipe row |
| 8 | `cursor` | GSD flag | C recipe row |
| 9 | `windsurf` | GSD flag | C recipe row |
| 10 | `augment` | GSD flag | C recipe row |
| 11 | `trae` | GSD flag | C recipe row |
| 12 | `qwen` | GSD flag | C recipe row |
| 13 | `hermes` | `Hermes Agent v0.23.1` at `$HOME/.local/bin/hermes`; `adapters/hermes-agent/` | `adapters/hermes-agent/` |
| 14 | `codebuddy` | `CODEBUDDY_CONFIG_DIR` | C recipe row |
| 15 | `cline` | GSD flag | C recipe row |
| 16 | `kimi` | GSD flag | C recipe row |
| 17 | `kimi-code` | GSD flag | C recipe row |
| 18 | `zcode` | GSD flag | C recipe row |
| 19 | `pi` | GSD flag | C recipe row |
| 20 | `muse-code` | `Muse Code 1.4.25` at `$HOME/.local/bin/muse`; `adapters/muse-code/` | `adapters/muse-code/` |
| 21 | `prime-agent` | Realm-only; `adapters/prime-agent/` | `adapters/prime-agent/` |
| 22 | `grok-build` | `grok 1.0.89` at `/usr/bin/grok` | C recipe row |

Unit C deliverable = one boot manifest/boot-hook entry per row above (21 recipe/manifest rows in C + Omp's in D), all resolving through `resolveBoot(manifest) → ResolvedBoot`, all installed `--global`.

## 2) Frozen shared contracts (B owns; C and D consume unchanged)

### 2.1 State names

- Lifecycle `State` (`src/core/states.ts`): `unbound | connecting | active | error | stopping`. Allowed transitions (9): `unbound→connecting`, `connecting→{active,error,stopping}`, `active→{error,stopping}`, `error→{connecting,stopping}`, `stopping→unbound`. No self-transitions; no `degraded`.
- Boot link sub-state `BootLink`/`HostLinkStatus.link` (`src/host/types.ts`, `src/host/boot.ts`): `off | linked | reconnecting | attaching | failed`. Status paint keeps six names: `linked`=active, `attaching|reconnecting`=connecting, `failed`=error.
- Boot event phases (`HostBootEvent.phase`): `attached | refused | failed | link-lost | reattached | closed`.

### 2.2 Exit codes

- CLI (`src/cli/*`): `0` = ok (JSON on stdout where applicable); `1` = refusal/failure (catalogue code on stdout, reason on stderr); `2` = usage error.
- Error catalogue (`src/core/errors.ts`, 29 codes, exact): `REALM_UNBOUND REALM_NOT_ACTIVE REALM_STOPPING REALM_INVALID_TRANSITION STARTUP_BUDGET_EXCEEDED DAEMON_START_TIMEOUT TOOL_TIMEOUT PODMAN_MISSING PODMAN_MACHINE_DOWN PODMAN_UNSUPPORTED_VERSION OPENSHELL_START_FAILED OPENSHELL_LABEL_AMBIGUOUS AGENTOS_CRASH_LOOP AGENTOS_NOT_CONFIGURED AGENTOS_STOP_FAILED POLICY_DENIED PATH_ESCAPE CREDENTIAL_PATH_DENIED LOCK_CONFLICT SANDBOX_NAME_IN_USE WRITE_NOT_ATOMIC EGRESS_DENIED SHELL_NOT_ALLOWED SCHEMA_INVALID AUDIT_WRITE_FAILED MCP_INPUT_FAILED CLEANUP_FAILED AUDIT_OUTCOME_UNKNOWN OPENSHELL_GATEWAY_LOST`.
- Boot code lists (`src/host/boot.ts:BOOT_BOUNDS`): `linkLostCodes = [REALM_NOT_ACTIVE, TOOL_TIMEOUT]`; `retryableAttachCodes = [REALM_NOT_ACTIVE, TOOL_TIMEOUT, STARTUP_BUDGET_EXCEEDED, DAEMON_START_TIMEOUT]`. Everything else is terminal (incl. `POLICY_DENIED`).

### 2.3 Environment variables

- Config homes: `HOME`, `XDG_CONFIG_HOME` (+ `<sub>` per host, e.g. `opencode`, `kilo`, `muse`), per-runtime `*_CONFIG_DIR` overrides (`CLAUDE_CONFIG_DIR`, `CODEBUDDY_CONFIG_DIR`, … per `src/host/runtimes.ts`). `src/host` never reads `process.env`; `HostEnv` is filled at the CLI edge.
- Driver pin: `REALM_DRIVER_*` digest-pin vars (read by driver + `src/doctor/checks-host.ts`; fallback identical). `REALM_ANCHOR_KEY_FILE` (`--publish` only).
- Boot bounds (frozen defaults, `src/host/boot.ts:BOOT_BOUNDS`): `enabled:true, startupBudgetMs:200_000, guardStatusBudgetMs:5_000, statusPollMs:2_000, reattach{enabled:false, retryCap:8, baseDelayMs:1_000, capDelayMs:60_000}`.

### 2.4 Health output

- `CheckResult` (`src/doctor/checks.ts`): `{ id: string, status: "pass"|"warn"|"fail", detail: string, fix: string|null }`; `fix` is null only when `pass`. `realm doctor [--workspace <abs> | --fix [--dry-run]]` prints the list; `realm status|up|down|metrics` for lifecycle.
- `HostLinkStatus` (`src/host/types.ts:198-203`): `{ state: State, mode: PolicyMode|null, link: "off"|"linked"|"reconnecting"|"attaching"|"failed", code?: ErrorCode }`. Daemon logs: `<stateDir>/daemon.log`, `<stateDir>/requests.log`, `<stateDir>/audit/<sessionId>.jsonl`.

### 2.5 Worktree addressing

- All paths absolute. Main checkout: `$WORKTREE`; integration: `agent-realm-integrate`; fleet: `$WORKTREE**`, `$WORKTREE**`, `$WORKTREE**`, `$WORKTREE**`, `$WORKTREE**` (150+ registered, few prunable/detached; `git worktree list --porcelain`).
- `workspaceRoot` must be absolute and inside `policy.workspaceRoots` (`bindRoot`, else `POLICY_DENIED`/`PATH_ESCAPE`). `stateDir` = `<XDG_CONFIG_HOME|HOME>/<realm config>`; socket under `<stateDir>/run` (`controlSocketPath`).
- Canonical worktree for SPE-39194 implementation is **G1 (open)** — default is the main checkout until G1 is resolved; no unit edits another worktree.

## 3) Contract order

**B → C → D.** B freezes §2 first; C implements the 22 boot adapters/manifests against §2; D proves Omp against B+C (non-secret config + validation + evidence only). **A is parallel** (configs/tooling only; never owns a runtime contract; edits nothing in B/C/D).

## 4) Verification commands (attached per unit; not run in this node)

- **A:** `npm run typecheck && npm run lint && npm run build && npm test` (plus `npm run test:scripts`, `npm run check:docs`, `npm run check:gates` as flagged).
- **B:** `node dist/src/cli/main.js doctor --workspace $WORKTREE` and `node dist/src/cli/main.js status --workspace $WORKTREE`; plus `podman version`, `openshell --version` for the runtime tier.
- **C:** `node dist/src/cli/main.js host status <host-id>` per discovered host (22×); `--global` install drift check per host.
- **D:** `omp --version`, `node dist/src/cli/main.js doctor --workspace $WORKTREE`, `node dist/src/cli/main.js host status omp` — evidence file only, no secrets.

*No gates were run in this node (per assignment: SKIP gates/tests/format).*
