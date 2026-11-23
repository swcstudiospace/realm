# UNITY n1 — Ground Truth Record

Date: 2026-11-23. Branch: `swarm/Tb559r-fe`. HEAD: `4f379da`.
Graph: `ut-aec293bb48` (SPE-37063, spec graph). This file is the annex
supplying n2/n3 inputs; unverified items are marked inline as
"not verified". No builds/tests/gates were run for this record.

## 1. Repository layout (n1.1, SPE-37075)

`package.json`: `agent-realm` 0.9.6, `private: true`, engines
`node>=22.13.0`; 17 scripts: typecheck, lint, test, test:integration,
test:coverage, build, test:scripts, check:docs, check:mcp, check:pack,
check:image-digests, build:image, check:gates, check:breaking,
release:next, release:sync, release:changelog.

Top-level: `src/` (acp, audit, capability, cli, contract, core, daemon,
doctor, fs, host, lifecycle, mcp, observe, omp, realm, runtime, session,
tools), `test/`, `scripts/` (check, docs, image, mutation, release,
spike), `docs/` (adr, architecture, data, frontend, hosts, integration,
requirements, specs, ux), `adapters/` (claude-plugin, hermes-agent,
muse-code, omp, prime-agent), `sandbox/`, `release/`, `site/`,
`assets/`, `licenses/`. Remote: `https://github.com/swcstudiospace/realm.git`.

HEAD `4f379da`; `git log --oneline -7` verbatim:

```text
4f379da feat(omp): render ultrathink advisory and reload-resume surfaces (W3 matrix)
b37b94c phase56: emit daemon.stopped causeCode; window blocked, F-51-1 carried
4dc5540 Merge remote-tracking branch 'origin/main'
31dfcd6 chore(release): v0.9.6 [skip ci]
b3fc8b8 feat(binding): cross-process workspace binding lock (CBIND-03) (#254)
c7d3f04 docs(verify): phases 44+55 re-verified at main 7ae9afc
b7002a5 docs(verify): re-verify phases 20-43 at main 7ae9afc (full suite 5849 pass)
```

7 commits ahead of main (per graph brief; `git log main..HEAD` count
not verified in this record beyond the -7 listing above).

## 2. Toolchain and measured baseline (n1.2, SPE-37074)

TypeScript strict + `noUncheckedIndexedAccess` +
`exactOptionalPropertyTypes` + `noUnusedLocals`; ESLint 10.13.0
`typescript-eslint` strictTypeChecked; `node --test` on
`dist/test/**`; fast-check 4.10.2. CI `verify` job verbatim: `npm ci`;
typecheck; lint; test; test:coverage 22x; test:integration;
test:scripts; check:docs; check:gates; build; check:pack; check:mcp —
plus `site` and `audit` jobs. Runtime: Node v24.18.0 observed, CI
matrix 22.x + 24.x.

Measured 2026-11-23 on the dirty tree: typecheck exit 0 (52s), lint
exit 0 (72s), build exit 0 (32s), test 5867 pass / 1 fail / 97 skip
(5965 tests, 117.7s runner), test:scripts 538 pass exit 0.

The one failure is CAPT-09
(`dist/test/docs/capability-token-doc.test.js:190`) matching
`/\/root\//`, root-caused to absolute `/root/src/repos/claude-ultrathink`
and `/root/.omp/agent/ultrathink/sessions/` strings in UNCOMMITTED
docs (`docs/requirements/spec.md`, `docs/architecture/blueprint.md`
diffs) — the committed tree has none (prior re-verify b7002a5: full
suite 5849 pass at 7ae9afc). The 97 skips are Podman-gated/live.

## 3. Linear reconciliation (n1.3 SPE-37072 + n1.4 SPE-37071)

Graph `ut-aec293bb48`: 7 parents SPE-37063..37069 + 45 sub-issues
SPE-37070..37114 (SPE-37069 → SPE-37114), all Backlog 2026-11-23,
linked in the spec ISSUES block.

Outstanding-phase coverage (rows exactly as reconciled):

| Phase | Outcome | Linear |
|-------|---------|--------|
| 55 HEALTH-01/02 | COMPLETE (55-VERIFICATION passed 2026-11-22, main 7ae9afc) | NO ISSUE |
| 56 STOP-05/06 | Code landed (b37b94c causeCode + stopCauseOf); live 20-iteration window NOT RUN (56-WINDOW blocked at production gate 2026-11-22) ⇒ CARRIED | NO ISSUE |
| 57 HTIER-01 | Instrument present; live rerun skipped at gate ⇒ CARRIED (GAP-40-01/48-01 residual) | NO ISSUE |
| 58 KIMV-02 | Recorder fixed + scratch reinstall verified; live rerun blocked ⇒ CARRIED (GAP-43-03 narrowed) | NO ISSUE |
| 59 CBIND-01..03 | COMPLETE (59-VERIFICATION passed, 5/5 criteria; ratification D-v9-6 cited in 59-CONTEXT — verified by reading `.planning/phases/59-concurrent-binding-implementation/59-CONTEXT.md` 2026-11-20/22) | NO ISSUE |

