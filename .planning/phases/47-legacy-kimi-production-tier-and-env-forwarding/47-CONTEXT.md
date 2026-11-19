# Phase 47: Legacy kimi production tier and environment forwarding - Context

**Gathered:** 2026-11-19, from the Phase 47 block of `.planning/ROADMAP.md`, KIMV-01 to KIMV-04 in `.planning/REQUIREMENTS.md`, `.planning/MILESTONE-CONTEXT.md` (D-v7-4, the owner decision of 2026-11-19, and the ordering note for Phases 47 and 48), `.planning/PROJECT.md`, `AGENTS.md`, the Phase 43 records (`.planning/milestones/v6.0-phases/43-kimi-and-kimi-code-rehearsal/43-CONTEXT.md`, `43-02-PLAN.md`, `43-02-SUMMARY.md`, `43-VERIFICATION.md`), the rows `GAP-24-02`, `GAP-24-03`, `GAP-43-01`, `GAP-43-02` and `GAP-43-03` of `docs/integration/host-plugin-gaps.md`, `docs/integration/wave1-boot-matrix.md`, `docs/hosts/snippets/kimi.md`, the evidence registry `test/support/host-registry.ts`, the wire recorder and the production runner (`test/support/host-live-session.ts`, `test/support/host-live.ts`, `test/support/host-live-kimi.ts`, `test/integration/host-live-kimi.test.ts`), the MCP server and the stdio session (`src/mcp/server.ts`, `src/cli/stdio-host.ts`, `src/cli/stdio-settle.ts`, `src/daemon/spawn-env.ts`, `src/daemon/main.ts`, `src/runtime/host-paths.ts`), the recipe table (`src/host/runtimes.ts`) and the cross-host contract checks (`test/host/recipes-bare.test.ts`, `test/support/host-contract.ts`). The v6.0 phases are the format precedent (CONTEXT with decisions and open questions, plans with frontmatter, a threat model per plan, blocking-human live windows on the `realmlive` account with the owner authorization carried by the milestone).
**Status:** Planned (four plans, nothing executed). This phase does not edit ROADMAP, STATE or REQUIREMENTS; the orchestrator registers the plans from the section "Text for the orchestrator" below. The Linear ticket is SPE-34732.

<domain>
## Phase Boundary

Decisions fixed elsewhere and not reopened here: D-v7-4 (root-cause the legacy kimi-cli 1.51.0 production-tier failure, GAP-43-03, and the environment forwarding of GAP-43-01), D-v7-6 (the release line is 0.7.x), the owner authorization carried since 2026-11-18 (live windows on the `realmlive` account under the shared live lock, with residue checks and evidence outside the repository; scratch installs of host CLIs outside the repository are pre-authorized), D-33-01 (cold attach: `realm mcp` answers the handshake and `tools/list` before the realm is ready), D-34-01 (capability tokens enforce by default, so a live session needs `--host LABEL`), the no-model-turn rule (GAP-31-02) and CAPT-09 (recipes and manifests stay bare: no `env`, token or key member; `test/host/recipes-bare.test.ts`).

What this phase is. Phase 43 ran the legacy kimi-cli 1.51.0 production tier once, cold, on 2026-11-18 and it failed: `kimi mcp test realm` exited 0 after 18225 ms, the wire showed `initialize`, `notifications/initialized` and `tools/list`, and no tool names were answered through the recorder. The window kept no wire log and no full command output, and the recorder summary cannot tell a response never written from one written after the client closed from an error response. The legacy CLI forwards only `HOME` and `PATH` to a stdio server (observed 2026-11-18), the recipe writes no `env` block, and the production run only passed its environment names because the recorder restored three of them. This phase (1) builds the instrument that can tell the three outcomes apart and the controls that can place the cause (client, `realm mcp`, stack), (2) runs one owner-supervised window that reproduces the failure with the logs kept (or records that it did not reproduce), attributes the cause by a rule frozen before the window, and shows live which of `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR` and `REALM_DRIVER_SOCKET` a legacy user needs when the recorder restores nothing, (3) acts on the cause (a `realm mcp` fix with a test that fails without it, a documented variant for a client cause, or the recorded owner decision) and on the environment result (a recipe `env` block of those names, an accepted-residual with a named workaround, or not needed), and (4) makes every document, the registry, the contract checks and the support matrix agree, removes the scratch install and leaves the stack as found.

