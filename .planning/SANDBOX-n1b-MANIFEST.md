# Sandbox n1b Manifest — Language / Runtime / Scripts / CI

Source inventory for node n1 (SPE-38066) sandbox slices. All claims cite the file read this session.

## 1. Language + module system

| Item | Value | Cite |
|---|---|---|
| Package | `agent-realm@0.9.6`, private, AGPL-3.0-only | `package.json:2-5` |
| Description | Realm: strict ESM TypeScript package | `package.json:7` |
| Module system | ESM: `"type": "module"`; bin `realm: ./dist/src/cli/main.js` | `package.json:27-29`, `package.json:48` |
| Language | TypeScript, strict ESM only | `AGENTS.md:97` |
| Compiler target/lib | ES2023 | `tsconfig.json:3-4` |
| Module resolution | `module: NodeNext`, `moduleResolution: NodeNext` (`.js`-suffixed ESM imports) | `tsconfig.json:5-6` |
| Strictness | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `verbatimModuleSyntax`, `noUncheckedSideEffectImports`, `forceConsistentCasingInFileNames`; `allowJs`+`checkJs`; `rootDir: .`, `outDir: dist`, `sourceMap` | `tsconfig.json:8-24` |
| Included sources | `eslint.config.js`, `src/**/*.ts`, `test/**/*.ts` | `tsconfig.json:25` |
| Scripts runtime | Plain ESM `.mjs`, Node built-ins only, except `export-usage*.mjs` which use the existing `typescript` devDependency | `AGENTS.md:83`, `AGENTS.md:106` |
| Lint | Flat config `eslint.config.js`: `strictTypeChecked` scoped to `**/*.ts`; `strict` (untyped) scoped to `**/*.mjs`, `**/*.js`; bans `@ts-ignore/@ts-expect-error/@ts-nocheck`; architecture invariants (child_process allowlist, spawn sites, D-99/D-88 guards, adapter internals, CLI/CDX rules) as lint rules | `eslint.config.js:1-15`, `AGENTS.md:104` |
| Deps | Dev: `@eslint/js 10.0.1`, `@types/node 22.20.5`, `eslint 10.13.0`, `fast-check 4.10.2`, `typescript 6.0.3`, `typescript-eslint 8.72.0`. Runtime: `@grpc/grpc-js 1.14.6`, `@grpc/proto-loader 0.8.1`, `@rivet-dev/agentos-core 0.4.7`, `ajv 8.20.0` | `package.json:71-84` |

## 2. Engines

| Item | Value | Cite |
|---|---|---|
| `engines.node` | `>=22.13.0` | `package.json:49-51` |
| AGENTS.md restatement | Requires Node.js 22.13.0 or later; CI runs Node 22.x and 24.x | `AGENTS.md:28` |
| Platform | Linux only verified platform; macOS/Windows out of scope unless verified; Bun unverified/not assumed; Podman 5.x required (Realm does not install it) | `AGENTS.md:22` |

## 3. Script table (exact commands)

| Script | Command | Cite |
|---|---|---|
| `typecheck` | `tsc -p tsconfig.json --noEmit` (AGENTS.md: same) | `package.json:53`, `AGENTS.md:34` |
| `lint` | `eslint .` (config `eslint.config.js`) | `package.json:54`, `AGENTS.md:35` |
| `test` | `tsc -p tsconfig.json && node --test "dist/test/**/*.test.js"` — compiles then node:test over every compiled test under `dist/test/`, including `dist/test/integration/` (Podman-gated suites skip when Podman 5.x absent) | `package.json:55`, `AGENTS.md:36` |
| `test:integration` | `tsc -p tsconfig.json && node --test "dist/test/integration/*.test.js"` (Podman-gated; skip reasons `PODMAN_UNSUPPORTED_VERSION` / `PODMAN_MISSING`) | `package.json:56`, `AGENTS.md:37` |
| `test:coverage` | `tsc -p tsconfig.json && node scripts/check/coverage.mjs` — runs compiled suite under `--experimental-test-coverage` (lcov), sums lines/branches/functions for `src/fs`, `src/core`, `src/tools` vs floors in `scripts/check/coverage-floors.json`; exits 1 below floor / unloaded / not-built source | `package.json:57`, `AGENTS.md:43` |
| `build` | `tsc -p tsconfig.json` → `dist/` | `package.json:58`, `AGENTS.md:47` |
| `test:scripts` | `node --test "scripts/**/*.test.mjs"` | `package.json:59`, `AGENTS.md:41` |
| `check:docs` | `node scripts/check/host-paths.mjs && node scripts/check/agents-sync.mjs && node scripts/check/default-mode.mjs` | `package.json:60`, `AGENTS.md:44` |
| `check:mcp` | `node scripts/check/mcp-smoke.mjs` (spawn built `realm mcp` over stdio, both protocol eras; run `build` first) | `package.json:61`, `AGENTS.md:51` |
| `check:pack` | `node scripts/check/pack-smoke.mjs` (pack → install tarball into throwaway consumer; run `build` first) | `package.json:62`, `AGENTS.md:50` |
| `check:image-digests` | `node scripts/check/verify-image-digests.mjs` (`--dir`/`--image`; needs Podman; NOT in CI) | `package.json:63`, `AGENTS.md:45` |
| `build:image` | `node scripts/image/build-image.mjs` (needs Podman; NOT in CI) | `package.json:64`, `AGENTS.md:46` |
| `check:gates` | `node scripts/check/gate-closure.mjs && node scripts/check/module-size.mjs && node scripts/check/export-usage-gate.mjs && node scripts/check/lockfile-integrity.mjs` | `package.json:65`, `AGENTS.md:48` |
| `check:breaking` | `node scripts/check/breaking-change-guard.mjs` (range `origin/main..HEAD`; report-only exit 0 default, `--enforce` for exit 1; enforced by separate `breaking-change-guard.yml`, NOT part of `check:gates`) | `package.json:66`, `AGENTS.md:49` |
| `release:next` / `release:sync` / `release:changelog` | `node scripts/release/next-version.mjs` / `sync-version.mjs` / `changelog.mjs` (run only in the CI build job, never in PRs) | `package.json:67-69` |

