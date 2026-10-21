# Phase 4: Reaper, Egress Guard, and Shared Dispatcher - Context

**Gathered:** 2026-10-21
**Status:** Ready for planning
**Mode:** `--auto` (all gray areas auto-selected; each choice derived from `docs/specs/realm-spec.xml` (nodes n3, n5, n6), the settled inputs S-17 to S-23 below, the carried inputs S-07 to S-12, and the frozen Phase 2 and Phase 3 code and decisions. Decision IDs continue from Phase 3 (D-75 onward). Open questions are `OQ-P4-xx`.)

<domain>
## Phase Boundary

Phase 4 delivers the three guards that sit between the lifecycle controller and the sandbox:

1. **Reaper (RT-08).** A startup reap removes every realm-labelled container and every stale session record left by a previous crash, including a crash during `realm up`.
2. **Egress guard (RT-05).** `Policy.egressAllow` becomes the only egress allowlist. It is validated at config load, rendered into an OpenShell `network_policies` document at create time, and proven offline by render tests. Host networking and IPv6 hosts are refused.
3. **Shared dispatcher (TOOL-03, TOOL-04).** One function, `ToolDispatcher.call`, is the only entry point for the six tools. Every call runs schema validation, then the state gate, then the lock check, then the audit admission, then execution. Every call has a timeout. A call made while the state is `connecting` waits at most `toolQueueMs` before a structured result.

The phase also resolves the two Phase 3 deferrals that were blocked on evidence: the OpenShell `network_policies` shape (OQ-P3-16) and the exec verb (Phase 3 deferred "any per-call exec through OpenShell, because no exec verb is in the pinned OpenShell set").

Out of this phase (see `<deferred>`): the process that calls the reaper at startup and the control socket (RT-06, Phase 6); the Omp, MCP, and ACP surfaces that call the dispatcher (Phase 5); the CLI (Phase 6); live egress and reap proofs (gated on Podman 5.x); any new error code (the catalogue is frozen at 22 codes); any new policy key.

**Verification boundary.** The host runs Podman 4.9.3 and OpenShell 0.1.2. No live container, OpenShell gateway, or egress proxy run is possible here. Every behavior is tested with in-process fakes (the fake libpod socket server, the injected OpenShell runner, the fake bridge). Live behavior is written as gated suites that skip with `PODMAN_UNSUPPORTED_VERSION`. A phase verification can only report "unit-verified, live-gated". It must not report live verification.

</domain>

<spec_lock>
## Requirements Lock (source: `.planning/REQUIREMENTS.md` and `docs/specs/realm-spec.xml`)

Phase requirements: **RT-05, RT-08, TOOL-03, TOOL-04** (4 IDs). Their text lives in `.planning/REQUIREMENTS.md` and is not restated here. No phase-level `*-SPEC.md` exists, so `spec_loaded = false`. Where a requirement's wording conflicts with a settled input, the settled input governs and the conflict is recorded in D-75 and D-76. The requirement text is not edited in this phase.

Success criteria are taken from `.planning/ROADMAP.md` Phase 4 (SC1 to SC4), and the spec anchors are `docs/specs/realm-spec.xml` `NETWORK_POLICY`, `LIFECYCLE`, and n3's module map (`src/session/reap.ts`, `src/runtime/egress.ts`, `src/tools/dispatch.ts`).

</spec_lock>

<decisions>
## Implementation Decisions

### Settled inputs (from the user; not reopened in this discussion)

- **S-17:** Policy default is **advisory** with a visible warning. **Fail-closed** is an opt-in per project. (Carried S-07.) Phase 4 adds the dispatcher, which applies the mode through the existing `decideMutation` (D-23) and `gateMutation` (Phase 3 D-63). The mode logic is not redefined.
- **S-18:** **One sandbox per session**, named `realm-<sessionId>`. The OpenShell gateway runs on the host. The sandbox container is created by OpenShell's Podman driver, and Realm verifies it (carried S-08, D-47).
- **S-19:** Advisory locks live in the daemon, keyed by canonical path. **Reaping keys off the session record and the realm label.** (Carried S-02 to S-04.)
- **S-20:** **Egress default deny.** The Phase 3 policy document has an empty `network_policies` map, which is deny-all. An allowlist entry becomes an OpenShell network policy entry. Live enforcement is gated on Podman 5.x. Offline proof uses policy render tests.
- **S-21:** **Audit failure blocks the tool call (fail closed).** This is owed by Phase 2 (`AUDIT_WRITE_FAILED`) and is enforced by the shared dispatcher in this phase.
- **S-22:** **One dispatcher.** Every tool call goes through schema validation, then state gate, then lock, then audit, then execution. There is no bypass path. Timeouts are enforced. Queued calls wait for `toolQueueMs` (default 2000) before a structured error.
- **S-23:** Host Podman is **4.9.3**. Live suites stay gated with `PODMAN_UNSUPPORTED_VERSION`. Unit tests use fakes and the fake socket server. The local install is not changed.
- **Carried:** OpenShell CLI pinned to the **0.1.2** verbs (S-10). AgentOS library mode primary (S-11). Anda is a TypeScript HTTP client with no shim (S-12). Podman rootless, hardening profile D-51 (including `NetworkMode: none`).

