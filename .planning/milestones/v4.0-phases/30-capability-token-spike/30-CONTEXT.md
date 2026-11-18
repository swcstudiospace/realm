# Phase 30: Capability token spike - Context

**Gathered:** 2026-11-17, from the Phase 27 to 31 blocks of `.planning/ROADMAP.md`, the v4.0 section of `.planning/REQUIREMENTS.md` (CAPT-01), `docs/integration/anda-replacement-research.md` (section 5.1 table row "Capability tokens", section 5.6 peer credentials, section 5.7 "Capability tokens: Macaroons and Biscuit"), `src/host/{capabilities,manifest,types,host-audit,runtimes}.ts`, `src/daemon/{channel,client,daemon,host-boot,spawn-env}.ts`, `src/cli/stdio-host.ts`, `src/audit/{log,chain,redact}.ts`, `src/tools/dispatch.ts`, `src/contract/validate.ts`, `src/runtime/hardening.ts`, `src/session/paths.ts`, `AGENTS.md`, `package.json`, `scripts/spike/workspace-snapshot.mjs` (the one earlier spike script) and `docs/integration/workspace-snapshot-spike.md` (the one earlier spike note), all in the `v4` worktree at the start of milestone v4.0. Nothing was run while gathering.
**Status:** Planned (two plans, nothing executed). Requirement CAPT-01 is already registered in `.planning/REQUIREMENTS.md` and mapped to Phase 30 in the traceability table; the orchestrator closes it after verification. `.planning/ROADMAP.md` still shows Phase 30 with `Plans: 0 plans`; the orchestrator updates it.

<domain>
## Phase Boundary

Milestone v4.0 decisions fixed by the owner on 2026-11-17 and not reopened here: the Anda bridge is dropped entirely as a breaking change with no shim (Phase 28); MCP over stdio stays the transport for agent hosts; Realm is local and single-user only; the release line is 0.4.x; and this spike exists. The research note (section 1, item 4 and section 5.7) already concluded that no alternative beats a 0600 socket against a same-user attacker, that capability tokens have "real utility, little security", and gave the verdict "Spike, optional".

This phase turns that verdict into evidence. It answers one question and records one decision:

> **Is a per-session capability token, minted by the Realm daemon and presented by a stdio host on each tool call, worth building?** Worth is measured against two promised gains (least privilege per host; audit attribution of a verified principal) and one honest limit (a same-user process that can read the token passes).

Deliverables (CAPT-01):

1. **A design note**, `docs/integration/capability-token-spike.md`: the question, the threat model (malicious workload, same-uid reader, stdio host trust), the build-or-drop criteria **frozen before any result exists**, the candidates, the experiment results, the cost, the decision, and, only if the decision is BUILD, a proposed follow-up phase written as a proposal.
2. **A throwaway prototype** in `scripts/spike/capability-token/` (Node built-ins only, not under `src`, not in the package `files` list, not imported by anything), with experiments that produce numbers and refusals, not opinions.
3. **A recorded decision** with its evidence, registered in `docs/integration/runtime-decision.md` after the owner approves it.

Out of scope, stated so no task drifts into it:

- **No production code, in either outcome.** Nothing under `src/`, no policy-schema key, no new error code, no audit-line field, no recipe change, no doctor check, no change to the frozen tool schema. If the decision is BUILD, the build is a follow-up phase that the note proposes and the owner schedules; the executor does not add it to `ROADMAP.md`, `REQUIREMENTS.md` or `STATE.md`.
- No Streamable HTTP, no OAuth, no remote hosts (research section 5.2; revisit only on an owner decision for remote hosts).
- No in-process (`extension`) host. Omp loads Realm inside its own process (`integration: "extension"`), so a token held by the same process that holds everything else protects nothing; the note says so and the experiments cover `mcp-config` hosts only.
- No change to the 0600 control socket, the sandbox mount set, or the Anda removal.
- No per-model or per-prompt identity. A token names a host install, not the model operating it.
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below: source, read date 2026-11-17, tier)

