# SANDBOX n1b — Isolation (daemon entry + sandbox exec)

Updated from current disk (not UNITY records). All file:line from current tree.

## Entry point: daemon main -> startDaemon -> handle -> dispatcher -> sandbox exec

- `src/daemon/main.ts:369-371` — `if (isDirectEntry(...)) void main()` is the only process entry. `main()` at `src/daemon/main.ts:314-318` does `installFailureHandlers(writeLine, exitProcess)` then `runDaemon({env})` with `process.env` copied once.
- `src/daemon/main.ts:75-139` — `runDaemon`: `readHostRuntime(deps.env, deps.readConfig)` (line 80), `runtimeRootsOf(loadRuntimeConfig(runtimeInput))` (line 81), `productionAgentOsDriver` (line 83), then `start(...)` at lines 100-118 with `policyPath: defaultPolicyPath(stateDir)` (line 103), `secretRoot`/`sandboxStateRoot` from roots (lines 108-109). Any start failure: `emitFailure(... codeOf(error))` + `return 1` (lines 119-124); outer catch same at lines 135-138. Stop path: `awaitStop` lines 126-130, 263-312 (SIGTERM/SIGINT in-process stop, control-channel `done` settles 0).
- `src/daemon/daemon.ts:211-229` — `startDaemon` fail-closed start gate: `config = loadRuntimeConfig(options.runtimeInput)` (line 219), `policy = loadPolicyFile(options.policyPath)` (line 221), `ceiling = bindRoot(config.workspaceRoot)` (line 223), `if (libpod === undefined) throw makeRealmError("SCHEMA_INVALID")` (lines 227-229). Rival socket owner `LOCK_CONFLICT`, failed reap rejects before serve (comment lines 207-210).
- `src/daemon/daemon.ts:187-205` — `buildDaemonHandle`: `policy ?? loadPolicyFile(options.policyPath)` (line 189), `exec ?? defaultExec(config, policy, options, runOpenShell)` (line 193), then `createRealmHandle({...})` (lines 194-204). No second tool path.
- `src/daemon/seams.ts:166-194` — `defaultExec`: `libpodOf(options)` undefined → `SCHEMA_INVALID` (lines 173-175). No driver/supervisor → `SessionExecution` without `agentosFor`, comment lines 178-179: "SessionExecution then refuses every runtime-touching call with AGENTOS_NOT_CONFIGURED, so the handle still builds." `egressAllow: policy.egressAllow` passed at line 192.
- `src/tools/dispatch.ts:238-263` — `#exec` (only exec entry): `checkExecPolicy(policy, params)` line 239, `buildExecArgv` line 242, state must be `active` else `execRefusalCode(state)` line 249, then `runSandboxExec(...)` lines 253-258 under `TOOL_CALL_TIMEOUT_MS` = 30_000 (line 61, mirrored bound). Audit lines written for admission/result (dispatch header lines 13-15).
- `src/runtime/session-execution.ts:809-832` — `runSandboxExec` is the sandbox exec entry: validates `timeoutMs` positive int else `SCHEMA_INVALID` (lines 816-818), builds pinned argv via `buildExecArgv(sessionId, watchdogWorkload(...))` (line 819), runner rejection → `REALM_NOT_ACTIVE` (or `TOOL_TIMEOUT` on timed-out, line 826), late resolve → `TOOL_TIMEOUT` (lines 828-830). Never spawns host shell directly; workload runs under OpenShell runner inside sandbox (comment lines 799-808).
- `src/runtime/session-execution.ts:193-226` — `SessionExecution.create` fail-closed ordering: `requireAgentOs` line 195, `requireSecretRoot` line 196, `requireSandboxStateRoot` line 197 — all before any libpod/OpenShell/policy-file call (comments lines 194, 469-470, 478-479). Relative workspaceRoot → `SCHEMA_INVALID` (lines 200-202); `bindRoot(req.workspaceRoot)` line 203 denies unresolvable/non-dir with `POLICY_DENIED` (via `src/fs/root.ts:29-39`).

## Default-deny filesystem roots