### Requirement-text conflicts resolved by the settled inputs and the documented model

- **D-75:** RT-05 and ROADMAP Phase 4 SC2 say "from inside the container, a request to a non-allowlisted host fails". The documented OpenShell Podman driver creates the workload container with networking turned off, and egress passes only through the supervisor's CONNECT proxy, which enforces `network_policies` (`docs/integration/openshell.md` Q4, Q9). The requirement is realized as "from inside the sandbox, through the supervisor proxy". The wording is not edited. **Reversibility:** costly, because the egress architecture depends on it.

- **D-76:** IPv6. RT-05 says "IPv6 is disabled". Realm does not create the container and cannot set its sysctls, so Realm cannot disable IPv6 directly. Phase 4 enforces what Realm can and reports the rest:
  (a) no IPv6 host or address appears in any rendered `network_policies` entry (D-80 rejects IPv6 literals);
  (b) the hardening verifier keeps `NetworkMode: none` (D-51). The workload container therefore has no interface and no IPv6 address;
  (c) whether the supervisor proxy blocks IPv6 egress is unverified and live-gated (OQ-P4-01).
  The unit suite reports RT-05 IPv6 as **partially unit-verified**. **Reversibility:** reversible (the reporting), costly for the verifier property.

### Egress guard (RT-05)

- **D-77:** Source and validation. `Policy.egressAllow` (frozen schema, Phase 2) is the **only** egress allowlist. No new policy key is added. `validateEgressAllow(rules)` in `src/runtime/egress.ts` accepts an entry only when:
  - `host` is an exact DNS hostname (at least two labels, letters, digits, and hyphens) or an IPv4 literal;
  - `host` is not an IPv6 literal (it contains `:` or `[` `]`), not a wildcard (`*`), not `localhost`, and not in the loopback `127.0.0.0/8`, link-local `169.254.0.0/16`, or unspecified `0.0.0.0` ranges (OpenShell refuses those destinations regardless of policy, and Realm refuses them earlier);
  - `port` is an integer from 1 to 65535 (already enforced by the schema, re-checked for the runtime path).
  A refused entry fails at config load with `SCHEMA_INVALID`. Wildcard hosts are deliberately excluded (OpenShell allows them; Realm is conservative until an allowlist need is recorded). **Reversibility:** reversible.

- **D-78:** Rendering. `renderNetworkPolicies(rules, workloadBinary)` in `src/runtime/egress.ts`:
  - an empty allowlist renders to `{}` (deny-all, S-20);
  - otherwise rules are sorted by host, then port, and each becomes one entry keyed `egress_<n>` (n counts from 0 after sorting, so the output is deterministic):
    `{ "name": "<host>:<port>", "endpoints": [{ "host": "<host>", "port": <port> }], "binaries": [{ "path": "<workloadBinary>" }] }`.
  Realm writes **only** `name`, `endpoints[].host`, `endpoints[].port`, and `binaries[].path`. It writes no `allowed_ips`, `path`, `ports`, `protocol`, `access`, `rules`, `deny_rules`, `network_middlewares`, or `_provider_` key. Realm's fields are the ones the v0.1.2 schema documents (OQ-P3-16 resolution, D-82). **Reversibility:** costly, because the rendered shape is a documented contract.

- **D-79:** The workload binary. OpenShell matches a network rule by the executable that opens the connection or one of its parent processes, and an empty `binaries` list matches nothing. Realm therefore needs an absolute executable path. `loadRuntimeConfig` now requires `workloadArgv[0]` to be an absolute path, otherwise `SCHEMA_INVALID`. The workload interpreter covers its children through parent-process matching. This tightens Phase 3 (D-52) and requires updating any Phase 3 test fixture whose `workloadArgv[0]` is relative. **Reversibility:** costly (the config contract changes).

- **D-80:** Host networking and driver escape are refused at config load. `RuntimeConfig` keeps its closed key set (D-52), so unknown keys are already `SCHEMA_INVALID`. Phase 4 adds an explicit denylist of names (`network`, `networkMode`, `hostNetwork`, `netns`, `driverConfig`, `driverConfigJson`) so the refusal is named in the test and in the reason. The OpenShell argv builder never emits `--driver-config-json` (the `sandbox create` help describes it as a driver-keyed object for driver-specific settings that Realm cannot inspect, disabled unless the gateway enables `allow_driver_config`), `--forward`, `--expose`, `--template`, `--provider`, `--env`, or `--auto-providers`. A test asserts each absence. **Reversibility:** reversible.

- **D-81:** The policy document. `buildPolicyDocument(egress, workloadBinary)` in `src/runtime/openshell.ts` replaces the Phase 3 no-argument form. It renders `network_policies` through D-78. `version`, `filesystem_policy`, `landlock`, and `process` are unchanged from D-57. The document is still JSON, still written atomically with mode 0600, and still written before the create argv (RT-07 ordering). Egress is fixed at create time. Changing it requires destroying and recreating the session (OQ-P4-10). **Reversibility:** costly for the shape; reversible for the timing.

