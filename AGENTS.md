# Realm

Canonical, vendor-neutral instructions for AI coding agents and human contributors. CLAUDE.md imports this file.

## Project

Realm is the agent sandbox component of the GSD-Core USSR Stack (Ultrathink, Substrate, Swarm, Realm). Its tagline is "Realm, the home of AI Generated Code" (README.md).

Realm runs an agent's execution and file mutations inside a locked-down sandbox. The layering is settled in `docs/integration/runtime-decision.md` (S-08, with the 2026-10-26 and 2026-10-28 decisions recorded in `docs/integration/openshell.md`): the OpenShell gateway runs on the host; the Realm compute driver (`src/runtime/driver/`) creates one rootless, digest-pinned sandbox container per session through the libpod API; AgentOS runs in that sandbox as a managed `openshell sandbox exec` child of the realm; and Anda Engine runs as a separate service, reached over HTTP from the TypeScript client. Nothing nests OpenShell inside the Realm container, and nothing runs privileged.

Realm ships three things over one tool contract:

- an Omp plugin that autostarts per session;
- a standalone CLI, `realm`, with a long-running local daemon;
- MCP and ACP surfaces, so other agent hosts use the same sandbox.

Core guarantee, under the fail-closed policy: every file mutation either lands inside the realm under policy or fails closed, and the user can always see whether the realm is active or disconnected for the session. The policy `mode` defaults to `fail-closed` (decision D4): while the realm is not active, the Omp guard refuses host `write` and `edit` calls. That is not containment of Omp's built-in `write`, `edit` and `bash` with the realm active, which still act on the host until Phase 16; advisory mode (warn and allow) requires the explicit value `"mode": "advisory"`.

Status (README.md and `.planning/PROJECT.md`):

- v3.0 (Containment by Default) is the current milestone (release line 0.3.x; phases 12 to 20 in `.planning/ROADMAP.md`); v2.0 (0.2.x) shipped, and v1.0 (0.1.x) was provisional and fail-closed. The daemon binds the AgentOS driver from the configured digest-pinned image. The production stack is the OpenShell 0.1.5 gateway, the Realm compute driver, and rootless Podman 5.x (`docs/integration/openshell.md`).
- Linux is the only verified platform. macOS and Windows are out of scope for v3.0 unless verified later. Bun is unverified and not assumed. Podman 5.x is required, and Realm does not install it.
- Podman-gated and host-gated checks ran live on 2026-10-28 on a Podman 5.7.1 host: the production live suite passed 31 of 31 assertions across its nine scenarios (`docs/integration/openshell.md`). The ACP surface was run live on 2026-10-29 by a separate client (67 checks, 0 failed; `docs/integration/acp.md`). OMP-05 is unproven live.
- Licence: AGPL-3.0-only (`LICENSE`).

## Commands

Requires Node.js 22.13.0 or later (`engines` in `package.json`). CI runs Node 22.x and 24.x (`.github/workflows/ci.yml`). Realm does not install or upgrade Podman.

