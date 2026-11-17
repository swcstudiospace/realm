# Phase 23: Boot integration for host plugins - Context

**Gathered:** 2026-11-17, from the merged Phase 21 and 22 code (`src/host/*.ts`, `src/omp/*.ts`, commit 819014d), the boot paths of `realm mcp` and `realm acp` (`src/cli/main.ts`), the daemon control channel and metrics (`src/daemon/channel.ts`, `src/daemon/daemon.ts`, `src/observe/metrics.ts`), the audit writer (`src/audit/log.ts`), the Phase 21 and 22 planning files, and `docs/integration/{host-plugin-contract,hosts,omp,mcp,acp}.md`. Nothing was run; every claim below cites a file and line read on this date.
**Status:** Planned (three plans, nothing executed). Requirement IDs BOOT-01..BOOT-09 are defined in this file's `<specifics>` block and are not yet in `.planning/REQUIREMENTS.md`; the orchestrator registers them with gsd-tools. `.planning/ROADMAP.md` still shows Phase 23 as "To be planned"; the orchestrator updates it.

<domain>
## Phase Boundary

When any supported CLI agent starts, Realm opens on boot, the same way for every host. The direction is fixed by the owner (carried from Phases 21 and 22, not reopened): the plugin loads into each CLI agent; the agent is the host process and Realm is the sandbox it attaches to. Omp plus Claude Code, OpenCode, Codex and Kimi CLI are proven end to end in Phase 24; every other runtime is config-only (Phase 25). Enterprise baseline only: the structured logger (`src/observe/logger.ts`), redaction (`src/audit/redact.ts`), least privilege through the existing policy gates, the hash-chained audit (`src/audit/log.ts`). No second logging, redaction, audit or metrics mechanism, no new npm dependency, no telemetry that leaves the machine. Merge on green CI, GitHub-hosted runners.

Omp already opens Realm on boot through an in-process extension (Phase 22). Claude Code, OpenCode, Codex, Kimi CLI and the config-only runtimes cannot load a JavaScript extension: they launch `realm mcp` (or `realm acp`) over stdio. Phase 23 gives those two entry points the same boot contract Omp has, and gives every boot, from every host, the same observable trail.

Phase 23 delivers:

1. **One attach sequence** (BOOT-01). `src/host/attach.ts` is the single implementation of "ensure the daemon answers, connect, run the idempotent `up`, keep or drop the client when `up` is refused". Today it exists twice: in `src/omp/extension.ts` (line 52) and, differently, in `src/cli/main.ts` (`ensureSharedDaemon` 566, `runMcp` 588, `runAcp` 620). Omp, `realm mcp` and `realm acp` all call the new one.
2. **A production boot driver** (BOOT-02). `src/host/boot-driver.ts` implements the Phase 21 `HostBootHook` port for `mcp-config` hosts: bounds from `resolveBoot`, startup budget through `withStartupBudget`, retryable versus terminal through `attachFailureDisposition`, bounded re-attach with the shared sub-state table and jitter, a fail-closed gate on tool calls, client-only shutdown. It passes the Phase 21 conformance harness C1 to C9. `bootHookOf(entry)` returns it for the 18 `mcp-config` hosts, so `HostAdapter.bootHook` is no longer `null` in production (Phase 22 left it `null`: `src/host/adapter.ts:438`).
3. **The boot sequence of `realm mcp` and `realm acp`** (BOOT-03): numbered, deterministic, serve-after-boot, with `--host <id>` and `--reattach` flags, an exit-code contract, signal teardown, and the rule that a host shutdown closes its client and never sends `down`.
4. **Per-host failure isolation** (BOOT-04), proven with a real daemon over fakes.
5. **Per-host presence markers for MCP and ACP sessions** and doctor and `realm host status` reporting for them (BOOT-05).
6. **Boot observability** (BOOT-06, BOOT-07, BOOT-08): a new `host-boot` control method; counters in `realm metrics`; one redacted structured `host.boot` line per report in `daemon.log` carrying the boot id; a daemon-only `host-boot` audit chain; a host-side observer shared by Omp and the stdio hosts.
7. **Docs and gates** (BOOT-09), including the nine export-usage allowlist entries Phases 21 and 22 left as "production wiring is Phase 23".

Out of scope (planned elsewhere): per-host install recipes and host-side proof for Claude Code, OpenCode, Codex and Kimi CLI (Phase 24); the other 14 runtimes (Phase 25); a published conformance package and author docs (Phase 26). No adapter bundle under `adapters/` changes. Registering Realm in any live host configuration needs explicit owner approval per host (`docs/integration/hosts.md`).
</domain>

<decisions>
## Implementation Decisions

### Findings that shape the plans (verified in the repo, 2026-11-17)

