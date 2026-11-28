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

## Tcffd1 addendum — test plan for A08 (AC-86..AC-96)

| Screen | Must-assert cases (counts; A08 verifies, A06 does not claim) |
|---|---|
| SCR-SecSplitFixture | 1 location (boot-report), 2 parts concatenated, 0 literal fixture strings, compiled run 0 failures, refusal 0 echoes, scanner 0 secrets; error names `<path>:<line>` + `REDACTED` (0 literals rendered) |
| SCR-Merge256Gate | local 5 pass + CI 5 pass, 0 failures; check:docs on merged main exit 0; 1 merge (squash, ship flow), 1 absence note, 0 claims of 5 of 5; pending rows read `running…`, never green |
| SCR-R3W3Closeout | 7 plans exit 0, W3 9 of 9 green (stack a519184 + 0d5032f), STATE prefix 29bc314a + ROADMAP 4b26403c with 0 planning edits, 4 of 4 Linear closed after gates (0 before), 2 of 2 PR states listed |

Mono/no-colour + pipe-order + parity regression anchor apply as before; `fe_state_parity_check`
input uses the spec states in the `component-spec.md` addendum (dotted sub-states count separately).
`fe_token_literal_scan` / `fe_client_security_scan` apply only when style or HTML-injection code
changes (none in this docs-view addendum — no `src/` change). Axe remains the authority; no axe run
in this repo (no axe dependency, A08 runs per story) — do not report axe `critical` as 0 from static
checks. CLI/daemon boards ship no web bundle (no browser JS), so no bundle bytes / Lighthouse /
CWV numbers are claimed here (UNVERIFIED unless a docs build is measured downstream).

## T5471 addendum — test plan for A08 (AC-97..AC-108)

| Screen | Must-assert cases (counts; A08 verifies, A06 does not claim) |
|---|---|
| SCR-QualityBaselineBoard | 8 gate rows each read 1 recorded exit code (same names as `ds/GateBoard` props in `component-spec.md` addendum); 3 of 3 coverage floors measured (`src/fs`, `src/core`, `src/tools`); audit row reads 1 exit + 1 dependency count; ratchet 0 suppression · 0 silent catches beyond 10 QUAL-01 exceptions · 0 unjustified deps · 0 oversized modules; unmeasured rows read `unknown — not measured` on the advisory surface, never pass; gate-fail names the gate + 1 remedy and preserves sibling verdicts |
| SCR-LinearContinuationBoard | every open item reads exactly 1 state (`done-with-evidence` with evidence ref, or `blocked-with-named-cause`); `0 items lack a state`; `duplicate phase titles 0, 1 count recorded per phase`; blocked rows read `BLOCKED — owner decision required` + 1 cause + 1 owner action + 1 next step; carried `phases 56-58 blocked on the realmlive stack, 0 live windows scheduled`; workspace-unreadable marks 0 items |
| SCR-GateEnforcementBoard | 4 verdict rows in text (`review`, `quality`, `security`, `release`); missing reads `not recorded — gate not run`; red gate holds release (`held — <gate> red`); `0 releases land on a red verdict`; most-restrictive wins; `ready` only at 4 of 4 green; traceability `100 percent of 4 stories trace…, 0 uncovered requirements` |

Mono/no-colour + pipe-order + parity regression anchor apply as before; `fe_state_parity_check`
input uses the spec states in the `component-spec.md` T5471 addendum (dotted sub-states count
separately). `fe_token_literal_scan` / `fe_client_security_scan` apply only when style or
HTML-injection code changes (none in this docs-view addendum — no `src/` change). Axe remains the
authority; no axe run in this repo (no axe dependency, A08 runs per story) — do not report axe
`critical` as 0 from static checks. CLI/daemon boards ship no web bundle (no browser JS), so no
bundle bytes / Lighthouse / CWV numbers are claimed here (UNVERIFIED unless a docs build is
measured downstream).

## T8580 addendum — test plan for A08 (SCR-BootBindingDiag, AC-114..AC-116)

| Screen | Must-assert cases (counts; A08 verifies, A06 does not claim) |
|---|---|
| SCR-BootBindingDiag | exactly 1 of `ACTIVE`/`DISCONNECTED` (`●`/`○` redundant); 4 checklist rows (`daemon`,`driver`,`image`,`config`, text verdicts, `not probed` after first failure, never `pass`); `error.daemon` reads `REALM_NOT_ACTIVE`, `error.driver` reads `OPENSHELL_GATEWAY_LOST`/`OPENSHELL_START_FAILED` and never `POLICY_DENIED`, `error.image-config` reads `AGENTOS_NOT_CONFIGURED`/`POLICY_DENIED` with 0 containers created; each failure = 1 code + 1 binding + 1 cause + 1 remedy + 1 verify; `empty.no-config` names `realm init`; `success` = `ACTIVE` + 1 container id + 1 readback + 0 `ERR_MODULE_NOT_FOUND`; disconnected write refuses `REALM_NOT_ACTIVE` with 0 host files changed |

State parity input = `default, loading, error.daemon, error.driver, error.image-config,
empty.no-config, success` (7, dotted sub-states count separately). Focus order
`workspace-selector, up-action, diagnostic-area` (24×24 / 44×44 / non-interactive status,
0 positive tabindex). Mono/no-colour + pipe-order (code first, reason second) apply as
before. Axe in component tests remains the authority; no axe run claimed here. CLI/daemon
surfaces ship no web bundle, so no Lighthouse/CWV/bundle numbers are claimed (UNVERIFIED).
