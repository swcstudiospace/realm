# Component Spec — Realm Operator Surfaces (skeleton, typed)

**Tokens:** `design.system.tokens@1.0.0` (`docs/ux/tokens.json`) · **Contract:**
Realm Control Socket 1.0.0 (`api-realm-control.yaml`) + `api-gsd-linear.yaml` for SCR-LinearGsd.
**Rule:** props are typed (no `any`/`unknown` in the component contract); a component is not done
without one Storybook story per state and Playwright component tests (see `test-notes.md`).
All screens: WCAG-2.2-AA, min contrast 6.47 (text) / 3.43 (focus ring on terminal surface).
`ds/*` refs are 1.0 text-output blocks. Focus order is the spec order; never add positive
tabindex — use DOM order.

Shared block contracts (referenced per screen):

```ts
// ds/StatusReadout — NFR-A1: exactly one of two labels, shape cue redundant with text.
type StatusLabel = "ACTIVE" | "DISCONNECTED";
interface StatusReadoutProps {
  label: StatusLabel;            // rendered as [ACTIVE] / [DISCONNECTED] + ● / ○
  sessionId: string;             // realm-<sessionId>
  workspace: string;             // absolute path, wraps, never truncates into ambiguity
  notice: string;                // one line; never empty when unread reconcile/reap exists
  colour: "success" | "none";    // colour.status.success reinforces ACTIVE only; "none" is NO_COLOR-safe
}
// ds/NoticeBanner — notice is never silent.
interface NoticeBannerProps {
  message: string;               // one line, factual: what happened / what it means / what next
  live?: boolean;                // aria-live polite when a new notice arrives
}
// ds/BlockedNotice — blocked is not failed; never green.
interface BlockedNoticeProps {
  question: string; decider: string; unblocksWhen: string; defaultBehaviour: string; unverifiedCount: number;
}
// ds/CodeBlock — terminal surface tokens only.
interface CodeBlockProps { code: string; }
// ds/CheckList — verdicts in text, never colour-only.
type CheckVerdict = "pass" | "fail";
interface CheckRow { id: string; verdict: CheckVerdict; remedy?: string; }
```

## SCR-RealmStatus — `realm status`
AC-11, AC-12, AC-13, AC-15, AC-21, AC-23, AC-24 · Contract `GET /status` → `StatusResponse`.
Props: `StatusReadoutProps` + `lifecycle: "active" | "degraded" | string` (unknown → `REALM_NOT_ACTIVE`).
States: `default`, `loading` ("status: probing daemon …"), `error.daemon-absent`, `error.validation`,
`empty.no-sessions`, `success`, `degraded` (sub-state of success: `ACTIVE` + `degraded: <cause>`, never a third label).
Focus: `workspace-selector`, `status-query`, `notice-area`.
Implementation note: `runStatus` (`src/cli/main.ts`) already returns exit 0 `disconnected` +
stderr `daemon absent (REALM_NOT_ACTIVE); local report` when no daemon answers — the spec
surface consumes that; do not change the string (see copy-table). Monochrome render keeps
`[DISCONNECTED]` + `○`.

## SCR-RealmLifecycle — `realm init|up|down`
AC-14, AC-16, AC-17, AC-22, AC-25 · Contract `POST /up`, `POST /down` → `StatusResponse`; 409 `POLICY_DENIED`.
Components: `ds/LifecycleSteps@1.0 { steps: ["init","up","down"] }`, `ds/StatusReadout@1.0`.
Props: `{ imageDigest: string; sessionId: string; workspace: string; mode: "fail-closed"|"advisory"; staysIntact: string[] }`.
States: `default`, `loading` ("up: starting daemon (≤200s budget)…" + elapsed), `error.policy`, `error.not-active`, `empty.no-workspace`, `success` (`down` prints `disconnected` / `already down (REALM_NOT_ACTIVE)` exit 0, no error framing).
Focus: `workspace`, `image-digest`. Isolation line (AC-22) names both sandboxes `realm-<sessionId>`
and states a write in one is invisible in the other. Advisory warning shown every invocation (AC-16).

## SCR-RealmDoctor — `realm doctor [--fix [--dry-run]]`
AC-19, AC-20. Components: `ds/CheckList@1.0 { verdicts: ["pass","fail"] }`, `ds/FixPreview@1.0 { dryRunFirst: true }`.
Props: `{ checks: CheckRow[]; fixMode: "none"|"fix"|"fix-dry-run"; metricsPointer?: string }`.
States: `default`, `loading` ("doctor: running N local checks…"), `error.daemon-absent`
(JSON to stdout + `daemon absent (REALM_NOT_ACTIVE); ran N local checks` to stderr), `error.validation`,
`empty.no-checks`, `success`. Success + `--fix --dry-run` prints `would <kind> <path> to 0700`,
changes nothing. Focus: `workspace`, `fix-mode`, `dry-run`.

## SCR-RealmAudit — `realm audit verify` + `realm anchor`
AC-10, AC-18, AC-30 · Contract `POST /audit/verify` → `AuditVerifyResponse`; `AuditLine` (seq/prev/code/correlationId, 0 PII).
Components: `ds/AuditVerdict@1.0 { exitCodes: [0,1,2] }`, `ds/AuditRow@1.0 { dispositions: ["satisfied","carried","superseded"] }`.
Props: `{ files: { session: string; result: "verified"|"chain-break"; line?: number }[]; head?: { seq: number; sha256: string }; anchorRoot?: string }`.
States: `default`, `loading` ("audit: checking <file>…"), `error.chain-break` (exit 1, first broken line),
`error.validation` (exit 2), `empty.no-files` (`no audit file to verify`, exit 1, not pass), `success` (`verified: K files, head <seq>:<sha256>`).
Paths are never printed; failures name session + line (or anchor line count). Crash-stage sweep orphans
listed by sweep audit lines (AC-10). Milestone audit: one row per requirement (AC-30). Focus: `selector`, `head-pin`, `anchor-file`.

