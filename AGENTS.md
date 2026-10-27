# Realm

Canonical, vendor-neutral instructions for AI coding agents and human contributors. CLAUDE.md imports this file.

## Project

Realm is the agent sandbox component of the GSD-Core USSR Stack (Ultrathink, Substrate, Swarm, Realm). Its tagline is "Realm, the home of AI Generated Code" (README.md).

Realm runs an agent's execution and file mutations inside a locked-down sandbox. The layering is settled in `docs/integration/runtime-decision.md` (S-08): the OpenShell gateway runs on the host; its Podman driver creates one rootless, digest-pinned sandbox container per session; AgentOS runs as the sandbox workload; and Anda Engine runs as a separate service, reached over HTTP from the TypeScript client. Nothing nests OpenShell inside the Realm container, and nothing runs privileged.

Realm ships three things over one tool contract:

- an Omp plugin that autostarts per session;
- a standalone CLI, `realm`, with a long-running local daemon;
- MCP and ACP surfaces, so other agent hosts use the same sandbox.

Core guarantee, under the fail-closed policy: every file mutation either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected for the session. In the default advisory mode the Omp guard warns and allows host write and edit calls while the realm is disconnected; containment requires opting into fail-closed.

Status (README.md and `.planning/PROJECT.md`):

- v1.0 is provisional and fail-closed. `realm up` refuses with `AGENTOS_NOT_CONFIGURED` until an AgentOS driver is bound; that driver is deferred to a follow-up milestone.
- Linux is the only verified platform. macOS and Windows are out of v1 scope unless verified later. Bun is unverified and not assumed.
- Podman-gated and host-gated checks await verification on a Podman 5.x host.
- Licence: AGPL-3.0-only (`LICENSE`).

## Commands

Requires Node.js 22.13.0 or later (`engines` in `package.json`). CI runs Node 22.x and 24.x (`.github/workflows/ci.yml`). Realm does not install or upgrade Podman.

- `npm ci`: installs from `package-lock.json`.
- `npm run typecheck`: `tsc -p tsconfig.json --noEmit`.
- `npm run lint`: `eslint .`, configured by `eslint.config.js`.
- `npm test`: compiles with tsc, then runs `node:test` over every compiled test under `dist/test/`. That glob includes `dist/test/integration/`, so the Podman-gated suites also run here and skip when Podman 5.x is absent.
- `npm run test:integration`: compiles, then runs `dist/test/integration/*.test.js`. Podman-gated tests skip with a stated reason: `PODMAN_UNSUPPORTED_VERSION` when Podman is older than 5.x, or `PODMAN_MISSING` when Podman is absent.
- `npm run test:scripts`: runs `node:test` over `scripts/**/*.test.mjs`.
- `npm run check:docs`: scans the published docs for host-local absolute paths, then runs the AGENTS.md and CLAUDE.md sync check.
- `npm run build`: compiles with `tsc -p tsconfig.json` into `dist/`.

Every gate must pass before a change is reviewed (`CONTRIBUTING.md`).

## Layout

