---
phase: 07-policy-reference-and-security-review
verified: 2026-10-22T00:00:00Z
status: human_needed
score: 9/9 must-haves verified
reverified: 2026-11-17
reverify_open: 3
---

# Phase 7: Policy Reference and Security Review — Verification Report

**Phase Goal:** Every policy key is documented and the security and supply-chain reviews are recorded before the first release.
**Verified:** 2026-10-22
**Status:** human_needed (all unit-verifiable items met; live-behavior items need a Podman 5.x / OpenShell / Omp / MCP / ACP check)

## Goal Achievement

### Observable Truths

| # | Truth (Roadmap SC) | Status | Evidence |
|---|--------------------|--------|----------|
| 1 | Policy reference documents `mode` with default and effect | ✓ VERIFIED | `docs/policy-reference.md` mode section: type `advisory \| fail-closed`, default `advisory` matches schema (`policy.schema.json:8-12`); advisory/fail-closed effect matches `decideMutation`/`denyCodeFor` in `src/core/policy.ts:130-153` (doc cites `:129-140`, a one-line offset — statement unchanged) |
| 2 | Policy reference documents `workspaceRoots` with default and effect | ✓ VERIFIED | Doc: `string[]`, default `[]` matches schema (`:13-17`); absolute-path rule matches `assertAbsoluteRoots` (`policy.ts:77-83`); outside-roots rule matches `assertPolicyOutsideRoots` (`policy.ts:85-117`); bind/contain effect matches `bindWorkspace` (`controller.ts:376-383`) + `bindRoot`/`isInsideRoot` (`fs/root.ts:18-42`) + `canonicalize` `PATH_ESCAPE` (`fs/canonicalize.ts:140-148`) |
| 3 | Policy reference documents `credentialAllow` with default and effect | ✓ VERIFIED | Doc: `string[]` globs, default `[]` matches schema (`:18-22`); frozen-list effect matches `CREDENTIAL_PATTERNS` + `assertCredentialAccess` → `CREDENTIAL_PATH_DENIED` (`fs/credentials.ts:13-50`); `relPathOf` canonical-relative matching (`:55-57`); threading matches `dispatch.ts:100-106` → `workspace.ts` → `fs/{read,list,write}.ts` |
| 4 | Policy reference documents `egressAllow` with default and effect | ✓ VERIFIED | Doc: `{host, port}[]`, default `[]` deny-all matches schema (`:23-27`, `:43-53`); validation refusals match `validateEgressAllow` → `SCHEMA_INVALID` (`runtime/egress.ts:40-45,86-135`); rendering matches `renderNetworkPolicies` sorted `egress_<n>`, empty → `{}` (`:50-70,125-131`); wiring matches `daemon.ts:497-508` → `openshell.ts:231-276` |
| 5 | Policy reference documents `shellEnabled` with default and effect | ✓ VERIFIED | Doc: `boolean`, default `false` matches schema (`:28-31`); gate matches `checkExecPolicy` → `SHELL_NOT_ALLOWED` (`policy.ts:155-167`), called before state/admission/runner (`dispatch.ts:163-165`); shell form `["/bin/sh","-c",script]` (`dispatch.ts:165`) |
| 6 | Policy reference documents `startupBudgetMs` and `toolQueueMs` with defaults and effects | ✓ VERIFIED | `startupBudgetMs`: integer ≥1, default `10000` matches schema (`:32-36`); deadline-before-bind + races + `STARTUP_BUDGET_EXCEEDED` match `controller.ts:127-139,153-156,180-226,263-282,385-391`; plugin timer matches `omp/plugin.ts:186-188,205-230`. `toolQueueMs`: integer ≥1, default `2000` matches schema (`:37-41`); wait-only-in-`connecting` matches `dispatch.ts:150-175,186-192`; `waitLeavingConnecting` timer+unsubscribe matches `dispatch.ts:275-291`. Non-key constants correctly excluded (`dispatch.ts:56-57`, `controller.ts:38`, `session-execution.ts:36-44`, `runtime/config.ts:1-67`) |
| 7 | A security review is recorded in the repo | ✓ VERIFIED | `.planning/phases/07-policy-reference-and-security-review/07-SECURITY-REVIEW.md` (349 lines): scope, method, boundary-as-implemented (B1–B10), open findings with dispositions (5.1–5.10), residual risks R1–R14, doc drift (§7), pre-release recommendations (§8), explicit not-observed statement (§9). Spot-checks hold: double-bind TOCTOU (compose `bindPolicyWorkspace` `:90-94` + controller `:376-382` + retry rebind `dispatch.ts:208`), advisory-write scope (`policy.ts:133-136`, `workspace.ts:71-99`, `plugin.ts:267-276`), plugin fixes (shutdown sub `:161-163`, `settled` guard `:205-228`, non-string refuse `:259-262`, `nowIso` fallback `:240-246`), MCP line discipline (`mcp/server.ts:149-162,185-219`), socket perms 0700/0600 (`daemon/channel.ts:6,26-28,298-380`), digest-shape check (`runtime/config.ts:20,80-84`) |
| 8 | A dependency and supply-chain review is recorded in the repo | ✓ VERIFIED | `.planning/phases/07-policy-reference-and-security-review/07-SUPPLY-CHAIN-REVIEW.md` (98 lines): 6 direct deps exact-pinned (`package.json:18-27` confirmed: `ajv` 8.20.0 runtime, 5 dev deps), lockfile v3 root match (lock lines 4-22 confirmed), 102 registry-only resolved entries, zero install scripts, digest-shape pinning (`config.ts:20,80-84`, D-52), Anda-licence conflict carried open (§5, `src/anda/` holds only `client.ts`+`shape.ts`, no vendored licence), engines gap S-1 (`engines >=22` vs eslint `^22.13.0` line — recorded, decision pending), missing project licence S-5 (no `LICENSE` file, no `license` field in `package.json:1-28` — recorded, release decision pending) |
| 9 | Both reviews are complete before the first release is cut | ✓ VERIFIED | Both review files exist on disk in the phase directory; neither review records a release having been cut; supply-chain §3 states the point-in-time lockfile under review; security §9 states no live claim of containment rests on the review alone. Release-gate decisions left open are S-1 (engines floor), S-4 (Anda licence), S-5 (project licence) and security §8 items 1–8 — recorded as decisions/recommendations, not as missing review content |