- **F1. The port has no production consumer.** `createHostAdapter` sets `bootHook: deps.bootHook ?? null` (`src/host/adapter.ts:438`); no caller passes one. Only `test/support/reference-boot-hook.ts` and `test/support/omp-boot-hook.ts` implement `HostBootHook`. That is why `scripts/check/export-usage-allowlist.json` still lists nine Phase-23 entries (see D-23-11).
- **F2. The attach sequence is duplicated and has drifted.** Omp's (`src/omp/extension.ts:52-95`) ensures the daemon, connects, runs `up`, and keeps the client of a refused `up` only when `status` answers and names this root and session. `runMcp` (`src/cli/main.ts:588-617`) keeps the client of a refused `up` unconditionally and writes the failure to stderr ("`realm mcp still serves when up is refused`", `test/cli/cli.test.ts:557`, `:773`); `runAcp` (`:620-655`) treats a refused `up` as fatal and also refuses any state other than `active` or `degraded` (`test/cli/cli.test.ts:853`, `:880`). Three behaviors, all pinned by tests, with no shared code and no bound other than the 230 s `up` timeout (`CONTROL_TIMEOUT_MS.up`, `src/daemon/channel.ts:46-53`).
- **F3. MCP and ACP serve nothing before boot settles, by decision and by test.** `test/cli/mcp-attach.test.ts:88` is titled "serves nothing before up settles"; its header says `realm mcp` must "ensure the shared daemon, claim the workspace with up, and only then read and answer MCP frames" (P6-D9). The success path writes nothing to diagnostics (`:140` area, `assert.equal(diagnostics.text(), "", ...)`), and the up notice is written once (`test/cli/cli.test.ts:1142`, `:1166`). Phase 23 keeps all of that: tool exposure is the last boot step, and default-level logging stays silent on success.
- **F4. The servers already take a `{ call }` dispatcher.** `createMcpServer(dispatcher, ...)` takes `Pick<ToolDispatcher, "call">` (`src/mcp/server.ts`, `McpDispatcher`); `runAcpAgent` takes the same (`src/acp/agent.ts`, `AcpAgentOptions.dispatcher`). ESLint bans every other dispatcher internal in `src/mcp`, `src/acp`, `src/omp` (`eslint.config.js`, `ADAPTER_INTERNALS`). So boot integration for MCP and ACP needs no edit to either server: the boot driver itself is the `{ call }` they are handed, and it can swap its client under them on re-attach.
- **F5. A `mcp-config` manifest cannot carry `boot` or name its host at launch.** `parseHostPluginManifest` refuses `boot` for `mcp-config` (`src/host/manifest.ts:196`, pinned by `test/host/manifest.test.ts:49` "mcp with boot"), `defaultManifestFor` launches `realm mcp` with no host id (`test/host/manifest.test.ts:122`), and `parseArgv` accepts only `--workspace` for `mcp` and `acp` (`src/cli/main.ts:92-99`). So today a stdio session cannot say which host it serves, and presence markers, metrics and audit cannot be per host.
- **F6. Nothing tears an MCP or ACP session down but stdin EOF.** `main()` (`src/cli/main.ts:823-846`) leaves `mcp` and `acp` to end themselves; no signal handler exists in `src/cli`. A host that kills `realm mcp` with SIGTERM skips every `finally`. A client holds no session state (`src/daemon/client.ts` header: every request dials, `close()` only marks the client closed), so the real loss is a stale presence marker, not a leaked session.
- **F7. The audit writer has no cross-process lock.** `writeAuditLine` reads the chain head and then appends (`src/audit/log.ts:139-151`). The `host-plugins` chain is safe because only the single `realm host` process writes it. Many host processes booting at once, all appending to one boot chain, could fork it. So the daemon, which is one process and appends synchronously, is the only writer of the boot chain (D-23-08).
- **F8. Three modules sit close to the 1000-line gate** (`scripts/check/module-size.mjs`, `LINE_LIMIT = 1000`): `src/omp/plugin.ts` 993, `src/daemon/daemon.ts` 945, `src/cli/main.ts` 856. New logic goes in new modules; `plugin.ts` is not touched; `daemon.ts` gains at most about 15 lines; `main.ts` shrinks.
- **F9. The metrics and control surfaces are closed sets, and strict.** `CONTROL_METHODS` is a const tuple and `CONTROL_TIMEOUT_MS` a full `Record` over it (`src/daemon/channel.ts:17`, `:46`), so a new method fails compilation until it has a bound. `isMetricsSnapshot` accepts exactly the keys in `SNAPSHOT_KEYS` and exactly `attachMs` and `toolCallMs` under `timings` (`src/observe/metrics.ts:253`, `:299-320`); every row key is validated against a closed vocabulary. A new key must be additive and optional in the validator, or a new `realm metrics` client reading an older running daemon fails with `SCHEMA_INVALID`.
- **F10. The conformance harness fits a stdio driver as it is.** `defineBootConformance(name, factory, manifest)` (`test/support/host-boot-conformance.ts:405-413`) asserts C1 to C9 against a `HostBootHookFactory`. Link loss is detected by the status poll (`C6`, `C8` advance `statusPollMs`), "no timer remains" is "no wait armed and at most one repaint poll" while a session is live, and the guard's non-string verdict is exactly `"realm bad tool call"`. A driver that arms its poll only when re-attach is enabled passes. The reference hook and its four mutants (`test/host/boot-conformance.test.ts`) stay as they are: they prove the harness can fail, which production code must not be bent to do.
- **F11. Hosts' real connect timeouts are unknown.** `docs/integration/hosts.md` records Claude Code 2.1.308 and Grok Build 1.0.46 connecting to `realm mcp` in isolated homes on 2026-10-29 (a connection check on a warm stack). It records no host's MCP start timeout. A cold first boot can take up to the 230 s `up` bound before `initialize` is answered. [INFERENCE: some hosts give up earlier.] See OQ-23-01.

### Owner-approved scope (carried in, not reopened)

- Plugin loads into each CLI agent. Omp plus Claude Code, OpenCode, Codex, Kimi CLI proven end to end; others config-only. Enterprise baseline only. Merge on green CI.
- Fail-closed stays the default everywhere. Strict TypeScript ESM, no new npm dependency, existing `RealmError` codes only (`src/core/errors.ts` stays at 31 codes). New refusal reasons are existing codes.
- The sandbox lasts until `realm down`. A host shutdown closes that host's client and never sends `down` (`AGENTS.md:109`; `test/support/host-boot-conformance.ts` C6).

### D-23-01. One attach sequence: `createDaemonAttach` (BOOT-01)

New `src/host/attach.ts` (allowed by the `src/host` ESLint block, which may import `../daemon/{client,channel,ensure}`; it spawns nothing itself):

```ts
createDaemonAttach(options: {
  socketPath: string; stateDir: string;
  connect: (socketPath: string, selection: ControlSelection) => DaemonClient;
  spawnDaemon: () => void;                       // injected: src/host may not import child_process
  diagnostics: { write(text: string): void };
  upBoundMs: number; pollMs: number;             // ensureDaemon timeoutMs and pollMs
  refusalRetention: "verified" | "always" | "never";
  onSelection?: (sessionId: string) => void;
  onUp?: (status: DaemonStatus) => void;         // the up reply, once, on a successful up
}): (workspaceRoot: string) => Promise<{ client: DaemonClient; refusal: RealmError | null }>
```

