# Phase 21: Host plugin contract and installer - Context

**Gathered:** 2026-11-17, from `21-DISCOVERY.md` (read-only repo discovery, same date) and the owner-approved scope below.
**Status:** Planned (four plans, nothing executed). Requirement IDs HOST-01..HOST-09 are defined in the plans and are not yet in `.planning/REQUIREMENTS.md`; the orchestrator registers them with gsd-tools.

<domain>
## Phase Boundary

Realm gets one host-neutral plugin contract in `src/host/` and an installer built on it. The direction is fixed: the plugin loads into each CLI agent (the agent is the host process; Realm is the sandbox it attaches to). Omp is the reference host.

Phase 21 delivers:

1. `HostPluginManifest` (strict, validated), `HostAdapter` (`detect`, `install`, `uninstall`, `status`, `bootHook`), and a capability catalog whose grants map onto the existing policy gates (HOST-01, HOST-02).
2. A declarative per-host table for the 18 GSD Core runtime flags plus the Omp reference entry (HOST-03).
3. The boot-hook port (attach, status, guard, retry, shutdown, bounded re-attach) and a reusable conformance harness (HOST-04).
4. The installer engine: three recipe primitives, atomic and idempotent writes, ownership receipts, dry-run, audit events and redacted logs (HOST-05, HOST-06).
5. The `realm host` subcommands, doctor checks, shipped docs (HOST-07, HOST-08, HOST-09).

Out of scope here, planned elsewhere: refactoring `src/omp/*` onto the contract (Phase 22), wiring hooks into daemon boot (Phase 23), per-host recipes with host-side proof for Claude Code, OpenCode, Codex and Kimi CLI (Phase 24), the remaining runtimes (Phase 25), contract-test packaging and author docs (Phase 26). No Phase 21 task edits `src/omp/**`.
</domain>

<decisions>
## Implementation Decisions

### Owner-approved scope (carried in, not reopened)

- Plugin loads into each CLI agent. Omp is the reference.
- Omp plus Claude Code, OpenCode, Codex and Kimi CLI are proven end to end; every other GSD Core runtime is config-only. Tiers in the table: `reference` (omp), `proven` (claude, opencode, codex, kimi), `config-only` (the rest). "Kimi CLI" is read as the GSD flag `--kimi`; `--kimi-code` stays config-only. [INFERENCE: Phase 24 research confirms this reading before its plan is written.]
- Enterprise-Ready means the existing baseline: redaction (`src/audit/redact.ts`), the structured logger (`src/observe/logger.ts`), least privilege through the policy gates, the hash-chained audit (`src/audit/log.ts`, `src/audit/chain.ts`). No second logging, redaction or audit mechanism is introduced.

### What "proven" means in Phase 21 (honest boundary)

Phase 21 proves the contract and the installer engine against fixture hosts in temporary homes (`node:test`, no real CLI agent touched). It does not prove any real host. The repo holds no config-file evidence for OpenCode, Codex or Kimi CLI, and only validator-tier evidence for Claude Code (`docs/integration/hosts.md` tiers, `adapters/claude-plugin`). So the table's `recipe` field is `null` for every real host in Phase 21, and `realm host install <id>` on such a host refuses with `POLICY_DENIED` and the status `recipe-pending`. Phases 24 and 25 fill recipes from verified evidence. A fabricated recipe is worse than a refusal.

### Contract shape (src/host/)

- `types.ts` holds every type and the id lists, no logic. `HOST_IDS` is the 19 ids. `HostRuntimeEntry` records live in a `Record<HostId, HostRuntimeEntry>`, so a missing host fails compilation (the technique `ERROR_CATALOGUE` in `src/core/errors.ts` uses).
- The manifest is validated by a hand-written strict validator that throws `SchemaInvalidError` (`src/contract/validate.ts`). No new JSON schema file, so the frozen schema set (`policy`, `tools`, `sessionRecord`) and the `package.json` `files` list do not change. Unknown keys are refused. A manifest has no `env` field, so a secret cannot ride in it.
- Two integration kinds: `extension` (code loads in the host process, Omp style) and `mcp-config` (the host launches `realm mcp` over stdio from a config entry, the shape of every file under `adapters/`). Only an `extension` manifest has a `boot` block.
- No new error code. `src/core/errors.ts` is frozen at 31 codes and `test/core/errors.test.ts` pins the count. Mapping used throughout: bad input or unparseable config `SCHEMA_INVALID`; refusal to touch foreign or drifted content, missing recipe, undetected host `POLICY_DENIED`; symlink or escape `PATH_ESCAPE`; interrupted write `WRITE_NOT_ATOMIC`; uninstall residue `CLEANUP_FAILED`; audit failure `AUDIT_WRITE_FAILED`; overlong async step `TOOL_TIMEOUT` or `STARTUP_BUDGET_EXCEEDED`.

### Capability grants map onto existing gates (no second enforcement path)