- `src/core/policy.schema.json:8-31` — defaults fail-closed: `mode` default `"fail-closed"` (line 11), `workspaceRoots` default `[]` (line 16), `credentialAllow` default `[]` (line 21), `egressAllow` default `[]` (line 26), `shellEnabled` default `false` (line 30).
- `src/core/policy.ts:33-48` — missing policy file → validated defaults (fail-closed, no roots, shell disabled); unreadable → `POLICY_DENIED` (`readPolicyText` lines 67-76).
- `src/core/policy.ts:96-118` — `assertAbsoluteRoots` + `assertPolicyOutsideRoots` (policy file inside own workspace root → `POLICY_DENIED`, anti-rewrite).
- `src/fs/root.ts:29-39` — `bindRoot`: non-absolute, unresolvable, non-directory → `POLICY_DENIED`. `bindWorkspaceUnderPolicy` lines 45-55: requested must lie inside ≥1 canonical policy root else `POLICY_DENIED`. `verifyPinnedAt` lines 63-80: dev/ino + `/proc/self/fd` check, fails closed without /proc.
- `src/fs/canonicalize.ts:84-151` — `canonicalize(root, relPath)`: absolute input → `PATH_ESCAPE` (lines 89-91); symlink walk MAX 40 hops (line 24, 126-128); write-mode final symlink → `PATH_ESCAPE` (lines 122-124); final real path must `isInsideRoot` else `PATH_ESCAPE` (lines 141-150). `verifyDescriptor` lines 157-172 and `openVerified` lines 179-203: O_NOFOLLOW|O_NONBLOCK open, /proc/fd mismatch or non-regular → `PATH_ESCAPE`; missing /proc → `PATH_ESCAPE` (line 158-160). Header lines 7-8: never skipped.
- `src/runtime/config.ts:58-85` — `loadRuntimeConfig`: closed key set (`ACCEPTED_KEYS` lines 30-36), `DENIED_KEYS` host-network/driver-escape refused (lines 38-47, 62-64), digest-pinned image required (`IMAGE_PATTERN` line 28, `requireImage` line 70), absolute `stateDir`/`workspaceRoot`/optional roots (lines 71-74), root overlap rejected (lines 75-77). All violations `SCHEMA_INVALID` (line 152).
- `src/runtime/config.ts:142-149` — `runtimeRootsOf`: `secretRoot` default `<stateDir>/secrets`, `sandboxStateRoot` default `<stateDir>/sandboxes`, `workspaceRoot` required. `src/daemon/main.ts:50-51` — stale `REALM_DRIVER_*_ROOT` env ignored.

## Credential-path denial

- `src/fs/credentials.ts:13-38` — frozen `CREDENTIAL_PATTERNS`: `.env`, `.env.*`, `**/.env*`, `**/.ssh/**`, `id_rsa*`, `id_dsa`, `id_ecdsa`, `id_ed25519*`, `.aws/credentials`, `.aws/config`, `.config/gcloud/**`, `.azure/**`, `.kube/config`, `.docker/config.json`, `.netrc`, `.git-credentials`, `.gnupg/**`, `*.pem`, `*.key`, `.npmrc`, `.pypirc`.
- `src/fs/credentials.ts:40-54` — `isCredentialDenied` matches on canonical relative path (post-symlink-resolution, header lines 1-5). `assertCredentialAccess(canonicalRelPath, credentialAllow)`: denied + no `credentialAllow` glob → `CREDENTIAL_PATH_DENIED` (lines 50-54). Callers run PATH_ESCAPE checks first (header line 4), so escaping path reports `PATH_ESCAPE`.
- `src/fs/credentials.ts:59-62` — `relPathOf` covers absent (not-yet-existing) denied shapes under verified parent.

## Sandbox exec entry + allowlist locations

| Allowlist | Location |
|---|---|
| `workspaceRoots` (claim policy roots) | `src/core/policy.schema.json:13-17`; enforced `src/core/policy.ts:96-118`, `src/fs/root.ts:45-55` |
| `credentialAllow` glob override | `src/contract/validate.ts:45` (type); consumed `src/fs/credentials.ts:44-54`; schema default `[]` `src/core/policy.schema.json:18-22` |
| `egressAllow` (host+port) | `src/contract/validate.ts:46`; validated `src/runtime/session-execution.ts:175-176` (`validateEgressAllow`); enforcement doc-referenced `src/host/capabilities.ts:24,105-110` (unverified here — see Unverified) |
| `shellEnabled` | `src/core/policy.schema.json:28-31` (default false); gate `src/core/policy.ts:182-189` |
| Runtime config keys (`image,stateDir,workspaceRoot,secretRoot,sandboxStateRoot`) | `src/runtime/config.ts:30-36,58-85` |
| `OPENSHELL_ENV_NAMES` runner env filter | Referenced `src/daemon/seams.ts:44-46` (unverified definition — see Unverified) |