- `npm ci`: installs from `package-lock.json`.
- `npm run typecheck`: `tsc -p tsconfig.json --noEmit`.
- `npm run lint`: `eslint .`, configured by `eslint.config.js`.
- `npm test`: compiles with tsc, then runs `node:test` over every compiled test under `dist/test/`. That glob includes `dist/test/integration/`, so the Podman-gated suites also run here and skip when Podman 5.x is absent.
- `npm run test:integration`: compiles, then runs `dist/test/integration/*.test.js`. Podman-gated tests skip with a stated reason: `PODMAN_UNSUPPORTED_VERSION` when Podman is older than 5.x, or `PODMAN_MISSING` when Podman is absent.
- The production live suite (`test/integration/production-driver.test.ts`, nine scenarios) is also gated: it runs the real stack and skips, naming the first missing prerequisite, unless `REALM_LIVE_PRODUCTION=1`, Podman 5.x, `REALM_LIVE_IMAGE`, `REALM_LIVE_DRIVER_CONFIG` (the absolute path of the `config.json` the running driver reads; the secret, workspace and sandbox-state roots come from that file, and a stale `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT` or `REALM_DRIVER_STATE_ROOT` is ignored), a rootless Podman socket, the `openshell` CLI and the built CLI are all present. Run the live file alone with `npm run build && node --test dist/test/integration/production-driver.test.js`. `npm run test:integration` runs the integration files in parallel, and this suite counts every container on the host, so the safe alternative is `node --test --test-concurrency=1 "dist/test/integration/*.test.js"`. Preconditions are in `docs/integration/openshell.md` (Running the production live suite).
- The Omp live harness (`test/integration/omp-spike.test.ts`, `test/integration/omp-guard.test.ts`) is gated and does not use Podman. It isolates the profile, credentials and workspace files. A cold profile can still contact the model catalog, so it is not a no-network run; the spike's refusing loopback proxy is the network lever and the guard suite does not use it. `REALM_LIVE_OMP=1` opts in to any test that starts a real Omp process; a test never sets it. `REALM_OMP_BIN` optionally names the Omp executable (default `omp` on `PATH`). `REALM_OMP_NET_TRACE=1` opts in to the strace network assertion. Without the opt-in, or without Omp, the files skip and name the first missing prerequisite (`ompSkipReason`). The guard suite is not LLM-driven. Run it alone, after `npm run build`, with `REALM_LIVE_OMP=1 node --test --test-concurrency=1 dist/test/integration/omp-guard.test.js`.
- `npm run test:scripts`: runs `node:test` over `scripts/**/*.test.mjs`.
- A weekly scheduled mutation run (`node scripts/mutation/run.mjs`, `.github/workflows/mutation.yml`) is non-blocking and covers `src/fs`, `src/core/policy.ts` and `src/audit/redact.ts`; Stryker was not installed because research recorded a 188-package tree and an unproven fit with `node:test` on compiled output.
- `npm run test:coverage`: compiles, runs the whole compiled suite under `--experimental-test-coverage` with the lcov reporter, sums lines, branches and functions for `src/fs`, `src/core` and `src/tools`, and prints a table against the floors in `scripts/check/coverage-floors.json`, followed by the current sources (`src/<dir>/**/*.ts`) that no test loads (compiled file present but no lcov record), the ones that are not built (run `tsc` first), and a count of type-only modules and of stale compiled files (output whose source is gone), which are ignored. Below a floor, or with an unloaded or not-built source, it exits 1. The suite runs with source maps off: the command line carries `--no-enable-source-maps`, which overrides `--enable-source-maps` in `NODE_OPTIONS` (the environment is passed through untouched), because mapped records would fall outside the `dist/src/**` include filter. The floors are enforced (`"reportOnly": false`): each is floor(measured) minus the tolerance of 1, taken from CI runs of the gate leg, which is Node 22.x (`gateNode`); the `Coverage floors` step of the `verify` job runs it there, so a failing floor fails the job and blocks the release. `node scripts/check/coverage.mjs --lcov <file>` evaluates an existing lcov file, and `--write` only raises floors; lowering a floor is a hand edit with a reason in the pull request. Node writes the lcov file even when a test fails, so the table is printed even if the suite fails in that run; the suite's non-zero exit code is then still the command's exit code, and without an lcov file only that code is returned.
- `npm run check:docs`: scans the published docs for host-local absolute paths, runs the AGENTS.md and CLAUDE.md sync check, then scans the docs for stale statements about the default policy mode (`scripts/check/default-mode.mjs`).
- `npm run check:image-digests -- --dir <dir>` or `-- --image <ref>`: verifies the sandbox image inputs against `sandbox/expected-digests.json`. `--image` needs Podman. It is not part of CI.
- `npm run build:image`: builds the sandbox image with the digests recorded in `sandbox/expected-digests.json` and verifies it. Needs Podman. It is not part of CI.
- `npm run build`: compiles with `tsc -p tsconfig.json` into `dist/`.
- `npm run check:gates`: runs `scripts/check/gate-closure.mjs`, which verifies that the exec gate modules' import closure reaches no forbidden module and no `child_process` (TOOL-02).
- `npm run check:pack`: packs the package, installs the tarball into a throwaway consumer and loads every schema and adapter manifest from it. Run `npm run build` first; it does not build.
- `npm run check:mcp`: spawns the built `realm mcp` over stdio and drives one session in both MCP protocol eras (a legacy `initialize` handshake, then modern requests and an unsupported version), checking the result shapes and the status call against `realm status`. Run `npm run build` first; it does not build.
- `node scripts/check/export-usage.mjs --list`: informational reference analysis of every `src/**/*.ts` export (TD-09). It errs towards keeping an export and classifies each as `used-in-src`, `forwarded` (another src file re-exports it), `test-only` (a documented seam, kept), `public-signature` (a type, class or enum used in the declaration of another export of its file: stays exported), `self-only` (drop the `export` keyword; delete the declaration if `noUnusedLocals` then flags it), `unclassified` (a re-export that does not resolve to an analyzed file, with the reason listed: never a removal candidate) or `excluded` (`src/core/errors.ts`, `src/core/ports*`, `src/contract/`, entry modules). `--json`, `--dir src/<dir>` and `--class <name>` filter it. It never fails the build (exit 2 only for a usage error); rerun it before adding an `export` that only a test needs. It parses the sources with the TypeScript compiler API (`ts.createSourceFile`, no program), the one documented exception to the Node-built-ins-only rule for scripts: `typescript` is already a devDependency, and the script is informational, not a CI gate.
- The `audit` job in CI runs `npm audit --omit=dev --audit-level=high` on Node 24.x. It needs the npm registry, so it is not part of the local gates; run the same command by hand when you change dependencies.

