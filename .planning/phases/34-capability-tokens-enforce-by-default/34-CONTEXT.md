# Phase 34: Capability tokens enforce by default - Context

**Gathered:** 2026-11-18, from a fresh read of branch `gsd/v5-plan` at commit 2159258 (release line 0.4.15, the v5.0 milestone start): `src/capability/{admit,gate,keyring,token,limiter}.ts`, `src/core/{policy,errors}.ts`, `src/core/policy.schema.json`, `src/contract/validate.ts`, `src/daemon/{daemon,client,channel,ensure}.ts`, `src/cli/{main,stdio-host,host}.ts`, `src/host/{attach,boot-driver,types}.ts`, `src/omp/extension.ts`, `src/acp/agent.ts`, `src/mcp/{protocol,server}.ts`, `src/doctor/{checks,capability-checks}.ts`, `docs/policy-reference.md`, `docs/integration/{mcp,runtime-decision,host-plugin-contract,host-plugin-gaps}.md`, `AGENTS.md`, `README.md`, the shipped `adapters/`, the Phase 32 record (`.planning/milestones/v4.0-phases/32-capability-tokens-for-stdio-hosts/`), and the test tree named in D-34-09.
**Status:** Planned (three plans, nothing executed). Requirement ids ENF-01 to ENF-04 are already in `.planning/REQUIREMENTS.md` (v5.0). This phase does not edit ROADMAP, STATE or REQUIREMENTS.
**Depends on:** Phase 33 (clients must connect on a cold start before enforcement matters). Phase 33 re-shapes `src/cli/stdio-host.ts` and `test/support/host-live.ts`; plan 34-02 anchors its one edit in `stdio-host.ts` by symbol (the `call` seams handed to the MCP server and to `runAcpOverStdio`), never by line number, and is executed on the tree that contains Phase 33.

<domain>
## Phase Boundary

Flip the default of the policy key `capabilityTokens.mode` from `off` to `enforce`, as a recorded breaking change (owner decision D-v5-3, 2026-11-18). Everything the Phase 32 build already does stays: the token format, the keyring, the gate, the client, the audit attribution, the rotation verbs. What changes is which posture a daemon has when the policy says nothing about it:

- A policy file with no `capabilityTokens` key, a policy file whose `capabilityTokens` object has no `mode`, and a missing policy file all load as `enforce`.
- `"capabilityTokens": { "mode": "off" }` is the documented opt-out and restores the 0.4.x behaviour exactly.
- A stale client (a `realm mcp` or `realm acp` binary from before Phase 32, or any process that speaks the control socket without `capability-attach`) and an unlabelled client (`realm mcp` with no `--host`) are refused with `POLICY_DENIED`, and the refusal is explained on every channel that can carry text without a new error code (D-34-05).
- Every client class the repository ships attaches under the default with no policy edit and a test per class proves it (D-34-06, D-34-07).

### What this phase does NOT change

1. The security claim. Enforce by default gives no defence against a process of the same user that can read the token, the process environment, process memory or the key file (the Phase 30 and 32 limits; the owner restates it in the v5.0 context). Phase 35 measures the memory-read claim and records it either way. Nothing here upgrades the claim; the documents keep the same first paragraph.
2. The wire. No new control method, no new request or reply member, no new error code (the catalogue stays at 29 codes), no change to `src/contract/tools.schema.json`, to `ToolOutcome` or to any MCP or ACP reply shape (D-32 constraints stand).
3. The token, keyring, gate verdict order, audit fields, redaction pattern, `realm host token` verbs, and the 18 default manifests and 15 recipes (they already launch `realm mcp --host ID`; `test/host/recipes-bare.test.ts` pins that).
4. `docs/specs/realm-spec.xml` (Phase 37 only), `CHANGELOG.md` and version fields (release-owned), `LICENSE`, `NOTICE`, `release/milestone.json` (the owner already approved the one-line v5.0 change).
5. `src/daemon/daemon.ts` (986 lines, limit 1000): no edit. All new daemon-side logic lives in `src/capability/gate.ts`, which the daemon already builds at one line (daemon.ts line 321).
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact: source, read date 2026-11-18, tier)

