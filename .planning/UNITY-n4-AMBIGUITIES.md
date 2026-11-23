# UNITY n4 — Ambiguity Ledger (SPE-37090..37096)

Date: 2026-11-23. Branch: `swarm/Tb559r-fe`. Graph: `ut-aec293bb48`.
Sole inputs: n1 `.planning/UNITY-n1-GROUND-TRUTH.md`, n2
`.planning/UNITY-n2-DECOMPOSITION.md`, n3
`.planning/UNITY-n3-COMPARISON.md`. No facts re-derived; every claim
cites section + line of those inputs. Trigger payload is SETTLED and
is not re-opened.

## 1. Predecessor review — deferred facts (n4.1 / SPE-37090)

Every deferred fact from n1 §7 (L144-154), n2 ambiguities (L128-138),
and n3 §8 gate (L136-156), numbered A1..A16:

| # | Question | Predecessor citations |
|---|----------|----------------------|
| A1 | Topology: 1-sandbox-per-repo vs settled 1-per-session | n1 §7 L148; n2 L132; n3 §7 L117-121 (combination invalid without owner arbitration) |
| A2 | Multi-worktree-in-one-sandbox | n1 §7 L149; n2 L133; n3 §4 L62-64 |
| A3 | Hosted-vs-Library mode | n1 §7 L150; n1 §5 L124-125 (`agentos.md:30` UNRESOLVED); n3 §8 L142-146 (gate blocked by (b)) |
| A4 | Trigger payload | n1 §7 L151 SETTLED; n2 L135; n3 §1 L32-33 |
| A5 | Plugin distribution | n1 §7 L152; n2 L136 |
| A6 | Grok Bot vs Build naming | n1 §7 L153; n1 §4 L104-108; n2 L137 |
| A7 | Persistence scope | n1 §7 L154; n2 L138 |
| A8 | Realmlive gate-block (allocation layer) | n1 §6(a) L132-134; n1 §5 L117-118 (stack DOWN); n3 §8 L140-143 (gate holds provisionally on (a)) |
| A9 | CAPT-09 hygiene (host-path failure) | n1 §6(c) L136-137; n1 §2 L54-60 |
| A10 | 17-vs-22 GSD-Core parity (17 sections vs 22 hosts) | n1 §4 L100-103 (delta recorded, not adjudicated); n3 §2 L43 |
| A11 | Pending-trio recipes (windsurf/trae/zcode, owner-deferred) | n1 §4 L94-95 (`hosts.md:49`); n2 L31-32 |
| A12 | Journal GC / retention (unpriced cost) | n3 §7 L126-128 ("retention/GC policy that n1 never prices"); n3 §6 L82 |
| A13 | Manifest consistency (registry manifest must be locked/reconciled; CBIND-03 must be extended) | n3 §7 L122-126; n3 §4 L62 |
| A14 | Linear conventions (phase-native coverage) | n1 §3 L84-86 (LINEAR_COMPLETENESS NOT MET; 52 cover GoT plan, not phases); n2 L8-13 |
| A15 | Connection / auth mechanism | n1 §5 L112-115 (mTLS Connected), L120-123 (settled layering); n3 §1 L21-26 |
| A16 | Plugin language / runtime | n1 §1 L10-14 (engines `node>=22.13.0`), L41-48 (TS strict; Node 24 observed, CI 22.x+24.x) |

## 2. Trigger (n4.2 / SPE-37091) — SETTLED, not open

Edits plus argv commands per `tools.schema.json` (n1 §7, L151; n2
L23-27; n3 §1, L32-33). Wiring is deferred work (n2 S8, L53), not a
question: trigger fires on edit and on argv command, conflicts reject
with `LOCK_CONFLICT` (n2, L23-27 and L53). Classification: SETTLED.
Blocked work: none beyond implementing S8.

## 3. Connection / auth (n4.3 / SPE-37092) — safe-default

