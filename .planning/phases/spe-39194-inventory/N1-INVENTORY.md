# N1 Inventory — SPE-39194: Inventory repo, GSD Core, and installed stack

Issue: SPE-39194 `n1-inventory-repo-gsd-core-and-installed-stack` — https://linear.app/swcstudio/issue/SPE-39194/n1-inventory-repo-gsd-core-and-installed-stack  
Scope: read-only discovery in `agent-realm` + one output file (this file). No gates/tests/lint/format run. Date: 2026-11-27. Host probe ran on the checkout below; paths are repo-relative unless noted.

## 1) Repo state (FACT)

| Item | Fact | Evidence |
|---|---|---|
| Repo root | `agent-realm` 0.9.9, AGPL-3.0-only, strict ESM TS, Node `>=22.13.0` | `package.json:1-51` |
| Root entries | `.agents/ .claude/ .github/ .planning/ .swarm/ adapters/ assets/ coverage/ dist/ docs/ licenses/ node_modules/ release/ sandbox/ scripts/ site/ src/ test/` + `AGENTS.md CHANGELOG.md CLAUDE.md CONTRIBUTING.md LICENSE NOTICE README.md SECURITY.md eslint.config.js package-lock.json tsconfig.agentos.json tsconfig.json` | `ls -la` 2026-11-27 |
| Branch | `fix/stdio-host-shutdown-log`, tracking `origin/fix/stdio-host-shutdown-log`, HEAD `1946ec5 docs(planning): ship window addenda…`, parent `501940b chore(release): v0.9.9` | `git branch --show-current`, `git log --oneline -3` |
| Dirty tree | 3 modified (`.planning/phases/57-htier-01-attribution-retest/57-VERIFICATION.md`, `.planning/phases/58-kimi-recorder-fix-and-rerun/58-VERIFICATION.md`, `.planning/v9.0-MILESTONE-AUDIT.md`) + 3 untracked SUMMARYs (`56/57/58-SUMMARY.md`); no other changes | `git status --porcelain=v1 -b` |
| Worktrees | 150+ registered incl. `$WORKTREE` (main), `agent-realm-integrate`, `$WORKTREE**`, `$WORKTREE**`, `$WORKTREE**`, `$WORKTREE**`, `$WORKTREE**`, few prunable/detached | `git worktree list --porcelain` |
| Prior discovery docs | `.planning/SANDBOX-n1b-*.md`, `SANDBOX-n2-UNITS.md`–`n7-WAVES.md`, `.planning/UNITY-n1-GROUND-TRUTH.md`–`n7-WAVE-PLAN.md` | `ls .planning/` |
| This phase dir | New: `.planning/phases/spe-39194-inventory/` containing only this `N1-INVENTORY.md` at write time | `ls` |

## 2) Planning state (FACT)

| Item | Fact | Evidence |
|---|---|---|
| STATE header | `milestone: v9.0 Doctor health and concurrent binding, status: Starting, current_phase: 56, progress 5 phases / 2 completed / 40%` | `.planning/STATE.md:1-18` |
| STATE position | Phase 56 carried + verification recorded (`gaps_found`); 57/58 `passed-with-gaps`; milestone audit pending; last activity 2026-11-25 | `.planning/STATE.md:29-34` |
| Current focus | `realm doctor` Omp plugin health check (HEALTH), F-51-1 cause (STOP-05/06), concurrent binding on frozen Phase 53 design gated on owner ratification; HTIER-01 (57) + KIMV-02 (58) retests | `.planning/STATE.md:27` |
| Core value | "Every file mutation by an agent either lands inside the realm under policy or fails closed; the user can always see whether the realm is active or disconnected." | `.planning/STATE.md:26` |
| ROADMAP v9.0 | Phases 55–59 on release line 0.9.x: 55 Omp health, 56 F-51-1, 57 HTIER-01, 58 KIMV-02, 59 concurrent binding (gated) | `.planning/ROADMAP.md:15,29` |
| ROADMAP history | v1.0–v8.0 archived/shipped (v7.0/v8.0 "shipped with accepted limitations"); v1.0–v9.0 narrative lines 5–15; 46/46 v1 reqs + v2.0 + PRD + v3.0 coverage line 17 | `.planning/ROADMAP.md:19-29` |
| Milestone dirs | `.planning/milestones/v1.0-phases/` … `v6.0-phases/` + `vX.0-ROADMAP.md`/`vX.0-MILESTONE-AUDIT.md` | `ls .planning/milestones/` |
| Root planning files | `PROJECT.md (29K) REQUIREMENTS.md (102.7K) ROADMAP.md (139.3K) STATE.md (147.2K) MILESTONE-CONTEXT.md MILESTONES.md config.json (2.0K) state.json (7.5K) quick/ baseline/ intel/` | `ls .planning/` |

