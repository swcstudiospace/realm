# Phase 32: Capability tokens for stdio hosts - Context

**Gathered:** 2026-11-17, from the Phase 30 spike (its note `docs/integration/capability-token-spike.md`, its prototype `scripts/spike/capability-token/` and `30-01-SUMMARY.md`, read read-only from the Phase 30 worktree, where they are still uncommitted), `.planning/phases/30-capability-token-spike/30-CONTEXT.md`, and a fresh read of `origin/main` at commit 29d2f2f (release v0.4.3): `src/daemon/{channel,client,daemon,host-boot,spawn-env,ensure}.ts`, `src/cli/{main,stdio-host,host}.ts`, `src/host/{attach,boot-driver,capabilities,manifest,runtimes,types}.ts`, `src/tools/dispatch.ts`, `src/audit/{log,redact,reconcile}.ts`, `src/core/{policy,errors}.ts`, `src/core/policy.schema.json`, `src/contract/validate.ts`, `src/doctor/{checks,host-checks}.ts`, `src/omp/extension.ts`, `docs/policy-reference.md`, `AGENTS.md`, `package.json`, and the module-size and export-usage gates under `scripts/check/`.
**Status:** Planned (three plans, nothing executed). Requirement ids CAPT-02 to CAPT-09 are defined in this file and are NOT yet in `.planning/REQUIREMENTS.md`. The orchestrator registers them, using the roadmap block and the requirement rows written at the end of this file. This phase does not edit ROADMAP, STATE or REQUIREMENTS.
**Precondition:** Phase 30's spike note must be on the branch before plan 32-03 runs (it appends a section to it). Phase 32 depends on Phase 30 only for that note and for the recorded measurements E1 to E9; no Phase 32 code imports anything from the spike prototype.

<domain>
## Phase Boundary

Build the C2 design of the Phase 30 spike into `src`, minimally: a per-session, per-host HMAC capability token that the Realm daemon mints, the stdio host (`realm mcp --host ID`, `realm acp --host ID`) carries in its control requests, and the daemon verifies before the dispatcher runs. Verification fails closed and works together with policy: the token can only narrow what the policy already grants. A verified token names the host and the key id, and both are written on the audit lines of the call. The build also contains the redaction pattern for the token shape, key rotation, a doctor check, and the policy and config surface that selects the per-host profile.

### The owner override (stated plainly)

The Phase 30 spike ran its frozen decision rule. Criterion M1 was **not demonstrated**: a same-uid process reads a token at rest and reads it from `/proc/PID/environ` (experiments E3 and E4, as root and as uid 65534), and no experiment found an attacker that is admitted without a token and refused with one, other than attackers the 0600 socket already stops (E5). By the spike's own stop rule that outcome is DROP. **On 2026-11-17 the owner overrode that outcome and directed a BUILD.** This phase carries out that direction. It does not reinterpret the spike: M1 stays "not demonstrated" and nothing in this phase claims otherwise. The owner's stated reason is that the token has value that does not depend on M1: per-host least privilege, and audit attribution of which host made a call, as a defence against the confused deputy and against a prompt-injected model that has no way to read the token channel.

### What this phase does NOT give (read this before the rest)

1. **No defence against a process of the same user that can read the token or the key.** Any same-uid process can connect to the 0600 control socket today and call every tool the policy allows. With the token it can still do that: it can run the same `capability-attach` request as a host and obtain a token (D-32-02), or read the key file and mint any token. Every same-uid process that can reach the socket can also obtain a token, so there is no attacker that the socket admits and the token refuses once that attacker takes the attach step. A model with a native shell in its host (Claude Code's Bash tool, for example) is a same-uid process, so for such a model the token changes nothing.
2. **Not an authentication of the host.** The token proves that the bearer attached to the daemon as host X, and that the call is the one the attach was minted for. It does not prove that the attaching process is the real host X: the daemon cannot tell (D-32-02). The attribution is a signed label that is verified on every call, not an identity.
3. **No identity of the model or of the prompt.** A token names a host install, not what operates it. A prompt-injected model that drives the host through its MCP tools is the same principal as the host.
4. **Nothing for an in-process host that holds everything in one process.** Omp loads Realm in its own process. It receives a token for the host id `omp` (D-32-08) so that it keeps working when enforcement is on, and so that its calls are attributed; the token protects nothing there beyond the profile.
5. **No protection of the sandbox.** The workload inside the sandbox never receives the token, the key or the socket. Containment is the sandbox and the dispatcher, not this phase.

### What it does give (the value the owner is buying)

| Gain | Honest scope |
| --- | --- |
| **Per-host least privilege** | A host whose profile is read-only has `write`, `exec` and `retry` refused before the dispatcher runs, for every caller that reaches the daemon with that host's token. A caller that has no token, or another host's token, never gets the read-only host's calls. Today every host has the same six capabilities and policy cannot tell them apart. |
| **Audit attribution** | Every call made with a token records the verified `host` and the `kid` on its audit lines, covered by the audit chain. Two hosts on one workspace share one session and one audit file; today a read from one and a write from the other are indistinguishable. A same-uid process that attaches as another host leaves an attach line for it (D-32-10). |
| **Confused-deputy resistance** | The token lives only in the memory of the `realm mcp` process that attached. It is not in the recipe, the host config, the environment, argv or any file. A caller that can only speak through the host's MCP tools (a prompt-injected model with no shell, a sandboxed host subprocess that is not a descendant of the `realm mcp` process) cannot read it, and cannot obtain the profile of a host it is not. |
| **Fail closed with policy** | With enforcement on, a missing, expired, malformed, forged or mismatched token refuses every tool call with `POLICY_DENIED` before any dispatcher stage runs, with no reason on the wire. |

### Out of scope, stated so no task drifts into it

- No Streamable HTTP, OAuth or remote host. No peer-credential check (Node has no API). No macaroon holder attenuation, no Biscuit, no third-party caveats, no revocation list beyond key rotation.
- No new error code (the catalogue has 29 and its codes are costly to change). Every token refusal is `POLICY_DENIED`.
- No change to `src/contract/tools.schema.json` and no change to any MCP or ACP reply shape or to `ToolOutcome`.
- No change to the 0600 control socket, the sandbox mount set, the Anda removal, or the 18 host recipes (D-32-02).
- No token in any recipe, host config, environment variable, argv, daemon spawn environment or file other than the daemon's key file.
- No change to `docs/specs/realm-spec.xml` (read as the product spec; not edited, as for Phase 28) and no CHANGELOG or version edit (release-owned).
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below: source, read date 2026-11-17, tier)