Tiers: **Observed** = read in this repository on 2026-11-17; **Documented** = stated by `anda-replacement-research.md` citing an external source; **[INFERENCE]** = reasoning from those; **Open** = the spike must establish it.

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-30-01 | Every `mcp-config` host registers the bare launcher `{command: "realm", args: ["mcp", "--host", ID]}`; recipes carry no environment, and the installer records hashes and relative paths only, never file content. A token delivered by a recipe would be the first secret Realm writes into a host-owned file. | `src/host/manifest.ts` (`defaultManifestFor`), `docs/integration/host-plugin-contract.md` rows, `src/host/receipt.ts` | Observed |
| E-30-02 | The `--host` id is parsed by the CLI and reaches only the boot path: the boot manifest, the boot observer and the self-reported `host-boot` control method, whose audit lines go to the daemon-only `host-boot` chain as `HOST/TRANSPORT/PHASE`. The control request for a tool call is `{ tool, ...selection }`; the daemon calls `dispatcher.call(tool, { correlationId, upId })`. **No host or principal reaches the dispatcher or the per-session audit chain.** | `src/cli/stdio-host.ts`, `src/daemon/client.ts` (the `tool` request), `src/daemon/daemon.ts` (`case "tool"`), `src/daemon/host-boot.ts` | Observed |
| E-30-03 | A per-session audit file holds entries with `sessionId, tool, outcome, phase, path, bytes, sha256, execSummary, correlationId, upId`. There is no host, principal or token field. The format changes only by agreement (D-42); optional additive fields are the precedent (`correlationId`, `upId`). | `src/audit/log.ts` | Observed |
| E-30-04 | One session per workspace (`sessionIdOfWorkspace(canonicalPath)` takes only the path), one container per session. Two hosts configured for the same workspace share one session and one audit file, so today a `read` from Claude Code and a `write` from Cursor are indistinguishable there. | `src/session/paths.ts`, `AGENTS.md` | Observed |
| E-30-05 | The capability catalog has nine capabilities; an `mcp-config` host's ceiling is six (`daemon.attach`, `fs.read`, `fs.write`, `fs.list`, `exec.argv`, `exec.shell`). **All fifteen `mcp-config` default manifests request the same six**, so no per-host difference exists today. `resolveCapabilities` computes request AND policy, is pure, and is documented as "not an enforcement path"; its only consumer is the `capabilitiesDenied` posture log field. | `src/host/capabilities.ts`, `src/host/manifest.ts` (`MCP_CAPABILITIES`), `src/daemon/host-boot.ts` | Observed |
| E-30-06 | The tools are `exec`, `read`, `write`, `list`, `status`, `retry`. The dispatcher runs schema, state, lock, admission audit, execution, result audit, in that order, and is the only entry point. `exec` has an argv form and a shell form; the shell form is gated by `policy.shellEnabled`. | `src/contract/validate.ts` (`ToolParams`), `src/tools/dispatch.ts` | Observed |
| E-30-07 | The control socket is mode 0600 in a 0700 directory; there is no peer-credential check, and Node has no API for one. A same-uid process that can reach the socket path can call every tool the policy permits. | `AGENTS.md`, `src/daemon/channel.ts` (`SOCKET_MODE`), research section 5.6 | Observed, Documented |
| E-30-08 | The sandbox has exactly four mounts: the workspace (`/workspace`), a state directory (`/realm-state`), the channel directory (`/run/openshell/channel`) and one scratch volume. Whether the state directory mounted there is, or contains, the daemon state directory that holds the control socket, the audit chain and any key file is **not established**. | `src/runtime/hardening.ts` (`mounts.length === 4`, `HARDENING_PROFILE`) | Observed, **Open** |
| E-30-09 | The detached daemon inherits an environment allowlist of paths, digests and the log level, "never a credential". A signing key or token would be the first credential-class value the daemon or its clients hold. | `src/daemon/spawn-env.ts` | Observed |
| E-30-10 | Redaction has a key layer (key names matching token, secret, password, api key, authorization, cookie, credential, private key) and a value layer (`Bearer ...`, PEM private keys, `AKIA...`, `gh[pousr]_...`, `sk-...`). A value such as `rcap1.PAYLOAD.MAC` under a key not named like a secret matches none of them. A token format needs its own value pattern before it could ever be logged safely. | `src/audit/redact.ts` | Observed |
| E-30-11 | The research note's cheap variant: an HMAC-SHA256 token from `node:crypto` carrying host id, workspace root, allowed tools and expiry, with "one signature primitive and no caveat language". Biscuit's `@biscuit-auth/biscuit-wasm` 0.6.0 is a WebAssembly wrapper that needs `--experimental-wasm-modules` on Node; Macaroons have no maintained library ("paper only"). | `anda-replacement-research.md` section 5.7 | Documented, search-only |
| E-30-12 | The package ships plain Node (`engines.node` is 22.13.0 or later), with no flags and no native addon; `files` lists `adapters`, `dist/src`, the schemas and the docs listed there, so nothing under `scripts/` ships. | `package.json` | Observed |
| E-30-13 | Spike precedent: `scripts/spike/workspace-snapshot.mjs` takes a required `--work` throwaway directory, never defaults it, prints one JSON document, exits 0 / 1 / 2; its note `docs/integration/workspace-snapshot-spike.md` records the decision as D19-6 in `runtime-decision.md`. `eslint` covers `scripts/**/*.mjs` with the untyped preset; `tsconfig.json` does not include `scripts/`. | `scripts/spike/`, `eslint.config.js`, `tsconfig.json` | Observed |
| E-30-14 | `scripts/check/host-paths.mjs` scans `docs` and `.planning` for `/root/`, `/tmp/`, `/Users/` and `/home/` paths. Every note, plan and prototype output that lands in those trees uses placeholders (`SCRATCH`, `WORK`). | `scripts/check/host-paths.mjs` | Observed |
| E-30-15 | The roadmap makes Phase 30 depend on Phase 29 (MCP tool annotations). The annotation classes (read-only, destructive, idempotent, open-world) are the natural coarse capability profiles; the spike maps tools to capabilities and checks that mapping against whatever Phase 29 landed. | `.planning/ROADMAP.md` | Observed |

