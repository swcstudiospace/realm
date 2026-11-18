# Wave 1 boot matrix

This page is the production-stack boot status of the five wave 1 hosts (`claude`, `codex`, `opencode`, `kimi`, `kimi-code`): whether a real host, started through its own CLI, booted Realm against the production stack and listed its tools, with the procedure, the evidence and the limits. The Disposition column is a view of the T3 status in the evidence registry (`test/support/host-registry.ts`), and a test (`test/docs/wave1-boot-matrix.test.ts`) ties each row to it, so a row cannot claim a result the registry does not hold. The per-host summary is the [Host support matrix](host-support-matrix.md), the unverified items and their lift conditions are on [Host plugin gaps](host-plugin-gaps.md), and the contract the recipes follow is [Host plugin contract and installer](host-plugin-contract.md).

A skipped test is `not-run`, never a pass. A cell that names no date and no version has no result behind it.

## The matrix

Dispositions: `rehearsed` (a dated run passed), `failed` (a dated run failed; the registry holds it as a gap whose note starts `rehearsal failed`), `not-run` (no dated result), `gap` (the tier cannot run at all today).

| Host | Disposition | Driven by | Version | Result | Wire and daemon evidence | Date | Gap rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `claude` | not-run | the production test with `claude mcp list` as the health check and a wire recorder in front of `realm mcp --host claude`, after a `realm up` warm-up | - | not run on the production stack. The validator tier passed on the real host 2026-11-18. The production tier requires a warm session: a cold attach (sandbox creation, about 35 to 60 s) exceeds the host connect timeout, and the health probe gave up with `realm status` unbound (GAP-31-04) | none yet | - | GAP-24-03, GAP-23-01, GAP-23-02, GAP-31-04 |
| `codex` | not-run | the production test with a `codex exec` session against a loopback provider that refuses every request, and the same wire recorder, after a `realm up` warm-up | - | not run on the production stack. Validator-tier session result, codex-cli 0.154.0, 2026-11-17 (evidence kept outside the repository): `codex exec` against a refusing loopback provider launches the registered stdio server, which sees initialize and tools/list; without the `env_vars` override the server sees only HOME, LANG and PATH (GAP-31-01). The production run is the live window (`test/integration/host-live-codex.test.ts`) | none yet | - | GAP-24-03, GAP-23-01, GAP-31-01, GAP-31-02, GAP-31-04 |
| `opencode` | not-run | the production test with `opencode mcp list` as the health check, after a `realm up` warm-up; the tier exists and is gated on the executable | - | not run on the production stack. The validator tier passed on the real host (opencode 1.19.5) 2026-11-18. The production tier requires a warm session: a cold attach exceeds OpenCode's 30 s connect timeout (GAP-31-04) | none yet | - | GAP-24-01, GAP-31-04 |
| `kimi` | gap | none: the Python Kimi CLI is archived and its last release is a deprecation stub | - | cannot run | none | - | GAP-24-02 |
| `kimi-code` | gap | none: functional product, not installed here, no MCP validator command documented | - | cannot run here | none | - | GAP-24-02 |

Every `claude` and `codex` cell reads not-run until a dated result is recorded from the live window. Rehearsals cover a warm stack on one machine and one version per host (GAP-31-03).

Observed on the live run of 2026-11-18, on the production stack (a rootless Podman 5.7.1 account, warm session; evidence kept outside the repository, and the rows above keep their status until the registry is updated at the phase closure):

- opencode 1.19.5: the production tier passed (`opencode mcp list` reported realm connected, against a warm session).
- claude 2.1.322: connects with the modern MCP revision, with no initialize handshake: it sends `server/discover` and then `tools/list`, and `realm mcp --host claude` answered with all six tools. The run's one failing assertion was the test's own requirement of an initialize; the assertion now accepts either `initialize` (legacy era) or `server/discover` (modern era) and still requires `tools/list` and the six tool names.