Tiers: **Observed** = read in this repository today; **[INFERENCE]** = reasoning from observed facts, not run.

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-34-01 | The schema default of `mode` is `"off"`; `capabilityTokens` itself and `profiles` default to `{}`. Defaults are applied by ajv (`useDefaults: true`) on a clone inside `validate()`. | `src/core/policy.schema.json` lines 43 to 62; `docs/policy-reference.md` lines 5 to 8 | Observed |
| E-34-02 | A missing policy file returns `validate("policy", {})`; a present file is parsed and validated, so a file with no `capabilityTokens` key gets the schema default. No code in the loader names `capabilityTokens`. | `src/core/policy.ts` lines 38 to 48 | Observed |
| E-34-03 | The default exists in three places: the schema, `DEFAULT_POLICY` in `capabilityPolicyOf` (hand-built `Policy` literals that omit the optional member), and `NO_POLICY` in the doctor item (no policy path). All three say `off`. | `src/capability/admit.ts` lines 13 to 18 and 63 to 65; `src/doctor/capability-checks.ts` line 43; schema line 47 | Observed |
| E-34-04 | The gate exists only when the mode is `enforce` (`createCapabilityGate` returns `undefined` otherwise). The keyring is created lazily by the first `attach` (`keyring(true)`), never on the verify path. The daemon builds the gate once, at start, from the policy it loaded once. | `src/capability/gate.ts` lines 56 to 92; `src/daemon/daemon.ts` lines 216, 319 to 321 | Observed |
| E-34-05 | In the daemon's `tool` case a tokenless request under a gate is refused `{ id, error: { code: "POLICY_DENIED" } }` after target resolution; `capability-attach` under no gate answers `{ mode: "off" }`. `status`, `up`, `down`, `metrics`, `doctor` and `host-boot` are not token-gated. | `src/daemon/daemon.ts` lines 629 to 647, 706 to 721 | Observed |
| E-34-06 | A client built without `host` never attaches and sends no token. A client built with `host` attaches on its first `call`; a `SCHEMA_INVALID` answer to `capability-attach` (an older daemon) is read as mode off. A new client against an old running daemon therefore works; an old client against a new daemon is refused. | `src/daemon/client.ts` lines 186 to 311 | Observed |
| E-34-07 | The only code paths that send a `tool` request are the boot driver's `daemon.call` (used by `realm mcp`, `realm acp`, through `createDaemonAttach` with `host` taken from `--host`) and Omp's attach (`host: "omp"`). The other `connectDaemon` users (`realm checkpoint` at `src/cli/checkpoint.ts:208`, the liveness probe at `src/cli/main.ts:825`) call `status`, `up`, `down` or `metrics` only. No CLI command issues a tool call. `src/realm/compose.ts` builds an in-process dispatcher with no socket and no token, by design. | `src/host/boot-driver.ts` lines 526 to 553; `src/cli/stdio-host.ts` lines 159 to 180, 295, 320; `src/omp/extension.ts` lines 78 to 96; `src/cli/checkpoint.ts`; `src/cli/main.ts` | Observed |
| E-34-08 | A refused `ToolOutcome` carries `outcome`, `tool`, `code`, `retryable` and an optional `causeCode`, and the MCP result for it is the JSON of that outcome with `isError` true; no reason text is on the wire or in the outcome. `toolErrorResult` prints `code: reason` only for a thrown `RealmError`. The catalogue reason of `POLICY_DENIED` is "The active policy denies this operation."; tests assert only that a reason is non-empty and equals the catalogue entry. | `src/mcp/protocol.ts` lines 102 to 127; `src/core/errors.ts` lines 128 to 131; `test/core/errors.test.ts` lines 128 to 130 | Observed |
| E-34-09 | `HOST_IDS` has 19 entries and `--host` accepts only the 18 `mcp-config` ids. None of `muse-code`, `prime-agent`, `grok-build` is an id. | `src/host/types.ts`; `src/cli/main.ts` lines 93 to 131 | Observed |
| E-34-10 | Shipped launchers that are NOT labelled today: `adapters/claude-plugin/.mcp.json` (`args: ["mcp"]`), `adapters/hermes-agent/mcp.json` and `mcp.snippet.yaml`, `adapters/muse-code/mcp-settings.snippet.json`, `adapters/prime-agent/MCP.md`; and the doc snippets `docs/hosts/snippets/claude-code.md` (lines 128, 146), `grok-build.md` (line 45), `hermes-agent.md` (lines 152, 166), `muse-code.md` (line 35), `prime-agent.md` (line 19), `qwen.md` (line 19), and `README.md` lines 258 to 261. The recipes and default manifests are labelled and pinned. `scripts/check/mcp-smoke.mjs` already spawns `realm mcp --host claude`. | the files named; `test/host/recipes-bare.test.ts`; `scripts/check/mcp-smoke.mjs` line 245 | Observed |
| E-34-11 | `test/host/claude-recipe.test.ts` line 177 pins that the installer never touches `adapters/claude-plugin` (a tree hash taken before and after); no test pins the bundle's `.mcp.json` content. `scripts/check/pack-smoke.mjs` lists the adapter files by path only. | those files | Observed |
| E-34-12 | The daemon's `ensure` has no version or build check, and the daemon holds the policy it loaded at start until it stops. A package upgrade therefore leaves an old detached daemon in its old posture until it restarts. A stop (SIGTERM) removes the container within about 30 s and leaves workspace files unchanged (`omp-lifecycle-runbook.md` line 81). | `src/daemon/ensure.ts`, `src/daemon/main.ts`; `docs/integration/omp-lifecycle-runbook.md` | Observed |
| E-34-13 | The release changelog drops a commit scoped `planning` or a `chore(release)` commit unless its subject carries `!`; a `!` subject is kept, grouped by its type. The release note text is the commit subject. A pull request whose commits are individually meaningful lands as a merge commit; a squash merge uses its title as the one entry. | `scripts/release/changelog.mjs` lines 24 to 26, 84 to 89; `CONTRIBUTING.md` line 49; `AGENTS.md` lines 118 to 128 | Observed |
| E-34-14 | `daemon.ts` is 986 lines; the module-size gate is 1000 and its allowlist is empty. `stdio-host.ts` is 336 lines, `main.ts` 922. | `wc -l`; `scripts/check/module-size.mjs` | Observed |
| E-34-15 | The test rigs that wrap `connectDaemon` forward two arguments only, so the `host` option is dropped: `test/support/boot-matrix-rig.ts` lines 232 to 267 (`hangingUp`, `flakyConnect`) and `test/integration/host-boot-isolation.test.ts` lines 203 to 216. `test/support/realm-daemon-fixture.ts` writes `{ mode, workspaceRoots }` with no `capabilityTokens` key (line 72) and hands out `connectDaemon(socket, selection)` with no host (line 130). | those files | Observed |
| E-34-16 | The doctor item returns `fail` for a missing keyring (class `missing`), `pass` for mode `off` with no profiles, `warn` for `off` with profiles. It never prints a policy value. | `src/doctor/capability-checks.ts` lines 55 to 66, 119 to 196 | Observed |

