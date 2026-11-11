# Phase 12 verification: scripted-provider harness and Omp enforcement spike

Status: **PARTIAL / current-source verification UNVERIFIED** (2026-10-31). This records retained execution and current source separately. It is not a new test run, signed verdict, phase completion or all-milestone clearance. HARN-02, HARN-04 and OMP-05 remain in progress/reopened until current answered C1–C4 AND HARN-03 pass.

Task `Trealm31-phase12-artifacts`; correlation `realm-phase12-records-oct31`; A15 attempt 2. Original graph/correlation `ut-mvvowl70-29165019`, accepted 27 tasks/52 criteria and D1–D6 unchanged. No DONE task or historical result/hash was rewritten. The previous no-edit attempt remains history; this attempt actually writes the five scoped documentation artifacts.

## Evidence authority and source identity

The current owner answer overrides contradictory older packet/scout interpretations, not their recorded bytes: **advisory_write = WARN AND ALLOW**. A reachable inactive advisory registered write must emit the existing notice every time and perform the actual host write. Unreachable registered write refuses/no file; reachable inactive fail-closed refuses/no file. Current source tests and runtime proof must distinguish these states.

Repository source read: `<src-root>/repos/agent-realm-lanes/recovery-oct31`, package version `0.3.26` from `package.json`. Retained Omp observations below are version `18.12.6`. Main privately integrated PR40 at historical `d25c8c1ce4da96d05b49b6bb1185bc80bd3e2843` per current binding authority; that is not a source identifier for this uncommitted joined wave. No new commit/build digest, current check exit or cryptographic verification is invented here.

Absolute input directory E0:

`<omp-home>/agent/sessions/-src-repos-agent-realm/2026-10-21T23-22-33-866Z_01a160c6-0a0a-7319-a4ef-5d9c4e2438e7/local/`

| Ref | Actual input / record | Use and limit |
| --- | --- | --- |
| E1 | E0 `realm-recovery-brief-oct31.md`; `realm-evidence-oct31.json` | Original brief and five scouts (9+9+11+19+4 rows). Scout assertions are candidates/source observations, not current execution or permission to waive HARN-02. |
| E2 | E0 `realm-parent-verification-packet-oct31.json` | `firstWaveVerification`, `lastJoinedAttempt`, `currentHarnProof`, `actualProductionOmp`, `cpuQuotaProof`, `formalFirstWaveQuality` keep distinct runs. Earlier advisory-refusal interpretation and old PR40 permission are not current authority. |
| E3 | E0 `realm-full-continuation-verified-runtime-oct31.md` | Original flat autonomous continuation, accepted DAG and parent postjoin ownership; superseded state/approval details are not silently reused. |
| E4 | `<omp-home>/agent/sessions/-src-repos-agent-realm/2026-10-21T23-22-33-866Z_01a160c6-0a0a-7319-a4ef-5d9c4e2438e7/8785.bash.log` | Lines 3–13: old C1–C4 passes; 19–40: 11 independent non-network spike passes; full run 15 pass/6 fail, NOT all-green. Network failures remain in the same log. |
| E5 | `<evidence-dir>/harn31-02hxpj5r/c4.frames.jsonl`, `c4.requests.json` | Genuine native C4 notice, CREATE result, `newText`, matching provider tool message and `done`; pre-answer evidence. |
| E6 | `<evidence-dir>/harn31-approved-0g2wtnam` | Approved bounded corrected trace evidence; built-Realm versus S11, cold versus warm/proxy labels remain separate. Earlier build, not current answered-source verification. |
| E7 | E0 `harn03-missing-podman-proof-oct31.json` | Actual isolated-PATH result: exit 0, 0 pass/0 fail/1 named skip. Not a network pass. |
| E8 | `<evidence-dir>/omp-production-driver-rootless-ns-oct31.json` | Actual real production registered write/host/sandbox/audit observation; scripted NOT LLM-driven and NOT strace HARN-03. |
| E9 | `<evidence-dir>/recovery-controller-oct31/2026-10-31T01-24-17-595Z_01a18f8e-b83b-745d-9b26-7e9630cb2ea4/RealmRecoveryWaveOne/RealmRecoveryWaveOne.RealmWaveOneQa.json` | Actual A08 gate execution/receipt. Later canonical DONE/exact-three-row settlement comes from current binding authority; this writer did not issue or cryptographically reverify it. |
| E10 | `<evidence-dir>/qr05-cpu-quota-2870c80bf0.json` (E2 `cpuQuotaProof`) | Separate loaded CPU-quota suite; matching totals do not make it E9. |

