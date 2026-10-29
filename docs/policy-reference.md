# Realm policy reference

Source of truth: `src/core/policy.schema.json` (frozen schema) and
`src/core/policy.ts` (loader, mode decision, exec gate).
Defaults are declared in the schema and applied by ajv (`useDefaults: true`,
the `ajv` instance in `src/contract/validate.ts`) on a clone inside `validate()`
(`validate`, `src/contract/validate.ts`); the typed result is `Policy`
(the `Policy` interface in `src/contract/validate.ts`).

The schema object is closed: `"additionalProperties": false` at the top level
of `src/core/policy.schema.json`. Unknown keys fail validation with
`SCHEMA_INVALID`; the failure message names the key and rule only, never the
value (`describeFailure`, `src/contract/validate.ts`). The nested egress rule object is
likewise closed (`$defs/egressRule` in `src/core/policy.schema.json`).

Loading rules (`loadPolicyFile`, `src/core/policy.ts`):

- The policy path is explicit and caller-supplied. A missing file (`ENOENT`)
  yields validated defaults via `validate("policy", {})` — `fail-closed` mode, no
  roots, shell disabled. Any other read failure throws `POLICY_DENIED`
  (`readPolicyText`, `src/core/policy.ts`).
- Every `workspaceRoots` entry must be absolute; otherwise
  `SchemaInvalidError("/workspaceRoots/<index> must be an absolute path")`
  (`assertAbsoluteRoots`, `src/core/policy.ts`).
- The policy file itself must not resolve inside any of its own workspace
  roots (both sides canonicalized with `realpathSync`, segment comparison so
  `/ws-other` is not inside `/ws`, equality counts as inside); violation, or a
  root that cannot be canonicalized, throws `POLICY_DENIED`
  (`assertPolicyOutsideRoots`, with `canonical` and `isInside`,
  `src/core/policy.ts`).
- Conventional on-disk location beside the state directory is
  `<stateDir>/policy.json` (`defaultPolicyPath`, `src/runtime/host-paths.ts`,
  passed by the daemon entry in `src/daemon/main.ts`); the daemon loads it
  with `loadPolicyFile` (`buildDaemonHandle`, `src/daemon/daemon.ts`).

## `mode`

- **Type:** `"advisory" | "fail-closed"` (the `mode` property of
  `src/core/policy.schema.json`; `PolicyMode` and `Policy.mode` in
  `src/contract/validate.ts`).
- **Default:** `"fail-closed"` (the `mode` property of `src/core/policy.schema.json`).
  A policy file with no `mode` key, and a missing policy file, both load as
  `fail-closed`. Decision D4 (2026-10-29) made this the default; earlier
  releases loaded those inputs as `advisory`.
- **Effect:** `fail-closed` is the default; `advisory` is the explicit opt-in
  (select it by writing `"mode": "advisory"` in the policy file; it is never
  applied without that value). The value changes the mutation decision for
  non-`active` states. `active` allows a mutation in both modes, whether or
  not an Anda bridge is configured (`decideMutation`, `src/core/policy.ts`):
  - `fail-closed` + non-`active` → `deny` with code from
    `denyCodeFor` (`src/core/policy.ts`): `unbound` →
    `REALM_UNBOUND`, `stopping` → `REALM_STOPPING`, `connecting`/`degraded`/
    `error` → `REALM_NOT_ACTIVE`.
  - `advisory` + non-`active` → `allow-with-warning` with message
    `` `realm is ${state}; the write proceeds under advisory policy` ``.
  - `active` → `allow`, in both modes, whether or not an Anda bridge is configured. A configured bridge that goes down moves the session to `degraded` (reason `ANDA_UNREACHABLE`), which is handled by the rows above.
