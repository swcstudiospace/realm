# Omp integration note

Status: gate note (FOUND-03, decision D-03, spec q4). The plugin code now exists: the extension entry is `./dist/src/omp/extension.js`, and the plugin attaches to the daemon.
Blocks: none. The plugin lives under `src/omp/`, its entry is `./dist/src/omp/extension.js`, and this note does not describe a live host run.

## Official sources read

Read date: 2026-10-21 (ISO 8601).

| Source | URL | Used for |
| --- | --- | --- |
| Omp home | https://omp.sh/ | Product identity; the site names no plugin API page |
| Omp docs index | https://omp.sh/docs | Entry point |
| Authoring extensions | https://omp.sh/docs/extension-authoring | `omp.extensions`, `ExtensionAPI`, registration |
| Marketplaces | https://omp.sh/docs/marketplace | Plugin catalog, plugin tree layout, manifest files |
| Upstream repository | https://github.com/can1357/oh-my-pi | Source of the documentation pages below |

Upstream documentation pages consulted in the upstream repository (`docs/` directory, read through a local read-only clone of `origin` at commit `0e2411c0df59fce8c56dc03a5f1c9afffcb0d746`, committed 2026-10-02): `extensions.md`, `extension-loading.md`, `hooks.md`, `cli-reference.md`, `sdk.md`, `marketplace.md`, `mcp-config.md`, `mcp-protocol-transports.md`, `gemini-manifest-extensions.md`.

Official pages for `/docs/plugins`, `/docs/hooks`, `/docs/extensions`, and `/docs/cli` were not fetched from `omp.sh`. The upstream pages above are cited for those topics and are marked as upstream-sourced.

## Phase 5 verification pass

Read date: 2026-10-22 (ISO 8601). Fetched directly in Phase 5:

| Source | URL | Verified in Q1-Q4 |
| --- | --- | --- |
| Authoring extensions (official) | https://omp.sh/docs/extension-authoring | `omp.extensions`, `ExtensionAPI` table, `pi.on`, `pi.registerCommand`, `setActiveTools`, `registerFileWriteFallback`, managed timers, session-startup init |
| Hooks (official) | https://omp.sh/docs/hooks | `tool_call` block shape and first-block-wins, `extensionHandlers.toolCallTimeoutMs` default and fail-closed, 30-second / 2-second budgets, `ctx.setTimeout` / `ctx.setInterval` / `ctx.clearTimer`, `session_start` / `session_shutdown` notification rows |
| Upstream extensions.md | https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extensions.md | `await pi.setActiveTools(...)`, `getActiveTools` / `getAllTools` names (upstream-sourced) |
| Upstream hooks.md | https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/hooks.md | `ctx.ui.setStatus(key, text)` per-key storage (upstream-sourced) |
| Upstream extension-loading.md | https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/extension-loading.md | handler budgets, `toolCallTimeoutMs` default 30,000 ms fail-closed (upstream-sourced) |
| Upstream sdk.md | https://raw.githubusercontent.com/can1357/oh-my-pi/main/docs/sdk.md | `restrictToolNames`, `setActiveToolsByName` are SDK-session mechanisms (upstream-sourced) |

Anything below marked upstream-sourced was not found on the two official `omp.sh` pages and stays a recorded limitation (OQ-P5-01).

Omp package identity used by the official page: `@oh-my-pi/pi-coding-agent` (npm package name as written on the official page; not installed here, not verified in the registry in this phase).

## Questions and answers

### Q1. Manifest format

Sourced answer.