### D-30-01. The question, split into three answerable parts (CAPT-01)

| Part | Question | Answered by |
| --- | --- | --- |
| Q1 | Which attacker does a token stop that today's model (0600 socket, stdio lineage, policy in the daemon) does not, **demonstrated by an experiment**? | E3, E4, E5 (what a reader can obtain) and E1, E9 (what a token refuses) |
| Q2 | Can the token deliver the two gains the research names: least privilege per host and audit attribution of a verified principal, without a new self-declared label? | E2 (capability enforcement), E9 (label versus token), E-30-05 (no per-host difference exists today) |
| Q3 | What does it cost: new secret handling, delivery to the host, code and seams touched, a dependency, ergonomics? | E6, E7, E8, the delivery table D-30-06, the integration inventory of plan 30-02 |

### D-30-02. Time box and stop rule

The spike is two plans and one working session of prototype effort. The prototype (three files plus its self-checks) stays under 400 lines. **Stop rule:** if, when plan 30-01 Task 3 ends, no experiment has demonstrated a Q1 attacker the token stops (criterion M1), the answer is DROP and no further exploration happens: no second candidate is implemented, no extra delivery channel is tried. The time box is a decision input, not a courtesy: an unbounded spike on a "spike, optional" item is the failure to avoid.

### D-30-03. Build-or-drop criteria, frozen before any result exists

These are written into the note's section 3 by plan 30-01 Task 1, before any prototype code exists, and their text is hashed. Plan 30-02 Task 1 recomputes the hash before it writes results; a mismatch voids the decision and is reported, not fixed silently.

**Musts (all five required for BUILD):**

| ID | Criterion | Evidence that satisfies it |
| --- | --- | --- |
| M1 | **A real attacker is stopped.** At least one attacker class from the threat model, other than "same-uid process that can read the token at rest", is admitted today and refused with a token, shown by a recorded experiment. If the only attackers a token stops are ones the 0600 socket already stops, M1 fails. | An experiment row where the same reader is admitted without a token and refused with one |
| M2 | **No new standing secret in a host-owned file.** The delivery channel does not require Realm to write a token or key into a file the host owns (host config, host environment block) and does not change the bare-launcher recipes of D-25-07 for all fifteen hosts. | A delivery channel in D-30-06 that is admitted by this rule and survives E3 and E4 |
| M3 | **No new runtime dependency and no runtime flag.** Node built-ins only; no WebAssembly, no `--experimental-*`. | The candidate's dependency list and E7 |
| M4 | **Bounded integration.** The integration inventory fits one follow-up phase of at most three plans, leaves `src/contract/tools.schema.json` and every MCP reply shape unchanged, and adds no error code beyond the existing catalogue (a refusal is `POLICY_DENIED`). | The grepped inventory of plan 30-02 |
| M5 | **Fail closed, no silent weakening.** A missing, expired, malformed or mismatched token refuses; the token set can only narrow what the loaded policy grants (token AND policy, never OR); no verbose reason leaves the daemon. | E1, E2 |

