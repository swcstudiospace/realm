# Phase 28: Remove the Anda bridge - Context

**Gathered:** 2026-11-17, from a worktree of branch `gsd/v4-start` at commit `3b19bee` (release line 0.3.54, `release/milestone.json` already at minor 4), by case-sensitive and case-insensitive text search of `src/`, `test/`, `scripts/`, `docs/`, `site/`, `adapters/`, `.github/`, `AGENTS.md`, `README.md` and `package.json`; the owner decisions of 2026-11-17 for milestone v4.0; `docs/integration/anda-replacement-research.md` (sections 2, 7.3 and 9); `.planning/ROADMAP.md` phase blocks 27 to 31; `.planning/REQUIREMENTS.md` (v4.0 section); and the Phase 25 context and plans as the style model.
**Status:** Planned (three plans, nothing executed). Requirement IDs ANDAX-03, ANDAX-04 and ANDAX-05 are the ones registered in `.planning/REQUIREMENTS.md`. `.planning/ROADMAP.md` still shows Phase 28 as "TBD"; the orchestrator updates it. Nothing in `.planning/ROADMAP.md`, `.planning/STATE.md` or `.planning/REQUIREMENTS.md` is edited by these plans.

<domain>
## Phase Boundary

Phase 28 deletes the Anda bridge, and everything that existed only because of it, as one breaking change with a clean cutover and no shim. The owner decisions of 2026-11-17 that bind this phase:

1. Drop the Anda bridge entirely, as a breaking change, with no shim. Remove `andaUrl`, `ANDA_UNREACHABLE`, `ANDA_VERSION_MISMATCH` and the `degraded` state.
2. MCP over stdio stays the transport. Nothing replaces the bridge (the research note, section 7.1: "a replacement mechanism has nothing to carry").
3. A capability-token spike is in the milestone (Phase 30), and the local, single-user scope is fixed. Neither changes any file in this phase.
4. The release line is 0.4.x.

What the phase delivers, in the order of the three plans:

1. **28-01 (wave 1): the bridge, the config key, the codes and the doctor item.** `src/anda/` is deleted. `BridgePort`, `BridgeEvent` and `BridgeKind` leave `src/core/ports.ts`. The `bridge` dependency leaves the lifecycle controller, `src/realm/compose.ts`, `src/daemon/seams.ts` and `src/daemon/daemon.ts`. `andaUrl` leaves `RuntimeConfig` and the loader, which then refuses it as a retired key with one fixed migration sentence (D-28-02). `ANDA_UNREACHABLE` and `ANDA_VERSION_MISMATCH` leave the catalogue (31 codes become 29). The `anda-bridge` doctor item and its HTTP transport go. The tests and fakes that compile against any of these go or change in the same plan, because `npm test` compiles `test/` with `src/` and a source-only commit cannot build.
2. **28-02 (wave 2): the `degraded` state.** `STATES` goes from six to five values and `ALLOWED_TRANSITIONS` from 13 edges to 9. `displayStatus` loses its `degraded` branch and `DisplayStatus` loses its `degraded` field. Every consumer that listed `degraded` as a state (policy switches, the exec queue, the Omp status text, the CLI `up` result, the ACP boot check, the daemon health loop, the live-state test and the status reply validator) is reduced to the states that remain. Tests and status fixtures change in the same plan.
3. **28-03 (wave 3): documents, gates and the release note.** `docs/integration/anda.md` is deleted and `docs/integration/anda-decision.md` becomes a short superseded notice. `docs/policy-reference.md`, `README.md`, `AGENTS.md`, `docs/integration/omp.md`, `docs/integration/acp.md`, `docs/integration/openshell.md`, `docs/integration/runtime-decision.md`, `docs/integration/hardening-plan.md` and `docs/integration/host-binaries.md` drop or mark the removed surface. The breaking-change note is written as the pull request title, the commit subjects (the only text the generated changelog shows) and the pull request body, with `Removes:` trailers only where the rules call for them (D-28-09). The closure checks run: `npm run check:docs`, `npm run check:gates`, the full build and the whole test run.

Out of scope (not claimed, and not done here): the decision record, the requirement closure and the v2.0 carry reconciliation (Phase 27, ANDAX-01 and ANDAX-02); MCP tool annotations (Phase 29); the capability-token spike (Phase 30); production boot rehearsals (Phase 31); `CHANGELOG.md` and every version field (release-owned, AGENTS.md "Versioning and release"); the `SECURITY.md` supported-line sentence and the AGENTS.md "current milestone" line (milestone-start bookkeeping that Phase 27 or the milestone closeout owns; Plan 28-03 only records that it saw them); `.planning/milestones/**`, `.planning/baseline/**`, `.planning/quick/**` and older phase directories (planning history, never rewritten). The scope split with Phase 27 is the one Phase 27 recorded (its D-27-09): Phase 27 edits `docs/integration/runtime-decision.md` only at its status line, the S-08 Anda bullet, the three OQ-P3 rows and a new tail section, and `AGENTS.md` only at the Settled-decision bullet; Phase 28 owns every other Anda or `degraded` mention in those two files, closes the "removal is scheduled in Phase 28" wording Phase 27 had to write, and reduces `docs/integration/anda-decision.md` (which Phase 27 bannered) to the tombstone.
</domain>

<decisions>
## Implementation Decisions

### Evidence (every fact below was observed in the worktree on 2026-11-17 unless a row says otherwise)

**E1. What the bridge is, and who reaches it.** `src/anda/client.ts` (509 lines) holds `AndaBridge`, `ANDA_INFORMATION_PATH`, `sleepUnlessAborted` and `SleepFn`; `src/anda/shape.ts` (57 lines) holds `checkAppInformationShape`. Nothing outside the bridge, the doctor and the daemon seams imports them:

| Importer of `src/anda/*` | What it takes |
| --- | --- |
| `src/daemon/seams.ts` | `AndaBridge` (inside `defaultBridge`) |
| `src/doctor/checks.ts` | `ANDA_INFORMATION_PATH`, `checkAppInformationShape` (the `anda-bridge` item and its `defaultFetchInformation` transport) |
| tests | `test/anda/handshake.test.ts`, `test/anda/listener-diagnostic.test.ts`, `test/anda/reconnect.test.ts`, `test/doctor/control-channel.test.ts`, `test/doctor/runtime-checks.test.ts` (types and transport) |

`sleepUnlessAborted` is used only by the client. `src/core/timeout.ts` has its own `sleep`, used widely, and `src/core/backoff.ts` is also used by `src/runtime/agentos.ts` (AgentOS 500/8000), so both stay and only their comments change.

**E2. `andaUrl` today.** `src/runtime/config.ts` accepts it in the closed key set `ACCEPTED_KEYS`, validates it with `isAndaUrl` and `requireAndaUrl` (http or https, no userinfo, using `USERINFO_PATTERN`), reports it in `describeRuntimeConfigProblems`, and exposes `andaBridgeRequired`, which `src/realm/compose.ts` and `src/daemon/seams.ts` call to decide whether a bridge exists. `src/daemon/seams.ts` also copies `config.andaUrl` into the `config` object it hands to `SessionExecution` (typed `Omit&lt;RuntimeConfig, "workspaceRoot"&gt;`, which re-runs `loadRuntimeConfig` per request in `src/runtime/session-execution.ts`). `src/cli/init.ts` never writes it, so a config written by `realm init` never carries it. The research note (section 2.2) records that no host is known to run an engine.