- Extension package: `package.json` with `"omp": { "extensions": ["./src/index.ts"] }`. The field is an array; entries are relative to the package root. Installed-plugin entries may be `.ts`, `.js`, `.mjs`, or `.cjs`. The older `pi.extensions` field remains compatible; new packages use `omp.extensions` (https://omp.sh/docs/extension-authoring).
- Plugin tree: `.omp-plugin/plugin.json` is read first, then `.claude-plugin/plugin.json`. A root `plugin.json` using the Agent Plugins 1.0.0 schema uses the portable provider with skills and `mcp.json` (https://omp.sh/docs/marketplace, upstream `marketplace.md`).
- Marketplace catalog: `.omp-plugin/marketplace.json`, or `.claude-plugin/marketplace.json` when the first is absent (https://omp.sh/docs/marketplace).
- MCP declaration in a plugin: a manifest `mcpServers` entry replaces the default `.mcp.json`; `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are expanded in portable plugin MCP config (upstream `mcp-config.md`, upstream `marketplace.md`).

Manifest validation details beyond these fields were not verified in this phase.

Phase 5 verification (read 2026-10-22, https://omp.sh/docs/extension-authoring): the page shows `"omp": { "extensions": ["./src/index.ts"] }`, states the field is an array relative to the package root, lists `.ts`, `.js`, `.mjs`, and `.cjs` entries, and keeps `pi.extensions` compatible. Its `ExtensionAPI` table names `registerCommand`, `registerTool`, `getActiveTools`, `getAllTools`, `setActiveTools`, `getCommands`, and `registerFileWriteFallback`. `pi.registerCommand("deploy", { description, getArgumentCompletions, handler })` is shown with args as the text after the command. Nothing in Q1 was corrected.

### Q2. Lifecycle hooks

Sourced answer.

- Events registered with `pi.on(event, handler)`. Session events named in the upstream `extensions.md` include `session_start` and `session_shutdown`. Example used on the official page: `ctx.ui.notify` in a `session_start` handler (https://omp.sh/docs/extension-authoring).
- Timing budgets (upstream `extension-loading.md` and `extensions.md`): most dispatched handlers have a 30-second budget; `session_shutdown` handlers run concurrently with a 2-second budget; `tool_call` uses `extensionHandlers.toolCallTimeoutMs` (default 30,000 ms) and fails closed on error or timeout.
- Timers created through the extension context (handle returned, cleared with `ctx.clearTimer(handle)`) are unref'd and are cleared automatically on `session_shutdown`. Raw `setInterval`/`setTimeout` and detached promises are not cleared for the extension and remain its responsibility (upstream `extensions.md`).

Phase 5 verification (read 2026-10-22, https://omp.sh/docs/extension-authoring and https://omp.sh/docs/hooks): `pi.on(event, handler)` and the `session_start` / `session_shutdown` names appear in the official events table. The official hooks page ("Ordering, timeouts, and errors") states most handlers have a 30-second budget, `session_shutdown` handlers run concurrently with a 2-second budget, `tool_call` uses `extensionHandlers.toolCallTimeoutMs` (30 seconds by default), and a `tool_call` exception or timeout fails closed by blocking the call. Managed timers are `ctx.setInterval()` / `ctx.setTimeout()` with `ctx.clearTimer()`; the official pages state managed callbacks are cleared on session shutdown. Extension factories are initialized at session startup; changed tools, hooks, and extension modules require a new session. Nothing in Q2 was corrected; the budget and timer claims now have official backing.

### Q3. Status API

Sourced answer.

- The surface found is UI-level: `ctx.ui.setStatus(key, text)`. Status text is stored per key and sorted by key name (upstream `hooks.md`). `ctx.ui.setWidget` renders content above or below the editor (upstream `extensions.md`).
- In RPC mode, `setStatus`, `notify`, and `setWidget` are emitted as fire-and-forget requests (upstream `extensions.md`).
- No separate HTTP or JSON status endpoint for a plugin was found in the sources read. A dedicated health or status API for Realm therefore `not documented`. Realm must not assume one.

Phase 5 verification (read 2026-10-22, https://omp.sh/docs/extension-authoring and https://omp.sh/docs/hooks): the official pages describe `ctx.ui` as notifications, status and widgets among other UI methods, and advise guarding with `ctx.hasUI` / `ctx.mode`. The exact `ctx.ui.setStatus(key, text)` key-plus-text signature was found only in upstream `hooks.md` ("Status line behavior": stored per key, sorted by key name), not on the official pages read — limitation recorded (OQ-P5-01): the name and signature stay upstream-sourced. No status endpoint for a plugin remains `not documented` on every source read.

### Q4. Host write-tool removal in required mode (spec q4)

Status: **OPEN. Deferred to Phase 5 (OMP-05). Not answered by this note.**

Decision basis: D-03 says host write and edit tools are disabled only in required mode. Phase 1 records the question only.

What the sources show (so Phase 5 starts from evidence, not from memory):

- Launch-time switches exist: `--no-tools` "disables all built-in tools" and `--tools <a,b,c>` enables a named list (upstream `cli-reference.md`). These are operator flags, not a plugin mechanism.
- SDK sessions can set `restrictToolNames: true`, which limits the session to `toolNames`, and "restricted sessions disable ambient MCP, extensions, custom commands, and LSP by default" (upstream `sdk.md`). This applies to SDK sessions, not to a plugin loaded into an interactive session.
- The extension API exposes `getActiveTools`, `getAllTools`, `setActiveTools`, and `await pi.setActiveTools(...)` (upstream `extensions.md`). Whether this removes built-in `write` and `edit` from the model's callable set, and whether that is enforced at execution time, is **not documented** in the sections read.
- `tool_call` handlers can block execution, and errors or timeouts block it (upstream `extensions.md`). Whether a `tool_call` block on `write`/`edit` satisfies a required-mode rule is **not documented** and is not a verified control.
- `registerFileWriteFallback` lets a handler take over a write when the built-in byte-write does not complete (upstream `extensions.md`, "File write fallback"). This is a fallback, not a removal, and must not be treated as a control.

Open for Phase 5: which mechanism (an extension `setActiveTools` call, a `tool_call` block, a launch-time `--tools` list enforced by the launcher, or a combination) can make required mode hold without relying on a model's cooperation. Each candidate needs a test in Phase 5 before it is chosen.

Phase 5 verification (read 2026-10-22, https://omp.sh/docs/extension-authoring and https://omp.sh/docs/hooks): the official `ExtensionAPI` table lists `setActiveTools` (with `getActiveTools` / `getAllTools`), and the official hooks page defines the `tool_call` return `{ block?, reason?, input? }` with first-block-wins dispatch and fail-closed timeouts. Neither official page documents that removing `write` / `edit` via `setActiveTools` provably enforces required mode at execution, nor that a `tool_call` block covers every host execution path. Upstream `sdk.md` documents `restrictToolNames: true` with `toolNames` and `setActiveToolsByName(names)` for SDK sessions only — not a plugin mechanism. Status stays **OPEN** (OQ-P5-01, OQ-P5-02); anything claiming enforcement is `not documented` and Phase 5 code must stay fail-closed.

### Q5. Does this note permit any plugin code now?

No. No file under `plugin/` is created. No manifest file is written. The examples above are quotations of official documentation, not code for this repository.

## Blocked module

`plugin/` (Phase 5). Phase 5 must answer Q4 before any plugin code that claims required-mode enforcement is written.

## Not in this note

- The package's `omp` field points at `./dist/src/omp/extension.js`. No `.omp-plugin/` tree and no `mcp.json` exist.

## Entry and attach (closure, 2026-10-22)

Sources: `package.json`, `src/omp/extension.ts`, `src/omp/plugin.ts`, and `src/daemon/client.ts`. No live Omp host session has run. The smoke run (commit 4b1d4ab) covered the built CLI and daemon only, so this section describes the attach path from source reading and makes no claim about a live Omp host.

Entry. `package.json` declares `"omp": { "extensions": ["./dist/src/omp/extension.js"] }`. The module's default export is `realmExtension(pi)`. It is the only module in the Omp wiring that reads `process.env`. It resolves the state directory and the control socket path once, and passes an `attachDaemon` function to `registerRealmPlugin` (`src/omp/extension.ts`, `src/omp/plugin.ts`).

Attach at session start. The `session_start` handler starts the attach without awaiting it. The attach and its first status read share a 10-second budget (`STARTUP_BUDGET_MS`). The attach:

1. Ensures a daemon answers on the control socket. When none does, it spawns `dist/src/daemon/main.js` detached.
2. Connects to the control socket and calls `up` with the session working directory (`ctx.cwd`) as the workspace root. `up` is idempotent.
3. Calls `status`. The reply carries the snapshot and the policy mode. The mode is stored on the session.

The status indicator is one status item, keyed `realm`. Its text is `<marker> <label> · <reason> · <last-transition time>`. The marker is `●` for active and `○` otherwise, and `[degraded]` follows the label when `displayStatus` marks the state degraded. There is no tooltip API on this host, so the reason and time ride in that text (P5-D5). A failed attach paints the error state with its code.

From session start, the indicator refreshes every 2 s (`STATUS_POLL_MS`, a managed interval). Each tick reads daemon status only while a client is attached, and that read runs under a 5 s timer (`GUARD_STATUS_BUDGET_MS`). Session shutdown clears the interval and every other timer the plugin armed.

Mode and guard. Each guarded host write reads the daemon status under a managed timer, stores the mode it reports, and repaints the indicator. If that read fails, the last mode the daemon reported decides: `advisory` warns and the write proceeds, and `fail-closed` blocks it. If no mode has been reported yet, the write is blocked (`src/omp/plugin.ts`).

Shutdown. `session_shutdown` closes the control client and clears the session. It never sends `down`. The daemon keeps the sandbox, and a host shutdown is only a detach of this host (`endSession`, `src/omp/plugin.ts`). The sandbox persists until `realm down`.

## Live verification status (2026-10-22)

This pass is partial. The CLI half ran. The Omp half did not run, so no live Omp evidence exists yet.

- Blocked: every invocation of the `omp` binary from the verification shell returned `BLOCKED needs: human-approval (mcp: nested-agent)`, including `omp --version` on a retry. The B1 session and the B2 dry run (`omp plugin install --dry-run`) therefore have no observed output. No persistent install was attempted, and no Omp config (`config.yml`, `mcp.json`) was read or changed.
- Not observed: the realm status item text from rpc or rpc-ui events, attach timing, the retry command outcome, and whether the daemon survives session shutdown.

### CLI status with an isolated config (observed)

The CLI reads its state directory from a realm config file. A scratch config was written under `XDG_CONFIG_HOME=<scratch>/config`, holding a placeholder digest-pinned image, `workloadArgv`, a scratch `stateDir`, and a scratch `workspaceRoot`. No daemon was started.

```
XDG_CONFIG_HOME=<scratch>/config node dist/src/cli/main.js status
disconnected
realm status: daemon absent (REALM_NOT_ACTIVE); local report
exit 0
```

Without an isolated config, the same command exits 2 with `cannot resolve a state directory`, because the host has no realm config file at `$HOME/.config/realm/config.json`.

### Expected Omp status text (derived from source, not observed)

From `renderRealmStatus` and `displayStatus`, the one `realm` status item should read `<marker> realm disconnected · <reason> · <time>`, where the marker is `○` and the reason is `connecting` during attach, or the error code (for example `REALM_NOT_ACTIVE`) when attach fails. An attached daemon in the active state reads `● realm active · <reason> · <time>`. These strings are expectations for the live run to confirm or refute.

### Runbook for the approved live run

Run only after a human approves the `omp` invocation, and only in an isolated profile. Use placeholders for the repo and scratch paths, and record exact output.

1. Dry run the package install check: `omp plugin install <repo> --dry-run --json`. Record the output. Do not drop `--dry-run`.
2. Start an isolated session with the built extension: `omp --profile=<scratch-profile> -e <repo>/dist/src/omp/extension.js`, with `--mode=rpc` or `--mode=rpc-ui` to capture the `realm` status item. The flags come from the read-only observations in the Omp facts; they are not yet verified against `omp --help`.
3. Record the status item text, the attach timing, and the reason. Run the retry command (`realm-retry`) and record its reply.
4. Run `node <repo>/dist/src/cli/main.js status` to compare the daemon with the status item.
5. Close the session and check that the daemon still answers `status`. Clean up the scratch profile and the state directory.

Realm `active` is not required. It needs Podman 5.x and an AgentOS driver, and this host has Podman 4.9.3 with no driver bound.
