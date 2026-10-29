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

Anything below marked upstream-sourced was not found on the two official `omp.sh` pages and stays a recorded limitation (OQ-P5-01). Update 2026-10-29: the behaviour OQ-P5-01 asked about was observed on Omp 18.12.6 and the question is closed for that version (see "Enforcement spike"); the official pages themselves were not re-read in that pass and still do not state it.

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

Status: **ANSWERED by execution on Omp 18.12.6 (2026-10-29, OMPX-01, phase 12).** Fail-closed mode may remove the built-in tools with `setActiveTools`, and a removed tool is refused at execution. The removal must be an allowlist, not `write`/`edit`/`bash` alone: after those three are removed, `write` stays as the device transport and `ast_edit`, `lsp`, `debug`, `eval` and `task` stay callable. The results table, the tools that remain, the recommended rule and the limits are under "Enforcement spike" below. The rest of this section (from "Decision basis" to the 2026-10-28 re-read) is the record of what was known before the spike and is kept as history.

Decision basis: D-03 says host write and edit tools are disabled only in required mode. Phase 1 records the question only.

What the sources show (so Phase 5 starts from evidence, not from memory):

- Launch-time switches exist: `--no-tools` "disables all built-in tools" and `--tools <a,b,c>` enables a named list (upstream `cli-reference.md`). These are operator flags, not a plugin mechanism.
- SDK sessions can set `restrictToolNames: true`, which limits the session to `toolNames`, and "restricted sessions disable ambient MCP, extensions, custom commands, and LSP by default" (upstream `sdk.md`). This applies to SDK sessions, not to a plugin loaded into an interactive session.
- The extension API exposes `getActiveTools`, `getAllTools`, `setActiveTools`, and `await pi.setActiveTools(...)` (upstream `extensions.md`). Whether this removes built-in `write` and `edit` from the model's callable set, and whether that is enforced at execution time, is **not documented** in the sections read.
- `tool_call` handlers can block execution, and errors or timeouts block it (upstream `extensions.md`). Whether a `tool_call` block on `write`/`edit` satisfies a required-mode rule is **not documented** and is not a verified control.
- `registerFileWriteFallback` lets a handler take over a write when the built-in byte-write does not complete (upstream `extensions.md`, "File write fallback"). This is a fallback, not a removal, and must not be treated as a control.

Open for Phase 5: which mechanism (an extension `setActiveTools` call, a `tool_call` block, a launch-time `--tools` list enforced by the launcher, or a combination) can make required mode hold without relying on a model's cooperation. Each candidate needs a test in Phase 5 before it is chosen.

