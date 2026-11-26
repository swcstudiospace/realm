# UNITY n3 — Comparison Matrix (SPE-37082..37088)

Date: 2026-11-23. Branch: `swarm/Tb559r-fe`. Graph: `ut-aec293bb48`.
Input: `.planning/UNITY-n1-GROUND-TRUTH.md` (n1, HEAD `4f379da`) — sole
fact source; no facts re-derived here. Axes: n3.1 adapter isolation,
n3.2 sandbox lifecycle, n3.3 filesystem/worktree, n3.4 OpenShell-on-
AgentOS integration, n3.5 trigger/retry, n3.6 synthesis, n3.7 selection.
Each table row: verdict (Recommends / Defers / Rejects) + evidence.

## 1. Framing (n1 facts that constrain every option)

Realm hosts 22 CLI ids (`src/host/runtimes.ts:98-351`, types
`src/host/types.ts:13-36`, n1 §4): omp [reference], claude, opencode,
kilo, codex, copilot, antigravity, cursor, windsurf [pending], augment,
trae [pending], qwen, hermes, codebuddy, cline, kimi, kimi-code, zcode
[pending], pi, muse-code, prime-agent, grok-build — 19 recipe plus 3
owner-deferred (windsurf/trae/zcode, `docs/integration/hosts.md:49`).
Five adapters exist (`adapters/`: claude-plugin, hermes-agent,
muse-code, omp, prime-agent); Grok shares claude-plugin (`hosts.md:10`),
so adapter count (5) is deliberately far smaller than host count (22,
n1 §4). Settled layering (n1 §5, SPE-37070): the OpenShell gateway
runs on host, the Realm compute driver creates the session container,
and the AgentOS runner is an in-sandbox managed `openshell sandbox
exec` child (`runtime-decision.md`; `openshell.md:442-446,451,160`;
`agentos.md:21-30`) — there is no separate `agentos` host binary
(`which agentos` empty, n1 §5), and the GoT premise "OpenShell inside
AgentOS" inverts this layering. The live-window block is a production
gate, not a protocol failure: phases 55–59 live reruns were blocked at
the production gate (REALM_DRIVER_SOCKET/CONFIG/IMAGE + realmlive
stack DOWN, n1 §5, §6(a)) while the root stack (openshell 0.1.5
Connected, podman 4.9.3/5.7.1, gateway RUNNING since 2026-11-20) is
healthy. Trigger contract is SETTLED (n1 §7): edits plus argv
commands per `tools.schema.json` — not open for redesign. Every option
below is therefore judged against: 22-host breadth with 5 thin
adapters, host-gateway/in-sandbox-runner layering, an allocation-layer
gate block, and a fixed trigger payload.

## 2. Axis 1 — Adapter isolation (SPE-37082)

| Option | Verdict | Evidence |
|---|---|---|
| Shared-contract thin adapters (one contract, per-host recipe/toml/json-merge; bundle-copy reference) | Recommends | Matches n1 §4: 22 hosts / 5 adapters; omp bundle-copy, grok-build toml-table, muse-code json-merge are already thin, divergent only in mechanism. `runtimes.ts:98-351` + `types.ts:13-36` centralise recipes, so a shared contract scales to 19 recipe hosts without 19 codebases. Deferred trio stays cheap: recipes exist but are owner-gated (`hosts.md:49`), so thinness costs nothing yet. |
| Forked adapters (full per-host adapter codebase) | Rejects | Contradicts n1 §4's 5-adapter / 22-host ratio: forking multiplies maintenance 4–5x for hosts (e.g. kimi vs kimi-code, n1 §4 delta) that differ by invocation, not contract. No n1 evidence of contract divergence requiring fork; GSD-Core `next` doc lists only 17 runtime sections, fewer than Realm's 22 (n1 §4). Cost would be paid on every host addition with zero observed benefit. |
| Generic shell wrapper (one wrapper shelling all hosts uniformly) | Rejects | n1 §4 mechanisms are irreconcilable through a shell: muse-code requires json-merge `mcpServers.realm` required:true, grok-build a toml-table, omp a bundle-copy — a generic wrapper would encode all three as special cases anyway (i.e. it becomes thin adapters, badly). It also breaks the doctor/observe surfaces n1 §1 shows in `src/` layout. Uniformity here is false economy. |

Selected on this axis: shared-contract thin adapters.

## 3. Axis 2 — Sandbox lifecycle (SPE-37083)