### CONTEXT/PLAN/SUMMARY per active phase (FACT, `ls` per dir)

| Phase dir | CONTEXT | PLAN | SUMMARY | Other |
|---|---|---|---|---|
| `12-scripted-provider…` | — | `12-02-PLAN.md 12-03-PLAN.md` | — | `12-REVIEW.md` |
| `25-host-adapters-wave-2…` | `25-CONTEXT.md` | — | — | `25-VERIFICATION.md` |
| `45-omp-responsiveness…` | `45-CONTEXT.md` | `45-01..04-PLAN.md` (4) | `45-01..04-SUMMARY.md` (4) | DESIGN/FEASIBILITY/MEASUREMENT/RESOLUTION/VERIFICATION |
| `46-rapid-stop-then-up` | `46-CONTEXT.md` | `46-01..04-PLAN.md` | `46-01..04-SUMMARY.md` | EVIDENCE/SECOND-WINDOW/VERIFICATION |
| `47-legacy-kimi…` | `47-CONTEXT.md` | `47-01..04-PLAN.md` | `47-01..04-SUMMARY.md` | VERIFICATION/WINDOW |
| `48-grok-attribution…` | `48-CONTEXT.md` | `48-01..04-PLAN.md` | `48-01..04-SUMMARY.md` | VERIFICATION/WINDOW |
| `49-omp-calibration-repeat` | `49-CONTEXT.md` | `49-PLAN.md` | `49-SUMMARY.md` | CALIBRATION/MEASUREMENT/RESOLUTION/VERIFICATION |
| `50-grok-harness-fix…` | `50-CONTEXT.md` | `50-PLAN.md` | `50-SUMMARY.md` | VERIFICATION/WINDOW |
| `51-rapid-stop-then-up-repeat` | `51-CONTEXT.md` | `51-PLAN.md` | `51-SUMMARY.md` | EVIDENCE/VERIFICATION |
| `52-legacy-kimi-cause` | `52-CONTEXT.md` | `52-PLAN.md` | `52-SUMMARY.md` | VERIFICATION |
| `53-concurrent-binding-design` | `53-CONTEXT.md` | `53-PLAN.md` | `53-SUMMARY.md` | DESIGN/VERIFICATION |
| `54-snapshots-design` | `54-CONTEXT.md` | `54-PLAN.md` | `54-SUMMARY.md` | DESIGN/VERIFICATION |
| `55-omp-plugin-health-check` | `55-CONTEXT.md` | `55-PLAN.md` | — | VERIFICATION |
| `56-f-51-1-cause` | `56-CONTEXT.md` | `56-PLAN.md` | `56-SUMMARY.md` (untracked) | EVIDENCE/WINDOW/VERIFICATION + VERIFICATION-UPDATE-20261127 |
| `57-htier-01-attribution-retest` | `57-CONTEXT.md` | `57-PLAN.md` | `57-SUMMARY.md` (untracked) | WINDOW/VERIFICATION + UPDATE-20261127 |
| `58-kimi-recorder-fix-and-rerun` | `58-CONTEXT.md` | `58-PLAN.md` | `58-SUMMARY.md` (untracked) | EVIDENCE/WINDOW/VERIFICATION + UPDATE-20261127 |
| `59-concurrent-binding-implementation` | `59-CONTEXT.md` | `59-PLAN.md` | — | VERIFICATION |
| `RECOVERY-2026-10-31.md` | — (35.1K) | — | — | maps 52 reqs to code units/evidence |

Earlier phases (1–11, 13–24, 26–44) live only under `.planning/milestones/*/v*-phases/`; not enumerated per-file here.

## 3) In-repo code and quality tooling (FACT — exact paths)

