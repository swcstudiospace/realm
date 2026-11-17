# Phase 22: Omp plugin on boot - Context

**Gathered:** 2026-11-17, from the merged Phase 21 code (`src/host/*.ts`, `docs/integration/host-plugin-contract.md`, commit bf70847), the Omp wiring (`src/omp/*.ts`), the Omp integration notes, and read-only observation of the installed Omp 18.22.0 (`omp --help`, `omp plugin --help`) plus the public page https://omp.sh/docs/extension-authoring.
**Status:** Planned (three plans, nothing executed). Requirement IDs OMPB-01..OMPB-08 are defined in the plans and are not yet in `.planning/REQUIREMENTS.md`; the orchestrator registers them with gsd-tools. Phase 21 has no `21-0N-SUMMARY.md` for plans 01 to 03 yet; this context reads the code instead.

<domain>
## Phase Boundary

Omp becomes the reference implementation of the host contract and opens Realm automatically on boot. The direction is fixed by the owner (carried from Phase 21): the plugin loads into each CLI agent; the agent is the host process and Realm is the sandbox it attaches to. Omp plus Claude Code, OpenCode, Codex and Kimi CLI are proven end to end in later phases; every other runtime is config-only. Enterprise baseline only: logging (`src/observe/logger.ts`), redaction (`src/audit/redact.ts`), least privilege through the existing policy gates, the hash-chained audit (`src/audit/log.ts`). No second logging, redaction or audit mechanism. Merge on green CI, GitHub-hosted runners.

Phase 22 delivers:

1. **Omp on the contract** (OMPB-01..03). `src/omp` consumes `src/host/boot.ts` instead of carrying its own bounds, link-lost codes, retry codes, sub-state table and jitter function. `src/omp/reattach.ts` is deleted, the duplicated constants leave `src/omp/plugin.ts`, and the parity block in `test/host/boot.test.ts` (the Phase 21 handoff list) is deleted with them. The existing guard keeps its exact behavior; only its two pure early verdicts go through `backstopVerdict`.
2. **Omp passes the Phase 21 boot conformance harness** (OMPB-02): C1 to C9 of `test/support/host-boot-conformance.ts` run against the real `registerRealmPlugin`, driven through the Omp host API by a test double, with the harness's four reference mutants still failing exactly the cases they fail today.
3. **`realm host install omp` has a recipe** (OMPB-04, OMPB-05): the one Omp recipe replaces `recipe: null` for `omp` only, as a shipped `adapters/omp` bundle installed into `<omp agent dir>/extensions/realm/`, with fail-closed preflights (extension not built, Omp already loading Realm through a plugin link).
4. **Auto-open is the default for an installed Omp** (OMPB-06): with the shim installed and no environment switch, an Omp session start attaches, starts the daemon when none answers, and runs the idempotent `up`. That includes the compiled Omp binary, which today refuses to spawn the daemon (see Findings).
5. **Doctor and `realm host status`** report that Omp is installed, that the shim target exists, and whether a live Omp process has loaded and attached the plugin; `realm host status omp` also reports a duplicate plugin link (OMPB-07).
6. **Docs and gates** (OMPB-08): `docs/integration/omp.md`, `docs/hosts/snippets/omp.md`, `docs/integration/host-plugin-contract.md`, `docs/policy-reference.md`, `AGENTS.md` (its layout line still names `reattach.ts`); the export-usage allowlist loses every `src/host` entry that gains a `src` importer; module-size, pack-smoke and `check:docs` stay green.

Out of scope (planned elsewhere): wiring hook factories into the daemon boot path (Phase 23); recipes for Claude Code, OpenCode, Codex, Kimi CLI (Phase 24); the other runtimes (Phase 25); published conformance package and author docs (Phase 26). Registry or marketplace install of the package into Omp stays unverified and is not claimed.
</domain>

<decisions>
## Implementation Decisions

### Findings that shape the plans (verified in the repo, 2026-11-17)