- **D-82:** OQ-P3-16 resolved for the fields Realm writes. Source: `https://docs.nvidia.com/openshell/v0.1.2/how-it-works/policies/schema.md`, read 2026-10-21 (the pinned CLI is 0.1.2, so the v0.1.2 index is used, not the v0.1.5 page). The page documents: `network_policies` as a map of rules; a rule with `name`, `endpoints` (list), and `binaries` (list); an endpoint with `host` and `port` or `ports`; a binary object with `path`; and that an empty `binaries` list matches no binary. The inspection and protocol fields are not used. The live acceptance of this document is gated (OQ-P4-02). Recorded in `docs/integration/runtime-decision.md` (D-100).

- **D-83 (verifier unchanged).** The hardening verifier (D-51) keeps `NetworkMode: none`, which matches the documented Podman driver. Egress is the sandbox proxy's job and is not container networking. No hardening property changes in Phase 4. **Reversibility:** costly (RT-01 contract).

### Reaper (RT-08)

- **D-84:** Startup reap. `reapStartup({ store, sweep })` in `src/session/reap.ts` runs in this order:
  1. `sweep()` removes every realm-labelled container and proves zero survivors. The sweep is the Phase 3 `removeAllRealmContainers`, moved unchanged in behavior to `src/runtime/sweep.ts` and extended to return the number removed. `session` does not import `runtime` (D-50), so the sweep arrives as a function argument.
  2. Only after the sweep reports zero survivors, every session record is deleted (`store.list()` then `store.delete(id)`).
  Containers are removed before records, so a crash during reap leaves the records that the next start needs. A second reap is a no-op. A failed sweep (`REALM_STOPPING`) leaves all records in place. **Reversibility:** reversible.

- **D-85:** `SessionStore.list()` returns the session ids from `<sessionsDir>/*.json` file names that pass `recordFileName`'s pattern. It does not parse the contents, so a corrupt record can still be deleted. **Reversibility:** reversible.

- **D-86:** A crash during `realm up` is covered in both record states. The record is written with `containerId: null` before the create (RT-07, Phase 2 D-38). The OpenShell create labels the container with `io.realm.managed=true` and `io.realm.session=<id>` (Phase 3 D-55). Whether the Podman driver applies those labels is live-gated (OQ-P3-01). The sweep therefore finds an orphan even when the record holds no container id, and the record is deleted only after that. Tests cover a record with a null container id, a record with a container id, and a foreign unlabelled container that must not be touched.

- **D-87:** Single-owner precondition. `reapStartup` must run before any `LifecycleController` or `ToolDispatcher` exists in the process, and only one host daemon may own the state directory (S-19, Phase 6). Phase 4 has no cross-process owner check. Phase 4 documents this as a precondition and as residual risk (OQ-P4-06). **Reversibility:** reversible.

### Shared dispatcher (TOOL-03, TOOL-04)

- **D-88:** Module layout. `src/tools/dispatch.ts` exports `ToolDispatcher`, the only entry point for tool calls. `src/tools/workspace.ts` holds the read, list, and write handlers over the Phase 2 filesystem layer. It is the only module under `src/tools/` that imports `lockedWrite`, `readFileCapped`, and `listDir`. The exec argv is built by `buildExecArgv` in `src/runtime/openshell.ts` (D-91). The OpenShell runner is injected. Constructor dependencies are: `sessionId`, `boundRoot` (a `PinnedRoot`), `policy`, `controller`, `locks` (the same `LockTable` instance the controller uses, D-96), `stateDir`, `runOpenShell`, and `clock`. The dispatcher reads no `process.env`. **Reversibility:** reversible.

- **D-89:** Pipeline order. Every call runs these stages in this order. A refusal at any stage returns a structured error, and no later stage and no execution run:
  1. **Schema.** `validate("tools", raw)` (D-40). A failure is `SCHEMA_INVALID`. Shell-form exec then runs `checkExecPolicy` (Phase 2 D-24), so `SHELL_NOT_ALLOWED` precedes the state check.
  2. **State.** Mutating tools are gated. `write` uses `controller.mutationGate()` (Phase 3 D-63). `exec` is allowed only in `active`, in both modes, because a command must never run in a sandbox that has not been verified. `read`, `list`, `status`, and `retry` are not gated.
  3. **Lock.** For `write`: canonicalize in write mode, run the credential check, and pre-check that no other owner holds the target (`locks.isHeldBy`). The authoritative acquire and hash check remain inside `lockedWrite` (D-34), so a race still yields `LOCK_CONFLICT`. Other tools have no target and record `lock: "none"`.
  4. **Audit admission.** `appendAudit` writes the admission line (outcome `ok`, meaning admitted) before any execution. `AUDIT_WRITE_FAILED` refuses the call with no execution (S-21).
  5. **Execution.** The call runs under its timeout (D-91).
  6. **Result audit.** `appendAudit` writes the result line, with outcome `ok` or the error code. An append failure after execution returns `AUDIT_WRITE_FAILED` and does not roll back the effect (OQ-P4-07).

  **Reversibility:** costly, because the order is the TOOL-03 contract.

- **D-90:** Audit format. The Phase 2 entry format (D-42) is unchanged. A call produces two lines: an admission line before execution and a result line after. A reader distinguishes them by the outcome (`ok` on admission, and the final outcome on the result line). An admission line is not written for refused calls before stage 4. Write entries record byte count and sha256, never content. Exec entries record argv after redaction, or the script length and sha256 for shell form. **Reversibility:** reversible.

