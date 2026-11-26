# UNITY n5 — Conditional Design (SPE-37097..37102)
Date: 2026-11-23. Branch: `swarm/Tb559r-fe`. Graph: `ut-aec293bb48`.
Sole inputs: n1 `UNITY-n1-GROUND-TRUTH.md`, n2 `UNITY-n2-DECOMPOSITION.md`,
n3 `UNITY-n3-COMPARISON.md`, n4 `UNITY-n4-AMBIGUITIES.md`. Design record
only: no code, tests, or gates. Every claim cites section + line.
A1 (topology) and A3 (Hosted-vs-Library) are owner-decision gaps blocking
provisioning start (n4 L137-141); gated parts are marked
`[PENDING A1]` / `[PENDING A3]` and never presented as decided.

## 1. Diagnosis gate (n5.1)

The n1 §6 failure classification decomposes "does not operate" into
three layers (n1 §6, L131-139). This design is gated on that
classification, not on a single root cause (n1 §6, L138-139).

**(a) ALLOCATION layer — named failing layer.** The LIVE-WINDOW BLOCK
is the production gate: `REALM_DRIVER_SOCKET` / `CONFIG` / `IMAGE` plus
the realmlive stack cannot open, so container allocation fails while
the root stack is healthy (n1 §6(a), L132-134). Root stack is healthy:
openshell 0.1.5 `Connected` (mTLS), podman 4.9.3 / 5.7.1, user-manager
`openshell-gateway` RUNNING since 2026-11-20, `podman.socket`
listening (n1 §5, L112-115). The realmlive account stack is DOWN: no
socket dir, openshell `not_configured` (n1 §5, L117-118). This is an
allocation-layer failure, NOT an OpenShell protocol failure
(n1 §6(a), L133-134; n3 §5, L72).

**(b) MODE CHOICE — UNRESOLVED `[PENDING A3]`.** Hosted-vs-Library is
unresolved at `agentos.md:30` (n1 §5, L124-125; n1 §7, L150). It is a
design decision, not a reproduction (n1 §6(b), L135). Owner must close
it before provisioning design can be finalised (n3 §8, L144-146).

Fix-at-allocation compatibility: the native root-cause fix (repair
driver socket/config/image + realmlive stack; keep settled layering)
is recommended on axis 4 (n3 §5, L72). That fix is compatible with
BOTH mode branches — it repairs the gate that blocks allocation
(n1 §6(a), L132-134) without assuming a Hosted or Library runtime, so
it proceeds regardless of the `[PENDING A3]` outcome.

Re-open condition: if a live re-check convicts the session layer
itself (e.g. in-sandbox `openshell sandbox exec` child failing under
Library mode, or `openshell.md:442-446` diverging from the settled
record), axis 4 inverts and n3 must be re-opened (n3 §8, L147-156).
The settled layering is gateway-on-host, driver-created container,
in-sandbox runner (n1 §5, L120-123); no `agentos` host binary exists,
`which agentos` empty (n1 §5, L125-127).

## 2. Repository identity (n5.2)

Canonical identity is the remote URL plus a normalized path. The
observed remote is `https://github.com/swcstudiospace/realm.git`
(n1 §1, L22). Normalization: strip trailing `.git` and trailing slash,
lowercase host, resolve `.` / `..` in the path, drop query/fragment.
Fallback rule: if no remote exists, use the verified local identity —
absolute worktree root resolved through symlinks, plus `HEAD` commit
as a non-identity freshness field only (identity = resolved path).
Fallback isolation risk: two clones of the same repo at different paths
get different identities (split sandboxes, wasted allocation on the
layer already blocked per §1(a)); conversely a moved/cloned path can
collide. Fallback registrations MUST be flagged `identity: local` in
the manifest so a later remote discovery can re-key without merging
foreign state.

Idempotency: provisioning is create-once or attach-on-repeat. A repeat
run with the same canonical identity attaches to the existing sandbox
and manifest entry; it MUST NOT create a duplicate sandbox, mount, or
manifest entry. This follows the repo-identity-keyed rationale that
reuse amortises creation across sessions of one repo (n3 §3, L52).

## 3. Provisioning — PARTIAL `[PENDING A1]`

Topology is user-decision-required: 1-sandbox-per-repo contradicts the
settled 1-per-session record and needs owner arbitration to change a
ratified record (n1 §7, L148; n3 §7, L117-121). Both branches below
specify create / attach / teardown-explicit, scoped to one repo/sandbox
and never affecting other repos.