Live suites (env-gated, not plain `npm test`): production live suite `test/integration/production-driver.test.ts` needs `REALM_LIVE_PRODUCTION=1` + Podman 5.x + `REALM_LIVE_IMAGE` + `REALM_LIVE_DRIVER_CONFIG` + rootless socket + `openshell` + built CLI + `REALM_DRIVER_SOCKET` (run alone: `npm run build && node --test --test-concurrency=1 dist/test/integration/production-driver.test.js`); Omp live harness needs `REALM_LIVE_OMP=1` (AGENTS.md:38-40).

## 4. CI matrix (`.github/workflows/ci.yml`)

Triggers: `push` to `main`, `pull_request` to `main`, `workflow_dispatch`; `permissions: contents: read`; concurrency `ci-${{ github.ref }}`, cancel-in-progress on PRs. All jobs on `ubuntu-24.04` GitHub-hosted runners (omega-ci self-hosted pool removed 2026-11-16).

| Job | Runner / Node | Steps in order (exact `run` commands) | Cite |
|---|---|---|---|
| `verify` (name: Verify (Node ${matrix})) | `ubuntu-24.04`, matrix `node-version: [22.x, 24.x]`; skipped if fork PR | `npm ci` → `npm run typecheck` → `npm run lint` → `npm test` → `npm run test:coverage` (only `22.x`) → `npm run test:integration` → `npm run test:scripts` → `npm run check:docs` → `npm run check:gates` → `npm run build` → `npm run check:pack` → `npm run check:mcp` | `ci.yml:22-34`, `ci.yml:47-108` |
| `site` (Build docs site) | `ubuntu-24.04`, Node `22.x` | `npm ci --prefix site` → `node scripts/docs/sync-site.mjs` → `npm run build --prefix site` | `ci.yml:110-137` |
| `audit` (Dependency audit) | `ubuntu-24.04`, Node `24.x` | `npm audit --omit=dev --audit-level=high` | `ci.yml:139-160`, `AGENTS.md:53` |
| `build` (Build release, main-only, needs verify+site+audit, `contents: read`) | `ubuntu-24.04`, Node `24.x` | `npm ci --ignore-scripts` → release plan/skip/superseded/normal → version bump + changelog + artifact upload | `ci.yml:162-192`, `AGENTS.md:123-127` |
| `publish` (main-only) | downloads artifacts only, write grants, no build | regenerate + attestation + push + GitHub release + dispatch `pages.yml` | `AGENTS.md:128-137` |

Notes: `verify` skips fork PRs (`github.event.pull_request.head.repo.full_name == github.repository`) — only the repo's own code runs. `check:breaking`/`check:image-digests`/`build:image` are NOT in this workflow's verify job (breaking guard is a separate workflow; image checks need Podman).

## 5. Project state context

- STATE.md: milestone v9.0 "Doctor health and concurrent binding" (phases 55-59 planned, release line 0.9.x), core value is fail-closed-in-realm + always-visible status, current phase 56, 55/59 verified per STATE head (`STATE.md:1-18`, `STATE.md:26-33`).
- ROADMAP Progress rows: Phase 55 (Omp plugin health check), 56 (F-51-1 cause), 57 (HTIER-01 retest), 58 (KIMV-02 rerun), 59 (concurrent binding impl) — all `0/0 | Planned` (`.planning/ROADMAP.md:702-706`); phases 55-59 depend on Phase 54 only, except 59 which additionally waits on owner ratification of the Phase 53 design; Phases 56/57/58 queue on the shared live window, Phase 55 is hermetic-first (`ROADMAP.md:637`).

## 6. Not verified in this slice

- Nothing in §§1–5 was run, built, linted, or executed this session (read-only discovery per assignment). Compile/lint/test/pack/mcp outcomes, the eslint full rule listing beyond lines 1-15 (elided ranges), and the publish/job tail of `ci.yml` beyond line 300 were not verified here (CI lines 1-300 read; file is 986 lines, remainder not inspected). CI command strings are quoted verbatim from `ci.yml:47-108` (verify job) and `ci.yml:128-160` (site/audit jobs) as read.