### D-34-01. The default flips; the value space does not change

`mode` stays `"off" | "enforce"`. The schema default becomes `"enforce"`. `ttlSeconds` (3600) and `profiles` (`{}`) are unchanged. The opt-out value is `"off"` (the v5.0 context default; no new value such as `"disabled"`). No per-workspace or per-host opt-out: the policy is one document per daemon (E-34-04), and a per-host off would defeat the least-privilege point.

### D-34-02. One default, read in one place (ENF-01)

Three copies of the default exist today (E-34-03). After the flip there is one definition that the others share:

- The schema default is the source of truth for validated policies.
- `src/capability/admit.ts` exports `DEFAULT_CAPABILITY_POLICY` (mode `enforce`, `ttlSeconds` 3600, empty `profiles`, frozen). `capabilityPolicyOf` returns it for a hand-built literal that omits the member. The doctor imports it and its private `NO_POLICY` is deleted. A test pins `DEFAULT_CAPABILITY_POLICY` deep-equal to `validate("policy", {})` so the two cannot drift.
- `Policy.capabilityTokens` stays optional in the type. Making it required would touch the 21 hand-built `Policy` literals of unrelated tests for no behavioural gain; the one reader (`capabilityPolicyOf`) already applies the default.

A hand-built literal that omits the member therefore means enforce, the same as a file that omits it: the safe reading, and the only one that keeps "absent means the default" true everywhere.

### D-34-03. Missing file and missing key load as enforce; the loader does not change

`loadPolicyFileDetailed` already returns the schema defaults for a missing file and for a file without the key (E-34-02). No loader edit is needed; the change is the default value. A test proves each of the four shapes (no file; `{}`; `{ "capabilityTokens": {} }`; `{ "capabilityTokens": { "ttlSeconds": 120 } }`) yields `mode` `enforce`, and `{ "capabilityTokens": { "mode": "off" } }` yields `off`. `realm init` does not write a `capabilityTokens` key into the policy file it generates: the default flows from the schema, and an init-generated file stays byte-identical (a test already pins it).

