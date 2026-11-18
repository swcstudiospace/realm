# Milestone v5.0 context: Cold attach, enforced capability tokens and evidence

The v3.0 context (owner decisions D1 to D6 of 2026-10-29) is archived at `.planning/milestones/v3.0-MILESTONE-CONTEXT.md`. This file holds v5.0 only.

Scope source: the owner's decisions of 2026-11-18 (below), the v4.0 audit (`.planning/milestones/v4.0-MILESTONE-AUDIT.md`, the accepted limitations of Phases 31 and 32), the gap row `GAP-31-04` in `docs/integration/host-plugin-gaps.md`, and the v1.0 open items listed in `.planning/milestones/v1.0-MILESTONE-AUDIT.md`. Planners and executors read those files; they do not work from memory.

## Goal

A host with a 30 second connect timeout connects to `realm mcp` on a cold start. Capability tokens are on by default, so a stale or unlabelled client is refused with a clear message and every shipped client works. The token claims are backed by a non-root run, a recorded memory-read probe and a live enforce proof on the production stack. The v1.0 live items this host can run are re-verified with dated evidence or carried with a named reason, and the product spec stops describing the removed Anda bridge.

## Release line

The release line is 0.5.x. `release/milestone.json` is `{"milestone":"v5.0","minor":5}`; the owner approved that exact one-line change on 2026-11-18. Phase 34 is a breaking change: its commits use `!` in the subject (for example `feat(capability)!: ...`) so the release notes list them.

## Owner decisions (2026-11-18, HITL)

- **D-v5-1, start milestone v5.0** "Cold attach, enforced capability tokens and evidence", phases 33 to 37, numbering continues from Phase 32.
- **D-v5-2, serve early (Phase 33):** `realm mcp` (`src/cli/stdio-host.ts`) answers the MCP handshake (`initialize`, `server/discover`, `tools/list`) before `ensure` and `up` complete. Until the session is ready it reports the realm as not active, using the existing status vocabulary, and refuses tool calls with the existing not-active refusal (fail closed). This closes `GAP-31-04`. The claude, opencode and codex production tiers are re-proved cold, with the warm-up removed from the test harness (`test/support/host-live.ts`).
- **D-v5-3, enforce by default (Phase 34):** the default of `capabilityTokens.mode` becomes `enforce`. This is breaking: stale or unlabelled clients are refused. The migration path is a documented policy value that opts out (`"mode": "off"`), doctor guidance and a clear refusal message. Every in-repo client (stdio hosts, Omp, ACP, `realm mcp`) attaches under enforce. The schema, defaults, docs and tests change together.
- **D-v5-4, evidence (Phase 35):** a non-root end-to-end run of the token tests on a host with `ptrace_scope` 1; the `/proc/PID/mem` probe run as a non-root, non-descendant, same-uid process with the result recorded either way; a live enforce proof on the production stack with claude through the daemon and the host attached, with audit lines carrying host and kid verified.
- **D-v5-5, live re-verification (Phase 36):** the v1.0 open items this host can run are re-verified with dated evidence kept outside the repository and recorded in the phase, or carried with a named reason: the doctor and control-socket live modes, the two reaper live checks, Muse Code and Hermes loading, Omp responsiveness. The Anda live handshake and licence items are closed as dropped by D-27-01.
- **D-v5-6, spec update (Phase 37):** `docs/specs/realm-spec.xml` stops describing the Anda bridge, and the statements that require `andaUrl` or the degraded state are removed or retired; all other spec content stays. This is an owner-directed edit of the spec (instruction of 2026-11-18; reason: the Anda bridge was removed in v4.0 under D-27-01, so the spec contradicts the product). The pull request records the instruction and the reason.

## Scope: five phases (numbering continues at 33)

| Phase | Name | Requirements | Carries |
|-------|------|--------------|---------|
| 33 | Cold attach | COLD-01..04 | GAP-31-04 |
| 34 | Capability tokens enforce by default | ENF-01..04 | Phase 32 accepted limitation: stale clients refused by design, never tried with a real stale binary |
| 35 | Capability token evidence | EVID-01..03 | Phase 32 limitations: local runs as root, memory-read claim unmeasured, no live enforce run |
| 36 | Live re-verification of the v1.0 open items | V1LIVE-01..02 | v1.0 audit human items; the Anda items closed as dropped (D-27-01) |
| 37 | Spec update | SPEC-01 | Anda statements left in the product spec after v4.0 |

## Ordering and dependencies

- 33 first. 34 depends on 33: clients must connect on a cold start before enforcement matters. 35 depends on 34: the evidence is for the shipped default. 36 and 37 are independent of 33 to 35 and of each other.
- Each phase ships through the ship flow (pull request, Greptile 5 of 5, squash merge, release on the `0.5.x` line). A phase may ship as several pull requests.
- The live production stack on the realm account is shared. The startup reap is account-wide, so only one live run may be active at a time; live runs take a lock.

## Constraints for every phase

- The rules of `AGENTS.md` apply: strict TypeScript, `RealmError` with catalogue codes, a timeout on every async boundary, no silent catch, no suppression comments, `process.env` read only at the three entry edges, no new dependency without the justification, licence check and maintenance check that `CONTRIBUTING.md` requires, no host-local absolute paths in committed files.
- Tests assert observable behaviour. No source-text tests. A change to a frozen contract updates its enumerating tests in the same pull request.
- `LICENSE` and `NOTICE` are not modified. `docs/specs/realm-spec.xml` is modified only by Phase 37 and only as D-v5-6 states. Version fields and `CHANGELOG.md` belong to the release job.
- Clean cutover: migrate every caller and remove the obsolete code in the same pull request. No compatibility shims.
- Fail closed is kept: a serve-early session never runs a tool call before the session is ready, and the status and audit contracts do not change.
- Every claim in a document carries an evidence label and is checked against the code or a run. Live evidence is kept outside the repository and cited by date.

## Limits

- Capability tokens give no defence against a same-uid reader of the token, the process environment, process memory or the key file (Phase 30 and 32 records). Enforce by default does not change that; Phase 35 measures the memory-read claim and records the result either way.
- Live phases (33, 35, 36) depend on this host: rootless Podman 5.7.1, the OpenShell gateway, and the claude, opencode and codex CLIs. An item that cannot run is carried with a named reason, not claimed.

## Open owner questions

None blocking. Defaults taken: the opt-out policy value is `"mode": "off"`; an unlabelled or stale client under enforce is refused with a message that names the opt-out and the fix; the Phase 37 edit is limited to the Anda statements.

## Out of scope

FS-02 closure (accepted limitation), UI-01 (accepted limitation), TD-06, the TD-10 repository settings, kimi and kimi-code live rehearsals (named gaps), and any spec change beyond D-v5-6.