Every gate must pass before a change is reviewed (`CONTRIBUTING.md`).

## Layout

- `src/`: strict TypeScript. `npm run build` emits it to `dist/src/`.
  - `cli/main.ts`: entry for the `realm` CLI.
  - `daemon/`: control socket (`channel.ts`), client, daemon, `ensure.ts` (starts the daemon once, only when the socket is absent, and waits for it; the status probe the CLI and the Omp extension share), and `main.ts`, the daemon entry.
  - `omp/`: Omp plugin logic (`plugin.ts`) and its entry (`extension.ts`).
  - `mcp/`: MCP stdio server (`server.ts`: transport and routing) and the protocol versions and result shapes of both eras (`protocol.ts`). It serves revision 2026-07-28 and answers the `initialize` handshake of the legacy revisions that Claude Code speaks (`docs/integration/mcp.md`, Q6).
  - `acp/`: ACP agent (`agent.ts`) and its stdio entry (`stdio.ts`).
  - `realm/`: composition root (`compose.ts`) that wires the adapters into the controller and dispatcher.
  - `lifecycle/`: `controller.ts` (the lifecycle controller) and `mutation-gate.ts`.
  - `tools/`: the single shared tool dispatcher (`dispatch.ts`) and the workspace file handlers (`workspace.ts`).
  - `runtime/`: Podman probe and version check, libpod client and routes, OpenShell adapter, hardening verifier, seccomp evidence (`seccomp-evidence.ts`), egress rules, session execution, and runtime config. The AgentOS pieces are `agentos.ts` (the port), `agentos-driver.ts` (the OpenShell-carried driver, always bound; its sandbox image is the configured digest-pinned `config.image`, and each session's runner acts on its own sandbox, `realm-<sessionId>`), and `agentos-workload.ts`. `runtime/driver/` holds the compute driver: gRPC server, lifecycle, channel and secret store, supervisor spawn, and seccomp profile delivery.
  - `session/`: session record store, state-directory paths, and the startup reaper (`reap.ts`).
  - `anda/`: Anda Engine HTTP bridge (`client.ts`) and the version-shape check (`shape.ts`).
  - `fs/`: canonical paths, root allowlist, credential-path denial, advisory write locks, atomic writes, read, list, glob, and write, and `temp-sweep.ts` (`src/fs/temp-sweep.ts`, which removes orphaned atomic-write temp files; the daemon calls it at start, before it serves).
  - `audit/`: redacted JSONL audit log, and `reconcile.ts` (`src/audit/reconcile.ts`, which appends `AUDIT_OUTCOME_UNKNOWN` reconciliation lines for admissions with no result; the daemon calls it at start, before it serves).
  - `observe/`: the JSON-line logger (`logger.ts`), its file and stderr sinks (`log-file.ts`, size-capped, rotated to one `.1` file), correlation ids (`ids.ts`), and the in-memory metrics registry with its strict snapshot validator (`metrics.ts`); libraries only, the daemon does not call them yet.
  - `doctor/`: prerequisite checks behind `realm doctor`.
  - `contract/`: tool and session-record schemas and the schema validator (`validate.ts`).
  - `core/`: frozen shared contracts: states and the state machine, status labels, policy loading with `policy.schema.json`, the typed error catalogue (`errors.ts`), the event bus, ports, backoff, and `withTimeout` (`timeout.ts`); and the package version reader (`package-version.ts`).
- `test/`: `node:test` suites by area, largely mirroring `src/`. `test/integration/` holds the Podman-gated suites and the Omp live harness. `test/support/` holds shared fakes, `property.ts` (the shared `fast-check` configuration, 200 runs from a fixed seed; `REALM_PROPERTY_SEED` overrides it, used by the `*.property.test.ts` files in `test/fs/` and `test/core/`), and the Omp harness: `omp-live.ts`, `scripted-provider.ts`, `omp-profile.ts`, `omp-rpc.ts`, `realm-daemon-fixture.ts`, `net-trace.ts`, and `omp-spike-extension.ts`.
- `scripts/`: plain ESM `.mjs` using Node built-ins only (`scripts/check/export-usage.mjs` is the one exception: it also uses the `typescript` devDependency). `scripts/check/` backs `npm run check:docs`, `npm run check:image-digests` (`verify-image-digests.mjs`), `npm run test:coverage` (`coverage.mjs` with `coverage-floors.json`) and `npm run test:scripts`, and holds the informational `export-usage.mjs --list` dead-export analysis. `scripts/image/` backs `npm run build:image` (`build-image.mjs`). `scripts/release/` backs the release job (`next-version.mjs`, `sync-version.mjs`, `changelog.mjs`, and `assets.mjs`, which writes `SHA256SUMS` and the CycloneDX SBOM).
- `docs/`: `integration/` (integration and decision notes, such as `runtime-decision.md` and `anda-decision.md`), `hosts/snippets/` (host config snippets), `policy-reference.md`, and `specs/realm-spec.xml` (the product spec).
- `.planning/`: GSD-managed planning state. See Planning artifacts.
- `release/milestone.json`: the milestone and its minor number, which set the release line.
- `assets/brand/`: logo and banner artwork.
- `.github/`: `dependabot.yml`, `workflows/ci.yml` (verify, site, audit, and release jobs), `workflows/pages.yml` (site build and deploy), `PULL_REQUEST_TEMPLATE.md`, and `ISSUE_TEMPLATE/`.
- `sandbox/`: the image build for the sandbox image (`Dockerfile`, `resolv.conf`, `expected-digests.json`). The image carries the pinned runtime, the AgentOS runner, and the probe. `tsconfig.agentos.json` and `.dockerignore` sit at the repository root, not in `sandbox/`.
- `licenses/`: the licence texts of the Apache-2.0 material that `NOTICE` lists. The package ships it.
- Repository root: `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, and `NOTICE`. `dist/`, `node_modules/`, and `coverage/` are git-ignored build and install output.

## Conventions

- TypeScript in strict mode, ESM only (`"type": "module"`). `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noUnusedLocals`. Public APIs are typed and documented.
- Tests use `node:test` and assert observable behaviour. No source-text tests: a test must not assert on the text of a module.
- Errors are `RealmError` values (`src/core/errors.ts`). Each carries a machine-readable `code` from `ERROR_CODES`, a human-readable `reason`, and a `retryable` flag. An optional `causeCode` is itself a catalogue code, so raw runtime text never enters an error.
- Every async boundary has a timeout (`withTimeout`, `src/core/timeout.ts`).
- No silent catch blocks, except the named exceptions under QUAL-01 in `.planning/REQUIREMENTS.md`. ESLint's `no-empty` rule rejects empty catch blocks.
- `process.env` is read only at the entry edges: `src/cli/main.ts`, `src/daemon/main.ts`, `src/omp/extension.ts`, and `src/runtime/driver/main.ts`. Other modules take their environment as an argument.
- No version string is copied into source: the MCP and ACP surfaces read the package manifest through `packageVersion()` (`src/core/package-version.ts`), because the release job rewrites the manifest and a copied string goes stale (release 0.2.0 advertised `0.0.0`).
- No suppression comments. `eslint.config.js` bans `@ts-ignore`, `@ts-expect-error`, and `@ts-nocheck`; fix the cause instead.
- No new npm dependency unless the pull request records a justification, a licence check, and a maintenance check (`CONTRIBUTING.md`). Scripts use Node built-ins only, except `scripts/check/export-usage.mjs`, which uses the existing `typescript` devDependency.
- Commit subjects start with a Conventional Commit type (`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, or `security`), with an optional scope. The changelog groups entries by type.
- No host-local absolute paths in committed files: no home-directory, temporary-directory, or Users-directory paths. `npm run check:docs` enforces this for the published docs.
- Settled runtime decisions (`docs/integration/runtime-decision.md`). Change them only through a new recorded decision:
  - The OpenShell gateway runs on the host, and the Realm compute driver creates the session container. Do not nest OpenShell inside the Realm container.
  - One container per session. The daemon owns sessions. A surface attaches by connecting to the control socket and calling `up`, which is idempotent. There is no attach or detach protocol.
  - The sandbox lasts until `realm down`. A host shutdown closes that host's client and never sends `down`.
  - The OpenShell CLI is pinned to the 0.1.5 verbs, re-verified on 2026-10-26: `sandbox create` with `--policy`, `--detach`, `--cpu`, `--memory` and `--from` (no create command and no `--no-keep`), `sandbox exec` with `--name`, `--workdir`, `--no-tty` and `--no-login-shell`, and `sandbox delete`. A create command does not run in 0.1.5, so the AgentOS runner starts as an exec child after create. Recorded decision: the pin moves from 0.1.2 to 0.1.5 on 2026-10-26, and the create-command finding is its reason (`docs/integration/openshell.md`). Re-verify the pin on any upgrade. Phase 17 adds the verb `status` (`openshell status`, no flags): the health probe runs it on the failure path only, to tell a lost gateway from a dead runner (`OPENSHELL_GATEWAY_LOST`; `docs/integration/runtime-decision.md`, "Catalogue extension (Phase 17)").
  - Anda consumes Realm over MCP (`docs/integration/anda-decision.md`, section 7). Realm reaches Anda over its HTTP API, with no shim.