- **Enforced by:**
  - `decideMutation` (`src/core/policy.ts`).
  - `gateMutation` thin wrapper mapping allow/allow-with-warning/deny to
    proceed/proceed-with-warning/refused (`src/lifecycle/mutation-gate.ts`);
    `runGatedMutation` runs the write only when not refused and propagates
    the warning (`src/lifecycle/mutation-gate.ts`).
  - `writeWorkspaceFile` asks `deps.mutationGate()`, throws the deny code on
    `refused`, and returns the warning on `proceed-with-warning`
    (`src/tools/workspace.ts`).
  - `exec` is stricter: it runs only while `active` **in both modes**
    (`ToolDispatcher.#exec`, `src/tools/dispatch.ts`); only `connecting` waits (see
    `toolQueueMs`), all other non-`active` states throw
    `execRefusalCode(state)` at once (`execRefusalCode`, `src/tools/dispatch.ts`).
    `read`, `list`, `status`, `retry` are not mutation-gated
    (stage list in the header comment of `src/tools/dispatch.ts`); `retry` has its own state refusal
    (`refuseRetryIn`, `src/tools/dispatch.ts`).

Advisory is the opt-in for a deployment that prefers to keep working while the realm is down; it is not containment. The default `fail-closed` refuses host `write` and `edit` calls while the realm is not active; it does not contain Omp's built-in `write`, `edit` and `bash` while the realm is active, which still act on the host. Containing the built-ins is planned work (Phase 16 of milestone v3.0). The posture and its limits are set out in `docs/integration/hardening-plan.md`.

`realm doctor` reports the mode in its `policy-file` check, says whether the file set it or the default applies, and warns for an explicit `advisory`. `realm status` and `realm up` print the mode in effect.

Supersession. The product spec (`docs/specs/realm-spec.xml`, read-only) still carries its line on the default mode from before decision D4, which names the old value. Decision D4 supersedes that line; this document and the schema are authoritative for the default.

### Upgrading

A policy that has no `mode` key, or no policy file at all, used to load as `advisory`. It now loads as `fail-closed`. While the realm is not active (not yet started, connecting, degraded, stopping or in error), host writes that used to proceed with a warning are refused: the Omp guard blocks `write` and `edit` with `REALM_NOT_ACTIVE` (or `REALM_UNBOUND` or `REALM_STOPPING` for those states), and `write` through the tool dispatcher is denied the same way. Start the realm (`realm up`, or `/realm-retry` in Omp) to proceed. To keep the earlier behaviour, add `"mode": "advisory"` to `<stateDir>/policy.json` and restart the daemon; to take the new default, change nothing. `exec` is unchanged: it was already refused outside `active` in both modes.

## `workspaceRoots`

- **Type:** `string[]`, each entry must be absolute (see loader rules above)
  (the `workspaceRoots` property of `src/core/policy.schema.json`;
  `Policy.workspaceRoots` in `src/contract/validate.ts`).
- **Default:** `[]` (the `workspaceRoots` property of `src/core/policy.schema.json`).
- **Effect:** the allowlist of host directories a session workspace may bind
  to. With the default (`[]`) the bind is refused with `POLICY_DENIED`, so no
  session is created: `bindWorkspaceUnderPolicy` (`src/fs/root.ts`) binds each
  policy entry with `bindRoot` (a policy root that does not
  resolve, is not a directory, or is not absolute throws `POLICY_DENIED`,
  `bindRoot`, `src/fs/root.ts`) and returns the configured workspace root only if it lies
  inside at least one policy root; otherwise it throws `POLICY_DENIED`.
  `createRealmHandle` (`src/realm/compose.ts`) runs this bind once, at
  construction. A `create` naming a different
  workspace than the pinned one, or than the recorded one while a container
  is recorded or the session is live, also throws
  `POLICY_DENIED` (`LifecycleController.create`, `src/lifecycle/controller.ts`,
  through `verifyPinnedAt`, `src/fs/root.ts`).
  A session create is also refused with `POLICY_DENIED`, before any libpod,
  OpenShell or policy-file call, unless the driver's pinned root
  (`REALM_DRIVER_WORKSPACE_ROOT`, the root the sandbox mounts at `/workspace`)
  and the policy-approved workspace are the same directory once both are
  resolved with `realpath` (`src/runtime/session-execution.ts`). A symbolic
  link to the same directory is the same directory. A pinned root that is a
  parent of the approved workspace is refused, because the sandbox would reach
  sibling directories the policy never approved: pin the project directory,
  not its parent. A path that cannot be resolved is refused the same way.
