# Omp integration note

Status: gate note (FOUND-03, decision D-03, spec q4). The plugin code now exists: the extension entry is `./dist/src/omp/extension.js`, and the plugin attaches to the daemon.
Blocks: none. The plugin lives under `src/omp/`, its entry is `./dist/src/omp/extension.js`. The live run of 2026-10-23 is under Live verification.

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

Sources: `package.json`, `src/omp/extension.ts`, `src/omp/plugin.ts`, and `src/daemon/client.ts`. This section describes the attach path from source reading. The live run is under Live verification.

Entry. `package.json` declares `"omp": { "extensions": ["./dist/src/omp/extension.js"] }`. The module's default export is `realmExtension(pi)`. It is the only module in the Omp wiring that reads `process.env`. It resolves the state directory and the control socket path once, and passes an `attachDaemon` function to `registerRealmPlugin` (`src/omp/extension.ts`, `src/omp/plugin.ts`).

Attach at session start. The `session_start` handler starts the attach without awaiting it. The attach and its first status read share a 10-second budget (`STARTUP_BUDGET_MS`). The attach:

1. Ensures a daemon answers on the control socket. When none does, it spawns `dist/src/daemon/main.js` detached.
2. Connects to the control socket and calls `up` with the session working directory (`ctx.cwd`) as the workspace root. `up` is idempotent.
3. Calls `status`. The reply carries the snapshot and the policy mode. The mode is stored on the session.

The status indicator is one status item, keyed `realm`. Its text is `<marker> <label> · <reason> · <last-transition time>`. The marker is `●` for active and `○` otherwise, and `[degraded]` follows the label when `displayStatus` marks the state degraded. There is no tooltip API on this host, so the reason and time ride in that text (P5-D5). A failed attach paints the error state with its code.

From session start, the indicator refreshes every 2 s (`STATUS_POLL_MS`, a managed interval). Each tick reads daemon status only while a client is attached, and that read runs under a 5 s timer (`GUARD_STATUS_BUDGET_MS`). Session shutdown clears the interval and every other timer the plugin armed.

Mode and guard. Each guarded host write reads the daemon status under a managed timer, stores the mode it reports, and repaints the indicator. If that read fails, the last mode the daemon reported decides: `advisory` warns and the write proceeds, and `fail-closed` blocks it. If no mode has been reported yet, the write is blocked (`src/omp/plugin.ts`).

Shutdown. `session_shutdown` closes the control client and clears the session. It never sends `down`. The daemon keeps the sandbox, and a host shutdown is only a detach of this host (`endSession`, `src/omp/plugin.ts`). The sandbox persists until `realm down`.

## Live verification (2026-10-23, Omp 18.12.5)

Run on this host with the built extension loaded by `-e`, under an isolated profile. HOME and XDG_CONFIG_HOME pointed at scratch directories, and `--no-extensions` so only the realm extension loads. The orchestrator ran these sessions from its own top-level shell, outside the swarm, as the owner approved.

Two defects found by the live run were fixed in this pass:

- The `session_start` handler read the context as its first argument. The host calls handlers as `(event, ctx)`, so `ctx.setInterval` was undefined and the status item never painted. `src/omp/plugin.ts` now takes `(event, ctx)`, and the plugin tests call handlers the same way.
- A daemon that refused to start was reported as `DAEMON_START_TIMEOUT`. The daemon writes its own code to `<stateDir>/daemon.log` as `realm daemon: <CODE>`. `src/daemon/ensure.ts` reads that line, and `realm up`, `realm mcp`, `realm acp`, and the Omp attach report that code.

Observed status item (`extension_ui_request`, method `setStatus`, `statusKey` `realm`):

| Scenario | Status item after the attach | daemon.log |
| --- | --- | --- |
| No policy file; the workspace is outside every policy root | `○ realm disconnected · POLICY_DENIED · <time>` | `realm daemon: POLICY_DENIED` |
| Policy file lists the workspace root | `○ realm disconnected · PODMAN_MACHINE_DOWN · <time>` | `realm daemon: PODMAN_MACHINE_DOWN` |