- **F1. The compiled Omp never spawns the daemon today.** `launchFilteredDaemon` in `src/cli/main.ts` throws `REALM_NOT_ACTIVE` when `process.versions.bun` exists, because `process.execPath` there is the Omp binary (`test/daemon/launch-runtime.test.ts` pins this; `docs/integration/omp.md` "Entry and attach" step 1 says "Start the daemon with `realm up` before starting Omp"). `omp` on this machine is a compiled ELF. So the existing attach flow does not by itself open Realm on boot for a real Omp; OMPB-06 closes exactly this gap and nothing else in the spawn path.
- **F2. The Omp install path documented in the repo is a plugin link, not a file recipe.** `docs/hosts/snippets/omp.md` records `omp plugin install <checkout>` (a link to `<home>/.omp/plugins/node_modules/agent-realm`, Omp 18.20.0, isolated profile). The installer has no spawn (`src/host` is under the child-process import ban) and only three file primitives. The public extension page (read 2026-11-17) documents a file-only route: "Loose modules can also be placed directly in `<project>/.omp/extensions/` or `~/.omp/agent/extensions/`; automatic directory scans find `.ts` and `.js` files plus one level of `index.ts` or `index.js` subdirectories", and `omp --help` states `PI_CODING_AGENT_DIR` defaults to `~/.omp/agent`. The recipe therefore installs a small shim module under `<agent dir>/extensions/realm/`. [INFERENCE: that Omp resolves the override as the directory holding `extensions/` is not stated by the page; plan 22-03 Task 4 verifies it in an isolated profile before any claim.]
- **F3. A static bundle cannot name where Realm is installed.** The shim must import the package's own `dist/src/omp/extension.js`, whose location differs per install. The engine's `bundle-copy` copies shipped bytes verbatim. Decision D-22-03 adds one install-time token (below) instead of a fourth recipe primitive.
- **F4. The Phase 21 harness cannot pass an Omp-shaped hook unchanged.** C1 (line 121), C4 (line 192) and C8 (lines 308, 329, 340) assert `rig.timers.pendingCount() === 0` while the session is still live (C6's two assertions run after `shutdown` and stay strict); the Omp plugin keeps its repaint poll interval armed for the life of a session by design (`beginSession` in `src/omp/plugin.ts`). C1 also expects the startup budget to run on the one real timer `withStartupBudget` arms, while Omp's budget runs on the host's managed timers. Decision D-22-02 amends the harness in two stated ways, nothing else.
- **F5. `registerRealmPlugin` exposes no readable state.** The port's `status()` needs state, mode, link and code; the plugin only paints them. Decision D-22-01 adds a read-only view and an attach-settled callback, not a second state machine.

### Owner-approved scope (carried in, not reopened)

- Plugin loads into each CLI agent; Omp is the reference. Enterprise baseline only. Merge on green CI.
- Fail-closed stays the default everywhere. No behavior change to the existing guard: every test in `test/omp/` and `test/integration/omp-*.test.ts` keeps its assertions. Where a test imports a deleted constant, only the import line changes (an alias to `BOOT_BOUNDS`), never an expectation.
- Strict TypeScript ESM, no new npm dependency, existing `RealmError` codes only (`src/core/errors.ts` stays at 31 codes). New refusal reasons are `HostRefusalReason` values mapped onto existing codes, not new codes.

### D-22-01. One source for bounds; the plugin takes them as data

`RealmPluginOptions` gains an optional `bounds?: ResolvedBoot` (default `BOOT_BOUNDS`). The plugin reads `startupBudgetMs`, `guardStatusBudgetMs`, `statusPollMs`, `reattach.retryCap`, `reattach.baseDelayMs`, `reattach.capDelayMs` from it, and the two code lists through two small predicates added to `src/host/boot.ts` (`isLinkLostCode`, `isRetryableAttachCode`, both taking `string`, because the plugin's outcomes carry string codes). `options.reattach.enabled` stays the one on/off switch the plugin reads (existing tests build it directly); callers set it from `bounds.reattach.enabled`. `src/omp/reattach.ts` and the exported `STARTUP_BUDGET_MS`, `GUARD_STATUS_BUDGET_MS`, `STATUS_POLL_MS` are deleted; no alias or re-export stays behind (clean cutover). The plugin gains `createRealmPlugin(pi, options): RealmPluginHandle` with `{ tools, view() }`, and `registerRealmPlugin` becomes `createRealmPlugin(...).tools`, so every existing caller compiles unchanged. `RealmPluginOptions.onAttach?(outcome)` is called once per non-superseded attach outcome and `onSessionEnd?()` once when a live session ends; the conformance double uses `onAttach` to resolve `start()`, and the extension edge (plan 22-03) uses both to write and remove the presence marker without registering a fifth host event (`test/omp/extension.test.ts` pins the four registered events). All status paints go through one `paint(session, ...)` funnel that records the last shown `{ state, code }` for `view()`.

### D-22-02. The conformance double lives in `test/support`; the harness is amended twice

The Omp hook under conformance is the real plugin driven by `test/support/omp-boot-hook.ts`, a `HostBootHookFactory` that owns an in-memory Omp host API (the same event, command and tool-set surface `test/omp/plugin.test.ts` fakes) and maps `start`, `switchWorkspace`, `guard`, `retry`, `shutdown` onto `session_start`, `session_switch`, `tool_call`, the registered retry command and `session_shutdown`. No double ships in `src/`. Production wiring of hooks into daemon boot is Phase 23, so `bootHook` stays `null` on the production Omp adapter. Harness amendments, each recorded in its header comment: (a) while a session is live, "no timer remains" means "no wait armed" (`pendingTimeouts() === 0`) and "at most the one repaint poll" (`pendingCount() - pendingTimeouts() <= 1`); every assertion made after `shutdown` keeps `pendingCount() === 0`. (b) C1 advances the fake clock by the startup budget while it waits, so a hook may enforce the budget on `withStartupBudget` (reference hook) or on the host's managed timers (Omp). The four reference mutants must still fail exactly `C1`, `C6`, `C5`, `C8` respectively (`test/host/boot-conformance.test.ts` asserts this); a different failing set means the amendment is wrong.

### D-22-03. The Omp recipe: `bundle-copy` of `adapters/omp` with one install-time token

`HOST_RUNTIMES.omp` becomes: `homes: [".omp/agent"]`, `homeVerified: true`, `envOverride: "PI_CODING_AGENT_DIR"`, `binaries: ["omp"]`, `recipe: { kind: "bundle-copy", source: "omp", dest: "extensions/realm" }`, and a new optional table field `conflicts: [".omp/plugins/node_modules/agent-realm"]` (paths relative to the user home; presence means Omp already loads Realm through a plugin link). `adapters/omp/index.js` is shipped:

```js
// Realm Omp extension shim (managed by `realm host install omp`; do not edit).
export default async function realmExtension(pi) {
  const { default: factory } = await import(@realm:extension-url@);
  await factory(pi);
}
```

At install, `readBundle` in `src/host/adapter.ts` replaces the single token `@realm:extension-url@` with `JSON.stringify(pathToFileURL(<package root>/<manifest.entry>).href)`, where the package root is the parent of `adaptersDir` and `entry` is the validated manifest entry (`dist/src/omp/extension.js`). Any other `@realm:` token in a bundle file is `SCHEMA_INVALID`. The URL is percent-encoded by `pathToFileURL` and emitted as a JSON string literal, so a path cannot break out of the literal. The receipt hashes the expanded bytes, so drift detection, idempotent reinstall (byte-identical no-op) and uninstall-only-what-we-own work unchanged. The shim reads no environment and writes no file; the factory it delegates to is the existing entry, which stays the only Omp module reading `process.env`.

Two new `HostRefusalReason` values, both `POLICY_DENIED`: `extension-unbuilt` (the manifest entry does not exist under the package root; nothing is written) and `already-loaded` (a `conflicts` path exists, so installing would register the extension twice). `realm host uninstall omp` is never blocked by either.

### D-22-04. Auto-open under a Bun host

`launchFilteredDaemon` keeps its Node branch byte-for-byte. Under Bun it resolves a Node binary instead of refusing outright: the first directory of the handed-in `PATH` that is absolute and holds a regular, executable file named `node`; none found keeps today's `REALM_NOT_ACTIVE` refusal with no child spawned. Relative and empty `PATH` entries are skipped, exactly as `detect` in `src/host/adapter.ts` does. The existing test "a Bun host refuses with REALM_NOT_ACTIVE and runs no child" passes unchanged (its environment is `{}`). The child still receives only `daemonSpawnEnv(source)` (`src/daemon/spawn-env.ts`), is detached, and its output goes to the daemon log. Node version is not probed by spawning: a Node older than `engines` makes the daemon exit, which `reportingStartFailure` already reports by catalogue code from `daemon.log`.

### D-22-05. "Plugin active" is a presence marker, stated as what it is

Omp has no wire to the daemon that identifies a client as Omp, and Phase 22 adds none. The extension edge writes `<stateDir>/hosts/omp-active/<pid>.json` (mode 0600, atomic, at most 4096 bytes, fields `schemaVersion`, `pid`, `startedAt`, `sessionId`, `attach` (`attached` or `failed`), `code` (catalogue code or null)) on each settled attach, and removes it on `session_shutdown`. Doctor and `realm host status omp` count markers whose pid is alive (`process.kill(pid, 0)`, injected), strict-parse every file, never follow a symlink, and read at most 64. The marker means "an Omp process loaded the plugin and its last attach ended this way"; it is not proof the sandbox is healthy (that is `realm status`) and not containment. The writer and reader are host-neutral (`src/host/presence.ts`) so a later in-process host can reuse them.

### D-22-06. Allowlist ownership

`scripts/check/export-usage-allowlist.json` is edited by exactly two plans, in disjoint entries: 22-01 removes the `src/host/boot.ts` entries its plugin refactor makes stale (`BOOT_BOUNDS`, `ResolvedBoot`, `BootLink`, `backstopVerdict`); 22-03 reconciles everything else by running `node scripts/check/export-usage-gate.mjs` and removing each reported STALE line (expected: `resolveBoot`, plus any new export that gained an importer), and rewrites the `reason` of the entries that remain, because their text says "Phase 22 wires src/omp to the port" and the remaining seams are Phase 23 and Phase 26 inputs (`withStartupBudget`, `attachFailureDisposition`, `HostBootDeps`, `HostBootHook`, `HostTimers`, `HostStatusSink`, `resolveCapabilities`, `integrationCeiling`). Plan 22-02 does not touch the file; it adds no src export that only a test uses.

### Threat model: malicious workload (summary; each plan carries its STRIDE rows)

The workload is code that runs inside the sandbox plus whatever it writes into the workspace: it controls file content, symlinks and tool-call arguments, and can try to trick the host side. It cannot reach `<stateDir>` or the user's Omp agent dir (neither is mounted into the container; the workspace, state and channel binds are Phase 19's exact set and are not changed). What this phase adds on the host side, and how each is held:

| Asset | Attack | Hold |
| --- | --- | --- |
| Omp extension dir | Plant a symlink or file where the shim is written, so install overwrites an arbitrary file | Engine refuses symlinks on the path (`PATH_ESCAPE`) and foreign content (`POLICY_DENIED`); writes use `atomicWriteFile` with `expectedPriorSha256`; the agent dir must already exist |
| Shim | Tamper it to import other code (the extension runs with Omp's full privileges: "not sandboxed", per the extension page) | Receipt hash; `realm host status`, doctor and uninstall refuse drift; the shim carries one import and no environment read |
| Shim URL | A hostile directory name tries to break out of the string literal | `pathToFileURL` plus `JSON.stringify`; test with quote, backslash, newline and `%` in the package path |
| Daemon spawn | Hijack the Node that a Bun host spawns | Absolute `PATH` entries only, regular executable file, allowlisted child env, detached with log; same-user `PATH` control is out of model and written down |
| Auto-open | Open Omp in a hostile directory to make Realm bind it | Unchanged `up` admission: a directory outside every policy root or the configured workspace root is `POLICY_DENIED`; the guard and fail-closed default are untouched |
| Presence marker | Forge or flood markers to fake "active" or exhaust the directory | The directory is host-side only; strict parse, 4096-byte cap, pid integer, 64-file read cap, symlink refusal; a marker never causes any action, it only changes a doctor sentence |
| Logs and audit | Leak paths, tokens or file content | Fields are host id, action, code, hashes and counts; install events stay in the existing `host-plugins` chain; no new log or audit path |
| Residual (unchanged) | A host path that bypasses the Omp extension pipeline is not covered by the guard (OQ-P5-02) | Not claimed as covered; docs keep saying fail-closed here is a host-tool allowlist plus guard, not process containment |

### Verification posture

Offline acceptance is `node:test` from compiled output (`npm run build`, then the named `dist/test/...` files), plus `npx eslint .`, `npm run check:gates`, `npm run check:docs`, `npm run check:pack`. Worker plans run none of these mid-flight; the parent runs them once after the plans land. Nothing offline needs Podman. The one live check (real Omp 18.22.x, isolated `HOME` and `PI_CODING_AGENT_DIR`) is a blocking human-verify task in 22-03; until it passes, docs may say the recipe is proven on a fixture host and the shim is unproven against a real Omp.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` Phase 21 to 26; `.planning/phases/21-host-plugin-contract-and-installer/21-CONTEXT.md` (handoff list: delete `src/omp` bound copies and the parity test); `.planning/phases/19-resume-and-checkpoint/19-01-PLAN.md` (plan format).
- `src/host/{boot,types,runtimes,manifest,adapter,recipe,install,receipt,capabilities}.ts`, `docs/integration/host-plugin-contract.md`.
- `src/omp/{plugin,extension,reattach,host-tools,tools}.ts`, `package.json` `omp.extensions`, `docs/integration/omp.md` ("Entry and attach"), `docs/hosts/snippets/omp.md`.
- `src/cli/main.ts` (`launchFilteredDaemon`, `startDetachedDaemon`), `src/daemon/{ensure,spawn-env}.ts`, `src/doctor/host-checks.ts`, `src/cli/host.ts`.
- `test/omp/{plugin,extension,host-tools,tools}.test.ts`, `test/integration/omp-*.test.ts`, `test/host/{boot,boot-conformance,adapter,runtimes}.test.ts`, `test/support/{host-boot-conformance,reference-boot-hook,fake-host-daemon,fixture-host}.ts`, `test/daemon/launch-runtime.test.ts`, `test/cli/host.test.ts`, `test/doctor/host-checks.test.ts`.
- `scripts/check/{export-usage-gate,module-size,pack-smoke,host-paths,default-mode}.mjs`, `scripts/check/export-usage-allowlist.json`.
- Omp: https://omp.sh/docs/extension-authoring, https://omp.sh/docs/marketplace; `omp --help` (`PI_CODING_AGENT_DIR`), `omp plugin --help` (observed on 18.22.0).
</canonical_refs>

<code_context>
## Existing Code Insights

- `src/omp/plugin.ts` (892 lines; module-size limit 1000) owns the session state machine: `registerRealmPlugin` closes over `live`, `attach`, `attachCycle`, `settleAttempt`, `scheduleWait`, `repaint`, `retryRealm`, `beginSession`. Eight status paints call `renderRealmStatus(...)` directly (lines 194, 207, 351, 424, 492, 545, 554, 573 today); all armed timers go through `armTimer`/`disarmTimer` on `ctx.setTimeout`, the repaint poll on `ctx.setInterval`.
- `guardHostToolCall` early verdicts (non-string tool name; no session) are exactly `backstopVerdict(toolName, null, PASS_THROUGH_HOST_TOOLS)` once the guarded-tool branch is taken first. Everything after that reads daemon status and stays in the plugin.
- ESLint (`eslint.config.js`): `src/omp/**` may not reference `withTimeout` (except `host-tools.ts`), `appendAudit`, `checkExecPolicy` and may import only `../daemon/{client,channel,ensure}.js`; `process.env` only at `src/omp/extension.ts` and three other edges; `src/host/**` may use `appendAudit` and `withTimeout` and reads no env.
- `src/host/boot.ts` already holds `BOOT_BOUNDS`, `resolveBoot`, `withStartupBudget`, `attachFailureDisposition`, `backstopVerdict`, `reattachTransitionAllowed`, `equalJitterDelayMs`; `test/support/reference-boot-hook.ts` is its only non-test-of-itself consumer today, which is why `scripts/check/export-usage-allowlist.json` lists seven of them with "Phase 22 wires src/omp to it".
- `createHostAdapter` (`src/host/adapter.ts`) reads a bundle through `readBundle` (lstat discipline, symlink refusal, 256 files, 1 MiB each) and its detect step skips empty and relative `PATH` entries; `status()` for `bundle-copy` compares each owned file to the receipt hash.
- `HostRuntimeEntry.recipe` is `null` for all 19 hosts; `test/host/runtimes.test.ts` ("Phase 21 invariant: every recipe is null") and `test/cli/host.test.ts` (list shows `recipe: "pending"` for every host; install refuses `recipe-pending` on the real table with host `claude`) pin it. These change for `omp` only.
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | Requirements | Depends on |
| --- | --- | --- | --- |
| 1 | 22-01 Omp onto `src/host`, plugin view, conformance run | OMPB-01, OMPB-02, OMPB-03 | none (Phase 21 merged) |
| 1 | 22-02 Omp install recipe, `adapters/omp` shim, preflights | OMPB-04, OMPB-05 | none (Phase 21 merged) |
| 2 | 22-03 auto-open under Bun, presence marker, doctor and status, docs, gates, live rehearsal | OMPB-06, OMPB-07, OMPB-08 | 22-01, 22-02 |

22-01 and 22-02 own disjoint files (22-01: `src/omp/plugin.ts`, `src/omp/reattach.ts`, `src/host/boot.ts`, omp and boot tests, harness; 22-02: `src/host/{types,runtimes,adapter,recipe}.ts`, `adapters/omp`, host and CLI tests, `scripts/check/pack-smoke.*`) and can run in parallel. 22-03 is the only plan that edits `src/omp/extension.ts`, `src/cli/main.ts`, `src/doctor/host-checks.ts`, `src/host/presence.ts`, docs and the allowlist's remaining entries.

## Requirement IDs

| ID | Statement |
| --- | --- |
| OMPB-01 | The Omp plugin reads every boot bound, the link-lost and retryable code lists, the re-attach sub-state table and the jitter function from `src/host/boot.ts`; `src/omp/reattach.ts` and the `src/omp` bound constants no longer exist; the parity tests are deleted. |
| OMPB-02 | The real Omp plugin, driven through the Omp host API, passes harness cases C1 to C9, and the harness's four reference mutants still fail exactly their cases. |
| OMPB-03 | The existing guard, status text, tool-set reconciliation and fail-closed default behave as before: all pre-existing `test/omp/` and `test/integration/omp-*.test.ts` expectations pass with import-line changes only. |
| OMPB-04 | `realm host install omp` writes, idempotently and atomically, the shim under `<agent dir>/extensions/realm/`, records a receipt, supports `--dry-run`, and `uninstall` removes only what the receipt owns. |
| OMPB-05 | Install refuses with `POLICY_DENIED` and writes nothing when the extension entry is not built (`extension-unbuilt`) or Omp already loads Realm through a plugin link (`already-loaded`); foreign content, drift and symlinks keep their Phase 21 refusals. |
| OMPB-06 | With the shim installed and no environment switch, Omp session start attaches, spawns the daemon when none answers (including under a Bun host, via an absolute `PATH` Node) and runs the idempotent `up`; a Bun host with no Node found still refuses with `REALM_NOT_ACTIVE` and spawns nothing. |
| OMPB-07 | `realm doctor` (`host-plugins`) and `realm host status omp` report installed, shim target present and live plugin sessions (presence markers); `realm host status omp` also reports duplicate-load (it needs the user's home, which doctor deliberately never reads). Output names ids, states and counts only, never a path or file content. |
| OMPB-08 | Docs describe the shipped behavior with evidence tiers and the unproven live boundary; the export-usage allowlist has no stale entry and no entry whose reason is outdated; module-size, pack-smoke and docs gates pass. |
</specifics>

<deferred>
## Deferred Ideas

- Hook factories wired into daemon boot and a production `bootHook` on the Omp adapter (Phase 23). A daemon-side client identity (so "active" could come from the daemon rather than a marker). Registry or marketplace install of `agent-realm` into Omp. Per-project `<project>/.omp/extensions/` install scope. A stop-the-poll-when-unlinked option in the plugin (D-22-02 amends the harness instead, so the plugin's repaint behavior stays as shipped).
- Raising the `src/host` coverage floor in `scripts/check/coverage-floors.json` (the orchestrator runs `node scripts/check/coverage.mjs --write` after the parent test run, as in Phase 21).
</deferred>