- **D-91:** Timeouts and the queue (TOOL-04).
  - **Queue.** When the state is `connecting` and the call needs `active` (exec, and write before the gate), the dispatcher waits on `controller.events` for a transition out of `connecting`, bounded by `policy.toolQueueMs` (default 2000). The timer is cleared on either outcome. A transition to `active` proceeds at once. On expiry: exec returns `REALM_NOT_ACTIVE` (retryable); write is decided by the mode gate (required mode returns `REALM_NOT_ACTIVE`; advisory mode proceeds with a warning). Only `connecting` waits. Other non-active states do not wait, so a call in `degraded` or `error` returns at once (OQ-P4-08).
  - **Timeout.** `TOOL_CALL_TIMEOUT_MS = 30000` is a constant in `dispatch.ts`. It is not a policy key, because a new key would extend the frozen schema and the documented key list in QUAL-03. Every awaited stage is raced through `withTimeout` with `TOOL_TIMEOUT`. Exec passes `timeoutMs` to the OpenShell runner, which kills the process at expiry (F-P3-05), so a timed-out call does not keep running in the background. The file tools are synchronous and bounded by their size limits (`maxBytes` at most 1 MiB; `MAX_LIST_ENTRIES` 1000), so no timer is wrapped around them. This is not an async boundary (QUAL-01).
  - **Retryable codes** come from the frozen catalogue (`ERROR_CATALOGUE`). No code is added.
  **Reversibility:** reversible for the constant; costly for the code mapping.

- **D-92:** Exec (TOOL-02, AUD-02). The argv form runs `buildExecArgv(sandboxName, argv)`, which returns exactly:
  `openshell sandbox exec --name realm-<sessionId> --workdir /workspace --no-tty --no-login-shell -- <argv...>`
  It never emits `--env`. The shell form (only when `policy.shellEnabled` is true) runs argv `["/bin/sh", "-c", script]`. The OpenShell runner receives no host environment beyond the names in `OPENSHELL_ENV_NAMES` (Phase 3). **Reversibility:** reversible.

- **D-93:** The exec verb is pinned. Phase 3 deferred exec because "no exec verb is in the pinned OpenShell set". The local 0.1.2 CLI now shows `openshell sandbox exec` (read-only `--help` check, 2026-10-21). It lists `-n/--name`, `--workdir`, `--timeout`, `--tty/--no-tty`, `--no-login-shell`, and `--env` (which is never used). The `sandbox exec` verb and the four flags used in D-92 are added to the pinned set (S-10). The docs for 0.1.5 describe the same verb. The live exec path is gated (OQ-P4-04). **Reversibility:** reversible.

- **D-94:** Exec output and the runner. `OpenShellRunOutcome` gains `stdout` and `stderr`, each bounded at 262144 bytes, with a `truncated` flag. Only exec reads them. The create path ignores them. A runner rejection or deadline during exec maps to `REALM_NOT_ACTIVE` (the sandbox is not reachable) when the runner rejected, and `TOOL_TIMEOUT` when the deadline expired. A non-zero exit code is a successful call with `exitCode` in the result, not an error. **Reversibility:** reversible.

- **D-95:** Status and retry. `status` returns `controller.snapshot()` and `displayStatus` (D-27). `retry` by state: `error` calls `controller.create(boundRoot)`; `connecting`, `active`, and `degraded` return the current snapshot unchanged; `unbound` returns `REALM_UNBOUND`; `stopping` returns `REALM_STOPPING`. Both tools pass the audit stages (they are tool calls). Phase 5 exposes `retry` through OMP-03. **Reversibility:** reversible.

- **D-96:** One lock table. The composition passes one `LockTable` to the controller (D-33 release on destroy) and to the dispatcher (the pre-check and `lockedWrite` owner is the session id). Tests assert that both hold the same instance. **Reversibility:** reversible.

- **D-97:** Transitions. The dispatcher subscribes to `controller.events` (the existing public bus, D-26). No new controller method is added. **Reversibility:** reversible.

- **D-98:** Read, list, and write results. `read` and `list` return the Phase 2 result shapes (D-36). `write` returns `{ sha256, bytes }` and the optional advisory `warning` from `decideMutation` (D-23, CORE-05). A write under advisory policy in a non-active state returns the warning in the result and the audit admission line. The write itself is not reported as failed. **Reversibility:** reversible.

- **D-99:** No-bypass structure (TOOL-03). A static test asserts that `buildExecArgv`, `lockedWrite`, `readFileCapped`, `listDir`, `spawnOpenShellRunner`, and `openshell` process spawning are referenced only from `src/tools/*`, `src/runtime/openshell.ts`, `src/runtime/session-execution.ts`, and their own modules. The same method as the D-46 routing test is used. **Reversibility:** reversible.

### Documentation and decision record (carried by the phase)

- **D-100:** `docs/integration/runtime-decision.md` gains a Phase 4 section. It records: OQ-P3-16 resolved for Realm's fields (D-82), with the v0.1.2 URL and read date; the exec verb pin and its evidence (D-93); the IPv6 partial status (D-76); the single-owner precondition (D-87); and the open questions OQ-P4-01 to OQ-P4-12 with their defaults. No new integration note file is created, because no new external dependency is added. The spec is not edited.

