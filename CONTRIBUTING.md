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

## Branches and pull requests

1. Create a feature branch from `main`.
2. Open a pull request into `main` and complete the pull request template.
3. CI must be green.
4. The Greptile review must reach 5/5.
5. A maintainer merges the change through the ship flow.

## Commit messages

Start each commit subject with a Conventional Commit type: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, or `security`. An optional scope in parentheses may follow the type. The changelog groups entries by these types.

## Planning directory

The `.planning/` directory is managed by the GSD workflow. Change it only through GSD commands, not by hand.

## Dependencies

Do not add an npm dependency without all three of the following in the pull request:

- a recorded justification for the dependency;
- a licence check;
- a maintenance check.

## Licence

Contributions are licensed under AGPL-3.0-only, the licence in [LICENSE](LICENSE).