Within-graph orphans: NONE. Workspace-orphans (SPE-36553/54/62,
SPE-36729/30, SPE-36951…) NOT CENSUSED (parent enumerated none beyond
these samples; not verified). Duplicates: NONE within graph.
Stale/done-but-open: graph rows all Backlog; no done-but-open observed
among the 52.

Conclusion: criterion LINEAR_COMPLETENESS (every phase ≥1 issue) NOT
MET; the 52 cover the GoT plan (n1..n7), not phase-native work — n2
must address.

## 4. CLI agent set (n1.5, SPE-37073)

22 ids (`src/host/runtimes.ts:98-351`, types `src/host/types.ts:13-36`):
omp [reference], claude, opencode, kilo, codex, copilot, antigravity,
cursor, windsurf [pending], augment, trae [pending], qwen, hermes,
codebuddy, cline, kimi, kimi-code, zcode [pending], pi, muse-code,
prime-agent, grok-build — 19 recipe, 3 owner-deferred
(windsurf/trae/zcode, `docs/integration/hosts.md:49`).

5 adapters (`adapters/`: claude-plugin, hermes-agent, muse-code, omp,
prime-agent); Grok shares claude-plugin (`hosts.md:10`). GSD-Core
GitHub: `https://github.com/open-gsd/gsd-core` (default_branch `next`,
captured 2026-11-23); current `next` doc `install-on-your-runtime.md`
lists 17 runtime sections (no hermes/omp/muse-code/grok-build/
prime-agent). Realm snapshot 2026-11-16 counted 18 incl. hermes +
kimi-code (`runtimes.ts:2`, commit 69d604e) — delta recorded, not
adjudicated. "Grok Bot" as distinct host/binary: not verified
anywhere. Omp = extension bundle-copy (reference); Grok Build =
toml-table `realm mcp --host grok-build`; Muse Code = json-merge
`mcpServers.realm` required:true — all three ARE in the 22 (GoT trio
covered 3/3).

## 5. Environment and AgentOS (n1.6 SPE-37070 + n1.7 SPE-37076)

Probes ran as root: openshell 0.1.5 at `/usr/bin/openshell`,
`openshell status` Connected (mTLS); podman default
`/usr/bin/podman` 4.9.3, `/usr/local/bin/podman` 5.7.1; user manager:
openshell-gateway RUNNING since 2026-11-20, podman.socket listening;
system: realm-root gateway/compute-driver/podman units present;
realmlive account stack DOWN (no socket dir, openshell
not_configured — 56/57-WINDOW 2026-11-22).

AgentOS integration (settled layering, evidence): OpenShell gateway
runs on host; Realm compute driver creates the session container;
AgentOS runner is an in-sandbox managed `openshell sandbox exec` child
(`runtime-decision.md`: gateway-on-host; `openshell.md:442-446,451,160`;
`agentos.md:21-30` Hosted-vs-Library mode choice recorded UNRESOLVED
at `agentos.md:30`). Verdict: there is NO separate `agentos` host
binary (`which agentos` empty); the GoT premise "OpenShell inside
AgentOS" INVERTS this layering (session-process).

## 6. Failure classification (n1.7)

The OpenShell-on-AgentOS "does not operate" decomposes into:
(a) LIVE-WINDOW BLOCK: production gate (REALM_DRIVER_SOCKET/CONFIG/
IMAGE + realmlive stack) cannot open ⇒ allocation layer, NOT
OpenShell protocol; root stack healthy. (b) MODE CHOICE: Hosted vs
Library unresolved ⇒ design decision, not a reproduction.
(c) CAPT-09 host-path failure on dirty tree ⇒ docs-lane hygiene,
negligible. NO single failing-layer root cause is established beyond
(a)+(b) — the reproduction criterion ("exact failing layer named")
is PARTIALLY met; n5 design is gated on re-opening (b) with the owner.

Dirty tree (19 M + 14 ?? incl. docs bundle + ADRs) listed as present,
foreign, EXCLUDED from this run, with the CAPT-09 cause (§2).

## 7. Open questions carried to n4

| Question | Disposition | Why |
|----------|-------------|-----|
| Topology 1-sandbox-per-repo vs Realm settled 1-per-session | user-decision-required | Settled decision record cited contradicts; owner must arbitrate changing a ratified record. |
| Multi-worktree-in-one-sandbox | discovery-first | Answerable from binding / 53-DESIGN records; no owner input needed. |
| Hosted-vs-Library | user-decision-required | Unresolved at `agentos.md:30`; design fork only the owner can close. |
| Trigger payload | SETTLED (not open) | Edits plus argv commands, `tools.schema.json`. |
| Plugin distribution | safe-default | In-repo, `private: true` package; no external distribution needed. |
| Grok Bot vs Build naming | discovery-first | Check hosts/adapters for any distinct Bot surface before asking. |
| Persistence scope | safe-default | Matches sandbox-persists-until-down; no new decision needed. |