**E3. How the loader treats an unknown key today (the fact that decides D-28-02).** `loadRuntimeConfig` walks `Object.keys(record)`; a key in `DENIED_KEYS` (host networking and driver escape, D-80) or a key not in `ACCEPTED_KEYS` calls `reject()`, which throws `SCHEMA_INVALID`. There is no "ignore with a warning" path anywhere in the loader: it returns one frozen `RuntimeConfig` and has no logger, no warning channel and no environment (its header says so). Every key name is deliberately absent from the error: `describeRuntimeConfigProblems` answers an unknown key with the fixed sentence "config.json has a key that is not accepted" and never echoes a key or a value (test `ONB-03: describeRuntimeConfigProblems names the failing keys and carries no value or unknown key name`). At least seven modules load this one file through the same function: `src/cli/main.ts` (twice), `src/cli/checkpoint.ts`, `src/cli/host.ts`, `src/daemon/main.ts`, `src/daemon/daemon.ts`, `src/realm/compose.ts`, `src/runtime/driver/main.ts`, `src/runtime/host-paths.ts` and `src/runtime/session-execution.ts`. `describeRuntimeConfigProblems` has no caller in `src/` today; it is exported and allowlisted as a test-only seam in `scripts/check/export-usage-allowlist.json`. In `src/cli/main.ts` a load failure is caught and printed as "cannot resolve a state directory (...) (SCHEMA_INVALID)", and for `realm doctor` as "config is absent; ran N local check (SCHEMA_INVALID)": both give no hint that the cause is a removed key, and the doctor text calls a present-but-invalid config "absent".

**E4. The codes.** `ERROR_CODES` in `src/core/errors.ts` is a frozen list of 31 codes; its header says "Exactly these 31 codes; no others" and `test/core/errors.test.ts` pins `CATALOGUE_SIZE = 31` and repeats the code list twice. `ANDA_UNREACHABLE` (retryable true) and `ANDA_VERSION_MISMATCH` (retryable false) are two of them. `src/runtime/driver/grpc-status.ts` maps both (`UNAVAILABLE` and `FAILED_PRECONDITION`). The only emitters are the bridge, the controller's `onBridgeEvent` and the doctor item. `src/lifecycle/controller.ts` also reads `ANDA_VERSION_MISMATCH` in `create` and `hydrateHeld` to refuse a retry after a startup mismatch. `test/omp/plugin.test.ts` uses `ANDA_UNREACHABLE` and `ANDA_VERSION_MISMATCH` as arbitrary reason strings in 19 places. Docs naming codes: `docs/policy-reference.md` and `docs/integration/runtime-decision.md` (line 393, a sentence that says `ANDA_UNREACHABLE` and `PODMAN_MACHINE_DOWN` "name other services").

**E5. The only producer of `degraded`.** `onBridgeEvent` in the controller is the single place that transitions to `degraded` (`active` to `degraded` on a down event with reason `ANDA_UNREACHABLE`, `degraded` to `active` on up). The controller's own comment on `probe` says "Probe never produces degraded: Phase 3 (ANDA-03) does". The research note records that no live run has ever observed `degraded`. Eleven source files read the state: `src/core/states.ts`, `src/core/status.ts`, `src/core/policy.ts`, `src/tools/dispatch.ts`, `src/lifecycle/controller.ts`, `src/lifecycle/session-state.ts`, `src/daemon/sessions.ts`, `src/daemon/client.ts`, `src/cli/main.ts`, `src/cli/stdio-host.ts` and `src/omp/plugin.ts`. The status wire shape carries it as `display.degraded` (boolean), validated by `isDisplayStatus` in `src/daemon/client.ts`, drawn by `src/omp/plugin.ts` as a ` [degraded]` suffix, and printed in the `README.md` captures. The research note's open question 2 offered "keep as a reserved state" or "remove it in a separate breaking phase (about eleven source files and thirty-five test and doc files)". The owner chose removal (decision 1 above). No JSON schema file lists the state names: `src/contract/session-record.schema.json` leaves the `state` enum to `src/contract/validate.ts`, which sets it from `STATES` (`sessionRecordStateEnum` is exported so a test can compare it with `STATES`); `src/contract/tools.schema.json` and `src/core/policy.schema.json` do not mention states or Anda.

**E6. The `persistCode` mechanism is reachable only from the bridge listener.** `StateMachine.holdPersistCode` has exactly one caller, `onBridgeEvent` (a background listener that must not throw, so a failed state write is held for the next transition, finding F7). `releasePersistCode` is called after the two controller writes, `StateEvent.persistCode` (`src/core/events.ts`) carries the code, and `src/daemon/sessions.ts` logs it as `persistCode` on `lifecycle.transition`. Tests `test/lifecycle/create-interrupt.test.ts` (the test at line 376) and `test/lifecycle/teardown-failures.test.ts` (line 80 area) exercise it through a bridge down event. After the bridge goes, the hold has no caller. `recoveredCode` (a different hold, set by stale-container recovery) stays.

**E7. A persisted `degraded` record becomes unreadable.** The controller writes the state to `STATE_DIR/sessions/SESSION_ID.json` on every transition (`writeState`), and the validator enum is derived from `STATES`. After this phase a record with `"state": "degraded"` fails `validate("sessionRecord", ...)`. `SessionStore.load` throws `SCHEMA_INVALID`; `readRecords` in `src/session/reap.ts` catches that and treats the record as unreadable: the record is deleted (cause `unreadable`) and its container, which then has no record, is removed with cause `no-record` by the startup reap. A clean `realm down` deletes the record, so only a daemon that died while a session was `degraded` leaves one, and `degraded` only ever occurred with `andaUrl` set. No migration shim is added (D-28-07).

**E8. The doctor.** `src/doctor/checks.ts` registers 11 items in `REGISTERED` (policy-file, state-dir, session-store, podman, podman-service, openshell, anda-bridge, control-channel, agentos, host-binaries, kernel-hardening), then appends the three runtime items (`runtime-roots`, `driver-socket`, `gateway`, from `src/doctor/runtime-checks.ts`) and `host-plugins`. The Anda-only parts are: the `anda-bridge` member of `CheckId`; the `DoctorOptions` members `fetchInformation` and `andaUrl`; the types `AndaReply` and `FetchInformation`; the constants `ANDA_MAX_BODY_BYTES`, `FIX_ANDA_URL`, `FIX_ANDA_SHAPE` and the Anda-specific setup text next to them; `andaBridgeCheck`; `defaultFetchInformation` and its `HttpTransport` type; and the imports `httpRequest`, `httpsRequest`, `ClientRequest`, `IncomingMessage`, `RequestOptions`, `ANDA_INFORMATION_PATH`, `checkAppInformationShape`. Whether the `node:http` and `node:https` imports have another user is checked by the compiler (`noUnusedLocals`). `docs/integration/openshell.md` states "fourteen items: the eleven above" for the report with a loadable config; after the cut it is "thirteen items: the ten above". Finding: no production caller ever sets `DoctorOptions.andaUrl` (`src/cli/main.ts` passes `runtimeConfig` and the daemon passes `runtimeConfig: config`; a text search finds `andaUrl` assigned to a doctor option only in tests), so in production the item always reported "no Anda Engine URL is configured" and could not have reached an engine even when `andaUrl` was set. The recorded receipts that say the item "warned because no engine URL is configured" are consistent with that. This lowers the cost of the removal: no operator ever got an engine health line from `realm doctor`.

