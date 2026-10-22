# Realm policy reference

Source of truth: `src/core/policy.schema.json` (frozen schema) and
`src/core/policy.ts` (loader, mode decision, exec gate).
Defaults are declared in the schema and applied by ajv (`useDefaults: true`,
`src/contract/validate.ts:147-152`) on a clone inside `validate()`
(`src/contract/validate.ts:260-287`); the typed result is `Policy`
(`src/contract/validate.ts:30-38`).

The schema object is closed: `"additionalProperties": false`
(`src/core/policy.schema.json:6`). Unknown keys fail validation with
`SCHEMA_INVALID`; the failure message names the key and rule only, never the
value (`src/contract/validate.ts:217-256`). The nested egress rule object is
likewise closed (`src/core/policy.schema.json:43`).

Loading rules (`src/core/policy.ts:28-37`):

- The policy path is explicit and caller-supplied. A missing file (`ENOENT`)
  yields validated defaults via `validate("policy", {})` — advisory mode, no
  roots, shell disabled. Any other read failure throws `POLICY_DENIED`
  (`src/core/policy.ts:46-57`).
- Every `workspaceRoots` entry must be absolute; otherwise
  `SchemaInvalidError("/workspaceRoots/<index> must be an absolute path")`
  (`src/core/policy.ts:77-83`).
- The policy file itself must not resolve inside any of its own workspace
  roots (both sides canonicalized with `realpathSync`, segment comparison so
  `/ws-other` is not inside `/ws`, equality counts as inside); violation, or a
  root that cannot be canonicalized, throws `POLICY_DENIED`
  (`src/core/policy.ts:85-117`).
- Conventional on-disk location beside the state directory is
  `<stateDir>/policy.json` (`src/cli/main.ts:258-260`); the daemon loads it
  with `loadPolicyFile` (`src/daemon/daemon.ts:14`).

## `mode`

- **Type:** `"advisory" | "fail-closed"` (`src/core/policy.schema.json:8-12`,
  `src/contract/validate.ts:22,31`).
- **Default:** `"advisory"` (`src/core/policy.schema.json:11`).
- **Effect:** `advisory` is the default; `fail-closed` is opt-in per project
  (select it by writing `"mode": "fail-closed"` in that project's policy
  file). The value only changes the mutation decision for non-`active`
  states; `active` always allows (`src/core/policy.ts:129-140`):
  - `advisory` + non-`active` → `allow-with-warning` with message
    `` `realm is ${state}; the write proceeds under advisory policy` ``.
  - `fail-closed` + non-`active` → `deny` with code from
    `denyCodeFor` (`src/core/policy.ts:142-153`): `unbound` →
    `REALM_UNBOUND`, `stopping` → `REALM_STOPPING`, `connecting`/`degraded`/
    `error` → `REALM_NOT_ACTIVE`.
- **Enforced by:**
  - `decideMutation` (`src/core/policy.ts:129-140`).
  - `gateMutation` thin wrapper mapping allow/allow-with-warning/deny to
    proceed/proceed-with-warning/refused (`src/lifecycle/mutation-gate.ts:23-33`);
    `runGatedMutation` runs the write only when not refused and propagates
    the warning (`src/lifecycle/mutation-gate.ts:37-46`).
  - `writeWorkspaceFile` asks `deps.mutationGate()`, throws the deny code on
    `refused`, and returns the warning on `proceed-with-warning`
    (`src/tools/workspace.ts:71-97`).
  - `exec` is stricter: it runs only while `active` **in both modes**
    (`src/tools/dispatch.ts:160-175`); only `connecting` waits (see
    `toolQueueMs`), all other non-`active` states throw
    `execRefusalCode(state)` at once (`src/tools/dispatch.ts:262-273`).
    `read`, `list`, `status`, `retry` are not mutation-gated
    (`src/tools/dispatch.ts:1-18`); `retry` has its own state refusal
    (`src/tools/dispatch.ts:250-258`).

## `workspaceRoots`

- **Type:** `string[]`, each entry must be absolute (see loader rules above)
  (`src/core/policy.schema.json:13-17`, `src/contract/validate.ts:32`).
- **Default:** `[]` (`src/core/policy.schema.json:16`).
- **Effect:** the allowlist of host directories a session workspace may bind
  to. With the default (`[]`) every `create` is refused: `bindWorkspace`
  binds each policy entry with `bindRoot` (a policy root that does not
  resolve, is not a directory, or is not absolute throws `POLICY_DENIED`,
  `src/fs/root.ts:18-29`) and returns the requested root only if it lies
  inside at least one policy root; otherwise it throws `POLICY_DENIED`
  (`src/lifecycle/controller.ts:373-383`). A `create` naming a different
  workspace than the recorded/bound one (including while live) also throws
  `POLICY_DENIED` (`src/lifecycle/controller.ts:160-167`).