- **D-101:** No new error code, policy key, dependency, or doctor item is added in Phase 4. The doctor items stay as Phase 3 registered them (D-69). The reaper and the dispatcher are not doctor items.

### Test suite taxonomy (QUAL-02; extends D-70)

- **D-102:** Test layout follows D-45 and D-70, with the new `tools` category directory. Every Phase 4 requirement ID is cited by at least one named test file:
  - `test/runtime/egress.test.ts` (RT-05): exact hostnames and IPv4 accepted; IPv6 literal, wildcard, `localhost`, loopback, link-local, and unspecified refused with `SCHEMA_INVALID`; empty allowlist renders `{}`; non-empty renders the exact D-78 shape; the rendered text contains no `:` in any host and no key outside the D-78 set; order is deterministic.
  - `test/runtime/config.test.ts` (extended, RT-05, RT-01): each name in the D-80 denylist rejected; a relative `workloadArgv[0]` rejected (D-79); an absolute one accepted; `egressAllow` validated through `validateEgressAllow` at load.
  - `test/runtime/openshell-policy.test.ts` (extended, RT-05): `version: 1`; `network_policies` equals the D-78 rendering for a given allowlist; `{}` for an empty allowlist; the document parses as JSON; mode 0600; written before the create argv.
  - `test/runtime/openshell-argv.test.ts` (extended, RT-03, RT-05, AUD-02): the exact exec argv (D-92); the workload after `--`; no `--env`, `--provider`, `--driver-config-json`, `--forward`, `--expose`, `--template`, or `--auto-providers` in any argv the builders produce.
  - `test/runtime/openshell-routing.test.ts` (extended, RT-03, TOOL-03): the D-99 structural guard.
  - `test/runtime/down-sweep.test.ts` (migrated): the sweep returns the removed count and still proves zero survivors (D-84).
  - `test/session/reap.test.ts` (RT-08): a crash during create reaped on the next start with a null container id (D-86); a record with a container id reaped; the foreign unlabelled container untouched; a second reap is a no-op; a surviving container yields `REALM_STOPPING` and keeps every record; records are deleted only after the sweep (order check).
  - `test/session/store.test.ts` (extended, RT-08): `list()` returns ids from file names, ignores non-matching names, and returns an id for a record whose contents are corrupt (D-85).
  - `test/tools/dispatch.test.ts` (TOOL-03): a recorded call order (schema, state, lock, audit admission, execution, result audit) for each tool; a schema failure with zero side effects; `SHELL_NOT_ALLOWED` before the state check; `AUDIT_WRITE_FAILED` at admission with no execution; a write in `degraded` under advisory mode returns a warning and a write in required mode returns `REALM_NOT_ACTIVE`; exec refused unless `active`; `status` and `retry` by state (D-95).
  - `test/tools/queue-timeout.test.ts` (TOOL-04): a runner that never settles yields `TOOL_TIMEOUT` within the bound and the runner receives its kill; a call in `connecting` returns `REALM_NOT_ACTIVE` after `toolQueueMs` for exec and proceeds at once when `active` is reached during the wait; the timer is cleared on settle; `degraded` does not wait.
  - `test/tools/workspace.test.ts` (TOOL-03): write through the dispatcher honors `ifMatchSha256` and `LOCK_CONFLICT` (D-34); audit lines carry byte count and sha256 and no content (D-42); `read` and `list` pass through the credential and root checks.
  - `test/tools/no-bypass.test.ts` (TOOL-03): the D-99 static guard, extended over `src/tools/`.
  - `test/integration/podman-gate.test.ts` (extended in place): live bodies for RT-05 (allowlisted host and port succeeds; a non-allowlisted host fails; IPv6 not reachable), RT-08 (a crash reaped on a live host), and TOOL-03 (an exec through the dispatcher). Each runs under the existing gate and skips with `PODMAN_UNSUPPORTED_VERSION` on 4.9.3.
  - `test/quality/suite-taxonomy.test.ts` (extended): adds the `tools` directory to `CATEGORY_DIRS`, adds a "tools" category, and asserts that all four Phase 4 requirement IDs are cited by at least one test file.
  - `test/runtime/decision-note.test.ts` (extended): asserts the Phase 4 section of `runtime-decision.md` (D-100).

  `test/support/*` helpers are not test files. Phase 4 may add `test/support/fake-tools.ts` (an in-memory controller and runner) if the existing helpers do not cover a case.

- **D-103:** The existing Phase 3 test `test/runtime/openshell-policy.test.ts` asserts `network_policies: {}`. That assertion is kept for the empty allowlist and extended for non-empty, so it is migrated, not deleted.

### Claude's Discretion

- Helper names, internal splits within a module, and the exact argument shape of `renderNetworkPolicies` and `ToolDispatcher`.
- Whether `ToolDispatcher` is a class or a closure over its dependencies.
- The exact reason text for each refusal, provided the frozen catalogue reason is included for the code.
- Test helper layout under `test/support/`.
- Number of plans and their wave grouping, subject to one owner per file per wave. `src/runtime/session-execution.ts` is touched by both the sweep move (D-84) and the runner output (D-94); it must have one owner per wave.

