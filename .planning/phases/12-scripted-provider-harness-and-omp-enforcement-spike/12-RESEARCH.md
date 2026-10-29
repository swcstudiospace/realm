# Research for Phase 12 (scripted-provider harness, Omp enforcement spike) and Phase 16 (Omp tools in the sandbox)

Author: ResearchP12Omp. Date of observation: 2026-10-29. Host: Linux x64, Node 24.18, Omp 18.12.6 (`omp --version` prints `omp/18.12.6`), installed package `@oh-my-pi/pi-coding-agent` 18.12.6 (global bun install, source in `src/`, types in `src/extensibility/extensions/types.ts`). The repository was not modified. All throwaway scripts of this research lived in a temp directory outside the repository (their essentials are reproduced in section 4) and were deleted at the end.

Evidence tags used below (the three labels the assignment requires, abbreviated):
- **[CR]** = VERIFIED_BY_CODE_READING (repo source, Omp installed source, Omp docs read through `omp://`).
- **[EX]** = VERIFIED_BY_EXECUTION (a command or an Omp run I made in a throwaway directory during this research, or an existing recorded run that I cite by file).
- **[INF]** = INFERENCE.

Path shorthands: `<evidence>` = the prototype evidence directory (`demo-v21-copy/`), `<omp-pkg>` = `@oh-my-pi/pi-coding-agent/src`, `<agent-core>` = `@oh-my-pi/pi-agent-core/src`, `<catalog>` = `@oh-my-pi/pi-catalog/src`.

---

## 0. Executive summary (read this first)

1. The prototype is small and works. It is a 99-line scripted OpenAI-compatible provider plus an RPC driver that talks JSON lines to `omp --mode rpc-ui --no-extensions -e <dist>/src/omp/extension.js --model stub/scripted --no-session`. Its three guard cases were observed live (LIVE-VERIFICATION L3, L4). It hardcodes a real account, a real daemon and fixed ports.
2. **The two realm-down cases and the realm-active case do not need the production stack.** `startDaemon` (`src/daemon/daemon.ts:170`) can run in-process in the test process with the existing fakes (`FakeExecutionService`, `FakeBridge`, scripted `probe`, `sweep: async () => 0`), exactly as `test/daemon/e2e.test.ts:107-124` does. Omp is a child process that dials the control socket. `down` over the control channel stops the daemon and unlinks the socket (`src/daemon/daemon.ts:332-358`), which is byte-for-byte the observable behaviour of the live `realm down` (extension reads fail with `REALM_NOT_ACTIVE`, L3/L4). A real-stack scenario stays useful as one extra, doubly-gated test.
3. **Enforcement answers (all [EX] unless stated), Omp 18.12.6:**
   - `registerTool` works, accepts Zod, TypeBox and a **raw JSON Schema object** as `parameters`, and **a tool registered under a built-in name replaces the built-in** (`getAllTools()` reports `write:extension`; the native tool never ran; `ctx.invokeTool` is then a function).
   - `setActiveTools([...])` removal **is enforced at execution for `bash`**: a model call to the removed tool returns `Tool bash not found` (`isError: true`) and the tool disappears from the list sent to the model.
   - **But removing `write`, `edit`, `bash` is not containment.** `write` is not removed while other tools are mountable: it stays as a "device-only" transport (path limited to `xd://<tool>` and `local://`), and `write xd://ast_edit` stays reachable, as do `ast_edit`, `lsp`, `debug`, `eval`, `task`. Shadowing `write` with an extension tool disables the `xd://` transport and turns those tools into ordinary top-level tools, which are still active. A complete denylist (or an allowlist) is required.
   - `tool_call` returns `{block?, reason?, input?, additionalContext?}`; a block surfaces as a tool result with `isError: true` and the reason as text [EX, L4]. The hook fires for a shadowed `write` before its `execute` [EX].
   - `registerFileWriteFallback` is **not a redirection hook for normal writes**. It runs only after a native byte-write fails with `EPERM`/`EACCES`/`EROFS`. With an `EROFS` workspace [EX] the handler received `{dst (absolute, symlink-resolved), content, sessionId, cause}`; returning `true` made Omp report "Successfully wrote 14 bytes" although the bytes went elsewhere. Useful only when the host denies writes.
4. **"The run makes no network call outside loopback" (proposal 6 success measure) is false for a default fresh Omp profile, and the harness must solve it.** Under `strace -f -e trace=connect` [EX]: a cold profile (fresh `PI_CODING_AGENT_DIR`) made dozens of outbound TCP 443 connects (Cloudflare, Google, other ranges) after DNS through `127.0.0.53`, plus loopback probes of ports 11434, 8080 and 1234 (local model discovery); a warm profile (second use of the same directory) made only those three loopback probes and the connection to the stub. The cause is Omp's model-catalog refresh, strategy `online-if-uncached`, 24 h cache (`<omp-pkg>/config/model-registry.ts:554`, `<omp-pkg>/config/model-registry.ts:884`, `<catalog>/model-manager.ts:25`) [CR]. I found no documented offline switch. The spike must find a lever (see 2.6) or the assertion must be scoped; do not promise "no network" until a traced run proves it.
5. Phase 16 impact is large but well bounded: add `registerTool`/`getActiveTools`/`setActiveTools` to the `OmpExtensionApi` interface, build five tool definitions from the existing MCP descriptors, map `DaemonClient.call` results (note: a daemon refusal arrives as a **thrown** `RealmError`, not as a resolved outcome; `read` returns a serialized `Buffer`), set `loadMode: "essential"`, and remove a full list of native tools (not only `write`/`edit`/`bash`). Section 5.

---

## 1. Findings

### 1.1 The prototype (read in full)