- `src/`: strict TypeScript. `npm run build` emits it to `dist/src/`.
  - `cli/main.ts`: entry for the `realm` CLI.
  - `daemon/`: control socket (`channel.ts`), client, daemon, `ensure.ts` (starts the daemon once and waits for it), and `main.ts`, the daemon entry.
  - `omp/`: Omp plugin logic (`plugin.ts`) and its entry (`extension.ts`).
  - `mcp/`: MCP stdio server (`server.ts`).
  - `acp/`: ACP agent (`agent.ts`) and its stdio entry (`stdio.ts`).
  - `realm/`: composition root (`compose.ts`) that wires the adapters into the controller and dispatcher.
  - `lifecycle/`: `controller.ts` (the lifecycle controller) and `mutation-gate.ts`.
  - `tools/`: the single shared tool dispatcher (`dispatch.ts`) and the workspace file handlers (`workspace.ts`).
  - `runtime/`: Podman probe and version check, libpod client and routes, OpenShell adapter, hardening verifier, egress rules, session execution, the AgentOS port and its OpenShell-carried driver (always bound; its sandbox image is the configured digest-pinned `config.image`, and each session's runner acts on its own sandbox, `realm-<sessionId>`), and runtime config.
  - `session/`: session record store, state-directory paths, and the startup reaper (`reap.ts`).
  - `anda/`: Anda Engine HTTP bridge (`client.ts`) and the version-shape check (`shape.ts`).
  - `fs/`: canonical paths, root allowlist, credential-path denial, advisory write locks, atomic writes, and read, list, glob, and write.
  - `audit/`: redacted JSONL audit log.
  - `doctor/`: prerequisite checks behind `realm doctor`.
  - `contract/`: tool and session-record schemas and the schema validator (`validate.ts`).
  - `core/`: frozen shared contracts: states and the state machine, status labels, policy loading with `policy.schema.json`, the typed error catalogue (`errors.ts`), the event bus, ports, backoff, and `withTimeout` (`timeout.ts`).
- `test/`: `node:test` suites by area, largely mirroring `src/`. `test/integration/` holds the Podman-gated suites, and `test/support/` holds shared fakes.
- `scripts/`: plain ESM `.mjs` using Node built-ins only. `scripts/check/` backs `npm run check:docs` and `npm run test:scripts`. `scripts/release/` backs the release job (`next-version.mjs`, `sync-version.mjs`, `changelog.mjs`).
- `docs/`: `integration/` (integration and decision notes, such as `runtime-decision.md` and `anda-decision.md`), `hosts/snippets/` (host config snippets), `policy-reference.md`, and `specs/realm-spec.xml` (the product spec).
- `.planning/`: GSD-managed planning state. See Planning artifacts.
- `release/milestone.json`: the milestone and its minor number, which set the release line.
- `assets/brand/`: logo and banner artwork.
- `.github/`: `workflows/ci.yml` (verify and release jobs), `PULL_REQUEST_TEMPLATE.md`, and `ISSUE_TEMPLATE/`.
- Repository root: `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, and `NOTICE`. `dist/`, `node_modules/`, and `coverage/` are git-ignored build and install output.

## Conventions

- TypeScript in strict mode, ESM only (`"type": "module"`). `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noUnusedLocals`. Public APIs are typed and documented.
- Tests use `node:test` and assert observable behaviour. No source-text tests: a test must not assert on the text of a module.
- Errors are `RealmError` values (`src/core/errors.ts`). Each carries a machine-readable `code` from `ERROR_CODES`, a human-readable `reason`, and a `retryable` flag. An optional `causeCode` is itself a catalogue code, so raw runtime text never enters an error.
- Every async boundary has a timeout (`withTimeout`, `src/core/timeout.ts`).
- No silent catch blocks, except the named exceptions under QUAL-01 in `.planning/REQUIREMENTS.md`. ESLint's `no-empty` rule rejects empty catch blocks.
- `process.env` is read only at the entry edges: `src/cli/main.ts`, `src/daemon/main.ts`, and `src/omp/extension.ts`. Other modules take their environment as an argument.
- No suppression comments. `eslint.config.js` bans `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck`; fix the cause instead.
- No new npm dependency unless the pull request records a justification, a licence check, and a maintenance check (`CONTRIBUTING.md`). Scripts use Node built-ins only.
- Commit subjects start with a Conventional Commit type (`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, or `security`), with an optional scope. The changelog groups entries by type.
- No host-local absolute paths in committed files: no home-directory, temporary-directory, or Users-directory paths. `npm run check:docs` enforces this for the published docs.
- Settled runtime decisions (`docs/integration/runtime-decision.md`). Change them only through a new recorded decision:
  - The OpenShell gateway runs on the host, and its Podman driver creates the session container. Do not nest OpenShell inside the Realm container.
  - One container per session. The daemon owns sessions. A surface attaches by connecting to the control socket and calling `up`, which is idempotent. There is no attach or detach protocol.
  - The sandbox lasts until `realm down`. A host shutdown closes that host's client and never sends `down`.
  - The OpenShell CLI is pinned to the 0.1.5 verbs, re-verified on 2026-10-26: `sandbox create` with `--policy`, `--detach`, `--cpu`, `--memory` and `--from` (no create command and no `--no-keep`), `sandbox exec` with `--name`, `--workdir`, `--no-tty` and `--no-login-shell`, and `sandbox delete`. A create command does not run in 0.1.5, so the AgentOS runner starts as an exec child after create. Recorded decision: the pin moves from 0.1.2 to 0.1.5 on 2026-10-26, and the create-command finding is its reason (`docs/integration/openshell.md`). Re-verify the pin on any upgrade.
  - Anda consumes Realm over MCP (`docs/integration/anda-decision.md`, section 7). Realm reaches Anda over its HTTP API, with no shim.

## Versioning and release

