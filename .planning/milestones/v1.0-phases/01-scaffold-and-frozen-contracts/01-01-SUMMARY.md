# Plan 01-01 summary: FOUND-03 integration gate notes (hosts, AgentOS, Podman, OpenShell)

Status: complete for the four files in scope. No integration source code, package manifest or build step was touched. No npm, node or build/test command was run.

## Files written

| File | Gate | Blocks | Summary |
| --- | --- | --- | --- |
| `docs/integration/hosts.md` | D-09, D-16 to D-18 | `engines` field, build target | Node or Bun requirement, plugin, MCP and ACP loading model, and capability gaps for Omp, Claude Code, Grok Build, Hermes Agent, and Muse Code (no official URL found). |
| `docs/integration/agentos.md` | D-16 to D-18 | `src/runtime/agentos.ts` | AgentOS is documented in two modes: a hosted Rivet Actor and an in-process library. Lifecycle API, security boundary, and open questions. Destroy route not documented. |
| `docs/integration/podman.md` | D-05, D-16 to D-18 | `src/runtime/podman.ts` | Hardening flags, resource limits, `--network none` as the only documented egress control, socket security. Version caveat: sourced from "latest" docs, not 4.9.3. Libpod routes not verified. |
| `docs/integration/openshell.md` | D-16 to D-18 | `src/runtime/openshell.ts` | Launch model (the Podman driver creates its own container), Podman 5.x requirement, policy schema, enforcement layers, TypeScript SDK package. |

## Node requirement recorded for plan 01-03 (D-09)

`"engines": { "node": ">=22" }`, recorded in `docs/integration/hosts.md`.

Basis: the only Node version floor in the official host pages read is Claude Code's npm install route (Node.js 22 or later). Omp's recommended route needs Bun 1.3.14 or later instead. Hermes ships its own Node. Grok Build and Muse Code state none. The OpenShell TypeScript SDK needs Node.js 20.3 or later, which the floor satisfies.

This is a derived value, not a host statement that Realm must run on Node 22. It is marked [INFERENCE] in the note, and the main agent should confirm it before 01-03 writes `engines`. Bun is not declared.

## URLs read (2026-10-21)

Each was reached from an official index or from a link on an official page. None was typed from memory.

- Rivet: https://rivet.dev/docs/ ; https://rivet.dev/docs/debugging/ ; https://rivet.dev/agentos/docs/ ; https://rivet.dev/agentos/docs/quickstart/ ; https://rivet.dev/agentos/docs/quickstart-hosted/ ; https://rivet.dev/agentos/docs/hosted-api/ ; https://rivet.dev/agentos/docs/self-hosting/ ; https://rivet.dev/agentos/docs/security-model/ ; https://rivet.dev/actors/docs/lifecycle/
- Podman: https://docs.podman.io/en/latest/ ; https://docs.podman.io/en/latest/Commands.html ; https://docs.podman.io/en/latest/markdown/podman-run.1.html ; https://docs.podman.io/en/latest/markdown/podman-system-service.1.html ; https://docs.podman.io/en/latest/Reference.html ; https://docs.podman.io/en/latest/_static/api.html (empty body)
- OpenShell: https://docs.nvidia.com/openshell/latest/llms.txt ; .../about/overview.md ; .../about/architecture.md ; .../about/installation.md ; .../how-it-works/gateways/overview.md ; .../how-it-works/policies/overview.md ; .../how-it-works/policies/schema.md ; .../security/best-practices.md ; .../sdk/typescript.md
- Omp: https://omp.sh/ ; https://github.com/can1357/oh-my-pi#readme
- Claude Code: https://code.claude.com/docs/llms.txt ; .../en/overview.md ; .../en/setup.md ; .../en/features-overview.md ; .../en/quickstart.md
- Grok Build: https://docs.x.ai/ ; https://docs.x.ai/build/overview ; https://docs.x.ai/build/features/skills-plugins-marketplaces
- Hermes Agent: https://hermes-agent.nousresearch.com/ ; .../docs ; .../docs/getting-started/installation ; .../docs/user-guide/features/plugins ; .../docs/user-guide/features/mcp ; .../docs/user-guide/features/acp
- Muse Code: no official URL found in any source read.

## Findings that change the plan

1. **Podman version gate.** The OpenShell Podman driver requires Podman 5.x, cgroups v2 and an active Podman user socket. The host runs 4.9.3, so the driver is unsupported on this host per the docs. D-05 forbids changing the host in Phase 1. This is a Phase 3 decision.
2. **Launch-model conflict.** The spec layer stack has OpenShell running inside a Realm-owned Podman container. The documented Podman driver instead creates each sandbox as its own container, with networking turned off. Nested launch is not documented. Phase 3 must choose a model or the spec needs an update.
3. **OpenShell version mismatch.** Docs show "Latest (v0.1.5)". An unverified check recorded CLI 0.1.2. Phase 3 must pin a version and read the matching docs index.
4. **AgentOS destroy route.** No destroy or stop action and no DELETE route are documented in the pages read.
5. **Libpod API.** The official API page returned an empty body. The route list is unverified.
6. **Egress.** Podman documents only `--network none`. Default-deny egress with allow-listed hosts must come from OpenShell's policy or another control.
7. **Muse Code.** No official URL found. Muse Code is not supported in `engines` or the snippets until its URL is recorded.
8. **OpenShell TypeScript SDK package** is `@nvidia/openshell-sdk` (Node.js 20.3 or later, GitHub Packages scope `@nvidia`). This closes the open item to confirm the package name.

## Verification run

- `not documented` (case-sensitive) appears in all four files.
- `http` appears in all four files (the source URLs).
- Grep for `/root`, `/home` and `/Users` across the four files returned no matches.
- The Hermes capability-gap sentence in `hosts.md` was reworded in place.

## Open items carried forward

- Omp plugin manifest, lifecycle hooks and status API: `omp.md` (gate 4).
- Omp host-write removal (D-03): `--no-tools` is documented, but whether it covers built-in write and edit is not. Phase 5 (OMP-05).
- MCP and ACP protocol versions and transports: `mcp.md` and `acp.md`.
- Claude Code, Grok Build and Hermes plugin manifest details, and the Claude Code MCP config format: not read in this phase.
- `anda.md` already existed when this plan started (another lane). It was not touched.

## Deviations from the plan text

- The plan's verify grep for `rivet.dev/docs` matches because `docs/integration/agentos.md` cites `https://rivet.dev/docs/`, the D-17 starting point, which was read.
- The plan's verify grep for `docs.podman.io` matches the podman note's source URLs.