## Versioning and release

- The release line is `0.<milestone minor>.<part>`. `release/milestone.json` holds the minor: v1.0 was minor 1 (line `0.1.x`), v2.0 was minor 2 (line `0.2.x`) and v3.0 is minor 3 (line `0.3.x`).
- Each push to `main` that passes the `verify` job, the `site` build job and the `audit` job runs the release job, which publishes the next part: `0.<minor>.0` first, then `0.<minor>.1`, and so on. `scripts/release/next-version.mjs` derives the next part from the latest `v0.*` tag. A milestone minor that is behind the latest tag fails the release.
- A new milestone starts in a pull request that sets the next minor number in `release/milestone.json`. Its first release is `0.<minor>.0`.
- The release job owns `CHANGELOG.md` and the `version` field in `package.json`, `package-lock.json`, and the four adapter manifests that carry a release version: `adapters/claude-plugin/.claude-plugin/plugin.json`, `adapters/muse-code/.muse-plugin/plugin.json`, `adapters/hermes-agent/plugin.json`, and `adapters/prime-agent/package.json`. Pull requests never edit those files' version fields or `CHANGELOG.md`. `node scripts/release/sync-version.mjs --files` lists the version files.
- The release job plans exactly one action per push before it changes anything: skip a version whose tag and GitHub release already exist, publish nothing when the push is superseded, or release. A push whose SHA is no longer `origin/main` is superseded and exits green without publishing, so only the newest push releases, and its changelog covers every non-merge commit since the previous tag that the filter keeps (see below). A tag that has no GitHub release (a failed earlier attempt) is repaired by the Finish step at the start of the next release run. A tag that exists without a GitHub release when planning starts, after the Finish step, fails the run.
- A release installs with `npm ci --ignore-scripts`, and the checkout token is not persisted in `.git/config`: git receives it only in the push step (through the environment), and that step ignores the global and system git configuration and disables hooks, because build code ran earlier as the same user. The `gh` steps (Finish, Plan, Create GitHub release, Dispatch Pages) receive it as `GH_TOKEN`; build and dependency code never does. It then syncs the versions (`scripts/release/sync-version.mjs`); generates the `CHANGELOG.md` section from `git log --no-merges <previous tag>..HEAD`, grouped by Conventional Commit type, leaving out `chore(release)` commits and commits scoped `planning` unless the subject carries `!` (`scripts/release/changelog.mjs`); builds and packs the tarball; writes `SHA256SUMS` and a CycloneDX SBOM of the production dependencies (`scripts/release/assets.mjs`); commits `chore(release): v<version> [skip ci]` as `github-actions[bot]`; pushes `main` and the tag `v<version>` atomically; creates the GitHub release with the tarball, `SHA256SUMS`, and the SBOM; and dispatches `.github/workflows/pages.yml` when the tip of `main` is a release commit, which covers a publish, a repair and the retry of a failed dispatch, and means a newer push never deploys before its own verify and release (`.github/workflows/ci.yml`).
- After `npm pack`, the release job runs `node scripts/check/pack-smoke.mjs --tarball agent-realm-<version>.tgz --expect-version <version>`. It installs that tarball in a throwaway consumer and checks that the shipped files carry the release version. It runs before any tag or push, so a failure leaves no tag behind.
- Nothing is published to npm: `package.json` has `"private": true`. The release carries no provenance attestation or signature yet. Adding one safely means splitting the release into an unprivileged build job and a privileged publish job, so that no dependency or build code shares a user or a runner with a write credential; that split is a recorded follow-up.