Each call: `selectionOf(workspaceRoot)` (re-resolved on every attempt, so a root swapped for a symlink between attempts is re-canonicalized), `ensureDaemon` with `reportingStartFailure(daemonAnswers(...))`, `connect`, `up`. On a refused `up`: `"verified"` keeps the client only when `status()` answers and reports this root and session id (today's Omp rule, `src/omp/extension.ts:62-94`); `"always"` keeps it (today's `realm mcp`; safe because every request carries the selection and the daemon refuses another project's: MULTI-03; the driver's own readback then decides whether to adopt it); `"never"` closes it and rethrows (today's `realm acp`). The three retention modes exist because three pinned behaviors exist; the plan does not unify them, it names them. Any non-`RealmError` refusal becomes `SCHEMA_INVALID`, as in Omp today.

### D-23-02. The production driver implements the port; Omp keeps its plugin (BOOT-02)

`src/host/boot-driver.ts` exports `createBootDriver(deps: HostBootDeps, bounds: ResolvedBoot): BootDriver`, `bootHookOf(entry: HostRuntimeEntry): BootDriverFactory | null` (`BootDriverFactory = (deps, manifest) => BootDriver`, assignable to `HostBootHookFactory`, so the runner keeps the typed `call` and `outcome`), and `systemTimers` (real timers, handles `unref`ed so a pending poll never holds the process). `BootDriver` is `HostBootHook` plus:

- `call(tool: unknown): Promise<ToolOutcome>`: the `{ call }` the MCP server and ACP agent receive. It reads the tool name (the sole own key of the D-13 map; anything else is `SCHEMA_INVALID`, no daemon call), asks `guard`, and on a block returns `{ outcome: "refused", tool, code, retryable }` instead of dialing; otherwise it forwards to the current client. A `RealmError` thrown by the channel is returned as a refusal and counts as a link-lost signal.
- `outcome(): { kind: "ready" | "refused" | "failed"; code?: ErrorCode; status: DaemonStatus | null; retrying: boolean; daemonAnswered: boolean }`, what the entry point decides exit and exposure on. `ready` is an adopted client with a successful `up`; `refused` an adopted client whose `up` was refused and whose readback confirmed this root and session; `failed` no adopted client. `daemonAnswered` is true when the daemon itself refused the `up` (the attach resolved with a refusal), whether or not the readback let the driver adopt the client: it is what separates "the daemon said no" from "no daemon" for `realm mcp`'s exposure rule (D-23-04).

`HostBootDeps` (`src/host/types.ts`) gains one optional member, `observe?: (event: HostBootEvent) => void`, with `HostBootEvent = { phase: "attached" | "refused" | "failed" | "link-lost" | "reattached" | "closed"; code?: ErrorCode; attempt: number; durationMs: number; state: State | null }`. Optional, so the Phase 21 harness, the reference hook and the Omp double compile unchanged. The driver calls it inside a `try`: a throwing observer never changes an outcome. The six phase literals are the same vocabulary as `HOST_BOOT_PHASES` in `src/host/boot-report.ts` (23-02); `types.ts` spells them out so 23-01 does not depend on 23-02, and 23-03 pins the two lists equal with a type-level test.

Behavior (each point is a test in 23-01):

- Every bound comes from `ResolvedBoot`; nothing is hard-coded. Each attempt (`attach` then one `status` readback, validated against the selection exactly as harness C3 and C9 require) runs under `withStartupBudget`; a late attach that resolves after the budget or after shutdown has its client closed.
- `attachFailureDisposition` decides retry. Re-attach is **off by default** (O4, Phase 21): one attempt, `start()` resolves, `status()` carries the code. With re-attach enabled the shared table (`reattachTransitionAllowed`) and `equalJitterDelayMs` schedule at most `retryCap` waits, each attempt under the startup budget; a terminal code stops the streak; `retry()` performs exactly one new attempt.
- The status poll (every `statusPollMs`, each read under `guardStatusBudgetMs`) is armed **only while re-attach is enabled**, because link-loss detection is its only job here; there is no repaint surface. `link` is `off` when re-attach is disabled.
- `guard(toolName)`: non-string is `backstopVerdict`'s `"realm bad tool call"` with no daemon call; the five non-retry Realm tools pass while an adopted client is `off` or `linked` and are refused with the last code while `reconnecting`, `attaching`, `failed` or after shutdown, with no status read (a read per call would add a round trip to every tool call; the daemon remains the one policy authority); `retry` always passes the gate and, when not `linked`, runs one re-attach before it is forwarded; any other string is classified with one status read bounded by `guardStatusBudgetMs` through the adopted client and then `backstopVerdict` (refused with `POLICY_DENIED` unless the daemon reports advisory), because harness cases C3, C5 and C9 require exactly that read. The driver cannot restrict a host's own built-in tools: `host.tools.restrict` is outside the `mcp-config` capability ceiling (`src/host/capabilities.ts`, `MCP_CONFIG_CEILING`), and the docs say so.
- `shutdown()` is idempotent: clears every timer, cancels a pending wait, closes the client once, emits the `closed` event. It makes no daemon call (C6); it never sends `down`.

**Why Omp does not run on the driver.** `src/omp/plugin.ts` is the conformance-tested session state machine of a host with a UI, a status item, a host tool set to reconcile and an event pipeline (`registerRealmPlugin`, `guardHostToolCall`). Moving it onto the driver would rewrite a 993-line module whose behavior 131 KB of tests pin, to share logic that is already shared where it matters: bounds, code lists, sub-state table and jitter (`src/host/boot.ts`, since Phase 22), and from this phase the attach sequence (D-23-01), the observer (D-23-09) and presence. Omp's `HostAdapter.bootHook` therefore stays `null` by design: "the host owns its in-process hook", conformance-proven through the Phase 22 double. A test pins `bootHookOf(omp) === null` and non-null for each of the 18 `mcp-config` entries, so a future host cannot silently ship with no boot hook.

`createHostAdapter` defaults `bootHook` to `bootHookOf(entry)`; `src/cli/stdio-host.ts` resolves its factory through `bootHookOf(HOST_RUNTIMES[id])`, so the port's `bootHook` field and the production path are the same thing. A session started with no `--host` (every adapter bundle and snippet shipped today runs plain `realm mcp`) builds the driver directly from `BOOT_BOUNDS` and reports as `unlabelled`.

### D-23-03. `realm mcp|acp` flags, manifests and launch (BOOT-03)

- `parseArgv` (`src/cli/main.ts:75-100`) accepts, for `mcp` and `acp` only, `--workspace <path>`, `--host <id>` and `--reattach` in any order, each at most once; anything else is the usage error (exit 2) as today. `--host` takes a canonical id (not an alias) and must name an `mcp-config` host: `--host omp` is a usage error, because an extension host's markers are written by its plugin. `up`, `down`, `status`, `metrics` and `doctor` keep `--workspace` only. `USAGE` is updated.
- `parseHostPluginManifest` accepts `boot` for `mcp-config` manifests (same `parseBoot` rules); the "mcp with boot" refusal case at `test/host/manifest.test.ts:49` becomes an acceptance case. `defaultManifestFor` for an `mcp-config` host launches `realm mcp --host <id>` (`args: ["mcp", "--host", id]`: the charset and the 8-argument limit of `launch.args` allow it). The assertion at `test/host/manifest.test.ts:122` changes accordingly. Phase 24 recipes then write that launch into host configurations. Hosts that already run plain `realm mcp` keep working and report as `unlabelled`.
- `--reattach` enables bounded boot retry and link re-attach for that process (`bounds.reattach.enabled`). No environment variable is added: a host's configured arguments are visible and auditable, and `src/cli/main.ts` reads no new variable.

### D-23-04. The boot sequence and the readiness contract (BOOT-03)

Every stdio session runs the same numbered steps; the host observes boot through the first protocol reply or the exit code.

| Step | Action | Failure |
| --- | --- | --- |
| 1 resolve | parse flags, absolute workspace root, host id, manifest and `resolveBoot`, new boot id | usage error, exit 2, nothing started |
| 2 ensure | probe the control socket; spawn the detached daemon at most once; poll to the `up` bound | `DAEMON_START_TIMEOUT` or the daemon's own start-failure code |
| 3 up | connect for this selection; idempotent `up` | refusal handled per D-23-01 retention |
| 4 readback | one `status` read, validated against the selection (session id, bound root) | `SCHEMA_INVALID`, client closed, not adopted |
| 5 settle | outcome `ready`, `refused` or `failed`; presence marker written; boot report sent; debug log line | |
| 6 expose | MCP: create the server and start reading stdin; ACP: start the agent | |

Contract: **a protocol reply is the readiness signal.** `initialize` (MCP) or the first ACP reply is answered only after step 5 settled `ready` (ACP: state `active` or `degraded`) or `refused` (MCP only, as today: the tools are listed, every call is refused and the refusal code is on stderr). `realm mcp` exposes its tools for exactly three outcomes: `ready`; `refused`; and `failed` with `daemonAnswered` (the daemon refused `up` but its status could not confirm this root and session, so the driver did not adopt the client: calls are then refused locally with the refusal's code, which is what a model saw before, the daemon's refusal, minus a daemon round trip). Every other `failed` outcome with re-attach off exits 1 before any frame, with the catalogue code and the daemon-log hint on stderr and nothing on stdout (unchanged; this is the pinned "ensure failure exits 1" behavior). With `--reattach`, a retryable `failed` instead exposes the tools and refuses every call through the driver's gate with the last code until a re-attach links or the cap is spent; the process then stays up and the Realm `retry` tool re-attaches once. ACP keeps its stricter rule: it never exposes on anything but `ready`, so after attach settles any state other than `active` or `degraded`, and any `failed` outcome (a daemon-refused `up` included, because ACP attaches with `refusalRetention: "never"`), exits 1 with `upRefusal`'s code and reason or the attach failure text; `--reattach` for ACP applies to link loss after a successful boot only.

Logging at default level stays silent on success (F3); structured `host.boot` lines are emitted at `debug` on success and at `warn` on `refused`, `failed` and link loss (those paths already write stderr). `REALM_LOG_LEVEL=debug` shows the whole sequence. The up notice is written once from `onUp`, not from the readback.

### D-23-05. Bounds, retries and what is not retried

All bounds are `BOOT_BOUNDS` / `resolveBoot` (`src/host/boot.ts:36-71`): startup budget 200 000 ms per attempt, guard status read 5 000 ms, poll 2 000 ms, re-attach off, retry cap 8, equal-jitter backoff from 1 000 ms to 60 000 ms, link lost on `REALM_NOT_ACTIVE` and `TOOL_TIMEOUT`, retry on those two plus `STARTUP_BUDGET_EXCEEDED` and `DAEMON_START_TIMEOUT`. Any other code (`POLICY_DENIED`, `PODMAN_MISSING`, `SCHEMA_INVALID`, a refusal the daemon answered) is terminal and is never retried. The `up` bound the stdio edge passes to `createDaemonAttach` is `CONTROL_TIMEOUT_MS.up` as today (`controlTimeoutOf(deps, "up")`), so the pre-existing timing tests keep their seams.

### D-23-06. Isolation and teardown rules (BOOT-03, BOOT-04)

- **Isolation by construction.** Each host session is its own OS process (stdio hosts) or its own in-process plugin (Omp) holding its own selection-bound client; requests are one-shot dials; a driver arms only timers it created and clears them at shutdown. A host that hangs in `up` holds a per-session lock in the daemon for that session only (`withSessionLock`, `src/daemon/sessions.ts:121`); another project's `up` takes another lock. Hosts of the same project share one admission by design: a slow `up` is slow for both, but a hung host process is not, because the daemon finishes the `up` and discards the reply. The daemon serves each socket concurrently (`serveOne`, `src/daemon/daemon.ts`). Phase 23 adds tests that pin this for the boot path (23-03, Task 4); it adds no shared lock.
- **Teardown.** Stdin EOF, `SIGTERM`, `SIGINT` and `SIGHUP` end an stdio session the same way: `driver.shutdown()` (timers cleared, client closed, no daemon call), marker removed, a best-effort `closed` report bounded at 1 s, then exit (`128 + signal` for a signal; a second signal exits at once). The seam is an injected `CliDeps.signals` (`once` and `exit`, default `process`; the default `exit` does not return, a test's records the code and the runner then resolves with it), so tests raise no real signal. A signal also ends a boot still pending in `up`: the runner races `start()` against the signal. A `SIGKILL` or crash leaves a stale marker, which readers already classify (`readPresence`: pid dead means `stale`) and writers prune (`pruneDead`).
- **No `down`, anywhere in boot.** Not on shutdown, not on a failed boot, not when the last host exits. The daemon and the sandbox outlive every host until `realm down`.
- **A hung dependency never blocks another.** The observer's report and marker writes are bounded and best effort: a presence failure is one catalogue code on diagnostics, a report failure a `debug` line; neither changes an outcome or holds the process (D-23-09).

### D-23-07. The `host-boot` control method (BOOT-06)

`CONTROL_METHODS` gains `"host-boot"`, bounded at 5 000 ms in `CONTROL_TIMEOUT_MS`. Params are exactly `{ report }` and carry no selection (a boot that failed before it had a daemon session still reports); `parseControlSelection` returns `{ selection: null }` for it after an exact-key check (the channel keeps its five-import allowlist, so the closed-vocabulary parse lives in `src/host/boot-report.ts`, called by the daemon). The report is strict and bounded:

| Field | Rule |
| --- | --- |
| `schemaVersion` | exactly `1` |
| `bootId` | `isCorrelationId` (`^[A-Za-z0-9_-]{1,64}$`, `src/observe/ids.ts`), one per process start |
| `hostId` | one of the 19 ids or `"unlabelled"` |
| `transport` | `extension` (only `omp`), `mcp` or `acp` (never `omp`) |
| `phase` | `attached`, `refused`, `failed`, `link-lost`, `reattached`, `closed` |
| `code` | an `ErrorCode`; non-null exactly for `refused`, `failed`, `link-lost`, null otherwise |
| `attempt` | integer 1 to 9 |
| `durationMs` | integer 0 to 600 000 |
| `state` | a `State` or `null` (the readback state) |

No path, session id, daemon text or free string crosses it. Unknown keys, wrong types and prototype keys are `SCHEMA_INVALID`. A token bucket (capacity 60, refill one per second, injectable clock) is taken before the parse; an empty bucket refuses with `POLICY_DENIED` and records nothing (one boot is at most about 30 reports, so the bucket never refuses an honest host). The reply is `{ recorded: true }`; refusals are existing codes through `refusalReply`, and `metrics.recordControl("host-boot", refused)` already counts them (`src/daemon/daemon.ts:749`).

### D-23-08. Daemon-side observability and audit (BOOT-06, BOOT-07)

New `src/daemon/host-boot.ts`, `createHostBootRecorder({ logger, metrics, policy, stateDir, now, audit })`, called from one new `case "host-boot"` in `daemon.ts`. For each accepted report, in this order: metrics, log, audit.

- **Metrics.** `metrics.recordHostBoot(report)`: counter rows `hostBoot: { hostId, transport, phase, code?, count }[]` (at most 256 distinct rows; a report whose key would be the 257th row is still logged and audited but adds no new row) and a `timings.hostBootMs` histogram fed by `durationMs` of `attached`, `refused`, `failed`. Both are optional in `isMetricsSnapshot` (F9) and always emitted by the new daemon. `realm metrics` prints them with no CLI change.
- **Log.** One `logger.info("host.boot", { correlationId: bootId, hostId, transport, phase, attempt, durationMs, state?, code?, capabilitiesDenied? })` per report (`warn` for `refused`, `failed`, `link-lost`). `correlationId` is the boot id, so a host's stderr line and the daemon's line join on it; the daemon's own `up.begin`/`up.end` lines (`src/daemon/daemon.ts` `finishUp`) join on `sessionId` and time (the host does not know the daemon's `upId`, and the `up` wire is not widened).
- **Capability posture.** On `attached` and `refused`, `resolveCapabilities(defaultManifestFor(hostId, version).capabilities, policy)` is computed once per host id and logged as `capabilitiesDenied: ["exec.shell:SHELL_NOT_ALLOWED", ...]`: what the host can ask for under the loaded policy. This is the "daemon boot wiring reads a Policy" the Phase 21 allowlist reason waits for; it reads policy data and enforces nothing.
- **Audit.** For `attached`, `refused` and `failed` only, `appendAudit(stateDir, { sessionId: "host-boot", tool: "host.boot", outcome: code ?? "ok", path: "<hostId>/<transport>/<phase>", correlationId: bootId })`. The existing `AuditEntryInput` fields are reused unchanged (D-42: field names change only by agreement); `path` carries the closed-vocabulary triple, never a filesystem path. The chain is the existing hash chain: `realm audit verify --session host-boot` covers it, and the file inherits 0600, redaction and fsync. A failed append replies `AUDIT_WRITE_FAILED` after the metric and log are recorded and never affects the host. These lines are **self-reported by the host process**: the audit says "a process claiming host X reported phase Y", not that X authenticated.

### D-23-09. The host-side observer (BOOT-08, BOOT-05)

New `src/host/boot-observer.ts`, `createBootObserver({ hostId, transport, bootId, stateDir, socketPath, logger, diagnostics, send, pid, startedAt, sessionId, isAlive? })`, host-neutral, reads no environment. It is the one place that turns "boot events" into the three side effects, so Omp and the stdio hosts cannot diverge:

1. a structured log line through the caller's `Logger` (the stdio edge builds it over `createStderrSink`; Omp's edge over its existing stderr path), event names `host.boot.<phase>`, fields `bootId`, `hostId`, `transport`, `phase`, `attempt`, `durationMs`, `code`, `state`; strings pass the existing redactor;
2. the presence marker (`writePresence` on a settled attach, `removePresence` at `closed`), only when `hostId` is a real host;
3. the report to the daemon through an injected `send` (the CLI's existing `SendControlRequest` seam, default `defaultSend`; `sendRequest` at the Omp edge), bounded at `CONTROL_TIMEOUT_MS["host-boot"]` (1 000 ms for `closed`), at most 8 in flight, never awaited by the boot path.

It never throws, never changes an attach outcome and never delays shutdown by more than the `closed` bound. A presence failure is one catalogue-code line on diagnostics (as `presenceFailure` does today, `src/omp/extension.ts:97`); a log or report failure is a `debug` line only, so a stand-in daemon that does not know the method cannot change an existing test's stderr. A boot that precedes any daemon (daemon never started) has no report in daemon metrics or audit by construction; its trail is the host-side log, the exit code and (for `failed`) no marker. That gap is stated in the docs, not papered over. Why not `host.log`: many host processes would append to one file whose rotation is single-writer by design (`src/observe/log-file.ts`).

The Omp edge adopts it through the plugin's existing `onAttach` and `onSessionEnd` callbacks (no `plugin.ts` change) and reads the plugin's `view()` (state and mode) for the report, which gives `RealmPluginView` its production caller.

### D-23-10. Presence for every host; doctor and status (BOOT-05)

`writePresence`/`readPresence` already key on a host id and are host-neutral (`src/host/presence.ts`); the only generalization is reading: `realm host status <id>` returns `plugin: { sessions }` for any host with live or unreadable markers, not only `extension` hosts (`src/cli/host.ts:255-270`), and the `host-plugins` doctor item appends "live sessions: claude 2, omp 1" (hosts with a nonzero live count, ids and integers only) to its detail whether or not a receipt exists, because a hand-registered `realm mcp --host claude` has markers and no receipt (`src/doctor/host-checks.ts:94-170`). Unreadable markers keep the existing `warn`. The marker means "a process of this host started a boot that settled this way", exactly as the Omp marker does; it is not proof of health (`realm status`) and never triggers an action.

### D-23-11. Allowlist ownership (BOOT-09)

`scripts/check/export-usage-allowlist.json` is edited by exactly one plan, 23-03 Task 5, by running `node scripts/check/export-usage-gate.mjs` and removing each reported STALE line. The nine entries tagged "Phase 23" and the expected outcome:

| Entry | Gains `src` importer from | Expected |
| --- | --- | --- |
| `src/host/boot.ts` `withStartupBudget` | `boot-driver.ts` (23-01) | remove |
| `src/host/boot.ts` `attachFailureDisposition` | `boot-driver.ts` (23-01) | remove |
| `src/host/types.ts` `HostTimers`, `HostStatusSink`, `HostBootDeps`, `HostBootHook` | `boot-driver.ts` (23-01), `stdio-host.ts` (23-03) | remove |
| `src/host/capabilities.ts` `resolveCapabilities` | `src/daemon/host-boot.ts` (23-02) | remove |
| `src/omp/plugin.ts` `RealmPluginView` | `src/omp/extension.ts` (23-03) | remove |
| `src/host/capabilities.ts` `integrationCeiling` | none planned: `isWithinCeiling` is its production caller | keep, reason rewritten ("input of the Phase 26 contract tests; `isWithinCeiling` is the production caller") |

If the gate reports otherwise, the gate wins: every STALE entry is removed, every remaining Phase-21/22 reason that says "production wiring is Phase 23" is rewritten to the real remaining owner or removed, and `recipePending` (Phases 24 and 25) is left alone. New exports that are test-only are not added; a new seam that must be exported for a test is allowlisted with a reason in the same commit. Worker plans do not edit the file mid-flight.

### D-23-12. Conformance

The Phase 21 harness is not amended. 23-01 adds `test/host/boot-driver-conformance.test.ts`: `defineBootConformance("boot driver", bootHookOf(claudeEntry), defaultManifestFor("claude", "1.0.0"))` runs C1 to C9 against the production driver, and the four reference mutants keep failing exactly their cases (`test/host/boot-conformance.test.ts` unchanged). A second suite, `test/host/boot-driver.test.ts`, covers what the harness does not: `call`, the six-tool guard, `outcome()`, observer event order, late-attach closing, signal-free shutdown. Omp stays conformance-tested through the Phase 22 double, unchanged.

### Threat model (summary; each plan carries its STRIDE rows)

**Malicious workload** (code inside the sandbox plus whatever it writes into the workspace: file content, symlinks, directory names, tool arguments). It cannot reach `<stateDir>`, the control socket or the user's host config directories (not mounted: the workspace, state and channel binds are Phase 19's exact set, unchanged here), so it cannot forge a boot report, a marker or an audit line. What it can do, and how each is held:

