# Host plugin contract and installer

Phase 21 gives every CLI agent Realm may run in the same contract: a declarative runtime table of 19 hosts, a strict plugin manifest, a capability catalogue that maps each capability to one existing policy fact, a boot-hook port with a conformance harness, an installer engine with five recipe kinds, ownership receipts, and the `realm host` command. This page documents what is built and, as plainly, what is not proven. Code lives in `src/host/`, the command in `src/cli/host.ts`, the doctor item in `src/doctor/host-checks.ts`.

No host is registered live by this repository. On the real table 16 of the 19 hosts have an install recipe (`omp`, `claude`, `opencode`, `codex`, `kimi`, `kimi-code`, and from Phase 25 `cursor`, `copilot`, `qwen`, `augment`, `pi`, `cline`, `antigravity`, `kilo`, `codebuddy`, `hermes`; see "The Omp recipe", "The Phase 24 recipes" and "The Phase 25 recipes"); the other 3 (`windsurf`, `trae`, `zcode`) are owner-approved deferrals that refuse as `recipe-pending` (see "Deferred hosts" and "Evidence limits"). Registering Realm in a live host configuration needs explicit owner approval per host, as `docs/integration/hosts.md` already states.

To add a host, read [Writing a Realm host plugin](writing-a-host-plugin.md); the per-host summary is the [Host support matrix](host-support-matrix.md); what is not proven is tracked in [Host plugin gaps](host-plugin-gaps.md); the production-stack boot status of the five wave 1 hosts is on [Wave 1 boot matrix](wave1-boot-matrix.md).

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