The original unissued-tag failure, historical warm 44 offenders/cold skip 49, failed intermediate run, same-task attempt2/rework2 approved correction, extra-attempt approval and old no-implementation results are preserved. None was rerun here merely to confirm it.

## Criterion matrix

Implementation labels: IMPLEMENTED means source exists at the cited symbol, not that it passes. PARTIAL means an actual requirement dependency remains. STUB_OR_MISSING is reserved for absent implementation, not a missing execution. UNVERIFIABLE means required evidence is unavailable. All **current-source execution** in this attempt is UNVERIFIED; only Main's actual command plus exit/evidence can change that.

| Criterion | Current source / authored behavior | Retained versioned execution | Current disposition and prospective proof |
| --- | --- | --- | --- |
| HARN-01: isolated local scripted-provider Omp RPC against built extension, no real credentials/tokens | IMPLEMENTED: `createOmpProfile` in `test/support/omp-profile.ts`; `ScriptedProvider`; `startOmp` in `test/support/omp-rpc.ts`; `runGuard`/`tracedRealmWrite` in `test/integration/omp-guard.test.ts`. Profile supplies private HOME/config/agent, caller-supplied PATH, child-private TMPDIR, local dummy provider key. | E6 warm requests offer/issue registered `write`, matching successful result and `done`; version 18.12.6, built Recovery extension. E4 records actual real Omp starts, not mocked Omp. | IMPLEMENTED; current-source UNVERIFIED. Main builds then runs helpers and full live guard cases; retain ready/start/end, provider requests, version and current source identity. |
| HARN-02 C1: reachable inactive advisory warns on every registered invocation and creates exact host bytes | PARTIAL at live-harness level. `registerRealmPlugin` → `callDaemon` now forwards each successful write's non-null `outcome.value.warning` to current `ctx.ui.notify`. Existing `ToolDispatcher.call` → `writeWorkspaceFile` → `lockedWrite` supplies the actual write, not a no-op/local fallback. `makeRegisteredWorkspace` plus authored C1 test uses real dispatcher/fs/lock/audit. | E4's old C1 passed an unreachable-daemon refusal/no-notice assertion. It does NOT satisfy the answered criterion. Historical native 3-case closure likewise is not registered C1. | PARTIAL, in progress/reopened. Main must execute authored real-dispatcher tests AND a correctly aligned real Omp reachable-inactive C1, repeated notices, exact UTF-8 bytes, result/details/provider continuation and failure propagation. Current live C1 still calls `daemon.down()`; alignment is outside the five records/four Omp paths. |
| HARN-02 C2: inactive fail-closed refuses `REALM_NOT_ACTIVE`, no host file, provider sees error | Registered behavioral case authored in `test/omp/plugin.test.ts`, degraded state, real dispatcher. Live `runGuard` C2 currently removes daemon/socket. | E4 old C2 refusal/no file/provider error on Omp 18.12.6. | PARTIAL current verification. Main must retain reachable-inactive fail-closed proof separately from unreachable refusal; no status/error weakening. |
| HARN-02 negative: unreachable daemon refuses registered write/no host file in either mode | `callDaemon` requires a live client; `realmToolDefinitions`/`definitionOf` maps call failures as refusal. Authored tests reject transport in both policy modes and assert no bytes/no cached-mode fallback. | E4 old C1/C2 are useful historical unreachable controls, not a positive advisory-write result. | IMPLEMENTED source; UNVERIFIED current. Main executes both policy cases and records absence plus error to the actual registered caller. |
| HARN-02 C3: active registered write succeeds | Existing registered tool → shared dispatcher; live `runGuard` C3 checks exact fake-backed workspace bytes. | E4 C3 pass/offered tool list; E6 warm registered-write bytes/details/provider proof. E8 provides separate real production observation. | IMPLEMENTED source; UNVERIFIED current. Main's current C3 must record offered registered name, matching successful result, exact bytes and provider continuation. |
| Native C4 host-create control | `callOf` emits supported patch CREATE; only native-edit child gets `PI_EDIT_VARIANT=patch`. No native snapshot tag or Realm digest conversion. Assertions in `omp-guard.test.ts` require notice, success, exact bytes and carried result. | E4 lines 10–13 and E5 frames 17–23/requests: notice; `isError=false`; `newText="c4\n"`; `[c4-created.txt]\n1:c4` carried to next tool-role request. Omp 18.12.6. | IMPLEMENTED with genuine historical pass, no longer “authored but not run.” Current-source rerun remains required, not inferred from E5. Distinct from optional production C4 in original research. |
| HARN-03: one versioned warm built-extension registered-write command; only stub + three discovery peers, zero external/DNS/offenders; named prerequisite/cold skips | IMPLEMENTED: `tracedRealmWrite` binds per-run issue/continuation phases, matching RPC IDs/details, file bytes, final stop and no errors; `defaultAllow`/parser/classifier in `test/support/net-trace.ts`; `createOmpProfile({refuseExternalNetwork:true})` sends proxies to provider port itself. Trace gate checks Podman executable after normal prerequisites. | E6 warm: 0/0/0, only 42461/11434/8080/1234, completed tool exchange/cleanup. Cold explicitly skipped. E7 missing Podman: 0 passes/1 skip. E2 actual scoped run: 6 tests/4 pass/0 fail/2 honest cold skips (includes separate S11). | IMPLEMENTED measurement, UNVERIFIED current source. Main reruns after all owners join; unchanged strict allowlist, same-turn bytes/RPC/provider plus trace, no acceptance relaxation. No pass from summary counts alone, cold zero counts, source proxy configuration or S11. |
| HARN-04 / OMP-05: record completion only on passing current harness and label scripted NOT LLM-driven | PARTIAL: owned plan/context/guide now restore criterion and retain history. Global REQUIREMENTS/ROADMAP/STATE are explicitly unowned; their old checked/supersession rows remain a separate allocation gap. | Historical 2026-10-30 native closure, E4 old registered-refusal/native control, E6 earlier warm and E9 first quality remain valid for their own scope only. | In progress/reopened. Current C1–C4 AND HARN-03 must pass, then sole authorized global A15 reconciles with actual evidence. No `phase.complete` or global promotion here. |
| OMPX-01: versioned spike answers registration/removal/fallback; close/restate OQ-P5-01/02 honestly | IMPLEMENTED: `test/support/omp-spike-extension.ts`, permanent `test/integration/omp-spike.test.ts`, S1–S14 table/Q4/OQ answers in `docs/integration/omp.md`. | Historical two 12/12 runs on 2026-10-29; E4 11 independent non-network recovery cases passed, Omp18.12.6. E6 S11 evidence separate. | IMPLEMENTED/version-scoped historical execution. Current-source suite still unverified. OQ-P5-01 closed for 18.12.6; OQ-P5-02 narrowly restated, not universal host containment or Phase16 clearance. |