- **Breadth (residual R7):** the loader accepts any absolute directory, including the filesystem root `/`. A root of `/` places every host path inside a policy root, so the bind check no longer narrows the workspace. Keep each root as narrow as the project needs. No breadth refusal is implemented; the Phase 7 security review records R7 as an open residual (`.planning/milestones/v1.0-phases/07-policy-reference-and-security-review/07-SECURITY-REVIEW.md`, section 6).
- **Enforced by:**
  - Startup bind: `createRealmHandle` (`src/realm/compose.ts`) calls
    `bindWorkspaceUnderPolicy` before the controller exists. In
    `LifecycleController.create` the pinned-root check (`verifyPinnedAt`) runs
    before any record/port work, inside the startup budget.
  - `bindRoot` absolute + resolvable-directory check
    (`bindRoot`, `src/fs/root.ts`); containment via segment comparison
    `isInsideRoot` (`src/fs/root.ts`).
  - Every file operation then stays under the pinned root: `canonicalize`
    throws `PATH_ESCAPE` for a target escaping the root
    (`canonicalize`, `src/fs/canonicalize.ts`), which callers run before the
    credential check so escapes always report `PATH_ESCAPE`
    (header comment of `src/fs/credentials.ts`).

## `credentialAllow`

- **Type:** `string[]` of glob patterns (the `credentialAllow` property of
  `src/core/policy.schema.json`; `Policy.credentialAllow` in `src/contract/validate.ts`).
- **Default:** `[]` — deny everything matching the frozen denial list, allow
  nothing extra (the `credentialAllow` property of `src/core/policy.schema.json`).
- **Effect:** exceptions to the frozen credential-denial list
  (`CREDENTIAL_PATTERNS`, `src/fs/credentials.ts`: `.env` shapes,
  `**/.ssh/**`, private-key names, `**/*.pem`, `**/*.key`, `**/.npmrc`,
  `**/.pypirc`, `**/.aws/credentials`, `**/.aws/config`,
  `**/.config/gcloud/**`, `**/.azure/**`, `**/.kube/config`,
  `**/.docker/config.json`, `**/.netrc`, `**/.git-credentials`,
  `**/.gnupg/**`). `credentialAllow` can permit a specific path that one of
  these patterns would deny. Matching is on the canonical relative path (forward
  slashes) after symlink resolution (`relPathOf`,
  `src/fs/credentials.ts`), so a symlink into `~/.ssh` is still denied
  and the raw input is never matched. A denied shape with no matching
  `credentialAllow` glob throws `CREDENTIAL_PATH_DENIED`
  (`assertCredentialAccess`, `src/fs/credentials.ts`); `isCredentialDenied` /
  `isCredentialAllowed` are the two halves (`src/fs/credentials.ts`).
- **Enforced by:**
  - The `ToolDispatcher` constructor threads `deps.policy.credentialAllow` into the
    workspace deps (`src/tools/dispatch.ts`).
  - `read` (`readWorkspaceFile`, `src/tools/workspace.ts` → `readFileCapped`, `src/fs/read.ts`),
    `list` (`listWorkspaceDir`, `src/tools/workspace.ts` → `listDir`, `src/fs/list.ts`, with
    `ListOptions.credentialAllow`), and `write`
    (`writeWorkspaceFile`, `src/tools/workspace.ts` → `lockedWrite`, `src/fs/write.ts`, plus the
    pre-lock `writeTargetOf` check in `src/tools/workspace.ts`).

## `egressAllow`

- **Type:** `{ host: string; port: number }[]`
  (the `egressAllow` property of `src/core/policy.schema.json`; `EgressRule` and
  `Policy.egressAllow` in `src/contract/validate.ts`).
  Rule shape: `host` non-empty string, `port` integer 1–65535
  (`$defs/egressRule` in `src/core/policy.schema.json`).