The contract never enforces anything itself. Enforcement stays where it is: `checkExecPolicy` and `decideMutation` in `src/core/policy.ts`, the credential patterns in `src/fs/credentials.ts`, the egress rules in the policy, pinned roots in `src/fs/root.ts`. `resolveCapabilities(requested, policy)` is a pure function that reports, for a manifest and a loaded `Policy`, which requested capabilities the policy would admit and the catalogue code of each denial. It reads `Policy` data only. Mapping: `fs.read`, `fs.write`, `fs.list` need a non-empty `workspaceRoots` (`POLICY_DENIED` otherwise); `exec.argv` is always admitted (`checkExecPolicy` returns for argv); `exec.shell` needs `shellEnabled` (`SHELL_NOT_ALLOWED`); `net.egress` with scope `host:port` needs an identical `egressAllow` rule (`EGRESS_DENIED`); `credential.read` with a pattern scope needs that exact entry in `credentialAllow` (`CREDENTIAL_PATH_DENIED`); `host.tools.restrict` is admitted only in `fail-closed` mode; `daemon.attach` is always admitted. An `mcp-config` integration may not request `net.egress`, `credential.read` or `host.tools.restrict` (no in-process code to express them). A grant narrows, it never widens: the effective authority of a plugin is always the intersection of its request and the policy.

### Boot hook port and parity with Omp

`src/omp/{plugin,extension,reattach,host-tools}.ts` is the evidence for the seams: attach under a startup budget (`STARTUP_BUDGET_MS` 200 000), refused `up` keeps the client only when its status root matches, status paint over the six state names, guard backstop (non-string tool name blocked, `POLICY_DENIED` otherwise), retry command, shutdown closes the client and never calls `down`, bounded re-attach (cap 8, equal jitter from 1 000 ms to 60 000 ms, retryable codes `REALM_NOT_ACTIVE`, `TOOL_TIMEOUT`, `STARTUP_BUDGET_EXCEEDED`, `DAEMON_START_TIMEOUT`, off by default).

Phase 21 does not touch `src/omp`. To keep `src/host` host-neutral it does not import `src/omp` either: `src/host/boot.ts` carries its own `BOOT_BOUNDS`, and a parity test imports both and asserts equal values. Phase 22 deletes the `src/omp` copies and then the parity test; that is recorded as the Phase 22 handoff.

### Installer design

- Recipe primitives (the only three, each pure planning plus one atomic apply): `json-merge` (set one key path inside a JSON file), `text-block` (a `# BEGIN realm` .. `# END realm` delimited block in a text or TOML file, so no TOML parser is needed), `bundle-copy` (copy a shipped `adapters/<name>` bundle into a host directory). No dependency is added. JSON that does not parse is refused, never rewritten. JSON with comments is therefore refused until a host phase proves a need.
- Writes use `atomicWriteFile` from `src/fs/atomic-write.ts` with `expectedPriorSha256`, so a file changed between plan and apply is refused. The config home is resolved with `realpath` first and every target must stay under it. A symlink target (dotfile managers) is refused with `PATH_ESCAPE` and the fix names `--config-home <real path>`. The home must already exist: Realm never creates a host's home directory.
- Ownership: a receipt `<stateDir>/hosts/<hostId>.receipt.json` records each file, the exact content hash Realm wrote, and the owned key path or marker. Uninstall removes only what the receipt owns and only while the current content still matches; drift is refused with `POLICY_DENIED`, never overwritten. Reinstall of an unchanged recipe is a byte-identical no-op.
- Dry-run computes the full plan (path, action `create|update|noop|remove`, before and after hash, byte counts) and writes nothing: no host file, no receipt, no audit line.
- The `launch` entry is `realm mcp` by bare command name, as in `adapters/claude-plugin/.mcp.json`. No absolute host path is written and no env block exists.

### Audit and logging

Host operations append to the existing hash chain under one reserved session id, `host-plugins` (`SAFE_SESSION_ID` in `src/audit/log.ts` accepts it), so `realm audit verify` covers them and `src/audit/reconcile.ts` marks an admission with no result as `AUDIT_OUTCOME_UNKNOWN` through the unchanged mechanism. `tool` is `host.install` or `host.uninstall`; `phase` `admission` before the first write and `result` after the last; `path` is the target file; `sha256` the written content hash. The known gap (chain is per session, not per plugin) is answered by this one named chain, not by a new chain format. Logging uses an injected `Logger`; fields are host id, action, code, byte counts and hashes, never file content.

### Process-environment and edge rules

`src/host/**` reads no `process.env` (eslint `no-restricted-properties` already bans it outside the four edges). The CLI hands `HostEnv` (`home`, `env`, `pathDirs`) in from `deps.env`. `detect` is filesystem-only (config home exists, or a named binary exists in a `PATH` directory); it spawns nothing, and `src/host` is added to the child-process import ban.

### Table facts (source: `21-DISCOVERY.md`, GSD Core commit 69d604e, `next`, 2026-11-16)