Tiers: **Observed** = read in this repository today at commit 29d2f2f; **Measured** = recorded by the Phase 30 prototype run in `30-01-SUMMARY.md`; **[INFERENCE]** = reasoning from those.

| ID | Fact | Source | Tier |
| --- | --- | --- | --- |
| E-32-01 | The control method list is `status, up, down, doctor, tool, metrics, host-boot`. `CONTROL_TIMEOUT_MS` is a full `Record` over `ControlMethod`, so a new method needs a bound. `parseControlSelection("tool", params)` requires `params.selection` to have exactly `workspaceRoot` and `sessionId`; it does not constrain the other keys of a `tool` request. The channel module keeps a five-import allowlist (P6-D10) and cannot import the dispatcher or any new module. | `src/daemon/channel.ts` lines 17, 47 to 55, 134 to 167 | Observed |
| E-32-02 | The daemon's `case "tool"` takes `params.tool`, resolves the target (`resolveTarget`, REALM_NOT_ACTIVE when no entry), mints a correlation id and calls `dispatcher.call(tool, { correlationId, upId })`. A refusal outcome becomes `{ id, error: { code[, causeCode] } }`, and the daemon logs `tool.result` and records metrics. `policy` is loaded once at start and read by every session. | `src/daemon/daemon.ts` lines 213 to 214, 624 to 690 | Observed |
| E-32-03 | The dispatcher's `call(raw, context)` validates `correlationId` and `upId` with `isCorrelationId`, builds `CallScope { correlationId, upId? }` and spreads it into every audit line through `#workspace` (file tools) and `#audited` (exec, status, retry). A field added to `CallScope` reaches every audit line of the call. | `src/tools/dispatch.ts` lines 100 to 160, 261 to 286 | Observed |
| E-32-04 | `appendAudit` builds each line from named fields (`upId` is spread only when present), redacts the whole object with `redactValue`, and writes it with the chain's `seq` and `prev`. The chain verifier reads only `seq` and `prev`, so an extra optional field is covered by the next line's `prev` hash and by head pins with no verifier change. The reconciler ignores a line that has no `phase` and pairs only `admission` with `result` and `reconciliation`. | `src/audit/log.ts` lines 41 to 125, `src/audit/chain.ts` (Phase 30 inventory), `src/audit/reconcile.ts` lines 146 to 165, 236 to 252 | Observed |
| E-32-05 | `SENSITIVE_KEY_PATTERN` matches any key containing `token`, so an object key named `token` is redacted by the key layer wherever `redactValue` runs. `SECRET_VALUE_PATTERNS` is a frozen array of five global patterns; a value shaped `rcap1.PAYLOAD.MAC` under a key such as `note` matches none of them (measured, E7). | `src/audit/redact.ts` lines 14 to 27 | Observed, Measured |
| E-32-06 | `defaultManifestFor` builds `launch: { command: "realm", args: ["mcp", "--host", id] }` for the 18 `mcp-config` hosts. `launch` has no `env` member. 15 of the 18 carry an install recipe (json-merge, yaml-map or toml writers) whose registered value is the same bare launcher; Omp has a `bundle-copy` recipe and is `extension`. The installer records hashes and relative paths, never content. | `src/host/manifest.ts` lines 195 to 234, `src/host/runtimes.ts` lines 77 to 306 | Observed |
| E-32-07 | `HOST_IDS` has 19 entries. `--host` accepts only the 18 `mcp-config` ids (`stdioHostOf`). Omp's extension builds its client through `createDaemonAttach` with `connect: connectDaemon`, so Omp calls the same `tool` method over the same socket. | `src/host/types.ts` lines 15 to 34, `src/cli/main.ts` lines 93 to 131, `src/omp/extension.ts` lines 18, 81 | Observed |
| E-32-08 | A `DaemonClient` holds no session state and dials once per request. The boot driver creates a new client on every re-attach, and a lost link (`REALM_NOT_ACTIVE` and the other link-lost codes) triggers it. A daemon that restarts has no admitted sessions, so an old client's next call fails with `REALM_NOT_ACTIVE` and the driver re-attaches. | `src/daemon/client.ts` lines 9 to 12, 149 to 215, `src/host/boot-driver.ts` lines 516 to 553 | Observed |
| E-32-09 | The stdio entry reads no environment. `runStdioHost` receives `hostId` (a `HostId` or null; the boot observer labels a missing one `unlabelled`), `connect`, `spawnDaemon` and every seam from the CLI edge. `daemonSpawnEnv` is an allowlist of paths, digests and the log level, "never a credential". | `src/cli/stdio-host.ts` lines 118 to 205, `src/daemon/spawn-env.ts` | Observed |
| E-32-10 | The doctor registry is `REGISTERED` plus the runtime checks plus `hostPluginsCheck`, appended last; `CheckId` is a closed union; the doctor loads the policy with `loadPolicyFileDetailed` and never prints a policy value. | `src/doctor/checks.ts` lines 47 to 61, 129 to 173, 190 to 247 | Observed |
| E-32-11 | `integrationCeiling("mcp-config")` returns exactly the six capabilities `daemon.attach, fs.read, fs.write, fs.list, exec.argv, exec.shell`. `resolveCapabilities` is pure and documented as "not an enforcement path"; its only consumer is the host-boot posture log. | `src/host/capabilities.ts` | Observed |
| E-32-12 | `scripts/check/module-size.mjs` limits every `src` file to 1000 lines and its allowlist is empty; `src/daemon/daemon.ts` is 955 lines. `export-usage-gate.mjs` fails an export that no other `src` file imports unless it is on the allowlist. `coverage-floors.json` and `check:coverage` apply. | `scripts/check/*` | Observed |
| E-32-13 | The sandbox state mount is `stateDir/sandboxes/NAME`, a read-only per-sandbox child. It is neither the daemon state directory nor a parent of `run/` or `audit/`. Residual: `overlapProblems` does not compare `sandboxStateRoot` with `stateDir`, so a hand-written layout can place the state directory inside a mounted child. | Phase 30 inventory E-30-08, `src/runtime/hardening.ts`, `src/runtime/config.ts` | Observed |
| E-32-14 | Prototype measurements. Token size 194 bytes (read-only), 209 (workspace-edit), 264 (full). Mint 20.6 microseconds and verify 23.67 microseconds, median of 20000. Zero dependencies. A 26-row refusal matrix (E1) and a 6-pair profile and policy matrix (E2) held with 0 mismatches. A same-uid sibling reads a 0600 token file and `/proc/PID/environ` (E3, E4). A different uid is refused by the kernel (E5). Rotation by kid works (E8). A signed token refuses a wrong-host claim and the audit line names the verified host and kid (E9); a plain label is spoofable. | `30-01-SUMMARY.md` | Measured |
| E-32-15 | The prototype's `token.mjs`, `gate.mjs` and `run.mjs` are throwaway `.mjs` files that import nothing from `src`. They are re-implemented in TypeScript here; nothing is copied or imported. Their E1 and E2 rows are the seed of the matrix in D-32-13. | `scripts/spike/capability-token/` (Phase 30 worktree) | Observed |