**Shoulds (both required for BUILD; they are the reason to build):**

| ID | Criterion | Evidence that satisfies it |
| --- | --- | --- |
| S1 | **Attribution beats the label.** A verified host principal can be recorded per call, and a holder of host A's token cannot present itself as host B, where a plain self-declared label (candidate C1) can be spoofed by any caller. | E9 |
| S2 | **Least privilege is enforceable per host.** At least one realistic profile (read-only: `fs.read`, `fs.list`) denies `write` and `exec` for a host that holds it, and a token never widens the policy. | E2 |

**Decision rule, mechanical:**

- BUILD only if M1 to M5 and S1 and S2 are all met on recorded evidence.
- Otherwise DROP. A "not run" experiment is not "met".
- If the outcome is DROP and S1 is met by the plain label (C1) alone, the note records C1 as a separately costed, optional follow-up ("label attribution", no cryptography). It is not part of the drop decision and is not implemented here.
- S3 (informational, not a gate): revocation without editing host config, through key rotation by `kid`. Recorded from E8.

**Prior, stated so the result is not mistaken for a surprise:** [INFERENCE] the research already expects M1 to be hard (a same-uid reader of the token passes). The spike is built to make the likely DROP a measured one, and to leave BUILD possible only on evidence.

### D-30-04. Candidates

| ID | Candidate | Role in the spike | Measured how |
| --- | --- | --- | --- |
| C0 | None: keep today's model, document the limit | Baseline for M1 | Cost zero; E3 to E5 show what a reader gets today |
| C1 | Self-declared host label: the `--host` id carried in the `tool` request and recorded in the audit line, no signature | Control for S1: accounting without authentication | E9 shows it is spoofable by any caller |
| C2 | **HMAC token** from `node:crypto`, bound to session id, host id and capability set, with expiry and a key id | The one that is prototyped | E1 to E9 |
| C3 | Macaroon-style HMAC chain (holder-added first-party caveats) | Paper only: C2 plus about 25 lines; attenuation by the holder is not needed by any current host, since no host spawns a sub-host | Argument in the note; no prototype |
| C4 | Biscuit (`@biscuit-auth/biscuit-wasm`) | Paper plus one registry probe | E7: confirm on this machine whether the package needs `--experimental-wasm-modules` and what it pulls in; "not run" is recorded if the registry is unreachable |

### D-30-05. The C2 prototype token (one primitive, no caveat language)