### Open questions (recorded; each has a default that the plan applies)

- **OQ-P4-01 (blocks the live egress proof, not the unit build):** Does the OpenShell supervisor proxy block IPv6 egress, and does it enforce `network_policies` when the workload container has networking off? Default: rely on the proxy and the rendered IPv4-only policy, and report the live property as gated. Gated suite decides.
- **OQ-P4-02 (blocks live acceptance of the rendered document):** Does the OpenShell 0.1.2 gateway accept the D-78 document at `--policy` create, and is `binaries[].path` matched by the workload interpreter? Default: the document as rendered, with `workloadArgv[0]` absolute (D-79). Gated.
- **OQ-P4-03:** The v0.1.2 page documents the endpoint fields Realm uses, but the inspection and protocol fields were read only in part. Default: Realm writes none of them. Re-verify on upgrade.
- **OQ-P4-04 (blocks live exec):** Does `openshell sandbox exec --name realm-<id> --workdir /workspace --no-tty --no-login-shell` run against a gateway-created sandbox, and does the sandbox have `/bin/sh` for shell form? Default: argv form is the tested path; shell form is gated. Gated.
- **OQ-P4-05:** Does `sandbox exec` return the remote exit code through the CLI exit status? The Phase 3 runner maps exit status only. Default: yes (the 0.1.2 help says "The CLI exits with the remote command's exit code"); verified by the gated suite.
- **OQ-P4-06 (residual risk, Phase 6):** Reaping has no cross-process owner check. A second host process could reap a live session. Default: the reap precondition (D-87) and the single-daemon rule in Phase 6, recorded here as residual risk.
- **OQ-P4-07:** A result-audit failure after a write has landed. Default: return `AUDIT_WRITE_FAILED` to the caller and do not roll back. The caller must treat the outcome as unknown.
- **OQ-P4-08:** The queue-wait error for advisory writes. Default: after the wait, advisory writes proceed with a warning; exec and required-mode writes return `REALM_NOT_ACTIVE`.
- **OQ-P4-09:** The value of `TOOL_CALL_TIMEOUT_MS` (30000). Default: the constant. Revisit only with a measured need, not as a policy key.
- **OQ-P4-10:** Egress changes after create. Default: fixed at create; changing it means destroy and recreate. Live `openshell policy set` is not used in Phase 4.
- **OQ-P4-11:** Retry and status surface. Default: the dispatcher implements both (D-95); Phase 5 exposes `retry` through OMP-03.
- **OQ-P4-12 (residual risk):** An allowlisted hostname that resolves to a private address is reachable under OpenShell's documented rule for exact hostnames. Default: Realm does not add `allowed_ips`, so the allowlist must contain only hosts the user intends to reach. Recorded in `runtime-decision.md`.

### Requirement coverage map (for the planner)

| ID | Decisions | Primary test files |
|---|---|---|
| RT-05 | D-75, D-76, D-77, D-78, D-79, D-80, D-81, D-82, D-83 | `test/runtime/egress.test.ts`, `test/runtime/openshell-policy.test.ts`, `test/runtime/config.test.ts`, `test/integration/podman-gate.test.ts` |
| RT-08 | D-84, D-85, D-86, D-87 | `test/session/reap.test.ts`, `test/session/store.test.ts`, `test/runtime/down-sweep.test.ts` |
| TOOL-03 | D-88, D-89, D-90, D-92, D-93, D-94, D-95, D-96, D-97, D-98, D-99 | `test/tools/dispatch.test.ts`, `test/tools/workspace.test.ts`, `test/tools/no-bypass.test.ts`, `test/runtime/openshell-routing.test.ts` |
| TOOL-04 | D-89 (queue stage), D-91 | `test/tools/queue-timeout.test.ts` |

### Requirement drift (reported, not edited)

- RT-05 and ROADMAP Phase 4 SC2: "from inside the container". Realized through the sandbox proxy (D-75).
- RT-05: "IPv6 is disabled". Partially unit-verified (D-76, OQ-P4-01).
- RT-03 and ROADMAP Phase 3 SC3 still say "OpenShell runs inside the container". This was reported in Phase 3 (D-46) and is not changed here.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product spec (source of truth; do not modify)
- `docs/specs/realm-spec.xml` §REALM_SANDBOX `NETWORK_POLICY` and `LIFECYCLE`; §SECURITY_AND_VALIDATION; §GRACEFUL_DEGRADATION `FAILURE_CASES`; §GRAPH_OF_THOUGHT n3 (defaults and the planned module paths `src/session/reap.ts`, `src/runtime/egress.ts`, `src/tools/dispatch.ts`, and tests `test/session/reap.test.ts`, `test/runtime/egress.test.ts`, `test/tools/`), n5 (fail-closed failure modes: orphans, egress bypass, silent fallback), n6 (frozen contracts).