Phase 5 verification (read 2026-10-22, https://omp.sh/docs/extension-authoring and https://omp.sh/docs/hooks): the official `ExtensionAPI` table lists `setActiveTools` (with `getActiveTools` / `getAllTools`), and the official hooks page defines the `tool_call` return `{ block?, reason?, input? }` with first-block-wins dispatch and fail-closed timeouts. Neither official page documents that removing `write` / `edit` via `setActiveTools` provably enforces required mode at execution, nor that a `tool_call` block covers every host execution path. Upstream `sdk.md` documents `restrictToolNames: true` with `toolNames` and `setActiveToolsByName(names)` for SDK sessions only — not a plugin mechanism. Status stays **OPEN** (OQ-P5-01, OQ-P5-02); anything claiming enforcement is `not documented` and Phase 5 code must stay fail-closed.

Re-read 2026-10-23 (https://omp.sh/docs/hooks and https://omp.sh/docs/extension-authoring, the same two pages): the hooks page defines the `tool_call` return as `{ block?, reason?, input? }`, says the first block stops dispatch, and says replacement input on a model-issued call is revalidated before execution. The extension-authoring page documents managed timers (`ctx.setTimeout`, `ctx.setInterval`) that are cleared on session shutdown. Neither page states that a `tool_call` block covers launch-time tool flags, SDK sessions, or a host that ignores the hook. Those are the residual paths named in `src/omp/plugin.ts`. OQ-P5-02 therefore stays **OPEN**: the guard is not claimed to cover every execution path.

OQ-P5-02, re-read for phase 9.7 (the Omp extension documentation pages `hooks.md` and `extensions.md`, read on 2026-10-28 through the `omp://` internal documentation). The documentation now states that a `tool_call` handler may return a block, and that the first block short-circuits. A handler error or timeout blocks (budget `extensionHandlers.toolCallTimeoutMs`, default 30000 ms). `tool_call` runs during argument preparation, before scheduling and approval. Calls made through the eval-prelude bridge do not emit `tool_call`. SDK sessions with `restrictToolNames` disable extensions by default. Still unsettled: paths that bypass the extension runner, `setActiveTools` enforcement, and tools other than `write` and `edit`. The guard's list is `write` and `edit` only, so `bash`, `ast-edit` and `eval` are not guarded. There is no documented way to raise a `write` or `edit` tool call without a model, and the model provider is currently out of quota, so OMP-05 stays unit-proven. OQ-P5-02 stays **OPEN**.

Update 2026-10-29 (the enforcement spike, Omp 18.12.6, VERIFIED_BY_EXECUTION): of the three points left unsettled above, `setActiveTools` enforcement and the tools other than `write` and `edit` are settled by observation, and the paths that bypass the extension runner are partly settled; one statement above is also not what Omp 18.12.6 does. `setActiveTools` removal is enforced at execution: a call to a removed tool is refused with `Tool <name> not found`, and the tool is absent from the list the model is offered. Every native tool that writes a file or runs a command passes through the same mechanism. A call made through the eval-prelude bridge (`tool.bash(...)` inside `eval`) does emit `tool_call`, with a `js-bash-` call id, and a block on it holds; what `eval` itself writes through the runtime's file API is not a tool call, and no hook sees it. OQ-P5-02 is restated, narrowly, under "Enforcement spike".

### Q5. Does this note permit any plugin code now?

No. No file under `plugin/` is created. No manifest file is written. The examples above are quotations of official documentation, not code for this repository.

## Blocked module

`plugin/` (Phase 5). Phase 5 must answer Q4 before any plugin code that claims required-mode enforcement is written.

## Not in this note

- The package's `omp` field points at `./dist/src/omp/extension.js`. No `.omp-plugin/` tree and no `mcp.json` exist.

## Entry and attach (closure, 2026-10-22)

Sources: `package.json`, `src/omp/extension.ts`, `src/omp/plugin.ts`, and `src/daemon/client.ts`. This section describes the attach path from source reading. The live run is under Live verification.

Entry. `package.json` declares `"omp": { "extensions": ["./dist/src/omp/extension.js"] }`. The module's default export is `realmExtension(pi)`. It is the only module in the Omp wiring that reads `process.env`. It resolves the state directory and the control socket path once, and passes an `attachDaemon` function to `registerRealmPlugin` (`src/omp/extension.ts`, `src/omp/plugin.ts`).

Attach at session start. The `session_start` handler starts the attach without awaiting it. The attach and its first status read share a 200-second budget (`STARTUP_BUDGET_MS`, 200000 ms). The attach:

1. Ensures a daemon answers on the control socket. When none does, it spawns `dist/src/daemon/main.js` detached.
2. Connects to the control socket and calls `up` with the session working directory (`ctx.cwd`) as the workspace root. `up` is idempotent.
3. Calls `status`. The reply carries the snapshot and the policy mode. The mode is stored on the session.

The status indicator is one status item, keyed `realm`. Its text is `<marker> <label> · <reason> · <last-transition time>`. The marker is `●` for active and `○` otherwise, and `[degraded]` follows the label when `displayStatus` marks the state degraded. There is no tooltip API on this host, so the reason and time ride in that text (P5-D5). A failed attach paints the error state with its code.

From session start, the indicator refreshes every 2 s (`STATUS_POLL_MS`, a managed interval). Each tick reads daemon status only while a client is attached, and that read runs under a 5 s timer (`GUARD_STATUS_BUDGET_MS`). Session shutdown clears the interval and every other timer the plugin armed.

A runner exit while the session is active, or one failed liveness probe, is detected by the daemon's health probe, which runs every 10 seconds (in `active` and `degraded`). A failed probe is an `alive` answer of false, no answer in time, or a rejection, which covers a stale heartbeat and an OpenShell failure. Either one holds the supervisor and the session moves to `error` with the reason `AGENTOS_CRASH_LOOP` (RT-04): there is no automatic restart and no hysteresis. Recovery is `realm down` then `realm up`, or the retry command. The bounded start retry (base 500 ms, cap 8000 ms, the fifth consecutive failure holds) applies to the initial start only. The status item therefore reads `realm disconnected` without running `realm doctor`. A `realm doctor` run on an active session whose liveness probe fails also holds the supervisor and shows the `AGENTOS_CRASH_LOOP` failure.

The terminal rule starts once the initial start has finished. A `realm doctor` run while `realm up` is still starting the runner lists the `agentos` item as failed, with the detail the doctor uses for every not-live reading ("AGENTOS_CRASH_LOOP: the AgentOS driver reports no live session"; the code name there is the doctor's label, not a state change). It changes nothing else: it does not probe the driver, does not hold the supervisor and counts no failure, so the session still reaches `active` and stays there. Checked live on 2026-10-29: two doctor runs overlapping a pending `realm up`, then two health intervals, status `active` throughout.

Mode and guard. Each guarded host write reads the daemon status under a managed timer, stores the mode it reports, and repaints the indicator. If that read fails, the last mode the daemon reported decides: `advisory` warns and the write proceeds, and `fail-closed` blocks it. If no mode has been reported yet, the write is blocked (`src/omp/plugin.ts`).

Shutdown. `session_shutdown` closes the control client and clears the session. It never sends `down`. The daemon keeps the sandbox, and a host shutdown is only a detach of this host (`endSession`, `src/omp/plugin.ts`). The sandbox persists until `realm down`.

## Live verification (2026-10-23, Omp 18.12.5)

Run on this host with the built extension loaded by `-e`, under an isolated profile. HOME and XDG_CONFIG_HOME pointed at scratch directories, and `--no-extensions` so only the realm extension loads. The orchestrator ran these sessions from its own top-level shell, outside the swarm, as the owner approved.

Two defects found by the live run were fixed in this pass:

- The `session_start` handler read the context as its first argument. The host calls handlers as `(event, ctx)`, so `ctx.setInterval` was undefined and the status item never painted. `src/omp/plugin.ts` now takes `(event, ctx)`, and the plugin tests call handlers the same way.
- A daemon that refused to start was reported as `DAEMON_START_TIMEOUT`. The daemon writes its own code to `<stateDir>/daemon.log` as `realm daemon: <CODE>`. `src/daemon/ensure.ts` reads that line, and `realm up`, `realm mcp`, `realm acp`, and the Omp attach report that code. A `LOCK_CONFLICT` line is not reported: it is what a second daemon writes when it finds a live daemon owning the socket, so the hosts waiting for the first one keep waiting. The Omp attach and the CLI share one probe (`daemonAnswers`), so a daemon that is still binding its socket or busy with its startup reap is waited for, never spawned over.

Observed status item (`extension_ui_request`, method `setStatus`, `statusKey` `realm`):

| Scenario | Status item after the attach | daemon.log |
| --- | --- | --- |
| No policy file; the workspace is outside every policy root | `○ realm disconnected · POLICY_DENIED · <time>` | `realm daemon: POLICY_DENIED` |
| Policy file lists the workspace root | `○ realm disconnected · PODMAN_MACHINE_DOWN · <time>` | `realm daemon: PODMAN_MACHINE_DOWN` |

In both runs the item first read `connecting`, never `active`. stderr was empty, and no daemon was left running. With a policy file the refusal comes from the daemon's startup Podman check: this host has no reachable Podman API, and the installed Podman is 4.9.3, below the 5.x that OpenShell requires. `realm up` reports the version first (`PODMAN_UNSUPPORTED_VERSION`), because the CLI probes Podman before it spawns the daemon.

Retry: `realm-retry` is listed by `get_available_commands`. Sent as a `prompt` message, it was accepted (`success: true`), the item repainted `connecting`, and then it settled on the same reason. The retry's reply text does not appear in the RPC frames.

Requirements. The owner reinstated OMP-LIVE-01, OMP-LIVE-03 and OMP-LIVE-04 on 2026-10-25, so none of them is descoped. They were verified live on 2026-10-28 on the final build; each row names what that check observed (see "Live Omp checks (2026-10-28)" below). The 2026-10-23 host results are kept in the same rows as dated history, marked historical, because that host had no reachable daemon:

| Requirement | Status | Evidence |
| --- | --- | --- |
| OMP-LIVE-01 | Verified live, 2026-10-28 | Omp 18.12.6 in a tmux pane, isolated profile, Podman 5.7.1, final build: the plugin attached and the status item read `● realm active · container running` (the same observation covers OMP-01 and OMP-02). Historical (2026-10-23 host, superseded): not met, because no daemon answered; the daemon refused at startup (Podman). |
| OMP-LIVE-02 | Met (2026-10-23 evidence, still true) | Disconnected with the daemon's own reason; never active |
| OMP-LIVE-03 | Verified live, 2026-10-28 | After `realm down` from another shell the status item read `realm disconnected · REALM_NOT_ACTIVE`; the `/realm-retry` command then reattached in the same Omp session: `connecting`, then `● realm active` in 24 seconds (also OMP-04). Historical (2026-10-23 host, superseded): partial; the retry re-ran the attach in the same session, but a reattach to active was not reachable there. |
| OMP-LIVE-04 | Verified live, 2026-10-28 | After Omp was quit, the same daemon process was still running and `realm status` reported active. Historical (2026-10-23 host, superseded): not met, because no daemon ran, so nothing survived shutdown. |
| Runner killed in the sandbox | Observed live, 2026-10-28 | The AgentOS runner was killed inside the sandbox. The status item changed to `○ realm disconnected · AGENTOS_CRASH_LOOP` within the 10 second health interval, observed 10.8 seconds after the kill (the plugin's poll cadence plus the probe interval). `/realm-retry` from that error state went to `connecting` and then `● realm active` in 4 seconds (OMP-04). |
| OMP-05 | Not proven live | The write and edit guard when disconnected needs a model call, and no model call was made. |
| UI-01 | Partial (re-measured 2026-10-28; a measurement, not a proof) | The item appears at launch. Non-blocking is not shown: see below |

UI-01 detail. Measurement of 2026-10-23: the attach alone fails in about 1.3 s (probe 2 ms; worst event-loop lag 71 ms under Node and 239 ms under Bun). Inside Omp the same failure paints about 6 s after launch, and a `get_state` sent one second after launch was answered only after the failure. In separate probes, a plugin-free extension, a `tool_call` handler, a registered command, a managed timer, and a detached spawn each answered `get_state` within about one second. The cause of the delay is not isolated, so UI-01's "without blocking the session" is not demonstrated.

Measurement of 2026-10-28 (Omp 18.12.6 in a tmux pane, isolated profile, Podman 5.7.1, final build, on a host with a load average near 30): Omp itself took 25 seconds to paint its first screen. From then on, through a 24 second cold attach, a keystroke sent every 2 to 3 seconds appeared in the editor within 0.2 to 1.2 seconds. The probe's own floor is about 0.2 to 0.3 seconds, so this bounds the stall on that run. It is a measurement and not a proof: it does not show that the loop is never blocked, and the requirement's status is the owner's to change. The earlier finding stands as history: `get_state` waited about 6 seconds.

The session context provides `setTimeout`, `setInterval`, `clearTimer`, and `ui.setStatus`. The plugin uses only these.

### Runbook

1. `npm run build`, then confirm that `<repo>/dist/src/omp/extension.js` exists.
2. Write `<scratch>/config/realm/config.json` with `image` (a digest pin), `stateDir` set to `<scratch>/state`, and `workspaceRoot` set to `<scratch>/workspace`. Set `<scratch>/state` to mode 0700 (`chmod 700`); the daemon refuses any other mode with `SCHEMA_INVALID`, and `realm doctor` reports it as the failing `state-dir` check. The schema is in the runtime configuration section of `docs/policy-reference.md`. The extension reads `$XDG_CONFIG_HOME/realm/config.json` when `XDG_CONFIG_HOME` is absolute.
3. To reach the attach path, also write `<scratch>/state/policy.json` as `{"workspaceRoots":["<scratch>/workspace"]}`. Without it the daemon refuses with `POLICY_DENIED`.
4. Start the session inside the workspace root, because the attach uses the session working directory: `cd <scratch>/workspace && env HOME=<scratch>/home XDG_CONFIG_HOME=<scratch>/config omp --mode=rpc-ui --no-extensions --profile=realm-live-check -e <repo>/dist/src/omp/extension.js`.
5. On stdin, write one JSON line per request: `{"id":"c1","type":"get_available_commands"}`, then `{"id":"s1","type":"get_state"}`. To retry, write `{"id":"p1","type":"prompt","message":"/realm-retry"}`. Close stdin to end the session.
6. Record every stdout line whose `method` is `setStatus` and whose `statusKey` is `realm`, and any `extension_error` line.
7. Afterwards run `env XDG_CONFIG_HOME=<scratch>/config node <repo>/dist/src/cli/main.js status`. If a daemon answers, stop it with `down` using the same command, then confirm with `status`.
8. Delete `<scratch>`.

`--no-extensions` keeps the run to the realm extension. HOME points at scratch so the Omp profile, sessions, and caches stay out of the real home.

Run of 2026-10-24 on Podman 5.7.1 (private API socket). Podman 5.7.1 was built from the upstream v5.7.1 source and installed under `/usr/local/bin`; the apt 4.9.3 package is unchanged. The live session reached a private Podman 5.7.1 API socket through `XDG_RUNTIME_DIR`. The status item read `connecting`, then `○ realm disconnected · SCHEMA_INVALID`; standard error was empty, and the daemon wrote the same code to its log. `realm doctor` passed the `podman`, `podman-service`, and `openshell` checks on this run. The policy file and the runtime configuration each load when called directly, so the refusing check is not isolated. Historical (superseded 2026-10-28): this run was made before the AgentOS driver was bound; the driver is now always bound from the configured digest-pinned image. Storage isolation was not enforced: the realm's Podman probe passes only `PATH`, `HOME`, and `XDG_RUNTIME_DIR` to the Podman child (`src/runtime/podman-probe.ts`), so `CONTAINERS_STORAGE_CONF` did not reach it. The shared rootful storage database changed at 02:09:52, after the isolated session; the writer is not attributed.

Owner decisions (2026-10-23 and 2026-10-24, historical, superseded 2026-10-25): OMP-LIVE-01 and OMP-LIVE-04 were descoped from v2.0 to the follow-up milestone (RT-04, CLI-01), and OMP-LIVE-03 the same way, because its reattach also needed an active daemon. The owner reinstated all three on 2026-10-25; they are no longer descoped. Until a daemon could answer, the v2.0 behaviour was the truthful disconnected status with the daemon's own reason, and that status is still how a failed attach is shown (OMP-LIVE-02).

### Live Omp checks (2026-10-28)

Verified live on 2026-10-28 on the final build (Omp 18.12.6, Podman 5.7.1), in a live Omp TUI session driven by hand, against the production stack (OpenShell 0.1.5 gateway, the Realm compute driver, rootless Podman 5.x). Steps 3, 7 and 8 each carry the live requirement they observe (OMP-LIVE-01, OMP-LIVE-03 and OMP-LIVE-04):

1. Run the built extension with `-e` under an isolated profile, in a pseudo-terminal such as tmux. Print mode never shows the status item.
2. Skip the first-run setup wizard of Omp with the Escape key. At the first launch of a fresh isolated profile the wizard has five steps, and each needs one Escape, so send five.
3. Read the status line. It reads `● realm active · container running` after attach (OMP-01, OMP-02, OMP-LIVE-01).
4. Kill the AgentOS runner inside the sandbox. At the daemon's 10 second health interval the status line reads `○ realm disconnected · AGENTOS_CRASH_LOOP` (observed 10.8 seconds after the kill, the plugin's poll cadence plus the probe interval).
5. Run the `/realm-retry` slash command from that error state. The status line reads `connecting`, then `● realm active`, in 4 seconds (OMP-04).
6. In another shell run `realm down`. After the poll interval (about 2 seconds) the status line reads `realm disconnected` with the reason `REALM_NOT_ACTIVE`. This is the disconnected state that the next step recovers from.
7. Run `/realm-retry` again. The status line reads `connecting`, then `● realm active`, in the same Omp session, in 24 seconds (OMP-04, OMP-LIVE-03).
8. Quit Omp. Confirm the same daemon process is still running and `realm status` reports active (OMP-LIVE-04).

Limits. OMP-05 (the write and edit guard when disconnected) needs a model call and stays unproven live. The ACP surface was exercised live on 2026-10-29 by a separate client (`docs/integration/acp.md`), not by these Omp checks. The Anda engine is not in scope.

### Closing OMP-05 live (needs a model)

OMP-05 stays partial because the guard sits on the host's `tool_call` hook, and only a model can make the host call its own `write` or `edit` tool. The guard's decisions are unit-tested in `test/omp/plugin.test.ts`; this procedure observes them in a live host. It needs an Omp profile with a working model provider. The realm account's profile ran out of quota on 2026-10-28; a provider key is the owner's to supply, and none is stored in this repository.

1. Run steps 1 to 3 of the live checks above, under an isolated profile, until the status item reads `● realm active`.
2. Advisory mode (the default). Run `realm down` in another shell so the item reads `○ realm disconnected · REALM_NOT_ACTIVE`, then ask the model to create a file in the workspace with its write tool. Expected: the call goes through, Omp shows the notice "realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy" (once the daemon is gone the guard cannot read the realm's state, so it reports the code of the failed read; when a daemon answers in a state other than active, the notice reads "realm is <state>; the write proceeds under advisory policy"), and the file exists on the host. Delete that file before step 3.
3. Fail-closed mode. Write `"mode": "fail-closed"` in the state directory's policy file (`docs/policy-reference.md`, `mode`), restart the daemon, reattach with `/realm-retry`, run `realm down`, and ask the model to write a file at a fresh path that you have confirmed does not exist. Expected: Omp reports the call blocked, with `REALM_NOT_ACTIVE` as the reason (when a daemon answers in another state, the reason is `REALM_UNBOUND`, `REALM_STOPPING` or `REALM_NOT_ACTIVE`, whichever fits that state), and the file does not exist.
4. Record both outcomes with the Omp version. Writes made through the bash tool, and any other host path that does not pass the `tool_call` hook for `write` or `edit`, are not covered by this guard (OQ-P5-02) and stay outside the claim.

### Scripted-provider and abrupt-end observations (2026-10-29)

The guard was also observed in a real Omp 18.12.6 host with no model account. A local scripted provider (a `models.yml` entry with `api: openai-completions` and a dummy key) answered one prompt per check with a call to Omp's own `write` tool, and the status item, the notice and the tool result were read from Omp's RPC frames. With the realm active the write succeeded. After `realm down` in advisory mode the notice read `realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy` and the file was written. In fail-closed mode the write was blocked with `REALM_NOT_ACTIVE` and no file was created. The model was a script, so this is not an LLM-driven run, and OMP-05's status stays the owner's decision.

The tool list that Omp offered the model with the extension loaded contained Omp's own tools only (`bash` and `eval` among them) and no Realm tool. After SIGHUP and then SIGKILL of the Omp process, the daemon and the container were unchanged, the file written through Omp was on the host, and the next session attached to the same container. Omp's own `write` overwrote the file in place: `open`, one `write`, `ftruncate`, `close`, with no temp file, no rename and no `fsync`.

The steps, the provider and the expected results are in `omp-lifecycle-runbook.md`. The recorded output is in the quick task `261029-g7m` under `.planning/quick/`.

## Enforcement spike (OMPX-01, 2026-10-29, Omp 18.12.6)

What Omp does when an extension removes, shadows, blocks or observes its built-in tools, observed on Omp 18.12.6 (`omp --version` prints `omp/18.12.6`), Linux x64, Node 24.18. Evidence labels: **VERIFIED_BY_EXECUTION** means the row is asserted by `test/integration/omp-spike.test.ts`, which a newer Omp that behaves differently fails; **VERIFIED_BY_CODE_READING** and **INFERENCE** are as in the research of phase 12.

Method. The spike uses a test extension, `test/support/omp-spike-extension.ts`, not the Realm plugin, so no answer depends on a Realm bug. Omp runs as `omp --mode rpc-ui --no-extensions -e <extension> --model stub/scripted --no-session` under an isolated profile (own `PI_CODING_AGENT_DIR`, `HOME` and `XDG_CONFIG_HOME`, no credentials, no real model). A scripted OpenAI-compatible provider emits exactly one tool call per prompt. The extension logs `tool_call`, `tool_result`, `getActiveTools()` and `getAllTools()` to a JSONL file that the test reads. No Podman, daemon or image is involved. The suite is gated like the guard suite: `REALM_LIVE_OMP=1` (the test never sets it), the Omp executable and its version (18.12.6 or newer), and the built extension. S11 also needs `REALM_OMP_NET_TRACE=1` and a `strace` that can trace; S5 needs `unshare -m`. A newer Omp runs and is recorded, and fails a row it behaves differently on.

| ID | Question | Observed result on Omp 18.12.6 | Evidence |
| --- | --- | --- | --- |
| S1 | Does an extension tool registered under a built-in's name replace it? | Yes. `getAllTools()` lists `write:extension` and no `write:builtin`. The model's `write {path, content}` ran the extension's `execute` with exactly that input; no file was written; `ctx.invokeTool` is a function. `tool_call` and `tool_result` still fired around it. A Zod object schema is accepted. | VERIFIED_BY_EXECUTION |
| S1b | Do extension tools under their own names run? | Yes. `exec`, `status` and `list` (a raw JSON Schema object as `parameters`) were active, were offered to the model and ran. `ctx.invokeTool` is `undefined` for a name that is not a built-in. | VERIFIED_BY_EXECUTION |
| S2a | After `setActiveTools` without `write`, `edit`, `bash`, `eval`, `ast_edit`, `lsp`, `debug` and `task`, is every one refused? | Yes. `getActiveTools()` afterwards was `read, ask, glob, grep, wait, todo, web_search`. Eleven calls (each removed tool, then `write xd://ast_edit`, `write xd://eval`, `write local://scratch.txt`) all returned `isError` with the text `Tool <name> not found`; no execute ran; `tool_call` never fired for them; the workspace held only its seed file. `read xd://` reported 0 mounted tool devices. The provider's next request offered exactly the active set. | VERIFIED_BY_EXECUTION |
| S2a (shadow) | The same, with `write` replaced by an extension tool? | Yes. The seven other removed names were refused as above. `write xd://ast_edit` reached the extension's `execute` as an ordinary string path, and nothing was mounted under `xd://`. | VERIFIED_BY_EXECUTION |
| S2b | Does a removal survive a new session? Does `session_start` fire again? | The removal persisted (`bash` still `Tool bash not found`). `session_start` did not fire again; `session_switch` fired once, with a new session id and the same restricted set. | VERIFIED_BY_EXECUTION |
| S2c | What survives a removal of `write`, `edit` and `bash` only? | `write` stays active as the device transport. It refuses a workspace path (`limited to the xd:// device transport and local:// session scratch`). `read xd://` lists three mounted devices: `ast_edit`, `debug`, `lsp`. `write local://scratch.txt` succeeded and wrote nothing into the workspace: the file landed in `omp-local/<session id>/` under Omp's temporary directory. `eval` stayed active and wrote `e.txt` in the workspace with `Bun.write`. | VERIFIED_BY_EXECUTION |
| S3 | Does a nested `write xd://<tool>` call emit its own `tool_call`? | Yes. A valid `write xd://ast_edit` emitted `tool_call` for the outer `write`, then one for the inner `ast_edit` with the same call id and the device's own input. A block on `ast_edit` blocked the call (the result text was the reason) and the blocked inner call had no `tool_result`. | VERIFIED_BY_EXECUTION |
| S4 | What do `tool_call` and `tool_result` handlers do? | A block makes the reason the result text with `isError`; `execute` does not run and no `tool_result` event fires for it. A returned `input` replaces the input `execute` receives (the event showed the original). A throw blocks the call with `Extension <file> failed: <message>`. A handler that never settles blocks it with `Extension <file> timed out after <n>ms`; the budget is `extensionHandlers.toolCallTimeoutMs` and took the value 3000 from `config.yml` in the agent directory. A `tool_result` return replaced the content and `isError` on the wire, while the event itself showed the result before the replacement. An `execute` that returns `isError: true`, and one that throws, both reach the model as tool errors. | VERIFIED_BY_EXECUTION |
| S5 | What does `registerFileWriteFallback` do? | It ran only after a native write failed with `EROFS` (a bind-mounted read-only workspace in its own mount namespace). The handler received the absolute destination, the content, a session id and the cause `EROFS`; returning `true` made Omp report `Successfully wrote 14 bytes to ro.txt` while the bytes went to another file and the workspace path stayed absent. A write to a writable path never reached it. It is a redirect for a host that denies writes, not a control. | VERIFIED_BY_EXECUTION |
| S6 | Does a subagent (`task`) session load the extension and meet the hooks? | Yes, in the same process. The `task` call returned `Spawned agent <name> (job <name>)` at once. The subagent session loaded the extension again, ran `session_start` with its own session id and its own base tool set (`read, bash, edit, eval, glob, grep, task, wait, web_search, write, ast_edit, debug`), and the extension's own `setActiveTools` removed `bash` from it (`Tool bash not found`; the subagent was never offered `bash`). Its `write` met the `tool_call` block and no file was created. Observed with the extension loaded by `-e`; a subagent of an Omp that does not load it was not run. | VERIFIED_BY_EXECUTION |
| S7 | Does the eval bridge pass the hook? Does `eval` bypass it? | A bridge call `tool.bash(...)` inside `eval` emitted `tool_call` for `bash` with a `js-bash-` call id, and the block held (no file). The documentation says the bridge emits no `tool_call`; on 18.12.6 it does. `eval` itself is one tool call: what its code writes with `Bun.write` is invisible to every hook, so `eval` must be removed. `ast_edit` through the device transport only stages a proposal (`files NOT modified yet`); the file changed only after `write xd://resolve` (`Applied 2 replacements in 1 file`), and `resolve` is not a tool (only the outer `write` reached the hook). | VERIFIED_BY_EXECUTION |
| S8 | Does a user-initiated shell command pass the hook or the removal? | No. The RPC `bash` command ran with `bash` removed, wrote the file, and produced no `tool_call`. It is the user's action, outside the model's reach, and no extension hook or removal covers it. | VERIFIED_BY_EXECUTION |
| S9 | What happens to an invalid call against a raw JSON Schema? | Omp rejects it before `execute`: `Validation failed for tool "list"` with `depth: is required`; `execute` ran for the valid call only. | VERIFIED_BY_EXECUTION |
| S10 | Does Omp rewrite an absolute path before an extension `write` sees it? | No. The shadowed `write` received the absolute path as sent. Whether the Realm `write` accepts it is Realm's schema (it rejects a leading `/`), not Omp's. | VERIFIED_BY_EXECUTION |
| S11 | What network does a startup make, and which lever gives a clean trace? | See "HARN-03 network finding". Cold profile 46 non-loopback connects, warm profile 0, a refusing loopback proxy 0 on a cold profile. | VERIFIED_BY_EXECUTION |
| S12 | Which tools prompt in a non-yolo approval mode? | With `tools.approvalMode: always-ask` a tool with no declared tier and a tool declared `approval: "exec"` each raised a `select` dialog (`Allow tool: <name>` with `Approve`, `Approve <name> for this session`, `Deny`); a tool declared `approval: "read"` and Omp's native `read` raised none. `tool_call` ran before the prompt. The harness answers a `select` with a cancel, which Omp reports as `Tool call denied by user: <name>`, and the denied tool did not run. | VERIFIED_BY_EXECUTION |
| S13 | What happens to a 1 MiB tool result? | Omp truncated it in the middle to 40 960 bytes plus a marker (41 073 characters visible) before the `tool_result` hook saw it, and attached `details.meta.truncation` (`direction: middle`, `totalBytes: 1048576`, `maxBytes: 40960`, `elidedBytes: 1007616`, an `artifactId`). The tool's own `details` survived and the model's next request carried the same truncated text. A Realm `read` of the full 1 MiB would therefore reach the model truncated. | VERIFIED_BY_EXECUTION |
| S14 | What does SIGKILL do in the middle of a tool call? | Omp exited with signal SIGKILL; the call whose `execute` had started never finished (no `tool_execution_end`, no `tool_result`); no shutdown handler ran. Whether a daemon, a container or a partial write is unaffected is **not answerable here**: the spike has no daemon. That is covered by the live kill runs recorded in the scripted-provider section above and by the guard suite. | VERIFIED_BY_EXECUTION (the kill); not answerable (the daemon) |

Run record: see "Run record" at the end of this section.

### Q4 answer

May fail-closed mode disable the built-in tools? **Yes.** `await pi.setActiveTools(names)` in the `session_start` handler removes tools, `getActiveTools()` returns exactly the requested set afterwards, the removed tool leaves the list the model is offered, and a call to it is refused at execution with `Tool <name> not found` before any hook or `execute` runs (S2a, S2b, S6). A `tool_call` block is a second, independent control that covers a call at execution time, including a nested `write xd://<tool>` (S3) and an eval-bridge call (S7), and it fails closed on a throw or a timeout (S4).

What does not work. Removing `write`, `edit` and `bash` is not containment. `write` stays as the device transport and the mountable tools behind it, `ast_edit`, `lsp` and `debug`, stay callable, as do `eval` and `task` (S2c). Shadowing `write` with an extension tool switches the transport off, and then those tools are ordinary top-level tools that stay active (S1, S2a shadow). `registerFileWriteFallback` is not a removal and not a redirection hook (S5). A removal does not reach the user's own shell command (S8).

### Tools that remain

After `setActiveTools` removes only `write`, `edit` and `bash` (S2c), the active set was `read, ask, eval, glob, grep, task, wait, todo, web_search, write, ast_edit, debug, lsp`. Of those, these can write a file or run a command on the host:

| Tool | Why it can mutate the host | Evidence |
| --- | --- | --- |
| `eval` | Runs arbitrary JavaScript (Bun) or Python in the session; `Bun.write` created a workspace file | VERIFIED_BY_EXECUTION (S2c, S7) |
| `ast_edit` (through `write xd://ast_edit` and `write xd://resolve`) | Rewrites files once the staged proposal is resolved | VERIFIED_BY_EXECUTION (S7) |
| `write` (device transport and `local://`) | Reaches the devices above; `local://` wrote outside the workspace | VERIFIED_BY_EXECUTION (S2c) |
| `task` | Starts a subagent session with its own tool set that includes native `write`, `edit` and `bash` unless the extension removes them there | VERIFIED_BY_EXECUTION (S6) |
| `lsp` | `rename`, `rename_file` and an applied code action rewrite files; a language server is a host process | VERIFIED_BY_CODE_READING (the tool's own description); not executed |
| `debug` | `launch` starts a program on the host | VERIFIED_BY_CODE_READING (the tool's own description); not executed |

`read`, `glob`, `grep`, `ask`, `todo` and `wait` write no workspace file by their own descriptions (INFERENCE: not each probed for a write). `read` and `web_search` can reach the network, which is outside the realm's egress policy.

After the full removal of S2a (`write, edit, bash, eval, ast_edit, lsp, debug, task`), the active set was `read, ask, glob, grep, wait, todo, web_search`, and none of the eleven refused calls changed the workspace.

### Recommended removal rule for fail-closed mode

An allowlist, computed at runtime, not a denylist:

1. In `session_start`, call `await pi.setActiveTools(allowed)` where `allowed` is the names in `getAllTools()` that are on an explicit read-only allowlist (`read`, `glob`, `grep`, `ask`, `todo`, `wait`, and `web_search` only if the product permits model-driven network access), plus the Realm tools. Do not name `write`, `edit` and `bash` and stop there (S2c), and do not hardcode a denylist of the eight natives of S2a: a later Omp adds tools, and every tool not on the allowlist must be gone.
2. Read `getActiveTools()` back. It matched the request in every spike run (S2a, S2b, S6). A mismatch is a failed attach and must block (fail closed).
3. Run the same step in every session the extension loads in. A subagent session runs its own `session_start` (S6). A new session in the same process does not run it again and keeps the removal (S2b).
4. Keep a `tool_call` handler as a backstop that blocks any tool name that is not on the allowlist or a Realm tool. It covers a tool that another extension or an MCP server registers after the removal, and the nested device and bridge calls of S3 and S7. A handler error or timeout blocks (S4).
5. Do not rely on `registerFileWriteFallback` (S5), and do not rely on shadowing `write` alone (S1).

### What the product can truthfully claim (D3)

D3 can end as containment of the model's tool calls, not as containment of the host. With the allowlist rule, every native tool that writes a file or runs a command was refused at execution in the spike, including the transports, and the same removal applies in a subagent session that loads the extension (S2a, S6). The claim must keep these limits, none of which the spike removes:

- the user's own shell command (the RPC `bash` command that S8 ran) bypasses the removal and every hook (S8);
- the removal is a decision inside the Omp process, not an operating-system boundary; a session that does not load the extension (for example Omp started with `--no-extensions` and no `-e`, or an SDK session with `restrictToolNames`) has none of it (INFERENCE: not run);
- tools that another extension or an MCP server registers are covered only by the allowlist step 1 and the backstop of step 4, which were not run against such a tool;
- the spike drove a test extension. Until Phase 16 repeats S2a, S3 and S6 with the Realm plugin, the supportable wording is a guard backed by tool removal that was observed on a test extension, with containment claimed for model-issued calls only.

### OQ-P5-01 and OQ-P5-02

OQ-P5-01 is **closed** for Omp 18.12.6. The names `registerTool`, `getActiveTools`, `getAllTools`, `setActiveTools` and `registerFileWriteFallback` exist and behave as the rows above show (VERIFIED_BY_EXECUTION). `ctx.ui.setStatus(key, text)` is exercised by the plugin in the live runs recorded above, which produced `setStatus` frames with the key `realm`. The official `omp.sh` pages still do not state the enforcement or the `setStatus` signature; they were not re-read in this pass.

OQ-P5-02 is **restated, narrowly**. Known, for Omp 18.12.6 and an extension loaded with `-e`:

- covered by `tool_call`: every model-issued tool call, a nested `write xd://<tool>` call (S3), a call through the eval bridge (S7), and a subagent session's calls (S6);
- not covered by `tool_call`: what `eval`'s own code writes with the runtime's file API (S7), and the user's own shell command (S8);
- covered by a removal but not by a hook: nothing was found that is.

Still unknown, not executed: the Python eval prelude (only JavaScript was run); an SDK session with `restrictToolNames`; a subagent in an Omp that does not load the extension; the interval between process start and `session_start` (no model turn ran in it in any spike run); tools registered by other extensions or MCP servers; and the Realm plugin itself with the rule above.

### HARN-03 network finding

The claim "a run makes no network call outside loopback" does not hold for a default fresh profile. Measured with `strace -f -ttt -e trace=connect,sendto,sendmsg,sendmmsg` around Omp (`test/support/net-trace.ts`), the stub on loopback, one scripted text turn, classified as in D-1205 (Unix sockets allowed; loopback allowed for the stub port and the local-model discovery ports 11434, 8080 and 1234; loopback port 53 reported as DNS; anything else external). VERIFIED_BY_EXECUTION on Omp 18.12.6:

| Profile or lever | Non-loopback connects | Notes |
| --- | --- | --- |
| Cold profile (a fresh agent directory) | 46 external TCP 443 connects (24 distinct addresses) and 7 DNS connects | The model-catalog refresh (strategy `online-if-uncached`, cache in `models.db`). Loopback probes of 11434, 8080 and 1234 and the stub. |
| Warm profile (the same directory, second start) | 0 external, 0 DNS | Loopback probes of 11434, 8080 and 1234 and the stub only. |
| Lever 1: a setting or environment variable that disables the refresh and discovery | No single switch found. The `disabledProviders` setting listing every provider id of the installed catalog (89 ids, read from the installed Omp) gave 0 external connects on a cold profile, and removed the probes of 11434 and 1234 | The list is internal to Omp and changes with each version, so it is recorded, not asserted. |
| Lever 2: a registry that exposes only the stub | Not clean: 46 external connects. The profile's `models.yml` already names only the stub, and `enabledProviders: [stub]` changed nothing | |
| Lever 3: a warm profile seeded by an earlier run | Clean (the warm row) | The warm-up run itself reaches the internet, and the cache expires. |
| Lever 4: an empty network namespace | 0 external connects, 28 DNS connects, no stub | The stub lives in the test process and is unreachable from inside the namespace, so no scripted turn can run. |
| Lever 5: a refusing loopback proxy (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY=127.0.0.1,localhost`) | 0 external, 0 DNS on a cold profile; the proxy refused 7 `CONNECT <host>:443` requests | The hosts Omp tried at startup: `api.commandcode.ai`, `api.kilo.ai`, `api.venice.ai`, `catalog.stencil.so`, `coding-intl.dashscope.aliyuncs.com`, `hyper.charm.land`, `zenmux.ai`. |

The lever that works without a warm-up and without a version-bound list is lever 5: it gives a cold profile a clean trace, and the recording proxy names exactly which hosts the startup would have contacted. The guard suite should start Omp that way and assert zero offenders with the proxy port on the loopback allowlist. The warm profile (lever 3) is the fallback. The scoped claim, if neither is used, is: after the `ready` frame and across all scripted turns, Omp made no non-loopback connection on a warm profile, with the startup catalog traffic of a cold profile out of scope. The wording of HARN-03 in `.planning/REQUIREMENTS.md` is changed through GSD, not here.

### Run record

The suite (twelve tests: S1 S9 S10, S2a, S2a shadow, S2b S8, S2c S3, S7, S4, S5, S6, S12, S13 S14 and S11) passed live on Omp 18.12.6 in two consecutive runs on 2026-10-29, each with 12 of 12 passing and 0 skipped (each run took about 23 minutes; the load average was 27 and 41 when the two runs started). Command: `REALM_LIVE_OMP=1 REALM_OMP_NET_TRACE=1 node --test --test-concurrency=1 dist/test/integration/omp-spike.test.js` after building with `tsc -p tsconfig.json`. The raw logs, RPC frames, provider requests and strace output were kept outside the repository. Two earlier attempts of the finished suite failed under a load average near 100 on a wait bound, not on an assertion: the 60 second bound of the first prompt of a cold profile, and of an `eval` call. The bounds of runtime-starting calls (`eval`, `bash`) and of that first prompt were then widened to the startup bound; every wait still resolves from the frame handler.

Two facts about running it. `omp --version` took 25 seconds at a load average near 100, so the gate's own 15 second version probe (`collectOmpGateInputs`) would skip the whole file on such a host; the spike reads the version itself with a 180 second failure bound. Omp must be given its own `TMPDIR`: its `local://` scratch files (`omp-local/<session id>/`) otherwise accumulate in the shared temporary directory, and the spike points `TMPDIR` into the profile root so they are removed with it.