- **Enforced by:**
  - Startup bind in `create`: `bindWorkspace` before any record/port work,
    inside the startup budget (`src/lifecycle/controller.ts:155-156`).
  - `bindRoot` absolute + resolvable-directory check
    (`src/fs/root.ts:20-29`); containment via segment comparison
    `isInsideRoot` (`src/fs/root.ts:31-42`).
  - Every file operation then stays under the pinned root: `canonicalize`
    throws `PATH_ESCAPE` for a target escaping the root
    (`src/fs/canonicalize.ts:140-148`), which callers run before the
    credential check so escapes always report `PATH_ESCAPE`
    (`src/fs/credentials.ts:1-5`).

## `credentialAllow`

- **Type:** `string[]` of glob patterns (`src/core/policy.schema.json:18-22`,
  `src/contract/validate.ts:33`).
- **Default:** `[]` — deny everything matching the frozen denial list, allow
  nothing extra (`src/core/policy.schema.json:21`).
- **Effect:** exceptions to the frozen credential-denial list
  (`CREDENTIAL_PATTERNS`, `src/fs/credentials.ts:13-34`: `.env` shapes,
  `**/.ssh/**`, private-key names, `**/.aws/credentials`, `**/.aws/config`,
  `**/.config/gcloud/**`, `**/.azure/**`, `**/.kube/config`,
  `**/.docker/config.json`, `**/.netrc`, `**/.git-credentials`,
  `**/.gnupg/**`). Matching is on the canonical relative path (forward
  slashes) after symlink resolution (`relPathOf`,
  `src/fs/credentials.ts:55-57`), so a symlink into `~/.ssh` is still denied
  and the raw input is never matched. A denied shape with no matching
  `credentialAllow` glob throws `CREDENTIAL_PATH_DENIED`
  (`src/fs/credentials.ts:44-50`); `isCredentialDenied` /
  `isCredentialAllowed` are the two halves (`src/fs/credentials.ts:36-42`).
- **Enforced by:**
  - Dispatcher threads `deps.policy.credentialAllow` into the workspace deps
    (`src/tools/dispatch.ts:100-106`).
  - `read` (`src/tools/workspace.ts:100-112` → `src/fs/read.ts:35-36`),
    `list` (`src/tools/workspace.ts:115-123` → `src/fs/list.ts:40-42` with
    `ListOptions.credentialAllow`, `src/fs/list.ts:36-38`), and `write`
    (`src/tools/workspace.ts:84-90` → `src/fs/write.ts:55-56`, plus the
    pre-lock `writeTargetOf` check at `src/tools/workspace.ts:154-159`).

## `egressAllow`

- **Type:** `{ host: string; port: number }[]`
  (`src/core/policy.schema.json:23-27`, `src/contract/validate.ts:24-27,34`).
  Rule shape: `host` non-empty string, `port` integer 1–65535
  (`src/core/policy.schema.json:43-53`).
- **Default:** `[]` — deny-all egress (`src/core/policy.schema.json:26`).
- **Effect:** the exact destinations the sandbox may reach, rendered into the
  OpenShell `network_policies` document. Validation (`validateEgressAllow`,
  `src/runtime/egress.ts:40-45`) admits only an exact DNS hostname of at
  least two labels or an IPv4 literal, and refuses wildcards, IPv6 literals,
  `localhost`/`.localhost`, loopback `127.0.0.0/8`, link-local
  `169.254.0.0/16`, and unspecified `0.0.0.0`
  (`src/runtime/egress.ts:86-123`); refusal throws `SCHEMA_INVALID` naming no
  value (`src/runtime/egress.ts:38-39,133-135`). Rendering
  (`renderNetworkPolicies`, `src/runtime/egress.ts:50-70`) sorts by host then
  port (`src/runtime/egress.ts:125-131`), emits one `egress_<n>` entry per
  rule named `<host>:<port>` bound to the absolute workload binary
  (non-absolute binary is `SCHEMA_INVALID`, `src/runtime/egress.ts:51-53`),
  and renders an empty allowlist as `{}` (deny-all, S-20,
  `src/runtime/egress.ts:56-59`).