- **Default:** `[]` — deny-all egress (the `egressAllow` property of `src/core/policy.schema.json`).
- **Effect:** the exact destinations the sandbox may reach, rendered into the
  OpenShell `network_policies` document. Validation (`validateEgressAllow`,
  `src/runtime/egress.ts`) admits only an exact DNS hostname of at
  least two labels or an IPv4 literal, and refuses wildcards, IPv6 literals,
  `localhost`/`.localhost`, and these IPv4 literal ranges: `0.0.0.0/8`,
  `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`,
  `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15` (the
  sandbox resolver hands out synthetic answers in this range), `224.0.0.0/4`
  and `240.0.0.0/4` (which includes `255.255.255.255`)
  (`isAllowedHost`, `src/runtime/egress.ts`); refusal throws `SCHEMA_INVALID` naming no
  value (`reject`, `src/runtime/egress.ts`). Any host whose last label is
  decimal digits, or `0x` plus hex digits, is refused unless the whole host is a
  canonical dotted quad outside the refused ranges, so hex, octal-looking and
  short notations such as `0x7f.0.0.0x1` and `127.1` are refused. The check is
  lexical: a hostname that resolves to a private address is not refused at
  validation time, and the supervisor resolves hostnames. Rendering
  (`renderNetworkPolicies`, `src/runtime/egress.ts`) sorts by host then
  port (`compareRules`, `src/runtime/egress.ts`), emits one `egress_<n>` entry per
  rule named `<host>:<port>` bound to the absolute workload binary
  (non-absolute binary is `SCHEMA_INVALID`, `renderNetworkPolicies`),
  and renders an empty allowlist as `{}` (deny-all, S-20,
  `renderNetworkPolicies`).
- **Enforced by:**
  - Daemon passes `policy.egressAllow` into the execution service
    (`defaultExec`, `src/daemon/daemon.ts`).
  - `buildPolicyDocument` embeds the D-78 rendering alongside the fixed
    filesystem/landlock/process stanza (`src/runtime/openshell.ts`).
  - `writePolicyDocument` renders before creating the runtime directory, so a
    refused allowlist or workload binary writes nothing, then writes
    `<stateDir>/runtime/<sessionId>.policy.json` atomically at 0600
    (`src/runtime/openshell.ts`).

## `shellEnabled`

- **Type:** `boolean` (the `shellEnabled` property of `src/core/policy.schema.json`;
  `Policy.shellEnabled` in `src/contract/validate.ts`).
- **Default:** `false` (the `shellEnabled` property of `src/core/policy.schema.json`).
- **Effect:** `false` refuses the shell form of `exec`; `true` permits it.
  The argv form always passes this gate. The check decides only and never
  spawns a process; it runs on input that already passed `validate("tools",
  ...)` (`checkExecPolicy`, `src/core/policy.ts`).
- **Enforced by:** `checkExecPolicy` throwing `SHELL_NOT_ALLOWED` when the
  params carry `shell`/`script` and the flag is off
  (`checkExecPolicy`, `src/core/policy.ts`), called at the top of the dispatcher exec
  path before any state check, admission line, or runner invocation
  (`ToolDispatcher.#exec`, `src/tools/dispatch.ts`; stage order in the
  header comment of `src/tools/dispatch.ts`). The shell form then runs as
  `["/bin/sh", "-c", script]` (`ToolDispatcher.#exec`).

## `startupBudgetMs`

- **Type:** `integer`, minimum 1 (the `startupBudgetMs` property of
  `src/core/policy.schema.json`; `Policy.startupBudgetMs` in `src/contract/validate.ts`).