**Score:** 9/9 truths verified (0 present-but-behavior-unverified; policy-reference truths are content-accuracy checks against code, verified by direct comparison)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `docs/policy-reference.md` | Documents all 7 policy keys + loader + non-keys | ✓ VERIFIED | All keys present with type, default, effect, enforced-by citations; loader rules (ENOENT→defaults, `POLICY_DENIED` paths, absolute-roots, outside-roots) present; non-key constants table present |
| `07-SECURITY-REVIEW.md` | Security review recorded | ✓ VERIFIED | Present, scoped, line-cited, with dispositions + residuals + not-observed statement |
| `07-SUPPLY-CHAIN-REVIEW.md` | Supply-chain review recorded | ✓ VERIFIED | Present, 6 direct deps + lockfile + pinning + findings S-1–S-7 + reproduce steps |
| `src/core/policy.schema.json` | Frozen 7-key closed schema (reference target) | ✓ VERIFIED | 7 properties, `additionalProperties: false`, defaults advisory/`[]`/`[]`/`[]`/false/10000/2000 — unchanged |
| `src/core/policy.ts` | Loader + mode + exec gate (reference target) | ✓ VERIFIED | Unmodified by this phase; cited ranges match (modulo the §7 one-line offset) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| policy-reference `mode` | `decideMutation` | cited `policy.ts:129-140` | WIRED | Function found at `:130-141`, `denyCodeFor` `:142-153`; advisory/fail-closed semantics as documented |
| policy-reference `workspaceRoots` | `bindWorkspace`/`bindRoot` | cited `controller.ts:373-383`, `root.ts:18-42` | WIRED | Both call sites present (`controller.ts:376-382`, `compose.ts:90-94`) |
| policy-reference `credentialAllow` | dispatcher → handlers | cited `dispatch.ts:100-106`, `workspace.ts`, `fs/*` | WIRED | Threading and `assertCredentialAccess` present |
| policy-reference `egressAllow` | `validateEgressAllow`/`renderNetworkPolicies` | cited `egress.ts`, `openshell.ts:231-276` | WIRED | Validator, renderer, deny-all `{}` all present |
| policy-reference `shellEnabled` | `checkExecPolicy` | cited `policy.ts:160-167`, `dispatch.ts:163-165` | WIRED | Gate order (before state check) present |
| policy-reference budgets | `withTimeout` races / `waitLeavingConnecting` | cited controller + `dispatch.ts:275-291` | WIRED | Deadline, races, timer+unsubscribe all present |
| security review claims | cited code lines | §§3/5 spot-checks above | WIRED | Every spot-checked citation resolves to the claimed code (one harmless line offset) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| QUAL-03 | Phase 7 (no PLAN files; docs phase) | Policy reference + security review + supply-chain review before first release | ✓ SATISFIED (unit part) | `docs/policy-reference.md` covers all 7 QUAL-03-named keys; both reviews recorded; live-behavior confirmation deferred to human verification below |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | — | — | None. This phase adds only documentation/review files; no source file was modified and no stub/marker scan findings apply. The one citation drift (`policy.ts:129-140` vs actual `:130-141`, self-reported in review §7) is ℹ️ Info, not a blocker. |