### D-34-04. The keyring is created when the daemon starts under enforce, and the doctor treats a not-yet-created keyring as normal

Today the first `attach` creates the keyring (E-34-04). Under a default that is on for every install this has two bad effects: `realm doctor` on a fresh install reports `fail` (E-34-16: missing is a fail), and a keyring that cannot be created shows up only as an unexplained `POLICY_DENIED` on a host's first call.

- `createCapabilityGate` ensures the keyring once, at construction, through the existing race-safe `ensureKeyring` (create-exclusive, 0700 directory, 0600 file, no symlink, owner check). On success it logs one `capability.keyring_ready` line (active kid only). On a keyring failure it logs one `capability.keyring_unavailable` line at error level with no detail and still returns the gate: every attach and every verify then refuses `POLICY_DENIED` (fail closed, as today), and the doctor names the failure class. The daemon does not refuse to start, because a daemon that cannot serve any tool call is no better and `status`, `up`, `down` and `doctor` must keep working so the operator can see why. Daemon start itself is not changed (no edit in `daemon.ts`).
- The verify path still never creates the file. Lazy creation at the first attach stays as the recovery path when the file is removed while the daemon runs.
- Doctor: a missing keyring under enforce is no longer a `fail`. It is a `warn` that says the daemon creates the keyring when it starts and names `realm host token rotate` as the manual creation; the guard classes (symlink, owner, mode, too large, unreadable, malformed, under the sandbox state root) remain `fail`. Rationale: before the first daemon start the keyring legitimately does not exist, and a `fail` on every fresh install would train operators to ignore the item.

### D-34-05. What a stale or unlabelled client sees: existing `POLICY_DENIED`, text on every channel that can carry it

The wire stays `{ error: { code: "POLICY_DENIED" } }` with no reason (D-32-03 stands; a reason on the wire would help an attacker probe and would need a reply-shape change). A stale client prints whatever its own catalogue says for `POLICY_DENIED`; that binary cannot be changed. What this phase adds, all with the existing code:

1. **Catalogue reason.** The reason of `POLICY_DENIED` becomes: "The active policy denies this operation, or the caller holds no valid capability token (capability tokens are enforced by default; run realm doctor)." Every current client then prints a clear sentence wherever it prints a catalogue reason (a thrown refusal at attach, `toolErrorResult`, a CLI refusal). A test pins that the text names capability tokens and `realm doctor`; the other catalogue tests are unchanged.
2. **A one-time diagnostic from `realm mcp` and `realm acp`.** A new module `src/host/refusal-hint.ts` wraps the `call` seam of the stdio host. On the first refused outcome with code `POLICY_DENIED` in a process it writes one line to the diagnostics stream (stderr, which hosts show in their MCP server logs) and never again. Two texts, chosen by whether the process has a host id:
   - no `--host` (unlabelled): says the session carries no capability token, that capability tokens are enforced by default, and the two fixes: add `--host ID` to the launcher (`realm host list` names the ids) or set `capabilityTokens.mode` to `off`; it names `docs/integration/mcp.md` Q10.
   - with `--host`: says the daemon refused the call with `POLICY_DENIED`; if the policy is not the cause, the key was revoked or rotated (reconnect the host), the token expired, or the host profile lacks the capability (`capabilityTokens.profiles`); it names `realm doctor`.
   The line carries no token, key, path or policy value, and it is written even at the default log level (it is a refusal the operator must see), once per process.
3. **The doctor item** (D-34-08) carries the same guidance in its detail.
4. **The daemon log** already has one `capability.refused` line per refusal with the internal class (`format` for a tokenless call); no change.

Not done, and why: no text in the refused `ToolOutcome` or in the MCP result (frozen shapes, E-34-08); no new error code (the catalogue has 29, costly to change); no causeCode trick (a cause must be a real catalogue code and would mislead).

### D-34-06. Every shipped client attaches under the default (ENF-02)

Client classes and what proves each (plan 34-03; all against a real daemon over a real socket with a policy file that has no `capabilityTokens` key):