## Merge and release flow

1. Branch from `main`. Changes reach `main` through a pull request; the release job is the only other writer, pushing its release commit and tag.
2. Open a pull request into `main`. Complete `.github/PULL_REQUEST_TEMPLATE.md`: requirement IDs, the gate checklist, and risk and rollback.
3. `ci.yml` must be green: the verify job (typecheck, lint, unit, integration and script tests, docs, gate-closure, build, pack and MCP checks, on Node 22.x and 24.x), the site build job and the dependency audit job (`npm audit --omit=dev --audit-level=high`). The release job waits for all three.
4. The Greptile review must reach 5 out of 5 with no open comments before merge. This is a process rule that the ship flow enforces: `main` has no branch protection, so GitHub does not enforce it.
5. Merge only through the ultrathink ship flow, which reads `ship.mergeMethod` from the Ultrathink user configuration (default `squash`; it is not stored in this repository). Never run `gh pr merge` from a shell. The merge method decides the release notes. A pull request whose commits are individually meaningful Conventional Commits lands with a merge commit, so the notes list each commit. A single-commit or throwaway-commit pull request may be squash-merged with a Conventional Commit title, which becomes its one entry. Set `ship.mergeMethod` to match. PRs 1 to 4 were squash-merged and PR 5 was merged with a merge commit; PR 6 is to be merged with a merge commit.
6. Never force-push `main`. Never rewrite history without an explicit user decision.
7. A push to `main` that passes verify, the site build and the audit runs the release job. Its release commit carries `[skip ci]`, so it starts no CI run of its own. See Versioning and release.