### D-32-01. The criteria, restated honestly after the override

The Phase 30 criteria are kept as the yardstick, and each is stated as it stands for this build. They are not re-scored to a pass.

| ID | Criterion | Status for this build |
| --- | --- | --- |
| M1 | A real attacker is stopped that today's model admits | **Not met, and not claimed.** Overridden by the owner (above). |
| M2 | No new standing secret in a host-owned file; recipes stay bare | Met by the delivery decision (D-32-02). The one standing secret is the daemon's own key file, under the daemon state directory. |
| M3 | No new dependency, no runtime flag | Met: `node:crypto` and `node:buffer` only. |
| M4 | Bounded: at most three plans, no tool-schema or reply-shape change, no new error code | Met by design: three plans; additive control method and request key; additive audit fields; `POLICY_DENIED` only. The frozen policy schema gains one key by the owner's direction. |
| M5 | Fail closed, token AND policy, no verbose reason | Met by design (D-32-03, D-32-07) and proven by the matrix (D-32-13). |
| S1 | Attribution beats the label | Partly. The per-call binding is verified (a request cannot change the recorded host). The attach is a self-declared label that the daemon cannot verify (D-32-02). |
| S2 | Least privilege enforceable per host | Met for every caller that does not reach the daemon as another host. |

### D-32-02. Delivery channel: the daemon mints at attach, the token lives only in the host process's memory (D3)

The spike's table:

| ID | Channel | Verdict |
| --- | --- | --- |
| D1 | `realm host install` writes the token into the host recipe (`env`) | Rejected |
| D2 | A 0600 token file under the daemon state directory, read by `realm mcp` at start | Rejected |
| D3 | The daemon mints a token when `realm mcp --host ID` attaches; the process keeps it in memory | **Chosen** |
| D4 | Inherited file descriptor from a supervising launcher | Not available: the host spawns `realm mcp` from a config line |

Decision: **D3.** The justification, in order of weight:

1. **A per-session token cannot be minted at install time.** The session id is derived from the workspace path (`sessionIdOfWorkspace`); a host config is global and names no workspace. D1 would have to become a per-install token with no session binding, which drops the property the owner asked for ("per-session").
2. **D3 keeps the token off every readable channel.** It is never in a host-owned file, the host's environment block, argv, the daemon spawn environment or a file of Realm's. D1 puts it in a config file that the host's own file tools, and any same-uid process, can read; D2 puts it in a state file. D3 leaves memory only. Reading another process's memory needs ptrace rights, and under Yama `ptrace_scope` 1 a process that is not a descendant of the `realm mcp` process is refused (this phase measures it where it can, D-32-13; the spike measured the file and the environment, not memory).
3. **D3 changes no recipe.** The 15 recipes and the 18 default manifests stay byte-identical (D-25-07 stands). A test pins that (plan 32-03). D1 would need a new `env` member in the manifest `launch` type and parser, changes to every recipe writer (json-merge, yaml-map and the toml writers) and to the receipt hash expectations, new rows in `host-plugin-contract.md`, and 15 recipe test suites, and several host config formats may not take an environment block at all [INFERENCE: not checked per host].
4. **D3 needs no new install or operator step.** An existing host works the day the daemon enforces.

**What D3 costs, stated:** the mint is not authenticated. The daemon cannot tell the real `cursor` from any process that says `--host cursor` (Node has no peer-credential API). So D3 is a signed label that every later call is verified against. A same-uid process that wants another host's profile attaches as that host, leaves an attach line in the audit chain, and gets a token (D-32-10 makes this visible, not impossible). This is exactly the limit stated in "What this phase does NOT give".

**Considered and not built.** An optional enrollment secret per host, written at install into a 0600 file under the state directory, which `realm mcp` would present at attach, would authenticate the attach against a same-uid reader that cannot read the state directory (a different uid, or a host-sandboxed process). It re-opens D2's problem for a same-uid reader and adds an install step. It is listed in Deferred.

**Migration of the 18 recipes if env delivery were chosen (it is not):** none is done. For the record, the work D1 would require is the list in point 3 above. This phase changes no `src/host` recipe, manifest or receipt code.

### D-32-03. Token format and verification (the C2 prototype, hardened for production)

Wire form: `rcap1.` then base64url(payload bytes), a dot, base64url(mac). Exactly three dot-separated parts. Base64url is decoded strictly (the alphabet only, and the decoded bytes must re-encode to the same text).