**E9. Gates that the change touches (read from the scripts).**

| Gate | Rule | Consequence here |
| --- | --- | --- |
| `scripts/check/export-usage-gate.mjs` | A `src/` export with no importer outside its file (`self-only`) or only test importers (`test-only`) fails unless allowlisted; an allowlist entry that no longer names a failing export is STALE and fails | Remove the allowlist entries `src/anda/client.ts#SleepFn`, `src/anda/client.ts#sleepUnlessAborted` and `src/doctor/checks.ts#AndaReply` (their files or types are gone). `andaBridgeRequired` is orphaned between 28-01 tasks 2 and 3 (a stopgap entry, removed in task 3). `describeRuntimeConfigProblems` stays an allowlisted test-only seam; the CLI calls the new `retiredKeyNotes` instead, which has a production importer and needs no entry. Any export the removal orphans must be deleted or, if a seam, allowlisted with a reason: `computeBackoffDelayMs` and `RandomSource` keep their `src/runtime/agentos.ts` importer |
| `scripts/check/module-size.mjs` | A `src/` file over 1000 lines needs an allowlist ceiling at or above its size; an entry for a file at or under 1000 lines is stale and fails | `src/lifecycle/controller.ts` is 1208 lines with a ceiling of 1218. Removing the bridge methods, fields and branches removes about 150 lines, so the file lands near 1060: still over 1000. The ceiling is lowered to the measured count (the ratchet only fails on growth, but the allowlist shrinks by convention). If the count is 1000 or fewer, delete the entry or the gate fails |
| `scripts/check/gate-closure.mjs` | The exec gate entry modules (`src/core/policy.ts`, `src/core/states.ts`, `src/core/errors.ts`, `src/contract/validate.ts`) must not reach `src/doctor/checks.ts`, `src/runtime/session-execution.ts` or `src/cli/main.ts`, and no `child_process` | The edits to those four files only delete lines; no import is added |
| `scripts/check/coverage.mjs` with `scripts/check/coverage-floors.json` | Floors for `src/fs`, `src/core`, `src/tools`, `src/host`, tolerance 1 | `src/core` loses `ports.ts` types and two catalogue entries; verified by `npm run test:coverage` in Plan 28-03, no floor change is planned |
| `scripts/check/host-paths.mjs`, `agents-sync.mjs`, `default-mode.mjs` (`npm run check:docs`) | No host-local absolute path in published docs; `AGENTS.md` and `CLAUDE.md` stay in sync and keep the required headings; the default-mode wording scan | New text uses placeholders only; AGENTS.md keeps all ten `##` headings |
| `scripts/check/pack-smoke.mjs`, `mcp-smoke.mjs` | Run the packed package and compare MCP and CLI status | Neither names Anda, `degraded` or the config key. `scripts/check/mcp-smoke.test.mjs` has one status fixture with `degraded: false` (line 18) that changes in Plan 28-02 |
| `eslint.config.js`, `tsconfig.json`, `.github/workflows/ci.yml`, `package.json`, `adapters/**`, `site/**`, `release/**`, `sandbox/**` | none | Searched: no Anda, `andaUrl` or `degraded` reference. No change |

**E10. The release tooling (read from `scripts/release/changelog.mjs` and AGENTS.md).** The generated changelog section lists one bullet per surviving commit, taken from the commit **subject only** (`git log --no-merges PREVIOUS_TAG..HEAD`, `%s`), grouped by Conventional Commit type (`refactor` goes under "Changed", `docs` under "Documentation", `test` under "Maintenance"). A `!` after the type or scope keeps a commit that would otherwise be dropped (scope `planning`). Commit bodies never reach the notes. A `Removes: SHA` trailer (one line per commit, in the body) drops the named feature commits from the notes when they are in the same release range, and drops the removing commit too unless it names a commit from an earlier release. A merge commit pull request lists each commit; a squash merge lists only its title (AGENTS.md "Merge and release flow", item 5). The previous tag is `v0.3.54`; the range `v0.3.54..HEAD` holds one commit today (`3b19bee`, a `docs` commit), so no feature commit that added the bridge is in range.

### Findings that shape the plans

- **F1. Tests are compiled with sources.** `npm test` is `tsc -p tsconfig.json && node --test "dist/test/**/*.test.js"`. Deleting `src/anda` while a test still imports it breaks the build, so each source-removal task carries its test changes, and each task leaves the tree compile-green and its own tests passing. The assignment sketch put tests in a second wave; this phase cannot, for that reason (see D-28-01).
- **F2. `bridge:` is a fixture parameter in 20 test files**, always `bridge: new FakeBridge()` (or a local variable of it) and the `FakeBridge` import from `test/support/fake-bridge.ts`. Removing the `bridge` option from the controller, `compose` and the daemon makes each a type error (`exactOptionalPropertyTypes` and excess-property checks), which the compiler lists. The 20 files are in the file inventory below.
- **F3. Several non-bridge tests reach `degraded` only through the bridge.** The cases are listed per file in the inventory; each is deleted when an `active` or `error` equivalent already exists and rewritten to `active` otherwise, never dropped without a stated reason. The behaviours that must keep a test after the bridge tests are deleted: teardown bound and resumed destroy (`test/lifecycle/teardown-failures.test.ts`), startup budget (`test/lifecycle/startup-budget.test.ts`), retry from `error` (`test/lifecycle/idempotent.test.ts` and `test/lifecycle/controller.test.ts`), the health loop timer lifecycle (`test/daemon/daemon-health.test.ts`), a failed probe moving `active` to `error` (`test/lifecycle/controller-health.test.ts`), and the mutation gate refusing every non-active state (`test/lifecycle/mutation-gate.test.ts`, `test/core/fail-closed.test.ts`).
- **F4. The `describeRuntimeConfigProblems` privacy rule and the retired key.** The privacy rule is "no input value and no unknown key name is ever echoed". A fixed sentence chosen from a closed table of retired keys is not input echo: the executor prints only text that is a literal in `src/runtime/config.ts`, and only for a key the table names.
- **F5. Old daemon and new client.** `isDisplayStatus` requires `typeof degraded === "boolean"` today. After the change the validator ignores unknown keys, so a new CLI reading a not-yet-restarted 0.3 daemon still passes (the extra key is ignored). An old CLI or plugin reading a new daemon fails the old validator. CLI, daemon and Omp plugin ship in one package, so this only arises when a 0.3 daemon outlives the upgrade; the release note tells the operator to run `realm down` before upgrading (D-28-09). [INFERENCE] that no mixed pair is otherwise possible; no skew test exists in the repository.
- **F6. The planning docs that name Anda are history.** `.planning/ROADMAP.md`, `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/MILESTONES.md`, `.planning/MILESTONE-CONTEXT.md`, `.planning/baseline/*`, `.planning/quick/*`, `.planning/milestones/**` and `.planning/phases/RECOVERY-2026-10-31.md` mention Anda. They are planning records, changed only through GSD commands by their owners, and are excluded from the closure search.

### File inventory (complete, from the searches above; line numbers are at `3b19bee` and are orientation only, the symbols are the contract)

**A. Deleted outright (10 files)**