Settled layering (n1 §5, L120-127): gateway runs on host, driver
creates the session container, AgentOS runner is an in-sandbox
`openshell sandbox exec` child; no `agentos` host binary exists. The
control path is user-only (user-manager `openshell-gateway` RUNNING
since 2026-11-20, `podman.socket` listening, n1 §5, L114-115) with
mTLS (`openshell status` Connected, n1 §5, L112-113; n3 §5, L73).
Keep that: no new transport, no shim. Classification: safe-default.
Blocked work: none (A8 is the live-socket availability issue, not the
mechanism).

## 4. Persistence limits (n4.4 / SPE-37093) — safe-default

Default is sandbox-persists-until-down; disconnect+restart rebinds,
teardown only at realm down (n1 §7, L154; n2, L24-25 "disconnect+
restart; sandbox lives until realm down"; n2 U7, L97-101; n3 §2,
L52). Ownership: the Realm compute driver on the host owns the
container; the driver socket/config/image gate is the allocation
layer whose absence blocks live runs (n1 §6(a), L132-134; n2 U1,
L68-72). No new persistence decision is needed. Classification:
safe-default. Blocked work: only the A8 live-stack availability.

## 5. Worktree concurrency (n4.5 / SPE-37094) — discovery-first

CBIND-03 is locked, not open: cross-process workspace binding lock
landed `b3fc8b8` (n1 §1, L31) and 59 CBIND-01..03 is COMPLETE 5/5
with ratification D-v9-6 (n1 §3, L76). What is open is only whether N
worktrees can live in one sandbox, answerable without the owner from
these exact records first (n1 §7, L149; n2 L133): (1)
`.planning/phases/59-concurrent-binding-implementation/59-CONTEXT.md`
(59-CONTEXT, D-v9-6, n1 §3, L76); (2) `src/session/workspace-binding.ts`
(n2 U6, L94-96); (3) binding / 53-DESIGN records and
`src/session/` layout (n1 §7, L149; n1 §1, L16-18); (4)
`git log` `b3fc8b8` / CBIND-03 (n1 §1, L31). Until that discovery is
recorded, the registry-manifest design (n3 §4, L62) stays a proposal.
Classification: discovery-first. Blocked work: n2 S6 (L51).

## 6. Linear conventions (n4.6 / SPE-37095, part 1) — user-decision-required

Found: graph `ut-aec293bb48` = 7 parents SPE-37063..37069 + 45
sub-issues SPE-37070..37114, all Backlog (n1 §3, L64-66). Gap: the 52
cover the GoT plan n1..n7, not phase-native work; LINEAR_COMPLETENESS
("every phase ≥1 issue") is NOT MET (n1 §3, L84-86; n2 doctrine, L10-13
says they "cannot close a phase"). n2 already drafted phase-native
issues PN-55..59 (n2, L15-21), but creating them is a filing decision
for the owner. Classification: user-decision-required. Blocked work:
PN-55..59 creation; phase close-out cannot be tracked in Linear
without it.

## 7. Plugin language (n4.6 / SPE-37095, part 2) — safe-default

Node + TypeScript from the repo record: `engines node>=22.13.0`,
17 scripts (n1 §1, L10-14); TS strict + `noUncheckedIndexedAccess` +
`exactOptionalPropertyTypes` + `noUnusedLocals` (n1 §1, L41-42);
observed Node v24.18.0, CI matrix 22.x+24.x (n1 §1, L47-48).
Default: write the plugin in TypeScript for Node 22+, shipped inside
this repo (`private: true`, n1 §7, L152; n2, L26-27). No language
choice is open. Classification: safe-default. Blocked work: none.

## 8. Owner-decision brief (n4.7 / SPE-37096)

### A1. Topology: one warm sandbox per repo, or a fresh one per session?

You must arbitrate overruling the current ratified rule (one sandbox
per session) in favour of one shared sandbox per repo. Recommended:
approve one-per-repo, because sessions of the same repo then reuse a
warm container and steady-state cost drops (n3 §7, L100-108).
Alternative: keep one-per-session for clean isolation per run; cost
is a fresh container every session and it re-hits the gate that
already blocks live work (n3 §3, L53). Gate effect: n5 design cannot
start on provisioning (n2 S4, L49) until this closes.