To write a boot hook for a new `extension` host, follow [Step 4: the boot hook](writing-a-host-plugin.md#step-4-the-boot-hook) of Writing a Realm host plugin.

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

**Readiness contract.** A protocol reply is the readiness signal: `initialize` (MCP) or the first ACP reply is answered only after the boot settled. `realm mcp` exposes its tools for exactly three outcomes: `ready`; `refused` (the refusal is written to stderr and every call is refused); and `failed` where the daemon itself refused `up` but its status could not confirm this root and session (calls are refused locally, never forwarded). Every other `failed` outcome with re-attach off exits 1 before any frame, with the catalogue code and the daemon-log hint on stderr and nothing on stdout. With `--reattach`, a retryable `failed` instead exposes the tools and refuses every call through the driver's gate with the last code until a re-attach links; the Realm `retry` tool re-attaches once. `realm acp` exposes only on `ready` with the state `active`: any other state exits 1 with the up refusal's `code: reason`, and any `failed` exits 1 with the attach failure text; `--reattach` applies to link loss after a successful boot only. A stdin end with a `RealmError` from the server exits 1; a clean end exits 0.

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

A runtime table entry carries an optional `recipe`. The engine (`src/host/install.ts`, planning in `src/host/recipe.ts`) supports five kinds. In all five, Realm changes only what a receipt entry owns: a value, marker block, table, entry or file that is not owned and differs from what Realm would write is refused, never overwritten.

| Kind | What Realm writes | Ownership | Drift rule |
| --- | --- | --- | --- |
| `json-merge` | one value at a key path in a JSON file, keeping every other key, the indent, the line ending and the trailing newline | the canonical value at the key path, and any parent object Realm created | a changed owned value is drift; an edit elsewhere in the file is not |
| `text-block` | a block between `# BEGIN realm host-plugin` and `# END realm host-plugin` in a text file | the text between the markers, and the separator newline Realm added | a changed block is drift; text outside the markers is not |
| `toml-table` | one TOML table in a TOML file, no marker: the header line and its key lines, appended at the end after one blank line (below) | the text of that table, located by its exact header (`src/host/toml-owned.ts`, `src/host/toml-table.ts`), and the blank separator line Realm added | a changed table is drift, an absent table is `missing`; text outside the table is not |
| `yaml-map` | one block-style entry `parent.child` in a YAML file, no marker (below) | the entry, located by key identity and compared by its parsed value (`src/host/yaml-scan.ts`, `src/host/yaml-owned.ts`), and the parent key and separator newline Realm added | a changed entry is drift, an absent entry is `missing`; text outside the entry is not |
| `bundle-copy` | the files of a shipped `adapters/<source>` directory under a destination in the host home | every copied file, whole, and every directory Realm created | any changed or missing copied file is drift |

An install on an absent file creates it; an uninstall restores the exact bytes the file had before (or removes a file Realm created, and the directories it created once they are empty). A second install with nothing to change is a noop. JSON with comments, a file larger than 1 MiB, invalid UTF-8, a symlink anywhere below the config home, an unsafe path segment and a file that changed while the operation ran are all refused.

A `toml-table` recipe names the table as a path of at most six bare key segments (Codex: `mcp_servers.realm`) and its text: the header line and its key lines, no comment, no blank line. No marker is written, because a TOML editor may drop or keep a comment line at will (see the Codex row under "Evidence limits"). The table is located by its exact header line on a line of its own, through its last key line; comment and blank lines after that belong to what follows. Install: the table absent is appended (after one blank line when the file is not empty and does not end in one; a CRLF file keeps CRLF); present with exactly the owned text and owned by the receipt is a noop; present with other text is `foreign-content`, as is the owned text with no receipt (Realm does not claim a table it did not write). Before any install, `src/host/toml-table.ts` scans the whole file and the install is refused as `foreign-content`, with nothing written, if the table or an ancestor key is also defined anywhere else: a second header, a header in another spelling (`[ mcp_servers . realm ]`, `[mcp_servers."realm"]`, `[mcp_servers.realm.env]`, `[[mcp_servers.realm]]`, a header with a trailing comment or indent), a `realm = ...` or `realm.command = ...` line inside `[mcp_servers]`, or a top-level dotted key starting with `mcp_servers`. A header or key the scanner cannot read is `unparseable`. The scanner is a line scanner, never a TOML parser, and it is conservative in one direction only: a look-alike inside a multi-line string is a false positive (refused), but a bare `["x"]` line inside a multi-line array in `[mcp_servers]` can hide a real definition from it (residual R-24-03). Status: the table equal to the receipt's hash is `ok`, absent is `missing`, anything else `drifted`. Uninstall: the table (and the blank separator line Realm added) is removed only when its hash equals the receipt's; a changed table is `drifted` and nothing is written; a table that is already gone is a noop that deletes the receipt. Everything else in the file stays byte for byte.

A `yaml-map` recipe (Hermes: `mcp_servers.realm`) names a parent key and a child key (both bare segments, no dots) and a flat value of `command` and `args` written as plain scalars. It exists for the one documented, observed, global YAML host. Ownership is by key identity and parsed value, never by a comment marker: Hermes rewrites its file with a comment-preserving round trip that may re-quote and re-flow the entry, and Codex showed that an editor can drop a marker comment and orphan the other one. A re-quoted or re-flowed entry with the same parsed value is `ok`, a changed value is `drifted` and an absent entry is `missing`. The reader is a conservative line scanner, not a YAML parser, and every doubt is a refusal. `unparseable`: a file over 1 MiB, a NUL, a BOM, a Unicode line break other than LF, a lone CR or mixed line endings, a tab used for indentation, a flow-style root, a document marker (`---` or `...`) or a `%` directive, an anchor, alias or tag token outside a comment, a merge key, a complex key, a quote that does not close and any line it cannot classify. `foreign-content`: a duplicate parent or child, a parent that is not a block mapping (a scalar, a sequence, `null` or `~`, a flow mapping other than exactly `{}`) and a `realm` entry that is not exactly the recipe's value. Install writes block style in the file's own child indent (default 2) and line ending, appends the parent at the end when it is absent and records the separator and any parent it created, so uninstall removes only those lines; everything else stays byte for byte. No new error code and no new refusal reason.

An entry may carry `shadows`: at most four relative paths, each with a base of `home` (below the user's home) or `config` (below the resolved install home). An install that would **create** the recipe file is refused as `foreign-content`, with nothing written and in a dry run too, when any shadow path exists (`lstat`, so a dangling symlink counts); when the recipe file already exists the guard is skipped, and status and uninstall never run it. Why: CodeBuddy reads the first existing of `.mcp.json`, the legacy `mcp.json` and `~/.codebuddy.json`, so a new `.mcp.json` silently hides the servers in a legacy file (observed with CodeBuddy 2.185.0). Only `codebuddy` has `shadows` today. It is separate from `conflicts`, which always refuses and says the host already loads Realm.

Refusals are catalogue errors with one of eleven fixed reasons. The reason id and its fixed text go to stderr; the code goes to stdout.

| Reason | Code | Meaning |
| --- | --- | --- |
| `recipe-pending` | `POLICY_DENIED` | no recipe yet: a deferred host (`windsurf`, `trae`, `zcode`), see "Deferred hosts" |
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

### The Phase 25 recipes

Phase 25 gives ten more hosts a recipe: `cursor`, `copilot`, `qwen`, `augment`, `pi`, `cline`, `antigravity`, `kilo`, `codebuddy` and `hermes`. With the six above, 16 of the 19 hosts have a recipe and 3 are deferred. Each recipe registers the bare `realm` with `mcp --host <id>` (the arguments of `defaultManifestFor(id).launch`; a test holds the two equal) in the host's user-level MCP file, never an absolute path and never project-level configuration, and each value equals the host's own canonical output where that was observed. The host's own override variable is used, not GSD Core's own names (`COPILOT_CONFIG_DIR`, `CURSOR_CONFIG_DIR`, `AUGMENT_CONFIG_DIR`, `KILO_CONFIG_DIR`, `CLINE_CONFIG_DIR` and the like are GSD-only, and the hosts do not read them). Per-host detail, the manual equivalent and the evidence reached are in the snippets under `docs/hosts/snippets/` (`cursor.md`, `copilot.md`, `qwen.md`, `augment.md`, `pi.md`, `cline.md`, `antigravity.md`, `kilo.md`, `codebuddy.md`, `hermes-agent.md`); the deferrals are in `docs/hosts/snippets/deferred-hosts.md`.

The ship rule: a host gets a recipe only if its official documentation names the file and the entry shape, **and** the shape was observed on a running host or at least two official pages agree and the file is MCP-only plain JSON. A host is deferred when that fails, when the product is renamed in a way that makes the target ambiguous, or when the file is the native config of a GUI-owned application that cannot be observed here. Decisions, one row per host (entry tier: observed means the host was run in an isolated home; documented means official pages only):

| Host | Decision | File | Location (override) | Primitive | Entry | Host validator | Entry tier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cursor` | ship | `mcp.json` | `~/.cursor/` (none honoured) | `json-merge` | `mcpServers.realm` = `{type: "stdio", command: "realm", args: ["mcp", "--host", "cursor"]}` | `agent mcp list` (interactive; launches) | documented; spawn observed |
| `copilot` | ship | `mcp-config.json` | `~/.copilot/` (`COPILOT_HOME`) | `json-merge` | `mcpServers.realm` = `{tools: ["*"], type: "local", command: "realm", args: ["mcp", "--host", "copilot"]}` | `copilot mcp get realm`, `copilot mcp list` (parse only) | observed (1.0.112) |
| `qwen` | ship | `settings.json` | `~/.qwen/` (`QWEN_HOME`) | `json-merge` | `mcpServers.realm` = `{command: "realm", args: ["mcp", "--host", "qwen"]}` | `qwen mcp list` (launches) | observed (0.22.0) |
| `augment` | ship | `settings.json` | `~/.augment/` (`AUGMENT_CACHE_DIR`) | `json-merge` | `mcpServers.realm` = `{type: "stdio", command: "realm", args: ["mcp", "--host", "augment"]}` | `auggie mcp list` (parse only, about 40 s) | observed (1.2.1) |
| `pi` | ship, pi 1.3 and later only | `mcp.json` | `~/.pi/agent/` (`PI_CODING_AGENT_DIR`, shared with `omp`) | `json-merge` | `mcpServers.realm` = `{command: "realm", args: ["mcp", "--host", "pi"]}` | `pi mcp list` (launches; pi 1.3 and later) | observed (1.5.2) |
| `cline` | ship, Cline CLI only | `data/settings/cline_mcp_settings.json` | `~/.cline/` (`CLINE_DIR`) | `json-merge` | `mcpServers.realm` = `{command: "realm", args: ["mcp", "--host", "cline"]}` (the documented flat shape) | `cline config mcp --json` (parse only) | documented; the flat shape parses (3.0.74) |
| `antigravity` | ship, documented-only | `mcp_config.json` | `~/.gemini/config/` (none) | `json-merge` | `mcpServers.realm` = `{command: "realm", args: ["mcp", "--host", "antigravity"]}` (no `type`) | none observed | documented (three Google pages; never run) |
| `kilo` | ship | `kilo.json` | `~/.config/kilo/` (`XDG_CONFIG_HOME` is a base: `$XDG_CONFIG_HOME/kilo/`; `~/.kilo` detection only) | `json-merge` | `mcp.realm` = `{type: "local", command: ["realm", "mcp", "--host", "kilo"]}` | `kilo mcp list` (launches) | observed (7.8.27) |
| `codebuddy` | ship, with `shadows` | `.mcp.json` | `~/.codebuddy/` (`CODEBUDDY_CONFIG_DIR`, the directory that holds `.mcp.json`) | `json-merge` | `mcpServers.realm` = `{type: "stdio", command: "realm", args: ["mcp", "--host", "codebuddy"]}`; install refuses when a legacy file would be hidden | `codebuddy mcp list`, `codebuddy mcp get realm` (launch, 30 to 45 s) | observed (2.185.0) |
| `hermes` | ship | `config.yaml` | `~/.hermes/` (`HERMES_HOME`) | `yaml-map` | `mcp_servers.realm` = `{command: realm, args: [mcp, --host, hermes]}` | `hermes mcp list` (parse), `hermes mcp test realm` (launches) | observed through the host's own writer functions (v0.23.2); the CLI was not run |
| `windsurf` | **defer** (OQ-25-01) | none | `~/.codeium/windsurf` (detection) | none | none | n/a | renamed product, two files, IDE unobserved |
| `trae` | **defer** (OQ-25-02) | none | `~/.trae` (detection) | none | none | n/a | no documented global file |
| `zcode` | **defer** (OQ-25-03) | none | `~/.zcode` (detection) | none | none | n/a | GUI-owned native config, unobservable |

The engine shape per family:

| Family | Primitive | Hosts | Why |
| --- | --- | --- | --- |
| JSON, key path `mcpServers.realm` | `json-merge` | `cursor`, `copilot`, `qwen`, `augment`, `pi`, `cline`, `antigravity`, `codebuddy` | each documents a JSON file with a top-level `mcpServers` map; the existing engine owns the entry by value |
| JSON, key path `mcp.realm` (OpenCode lineage) | `json-merge` | `kilo` | `kilo.json`, key `mcp`, an array `command` |
| YAML, path `mcp_servers.realm` | `yaml-map` | `hermes` | the only YAML host that is documented, observed and global |
| TOML | `toml-table` (exists) | none | the only TOML candidate (TRAE CLI 2.0) is third-party evidence and deferred |
| none | no recipe | `windsurf`, `trae`, `zcode` | the deferrals above |

No Phase 25 recipe uses a comment marker: Copilot, Qwen and CodeBuddy are observed dropping comments from the JSON file they rewrite, Kilo and Hermes reformatting the entry or adding keys, and Codex dropped one marker comment from its TOML file and orphaned the other. Ownership is by key (JSON, YAML) or table (TOML), and the recipe values equal each host's own canonical form, so a host's rewrite (Copilot adding `tools`, Qwen migrating its settings, Kilo adding `$schema` and `permission`, CodeBuddy adding `disabledMcpServers`, Hermes adding `_config_version`) leaves the entry `ok`. A strict JSON engine refuses a commented file (`unparseable`) for the hosts that tolerate JSONC (Augment, CodeBuddy, Kilo's `.jsonc` sibling, Devin); a JSONC-aware merge is deferred (OQ-25-06). Kilo writes `kilo.json` and never `kilo.jsonc`.

### Deferred hosts

`windsurf` (renamed Devin Desktop on 2026-06-02; two MCP files; the IDE was not observed), `trae` (three different products and no official global MCP path) and `zcode` (a GUI-owned Electron application with a shared native config) have no recipe. The owner approved each deferral on 2026-11-17. Each keeps refusing `realm host install` as `recipe-pending` and changes nothing; the reason, the evidence, the alternative recipe an owner could choose and the open question that would lift each are in `docs/hosts/snippets/deferred-hosts.md`, which also lists the twelve open questions of this phase (OQ-25-01 to OQ-25-12) with their defaults. `pi` ships for pi 1.3 and later only (owner-approved, OQ-25-07).

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
| `realm host list` | the 19 hosts: `id`, `flag`, `aliases`, `tier`, `integration`, `homeVerified`, `recipe` (`pending` or `ready`; 16 are `ready` and 3 are `pending`: `windsurf`, `trae`, `zcode`) | nothing |
| `realm host detect [<host>]` | `id`, `detected`, `homes` (path and whether it exists; `config` and `skills` homes only) and the `binary` found on an absolute `PATH` directory; honors each host's override variable (`CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `CODEX_HOME`, `KIMI_SHARE_DIR`, `KIMI_CODE_HOME`, `PI_CODING_AGENT_DIR`, `COPILOT_HOME`, `QWEN_HOME`, `AUGMENT_CACHE_DIR`, `CODEBUDDY_CONFIG_DIR`, `CLINE_DIR`, `HERMES_HOME`) | `HOME` |
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

$ realm host status trae
{"id":"trae","status":"recipe-pending","entries":[]}

$ realm host install trae --dry-run 2>&1 >/dev/null
realm host install: recipe-pending: no install recipe exists for this host yet
$ realm host install trae --dry-run 2>/dev/null; echo "exit $?"
POLICY_DENIED
exit 1

$ realm host uninstall trae
{"id":"trae","status":"noop","dryRun":false,"actions":[]}
```

On a host with a recipe (the 16 above: `omp`, `claude`, `opencode`, `codex`, `kimi`, `kimi-code`, `cursor`, `copilot`, `qwen`, `augment`, `pi`, `cline`, `antigravity`, `kilo`, `codebuddy`, `hermes`), `install` and `uninstall` print `{ id, status, dryRun, actions }`, where `status` is `planned`, `installed`, `noop` or `removed` and each action is `{ path, action, bytes }` with `path` relative to the config home and no content. `realm host status claude` on an installed host prints, for example, `{"id":"claude","status":"installed","entries":[{"path":".claude.json","state":"ok"}],"launch":"on-path"}`.

`realm doctor` adds a `host-plugins` item. It reads receipts, the files a receipt names (for Claude Code a file in the user's home) and presence markers only, never a host binary or the environment: `pass` with no receipt or only intact installs, `warn` for a pending receipt or any drifted entry with the repair command (`realm host install <id>`, or `realm host uninstall <id>` to remove), and `fail`, with the catalogue code and the host id, for a corrupt receipt, a symlinked `hosts` directory or a read that exceeds its bound. A drifted entry that is `unreadable` carries the count in the detail (`..., 1 unreadable`) and a different fix text: the file cannot be read or parsed safely, so inspect it and repair it by hand before running `realm host uninstall <id>`. For an installed `omp` the detail adds whether the extension target exists and the number of live plugin sessions (`installed: omp (extension target present, 1 live plugin session)`); a missing or unreadable target is a `warn` (`host plugin drift: omp: extension target missing`), as is an unreadable presence marker. The detail never holds a path or file content. Doctor does not report `launch`, because it reads no environment.

## The 19 hosts

Source: GSD Core `next`, commit `69d604e`, 2026-11-16, recorded in `.planning/phases/21-host-plugin-contract-and-installer/21-DISCOVERY.md` (package 1.21.0: `src/runtime-name-policy.cts`, `src/runtime-homes.cts`, `docs/how-to/install-on-your-runtime.md`). Gemini is retired upstream and `vscode` is registered but not installable, so neither is in the table. Tier is the project decision carried into Phase 21 and is the roadmap's classification of where end-to-end effort goes, not a statement of evidence: Omp is the reference; Claude Code, OpenCode, Codex and Kimi CLI are the proven tier, with their recipes landed in Phase 24 (and the `kimi-code` row's recipe by decision D-24-05); the rest are config-only, with their recipes landed in Phase 25 except the three deferred hosts. What was proven for each host is stated under "Evidence limits".

| Id | Flag | Tier | Integration | Config home (global) | Recipe |
| --- | --- | --- | --- | --- | --- |
| `omp` | `--omp` | reference | extension | `~/.omp/agent` (`PI_CODING_AGENT_DIR`); the shim goes to `extensions/realm/` | ready |
| `claude` | `--claude` | proven | mcp-config | `~/.claude` (`CLAUDE_CONFIG_DIR`); the entry goes in `~/.claude.json` (`mcp` role: the user's home, or `CLAUDE_CONFIG_DIR`) | ready |
| `opencode` | `--opencode` | proven | mcp-config | `~/.config/opencode` (`XDG_CONFIG_HOME/opencode`) | ready |
| `kilo` | `--kilo` | config-only | mcp-config | `~/.config/kilo` (`XDG_CONFIG_HOME/kilo`); `~/.kilo` is detection only | ready |
| `codex` | `--codex` | proven | mcp-config | `~/.codex` (`CODEX_HOME`) | ready |
| `copilot` | `--copilot` | config-only | mcp-config | `~/.copilot` (`COPILOT_HOME`) | ready |
| `antigravity` | `--antigravity` | config-only | mcp-config | `~/.gemini/config` (no override); documented-only | ready |
| `cursor` | `--cursor` | config-only | mcp-config | `~/.cursor` (no override) | ready |
| `windsurf` | `--windsurf` (alias `devin-desktop`) | config-only | mcp-config | `~/.codeium/windsurf` (detection only) | pending (deferred) |
| `augment` | `--augment` | config-only | mcp-config | `~/.augment` (`AUGMENT_CACHE_DIR`) | ready |
| `trae` | `--trae` | config-only | mcp-config | `~/.trae` (detection only) | pending (deferred) |
| `qwen` | `--qwen` | config-only | mcp-config | `~/.qwen` (`QWEN_HOME`) | ready |
| `hermes` | `--hermes` | config-only | mcp-config | `~/.hermes` (`HERMES_HOME`) | ready |
| `codebuddy` | `--codebuddy` | config-only | mcp-config | `~/.codebuddy` (`CODEBUDDY_CONFIG_DIR`) | ready |
| `cline` | `--cline` | config-only | mcp-config | `~/.cline` (`CLINE_DIR`) | ready |
| `kimi` | `--kimi` | proven | mcp-config | skills `~/.config/agents`, config `~/.kimi` (`KIMI_SHARE_DIR`, config only) | ready |
| `kimi-code` | `--kimi-code` | config-only | mcp-config | `~/.kimi-code` (`KIMI_CODE_HOME`) | ready |
| `zcode` | `--zcode` | config-only | mcp-config | `~/.zcode` (detection only) | pending (deferred) |
| `pi` | `--pi` | config-only | mcp-config | `~/.pi/agent` (`PI_CODING_AGENT_DIR`, shared with Omp) | ready (pi 1.3 and later) |

## Evidence limits

- The engine and the 16 recipes are proven on fixtures (tier T1): a temporary HOME, a temporary state directory and, for Omp, a stub extension entry (`test/support/fixture-host.ts`, `test/host/omp-recipe.test.ts`); for the other 15, string goldens each tagged with its source and date (`test/support/host-config-goldens.ts`, `test/host/{claude,opencode,codex,kimi}-recipe.test.ts`, `test/host/{wave2-json-recipes,wave2-json-specifics,codebuddy-recipe,hermes-recipe,shadows}.test.ts`, `test/cli/host.test.ts`). No real host configuration is read or written by the test suite. The 3 deferred hosts (`windsurf`, `trae`, `zcode`) have no recipe: every real install refuses as `recipe-pending` and changes nothing.
- That a real Omp loads the installed shim, starts the daemon and paints the status item is proven only by the live rehearsal in an isolated profile (`docs/integration/omp.md`, "Installed by `realm host install omp`"); until it is recorded there, the shim is unproven against a real Omp.
- Omp is the only host with live evidence (`docs/integration/hosts.md`). The four adapter bundles under `adapters/` have evidence tier 2 (a host validator or isolated install passes) and are not registered in any live configuration.
- Config homes: Omp's home (`~/.omp/agent`, `PI_CODING_AGENT_DIR`) is verified against `omp --help` and the public extension page. The homes and files of `claude` (`~/.claude.json`, `CLAUDE_CONFIG_DIR`), `codex` (`~/.codex/config.toml`, `CODEX_HOME`) and `opencode` (`XDG_CONFIG_HOME`) were observed on 2026-11-17 by running the host in an isolated HOME (Claude Code 2.1.322, codex-cli 0.154.0, OpenCode 1.19.5 fetched into a scratch directory), and also come from documentation. The homes and entry shapes of `kimi` (`~/.kimi/mcp.json`, `KIMI_SHARE_DIR`) and `kimi-code` (`~/.kimi-code/mcp.json`, `KIMI_CODE_HOME`) come from official documentation only: no Kimi product was observed writing them. The homes and files of the ten Phase 25 hosts come from official documentation and, where each snippet says so, from a manual observation of a fetched copy in an isolated HOME on 2026-11-17 (qwen 0.22.0, kilo 7.8.27, copilot 1.0.112, auggie 1.2.1, codebuddy 2.185.0, cline 3.0.74, pi 1.5.2, cursor-agent 2026.11.13); `antigravity` is documented-only (`agy` was never run) and `hermes` was observed through the host's own writer functions, not its CLI. The homes of the three deferred hosts come from the GSD Core discovery above and were not independently verified.
- `detect` is a file-system look at a home directory and at an executable on `PATH`. It runs no host binary, so it cannot tell a working install from a leftover directory.
- The boot path of the 18 `mcp-config` hosts (`realm mcp|acp --host <id>`) is proven against fakes and against a real daemon over fakes, and its marker against a built `realm mcp --host claude` in the smoke. That a real Claude Code or a real Omp boots through it, and how long a real host waits for a cold first boot, is proven only by the live rehearsal, which has not been run (see "Boot integration", "Evidence tiers").
- Wave 2 gaps (Phase 25). Only `qwen` (Qwen Code 0.22.0) has a live validator result (PASS, 2026-11-17); the other eight gated hosts have never run through the gated tier, `antigravity` has no tier, and no wave 2 host has a production tier. The three deferrals (`windsurf`, `trae`, `zcode`) are decisions, not defects. JSONC is refused, not merged (OQ-25-06). `pi` is valid for pi 1.3 and later only and the recipe cannot check the version: on a pi below 1.3 the install succeeds and the host ignores the file. `cline` is the Cline CLI only: the IDE extension's file is not documented, and `CLINE_DATA_DIR` and `CLINE_MCP_SETTINGS_PATH` are not honoured (OQ-25-08). `antigravity` was never run: the path and shape rest on three Google pages that agree, against GSD Core's own different path. GSD Core's environment names for these hosts are GSD-only, and a recipe uses the host's own variable or none (`cursor` and `antigravity` have none, so `--config-home` is the only way to point at another directory). `PI_CODING_AGENT_DIR` is shared with Omp: setting it moves both hosts' homes. The `hermes` CLI was broken on the verification machine (`hermes --version` failed), so only the host's own writer functions were observed. Nothing in this phase measures a host's MCP start timeout against a cold first boot (OQ-24-06 carried).

The three evidence tiers of the Phase 24 recipes, per host. T1 is the offline fixture (always runs in CI). T2 is the host's own validator command against what the recipe wrote, in an isolated HOME, with a stub `realm` on `PATH` (gated: `REALM_LIVE_CLAUDE`, `REALM_LIVE_CODEX`, `REALM_LIVE_OPENCODE`, `REALM_LIVE_KIMI`). T3 is a real host health check performing an MCP initialize against the real `realm mcp --host <id>` with a daemon opened for a workspace (gated: `REALM_LIVE_PRODUCTION=1` plus the host variable, Podman 5.x). The gated rehearsal was run by hand on 2026-11-17 for the T2 tier of `claude` and `codex` (results below, evidence kept outside the repository); no other cell has a result: a cell says "not run" until a dated result is written here, and "gap" where the tier cannot be run at all.

| Host | T1 offline fixture | T2 host validator | T3 live end to end |
| --- | --- | --- | --- |
| `claude` | covered; golden observed from Claude Code 2.1.322, 2026-11-17 | ran live, 2026-11-17, Claude Code 2.1.322: 3 of 3 passed, run twice (the second from the merged tree). The real `claude mcp get` and `claude mcp list` parse the file the recipe wrote and launch the registered argv; the host's own add and remove interoperate with the recipe; `CLAUDE_CONFIG_DIR` moves the file | not run, see the [Wave 1 boot matrix](wave1-boot-matrix.md): the production test exists and records the wire; no dated result yet |
| `codex` | covered; golden observed from codex-cli 0.154.0, 2026-11-17 | ran live, 2026-11-17, codex-cli 0.154.0 (`get` and `list` parse only). The first run, against the comment-marker recipe, failed and found the defect: Codex drops a marker comment that is the decor of a table and keeps the table text, `codex mcp add other` left the END marker and `codex mcp remove realm` left an orphan END, so markers are not an ownership mechanism for Codex; ownership is by table header, no markers. After the header-owned recipe merged, a run from the merged tree: 5 passed, 0 failed, 2 skipped (production tiers). `codex mcp get\|list` parse the table; after `codex mcp add other` and `codex mcp remove realm` install, status and uninstall stay consistent (the table stays byte-identical and status `ok` after `add other`; status is `missing` and uninstall a no-op after `remove realm`); after `codex mcp add realm`, install refuses with `foreign-content` | session tier written, not run, see the [Wave 1 boot matrix](wave1-boot-matrix.md): `codex exec` against a refusing loopback provider makes Codex start the registered server and list its tools without a credential; no model turn and no tool call |
| `opencode` | covered; formats from official documentation and an observation of 1.19.5, 2026-11-17 | not run: no `opencode` executable on the verification machine. Observed 2026-11-17 with opencode 1.19.5: `opencode mcp list` itself writes `{"$schema": "https://opencode.ai/config.json"}` into `opencode.json` and creates a `.gitignore` beside it, so after the host ran, `realm host uninstall opencode` removes only the realm entry and leaves the file with `$schema` plus the host-created `.gitignore`; the file is removed only when the host never touched it | not run, see the [Wave 1 boot matrix](wave1-boot-matrix.md): the tier exists and needs a scratch install the owner has not approved |
| `kimi` | covered; formats from official documentation, 2026-11-17 | not run: no `kimi` executable, and the only published release is an inert stub | gap: the Python Kimi CLI is archived, its last release is a deprecation stub |
| `kimi-code` | covered; formats from official documentation, 2026-11-17 | not available: no validator command is documented (no `kimi mcp` command exists; `kimi doctor` validates `config.toml` and `tui.toml` only) | gap: functional product, not installed here, not run |

Not shown by any tier, for any host: that a long-running session keeps using the entry after its file changes, that a real model turn calls the Realm tools, and that a host's start timeout outlasts a cold first boot of up to 230 s (OQ-24-06; no recipe writes a timeout). Open owner decisions: OQ-24-01 (keep, drop or promote `kimi-code`), OQ-24-02 (OpenCode V1 versus V2 entry shape), OQ-24-03 (hide host-config names from the workspace mount), OQ-24-05 (what Codex does to the markers).

The Phase 25 evidence, per host. T1 is covered for all ten (fixture hosts built from the real table rows). T2 is the host's own validator command against what the recipe wrote, in an isolated HOME, run only by the gated rehearsal (`test/integration/host-live-wave2.test.ts`, opt in with `REALM_LIVE_<ID>=1`, optional `REALM_<ID>_BIN`); **the gated rehearsal ran live once, on 2026-11-17: `qwen` passed (Qwen Code 0.22.0), and the other eight gated hosts skipped with named reasons (opt-in not set, CLI not installed, pi 0.84.3 below the 1.3 floor, the Hermes CLI broken on the verification machine), so no cell below claims that those ran**; the hermetic helper test passed (32 pass, 0 fail, 8 skipped). The observations named in the last column were manual runs of a fetched copy in an isolated HOME on 2026-11-17, not the gated test and not through `realm host install`. No wave 2 host has a T3 tier: they are config-only by the owner's decision (OQ-25-09), and nothing claims a live Realm session through any of them.

| Host | T1 offline fixture | T2 host validator | Observed or documented |
| --- | --- | --- | --- |
| `cursor` | covered | `agent mcp list` (launches): no result recorded | documented; spawn observed with cursor-agent 2026.11.13 |
| `copilot` | covered | `copilot mcp get realm`, `copilot mcp list` (parse only): no result recorded | observed, Copilot 1.0.112 |
| `qwen` | covered | `qwen mcp list` (launches): ran live, 2026-11-17, Qwen Code 0.22.0, through the gated wave 2 validator tier (`REALM_LIVE_QWEN=1`): PASS. The real recipe installed into an isolated home, Qwen Code's own commands parsed it, and uninstall removed only what install created. The result covers 0.22.0 only (evidence kept outside the repository) | observed, Qwen Code 0.22.0 |
| `augment` | covered | `auggie mcp list` (parse only): no result recorded | observed, Auggie 1.2.1 |
| `pi` | covered | `pi mcp list` (launches; skips below pi 1.3.0): no result recorded | observed, pi 1.5.2; valid for pi 1.3 and later only |
| `cline` | covered | `cline config mcp --json` (parse only): no result recorded | documented; the flat shape parses in Cline 3.0.74; CLI only |
| `antigravity` | covered | none: documented-only, `agy` never run | documented (three Google pages) |
| `kilo` | covered | `kilo mcp list` (launches): no result recorded | observed, Kilo 7.8.27 |
| `codebuddy` | covered | `codebuddy mcp list` (launches): no result recorded | observed, CodeBuddy 2.185.0 |
| `hermes` | covered | `hermes mcp list`, `hermes mcp test realm`: no result recorded; the CLI fails `--version` on the verification machine | host writer functions run as library code (v0.23.2); the CLI was not run |

Open owner decisions of Phase 25: OQ-25-01 to OQ-25-03 (the deferrals, approved), OQ-25-04 (`antigravity` documented-only), OQ-25-05 (the `yaml-map` kind for one host), OQ-25-06 (a JSONC-aware merge), OQ-25-07 (the pi floor, approved), OQ-25-08 (the Cline CLI only), OQ-25-09 (no T3 tier), and the three unverified inferences OQ-25-10 to OQ-25-12, all listed with their defaults in `docs/hosts/snippets/deferred-hosts.md`.

Residual risks, accepted and documented:

- JSON with comments (JSONC) is refused as `unparseable`, not rewritten; TOML is edited only as one owned table located by its header and guarded by a line scanner, never parsed; YAML is edited only as one owned entry located by a line scanner. OpenCode's `opencode.jsonc` and Kilo's `kilo.jsonc` are never read or changed.
- A host config home that is a symlink (dotfile managers) is refused; the operator names the real directory with `--config-home`.
- The write phase is synchronous and bounded by file size (1 MiB per file, 256 bundle files), not by a timer; reads are bounded by `TOOL_TIMEOUT`.
- A workload that can write a host config home can edit other settings there as well; Realm detects changes to its own entry only (doctor `warn`, uninstall refusal).
- R-24-01, project-level shadowing: a workload can write a host's project-level configuration in the workspace (`.mcp.json`, `.codex/config.toml`, `opencode.json` and `.opencode/`, `.kimi-code/mcp.json`) naming a server `realm` with a hostile command; the host then launches it outside the sandbox with the user's privileges. Claude Code asks approval, Codex honours project configuration for trusted projects only and Kimi Code asks workspace trust; OpenCode documents no trust gate. Realm writes and reads no project-level configuration and the sandbox mount does not hide these names; the fix, a read-only or hidden overlay, is Phase 19 mount territory and an open owner decision (OQ-24-03).
- R-24-02, the concurrent-writer window: a host (Claude Code rewrites `~/.claude.json` at any time) can write the file between the final hash check and the rename. A change before the check is refused as `concurrent-change`; the window itself cannot be closed without a lock the host does not honour, so install with no host session open.
- R-24-03, the scanner limit: the Codex duplicate-table guard is a line scanner, not a parser (see "Install recipes"); a bare `["x"]` line inside a multi-line array in `[mcp_servers]` can hide a definition, in which case Codex itself rejects the file.
- R-24-04, the Codex editor: Codex rewrites `config.toml` with a comment-dropping TOML editor (observed with 0.154.0, 2026-11-17), so Realm owns one table by its header and writes no marker. A later Codex version that reformats the owned table (quoting, key order) makes the entry `drifted` and uninstall refuses rather than guessing; deleting the table by hand and running `realm host uninstall codex` clears the receipt.
- R-25-01, project-level shadowing by the ten Phase 25 hosts: a workload can write a host's project-level configuration into the workspace (Copilot `.mcp.json` and `.github/mcp.json`, Qwen `.qwen/settings.json`, Pi `.pi/mcp.json`, CodeBuddy `.mcp.json`, Cursor `.cursor/mcp.json`, Kilo `kilo.json` and `.kilo/`, Augment `.augment/settings.json` and `.augment/settings.local.json`, Antigravity `.agents/mcp_config.json`) naming a server `realm` with a hostile command; the host then launches it outside the sandbox with the user's privileges. Copilot loads it after folder trust, Qwen shows "Pending approval", Pi after project trust and CodeBuddy after approval; Cursor merges it with per-server approval in its CLI; Kilo, Augment and Antigravity document no gate; none was found for Hermes and none is documented for Cline. Realm writes and reads no project-level configuration and the sandbox mount does not hide these names. **Never approve or trust a `realm` server defined in a repository**; each snippet says so once. Hiding the names is Phase 19 mount territory and an open owner decision.
- R-25-02, the concurrent-writer window for GUI-owned or running hosts (Cursor, Antigravity, Copilot with its lock file, Qwen, Kilo's first-run migration): a host can write the file between Realm's final hash check and the rename. A change before the check is refused as `concurrent-change`; the window itself cannot be closed without a lock the hosts do not honour, so install with no host session open.