| Domain | Paths | Role |
|---|---|---|
| Sandbox / Podman / OpenShell / AgentOS | `sandbox/Dockerfile sandbox/expected-digests.json sandbox/resolv.conf`; `src/runtime/podman-probe.ts src/runtime/podman-version.ts src/runtime/libpod-client.ts src/runtime/libpod-routes.ts src/runtime/openshell.ts src/runtime/agentos.ts src/runtime/agentos-driver.ts src/runtime/agentos-probe.ts src/runtime/agentos-runner.ts src/runtime/agentos-workload.ts src/runtime/hardening.ts src/runtime/session-execution.ts src/runtime/driver/` (`compute-driver*.ts admission.ts channel.ts grpc-status.ts isolation/launch.ts`); `src/daemon/` (`daemon.ts sessions.ts startup.ts seams.ts client.ts main.ts`); `src/lifecycle/controller.ts src/lifecycle/bounds.ts`; `src/runtime/config.ts src/runtime/config-file.ts src/runtime/egress.ts src/runtime/sweep.ts src/runtime/teardown-stages.ts` | Runtime, hardening (14 checks), compute-driver gRPC, lifecycle |
| Omp plugin | `src/omp/plugin.ts (42.8K) src/omp/extension.ts src/omp/tools.ts src/omp/host-tools.ts src/omp/status-paint.ts src/omp/status-render.ts src/omp/advisory-render.ts`; `adapters/omp/`; `package.json:30-34` (`omp.extensions: ./dist/src/omp/extension.js`) | Reference plugin; `realm host install omp` installs it |
| Host plugin contract / boot | `src/host/types.ts src/host/manifest.ts src/host/runtimes.ts src/host/boot.ts src/host/boot-driver.ts src/host/boot-observer.ts src/host/boot-report.ts src/host/adapter.ts src/host/attach.ts src/host/presence.ts src/host/recipe.ts src/host/install.ts src/host/capabilities.ts src/host/env.ts src/host/toml-owned.ts src/host/toml-table.ts src/host/yaml-owned.ts src/host/yaml-scan.ts src/host/host-audit.ts src/host/receipt.ts src/host/refusal-hint.ts`; `src/cli/host.ts src/cli/stdio-host.ts src/cli/stdio-settle.ts src/cli/main.ts` | Host-neutral contract; 22-host table; boot bounds; install engine |
| Doctor / CLI | `src/doctor/checks.ts src/doctor/checks-host.ts src/doctor/runtime-checks.ts src/doctor/capability-checks.ts`; `src/cli/checkpoint.ts src/cli/init.ts`; `dist/src/cli/main.js` (bin `realm`); `src/daemon/main.ts` | `realm doctor/init/up/down/status/mcp/acp/checkpoint` |
| MCP/ACP/tools | `src/mcp/server.ts src/acp/ src/tools/ src/capability/ src/session/ src/core/ src/contract/` | Single dispatcher behind MCP+ACP; `realm mcp` cold-attach |
| Host adapters | `adapters/claude-plugin/ adapters/muse-code/ adapters/hermes-agent/ adapters/prime-agent/ adapters/omp/` (+ `docs/hosts/snippets/`, `docs/integration/hosts.md`) | Per-host bundles/snippets |
| Quality scripts | `package.json:52-70` — `typecheck lint test test:integration test:coverage test:scripts check:docs check:mcp check:pack check:image-digests check:gates check:breaking build build:image release:next/sync/changelog`; `scripts/check/` (gate-closure, module-size, export-usage-gate, lockfile-integrity, breaking-change-guard, coverage, host-paths, agents-sync, default-mode, mcp-smoke, pack-smoke, verify-image-digests + `.test.mjs` twins); `scripts/image/build-image.mjs`; `eslint.config.js (16.6K) tsconfig.json tsconfig.agentos.json` | Gate command set; no gsd-tools invocation in scripts |
| CI | `.github/workflows/ci.yml (42.5K, ubuntu-24.04, verify/site/audit on PR, build/publish on main)` `.github/workflows/{breaking-change-guard,mutation,pages,rollback}.yml` | No self-hosted pool (removed 2026-11-16) |

## 4) GSD-Core repo (FACT — highest-confidence source per clarification)

