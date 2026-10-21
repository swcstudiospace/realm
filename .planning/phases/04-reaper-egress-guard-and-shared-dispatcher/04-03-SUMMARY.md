# Plan 04-03 Summary: OpenShell egress wiring, exec argv, runner types (RT-05, D-79, D-80, D-81, D-92, D-94)

## Status

Implemented by inspection. Build, typecheck, and tests were not run by this lane, per the wave
instructions. The orchestrator runs `npx tsc -p tsconfig.json` and
`node --test dist/test/runtime/config.test.js dist/test/runtime/openshell-policy.test.js dist/test/runtime/openshell-argv.test.js`
after the wave lands. Four out-of-lane call sites do not yet match the new signatures (see Open items);
the type check is expected to fail on them until plans 04-05 and 04-07 land.
The read-only check `openshell sandbox exec --help` (local 0.1.2 CLI, 2026-10-21) lists `--name`,
`--workdir`, `--no-tty`, and `--no-login-shell`, so the exec argv pins only those flags plus the
`--` separator (D-93). It also lists `--timeout`, `--tty`, and `--env`; none of them is emitted.

## Files

- `src/runtime/config.ts`: D-80 denylist (`DENIED_KEYS`) checked before the closed key set; D-79 absolute check on `workloadArgv[0]` in `requireArgv`.
- `src/runtime/openshell.ts`:
  - `buildExecArgv(sessionId, argv)` (D-92, D-93): the pinned exec argv, frozen, workload after `--`.
  - `buildPolicyDocument(egress, workloadBinary)` (D-81): `network_policies` rendered through `renderNetworkPolicies`.
  - `writePolicyDocument(stateDir, sessionId, egress, workloadBinary)`: renders before the runtime directory is created.
  - `OpenShellRunOptions.captureOutput` (opt-in), `OpenShellRunOutcome.stdout|stderr|truncated` (present only when captured), `OPENSHELL_OUTPUT_LIMIT_BYTES = 262144`, `OpenShellRunnerError` with `kind` (`failed` | `timed-out`) and fixed text (D-94, C-6, D-108).
  - `MANAGED_LABEL_VALUE` was already exported from this module by plan 04-02; the create argv uses it unchanged.
- `test/runtime/config.test.ts` (extended): RT-05 denylist, relative and absolute `workloadArgv[0]`, egress key refusal.
- `test/runtime/openshell-policy.test.ts` (migrated): the D-103 empty-map assertion is kept; RT-05 non-empty render, D-57 fields unchanged, file write, and refusal-without-write cases.
- `test/runtime/openshell-argv.test.ts` (extended): exact exec argv, sandbox-name parity with create, D-80 absence per flag for both builders, exec refusal cases.

## Evidence for the must_haves

Truth 1 (policy document through D-78, JSON, mode 0600, written before create):
- D-78 shape and equality with `renderNetworkPolicies`: "RT-05: a non-empty allowlist renders network_policies to the exact D-78 shape for the workload binary".
- Empty map kept (D-103): "RT-05: an empty allowlist renders network_policies as an empty map, which is deny-all egress (D-103)".
- D-57 fields unchanged: "RT-05: a non-empty allowlist leaves version, filesystem_policy, landlock, and process at their D-57 values".
- JSON and mode 0600: "RT-05: a non-empty allowlist is written as JSON at mode 0600 with its rendered network_policies"; "RT-03: the policy file lands at <stateDir>/runtime/<sessionId>.policy.json with mode 0600".
- Refusal writes nothing: "RT-05: an allowlist entry that is refused, or a relative workload binary, writes no file and creates no runtime directory".
- Write before create argv: NOT evidenced in this lane. The ordering is a call-order property of `SessionExecution.create` in `src/runtime/session-execution.ts`, which plan 04-05 owns. It is an open item.

Truth 2 (relative `workloadArgv[0]` and denylist refused; absolute accepted):
- "RT-05: each D-80 denylist name is refused at load with SCHEMA_INVALID (D-80)".
- "RT-05: a relative workloadArgv[0] is refused with SCHEMA_INVALID (D-79)".
- "RT-05: an absolute workloadArgv[0] is accepted with or without arguments (D-79)".
- Allowlist validation at load: replaced by "RT-05: an egressAllow key is refused at load, because the allowlist is validated where the runtime is built (D-106)". See Deviations.