| Option | Verdict | Evidence |
|---|---|---|
| Repo-identity-keyed (one sandbox per repo, keyed by repo id; sessions attach) | Recommends | Matches the n3.7 brief's one-sandbox-per-repo rationale and n1 §7's open topology question, framed as a lifecycle choice: identity-keyed reuse amortises container creation across sessions of the same repo. n1 §5 shows the driver already creates session containers under a host gateway, so keying by repo is a driver-side policy change, not a new primitive. n1 §7 persistence-scope default (sandbox-persists-until-down) fits repo lifetime better than session lifetime. |
| Name-based (one sandbox per named session run) | Defers | Closest to Realm's settled 1-per-session record cited in n1 §7 — deferring, not rejecting, because the settled record is ratified and owner arbitration is required to change it (n1 §7, user-decision-required). Name-based gives clean isolation per run but recreates the container on every session, repeating the allocation cost the production gate already blocks on (n1 §6(a)). Keep as fallback if the owner rejects repo-keying. |
| Ephemeral-recreate (create per trigger, destroy after) | Rejects | Maximises the allocation-layer cost that n1 §6(a) identifies as the failing layer: every trigger would re-hit REALM_DRIVER_SOCKET/CONFIG/IMAGE and container creation. It also discards the persists-until-down default (n1 §7) and makes partial-failure recovery impossible (nothing to resume against). Rejected on cost and safety. |

Selected on this axis: repo-identity-keyed.

## 4. Axis 3 — Filesystem / worktree models (SPE-37084)

| Option | Verdict | Evidence |
|---|---|---|
| Registry-manifest-per-project-per-worktree (manifest records project → worktree → sandbox binding) | Recommends | n1 §7 puts multi-worktree-in-one-sandbox in discovery-first (answerable from binding / 53-DESIGN records, no owner input) — a manifest is the artifact that answers it audibly. It gives partial-failure safety: a binding entry survives a crashed session and can be reconciled, unlike a bare directory. It also composes with repo-identity-keyed lifecycle (axis 2): the manifest's repo key is the binding key. |
| Single shared checkout (all sessions share one working tree) | Rejects | n1 §7's settled 1-per-session record and the 59 CBIND-01..03 cross-process workspace binding lock (n1 §3, COMPLETE, 5/5 criteria) exist precisely because concurrent sessions on one checkout are unsafe. A shared checkout reintroduces the races CBIND-03 fixed. Rejected on concurrency safety. |
| Native git-worktree mounts (rely on `git worktree` mounts, no Realm manifest) | Defers | Viable mechanically, but n1 evidence points the other way: binding is a Realm-level concept (59-CONTEXT ratification D-v9-6, n1 §3), so raw git worktrees would duplicate binding logic outside the lock. Defer until the discovery-first multi-worktree question (n1 §7) is answered; then adopt as the subtree representation under the manifest, not as a replacement for it. |

Selected on this axis: registry-manifest-per-project-per-worktree.

## 5. Axis 4 — OpenShell-on-AgentOS integration (SPE-37085)

| Option | Verdict | Evidence |
|---|---|---|
| Native root-cause fix in the allocation/gate layer (fix driver socket/config/image + realmlive stack; keep settled layering) | Recommends | n1 §6(a) decomposes the failure: LIVE-WINDOW BLOCK is the allocation layer, NOT OpenShell protocol, root stack healthy (openshell 0.1.5 Connected, n1 §5). The settled layering (gateway-on-host, AgentOS in-sandbox runner, n1 §5) is already correct, so the fix belongs where the failure is. `openshell.md:442-446,451,160` and `runtime-decision.md` already describe this architecture; no inversion needed. |
| Sidecar-shim (a shim container translating between AgentOS and OpenShell) | Rejects | n1 §5: there is no `agentos` host binary to shim against (`which agentos` empty) — the shim would invent a layer that does not exist. It adds an mTLS/transport hop (gateway already uses mTLS, n1 §5) without naming a failing layer, violating the n1.7 reproduction criterion (n1 §6). Rejected as unprincipled. |
| Bypass-AgentOS (run agents directly on OpenShell, drop AgentOS runner) | Rejects | Contradicts the settled layering record (`agentos.md:21-30`, n1 §5) and the "AgentOS runner is an in-sandbox managed child" decision. The unresolved item is Hosted-vs-Library mode at `agentos.md:30` (n1 §5, §6(b)) — a mode choice inside AgentOS, not a reason to bypass it. Bypass would also orphan the trigger contract (`tools.schema.json`, n1 §7) hosted by that runner. |

Selected on this axis: native root-cause fix in the allocation/gate layer.

## 6. Axis 5 — Trigger / retry models (SPE-37086)

