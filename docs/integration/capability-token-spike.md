# Capability token spike (CAPT-01)

Date: 2026-11-17. Phase 30, plan 30-01 (sections 1 to 4) and plan 30-02 (sections 5 to 8). Prototype: `scripts/spike/capability-token/` (throwaway, not packaged, imports nothing from `src` or `dist`).

All paths below use the placeholders `SCRATCH` (the throwaway directory passed to the prototype) and `WORK` (how the prototype prints it). No host-local path appears in this note.

## 1. Question and scope

Question. Is a per-session capability token, minted by the Realm daemon and presented by a stdio host on each tool call, worth building? Worth is measured against two promised gains and one honest limit. The gains are least privilege per host and audit attribution of a verified principal. The limit is that a same-user process that can read the token passes.

The question is answered in three parts:

| Part | Question | Answered by |
| --- | --- | --- |
| Q1 | Which attacker does a token stop that today's model (0600 socket, stdio lineage, policy in the daemon) does not, shown by an experiment? | E3, E4, E5 (what a reader can obtain) and E1, E9 (what a token refuses) |
| Q2 | Can the token deliver the two gains, least privilege per host and attribution of a verified principal, without a new self-declared label? | E2 (capability enforcement), E9 (label versus token), and the fact that no per-host capability difference exists today |
| Q3 | What does it cost: new secret handling, delivery to the host, code and seams touched, a dependency, ergonomics? | E6, E7, E8, the delivery table in section 4, and the integration inventory written by plan 30-02 |

Scope. Hosts that integrate as `mcp-config` (a stdio process `realm mcp --host ID` that the host spawns). One local machine, one user, Linux.

Out of scope. No production code in either outcome: nothing under `src`, no policy key, no error code, no audit-line field, no recipe change, no doctor check, no change to the frozen tool schema. No Streamable HTTP, no OAuth, no remote host. No in-process host: Omp loads Realm inside its own process (`integration: "extension"`), so a token held by the same process that holds everything else protects nothing. No change to the 0600 control socket, the sandbox mount set or the Anda removal. No per-model or per-prompt identity: a token would name a host install, not the model operating it.

Time box and stop rule. The spike is two plans and one working session of prototype effort; the prototype (three files and their self-checks) stays under 400 lines. If, when the last experiment of plan 30-01 ends, no experiment has demonstrated an attacker class that the token stops (criterion M1), the answer is DROP and nothing further is explored: no second candidate, no extra delivery channel.

Hypothesis under test. The research note (`anda-replacement-research.md`, sections 1 and 5.7) concluded that capability tokens have real utility and little security, and gave the verdict "Spike, optional". Its reasoning that a same-user reader of the token passes is an [INFERENCE]. This spike treats that inference as the hypothesis the experiments test, not as a premise.

Status: Decided, 2026-11-17. Criteria outcome: DROP (M1 not demonstrated, M2 not met). Owner decision: override, BUILD (decision D30-1, section 8). The criteria and their readings are unchanged; the override is recorded beside them, not in place of them.

Criteria frozen: sha256 535b8cd6fc72b1acc606d4836a15e98196b3390ac58883dd4c69e8ae729e81c0 of section 3, recorded before any prototype code was written.

## 2. Threat model

Assets: the ability to call `read`, `write`, `exec` and `list` through the control socket; the integrity of the audit chain's attribution; the signing key; the host's own configuration.

| Actor | Capability | Today | What a token changes | What it cannot change |
| --- | --- | --- | --- | --- |
| Malicious workload: code inside the sandbox, plus what it writes into the workspace (files, symlinks, tool arguments) and the text it returns to the model | Runs under the Phase 19 mount set; has no route to the daemon control socket; can influence the model through tool results (prompt injection) | Cannot reach the socket; every effect goes through the dispatcher and the policy | Nothing directly. The key and every token must stay out of the four mounts and out of anything `exec` or `read` can return; a token never enters the sandbox environment | A workload that never held the socket gains nothing from a token it cannot reach. A workload that tricks the model into a tool call is stopped, if at all, by policy and the host's consent prompts, not by a token the host already holds |
| Same-uid reader: any process of the owner's user (a package postinstall, another agent, a sub-sandboxed shell inside a host) | Reads 0600 files and, unless a process is non-dumpable, the environment of other same-user processes through `/proc`; reads host configs; can connect to the 0600 socket | Admitted: connects to the socket and calls every tool the policy allows | Possibly narrows a same-uid process that can reach the socket but cannot read the token (a process confined by its host's own sandbox), if the token is neither at rest nor in a readable environment. E3 to E5 measure exactly this | A reader that can read the token at rest or through `/proc` passes (the research inference, confirmed or refuted by E3 and E4) |
| Stdio host trust: the host process that spawns `realm mcp`, sees its stdin, stdout, environment and config | Full control of the stdio pipe and of the process Realm runs in; the model drives it | The host is trusted at the pipe; Realm cannot tell the host from the model operating it | Per-host narrowing: a host can be limited to a profile; audit can name the host install | It cannot narrow the model relative to the host (same principal); it cannot stop a compromised host from using what its own token allows; it authenticates possession, not identity |
| Other configured host (Cursor and Claude Code on one workspace) | Reads the other host's config as the same user | Equal footing | A holder of host A's token cannot claim host B (E9) | If tokens sit in host configs or a readable file, host B reads host A's token |
| Prompt-injected model | Calls the tools the host allows | Limited by policy only | A read-only profile for the host removes `write` and `exec` from the reachable set | Host-side tools outside Realm are untouched |

