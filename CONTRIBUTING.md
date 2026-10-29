# Contributing to Realm

This guide covers local setup, the gates a change must pass, and the branch and pull request flow.

## Prerequisites

- Node.js 22.13.0 or later, as set in the `engines` field of `package.json`.
- npm.

## Setup

```sh
npm ci
```

## Gates

A change must pass every gate below before it is reviewed.

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | TypeScript types, with no emit |
| `npm run lint` | ESLint over the repository |
| `npm test` | Unit tests (`node:test`) |
| `npm run test:integration` | Integration tests; Podman-gated tests skip with a stated reason when the host lacks Podman 5.x |
| `npm run test:scripts` | Tests for the scripts under `scripts/` |
| `npm run check:docs` | Documentation checks |
| `npm run build` | Compile to `dist/` |
| `npm run check:gates` | Gate closure (TOOL-02): the exec gate modules' import closure reaches no forbidden module and no `child_process` (`scripts/check/gate-closure.mjs`) |
| `npm run check:pack` | Pack smoke test: packs the package, installs the tarball into a throwaway consumer and loads the schemas and adapter manifests; run `npm run build` first |
| `npm run check:mcp` | MCP smoke test: spawns the built `realm mcp` over stdio and calls status; run `npm run build` first |

## Branches and pull requests

1. Create a feature branch from `main`.
2. Open a pull request into `main` and complete the pull request template.
3. CI must be green.
4. The Greptile review must reach 5/5 with no open comments. This is a process rule that the ship flow enforces; `main` has no branch protection.
5. A maintainer merges the change through the ship flow. A pull request whose commits are individually meaningful Conventional Commits lands with a merge commit, so the release notes list each commit. A single-commit or throwaway-commit pull request may be squash-merged with a Conventional Commit title, which becomes its one entry.

## Commit messages

Start each commit subject with a Conventional Commit type: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, or `security`. An optional scope in parentheses may follow the type. The changelog groups entries by these types. It leaves out commits scoped `planning`, which record GSD workflow artefacts, unless the subject carries `!`. Write a squash-merged pull request's title in the same form: it becomes the changelog entry.

## Planning directory

The `.planning/` directory is managed by the GSD workflow. Change it only through GSD commands, not by hand.

## Dependencies

Do not add an npm dependency without all three of the following in the pull request:

- a recorded justification for the dependency;
- a licence check;
- a maintenance check.

## Licence

Contributions are licensed under AGPL-3.0-only, the licence in [LICENSE](LICENSE).
