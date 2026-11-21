# Cleaned Brief — Ta08e-req (v9.0 close-out + Realm quality)

**Task:** `Ta08e-req` · **Correlation:** `a08e7d90-26e9-4f01-b9be-b3421a4b41e0` · **Capability:** `req.spec`

PII scan: `req_pii_scan` on the brief text returned SUCCESS with `found: []`, `has_pii: false`, `regimes_hint: []`. Ambiguity scan: `req_ambiguity_scan` returned score 0.0 across 18 sentences, `needs_clarification: false`. No open questions were listed for this task before drafting.

## Goal (one line)

Bring Realm to production-grade quality, close the outstanding GSD milestone phases 55–59, add an optional Omp plugin toggle, merge Realm UI into the additional UI instead of the under-bar status area, debug the Realm start errors, track the work in Notion and Linear, and merge to main through a green-CI pull request.

## Stakeholders (each quotes the brief)

- *Operator* — "User wants: optional plugin toggle in Realm, and UI merged into other additional UI not underneath the bar." Controls the toggle and reads Realm UI.
- *Maintainer* — "Merge via PR to main after Green CI." Owns the green-CI merge, the template, and the Notion/Linear tracking.
- *Owner* — "Phase 59 gated on 53-DESIGN ratification (not ratified)." Holds the ratification gate for Phase 59.

## Constraints (each quotes the brief)

- "Branch gsd/close-harn03-crash04-next, main at v0.9.2 with PRs merged." The change lands on that branch and merges to main; version files stay release-owned.
- "v9.0 phases 55-59: hermetic 55/56/58 done and merged; live 56/57/58 human-blocking." Hermetic parts of 55, 56 and 58 are already merged; live proof is human-gated and stays provisional here.
- "Phase 59 gated on 53-DESIGN ratification (not ratified), planning merged." No Phase 59 code lands before ratification.
- "POLICY_DENIED due to workspaceRoot config pointing to a nonexistent directory." A stale stored workspaceRoot causes a start refusal; the realm must start cleanly or name the remaining cause with evidence.
- "Omp plugin uses ctx.ui.setStatus with REALM_STATUS_KEY status bar under the bar; adapters/omp/index.js is a shim." The plugin source and the shim are the UI surface in scope; the shim host is not edited by hand.

## Acceptance (quotes the brief)

- "realm starts cleanly or remaining cause named with evidence" — maps to US-111.
- "toggle exists, defaults on, off-path tested hermetically" — maps to US-112.
- "UI no longer paints under the bar, state still truthful" — maps to US-113.
- "Notion pages exist/linked per phase" — maps to US-120.
- "all gates green" — maps to US-114.
- "PR merged to main with template complete" — maps to US-121.
- Phases 55–59 close-out maps to US-115 through US-119.

## Open questions

None. The brief carries measurable acceptances for each work item, and the ambiguity score is 0.0.