Truth 3 (exact D-92 exec argv; no D-80 flag):
- "RT-03, AUD-02: the exec argv is exactly the pinned D-92 form with the workload after --, and it is frozen".
- "RT-03: the exec argv names the same sandbox that the create argv names".
- "RT-05: neither builder emits any D-80 forbidden flag, as an element or as a prefixed form, before the separator" (one assertion per flag: `--driver-config-json`, `--forward`, `--expose`, `--template`, `--provider`, `--env`, `--auto-providers`).
- "RT-05: a session id outside the safe set, an empty argv, or an empty element is refused by buildExecArgv with SCHEMA_INVALID".

Truth 4 (bounded capture, truncation flag, create path ignores stdio):
- Types only in this lane (the plan's Task 4 has no behavior bullets). The spawn implementation and its capture tests belong to `spawnOpenShellRunner` in plan 04-05 (D-108). The bound constant is exported for that lane.

## Deviations

1. Egress validation at config load was not added. Plan Task 1 asks for `egressAllow` to go through `validateEgressAllow` at load, but D-106 (and PATTERNS C-3) say `RuntimeConfig` keeps no egress field and the allowlist is validated in the `SessionExecution` constructor (plan 04-05). Task 1 also says "without touching ACCEPTED_KEYS", which makes a load-time egress field impossible without a second validation point. Default applied: D-106 governs. The config test asserts that an `egressAllow` key is refused.
2. The captured `stdout`, `stderr`, and `truncated` fields are optional on `OpenShellRunOutcome`, not required. Required fields would break `spawnOpenShellRunner` and `test/support/fake-openshell.ts`, both owned by plan 04-05, before that lane lands. Present only when captured is the documented contract.
3. `renderNetworkPolicies` runs before the runtime directory is created in `writePolicyDocument`, so a refused allowlist leaves no directory. This is stricter than the plan text and is asserted by a test.
4. The D-80 denylist is a separate constant (`DENIED_KEYS`), checked before the unknown-key check, so the refusal is named in the code and the test.

## Open items (outside this lane's files)

- `src/runtime/session-execution.ts` (plan 04-05): `writePolicyDocument(runtime.stateDir, sessionId)` now needs `egress` and the workload binary. The create path must also write the policy before the create argv.
- `src/runtime/session-execution.ts` (plan 04-05): `spawnOpenShellRunner` must set `stdout`, `stderr`, and `truncated` when `captureOutput` is true, cap each stream at `OPENSHELL_OUTPUT_LIMIT_BYTES`, and reject with `OpenShellRunnerError` (`failed` or `timed-out`) in place of the plain `Error` messages.
- `test/runtime/session-execution.test.ts` (plan 04-05), line ~164: `buildPolicyDocument()` now needs `(egress, workloadBinary)`.
- `test/integration/podman-gate.test.ts` (plan 04-07), line ~176: `writePolicyDocument` now takes `egress` and the workload binary.
- `src/doctor/checks.ts`: `pinnedCreateFlags` calls `buildCreateArgv` with `workloadArgv: ["doctor-check"]`, a relative element that never goes through `loadRuntimeConfig`. The builder is only read for flag names and never executed, so it was left unchanged. Flagged for review.
- No Phase 3 config fixture in the owned test files carries a relative `workloadArgv[0]`; the existing ones are absolute. The gated live fixture (`REALM_LIVE_WORKLOAD`) is read from the environment and is owned by plan 04-07.
- OQ-P4-02 and OQ-P4-04 remain live-gated (Podman 4.9.3 on this host). Nothing here is live-verified.

## Decisions carried

- D-79, D-80, D-81, D-92, D-93, D-94 as written in 04-CONTEXT.md. No new error code, policy key, or dependency (D-101).
- No shell form is built in `src/runtime/openshell.ts`; the dispatcher owns it behind `checkExecPolicy` (D-92, D-89).