What a token would give: a verifiable host principal per call (attribution that a label cannot give), a per-host capability ceiling that is enforced rather than logged, and expiry.

What it cannot give: protection from a same-uid reader of the token, identity of the model or the prompt, a boundary between two hosts of the same user, and anything for in-process (`extension`) hosts.

### Inventory facts (read-only grep and read, 2026-11-17, worktree at commit 63f89c0)

Preflight. `grep -rln readOnlyHint src` finds `src/mcp/protocol.ts` and `src/mcp/server.ts`: Phase 29 has landed on this branch, so the plan proceeds.

Observed, host label path (E-30-02). `--host` is parsed in `src/cli/stdio-host.ts` (`hostId`, lines 58, 96 to 114) and used as the label of the boot observer (`hostId: input.hostId ?? "unlabelled"`, line 135). In the daemon it appears only in `src/daemon/host-boot.ts` (lines 111 to 153: capability posture and the `HOST/TRANSPORT/PHASE` audit path). `grep hostId` over `src/daemon/daemon.ts`, `src/daemon/client.ts`, `src/daemon/channel.ts` and `src/tools/dispatch.ts` finds no match. The tool request is `request("tool", { tool, ...selected })` (`src/daemon/client.ts:199`); the daemon's `case "tool"` (`src/daemon/daemon.ts:627`) calls `dispatcher.call(tool, { correlationId, upId })` (line 644). No host or principal reaches the dispatcher or the per-session audit chain.

Observed, audit shape (E-30-03). `AuditEntryInput` (`src/audit/log.ts`, lines 41 to 54) has `sessionId, tool, outcome, phase, path, bytes, sha256, execSummary, correlationId, upId`; there is no host, principal or token field. Optional additive fields are the precedent (`correlationId`, `upId`).

Observed, chain coverage of an extra field. In `src/audit/chain.ts` the chain link is `prev`, the sha256 of the previous line's raw bytes (`prevRaw = sha256Hex(line)`, line 387; `sha256Hex` over the whole line, line 112 to 114), and a head pin compares `sha256Hex(line)` (line 326). The verifier interprets only `seq` and `prev` (`isChained`, lines 258 to 269; `acceptChainStart`, lines 452 to 455). So an additional optional field on a line is covered by the next line's `prev` hash and by head pins, and the verifier needs no change to accept it. This settles the [INFERENCE] in the context for the chain; the per-line size bound `AUDIT_LINE_MAX_BYTES` (4 MiB, line 22) still applies.

