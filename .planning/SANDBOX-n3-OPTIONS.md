# SANDBOX n3 — Extension options vs n1b baseline

Scope: n3 steps SPE-38087..38092 only. Fact base: `.planning/SANDBOX-n1b-MANIFEST.md`,
`.planning/SANDBOX-n1b-ISOLATION.md`, `.planning/SANDBOX-n1b-LIFECYCLE.md`.
Every factual claim below cites section and line of one of those three files.
No other file is cited as a sole authority. This file is the only write.

## 1. Baseline in five facts

| # | Baseline fact | Cite |
|---|---|---|
| 1 | TS strict ESM, Node `>=22.13.0`, Linux-only; Podman 5.x required, Realm does not install it | MANIFEST §1 L7-19; §2 L23-27 |
| 2 | Single exec path: daemon start gate → `defaultExec` → dispatch `#exec` → `runSandboxExec` → OpenShell runner; never a host shell | ISOLATION §Entry point L7-14; §Fail-closed L65 |
| 3 | Defaults fail-closed: `mode=fail-closed`, empty roots/allow lists, `shellEnabled=false`; policy outside own root; digest-pinned image; closed runtime config keys | ISOLATION §Default-deny L18-24; §Allowlist L36-41 |
| 4 | Every failure is a catalog `RealmError` or a throw before any libpod/OpenShell call; no unsandboxed path exists | ISOLATION §Fail-closed L48-65 |
| 5 | 5-state machine (9 edges, no self-transitions) separate from `SessionExecution` create/start/probe/stop/destroy | LIFECYCLE §1 L9-27; §2 L43-45 |

Resource bounds actually evidenced: wall-clock only. `TOOL_CALL_TIMEOUT_MS=30_000`,
create deadline `60_000`, stop `15_000`, container stop `2_000`, confirm `10_000`,
sandbox-delete `15_000` (ISOLATION §Entry point L13; LIFECYCLE §3 L106-123).
No CPU/memory/disk quota, cgroup value, or storage cap is evidenced in the baseline;
`verifyOrRemove` checks hardening/conformance only (LIFECYCLE §2 L58-62).
Absence of evidence is not proof the current mechanism cannot enforce a quota.

## 2. The six scoring criteria (pass = must hold, not preference)

| Criterion | Pass rule |
|---|---|
| C1 Fail-closed isolation | New code denies with a catalog code or throws before any libpod/OpenShell call; reuses `bindRoot`/`canonicalize`/credential denial; no new host path |
| C2 Bounded CPU/memory/disk/wall-clock | All four bounds are explicit values validated at the gate (reject non-positive/invalid), enforced inside the sandbox, and reported on violation; silent defaults fail |
| C3 Guaranteed cleanup | Success, failure, timeout, and cancel/offline paths all reach the existing delete/remove/stop steps; any failed delete surfaces as a failure step, never as success |
| C4 Observable execution states | Create/start/probe/stop transitions and bound violations are logged as structured lines (redacted) and/or `state.transition` events; no success without the matching event/line |
| C5 Existing-pattern fit | Plain TS ESM + Node built-ins + existing deps/scripts; no new runtime, package, or GH action; same modules, codes, and test gates |
| C6 No-unsandboxed-fallback | No branch, catch, retry, probe fallback, or wrapper may run the workload on the host, in a second container, or with reduced policy when the sandbox path fails |

## 3. What the options mean (file-disjoint, in place)

- **Option A — extend in place.** Add explicit resource/observation fields to the
  existing `src/runtime/config.ts`, `src/core/policy.ts`, and
  `src/runtime/session-execution.ts`; enforce in `SessionExecution.create`/
  `runSandboxExec`/teardown with existing `withTimeout`/`killProcessTree`.
  Single exec entry unchanged.
- **Option B — configure/wrap existing primitive.** Drive behavior only from the
  existing policy keys (`mode`, `workspaceRoots`, `credentialAllow`,
  `egressAllow`, `shellEnabled`) and runtime keys (`image`, `stateDir`,
  `workspaceRoot`, `secretRoot`, `sandboxStateRoot`), plus a wrapper around the
  current runner/dispatch. No core-module changes.
- **Option C — replace with new runtime/dependency.** Swap Podman/OpenShell/AgentOS
  runner for a new container runtime, sidecar, or service; new dep, image, and
  supervision path.

## 4. Scores (PASS / PARTIAL / FAIL per criterion)