| Option | Verdict | Evidence |
|---|---|---|
| Idempotency-keyed journal + bounded transient-only retry | Recommends | Pairs with repo-keyed sandboxes (axis 2) and the registry manifest (axis 3): the journal key is the manifest entry, so a retried trigger re-attaches instead of duplicating work. It directly addresses n1 §6(a): allocation/gate failures are transient-class and safe to retry boundedly, while CAPT-09-class hygiene failures (n1 §6(c)) must not be retried. The settled trigger payload (edits + argv, `tools.schema.json`, n1 §7) is naturally journalisable. |
| Blind retry (retry any failure unboundedly) | Rejects | n1 §6 distinguishes failure classes (gate-block vs mode-choice vs docs-hygiene); blind retry would hammer the already-blocked production gate (REALM_DRIVER_SOCKET/CONFIG/IMAGE, n1 §6(a)) and re-run non-transient errors (e.g. CAPT-09 host-path, n1 §2) forever. Rejected on safety. |
| No-retry (single attempt, surface failure) | Defers | Safe but wasteful: the gate block in n1 §6(a) is transient by nature (stack down, not verdict), and phases 56–58 were CARRIED precisely because live windows were skipped at the gate (n1 §3) — no-retry would re-carry work that a bounded retry of transient allocation errors could complete. Defer as the conservative fallback if idempotency keys cannot be introduced. |

Selected on this axis: idempotency-keyed journal + bounded transient retry.

## 7. Selection — the n3 combination (n3.7, SPE-37088)

Recommended combination, one choice per axis:

| Axis | Selected option |
|---|---|
| 1. Adapter isolation | Shared-contract thin adapters |
| 2. Sandbox lifecycle | Repo-identity-keyed (one sandbox per repo) |
| 3. Filesystem / worktree | Registry-manifest-per-project-per-worktree |
| 4. OpenShell-on-AgentOS | Native root-cause fix in allocation/gate layer |
| 5. Trigger / retry | Idempotency-keyed journal + bounded transient retry |

Rationale. One-sandbox-per-repo (axis 2) gives every session of a repo
the same warm container, so the deferred-trio and 19-recipe breadth of
the 22-host table (n1 §4) costs no per-session creation. The registry
manifest (axis 3) turns that reuse into an auditable binding: repo key
→ project → worktree → sandbox, so a crashed session's next trigger
re-attaches to recorded state instead of orphaning it (partial-failure
safety). The idempotency-keyed journal (axis 5) is written against the
manifest entry, making duplicate triggers no-ops and bounding retries
to transient allocation errors only — the exact class n1 §6(a) names.
Thin adapters (axis 1) keep all 22 hosts expressible without forking,
and the native allocation fix (axis 4) repairs the layer n1 §6(a)
actually convicts instead of shimming around a layering that n1 §5
shows is already correct. Isolation is preserved because repo-keying
scopes sharing to one repo: different repos never share a sandbox, and
the CBIND-03 cross-process binding lock (n1 §3) still serialises
concurrent writers inside a repo.

Cost / trade-off paragraph. This combination is not free. One-sandbox-
per-repo deliberately contradicts Realm's settled 1-per-session record
(n1 §7 topology row: user-decision-required), so it requires owner
arbitration to change a ratified decision — without that sign-off the
combination is invalid even if every technical argument holds. Repo-
keyed reuse also lengthens sandbox lifetime, widening the blast radius
of a poisoned sandbox (a bad container now serves all sessions of that
repo until reaped) and making the registry manifest a consistency
surface that must itself be locked and reconciled — the CBIND-03
machinery must be extended, not assumed. The idempotency journal adds
a write on every trigger and a retention/GC policy that n1 never
prices. And the native allocation fix is the only axis-4 path that
re-opens the realmlive stack owned by a different team surface (n1 §5:
realmlive stack DOWN), so schedule risk concentrates exactly where the
production gate already blocked phases 56–58 (n1 §3). Net: lower
steady-state cost and far better failure semantics, at the price of
one ratified-record change, a longer-lived failure domain, and a new
consistency component.

## 8. Conditional gate (SPE-37087)

This selection is valid ONLY if the n1.7 failure classification names
the exact failing layer as the allocation/gate layer. Status per
n1 §6: PARTIALLY MET — n1 §6(a) identifies the allocation layer
(LIVE-WINDOW BLOCK: production gate cannot open, NOT OpenShell
protocol) but n1 §6(b) leaves Hosted-vs-Library unresolved at
`agentos.md:30` (n1 §5), and n1 §6 closes with "NO single failing-
layer root cause is established beyond (a)+(b)". The gate therefore
holds provisionally on (a) and is blocked by (b): n5 design must not
start until the owner closes the Hosted-vs-Library choice (n1 §7).
Re-opens the comparison if: the layer contradicts native hosting —
specifically, if re-opening (b) (or any new live reproduction) convicts
the OpenShell/AgentOS session-process layer itself (e.g. the in-
sandbox `openshell sandbox exec` child failing under Library mode, or
`openshell.md:442-446` behaviour diverging from the settled record),
then axis 4's verdict inverts: the sidecar-shim or mode-flip options
must be re-tabled, the allocation fix is demoted to necessary-but-
insufficient, and axes 2/3/5 must be re-checked for assumptions that
depended on the settled gateway-on-host layering (n1 §5). Absent such
a contradiction, the §7 combination stands.