## Planning artifacts

- `.planning/` is managed by the GSD workflow. Change it only through GSD commands, never by hand.
- Start file-changing work through a GSD command (`.agents/GEMINI.md`): `/gsd-quick` for small fixes, documentation updates, and ad-hoc tasks; `/gsd-debug` for investigation and bug fixing; `/gsd-execute-phase` for planned phase work. Do not make repository edits outside a GSD workflow unless the user explicitly asks you to bypass it.
- `.planning/REQUIREMENTS.md` holds the requirement IDs (for example `CRASH-01` or `ONB-02`) that a pull request names, and the standing requirements of earlier milestones that still bind (`QUAL-01` to `QUAL-03`, including the named silent-catch exceptions). `.planning/PROJECT.md` holds constraints and status, `.planning/ROADMAP.md` the phases, and `.planning/STATE.md` the workflow state.
- The documentation site publishes `.planning/` read-only.

## Documentation and site

- The published entry points are `README.md` and `CHANGELOG.md`. The release tarball (`npm pack`; nothing is published to npm) ships them with `LICENSE`, `NOTICE`, `licenses/`, `adapters/`, the driver protos, the schemas and `dist/src` (`files` in `package.json`).
- Documentation is published as a GitHub Pages site (`homepage` in `package.json`; `CHANGELOG.md`). `.github/workflows/pages.yml` has no push trigger: it runs when the release job dispatches it after a release, or by hand (`workflow_dispatch`). Its permissions are set per job.
- Integration notes under `docs/integration/` cite each official source's URL and read date. Read the official documentation and record it there before writing integration code against it. Record anything unverified as an open question, not as a fact.
- `docs/specs/realm-spec.xml` is the authoritative product spec. It is read-only: do not modify it.
- Update the docs in the same pull request as the change they describe.