| Criterion | A: extend in place | B: configure/wrap | C: replace |
|---|---|---|---|
| C1 Isolation | PASS — extends the gate that already refuses before any libpod call (ISOLATION §Entry point L14; §Fail-closed L50-55) | PARTIAL — keys exist (ISOLATION §Allowlist L36-41) but any wrapper above dispatch `#exec` must reproduce its policy/state checks or bypass them (ISOLATION §Entry point L13) | FAIL — new runtime re-opens §Fail-closed L48-65 proof; baseline does not show the old path cannot enforce isolation |
| C2 Bounds | PASS (with guardrail G2) — wall-clock already validated as positive-int `timeoutMs` and enforced by watchdog/kill (LIFECYCLE §3 L116-123); quota fields land at the same gate | FAIL — existing keys carry no CPU/memory/disk field (ISOLATION §Allowlist L40); wrapper cannot bound what policy cannot express | PARTIAL — could carry quotas, but no baseline proof current mechanism cannot (see §1 note); unproven premise |
| C3 Cleanup | PASS — create-failure delete, hardening force-remove, and every teardown step attempted (LIFECYCLE §4 L130-136) | PARTIAL — wrapper must still reach `stop`/`deleteNamedSandbox` on timeout/cancel; a timed-out driver stop currently reports failure, never success (LIFECYCLE §2 L89-91) | FAIL — new teardown order unproven vs `endSession` aggregation (LIFECYCLE §2 L69-77) |
| C4 Observability | PASS — same logger shape `ts,level,event,code` + redaction (LIFECYCLE §5 L161-170); state events already emitted (LIFECYCLE §1 L29-34) | PARTIAL — `requests.log`/`daemon.log` shapes exist (LIFECYCLE §5 L171-180) but quota/bound events need a new emitter | PARTIAL — new log/event surface unproven; must not bypass `state.transition` |
| C5 Pattern fit | PASS — TS strict ESM, no new dep (MANIFEST §1 L12-19); uses `withTimeout`/`sleep` (LIFECYCLE §3 L99-105) | PASS — config-only, smallest diff; matches MANIFEST script/CI discipline (MANIFEST §3 L31-47) | FAIL — new runtime contradicts Node/Podman/Linux-only pins (MANIFEST §2 L23-27); CI verify order has no slot for it (MANIFEST §4 L57) |
| C6 No fallback | PASS if G1 held — every failure today throws before libpod/OpenShell (ISOLATION §Fail-closed L65) | PARTIAL — wrapper catch/retry is the classic fallback site; must be banned explicitly | FAIL — replacement path itself is a second execution mode until the old one is deleted |

Decision rule for C (mandatory): C is rejected unless the baseline proves the
current mechanism cannot enforce a control. It does not: isolation, wall-clock,
cleanup, and observability are each evidenced as enforced above; CPU/memory/disk
are unevidenced, not proven unenforceable. C is therefore rejected.

## 5. Selected option: A — extend in place

Guardrails (all mandatory; violation = stop, not retry):

- **G1 No fallback.** Reject unknown/denied config keys with `SCHEMA_INVALID`
  (ISOLATION §Default-deny L23); deny shell form with `SHELL_NOT_ALLOWED`
  (ISOLATION §Entry point L13); no catch may re-dispatch to host or second runner.
- **G2 Bounds as gate values.** Reject non-positive/non-finite timeouts and stop
  deadlines at construction (LIFECYCLE §3 L106-107) and invalid `timeoutMs` with
  `SCHEMA_INVALID` (ISOLATION §Entry point L13). Any new CPU/memory/disk field is
  a required, validated gate value or the feature ships disabled — never unbounded.
- **G3 Ordering.** Keep `requireAgentOs`/`requireSecretRoot`/`requireSandboxStateRoot`
  before any libpod/OpenShell/policy-file call (ISOLATION §Entry point L14;
  LIFECYCLE §2 L47-52) and `verifyOrRemove` before returning a running container
  (LIFECYCLE §2 L58-62).
- **G4 Cleanup order.** Keep `settleCreatesFor` → `stopAgentOs` → `endContainer`
  → sandbox delete, aggregate all steps, first cause wins (LIFECYCLE §2 L69-77).
  Already-gone container = removed; inspect rejection = failed step (LIFECYCLE §2 L74-77).
- **G5 Observability.** Log under existing keys/levels and redaction; never log
  values the redactor would strip (LIFECYCLE §5 L161-170, §6 L184-201).
- **G6 Blast radius.** Touch only `config.ts`, `policy.ts`, `session-execution.ts`
  (and their tests). Do not edit the 5-state machine, dispatch entry, daemon gate,
  or CI matrix — those are the proven parts.

B is retained only as the *configuration surface* inside A: prefer expressing
behavior through existing policy/runtime keys where they fit. B as a standalone
wrapper is not selected (fails C2, partial on C1/C3/C6).

## 6. Grey areas for n4 (do not guess; verify in n4)

| Grey area | Why it stays open in baseline |
|---|---|
| CPU/memory/disk enforcement mechanism | No quota/cgroup value evidenced; Podman/OpenShell quota support unverified (ISOLATION §Unverified L67-72) |
| Egress enforcement body | `src/host/capabilities.ts` body explicitly unverified (ISOLATION §Unverified L69) |
| `OPENSHELL_ENV_NAMES` definition | Referenced, not read in baseline (ISOLATION §Unverified L70) |
| `buildExecArgv` / `createRealmHandle` internals | Dispatcher wiring verified, internals not (ISOLATION §Unverified L71) |
| Log-sink rotation parameters | `createFileSink` out of scope (LIFECYCLE §Unverified L205) |
| Startup reap/orphan-sweep trigger owner | Only report shape verified (LIFECYCLE §Unverified L211-212) |
| Image build dependency additions | `build:image`/`check:image-digests` need Podman and are NOT in CI (MANIFEST §4 L63) |

## 7. n4 handoff

n4 verifies G1–G6 against the tree (resource-quota mechanism decision first),
then implements A in the three named modules. Any finding that a control cannot
be enforced by the Podman/OpenShell path re-opens C with that proof attached —
nothing else does.