**Branch A — repo-keyed (n3 axis 2, recommended).** One sandbox per
repo, keyed by the §2 canonical identity; sessions attach (n3 §3,
L52). Create: only when no live sandbox exists for the key. Attach: a
session binds to the existing container via the manifest entry (§4).
Teardown-explicit: only an explicit operator/driver action tears down;
disconnect NEVER tears down (persistence default, §6). Feeds n2 unit
S4 (provisioning spec, n2 L49) and U4 (n2 L83-87).

**Branch B — name-based / 1-per-session (settled record).** One
sandbox per named session run, matching the ratified 1-per-session
record (n1 §7, L148; n3 §3, L53). Create: per session name, absent key.
Attach: only same-named runs reattach; cross-session attach forbidden.
Teardown-explicit: per-session explicit teardown; ending one session
never touches another repo or session. Cost: fresh container per
session, re-hitting the blocked allocation gate (§1(a)) (n3 §3, L53).
This branch is the fallback if the owner rejects repo-keying
(n3 §3, L53). Feeds the same n2 unit S4 (n2 L49), with the provision
spec recording the 1-per-session decision instead (n2 L49).

Branch selection itself is `[PENDING A1]` (ledger P-A1-1); S4
implementation start is gated on it (P-A1-2).

## 4. Filesystem layout (n5.3)

Registry-manifest-per-project-per-worktree is the selected axis-3
model: manifest records project → worktree → sandbox binding (n3 §4,
L62). Layout:

| Location | Contents |
|---|---|
| Registry manifest at root | One entry per repo identity (§2), holding repo key and project pointer |
| Per-project root | Project entry: sandbox handle, lifecycle state (§5), worktree list |
| Per-worktree subdirectory | One subdir per worktree: binding record, journal pointer (§7), scoped checkout |

Rules: paths MUST be validated and non-traversable — reject any
registration whose normalized path escapes the project root (`..`,
symlink escape, absolute-path injection). Per-project read/write
boundaries: edits outside the bound worktree are rejected, never
clamped silently (n2 S5 acceptance, n2 L50; conflicts reject with
`LOCK_CONFLICT`, n2 L23-27). A stale or conflicting registration
(dead sandbox handle, duplicate repo key, mismatched worktree) is
REJECTED and reported — reported as an explicit error naming the
identity, never silently overwritten or merged. The manifest is the
artifact that makes partial-failure safety auditable: a binding entry
survives a crashed session for reconciliation (n3 §4, L62).

Note A13: the manifest must be locked and reconciled — CBIND-03
machinery must be extended, not assumed (n3 §7, L122-126; n4 L29).
Note A2: multi-worktree discovery is pending (n1 §7, L149; n4 §5,
L69-78) — the layout is designed to absorb either answer: if N
worktrees per sandbox is proven, worktree subdirectories multiply
under one project entry; if only one worktree per sandbox is proven,
each project entry holds exactly one subdirectory, with no layout
change to the manifest schema.

## 5. State machine (n5.4)

States: provisioning → ready → connected ⇆ disconnected →
reconnecting → connected; any live state → degraded → failed;
explicit teardown from any state → torn-down. Timeouts: provisioning
and reconnecting time out into `failed` with the cause recorded;
degraded is entered on partial evidence (one worktree or one probe
failing while others succeed), never on a fully empty probe.

Empty states report empty, not error: no worktrees, no triggers, and
no manifest entries yield an explicit `empty` observable with exit 0,
distinct from a failed probe (exit non-zero + cause).

| State | Evidence (status/log sample) | Observable |
|---|---|---|
| provisioning | driver create log line; no container id yet | `provisioning` + repo key; no session attachable |
| ready | container id present; gateway `Connected` (n1 §5, L112-113) | `ready`; attach allowed |
| connected | in-sandbox exec probe exit 0 (n1 §5, L122-123) | `connected`; triggers accepted |
| disconnected | control socket closed; container id still present | `disconnected`; state retained, rebind offered |
| reconnecting | reattach attempt + probe; bounded attempts (§7 retry rule) | `reconnecting`; no new triggers queued as applied |
| degraded | ≥1 worktree/probe failing, others exit 0 | `degraded` + failing scope named |
| failed | timeout or terminal cause line (socket/config/image absent, §1(a)) | `failed` + cause + remedy pointer (§7) |
| torn-down | explicit teardown record; container id absent | `torn-down`; manifest entry tombstoned, not deleted |