In both runs the item first read `connecting`, never `active`. stderr was empty, and no daemon was left running. With a policy file the refusal comes from the daemon's startup Podman check: this host has no reachable Podman API, and the installed Podman is 4.9.3, below the 5.x that OpenShell requires. `realm up` reports the version first (`PODMAN_UNSUPPORTED_VERSION`), because the CLI probes Podman before it spawns the daemon.

Retry: `realm-retry` is listed by `get_available_commands`. Sent as a `prompt` message, it was accepted (`success: true`), the item repainted `connecting`, and then it settled on the same reason. The retry's reply text does not appear in the RPC frames.

Requirements on this host:

| Requirement | Result on this host | Evidence or reason |
| --- | --- | --- |
| OMP-LIVE-02 | Met | Disconnected with the daemon's own reason; never active |
| OMP-LIVE-03 | Partial | The retry re-runs the attach in the same session; a reattach to active is not reachable here |
| OMP-LIVE-01 | Not met | No daemon answers: the daemon refuses at startup (Podman), and AgentOS is unbound (`src/runtime/session-execution.ts:208-210`) |
| OMP-LIVE-04 | Not met | No daemon runs, so nothing survives shutdown |
| UI-01 | Partial | The item appears at launch. Non-blocking is not shown: see below |

UI-01 detail. The attach alone fails in about 1.3 s (probe 2 ms; worst event-loop lag 71 ms under Node and 239 ms under Bun). Inside Omp the same failure paints about 6 s after launch, and a `get_state` sent one second after launch was answered only after the failure. In separate probes, a plugin-free extension, a `tool_call` handler, a registered command, a managed timer, and a detached spawn each answered `get_state` within about one second. The cause of the delay is not isolated, so UI-01's "without blocking the session" is not demonstrated.

The session context provides `setTimeout`, `setInterval`, `clearTimer`, and `ui.setStatus`. The plugin uses only these.

### Runbook

1. `npm run build`, then confirm that `<repo>/dist/src/omp/extension.js` exists.
2. Write `<scratch>/config/realm/config.json` with `image` (a digest pin), `workloadArgv`, `stateDir` set to `<scratch>/state`, and `workspaceRoot` set to `<scratch>/workspace`. The schema is in the runtime configuration section of `docs/policy-reference.md`. The extension reads `$XDG_CONFIG_HOME/realm/config.json` when `XDG_CONFIG_HOME` is absolute.
3. To reach the attach path, also write `<scratch>/state/policy.json` as `{"workspaceRoots":["<scratch>/workspace"]}`. Without it the daemon refuses with `POLICY_DENIED`.
4. Start the session inside the workspace root, because the attach uses the session working directory: `cd <scratch>/workspace && env HOME=<scratch>/home XDG_CONFIG_HOME=<scratch>/config omp --mode=rpc-ui --no-extensions --profile=realm-live-check -e <repo>/dist/src/omp/extension.js`.
5. On stdin, write one JSON line per request: `{"id":"c1","type":"get_available_commands"}`, then `{"id":"s1","type":"get_state"}`. To retry, write `{"id":"p1","type":"prompt","message":"/realm-retry"}`. Close stdin to end the session.
6. Record every stdout line whose `method` is `setStatus` and whose `statusKey` is `realm`, and any `extension_error` line.
7. Afterwards run `env XDG_CONFIG_HOME=<scratch>/config node <repo>/dist/src/cli/main.js status`. If a daemon answers, stop it with `down` using the same command, then confirm with `status`.
8. Delete `<scratch>`.

`--no-extensions` keeps the run to the realm extension. HOME points at scratch so the Omp profile, sessions, and caches stay out of the real home.

Decision for the owner: whether a truthful disconnected status satisfies OMP-LIVE-01 and OMP-LIVE-03, which say "attaches". An active attach needs Podman 5.x and an AgentOS driver, which is the scope of the follow-up milestone (RT-04, CLI-01).
