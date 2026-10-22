# Plan 04-05 Summary: bounded exec capture, egress plumbing at create, execution-layer argv refusals (TOOL-03, RT-05)

## Status

Implemented by inspection. Build, typecheck, and tests were not run by this lane, per the wave
instructions. The orchestrator runs `npx tsc -p tsconfig.json && node --test dist/test/runtime/session-execution.test.js`
after the wave lands. The exec call site in `src/tools/dispatch.ts` belongs to plan 04-06 and is not
part of this lane; the helper it needs is exported here (see Files).

## Files

- `src/runtime/session-execution.ts`:
  - `spawnOpenShellRunner`: with `captureOutput` true, stdio is `ignore`, `pipe`, `pipe`; each stream keeps at most `OPENSHELL_OUTPUT_LIMIT_BYTES` (262144) bytes through `BoundedOutput`, keeps draining past the bound, and sets `truncated` when a stream is cut. Without `captureOutput` the stdio stays `ignore` and the outcome is exactly `{ exitCode }`, so the create path is unchanged (D-94, C-6, D-108).
  - Rejections are `OpenShellRunnerError` with kind `failed` or `timed-out` and fixed text; the spawn error's text and the child's output never cross the boundary.
  - `runSandboxExec(runner, sessionId, workload, timeoutMs)` (new export): builds the pinned exec argv with `buildExecArgv`, calls the injected runner with `{ timeoutMs, captureOutput: true }`, returns the outcome unchanged (non-zero exit is success), and maps rejections: kind `timed-out` to `TOOL_TIMEOUT`, any other rejection to `REALM_NOT_ACTIVE`. A non-positive or non-integer `timeoutMs` is `SCHEMA_INVALID` before any run (D-92, D-94, D-91).
  - `SessionExecutionOptions.egressAllow` (new, required): validated in the `SessionExecution` constructor through `validateEgressAllow` before any create (D-106, C-3).
  - `create()`: `writePolicyDocument(stateDir, sessionId, egressAllow, workloadArgv[0])` writes the policy before the create argv runs (D-81).
  - Removed the unused `RUNNER_FAILED` and `RUNNER_TIMED_OUT` message constants.
- `test/support/fake-openshell.ts`:
  - New scripted steps `reject-failed` and `reject-timed-out` (kinded `OpenShellRunnerError`), and `{ output: OpenShellRunOutcome }` returned exactly as given, so exec tests script `stdout`, `stderr`, and `truncated`.
  - `FakeOpenShellCall` now logs `captureOutput`. The argv and `timeoutMs` logging is unchanged.
- `test/runtime/session-execution.test.ts`:
  - Fixture passes `egressAllow` and records the policy text at each OpenShell run (`policyAtRun`).
  - The write-before-create test now calls `buildPolicyDocument(EGRESS, WORKLOAD_BINARY)` (the line-164 call).
  - New TOOL-03 and RT-05 tests listed below.
- `.planning/phases/04-reaper-egress-guard-and-shared-dispatcher/04-05-SUMMARY.md` (this file).

## Evidence for the must_haves

Truth 1 (exec through the runner: bounded capture with truncation, runner rejection to REALM_NOT_ACTIVE, deadline to TOOL_TIMEOUT, no timed-out call left running):
- Bounded capture with truncation: "TOOL-03: captured output is bounded at 262144 bytes per stream, and truncated is set when a stream is cut"; "TOOL-03: captured output below the bound is returned whole with truncated false, and a non-zero exit is an outcome".
- Pinned exec argv with capture on, outcome returned as is: "TOOL-03: exec spawns the pinned exec argv with output capture on and returns the runner outcome as it is".
- Runner rejection maps to REALM_NOT_ACTIVE with no child text: "TOOL-03: a runner rejection during exec maps to REALM_NOT_ACTIVE, and the error carries no child text".
- Deadline expiry maps to TOOL_TIMEOUT: "TOOL-03: a deadline expiry during exec maps to TOOL_TIMEOUT".
- Kill on timeout, process and forked helper, rejects as timed-out: "TOOL-03: a capturing run that misses timeoutMs has its process and forked helper killed, and rejects as a timed-out OpenShellRunnerError" (real child processes; the existing "RT-03: the OpenShell runner kills the process and the helpers it forked when timeoutMs expires, then rejects" is unchanged).
- Non-zero exit is success: "TOOL-03: a non-zero remote exit code is a successful call carrying exitCode, not an error"; "TOOL-03: captured output below the bound is returned whole with truncated false, and a non-zero exit is an outcome" (real child exit 3).
- Create path stdio stays ignored: "TOOL-03: without captureOutput the runner outcome carries the exit code only, so the create path keeps its output out".
- Invalid timeout refused before any run: "TOOL-03: exec refuses a non-positive timeout before any OpenShell run starts".

