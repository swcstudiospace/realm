# Phase 9 Summary: Live Omp Verification

Status: complete on evidence. Hand-written by the orchestrator (gsd-verifier not run); flagged for owner ratification.

## Scope
- ROADMAP Phase 9 goal: a live Omp session attaches, reports a truthful disconnected status with its reason, retries, and leaves the daemon running on shutdown.
- Owner decisions carried forward: OMP-LIVE-01 (2026-10-23), OMP-LIVE-03 (2026-10-24), and OMP-LIVE-04 (2026-10-23) are descoped to a follow-up milestone; UI-01 is an accepted limitation (2026-10-23). This phase closes OMP-LIVE-02 on refreshed evidence.
- Accepted expansion (owner, 2026-10-24): on Podman 5.7.1 the daemon refused at startup with `SCHEMA_INVALID`, so the libpod client was fixed before a live check could mean anything.

## Root cause
- The libpod client sent unversioned routes (`/libpod/...`). Podman 5.7.1 answers unversioned libpod paths with 404 and serves only `/v<api-version>/libpod/...`.
- Startup reaping (`reapStartup`, then list by realm label) turned that 404 into `SCHEMA_INVALID`, and the daemon exited at startup.
- Inspect treated any 404 as absent, and remove accepted any 404 as removed, so a wrong route was masked as success in those two calls.

## Change
- `src/runtime/libpod-routes.ts`: routes are built under `/v<api-version>`; `matchLibpodRoute` matches only versioned paths; `checkRouteId` runs before any socket request; `PING_PATH`, `LIBPOD_API_VERSION_HEADER`, and `API_VERSION_PATTERN` are exported.
- `src/runtime/libpod-client.ts`: the API version is read once per transport from `GET /_ping` (header `Libpod-Api-Version`) and cached in a module-level `WeakMap`; a failed probe is dropped and retried on the next call; a missing or malformed version is `SCHEMA_INVALID`. Inspect returns null only for a 404 whose JSON `cause` is `no such container`. Remove treats only that 404 as removed; any other 404 is `SCHEMA_INVALID`.
- `test/support/fake-libpod.ts`: answers `/_ping` with the version header (configurable, or omitted); the missing-container 404 carries Podman's `cause`; unversioned libpod paths are not matched.
- `test/runtime/libpod-api-version.test.ts` (new, 7 tests): versioned target, version read once, missing version fails closed, route-level 404 on list, inspect, and remove fails closed, inspect returns null for no-such-container.
- `test/runtime/libpod-client.test.ts`: the force-flag assertion checks the route suffix and force query, not the unversioned string.
- `test/runtime/openshell-routing.test.ts`: the no-process routing invariant exempts exactly the `GET /_ping` version probe; every other recorded request must match a route and must not start a process.

## Commands and outcomes
| Step | Command | Outcome |
|---|---|---|
| typecheck | `npm run typecheck` | exit 0 |
| lint | `npm run lint` | exit 0 |
| build | `npm run build` | exit 0 |
| targeted | `node --test` on libpod-api-version, libpod-client, sweep, down-sweep, sweep-timeout | 30 pass, 0 fail |
| unit | `npm test` | 1136 total, 1127 pass, 0 fail, 9 skipped (baseline 1129 / 1120 / 9; +7 new tests, all pass) |
| integration, default PATH (Podman 4.9.3) | `npm run test:integration` | 9 skipped, `PODMAN_UNSUPPORTED_VERSION` (expected below 5.x) |
| integration, Podman 5.7.1 | `npm run test:integration` with the 5.7.1 binary first on PATH and XDG_RUNTIME_DIR pointing at the dedicated rootless user's runtime dir | 9 tests: 1 pass (RT-02), 0 fail, 8 skipped (REALM_LIVE_IMAGE and REALM_LIVE_WORKLOAD unset) |
| scripts, docs, gates, pack, mcp, site | `npm run test:scripts`, `check:docs`, `check:gates`, `check:pack`, `check:mcp`, site build | all exit 0 |
| live daemon before the fix | daemon run as the dedicated rootless user, 40 s limit | exited at startup with `SCHEMA_INVALID` from the reaper |
| live daemon after the fix | same user, rootless Podman 5.7.1 service; daemon ran past its 40 s limit without exiting and created its control socket | `realm status`: state `unbound`, reason `no workspace`, display `realm disconnected`, degraded false, mode advisory |

## Evidence limits
- The Omp UI was not re-run in this pass. The status text comes from the daemon's status response, which is what the Omp status item displays. OMP-LIVE-02's previous re-run line (`SCHEMA_INVALID`) is now stale; the current reason is `no workspace`.
- No Omp session attached in this pass; OMP-LIVE-01, -03, and -04 remain descoped by owner decision.
- The live integration bodies (REALM_LIVE_IMAGE, REALM_LIVE_WORKLOAD) are unset; the 8 skips stand.

## Open finding (not a Phase 9 blocker)
- The rootful shared container store's db file mtime changed during the root-run Podman 5.7.1 integration window (03:11:35 to 03:12:18). The writer is not attributed. The realm's Podman probe passes only PATH, HOME, and XDG_RUNTIME_DIR to Podman children, so the realm cannot be pointed at a separate store by config. The realm daemon run for this phase was rootless and used its own store; it made no rootful call.

## Follow-ups
- Owner: ratify these hand-written artifacts. Decide whether the OMP-LIVE-02 traceability text in REQUIREMENTS (which records `SCHEMA_INVALID`) should be updated through a GSD command.
- Owner: decide whether 5.x integration runs should use the rootless user instead of root, so they cannot touch the rootful store.
