<p align="center">
  <img src="assets/brand/banner.svg" alt="Realm, the home of AI Generated Code" width="960" height="480">
</p>

<h1 align="center"><img src="assets/brand/logo.svg" alt="Realm logo" width="64" height="64" align="middle"> Realm</h1>

[![CI](https://github.com/swcstudiospace/realm/actions/workflows/ci.yml/badge.svg)](https://github.com/swcstudiospace/realm/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/swcstudiospace/realm?sort=semver)](https://github.com/swcstudiospace/realm/releases) [![Licence: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-8b5cf6)](LICENSE) [![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-5b21b6)](https://swcstudiospace.github.io/realm/)

<p align="center"><strong>Realm, the home of AI Generated Code.</strong></p>

## What it is

Realm is the agent sandbox component of the GSD-Core USSR Stack (Ultrathink, Substrate, Swarm, Realm). It runs an agent's execution and file mutations inside a locked-down sandbox, and it ships an Omp plugin, a standalone CLI with a long-running local daemon, and MCP and ACP surfaces. The MCP and ACP surfaces let other agent hosts, such as Muse Code, Claude Code, Grok Build, and Hermes Agent, use the same sandbox.

The core guarantee, under the fail-closed policy: every file mutation either lands inside the realm under policy or fails closed, and the user can see whether the realm is active or disconnected for the session. The policy `mode` defaults to `fail-closed`: while the realm is not active, the Omp guard refuses host `write` and `edit` calls (with `REALM_NOT_ACTIVE`, or the code of the realm's state). That default is not containment of Omp's own tools: with the realm active, the Omp built-in `write`, `edit` and `bash` still act on the host, and containing them is planned work (Phase 16 of milestone v3.0). Advisory mode, which warns and allows host writes while the realm is not active, requires the explicit value `"mode": "advisory"` in the policy file (`docs/policy-reference.md`).

**Upgrading.** This changes the default of earlier releases. A policy file with no `mode` key, or no policy file at all, now loads as `fail-closed`, so host `write` and `edit` calls that used to proceed with a warning are refused with `REALM_NOT_ACTIVE` while the realm is not active (start it with `realm up`, or `/realm-retry` in Omp). To keep the old behaviour, add `"mode": "advisory"` to `<state-dir>/policy.json`; to take the new default, change nothing. `realm status` and `realm up` print the mode in effect. See "Upgrading" in `docs/policy-reference.md`.

## Status

- v0.1.x was the first release line, for milestone v1.0 (a provisional name), and v0.2.x was the line of milestone v2.0. v0.3.x, for milestone v3.0, becomes the current line with its first release and is the only line that is supported.
- `realm up` binds the AgentOS driver from the configured digest-pinned image. The production stack is the OpenShell 0.1.5 gateway, the Realm compute driver, and rootless Podman 5.x (`docs/integration/openshell.md`).
- Linux is the only verified platform. Podman 5.x is required, and Realm does not install it.
- The Podman-gated production live suite (nine scenarios) and the Omp status checks were run on one Podman 5.7.1 host on 2026-10-28, and the ACP surface was run live against the same stack on 2026-10-29 (`docs/integration/openshell.md`, `docs/integration/omp.md`, `docs/integration/acp.md`). Other hosts and the Anda engine are not verified live. The Omp write and edit guard when disconnected was observed live on 2026-10-29 with a scripted model provider, not with a model (`docs/integration/omp-lifecycle-runbook.md`); a model-driven run is still outstanding (OMP-05).

## Quick start

Prerequisites: Node.js 22.13.0 or later, and npm. Linux is the verified platform.

```sh
npm ci
npm run build
npm test
```

## Hosts

Realm ships one integration per host, each under `docs/hosts/` with a snippet:

- Omp: a Realm extension, loaded from `dist/src/omp/extension.js` (see `docs/hosts/snippets/omp.md`). It attaches the sandbox when a session starts, shows its status, and gates Omp's `write` and `edit` calls: under the default `fail-closed` mode it refuses them while the realm is not active, and under an explicit `advisory` mode it warns and lets them through. With the realm active, Omp's own tools, `bash` included, still run on the host (containing them is Phase 16), and the session directory must be the configured workspace root (`docs/integration/omp-lifecycle-runbook.md`).
- Claude Code and Grok Build: the shared plugin bundle `adapters/claude-plugin`, plus an MCP entry that runs `realm mcp`.
- Muse Code: the plugin bundle `adapters/muse-code`, plus an `mcp_servers` entry.
- Hermes Agent: the MCP-only plugin bundle `adapters/hermes-agent`.
- Prime Agent: the package `adapters/prime-agent`, plus an MCP entry.

Each bundle is checked with its host's validator in an isolated directory. No
host configuration is changed by this repository. `realm` is not on `PATH` on
the verification host, so install it first or use an absolute path.

See [docs/integration/hosts.md](docs/integration/hosts.md) for the host tiers.

## Documentation

- [Documentation site](https://swcstudiospace.github.io/realm/)
- [CHANGELOG.md](CHANGELOG.md)
- [AGENTS.md](AGENTS.md): for AI agents and contributors
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)

## Versioning

Versions follow `0.<milestone>.<part>`. Each green push to `main` publishes the next part as a GitHub release, with the npm pack tarball attached.

## Licence

Copyright (C) 2026 Spectrum Web Co/swcstudiospace.

Licensed under the GNU Affero General Public License v3.0 only (AGPL-3.0-only). See [LICENSE](LICENSE) and [NOTICE](NOTICE).