### Human Verification Required

All automated (read-only, no-execution) checks pass. The items below cannot be verified without live hosts, network, or a release decision — each is recorded in the reviews themselves as unverified or open.

### 1. Podman 5.x hardening field paths and egress behaviour

**Test:** On a host with Podman ≥5.x, run the gated suite and confirm the libpod inspect field paths provisional in `src/runtime/hardening.ts:1-10`, the `networkMode: "none"` setting (`hardening.ts:13-30`), and the rendered OpenShell `network_policies` actually deny non-allowlisted egress.
**Expected:** Hardening fields resolve; non-allowlisted egress is blocked; empty allowlist denies all.
**Why human:** No live Podman was observed (security review §9, R1/R13/C15/C16); this verifier ran nothing per assignment.

### 2. Omp host hook fail-closed behaviour (OQ-P5-01 / OQ-P5-02)

**Test:** In a real Omp host, verify whether a `tool_call` handler error/timeout blocks the guarded `write`/`edit` call, and whether `setActiveTools` removal or a `tool_call` block covers every host execution path (`docs/integration/omp.md:84-90`).
**Expected:** One tested mechanism chosen per `omp.md:88` (one test per candidate mechanism); otherwise the 5.4 residual stays open.
**Why human:** Upstream host behaviour; unverified in notes and unobservable statically.

### 3. MCP and ACP client behaviour over the contract

**Test:** Drive `src/mcp/server.ts` and `src/acp/agent.ts` with a real MCP/ACP client: notifications take no reply, unusable ids diagnose only, replies are single JSON lines, `tools/call` validates before dispatch, injected `log` cannot break the ACP protocol.
**Expected:** Behaviour matches 5.7/5.8; stdin-writer trust boundary (5.8 residual) accepted or mitigated.
**Why human:** No MCP/ACP client was observed (security review §9).

### 4. Supply-chain reproduce steps (network) and release decisions

**Test:** Run `npm audit --package-lock-only --json`, `npm audit signatures`, recompute each direct tarball SHA-512 against the lockfile `integrity`, and read the six registry manifests; then decide S-1 (raise `engines` floor to `>=22.13.0` or accept the 22.0–22.12 gap), S-4 (Anda licence conflict still blocks Anda code), S-5 (declare a project licence / add `LICENSE`).
**Expected:** Audit clean, 102 signatures verified, six tarballs match, three decisions recorded before release.
**Why human:** Requires network fetches and a release decision; this verifier ran nothing per assignment.

### 5. Advisory-mode default for containment-critical deployments (security §8 item 2)

**Test:** Decide and document the default mode for deployments that expect containment; state the advisory write behaviour (5.3) in the release notes.
**Expected:** A documented recommendation (fail-closed for containment) recorded before release.
**Why human:** Product/release decision, not a code check.

### Gates (established by orchestrator at this HEAD, not run by verifier)

- `npm run typecheck` (`tsc --noEmit`): PASS (per orchestrator)
- `npm run lint` (ESLint): PASS (per orchestrator)
- Full `node --test` suite: 988 tests, 979 pass, 0 fail, 9 live-gated skips (host Podman 4.9.3 below 5.x)

### Gaps

None. Every roadmap success criterion for Phase 7 is met in code and unit evidence: all seven policy keys are documented with defaults and effects that match the schema and implementation, and both the security review and the supply-chain review are recorded with findings, residuals, and reproduce steps. Open items (S-1/S-4/S-5, security §8) are decisions and live confirmations explicitly scoped to pre-release human verification, not missing phase content.

---
_Verified: 2026-10-22_
_Verifier: Claude (gsd-verifier)_

## Re-verification 2026-11-17

Read-only re-verification against evidence produced after this report (v2.0 and v3.0). Nothing was run. Each row quotes the unresolved item and cites the file read and the result recorded there. Verdicts: covered-by-later-evidence, still-open, superseded.