## Exact advisory interface and authored tests

`src/omp/plugin.ts: registerRealmPlugin/callDaemon` captures the current session/client, awaits `client.call`, and notifies only if that same session/client is still current and the returned outcome is `done/write` with non-null warning. The returned outcome is unchanged. Shared `decideMutation` supplies `realm is <state>; the write proceeds under advisory policy` for reachable inactive advisory writes. Native C4 after unreachable status has the distinct historical `realm status unavailable (REALM_NOT_ACTIVE); ...` notice. No second writer or cached-mode disconnected fallback is added.

Source tests, authored by the Omp owner and **NOT EXECUTED here** (`test/omp/plugin.test.ts`, `makeRegisteredWorkspace`):

| Test name | Real behavior asserted / seam |
| --- | --- |
| `HARN-02 C1: registered advisory write warns on every inactive invocation and writes exact host bytes` | Registered execute, two Unicode writes, exact filesystem bytes, one visible warning per invocation, registered readback and two admission/result audit pairs. Real dispatcher/fs, transport/lifecycle double only. |
| `HARN-02 C2: registered inactive fail-closed write refuses REALM_NOT_ACTIVE without a host file` | Reachable degraded controller with actual fail-closed mutation gate, refusal and absent path/no notice. |
| `HARN-02: registered advisory write refuses an unreachable daemon without host fallback` and fail-closed counterpart | Client rejects; registered execution returns REALM_NOT_ACTIVE, absent file, no notification; prior advisory state cannot authorize fallback. |
| `HARN-02 C1: registered advisory writes propagate validation, path and conditional-write failures` | Schema-invalid content/traversal, symlink PATH_ESCAPE, conditional LOCK_CONFLICT; failures preserve existing bytes/no invalid or escaped file. |

These tests do not mock the changed module or grep source strings; they also do not substitute for real Omp live evidence. No behavioral tests were authored by A15 outside its five documentation paths.

## Retained warm/cold/proxy and production evidence

