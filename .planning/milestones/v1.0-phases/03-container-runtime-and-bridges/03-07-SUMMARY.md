# Plan 03-07 Summary: AgentOS port, crash-loop supervisor, hardening verifier

Status: done (unit-verified). No live I/O. The concrete AgentOS driver is not bound: blocked by OQ-P3-05 and OQ-P3-06. The live hardening proof is gated (OQ-P3-14).

## Files

- `src/runtime/agentos.ts` (new): `AgentOsDriver` port (`start`, `alive`, `stop`), the `AgentOsSupervisor` class (`start`, `check`, `stop`, `consecutiveFailures`), and the constants base 500 ms, cap 8000 ms, 5 consecutive failures, 60000 ms stable window. Imports only `core/backoff` and `core/errors`.
- `src/runtime/hardening.ts` (new): frozen `HARDENING_PROFILE`, the ordered `HARDENING_PROPERTIES` list, and `verifyInspect(binding, inspect)`, which returns the failed property names (empty on conformance). Imports nothing.
- `test/support/fake-agentos.ts` (new): in-memory `AgentOsDriver` with per-operation scripted outcomes (`ok`, `reject`, `hang`), a `crash()` helper, and a call log.
- `test/runtime/agentos-supervisor.test.ts` (new): 11 tests, each title citing RT-04.
- `test/runtime/hardening.test.ts` (new): 36 tests, each title citing RT-01.

## Behaviour

- Restart policy (D-59): a crash (alive false, or no answer within `callTimeoutMs`) or a failed start is one failure. Each failure stops the driver best effort, waits `computeBackoffDelayMs(failures - 1, 500, 8000, random)`, then starts again. The fifth consecutive failure holds the supervisor and throws `AGENTOS_CRASH_LOOP` (retryable). `check()` throws while held. An explicit `start()` resets the count and runs again.
- The count resets to 0 only after 60000 ms of continuous alive, on the injected clock. A crash inside the window keeps the count.
- Every driver call is raced against `callTimeoutMs`. A timed-out call counts as a failed attempt, and its late result is ignored.
- `stop()` is best effort. A failed or hung stop does not block teardown. The session container removal is the hard guarantee.
- Verifier (D-51): each property is checked on its own and reports its name. A missing, mistyped, or unrecognised field fails that property. `rootless` comes from the binding (libpod info), not the inspect. Mounts must be exactly two bind mounts, whose sources are the workspace root and the state directory. No path segment may be `docker.sock` or `podman.sock`.

## Verification

- `npx tsc -p tsconfig.json`: no errors in owned files. The only errors are the two known sibling imports of the moved podman-version path (`test/integration/podman-gate.test.ts`, `test/quality/suite-taxonomy.test.ts`), which plan 03-10 fixes.
- `node --test dist/test/runtime/agentos-supervisor.test.js dist/test/runtime/hardening.test.js`: 47 pass, 0 fail, 0 skipped.
- `npx eslint` on the five owned `.ts` files: no issues.

## Requirement evidence

- RT-04: the bounded backoff, the `AGENTOS_CRASH_LOOP` on the fifth consecutive failure, the stable-window reset, the timeout on a hung driver, and the no-binding check are covered by `test/runtime/agentos-supervisor.test.ts`.
- RT-01: every D-51 property has a wrong-value and a missing-field case in `test/runtime/hardening.test.ts`. A conforming inspect yields an empty list. The live container check is gated (OQ-P3-14) and is not claimed here.

## Deviations and design choices

- `verifyInspect` takes a `HardeningBinding` (`image`, `rootless`, `workspaceRoot`, `stateDir`) as its first argument, not the bare profile. D-51 needs the pinned digest, the rootless flag from info, and the two mount sources. The numeric profile stays in the frozen `HARDENING_PROFILE` constant.
- `check()` recovers a crash inline. It returns true after a successful restart, so a probe can wait for up to five bounded attempts. The caller in plan 03-08 must bound the probe.
- `callTimeoutMs` is a required option with no default. Plan 03-08 must supply it.
- The driver-call race is local to `agentos.ts`, not `withTimeout`. `withTimeout` requires a catalogue code, and no catalogue code names a driver-call timeout. No code was added (D-10 frozen table).
- Mount assumption: only `Type: "bind"` entries are admitted, and libpod tmpfs entries are not expected in `Mounts`. This is provisional (podman.md Q5) and confirmed only by the gated suite.
- Residual gap: the socket rule matches socket names in path segments. A mount whose source is a directory that merely contains a socket is caught only by the exact two-mount rule and the config checks. The verifier cannot see the filesystem.
- The runtime decision note must record OQ-P3-05 and OQ-P3-06 as blocked for the concrete AgentOS driver. That note is not in this plan's `files_modified`, so the orchestrator or the owning plan records it.
- No dependency was added. No AgentOS package is named in any owned file; a test checks this.