| Item | Fact | Evidence |
|---|---|---|
| URL | `https://github.com/open-gsd/gsd-core/` — 11,901 stars / 859 forks, MIT, JS, npm `@opengsd/gsd-core` | GitHub repo page fetched 2026-11-27 |
| Install entry | `npx @opengsd/gsd-core@latest [--<runtime> --global\|--local]`; Node.js 24+ npm 10+ required; per-runtime `*_CONFIG_DIR` overrides | `docs/how-to/install-on-your-runtime.md` |
| Supported runtimes (upstream doc headings) | Claude Code, OpenCode, Codex, Copilot, Cursor, Windsurf/Devin Desktop, Cline, CodeBuddy, Qwen Code, Augment Code, Antigravity, Trae, ZCode, Hermes Agent, pi (+ Gemini-era notes) | `docs/how-to/install-on-your-runtime.md:300-693` |
| Realm mirror (in-repo) | 22 hosts = 18 GSD flags + `omp` (reference) + `muse-code, prime-agent, grok-build` (Realm-only, Phase 40): `omp claude opencode kilo codex copilot antigravity cursor windsurf augment trae qwen hermes codebuddy cline kimi kimi-code zcode pi muse-code prime-agent grok-build`; source cited `21-DISCOVERY.md (commit 69d604e, 2026-11-16)`; no `gemini` (retired), no `vscode` (not installable) | `src/host/types.ts:13-36`, `src/host/runtimes.ts:1-3` |
| GSD plugin-on-boot contract (upstream) | Installer writes skills/agents/commands + lifecycle hooks per runtime; `SessionStart` hook = update-check + session orientation (`gsd-check-update.js`, `gsd-session-state.sh`); `PreToolUse`/`PostToolUse`/`Stop`/`PreCompact`/`SubagentStart|Stop` hooks (context monitor, prompt/read/worktree guards, phase-boundary, graphify); global-vs-local shadowing advisory (W028); restart runtime after install | `docs/how-to/install-on-your-runtime.md` (Claude/CodeBuddy/Qwen/Augment/Hermes sections) |
| Realm plugin-on-boot contract (in-repo) | Host-neutral `resolveBoot(manifest) → ResolvedBoot` in `src/host/boot.ts`: defaults `enabled:true, startupBudgetMs:200_000, guardStatusBudgetMs:5_000, statusPollMs:2_000, reattach{enabled:false,retryCap:8,base:1_000,cap:60_000}`, `linkLost=[REALM_NOT_ACTIVE,TOOL_TIMEOUT]`, `retryableAttach=[+STARTUP_BUDGET_EXCEEDED,DAEMON_START_TIMEOUT]`; Omp is the reference consumer (`src/omp/plugin.ts`); `src/host/boot-driver.ts` is the stdio (MCP/ACP) production driver; `boot-report.ts` daemon-side audit+metrics; teardown never sends `down` | `src/host/boot.ts:1-60`, `src/host/boot-driver.ts` |
| Repo-level GSD footprint | `.planning/` consumed by `gsd-tools` (state.json/roadmap); `.claude/` + `.agents/` present; no `gsd-core/` engine dir in this checkout | `ls -a`, `.planning/config.json` |

## 5) Installed probes (FACT, 2026-11-27)

| Tool | `command -v` | Version / probe | Exit |
|---|---|---|---|
| Podman (PATH) | `/usr/bin/podman` | `podman version 4.9.3` | 0 |
| Podman (alt) | `/usr/local/bin/podman` | `podman version 5.7.1` — ≥5.x live tier available off-PATH | 0 |
| OpenShell | `/usr/bin/openshell` | `openshell 0.1.5` | 0 |
| AgentOS CLI | `ABSENT` (no `agentos` binary) | `@rivet-dev/agentos-core 0.4.7` in `node_modules`; in-sandbox runner/probe compiled from source | n/a |
| Omp | `$HOME/.local/bin/omp` | `omp/19.2.1` | 0 |
| Hermes | `$HOME/.local/bin/hermes` | `Hermes Agent v0.23.1 (2026.9.24) · stable · local 3b4215785882` (`--help` usage OK) | 0 |
| Muse Code | `$HOME/.local/bin/muse` | `Muse Code 1.4.25 (1.4.25-R9361.1)` | 0 |
| Grok Build | `/usr/bin/grok` | `grok 1.0.89 (28be5bb1bf65) [stable]` | 0 |
| Claude Code | `/usr/bin/claude` | `2.1.322 (Claude Code)` | 0 |
| Codex | `/usr/bin/codex` | `codex-cli 0.154.0` | 0 |
| realm | `ABSENT` | `realm: command not found` — use `node dist/src/cli/main.js` | 127 |
| node/npm/gh/bun | `/usr/bin/node /usr/bin/npm /usr/bin/gh $HOME/.local/share/reflex/bun/bin/bun` | node/npm OK (engines `>=22.13.0`) | 0 |