- The release line is `0.<milestone minor>.<part>`. `release/milestone.json` holds the minor: v1.0 is minor 1, so its line is `0.1.x`.
- Every green push to `main` publishes the next part: `0.1.0` first, then `0.1.1`, and so on. `scripts/release/next-version.mjs` derives the next part from the latest `v0.*` tag. A milestone minor that is behind the latest tag fails the release.
- A new milestone starts in a pull request that sets the next minor number in `release/milestone.json`. Its first release is `<minor>.0`.
- The release job owns the `version` field in `package.json`, `package-lock.json`, `CHANGELOG.md`, and the four adapter manifests that carry a release version: `adapters/claude-plugin/.claude-plugin/plugin.json`, `adapters/muse-code/.muse-plugin/plugin.json`, `adapters/hermes-agent/plugin.json`, and `adapters/prime-agent/package.json`. Pull requests never edit those files' version fields or `CHANGELOG.md`.
- The release job skips a version whose tag already exists on origin. Otherwise it tags `v<version>`, packs the npm tarball, and creates the GitHub release (`.github/workflows/ci.yml`).

## Merge and release flow

1. Branch from `main`. Changes reach `main` through a pull request; the release job is the only other writer, pushing its release commit and tag.
2. Open a pull request into `main`. Complete `.github/PULL_REQUEST_TEMPLATE.md`: requirement IDs, the gate checklist, and risk and rollback.
3. `ci.yml` must be green. Its verify job runs every gate on Node 22.x and 24.x.
4. The Greptile review must reach 5 out of 5 with no open comments before merge.
5. Merge only through the ultrathink ship flow. Never run `gh pr merge` from a shell.
6. Never force-push `main`. Never rewrite history without an explicit user decision.
7. A green push to `main` runs the release job after verify. See Versioning and release.

## Planning artifacts

- `.planning/` is managed by the GSD workflow. Change it only through GSD commands, never by hand.
- Start file-changing work through a GSD command (`.agents/GEMINI.md`): `/gsd-quick` for small fixes, documentation updates, and ad-hoc tasks; `/gsd-debug` for investigation and bug fixing; `/gsd-execute-phase` for planned phase work. Do not make repository edits outside a GSD workflow unless the user explicitly asks you to bypass it.
- `.planning/REQUIREMENTS.md` holds the requirement IDs (for example `CORE-05` or `FS-04`) that a pull request names. `.planning/PROJECT.md` holds constraints and status, `.planning/ROADMAP.md` the phases, and `.planning/STATE.md` the workflow state.
- The documentation site publishes `.planning/` read-only.

## Documentation and site

- The published entry points are `README.md` and `CHANGELOG.md`. The npm package ships them with `LICENSE`, `NOTICE`, and `dist/src` (`files` in `package.json`).
- Documentation is published as a GitHub Pages site (`homepage` in `package.json`; `CHANGELOG.md`). After a release, the release job dispatches `.github/workflows/pages.yml` if that file exists (`ci.yml`).
- Integration notes under `docs/integration/` cite each official source's URL and read date. Read the official documentation and record it there before writing integration code against it. Record anything unverified as an open question, not as a fact.
- `docs/specs/realm-spec.xml` is the authoritative product spec. It is read-only: do not modify it.
- Update the docs in the same pull request as the change they describe.

## Progressive updates

- Update this file in the same pull request when a convention, command, or layout changes. A new or moved path is a layout change.
- CI runs `npm run check:docs`. It fails unless the Commands, Versioning and release, and Merge and release flow headings each appear exactly once in this file, and unless CLAUDE.md contains the `@AGENTS.md` line and no Commands heading.
- Keep all ten `##` headings. `CHANGELOG.md` refers to "Versioning and release" by name.

## Safety and high-risk paths

- Human review is required before merge for `.github/workflows/**`, `release/**`, `scripts/release/**`, `LICENSE`, and `NOTICE`.
- The sandbox is a security boundary. Policy violations fail closed when the policy mode is fail-closed, and a file-mutating tool must never run outside the realm when the active policy requires the realm. The default mode is advisory, with a visible warning; fail-closed is the documented opt-in for containment deployments.
- No host secrets are injected into the sandbox by default, and no secrets belong in the repository, images, or logs. There is no telemetry that sends data off the machine.
- Podman runs rootless only. Never use privileged containers, and never mount a host Docker or Podman socket into a container.
- The control socket is user-only: its directory is mode 0700 and the socket is mode 0600.
- Report suspected vulnerabilities privately through GitHub private vulnerability reporting (`SECURITY.md`). Do not open a public issue, pull request, or discussion for one, and do not put secrets in the report. Only the 0.1.x line is supported.
- `.env` and `.env.*` files are git-ignored (`.gitignore`).