### Planning state
- `.planning/REQUIREMENTS.md`: RT-05, RT-08, TOOL-03, TOOL-04 text and the traceability table.
- `.planning/ROADMAP.md`: Phase 4 goal and success criteria SC1 to SC4.
- `.planning/PROJECT.md`: constraints (ESM, strict, no host paths, no telemetry, no unverified dependency, no secrets).
- `.planning/STATE.md`: stale (still reads Phase 3 as current). Phase 3 is committed as `53fc919` and verified (`ce364b8`).

### Integration notes (gates)
- `docs/integration/openshell.md`: Q1 (the Podman driver creates the sandbox container), Q3 (policy model), Q4 (network enforcement by the CONNECT proxy and OPA; deny-by-default egress), Q5 (`--policy` at create), Q9 (workload networking off under the Podman driver).
- `docs/integration/podman.md`: Q3 (`--network none`; no per-destination allowlist in Podman itself), Q4 (never mount the API socket).
- `docs/integration/runtime-decision.md`: the Phase 3 decision record, OQ-P3-01 to OQ-P3-16. Phase 4 adds its section (D-100).
- External, read 2026-10-21 for this phase: `https://docs.nvidia.com/openshell/v0.1.2/how-it-works/policies/schema.md` (the pinned version, the source of D-82). The v0.1.5 page at `https://docs.nvidia.com/openshell/latest/how-it-works/policies/schema.md` has the same top-level and `network_policies` shape.
- Local, read-only checks run for this phase: `openshell --version` (0.1.2), `openshell sandbox --help`, `openshell sandbox exec --help`, `openshell sandbox create --help`, `openshell policy set --help`. Nothing was run that changes the host.