- **Default:** `200000` ms (the `startupBudgetMs` property of `src/core/policy.schema.json`). The default covers the AgentOS start timeout of 180 s with margin.
- **Effect:** one deadline covering the whole startup path. In
  `LifecycleController.create` the deadline is armed before the pinned-root
  check (`verifyPinnedAt`)
  and covers that check, record loads/writes, port create and start, and the bridge
  handshake; each synchronous step is followed by a deadline check and each
  port call is raced against the time left
  (`LifecycleController.create`, `src/lifecycle/controller.ts`). Expiry
  throws/maps to `STARTUP_BUDGET_EXCEEDED` (create: `checkDeadline`,
  `src/lifecycle/controller.ts`, and the `withTimeout` races in
  `LifecycleController.create`; probe races the same
  budget, `LifecycleController.probe`). A create that gives up at
  the budget destroys the container its port call later produces
  (`LifecycleController.create` and `failCreate`, `src/lifecycle/controller.ts`). The Omp plugin
  does not read this key: the policy is daemon-owned, so the plugin arms its
  own detached attach timer from `STARTUP_BUDGET_MS` (`src/omp/plugin.ts`), a
  constant equal to this key's schema default (`200000`), through `armTimer` in
  the `attach` function of `registerRealmPlugin`. A project that sets another
  `startupBudgetMs` therefore does not change the plugin's timer. Expiry paints the
  disconnected display with the existing `STARTUP_BUDGET_EXCEEDED` code while
  the session continues, and settle clears the timer (`disarmTimer`,
  `src/omp/plugin.ts`). Catalogue entry:
  `STARTUP_BUDGET_EXCEEDED` is retryable
  (`ERROR_CATALOGUE` in `src/core/errors.ts`).
  The control channel's `up` request waits 230 s (the 200 s default plus a
  30 s reply margin; `CONTROL_TIMEOUT_MS`, `src/daemon/channel.ts`) before
  the caller reports `TOOL_TIMEOUT`, while `status`, `down`, `doctor` and
  `tool` keep their own limits. No CLI or plugin caller reads the
  daemon-owned policy, so a `startupBudgetMs` above 200 s can still outlast
  the `up` request limit; the plugin's own 200 s timer is unchanged and fires
  first.
- **Also see:** the single teardown bound `TEARDOWN_TIMEOUT_MS` (30000 ms) is a separate
  constant, not this key (`TEARDOWN_TIMEOUT_MS`, `src/lifecycle/controller.ts`).

## `toolQueueMs`

- **Type:** `integer`, minimum 1 (the `toolQueueMs` property of
  `src/core/policy.schema.json`; `Policy.toolQueueMs` in `src/contract/validate.ts`).
- **Default:** `2000` (the `toolQueueMs` property of `src/core/policy.schema.json`).
- **Effect:** how long a tool call in `connecting` waits for the state to
  leave `connecting` before proceeding to its normal decision. Applies to
  `write` (`ToolDispatcher.#write`, `src/tools/dispatch.ts`) and `exec`
  (`ToolDispatcher.#exec`); exec outside `active` after the wait is
  still refused in both modes (`ToolDispatcher.#exec`). `status` is
  not gated and never waits (`ToolDispatcher.#status`).
- **Enforced by:** `waitLeavingConnecting`, which resolves when the event bus
  reports a transition from `connecting` or when the `toolQueueMs` timer
  fires, whichever comes first, clearing the timer and unsubscribing in
  either case (`waitLeavingConnecting`, `src/tools/dispatch.ts`, timer at `setTimeout(finish,
  toolQueueMs)`).

## What is not a policy key

These look budget-like but are fixed constants, not policy keys (there is no
schema entry, no default to override, and no per-project opt-in). The
dispatcher states this explicitly for the call bound: "It is a constant, not
a policy key (D-101)" (`TOOL_CALL_TIMEOUT_MS`, `src/tools/dispatch.ts`).