## SCR-RealmCheckpoint — `realm checkpoint create|restore`
AC-24, AC-25, AC-26 · Contract `POST /checkpoint/restore` (409 unsafe paths).
Component: `ds/CheckpointPanel@1.0 { byteExact: true }`.
Props: `{ checkpointId: string; fileCount: number; workspace: string; mode: "create"|"restore" }`.
States: `default`, `loading` ("checkpoint: writing…"), `error.daemon-silent` (`REALM_NOT_ACTIVE` before anything is written), `error.validation`, `empty.no-checkpoint`, `success` (byte-for-byte: deletions restored, extras removed). Focus: `workspace`, `checkpoint-id`, `mode`.

## SCR-RealmMetrics — `realm metrics`
AC-20 · Contract `GET /control/metrics` → `MetricsResponse`.
Component: `ds/MetricTable@1.0 { unit: "count" }` — table `counter | value | window`.
Props: `{ counters: Record<string, number>; window: string; networkListeners: 0 }`.
States: `default`, `loading` ("metrics: reading…"), `error.daemon-absent` (`realm metrics: daemon absent (REALM_NOT_ACTIVE)`, exit 1), `error.validation`, `empty.no-session`, `success` (+ `0 network listeners` line). Focus: `workspace`, `query`.

## SCR-OmpGuard — Omp extension panel/transcript
AC-1, AC-2, AC-3, AC-4, AC-14, AC-15, AC-16, AC-17. Components: `ds/ModeBanner@1.0 { modes: ["fail-closed","advisory"] }`, `ds/ToolList@1.0 { tools: ["exec","read","write","list","status"] }`, `ds/RefusalCard@1.0 { needsNextAction: true }`.
Props: `{ mode: "fail-closed"|"advisory"; tools: readonly ["exec","read","write","list","status"]; refusal?: { code: string; reason: string; next: string }; warning?: string }`.
States: `default`, `loading` ("omp: starting run…"), `error.refused` (catalogue code + reason + next; bash refused in fail-closed with 1 code, AC-15), `error.validation`, `empty.tool-list` (stated, not blank), `success` (bytes in sandbox `/workspace` + host root; audit admission+result share correlation id, AC-17).
Advisory warning on every reachable-inactive write (AC-2/AC-16). Focus: `tool-name`, `mode-banner`, `refusal-message`.

## SCR-CiGates — CI / gate board (docs view)
AC-5, AC-6, AC-7, AC-8, AC-9, AC-31. Component: `ds/GateBoard@1.0`.
Props: `{ gates: { name: "typecheck"|"lint"|"test"|"build"|"check-docs"|"check-gates"|"check-pack"|"check-mcp"; verdict: "pass"|"fail" }[]; greptile: string; mergeRecord?: string; ciNodeVersions: string[] }`.
States: `default`, `loading` ("gates: running"), `error.gate-fail` (named gate + `BELOW` for coverage / missing file for pack-smoke), `error.validation`, `empty.no-run`, `success` (`5 of 5` Greptile + squash merge record). Dense table links: ≥24 px height (a11y.md remediation). Focus: `gate-list`, `greptile-verdict`, `merge-record`.

## SCR-OnboardingDocs — docs / README / site pages
AC-4, AC-21, AC-30. Components: `ds/DocSteps@1.0 { numbered: true }`, `ds/CodeBlock@1.0 { surface: "terminal" }`.
Props: `{ steps: { title: string; command: string }[]; nextHref: string }` — every command in its own code block.
States: `default`, `loading` (skeleton + `aria-busy`, code not yet present), `error.not-found` (bounce links), `error.validation`, `empty.no-results` (`0 results` + suggested terms), `success` (install→up on one page).
Heading order starts at H1, never skips a level descending. Focus: `nav`, `heading`, `code-block`, `action-link`.

## SCR-ReleaseProvenance — release workflow view
AC-27, AC-28, AC-29. Component: `ds/ProvenanceList@1.0 { artifacts: ["tarball","SHA256SUMS","SBOM"] }`.
Props: `{ tag: string; checksums: string; sbom: string; attestation: "verified"|"failed"|"pending"; rollbackTarget?: string }`.
States: `default`, `loading` ("release: building…"), `error.attestation` (`gh attestation verify` failure named), `error.validation`, `empty.no-release`, `success` (verified tarball; test release prerelease). Focus: `release-tag`, `attestation`, `rollback`.

## SCR-LinearGsd — Linear / GSD tracking UX
AC-30, AC-32. Components: `ds/IssueHeader@1.0 { oneLineTitle: true }`, `ds/AgentNotes@1.0 { collapsible: "+++ Agent notes" }`, `ds/SubIssueList@1.0`, `ds/BlockedNotice@1.0 { neverGreen: true }`.
Props: `{ phaseId: string; title: string; planIds: string[]; requirementIds: string[]; acCount: number; subIssues: { id: string; title: string }[]; blocked?: BlockedNoticeProps }`.
States: `default`, `loading` ("loading issue…"), `error.duplicate` (existing id stated; creation refused), `error.validation`, `empty.no-match`, `success` (1 issue per phase, 8 issues; sub-issue per plan/requirement when >4 ids).
`+++ Agent notes` is a labelled disclosure; phase order stated as counts (Omp 12→16; runtime 14→17→18→19; pipeline 13→20). Focus: `issue-title`, `agent-notes`, `sub-issue-list`, `state-roadmap`.