### Prior phases (frozen; read before touching related code)
- `.planning/phases/02-policy-state-and-filesystem-lockdown/02-CONTEXT.md`: D-23 (mode decision), D-24 (exec gate), D-26 (event bus), D-28 (timeouts, `toolQueueMs` assigned to the dispatcher), D-33 to D-36 (locks, locked write, atomic write, read and list), D-37 (session record), D-40 (tool-input gate and the dispatcher as Phase 4's job), D-41 and D-42 (redaction and audit format), D-43 (no host environment).
- `.planning/phases/03-container-runtime-and-bridges/03-CONTEXT.md`: D-46 (routing guard), D-47 (verify, do not create), D-51 (hardening profile, `NetworkMode: none`), D-52 (config keys), D-55 to D-57 (OpenShell argv, idempotent create, policy document), D-63 (mutation gate), D-64 (controller states), D-67 and D-68 (`SessionExecution` and the sweep), D-69 (doctor), D-70 (test layout).
- `.planning/phases/03-container-runtime-and-bridges/03-VERIFICATION.md`: what Phase 3 verified and what remains live-gated.

### Frozen code (extend beside it; never edit frozen tables)
- `src/core/errors.ts` (22 codes, `ERROR_CATALOGUE`). No code is added.
- `src/core/policy.ts` (`decideMutation`, `checkExecPolicy`, `loadPolicyFile`), `src/core/policy.schema.json` (`egressAllow` already present), `src/core/timeout.ts` (`withTimeout`), `src/core/events.ts`, `src/core/status.ts`, `src/core/ports.ts` (`ExecutionService` and `BridgePort` are not changed).
- `src/contract/validate.ts` (`EgressRule`, `Policy`, `ToolParams`), `src/contract/tools.schema.json`, `src/contract/session-record.schema.json`.
- `src/lifecycle/controller.ts`: public `events` bus, `mutationGate()`, `snapshot()`, `create(workspaceRoot)`. Not reshaped in Phase 4.
- `src/lifecycle/mutation-gate.ts` (`gateMutation`).
- `src/fs/write.ts` (`lockedWrite`), `src/fs/read.ts`, `src/fs/list.ts`, `src/fs/locks.ts` (`LockTable.acquire`, `isHeldBy`), `src/fs/root.ts` (`bindRoot`), `src/fs/canonicalize.ts`, `src/fs/credentials.ts`, `src/fs/atomic-write.ts`.
- `src/session/store.ts` (`save`, `load`, `delete`; `list` is added in Phase 4), `src/session/paths.ts` (`recordFileName`, `sessionsDirOf`).
- `src/audit/log.ts` (`appendAudit`, which throws `AUDIT_WRITE_FAILED`), `src/audit/redact.ts`.
- `src/runtime/openshell.ts` (`buildCreateArgv`, `runOpenShellCreate`, `buildPolicyDocument` with no arguments today, `writePolicyDocument`, `MANAGED_LABEL_KEY`, `SESSION_LABEL_KEY`, `SANDBOX_WORKSPACE_PATH`).
- `src/runtime/session-execution.ts` (`removeAllRealmContainers` at line 191 today, `spawnOpenShellRunner`, `OPENSHELL_ENV_NAMES`). Phase 4 moves the sweep out and extends the runner's outcome.
- `src/runtime/config.ts` (`ACCEPTED_KEYS`, `loadRuntimeConfig`). Phase 4 adds D-79 and D-80.
- `src/runtime/libpod-client.ts` (`listContainersByLabel`, `removeContainer`; the summary carries only `id`, so label queries are needed for any per-session check).
- `src/runtime/hardening.ts`, `src/runtime/agentos.ts`, `src/anda/client.ts`, `src/doctor/checks.ts`.
- Test helpers: `test/support/fake-libpod.ts`, `fake-openshell.ts`, `fake-agentos.ts`, `fake-bridge.ts`, `fake-execution.ts`.

No external specs or ADRs beyond the above are referenced. `.planning/codebase/` does not exist for this repo, so the codebase scout used the grep fallback over `src/` and `test/`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `removeAllRealmContainers` (`src/runtime/session-execution.ts`): the zero-orphan sweep. The reaper reuses it through an injected function (D-84).
- `decideMutation` and `gateMutation`: the state gate, reused, not redefined (D-89).
- `checkExecPolicy`: the shell-form gate (D-89).
- `validate("tools", raw)`: the single schema gate (D-89).
- `lockedWrite`, `readFileCapped`, `listDir`, `bindRoot`, `canonicalize`, `assertCredentialAccess`: the Phase 2 file layer, reused through `src/tools/workspace.ts` (D-88).
- `appendAudit`, `redactValue`: the audit path (D-90).
- `withTimeout`: the timeout race for awaited stages (D-91).
- `LockTable.isHeldBy`: the lock pre-check (D-89).
- `controller.events`: the public event bus (D-97).
- `buildCreateArgv`, `runOpenShellCreate`, `writePolicyDocument`, `atomicWriteFile`: the create path and policy write, extended in place (D-81, D-92).
- `recordFileName`: the session-id pattern, reused by `SessionStore.list` (D-85).

### Established Patterns
- Injected I/O everywhere. No new module reads `process.env` (D-46, D-67).
- A typed error by `makeRealmError(code)`. No raw message crosses a boundary (Phase 2 M-3, Phase 3 F-P3-05).
- A closed client with a fixed method set (D-54). The dispatcher has no method that takes a raw path past the schema.
- A runner that owns its own kill (F-P3-05). Exec uses the same runner.
- Each file has one owner per wave. Files already owned by Phase 3 are extended by additive change, and the Phase 3 behavior is kept.

### Integration Points
- `src/runtime/config.ts` gains D-79 and D-80 at load. Phase 3 fixtures with a relative `workloadArgv[0]` need updating.
- `src/runtime/openshell.ts` gains `buildExecArgv` (D-92), the new `buildPolicyDocument` signature (D-81), and the argv refusal list (D-80).
- `src/runtime/session-execution.ts` gives up `removeAllRealmContainers` to `src/runtime/sweep.ts` (D-84) and extends `spawnOpenShellRunner`'s outcome (D-94). Single owner per wave.
- `src/session/store.ts` gains `list()` (D-85).
- `src/session/reap.ts` (new): `reapStartup` (D-84).
- `src/runtime/egress.ts` (new): `validateEgressAllow` and `renderNetworkPolicies` (D-77, D-78).
- `src/tools/dispatch.ts`, `src/tools/workspace.ts` (new): the dispatcher and the file handlers (D-88).
- `src/lifecycle/controller.ts`: not reshaped. Phase 4 consumes `events`, `mutationGate`, `snapshot`, `create`.
- The spec's older WORKFLOW file names (`src/tools/dispatch.ts` in n8) match the planned location.

</code_context>

<specifics>
## Specific Ideas

- Keep every unverified OpenShell fact in one file, `src/runtime/openshell.ts`, next to the pinned verb list, so the gated pass has one place to confirm or correct it. Egress shape facts (D-78, D-82) live in `src/runtime/egress.ts`.
- The reaper's order (containers first, then records) is the crash-safety argument. Make it the first assertion in `test/session/reap.test.ts`.
- The two audit lines per call (D-90) are a format-consumer concern. Name them in `runtime-decision.md` so the Phase 7 review reads them as one call.
- The dispatcher test should record the order of calls to fake stages, not only the outcome. A test that only checks the outcome cannot show that schema runs before state.

</specifics>

<deferred>
## Deferred Ideas

- The startup caller that runs `reapStartup` and the single-daemon control channel (RT-06, S-03, OQ-P4-06): Phase 6.
- The Omp, MCP, and ACP surfaces that call the dispatcher, and the Omp `retry` command (TOOL-05, OMP-01 to OMP-05): Phase 5.
- The CLI and the daemon (CLI-01 to CLI-04): Phase 6.
- Live `openshell policy set` for egress changes without recreate (OQ-P4-10): not planned in v1.
- Wildcard egress hosts (OpenShell supports them; Realm refuses them in D-77 until a need is recorded): a later decision.
- Per-tool timeout policy keys and a dedicated tool-timeout code (OQ-P4-09): a later decision; both are catalogue or schema changes (costly).
- Explicit `allowed_ips` for allowlisted names (OQ-P4-12): a later decision with its own threat review.
- Egress through the OpenShell TypeScript SDK (`@nvidia/openshell-sdk`, docs Q7): not used. The argv path is the pinned route.
- Doctor items for the reaper and the egress guard: none planned (D-101).
- Teardown-timeout catalogue code (Phase 2 Q-1, kept at `REALM_STOPPING` by Phase 3): unchanged.

**Reviewed Todos (not folded):** none. `todo.match-phase 4` returned zero todos.

</deferred>

---

*Phase: 04-reaper-egress-guard-and-shared-dispatcher*
*Context gathered: 2026-10-21*
</content>