| Name | Value / site | Scope (not per-project policy) |
| --- | --- | --- |
| `TOOL_CALL_TIMEOUT_MS` | `30_000` (`src/tools/dispatch.ts`) | Bounds one awaited tool call: the `exec` sandbox run (`ToolDispatcher.#exec`) and the `retry` create (`ToolDispatcher.#retry`). Expiry maps to `TOOL_TIMEOUT`. |
| `TEARDOWN_TIMEOUT_MS` | `30_000` (`src/lifecycle/controller.ts`) | Single bound for `stop`/`destroy`; expiry returns `REALM_STOPPING` (header comment and `teardownBound` of `LifecycleController`, `src/lifecycle/controller.ts`). |
| `OPENSHELL_CREATE_DEADLINE_MS` | `60_000` (`src/runtime/session-execution.ts`) | Bound for the whole OpenShell create including the label poll (`OPENSHELL_CREATE_DEADLINE_MS`, `src/runtime/session-execution.ts`). |
| `CONTAINER_STOP_GRACE_MS` | `10_000` (`src/runtime/session-execution.ts`) | Libpod stop timeout grace period (`CONTAINER_STOP_GRACE_MS`, `src/runtime/session-execution.ts`). |
| `AGENTOS_STOP_DEADLINE_MS` | `15_000` (`src/runtime/session-execution.ts`) | Backstop on the AgentOS stop; a missed deadline is a failed stop and maps to `AGENTOS_STOP_FAILED` (`AGENTOS_STOP_DEADLINE_MS` and `stopDeadlineMs`, `src/runtime/session-execution.ts`). |
| `OPENSHELL_OUTPUT_LIMIT_BYTES` | `262144` (`src/runtime/openshell.ts`) | Per-stream capture cap for exec output (`BoundedOutput`, `src/runtime/session-execution.ts`). |
| Runtime image / state dir | `RuntimeConfig` (`src/runtime/config.ts`), validated by hand-written `loadRuntimeConfig` (`src/runtime/config.ts`) | Deployment inputs, not policy: image digest pin, `stateDir`, optional `andaUrl`. Numeric limits live in `HARDENING_PROFILE`, never here (header comment of `src/runtime/config.ts`). |

Related but separate: session identity file naming (`SESSION_ID_PATTERN`,
`isSessionId` and `recordFileName`, `src/session/paths.ts`), state/record layout
(`sessionsDirOf` and `controlSocketPath`, `src/session/paths.ts`), and the open-file/list caps such as
`MAX_LIST_ENTRIES` (`src/fs/list.ts`) are code constants, not policy
keys.

## Runtime configuration file

This file holds deployment inputs for the runtime: the `RuntimeConfig` type in `src/runtime/config.ts`. It is not a policy file, and none of its keys are policy keys (see "What is not a policy key" above).

Path (`resolveConfigPath`, `src/runtime/host-paths.ts`):

- `$XDG_CONFIG_HOME/realm/config.json` when `XDG_CONFIG_HOME` is an absolute path. A relative value is ignored.
- Otherwise `$HOME/.config/realm/config.json`. When `HOME` is not absolute there is no location to read, and the call is `SCHEMA_INVALID`.

Keys (`ACCEPTED_KEYS`, `src/runtime/config.ts`). The key set is closed, and any other key is refused:

- `image` (required): a digest-pinned reference in the form `name@sha256:<64 hex>`. The name starts with a lowercase letter or digit and continues with lowercase letters, digits, `.`, `_`, `/`, or `-`. A tag-only reference is refused.
- `stateDir` (required): an absolute path.
- `workspaceRoot` (required): an absolute path.
- `andaUrl` (optional): an `http:` or `https:` URL with no userinfo. Its presence decides whether the Anda bridge is required (`andaBridgeRequired`, `src/runtime/config.ts`).
  - Set: the bridge is required at start. The start runs the bridge handshake, and an unreachable bridge refuses the start with `ANDA_UNREACHABLE`.
  - Absent: no Anda bridge is attached and there is no handshake, so the session goes `active` once the runner start succeeds. While `active` with no bridge, `exec` and `write` run exactly as they do with a bridge, in both policy modes. `status`, `read`, `list`, and `retry` do not need the bridge. If a configured bridge later goes down, the session moves to `degraded` and `exec` and `write` are refused as in any non-active state.

The CLI and the daemon both read `stateDir` from this file, and a config that omits it is `SCHEMA_INVALID`.

Reading (`readRuntimeConfigFile`, `src/runtime/config-file.ts`):

- The file is read with a 64 KiB cap (65,536 bytes).
- A missing path, a path that is not a regular file, a file over the cap, invalid JSON, and any validation failure are all `SCHEMA_INVALID`. The error names no field value.

Policy file: `<stateDir>/policy.json` (`defaultPolicyPath`, `src/runtime/host-paths.ts`).

Example. The digest is a placeholder of 64 zeros. It is not a real image, and this document does not claim that any image with this name or digest exists. The paths are illustrative.

```json
{
  "image": "realm-workload@sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "stateDir": "/srv/realm/state",
  "workspaceRoot": "/srv/realm/workspace"
}
```

