# Frontend / CLI Operator Surfaces — Catalog (Realm v3.0)

**Task:** `Tc8fd-fe` · **Correlation:** `c8fd136c-b9a0-459e-bc27-e2c578d77a08` · **Capability:** `code.frontend`
**Scope:** CLI/daemon/Omp operator surfaces only. Realm is not a marketing site; there are no
marketing pages, web app routes, or new graphical components. `ds/*` names below are text-output
blocks in existing Realm surfaces (`src/cli/*`, Omp extension, docs/site shell) — no new UI
framework, no new dependency. A new dependency or UI pattern would be L3 and is not introduced.
**Branch:** `gsd/phase-15-complete` · **Fidelity:** lofi (ASCII/text spec) · **Provisional:** true
(system default theme, no brand guide invented).

## Bound inputs (do not write code against anything else)

| Artifact | Version read this run | Used for |
|---|---|---|
| `docs/ux/spec.md` (A04, `Tc8fd-ux`) | tokens 1.0.0, 11 screens | Screen list, state families, focus order, AC trace |
| `docs/ux/tokens.json` | 1.0.0 | Token binding (see table below) |
| `docs/ux/a11y.md` | WCAG-2.2-AA sheet | Contrast, target-size, NFR-A1, reduced-motion |
| `docs/architecture/contracts/api-realm-control.yaml` | Realm Control Socket 1.0.0 | Only API shapes the CLI surface displays |
| `docs/architecture/contracts/api-gsd-linear.yaml` | read for SCR-LinearGsd shape | Issue/tracking surface |
| `src/cli/main.ts`, `audit.ts`, `anchor.ts`, `checkpoint.ts`, `init.ts` | current tree | Exact stdout/stderr copy (copy-table cites them) |

**Out of scope for this delivery:** any change to `src/` (none made), backend/schema/deploy, E2E
suite (owned by A08), design-token changes (would be L3 to A04), contract changes (A03).
Files in this delivery: `docs/frontend/README.md`, `component-spec.md`, `copy-table.md`,
`test-notes.md`. Disjoint from A07 (data docs) by path.

## What "frontend" means in Realm

| Surface | Operator front end | Not present |
|---|---|---|
| CLI (`realm …`) | stdout = machine line (code/result JSON), stderr = human reason; exit 0/1/2 | No spinner dependence, no color-only meaning |
| Omp extension | Mode banner + tool list (5 tools) + refusal card in transcript | No glob tools, no silent denial |
| Docs/site | H1 → numbered steps → terminal code blocks → next link; 44 px targets | No marketing hero, no brand theme |
| Linear/GSD | 1-line title + `+++ Agent notes` + sub-issue list + blocked notice | No progress bar alone; counts, not bars |

## Token binding (`design.system.tokens@1.0.0`)

No hard-coded values. Every style below binds to the token file; docs/site CSS and any future
style extraction map verbatim:

| Use | Token | Docs/site value |
|---|---|---|
| Page background | `color.background.primary` | `#ffffff` |
| Secondary surface | `color.surface.secondary` | `#f3f4f6` |
| Terminal surface / text | `color.surface.terminal` / `color.surface.terminal-text` | `#111827` / `#f9fafb` |
| Primary / secondary / muted text | `color.text.primary` / `.secondary` / `.muted` | `#111827` / `#374151` / `#4b5563` |
| Link | `color.link.primary` | `#1d4ed8` |
| Status reinforce only | `color.status.success` / `.warning` / `.error` | `#166534` / `#92400e` / `#b91c1c` |
| Focus ring | `color.focus.ring` | `#2563eb` (3.43 on terminal ≥ 3; see `a11y.md`) |
| Border | `color.border.default` | `#4b5563` |
| Spacing | `space.scale-1…16` (4/8/12/16/24/32/48/64 px) | Multiples of 4 px |
| Type | `type.size.body` / `.small` / `.code` | 16 / 14 / 13 px |
| Breakpoints | `breakpoint.base/sm/md/lg/xl` | 0 / 640 / 768 / 1024 / 1280 px |

Contrast floor (measured in `a11y.md`, not re-measured here): min text 6.47, terminal 16.97,
terminal focus ring 3.43. Status colour may **reinforce** a text label, never replace it (NFR-A1).

## NFR-A1 — the single invariant (ACTIVE / DISCONNECTED)

Every status surface shows exactly one of two text labels, with a redundant shape cue
(`[ACTIVE]`/`[DISCONNECTED]` + `●`/`○`), colour optional. This must survive `NO_COLOR`, pipes,
and `2>&1` capture. A third label (`degraded` as a label, green blocked, colour-only pass/fail)
is a publish blocker. `component-spec.md` states this per screen; `copy-table.md` locks the exact
strings; `test-notes.md` gives A08 the mono/no-color tests.

## Screen index (details: `component-spec.md`)

SCR-RealmStatus, SCR-RealmLifecycle, SCR-RealmDoctor, SCR-RealmAudit, SCR-RealmCheckpoint,
SCR-RealmMetrics, SCR-OmpGuard, SCR-CiGates, SCR-OnboardingDocs, SCR-ReleaseProvenance,
SCR-LinearGsd. State parity: each screen implements exactly the states its spec JSON lists
(`default, loading, error.*, empty.*, success` as dotted sub-states); `fe_state_parity_check`
input is prepared in `test-notes.md` for A08. No extra or missing state without A04 sign-off.

## Realm constraints honoured by the spec (no src/ change needed)

Strict TS ESM, `process.env` only at the entry edge (`main.ts` hands env once), no
`@ts-ignore`, `RealmError` catalogue codes, `withTimeout` on control requests
(`CONTROL_TIMEOUT_MS` per method). The CLI already emits the required two-label/machine-human
split and exit-code contract; this delivery specifies the surface, it does not rewrite `src/`.
Any future `src/cli` edit that changes a string must update `copy-table.md` first.

## How to use this folder

1. `component-spec.md` — per-screen props, states, focus order, AC refs (skeleton, typed).
2. `copy-table.md` — exact operator copy per state, with `src/cli` source line refs.
3. `test-notes.md` — component/Playwright/axe test plan for A08, a11y self-check evidence,
   perf/bundle notes, and the handover table for reviewers.
