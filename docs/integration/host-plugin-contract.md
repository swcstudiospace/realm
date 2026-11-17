# Host plugin contract and installer

Phase 21 gives every CLI agent Realm may run in the same contract: a declarative runtime table of 19 hosts, a strict plugin manifest, a capability catalogue that maps each capability to one existing policy fact, a boot-hook port with a conformance harness, an installer engine with three recipe kinds, ownership receipts, and the `realm host` command. This page documents what is built and, as plainly, what is not proven. Code lives in `src/host/`, the command in `src/cli/host.ts`, the doctor item in `src/doctor/host-checks.ts`.

No host is registered live by this repository. On the real table six hosts have an install recipe (`omp`, `claude`, `opencode`, `codex`, `kimi`, `kimi-code`; see "The Omp recipe" and "The Phase 24 recipes"); the other 13 refuse as `recipe-pending` (see "Evidence limits"). Registering Realm in a live host configuration needs explicit owner approval per host, as `docs/integration/hosts.md` already states.

## Direction

The plugin loads into the CLI agent, not the reverse. Omp is the reference implementation: it consumes `src/host/boot.ts` and passes the conformance harness through the Omp host API. `src/omp/extension.ts` reads the environment once at the entry edge, takes its bounds from the omp manifest through `resolveBoot`, builds the daemon attach through the shared `createDaemonAttach` and reports boot through the shared `createBootObserver` (log line, presence marker, host-boot report); `src/omp/plugin.ts` registers the session hooks, the retry command, the five Realm tools, the status paint and the guard; `src/omp/host-tools.ts` holds the fail-closed host-tool removal. The plugin never runs `down`: it closes its own client only, and the sandbox lasts until `realm down`. The contract states those seams once for every host, and `src/omp` holds no copy of a bound, a code list, the sub-state table or the jitter function.

Since Phase 23 both kinds of host boot the same way. Omp loads the plugin in process; the 18 `mcp-config` hosts launch `realm mcp` or `realm acp` with `--host <id>`. Both paths attach through one function and report through one observer, so a host's boot is bounded, fail-closed and observable the same way; see "Boot integration".

A host is one of two integration kinds:

| Kind | How Realm reaches the host | Ceiling |
| --- | --- | --- |
| `extension` | A JavaScript entry the host loads in process (Omp: `dist/src/omp/extension.js`) | every capability |
| `mcp-config` | The host launches `realm mcp` over stdio from its own configuration | `daemon.attach`, `fs.read`, `fs.write`, `fs.list`, `exec.argv`, `exec.shell` |

## Manifest

`parseHostPluginManifest` (`src/host/manifest.ts`) is a hand-written strict parser. Unknown keys, prototype keys and any shape outside the rules below are refused with `SCHEMA_INVALID` and a fixed message; no input text is ever echoed.

| Field | Rule |
| --- | --- |
| `schemaVersion` | exactly `1` |
| `hostId` | one of the 19 ids |
| `integration` | `extension` or `mcp-config` |
| `pluginName` | exactly `realm` |
| `pluginVersion` | semantic version |
| `launch` | `mcp-config` only: `{ command, args }`, a bare command name (`A-Z a-z 0-9 . _ -`), at most 8 arguments of `A-Z a-z 0-9 . _ : = -` up to 64 characters |
| `entry` | `extension` only: a relative path ending `.js`, no `..`, no backslash, at most 256 characters |
| `capabilities` | at most 16, no duplicate (capability, scope) pair, each inside the integration's ceiling |
| `boot` | `extension` only: `startupBudgetMs` 1 to 200000; `reattach` with `enabled`, `retryCap` 0 to 8, `baseDelayMs` (not above `capDelayMs`) and `capDelayMs` up to 60000 |

An `mcp-config` manifest has `launch` and no `entry` or `boot`; an `extension` manifest has `entry` and no `launch`. `defaultManifestFor(id, version)` builds the manifest the installer uses for a host: `realm mcp` as the launch for every `mcp-config` host, and the Omp entry plus every capability for Omp.

## Capabilities

`resolveCapabilities` (`src/host/capabilities.ts`) is pure: a capability is granted when the plugin requests it and the policy admits it. It reads policy data only and is not an enforcement path: every tool call still goes through the dispatcher gates.

| Capability | Policy fact | Denial code | Scope |
| --- | --- | --- | --- |
| `daemon.attach` | none | none | forbidden |
| `fs.read`, `fs.write`, `fs.list` | `workspaceRoots` is not empty | `POLICY_DENIED` | forbidden |
| `exec.argv` | none | none | forbidden |
| `exec.shell` | `shellEnabled` | `SHELL_NOT_ALLOWED` | forbidden |
| `net.egress` | an `egressAllow` rule for the exact `host:port` | `EGRESS_DENIED` | `host:port`, required |
| `credential.read` | the pattern is in `credentialAllow` | `CREDENTIAL_PATH_DENIED` | pattern, required |
| `host.tools.restrict` | `mode` is `fail-closed` | `POLICY_DENIED` | forbidden |

A scope on a capability that forbids one, a missing or malformed scope on one that needs it, or an unparsable `host:port` is `SCHEMA_INVALID`. The catalogue has no new error code: the table reuses the existing 31.

## Boot-hook port

A host plugin of kind `extension` supplies a `HostBootHookFactory` (`src/host/types.ts`): `(deps: HostBootDeps, manifest) => HostBootHook`. The dependencies are `attachDaemon`, `now`, `random`, `timers` and a status `sink`; the hook exposes `start`, `switchWorkspace`, `status`, `guard`, `retry` and `shutdown`. `src/host/boot.ts` holds the shared bounds (`BOOT_BOUNDS`), the single source: the Omp plugin reads them and keeps no copy. `test/host/boot.test.ts` holds the startup budget equal to the `policy.schema.json` default:

| Bound | Default |
| --- | --- |
| startup budget | 200000 ms |
| guard status read | 5000 ms |
| status repaint poll | 2000 ms |
| re-attach | off; cap 8 attempts, equal-jitter backoff from 1000 ms up to 60000 ms |
| link lost on | `REALM_NOT_ACTIVE`, `TOOL_TIMEOUT` |
| attach retried on | `REALM_NOT_ACTIVE`, `TOOL_TIMEOUT`, `STARTUP_BUDGET_EXCEEDED`, `DAEMON_START_TIMEOUT` |

A hook takes every bound from `resolveBoot(manifest)` and never hard-codes one.

To check a new hook, run the conformance harness (`test/support/host-boot-conformance.ts`) against it from a `node:test` file:

```ts
import { defaultManifestFor } from "../../src/host/manifest.js";
import { defineBootConformance } from "../support/host-boot-conformance.js";

defineBootConformance("my host hook", myBootHook, defaultManifestFor("omp", "1.0.0"));
```

`defineBootConformance` registers nine cases against fakes (`test/support/fake-host-daemon.ts`): bounded attach, status readback and paint, refused-up retention, terminal attach failure, the fail-closed guard, client-only shutdown, re-attach off by default, bounded re-attach and workspace switching. `runBootConformance` returns the same results as data. The reference hook and four deliberately broken variants (`test/support/reference-boot-hook.ts`) prove the harness can pass and can fail. The real Omp plugin runs through it, driven through the Omp host API by a test double (`test/support/omp-boot-hook.ts`, `test/omp/boot-conformance.test.ts`). The harness was amended in two stated ways for a host that keeps a live session: while a session is live, a hook may keep one repaint poll armed (so "no timer remains" means no wait armed and at most that one poll), and the startup budget may run on the host's managed timers or on `withStartupBudget`. Every assertion made after shutdown stays strict. Phases 24 and 25 run it against each new host hook.

## Boot integration

Phase 23 wires the boot path end to end. A host's shutdown or failure never takes another host's session, or the sandbox, down: each host is its own process (stdio hosts) or its own in-process plugin (Omp), holds a client bound to its own selection, and arms only timers it created.

