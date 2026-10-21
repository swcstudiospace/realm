# Omp integration note

Status: gate note (FOUND-03, decision D-03, spec q4). No plugin code or manifest exists in this phase.
Blocks: `plugin/` (Phase 5). `plugin/` is not created by this note.

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

Omp package identity used by the official page: `@oh-my-pi/pi-coding-agent` (npm package name as written on the official page; not installed here, not verified in the registry in this phase).

## Questions and answers

### Q1. Manifest format

Sourced answer.

- Extension package: `package.json` with `"omp": { "extensions": ["./src/index.ts"] }`. The field is an array; entries are relative to the package root. Installed-plugin entries may be `.ts`, `.js`, `.mjs`, or `.cjs`. The older `pi.extensions` field remains compatible; new packages use `omp.extensions` (https://omp.sh/docs/extension-authoring).
- Plugin tree: `.omp-plugin/plugin.json` is read first, then `.claude-plugin/plugin.json`. A root `plugin.json` using the Agent Plugins 1.0.0 schema uses the portable provider with skills and `mcp.json` (https://omp.sh/docs/marketplace, upstream `marketplace.md`).
- Marketplace catalog: `.omp-plugin/marketplace.json`, or `.claude-plugin/marketplace.json` when the first is absent (https://omp.sh/docs/marketplace).
- MCP declaration in a plugin: a manifest `mcpServers` entry replaces the default `.mcp.json`; `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are expanded in portable plugin MCP config (upstream `mcp-config.md`, upstream `marketplace.md`).

Manifest validation details beyond these fields were not verified in this phase.

### Q2. Lifecycle hooks

Sourced answer.

- Events registered with `pi.on(event, handler)`. Session events named in the upstream `extensions.md` include `session_start` and `session_shutdown`. Example used on the official page: `ctx.ui.notify` in a `session_start` handler (https://omp.sh/docs/extension-authoring).
- Timing budgets (upstream `extension-loading.md` and `extensions.md`): most dispatched handlers have a 30-second budget; `session_shutdown` handlers run concurrently with a 2-second budget; `tool_call` uses `extensionHandlers.toolCallTimeoutMs` (default 30,000 ms) and fails closed on error or timeout.
- Timers created through the extension context (handle returned, cleared with `ctx.clearTimer(handle)`) are unref'd and are cleared automatically on `session_shutdown`. Raw `setInterval`/`setTimeout` and detached promises are not cleared for the extension and remain its responsibility (upstream `extensions.md`).

### Q3. Status API

Sourced answer.

- The surface found is UI-level: `ctx.ui.setStatus(key, text)`. Status text is stored per key and sorted by key name (upstream `hooks.md`). `ctx.ui.setWidget` renders content above or below the editor (upstream `extensions.md`).
- In RPC mode, `setStatus`, `notify`, and `setWidget` are emitted as fire-and-forget requests (upstream `extensions.md`).
- No separate HTTP or JSON status endpoint for a plugin was found in the sources read. A dedicated health or status API for Realm therefore `not documented`. Realm must not assume one.

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

### Q5. Does this note permit any plugin code now?

No. No file under `plugin/` is created. No manifest file is written. The examples above are quotations of official documentation, not code for this repository.

## Blocked module

`plugin/` (Phase 5). Phase 5 must answer Q4 before any plugin code that claims required-mode enforcement is written.

## Not in this note

- No plugin code, no `package.json` for a plugin, no `.omp-plugin/` tree, no `mcp.json`.
- No guessed URLs. Pages not fetched from `omp.sh` are marked as upstream-sourced above.