Out of scope, stated so no task drifts into it: a model turn or tool call through the legacy CLI (GAP-31-02), the network use of the CLIs (GAP-43-02 stays accepted-residual), a second version of the legacy CLI (GAP-31-03), Kimi Code (it passed its production tier on 2026-11-18 and is not rerun), any change to the `kimi-code` recipe, the Codex `env_vars` question (GAP-31-01), Phase 48's host ids, and any edit of `docs/specs/realm-spec.xml`. Dropping the `kimi` row from the table (HOST_IDS shrinks and many tests pin 22 ids) is not done in this phase; if the owner retires the archived row, the phase records the decision and the demotion or removal is a follow-up the owner names (see Owner decisions needed).
</domain>

<decisions>
## Implementation Decisions

### Evidence (each fact: source, date, tier)

Tiers: **O** observed by reading a repository file on 2026-11-19, **R** recorded in a Phase 43 record dated 2026-11-18 (a live observation the window kept only in summary form), **W** read on a public page (read 2026-11-19), **I** inference, never stated as a result. The executors repeat every O fact they rely on and record the repeat.

- **E-47-01 (R).** Legacy kimi 1.51.0 against the production stack, cold: `kimi mcp test realm` exited 0 after 18225 ms; the wire summary was host methods `initialize`, `notifications/initialized`, `tools/list` and no tool names; a container, a sandbox and a daemon existed after the run (so the stack was reached); the recorder restored `REALM_DRIVER_SOCKET`, `XDG_CONFIG_HOME` and `XDG_RUNTIME_DIR`. No wire log and no full output were kept (43-VERIFICATION, behavior_unverified 1).
- **E-47-02 (R).** The same command against the fake MCP server returned after 18058 ms and listed the six tools (validator session). The two durations differ by 167 ms, so most of the 18 s is the client's own time, not Realm's. [I] The legacy client has a fixed or startup-dominated cost of about 18 s; nothing yet says where it goes.
- **E-47-03 (O).** The wire recorder (`test/support/host-live-session.ts`, `teeSource`) logs direction, kind, method, request id and, on the response to `tools/list`, the tool names. It records no time, no marker that a response was an error, no marker that the host closed its end, and no exit of the server. `wireSummary.answered` is true only when a `tools/list` response with at least one tool name was logged. So an absent response, an error response and a response written after the client closed all read as `answered: false`. This is why GAP-43-03 cannot be classified from the 2026-11-18 evidence.
- **E-47-04 (O).** `realm mcp` answers `tools/list` from a static table (`src/mcp/server.ts`, `dispatchMethod`), without touching the daemon, and writes the reply synchronously (`writeReply`). On stdin end the reader loop drains the remaining lines before `closed` resolves. The attach runs in the background (`src/cli/stdio-host.ts`): `driver.start` is called in the same synchronous turn as `createMcpServer`, and the process exits 1 at stdin end only when the settled boot found no client (`src/cli/stdio-settle.ts`). [I] Nothing read says why a `tools/list` would go unanswered; the candidates are a long synchronous part of the start path delaying the first read, a client that closes before a healthy answer, an error response, or the server exiting first. Each is tested by an observation below, none is assumed.
- **E-47-05 (O).** What `realm mcp` needs from its environment (`src/runtime/host-paths.ts`, `src/daemon/spawn-env.ts`, `src/daemon/main.ts`): `XDG_RUNTIME_DIR` is the only source of the rootless Podman API socket path (no fallback; unset gives no socket path and the probe fails with a message naming it); `XDG_CONFIG_HOME` locates the realm config file when it is absolute, otherwise the config is read from the home directory under `.config/realm`; `REALM_DRIVER_SOCKET` is read by the daemon, and unset means no driver socket is configured, the supervisor does not probe it and `realm doctor` reports the unset variable. The daemon spawn allowlist keeps exactly these three names plus `PATH`, `HOME`, the driver supervisor pins and `REALM_LOG_LEVEL`. [I] So a legacy user probably needs `XDG_RUNTIME_DIR` always, `XDG_CONFIG_HOME` only for a non-default config location, and `REALM_DRIVER_SOCKET` only for supervision of the compute driver. This is the expectation the live ablation (D-47-06) tests; it is not a result.
- **E-47-06 (O).** The production runner relocates the realm config home for the scenario (`createScenarioEnvironment`), so the production stack is a non-default stack in the sense of KIMV-03: a client that does not forward `XDG_CONFIG_HOME` makes `realm mcp` read the account's default config location, not the scenario's.
- **E-47-07 (O).** A recipe `env` member is currently forbidden by CAPT-09: `test/host/recipes-bare.test.ts` fails if an `env`, token or key member is added to a recipe, a manifest or a receipt, with one allowed exception (claude's empty `env` object). `docs/integration/host-plugin-contract.md` states the same ("with no `env` member"). The cross-host contract reader (`test/support/host-contract.ts`, `registeredArgvOf`) reads `command` and `args` only and ignores other members. The same test also fails when a recipe text carries `REALM_` or when an applied recipe writes a `REALM_` name, and `REALM_DRIVER_SOCKET` is one of the three names. So a kimi `env` block is a contract change: an allowed-names exception in the bare-recipe test (the env object text, and the single `REALM_` name when it is needed, for the kimi host only), the contract sentence, the golden and a migration note, and a `!` marker on the commit subject because an existing install's owned value changes (MILESTONE-CONTEXT, "Release line").
- **E-47-08 (O).** A recipe's `value` is a constant (`src/host/runtimes.ts`, `json-merge`). It cannot carry a path that belongs to the user (`XDG_RUNTIME_DIR` is per user and per boot). So an `env` block of those three names can only hold either a variable reference the client expands, or a value captured from the installing process by a new recipe capability. Whether the legacy client expands a reference is unknown (E-47-09).
- **E-47-09 (W, read 2026-11-19, official documentation and an issue page).** `kimi mcp add` takes `--env KEY=VALUE` (stdio only, repeatable) and stores `command`, `args` and `env` for a stdio server in `mcp.json`; `kimi mcp test NAME` connects, lists the tools and prints `Testing connection to 'NAME'...` first; the client is built on fastmcp and the MCP Python SDK. The page does not say whether `env` values are expanded. [I] The Python SDK's stdio client starts a server with a small default environment (HOME, PATH, user and terminal names) plus the entry's `env`, which matches E-47-01 (only HOME and PATH seen after shell-added names are filtered).
- **E-47-10 (R).** On 2026-11-17, `kimi mcp add --transport stdio ...` did not return within 60 s in an isolated home and wrote nothing; the cause was not found. The window therefore bounds it and may not get the host's own writer output (see D-47-07).
- **E-47-11 (O).** The harness already has: the validator session test with a fake server (`test/integration/host-live-kimi.test.ts`), the command drive of the production runner with a `restore` list (`test/support/host-live.ts`, `HostCommandDrive`), the direct cold attach probe with a handshake bound of 10 000 ms (`test/support/cold-attach-probe.ts`, `HANDSHAKE_BOUND_MS`; `test/integration/cold-attach-live.test.ts`), residue and listing helpers (`test/support/production-live.ts`) and the cross-host contract checks. It has no warm drive, no evidence directory, no reach observation and no timeline.
- **E-47-12 (R).** The legacy kimi-cli 1.51.0 scratch install of 2026-11-18 was a virtual environment on the system Python 3.12 (`uv venv`, then `uv pip install kimi-cli==1.51.0`), 209 MB, 127 frozen dependencies that are not hash-pinned (accepted residual); the 1.52.0 release is the deprecation stub. The scratch install was removed from the system optional-software directory after the Phase 43 recording. It does not exist now and must be reinstalled by Plan 47-02 and removed by Plan 47-04.
- **E-47-13 (O).** `test/docs/host-gaps.test.ts` accepts gap ids of phases 21 to 43 only. This phase adds no new gap id: it updates `GAP-24-02`, `GAP-24-03`, `GAP-43-01` and `GAP-43-03` in place, so the bound does not move (Phase 48 owns any bump). `test/docs/wave1-boot-matrix.test.ts` ties each row's disposition to the T3 status of the registry record (a note that starts `rehearsal failed` reads as failed).

### D-47-01. The question and the five legal outcomes of the reproduction

The question is why `kimi mcp test realm` on the production stack did not give the recorder a tool list on 2026-11-18. The window can end the reproduction in exactly one of these outcomes per D-47-04, and every one is a legal result that is recorded as it is, never relabelled:

- **REPRODUCED**: at least two valid cold runs are not ANSWERED (classes in D-47-03). The cause is then attributed by D-47-05.
- **NOT-REPRODUCED**: at least three valid cold runs, all ANSWERED with the six names. The 2026-11-18 failure stays recorded; the new runs are dated passes of the tier; the cause is recorded as not established (candidates stay INFERENCE).
- **INCONCLUSIVE**: anything else after the attempt limit (one failing run among several, or fewer than three valid runs). Recorded with every run; the gap stays open.
- **VOID**: the window did not open, a precondition failed (Podman, stack, scratch install does not run), or the instrument was not the one the plan froze. Recorded as a blocker, not as a result.

### D-47-02. The instrument (Plan 47-01; test support only, no file under src changes)

1. **Timeline recorder.** The wire recorder gains, on every logged line, a millisecond mark `t` (monotonic, from the recorder start), on a response an `error` flag and the numeric `errorCode` (never the message), on a request a `meta` flag (the request carried a `_meta` member; never its content), and lifecycle lines: the host closing its end (`host-stdin-end`), a signal the recorder received (`host-signal`), the child starting and the child exiting with code or signal. An optional `stderrFile` copies the child's stderr to a file (mode 0600) while still forwarding it. The existing reader `readWireLog` and every existing hermetic pin keep their behaviour: the new reader `readWireTimeline` reads the richer lines, and lifecycle lines are foreign to the old reader (skipped by its existing rule).
2. **Pure rules as code before data** (`test/support/wire-timeline.ts`, pinned by `test/support/wire-timeline.test.ts`): `classifyToolsList` (D-47-03), `reproductionOutcome` (D-47-04), `attributeCause` (D-47-05), `ablationVerdict` (D-47-06) and their constants. A runner `test/support/wire-timeline-run.ts` reads a directory of run folders and prints the verdict as JSON, so the window result is computed by the frozen code and not by hand.
3. **Run evidence.** When the environment names an evidence directory (an absolute path of an existing directory outside the repository checkout, mode 0700; a path inside the checkout is refused), the command drive writes per run, before any assertion, the wire log, the full stdout and stderr of the host command, the recorder's copy of the server's stderr, and the reach record (D-47-06), with file mode 0600. The default run (no variable) is unchanged.
4. **Variant switches** (environment names read by the kimi production test only; the default is the Phase 43 behaviour): which names the recorder restores (all three, none, or all minus one), and a warm control that brings the project's session up before the host command. A restore set other than all three, and the warm control, label the run `diagnostic variant` and are never recorded as the production tier.
5. **Two gated validator probes** (`REALM_LIVE_KIMI=1` plus `REALM_LIVE_KIMI_PROBES=1`; no Podman): (a) the expansion probe: an `env` block with the three names as variable references (two spellings) and as a plain literal is put into the rig's own `mcp.json` (never an install recipe output), the fake server logs for each name only a short digest of the value it received, and the test classifies each as absent, the reference text unexpanded, the host's value (expanded) or other; (b) the writer probe: the host's own `kimi mcp add --transport stdio --env NAME=VALUE ... -- realm mcp --host kimi` runs in the isolated home under the containment environment with a 60 s bound, and the resulting `mcp.json` is compared structurally (key order, indent, member names) with the recipe's output. A writer that does not return is recorded as `did not return`, a result, not a failure.
6. **Early-close characterization** (`test/cli/mcp-close.test.ts`, hermetic, in process with the injected seams of `test/cli/mcp-attach.test.ts`): the handshake and `tools/list` delivered in one chunk and the input ended in the same turn; `tools/list` then end while the attach is held; a reader that is slow to drain stdout; a reader that goes away. It asserts the reply is written and the process settles. A red case is a finding that selects Branch A of D-47-05 before the window; it is carried to Plan 47-03 as its red-first test and is not committed red by Plan 47-01.

### D-47-03. Classification of one run's `tools/list` outcome (frozen)

From the timeline: `tRequest` is the mark of the first `tools/list` request from the host; the response is the first realm-to-host response carrying that id; `tResponse` its mark; `tHostEnd` is the earliest of the `host-stdin-end` mark and the first `host-signal` mark; `L = tResponse - tRequest` and `G = tHostEnd - tRequest` when defined. A run is valid when the log holds an `initialize` or `server/discover` request.

- **NOT-REQUESTED**: no `tools/list` request was logged.
- **ANSWERED**: a response exists, it is a result (no `error`), and `tHostEnd` is undefined or not before `tResponse`. Sub-flag `sixTools` (the names equal the six Realm tools).
- **ERROR**: a response exists with `error`, written no later than `tHostEnd`. Its numeric code is kept.
- **WRITTEN-AFTER-CLOSE**: a response exists and `tHostEnd` is defined and before `tResponse`. Its kind (result or error) is kept.
- **NEVER-WRITTEN**: no response was logged for that id by the end of the log. The child's exit mark and code, when logged, are kept.

This is the classification KIMV-01 requires: a response never written, one written after the client closed, and an error response are three different classes.

### D-47-04. The reproduction rule (frozen)

Constants: `REPRO_MIN_VALID` 3, `REPRO_MAX_ATTEMPTS` 5, `REPRO_FAIL_THRESHOLD` 2. A run counts toward the rule only when it is cold (the before snapshot of the run shows no daemon of the account, 0 containers, 0 sandboxes and an empty workspace root), valid (D-47-03) and made in the 2026-11-18 condition (recorder restores all three names, no warm control, default drive). Runs continue until `REPRO_FAIL_THRESHOLD` failing runs (any class other than ANSWERED with the six names) are seen, or `REPRO_MIN_VALID` valid runs are all ANSWERED, or `REPRO_MAX_ATTEMPTS` attempts are made. The outcome is REPRODUCED (at least two failing valid runs), NOT-REPRODUCED (at least three valid runs, none failing), otherwise INCONCLUSIVE; a window with fewer than one valid run is VOID.

### D-47-05. The cause attribution rule (frozen; the controls are part of the window)

Controls, each made in the same window: **C1** the legacy client alone, the validator session against the fake server through the timeline recorder (at least one run): the client's own timeline and time. **C2** the realm alone, cold: the existing direct cold attach probe (`test/integration/cold-attach-live.test.ts`, at least one run): how fast `realm mcp` answers the handshake and `tools/list` cold on this stack; it is judged against `HANDSHAKE_BOUND_MS` (10 000 ms). **C3** the legacy client warm: the warm control (D-47-02 item 4), at least two runs, taken only when the reproduction is REPRODUCED.

Constants: `STALL_MS` 10 000 (equal to the handshake bound), `FIXED_TIMEOUT_SPREAD` 0.10.

Rules, in order, on the failing valid runs of a REPRODUCED window:

1. If C1 is not ANSWERED with the six names: cause **CLIENT** (it fails against a server that answers at once).
2. If any failing run is ERROR: cause **REALM-MCP** (the response is realm's own; the code is recorded; if the host's request line was not valid JSON-RPC, the cause is CLIENT instead and the record says so).
3. If any failing run is NEVER-WRITTEN and the child exited with a mark earlier than `tRequest + STALL_MS`: cause **REALM-MCP** (the server went away without answering; its exit code and stderr are recorded).
4. If every failing run is WRITTEN-AFTER-CLOSE with `L` at most `STALL_MS` and `G` less than `L`: cause **CLIENT** (the client closed before a healthy answer). If at least two such `G` values agree within `FIXED_TIMEOUT_SPREAD`, the record says fixed client timeout, with the value.
5. If failing runs show a stall (`L` greater than `STALL_MS`, or NEVER-WRITTEN with the child still alive at `tRequest + STALL_MS`): when C2 answered within `STALL_MS` and C3 answered with the six names in every warm run, cause **STACK** (cold session timing); when C3 did not answer in every warm run, cause **UNDETERMINED** with the narrowing "not cold-stack timing".
6. Any other combination: **UNDETERMINED**.

NOT-REPRODUCED and INCONCLUSIVE outcomes have no attributed cause: **NOT-ESTABLISHED** is recorded. UNDETERMINED and NOT-ESTABLISHED keep GAP-43-03 open with the narrowing written into the row.

### D-47-06. The environment ablation and its verdict (KIMV-03; frozen)

The question is which of the three names a legacy user must have forwarded. The legacy client forwards HOME and PATH only, so with the recorder restoring nothing the server sees exactly what a real user's server sees. Runs, cold, each with the recorder restoring a named set `S`: **SA** all three (these are the reproduction runs), **S0** none (the real-user condition, one run), and for each name `N` the set of all three minus `N` (two runs each). Each run records a **reach** observation taken right after the host command returns and polled every 2 s for `REACH_WINDOW_MS` 60 000 (scaled like other live bounds): the state `realm status` gives for the project, the count of containers and of Realm sandboxes of the project, the count of `attached` boot reports for the host in `realm metrics`, and the catalogue codes found in the server's stderr copy.

A run is **reached** when at any poll at least one of: a sandbox of the project exists, a container of the project exists, an `attached` boot report for `kimi` was counted. Verdict per name `N`: **NEEDED** when the SA runs are reached and both minus-`N` runs are not reached; **NOT-NEEDED** when the SA runs are reached and both minus-`N` runs are reached; **UNDETERMINED** otherwise (including a disagreement between the two runs, or SA not reached, in which case reach cannot discriminate and the verdict falls back to a catalogue code in the stderr copy that names the missing variable, recorded as such). S0 is recorded as a fact (whether a real legacy user reaches the stack with nothing restored) and is not used by the per-name rule. A result says "needed for this non-default stack": the production scenario relocates the config home (E-47-06), so `XDG_CONFIG_HOME` may be needed here and not by a user with the default config location, and the record says which.

### D-47-07. What the recipe does with the result (KIMV-03; Plan 47-03)

- **E-A, needed and the client expands references** (the expansion probe classifies each reference spelling as the host's value): the `kimi` recipe value gains an `env` object holding only the needed names, each set to the reference spelling the probe proved (no value, no secret). The golden equals what the host's own writer produces when the writer probe returned, else the documented `mcp.json` shape (and the row says documented, not observed). `test/host/recipes-bare.test.ts` gains one allowed entry naming `kimi` and those exact names (a stale entry fails, as the existing allowance does), the contract page sentence is amended, the migration note says an existing install shows drifted until `realm host install kimi` is run again (the plan verifies the refresh behaviour in the recipe test harness before writing the note), and the commit subject carries `!`.
- **E-B, needed and the client does not expand references**: a static recipe cannot carry the user's values (E-47-08). The phase does not build a new recipe capability on its own authority: it records GAP-43-01 as accepted-residual with a named workaround (`kimi mcp add --env NAME=VALUE`, or editing the entry's `env` object, with the exact names) and raises Owner decision OD-47-1. Default without an answer: accepted-residual.
- **E-C, none needed** (all three NOT-NEEDED and S0 reached): GAP-43-01 closes as not needed with the dated evidence.
- **Mixed or UNDETERMINED**: GAP-43-01 is narrowed with the per-name verdicts and what would decide it; the recipe is not changed.

### D-47-08. What the registry and the documents say (KIMV-04)

The registry record of `kimi` states the tier reached with a dated note and never a stronger label than the evidence: a clean pass of the default production tier in the window (REPRODUCED false, or a fix or variant that passes) is `rehearsed` with the dated note and the earlier failure still named; a failure that stays is `gap` with a note starting `rehearsal failed`. A diagnostic variant (restore set, warm control) is recorded as a variant, never as the tier. `GAP-24-02` states the legacy half at the tier reached; `GAP-24-03` names the legacy production result; `GAP-43-03` and `GAP-43-01` carry the cause or the narrowing, the dated runs and the next step. A row is closed only with evidence cited in the same edit (the gap page's own rule), and a gap closed as "not reproduced" is not closed: it is narrowed.

### D-47-09. Hygiene constraints for every plan

- No host-local absolute path, user name, home directory, token, header value or environment value in any repository file; placeholders SCRATCH_DIR, EVIDENCE_DIR, REPO_CHECKOUT, IMAGE_DIGEST, DRIVER_CONFIG, DRIVER_SOCKET, RUNTIME_DIR and PODMAN5_BIN_DIR are never replaced by a real path (as in Phases 36 and 43). The run evidence holds names, counts, hashes, millisecond marks, ids and catalogue codes in the repository, and the full command output and server stderr only outside it.
- The scratch install is outside the repository, in a directory the `realmlive` account can read and run, with its package cache kept inside the same directory (`UV_CACHE_DIR`) so one removal takes everything; the scratch directory is removed by Plan 47-04 and its absence confirmed. If the phase stops earlier than Plan 47-04, the plan that stops it removes the scratch directory first.
- The live runs are serial, cold (no warm-up between the residue check and the run, no `realm up`, no probe), under the shared live lock, with the Phase 43 residue checks between runs and a before and after snapshot. A leftover is a finding, restored with one `realm down`, and the run that left it is recorded failed. No agent runs a live test; a person does, on the `realmlive` account.
- Nothing is patched in a window. A failed step is reported with its catalogue code and is not retried silently. A variant run is labelled and never relabelled as the tier.
- No model turn, no tool call, no credential in the shell (the credential-name count is zero, names never recorded).
- Terms: a run that did not finish inside its bound is recorded `did not return` with the marks it has; it is data, not a rerun trigger.

### D-47-10. Threat model (summary; each plan carries its STRIDE rows)

Tampering: a window run that edits the operator's real Kimi configuration (hash before and after, the rig and scenario homes are isolated). Information disclosure: evidence naming paths or environment values in the repository (the host-path check, names-only rule, evidence outside). Repudiation: a label stronger than the evidence, or a not-reproduced run recorded as a pass of the cause (D-47-01, D-47-08). Denial of service: a hung host command or a stack left running (bounds, process-group kill, residue checks, one `realm down`). Elevation of privilege: root-owned scratch binaries executed by `realmlive` (read and execute only, removed at the end). Contract drift: an `env` block that quietly relaxes CAPT-09 (the allowed names are exact and a stale entry fails).

## Canonical References

- `.planning/MILESTONE-CONTEXT.md`, `.planning/REQUIREMENTS.md` (KIMV-01 to KIMV-04), `.planning/ROADMAP.md` (Phase 47), `.planning/PROJECT.md`, `AGENTS.md`.
- `.planning/milestones/v6.0-phases/43-kimi-and-kimi-code-rehearsal/` (43-CONTEXT D-43-06, D-43-07, D-43-09, E-43-09, OQ-43-02, OQ-43-03; 43-02-PLAN window format; 43-02-SUMMARY; 43-VERIFICATION behavior_unverified 1 and 2).
- `docs/integration/host-plugin-gaps.md` (GAP-24-02, GAP-24-03, GAP-43-01, GAP-43-02, GAP-43-03), `docs/integration/wave1-boot-matrix.md`, `docs/integration/host-support-matrix.md` (generated block), `docs/integration/host-plugin-contract.md`, `docs/integration/hosts.md`, `docs/hosts/snippets/kimi.md`.
- `test/support/host-registry.ts`, `test/support/host-live.ts`, `test/support/host-live-session.ts`, `test/support/host-live-kimi.ts`, `test/support/cold-attach-probe.ts`, `test/support/production-live.ts`, `test/integration/host-live-kimi.test.ts`, `test/integration/host-live-kimi-helpers.test.ts`, `test/integration/host-live-session-helpers.test.ts`, `test/integration/cold-attach-live.test.ts`, `test/host/recipes-bare.test.ts`, `test/host/kimi-recipe.test.ts`, `test/support/host-contract.ts`.
- `src/mcp/server.ts`, `src/cli/stdio-host.ts`, `src/cli/stdio-settle.ts`, `src/daemon/spawn-env.ts`, `src/daemon/main.ts`, `src/runtime/host-paths.ts`, `src/host/runtimes.ts`.

## Existing Code Insights

- The wire recorder's pins are strict (`deepEqual` on parsed events, an exact file listing of the recorder directory): the timeline fields are additive and live in the log, and the old reader drops unknown fields and skips foreign kinds, so the old tests pass unedited. The new stderr copy writes to a path the caller names and adds no file to the recorder directory.
- The production runner is 1300 lines and not under the module-size gate (that gate covers `src` only), but new behaviour goes to new test-support modules (`host-live-evidence.ts`, `host-live-reach.ts`) with injected seams, so it is hermetically testable and the runner only calls them.
- `realm mcp` is stateless for `tools/list`; the attach is the only slow part and runs behind the server. A stall in the answer therefore needs a long synchronous stretch in the start path or a starved process; the timeline plus C2 and C3 separate those.
- The generated support matrix block is rewritten by `REALM_WRITE_HOST_MATRIX=1 node --test dist/test/docs/host-support-matrix.test.js`; the registry note and the wave 1 page are tied by test.

## Wave Structure

| Wave | Plan | Autonomous | What |
| --- | --- | --- | --- |
| 1 | 47-01 | yes | the timeline recorder, the frozen rules as code, the evidence and reach support, the variant switches, the two probes, the early-close characterization (test support only) |
| 2 | 47-02 | no | scratch reinstall, the owner-supervised window (controls, reproduction, ablation, probes), the dated record `47-WINDOW.md` |
| 3 | 47-03 | no | act on the cause and on the environment result: the `realm mcp` fix with a red-first test, a documented variant, the recipe `env` block or the accepted-residual, and the live re-run where a change was made |
| 4 | 47-04 | no | registry, gap rows, matrix, wave 1 page, snippet, contract page and checker agree; migration note; scratch removal; stack as found |

## Requirement coverage

| Requirement | Plans | Where it is met |
| --- | --- | --- |
| KIMV-01 | 47-01, 47-02 | the timeline recorder and classifier (47-01); the scratch reinstall, the dated run with the wire log and the full command output kept outside the repository, and the classification (47-02) |
| KIMV-02 | 47-01, 47-02, 47-03 | the frozen attribution rule and the characterization (47-01); the cause recorded (47-02); the fix with a test that fails without it, the documented variant, or the owner decision (47-03) |
| KIMV-03 | 47-01, 47-02, 47-03 | the ablation instrument and probes (47-01); the live ablation and probes (47-02); the recipe block, the accepted-residual or not needed (47-03) |
| KIMV-04 | 47-04 (all plans feed it) | the registry, gaps, matrix, wave 1 page, snippet, contract page and checker agree; scratch removed; stack as found |

## Open Questions (none blocks plan 47-01)

- **OQ-47-01 (unverified).** Does the legacy client expand `${NAME}` or `$NAME` in an `env` value? The expansion probe answers it (47-02); the answer selects E-A or E-B.
- **OQ-47-02 (unverified).** Does `kimi mcp add --env` return in the isolated home under the containment environment? The writer probe answers it; a hang is recorded and the golden then rests on the documented shape.
- **OQ-47-03 (unverified).** Where does the client's 18 s go? The C1 timeline gives its marks; no claim is made beyond them.
- **OQ-47-04 (person).** The window date, the person, the lock and the order (Plan 47-02 Task 2). The window may not open; then Plan 47-01 stands on its own, the tier stays as recorded on 2026-11-18, and the phase closes on the named blocker VOID with GAP-43-01 and GAP-43-03 unchanged except for the instrument noted.

## Owner decisions needed (none blocks planning or Plan 47-01; each has a default the plans follow if no answer arrives)

- **OD-47-1 (env values).** If the live ablation shows a name is needed and the legacy client does not expand variable references: choose (a) build an install-time capture of the installer's values into the entry (a new recipe capability, new drift semantics, a CAPT-09 amendment, work in its own phase), (b) accept GAP-43-01 as an accepted-residual with the documented manual workaround, or (c) retire the archived `kimi` row (OQ-43-03, OQ-24-01). **Default: (b).**
- **OD-47-2 (client cause).** If the cause is the legacy client and no documented variant passes the production tier: keep the `kimi` row at its failed tier with the cause recorded (default), demote its tier from `proven` to `config-only` as an archived product, or drop the row (HOST_IDS shrinks; many pins change; OQ-24-01). **Default: keep, cause recorded.**
- **OD-47-3 (not reproduced).** If the reproduction is NOT-REPRODUCED: accept the dated passes plus the standing 2026-11-18 failure as the closure of KIMV-02, or keep KIMV-02 carried because the cause was not established. **Default: carried; GAP-43-03 narrowed, never closed on this evidence.**
- **OD-47-4 (the window).** The date, the person and the lock mechanism of the window and, if one window cannot hold about fifteen cold runs on the shared host, whether to split it. **No default: without a window the phase records VOID.**
- **OD-47-5 (breaking marker).** If a recipe `env` block lands (E-A), confirm the `!` commit marker and the 0.7.x release note wording. **Default: `!` used.**

## Deferred Ideas

- A scripted provider that makes the legacy CLI call a Realm tool (GAP-31-02).
- A network capture of the two Kimi products in a production run (GAP-43-02).
- An install-time environment capture capability for recipes in general (the shared class of GAP-31-01 for Codex and GAP-43-01), if the owner chooses OD-47-1 (a).
- A second version of the legacy CLI (GAP-31-03).
</decisions>

## Text for the orchestrator

### ROADMAP.md, Phase 47 plan list

**Plans:** 4 plans

Plans:
- [ ] 47-01-PLAN.md: Timeline recorder, frozen classification and attribution rules as code, evidence and reach support, variant switches, the two probes and the early-close characterization (test support only)
- [ ] 47-02-PLAN.md: Scratch reinstall of kimi-cli 1.51.0 and the owner-supervised window: controls, reproduction with the logs kept, cause attribution, environment ablation and probes (the dated record 47-WINDOW.md)
- [ ] 47-03-PLAN.md: Act on the cause and the environment result: the realm mcp fix with a red-first test, a documented variant, the recipe env block or the accepted-residual, and the live re-run where something changed
- [ ] 47-04-PLAN.md: Registry, gap rows, support matrix, wave 1 page, snippet, contract page and checker agree; migration note; scratch removal; stack as found

### REQUIREMENTS.md

KIMV-01 to KIMV-04 are already registered and mapped to Phase 47 (Planned). They close only through the plans above: KIMV-01 through 47-02, KIMV-02 and KIMV-03 through 47-02 and 47-03 (a NOT-REPRODUCED or UNDETERMINED cause leaves KIMV-02 recorded as not met until the owner decides OD-47-3), KIMV-04 through 47-04.