| File | Why |
| --- | --- |
| `src/anda/client.ts`, `src/anda/shape.ts` | The bridge (directory `src/anda/` is removed) |
| `test/anda/handshake.test.ts`, `test/anda/listener-diagnostic.test.ts`, `test/anda/no-shim.test.ts`, `test/anda/reconnect.test.ts` | Tests of the bridge and its no-Rust-shim pin (directory `test/anda/` is removed) |
| `test/lifecycle/bridge-states.test.ts`, `test/lifecycle/bridge-retry.test.ts` | Controller behaviour with a bridge (12 and 4 tests) |
| `test/support/fake-anda.ts`, `test/support/fake-bridge.ts` | Fakes of the bridge and its engine |
| `docs/integration/anda.md` | Sourced facts about a removed integration (D-28-08) |

**B. Source files edited (24)**

| File | Change |
| --- | --- |
| `src/core/ports.ts` | Remove `BridgeKind`, `BridgeEvent`, `BridgePort` and their comment block |
| `src/core/errors.ts` | Remove the two codes from `ERROR_CODES` and `ERROR_CATALOGUE`; header "31" becomes "29" |
| `src/core/states.ts` | `STATES` loses `degraded`; `ALLOWED_TRANSITIONS` loses four edges; header and comments say five states and 9 edges |
| `src/core/status.ts` | Remove the `degraded` case, the `degraded` field of `DisplayStatus` and the `display` helper parameter |
| `src/core/policy.ts` | Remove `case "degraded"` in `denyCodeFor`; reword the `decideMutation` comment that mentions a bridge |
| `src/core/state-machine.ts`, `src/core/events.ts` | Remove `holdPersistCode`, `releasePersistCode`, the `persistCode` member of `held` and of the event (E6) |
| `src/core/backoff.ts`, `src/core/timeout.ts` | Comment-only: drop "Anda" and `ANDA-03` from the header, and the `sleepUnlessAborted in src/anda/client.ts` pointer in `sleep` |
| `src/tools/dispatch.ts` | Remove `case "degraded"` in the exec refusal switch |
| `src/lifecycle/controller.ts` | Remove the `bridge` dependency, `unsubscribeBridge`, `bridgeHandshake`, `bridgeConnected`, `connectBridge`, `subscribeBridge`, `onBridgeEvent`, `releaseBridge`, the bridge half of `teardownBridgeAndContainer` (renamed `teardownContainer`), the two `ANDA_VERSION_MISMATCH` refusals in `create` and `hydrateHeld`, the two bridge steps in the create and hydrate tails, `releasePersistCode` calls, and every `degraded` clause (`probe`, `isInService`, comments) |
| `src/lifecycle/session-state.ts` | `isLiveState` drops `degraded` |
| `src/lifecycle/mutation-gate.ts` | Comment only (a stale "anda." fragment in the header) |
| `src/realm/compose.ts` | Remove the `bridge` option, field and the `andaBridgeRequired` branch |
| `src/daemon/seams.ts` | Remove `defaultBridge`, the `bridge` option, the `AndaBridge` and `andaBridgeRequired` imports and the `andaUrl` member of the `config` object handed to `SessionExecution` (`defaultExec`); reword the header and the logger comment |
| `src/daemon/daemon.ts` | Remove the `bridge` wiring (`defaultBridge` import, `options.bridge ??`, the `bridge` key) and the header mention |
| `src/daemon/sessions.ts` | Health loop runs in `active` only; drop the `persistCode` log field |
| `src/daemon/client.ts` | `isDisplayStatus` stops requiring `degraded` |
| `src/runtime/config.ts` | Remove `andaUrl`, `andaBridgeRequired`, `isAndaUrl`, `requireAndaUrl`, `USERINFO_PATTERN` and the `ACCEPTED_KEYS` entry; add `RETIRED_KEYS` and its sentence (D-28-02) |
| `src/runtime/driver/grpc-status.ts` | Remove the two map entries |
| `src/doctor/checks.ts` | Remove the Anda parts listed in E8 and the `anda-bridge` entry of `REGISTERED`; fix the header |
| `src/cli/main.ts` | `upResult` accepts `active` only; the config-load failure paths print the retired-key sentence (D-28-02) |
| `src/cli/stdio-host.ts` | ACP boot check accepts `active` only |
| `src/omp/plugin.ts` | Remove the ` [degraded]` flag and `case "degraded"`; reword the one-label comment |

**C. Tests edited** (counts are text-search hits and are orientation only)

| File | Change |
| --- | --- |
| 20 files that import `FakeBridge`: `test/daemon/daemon-health.test.ts`, `test/daemon/daemon.test.ts`, `test/daemon/e2e.test.ts`, `test/daemon/host-boot-control.test.ts`, `test/integration/omp-guard.test.ts`, `test/lifecycle/adopt-hydrate.test.ts`, `test/lifecycle/controller-health.test.ts`, `test/lifecycle/controller.test.ts`, `test/lifecycle/create-interrupt.test.ts`, `test/lifecycle/idempotent.test.ts`, `test/lifecycle/mutation-gate.test.ts`, `test/lifecycle/no-host-env.test.ts`, `test/lifecycle/stale-container.test.ts`, `test/lifecycle/startup-budget.test.ts`, `test/lifecycle/teardown-failures.test.ts`, `test/realm/compose.test.ts`, `test/runtime/session-execution.test.ts`, `test/session/checkpoint-quiescence.test.ts`, `test/surfaces/daemon-equivalence.test.ts`, `test/support/realm-daemon-fixture.ts` | Remove the import and the `bridge` entry; delete or rewrite the cases that drive a bridge (F3) |
| `test/core/errors.test.ts` | Two codes out of both lists, `CATALOGUE_SIZE = 29`, retryable lists |
| `test/core/backoff.test.ts` | Rename the `ANDA` schedule fixture (500 and 30000) to a neutral name, keep every assertion, replace the `ANDA-03, RT-04` tags with `RT-04` |
| `test/core/states.test.ts`, `test/core/state-machine.test.ts`, `test/core/status.test.ts`, `test/core/fail-closed.test.ts` | Five states, 9 edges, no `degraded` row or flag |
| `test/doctor/checks.test.ts`, `test/doctor/control-channel.test.ts`, `test/doctor/runtime-checks.test.ts`, `test/daemon/e2e.test.ts` | Remove `anda-bridge` from the pinned id lists and order assertions; delete the whole `ANDA-02` group, `ANDA_OK`, `AndaReply`, `fakeHost` engine and `andaUrl` plumbing and the real-transport trickle test; `RUNTIME_IDS` loses one id |
| `test/runtime/config.test.ts` | `validInput()` loses `andaUrl`; the six `andaUrl` tests become the retired-key tests (D-28-02); add the cases for `describeRuntimeConfigProblems` |
| `test/cli/cli.test.ts` | Config-load failure cases for the retired key; status fixtures lose `degraded` |
| `test/omp/plugin.test.ts` | Replace the 19 `ANDA_*` reason strings with live catalogue codes, delete the `degraded` label and flag cases, keep the label-table pin with two labels |
| `test/tools/dispatch.test.ts`, `test/tools/queue-timeout.test.ts`, `test/tools/workspace.test.ts`, `test/acp/agent.test.ts`, `test/surfaces/equivalence.test.ts`, `test/host/boot-driver.test.ts`, `test/support/fake-tools.ts` | A non-active state used as a fixture changes from `degraded` to `error` (or `connecting` where the case needs a waiting state); per-state tables lose the row |
| `test/session/reap.test.ts`, `test/session/store.test.ts`, `test/contract/session-record.schema.test.ts` | New cases: a stored `degraded` record is refused by the validator, unreadable to the store and removed by the startup reap (E7); the "six states" wording becomes "five states" |
| Status fixtures that carry `degraded: false`: `test/cli/checkpoint-stopped.test.ts`, `test/cli/cli.test.ts` (two), `test/cli/mcp-attach.test.ts`, `test/daemon/client.test.ts` (two), `test/omp/extension.test.ts` (two), `test/support/stdio-world.ts`, `test/integration/production-live-helpers.test.ts` (a printed JSON string), `scripts/check/mcp-smoke.test.mjs` | Remove the key; add one case that a reply with the extra key is still accepted and one that a reply without it is accepted |
| `test/quality/suite-taxonomy.test.ts` | Remove the `anda` category directory, the `anda bridge` category and the four taxonomy lines that name `anda/*.test.ts` and `lifecycle/bridge-states.test.ts` |

