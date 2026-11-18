---
phase: 31-production-stack-boot-rehearsals-for-wave-1-hosts
plan: "02"
subsystem: host-boot-live-window
tags: [host, boot, production-stack, live-window, claude, opencode, codex, gaps]
requires: ["31-01"]
provides:
  - "A dated production-tier result for claude 2.1.322 and opencode 1.19.5 (2026-11-18, production stack on a rootless Podman 5.7.1 account), recorded in test/support/host-registry.ts, the support matrix, the wave 1 boot matrix, the contract page and the snippets"
  - "The codex row records the validator-tier session rehearsal (codex-cli 0.154.0, 2026-11-17) and, from window 9 (2026-11-18), the production tier result: the codex row is rehearsed"
  - "GAP-31-04: a cold first attach exceeds a host's MCP connect timeout"
  - "GAP-23-01, GAP-24-01 and GAP-24-03 narrowed with the results"
key-files:
  modified:
    - test/support/host-registry.ts
    - test/support/host-live.ts
    - test/integration/host-live-claude.test.ts
    - test/integration/host-live-opencode.test.ts
    - docs/integration/wave1-boot-matrix.md
    - docs/integration/host-support-matrix.md
    - docs/integration/host-plugin-gaps.md
    - docs/integration/host-plugin-contract.md
    - docs/hosts/snippets/claude-code.md
    - docs/hosts/snippets/codex.md
    - docs/hosts/snippets/opencode.md
decisions:
  - "The codex session drive judges a host that exits on its own from the wire (handshake and the six tools) and `realm status` active, because the ready observation raced the exit; the registry holds codex as rehearsed after the passing production run"
  - "The production tier runs `realm up --workspace` first, so the host attaches to a warm session; the cold-attach gap is recorded, not fixed (no src change)"
  - "The production assertion accepts either `initialize` or `server/discover` as the host's handshake and still requires tools/list and the six tool names"
  - "OpenCode was run from an owner-approved scratch install outside the repository (31-CONTEXT OQ-31-01 answered yes)"
---

# Plan 31-02 Summary: the live window and the recorded results

The windows were human-owned, on the production stack (a rootless Podman 5.7.1 account), under the shared live lock. No agent ran a live step. Evidence is kept outside the repository (versions, counts, hashes and results; no paths or environment values).

## Final window (2026-11-18)

8 of 8 tests passed:

- claude 2.1.322: the validator tier (3) and the production tier (1). `claude mcp list` connected; the recorder shows `server/discover` then `tools/list` (the modern MCP era, no initialize) and the six Realm tools; `realm status` active; a warm session.
- opencode 1.19.5, from an owner-approved scratch install outside the repository: the validator tier (3) and the production tier (1). `opencode mcp list` reported realm connected; the wire was recorded and the tool listing is not asserted for OpenCode.
- The stack was clean before and after: 0 containers, 0 sandboxes, an empty workspace.

Earlier: codex-cli 0.154.0, 2026-11-17, the two validator-tier session tests passed against a refusing loopback provider. Codex production tier, window 8 (2026-11-18): the wire showed the handshake and all six tools, but the test failed because its ready observation raced the host's exit (codex exec exits within seconds against the refusing provider; the session persists until `realm down`). The session drive now judges a host that exits on its own from the wire and `realm status`. Window 9 (2026-11-18, current main): codex-cli 0.154.0 passed 5 of 5 (validator 2, validator session 2, production 1); the host was clean before and after.

## What the earlier windows found (all fixed in test support, nothing under src)

1. The host-boot project directory was named before it existed (`sandboxNameFor` resolves a real path): created first.
2. Real `opencode mcp list` writes `$schema` into `opencode.json` (and into an existing `opencode.jsonc`) and creates a `.gitignore`; the uninstall contract was re-pinned to what the engine owns.
3. A cold first attach (sandbox creation, about 35 to 60 s) exceeds the hosts' connect timeouts (OpenCode 30 s; Claude's probe gave up): the tier now runs `realm up --workspace` first. Recorded as GAP-31-04.
4. The host PATH put the host binary's directory ahead of the production Podman 5, so a Podman 4.9.3 was probed; the production PATH now comes first, and the warm-up uses the production PATH.
5. The cleanup left the host receipt behind after a failed assertion; every step now runs independently and the recipe is uninstalled.
6. Claude Code 2.1.322 sends `server/discover`, not `initialize`: the assertion accepts either.
7. Observation, no code change: a daemon left running from an earlier stub-PATH run kept answering `PODMAN_MISSING` until it was stopped.

## What the docs record

The registry holds claude, codex and opencode as `rehearsed` (2026-11-18, versions 2.1.322, 0.154.0 and 1.19.5), kimi and kimi-code as `gap`. The support matrix block, the boot matrix, the contract page and the three snippets say the same. `docs/integration/host-plugin-gaps.md` narrows GAP-23-01, GAP-24-01 and GAP-24-03 and keeps GAP-24-02 open for kimi and kimi-code.

## Not verified here

- The writer of this summary did not run the live tests; the results are those reported by the window runner. CI is the check of the documents and test support.
- Kimi and kimi-code were not run.
- Only a warm attach is shown to pass; a cold first attach is not (GAP-31-04).

## Deviations from plan

- The plan's checkpoint order was followed, but the window needed several re-runs because of the test-support defects above (seven windows in all).
- The codex production tier needed a second window after the exit-race fix; the row became rehearsed only after the passing run.