**Two paths, shared pieces.** `createDaemonAttach` (`src/host/attach.ts`) is the only implementation of "ensure the daemon answers, connect, run the idempotent `up`, keep or drop the client when `up` is refused". Omp (`src/omp/extension.ts`), `realm mcp` and `realm acp` all call it. The three refusal-retention modes name behavior each entry already had: `verified` keeps the client only when `status` answers and names this root and session (Omp), `always` keeps it (`realm mcp`, which keeps serving and lets the driver's readback decide), `never` closes it and rethrows (`realm acp`). `createBootObserver` (`src/host/boot-observer.ts`) turns the boot events of either path into the same three side effects: one structured log line, the presence marker and the report to the daemon.

**The driver.** `createBootDriver` (`src/host/boot-driver.ts`) is the production `HostBootHook` for the 18 `mcp-config` hosts, and the `{ call }` dispatcher the MCP server and the ACP agent are handed (neither file changed). It takes every bound from `resolveBoot`, runs each attempt (attach plus one status readback, validated against the selection) under `withStartupBudget`, decides retry with `attachFailureDisposition`, keeps re-attach off by default, refuses a Realm tool call while the link is not usable, and on shutdown closes its client and makes no daemon call. `bootHookOf(entry)` returns the driver factory for an `mcp-config` host and `null` for `omp`, by design: Omp keeps its in-process plugin (`src/omp/plugin.ts`), a conformance-tested session state machine with a status item, a host tool set to reconcile and an event pipeline. Moving it onto the driver would rewrite a 993-line module whose behavior its tests pin, to share logic that is already shared where it matters (bounds, code lists, the sub-state table and jitter in `src/host/boot.ts`, the attach, the observer and presence). The driver passes the conformance harness cases C1 to C9 (`test/host/boot-driver-conformance.test.ts`).

**The sequence.** `realm mcp|acp [--workspace <absolute path>] [--host <id>] [--reattach]` runs `runStdioHost` (`src/cli/stdio-host.ts`):

| Step | Action | Failure |
| --- | --- | --- |
| 1 resolve | parse flags, the host's manifest and `resolveBoot` (or the defaults for a session with no `--host`), a new boot id, the observer | usage error, exit 2, nothing started |
| 2 ensure | probe the control socket, spawn the detached daemon at most once, poll to the `up` bound | `DAEMON_START_TIMEOUT` or the daemon's own start-failure code |
| 3 up | connect for this selection, run the idempotent `up` | refusal handled per the retention mode |
| 4 readback | one `status` read, validated against the selection (session id, bound root) | `SCHEMA_INVALID`, client closed, not adopted |
| 5 settle | outcome `ready`, `refused` or `failed`; marker written, report sent, log line written | |
| 6 expose | MCP creates its server and reads stdin; ACP starts its agent | |

Nothing reads stdin before step 5 settles, and the runner writes nothing to stdout: boot text goes to diagnostics, so stdout holds protocol frames only in every outcome.

**Readiness contract.** A protocol reply is the readiness signal: `initialize` (MCP) or the first ACP reply is answered only after the boot settled. `realm mcp` exposes its tools for exactly three outcomes: `ready`; `refused` (the refusal is written to stderr and every call is refused); and `failed` where the daemon itself refused `up` but its status could not confirm this root and session (calls are refused locally, never forwarded). Every other `failed` outcome with re-attach off exits 1 before any frame, with the catalogue code and the daemon-log hint on stderr and nothing on stdout. With `--reattach`, a retryable `failed` instead exposes the tools and refuses every call through the driver's gate with the last code until a re-attach links; the Realm `retry` tool re-attaches once. `realm acp` exposes only on `ready` with the state `active` or `degraded`: any other state exits 1 with the up refusal's `code: reason`, and any `failed` exits 1 with the attach failure text; `--reattach` applies to link loss after a successful boot only. A stdin end with a `RealmError` from the server exits 1; a clean end exits 0.

**Flags.** `--workspace`, `--host` and `--reattach` may come in any order, each at most once, on `realm mcp` and `realm acp` only; `up`, `down`, `status`, `metrics` and `doctor` keep `--workspace` only. `--host` takes a canonical id of an `mcp-config` host: an alias, a differently cased name, an unknown id and `omp` are the usage error (exit 2). A session started with no `--host` (every adapter bundle and snippet shipped today) reports as `unlabelled`: it gets the same boot, a report and a log line, and no presence marker. No environment variable is added; the flags are visible in the host's configuration.

**Teardown.** Stdin EOF, `SIGTERM`, `SIGINT` and `SIGHUP` end a session the same way: timers cleared, client closed, marker removed, a closing report bounded at 1 s, then exit (`128 + signal` for a signal: 143, 130, 129; a second signal exits at once). A signal also ends a boot still pending in `up`. No boot path sends `down`, on shutdown or on a failed boot or when the last host exits: the sandbox lasts until `realm down` (`test/host/boot-no-down.test.ts` pins that no boot-path source names the method). A `SIGKILL` or a crash leaves a stale marker, which readers classify as stale and the next write prunes.

**Observability.**

| Surface | What it carries | Where |
| --- | --- | --- |
| Host log line | `host.boot.<phase>` with `correlationId` (the boot id), `hostId`, `transport`, `phase`, `attempt`, `durationMs`, and `code` and `state` when set; `debug` for `attached`, `reattached`, `closed`, `warn` for `refused`, `failed`, `link-lost` | stderr, through the structured logger; the level is `REALM_LOG_LEVEL` when set and `error` when it is not, so a default session writes nothing it did not write before and `REALM_LOG_LEVEL=debug` shows the whole sequence |
| Presence marker | `<stateDir>/hosts/<id>-active/<pid>.json`, written at settle, removed at `closed`; one catalogue-code line on stderr if it cannot be written | every labelled session, read by `realm host status <id>` and the `host-plugins` doctor item (ids and counts only) |
| `host-boot` control method | one strict report `{ schemaVersion, bootId, hostId, transport, phase, code, attempt, durationMs, state }`, no path, session id or daemon text; at most 8 in flight, 5 s each (1 s for `closed`), never awaited by the boot | the daemon |
| Daemon counters | `hostBoot` rows `{ hostId, transport, phase, code?, count }` (at most 256 distinct rows) and `timings.hostBootMs` (the `durationMs` of `attached`, `refused` and `failed`) | `realm metrics` |
| Daemon log line | one `host.boot` line per accepted report with the same `correlationId`; `warn` when a code is set; the capability posture (`capabilitiesDenied`) of the reporting host on `attached` and `refused` | `daemon.log` |
| Boot audit chain | `attached`, `refused` and `failed` reports as `host.boot` lines of the reserved `host-boot` session, `path` the closed triple `<hostId>/<transport>/<phase>`, the daemon the only writer | `<stateDir>/audit/host-boot.jsonl`; `realm audit verify --session host-boot` |

The daemon refuses a report with `SCHEMA_INVALID` when it is outside the vocabulary and with `POLICY_DENIED` when a token bucket (60, one more per second) is empty, and records nothing. The Omp edge reports through the plugin's `onAttach` and `onSessionEnd` callbacks and reads `plugin.view()` for the state; its `hostId` is `omp` and its `transport` is `extension`.

**Evidence tiers.** What is proven, and against what:

| Tier | What it proves | Evidence |
| --- | --- | --- |
| Fakes | the driver and its guard (conformance cases C1 to C9), the shared attach, the observer's three side effects, the numbered sequence, flags, exit codes and signals of `realm mcp|acp`, Omp on the shared attach and observer | `test/host/`, `test/cli/stdio-host.test.ts`, `test/cli/mcp-attach.test.ts`, `test/cli/cli.test.ts`, `test/omp/extension.test.ts` |
| Real daemon over fakes | a hung `up`, a failed boot, a signal teardown or a report flood leaves another host's session, the shared sandbox and the daemon answering within their bounds; no `down` row in `controlRequests`; a hostile directory name reaches no sink | `test/integration/host-boot-isolation.test.ts`, `test/daemon/host-boot-control.test.ts` |
| Scripted-client smoke | a built `realm mcp --host claude` writes its marker before the first reply and removes it at exit | `scripts/check/mcp-smoke.mjs` (`npm run check:mcp`) |
| Live rehearsal | a real Claude Code 2.x and a real Omp 18.x boot through this path in isolated profiles; how long a real host waits for a cold first boot | not run: it needs explicit owner approval, isolated profiles and (optionally) the Podman stack |

Residuals, accepted and documented:

- Reports are self-reported and advisory: the boot audit says "a process claiming host X reported phase Y", not that X authenticated. A same-user process can dial the control socket, forge a marker or run `down` itself.
- A boot that never reaches a daemon leaves no daemon-side record; its trail is the host log line, the exit code and stderr.
- The driver cannot restrict a host's own built-in tools: `host.tools.restrict` is outside the `mcp-config` ceiling.
- Serve-after-boot can exceed a host's connect timeout on a cold first boot (up to the 230 s `up` bound before `initialize` is answered). No real host's timeout is measured; this is open question OQ-23-01, and serve-early with calls awaiting boot is the follow-up if a real host gives up first.
- A `realm metrics` client older than an upgraded daemon fails on the snapshot's new `hostBoot` keys until `realm down` restarts the daemon on the new build.
- A workload-planted project-level host configuration (`.mcp.json`, `.omp/extensions/`) is outside Realm's model: Realm installs at user level only.
- The client of an `up` that never settles is not reachable by the driver, so it is not closed on teardown; the process exits and the sandbox is unaffected.

## Install recipes

A runtime table entry carries an optional `recipe`. The engine (`src/host/install.ts`, planning in `src/host/recipe.ts`) supports four kinds. In all four, Realm changes only what a receipt entry owns: a value, marker block, table or file that is not owned and differs from what Realm would write is refused, never overwritten.

| Kind | What Realm writes | Ownership | Drift rule |
| --- | --- | --- | --- |
| `json-merge` | one value at a key path in a JSON file, keeping every other key, the indent, the line ending and the trailing newline | the canonical value at the key path, and any parent object Realm created | a changed owned value is drift; an edit elsewhere in the file is not |
| `text-block` | a block between `# BEGIN realm host-plugin` and `# END realm host-plugin` in a text file | the text between the markers, and the separator newline Realm added | a changed block is drift; text outside the markers is not |
| `toml-table` | one TOML table in a TOML file, no marker: the header line and its key lines, appended at the end after one blank line (below) | the text of that table, located by its exact header (`src/host/toml-owned.ts`, `src/host/toml-table.ts`), and the blank separator line Realm added | a changed table is drift, an absent table is `missing`; text outside the table is not |
| `bundle-copy` | the files of a shipped `adapters/<source>` directory under a destination in the host home | every copied file, whole, and every directory Realm created | any changed or missing copied file is drift |

An install on an absent file creates it; an uninstall restores the exact bytes the file had before (or removes a file Realm created, and the directories it created once they are empty). A second install with nothing to change is a noop. JSON with comments, a file larger than 1 MiB, invalid UTF-8, a symlink anywhere below the config home, an unsafe path segment and a file that changed while the operation ran are all refused.

A `toml-table` recipe names the table as a path of at most six bare key segments (Codex: `mcp_servers.realm`) and its text: the header line and its key lines, no comment, no blank line. No marker is written, because a TOML editor may drop or keep a comment line at will (see the Codex row under "Evidence limits"). The table is located by its exact header line on a line of its own, through its last key line; comment and blank lines after that belong to what follows. Install: the table absent is appended (after one blank line when the file is not empty and does not end in one; a CRLF file keeps CRLF); present with exactly the owned text and owned by the receipt is a noop; present with other text is `foreign-content`, as is the owned text with no receipt (Realm does not claim a table it did not write). Before any install, `src/host/toml-table.ts` scans the whole file and the install is refused as `foreign-content`, with nothing written, if the table or an ancestor key is also defined anywhere else: a second header, a header in another spelling (`[ mcp_servers . realm ]`, `[mcp_servers."realm"]`, `[mcp_servers.realm.env]`, `[[mcp_servers.realm]]`, a header with a trailing comment or indent), a `realm = ...` or `realm.command = ...` line inside `[mcp_servers]`, or a top-level dotted key starting with `mcp_servers`. A header or key the scanner cannot read is `unparseable`. The scanner is a line scanner, never a TOML parser, and it is conservative in one direction only: a look-alike inside a multi-line string is a false positive (refused), but a bare `["x"]` line inside a multi-line array in `[mcp_servers]` can hide a real definition from it (residual R-24-03). Status: the table equal to the receipt's hash is `ok`, absent is `missing`, anything else `drifted`. Uninstall: the table (and the blank separator line Realm added) is removed only when its hash equals the receipt's; a changed table is `drifted` and nothing is written; a table that is already gone is a noop that deletes the receipt. Everything else in the file stays byte for byte.

Refusals are catalogue errors with one of eleven fixed reasons. The reason id and its fixed text go to stderr; the code goes to stdout.

| Reason | Code | Meaning |
| --- | --- | --- |
| `recipe-pending` | `POLICY_DENIED` | no install recipe exists for this host yet |
| `not-detected` | `POLICY_DENIED` | the host was not detected (skipped when `--config-home` names it) |
| `foreign-content` | `POLICY_DENIED` | content Realm does not own is in the way |
| `drifted` | `POLICY_DENIED` | content Realm owns was changed after it was written |
| `config-home-missing` | `POLICY_DENIED` | the config home does not exist (Realm never creates one) |
| `symlink` | `PATH_ESCAPE` | a symlink lies on the path; when the symlink is a directory component the text adds `use --config-home <real path>`, and for a symlinked file it adds no hint |
| `unparseable` | `SCHEMA_INVALID` | a host file cannot be parsed safely |
| `concurrent-change` | `WRITE_NOT_ATOMIC` | a host file or receipt changed while the operation ran |
| `extension-unbuilt` | `POLICY_DENIED` | the extension entry the shim imports is not built (`npm run build`); nothing is written |
| `already-loaded` | `POLICY_DENIED` | the host already loads Realm through a plugin link (table `conflicts`), so installing would register it twice |
| `unsupported-path` | `POLICY_DENIED` | the package path holds a backslash that Node cannot import from a shim |

### The Omp recipe

`omp` is the one host whose recipe is a `bundle-copy`. It copies the shipped `adapters/omp` directory into `<agent dir>/extensions/realm/`, where the agent dir is `~/.omp/agent` or the `PI_CODING_AGENT_DIR` override. The shim is one file; at install the single token `@realm:extension-url@` is replaced with the file URL of the built entry (`dist/src/omp/extension.js`) as a JSON string literal, so the receipt hashes the expanded bytes and drift detection, an idempotent reinstall and an uninstall of only what Realm owns work unchanged. The table's `conflicts` field names `.omp/plugins/node_modules/agent-realm` (a plugin link, relative to the user home); when it exists, install refuses as `already-loaded`. Uninstall is never blocked by `extension-unbuilt` or `already-loaded`.

### The Phase 24 recipes

Phase 24 gives `claude`, `opencode`, `codex`, `kimi` and `kimi-code` a recipe. Each registers the bare command `realm` with `mcp --host <id>` (the arguments of `defaultManifestFor(id).launch`; a test holds the two equal) in the host's user-level MCP file, never an absolute path and never project-level configuration. Per-host detail, the manual equivalent and the evidence reached are in the snippets under `docs/hosts/snippets/` (`claude-code.md`, `opencode.md`, `codex.md`, `kimi.md`).

| Host | File | Location (override) | Primitive | Entry | Host validator |
| --- | --- | --- | --- | --- | --- |
| `claude` | `.claude.json` | `~/.claude.json`, a sibling of `~/.claude` (`CLAUDE_CONFIG_DIR` moves it with the directory) | `json-merge` | `mcpServers.realm` = `{type: "stdio", command: "realm", args: ["mcp", "--host", "claude"], env: {}}`, the bytes `claude mcp add --scope user` writes | `claude mcp get realm` (launches the entry) |
| `opencode` | `opencode.json` | `~/.config/opencode/` (`XDG_CONFIG_HOME` is a base: `$XDG_CONFIG_HOME/opencode/`) | `json-merge` | `mcp.realm` = `{type: "local", command: ["realm", "mcp", "--host", "opencode"]}`, the V1 shape (see the snippet) | `opencode mcp list` (launches the entry) |
| `codex` | `config.toml` | `~/.codex/` (`CODEX_HOME`) | `toml-table` | the table `[mcp_servers.realm]` with `command` and `args`, owned by its header, no marker | `codex mcp get realm`, `codex mcp list` (parse only; neither launches) |
| `kimi` | `mcp.json` | `~/.kimi/` (`KIMI_SHARE_DIR`) | `json-merge` | `mcpServers.realm` = `{command: "realm", args: ["mcp", "--host", "kimi"]}` | `kimi mcp test realm` (a functional Kimi CLI only) |
| `kimi-code` | `mcp.json` | `~/.kimi-code/` (`KIMI_CODE_HOME`) | `json-merge` | the same, with `--host kimi-code` | none documented |

**Home roles.** A home spec has a role: `config` (the host's configuration directory, a detection home), `skills` (a skills directory, a detection home) or `mcp` (the directory that holds the host's user-level MCP file when that is not its config home; never a detection home). `claude` has both a `config` home (`~/.claude`) and an `mcp` home (the user's home itself), and its recipe names `homeRole: "mcp"`. An absolute `envOverride` value replaces the path of every `config` and `mcp` home and never a `skills` home (`KIMI_SHARE_DIR` moves Kimi CLI's config home and leaves `~/.config/agents`). `envBase` (OpenCode: `XDG_CONFIG_HOME`, subdirectory `opencode`) replaces the `config` homes with the absolute value joined to the subdirectory; an entry has an override or a base, never both. An empty or relative value is `SCHEMA_INVALID`. `--config-home <abs>` for a host whose recipe has `homeRole: "mcp"` names the directory that holds the file (for `claude`, the user's home or `CLAUDE_CONFIG_DIR`), not `~/.claude`.

**Kimi.** `--kimi` and the id `kimi` are Kimi CLI (Python, `~/.kimi`); `--kimi-code` and `kimi-code` are Kimi Code (Node, `~/.kimi-code`), per the GSD Core installer source at commit `69d604e`. The command name `kimi` is shared by both, so neither row detects by binary. Kimi CLI is archived upstream and its last PyPI release is an inert stub; Kimi Code is the maintained successor. The `kimi` row keeps its `proven` tier by the owner's roadmap while its evidence is T1 only; the `kimi-code` row, added by decision D-24-05, stays `config-only`. Keeping, dropping or promoting it is an owner decision (OQ-24-01).

**Status.** `realm host status` reports each entry as `ok`, `drifted`, `missing` or `unreadable`, and for an installed `mcp-config` host `launch` (see "Commands"). The remover of a host's own CLI interacts with the recipe differently per primitive: `claude mcp remove realm -s user` deletes the key, so the entry reads `drifted` and `realm host uninstall claude` is a clean no-op; `codex mcp remove realm` removes the owned table, so the entry reads `missing` and `realm host uninstall codex` is a clean no-op that deletes the receipt; `codex mcp add other` leaves the owned table byte-identical, so the entry stays `ok` (observed with codex-cli 0.154.0, 2026-11-17: Codex rewrites `config.toml` with a comment-dropping TOML editor, which dropped a `# BEGIN` marker line and left the `# END` line, so the first Codex recipe's markers could not be an ownership mechanism and the recipe owns the table by its header instead; see the Codex row under "Evidence limits").

### Presence

`src/host/presence.ts` is host-neutral. A plugin that has settled an attach writes `<stateDir>/hosts/<id>-active/<pid>.json` (mode 0600, directory 0700, atomic, at most 4096 bytes: `schemaVersion`, `pid`, `startedAt`, `sessionId`, `attach` of `attached` or `failed`, and a catalogue `code` or null) and removes it when its session ends. Doctor and `realm host status` count the markers whose process is alive (`process.kill(pid, 0)`); they read at most 64 names, parse each strictly, and count a symlink, directory, oversized or malformed file as unreadable. A marker means "a process of this host loaded the plugin and its last attach ended this way". It is not proof that the sandbox is healthy (that is `realm status`), it is not containment, and it never triggers an action. A write failure never changes an attach outcome; the extension reports it as one stderr line holding only a catalogue code.

Since Phase 23 one module writes the marker for every host: `createBootObserver` (`src/host/boot-observer.ts`) writes it for Omp (`omp-active`) and for every `realm mcp|acp --host <id>` session (`<id>-active`), with the writer above unchanged; a session with no `--host` writes none. A marker written for a stdio host means the same thing: a process serving that host settled its boot this way. `realm host status <id>` and the `host-plugins` doctor item report live and unreadable markers for every host, ids and counts only, whether or not a receipt exists.

## Receipts, audit and log

- **Receipt:** `<stateDir>/hosts/<id>.receipt.json`, directory mode 0700, file mode 0600, written atomically. It holds the recipe kind, the config home, a `pending` or `installed` state, and per entry a relative path and hashes and creation flags. It never holds file content or a value read from a host configuration. A `pending` receipt left by a crash is what the next install resumes and what `status` and the doctor report as drift.
- **Audit chain:** every applied install or uninstall adds two lines (an `admission` before any change and a `result` after) to `<stateDir>/audit/host-plugins.jsonl`, on the existing hash chain under the reserved session id `host-plugins`. A line carries the tool (`host.install` or `host.uninstall`), the config home, a byte count, hashes and a correlation id, never content. `realm audit verify` covers the file; a dry run, a noop and a refusal at the planning stage add nothing. If the admission line cannot be written, nothing is changed.
- **Log:** `<stateDir>/host.log` (beside `daemon.log` and `requests.log`), mode 0600, rotated by the same file sink. Events are `host.<install|uninstall>.plan`, `.applied`, `.refused` and `.audit_failed`; the level comes from `REALM_LOG_LEVEL`; lines are redacted and structured. When the file cannot take a line, `realm host` writes it to stderr instead.

## Commands

`realm host` never needs a running daemon and spawns no process. A host is a bare id or an alias (`devin-desktop` is `windsurf`); installer flags such as `--claude` are not accepted, and `gemini` and `vscode` are unknown hosts.

Exit codes: 0 success (one JSON line on stdout); 1 a catalogue refusal (the code on stdout, `realm host <subcommand>: <reason>` on stderr); 2 a usage error (stdout empty, stderr the usage line and, for an unknown host, the name only when it matches `^[A-Za-z0-9._-]{1,32}$`, else `<invalid>`).

| Command | What it does | Needs |
| --- | --- | --- |
| `realm host list` | the 19 hosts: `id`, `flag`, `aliases`, `tier`, `integration`, `homeVerified`, `recipe` (`pending` or `ready`) | nothing |
| `realm host detect [<host>]` | `id`, `detected`, `homes` (path and whether it exists; `config` and `skills` homes only) and the `binary` found on an absolute `PATH` directory; honors each host's override variable (`CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `CODEX_HOME`, `KIMI_SHARE_DIR`, `KIMI_CODE_HOME`, `PI_CODING_AGENT_DIR`) | `HOME` |
| `realm host status [<host>]` | `id`, `status` and per owned entry its state (`ok`; `drifted`: the file parses and the owned part differs or is absent; `missing`: the file is gone; `unreadable`: a symlink, a file over 1 MiB, invalid UTF-8, content that does not parse, or a lone Realm marker); `status` is `not-detected`, `detected`, `recipe-pending`, `installed` or `drifted` (`installed` only when every entry is `ok`). A host with a receipt adds `launch`: `on-path` or `not-on-path`, whether the command the recipe registers resolves as an executable file in an absolute directory of the `PATH` of the `realm host status` process only (not the host's own `PATH`; nothing is spawned). The `omp` row adds `plugin`: `target` (`present`, `missing`, `unreadable` or `null` with no receipt), `sessions` (`live`, `stale`, `unreadable` marker counts) and `conflicts` (the table's plugin-link paths, relative to the home, that exist) | `HOME`, the state directory |
| `realm host install <host> [--dry-run] [--config-home <abs>]` | install the recipe, or plan it with `--dry-run` | `HOME`, the state directory |
| `realm host uninstall <host> [--dry-run] [--config-home <abs>]` | remove exactly what the receipt owns, or plan it | `HOME`, the state directory |

The state directory comes from the runtime config the way `realm audit` finds it; without a valid config, `status`, `install` and `uninstall` exit 1 with `realm host <subcommand>: cannot resolve a state directory (run realm init)`. `--config-home` must be an absolute path; it names the host explicitly, so detection is skipped, and it is still checked (it must exist and is resolved with a symlink walk).

Paths below are shown with `~` for the home directory; the command prints absolute paths.

```console
$ realm host list
[{"id":"omp","flag":"--omp","aliases":[],"tier":"reference","integration":"extension","homeVerified":true,"recipe":"ready"},…]

$ realm host detect claude
{"id":"claude","detected":true,"homes":[{"path":"~/.claude","exists":true}],"binary":"claude"}

$ realm host status cursor
{"id":"cursor","status":"recipe-pending","entries":[]}

$ realm host install cursor --dry-run 2>&1 >/dev/null
realm host install: recipe-pending: no install recipe exists for this host yet
$ realm host install cursor --dry-run 2>/dev/null; echo "exit $?"
POLICY_DENIED
exit 1

$ realm host uninstall cursor
{"id":"cursor","status":"noop","dryRun":false,"actions":[]}
```

On a host with a recipe (`omp`, `claude`, `opencode`, `codex`, `kimi`, `kimi-code`), `install` and `uninstall` print `{ id, status, dryRun, actions }`, where `status` is `planned`, `installed`, `noop` or `removed` and each action is `{ path, action, bytes }` with `path` relative to the config home and no content. `realm host status claude` on an installed host prints, for example, `{"id":"claude","status":"installed","entries":[{"path":".claude.json","state":"ok"}],"launch":"on-path"}`.

`realm doctor` adds a `host-plugins` item. It reads receipts, the files a receipt names (for Claude Code a file in the user's home) and presence markers only, never a host binary or the environment: `pass` with no receipt or only intact installs, `warn` for a pending receipt or any drifted entry with the repair command (`realm host install <id>`, or `realm host uninstall <id>` to remove), and `fail`, with the catalogue code and the host id, for a corrupt receipt, a symlinked `hosts` directory or a read that exceeds its bound. A drifted entry that is `unreadable` carries the count in the detail (`..., 1 unreadable`) and a different fix text: the file cannot be read or parsed safely, so inspect it and repair it by hand before running `realm host uninstall <id>`. For an installed `omp` the detail adds whether the extension target exists and the number of live plugin sessions (`installed: omp (extension target present, 1 live plugin session)`); a missing or unreadable target is a `warn` (`host plugin drift: omp: extension target missing`), as is an unreadable presence marker. The detail never holds a path or file content. Doctor does not report `launch`, because it reads no environment.

## The 19 hosts

Source: GSD Core `next`, commit `69d604e`, 2026-11-16, recorded in `.planning/phases/21-host-plugin-contract-and-installer/21-DISCOVERY.md` (package 1.21.0: `src/runtime-name-policy.cts`, `src/runtime-homes.cts`, `docs/how-to/install-on-your-runtime.md`). Gemini is retired upstream and `vscode` is registered but not installable, so neither is in the table. Tier is the project decision carried into Phase 21 and is the roadmap's classification of where end-to-end effort goes, not a statement of evidence: Omp is the reference; Claude Code, OpenCode, Codex and Kimi CLI are the proven tier, with their recipes landed in Phase 24 (and the `kimi-code` row's recipe by decision D-24-05); the rest are config-only. What was proven for each host is stated under "Evidence limits".

| Id | Flag | Tier | Integration | Config home (global) | Recipe |
| --- | --- | --- | --- | --- | --- |
| `omp` | `--omp` | reference | extension | `~/.omp/agent` (`PI_CODING_AGENT_DIR`); the shim goes to `extensions/realm/` | ready |
| `claude` | `--claude` | proven | mcp-config | `~/.claude` (`CLAUDE_CONFIG_DIR`); the entry goes in `~/.claude.json` (`mcp` role: the user's home, or `CLAUDE_CONFIG_DIR`) | ready |
| `opencode` | `--opencode` | proven | mcp-config | `~/.config/opencode` (`XDG_CONFIG_HOME/opencode`) | ready |
| `kilo` | `--kilo` | config-only | mcp-config | `~/.config/kilo` or `~/.kilo` | pending |
| `codex` | `--codex` | proven | mcp-config | `~/.codex` (`CODEX_HOME`) | ready |
| `copilot` | `--copilot` | config-only | mcp-config | `~/.copilot` | pending |
| `antigravity` | `--antigravity` | config-only | mcp-config | none verified | pending |
| `cursor` | `--cursor` | config-only | mcp-config | `~/.cursor` | pending |
| `windsurf` | `--windsurf` (alias `devin-desktop`) | config-only | mcp-config | `~/.codeium/windsurf` | pending |
| `augment` | `--augment` | config-only | mcp-config | `~/.augment` | pending |
| `trae` | `--trae` | config-only | mcp-config | `~/.trae` | pending |
| `qwen` | `--qwen` | config-only | mcp-config | `~/.qwen` | pending |
| `hermes` | `--hermes` | config-only | mcp-config | `~/.hermes` | pending |
| `codebuddy` | `--codebuddy` | config-only | mcp-config | `~/.codebuddy` | pending |
| `cline` | `--cline` | config-only | mcp-config | `~/.cline` | pending |
| `kimi` | `--kimi` | proven | mcp-config | skills `~/.config/agents`, config `~/.kimi` (`KIMI_SHARE_DIR`, config only) | ready |
| `kimi-code` | `--kimi-code` | config-only | mcp-config | `~/.kimi-code` (`KIMI_CODE_HOME`) | ready |
| `zcode` | `--zcode` | config-only | mcp-config | `~/.zcode` | pending |
| `pi` | `--pi` | config-only | mcp-config | `~/.pi/agent` | pending |

## Evidence limits

- The engine and the six recipes are proven on fixtures (tier T1): a temporary HOME, a temporary state directory and, for Omp, a stub extension entry (`test/support/fixture-host.ts`, `test/host/omp-recipe.test.ts`); for the other five, string goldens each tagged with its source and date (`test/support/host-config-goldens.ts`, `test/host/{claude,opencode,codex,kimi}-recipe.test.ts`, `test/cli/host.test.ts`). No real host configuration is read or written by the test suite. The 13 other hosts have no recipe: every real install refuses as `recipe-pending` and changes nothing. Their recipes are Phase 25.
- That a real Omp loads the installed shim, starts the daemon and paints the status item is proven only by the live rehearsal in an isolated profile (`docs/integration/omp.md`, "Installed by `realm host install omp`"); until it is recorded there, the shim is unproven against a real Omp.
- Omp is the only host with live evidence (`docs/integration/hosts.md`). The four adapter bundles under `adapters/` have evidence tier 2 (a host validator or isolated install passes) and are not registered in any live configuration.
- Config homes: Omp's home (`~/.omp/agent`, `PI_CODING_AGENT_DIR`) is verified against `omp --help` and the public extension page. The homes and files of `claude` (`~/.claude.json`, `CLAUDE_CONFIG_DIR`), `codex` (`~/.codex/config.toml`, `CODEX_HOME`) and `opencode` (`XDG_CONFIG_HOME`) were observed on 2026-11-17 by running the host in an isolated HOME (Claude Code 2.1.322, codex-cli 0.154.0, OpenCode 1.19.5 fetched into a scratch directory), and also come from documentation. The homes and entry shapes of `kimi` (`~/.kimi/mcp.json`, `KIMI_SHARE_DIR`) and `kimi-code` (`~/.kimi-code/mcp.json`, `KIMI_CODE_HOME`) come from official documentation only: no Kimi product was observed writing them. The other 13 hosts' homes come from the GSD Core discovery above and were not independently verified on a machine with each host; `antigravity` has no verified home (`homeVerified` is false).
- `detect` is a file-system look at a home directory and at an executable on `PATH`. It runs no host binary, so it cannot tell a working install from a leftover directory.
- The boot path of the 18 `mcp-config` hosts (`realm mcp|acp --host <id>`) is proven against fakes and against a real daemon over fakes, and its marker against a built `realm mcp --host claude` in the smoke. That a real Claude Code or a real Omp boots through it, and how long a real host waits for a cold first boot, is proven only by the live rehearsal, which has not been run (see "Boot integration", "Evidence tiers").

The three evidence tiers of the Phase 24 recipes, per host. T1 is the offline fixture (always runs in CI). T2 is the host's own validator command against what the recipe wrote, in an isolated HOME, with a stub `realm` on `PATH` (gated: `REALM_LIVE_CLAUDE`, `REALM_LIVE_CODEX`, `REALM_LIVE_OPENCODE`, `REALM_LIVE_KIMI`). T3 is a real host health check performing an MCP initialize against the real `realm mcp --host <id>` with a daemon opened for a workspace (gated: `REALM_LIVE_PRODUCTION=1` plus the host variable, Podman 5.x). The gated rehearsal was run by hand on 2026-11-17 for the T2 tier of `claude` and `codex` (results below, evidence kept outside the repository); no other cell has a result: a cell says "not run" until a dated result is written here, and "gap" where the tier cannot be run at all.

| Host | T1 offline fixture | T2 host validator | T3 live end to end |
| --- | --- | --- | --- |
| `claude` | covered; golden observed from Claude Code 2.1.322, 2026-11-17 | ran live, 2026-11-17, Claude Code 2.1.322: 3 of 3 passed, run twice (the second from the merged tree). The real `claude mcp get` and `claude mcp list` parse the file the recipe wrote and launch the registered argv; the host's own add and remove interoperate with the recipe; `CLAUDE_CONFIG_DIR` moves the file | not run: Podman 4.9.3 is below the required 5.x |
| `codex` | covered; golden observed from codex-cli 0.154.0, 2026-11-17 | ran live, 2026-11-17, codex-cli 0.154.0 (`get` and `list` parse only). The first run, against the comment-marker recipe, failed and found the defect: Codex drops a marker comment that is the decor of a table and keeps the table text, `codex mcp add other` left the END marker and `codex mcp remove realm` left an orphan END, so markers are not an ownership mechanism for Codex; ownership is by table header, no markers. After the header-owned recipe merged, a run from the merged tree: 5 passed, 0 failed, 2 skipped (production tiers). `codex mcp get\|list` parse the table; after `codex mcp add other` and `codex mcp remove realm` install, status and uninstall stay consistent (the table stays byte-identical and status `ok` after `add other`; status is `missing` and uninstall a no-op after `remove realm`); after `codex mcp add realm`, install refuses with `foreign-content` | gap: `codex mcp list` does not start servers and a session needs model credentials; not automatable |
| `opencode` | covered; formats from official documentation and an observation of 1.19.5, 2026-11-17 | not run: no `opencode` executable on the verification machine | not run: no executable, and Podman 4.9.3 is below 5.x |
| `kimi` | covered; formats from official documentation, 2026-11-17 | not run: no `kimi` executable, and the only published release is an inert stub | gap: no functional Kimi CLI exists to run |
| `kimi-code` | covered; formats from official documentation, 2026-11-17 | not available: no validator command is documented | gap: not run, none attempted |

Not shown by any tier, for any host: that a long-running session keeps using the entry after its file changes, that a real model turn calls the Realm tools, and that a host's start timeout outlasts a cold first boot of up to 230 s (OQ-24-06; no recipe writes a timeout). Open owner decisions: OQ-24-01 (keep, drop or promote `kimi-code`), OQ-24-02 (OpenCode V1 versus V2 entry shape), OQ-24-03 (hide host-config names from the workspace mount), OQ-24-05 (what Codex does to the markers).

Residual risks, accepted and documented:

- JSON with comments (JSONC) is refused as `unparseable`, not rewritten; TOML is edited only as an owned marker block guarded by a line scanner, never parsed. OpenCode's `opencode.jsonc` is never read or changed.
- A host config home that is a symlink (dotfile managers) is refused; the operator names the real directory with `--config-home`.
- The write phase is synchronous and bounded by file size (1 MiB per file, 256 bundle files), not by a timer; reads are bounded by `TOOL_TIMEOUT`.
- A workload that can write a host config home can edit other settings there as well; Realm detects changes to its own entry only (doctor `warn`, uninstall refusal).
- R-24-01, project-level shadowing: a workload can write a host's project-level configuration in the workspace (`.mcp.json`, `.codex/config.toml`, `opencode.json` and `.opencode/`, `.kimi-code/mcp.json`) naming a server `realm` with a hostile command; the host then launches it outside the sandbox with the user's privileges. Claude Code asks approval, Codex honours project configuration for trusted projects only and Kimi Code asks workspace trust; OpenCode documents no trust gate. Realm writes and reads no project-level configuration and the sandbox mount does not hide these names; the fix, a read-only or hidden overlay, is Phase 19 mount territory and an open owner decision (OQ-24-03).
- R-24-02, the concurrent-writer window: a host (Claude Code rewrites `~/.claude.json` at any time) can write the file between the final hash check and the rename. A change before the check is refused as `concurrent-change`; the window itself cannot be closed without a lock the host does not honour, so install with no host session open.
- R-24-03, the scanner limit: the Codex duplicate-table guard is a line scanner, not a parser (see "Install recipes"); a bare `["x"]` line inside a multi-line array in `[mcp_servers]` can hide a definition, in which case Codex itself rejects the file.
- R-24-04, the Codex editor: Codex rewrites `config.toml` with a comment-dropping TOML editor (observed with 0.154.0, 2026-11-17), so Realm owns one table by its header and writes no marker. A later Codex version that reformats the owned table (quoting, key order) makes the entry `drifted` and uninstall refuses rather than guessing; deleting the table by hand and running `realm host uninstall codex` clears the receipt.
