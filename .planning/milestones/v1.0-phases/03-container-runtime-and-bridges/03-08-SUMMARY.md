# Plan 03-08 Summary: Session execution, down sweep, no-bypass proof

Status: done for unit scope. Live behaviour is gated and unverified: the development host runs Podman 4.9.3, so no live OpenShell sandbox start, container inspect on 5.x, or zero-orphan sweep against a real engine is claimed here. The concrete AgentOS driver is not bound (OQ-P3-05, OQ-P3-06); the supervisor is composed with a driver argument only.

## Files

- `src/runtime/session-execution.ts` (new):
  - `SessionExecution` implements the frozen `ExecutionService` (D-39). Its dependencies (libpod client, OpenShell runner, AgentOS supervisor, validated config) are constructor arguments. It reads no host environment.
  - `create`: reads the libpod info for the rootless flag, validates the config view, writes the policy document, runs the label-idempotent OpenShell create, then verifies the inspect. A mismatch or an unreadable inspect removes the container best effort and throws `OPENSHELL_START_FAILED`.
  - `start`, `probe`, `stop`, `destroy` as the plan specifies. There is no exec verb.
  - `removeAllRealmContainers(libpod)`: the down sweep (RT-09, D-68).
  - `spawnOpenShellRunner(environment)`: the production OpenShell runner. It spawns argv[0] with `shell: false`, `stdio: "ignore"`, and only the given environment. It kills the child at `timeoutMs` and rejects with fixed messages.
  - `selectOpenShellEnvironment(source)`: picks `PATH`, `HOME`, and `XDG_RUNTIME_DIR` from a caller-supplied source.
- `test/runtime/session-execution.test.ts` (new): 12 tests.
- `test/runtime/down-sweep.test.ts` (new): 3 tests.
- `test/runtime/openshell-routing.test.ts` (new): 3 tests.

## Test results

- `npx tsc -p tsconfig.json`: exit 2. The only errors are `test/integration/podman-gate.test.ts` and `test/quality/suite-taxonomy.test.ts`, the known imports of the moved podman-version path that plan 03-10 fixes. No error comes from an owned file, and output is emitted.
- `node --test dist/test/runtime/session-execution.test.js dist/test/runtime/down-sweep.test.js dist/test/runtime/openshell-routing.test.js`: exit 0, 18 pass, 0 fail, 0 skipped.
- `npx eslint` on the four owned `.ts` files: no issues.

Test titles (each cites its requirement IDs):

- session-execution: reuse with one OpenShell run (CORE-06, RT-03); a failed hardening check destroys the container and throws `OPENSHELL_START_FAILED` with the first failed property named (RT-01, RT-03); an unreadable inspect fails closed (RT-01, RT-03); the policy file exists before the create runs (RT-03, CORE-06); start refuses a stopped container and starts AgentOS only through the supervisor (RT-03, RT-04); probe is healthy only when running and AgentOS is alive (RT-01, RT-04); stop and destroy are repeatable (RT-03); the environment allowlist (AUD-02, D-67); no host-environment read and no shell in the source (AUD-02, D-67); the runner runs without a shell and passes only its environment (RT-03); the runner kills a process at `timeoutMs`, verified by the child's pid being gone (RT-03); a missing binary is rejected without echoing its path (RT-03).
- down-sweep: labelled removal with a foreign container untouched (RT-09); two listings per run and a clean repeat is a no-op (RT-09); a survivor gives `REALM_STOPPING` and a repeat clears it (RT-09).
- openshell-routing: the workload starts only through the OpenShell create argv, with the workload after `--` (RT-03); the libpod client has no process-starting method and no request reaches one (RT-03); AgentOS is started only through the supervisor (RT-03, RT-04).

## Requirement evidence

- RT-01 (unit): the verify-then-destroy path, with the first failed property named, is covered by `session-execution.test.ts`. The live container check is gated (OQ-P3-14).
- RT-03 (unit, structural): the argv path, the libpod method set and routes, and the supervisor-only AgentOS start are covered by `openshell-routing.test.ts`. The live no-bypass proof is gated.
- RT-09 (unit): labelled removal, foreign preservation, the zero-orphan proof by second listing, and `REALM_STOPPING` are covered by `down-sweep.test.ts`. A live zero-orphan proof is gated.
- CORE-06 (unit): a repeated create reuses the labelled container with one runner call.
- RT-04 (unit, consumed): probe and start use the supervisor. Its restart policy is covered by plan 03-07.
- Live-gated and unverified, with the default applied: OQ-P3-01 (driver applies `--label`), OQ-P3-02 (`/workspace` bind path; the create argv carries no workspace mount, so the verifier's workspace mount source relies on the driver), OQ-P3-03 (digest), OQ-P3-04 (sandbox records; containers-only removal, Phase 4 owns records), OQ-P3-14 (hardening properties on a real container).

## Deviations and decisions

- `HardeningFailedError` extends `RealmError` and adds one `property` field. The field holds a fixed name from `HARDENING_PROPERTIES`, never caller text. The plan requires the first failed property to be named, and `RealmError` carries only the catalogue code. The code stays `OPENSHELL_START_FAILED`.
- The hardening check runs on the reuse path as well as the first create. A reused container is verified before it is returned.
- `start()` starts AgentOS through the supervisor after confirming the container is running. Without that call the supervisor stays idle and `probe()` could never report healthy.
- `probe()` maps every failure, including `AGENTOS_CRASH_LOOP` and libpod errors, to `unhealthy`. A probe answers a health question, and the lifecycle decides the consequence.
- `stop()` stops AgentOS best effort first, then the container. `destroy()` only removes the container, as the plan states.
- The sweep does not stop at the first failed removal. It attempts every container and lets the second listing report survivors. A failed removal is therefore never silent.
- Two values are chosen here, not taken from the plan: the create deadline (60 s) and the stop grace period (10 s). The sandbox CPU and memory are derived from `HARDENING_PROFILE`, so they cannot drift from the verifier.
- `OPENSHELL_ENV_NAMES` repeats the three names of the probe's private list in `podman-probe.ts`. That file is not owned by this plan, so the list is not imported.
- `Promise.withResolvers` is not used. The tsconfig lib is ES2023 and `test/lifecycle/idempotent.test.ts` documents the executor form for that reason.
- The runner-kill test waits on a real child process with real-time polling, which no fake clock can drive. The helpers carry a comment naming the exception.
- The RT-09 phrase "session left in stopping" is the controller's responsibility (plan 03-09). This plan's sweep reports `REALM_STOPPING`, and its tests cover that code only.

## Open items for later plans

- Plan 03-09 (controller) must read `ExecutionService` only, and must call the sweep and the stopping transition itself.
- The composition root (plans 03-09 and 03-10) must build the production runner as `spawnOpenShellRunner(selectOpenShellEnvironment(<host environment>))` and construct the `AgentOsSupervisor` with a `callTimeoutMs` value. Neither wiring exists in this plan.
- No concrete AgentOS driver exists. The supervisor will reject with a start failure until OQ-P3-05 and OQ-P3-06 are resolved.
- The runtime decision note must record OQ-P3-05 and OQ-P3-06 as blocking the concrete driver. That note is not in this plan's `files_modified`.