## Progressive updates

- Update this file in the same pull request when a convention, command, or layout changes. A new or moved path is a layout change.
- CI runs `npm run check:docs`. It fails unless the Commands, Versioning and release, and Merge and release flow headings each appear exactly once in this file, and unless CLAUDE.md contains the `@AGENTS.md` line and no Commands heading.
- Keep all ten `##` headings. `CHANGELOG.md` refers to "Versioning and release" by name.

## Safety and high-risk paths

- Human review is required before merge for `.github/workflows/**`, `release/**`, `scripts/release/**`, `LICENSE`, and `NOTICE`.
- The sandbox is a security boundary. Policy violations fail closed when the policy mode is fail-closed, and a file-mutating tool must never run outside the realm when the active policy requires the realm. The default mode is fail-closed (a policy with no `mode` loads as fail-closed); advisory, which warns and allows, is the explicit opt-in and is not containment. Never write documents that call advisory the default: `npm run check:docs` fails on them (`scripts/check/default-mode.mjs`).
- No host secrets are injected into the sandbox by default, and no secrets belong in the repository, images, or logs. There is no telemetry that sends data off the machine.
- Podman runs rootless only. Never use privileged containers, and never mount a host Docker or Podman socket into a container.
- The control socket is user-only: its directory is mode 0700 and the socket is mode 0600.
- Report suspected vulnerabilities privately through GitHub private vulnerability reporting (`SECURITY.md`). Do not open a public issue, pull request, or discussion for one, and do not put secrets in the report. Only the 0.3.x line is supported, from its first release, 0.3.0.
- `.env` and `.env.*` files are git-ignored (`.gitignore`).