E6 `built-realm-warm.summary.json` records version `18.12.6`, actual built extension, `scriptPhase=done`, `turnProven=true`, `processClosed=true`, allowlist `[42461,11434,8080,1234]`, `offenders=[]`, `external=0`, `dns=0`. The companion requests/frames bind offered/issued `write` to the exact successful result: 39 UTF-8 bytes, SHA-256 `075d35c7cd91e5ffa0c45f790d2924956038d8b5f948df6feeef18f849d6a838`, then `done`. Source assertions check actual workspace bytes and RPC details, not text-only hello. A summary says “measured; assertions determine result”; it is not itself a formal verdict. Actual execution scope is E2 `currentHarnProof`.

`built-realm-cold.summary.json` remains `status=skipped` with the reason “cold built-Realm warm-up; startup catalog refresh is outside the measured warm network claim,” despite completed exchange and zero observed offenders. E7's Podman-missing skip is separate. Omp opt-in/platform/binary/version/built-extension/trace prerequisites are evaluated before that extra Podman executable check; the fake-backed test does not start Podman.

S11 `s11-{cold,warm,proxy}` uses the spike extension's registered `status` and separate proxy allowance. Preserve its per-run `.script-state.json`/`.log.jsonl`/`.proxy-requests.json`; they do not widen the stricter built-Realm allowlist. Historical unproxied warm 38 external + 6 DNS = 44 offenders, cold skipped 49, same-run 0 external/0 DNS/7 refused CONNECT proxy lever, and failed intermediate cold/warm attempts all remain history. Cache warmth is not a reliable isolation control and no scope amendment is approved.

E8's `realOmpScenario.returncode=0` records UID5002, actual production daemon, offered/issued/successful registered write, provider continuation, exact **21 bytes** in host root and sandbox `/workspace`, SHA-256 `cf99298da1f40b967fcc5fa77605f4e77e3b60be3ea034057e8bf6cea2f6d0e3`, admission/result correlation `20756919-94ff-4d8f-a577-7e9cf2389b8f`. Cleanup records original service restored and zero remaining containers. `productionScenarios.executed=false` explicitly avoids rerunning previously verified live5/6. This is scripted NOT LLM-driven and not strace HARN-03. Permanent production Omp coverage remains downstream; no OMPX-05 or Phase16 completion is inferred.

## Distinct execution ledger and quality authority

| Run | Actual result from retained record | Boundary |
| --- | --- | --- |
| Baseline E2 `baseline` | 2347 tests, 2317 pass, 0 fail, 30 skip; 282 scripts | Baseline only; MCP catalogue/disconnected refusal, not sandbox proof. |
| First wave E2 `firstWaveVerification` | 2380 tests, 2351 pass, 0 fail, 29 skip; 282 scripts; native C4 1 pass/0 skip; nonroot doctor 31 pass/0 skip | Not the later full union or answered advisory proof. |
| Host union E2 `lastJoinedAttempt`, original `8791.bash-original.log`/`8792.async.log` as retained by E9 | 2388 tests, 2358 pass, 0 fail, 30 skip; 282 scripts; chained docs/gates/build/pack/MCP reported pass | Before final trace-body delta; later separate checks are not a retroactive rerun of this union. |
| Intermediate live E4 | 21 tests, 15 pass, 6 fail, 0 skip; C1–C4 plus 11 non-network passed | Network failure remains failed; do not sum passing subcases into whole-suite green. |
| Approved scoped trace E2 `currentHarnProof`, E6 | 6 tests, 4 pass, 0 fail, 2 honest cold skips | Earlier source semantics; only measured warm cases positive. Missing-Podman 1 skip is E7, not added to this run. |
| Independent CPU quota E2 `cpuQuotaProof` / E10 | 2388 tests, 2359 pass, 0 fail, 29 skip, 0 cancelled; UID1001, Node24.22.1, cpu.max 50000/100000, two competing CPU workers, throttling 1→1902 | Not formal A08 quality even though totals match. Earlier OpenSSL-absent 67 TLS failures stay historical. |
| Formal first quality E9 | `npm test`, exit 0, 2388 tests, 2359 pass, 0 fail, 29 skip, once; A08 attempt1/RW0 | Event `404adf8fffef4a2ea4e61c5fdef4692a`, 2026-10-31T10:26:12Z. Unit/integration pass; e2e/perf not selected. No new live smoke from its gated skips. |