Payload: a JSON object with exactly the keys, in this order, `v` (the integer 1), `kid` (1 to 16 of lowercase letters and digits), `sid` (a session id matching the audit module's safe pattern), `host` (one of the 19 ids in `HOST_IDS`), `caps` (sorted, unique, drawn only from the six `mcp-config` capabilities), `iat` and `exp` (safe integers in seconds, `exp` minus `iat` between 1 and 86400). Any other key, type or order violation refuses.

MAC: HMAC-SHA256 over the bytes `realm-capt-v1`, one zero byte, then the payload bytes, with a 32-byte key chosen by `kid`; compared with `crypto.timingSafeEqual` after a length check (a tag of any length other than 32 is `format`).

Fixed verification order, so refusals are deterministic and testable: format; kid known (and not revoked); MAC; payload schema; version; time window (60 seconds of clock skew allowed on `iat`, none on `exp`); session binding; capability. The prototype's host-binding stage disappears: a `tool` request carries no host claim, so the daemon reads the host only from the verified token. A request frame that carries an extra key is refused by the channel (SCHEMA_INVALID) before any token is read.

Refusal classes (internal names, never on the wire): `format`, `unknown-kid`, `bad-mac`, `bad-payload`, `bad-version`, `time-window`, `wrong-session`, `capability-not-granted`. On the wire every one of them is `{ error: { code: "POLICY_DENIED" } }` with no cause code and no detail. The class goes to the daemon log line only (and the refusal is counted as a refused tool call by the existing metrics). A refusal of the last four classes (the MAC and the payload schema both passed) also carries the authentic host and kid, which the daemon may write on the audit line of the refusal (D-32-10); an earlier class carries none, so an unauthenticated claim is never recorded.

### D-32-04. Keyring and rotation

- File: `stateDir/capability/keys.json`, directory mode 0700, file mode 0600, both owned by the current user, no symlink at either path (`lstat`), written with the existing atomic write. Content: `{ "version": 1, "active": "k2", "keys": [ { "kid": "k1", "key": "BASE64URL32", "createdAt": 1700000000, "retiredAt": 1700003600 }, { "kid": "k2", "key": "BASE64URL32", "createdAt": 1700003600 } ] }`. The key is 32 bytes from `randomBytes`.
- It lives outside `run/`, `audit/`, `sessions/` and `sandboxes/`, so no default sandbox mount reaches it (E-32-13). The doctor item (plan 32-03) refuses a layout where it falls under the configured sandbox state root.
- The daemon creates the keyring (one active key `k1`) the first time it must mint in enforce mode, race-safely (create-exclusive). It never creates it on the verify path: a missing or unreadable keyring refuses every verification (`POLICY_DENIED`, logged), which is the fail-closed answer.
- The daemon re-reads the file when its identity (inode, mtime, size) changes, checked on each mint and verify, so a rotation made by the CLI while the daemon runs takes effect on the next request with no restart and no control method.
- `kid` values are `k` followed by a counter (`k1`, `k2`, ...). Rotation appends a new key, makes it active, and stamps the previous active key `retiredAt`. A retired key still verifies until `retiredAt` plus 86400 seconds plus 60 seconds of skew (no token it signed can live longer), and is pruned after that. **Revocation** (`--revoke-previous`) removes every non-active key at once: tokens they signed fail `unknown-kid` immediately, and the affected hosts' calls are refused until each `realm mcp` process re-attaches (a host reconnect or restart; the client does not guess a revocation, D-32-08). This is the emergency path; planned rotation is non-disruptive.
- Cost of this choice: the key at rest is the crown jewel. A same-uid reader of `keys.json` mints any token directly. This is inside "What this phase does NOT give", and it is why the key file is not in any sandbox mount and never printed, logged or put in an environment.

### D-32-05. Policy and config surface

One new top-level policy key, in the frozen schema (changed by the owner's direction, with the schema tests moved with it):

```
"capabilityTokens": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "mode": { "type": "string", "enum": ["off", "enforce"], "default": "off" },
    "ttlSeconds": { "type": "integer", "minimum": 60, "maximum": 86400, "default": 3600 },
    "profiles": {
      "type": "object",
      "propertyNames": { "enum": ["omp", "claude", "opencode", "kilo", "codex", "copilot", "antigravity", "cursor", "windsurf", "augment", "trae", "qwen", "hermes", "codebuddy", "cline", "kimi", "kimi-code", "zcode", "pi"] },
      "additionalProperties": {
        "type": "array",
        "uniqueItems": true,
        "items": { "type": "string", "enum": ["daemon.attach", "fs.read", "fs.write", "fs.list", "exec.argv", "exec.shell"] }
      },
      "default": {}
    }
  },
  "default": {}
}
```

- **Default posture: `off`.** With `off` nothing changes: no token is minted, none is checked, no audit line changes, and every existing install, test and script behaves as on 0.4.3. The reason is rollout safety (a stale detached daemon or an older `realm mcp` would otherwise refuse) and that the owner asked for a minimal build; whether the next minor flips the default is an open question (OQ-32-01).
- `enforce` turns the feature on for every host and every session of the daemon. There is no per-workspace opt-in: the policy is one document per daemon (E-32-02).
- `profiles` maps a host id to the capabilities its token carries. A host with no entry gets all six (the manifest ceiling). An empty array gives a token that can only call `status`. A listed capability the policy cannot grant is still listed in the token (the policy gates still apply after it, D-32-07); the doctor item reports the effective picture.
- `ttlSeconds` is the lifetime of one token. Constants, not policy keys: clock skew 60 seconds, maximum lifetime 86400 seconds, client renewal margin 120 seconds, refusal and attach audit bound (D-32-10).
- `Policy` (in `src/contract/validate.ts`) gets `readonly capabilityTokens?: CapabilityTokenPolicy`. A validated policy always has it (the schema fills the default); it is optional in the type only so that the 21 hand-built `Policy` literals in the test tree keep compiling. One function, `capabilityPolicyOf(policy)` in `src/capability/admit.ts`, applies the default, and it is the only reader. A schema test proves `validate("policy", {})` yields `mode` `off`, `ttlSeconds` 3600 and empty `profiles`.
- `docs/policy-reference.md` gets a `capabilityTokens` section in the same style as the other keys (type, default, effect, enforced by, what it does not do).

### D-32-06. Control protocol

- New control method `capability-attach`, params exactly `{ selection, host }` where `selection` is the existing selection and `host` is a string of 1 to 32 of lowercase letters, digits and a hyphen (shape checked by the channel; membership in `HOST_IDS` is the daemon's check, which refuses with `POLICY_DENIED`). Bound `CONTROL_TIMEOUT_MS["capability-attach"]` is 5000, like status. `CONTROL_METHODS` becomes eight entries.
- Reply when the policy mode is `off`: `{ mode: "off" }` (no token is minted). Reply when `enforce`: `{ mode: "enforce", token, expiresAt }` where `token` is the token text and `expiresAt` the epoch seconds of its `exp`.
- The `tool` request gains one optional member: `params.token`, a string of at most 512 characters. The channel validates the frame as exactly `{ tool, selection }` plus optional `token`; any other key is `SCHEMA_INVALID`. A `token` that is not a string is `SCHEMA_INVALID` (shape, not secret). This is the only place a token appears on the wire.
- The daemon's `tool` path, in order: parse the frame; read the raw `tool` object; resolve the target and require an admitted entry (existing behaviour); **if mode is `enforce`, run the capability check (below)**; only then mint the correlation id and call the dispatcher, now with `principal { host, kid }` in its context. In mode `off` the token member is ignored and not verified. The check: determine the needed capability from the raw tool object (D-32-09); verify the token (D-32-03) for this selection's session id and that capability; on any refusal return `{ id, error: { code: "POLICY_DENIED" } }`, log one `capability.refused` line (class, tool name, no token, no host that was not proven), count it in the metrics, and never call the dispatcher or write an admission line.
- `capability-attach` in `enforce`: the selection must resolve and name an admitted session (as `tool` requires, else the same `REALM_NOT_ACTIVE`); the host must be in `HOST_IDS`; mint with `caps` equal to the profile for that host (all six when absent); write the attach audit line (D-32-10) and only then reply. An audit write failure refuses the attach (`AUDIT_WRITE_FAILED`, fail closed). In `off` mode the method answers `{ mode: "off" }` without touching the audit.
- **Version skew.** A client that meets a daemon that does not know `capability-attach` gets `SCHEMA_INVALID` (unknown method) and sends no token, which is right for an older daemon that enforces nothing. A new daemon in `enforce` refuses a tokenless `tool` call, so a stale client is refused, not admitted.
- Unlabelled stdio (no `--host`): in `enforce` the client has no host to attach as and its calls are refused (`POLICY_DENIED`); the operator adds `--host`. In `off` nothing changes. Documented (plan 32-03).

### D-32-07. Token AND policy, never OR

The token is a gate in front of the unchanged dispatcher. A call is admitted only if (1) the token verifies for this session and grants the capability the call needs, and then (2) the dispatcher runs its existing stages (schema, state, lock, policy gates such as `shellEnabled`, path and credential checks, mutation gate), which the token cannot bypass. No code path lets a token grant what the policy refuses: a token with all six capabilities under `shellEnabled: false` still gets `SHELL_NOT_ALLOWED` for a shell-form `exec`, and a token without `fs.write` is refused `write` under a policy that allows it. Tests prove both directions.

### D-32-08. Client behaviour

The token handling lives in `DaemonClient` (`src/daemon/client.ts`), not in the MCP surface, so one implementation serves MCP, ACP and Omp.

- `connectDaemon(socketPath, selection, options)` takes an optional `options` object with `host` (a `HostId`) and a `now` seam. Without `host` the client never attaches and sends no token (a status probe, a checkpoint, a test client).
- With `host`, the first `call` (and any call within 120 seconds of `expiresAt`) sends `capability-attach` and keeps the reply in a closure variable: never a property, never logged, never put in an error, not enumerable, not serialised. A reply `{ mode: "off" }` is cached for 60 seconds, then asked again (the daemon cannot change mode without a restart, which makes a new client anyway, E-32-08).
- Every `tool` request carries `token` when the client holds one.
- A failed attach is thrown as its `RealmError` and becomes the call's refusal in the boot driver as today. The client does **not** retry a `POLICY_DENIED` tool reply: it cannot tell an expired or revoked token from a real denial without a new code (none is allowed). After a revocation, hosts re-attach when they reconnect or restart. Tokens expire and are renewed by the clock, not by guessing.
- `stdio-host.ts` passes `host: input.hostId` through the `connect` seam of `createDaemonAttach` (an additive third argument on the seam type in `src/host/attach.ts` and `CliDeps.connect`; fakes that take two arguments still compile). `src/omp/extension.ts` passes `host: "omp"`. `realm status`, `realm checkpoint` and the doctor pass none.

### D-32-09. Capability mapping (the spike's, kept)

| Tool | Capability required |
| --- | --- |
| `read` | `fs.read` |
| `list` | `fs.list` |
| `write` | `fs.write` |
| `exec`, argv form | `exec.argv` |
| `exec`, shell form (`shell` is true) | `exec.shell` |
| `retry` | `daemon.attach` |
| `status` | none (a valid token for this session is enough) |
| anything else, or a malformed call | none needed for the token check; a valid token is still required, and the dispatcher then refuses it `SCHEMA_INVALID` as today |

`retry` maps to `daemon.attach` because it can re-create the sandbox; no read-only profile holds it. The mapping reads the raw tool object only for its single key and, for `exec`, the `shell` member; it validates nothing (the dispatcher does). Phase 29's annotation hints are not read by any code, and this mapping is the only per-tool classification that gates anything.

### D-32-10. Audit attribution

- `AuditEntryInput` gains optional `host` (a string matching `[a-z][a-z0-9-]{0,31}`) and `kid` (`[a-z0-9]{1,16}`); `appendAudit` validates them (SCHEMA_INVALID on a mismatch, nothing written) and writes them after `upId` only when present. `ToolDispatcher.call` accepts `principal { host, kid }` in its context, validates it the same way, and adds both to `CallScope`, so the admission and result lines of every tool carry them. Lines of a call made without a token (mode `off`, or no principal) are unchanged.
- The audit chain covers the new fields without a verifier change (E-32-04). A test proves that editing a recorded `host` in a past line makes `realm audit verify` fail.
- An attach writes one line in the session chain: `tool` `capability.attach`, `outcome` `ok`, with `host` and `kid`, no `phase` (so the reconciler ignores it). This is the detection trail for a process that attaches as a host it is not.
- A refused tool call in `enforce` writes one line `tool` (the tool name, or `unknown`), `outcome` `POLICY_DENIED`, no `phase`, with `host` and `kid` **only when the token verified as far as its MAC** (so the recorded host is authentic) and none otherwise. Both kinds of capability line share one bound: a burst of 60 and a refill of one per second per daemon, over an injected monotonic clock. A line over the bound is not written; a `capability.audit_dropped` log line carries the count (the metrics snapshot shape is unchanged; every refusal is still counted as a refused tool call through the existing `recordTool`). The refusal itself is never bound. An attach over the bound is refused `POLICY_DENIED` (fail closed). The bound is local to `src/capability` (the host-boot bucket is private and not touched).
- The host label stays untrusted wherever it is self-reported (the `host-boot` report); only the verified token's host is recorded as attribution.

### D-32-11. Redaction

`SECRET_VALUE_PATTERNS` gains one anchored pattern for the token shape, `rcap1\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]*)?`, so a full token, a truncated copy and a token inside any string (an `exec` argv recorded in the audit, a log line, an error text) is replaced with `[REDACTED]`. The object key `token` is already caught by the key layer. Tests: a minted token under a key named `note`, inside an argv element, inside a Bearer header, and a truncated token are all redacted; the word `rcap1` alone and ordinary text are not; the pattern is linear (a 100 KB run of token characters redacts in well under a second).

### D-32-12. Operator surface

- `realm host token status` and `realm host token rotate [--revoke-previous]`, parsed in `src/cli/host.ts` like the other `realm host` verbs (usage error exit 2, catalogue refusal exit 1, one JSON line on stdout, exit 0). No daemon is needed: the CLI reads and writes `keys.json` through the same keyring module (D-32-04) and the running daemon notices the change. `status` prints the policy mode, the active kid, the retired kids with their ages and the key file mode, and **never a key or a token**. `rotate` prints the new active kid and the retired and revoked kid lists.
- Doctor item `capability-tokens`, appended after `host-plugins` (the list is a costly change, D-44, so nothing moves): `pass` when the mode is `off` with no profiles; `warn` when the mode is `off` but profiles are configured (they have no effect) or when a retired key is past its pruning time; `pass` when `enforce` with a valid keyring (detail names mode, active kid, retired count); `fail` when `enforce` and the keyring is missing, unreadable, a symlink, owned by another user, not 0700 and 0600, malformed, has no active key, or lies under the configured sandbox state root. Details name modes, kids and counts, never a path outside the state directory, a key or a policy value.

### D-32-13. The tests (the seeded-refusal matrix is the centre)

All Node's built-in runner, TypeScript under `test/`, no new dependency (`fast-check` is already a dev dependency). New directory `test/capability/`.

1. **Token unit matrix** (`test/capability/token.test.ts`): the 26 rows of the prototype's E1, each with its own refusal class and the fixed order rows, ported with the host-binding rows replaced (a payload with a host outside `HOST_IDS` is `bad-payload`; there is no wrong-host stage). A property test: every single-character substitution of a valid token is refused (the strict base64url check makes this total). Mint and verify round-trip for every host id and capability subset.
2. **Keyring** (`keyring.test.ts`): modes and ownership refuse, a symlink refuses, create-exclusive under a race, atomic rotation, grace and prune arithmetic with an injected clock, revocation, no key in any thrown error or `toString`.
3. **Policy surface**: the schema and `Policy` agree, defaults fill, the 19 host ids in the schema equal `HOST_IDS`, the six capabilities equal `integrationCeiling("mcp-config")`, an unknown key, host or capability refuses, `ttlSeconds` bounds hold.
4. **Wire matrix** (`test/daemon/capability-wire.test.ts`, real daemon on a real socket with fake runtime seams as in `test/daemon/e2e.test.ts`): every token defect of the unit matrix, presented in a real `tool` request after a real `capability-attach`, is `POLICY_DENIED` with a reply of exactly `{ id, error: { code } }`, **zero dispatcher admissions**, no admission audit line, and no effect (a `write` leaves the workspace unchanged). Extra rows: no `token` member, empty string, a token for another session (two admitted sessions), a token whose capability set lacks the tool's capability for each of `write`, both `exec` forms and `retry`, an expired token (injected clock), a revoked kid, a token after `--revoke-previous`, an unlabelled client, a `host` outside `HOST_IDS` at attach, and an unknown key in the frame. Allow rows: a read-only profile reads, lists and gets status; `full` under `shellEnabled: false` gets `SHELL_NOT_ALLOWED` for shell form; two hosts on one session record `claude` with its kid and `cursor` with its kid on their own lines, and no field of a request changes the recorded host.
5. **No leak**: after the wire matrix, the minted token texts do not appear in the daemon log, the metrics snapshot, any audit file, the doctor output, the CLI output or the diagnostics stream; the client harness proves the token is in no environment variable, no argv, no file under the state directory or the workspace, and (Linux only, skipped as non-root harness cannot prove it) that a non-descendant sibling cannot read it from `/proc/PID/mem` when `ptrace_scope` is at least 1, recorded as observed.
6. **Mode `off` is byte-identical**: with the default policy, the audit lines of a tool call equal the 0.4.3 lines, no `capability-attach` line exists, and a tokenless client is admitted.
7. **Audit**: `host` and `kid` on both lines of each tool; the chain verifies; an edit of a past `host` breaks verification; the reconciler ignores capability lines.
8. **Operator surface and recipes**: the CLI verbs, the doctor statuses, and a recipe guard that pins the registered launch value of all 15 recipes and the `launch` of all 18 default manifests as unchanged and free of `env` and token members.
9. **Docs**: a doc test pins the honesty statements and the policy table to the schema.

### D-32-14. Hygiene constraints for every plan

No `src/contract/tools.schema.json` change. No host path in any committed file (`scripts/check/host-paths.mjs` scans `docs` and `.planning`; use placeholders such as `STATE_DIR`). No raw angle brackets outside code in planning files. `src/daemon/daemon.ts` stays at or under 1000 lines (it is at 955): all logic lives in `src/capability/gate.ts`, and the daemon only builds the gate and calls it from `case "tool"` and a new `case "capability-attach"` (about 30 net lines); if the file would pass 990 lines the executor moves the `tool` reply building into a new `src/daemon/tool-reply.ts` first. Every new `src` export has a `src` importer (the export-usage gate); plan 32-01's exports are consumed by plan 32-02, so the gate is first run at the end of 32-02. New files appear in the coverage run. No CHANGELOG or version edit; commits are `feat(capability)` style and the release derives notes from them.

### Threat model (summary; each plan carries its STRIDE rows)

Assets: the ability to call `read`, `write`, `exec`, `list`, `retry` through the control socket; the audit chain's attribution; the key file; the session binding.

| Actor | Today | With this build | Stays open |
| --- | --- | --- | --- |
| Malicious workload inside the sandbox | No socket route | Unchanged. The token, the key and the socket never enter the four mounts. | A workload that tricks the model into a tool call is stopped, if at all, by policy and host consent prompts |
| Same-uid process with a native shell (the host's own Bash tool, a postinstall, another agent) | Admitted | **Admitted.** It can attach as any host or read the key. | Everything; stated up front |
| Prompt-injected model that has only MCP tools | Limited by policy only | A read-only host profile removes `write`, `exec` and `retry` from its reachable set; its token is not readable through any MCP tool or file | A model with host-side shell is the row above |
| Another configured host on the same workspace | Equal footing | Its calls are attributed to its own host and kid; it holds only its own profile | It can attach as the first host (signed label) |
| Stale or leaked token | Not applicable | Expires within the ttl; `--revoke-previous` refuses it at once | A leaker who can also attach |
| Local flood of bad requests | Possible | Refusals cost no dispatcher work; refusal and attach audit lines are bounded | Log and metrics volume |
</decisions>

<canonical_refs>
## Canonical References

- `docs/integration/capability-token-spike.md` (Phase 30, sections 1 to 4 and the experiment record) and `.planning/phases/30-capability-token-spike/30-01-SUMMARY.md`, `30-CONTEXT.md`.
- `docs/integration/anda-replacement-research.md` sections 1, 5.6 and 5.7 (the research that predicted M1 would fail).
- `src/daemon/{channel,client,daemon}.ts`, `src/cli/{main,stdio-host,host}.ts`, `src/host/{attach,boot-driver,capabilities,manifest,runtimes,types}.ts`, `src/tools/dispatch.ts`, `src/audit/{log,redact,reconcile,chain}.ts`, `src/core/{policy,errors}.ts`, `src/core/policy.schema.json`, `src/contract/validate.ts`, `src/doctor/{checks,host-checks}.ts`, `src/omp/extension.ts`, `src/fs/atomic-write.ts`.
- `docs/policy-reference.md`, `docs/integration/{mcp,hosts,host-plugin-contract,runtime-decision}.md`, `AGENTS.md` (line 176: the control socket is user-only).
- `scripts/check/{module-size,export-usage-gate,host-paths}.mjs` and the coverage floors.
- Style precedent: `.planning/phases/29-mcp-tool-annotations/29-01-PLAN.md`, `29-02-PLAN.md`.
</canonical_refs>

<code_context>
## Existing Code Insights

- The attach sequence is shared (`src/host/attach.ts`); the only thing that differs per host is the `connect` seam. Adding an optional third argument there reaches MCP, ACP and Omp with one change.
- `DaemonClient.call(tool)` is the single place a tool request is built (`request("tool", { tool, ...selected })`); the token member belongs there.
- `daemon.ts`'s `case "tool"` already owns correlation ids, metrics and the `tool.result` log; the capability gate returns a verdict and the case keeps formatting the reply.
- `CallScope` is spread into every audit line, so the attribution change is one optional pair of fields plus their validation in `appendAudit`.
- The doctor and `realm host` follow fixed patterns (a result-shaped item appended last; a verb parser with a usage constant), so the operator surface adds one module and one verb.
- The policy schema and its property tests read their defaults and bounds from the schema file, so the new key is pinned by changing the schema and the test key lists together.
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | What |
| --- | --- | --- |
| 1 | 32-01 | The pure core: token mint and verify, keyring and rotation, capability mapping and the profile function, the policy key and its docs, the redaction pattern. No daemon or client change. |
| 2 | 32-02 | The wiring: channel frame and method, audit and dispatcher attribution, the capability gate and its daemon cases, the client token handling, stdio and Omp hosts. The seeded-refusal matrix over a real socket. |
| 3 | 32-03 | The operator surface and the record: `realm host token`, the doctor item, the recipe guard, docs, the decision record and the spike note section. |

Wave 2 depends on wave 1's modules; wave 3 depends on wave 2's behaviour for its docs and tests. The plans modify disjoint files except `src/cli/main.ts` (32-02 changes only the `connect` seam type and the `runStdio` call; 32-03 changes only the usage constant and the host-verb dispatch) and `docs/policy-reference.md` (32-01 only).

## Requirement IDs (to be registered by the orchestrator)

| ID | Statement | Plans |
| --- | --- | --- |
| CAPT-02 | A per-session, per-host HMAC capability token (format `rcap1`, Node built-ins only) can be minted and verified in a fixed order with deterministic internal refusal classes, and a tool-to-capability mapping and per-host profile function exist, proven by a seeded refusal matrix | 32-01 |
| CAPT-03 | A keyring at rest (mode and ownership checked, atomic, no symlink) supports rotation by key id with a non-disruptive grace period and an emergency revoke | 32-01 |
| CAPT-04 | The policy has a `capabilityTokens` key (mode `off` or `enforce`, `ttlSeconds`, per-host `profiles`) with schema, defaults, type and reference documentation; the default leaves behaviour unchanged | 32-01 |
| CAPT-05 | The token shape is redacted by the audit and log redaction layers in every position, linearly | 32-01 |
| CAPT-06 | With enforcement on, the daemon mints a token at `capability-attach` and verifies the token in every `tool` request before dispatch, failing closed with `POLICY_DENIED` and no reason on the wire; token AND policy, never OR; the client keeps the token in memory only; MCP, ACP and Omp hosts attach | 32-02 |
| CAPT-07 | The verified host and key id are recorded on the audit lines of every tokened call, attaches and refusals are audited within a bound, and the chain covers the fields | 32-02 |
| CAPT-08 | `realm host token status` and `rotate` work without a daemon, and a doctor item `capability-tokens` reports the mode, the keyring and misconfiguration | 32-03 |
| CAPT-09 | The delivery decision, the limits (no defence against a same-uid reader) and the owner override are documented and tested; the 18 default manifests and 15 recipes are unchanged | 32-03 |

## Roadmap block for the orchestrator (ROADMAP.md)

Milestone list line (add after the Phase 31 line):

```
- [ ] **Phase 32: Capability tokens for stdio hosts** - Per-session, per-host HMAC capability tokens minted by the daemon and carried by stdio hosts, verified before dispatch and fail-closed together with policy, with per-host profiles, audit attribution, key rotation and a doctor check, and an honest record of what they do not stop (owner override of the Phase 30 outcome, 2026-11-17).
```

Detail block (add after the Phase 31 block; the `gsd-tools phase add` command writes a stub there, and this worktree's ROADMAP.md and state.json were restored to origin/main after that command ran, so the orchestrator applies the block):

```
### Phase 32: Capability tokens for stdio hosts

**Goal:** A per-session, per-host capability token minted by the daemon and carried by stdio hosts gives per-host least privilege and verified audit attribution, fails closed together with policy, and is documented with the limits the Phase 30 spike measured (no defence against a same-uid reader of the token); built on the owner's override of 2026-11-17.
**Depends on:** Phase 30
**Requirements**: CAPT-02, CAPT-03, CAPT-04, CAPT-05, CAPT-06, CAPT-07, CAPT-08, CAPT-09
**Plans:** 3 plans

Plans:
- [ ] 32-01-PLAN.md: token, keyring and rotation, mapping and profiles, policy key, redaction (wave 1)
- [ ] 32-02-PLAN.md: control frame, gate, audit attribution, client, stdio and Omp hosts, seeded wire matrix (wave 2)
- [ ] 32-03-PLAN.md: realm host token, doctor item, recipe guard, docs and decision record (wave 3)
```

## Requirement rows for the orchestrator (REQUIREMENTS.md, v4.0 section, after CAPT-01)

```
- [ ] **CAPT-02**: A per-session, per-host HMAC capability token can be minted and verified in a fixed order with deterministic refusal classes, with a tool-to-capability mapping and per-host profiles, proven by a seeded refusal matrix
- [ ] **CAPT-03**: A keyring at rest (mode and ownership checked, atomic) supports rotation by key id with a grace period and an emergency revoke
- [ ] **CAPT-04**: The policy has a capabilityTokens key (mode off or enforce, ttlSeconds, per-host profiles) with schema, defaults, type and reference docs; the default leaves behaviour unchanged
- [ ] **CAPT-05**: The token shape is redacted by the audit and log redaction layers in every position
- [ ] **CAPT-06**: With enforcement on, every tool request is verified against a daemon-minted token before dispatch, fail closed with POLICY_DENIED, token AND policy; the client keeps the token in memory only; MCP, ACP and Omp hosts attach
- [ ] **CAPT-07**: The verified host and key id are recorded on the audit lines of every tokened call; attaches and refusals are audited within a bound; the chain covers the fields
- [ ] **CAPT-08**: realm host token status and rotate work without a daemon; a doctor item capability-tokens reports mode, keyring and misconfiguration
- [ ] **CAPT-09**: The delivery decision, the limits (no defence against a same-uid reader) and the owner override are documented and tested; the 18 default manifests and 15 recipes are unchanged
```

Traceability table rows (after the CAPT-01 row):

```
| CAPT-02 | Phase 32 | Planned |
| CAPT-03 | Phase 32 | Planned |
| CAPT-04 | Phase 32 | Planned |
| CAPT-05 | Phase 32 | Planned |
| CAPT-06 | Phase 32 | Planned |
| CAPT-07 | Phase 32 | Planned |
| CAPT-08 | Phase 32 | Planned |
| CAPT-09 | Phase 32 | Planned |
```

Also for Phase 30's own block: the orchestrator may note that Phase 30's recorded outcome is DROP by the frozen rule and that the owner overrode it into Phase 32 (D-32-01).

## Open Questions (owner decisions or unverified; none blocks planning)

- **OQ-32-01.** Default posture. This plan ships `off` (behaviour unchanged). Whether the next minor enforces by default, which would refuse every stale client and every unlabelled `realm mcp`, is the owner's call.
- **OQ-32-02.** Omp gets a token for host id `omp` (D-32-08) so it keeps working under enforcement. The alternative, exempting Omp, leaves one tokenless route and is not taken. The owner may veto.
- **OQ-32-03.** Whether a refused tool call should be audited at all (D-32-10 audits them within a bound, with the host only when the MAC verified). The alternative is log and metrics only.
- **OQ-32-04.** The optional enrollment secret (Deferred) for a same-uid reader that cannot read the state directory. Not built; costed only.
- **OQ-32-05.** [INFERENCE, to be measured by plan 32-02 where the harness allows] that a non-descendant same-uid process cannot read a token from `/proc/PID/mem` under `ptrace_scope` 1. The spike measured the file and the environment only. The harness here runs as root, so the probe is skipped there and recorded as not run; the statement in the docs is worded as "expected, not proven here" until a non-root run records it.
- **OQ-32-06.** Phase 30's 30-02 plan writes its decision as a recommendation for owner approval. It must record the outcome as "DROP by the frozen rule; overridden to BUILD by the owner, see Phase 32" and not as a plain DROP. The orchestrator orders that edit before plan 32-03 runs, or 32-03 appends the override section itself if the note has no decision text yet.

## Success Criteria (from the roadmap, made observable)

1. With the default policy nothing changes: the 0.4.3 audit lines, replies and recipes are byte-identical, and the whole existing test suite passes unchanged except the tests that pin the control method list, the doctor item list, the policy key list and the usage text.
2. With `"capabilityTokens": { "mode": "enforce" }`: a host that attached reads, lists and gets status, and every token defect row of the matrix is refused `POLICY_DENIED` with zero dispatcher work and no effect.
3. A read-only profile denies `write`, both `exec` forms and `retry`; `full` never widens the policy.
4. The audit lines of a tokened call carry the verified `host` and `kid`, and `realm audit verify` rejects an edit of either.
5. The token appears nowhere outside the process memory of the attached host and the wire of one socket request: not in any log, audit file, doctor or CLI output, environment, argv, recipe or state file.
6. `realm host token rotate` changes the active kid with no hosts disturbed; `--revoke-previous` refuses old tokens at once; the doctor item reports the state.
7. The docs state, in the first paragraph of the new section, that a same-uid reader is not stopped.
</specifics>

<deferred>
## Deferred Ideas

- An optional per-host enrollment secret presented at attach (the only way to authenticate the attach against a same-uid reader that cannot read the state directory); costs an install step and re-opens the file-at-rest problem.
- Environment delivery of a long-lived token (D1) and the manifest `env` member and 15 recipe changes it would need.
- Holder attenuation (macaroon-style caveats), a revocation list, third-party caveats, Biscuit.
- A control-level distinction between an expired and a denied token (would need a catalogue code) so that clients could re-attach automatically after a revocation.
- Per-workspace opt-in (the policy is one document per daemon).
- Streamable HTTP with OAuth for remote hosts; peer credentials; per-model identity.
</deferred>