Files in `<evidence>`: `stub-provider.mjs` (99 lines), `drive-omp.mjs` (199), `drive-omp-kill.mjs` (138), `persist-probe.mjs` (184), `strace-omp.mjs` (75), `strace-omp-order.mjs` (69), `env-passthrough.mjs` (65), plus directories it created (`agent/`, `agent2/` Omp profiles holding `models.yml` and Omp's sqlite state, `c/realm/config.json`, `s/` = realm state dir with `policy.json`, `daemon.log`, `run/`, `sessions/`, `audit/`, `out/` logs). The "findings" directory next to it only holds `IMPROVEMENT-PROPOSALS.md` and `OUTSTANDING-WORK-INVENTORY.md` (no scripts).

**stub-provider.mjs** [CR, and exercised [EX] in every run of LIVE-VERIFICATION]:
- `node:http` server on `127.0.0.1:<port>` (default 18911), request log appended as JSONL (`kind: request`, `stream`, `lastRole`, `tools` (names offered by Omp), `userHead`, `writeParameters`, `plan`).
- `GET /v1/models` returns `{object:"list", data:[{id:"scripted"}]}`.
- `POST /v1/chat/completions`: extracts the last `user` message text (string or array of `{text}` parts). Plan: if the last message has role `tool` -> answer text `done`; else if the text matches `/WRITE (\S+) ([^\n]*)/` **and** the offered `tools` include `write` -> one tool call `write {path, content}`; else text `ack`.
- Streaming (`stream: true`, which is what Omp sends): SSE chunks. Tool call = chunk 1 `delta {role:"assistant", content:null, tool_calls:[{index:0,id:"call_<6>",type:"function",function:{name,arguments:""}}]}`, chunk 2 `delta {tool_calls:[{index:0,function:{arguments:"<json>"}}]}`, chunk 3 `delta {}` with `finish_reason:"tool_calls"`, then a usage-only chunk `choices: []` with `usage`, then `data: [DONE]`. Text = `delta{role:"assistant",content:""}`, `delta{content:text}`, `finish_reason:"stop"`. A non-streaming JSON branch exists too.
- Note: the scripted call omits the intent field `i` although the offered `write` schema (`{path, content?, i}` with `required:["path","i"]`, `additionalProperties:false`, LIVE-VERIFICATION L2) lists it as required; Omp accepted the call [EX, L2/L4]. In my own runs tool calls without `i` were also accepted for the built-in `write`, and for extension tools whose schema does not define `i` (Omp strips a harness-owned `i` before validation when the tool's schema does not own it, `<agent-core>/agent-loop.ts:3100-3106`) [CR].

**Profile** [CR]: `models.yml` in `$PI_CODING_AGENT_DIR` (Omp honours this variable only for the default profile, `omp://environment-variables.md` line 23):

```yaml
providers:
  stub:
    baseUrl: http://127.0.0.1:<port>/v1
    api: openai-completions
    apiKey: dummy
    models:
      - id: scripted
        name: Scripted
        contextWindow: 32000
        maxTokens: 4000
```

Realm side of the profile (`drive-omp.mjs:29-51`): `XDG_CONFIG_HOME=<demo>/c` with `realm/config.json` = `{image, stateDir, workspaceRoot}` (mode 0600); `<demo>/s` (stateDir, mode 0700) with `policy.json` = `{"workspaceRoots":[<ws>]}` (plus `"mode":"fail-closed"` for case D); env passed to Omp: `PATH`, `HOME` (real home; the OpenShell child needs it, `src/runtime/session-execution.ts:72`), `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `PI_CODING_AGENT_DIR`, `REALM_DRIVER_STATE_ROOT`, `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT`. A hermetic harness needs only `PATH`, an isolated `HOME`, `XDG_CONFIG_HOME`, `PI_CODING_AGENT_DIR` (the Omp child also writes logs to `$HOME/.omp/logs`, seen in my runs [EX]; isolate `HOME` so nothing lands in the real home).

**RPC driver** (`drive-omp.mjs:80-147`) [CR + EX]:
- Spawn: `omp --mode rpc-ui --no-extensions -e <dist>/src/omp/extension.js --model stub/scripted --no-session`, `cwd` = the pinned workspace (the plugin attaches with `ctx.cwd`), stdio pipes. JSON per line in and out.
- Parses stdout lines into frames (non-JSON lines are logged aside). Frames used: `{type:"ready"}`; `{type:"extension_ui_request", method:"setStatus", statusKey:"realm", statusText}`; `method:"notify", message`; dialogs (`confirm|select|input|editor`) are auto-answered (`extension_ui_response`); `{type:"tool_execution_start|end", toolCallId, toolName, args, result:{content,details}, isError}`; `{type:"agent_end", isTerminal}` and `prompt_result`.
- Input: `{"id":"p1","type":"prompt","message":"WRITE guard-active.txt written-while-active"}`; the slash command is sent the same way (`"message":"/realm-retry"`).
- `prompt()` waits for `agent_end` (isTerminal !== false) or a matching `prompt_result`, then sleeps 1.2 s, then reports the `tool_execution_*` frames of that prompt. Timeouts are poll loops at 250 ms.
- stderr of Omp can contain progress noise ("Still starting after 13s — phase: ..."), seen in my runs [EX]: never treat Omp stderr as failure.

**Assertions of drive-omp.mjs** (as transcribed in LIVE-VERIFICATION L1-L4; the script only logs, it does not assert) [CR/EX]:
- A: after `ready`, status text reaches `● realm active · container running · <iso>` (cold attach 40-57 s on a loaded host; budget 260 s); `realm status` JSON says active, mode advisory.
- B: write while active: `tool_execution_end` isError false, file on host = content.
- C: `realm down` -> status `○ realm disconnected · REALM_NOT_ACTIVE · <iso>`; write -> a `notify` frame `realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy`, `tool_execution_end` isError false, file exists.
- D: policy `mode: fail-closed`, `/realm-retry`, wait active, write ok, `realm down`, status `REALM_NOT_ACTIVE`, write -> `tool_execution_end` `{"isError":true,"result":{"content":[{"type":"text","text":"REALM_NOT_ACTIVE"}],"details":{}}}` and the file does **not** exist.
- The first provider request logged the tool list `read, bash, edit, ask, eval, glob, grep, task, wait, todo, web_search, write` (L2). In my 2026-10-29 runs the active set was also `ast_edit, debug, lsp` (mounted under `xd://` when `write` and `read` are the transport).

**drive-omp-kill.mjs**: for SIGHUP then SIGKILL it starts a session, waits for active, scripts a write, reads the daemon pid via `ss -xlpn | grep control.sock`, signals only the Omp child, then checks daemon pid unchanged, container id unchanged, file on host, and that a third session re-attaches to the same container. **persist-probe.mjs**: a daemon-level probe through `realm mcp` (kill -9 the daemon, restart, SIGTERM). **env-passthrough.mjs**: reads `/proc/<daemon pid>/environ` names. **strace-omp*.mjs**: `strace -f -qq [-e trace=... | -P <file>]` around Omp (this proves `strace` can wrap Omp on this host) to study how Omp's own `write` overwrites (open, write, ftruncate, close; no temp file, rename or fsync, L6b). The kill, persist, env and strace scripts belong to other phases (14, 18, 19); **only stub-provider + drive-omp are the Phase 12 seed**.

**Prototype defects to fix when promoting it** [CR]:
1. Hardcoded host facts: account home, uid 5002, absolute Omp path, `<realm-home>/...`, port 18911/18912 (a fixed port also collides between parallel test files). Use `mkdtemp`, port 0, `PATH` lookup.
2. Assertions are `tlog` lines, not `assert`.
3. Poll loops with a wall-clock sleep (250 ms, 1.2 s); the repo's tests prefer event-driven waits (see `within` in `test/omp/extension.test.ts:69`).
4. Uses the real daemon, so every run needs Podman, OpenShell, an image and 3 minutes; the realm-down transitions are done by shelling out `realm down`.
5. `spawnSync` for `realm`/`curl` in the same process that would host an in-process daemon would deadlock it: any hermetic version must use async spawns only.
6. Frame handling is untyped and swallows parse errors (`catch {}`): the repo bans silent catches (AGENTS.md, Conventions); count and report non-JSON lines.
7. It treats a missing `tool_execution_end` as a printed timeout rather than a failure.

### 1.2 Repo facts the harness depends on

- Existing gating pattern [CR]: `test/support/production-live.ts:27-31` names `REALM_LIVE_PRODUCTION`, `REALM_LIVE_IMAGE`, `REALM_DRIVER_STATE_ROOT`, `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT`; `productionSkipReason(inputs)` (`:54`) returns the FIRST missing prerequisite in a fixed order and is covered by an always-running hermetic file `test/integration/production-live-helpers.test.ts`. `production-driver.test.ts` computes `gate` at module load and skips every scenario with that reason; scenario timeout 300 s; `CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url))` finds the built file from `dist/test/integration/` (`:~60`). `createScenarioEnvironment` (`production-live.ts:462`) builds a short `mkdtemp` root (`rlv-`), keeps the control socket path under the 107-byte `sun_path` limit, writes `config.json` and `policy.json`.
- `npm test` runs `dist/test/**/*.test.js`, so a gated file also runs (and skips) there (AGENTS.md, Commands). CI installs no Omp and no strace, so the new suite skips in CI by default, as proposal 6 intends ("skips in CI by default").
- Built extension location: `dist/src/omp/extension.js` (`package.json` `omp.extensions`; `extension.ts` header). From a compiled test file in `dist/test/integration/`, `fileURLToPath(new URL("../../src/omp/extension.js", import.meta.url))`. This extension imports `../cli/main.js`, `../daemon/*`, `../runtime/host-paths.js` and loads fine inside Omp's Bun (observed live, L1) [EX].
- The extension reads `process.env` once at load (`src/omp/extension.ts:17-21`): `readHostRuntime(process.env)` = `$XDG_CONFIG_HOME/realm/config.json` (absolute `XDG_CONFIG_HOME`, else `$HOME/.config/realm/config.json`), `controlSocketPath(stateDir)` = `<stateDir>/run/control.sock` (`src/session/paths.ts:18`). Attach = `ensureDaemon` (spawns a detached daemon only when the socket is **absent**, `src/daemon/ensure.ts:3-8,40`) -> `connectDaemon` -> `client.up(ctx.cwd)`. A socket that answers `status` is used as is.
- Control protocol [CR] (`src/daemon/channel.ts:17,44-50,136-225`): one NDJSON request per connection (`{id, method, params?}`), one reply line then close (`{id, result}` XOR `{id, error:{code, causeCode?}}`), methods `status|up|down|doctor|tool`, per-method timeouts `status 5 s`, `up 230 s`, `down 45 s`, `doctor 60 s`, `tool 40 s`; max line 1 MiB; run dir mode 0700, socket mode 0600. `status` and `up` results must satisfy `isDaemonStatus` (`src/daemon/client.ts:77`): `{snapshot:{state,reason,lastTransitionAt}, display:{label,degraded,reason,lastTransitionAt}, mode:"advisory"|"fail-closed"}`; `tool` results must satisfy `isToolOutcome` (`client.ts:81`).
- `test/omp/extension.test.ts:26-48` already contains a hand-rolled stand-in control server (about 20 lines) that answers every request with an active status, used to prove the extension and the CLI dial one socket.
- Real daemon behaviour on `down` [CR]: `stop()` sets `draining`, closes the controller (bounded 30 s), `server.close()`, removes the socket file, answers on the requesting socket (`src/daemon/daemon.ts:332-358,360-369,426-429`). After it, any status read by the plugin fails at dial (`REALM_NOT_ACTIVE`), which is the observed `○ realm disconnected · REALM_NOT_ACTIVE` in L3/L4 and the docs (`docs/integration/omp.md:158,196`).
- A refused tool outcome crosses the control channel as an **error reply**: `daemon.ts:417-420` converts `outcome:"refused"` into `{id, error:{code}}`, and `DaemonClient.request` turns an error reply into a thrown `RealmError` (`client.ts:125-127`). The `DaemonClient.call` doc comment ("A refusal is a resolved ToolOutcome, not a throw", `client.ts:28-30`) is therefore wrong for the daemon path (only `done` outcomes resolve). [CR]. Phase 16 must handle both.

### 1.3 Omp's side (installed source, read in full where cited)

- `ExtensionAPI` (`<omp-pkg>/extensibility/extensions/types.ts:1624-`): `logger`, `typebox`, `arktype`, **`zod`** (host-injected schema builders), `pi`, `on(...)`, `registerTool`, `registerFileWriteFallback`, `registerFileDeleteFallback`, `registerCommand`, `registerShortcut`, `registerFlag`, `getActiveTools(): string[]`, `getAllTools(): ToolInfo[]`, `setActiveTools(toolNames: string[]): Promise<void>`, `exec`, `sendMessage`, ... "Session actions are unavailable during extension load; registration methods, `getFlag`, and `exec` are available" (`omp://extensions.md`, Constraints). `setActiveTools` was callable from the `session_start` handler [EX].
- Event handler call convention is `(event, ctx)` (already fixed in `src/omp/plugin.ts:318`). `tool_call` event: `{type:"tool_call", toolCallId, toolName, input}` (`types.ts:1331-1379`). `ExtensionContext` carries `cwd`, `ui`, `sessionManager`, `hasUI`, ...
- The agent loop resolves a model's tool call only against the **advertised snapshot** (`context.tools`), then a host fallback (`resolveFallbackTool` = xd:// devices and MCP aliases, `<agent-core>/agent-loop.ts:2876-2894`, `sdk.ts:3836-3860`); a miss becomes `Tool <name> not found` without execution (`agent-loop.ts:3126-3140`) [CR, and [EX] for `bash`].

---

## 2. API answers and unknowns

Legend for the "answer" column: what static reading settled, what I executed, what is still open. Omp version 18.12.6 throughout.

### 2.1 `registerTool`

- Signature [CR]: `registerTool<TParams extends TSchema = TSchema, TDetails = unknown>(tool: ToolDefinition<TParams, TDetails>): void` (`types.ts:1725`). Synchronous, stores into the extension's tool map (`loader.ts:216-224`); no restriction on the name.
- `ToolDefinition` (`types.ts:884-933`) [CR]: `name`, `label`, `description`, `parameters` (`TSchema = Type | TJsonSchema`, i.e. Zod / TypeBox / **plain JSON Schema object**), optional `hidden`, `defaultInactive`, `loadMode`, `deferrable`, `approval`, `strict`, `renderCall/renderResult`, and
  `execute(toolCallId: string, params: Static<TParams>, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback | undefined, ctx: ExtensionContext): Promise<AgentToolResult<TDetails>>`.
- Result shape Omp expects [CR `<agent-core>/types.ts:1015-1027`; EX]: `{ content: (TextContent|ImageContent)[]; details?: unknown; isError?: boolean; useless?: boolean; providerMetadata? }`. Observed on the wire (`tool_execution_end`): `{"result":{"content":[{"type":"text","text":"EXEC [\"echo\",\"hi\"]"}],"details":{}},"isError":false}`; `details` defaults to `{}`. A thrown error becomes a tool error; the blocked-`tool_call` frame is `{"result":{"content":[{"type":"text","text":"<reason>"}],"details":{}},"isError":true}` [EX, L4]. Not exercised: `isError:true` returned by `execute` (documented: "agent-loop honors this and surfaces it as a tool error on the wire").
- Raw JSON Schema accepted [EX]: a tool `list` registered with `parameters: {type:"object", additionalProperties:false, required:["path","depth"], properties:{path:{type:"string",minLength:1}, depth:{type:"integer",minimum:0}}}` was offered to the model and executed with `{path:".",depth:1}`. Unknown: what Omp does with an **invalid** call against such a schema (expected: validation error result before `execute`, [INF] from `validateAgentToolArguments`, `<agent-core>/tool-arguments.ts:22`), and whether `strict` provider serialization rewrites `additionalProperties`.
- **Name collision with a built-in replaces the built-in** [EX; CR `sdk.ts:3605-3608`, "extension re-registration replaces registry entries"]: registering `write` made `getAllTools()` list `write:extension`; the model's `write {path:"a.txt",content:"X"}` ran the extension's `execute` (it received `{path, content}` and `ctx.invokeTool` was a function), **no file was created**, and the `tool_call` and `tool_result` events still fired around it. `ctx.invokeTool(params)` runs the native same-named tool; it is `undefined` for net-new names (`omp://extensions.md`, "Delegating to a native built-in") [CR].
- `loadMode` [CR `omp://extensions.md` 724-725, `tools/essential-tools.ts`]: new names default to `"discoverable"` (moved under `xd://` or tool search when the transport is active); re-registered essential built-ins (`read, write, bash, edit, glob, find, eval, task, wait, ...`) keep `"essential"`. In my shadow run `exec`, `status`, `list` appeared **top-level** because shadowing `write` switched the `xd://` transport off (see 2.2); do not rely on that: set `loadMode: "essential"` explicitly on `exec`, `list`, `status` (and `read`/`write`).
- `approval` defaults to tier `"exec"`; default approval mode is `yolo` (`omp://approval-mode.md` 12, 25), under which no prompt appeared for any of my runs [EX]. In `ask-*`/other modes an undeclared tool prompts; declare `approval: "read"` for `read`/`list`/`status` and `"write"`/`"exec"` for the others. Unknown: the exact RPC prompt shape in non-yolo mode (spike S12).
- Unknown: tool results larger than Omp's artifact-spill threshold are wrapped by `wrapToolWithMetaNotice` (`sdk.ts:3570-3576`); effect on Realm `read` of 1 MiB [INF: truncated or spilled; spike S13].

### 2.2 `setActiveTools` / `getActiveTools` / `getAllTools`

- Signatures [CR `types.ts:1878-1884`]: `getActiveTools(): string[]`, `getAllTools(): ToolInfo[]` (`{name, description, parameters, sourceInfo:{source:"builtin"|"extension"|"mcp"|"sdk", ...}}`), `setActiveTools(toolNames: string[]): Promise<void>`.
- Initial active set in the scripted profile [EX]: `read, bash, edit, ask, eval, glob, grep, task, wait, todo, web_search, write, ast_edit, debug, lsp`; `getAllTools` additionally shows `goal` and a few `extension` entries from Omp's own bundled extensions (`init_experiment`, `run_experiment`, `log_experiment`, `update_notes...`) even with `--no-extensions`.
- Removal enforced at execution? [EX]
  - `setActiveTools(active.filter(n => !["write","edit","bash"].includes(n)))` in `session_start`. `getActiveTools()` afterwards: `read, ask, eval, glob, grep, task, wait, todo, web_search, write, ast_edit, debug, lsp` (`bash` and `edit` gone; **`write` still there**). The first request to the provider offered `read, ask, eval, glob, grep, task, wait, todo, web_search, write` (the `ast_edit`, `debug`, `lsp` tools were mounted under `xd://`, and `read xd://` returned `xd:// 3 mounted tool devices: ast_edit, debug, lsp`).
  - Scripted `bash {command}`: `tool_execution_end` `isError:true`, text `Tool bash not found` (details `{isError:true,error:"Tool bash not found"}`), no file, no `tool_call` event. So removal **is** enforced for tools that are not re-routed.
  - Scripted `write {path:"a.txt",content:"X"}`: `isError:true`, text "This `write` tool is limited to the xd:// device transport and local:// session scratch: call it with path `xd://<tool>` ... Filesystem writes are not available elsewhere." No file. The `tool_call` event fired (input `{path,content}`) and `tool_result` followed.
  - Scripted `write {path:"xd://ast_edit", content:"{}"}`: reached the device (`Invalid args for xd://ast_edit: ... ops, paths missing`), i.e. **the mounted `ast_edit` (which rewrites files) stays callable through the transport after `write`, `edit`, `bash` were removed**. Scripted `write {path:"local://scratch.txt",content:"hello"}` succeeded and wrote to `<tmp>/omp-local/<session-id>/scratch.txt` (outside the workspace, unguarded).
  - Source of this behaviour [CR]: `session-tools.ts:1198-1271` keeps the built-in `write` as the xd transport whenever `mountNames.size > 0` and restricts it to device-only (`restrictDeviceOnlyWrite`); `xdev.ts:60-70,102` documents "dispatch accepts the enabled union of top-level active and mounted names".
- With `write` shadowed by an extension tool [EX]: `getActiveTools()` listed `read, bash, edit, ast_edit, ask, debug, eval, glob, grep, lsp, task, wait, todo, web_search, write, exec, status, list`; `read xd://` said `xd:// 0 mounted tool devices`: the transport is gone, and `ast_edit`, `debug`, `lsp` became ordinary top-level tools. So with the Realm `write` shadow the file-mutating set to remove is at least: `bash, edit, eval, ast_edit, lsp, debug, task` (and `notebook`/others if present in a given profile; compute the list at runtime from `getAllTools()` against an allowlist, do not hardcode).
- Not answered: subagents. `task` spawns sessions with their own `ExtensionRunner`; whether they load this extension and inherit the active set is documented only as "Restricted children may rebind parent hooks" (`file-write-fallback.ts` comments, `omp://extensions.md`). Needs the live spike (S6). Also unanswered: the eval-prelude bridge (`omp://hooks.md`/`docs/integration/omp.md:94` say calls through it emit no `tool_call`), and user-initiated `!`/`user_bash` commands (a separate event).
- `setActiveTools` is a session action: call it in `session_start` (works [EX]) and re-apply when the daemon mode changes; the set is not persisted by Omp across sessions (unknown, spike S2b: does `/new` or session switch re-run `session_start`?).

### 2.3 `tool_call` and `tool_result`

- `tool_call` [CR `shared-events.ts:331-352`, `runner.ts:1928-1993`, `wrapper.ts:280-327`]: handler `(event: ToolCallEvent, ctx) => ToolCallEventResult | void | Promise<...>`; result `{block?: boolean, reason?: string, input?: Record<string,unknown>, additionalContext?: string}`. Dispatch order is extension registration order, **first `block` wins** and stops later handlers; a handler error or timeout blocks (fail closed), budget `extensionHandlers.toolCallTimeoutMs` default 30 000 ms (paused during UI waits). `input` replaces the execution input (last handler wins; revalidated against the tool schema; ignored when `block`). It fires at argument preparation, **before** scheduling and approval, for model-issued calls (`agent-loop.ts:3139-3172`). Approval denials may short-circuit before the hook and blocked calls emit no `tool_result` (`omp://extensions.md` near the template). Observed [EX]: event `{toolName:"write", input:{path,content}}` precedes `execute` of the shadow; blocked frame as in 2.1.
- `tool_result` [CR `shared-events.ts:404-421`, `runner.ts:1876-1926`]: handler gets `{toolCallId, toolName, input, content, details, isError}` and may return `{content?, details?, isError?, additionalContext?}`; handlers chain in order and each sees the previous replacement. Observed [EX]: event fields `toolName, isError, content`. Not exercised: returning a modification (spike S4).
- The guard in `src/omp/plugin.ts:344,371-394` reads `call.toolName` only and blocks/allows by plugin state. With `write` shadowed its `tool_call` still runs first [EX].
- Unknown: whether a **valid** nested `write xd://<tool>` call emits a separate `tool_call` for the inner tool (my invalid call showed only the outer `write` event). `omp://extensions.md` and `shared-events.ts:344-350` describe "nested `write xd://` device calls" as dispatches the loop never sees, where the tool wrapper applies the revision, which suggests the wrapper emits one (spike S3).

### 2.4 `registerFileWriteFallback` (the real name; there is also `registerFileDeleteFallback`)

- Signature [CR `types.ts:1757`, `tools/file-write-fallback.ts:140-170`]: `registerFileWriteFallback(handler: (req: {dst: string; sessionId: string|undefined; content: string; cause: unknown}, ctx: ExtensionContext) => Promise<boolean>): void`. Register during extension load. Handlers run in registration order; the first `true` counts as "bytes durably on disk" and the native tool continues as if its own write succeeded (and records its snapshot under the real destination, so hashline `edit` keeps working). `false` from all handlers rethrows the original error. The registry is process-wide (all sessions, subagents included); compare `req.sessionId` with `ctx.sessionManager.getSessionId()`.
- When it runs [CR]: only when the native byte-write (shared primitive of `write`, `edit`, `apply_patch`, hashline `MV` destination) fails with `EPERM`, `EACCES` or `EROFS` (or a denied parent `mkdir` masked as `ENOENT`). **Not** for ordinary writes, archive members, SQLite, `lsp` edits, `bash`, `acp-bridge`.
- Observed [EX]: workspace bind-mounted read-only (`unshare -m` + `mount -o remount,bind,ro`), scripted `write {path:"ro.txt",content:"FALLBACK-BYTES"}`: handler called with `dst` = absolute resolved path, `content`, `sessionId` (uuid), `cause` code `EROFS`; my handler wrote the bytes to a different file and returned `true`; Omp's result text was `[ro.txt#F63A] Successfully wrote 14 bytes to ro.txt` with `details.resolvedPath` = the (read-only) target. So the model is told the write happened at the requested path while the bytes went wherever the handler put them.
- Consequence for D3: it is a **redirect for a host that denies direct writes** (e.g. Omp's own process confined by Landlock/bwrap/ro mount), never a containment control by itself. It also cannot reach `bash`.
- Unknown: behaviour for non-root users with a plain 0555 directory (I ran as root, which bypasses mode bits; the EROFS mount reproduces the denial portably). Spike S5 must run as non-root or use the mount.

### 2.5 How built-in names are enforced at execution (summary)

| Question | Answer | Tag |
|---|---|---|
| Removed tool, model still emits it | `Tool <name> not found`, `isError`, nothing runs, tool absent from the next request's `tools` | [EX] bash |
| Removed `write`/`edit`/`bash` set | `edit`, `bash` gone; `write` stays as xd transport while any tool is mountable; `xd://ast_edit|lsp|debug` reachable | [EX] |
| Same-name extension tool | replaces the built-in entirely; also turns off xd transport | [EX] |
| `tool_call` block | blocks that call; error text = `reason`; fail closed on throw/timeout | [EX]/[CR] |
| Calls the hook may not see | eval-prelude bridge, `user_bash`, subagent sessions, `ctx.exec`/`pi.exec` by other extensions, `local://` writes (a native `write` path) | [CR]/[INF], spike |
| `registerFileWriteFallback` | fallback after EPERM/EACCES/EROFS only | [EX] |

### 2.6 Network: what Omp does at startup (for "no call outside loopback")

Observed with `strace -f -qq -e trace=connect[,sendto,sendmsg] -o <file>` wrapped around `omp --mode rpc-ui ...`, stub on loopback, scripted turn [EX]:
- Cold profile (new `PI_CODING_AGENT_DIR` and `HOME`): DNS via the systemd stub `127.0.0.53:53`, then **tens of `connect()` to non-loopback `:443`** addresses (Cloudflare ranges, Google, others), IPv4 and IPv6, with TLS ClientHello `sendto`s; plus loopback probes `127.0.0.1:11434`, `:8080`, `:1234` (Ollama, llama.cpp, LM Studio discovery, `<catalog>/provider-models/openai-compat.ts:611,4376`, `model-registry.ts:1663,1694`) and the stub port.
- Warm profile (same directory reused after earlier runs): only those three probe ports and the stub, timestamps all at startup / on the first prompt. No non-loopback connect at all.
- Interpretation [INF, supported by CR]: model catalog refresh with strategy `online-if-uncached` (`model-registry.ts:554`, `:884`: "fetches at most once per cache TTL (24 h)"), cache in `models.db` of the agent directory. The hostnames were not captured (IPs only), so which endpoints are hit is unknown.
- Found no documented flag/env to force offline (`omp://cli-reference.md` and `environment-variables.md` grep for offline/discovery returned nothing relevant). Candidate levers for the spike: `enabledProviders`/`disabledProviders` or other settings in `$PI_CODING_AGENT_DIR/config.yml` (`omp://models.md`, `model-settings.ts`), `discovery` keys in `models.yml`, seeding a pre-warmed `models.db` (7.5 MB, cannot be committed), or running Omp in an empty network namespace.

---

## 3. Harness design (Phase 12)

### 3.1 Gating (names consistent with the production suite)

Two tiers so that the cheap hermetic one is usable by developers without Podman:

| Variable | Meaning |
|---|---|
| `REALM_LIVE_OMP=1` | explicit opt-in for any test that starts a real Omp process. Never set by a test. Hermetic: needs no Podman, no image, no openshell. |
| `REALM_OMP_BIN` | optional path of the Omp executable; default `omp` found on `PATH` (`onPath` helper of `production-live.ts:120`). |
| `REALM_LIVE_PRODUCTION=1` + the existing four variables | additionally required by the optional production-stack scenario (`productionSkipReason`, unchanged). |
| `REALM_OMP_NET_TRACE=1` | opt-in for the strace-based no-external-network assertion (needs `strace` and ptrace permission). Default on when `strace` works and `REALM_LIVE_OMP=1`, otherwise a skip with reason. |

`ompSkipReason(inputs)` returns the FIRST missing prerequisite in this order (copying `productionSkipReason`'s shape so a hermetic always-running helper test can cover each branch): opt-in variable; Linux; Omp executable present; `omp --version` parses and is a version the harness was written for (record, do not hard-fail on newer: print `omp/18.12.6` in the test output, hard-fail only below 18.12.6); built extension `dist/src/omp/extension.js` exists; for the strace assertion: `strace` on PATH and a trivial `strace -e trace=connect true` works (CI containers often block ptrace). Reuse `isDirectory`, `onPath`, `runCommand`, `pollUntil` exports of `test/support/production-live.ts` instead of re-implementing them.

### 3.2 Files (all under `test/`, TypeScript strict, compiled to `dist/test/`)

| File | Purpose |
|---|---|
| `test/support/omp-live.ts` | gate constants and `ompSkipReason`, `EXTENSION_PATH` resolver (from `import.meta.url`), `ompVersion()`, shared timeouts (ready 180 s, per prompt 60 s, scenario 300 s). Takes everything as parameters; reads no env itself (match the existing helper rule). |
| `test/support/scripted-provider.ts` | in-process `node:http` server on `127.0.0.1:0`. `start(): {port, baseUrl}`, `onTurn(fn)` where `fn({userText, toolsOffered, lastRole, messages}) => {call:{name,args}} \| {text}` replaces the prototype's regex, `requests: readonly RecordedRequest[]` (tools offered, last role, tool-result text), SSE and non-stream encoders ported from the prototype (the exact chunk sequence of 1.1), `GET /v1/models`. Always loopback-bound. `stop()` closes sockets (use `server.closeAllConnections()`; Omp keeps keep-alive connections). |
| `test/support/omp-profile.ts` | `createOmpProfile({providerPort, realm})`: `mkdtemp` under `os.tmpdir()` with a **short** prefix (control socket path < 107 bytes, `production-live.ts:406`), `agent/models.yml`, `home/`, `config/realm/config.json` (`{image: <fake digest>, stateDir, workspaceRoot}`, mode 0600), `state/` (0700) and `policy.json` (`{workspaceRoots:[ws], mode}`), `ws/` (realpath). Returns the env record for Omp: `PATH` (from test env), `HOME`, `XDG_CONFIG_HOME`, `PI_CODING_AGENT_DIR` only (the daemon is in-process; no driver roots). `dispose()` removes the root. |
| `test/support/omp-rpc.ts` | `startOmp({bin, env, cwd, extensionPath, wrap?})` -> `OmpSession`: spawns with `--mode rpc-ui --no-extensions -e <ext> --model stub/scripted --no-session`, line-buffered JSON parser (counts non-JSON lines, exposes them), `frames`, typed accessors `status()` (last `setStatus` with `statusKey:"realm"`), `notices()`, `toolEnds()`; **event-driven** `waitFor(predicate, ms, label)` (resolves from the frame handler, no polling sleeps; a timeout rejects with the frame tail), `prompt(text) -> {toolStarts, toolEnds}` resolving on `agent_end` (`isTerminal !== false`) of that prompt, `send`, `signal(sig)`, `close()` (stdin end -> wait -> SIGTERM -> SIGKILL, bounded), auto-answer of `extension_ui_request` dialogs (`confirm` true, others cancelled, as the prototype). Only signals the process it spawned. |
| `test/support/realm-daemon-fixture.ts` | `startRealmDaemon({stateDir, workspace, mode})`: wraps `startDaemon` with the e2e options (`FakeExecutionService`, `FakeBridge`, `probe: ok`, `sweep: 0`, `runOpenShell` stub, a fixed `clock`), writes `policy.json`, returns `{socketPath, down(), status(), done}` where `down()` sends `{method:"down"}` through `sendRequest` (the same call `realm down` makes) and awaits `done`. Use `socketDirDeps`/default `ensureSocketDir`. Also exports a second, 40-line **hand-rolled** `startScriptedControlServer` (see 3.4) for states a real controller cannot easily be put in. |
| `test/support/net-trace.ts` | strace wrapper and parser (3.6): `traceArgv(outFile)`, `parseConnects(text) -> {pid, family, address?, port?, path?, result}[]`, `classify(c) -> "unix" \| "loopback" \| "external" \| "dns" \| "ignored"`, `externalConnects(text, allow)`. |
| `test/integration/omp-guard.test.ts` | the gated end-to-end suite: three cases (3.3) plus the optional production scenario. |
| `test/integration/omp-live-helpers.test.ts` | always-running hermetic tests of every pure helper (skip-reason branches, JSONL framing incl. split chunks and bad lines, scripted-provider protocol exercised with a plain `http`/`fetch` client, strace line parser against pasted real lines, classifier). Mirrors `production-live-helpers.test.ts`. |
| `test/support/omp-spike-extension.ts` (compiled to `dist/test/support/omp-spike-extension.js`, loaded by Omp with `-e`) + `test/integration/omp-spike.test.ts` | the spike (section 4), kept as a permanent regression for the enforcement claims, gated like the guard suite. |

Docs and AGENTS.md touched in the same PR (AGENTS.md "Progressive updates"): `docs/integration/omp.md` (Q4 answered, scripted-provider section replaces the "not proven" lines, OMP-05 basis), `docs/integration/omp-lifecycle-runbook.md` (point step B at the test; keep the appendix only if still needed), AGENTS.md Commands (new gate variables) and Layout (new support files).

### 3.3 The three cases and where their realm state comes from

All three run Omp against an **in-process real daemon with fakes** (no Podman). Each case has its own temp profile, daemon and Omp process (Omp ready takes 10-60 s on a loaded host; isolation beats reuse).

| Case | Policy mode in `policy.json` | Realm state source | Script and assertions |
|---|---|---|---|
| C1 advisory, realm down | `advisory` (explicit; after D4 the default flips to fail-closed, so never rely on omission) | `startRealmDaemon`, Omp attaches by itself on `session_start` (`up` -> fake exec -> active). Then `daemon.down()`. | wait status `● realm active`; prompt `write A` -> `toolEnd.isError === false`, file content equals; `down()`; wait status `○ realm disconnected · REALM_NOT_ACTIVE`; prompt `write B` -> a `notify` frame with message exactly `realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy`, `isError === false`, file B exists with content. Provider saw the tool-role message (`done`). |
| C2 fail-closed, realm down | `fail-closed` | same, mode comes from the daemon's `status` reply (`DaemonStatus.mode`, stored by the plugin at attach) | active; `write A` succeeds (today; Phase 16 changes this, see 5); `down()`; prompt `write B` -> `toolEnd.isError === true`, result text `REALM_NOT_ACTIVE`, file B **absent**, provider's next request carries the error text as the tool result. |
| C3 realm active | `advisory` and `fail-closed` (parametrise) | daemon left up | status text matches `^● realm active · ` with `container running`-style reason from the fake (use the fake's reason string, not the production one); `write` lands on the host workspace (**today** this is the host write, which is exactly the behaviour Phase 16 replaces); the first provider request's `tools` list is recorded (negative control: contains no `exec`/`status` today; after Phase 16 this assertion flips). `realm status`-equivalent: `sendRequest(socket, {method:"status"})` says `active`. |
| C4 (optional) production | both | real stack via `createScenarioEnvironment` + `realmCli` from `production-live.ts`, gated additionally by `productionSkipReason`; reproduces L1 + L4 once, serial with the other live files (the startup reap is account-wide, MILESTONE-CONTEXT "live runs take a lock") | status reaches active; fail-closed write blocked after `realm down` through the CLI. |

Why the fake is faithful (answer to "could a fake daemon replace the production stack"): the plugin sees the daemon only through five things: socket presence/answering (`ensureDaemon`/`daemonAnswers`), `up`, `status` (snapshot, display, mode), `tool`, and socket disappearance. Real `startDaemon` over fakes reproduces exactly those on a real Unix socket with the real controller, dispatcher, mutation gate and `down` handling (`daemon.ts:332-358`), so L3/L4's observable (status read fails with `REALM_NOT_ACTIVE`; mode remembered from the last status) is identical [CR; faithful by construction, not yet [EX] — Phase 12's own run is the evidence]. What the fake cannot show is Podman/OpenShell attach timing and the container (that is C4 and the production suite).

Order/race notes: the plugin repaints on a 2 s poll (`STATUS_POLL_MS`), and a guarded call re-reads status itself; so "wait status disconnected" has budget >= 10 s, but a write issued immediately after `down()` already sees the failed read. Do not use `spawnSync` anywhere in the test process while the daemon is in-process (event loop). Create the daemon before spawning Omp so `ensureDaemon` never spawns a real detached daemon (it would be `bun`-run `dist/src/daemon/main.js`, detached, and leak).

### 3.4 When a hand-rolled control server is better than the real daemon

Use `test/omp/extension.test.ts:26-48` style for states the real controller cannot be driven into cheaply: reply `connecting`, `degraded`, `error`, `unbound`, `stopping` snapshots with chosen `mode`, delayed or hung `status` (to test the 5 s `GUARD_STATUS_BUDGET_MS` path), malformed replies (`SCHEMA_INVALID`). It must speak `{id, result}` one line per connection and end the socket. It gives Phase 16 a way to script `tool` replies (`{id, result:{outcome:"done",tool:"write",value:{...}}}`) and daemon errors (`{id, error:{code:"POLICY_DENIED"}}`).

### 3.5 Omp session lifecycle in the harness

`startOmp` -> wait `ready` frame -> wait first `realm` `setStatus` -> assertions -> `close()`; then dispose the profile; the daemon fixture teardown follows the e2e pattern (`cleanupDaemon`: send `down`, await `done`, then remove the directory). All timers cleared; no wall-clock sleeps except bounded failure timers. Scenario timeout 300 s like the production suite; `t.after` for every spawned process and server. Omp may print "Still starting after Ns" on stderr: capture, never fail on it.

### 3.6 Asserting "no network call outside loopback"

Facts first: a default fresh Omp does connect outside loopback (2.6). So the assertion needs an Omp-side lever and an observer.

Observer (recommended): wrap Omp in `strace -f -qq -e trace=connect,sendto,sendmsg,sendmmsg -o <file>` (`strace` already wraps Omp in the prototype scripts). Pass it through the `wrap` option of `startOmp` (argv prefix `["strace", ...flags, "--", omp, ...]`). After the run parse each `connect(` line:
- `AF_UNIX` (control socket, dbus) -> allowed; `AF_NETLINK`, `AF_UNSPEC` -> ignored.
- `AF_INET` with `inet_addr("127.x.y.z")`, `AF_INET6` with `::1` or `::ffff:127.x.y.z` -> loopback, allowed, **except** port 53: a connect to the resolver (`127.0.0.53:53`) means a name lookup happened and is reported as `dns`; fail unless explicitly allow-listed.
- anything else -> `external`, test fails and prints the first 10 offenders with pid and timestamp.
- `sendto`/`sendmsg` with a `sa_family=AF_INET*` name catch unconnected UDP.
Use `-ttt` so offenders can be compared with the `ready` frame time. Also assert the loopback peers are only the stub port (and the known discovery probe ports 11434/8080/1234, listed in an explicit allowlist with a comment naming Omp's local-model discovery).

Levers to get a clean trace (Phase 12 spike must decide, in this order of preference):
1. an Omp setting/env that disables the catalog refresh and provider discovery (candidates in 2.6) written into the profile;
2. a model-registry configuration that exposes only the `stub` provider (`enabledProviders`) so no other provider is refreshed;
3. seeding the profile from a locally generated, **uncommitted** warm `models.db` cache (a one-time setup step in the gate, skipped with a reason when absent) - fragile (24 h TTL);
4. run Omp in an empty network namespace (`unshare --user --map-root-user --net`, bring `lo` up) so any external connect fails ENETUNREACH - needs the stub provider launched inside that namespace as a child process writing its request log to a file (as the prototype does); keep the strace assertion on top.
If none works the honest scoped claim is: "after the `ready` frame and across all scripted turns, Omp made no non-loopback connection" (the warm-profile run satisfied this), with startup catalog traffic named as out of scope. Record the measured outcome with the Omp version in `docs/integration/omp.md`.

Alternative observers (weaker): `/proc/<pid>/net/tcp{,6}` snapshots (racy), `ss -tnp` sampling (racy), a local DNS sinkhole (does not see literal IPs).

---

## 4. Spike script (Phase 12: what to prove and what the stub emits)

Principle: use a **test extension** (`omp-spike-extension`), not the Realm plugin, so answers are independent of Realm bugs; then run the same cases against the Realm plugin in Phase 16. The scripted provider's `onTurn` callback emits exactly one tool call per prompt; the extension logs `tool_call`, `tool_result`, `getActiveTools()`, `getAllTools()` to a JSONL file the test reads.

The extension fixture I used (condensed, all of it ran):

```js
export default function (pi) {                      // mode from env SPIKE_MODE
  if (mode === "shadow") {
    const z = pi.zod;
    pi.registerTool({ name: "write", label: "Realm write", description: "shadowed write",
      parameters: z.object({ path: z.string(), content: z.string() }),
      async execute(id, params, signal, onUpdate, ctx) { log({ev:"exec", params, invoke: typeof ctx.invokeTool});
        return { content: [{ type: "text", text: "SHADOW-WRITE " + params.path }], details: { shadow: true } }; } });
    pi.registerTool({ name: "list", loadMode: "essential", label: "l", description: "raw JSON schema",
      parameters: { type: "object", additionalProperties: false, required: ["path","depth"],
        properties: { path: { type: "string", minLength: 1 }, depth: { type: "integer", minimum: 0 } } },
      async execute(id, p) { return { content: [{ type: "text", text: "LIST " + JSON.stringify(p) }] }; } });
  }
  if (mode === "fallback")
    pi.registerFileWriteFallback(async (req, ctx) => { log({ev:"fallback", dst: req.dst, cause: String(req.cause?.code)});
      fs.writeFileSync(brokered, req.content); return true; });
  pi.on("session_start", async () => {
    log({ ev: "start", active: pi.getActiveTools(), all: pi.getAllTools().map(t => t.name + ":" + t.sourceInfo.source) });
    if (mode === "remove") await pi.setActiveTools(pi.getActiveTools().filter(n => !["write","edit","bash"].includes(n)));
  });
  pi.on("tool_call", async e => { log({ ev: "tool_call", toolName: e.toolName, input: e.input });
    if (mode === "block" && e.toolName === "write") return { block: true, reason: "SPIKE-BLOCK" }; });
  pi.on("tool_result", async e => { log({ ev: "tool_result", toolName: e.toolName, isError: e.isError });
    if (mode === "modify" && e.toolName === "write") return { content: [{ type: "text", text: "MODIFIED" }], isError: false }; });
}
```

Provider script protocol I used: the user prompt `CALL <tool> <json args>` -> that tool call; a `tool`-role last message -> `done`. In the real harness the `onTurn` callback replaces the text protocol.

Results already obtained in this research (the spike must reproduce them as assertions):

| ID | Emission | Observed [EX] |
|---|---|---|
| S1 | `write {path:"a.txt",content:"X"}` with `write` shadowed | extension `execute` ran; no host file; `tool_call` and `tool_result` fired; `getAllTools` says `write:extension` |
| S1b | `exec`, `status`, `list` (JSON-schema) calls with those tools registered | all executed; results `isError:false` |
| S2 | `setActiveTools` without `write,edit,bash`; calls `bash`, `write` | `bash` -> `Tool bash not found`; `write` -> device-only refusal; no files |
| S2c | `read xd://`; `write xd://ast_edit {}`; `write local://scratch.txt` | 3 mounted devices (`ast_edit, debug, lsp`); device reached; `local://` write succeeded outside the workspace |
| S5 | ro workspace mount + `write` with `registerFileWriteFallback` returning `true` | handler got `{dst, content, sessionId, cause:EROFS}`; Omp reported success |
| N1 | strace of a cold and a warm profile | external 443 connects when cold; none when warm |

Still to run in the Phase 12 spike (each is one scripted turn; assertion in brackets):

- **S2a (full denylist):** remove `write, edit, bash, eval, ast_edit, lsp, debug, task` (from `getAllTools` minus an allowlist) with `write` **not** shadowed, then emit each of `write(path)`, `edit {...}`, `eval {...}`, `ast_edit {...}` (valid args from `read xd://ast_edit`), `lsp`, `debug`, `task`, plus `write xd://<each>`. [every one refused, zero workspace mutations, active list printed.] Then repeat with `write` shadowed by a Realm-like tool [same].
- **S2b (lifecycle):** after `session_start` removal, send `/new` or a session switch; [does the removal persist; does `session_start` fire again].
- **S3 (nested device event):** `write {path:"xd://ast_edit", content:<valid args>}` while mounted, with a `tool_call` handler that blocks `toolName:"ast_edit"`. [handler sees `ast_edit`? blocked? if only the outer `write` is seen, `write` must stay blocked/removed.]
- **S4 (hook semantics):** `tool_call` returns `{input:{path:"b.txt"}}` (rewrite; assert `execute` params), `{block:true}`, throws, and hangs past `toolCallTimeoutMs` (set it small in the profile settings if a key exists; otherwise assert only throw); `tool_result` returns `{content, isError:true}` (assert the wire frame and the next provider request's tool message). [documents modify semantics.]
- **S6 (subagents):** `task` call (read `read xd://task` for the argument shape) whose child session is served by the same scripted provider emitting `write`/`bash`. [does the child load the extension, inherit `setActiveTools`, hit the guard; if not, `task` must be removed from the active set.]
- **S7 (eval bridge):** `eval` with code that writes a file via `fs`/`Bun.write`, with the guard loaded. [is `tool_call` fired for the inner call (docs say no); confirms `eval` must be removed.]
- **S8 (user-initiated):** RPC command for a user shell (`user_bash`) [out of model scope; document].
- **S9 (invalid args):** call the JSON-schema `list` with `{path:"/abs"}` or missing `depth` and `additionalProperties`. [schema errors reported by Omp before `execute`.]
- **S10 (names with a leading path form):** native-style absolute path to the Realm `write`: [what does the model send; Realm's schema rejects leading `/`, see 5].
- **S11 (offline lever):** run the cold-profile trace with each candidate lever of 2.6; pick the one that yields zero non-loopback `connect`.
- **S12 (approval):** `--approval-mode` other than yolo; [RPC prompt shape for an undeclared/`exec` tool and whether `approval:"read"` suppresses it].
- **S13 (big results):** Realm-like `read` returning 1 MiB text; [truncation/spill behaviour, `details` size].
- **S14 (kill):** SIGKILL Omp mid-tool-call with a Realm-like `execute` in flight; [daemon unaffected; no partial state] (reuse L7 on the fake).

Output of the spike: a table in `docs/integration/omp.md` Q4 with answer, evidence label, Omp version for each of S1-S14; the decision for D3 (which mechanism fail-closed uses) follows from S2a, S3, S6, S7: if any mutating path survives removal, the claim stays "guard", per D3's escape clause.

---

## 5. Phase 16 impact

### 5.1 `src/omp/plugin.ts` and `src/omp/extension.ts`

1. `OmpExtensionApi` (`plugin.ts:71-76`) must grow: `registerTool`, `getActiveTools`, `setActiveTools` (and `registerFileWriteFallback` only if S5 shows value). The header comment (`:18-20`: "No ... setActiveTools enforcement is used", "no `registerTool`") and the file's "Verified host surface" list must be rewritten; `docs/integration/omp.md` Q4/Q5 and the L2 sentence "no Realm tool" (`omp.md:215`) likewise.
2. `HostToolCall` (`plugin.ts:56-59`) only has `toolName`; add `input` (and `toolCallId`) if the guard must inspect `write` paths (`xd://...`, `local://...`) or block nested devices.
3. New module, e.g. `src/omp/tools.ts`: builds `ToolDefinition`s for `exec`, `read`, `write`, `list`, `status` from shared descriptors. `execute(toolCallId, params, signal, onUpdate, ctx)` calls the live `session.client.call({[name]: params})`. The client is `session.client` (null while disconnected): when null the tool must return an error result carrying `REALM_NOT_ACTIVE` (never fall back to the host).
4. `session_start`: after the attach is started, apply the active-tool policy (fail-closed: remove the mutating native set computed at runtime; advisory: leave natives, register Realm tools). Re-apply on `/realm-retry` and on mode change; remove/restore on `session_shutdown`.
5. `GUARDED_HOST_TOOLS` (`plugin.ts:123`) stays a backstop; extend to every native file-mutating or exec tool the spike shows reachable. In `active` state the guard currently **allows** host `write`/`edit` (`stateVerdict`, `plugin.ts:444-446`), which is the Phase 16 problem: with Realm active, native mutating tools must be blocked or removed in fail-closed.
6. Tests: `test/omp/plugin.test.ts` `FakePi` (`:~190`) implements only `on` and `registerCommand`; `FakeDaemon.call` rejects "the plugin never dispatches tools" (`:~163`) - both change. `test/omp/extension.test.ts` pi stub likewise. Add the Phase 12 harness C3 flip (tools list now contains the five Realm tools).
7. `process.env` stays read only in `extension.ts`; the tools module takes the client via the session.

### 5.2 Frozen ToolCall shapes (`src/contract/tools.schema.json`, `validate.ts:40-76`)

A call is a map with exactly one key (D-13), every object rejects unknown keys:

| Tool | Input |
|---|---|
| `exec` | `{argv: string[] (min 1)}` XOR `{shell: true, script: string (min 1)}` (shell form needs policy `shellEnabled`, else `SHELL_NOT_ALLOWED`) |
| `read` | `{path, maxBytes}` both **required**, `maxBytes` integer 1..1 048 576 |
| `write` | `{path, content, ifMatchSha256?}` (`^[0-9a-f]{64}$`) |
| `list` | `{path, depth}` both required, `depth` integer >= 0 |
| `status` | `{}` |
| `retry` | `{}` (not in the five requested; `/realm-retry` already exists) |

`path` = workspace-relative: not starting with `/` or `\` or a drive letter, no `..` segment. Implications for the Omp adapter [CR]:
- Models (and Omp's own tools) often use absolute paths or `./x`; Omp runs with `cwd` = workspace. The adapter must normalise (relativise against `ctx.cwd` when inside, refuse otherwise with a clear error) without changing the frozen contract; decide whether `./x` is accepted by the schema (the pattern only bars leading `/`, `\`, drive, `..` segments, so `./x` passes).
- `read.maxBytes` is required: either document it in the description and let the model supply it, or have the adapter inject a default; list `depth` likewise. This is an adapter decision, not a contract change.
- **Descriptor reuse:** `MCP_TOOL_DESCRIPTORS` (`src/mcp/server.ts:109-113`, schemas at `:56-98`, descriptions at `:100-107`) are already combinator-free JSON Schemas pinned to the frozen schema by `test/mcp/descriptors.test.ts`. Extract them into a neutral module (e.g. `src/tools/descriptors.ts`) used by MCP, ACP and Omp so there is one source; Omp accepts raw JSON Schema as `parameters` [EX]. Note `exec`'s "exactly one form" rule stays in prose + dispatcher.
- Omp's schema layer adds its own intent field `i` to tool schemas it owns and strips it for tools that do not define it (`agent-loop.ts:3100-3106`) [CR]; the frozen `additionalProperties:false` therefore holds, but verify with S9.

### 5.3 Result mapping (`ToolOutcome` -> `AgentToolResult`)

- `DaemonClient.call(tool)` returns a `ToolOutcome` for `done`; for a refusal it **throws** `RealmError` (`daemon.ts:417-420`, `client.ts:125-127`). Map: `done` -> `{content:[{type:"text", text: <rendered value>}], details: outcome}`; thrown `RealmError`/`refused` -> `{content:[{type:"text", text: "<code>: <reason>"}], isError:true, details:{code, causeCode?, retryable}}`; transport failure -> `REALM_NOT_ACTIVE` error. Never throw out of `execute` for expected refusals (a throw also works but loses `details`).
- Value shapes to render [CR/EX]: `exec` -> `{exitCode, stdout, stderr, truncated}`; `write` -> `{sha256, bytes, warning}`; `list` -> `ListResult`; `status` -> `{snapshot, display}`; **`read` -> `{status:"found", content: {type:"Buffer", data:[...]}, sha256, ...}`** over the control channel (the `Buffer` was JSON-serialised; L5 line 113). The adapter must decode `content.data` (UTF-8 text, or base64 for binary) before showing it to a model; consider fixing the daemon-side serialisation instead (affects MCP `read` too).
- Timeouts: Omp bounds `execute` only through the signal; the control channel bounds `tool` at 40 s (`channel.ts:49`); dispatcher exec bound 30 s (`dispatch.ts:60`). Pass `signal` abort to a client-side cancel (the client has no cancel API: unknown, check `connectDaemon`).
- Approval: declare `approval: "read"` for `read|list|status`, `"write"` for `write`, `"exec"` for `exec`; `loadMode: "essential"` for all five.

### 5.4 Which native tools to remove / keep (from the spike)

Computed at runtime: `allowed = names(getAllTools()) \cap READ_ONLY_ALLOWLIST` (e.g. `ask, todo, wait, web_search, glob, grep` — decide per D3; `web_search` is network; keep only if the product allows), then `setActiveTools(allowed ∪ {realm tools})`. Not `denylist = {write, edit, bash}` (see 2.2). Hashline `edit` depends on native `read` snapshots (`[path#TAG]` anchors in native `write` results, L3 output); shadowing `read` and `write` with Realm tools means `edit` must be removed or re-implemented (Phase 16 scope question for the planner).

### 5.5 Other Phase 16 risks

- OMP-05/UI claims (docs): README says the guard "warns and allows host write and edit"; the claim and `docs/integration/omp.md` must say exactly what the spike proves (D3 escape clause).
- D4 (default mode flips to fail-closed, Phase 15): C1/C3 must set `mode` explicitly in `policy.json`.
- The model sees different tool names/semantics (`exec` argv form, no `bash` string) - behaviour change for existing users; advisory keeps natives.
- `registerFileWriteFallback` can be an additional backstop if Omp itself is confined; out of scope unless chosen.

---

## 6. Suggested plan slicing for Phase 12 (file-disjoint work units)

Interfaces to freeze before starting (so units can run in parallel): `OmpSession` (omp-rpc.ts), `ScriptedProvider` (`start`, `onTurn`, `requests`), `RealmDaemonFixture` (`socketPath`, `down()`), `OmpProfile` (env record, paths), `ompSkipReason` signature, `NetConnect` record. Dependency: WU4 and WU5 import the others' interfaces only.

| Unit | Files (owner exclusive) | Content | Needs |
|---|---|---|---|
| WU1 Harness core | `test/support/omp-live.ts`, `test/support/scripted-provider.ts`, `test/support/omp-profile.ts`, `test/support/omp-rpc.ts`, `test/integration/omp-live-helpers.test.ts` | gate + provider + profile + RPC session + their always-running tests | none |
| WU2 Realm-state fixture | `test/support/realm-daemon-fixture.ts` (+ `test/daemon/realm-daemon-fixture.test.ts` proving `down` removes the socket and `status` answers through `connectDaemon`) | in-process real daemon with fakes; hand-rolled scripted control server | none |
| WU3 Network observer | `test/support/net-trace.ts` (+ `test/integration/net-trace.test.ts` with pasted real strace lines from this research: loopback, 127.0.0.53:53, external v4/v6, AF_UNIX, AF_UNSPEC, sendto) | parser/classifier/argv builder | none |
| WU4 Enforcement spike | `test/support/omp-spike-extension.ts`, `test/integration/omp-spike.test.ts`, `docs/integration/omp.md` (Q4 and the live-verification table), `docs/integration/omp-lifecycle-runbook.md` | S1-S14, results table, D3 decision input, OQ-P5-01/02 closure text | WU1, WU3 |
| WU5 Guard suite + docs | `test/integration/omp-guard.test.ts`, `AGENTS.md` (Commands, Layout), `.planning` traceability note only through GSD | C1-C3 (+ C4 optional), version recording, no-network assertion using the lever WU4 picks, OMP-05 evidence statement | WU1, WU2, WU3 (the lever from WU4 at the end) |

WU4 and WU5 both want to edit `docs/integration/omp.md`; give it to WU4 and let WU5 add its text in a second PR or after WU4 merges (otherwise they are not file-disjoint).

---

## 7. Risks

1. **Omp load and time.** Ready took 10-60 s here (Omp prints "Still starting after 31s"); production prototype cold-attach 40-57 s at load 70. Three cases = at least 3 Omp starts. Mitigation: per-test 300 s bound, event-driven waits, only the cases required.
2. **Version drift.** The stub protocol, `rpc-ui` frame names, `tool_execution_*` fields, the device-only `write` behaviour and `registerTool` replacement are Omp 18.12.6 behaviour. Record `omp --version`; hard-fail below 18.12.6; the spike table is version-stamped.
3. **Network assertion.** A default profile contacts the internet at startup (2.6); acceptance "no network call outside loopback" is not achievable by wrapping alone. Only 3 traced runs exist (cold, warm, cold) and which hosts were contacted is unknown. If no lever exists, the scoped claim must be stated honestly (D3-style escape).
4. **strace availability.** Not on CI images by default; `ptrace_scope=1` allows tracing one's own child only; containers may block ptrace. Gate with a trial trace; skip with reason.
5. **Enforcement is partial by default.** Removing `write/edit/bash` leaves `ast_edit`, `lsp`, `debug`, `eval`, `task` and `local://` writes; subagents and the eval bridge may bypass hooks. D3 may end as "guard only".
6. **`registerFileWriteFallback` misreads.** It reports success to the model for bytes written elsewhere and runs only after a denial; do not present it as containment.
7. **Hermetic daemon vs real daemon drift.** The in-process daemon uses fakes; the production suite (and C4) keep the real-stack evidence. Keep C4 or the L1/L4 evidence current, or the harness proves less than the claim.
8. **In-process daemon in the test process.** A blocking call in the test (e.g. `spawnSync`) stalls the daemon; `down` must be awaited before the temp dir is removed (leaked listening server holds the event loop open, `e2e.test.ts:61-76`).
9. **Socket path length.** `sun_path` limit 107 bytes; use a short `mkdtemp` prefix like `rlv-`; the Omp temp profile root must stay short too.
10. **Unsupervised Omp side effects.** Omp writes `$HOME/.omp/logs`, sqlite files in the agent dir and `<tmp>/omp-local/<session>/` (local:// scratch). Isolate `HOME` and the agent directory; clean `<tmp>/omp-local` entries is not possible per test (shared) - tolerate.
11. **Parallel test files.** The production live suite counts all containers; the Omp suite uses none, but both may run under `npm test`; the Omp suite uses only ephemeral ports and its own dirs, so it is safe in parallel except for CPU load (flaky timeouts on a loaded host: generous bounds, no wall-clock assertions of speed).
12. **Root vs non-root.** My `chmod`-style denial tests would not work as root; use the EROFS mount (`unshare -m`, needs privileges or a user namespace, `unshare -Urm`) or skip with a reason.
13. **Prompt protocol coupling.** `agent_end` vs `prompt_result` completion signals differ by mode; I used `agent_end` successfully. If Omp changes frame names the harness fails loudly at `ready`/first `prompt`, which is the desired behaviour.
14. **Tool-result truncation/spill** for large `read`/`exec` outputs (S13) can change what a model sees versus MCP.
15. **Process env leak (L8, other phase)**: the plugin-spawned daemon inherits Omp's whole environment; irrelevant here because the daemon is in-process, but a C4 run reproduces it.

## 8. Unknowns list (nothing here is claimed as fact)

- Which hostnames Omp contacts at cold start and whether any setting disables it (S11).
- Whether a valid nested `write xd://<tool>` emits `tool_call` for the inner tool (S3).
- Whether `task` subagents load the extension and inherit `setActiveTools` (S6).
- Whether eval-prelude calls and `user_bash` bypass the hook (S7, S8) - documented but not executed.
- Behaviour of `execute` returning `isError:true`, of hook-modified `tool_result`, of invalid args against a raw JSON Schema, of large results, of non-yolo approval (S4, S9, S12, S13).
- Whether `session_start` re-fires on `/new`/switch and whether `setActiveTools` survives (S2b).
- Whether `DaemonClient` supports cancellation (no API seen at `src/daemon/client.ts:23-33`).
- Whether the hermetic daemon reproduces the live status strings exactly (Phase 12's first run is the proof; the reason text is the fake's, so assert on label prefixes and the code, not on `container running`).
