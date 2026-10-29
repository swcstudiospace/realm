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

Re-read 2026-10-23 (https://omp.sh/docs/hooks and https://omp.sh/docs/extension-authoring, the same two pages): the hooks page defines the `tool_call` return as `{ block?, reason?, input? }`, says the first block stops dispatch, and says replacement input on a model-issued call is revalidated before execution. The extension-authoring page documents managed timers (`ctx.setTimeout`, `ctx.setInterval`) that are cleared on session shutdown. Neither page states that a `tool_call` block covers launch-time tool flags, SDK sessions, or a host that ignores the hook. Those are the residual paths named in `src/omp/plugin.ts`. OQ-P5-02 therefore stays **OPEN**: the guard is not claimed to cover every execution path.

OQ-P5-02, re-read for phase 9.7 (the Omp extension documentation pages `hooks.md` and `extensions.md`, read on 2026-10-28 through the `omp://` internal documentation). The documentation now states that a `tool_call` handler may return a block, and that the first block short-circuits. A handler error or timeout blocks (budget `extensionHandlers.toolCallTimeoutMs`, default 30000 ms). `tool_call` runs during argument preparation, before scheduling and approval. Calls made through the eval-prelude bridge do not emit `tool_call`. SDK sessions with `restrictToolNames` disable extensions by default. Still unsettled: paths that bypass the extension runner, `setActiveTools` enforcement, and tools other than `write` and `edit`. The guard's list is `write` and `edit` only, so `bash`, `ast-edit` and `eval` are not guarded. There is no documented way to raise a `write` or `edit` tool call without a model, and the model provider is currently out of quota, so OMP-05 stays unit-proven. OQ-P5-02 stays **OPEN**.

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
- A daemon that refused to start was reported as `DAEMON_START_TIMEOUT`. The daemon writes its own code to `<stateDir>/daemon.log` as `realm daemon: <CODE>`. `src/daemon/ensure.ts` reads that line, and `realm up`, `realm mcp`, `realm acp`, and the Omp attach report that code.

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

Limits. OMP-05 (the write and edit guard when disconnected) needs a model call and stays unproven live. ACP was not exercised live: only MCP was. The Anda engine is not in scope.