- **Enforced by:**
  - Daemon passes `policy.egressAllow` into the execution service
    (`src/daemon/daemon.ts:497-508`).
  - `buildPolicyDocument` embeds the D-78 rendering alongside the fixed
    filesystem/landlock/process stanza (`src/runtime/openshell.ts:231-253`).
  - `writePolicyDocument` renders before creating the runtime directory, so a
    refused allowlist or workload binary writes nothing, then writes
    `<stateDir>/runtime/<sessionId>.policy.json` atomically at 0600
    (`src/runtime/openshell.ts:255-276`).

## `shellEnabled`

- **Type:** `boolean` (`src/core/policy.schema.json:28-31`,
  `src/contract/validate.ts:35`).
- **Default:** `false` (`src/core/policy.schema.json:30`).
- **Effect:** `false` refuses the shell form of `exec`; `true` permits it.
  The argv form always passes this gate. The check decides only and never
  spawns a process; it runs on input that already passed `validate("tools",
  ...)` (`src/core/policy.ts:155-167`).
- **Enforced by:** `checkExecPolicy` throwing `SHELL_NOT_ALLOWED` when the
  params carry `shell`/`script` and the flag is off
  (`src/core/policy.ts:160-167`), called at the top of the dispatcher exec
  path before any state check, admission line, or runner invocation
  (`src/tools/dispatch.ts:163-165`; stage order
  `src/tools/dispatch.ts:1-18`). The shell form then runs as
  `["/bin/sh", "-c", script]` (`src/tools/dispatch.ts:165`).

## `startupBudgetMs`

- **Type:** `integer`, minimum 1 (`src/core/policy.schema.json:32-36`,
  `src/contract/validate.ts:36`).
- **Default:** `10000` (`src/core/policy.schema.json:35`).
- **Effect:** one deadline covering the whole startup path. In
  `LifecycleController.create` the deadline is armed before `bindWorkspace`
  and covers bind, record loads/writes, port create and start, and the bridge
  handshake; each synchronous step is followed by a deadline check and each
  port call is raced against the time left
  (`src/lifecycle/controller.ts:127-139,153-156,180-193,214-226`). Expiry
  throws/maps to `STARTUP_BUDGET_EXCEEDED` (create: `checkDeadline`,
  `src/lifecycle/controller.ts:385-391`, and the `withTimeout` races at
  `src/lifecycle/controller.ts:189-193,215-219,226`; probe races the same
  budget, `src/lifecycle/controller.ts:263-282`). A create that gives up at
  the budget destroys the container its port call later produces
  (`src/lifecycle/controller.ts:194-203`). The OMP plugin arms its detached
  autostart timer from the same parsed value (`budgetMs =
  policy.startupBudgetMs`, `src/omp/plugin.ts:186-188`); expiry paints the
  disconnected display with the existing `STARTUP_BUDGET_EXCEEDED` code while
  the session continues, and settle clears the timer
  (`src/omp/plugin.ts:173-179,205-230`). Catalogue entry:
  `STARTUP_BUDGET_EXCEEDED` is retryable
  (`src/core/errors.ts:69-72`).
- **Also see:** the single teardown bound `TEARDOWN_TIMEOUT_MS` is a separate
  constant, not this key (`src/lifecycle/controller.ts:35-38`).

## `toolQueueMs`

- **Type:** `integer`, minimum 1 (`src/core/policy.schema.json:37-41`,
  `src/contract/validate.ts:37`).
- **Default:** `2000` (`src/core/policy.schema.json:40`).
- **Effect:** how long a tool call in `connecting` waits for the state to
  leave `connecting` before proceeding to its normal decision. Applies to
  `write` (`src/tools/dispatch.ts:150-158`) and `exec`
  (`src/tools/dispatch.ts:168-172`); exec outside `active` after the wait is
  still refused in both modes (`src/tools/dispatch.ts:173-175`). `status` is
  not gated and never waits (`src/tools/dispatch.ts:186-192`).
- **Enforced by:** `waitLeavingConnecting`, which resolves when the event bus
  reports a transition from `connecting` or when the `toolQueueMs` timer
  fires, whichever comes first, clearing the timer and unsubscribing in
  either case (`src/tools/dispatch.ts:275-291`, timer at `setTimeout(finish,
  toolQueueMs)`).

## What is not a policy key

These look budget-like but are fixed constants, not policy keys (there is no
schema entry, no default to override, and no per-project opt-in). The
dispatcher states this explicitly for the call bound: "It is a constant, not
a policy key (D-101)" (`src/tools/dispatch.ts:56-57`).

