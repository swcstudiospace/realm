---
phase: 43-kimi-and-kimi-code-rehearsal
plan: "01"
requirements: [KIMI-01]
---

# 43-01 summary: live wiring for the two Kimi hosts

## What changed (test support and tests only; nothing under src)

- `test/support/host-live.ts`: kimi-code is in `LiveHostId`, `LIVE_HOST_IDS`, `HOST_LIVE` (opt-in `REALM_LIVE_KIMI_CODE`, override `REALM_KIMI_CODE_BIN`, default binary `kimi`, version 2.6.3, production tier), `PRODUCT_WORDS` and `HOST_OVERRIDE_VARIABLES` (`KIMI_CODE_HOME`). kimi has a production tier. `KIMI_CODE_GAP` is gone. The gate skips the archived stub for both Kimi hosts and guards the product by major version (kimi needs < 2, kimi-code >= 2); each sentence names the variable to repoint. `runHostProduction` takes five hosts, a session drive with `env` and `credential: "fixed-key"`, and a command drive (`kind: "command"`, `args`, `restore`); `productionOverrides` holds the per-host configuration homes and throws on an unknown host.
- `test/support/host-live-session.ts`: `startRefusingProvider({ expectedKey })` records `matchesKey` (booleans only); `writeWireRecorder({ restoreEnv })` writes the pairs to `wire-restore.json` (0600), restores absent names into the target and logs the sorted names; `readWireLog` and `wireSummary` carry `restored` and `restoredNames`.
- `test/support/host-live-kimi.ts` (new): `KIMI_REHEARSAL_KEY`, `KIMI_REHEARSAL_MODEL`, `kimiCodeSessionArgs`, `kimiCodeDriveEnv`, `kimiContainmentEnv`, `KIMI_RESTORED_ENV`, `credentialNamesOf`.
- `test/support/host-live-wave2.ts`, `test/support/host-registry.ts`: the wave 2 type excludes kimi-code; the kimi-code record says `live: "kimi-code"` (t2 and t3 untouched).
- `test/integration/host-live-kimi.test.ts` (validator with containment, validator session, production command drive), `host-live-kimi-code.test.ts` (new: validator, validator session, production session), `host-live-kimi-helpers.test.ts` (new), and the extended `host-live-helpers.test.ts` and `host-live-session-helpers.test.ts`.
- `docs/integration/host-support-matrix.md`: regenerated; only the kimi-code live column changed (`none` to `REALM_LIVE_KIMI_CODE=1`).

## Verification run

Build, the ten test files of the plan (104 tests, 89 pass, 0 fail, 15 skipped live tests), `eslint` on the changed files, `npm run check:gates`, `node scripts/check/host-paths.mjs`, `suite-taxonomy`, and `dist/test/docs` plus `dist/test/host` (1505 of 1506; `boot-driver` "a call refused while the first attempt is in flight" is an intermittent failure that passes on a rerun and touches nothing changed here). Run as root in this environment, not as a regular user.

## Deviations

- `credentialNamesOf` follows the plan (KIMI_ or MOONSHOT_ prefix, _API_KEY or _TOKEN suffix), so the Kimi configuration names (KIMI_MODEL_NAME, KIMI_CODE_HOME and so on) are listed by it too. The hermetic test therefore compares the result with the exact expected KIMI_ name list and separately asserts that the only key-shaped name is KIMI_MODEL_API_KEY, instead of comparing with a single name.
- The kimi-code `0.0.1` "older version never skips" case is excluded (as planned); the 99.0.0 "newer never skips" case uses 1.99.0 for the legacy kimi row, because 99.x is Kimi Code.

## Live steps for Plan 43-02

Gate variables: `REALM_LIVE_KIMI=1` (+ `REALM_KIMI_BIN` absolute path to the legacy 1.51.0 `kimi`) and `REALM_LIVE_KIMI_CODE=1` (+ `REALM_KIMI_CODE_BIN` absolute path to the 2.6.3 `kimi`). Production adds `REALM_LIVE_PRODUCTION=1`, `REALM_LIVE_IMAGE`, `REALM_LIVE_DRIVER_CONFIG`, `REALM_DRIVER_SOCKET` and the rootless Podman socket.
Select by title prefix: `kimi validator:`, `kimi validator session:`, `kimi production:`, `kimi-code validator:`, `kimi-code validator session:`, `kimi-code production:` (`node --test --test-name-pattern=... dist/test/integration/host-live-kimi.test.js dist/test/integration/host-live-kimi-code.test.js`).