Stale statement in the truth table above: Truth 1 and the `mode` row describe the `mode` default as `advisory`. That is superseded: owner decision D4 (2026-10-29) made the default `fail-closed`. See item 16.

| # | Unresolved item (quoted) | Current evidence | Verdict |
| - | ------------------------ | ---------------- | ------- |
| 1 | Human item 1: "confirm the libpod inspect field paths provisional in `src/runtime/hardening.ts:1-10`" | `docs/integration/openshell.md` live suite results on rootless Podman 5.7.1 with runc and the 26-property create-time verifier: 31 of 31 assertions, 9 scenarios, 2026-10-28; 33 of 33, 10 scenarios, 2026-10-30. `.planning/phases/19-resume-and-checkpoint/19-VERIFICATION.md` (2026-11-16): the production live file ran 40 tests, 40 pass, 0 fail in runs `19-live-2ff6df9-r2` and `full3-1` to `-3`; run 1 had one failure (scenario 12, accepted gap G1, not a hardening scenario). `.planning/milestones/v2.0-phases/09.7-review-finding-remediation/09.7-VERIFICATION.md` (live runs 2026-10-28): verifier extended to 26 properties. Note: Podman 5.7.1 does not report `KernelCaps` or sysctls in inspect; the verifier reads capabilities from the init process `/proc` status and sysctls from the OCI config (`src/runtime/hardening.ts` header; `openshell.md` lines 384-387). The `hardening.ts` header comment still says the paths are confirmed only by the gated suite; the suite has since passed. | covered-by-later-evidence |
| 2 | Human item 1: "the `networkMode: "none"` setting (`hardening.ts:13-30`)" | `docs/integration/openshell.md` lines 393-394 (2026-10-28, Podman 5.7.1): production create flags use network none; Podman refuses `dns_server` with network none; inspect reports an empty `ResolvConfPath`; live evidence with the realm-rendered policy behind the gateway. Scenario 1 asserts IPv6 disabled and the exact `resolv.conf` (33 of 33, 2026-10-30). | covered-by-later-evidence |
| 3 | Human item 1: "the rendered OpenShell `network_policies` actually deny non-allowlisted egress"; Expected "empty allowlist denies all" | `openshell.md` lines 466-472 (verified live on the rebuilt image, 2026-10-28): "Egress is deny-all by default"; with an allowlist the allowed host and port connect, a non-allowlisted IP, a non-allowlisted host and an IPv6 literal fail with `EACCES`; AAAA returns `ENODATA`. Scenario 3 of the live suite asserts these (passed in the 2026-10-30 run, 33 of 33). `09.6-integration-live-proof/09.6-VERIFICATION.md`: host packet capture showed no DNS packets for names outside the allowlist. `09.7-VERIFICATION.md` row E-05: private egress literals refused in every notation; "Live scenario 3 passes." | covered-by-later-evidence |
| 4 | Human item 2: "verify whether a `tool_call` handler error/timeout blocks the guarded `write`/`edit` call" | `docs/integration/omp.md` Enforcement spike table row S4 (Omp 18.12.6, 2026-10-29): a throw blocks the call with `Extension <file> failed`; a handler that never settles blocks it with `Extension <file> timed out after <n>ms` (budget `extensionHandlers.toolCallTimeoutMs`). Suite of 12 tests passed live twice, 12 of 12 each, 2026-10-29 (`omp.md` line 402). `.planning/phases/12-scripted-provider-harness-and-omp-enforcement-spike/12-VERIFICATION.md` (2026-11-14, passed) row 10. Realm plugin guard observed in a real Omp 18.12.6 host: in fail-closed mode the write was blocked with `REALM_NOT_ACTIVE` and no file was created (`omp.md`, scripted-provider observations; marked historical for its daemon-down assertion). Caveat: observed on Omp 18.12.6; the 2026-11-17 rehearsal on Omp 18.22.0 covers boot only (`omp.md` line 172), not this hook behaviour. | covered-by-later-evidence |
| 5 | Human item 2: "whether `setActiveTools` removal or a `tool_call` block covers every host execution path"; Expected "One tested mechanism chosen ... otherwise the 5.4 residual stays open" | `omp.md` Q4 and the enforcement spike: both mechanisms were tested (S2a removal refused at execution with `Tool <name> not found`; S4 `tool_call` block). The chosen rule is an allowlist removal plus a `tool_call` backstop (`omp.md` lines 293 and 321). OQ-P5-01 closed; OQ-P5-02 restated narrowly (`omp.md` lines 333-345): not covered by a hook are what `eval` code writes with the runtime file API and the user's own shell command; the Python eval prelude, SDK `restrictToolNames` sessions and other extensions' tools were not run. Those limits stay documented and containment is claimed for model-issued calls only. Realm plugin: `.planning/phases/16-omp-runs-in-the-sandbox/16-VERIFICATION.md` (2026-11-14, passed, OMPX-05 live pass); tool list after active on Omp 18.18.1 (`omp.md`, 2026-11-08). The question the item asked is answered and the mechanism is chosen; the remaining bypass paths are recorded limits, not unobserved behaviour. | covered-by-later-evidence |
| 6 | Human item 3: "Drive `src/mcp/server.ts` ... with a real MCP ... client" | `docs/integration/mcp.md` line 96 (2026-10-29): Claude Code `claude mcp list` Connected and Grok Build `grok mcp doctor` handshake accepted with 6 tools discovered, on the production stack; `npm run check:mcp` drives both protocol eras (Phase 20 gate, `20-VERIFICATION.md`, exit 0 at 9710346). Production live scenario 6 handshakes as a legacy client then sends a modern request (`openshell.md`, 33 of 33 and 40 of 40). `.planning/phases/24-host-adapters-wave-1-claude-code-opencode-codex-kimi-cli/24-VERIFICATION.md` (2026-11-17): claude 2.1.322 validator 3/3, run twice. Unit shape: `test/mcp/server.test.ts` lines 88 (one newline-terminated JSON message per request), 294 (six tools route with the ToolCall map unchanged) and 417 (stdio-client-shaped status and write). | covered-by-later-evidence |
| 7 | Human item 3 (MCP half): "notifications take no reply, unusable ids diagnose only" (security review 5.8, `mcp/server.ts:209-219`) | No named test in `test/mcp/server.test.ts` and no live observation was found for a notification or an unusable id on the MCP surface. Only the static reading from the 07 review exists. The live helper `test/integration/production-live-helpers.test.ts` lines 552-570 ignores notifications when matching replies, so it does not prove the server stays silent. The ACP equivalents are covered (item 8). Missing: a test or a recorded client observation that an MCP notification gets no reply and an id that is not a string, number or null gets a diagnostic only. | still-open |
| 8 | Human item 3 (ACP half): "ACP ... notifications take no reply, unusable ids diagnose only, replies are single JSON lines" | `docs/integration/acp.md` live check 2026-10-29 (Podman 5.7.1, OpenShell 0.1.5): 67 checks, 0 failed, including a `_realm/tool` notification never executed with no reply, a malformed line, a batch line rejected, an echoed string id, an unknown method. `test/acp/agent.test.ts` line 386 (notification, MED-01), 410 and 437 (non-standard id and null id, LOW-02), 468 and 482 (LOW-03 stream handling). The id behaviour is a null-id `INVALID_REQUEST` reply, which the 07 review 5.7 records as conformant JSON-RPC and a parity choice with MCP. | covered-by-later-evidence |
| 9 | Human item 3: "injected `log` cannot break the ACP protocol" (5.7 LOW-03, contract documented, not enforced) | `src/acp/agent.ts` lines 36-56 and 214-222: diagnostics always go to `process.stderr` first and the observer receives a copy; `src/acp/stdio.ts` line 14 is the only production call and passes no `log`. `test/acp/agent.test.ts` line 506 (LOW-04): stdout carries only protocol lines. The contract that an injected observer must not write to `output` is still not enforced in code, but no production caller can trigger it. | covered-by-later-evidence |
| 10 | Human item 3: "stdin-writer trust boundary (5.8 residual) accepted or mitigated" | Only the 07 security review 5.8 records it as a residual ("The trust boundary is the process that launches the server"); `docs/integration/mcp.md` line 32 describes the client-launches-server transport. No later document records an acceptance or a mitigation for who may write to the MCP or ACP stdin. `docs/integration/project-session-contract.md` line 79 states a local single-account trust boundary for the binding directory, which is a different surface. Missing: a recorded owner acceptance (or a mitigation) for the stdin trust boundary of `realm mcp` and `realm acp`. | still-open |
| 11 | Human item 4: "Run `npm audit --package-lock-only --json`" (Expected "Audit clean") | `.github/workflows/ci.yml` lines 154-161: `npm audit --omit=dev --audit-level=high` runs as the `audit` job and the `build` job needs it; `CONTRIBUTING.md` line 32 says release waits for it. `.planning/phases/20-release-pipeline-hardening/20-VERIFICATION.md` (2026-11-17): joined gate at 9710346 with npm audit exit 0. `09.4-compute-driver/09.4-01-VERIFICATION.md` row 7: `@grpc/grpc-js` 1.14.6 and `@grpc/proto-loader` 0.8.1 exact pins, Apache-2.0, audit 0 vulnerabilities. The pipeline replaced the manual one-off run. | covered-by-later-evidence |
| 12 | Human item 4: "`npm audit signatures`, recompute each direct tarball SHA-512 against the lockfile `integrity`" (Expected "102 signatures verified, six tarballs match") | The 07 supply-chain review (2026-10-21) records both as done for its lockfile. No later record of `npm audit signatures` or a tarball re-hash exists (a repo-wide search found the phrase only in the two 07 files), and the lockfile has since changed: `package.json` now pins 9 direct dependencies (3 more runtime: `@grpc/grpc-js`, `@grpc/proto-loader`, `@rivet-dev/agentos-core`) and the lockfile is regenerated on every release commit. CI installs with `npm ci` (`ci.yml` lines 50, 192, 399); [INFERENCE] npm checks integrity there, but no document records it as the check. Missing: a recorded signature and tarball-integrity check for the current lockfile, or a decision that CI `npm ci` is the accepted control. | still-open |
| 13 | Human item 4: "decide S-1 (raise `engines` floor to `>=22.13.0` or accept the 22.0-22.12 gap)" | `package.json` (read 2026-11-17): `"engines": { "node": ">=22.13.0" }`. The floor was raised. | covered-by-later-evidence |
| 14 | Human item 4: "S-4 (Anda licence conflict still blocks Anda code)" | `docs/integration/anda-decision.md` (decision summary): licence conflict "Open. It blocks vendoring any Anda code"; `.planning/milestones/v2.0-MILESTONE-AUDIT.md` line 247: "open, owner; ANDA-01 to ANDA-04 stay carried". `src/anda/` holds only `client.ts` and `shape.ts` (an own HTTP client, no vendored Anda file); `NOTICE` lists only the OpenShell protocol definitions and the modified seccomp profile as third-party material. The decision to carry the conflict as a block on vendoring is recorded and no release shipped Anda code. The conflict itself is not resolved and stays an owner item. | covered-by-later-evidence |
| 15 | Human item 4: "S-5 (declare a project licence / add `LICENSE`)" | `LICENSE` exists (GNU AGPL-3.0, unchanged after review: `.planning/milestones/v2.0-phases/10-docs-packaging-release/10-04-RESERVED-FILES.md`); `package.json` has `"license": "AGPL-3.0-only"` and ships `LICENSE`, `NOTICE`, `licenses`; `CHANGELOG.md` line 947: "Licence is AGPL-3.0-only". | covered-by-later-evidence |
| 16 | Human item 5: "Decide and document the default mode for deployments that expect containment; state the advisory write behaviour (5.3) in the release notes" (security review 8 item 2) | Owner decision D4 (2026-10-29): the default is `fail-closed`; advisory is an explicit opt-in. `src/core/policy.schema.json` lines 10-11 default `fail-closed`; `docs/policy-reference.md` lines 41-45 and 74-82 document the default, the advisory write behaviour and the change from the old default; `.planning/phases/15-zero-config-onboarding-and-fail-closed-default/15-VERIFICATION.md` (2026-11-14, passed) row 4 and the spec classification table. The advisory-by-default design this item targeted no longer exists. | superseded |

### Verdict counts

- covered-by-later-evidence: 12 (items 1, 2, 3, 4, 5, 6, 8, 9, 11, 13, 14, 15)
- superseded: 1 (item 16, decision D4)
- still-open: 3 (items 7, 10, 12)

### Result

Status stays `human_needed` with `reverify_open: 3`. The three open items are narrow: an MCP-surface notification and unusable-id test or observation (7), a recorded acceptance of the stdin trust boundary (10), and a signature and tarball-integrity record for the current lockfile (12). All live-behavior items that this report deferred to a Podman 5.x host (items 1 to 3), a real Omp (4, 5), and real MCP and ACP clients (6, 8) are covered by dated live evidence.

_Re-verified: 2026-11-17_
_Re-verifier: Claude (read-only; no commands run beyond file reads)_

### Re-verification addendum 2026-11-17 (orchestrator run)

- Item 12 (supply chain): `npm audit signatures` on the current lockfile reported 145 packages with verified registry signatures and 39 packages with verified attestations. A tarball re-hash is still not recorded, so the item stays open for that part only.
