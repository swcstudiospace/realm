# Backlog Order — v9.0 addendum (Ta08e-req)

**Task:** `Ta08e-req` · **Correlation:** `a08e7d90-26e9-4f01-b9be-b3421a4b41e0` · **Capability:** `req.spec`

**Method:** MOSCOW. The backlog holds 11 stories, at or below the 20-story WSJF threshold, so MOSCOW is the default. WSJF scores were not called: stakeholder scores for business value, time criticality, risk reduction and job size were unavailable for this brief, and no number was guessed. The order below uses the brief acceptance sequence (a) to (f) inside each class and is provisional until stakeholder scores settle the WSJF scatter.

## Must

1. US-111 — Realm start-error debug and clean start. First, because every later proof needs a realm that starts.
2. US-112 — Optional Omp plugin toggle. Second, because the later UI-merge proof needs the toggle on.
3. US-113 — Realm UI merged into the additional UI. Third, because the merge must show 0 under-bar paints.
4. US-114 — Production-grade quality bar on the release line. Fourth, because the pull request never reaches review on red gates.
5. US-121 — Green-CI pull request merge to main. Fifth in commitment, last in execution (see the sequence note below).

## Should

5. US-115 — Phase 55: Omp plugin health check.
6. US-116 — Phase 56: F-51-1 dirty-stop cause.
7. US-117 — Phase 57: HTIER-01 attribution retest.
8. US-118 — Phase 58: KIMV-02 recorder fix and rerun.
9. US-120 — Notion and Linear tracking through Notion.

## Could

10. US-119 — Phase 59: concurrent binding behind ratification. Deferred until the owner ratifies 53-DESIGN by a cited date; no code lands before that gate.

## Will not

None. No story is cut from the v9.0 close-out in this addendum.

## Sequence note

US-121 (green-CI pull request merge to main) is a Must commitment that executes last: it merges only after US-111 through US-114 and US-120 show green criteria. Release order inside a class is an A01 scheduling constraint and does not couple the stories.