**D. Scripts and gate data**

| File | Change |
| --- | --- |
| `scripts/check/export-usage-allowlist.json` | Remove four entries (E9) |
| `scripts/check/module-size-allowlist.json` | Lower or delete the `src/lifecycle/controller.ts` entry (E9) |
| `scripts/check/mcp-smoke.test.mjs` | Fixture edit above |
| `scripts/check/pack-smoke.mjs`, `scripts/check/mcp-smoke.mjs`, `scripts/check/coverage-floors.json`, `scripts/check/gate-closure.mjs`, all of `scripts/release/**`, `scripts/image/**`, `scripts/docs/**`, `scripts/spike/**`, `scripts/mutation/**` | No change (searched) |

**E. Documents**

| File | Change |
| --- | --- |
| `docs/integration/anda.md` | Delete |
| `docs/integration/anda-decision.md` | Replace with a superseded notice (D-28-08) |
| `docs/integration/anda-replacement-research.md` | **Not edited by this phase.** It is the published rationale and a dated evidence note (Phase 27 owns it). It cites files this phase deletes; the notice in `anda-decision.md` says they were read at tag `v0.3.54` |
| `docs/policy-reference.md` | Rewrite the mutation-decision rows (the `degraded` rows and both bridge sentences), the runtime-config row and the `andaUrl` bullet group; add a "Retired keys" paragraph with the migration note |
| `README.md` | Drop "and the Anda engine" from the verification sentence; add one sentence under each of the two captured transcripts that `display` has no `degraded` key from 0.4 on (the captures themselves stay byte for byte) |
| `AGENTS.md` | Line 9 (the layering sentence), the `anda/` layout line, the `docs/` layout line, and the Settled-decision bullet that Phase 27 rewrote: only its "removal is scheduled in Phase 28" wording changes, to the past tense (the decision itself stays Phase 27's) |
| `docs/integration/omp.md` | Status item text (the `[degraded]` sentence), the health-loop sentence ("in `active` and `degraded`"), and the limits sentence "The Anda engine is not in scope" (Phase 27 leaves it to this phase) |
| `docs/integration/acp.md` | The sentence "state is `active` or `degraded`" |
| `docs/integration/openshell.md` | "fourteen items: the eleven above" becomes "thirteen items: the ten above"; the line-482 decision bullet and the dated receipts (lines 264 and 642) get a one-line removal marker |
| `docs/integration/runtime-decision.md` | Delete the `anda.listener_failed` log-record bullet (line 198); rewrite the line-393 sentence and the line-430 sentence ("a state other than active or degraded"); the status line, the S-08 layering line 27, the OQ-P3-09 to OQ-P3-11 rows and the tail section are the decision record Phase 27 owns, so this plan only checks they were marked superseded |
| `docs/integration/hardening-plan.md` | The decision bullet at line 299 gets the removal marker; the table row at line 136 (the IC-TEE reference for item H3, a different project from the bridge) stays unchanged (D-28-08) |
| `docs/integration/host-binaries.md` | The dated receipt at line 57 gets the removal marker |
| `docs/checkpoint.md` | "connecting, active, degraded, error and stopping" loses `degraded` |
| `docs/integration/host-plugin-contract.md` | Readiness text at line 105, if it names `degraded` |
| `docs/specs/realm-spec.xml` | No edit by default (Phase 27's OQ-27-02 default); an owner-directed amendment of the normative lines only if the owner answers yes: see D-28-10 and OQ-28-01 |
| `docs/integration/mcp.md`, `docs/integration/hosts.md`, `docs/integration/podman.md`, `docs/integration/project-session-contract.md`, `docs/integration/host-plugin-gaps.md`, `docs/integration/host-support-matrix.md`, `docs/integration/writing-a-host-plugin.md`, `docs/integration/omp-lifecycle-runbook.md`, `docs/integration/agentos.md`, `docs/integration/workspace-snapshot-spike.md`, every file under `docs/hosts/`, `site/content/index.md` | Searched: no Anda, `andaUrl`, `ANDA_` or `degraded` mention. No change |

### D-28-01. Cut line, order and commit shape

Three plans in three waves, each depending on the one before: 28-01 (bridge, key, codes, doctor), 28-02 (`degraded`), 28-03 (documents, gates, release note). The sketch of the phase put "tests, schemas, scripts, docs" in the second wave; the test and gate-data edits move into the plan whose source change forces them (F1), the schemas need no edit (E5), and the documents are the third wave. Inside 28-01 the order is fixed by import direction so every task builds: first the doctor item (it imports `src/anda`), then the bridge wiring and `src/anda` itself, then the config key (the daemon seams and compose used `andaBridgeRequired` until the bridge wiring is gone), then the codes (the controller used them until the bridge wiring is gone). Each task is one commit with a Conventional Commit subject that carries `!` (D-28-09). No alias, re-export, deprecated stub, compatibility option or "ignored" key is added anywhere.

### D-28-02. `andaUrl` in config.json is refused, with a fixed migration sentence; no new error code

**Decision:** `loadRuntimeConfig` keeps its closed key set and refuses `andaUrl` like any other unknown key, with `SCHEMA_INVALID`. A closed table `RETIRED_KEYS` in `src/runtime/config.ts` maps `andaUrl` to one fixed sentence: "andaUrl was removed in the 0.4 release line, with the Anda bridge: delete it from config.json". A new function `retiredKeyNotes(input)` returns the sentences for the retired keys present in an input (never the value); `describeRuntimeConfigProblems` appends them after its existing generic "has a key that is not accepted" line. `src/cli/main.ts` reads the config input once, and when `loadRuntimeConfig` rejects an input that was read successfully it writes one stderr line per `retiredKeyNotes` sentence under the existing refusal text, for both the doctor path and the other commands. Other bad keys keep their exact current output. No catalogue code is added (the catalogue shrinks, D-28-03), and no warning channel is added to the loader.

**Why refuse rather than ignore with a warning, against how the loader behaves today (E3):**

1. The loader has one behaviour for a key it does not accept: refuse (D-80, "closed key set"). Ignoring a retired key would be the first special case in a function whose point is that its key set is closed, and the next retired key would copy the pattern.
2. "Ignored with a warning" needs somewhere to warn. The loader returns a frozen value, takes no logger and reads no environment; at least seven modules load the same file (E3), and only the doctor and the daemon have a log. Most callers would drop the warning silently. A refusal is uniform across all of them.
3. Fail closed. An operator who set `andaUrl` was relying on the bridge: with it, an unreachable engine made the session `degraded` and `exec` and `write` were refused. Ignoring the key silently turns that guard off. Refusing makes the operator acknowledge the change before the daemon starts.
4. The cost is one config edit and no known operator pays it (research note section 2.2; `realm init` never wrote the key).
5. A refusal is testable with an observable outcome (exit code and message); a warning would test log text.

**What the operator sees.** With `andaUrl` in `config.json`, `realm up`, `realm status`, `realm down`, `realm doctor`, the daemon start and the compute driver start all refuse with `SCHEMA_INVALID` (existing behaviour). New: the CLI prints the migration sentence on the next line. `realm doctor` keeps its leading text and adds the sentence; the leading text still says "config is absent" for any invalid config, which is existing wording that this phase does not touch (recorded as a limitation, not fixed). The daemon's own start failure keeps its one-line "catalogue code only" contract (`src/daemon/main.ts`); the CLI refuses before it ever spawns a daemon.

### D-28-03. The catalogue shrinks to 29 codes; nothing replaces the two

`ANDA_UNREACHABLE` and `ANDA_VERSION_MISMATCH` are removed from `ERROR_CODES` and `ERROR_CATALOGUE`, from the gRPC map and from every test and doc. The catalogue header, `CATALOGUE_SIZE` and the retryable partition in `test/core/errors.test.ts` are updated together. The codes surface to MCP and ACP hosts, so this is a contract change and belongs in the breaking-change note (D-28-09); no emitter outside the bridge ever produced them, so no host receives them unless `andaUrl` was set. The doctor item reported them in its detail text and goes with the item.

### D-28-04. `degraded` is removed completely, including the status field

`STATES` has five values (`unbound`, `connecting`, `active`, `error`, `stopping`); `ALLOWED_TRANSITIONS` has 9 edges (13 minus `active` to `degraded`, `degraded` to `active`, `degraded` to `error`, `degraded` to `stopping`). `DisplayStatus` becomes `{ label, reason, lastTransitionAt }`: the field is removed, not kept as an always-false value, because a constant field is a compatibility shim and because the research note's open question 2 named "the status schema" as part of the removal. `STATUS_LABELS` is unchanged (two labels). Every consumer that listed `degraded` is reduced to `active`. `README.md` captures stay as recorded evidence (E5, D-28-08).

### D-28-05. The doctor loses the item and its transport; the report is one item shorter

`anda-bridge` leaves `CheckId` and `REGISTERED`. `fetchInformation` and `andaUrl` leave `DoctorOptions`. The order of the remaining items is unchanged. The doctor and `realm doctor` JSON output therefore has one entry fewer; consumers that pin the item list (tests, the OpenShell doc) are updated. No replacement check is added: an operator who runs an Anda engine monitors it themselves (research note 7.1).

### D-28-06. The lifecycle controller drops the bridge and the F7 hold with it

`LifecycleDeps.bridge`, the handshake bookkeeping, the two create and hydrate bridge steps and the event listener are removed, along with the `ANDA_VERSION_MISMATCH` retry refusal. `teardownBridgeAndContainer` becomes `teardownContainer` and keeps its other three parts (container stop, pending create reclaim, pending start reclaim) in the same `Promise.all`, so stop still reaches `exec.stop` in the same tick (the Phase 2 idempotency contract). `holdPersistCode`, `releasePersistCode` and the `persistCode` event and log field are removed because nothing can call the hold any more (E6); if the implementer finds any other caller at execution time, the mechanism stays and only the bridge test changes. `recoveredCode` stays.

### D-28-07. Persisted `degraded` records are not migrated

A record with `"state": "degraded"` is left as the validator finds it: invalid. The startup reap treats it as unreadable and removes its record and container (E7), the safe outcome for a session whose daemon died while its auxiliary service was down. No migration code, no fallback state mapping. The behaviour is pinned by three tests (D-28-04 task list) and named in the release note.

### D-28-08. Documents: delete the sourced note, supersede the decision note, mark dated receipts

`docs/integration/anda.md` (sourced facts about a removed surface) is deleted. `docs/integration/anda-decision.md` (which Phase 27 left whole under a superseded banner and a disposition table) is replaced by a notice of at most 25 lines: status superseded on 2026-11-17 by the owner decision, what was removed in the 0.4 line, one retained fact (Anda consumes Realm as an MCP client over stdio through `realm mcp`, nothing in Realm dials Anda), a pointer to `docs/integration/anda-replacement-research.md` as the rationale and to the v4.0 decision section of `docs/integration/runtime-decision.md` for the dispositions, and the statement that the files cited there were read at tag `v0.3.54` (recoverable from git history). The disposition table is not lost: Phase 27 also records every disposition in `docs/integration/runtime-decision.md` and in `27-DISPOSITIONS.md`; the executor of 28-03 confirms that before deleting it from `anda-decision.md`, and keeps the table if it exists nowhere else. Only one of "notice" and "delete" is kept, per the research note ("do not keep both as live guidance"). Documents that describe behaviour (policy reference, Omp including the limits sentence "The Anda engine is not in scope" that Phase 27 leaves to this phase, ACP, OpenShell item count, checkpoint, the `runtime-decision.md` log catalogue and startup-output sentences, and the Phase 27 wording that says removal is scheduled) are rewritten to the new behaviour. Documents that are dated records of what a past build did (the README captures, the receipts at `docs/integration/openshell.md` line 264 and `docs/integration/host-binaries.md` line 57, the decision bullets in `docs/integration/openshell.md` and `docs/integration/hardening-plan.md`) keep their text and gain one short marker sentence: "This record is from a 0.3.x build; the item or field it names no longer exists." Rewriting a receipt would falsify it. The table row in `docs/integration/hardening-plan.md` for "Anda dTEE over Nitro via IC-TEE" names a different repository (IC-TEE, a reference for hardening item H3), not the bridge and not the Anda Engine; Phase 27 left the decision to this phase and the row stays unchanged (it names none of the removed surface).

### D-28-09. The breaking-change note is the commit subjects plus the pull request body; `Removes:` trailers only where they apply

Because the generated notes show subjects only (E10), each of the six source-removal commits has a self-contained subject with `!`. The pull request is merged with a merge commit (AGENTS.md item 5: the commits are individually meaningful), so `ship.mergeMethod` must be set to `merge` for this pull request; if it is squash-merged the single title must carry the whole note. The pull request title is itself a Conventional Commit subject with `!`. The body carries the migration note, the upgrade order (`realm down` on 0.3.x, upgrade, `realm up`), the list of removed names (config key, two codes, state, status field, doctor item, log event) and the risk and rollback section the template asks for. `Removes:` is written only when `git log --no-merges v0.3.54..HEAD` shows a feature or fix commit in this range that added Anda behaviour; today there is none, because every bridge commit is in an earlier release. A trailer that names a commit from an earlier release is allowed (it keeps the removal visible) but is not needed here because the `!` already keeps the six commits. `CHANGELOG.md` and the version fields are never edited by the pull request. The full pull request text and the dry run of the generator are in 28-03 task 3.

The commit subjects, fixed here so that the executors of 28-01 and 28-02 use them at commit time (each is the text that appears in the 0.4.0 notes, under the category of its type):

| Plan and task | Subject |
| --- | --- |
| 28-01 task 1 | `refactor(doctor)!: remove the anda-bridge doctor item` |
| 28-01 task 2 | `refactor(anda)!: remove the Anda bridge and the bridge option of the lifecycle controller, compose and daemon` |
| 28-01 task 3 | `refactor(config)!: refuse the retired andaUrl config key with SCHEMA_INVALID and a migration message` |
| 28-01 task 4 | `refactor(core)!: remove the ANDA_UNREACHABLE and ANDA_VERSION_MISMATCH error codes` |
| 28-02 task 1 | `refactor(core)!: remove the degraded session state` |
| 28-02 task 2 | `refactor(core)!: remove the degraded field from the status reply display` |
| 28-02 task 3 (only if it changes a file) | `chore(gates): refresh the size and export allowlists after the Anda removal` |
| 28-03 task 1 | `docs: remove the Anda bridge and the degraded state from the reference docs and mark the dated records` and `docs(anda): supersede the Anda decision note and delete the Anda source note` |
| 28-03 task 2 | none unless a closure check forces a fix; then `fix(...)` or `test(...)` with the cause in the subject |

### D-28-10. The product spec

`docs/specs/realm-spec.xml` names the bridge in its layering, its stack diagram, its `degraded` state definition, its failure-handling line, its step list and its open questions, and calls the six-state machine a fixed requirement. AGENTS.md allows an owner-directed edit only when the owner asks for it and the pull request records the instruction and the reason; Phase 27 asked the owner (its OQ-27-02) and recorded "no edit" as the default, with the divergence listed in its supersession table. Phase 28 follows that default: no edit. If the owner answers yes, 28-03 task 1 amends only the normative lines (layering, bridge section, `STATE` definitions for `active` and `degraded`, the Anda-unreachable failure line and the open question about Anda), leaves the `ORIGINAL` request and the historical plan blocks untouched, and the pull request body records the instruction (the conditional paragraph in 28-03 task 3). Either way no gate reads the spec except `scripts/check/default-mode.test.mjs`, which checks default-mode wording only.

### D-28-11. Hand-offs from Phase 27 and for the orchestrator

Phase 27's F5 lists what Phase 28 must not miss; each is placed:

| Hand-off | Placed in |
| --- | --- |
| The config message rule: no unknown key name is ever echoed (E-27-22), against the research default "fail with a clear error naming the key" | D-28-02 and F4: the key is named only through a literal from a closed retired-key table, never echoed from input |
| The `degraded` readers (11 `src` files, the test files, the doc files) | 28-02 and 28-03, with the inventory above |
| `docs/integration/hardening-plan.md` line 136 (the IC-TEE row) | D-28-08: the row stays, it names none of the removed surface |
| The "removal is scheduled in Phase 28" wording in `AGENTS.md` and the banner (Phase 27 F4) | 28-03 task 1 rewrites the AGENTS wording in the past tense and replaces the banner with the tombstone |
| The QUAL-01 amended exception list in `.planning/REQUIREMENTS.md` names two silent-catch sites in `src/anda/client.ts` (`deliver`, 2 sites; `stamp`) (E-27-21) | The file is deleted by 28-01, so the exception list loses both. `.planning/REQUIREMENTS.md` is not edited by these plans: the orchestrator must remove exceptions (a) and (b) from QUAL-01 after the merge, and 28-03's summary lists them. `eslint.config.js` has no per-file exception for the file (searched), so no lint config changes |
| `.planning/PROJECT.md` lines 37 and 77 (the Anda boundary rows) and the archived Phase 3 decisions S-12, D-52 (the `andaUrl` clause), D-61, D-62, D-64, D-65, D-66 and D-69 (the `anda-bridge` item) that the removal supersedes (E-27-12) | Planning records, edited only by the orchestrator through GSD commands; 28-03's summary lists them as the post-merge hand-off |
| Requirement status flips: ANDAX-03 and ANDAX-04 complete when 28-03 task 2 passes; ANDAX-05 when the pull request is merged and the 0.4.0 notes show the six subjects | 28-03 summary |

### Threat model

Phase 28 removes code. Its risks are regressions in what remains, not new surface.

| # | Boundary and threat (STRIDE) | Mitigation in this phase | Residual |
| --- | --- | --- | --- |
| T-28-01 | **Elevation, fail-open regression.** The bridge going down used to refuse `exec` and `write`; a careless removal could widen what an `active` session allows or narrow what a non-active one refuses | `decideMutation`, `denyCodeFor`, the exec refusal switch and the plugin switch keep every other state's refusal; the per-state tables in `test/core/fail-closed.test.ts`, `test/tools/dispatch.test.ts` and `test/lifecycle/mutation-gate.test.ts` are kept with the `degraded` row removed, and `unbound`, `connecting`, `stopping` and `error` still refuse in `fail-closed` mode | None known. `active` allowed both operations before and after |
| T-28-02 | **Tampering by silent config change.** A stale `andaUrl` ignored without notice | Refused with `SCHEMA_INVALID` and the fixed sentence (D-28-02); the compute driver and the daemon refuse the same file | An operator who edits the key out of the config loses nothing |
| T-28-03 | **Information disclosure through the new message.** A message built from input | The sentence is a literal chosen by a closed key table; the value and any other unknown key are never printed; a test asserts the output for a hostile value (a string that looks like a secret) contains neither the value nor the key name beyond the fixed sentence | The word `andaUrl` itself appears in the sentence, by design |
| T-28-04 | **Denial or orphan on upgrade.** A 0.3.x `degraded` record read by 0.4 | E7: the record validates as invalid, the store throws `SCHEMA_INVALID`, the startup reap deletes the record and removes the container; three tests pin each step | One reaped container per daemon that died while `degraded`. Operators who run `realm down` first lose nothing |
| T-28-05 | **Repudiation or contract break for hosts.** A host that parses `display.degraded` or switches on the removed codes | Breaking-change commit subjects and pull request body list both (D-28-09); `scripts/check/mcp-smoke.mjs` still checks MCP and CLI status equality | A third-party host that required `display.degraded` as a boolean breaks. No such host is recorded in `docs/integration/hosts.md` or the support matrix; [INFERENCE] none exists |
| T-28-06 | **Dead code and stale allowlist entries** hide a mistake | The export-usage and module-size gates fail on orphaned exports, stale allowlist entries and a stale ceiling; `noUnusedLocals` fails on unused imports; the closure search in 28-03 | None |
| T-28-07 | **Mixed versions.** A 0.3 daemon that outlives the upgrade serving a 0.4 client, or the reverse | F5; the release note orders `realm down` before the upgrade | Not tested; [INFERENCE] bounded by one package shipping all three parts |
| T-28-08 | **Log consumers.** Older `requests.log` lines carry `anda.listener_failed` and `lifecycle.transition` events naming `degraded` | The documented record list drops the event; no tool in the repository parses old logs for it | Old log files keep their old lines; the release note says so |

### Verification posture

- Every task names its own build and test command and an observable outcome; no task asserts on module text (AGENTS.md: no source-text tests). The final closure search in 28-03 is a one-time acceptance command, not a committed test.
- Nothing here needs Podman, OpenShell or a live engine. The gated live suites (`npm run test:integration`) are unaffected; the doctor item they exercised is gone, and a run on the production stack is Phase 31's rehearsal.
- What is **not** verified by these plans: behaviour of a 0.3.x daemon against a 0.4 client (T-28-07), and any third-party host's reading of the status reply (T-28-05).
</decisions>

<canonical_refs>
## Canonical References

- `docs/integration/anda-replacement-research.md` sections 2, 7.1, 7.3, 9 (the rationale, the minimal change list and the open questions the owner answered).
- `.planning/ROADMAP.md` Phase 28 block; `.planning/REQUIREMENTS.md` ANDAX-03 to ANDAX-05.
- `AGENTS.md`: "Versioning and release" (release owns `CHANGELOG.md`; `Removes:` trailer rule), "Merge and release flow" item 5 (merge method decides the notes), "Conventions" (no source-text tests, module-size ratchet, no host-local paths), "Documentation and site" (spec edits).
- `scripts/release/changelog.mjs` (subjects only, `!` keeps a commit, `Removes:` semantics).
- `scripts/check/export-usage-gate.mjs`, `scripts/check/module-size.mjs`, `scripts/check/gate-closure.mjs`, `scripts/check/coverage.mjs`.
- `.planning/milestones/v3.0-phases/25-host-adapters-wave-2-remaining-gsd-core-runtimes/` (style model).
</canonical_refs>

<code_context>
## Code Context

- `createRealm` in `src/realm/compose.ts` validates `runtimeInput` with `loadRuntimeConfig` and then, only when `andaBridgeRequired(config)` holds, insists on an injected bridge. `startDaemon` in `src/daemon/daemon.ts` builds the production seams through `src/daemon/seams.ts` (`defaultBridge`, `defaultExec`, the doctor options).
- `LifecycleController` (`src/lifecycle/controller.ts`, 1208 lines) owns the `StateMachine` from `src/core/state-machine.ts`; `writeState` and `persist` write the session record on each transition; `probe` and `isInService` gate the health outcome; `teardownBridgeAndContainer` is shared by `stop` and `destroy`.
- `SessionHealth` in `src/daemon/sessions.ts` starts a 10 second probe timer when a lifecycle event enters `active` or `degraded` and stops it otherwise.
- `displayStatus` in `src/core/status.ts` is the single mapping from state to label; `STATUS_LABELS` is imported by the CLI, the Omp plugin and the tests.
- The doctor registry in `src/doctor/checks.ts` is an ordered array of check functions (`REGISTERED`); order is a documented, costly contract (header comment) and tests pin it.
- Tests build on `test/support/*`: `fake-bridge.ts` (to be deleted), `fake-tools.ts` (a per-state table), `stdio-world.ts` and `realm-daemon-fixture.ts` (status and daemon fixtures).
</code_context>

<specifics>
## Wave Structure

| Wave | Plan | Requirements | Depends on |
| --- | --- | --- | --- |
| 1 | 28-01 Remove the bridge, the `andaUrl` key, the two codes and the `anda-bridge` doctor item | ANDAX-03 | Phase 27 landed |
| 2 | 28-02 Remove the `degraded` state and the `display.degraded` field | ANDAX-03, ANDAX-04 (state machine, status labels, schemas) | 28-01 |
| 3 | 28-03 Documents, gate data, closure checks and the breaking-change release note | ANDAX-04 (policy reference, README, integration docs), ANDAX-05 | 28-01, 28-02 |

28-01 owns `src/anda/**`, `src/core/ports.ts`, `src/core/errors.ts`, `src/core/state-machine.ts` (hold removal), `src/core/events.ts`, `src/lifecycle/controller.ts` (bridge parts), `src/realm/compose.ts`, `src/daemon/seams.ts`, `src/daemon/daemon.ts`, `src/runtime/config.ts`, `src/runtime/driver/grpc-status.ts`, `src/doctor/checks.ts`, `src/cli/main.ts` (config failure text) and the tests that follow from them. 28-02 owns `src/core/states.ts`, `src/core/status.ts`, `src/core/policy.ts`, `src/tools/dispatch.ts`, `src/lifecycle/session-state.ts`, the `degraded` parts of `src/lifecycle/controller.ts`, `src/daemon/sessions.ts`, `src/daemon/client.ts`, `src/cli/main.ts` (`upResult`), `src/cli/stdio-host.ts`, `src/omp/plugin.ts` and their tests. Both touch `src/lifecycle/controller.ts` and `src/cli/main.ts` in different functions; the waves are sequential so there is no overlap. 28-03 owns every document, the two allowlist files, the closure checks and the release text.

## Requirement IDs

| ID | Statement (as registered) | Closed by |
| --- | --- | --- |
| ANDAX-03 | The Anda bridge code, the `andaUrl` config key, `ANDA_UNREACHABLE`, `ANDA_VERSION_MISMATCH`, the degraded state, the Anda doctor check and the Anda tests are removed with no shim | 28-01, 28-02 |
| ANDAX-04 | The state machine, status labels, schemas, policy reference, README and integration docs no longer mention the removed surface, and the check:docs and check:gates gates pass | 28-02 (state machine, status), 28-03 (documents, gates) |
| ANDAX-05 | The removal is a documented breaking change: release note text, config migration note (an unknown `andaUrl` key is refused with a clear message or ignored with a warning, as decided in the phase context) | 28-01 (the refusal and message), 28-03 (the notes) |

## Open questions for the owner or the orchestrator

- **OQ-28-01.** Is an amendment of the normative lines of `docs/specs/realm-spec.xml` wanted (D-28-10)? Default, following Phase 27's OQ-27-02 default: no edit. If the owner answers yes, 28-03 task 1 amends the normative lines and the pull request body records the owner's instruction. The answer changes one task step and one paragraph of the pull request body; no code.
- **OQ-28-02.** Merge method for this pull request. The plan needs `ship.mergeMethod` set to `merge` (D-28-09). If the owner prefers squash, the pull request title is the single changelog entry and must carry the whole breaking note in one line; the six subjects in 28-03 are then folded into the body.
- **OQ-28-03.** [INFERENCE] Phase 27 lands first. 28-03 re-reads at execution time the `AGENTS.md` Settled-decision bullet, the status line, the S-08 bullet and the OQ-P3 rows of `docs/integration/runtime-decision.md`, and the banner of `docs/integration/anda-decision.md`, and edits only what D-28-09 and D-28-11 assign to Phase 28 (the tense of the "scheduled" wording and the tombstone). If Phase 27 has not landed, this phase is blocked on its decision record, not on code.
- **OQ-28-04.** [INFERENCE] The `src/lifecycle/controller.ts` size after the cut. The plan says "near 1060"; the executor measures and sets the allowlist ceiling to the measured line count, or deletes the entry at 1000 or fewer.

## Commit and pull request shape

Six source-removal commits (28-01: four, 28-02: two), one documents commit, one test-and-closure commit; subjects in 28-03 task 3. Tests ride in the commit of the source they cover.
</specifics>

<deferred>
## Deferred Ideas

- A permanent documentation lint that fails when a removed name reappears in published docs (a new `scripts/check` script). The closure search in 28-03 is run once; a permanent check is a new gate and is not required by ANDAX-04.
- Rewording `realm doctor`'s "config is absent" text so it distinguishes an absent config from an invalid one (E3). Existing behaviour, out of scope.
- A forward-compatible "retired keys" registry beyond `andaUrl`. The table has one entry; a second retired key adds a row.
- Updating the `SECURITY.md` supported-line sentence and the AGENTS.md "current milestone" line to 0.4.x (milestone bookkeeping).
- A skew test between a 0.3 daemon and a 0.4 client (T-28-07).
</deferred>
