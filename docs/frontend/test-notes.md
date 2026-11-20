# Test Notes — component / a11y / perf plan for A08

**Scope:** component tests + Storybook stories delivered with each component (consumed by A08);
E2E suite is A08's, not this delivery's. No `src/` test changes in this delivery (docs-only
brief; verifiers run in the main agent per assignment). Test names below are the contract to
implement against `component-spec.md` props and `copy-table.md` strings.

## Playwright component tests (per component, per state)

For every screen: one test per listed state asserting the exact `copy-table.md` string (stdout
code/result vs stderr reason split), the exact state set (no extra/missing state — parity), and
the focus order (Tab reaches spec stops in order; no positive tabindex). Component test matrix:

| Screen | Must-assert cases |
|---|---|
| SCR-RealmStatus | `[ACTIVE]`/`[DISCONNECTED]` exactly one; `●`/`○` cue; daemon-absent stderr line + exit 0; unknown lifecycle → `REALM_NOT_ACTIVE`/`SCHEMA_INVALID`; empty → `no live session for <ws>`; degraded is `ACTIVE` + notice |
| SCR-RealmLifecycle | init digest pinned; down-already-down exit 0 no error framing; `POLICY_DENIED` 0 containers; advisory warning every invocation; per-session names in isolation line |
| SCR-RealmDoctor | `pass`/`fail` in text (colour removed still readable); dry-run prints `would … to 0700`, writes nothing; daemon-absent JSON + stderr line |
| SCR-RealmAudit | chain-break names first broken line exit 1; `no audit file to verify` exit 1 not pass; success `verified: K files, head <seq>:<sha256>`; usage exit 2; paths never printed |
| SCR-RealmCheckpoint | daemon-silent refuses before any write; `no checkpoint <id>`; byte-exact restore copy (deletions restored, extras removed) |
| SCR-RealmMetrics | counters table; daemon-absent exit 1 code split; `0 network listeners`; `no session for <ws>` |
| SCR-OmpGuard | exactly 5 tools frozen shape, 0 glob; refusal = code + reason + next; advisory warning on reachable-inactive writes; tool-list empty stated |
| SCR-CiGates | 8 gate names each pass/fail in text; gate-fail names `BELOW` / missing file; `5 of 5` + merge record; dense links ≥24 px |
| SCR-OnboardingDocs | steps numbered 1..N in order; each command its own code block; `aria-busy` skeleton; `page not found` bounce links; `0 results` + suggestions |
| SCR-ReleaseProvenance | tag/SHA256SUMS/SBOM/attestation in text; attestation failure named; `no release for this ref` |
| SCR-LinearGsd | 1-line title; `+++ Agent notes` labelled disclosure; duplicate refused with existing id; blocked notice exact shape, never green, not counted as pass; counts not bars |

**Mono/no-colour tests (NFR-A1, mandatory):** render every status/gate/check surface with
`NO_COLOR=1` and with colour forcibly removed; assert text labels and shape cues still convey
state, and axe still passes. Pipe through `2>&1` capture and assert order: code first, reason second.

**Regression anchor:** `fe_state_parity_check` input = per-screen states in `component-spec.md`
vs the states implemented; `fe_token_literal_scan` input = any new style declarations (expect 0
raw literals); `fe_client_security_scan` on any HTML-injection surface (expect no sinks).

## A11y self-check (this run)

- Static `fe_a11y_scan` on a representative status markup snippet (h1 → `[ACTIVE]` label → button):
  `state SUCCESS, issue_count 0` via `swarm_tool_call`. File-level `fe_a11y_check.py` + axe-core
  in component tests remain the authority — run before any `src/`-backed screen goes IN_REVIEW.
- Contrast/target/motion/heading evidence is carried from `docs/ux/a11y.md` (WCAG-2.2-AA,
  min text 6.47, focus ring 3.43 on terminal, 44 px primary targets, dense links revised to
  24 px, reduced-motion variants present, `provisional: true`). Re-measure on brand arrival.
- Self-gate for publish: serious/critical = 0 (`a11y_selfcheck: {serious: 0, critical: 0,
  moderate: 0}` for the scanned snippet only). This is **not** a full serialisation of all 11
  screens — A08 must run axe per component story (see UNVERIFIED in the result summary).

## Perf / bundle notes

CLI/daemon surfaces have no web bundle (no browser JS to ship); Lighthouse/CWV apply to the
docs/site shell only. Budget carried from the UX work: initial bundle within the perf budget,
regression > 5% → code-split or escalate; Lighthouse perf ≥ 90, a11y = 100 on shipped docs
pages. This docs-only delivery builds nothing, so no bundle bytes or Lighthouse numbers are
claimed here (UNVERIFIED — no invented measurements). `fe_bundle_budget_check` takes emitted
chunk bytes; do not feed it source sizes. Core Web Vitals gates: LCP ≤ 2.5 s, INP ≤ 200 ms,
CLS ≤ 0.1 on the docs shell when it is next built.

## Toolchain (this run, evidence for checks block)

`shared_toolchain {"scan": true}` → `SUCCESS, python false, js true`; `shared_check_plan
{"scan": true}` → `SUCCESS, names "eslint,tsc,npm test"`. Per the assignment (do not verify /
lint / format; skip gates), `code_checks` and `fe_a11y_check` (python + bun twins) were **not**
executed — checks are reported as `skipped:tool-missing` in the result JSON on that basis, not
as passes. The main agent verifies.

## Gaps / questions for reviewers

- None blocking: 11/11 screens, all state families, AC-1..32 trace from `docs/ux/spec.md` binds
  cleanly. No L3 action (no new dependency, pattern, or token change) was needed.
- `provisional: true` still applies (no brand guide). If A04 supplies brand tokens, the token
  table in `README.md` is the single sync point — re-run contrast measurements then.