| Asset | Attack | Hold |
| --- | --- | --- |
| Boot logs, reports, metrics, audit | Put hostile text into a workspace directory name, file or tool output so it reaches a log line, report field, metric key or audit line (injection, secret leakage, cardinality) | Boot telemetry carries only closed-vocabulary fields, a boot id, codes and bounded integers; no path, no session id from the workload, no daemon `reason` text, no `status.notice`; metric rows are a closed key set capped at 256; tests drive a workspace named with newline, quote, ANSI and a secret-looking token and grep every sink |
| Workspace root selection | Swap the workspace directory for a symlink between boot attempts | `selectionOf` runs on every attempt; the daemon pins directory identity at `up` (Phase 18, unchanged); a re-attach after the swap is refused by the existing admission; tested through the driver |
| Boot loop | Crash or wedge the sandbox so every boot refuses, hoping for a retry storm or an auto-`down` that destroys a neighbour's work | Retries are bounded (cap 8, jitter, terminal codes never retried); no code path in boot sends `down`; a failed boot closes only its own client |
| Host config in the workspace | Plant `.mcp.json`, `.claude/`, `.omp/extensions/` so the next host start loads attacker config | Host trust boundary, outside Realm's model (OQ-P5-02 class). Phase 22's recipe installs at user level only; Phase 23 adds no per-project install; the docs state the residual |
| Auto-open of a hostile directory | Open a host in a directory the workload populated | Unchanged `up` admission: outside every policy root is `POLICY_DENIED`; the fail-closed default and the guard are untouched |
| Tool calls during a bad boot | Race tool calls against a half-booted session | Tools are not exposed before settle (D-23-04); after settle, a non-`linked` driver refuses every Realm tool with the code and never forwards to a stale client |

