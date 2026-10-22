---
phase: 07-policy-reference-and-security-review
verified: 2026-10-22T00:00:00Z
status: human_needed
score: 9/9 must-haves verified
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