## 6. Connect / disconnect / reconnect (n5.5)

Mechanism (settled, safe-default): user-only control socket —
user-manager gateway RUNNING, `podman.socket` listening (n1 §5,
L114-115) — with mTLS (`openshell status` Connected, n1 §5, L112-113),
and the AgentOS runner as an in-sandbox managed
`openshell sandbox exec` child (n1 §5, L122-123; n4 §3, L44-50). No
new transport, no shim — a shim is rejected as inventing a layer that
does not exist (n3 §5, L73). Credentials come from the environment
only; no secrets appear in logs or artifacts. Which mode the runner
is hosted in remains `[PENDING A3]` (ledger P-A3-1) but does not
change the socket / mTLS / exec-runner mechanism above.

Persistence (A7 safe-default): sandbox persists until down —
disconnect + restart rebinds, teardown only at realm down
(n1 §7, L154; n2 L24-25; n4 §4, L56-63). The Realm compute driver on
the host owns the container (n4 §4, L60-61). Sandbox lifetime policy
under each topology branch is `[PENDING A1]` (ledger P-A1-4).

## 7. Trigger-change (n5.6)

Payload is SETTLED: edits plus argv commands per `tools.schema.json`
(n1 §7, L151; n4 §2, L36-39), falsely open elsewhere — never
re-designed. Each trigger carries an idempotency key derived from the
manifest entry (n3 §6, L82); the journal is written BEFORE execution
so a crash leaves a detectable, recoverable partial state (§5
`failed`/`degraded` with journal pointer). Outcomes are recorded
per worktree, so one failing worktree yields `degraded`, not a global
failure. Retry is bounded and transient-only: allocation/gate
failures (§1(a)) are retryable (n3 §6, L82); validation and hygiene
failures (e.g. CAPT-09 host-path, n1 §6(c), L136-137) MUST NOT be
retried (n3 §6, L83). Journal retention/GC is unpriced (A12, n4 L28)
and must be priced before the journal is implemented.

Failure modes (cause → state → operator remedy):

| Failure mode | Cause | State | Operator remedy |
|---|---|---|---|
| Sandbox crash | container died; manifest entry survives (n3 §4, L62) | `failed` (journal = partial) | Re-provision by repo key (§3 branch in force); re-attach reuses journal |
| Runtime not starting | driver socket/config/image absent (§1(a)) | `provisioning` → `failed` | Bring realmlive stack up (n2 S1, L46); bounded retry only |
| FS unavailable / full | bound worktree unmounted or disk full | `degraded` → `failed` | Free space / remount; rejected registration reported, not merged (§4) |
| Stale registration | dead sandbox handle or duplicate repo key | `degraded` | Reconcile/expire manifest entry under extended CBIND-03 lock (A13); re-register |
| Dropped connection mid-trigger | control socket closed during exec | `disconnected` → `reconnecting` | Reattach (§6); journal + idempotency key make replay a no-op if already applied |
| AgentOS-host unavailable | gateway or in-sandbox runner unreachable | `degraded` | Check user-manager gateway (n1 §5, L114-115); exact remedy depends on chosen mode `[PENDING A3]` (P-A3-2) |

Mode-conviction re-open: any live reproduction convicting the
session layer re-opens n3 per §1 (ledger P-A3-2).

## Gate ledger

| # | Gated item | Tag | Status |
|---|---|---|---|
| 1 | Mode choice: Hosted-vs-Library closed (§1(b), §6) | KEEP HOSTED 2026-11-23 |
| 2 | Live session-layer re-check verdict; n3 re-open trigger (§1, §7) | KEEP HOSTED — re-check is ordinary live validation |
| 3 | AgentOS-host-unavailable remedy per chosen mode (§7) | Closed — hosted-path remedy |
| 4 | Topology branch A (repo-keyed) vs B (1-per-session) selected (§3) | BRANCH A APPROVED 2026-11-23 |
| 5 | S4 provisioning implementation start (n2 L49) (§3) | UNBLOCKED |
| 6 | Manifest repo-key binding key under chosen branch (§4) | UNBLOCKED |
| 7 | Sandbox lifetime / teardown scope per branch (§5, §6) | UNBLOCKED |