Truth 2 (policy written with egress and workload binary before create; invalid allowlist fails before any create):
- Egress list and workload binary reach the policy document the create runs against: "RT-05, RT-03: create writes the egress list and the workload binary into the policy the create runs against".
- Write precedes the create argv: "RT-03, CORE-06: the policy document is written before the OpenShell create runs" (updated to the two-argument call; `policyAtRun` holds the text at run time).
- Invalid allowlist throws SCHEMA_INVALID at construction, with zero OpenShell runs, zero containers, no policy write, and zero libpod requests: "RT-05: an invalid egress allowlist throws SCHEMA_INVALID at construction, before any OpenShell run, container, policy write or libpod request".

Truth 3 (existing create, start, probe, stop, destroy unchanged; RT-01, RT-03, CORE-06 preserved):
- Unchanged existing tests: "CORE-06, RT-03: a second create with the same session reuses the labelled container and runs the OpenShell create once"; "RT-01, RT-03: a failed hardening check destroys the container ..."; "RT-03, RT-04: start refuses a container that is not running ..."; "RT-01, RT-04: probe is healthy only when the container runs and AgentOS reports alive"; "RT-03: stop stops the container, destroy removes it, ...".
- Execution-layer D-80 refusal: "RT-05, D-80: no argv the execution path spawns, for create or exec, carries a forbidden flag" (asserts `--env`, `--provider`, `--driver-config-json`, `--forward`, `--expose`, `--template`, `--auto-providers` are absent from both the create and the exec argv, matched as whole argv elements).
- Source-level prohibitions still hold: "AUD-02, D-67: session-execution reads no host environment and its runner never uses a shell" (no `process.env` or `shell: true` added to the module).

## Deviations

1. Exec helper: the plan names no exec function. `runSandboxExec` is exported from `session-execution.ts` so the dispatcher (plan 04-06) imports one exec path and does not map errors itself. The kind-to-error mapping lives in this helper; `spawnOpenShellRunner` rejects with `OpenShellRunnerError` as the 04-03 contract requires, so the kind stays visible to callers and tests. The plan text put `makeRealmError` mapping in the runner; the same mapping is applied one call up.
2. The egress option is typed `unknown` and validated by the constructor. It is an untrusted input in the same sense as `validateEgressAllow(rules: unknown)`, so the type does not promise a valid list.
3. `workloadArgv[0]` is typed `string | undefined` under `noUncheckedIndexedAccess`. The create path throws `SCHEMA_INVALID` when it is absent. `loadRuntimeConfig` already guarantees a non-empty array, so the branch is a type narrowing, not a new policy.
4. Promise executor form kept in `spawnOpenShellRunner`, not `Promise.withResolvers`: `tsconfig.json` sets `lib` to `ES2023`, where `Promise.withResolvers` is not typed, and the file already uses the executor form.
5. The fake gained steps (`reject-failed`, `reject-timed-out`, `{ output }`) rather than extra fields on the existing steps; the existing steps keep their behavior.
6. Real-process tests use `process.execPath` children with real time, as the existing runner tests do. This is deliberate: a fake clock cannot advance an OS process's kill.

## Open items (outside this lane's files)

- `src/tools/dispatch.ts` (plan 04-06): exec must go through `runSandboxExec` from `src/runtime/session-execution.ts`, with the dispatcher's `timeoutMs`. It must not map runner errors itself.
- `test/integration/podman-gate.test.ts` (plan 04-07) and `src/doctor/checks.ts` were not in this lane; their `writePolicyDocument`/`buildCreateArgv` call sites are unchanged by this plan.
- OQ-P4-04 (exec verb against a real sandbox) and OQ-P4-02 remain live-gated. Podman on this host is 4.9.3; nothing here is live-verified.
- OQ-P4-10 default applied: egress is fixed at create, and a change means destroy and recreate.

## Decisions carried

- D-79, D-80, D-81, D-91, D-92, D-94, D-106, D-108 as written in 04-CONTEXT.md. No new error code, policy key, or dependency (D-101).
- The exec argv is built only by `buildExecArgv`; no shell form is built here (D-92, D-89).
- Captured output is bounded per stream at 262144 bytes, and the runner keeps draining past the bound so a chatty child cannot block (D-94).