- **Wire form:** `rcap1.` + base64url(payload bytes) + `.` + base64url(mac). Exactly three dot-separated parts. Base64url is decoded strictly (re-encode and compare).
- **Payload:** a JSON object with exactly the keys `v` (1), `kid` (1 to 16 chars of lowercase letters and digits), `sid` (a session id matching the audit module's safe pattern), `host` (a canonical `mcp-config` host id from the 19-id list), `caps` (sorted, unique, drawn only from the six `mcp-config` capabilities), `iat` and `exp` (integer seconds, `exp` minus `iat` at most 86400). Any other key, type or order violation refuses.
- **MAC:** HMAC-SHA256 over the ASCII bytes `realm-capt-v1`, one zero byte, then the payload bytes, with a 32-byte key chosen by `kid`; compared with `crypto.timingSafeEqual` after a length check.
- **Verification order (fixed so refusals are deterministic and testable):** format, key id known, MAC, payload schema, version, time window (60 s clock skew for `iat`), session binding, host binding, capability check. The prototype returns an internal reason name per refusal; a real build would collapse every reason into the single catalogue code `POLICY_DENIED` and log the reason class only.
- **No holder attenuation, no third-party caveats, no revocation list.** Revocation is expiry plus retiring a `kid` (E8).
- **Key:** `randomBytes(32)`, held in memory in the prototype and, for E3 only, written once to a mode 0600 file under the scratch work directory. Never printed.

### D-30-06. Delivery channels: how the token reaches `realm mcp --host ID`

The token is only as good as the path that carries it. The spike evaluates four, on paper plus E3 and E4, and applies M2:

| ID | Channel | Authenticates the requester? | At rest | Verdict input |
| --- | --- | --- | --- | --- |
| D1 | Written by `realm host install` into the host recipe (`env` block) | Yes, at install time (the owner ran it) | In a host-owned file, readable by any same-uid process, and changes the bare recipes of all fifteen hosts | Fails M2 |
| D2 | Token file under the daemon state directory, mode 0600, read by `realm mcp --host ID` at start | No: any same-uid process can read it and claim any host | On disk, same-uid readable (E3) | Adds no protection against a same-uid reader; keeps recipes bare |
| D3 | The daemon mints a token when `realm mcp --host ID` attaches (the existing `up` or `host-boot` moment) | **No**: the daemon cannot tell the real host from any process that says `--host cursor`; this is the self-declared label (C1) with a signature on top | None (in memory) | Authenticates nothing; reaches E9 only as a signed label |
| D4 | Inherited file descriptor from a supervising launcher | Would, but hosts spawn `realm mcp` themselves from a config line; Realm is not the launcher | None | Not available (host config owns the spawn) |

[INFERENCE] The crux the experiments must confirm or refute: the only moment Realm knows which host it is talking to is install time (D1), and the only place a secret survives between install and use is a file or an environment, both same-uid readable (E3, E4). If that holds, M1 and M2 cannot both be met and the outcome is DROP.

### D-30-07. Capability mapping used by the prototype

| Tool | Capability required |
| --- | --- |
| `read` | `fs.read` |
| `list` | `fs.list` |
| `write` | `fs.write` |
| `exec` argv form | `exec.argv` |
| `exec` shell form | `exec.shell` |
| `retry` | `daemon.attach` |
| `status` | none (read-only; always allowed to a valid token) |

[INFERENCE] The mapping is the spike's own and mirrors `CAPABILITY_FACTS`; Task 1 of plan 30-01 checks it against the annotation classes Phase 29 landed and writes any difference into the note. The enforced set is the intersection: a call is admitted only if the token grants the capability **and** the loaded policy grants it (`resolveCapabilities` semantics). Three profiles are exercised: `read-only` (`fs.read`, `fs.list`), `workspace-edit` (those plus `fs.write`) and `full` (all six).

### D-30-08. Prototype placement and hygiene

- Directory: `scripts/spike/capability-token/`, files `token.mjs` (mint and verify), `gate.mjs` (the in-process model of the daemon admission: tool to capability, token AND policy, an audit-line model), `run.mjs` (experiments E1 to E9, the CLI, the self-checks). Precedent: `scripts/spike/workspace-snapshot.mjs`.
- Node built-ins only. **No import from `src/` or `dist/`**: the prototype copies the capability names as literals so that it cannot be mistaken for, or become, production code.
- `run.mjs --work SCRATCH` requires an absolute scratch directory that does not exist or is empty, never defaults it, refuses a directory inside the repository or under the real home, and writes only inside it. One JSON document on stdout; the scratch path appears as the literal `WORK`; token and key values never appear, only lengths and the first 8 hex of a SHA-256.
- Not named `*.test.mjs`, so `npm run test:scripts` does not pick it up: it is evidence, not a permanent test.
- Retention: kept as evidence under the `workspace-snapshot.mjs` precedent. If the owner approves BUILD, the follow-up phase deletes it when its production module lands. The owner may ask for deletion on DROP.

### D-30-09. The experiments

All Linux, local, bounded. Each records: the expectation, the observation, the tier (Observed or Not run with the reason).

| ID | Experiment | Expectation | Feeds |
| --- | --- | --- | --- |
| E1 | Round trip and refusal matrix: valid token accepted; refused for tampered payload, tampered MAC, truncated MAC, wrong key, unknown `kid`, unknown version, extra payload key, wrong type, duplicate or unsorted or out-of-catalogue capability, `exp` past, `iat` beyond skew, lifetime over 86400, wrong session, wrong host, non-canonical base64url | Each refusal has its own reason; verification order holds; the valid token is accepted | M5, S1 |
| E2 | Capability enforcement: six tools times three profiles times policy with and without `exec.shell`/`fs.write`; shell-form versus argv-form exec; a token holding a capability the policy lacks | read-only denies `write` and `exec`; token never widens policy; shell form needs `exec.shell` | S2, M5 |
| E3 | Same-uid reader of a token at rest: a child writes a 0600 token file; a sibling process of the same uid reads it | Sibling reads it (the limit is real) | M1, M2 |
| E4 | Same-uid reader of a token in a process environment: a child holds the token in its environment; a non-descendant sibling reads `/proc/PID/environ`; record `ptrace_scope`, uid, and whether the read succeeds | Read succeeds for the same uid on a default Linux; the value is recorded as observed, not assumed | M1, M2 |
| E5 | Different-uid reader (runs only when the harness is root and uid 65534 exists): a child as that uid tries to open the 0600 token file and the 0700 directory | Refused by the kernel (EACCES); recorded as the case the socket already stops | M1 |
| E6 | Cost: token size for the three profiles; mint and verify median over 20000 iterations (informational, no threshold); prototype line count; dependency count | Under 400 bytes; verify in microseconds; zero dependencies | M3, M4 |
| E7 | Candidate C4 probe in a scratch directory outside the repository: `npm view` metadata, install with `--ignore-scripts`, import under the Node in use with and without `--experimental-wasm-modules`; separately read `src/audit/redact.ts` and record whether a token-shaped value is redacted today | Confirms or refutes the research's search-only claim; redaction gap per E-30-10 | M3, M4 |
| E8 | Rotation and revocation: two keys, retire the old `kid`, a token under the retired key refuses, a token under the active key is accepted | Revocation is key rotation by `kid` | S3 |
| E9 | Attribution, label versus token: two hosts share one session; calls recorded with (a) a self-declared label, (b) a verified token principal; host A's token presented with a claim of host B | The label is spoofable; the token refuses the claim | S1 |

### D-30-10. Recording the decision

- The note's section "Decision" states the outcome, the criteria table with each row met, not met or not run and the evidence reference, and the one-line reason.
- The owner approves it (checkpoint in plan 30-02). Only then is a decision entry added to `docs/integration/runtime-decision.md` (`D30-1`, dated, "Engineering decision, owner approved") and a one-line outcome added after the capability-token bullets of research section 5.7. Before approval the note's status line says "Recommendation, awaiting owner decision".
- BUILD adds a section "Proposed follow-up phase" to the note: goal, proposed requirement ids (a new CAPTB prefix, to be registered by the orchestrator), plan outline, the production files from the integration inventory, the default posture, the migration of the fifteen recipes if D1 is chosen, threat-model deltas and open questions. It is labelled "Proposed, not scheduled" and is not copied into `ROADMAP.md` or `REQUIREMENTS.md` by this phase.
- DROP adds a section "What is closed and what remains": the limit stated for users, the optional costed label (C1) if S1 is met by it, and the retention of the prototype.

### D-30-11. Hygiene and what the executor does not touch

No `src/`, `test/`, `adapters/`, `docs/` file other than the two named below, no `package.json`, no lockfile, no CI workflow. The only edited existing files are `docs/integration/runtime-decision.md` and `docs/integration/anda-replacement-research.md` (one line), both only after owner approval. No changelog entry: the release notes are generated from commits and the spike changes no packaged file; the commit type is `docs` or `chore`, never `feat` or `fix`.

### Threat model (summary; each plan carries its STRIDE rows)

Assets: the ability to call `read`, `write`, `exec`, `list` through the control socket; the integrity of the audit chain's attribution; the signing key; the host's own configuration.

| Actor | Capability | Today | What a token changes | What it cannot change |
| --- | --- | --- | --- | --- |
| **Malicious workload**: code inside the sandbox, plus what it writes into the workspace (files, symlinks, tool arguments) and the text it returns to the model | Runs under the Phase 19 mount set; has no route to the daemon control socket; can influence the model through tool results (prompt injection) | Cannot reach the socket; every effect goes through the dispatcher and the policy | Nothing directly. The key and every token must stay out of the four mounts and out of anything `exec` or `read` can return (E-30-08 is Open: whether the mounted state directory overlaps the daemon state directory); a token never enters the sandbox environment | A workload that never held the socket gains nothing from a token it cannot reach; a workload that tricks the model into a tool call is stopped, if at all, by policy and the host's consent prompts, not by a token the host already holds |
| **Same-uid reader**: any process of the owner's user (a package postinstall, another agent, a sub-sandboxed shell inside a host) | Reads 0600 files, the environment of other same-user processes through `/proc` (unless the process is non-dumpable), host configs, and can connect to the 0600 socket | Admitted: connects to the socket and calls every tool the policy allows | Possibly narrows a same-uid process that can reach the socket but cannot read the token (a process confined by its host's own sandbox) if the token is not at rest and not in a readable environment; E3 to E5 measure exactly this | A reader that can read the token at rest or in `/proc` passes (research section 5.7, [INFERENCE] confirmed or refuted by E3 and E4) |
| **Stdio host trust**: the host process that spawns `realm mcp`, sees stdin, stdout, its environment and its config | Full control of the stdio pipe and of the process Realm runs in; the model drives it | The host is trusted at the pipe; Realm cannot tell the host from the model operating it | Per-host narrowing: a host can be limited to a profile; audit can name the host install | It cannot narrow the model relative to the host (same principal); it cannot stop a compromised host from using what its own token allows; it authenticates possession, not identity |
| **Other configured host** (Cursor and Claude Code on one workspace) | Reads the other host's config as the same user | Equal footing | A holder of A's token cannot claim B (E9) | If tokens sit in host configs (D1) or a readable file (D2), B reads A's token |
| **Prompt-injected model** | Calls tools the host allows | Limited by policy only | A read-only profile for the host removes `write` and `exec` from the reachable set | Host-side tools outside Realm are untouched |

