# Phase 21 discovery (read-only, 2026-11-17)

## Existing host integrations (evidence)
- Omp (reference): `src/omp/extension.ts` (edge: env read once, builds `attachDaemon` = ensureDaemon + startDetachedDaemon + connectDaemon + `client.up()`), `src/omp/plugin.ts` (`registerRealmPlugin`: session_start/session_switch/session_shutdown/tool_call hooks, retry command, five Realm tools, status paint, guard), `src/omp/host-tools.ts` (fail-closed removal of host tools plus tool_call backstop), `src/omp/reattach.ts` (bounded re-attach, cap 8, equal-jitter backoff). No `down` from the plugin: it closes its client only; the sandbox lasts until `realm down`.
- `adapters/{claude-plugin,hermes-agent,muse-code,prime-agent}`: each connects through `realm mcp` (stdio); none declares ACP; `realm acp` exists separately. Evidence tier 2 (host validator or isolated install passes); only Omp has live evidence. Manifest formats differ per host (`.claude-plugin/plugin.json`, Hermes `plugin.json` plus `mcp.json`, `.muse-plugin/plugin.json`, Prime package install plus `prime-agent mcp add`). `scripts/check/pack-smoke.mjs` asserts the files; no unit tests cover the bundles.

## Contract seams to abstract from Omp
attach(daemon) with startup budget, status readback and paint, host-tool plan by policy mode, guard backstop, retry command, shutdown closes client only, bounded re-attach rules.

## Enterprise baseline reusable by the contract
Redaction (`src/audit/redact.ts`), structured logger (`src/observe`), policy shape and pure gates (`src/core/policy.ts`: roots, credential allow, egress, shell), hash-chained audit (`src/audit/*`, anchored to session id), doctor checks (`src/doctor`). Gaps: no plugin-facing capability catalog; audit chain is per session, not per plugin; doctor has no plugin checks.

## GSD Core supported runtimes (source for phases 24 and 25)
Source: github.com/open-gsd/gsd-core default branch `next`, commit `69d604ebf8cf4190dcd596962ac6fc05cfbace72` (2026-11-16), package 1.21.0, `src/runtime-name-policy.cts`, `src/runtime-homes.cts`, `docs/how-to/install-on-your-runtime.md`; retrieved 2026-11-17. This supersedes the earlier list taken from `main`.
Installer flags: `--claude` (default), `--opencode`, `--kilo`, `--codex`, `--copilot`, `--antigravity`, `--cursor`, `--windsurf` (alias `--devin-desktop`), `--augment`, `--trae`, `--qwen`, `--hermes`, `--codebuddy`, `--cline`, `--kimi`, `--kimi-code`, `--zcode`, `--pi`. Gemini is retired (sunset 2026-06-18, issue 1928). `vscode` is registered but not installable.
Config homes (global, env override): claude `~/.claude` (CLAUDE_CONFIG_DIR); opencode `~/.config/opencode`; kilo `~/.config/kilo` or `~/.kilo`; codex `~/.codex`; copilot `~/.copilot`; cursor `~/.cursor`; windsurf `~/.codeium/windsurf`; augment `~/.augment`; trae `~/.trae`; qwen `~/.qwen`; hermes `~/.hermes`; codebuddy `~/.codebuddy`; cline `~/.cline`; kimi skills `~/.config/agents`, hooks `~/.kimi/config.toml`; kimi-code `~/.kimi-code`; zcode `~/.zcode`; pi `~/.pi/agent` (extension `extensions/gsd.js`).

## Decisions carried in
Plugin loads into each CLI agent; Omp plus Claude Code, OpenCode, Codex and Kimi CLI proven end to end, the rest config-only; Enterprise-Ready = existing logging, redaction, least-privilege and audit chain.