Flags: claude (default), opencode, kilo, codex, copilot, antigravity, cursor, windsurf (alias devin-desktop), augment, trae, qwen, hermes, codebuddy, cline, kimi, kimi-code, zcode, pi (18). Gemini is retired and `vscode` is not installable: neither is in the table. Discovery lists a home for 17 of the 18; antigravity has none, so its entry is `homeVerified: false` and requires `--config-home`. Only `CLAUDE_CONFIG_DIR` is named as an environment override; the table records `null` for the rest rather than guess. Kilo has two candidate homes, Kimi has a skills home and a hooks file. Existing bundles: `adapters/claude-plugin` is the Phase 24 recipe input for `claude` (it also serves Grok Build, which is not a GSD runtime) and `adapters/hermes-agent` the Phase 25 input for `hermes`; `adapters/muse-code` and `adapters/prime-agent` serve hosts outside the GSD list and are not table entries.

### Verification posture

Every plan's acceptance is `node:test` run from compiled output (`npm run build` then `node --test dist/test/host/*.test.js`). Per the repo convention for worker plans, the executing agent runs no live host and no network. Nothing here needs Podman.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/phases/21-host-plugin-contract-and-installer/21-DISCOVERY.md` (verified facts), `.planning/ROADMAP.md` Phase 21 to 26.
- `src/omp/extension.ts`, `src/omp/plugin.ts` (guard, status, attach, retry), `src/omp/host-tools.ts`, `src/omp/reattach.ts`, `src/omp/tools.ts`.
- `src/core/policy.ts`, `src/contract/validate.ts` (`Policy`, `SchemaInvalidError`), `src/core/errors.ts`, `src/core/timeout.ts`, `src/fs/atomic-write.ts`, `src/fs/credentials.ts`.
- `src/audit/log.ts`, `src/audit/redact.ts`, `src/audit/chain.ts`, `src/audit/reconcile.ts`, `src/observe/logger.ts`.
- `src/cli/main.ts` (command table, `runCli`), `src/cli/init.ts` and `src/cli/checkpoint.ts` (own-words command modules), `src/doctor/checks.ts`.
- `docs/integration/omp.md`, `docs/integration/hosts.md`, `adapters/*`, `scripts/check/pack-smoke.mjs`.
- `.planning/phases/19-resume-and-checkpoint/19-01-PLAN.md` (plan format).
</canonical_refs>

<code_context>
## Existing Code Insights

- `src/omp/extension.ts` is the only Omp module reading `process.env`; it builds `attachDaemon` from `ensureDaemon`, `startDetachedDaemon`, `connectDaemon` and `client.up()`. The plugin (`registerRealmPlugin`) stays free of environment reads, which is the separation the contract keeps.
- `package.json` declares `"omp": { "extensions": ["./dist/src/omp/extension.js"] }`; that is how Omp loads the plugin today (evidence for the `extension` kind).
- `eslint.config.js` restricts `process.env` to `src/cli/main.ts`, `src/daemon/main.ts`, `src/omp/extension.ts`, `src/runtime/driver/main.ts`; adapter code (`src/mcp`, `src/acp`, `src/omp`) may not reference `appendAudit`, `withTimeout`, `checkExecPolicy` and other dispatcher internals. `src/host` needs `appendAudit` and `withTimeout`, so its block lifts exactly those two.
- Gates that new source must satisfy: `scripts/check/module-size.mjs` (1000-line limit), `scripts/check/export-usage-gate.mjs` (an export used only by tests needs an allowlist entry or loses `export`), `scripts/check/host-paths.mjs` (no `/home/`, `/root/`, `/tmp/`, `/Users/` in docs), `scripts/check/coverage.mjs` (per-directory floors in `scripts/check/coverage-floors.json`).
- Adapter bundles (`adapters/claude-plugin`, `hermes-agent`, `muse-code`, `prime-agent`) have no unit tests; `scripts/check/pack-smoke.mjs` only asserts file presence. Plan 21-04 adds the first structural tests over them as inputs to future recipes.
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | Requirements | Depends on |
| --- | --- | --- | --- |
| 1 | 21-01 contract types, manifest, capabilities, runtime table | HOST-01, HOST-02, HOST-03 | none |
| 2 | 21-02 boot-hook port and conformance harness | HOST-04 | 21-01 |
| 2 | 21-03 installer engine, receipts, audit | HOST-05, HOST-06 | 21-01 |
| 3 | 21-04 `realm host`, doctor checks, docs, packaging | HOST-07, HOST-08, HOST-09 | 21-02, 21-03 |

21-02 and 21-03 own disjoint files and can run in parallel. 21-04 is the only plan that edits `src/cli/main.ts`, `src/doctor/checks.ts` and docs.
</specifics>

<deferred>
## Deferred Ideas

- Real per-host recipes and host-side proof (Phases 24 and 25). Registering Realm in any live host configuration needs explicit owner approval per host, as `docs/integration/hosts.md` already states.
- Moving Omp onto the contract and deleting the `src/omp` bound constants (Phase 22). Daemon-boot hook wiring (Phase 23). Third-party plugin authoring docs and a published conformance suite (Phase 26).
- Per-plugin audit chains, plugin signing, JSON-with-comments and TOML parsing, Windows paths. None is needed to meet HOST-01..09.
</deferred>