The cold-attach gap (GAP-31-04): `realm mcp --host ID` ensures the daemon and runs `up` before it answers initialize, so a first attach that has to create the sandbox takes about 35 to 60 s and outlasts the host's MCP connect timeout (OpenCode 30 s; Claude's `mcp list` probe also gave up, leaving `realm status` unbound with no workspace). A second attach is fast. The production tests therefore run the idempotent `realm up --workspace` for the project first, so the host attaches to a warm session. Options for a later phase: answer initialize before `up` and report a not-active status until ready, or document running `realm up` first. This plan changes no product code.

## How a host is booted

- **claude.** The production test installs the real recipe into an isolated Claude configuration directory, puts a wire recorder first on the path as the registered `realm`, and runs `claude mcp list` from a directory under the pinned workspace root. The health check performs a real MCP handshake against `realm mcp --host claude` (`initialize` in the legacy era, `server/discover` in the modern era; Claude Code 2.1.322 used the latter); the test requires `connected` for the realm line and no `failed`.
- **codex.** The same install and recorder, then a `codex exec` session in an isolated Codex home against a loopback provider that answers every request with a 503 and records only whether an Authorization header ever arrived. The provider table has no key, auth or bearer field, so no credential exists. The entry is told to forward three extra environment names to the server (`XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `REALM_DRIVER_SOCKET`) on top of Codex's default `HOME`, `LANG` and `PATH`. The test does not wait for Codex to exit, which it never does by itself: it polls for the boot (the daemon answers active, an attached boot report for the host, the recorder shows the tool listing) and then ends the process group.
- **opencode.** The production test runs `opencode mcp list` as the health check, like claude. It is gated on an `opencode` executable; it passed once on 2026-11-18 (see above).
- **kimi and kimi-code.** No drive exists. `kimi` is archived and cannot run a session. `kimi-code` has no documented command that lists or launches a registered server (`docs/hosts/snippets/kimi.md`).

The wire recorder forwards the host's stdio to the real CLI byte for byte, and logs one line per message: the direction, the kind, the JSON-RPC method name, the request id and, for the response to `tools/list`, the tool names. It never records parameters, results, headers, paths or environment values. For every host the test requires a handshake from the host (`initialize` or `server/discover`, and the failure message names the methods seen); for claude and codex it also requires `tools/list` and the six tools (`exec`, `list`, `read`, `retry`, `status`, `write`); for opencode it only records the tools.

After the host command, every drive checks the same things: the daemon shows no live session and an empty presence directory, `realm down` succeeds, no sandbox or container remains, `realm host uninstall` removes the entry, and the operator's real host configuration file is byte-identical. The session drive also requires that the provider saw no Authorization header and only loopback peers.

## The window

A production run happens in a human-owned window on the production stack's account, under the shared live lock, one host test at a time. The person who runs it keeps the evidence outside the repository (versions, counts, hashes and results, never paths or environment values), takes a before and an after snapshot of containers, sandboxes, state-directory entries and processes, and compares the real host configuration hashes. A failed step is reported with its catalogue code and the plan that owns the behaviour; it is not retried silently and nothing is patched in the window. No agent runs the production tests. The results are recorded here, in the registry and on the gaps page from that evidence only.

## Not shown

- No model turn and no tool call ran: a session against a refusing provider lists tools and nothing more (GAP-31-02). A scripted provider that makes Codex call a Realm tool is a deferred idea.
- A cold stack start: the window runs against a warm stack and says so (GAP-31-03, GAP-22-02, GAP-23-02).
- A second version of any host (GAP-31-03, GAP-22-03).
- The wave 2 hosts: they have no production tier by owner decision (GAP-25-07).
- Windows and macOS: Linux only (GAP-23-05).
- The Codex default-environment consequence: Codex forwards only `HOME`, `LANG` and `PATH` to a stdio server unless the entry lists more, and the codex recipe writes no such list, so whether a real Codex user reaches a non-default production stack is inferred (GAP-31-01).