What the token would **give**: a verifiable host principal per call (attribution that a label cannot give), a per-host capability ceiling that is enforced rather than logged, expiry. What it **cannot give**: protection from a same-uid reader of the token, identity of the model or the prompt, a boundary between two hosts of the same user, anything for in-process (`extension`) hosts.

### Verification posture

The parent runs, after the plans land: `node scripts/spike/capability-token/run.mjs --work SCRATCH` (a fresh scratch directory; exit 0 means every expectation held, including that the same-uid limit was demonstrated), `npx eslint scripts/spike/capability-token`, `node scripts/check/host-paths.mjs`, and the plan 30-02 hash and diff checks. No build and no test suite is needed for the plans themselves: `git diff --name-only` must list only the files named in `files_modified`.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` Phase 30 (goal, dependency on Phase 29, requirement CAPT-01) and Phases 27 to 31; `.planning/REQUIREMENTS.md` v4.0 section (CAPT-01) and its traceability row.
- `docs/integration/anda-replacement-research.md`: section 1 item 4, section 5.1 table row "Capability tokens (Biscuit, Macaroons)", section 5.6 (peer credentials), section 5.7 "Capability tokens: Macaroons and Biscuit".
- `src/host/capabilities.ts`, `src/host/manifest.ts`, `src/host/types.ts` (`HostCapability`), `src/host/host-audit.ts`, `src/host/runtimes.ts`, `src/daemon/host-boot.ts` (where the host id is self-reported today).
- `src/daemon/{channel,client,daemon,spawn-env}.ts`, `src/cli/stdio-host.ts`, `src/tools/dispatch.ts`, `src/contract/validate.ts`.
- `src/audit/{log,chain,redact}.ts` (the audit chain and the redaction layers), `src/session/paths.ts`, `src/runtime/hardening.ts` (the four mounts).
- `docs/integration/{host-plugin-contract,mcp,hosts,workspace-snapshot-spike,runtime-decision}.md`; `scripts/spike/workspace-snapshot.mjs`; `scripts/check/host-paths.mjs`; `AGENTS.md` (control socket and settled decisions).
- Phase 29's landed annotation table (found by searching `src/mcp` for `readOnlyHint`); its location is not assumed here.
- Style precedent: `.planning/milestones/v3.0-phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/25-CONTEXT.md` and `25-03-PLAN.md`.
</canonical_refs>

<code_context>
## Existing Code Insights

- The host id is a boot-time label only. `defaultManifestFor(id, version)` builds the launch line; `createBootObserver({ hostId, ... })` reports it through the `host-boot` control method; `createHostBootRecorder` writes one metrics update, one log line and one audit line on a separate `host-boot` chain, and computes `capabilitiesDenied` from `resolveCapabilities(defaultManifestFor(hostId).capabilities, policy)`. That is the whole existing use of "host" and of the capability catalog.
- The tool path is `realm mcp` (`src/mcp/server.ts`, `createMcpServer`) to the daemon client (`src/daemon/client.ts`, request `tool`) to the channel (`src/daemon/channel.ts`, `CONTROL_METHODS`, frame validation with exact keys per method) to `case "tool"` in `src/daemon/daemon.ts` to `dispatcher.call`. A token would have to ride the `tool` request (a new key, so a new channel frame shape), be checked in the daemon (the only place the key can live), and be recorded by the dispatcher's audit lines. These are the seams the integration inventory in plan 30-02 counts.
- The audit line type `AuditEntryInput` accepts optional additive fields (`correlationId`, `upId`); the hash chain (`src/audit/chain.ts`) covers every line, so a principal field would be chained and verified by `realm audit verify` without chain changes. [INFERENCE] to confirm by reading `verifyAuditFile`.
- `SECRET_VALUE_PATTERNS` and `SENSITIVE_KEY_PATTERN` are the redaction layers; a token needs a value pattern (a fixed `rcap1.` prefix makes that one anchored expression).
- `daemonSpawnEnv` is an allowlist: a key could not reach the daemon through the environment without changing it, and should not.
- `test/support/host-live.ts` and the recipe suites show how hosts are rehearsed in an isolated `HOME`; the spike does not use them (no host CLI, no real configuration is touched).
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | What |
| --- | --- | --- |
| 1 | 30-01 | Note sections 1 to 4 with the frozen criteria; the C2 prototype and experiments E1 to E9; the recorded run |
| 2 | 30-02 | Verify the criteria were not edited; results, cost and integration inventory; apply the decision rule; decision, proposal or closure; owner checkpoint; registration |

Wave 2 depends on wave 1 only through files it produces. The plans modify disjoint files except the note, which 30-01 creates (sections 1 to 4) and 30-02 completes (sections 5 onward).

## Requirement IDs

| ID | Statement (from `.planning/REQUIREMENTS.md`) | Plans |
| --- | --- | --- |
| CAPT-01 | A spike answers whether a per-session capability token is worth building (threat model, same-user limits, cost) and records a build or drop decision with evidence | 30-01, 30-02 |

## Open Questions (owner decisions or unverified; none blocks planning)

- **OQ-30-01.** The decision itself. The plan produces a recommendation by the frozen rule; the owner approves or reverses it at the 30-02 checkpoint, as the research note requires ("a decision needs the owner and a new recorded decision ID").
- **OQ-30-02.** Wording of the roadmap goal: "no production code unless the decision is build". This phase writes no production code in either outcome; on BUILD the code is the proposed follow-up phase. The owner confirms that reading, and the orchestrator may reword the roadmap line. (This phase does not edit `ROADMAP.md`.)
- **OQ-30-03.** If BUILD: default posture. Opt-in per workspace policy (tokens unrequired unless enabled) versus mandatory for every host. Opt-in leaves an unauthenticated mode; mandatory changes every install. Proposal only.
- **OQ-30-04.** If DROP with S1 met by the label: whether the owner wants the label attribution (C1) scheduled at all. It carries a frozen audit-format change (additive optional field) and a new control frame key.
- **OQ-30-05.** E-30-08 (does the mounted state directory overlap the daemon state directory). Settled by plan 30-01 Task 1 step 4; if the daemon state directory is reachable from the sandbox, that is a finding about the existing audit and socket directory, reported to the owner as such, independent of this spike.
- **OQ-30-06.** [INFERENCE] Hosts that sandbox their own subprocesses (the research names none in this repository) are the only plausible Q1 attacker class. The spike emulates it with the different-uid reader (E5) and a non-descendant sibling (E4); it does not run any host's sandbox.

## Success Criteria (from the roadmap, made observable)

1. `docs/integration/capability-token-spike.md` exists with the question, three-actor threat model, frozen criteria (with the recorded hash), candidates, results, cost and decision.
2. `scripts/spike/capability-token/run.mjs --work SCRATCH` exits 0 and prints the nine experiments, with no token, key or host path in its output.
3. The decision is derived from the criteria table by the stated rule and approved by the owner; `D30-1` is registered.
4. `git diff --name-only` lists no file under `src/`, `test/`, `adapters/`, `package.json` or a lockfile.
</specifics>

<deferred>
## Deferred Ideas

- The token itself (production module, channel frame key, dispatcher check, audit field, install provisioning, doctor check, policy key): a follow-up phase, only on a BUILD decision.
- The plain host label attribution (candidate C1): a separate small phase, only if the owner asks after a DROP.
- Streamable HTTP with OAuth 2.1 and a resource-server-only design for remote hosts (research section 5.2).
- Peer credentials (`SO_PEERCRED`), file-descriptor passing, SPIFFE: no Node API, rejected by the research.
- Per-model or per-prompt identity; holder attenuation (C3) and third-party caveats.
- A token for `extension` hosts (Omp).
</deferred>
