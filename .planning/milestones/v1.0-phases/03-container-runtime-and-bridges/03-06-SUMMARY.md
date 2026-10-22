# Plan 03-06 summary: Anda bridge, fakes, handshake and reconnect

## Status

Done for the plan's scope. Unit-verified against an in-process fake engine. Live behaviour against a real Anda Engine is not claimed.

## Files changed

- `src/anda/client.ts` (new): `AndaBridge`, the `BridgePort` implementation. One anonymous route, `GET /.well-known/information`. Shape handshake through `./shape.ts`. Backoff through `computeBackoffDelayMs` with base 500 ms and cap 30000 ms. Per-attempt timeout 2000 ms with request abort. `close()` aborts the stop signal, which clears every sleeping timer, and waits for the monitor loop to exit. No credential is produced and no POST route exists.
- `test/support/fake-anda.ts` (new): scripted HTTP engine on 127.0.0.1. Replies are `json`, `text`, `hang`, or `reset`. Records method, path, and headers, and whether the client abandoned a request. `waitUntil` lets tests await server-side events.
- `test/support/fake-bridge.ts` (new): in-memory `BridgePort` with `setDelay`, `failNext`, `beforeCall`, `calls`, `callCount`, and `emit({ kind, code? })`.
- `test/anda/handshake.test.ts` (new): 10 tests, titles cite ANDA-02.
- `test/anda/reconnect.test.ts` (new): 8 tests, titles cite ANDA-03.

## Tests

- `npx tsc -p tsconfig.json`: no errors in owned files. The only errors are the two known sibling imports (`test/integration/podman-gate.test.ts`, `test/quality/suite-taxonomy.test.ts`), which plan 03-10 fixes.
- `node --test dist/test/anda/handshake.test.js dist/test/anda/reconnect.test.js`: exit 0, 18 pass, 0 fail, 0 skipped.
- `npx eslint` on the five owned `.ts` files: no issues.

## Requirement evidence

- **ANDA-02**
  - Correct shape connects on one anonymous GET.
  - Six malformed bodies (JSON array, non-JSON, `engines`, `default_engine`, negative and missing `start_time_ms`) each fail once with `ANDA_VERSION_MISMATCH`, with no retry and no wait.
  - No request carries a credential header, and every request is the GET route.
  - The module source contains no POST and no credential production.
  - This is a shape check, not a version check (OQ-P3-09). A pass must not be reported as a version match.
- **ANDA-03**
  - An unreachable engine exhausts the deadline with `ANDA_UNREACHABLE`. Recorded waits are `[500, 1000, 2000]` against a 3500 ms deadline.
  - Waits stop growing at the cap: `[500, 1000, 1000, 1000, 500]`.
  - A hung engine times out each attempt, and the server observes every request aborted.
  - A mid-run outage publishes `down` once, retries with waits `[5, 10, 20]`, and publishes `up` on recovery.
  - A mismatch while monitoring publishes `mismatch` and stops probing.
  - `close()` cancels the sleeping monitor timer and an in-flight attempt timer. The live-timer count is unchanged after close.
  - `connect` after `close` rejects with `ANDA_UNREACHABLE` and sends nothing.
- **Live**: no live Anda Engine was contacted. No gated suite was added for this plan.

## Decisions and deviations

- **Events.** The bridge publishes `up`, `down`, and `mismatch` only after a successful connect, and only on transitions. A connect failure is reported by its rejection alone, per the `BridgePort` contract. Consequence for plan 03-09: `snapshot()` stays `null` through a healthy startup and is never `up` until an outage has recovered. The startup path therefore receives no bridge events while `connecting`.
- **Failure classes.** A non-200 status is unreachable. A 200 with a body that is not JSON, fails the shape check, or exceeds 64 KiB is a mismatch.
- **Clock and sleep.** `now` and `sleep` are injected. `sleep` takes an `AbortSignal` and resolves early on abort, so the bridge checks the signal after each wait.
- **`connect` runs once per bridge.** A second call throws a plain `Error`, which is a programming error and never reaches a host.
- **URL check.** `client.ts` carries its own http/https and no-userinfo check. `config.ts` keeps its check private, and this plan does not own that file.
- **Promise executor form.** `attempt` and `sleepUnlessAborted` use `new Promise`, not `Promise.withResolvers`, because `tsconfig.json` targets ES2023 and `withResolvers` is ES2024. This is the style rule's allowed exception.
- **Real timers in tests.** Three to four reconnect tests run the real timer, because the per-attempt timeout and timer cleanup are the behaviour under test. Each is marked in the file. Everything else uses a fake clock or event-driven waits.
- **No new dependencies.** Node built-ins only (`node:http`, `node:https`, `node:net` types).

## Open items

- OQ-P3-09: no Anda version surface, so the handshake remains a shape check.
- OQ-P3-10: RPC body and credentials not used in Phase 3.
- Plan 03-09 must wire `subscribe` before `connect` and use the `connect` rejection codes (`ANDA_UNREACHABLE`, `ANDA_VERSION_MISMATCH`) for the startup path.