**Hostile host process** (a compromised, buggy or malicious CLI agent or plugin on the user's account; it runs as the user, so it can dial the 0600 control socket, write `<stateDir>`, and run `down` itself; Realm cannot stop same-user code execution and the docs say so). Phase 23's claim is narrower and testable: its boot path gives such a process no new power, and one host's misbehavior cannot corrupt another host's session or the daemon.

| Asset | Attack | Hold |
| --- | --- | --- |
| Daemon availability | Flood `host-boot` reports, or send 1 MiB frames of junk | Token bucket taken before parse (60, 1 per s); 1 MiB line cap and per-socket read timeout already exist (`MAX_CONTROL_LINE_BYTES`, `readControlLine`); refusals are `POLICY_DENIED` or `SCHEMA_INVALID`; a flood test asserts `status` still answers within its bound |
| Metrics and audit integrity | Lie about host, phase or code; fill the boot chain | Reports are advisory and labelled self-reported in every doc; closed vocabulary; at most three phases are audited and each costs a token, so the chain grows at most 60 lines then 1 per second; the daemon is the single audit writer (F7), so the chain cannot fork; `realm audit verify` still passes after a flood test |
| Another host's session | Hang in `up`, hold a socket, exit mid-boot | Per-session lock plus selection-bound one-shot requests; tests with a hung `up` for project A while project B boots and serves; the hung host's teardown makes no `down` request (asserted from `controlRequests`) |
| Identity | Pass `--host claude` from another program, or forge a marker file | Counts only change a doctor sentence; no authorization reads host id or marker (tested by grep: no policy or gate code imports `src/host/presence.ts` or `boot-report.ts`) |
| Resource leak | Leave timers, waits or sockets behind to keep the daemon busy or the process alive | Every driver timer goes through `deps.timers` and is cleared at shutdown (C6); `systemTimers` handles are `unref`ed; a late attach closes its stray client |
| Stdout protocol | Make boot write to stdout and corrupt MCP framing | The stdio runner writes boot output to diagnostics only; a test asserts stdout holds only protocol frames across every boot outcome |

### Verification posture

Offline acceptance is `node:test` from compiled output (`npm run build`, then the named `dist/test/...` files), then `npx eslint .`, `npm run check:gates` (gate-closure, module-size, export-usage), `npm run check:docs`, `npm run check:pack`, `npm run check:mcp`, `node --test "scripts/**/*.test.mjs"`, and `npm run test:coverage` then `node scripts/check/coverage.mjs --write` (the orchestrator owns `scripts/check/coverage-floors.json`). Worker plans run none of these mid-flight; the parent runs them once after the plans land. Nothing offline needs Podman: the end-to-end boot tests use `startRealmDaemon` (`test/support/realm-daemon-fixture.ts`), the real daemon in-process over fakes. The one live check (a real Omp and a real Claude Code 2.x in isolated profiles) is a blocking human-verify task in 23-03; until it passes, docs may say the driver is proven against fakes and a scripted MCP client, and that no real stdio host's boot has been observed.

### Open questions (owner may answer later; each has a default the plans follow)

- **OQ-23-01. Serve-after-boot versus serve-early.** Default (followed): serve-after-boot, because P6-D9 and three pinned tests say so and it is the strictest fail-closed shape. Risk: a cold first boot can exceed a host's MCP start timeout (F11, unmeasured). The live task records what Claude Code does. If it times out, a follow-up phase can answer `initialize` and `tools/list` at once and make calls await boot; `BootDriver.call` already gates on link state, so that change would not touch the driver.
- **OQ-23-02. Boot trail without a daemon.** A boot that never reaches a daemon leaves no daemon-side record. Default: accept and document; the exit code, stderr and the host's own log are the trail. A write-ahead host-side file would reintroduce the multi-writer problem of F7.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` Phases 21 to 26; `.planning/phases/21-host-plugin-contract-and-installer/21-CONTEXT.md`; `.planning/phases/22-omp-plugin-on-boot/22-CONTEXT.md` (deferred: "hook factories wired into daemon boot and a production bootHook"); `.planning/phases/22-omp-plugin-on-boot/22-03-PLAN.md` (plan format, allowlist rule D-22-06).
- `src/host/{boot,types,manifest,capabilities,adapter,runtimes,presence,host-audit,env}.ts`; `src/omp/{extension,plugin}.ts`; `src/cli/{main,host}.ts`; `src/daemon/{channel,client,daemon,ensure,sessions}.ts`; `src/observe/{metrics,logger,ids,log-file}.ts`; `src/audit/{log,redact}.ts`; `src/mcp/server.ts`; `src/acp/agent.ts`; `src/doctor/host-checks.ts`.
- `test/support/{host-boot-conformance,reference-boot-hook,omp-boot-hook,fake-host-daemon,realm-daemon-fixture}.ts`; `test/host/{boot,boot-conformance,manifest,adapter,presence}.test.ts`; `test/cli/{cli,mcp-attach,host}.test.ts`; `test/omp/extension.test.ts`; `test/daemon/{channel,daemon}.test.ts`; `test/observe/metrics.test.ts`; `test/doctor/host-checks.test.ts`.
- `scripts/check/{export-usage-gate,module-size,host-paths,agents-sync,pack-smoke,mcp-smoke}.mjs`, `scripts/check/export-usage-allowlist.json`; `docs/integration/{host-plugin-contract,hosts,omp,mcp,acp}.md`; `AGENTS.md` (layout, metrics line 177, sandbox-lasts rule line 109).
</canonical_refs>

<code_context>
## Existing Code Insights

- The attach sequence of `realm mcp` is: `selectionOf` then `ensureSharedDaemon` (`ensureDaemon` with `reportingStartFailure(daemonAnswers(...))`, `MCP_POLL_INTERVAL_MS` 100) then `deps.connect` then `client.up()`; the daemon notice goes to diagnostics through `writeNotice` once (`src/cli/main.ts:566-617`). `runAcp` differs only after `up`: it computes an `UpLifecycle` and exits 1 on any state but `active` or `degraded` (`:631-640`).
- `launchFilteredDaemon` and `startDetachedDaemon` (`src/cli/main.ts:355-386`) are the only daemon spawn; `src/host` may not import `child_process`, so `createDaemonAttach` takes `spawnDaemon` as a parameter, as `ensureDaemon` takes it.
- `FakeDaemon`, `scriptedAttach` and `FakeTimers` (`test/support/fake-host-daemon.ts`) already model a client, outcomes consumed one per attach and a controllable clock; the new driver tests reuse them.
- The existing CLI fakes build `STATUS = { mode: "advisory" } as DaemonStatus` (`test/cli/mcp-attach.test.ts`, `test/cli/cli.test.ts`). The readback step reads `snapshot`, `sessionId` and `boundRoot`, so those fixtures gain a full `DaemonStatus` and a `status` that answers after the spawn; assertion text and expected values stay as they are. A real `DaemonClient.status()` already validates the shape (`isDaemonStatus`).
- ESLint: `src/host/**` may use `appendAudit` and `withTimeout`, may import `../daemon/{client,channel,ensure}` only, reads no `process.env`; `src/mcp`, `src/acp`, `src/omp` may not name dispatcher internals; `process.env` is read only at `src/cli/main.ts`, `src/daemon/main.ts`, `src/omp/extension.ts`, `src/runtime/driver/main.ts`. The new `src/cli/stdio-host.ts` reads no environment (the entry hands it values).
- `docs/integration/mcp.md` and `acp.md` say nothing about boot sequencing; `host-plugin-contract.md` "Boot-hook port" describes the port and the harness and not a production consumer.
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | Requirements | Depends on |
| --- | --- | --- | --- |
| 1 | 23-01 shared attach, production boot driver, `bootHookOf`, manifest and launch, presence read side | BOOT-01, BOOT-02, BOOT-05 | none (Phase 22 merged) |
| 1 | 23-02 `host-boot` control method, report vocabulary, metrics, daemon log, boot audit chain | BOOT-06, BOOT-07 | none (Phase 22 merged) |
| 2 | 23-03 observer, `realm mcp\|acp` boot sequence and teardown, Omp adoption, isolation tests, docs, allowlist, live rehearsal | BOOT-01, BOOT-03, BOOT-04, BOOT-05, BOOT-08, BOOT-09 | 23-01, 23-02 |

23-01 and 23-02 own disjoint files and can run in parallel (23-01: `src/host/{attach,boot-driver,types,manifest,adapter,presence}.ts`, `src/doctor/host-checks.ts`, `src/cli/host.ts` and their tests; 23-02: `src/host/boot-report.ts`, `src/daemon/{channel,host-boot,daemon}.ts`, `src/observe/metrics.ts` and their tests). 23-03 is the only plan that edits `src/cli/main.ts`, `src/cli/stdio-host.ts`, `src/omp/extension.ts`, `src/host/boot-observer.ts`, docs, `AGENTS.md`, the allowlist and `scripts/check/mcp-smoke.mjs`.

## Requirement IDs

| ID | Statement |
| --- | --- |
| BOOT-01 | `createDaemonAttach` (`src/host/attach.ts`) is the only implementation of ensure daemon, connect, `up` and refusal retention; `src/omp/extension.ts`, `realm mcp` and `realm acp` call it; its three retention modes (`verified`, `always`, `never`) reproduce today's Omp, MCP and ACP behavior with every existing assertion unchanged. |
| BOOT-02 | `createBootDriver` (`src/host/boot-driver.ts`) is the production `HostBootHook` for `mcp-config` hosts: bounds from `resolveBoot`, budget through `withStartupBudget`, retry through `attachFailureDisposition`, bounded re-attach off by default, fail-closed `call` gate, client-only shutdown. It passes harness cases C1 to C9; `bootHookOf` returns it for the 18 `mcp-config` hosts and `null` for `omp`; the four reference mutants still fail exactly their cases. |
| BOOT-03 | `realm mcp\|acp [--host <id>] [--reattach]` runs the numbered boot sequence (resolve, ensure, up, readback, settle, expose); serves nothing before settle; a terminal failure exits 1 with its catalogue code and nothing on stdout; stdin EOF, `SIGTERM`, `SIGINT` and `SIGHUP` close the client, remove the marker and never send `down`; stdout holds only protocol frames in every outcome. |
| BOOT-04 | Per-host failure isolation is proven with a real daemon over fakes: one host's hung `up`, failed boot, teardown or report flood leaves another host's session, the shared sandbox and the daemon answering within their bounds, and no boot path issues `down`. |
| BOOT-05 | MCP and ACP sessions with `--host <id>` write and remove `<stateDir>/hosts/<id>-active/<pid>.json`; `realm host status <id>` and the `host-plugins` doctor item report live and unreadable markers for every host, ids and counts only. |
| BOOT-06 | The `host-boot` control method accepts a strict closed-vocabulary report with no selection, rate-bounded by a token bucket; it feeds `hostBoot` counters and `timings.hostBootMs` in `realm metrics` and one redacted `host.boot` line carrying the boot id in `daemon.log`; a malformed or over-rate report is refused with an existing code and records nothing. |
| BOOT-07 | The daemon alone appends `attached`, `refused` and `failed` reports to the reserved `host-boot` audit chain (closed-vocabulary `path`, boot id as correlation id, no paths or content); `realm audit verify --session host-boot` passes; the capability posture of the reporting host is logged from `resolveCapabilities` over the loaded policy. |
| BOOT-08 | One host-side observer (`createBootObserver`) serves Omp and the stdio hosts: structured redacted log lines carrying the boot id, the presence marker and the report to the daemon, all best effort, none able to change an attach outcome, throw, or delay shutdown past 1 s. |
| BOOT-09 | Docs describe the shipped behavior with evidence tiers and the unproven live boundary; the export-usage allowlist has no stale entry and no entry whose reason still says production wiring is Phase 23; module-size, host-paths, agents-sync, pack-smoke and mcp-smoke gates pass; the live rehearsal is recorded or the plan stays blocked on the named step. |
</specifics>

<deferred>
## Deferred Ideas

- Serve-early with calls awaiting boot (OQ-23-01), after the live rehearsal measures a real host's start timeout.
- Per-host recipes writing `realm mcp --host <id>` into each host's configuration (Phase 24 and 25); registering Realm in any live host configuration (owner approval per host).
- A daemon-side client identity (so "active" could come from the daemon and not a marker), authenticated host reports, a write-ahead host-side boot log, boot metrics export to an external system. None is in the enterprise baseline.
- Moving Omp's plugin onto the driver (D-23-02 records why not now), a stop-the-poll-when-unlinked option in the plugin, and per-project `.omp/extensions` install scope.
- A published conformance package and author docs (Phase 26). Raising the `src/host` coverage floor (the orchestrator runs `node scripts/check/coverage.mjs --write` after the parent test run).
</deferred>