## 6) Host facts (FACT, 2026-11-27)

| Item | Fact | Evidence |
|---|---|---|
| OS/kernel | `Linux vps 6.8.0-149-generic #149-Ubuntu SMP PREEMPT_DYNAMIC … x86_64` — Ubuntu 24.04.4 LTS (Noble) | `uname -a`, `/etc/os-release` |
| Shell / init | `$SHELL` empty in this shell; PID 1 = `systemd` | `env`, `ps -p 1` |
| Podman info (PATH 4.9.3) | `arch: amd64, os: linux, conmon 2.1.10, aardvark-dns 1.4.0, netavark 1.4.0, crun 1.14.1`; default-path Podman is BELOW the 5.x OpenShell/live requirement | `podman info` |
| Images | `localhost/autonogrammer-api:ci-local/:local, localhost/omp-deps:check/:tmp, alpine:latest/:3, node:22/:22-slim, mcr.microsoft.com/dotnet/{aspnet,sdk}`, `dragonflydb:v1.27.1`, `timescale/timescaledb:2.13.1-pg16`; **no `localhost/realm-agentos` image** in default-path list | `podman images` (both binaries, same store) |
| Sizes | `node_modules 846M`, `dist 16M`, `coverage/lcov.info 442K` | `du -sh` |

## 7) Clarifications as given — treated as decisions (not re-derived)

| Decision | Value | Effect on inventory |
|---|---|---|
| Trackers | Linear "Spectrum Web Co" workspace + Notion collection `be3418…` configured | Tracking rows exist outside this repo; not re-verified here |
| Teardown | Auto-recreate (teardown is non-final; next up recreates) | `realm down`/`teardown` never permanent; boot-report teardown-never-down holds |
| Boot scope | Global, all hosts | Install = `--global` for every supported runtime; no per-project opt-in |
| GSD repo | `github.com/open-gsd/gsd-core` is highest-confidence source | Section 4 above is canonical; in-repo `runtimes.ts` is a dated mirror (2026-11-16) |

## 8) Assumptions / gaps (NOT facts — separated)

| # | Assumption or gap | Why it is not a fact |
|---|---|---|
| A1 | The 52-req mapping / "live window" state in STATE recovery boundaries is current — it is a long historical snapshot string, truncated at line 46-46; verbatim re-read was capped | Lines truncated to 768 chars; raw `--` reads pending if a later node needs exact wording |
| A2 | `/usr/local/bin/podman 5.7.1` is the same store/graph-driver as PATH 4.9.3 — image list matched today, but driver/graph not compared | `podman info` full dump not diffed per binary |
| A3 | GSD runtime list at HEAD == the 18 flags mirrored in `runtimes.ts` — upstream HEAD may have drifted since the 2026-11-16 mirror | Only installer doc page fetched; no per-flag HEAD diff |
| A4 | `realm` absence from PATH means uninstalled vs. dist-only consumption — `dist/` is built (16M) but no `npm link`/global bin probe done | Probe limited to `command -v` + `--version` |
| A5 | Notion collection id `be3418…` and Linear workspace state were NOT verified in this run (no MCP/Linear read) | Given as clarification only |
| G1 | Open question for the next node: which of the 150+ worktrees is canonical for SPE-39194 implementation? (main checkout vs `$WORKTREE*`) | Inventory-only run; no checkout decision taken |
| G2 | Open question: is the Realm "plugin-on-boot" deliverable an install-time recipe only (GSD-style hooks) or also a `realm host`-managed stateful attach (boot-driver)? Both exist in-repo; scope is "global all" per clarification | Design decision for the build node |
| G3 | Hermes `--version` prints nothing on stdout (version came from `--version` long probe `v0.23.1` line) — exit 0 either way | Cosmetic probe quirk, no effect |