| Class | Entry | Proof |
| --- | --- | --- |
| stdio MCP host, all 18 `mcp-config` ids | `realm mcp --host ID` (`runCli`) | a `status` tool call per id answers the active state; the audit file has one `capability.attach` line per id with that `host` and a `kid`, and the result lines carry both |
| ACP | `realm acp --host ID` | one tool call over ACP stdio completes; same audit fields |
| Omp | `createDaemonAttach` configured exactly as `src/omp/extension.ts` configures it (`connect: connectDaemon`, `host: "omp"`), and one call through the attach | the call completes; the attach line has host `omp` |
| `realm mcp` unlabelled | `realm mcp` with no `--host` | refused `POLICY_DENIED`, the one-time diagnostic of D-34-05 is written once, no dispatcher admission, no effect |
| stale client | a raw tokenless `tool` frame (the exact frame a pre-Phase-32 `DaemonClient` sends) | `{ id, error: { code: "POLICY_DENIED" } }`, zero admissions |
| CLI | `realm status`, `realm checkpoint`, the doctor, the liveness probe | still work with no token (E-34-05, E-34-07) |
| opt-out | the same policy plus `"mode": "off"` | the tokenless frame and the unlabelled `realm mcp` are admitted; no keyring is created; no capability audit line |

There is no CLI tool-call client (E-34-07), so "CLI tool calls" has no entry beyond the status-class commands above.

### D-34-07. Shipped launchers and the id-less hosts (judgement call; see OQ-34-01)

A launcher the repository ships must not be refused by the default the repository sets. Therefore:

- `adapters/claude-plugin/.mcp.json` becomes `args: ["mcp", "--host", "claude"]`. The same bundle serves Grok Build (it reads Claude plugins), so a Grok Build session is attributed `claude`; the label is a self-declared attribution (D-32-02) and the docs say so.
- `adapters/hermes-agent/mcp.json` and `mcp.snippet.yaml` become `["mcp", "--host", "hermes"]`; the `docs/hosts/snippets` copies and the qwen and claude-code command lines follow (`--host qwen`, `--host claude`).
- Muse Code, Prime Agent and Grok Build have no host id (E-34-09). Giving them ids means three runtime-table rows, three manifests (the 18 pinned manifests would change) and a host-support-matrix change, which is outside this phase. Their shipped snippets therefore stay unlabelled, and each snippet and `docs/integration/host-plugin-gaps.md` (new row GAP-34-01, class `accepted-residual`) say: under the default these sessions are refused; set `capabilityTokens.mode` to `off`, or launch with the `--host` id of the host family you accept as the attribution label. This is exactly D-v5-3's "unlabelled clients are refused", with the fix named. It is not silent.
- A new guard test (`test/host/adapters-labelled.test.ts`) reads every shipped adapter launcher and every `realm mcp` command line in `docs/hosts/snippets` and `README.md`: each is either labelled with a valid `mcp-config` id or belongs to the named set of three id-less hosts. A future bare launcher fails the test.

### D-34-08. Doctor (ENF-03)

The item keeps its id `capability-tokens` and its position (last; the list order is costly to change). New behaviour:

| Situation | Status | Detail and fix |
| --- | --- | --- |
| enforce (explicit or default) and a valid keyring | `pass` | as today, plus one sentence: "a client refused POLICY_DENIED with no other cause is stale or unlabelled: upgrade it, add --host ID to its realm mcp launcher, or set capabilityTokens.mode to off" |
| enforce and no keyring yet | `warn` | "the keyring is created when the daemon starts"; fix: start the daemon, or run realm host token rotate |
| enforce and a failing guard class | `fail` | unchanged |
| `off` (explicit, no profiles) | `warn` | "capability tokens are off: a caller that reaches the control socket is admitted without a token (the opt-out of the 0.5 default)"; fix: remove capabilityTokens.mode, or set it to enforce once every client is labelled |
| `off` with profiles | `warn` | unchanged text (profiles have no effect) |
| policy cannot be loaded | `warn` | unchanged |

Does the doctor warn when the mode is off? Yes (answers the question in the assignment): an opt-out is a deliberate downgrade, so it is visible in `realm doctor` every time, like the existing off-with-profiles case; it is a `warn`, not a `fail`, so a deliberate opt-out never fails the doctor. The doctor still never prints a policy value, a key, a token or a path outside the state directory.

### D-34-09. Test and fixture impact (ENF-01, ENF-02)

The flip turns every real daemon started from a default policy into an enforcing daemon. The impact is classified here; the executor's flip probe (plan 34-01 task 1) is authoritative and this table is its prediction.

**Class A, tests that pin the old default (updated in plan 34-02 with the flip):**