Observed, E-30-08 (does the sandbox's state mount overlap the daemon state directory). The mounted state directory is `join(stateRoot, sandboxName)` (`src/runtime/driver/sandbox-binding.ts`, `sandboxBindingOf`), mounted read-only at the state destination (`src/runtime/hardening.ts`, `mounts` check, `isMountOf(..., false)`). `sandboxStateRoot` defaults to `join(stateDir, "sandboxes")` (`src/runtime/config.ts`, `runtimeRootsOf`). The control socket is `join(stateDir, "run", "control.sock")` (`src/session/paths.ts:19`) and the audit files are under `join(stateDir, "audit")` (`src/audit/log.ts`). So by default the mounted directory is a per-sandbox child of the daemon state directory (`stateDir/sandboxes/NAME`), neither the same as nor a parent of `run/` or `audit/`. The channel directory (read-write) is under `secretDirOf(secretRoot, name)`, default `stateDir/secrets/NAME/channel`, also a child. Residual: `sandboxStateRoot` can be set in config, and `overlapProblems` (`src/runtime/config.ts`) compares it only with `secretRoot` and `workspaceRoot`, never with `stateDir`. A hand-written layout that puts `stateDir` inside `sandboxStateRoot/NAME` is therefore not refused by that check. The answer for the default derivation is: not the same, not a parent. The unusual explicit layout is not ruled out by the code. This is a standing observation independent of this spike; it is not a finding about any realistic layout.

Observed, E-30-05 count correction. The context says all fifteen `mcp-config` default manifests request the same six capabilities. In `src/host/runtimes.ts` the integration is `extension` only for `omp` (line 77), so all 18 other ids have an `mcp-config` default manifest (`defaultManifestFor`, `src/host/manifest.ts:216 to 235`), and every one requests the same six (`MCP_CAPABILITIES`, line 211). Fifteen of them carry an install recipe (16 table entries have a `recipe: {` object, one of which is `omp`); that is the source of "fifteen". The conclusion is unchanged: no per-host capability difference exists today.

## 3. Decision criteria (frozen)

Musts (all five required for BUILD):

| ID | Criterion | Evidence that satisfies it |
| --- | --- | --- |
| M1 | A real attacker is stopped. At least one attacker class from the threat model, other than "same-uid process that can read the token at rest", is admitted today and refused with a token, shown by a recorded experiment. If the only attackers a token stops are ones the 0600 socket already stops, M1 fails. | An experiment row where the same reader is admitted without a token and refused with one |
| M2 | No new standing secret in a host-owned file. The delivery channel does not require Realm to write a token or key into a file the host owns (host config, host environment block) and does not change the bare-launcher recipes of D-25-07 for all hosts. | A delivery channel in the section 4 table that is admitted by this rule and survives E3 and E4 |
| M3 | No new runtime dependency and no runtime flag. Node built-ins only; no WebAssembly, no `--experimental-*`. | The candidate's dependency list and E7 |
| M4 | Bounded integration. The integration inventory fits one follow-up phase of at most three plans, leaves `src/contract/tools.schema.json` and every MCP reply shape unchanged, and adds no error code beyond the existing catalogue (a refusal is `POLICY_DENIED`). | The grepped inventory of plan 30-02 |
| M5 | Fail closed, no silent weakening. A missing, expired, malformed or mismatched token refuses; the token set can only narrow what the loaded policy grants (token AND policy, never OR); no verbose reason leaves the daemon. | E1, E2 |

Shoulds (both required for BUILD; they are the reason to build):

| ID | Criterion | Evidence that satisfies it |
| --- | --- | --- |
| S1 | Attribution beats the label. A verified host principal can be recorded per call, and a holder of host A's token cannot present itself as host B, where a plain self-declared label (candidate C1) can be spoofed by any caller. | E9 |
| S2 | Least privilege is enforceable per host. At least one realistic profile (read-only: `fs.read`, `fs.list`) denies `write` and `exec` for a host that holds it, and a token never widens the policy. | E2 |

Decision rule, mechanical:

- BUILD only if M1 to M5 and S1 and S2 are all met on recorded evidence.
- Otherwise DROP. A "not run" experiment is not "met".
- If the outcome is DROP and S1 is met by the plain label (C1) alone, the note records C1 as a separately costed, optional follow-up ("label attribution", no cryptography). It is not part of the drop decision and is not implemented here.
- S3 (informational, not a gate): revocation without editing host config, through key rotation by `kid`. Recorded from E8.

Prior, stated so the result is not mistaken for a surprise: [INFERENCE] the research already expects M1 to be hard (a same-uid reader of the token passes). The spike is built to make the likely DROP a measured one, and to leave BUILD possible only on evidence.

## 4. Candidates

| ID | Candidate | Role in the spike | Measured how |
| --- | --- | --- | --- |
| C0 | None: keep today's model, document the limit | Baseline for M1 | Cost zero; E3 to E5 show what a reader gets today |
| C1 | Self-declared host label: the `--host` id carried in the `tool` request and recorded in the audit line, no signature | Control for S1: accounting without authentication | E9 shows it is spoofable by any caller |
| C2 | HMAC token from `node:crypto`, bound to session id, host id and capability set, with expiry and a key id | The one that is prototyped | E1 to E9 |
| C3 | Macaroon-style HMAC chain (holder-added first-party caveats) | Paper only: C2 plus about 25 lines. Attenuation by the holder is not needed by any current host, since no host spawns a sub-host | Argument in this note; no prototype |
| C4 | Biscuit (`@biscuit-auth/biscuit-wasm`) | Paper plus one registry probe | E7: confirm on this machine whether the package needs `--experimental-wasm-modules` and what it pulls in; "not run" is recorded if the registry is unreachable |

C2 token format (a spike artefact, not a design for production). Wire form: `rcap1.` then base64url(payload bytes), a dot, base64url(mac); exactly three dot-separated parts, base64url decoded strictly (re-encoded bytes must equal the input). Payload: a JSON object with exactly the keys `v` (1), `kid` (1 to 16 lowercase letters and digits), `sid` (a session id matching the audit module's safe pattern), `host` (one of the host ids that integrate as `mcp-config`), `caps` (sorted, unique, drawn only from the six `mcp-config` capabilities), `iat` and `exp` (integer seconds, `exp` minus `iat` at most 86400). Any other key, type or order violation refuses. MAC: HMAC-SHA256 over the ASCII bytes `realm-capt-v1`, one zero byte, then the payload bytes, with a 32-byte key chosen by `kid`, compared with `crypto.timingSafeEqual` after a length check. Verification order, fixed so refusals are deterministic: format, key id known, MAC, payload schema, version, time window (60 s clock skew for `iat`), session binding, host binding, capability check. The prototype returns an internal reason name per refusal; a real build would collapse every reason into the single catalogue code `POLICY_DENIED`. No holder attenuation, no third-party caveats, no revocation list: revocation is expiry plus retiring a `kid` (E8). The key is `randomBytes(32)`, held in memory, and written once to a 0600 file under `SCRATCH` for E3 only; it is never printed. The token authenticates possession, not identity.

Delivery channels: how the token would reach `realm mcp --host ID`. The token is only as good as the path that carries it. Four channels are read against criterion M2, on paper plus E3 and E4:

| ID | Channel | Authenticates the requester? | At rest | M2 reading |
| --- | --- | --- | --- | --- |
| D1 | Written by `realm host install` into the host recipe (an `env` block) | Yes, at install time (the owner ran it) | In a host-owned file, readable by any same-uid process; changes the bare recipes of every host | Fails M2 |
| D2 | Token file under the daemon state directory, mode 0600, read by `realm mcp --host ID` at start | No: any same-uid process can read it and claim any host | On disk, same-uid readable (E3) | Keeps recipes bare; adds no protection against a same-uid reader |
| D3 | The daemon mints a token when `realm mcp --host ID` attaches (the existing `up` or `host-boot` moment) | No: the daemon cannot tell the real host from any process that says `--host cursor`; this is the self-declared label (C1) with a signature on top | None (in memory) | Authenticates nothing; reaches E9 only as a signed label |
| D4 | Inherited file descriptor from a supervising launcher | Would, but hosts spawn `realm mcp` themselves from a config line; Realm is not the launcher | None | Not available: host config owns the spawn |

[INFERENCE] The crux the experiments must confirm or refute: the only moment Realm knows which host it is talking to is install time (D1), and the only place a secret survives between install and use is a file or an environment, both same-uid readable (E3, E4). If that holds, M1 and M2 cannot both be met and the outcome is DROP.

Capability mapping used by the prototype (the spike's own; it mirrors `CAPABILITY_FACTS` and `resolveCapabilities` request AND policy in `src/host/capabilities.ts`):

| Tool | Capability required |
| --- | --- |
| `read` | `fs.read` |
| `list` | `fs.list` |
| `write` | `fs.write` |
| `exec` argv form | `exec.argv` |
| `exec` shell form | `exec.shell` |
| `retry` | `daemon.attach` |
| `status` | none (read-only; always allowed to a valid token) |

The enforced set is the intersection: a call is admitted only if the token grants the capability and the loaded policy grants it. Three profiles are exercised: `read-only` (`fs.read`, `fs.list`), `workspace-edit` (those plus `fs.write`) and `full` (all six).

Comparison with the Phase 29 annotation classes (`TOOL_ANNOTATIONS`, `src/mcp/server.ts:126 to 168`; hints only, "no code reads them"). Phase 29 marks `read`, `list` and `status` read-only and idempotent; `write` destructive and idempotent; `exec` destructive, open-world and not idempotent; `retry` not read-only, not destructive, idempotent. The mapping above treats exactly `read` and `list` as plain `fs.read` and `fs.list`, and `status` as no capability; none of these is marked other than read-only by Phase 29, so no tool the mapping treats as a plain read is marked otherwise. Two differences are recorded as notes, and Phase 29's table is not changed. First, `retry` maps to `daemon.attach`, which no read-only profile holds, so a read-only token denies `retry`; Phase 29 agrees (`readOnlyHint: false`), but it also marks `retry` non-destructive, a distinction the capability model does not express. Second, Phase 29 has one annotation row for `exec`, while the capability model splits it into `exec.argv` and `exec.shell`; the annotation takes the broader value, the capability model takes the policy-dependent one. Neither difference changes a result of this spike.

## 5. Experiments and results

Every row below is copied from the recorded run of plan 30-01 (`.planning/phases/30-capability-token-spike/30-01-SUMMARY.md`, section "Recorded run"). Environment of the run: Linux 6.8 on one machine, Node v24.18.0, harness uid 0, `ptrace_scope` 1, uid 65534 present, run date 2026-11-17, scratch directory SCRATCH (printed as WORK by the prototype). Nothing was re-run to improve a result. The observations cover this one kernel and this one Node version (accepted residual R-30-01).

| Experiment | Expectation | Observed | Tier | Feeds |
| --- | --- | --- | --- | --- |
| E1 refusal matrix | Each defect refuses with its own reason in the fixed order; the valid token is accepted | 26 rows, 0 mismatches; reasons seen: accepted, bad-mac, bad-payload, bad-version, capability-not-granted, format, time-window, unknown-kid, wrong-host, wrong-session; token length 194, digest prefix 5a8e74c9 | Observed | M5 |
| E2 capability enforcement | read-only denies write, both exec forms and retry; a token never widens the policy; shell form needs exec.shell | 6 profile and policy pairs, 0 mismatches against the mapping; read-only allows read, list, status and denies the rest with capability-not-granted; full under a policy without fs.write and exec.shell gets write=policy-denied, exec-shell=policy-denied, exec-argv=allow | Observed | M5, S2 |
| E3 same-uid read at rest | A same-uid sibling process reads a 0600 token file | sibling obtained the token for the harness uid (root) and for uid 65534; digest prefixes equal (887086a8; e2cb12dc); file mode 600 | Observed | M1, M2 |
| E4 same-uid read of the environment | A same-uid, non-descendant sibling reads the token from `/proc/PID/environ` on a default Linux | sibling obtained the token for the harness uid and for uid 65534; digest prefixes equal (3e7087b4; 5ee11392); `ptrace_scope` 1 | Observed | M1, M2 |
| E5 different uid | The kernel refuses another uid with EACCES or EPERM (the case the 0600 socket already stops) | open of the token file: EACCES; uid 65534 could stat WORK, the e5 directory and the directory itself; the token path was the first refused level | Observed | M1 |
| E6 cost | Under 400 bytes; verify in microseconds; zero dependencies | token bytes: read-only 194, workspace-edit 209, full 264; mint 20.6 us, verify 23.67 us (median of 20000); 62, 38 and 299 lines (399 in total, the 299 being the experiment harness); 0 dependencies, 2 relative imports | Observed | M3, M4 |
| E7 (a) redaction | A `rcap1` value under key `note` is not changed by the value layer; under key `token` it is redacted by the key layer | value layer changes the token-shaped value: false; value layer changes a real minted token: false; key layer redacts key `token`: true, key `note`: false; assignment layer redacts an environment-style assignment: true; `Bearer` plus the value is redacted: true; the patterns match the text of `src/audit/redact.ts`: true | Observed | M3, build requirements |
| E7 (b) Biscuit | Registry reachable; the flag needed on this Node is measured, not assumed | `@biscuit-auth/biscuit-wasm` 0.6.0, Apache-2.0, `engines.node` at least 22.0.0, no `dependencies` key, 1 package, 2.5 MB. Node v24.18.0: import exits 0 with and without `--experimental-wasm-modules`, with an ExperimentalWarning. Node v22.13.0: without the flag exit 1, `ERR_UNKNOWN_FILE_EXTENSION` for `.wasm`; with the flag exit 0 | Observed (manual probe, outside the repository) | M3 |
| E8 revocation | Revocation is key rotation by kid: a retired kid refuses, the active kid is accepted | k1 token before retiring: accepted; after retiring k1: unknown-kid; k2 token: accepted | Observed | S3 |
| E9 label versus token | The self-declared label is spoofable; a token claim that does not match the token refuses | label line recorded host claude for a cursor caller (spoofed: true); cursor token claiming claude: wrong-host; valid cursor call recorded host cursor with kid k1; the line does not contain the token. Limit recorded: a holder of the claude token presented as claude is admitted | Observed | S1 |

No row is "Not run": every experiment ran and every `ok` was true.

Differences from the plan text and what they mean. No experiment's outcome differed from its stated expectation, so there is no surprise to explain. Three deviations are recorded as they were. First, the children of E3 and E4 received the token from the harness (standard input for the file holder, the child environment for the environment holder) instead of minting it, because uid 65534 cannot read the repository; the holder and the reader are still separate processes and the reader is not a descendant of the holder. Second, the harness runs as root, and root bypasses file modes, so the harness-uid variants of E3 and E4 alone would prove nothing; the uid 65534 variants (added beyond the plan) are the real non-root same-uid pair, and both obtained the token. Third, E7 (b) is a manual shell sequence; the first attempt to get Node 22.13.0 through `npx` timed out, and the tarball route replaced it.

What E3 to E5 mean for M1. The token was obtained by a same-uid reader at rest (E3) and from the process environment (E4), and was refused to another uid only by the kernel's file modes (E5), which is the case the 0600 socket already stops. No row shows the same reader admitted without a token and refused with one. E1 and E9 show what a token refuses (a malformed token, a wrong claim, a wrong host); they do not show an attacker class that today's model admits and a token stops.

## 6. Cost and integration inventory

### 6 (a) Prototype cost (E6)

- Token size: 194 bytes (read-only), 209 (workspace-edit), 264 (full).
- Time, median of 20000 iterations on this machine: mint 20.6 us, verify 23.67 us.
- Prototype size: 399 lines in three files (`token.mjs` 62, `gate.mjs` 38, `run.mjs` 299); the harness is three quarters of it.
- Dependencies: 0 (Node built-ins only), no runtime flag.

### 6 (b) Candidate C4 and redaction (E7)

Biscuit (`@biscuit-auth/biscuit-wasm` 0.6.0, Apache-2.0, `engines.node` at least 22.0.0, no declared dependencies, a WebAssembly module of 2.5 MB installed): on the repository's Node floor 22.13.0 the import fails without `--experimental-wasm-modules` and works with it; on Node 24.18.0 it works unflagged but emits an ExperimentalWarning. Only these two Node versions were tried. The research claim (the wasm wrapper needs the flag) is therefore confirmed on 22.13.0, observed here and no longer search-only. C4 fails M3 (a WebAssembly dependency and, on the floor, a runtime flag) and was not pursued. C3 (macaroon-style chain) stays paper only: no current host spawns a sub-host, so holder attenuation is not needed.

Redaction (E7 a): the existing value patterns do not change a `rcap1.` token, so a token that ends up under an innocuous key is written to an audit line unredacted; the key layer and the assignment layer catch it only under a sensitive key or an environment-style assignment. A build therefore needs a value pattern for the `rcap1.` prefix, and a redaction test that fails without it.

### 6 (c) Delivery channels (M2)

| ID | Channel | Reading under M2 | Evidence |
| --- | --- | --- | --- |
| D1 | Written by `realm host install` into the host recipe | Fails: a standing secret in a host-owned file, and it changes the bare recipes of every host; readable by any same-uid process | E3 (file read by a same-uid sibling) |
| D2 | Token file under the daemon state directory, 0600 | Keeps recipes bare and writes nothing into a host-owned file, but any same-uid process reads it and claims any host: does not survive E3 | E3 |
| D3 | The daemon mints at attach, kept in memory | Writes no file and leaves the recipes bare, but authenticates nothing: the daemon cannot tell the real host from any process that says `--host cursor` (a signed label, C1 plus a signature); nothing is at rest for E3 or E4 to read, and nothing identifies the requester | E9 (limit), E3, E4 (no at-rest secret to read) |
| D4 | Inherited file descriptor from a launcher | Not available: the host's config owns the spawn | Section 4 |

M2 reading: no channel is both admitted by the rule and meaningful against the attacker class of M1. D1 breaks the rule, D2 fails E3 and E4, D3 passes the rule only by authenticating nothing, D4 does not exist. Not met.

### 6 (d) Integration inventory (estimate from reading the code, not from building it)

Read-only greps and reads on 2026-11-17 at commit 63f89c0, for the cheapest channel (D3, daemon mints in memory). The count is an estimate and is labelled so (accepted residual R-30-03).

| Seam | File and lines | What a token build would change | Frozen contract touched |
| --- | --- | --- | --- |
| Tool request frame (server side) | `src/daemon/channel.ts` 17 (`CONTROL_METHODS`), 113 (`hasExactKeys`), 163 (the `tool` frame carries `tool` beside the selection) | accept and validate one optional token key on the `tool` frame | The control request frame, an additive optional key (internal protocol, not the tool schema) |
| Tool request (client side) | `src/daemon/client.ts` 199 (`request("tool", { tool, ...selected })`) | attach the token to each tool request | no |
| Daemon dispatch seam | `src/daemon/daemon.ts` 627 (`case "tool"`), 644 (`dispatcher.call`) | verify the token before dispatch, apply token AND policy, refuse with `POLICY_DENIED`; hold the key and the per-session token registry | no |
| Mint at attach | `src/daemon/host-boot.ts` 111 to 153 (the host-boot recorder knows the host id and the policy) | mint the token at the existing attach moment | no |
| Stdio process | `src/cli/stdio-host.ts` 58, 96 to 114 (host id), 135 (boot observer label), 293 and 318 (`driver.call` is what the MCP server invokes) | obtain the token and hand it to the client; `src/mcp/server.ts` itself is unchanged (it only calls the driver, line 275) | no |
| Dispatcher context | `src/tools/dispatch.ts` 100 to 142 (`CallScope`: `correlationId`, `upId`), 267 to 272 (audit base) | carry the verified principal (host, kid) with the call scope | no |
| Audit line | `src/audit/log.ts` 41 to 54 (`AuditEntryInput`), 78 to 100 (`appendAudit`) | two additive optional fields, `host` and `kid` (precedent: `correlationId`, `upId`); the chain covers an extra field by the next line's `prev` hash and the verifier reads only `seq` and `prev`, so it needs no change (`src/audit/chain.ts` 112 to 114, 258 to 269, 326, 387, 452 to 455); `src/audit/reconcile.ts` parses a line with `JSON.parse` (146) and was not found to reject unknown fields | The audit line format, additive optional fields |
| Redaction | `src/audit/redact.ts` 15 (`SENSITIVE_KEY_PATTERN`), 21 (`SECRET_VALUE_PATTERNS`), 35 (assignment pattern) | one value pattern for the `rcap1.` prefix | no |
| Policy posture | `src/core/policy.schema.json` (`additionalProperties` false), `src/contract/validate.ts` 33 to 34, `docs/policy-reference.md` | one optional key for the posture (see OQ-30-03 in section 8); `scripts/check/default-mode.mjs` scans prose for any claim about which mode is the default and needs no change | `src/core/policy.schema.json`, an additive optional key (`core/` is the frozen shared-contract directory per AGENTS.md) |
| Capability resolution | `src/host/capabilities.ts` 121 (`resolveCapabilities`) | reused as is for the token-and-policy intersection | no |
| Doctor | `src/doctor/host-checks.ts` 110 (`hostPluginsCheck`) | a check for the key file mode, a stale kid and a token present in a host config | no |
| New module | (new) `src/daemon/capability-token.ts`, and key custody (new file or inside it) | mint, verify, key and kid handling, rewritten and tested rather than copied from the spike | no |
| Manifests, recipes, receipts | `src/host/manifest.ts` 211 and 230, `src/host/recipe.ts`, `src/host/install.ts`, `src/host/receipt.ts` | none under D3: the 18 `mcp-config` manifests all request the same six capabilities, and the recipes stay bare launchers | no |
| Docs | `docs/integration/host-plugin-contract.md`, `hosts.md`, `mcp.md`, `docs/policy-reference.md` | describe the principal, the posture and the limit | no |

Totals (estimate):

- Production files to change: 13 (11 existing: `channel.ts`, `client.ts`, `daemon.ts`, `host-boot.ts`, `stdio-host.ts`, `dispatch.ts`, `log.ts`, `redact.ts`, `policy.schema.json`, `validate.ts`, `host-checks.ts`; 2 new: the token module and its key custody).
- Test files to add or change: about 10 (8 changed: `test/daemon/channel.test.ts`, `client.test.ts`, `daemon.test.ts`, `host-boot.test.ts`, `test/audit/log.test.ts`, `redaction.test.ts`, the doctor host-checks test, the policy validation test; 2 new: the token module test and the capability-enforcement test).
- Frozen contracts touched: 3, all additive and optional: the `tool` control frame key, the audit line fields `host` and `kid`, and one optional `policy.schema.json` key. Not touched: `src/contract/tools.schema.json`, every MCP reply shape, the recipes and the receipt.
- New error codes: 0 (a refusal is `POLICY_DENIED`, which exists in `src/core/errors.ts`).

M4 reading: yes. About 13 production files and about 10 test files fit one follow-up phase of three plans, leave `src/contract/tools.schema.json` and every MCP reply shape unchanged, and add no error code. The three additive contract changes are listed for the owner and are not the tool schema or an MCP reply shape, which is what M4 names.

## 7. Decision

Criteria outcome: DROP. Owner decision: override to BUILD, 2026-11-17 (section 8). The two are recorded separately; the criteria below and their readings are as derived and are not edited.

The criteria are copied from section 3 (IDs and statements), with the Reading and Evidence columns added.

| ID | Criterion | Reading | Evidence |
| --- | --- | --- | --- |
| M1 | A real attacker is stopped: at least one attacker class other than "same-uid process that can read the token at rest" is admitted today and refused with a token, shown by a recorded experiment | Not met | E3 and E4: a same-uid reader obtains the token at rest and from the environment (root and uid 65534); E5: only a different uid is refused, by file modes, which the 0600 socket already stops; no row shows a reader admitted without a token and refused with one |
| M2 | No new standing secret in a host-owned file; the delivery channel does not change the bare recipes for all hosts | Not met | Section 6 (c): D1 fails the rule, D2 fails E3 and E4, D3 authenticates nothing, D4 is unavailable; no channel is both admitted and meaningful |
| M3 | No new runtime dependency and no runtime flag | Met | E6 (C2: 0 dependencies, Node built-ins) and E7 (b) (C4 would fail; C2 is the candidate) |
| M4 | Bounded integration: at most three plans, tool schema and MCP replies unchanged, no new error code | Met (estimate) | Section 6 (d): about 13 production files, about 10 test files, 0 new codes |
| M5 | Fail closed, no silent weakening: a missing, expired, malformed or mismatched token refuses; token AND policy, never OR | Met | E1 (26 rows, 0 mismatches), E2 (6 pairs, 0 mismatches). The clause "no verbose reason leaves the daemon" has no experiment, since the prototype has no daemon; the build carries it as a test (every refusal maps to the same `POLICY_DENIED` reply) |
| S1 | Attribution beats the label: a verified principal per call, and a holder of host A's token cannot present itself as host B | Met in the prototype | E9: label spoofed, token claim mismatch refused with wrong-host, valid call recorded host cursor with kid k1. Limit: possession, not identity (a holder of the claude token passes as claude) |
| S2 | Least privilege is enforceable per host, and a token never widens the policy | Met | E2 |
| S3 (informational) | Revocation by key rotation by kid | Observed | E8 |

Rule (frozen): BUILD only if M1 to M5, S1 and S2 are all met; a not-run experiment is not met. Readings: M1 and M2 are not met. Outcome by the rule: DROP.

Reason: no recorded experiment shows an attacker class that a token stops and today's 0600 socket plus policy does not, and no delivery channel is both admitted by M2 and meaningful against a same-uid reader. This agrees with the prior stated in section 3 (the research expected M1 to be hard); the prior is now measured. S1 is not met by the plain label alone (candidate C1), because E9 shows the label is spoofable, so the optional label follow-up named in the decision rule does not apply.

The owner reviewed the result on 2026-11-17 and overrode the criteria outcome with a BUILD (section 8). The BUILD is an owner decision against the rule, not a result of it.

Freeze check: the sha256 of section 3 recomputed before this section was written equals the recorded value 535b8cd6fc72b1acc606d4836a15e98196b3390ac58883dd4c69e8ae729e81c0.

## 8. Follow-up or closure

### Owner override (decision D30-1, 2026-11-17)

On 2026-11-17 the owner reviewed the result and explicitly overrode the criteria outcome (DROP), directing a BUILD. This is recorded as an owner override: the criteria outcome in section 7 stays DROP, and no criterion or reading was edited. The criteria the override does not satisfy, accepted by the owner's direction and named here: M1 (no attacker class that a token stops and today's model admits was demonstrated) and M2 (no delivery channel is both admitted by the rule and meaningful against a same-uid reader). No reason text accompanied the direction, so none is recorded beyond it. The decision is registered as D30-1 in `docs/integration/runtime-decision.md`.

### What the build does not give

Any process of your user that can read the token, or the environment or memory of the process that holds it, can act as that host. A token authenticates possession, not identity, and says nothing about the model or the prompt. E3 and E4 measured this on one Linux kernel and Node v24.18.0: a same-uid reader obtained the token from a 0600 file and from `/proc/PID/environ`. Realm's boundary against your own user stays the 0600 control socket and the policy. Under channel D3 a same-uid process that can start `realm mcp --host OTHER` is also given the token of OTHER, so a per-host ceiling holds against a process that does not choose its host id (a prompt-injected model driving a host's one stdio process), not against a same-uid process that does. The build adds per-host least privilege and verified attribution inside that limit; it adds no defence against a same-uid reader, and a host that runs in the same process as Realm (`extension`, Omp) is out of its reach.

### Proposed follow-up phase (proposed, not scheduled, not in the roadmap)

Name as proposed by the owner: Phase 32, capability tokens for stdio hosts. Scheduling, the phase number and the requirement registration belong to the orchestrator; this plan edits none of the roadmap, state or requirements files, and nothing here is implemented.

Goal. A per-session, per-host HMAC token, minted by the daemon, is verified before every dispatched tool call; a missing, expired, malformed or mismatched token fails closed together with the loaded policy (token AND policy); the audit line records the verified host and key id; the token never reaches a log; the key can be rotated; the doctor checks the key and the absence of a token in host config.

Proposed requirement ids (new prefix, to be registered by the orchestrator): CAPTB-01 mint and verify before dispatch, fail closed, token AND policy; CAPTB-02 audit attribution of the verified host and key id; CAPTB-03 redaction of the `rcap1.` prefix and key rotation by kid; CAPTB-04 doctor check and documentation of the limit.

Delivery channel. D3: the daemon mints the token at the existing attach moment (the host-boot path) and the stdio process keeps it in memory. It writes no file, changes no recipe (none of the 18 `mcp-config` manifests or their recipes migrate) and adds no standing secret in a host-owned file. It does not authenticate the requester; that is the limit above, stated, not hidden. D1 and D2 are not chosen.

Plan outline (at most three plans, from the section 6 inventory):

| Plan | Content | Tests that prove it |
| --- | --- | --- |
| 32-01 | Token module and key custody (new files), the `tool` frame key in `channel.ts` and `client.ts`, minting in `host-boot.ts`, verification and token-AND-policy in `daemon.ts` before `dispatcher.call`, the token handed over in `stdio-host.ts`, `POLICY_DENIED` for every refusal | A table-driven refusal matrix equal to E1; capability enforcement equal to E2; every refusal maps to the same reply (M5 clause) |
| 32-02 | Audit attribution (`host`, `kid` through `CallScope` and `appendAudit`), the redaction value pattern for `rcap1.`, key rotation by kid | An audit-attribution test equal to E9; a redaction test that fails without the pattern (E7 a); a rotation test equal to E8 |
| 32-03 | The policy posture key (`policy.schema.json`, `validate.ts`), the doctor check, the documentation and the removal of `scripts/spike/capability-token/` once the production module lands | A policy-validation test; a doctor test; the default-mode check stays green; a documentation test for the limit text |

Default posture (OQ-30-03), two options for the owner: opt-in per workspace policy (tokens not required unless the key enables them; leaves an unauthenticated mode) or mandatory for every host (no unauthenticated mode; every install and every stdio attach changes). The owner's phrase "fail-closed with policy" is satisfied in both by the token-AND-policy rule; the posture only decides whether an absent token is refused by default. The phase's first task is to ask the owner to choose.

Frozen-contract changes the owner must approve in the phase, all additive and optional: the `tool` control frame key, the audit line fields `host` and `kid`, and one optional policy key. `src/contract/tools.schema.json` and every MCP reply shape stay unchanged.

New threat-model rows the phase adds to the design note: token and key custody in the daemon process memory and state directory; a token in the stdio process environment visible to a same-uid reader (E4); the signed-label limit of D3 (E9).

Open questions: where the host-to-profile mapping lives (a default per host id in code, or in policy); whether the token lifetime follows the session or is capped at 86400 seconds as in the prototype; whether `status` should require a token at all.

The throwaway prototype `scripts/spike/capability-token/` stays in place until the production module lands and is removed in plan 32-03; it is not packaged and is imported by nothing.