- `src/core/policy.ts:182-189` — `checkExecPolicy`: argv form passes; shell form without `shellEnabled` → `SHELL_NOT_ALLOWED`. `src/tools/dispatch.ts:239` calls it before state check per header lines 4-6.
- `src/core/policy.ts:152-175` — `decideMutation`: active allows; `advisory` allows non-active with warning; default fail-closed denies with `REALM_UNBOUND`/`REALM_STOPPING`/`REALM_NOT_ACTIVE` (`denyCodeFor` lines 165-175). `src/tools/dispatch.ts:7-9` — exec runs only while active in both modes.

## Fail-closed behavior (deny with code, never run unsandboxed)

| Condition | Code | Evidence |
|---|---|---|
| No libpod client at start | `SCHEMA_INVALID` | `src/daemon/daemon.ts:227-229`; also `src/daemon/seams.ts:173-175` |
| No AgentOS supervisor | `AGENTOS_NOT_CONFIGURED` | `src/runtime/session-execution.ts:462-467` (`requireAgentOs`), used create/start/probe lines 195, 272, 284; documented `src/daemon/seams.ts:178-179` |
| Missing/relative `secretRoot` or `sandboxStateRoot` | `SCHEMA_INVALID` | `src/runtime/session-execution.ts:471-485`, create lines 196-197 |
| Invalid `egressAllow` | `SCHEMA_INVALID` (constructor, before create) | `src/runtime/session-execution.ts:175-176` |
| Policy unreadable / inside own root / uncanonicalizable | `POLICY_DENIED` | `src/core/policy.ts:67-76,108-126` |
| Bad runtime config (tag image, unknown/denied key, relative root, overlap) | `SCHEMA_INVALID` | `src/runtime/config.ts:58-85,151-153` |
| Path escape / symlink / /proc missing / FIFO swap | `PATH_ESCAPE` | `src/fs/canonicalize.ts:89-91,122-128,147-150,158-172,186-189` |
| Credential shape w/o allow | `CREDENTIAL_PATH_DENIED` | `src/fs/credentials.ts:50-54` |
| Shell form, shell disabled | `SHELL_NOT_ALLOWED` | `src/core/policy.ts:186-188` |
| Exec while not active | `REALM_UNBOUND`/`REALM_STOPPING`/`REALM_NOT_ACTIVE` | `src/tools/dispatch.ts:248-250` → `src/core/policy.ts:165-175` |
| Control channel: bad method/malformed/oversized, bad run dir/socket mode/owner, chmod fail | `SCHEMA_INVALID` | `src/daemon/channel.ts:242-244,487-489,613-684` (run dir 0700 lines 655-665, socket 0600 lines 675-684) |
| Runner reject / late resolve | `REALM_NOT_ACTIVE` / `TOOL_TIMEOUT` | `src/runtime/session-execution.ts:824-830` |
| Teardown bound expiry | `REALM_STOPPING` | `src/daemon/teardown.ts:29` (withTimeout), stop loop lines 26-40 |

- `src/daemon/channel.ts:1-9` — control requests are shape-only selections; daemon checks sessionId vs pinned root (lines 107-109). `parseControlSelection` lines 160-214: every refusal `SCHEMA_INVALID`.
- `src/daemon/teardown.ts:19-41` — `stopSessions` sequential, health loop disposed, each stop under bound; failures counted, first code kept. No unsandboxed fallback anywhere in these paths — every failure above throws a catalogue `RealmError` or throws before any libpod/OpenShell call.

## Unverified

- `src/host/capabilities.ts:105-110` — exact egress enforcement body not read in assigned files; claim per grep preview only.
- `OPENSHELL_ENV_NAMES` definition (in `src/runtime/openshell.ts` per `src/runtime/session-execution.ts:809+` context) not read — assigned files only.
- `createRealmHandle` / `buildExecArgv` internals and `src/daemon/daemon.ts` dispatch body beyond line 263 not read; `buildDaemonHandle`/`defaultExec` wiring verified.
- `src/cli/init.ts` policy seed (`mode: fail-closed`, single root) seen only via grep preview; not in assigned files.