Current binding authority confirms canonical ingest settled `Trealm31-wave1-quality` DONE and exactly these three signed quality PASS target rows: `Trealm31-c4-native-create`, `Trealm31-init-private-roots`, `Trealm31-doctor-fix-cli`. Producers remain IN_REVIEW/review OPEN. E9 retains the actual gate event and signature-presence metadata, not a signature invented here. The worker's earlier row-binding caveat and outer-low versus effective-medium metadata discrepancy remain in E9; the later canonical settlement does not rewrite that receipt. No current-source signed gate is claimed.

AF-DOC-1/QF-101 is supplementary and absent from the original signed gate findings. Its stale C4-not-run and unproxied guard descriptions are corrected in the owned guide. No backfilled findings/signature or fabricated scan result is issued. Full skip identities are not reconstructed from E9's bounded tail; historical skip names stay with their own runs.

## Commands and evidence recipes for Main only

**Not executed by this worker.** Main must wait for all owners, align the out-of-scope live C1/C2 fixture through authorized ownership, build current source, then retain command/exit/source identity/raw files. Reuse the established isolated/rootless live wrapper and lock; do not start services or publish as a side effect of these docs. Exact historical wrapper is E0 `realm-isolated-harn-command-oct31.txt`, including `realm-live-lock`, `runuser`, `env -i`, `podman unshare`, read-only-root `bwrap`, private HOME/TMPDIR, credential-directory mask and owned evidence bind. That command targets E5's directory and the old source; do not overwrite its evidence when constructing a new run.

Prospective current repository checks (existing package scripts):

```sh
npm run typecheck
npm run lint
npm test
npm run test:scripts
npm run check:docs
npm run check:gates
npm run build
npm run check:pack
npm run check:mcp
```

After current build, source-specific compiled consumers for Main:

```sh
node --test dist/test/omp/plugin.test.js dist/test/omp/tools.test.js
node --test dist/test/integration/omp-live-helpers.test.js dist/test/integration/net-trace.test.js
```

Live command body inside the established isolated wrapper, with a new owned evidence directory prepared by Main (not the historical E5/E6 directory):

```sh
REALM_LIVE_OMP=1 REALM_OMP_NET_TRACE=1 REALM_OMP_EVIDENCE_DIR=<new-owned-evidence-directory> node --test --test-concurrency=1 dist/test/integration/omp-guard.test.js dist/test/integration/omp-spike.test.js
```

`REALM_OMP_BIN` can name the existing executable; record its actual version. Missing opt-in/platform/Omp/version/build/strace/Podman prerequisite must remain an explicitly named skip, not a substitute for current positive evidence. No requested acceptance is satisfied by running only a narrower source-string/count check. For C1, retain repeat-call notice count, exact host bytes, dispatcher result/details and provider continuation; for unreachable/fail-closed retain actual absence/error. For HARN-03 require the matching current warm turn and strict unchanged allowlist; keep cold/network failures distinct.

## Remaining ownership and completion blockers

- Current-source postjoin execution and current answered C1–C4/HARN-03 are UNVERIFIED. Authored tests and retained earlier passes cannot close that gap.
- `test/integration/omp-guard.test.ts` live C1/C2 fixture alignment is outside A15's five paths and A05's four signed paths. No worker expands its scope; A01 routes the actual dependency without inventing an amended DAG/task.
- Separate global allocation is unavailable here: REQUIREMENTS/ROADMAP/STATE are untouched. REQUIREMENTS' historical checked HARN-02/HARN-04/OMP-05 and obsolete recovery interpretation need sole separately authorized A15 reconciliation, preserving original receipts and reflecting reopened status. No `phase.complete`, acceptance rewrite, raw DAG write or new tracking/reconciliation vehicle.
- Lifecycle runbook stale network text is outside ownership. OMPX-02..05/permanent production case and remaining 52-row milestone work are not closed. Individual CRASH-02..07, OBS-03..04, ONB-07, DEF-01..02 coverage and explicit logged `recordsDeleted` proof remain separately accepted/unverified until actual implementation and parent recipes exist.
- No merge/release/publication/workflow dispatch/backport is authorized without new written parent approval. No global planning, signing/key/guard, legal/spec/changelog/version or main/sibling mutation.

## Worker execution statement

Five scoped Markdown paths actually changed; both new-file parents and existing owned paths resolved inside the expected Recovery realpath before writes. No tests/build/typecheck/lint/formatter/gates/smokes, no indirect check script or `docs_bundle` twin, no live/service action, no commit/Git mutation, no signature/key access, no global/task-state update and no phase/milestone completion command was performed. Documentation scanners/link/readability/coverage checks are **not run under the edit-only assignment**, not falsely marked pass. Main owns the sole joined verification.
