<p align="center">
  <img src="assets/brand/banner.svg" alt="Realm, the home of AI Generated Code" width="960" height="480">
</p>

<h1 align="center"><img src="assets/brand/logo.svg" alt="Realm logo" width="64" height="64" align="middle"> Realm</h1>

[![CI](https://github.com/swcstudiospace/realm/actions/workflows/ci.yml/badge.svg)](https://github.com/swcstudiospace/realm/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/swcstudiospace/realm?sort=semver)](https://github.com/swcstudiospace/realm/releases) [![Licence: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-8b5cf6)](LICENSE) [![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-5b21b6)](https://swcstudiospace.github.io/realm/)

<p align="center"><strong>Realm, the home of AI Generated Code.</strong></p>

## What it is

Realm is the agent sandbox component of the GSD-Core USSR Stack (Ultrathink, Substrate, Swarm, Realm). It runs an agent's execution and file mutations inside a locked-down sandbox, and it ships an Omp plugin, a standalone CLI with a long-running local daemon, and MCP and ACP surfaces. The MCP and ACP surfaces let other agent hosts, such as Muse Code, Claude Code, Grok Build, and Hermes Agent, use the same sandbox.

The core guarantee, under the fail-closed policy: every file mutation either lands inside the realm under policy or fails closed, and the user can see whether the realm is active or disconnected for the session. The default advisory mode does not contain: while the realm is disconnected, the Omp guard warns and allows host write and edit calls. Containment requires opting into fail-closed.

## Status

- v0.1.x is the first release line, for milestone v1.0 (a provisional name).
- `realm up` binds the AgentOS driver from the configured digest-pinned image. The production stack is the OpenShell 0.1.5 gateway, the Realm compute driver, and rootless Podman 5.x (`docs/integration/openshell.md`).
- Linux is the only verified platform. Podman 5.x is required, and Realm does not install it.
- The Podman-gated production live suite (nine scenarios) and the Omp status checks were run on one Podman 5.7.1 host on 2026-10-28 (`docs/integration/openshell.md`, `docs/integration/omp.md`). Other hosts, the ACP surface, the Anda engine, and the Omp write and edit guard when disconnected (which needs a model call) are not verified live.

## Quick start

Prerequisites: Node.js 22.13.0 or later, and npm. Linux is the verified platform.

```sh
npm ci
npm run build
npm test
```

## Hosts

Realm ships one integration per host, each under `docs/hosts/` with a snippet:

- Omp: a Realm extension, loaded from `dist/src/omp/extension.js` (see `docs/hosts/snippets/omp.md`).
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