| File | What it pins | Update |
| --- | --- | --- |
| `test/core/policy.schema.test.ts` (lines 37, 175 to 188, 254 to 258) | defaults `off`; schema default `"off"` | expect `enforce`; add the four-shape load matrix of D-34-03 |
| `test/core/policy.test.ts` (line 48) | loaded defaults include `mode: "off"` | expect `enforce` |
| `test/core/policy.property.test.ts` (lines 26, 46, 58, 111, 249) | generators and expected defaults for `capabilityTokens` | follow the schema; no hard-coded `off` default |
| `test/capability/admit.test.ts` (lines 129, 132) | `capabilityPolicyOf` default is off | expect `DEFAULT_CAPABILITY_POLICY` (`enforce`); add the equality pin with `validate("policy", {})` |
| `test/capability/gate.test.ts` (line 77 to 84 and any row that starts a gate and expects no keyring before the first attach) | gate exists only for enforce; lazy keyring | explicit `off` row stays; add eager-creation rows (D-34-04) |
| `test/doctor/capability-checks.test.ts` (lines 81 to 97, 128 to 135, 214, 244 to 262) | off passes; missing keyring fails | off warns; missing keyring warns; add the default-enforce rows |
| `test/doctor/checks.test.ts`, `host-checks.test.ts`, `control-channel.test.ts`, `runtime-checks.test.ts`, `test/daemon/e2e.test.ts` (lines 299 to 316) | the item's position and the daemon report; any all-pass expectation | probe; update only the expected status of the item |
| `test/cli/host-token.test.ts` (lines 39, 119) | `status` with no policy prints mode `off` | expect `enforce` |
| `test/daemon/capability-wire.test.ts` (lines 363 to 378) and `test/daemon/capability-e2e.test.ts` (lines 135 to 162) | "default policy means off, tokenless admitted, no keyring, no capability line" | rename to the explicit `"mode": "off"` policy; add the default-policy-is-enforce counterpart |
| `test/support/capability-harness.ts` (line 28 comment and the `RigOptions` default) | absent member means off | document and implement: absent member means the default (enforce) |
| `test/docs/capability-token-doc.test.ts` | Q10 table equals the schema (follows the schema automatically); the honesty statements | update the default row text in the doc in lockstep; add the migration-section pins (plan 34-03) |
| `test/core/errors.test.ts` | reason non-empty and equal to the catalogue | add the `POLICY_DENIED` text pin (D-34-05) |

**Class B, tests whose real daemon or client is tokenless and does not mean to test tokens (decoupled in plan 34-01, before the flip, while the default is still off, so the commit is green):**

| File | Why | How |
| --- | --- | --- |
| `test/daemon/daemon.test.ts` | about 33 raw `method: "tool"` frames and eight `writePolicy` calls (lines 144, 239, 416, 1532, 1917, 2030, 2435, 3393) | `writePolicy` adds the shared opt-out unless the document sets `capabilityTokens`; the raw frames stay tokenless on purpose |
| `test/support/realm-daemon-fixture.ts` and its users `test/daemon/realm-daemon-fixture.test.ts` (lines 63, 81, 101, 124), `test/surfaces/daemon-equivalence.test.ts` (lines 176, 253) | `{ mode, workspaceRoots }` policy with no key; `client()` without host | fixture option `capabilityTokens` ("default" or "off"); the tokenless-client tests pass "off"; the equivalence test compares audit lines against the direct dispatcher, which carry no host or kid, so it stays "off" |
| `test/support/boot-matrix-rig.ts` (lines 232 to 267) and `test/integration/host-boot-isolation.test.ts` (lines 203 to 216) | wrappers around `connectDaemon` drop the `options` argument, so the real client loses its host | forward the third argument; these suites then run real hosts under the default, which is extra coverage |
| `test/daemon/e2e.test.ts`, `daemon-health.test.ts`, `host-boot-control.test.ts`, `libpod-entry.test.ts`, `test/integration/omp-guard.test.ts` | policy files with no key, or a nonexistent policy path (`e2e.test.ts` line 447); status, doctor and host-boot only | expected unaffected; the probe confirms; fix only what it shows (audit-line counts, state-directory listings, the doctor item status) |