| Name | Value / site | Scope (not per-project policy) |
| --- | --- | --- |
| `TOOL_CALL_TIMEOUT_MS` | `30_000` (`src/tools/dispatch.ts:57`) | Bounds one awaited tool call: the `exec` sandbox run (`src/tools/dispatch.ts:176-182`) and the `retry` create (`src/tools/dispatch.ts:207-211`). Expiry maps to `TOOL_TIMEOUT`. |
| `TEARDOWN_TIMEOUT_MS` | `5000` (`src/lifecycle/controller.ts:38`) | Single bound for `stop`/`destroy`; expiry returns `REALM_STOPPING` (`src/lifecycle/controller.ts:3-7,35-38`). |
| `OPENSHELL_CREATE_DEADLINE_MS` | `60_000` (`src/runtime/session-execution.ts:36`) | Bound for the whole OpenShell create including the label poll (`src/runtime/session-execution.ts:35-36,118-120`). |
| `CONTAINER_STOP_GRACE_MS` | `10_000` (`src/runtime/session-execution.ts:38`) | Libpod stop timeout grace period (`src/runtime/session-execution.ts:160-161`). |
| `AGENTOS_STOP_DEADLINE_MS` | `15_000` (`src/runtime/session-execution.ts:41`) | Backstop on the AgentOS stop; failures map to `AGENTOS_CRASH_LOOP` (`src/runtime/session-execution.ts:39-44,179-186`). |
| `OPENSHELL_OUTPUT_LIMIT_BYTES` | `262144` (`src/runtime/openshell.ts:53`) | Per-stream capture cap for exec output (`src/runtime/session-execution.ts:257-284`). |
| Runtime image / workload / state dir | `RuntimeConfig` (`src/runtime/config.ts:10-18`), validated by hand-written `loadRuntimeConfig` (`src/runtime/config.ts:43-67`) | Deployment inputs, not policy: image digest pin, `workloadArgv`, `stateDir`, optional `andaUrl`. Numeric limits live in `HARDENING_PROFILE`, never here (`src/runtime/config.ts:1-5`). |

Related but separate: session identity file naming (`SESSION_ID_PATTERN`,
`src/session/paths.ts:10,36-42`), state/record layout
(`src/session/paths.ts:14-34`), and the open-file/list caps such as
`MAX_LIST_ENTRIES` (`src/fs/list.ts:13`) are code constants, not policy
keys.

## Runtime configuration file

This file holds deployment inputs for the runtime: the `RuntimeConfig` type in `src/runtime/config.ts`. It is not a policy file, and none of its keys are policy keys (see "What is not a policy key" above).

Path (`resolveConfigPath`, `src/runtime/host-paths.ts`):

- `$XDG_CONFIG_HOME/realm/config.json` when `XDG_CONFIG_HOME` is an absolute path. A relative value is ignored.
- Otherwise `$HOME/.config/realm/config.json`. When `HOME` is not absolute there is no location to read, and the call is `SCHEMA_INVALID`.

Keys (`ACCEPTED_KEYS`, `src/runtime/config.ts`). The key set is closed, and any other key is refused:

- `image` (required): a digest-pinned reference in the form `name@sha256:<64 hex>`. The name starts with a lowercase letter or digit and continues with lowercase letters, digits, `.`, `_`, `/`, or `-`. A tag-only reference is refused.
- `workloadArgv` (required): a non-empty array of non-empty strings. The first element must be an absolute path (D-79).
- `stateDir` (required): an absolute path.
- `workspaceRoot` (required): an absolute path.
- `andaUrl` (optional): an `http:` or `https:` URL with no userinfo.

The CLI and the daemon both read `stateDir` from this file, and a config that omits it is `SCHEMA_INVALID`.

Reading (`readRuntimeConfigFile`, `src/runtime/config-file.ts`):

- The file is read with a 64 KiB cap (65,536 bytes).
- A missing path, a path that is not a regular file, a file over the cap, invalid JSON, and any validation failure are all `SCHEMA_INVALID`. The error names no field value.

Policy file: `<stateDir>/policy.json` (`defaultPolicyPath`, `src/runtime/host-paths.ts`).

Example. The digest is a placeholder of 64 zeros. It is not a real image, and this document does not claim that any image with this name or digest exists. The paths are illustrative.

```json
{
  "image": "realm-workload@sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "workloadArgv": ["/usr/bin/node", "/opt/realm/workload.js"],
  "stateDir": "/home/user/.local/state/realm",
  "workspaceRoot": "/home/user/projects/example"
}
```