**Owner decision (2026-11-23): APPROVED — one sandbox per repo
(Branch A repo-keyed).** Provisioning design branches resolved to
Branch A; Branch B dropped as fallback only.

### A3. Hosted or Library: where does the agent runner live?

You must close the mode choice left open in the design record
(`agentos.md:30`, n1 §5, L124-125). Recommended: keep the settled
hosted arrangement (gateway on host, runner inside the sandbox),
because n1 §5 shows that layering is already correct and the actual
failure is the allocation gate, not the protocol (n1 §6(a), L132-134;
n3 §5, L72). Alternative: Library mode or a shim; neither is needed
unless a live re-check convicts the session layer itself, which would
flip the whole comparison (n3 §8, L147-156). Gate effect: n5 design
must not start until this closes (n1 §6, L139; n3 §8, L144-146).

**Owner decision (2026-11-23): KEEP HOSTED.** Settled layering
confirmed; no Library mode, no shim.

### A14. Should phases 55–59 get their own tracker rows?

Today all 52 tracker rows describe the GoT plan, so phases 55–59 have
no phase-native row and cannot be closed out (n1 §3, L84-86).
Recommended: file the five drafted phase-native rows PN-55..59
(n2, L15-21), because close-out and carried-window tracking then has
a home and no GoT row is duplicated (n2, L29-37). Alternative: stay
GoT-only; phase close-out then lives only in `.planning/` files.
Gate effect: blocks only Linear tracking, not n5 design.

Gate consequence (A1 + A3): n5 design is blocked until both close —
without topology sign-off the n3 combination "is invalid even if
every technical argument holds" (n3 §7, L117-121), and without the
Hosted-vs-Library choice the gate "holds provisionally on (a) and is
blocked by (b)" (n3 §8, L144-146).

## 9. Sediment summary

| A# | Question | Classification | Blocked work | Next action |
|----|----------|---------------|--------------|-------------|
| A1 | Topology 1-per-repo vs 1-per-session | user-decision-required | n5 (S4), n3 combination validity | Owner decision (Section 8) |
| A2 | Multi-worktree-in-one-sandbox | discovery-first | S6 | Read 4 records in Section 5 |
| A3 | Hosted-vs-Library | user-decision-required | n5 design start | Owner decision (Section 8) |
| A4 | Trigger payload | SETTLED (safe-default) | None (S8 wiring only) | Implement per `tools.schema.json` |
| A5 | Plugin distribution | safe-default | None (S10 pack check) | Ship in-repo, `private: true` |
| A6 | Grok Bot vs Build naming | discovery-first | S9 | Check hosts/adapters for a Bot surface first |
| A7 | Persistence scope | safe-default | None (S7) | Sandbox persists until down |
| A8 | Realmlive gate-block (allocation) | discovery-first | PN-56/57/58 live windows, S1 | Bring realmlive socket/config/image up (n2 S1, L46) |
| A9 | CAPT-09 hygiene | safe-default | S1 (clean tree) | Hygiene in uncommitted docs only |
| A10 | 17-vs-22 GSD parity | discovery-first | S9 | Record delta, not adjudicated (n1 §4) |
| A11 | Pending-trio recipes | discovery-first | S9 | Disposition from `hosts.md:49` |
| A12 | Journal GC / retention | discovery-first | S8 / axis-5 design | Price retention before implementing the journal |
| A13 | Manifest consistency | discovery-first | S5/S6 manifests | Extend CBIND-03 locking to the manifest |
| A14 | Linear phase-native conventions | user-decision-required | PN-55..59 filing | Owner decision (Section 8) |
| A15 | Connection / auth (mTLS, user socket) | safe-default | None | Keep settled layering (Section 3) |
| A16 | Plugin language (Node 22/TS) | safe-default | None | TypeScript on Node 22+ |

Counts: discovery-first 7 (A2, A6, A8, A10, A11, A12, A13);
user-decision-required 3 (A1, A3, A14); safe-default incl. SETTLED 6
(A4, A5, A7, A9, A15, A16). Blocking n5: A1 and A3 only. A8 blocks
live windows (PN-56/57/58), not n5 design, except through A3.