**Class C, expected unaffected (fakes or stubs, no real enforcing daemon):** `test/daemon/client.test.ts`, `test/host/attach.test.ts`, `boot-driver.test.ts`, `test/omp/*`, `test/cli/stdio-host*.test.ts`, `cli.test.ts`, `mcp-attach.test.ts`, `checkpoint-stopped.test.ts`, `test/support/fake-host-daemon.ts` (answers `SCHEMA_INVALID` to the unknown method, which a client reads as off), `scripts/check/mcp-smoke.mjs` (labelled already). The live suites (`test/support/host-live*.ts`, `production-live.ts`, `omp-live.ts`) launch labelled hosts and attach under the default; they are run only in the live windows of Phases 33 and 35.

**New tests (plan 34-03):** `test/integration/enforce-default.test.ts` (the D-34-06 table), `test/host/adapters-labelled.test.ts` (D-34-07), `test/host/refusal-hint.test.ts` (D-34-05), the doc pins for the migration section. Taxonomy: no basename contains `mcp` or `acp`.

### D-34-10. Breaking-change conventions (ENF-04)

- Every commit of plans 34-02 and 34-03 (code, schema, docs, adapters, tests that follow the flip) carries `!` after the type and scope: for example `feat(capability)!: enforce capability tokens by default; set capabilityTokens.mode to off to opt out`. The `!` keeps the commit in the release notes even for a `docs` or `planning` scope (E-34-13). Plan 34-01's commits are behaviour-neutral test decoupling (green under the old default) and use plain `test(...)` subjects without `!`.
- The subject of the flip commit is itself the release note text (the changelog uses the subject only). It is written so it can stand alone and is repeated in the migration section of `docs/integration/mcp.md` as the "Release note text" paragraph, which a doc test pins.
- The pull request lands as a merge commit (each `!` commit listed) or, if squashed, with a title of the same `feat(capability)!:` form. The executor records which in the phase summary. A squash with a title that lacks `!` is a defect (it would drop the entry for scoped commits).
- `CHANGELOG.md` and version fields are not edited (release-owned). `release/milestone.json` is already `{"milestone":"v5.0","minor":5}`; the release is `0.5.x`.
- The migration notes live in `docs/integration/mcp.md` Q10 (the section the Phase 32 doc test pins), with a short pointer in `README.md`, `docs/policy-reference.md` and `AGENTS.md`. No new document file (no site navigation change).

### D-34-11. Rollout and the stale daemon

A detached daemon keeps the policy it loaded (E-34-12). After an upgrade:

- A new client against a still-running old daemon works (the old daemon answers `SCHEMA_INVALID` to `capability-attach`, read as off; E-34-06).
- The default takes effect when the daemon next starts. Stopping it removes the container within about 30 s and leaves workspace files unchanged; the next `realm mcp`, `realm up` or Omp attach starts a new daemon and a new sandbox. The migration section says to save work first and names the stop method the runbook documents.
- An old client against the new daemon is refused (this phase's point), explained by D-34-05.

### Open questions (defaults taken; none blocks)

- **OQ-34-01.** Muse Code, Prime Agent and Grok Build have no host id. Default taken (D-34-07): their shipped snippets stay unlabelled, are named in GAP-34-01, and need the opt-out or a borrowed label. Alternative if the owner prefers: add three ids (runtime rows, manifests, support matrix), a separate phase.
- **OQ-34-02.** Should `realm init` write an explicit `capabilityTokens` key so the posture is visible in the file? Default taken: no (D-34-03); the doctor and the docs state the posture.
- **OQ-34-03.** Should a stale client be told on the wire? Default taken: no (D-34-05).

### Threat model (summary; each plan carries its STRIDE rows)

Assets: the six tools reachable through the control socket; the audit attribution; the key file; the session binding.

| Actor | 0.4.x default | With this default | Stays open |
| --- | --- | --- | --- |
| Same-uid process with a native shell | Admitted | Admitted (can attach as any host or read the key) | Everything; stated first in every document |
| Prompt-injected model with MCP tools only | Limited by policy | Per-host profile and token it cannot read; every install, not only opted-in ones | A model with a host shell is the row above |
| Stale or unlabelled client | Works | Refused, with the explanation of D-34-05; opt-out documented | A user who opts out is back to the 0.4.x posture; the doctor warns |
| Operator who cannot tell why calls fail | Not applicable | Reason text, one-time stderr line, doctor detail, migration docs | A stale binary shows only its own old text |
| Daemon that cannot create its keyring | Not applicable | Logged at start, every attach and verify refused (fail closed), doctor `fail` with the class | Availability: calls are refused until the keyring is fixed |
</decisions>

<canonical_refs>
## Canonical References

- `.planning/MILESTONE-CONTEXT.md` (D-v5-3, D-v5-4, limits, out of scope), the v5.0 section of `.planning/REQUIREMENTS.md` (ENF-01 to ENF-04), the Phase 33 to 37 blocks of `.planning/ROADMAP.md`.
- The Phase 32 record: `.planning/milestones/v4.0-phases/32-capability-tokens-for-stdio-hosts/32-CONTEXT.md` (D-32-02 delivery, D-32-03 wire, D-32-05 policy, D-32-06 control protocol, D-32-08 client, D-32-12 operator surface), its three plans and summaries, and `32-VERIFICATION.md`.
- `docs/integration/runtime-decision.md` D32-1 (default off, OQ-32-01 "whether the next minor flips the default"), `docs/integration/mcp.md` Q10, `docs/policy-reference.md` section `capabilityTokens`, `docs/integration/host-plugin-gaps.md`, `docs/integration/host-plugin-contract.md` section "Capability tokens".
- `src/capability/*`, `src/core/{policy,errors}.ts`, `src/core/policy.schema.json`, `src/contract/validate.ts`, `src/daemon/{daemon,client}.ts`, `src/cli/{main,stdio-host}.ts`, `src/host/{attach,boot-driver}.ts`, `src/omp/extension.ts`, `src/doctor/capability-checks.ts`.
- `scripts/check/{module-size,export-usage-gate,host-paths}.mjs`, `scripts/release/changelog.mjs`.
- Style precedent: the Phase 32 plans and `.planning/milestones/v4.0-phases/28-remove-the-anda-bridge/`, `29-mcp-tool-annotations/`, `31-production-stack-boot-rehearsals-for-wave-1-hosts/`.
</canonical_refs>

<specifics>
## Wave Structure

| Wave | Plan | What |
| --- | --- | --- |
| 1 | 34-01 | Decouple the tests and fixtures from the default while it is still off (Class B), proven by a local flip probe. Behaviour neutral, green on its own, no `!`. |
| 2 | 34-02 | The flip: schema, one shared default, eager keyring, doctor behaviour, `POLICY_DENIED` reason, policy reference, and the Class A pins. Commits carry `!`. |
| 3 | 34-03 | Every shipped client proven under the default, the refusal hint, the shipped launchers, the migration docs and decision record, the stale-binary live window (blocking human), and the commit-convention check. Commits carry `!`. |

Wave 2 needs wave 1 so that the flip commit is green (each commit bisectable). Wave 3 needs the flip (its tests run under the default). Files are disjoint across plans except `docs/policy-reference.md` (34-02 only) and `test/support/capability-harness.ts` (34-02 only).

## Hygiene for every plan

No `src/contract/tools.schema.json` change; no new error code; no `daemon.ts` edit (it is at 986 of 1000 lines). No host path in any committed file (`node scripts/check/host-paths.mjs` scans `docs` and `.planning`; use placeholders such as STATE_DIR). Raw angle tokens outside code fences are escaped; inside plan task blocks there are no angle brackets at all. Every new `src` export has a `src` importer (export-usage gate); a test-only export needs an allowlist entry, and a stale entry fails the gate. Lint: no unnecessary conditions after assert narrowing, `restrict-template-expressions` (wrap numbers in `String(...)`), `no-base-to-string`, `prefer-const`, `void test(...)`. Tests assert observable behaviour only (no source-text tests); the doc pins read documents, as `test/docs/capability-token-doc.test.ts` does. Tests must pass as a regular non-root user. Test files do not use `mcp` or `acp` in their basename (the taxonomy test; `cli/mcp-attach.test.ts` is its one exception).

## Live window rule (plan 34-03)

The owner authorized live windows when a phase needs them, on 2026-11-18, under the same rules as before: one live run at a time on the shared realm account, the lock taken, evidence kept outside the repository and cited by date in the phase record, no host-local path or secret committed, the production stack and the registered live host configurations left as found. Phase 34 needs exactly one window: a real stale client binary against the new default (the Phase 32 limitation "never tried with a real stale binary").

## Deferred

- Host ids for Muse Code, Prime Agent and Grok Build (OQ-34-01).
- A per-host enrollment secret (Phase 32 deferral, unchanged).
- The memory-read measurement, the non-root run on a `ptrace_scope` 1 host and the live claude enforce proof (Phase 35).
- Any change to the audit bound, the token lifetime or the profile model.
</specifics>
