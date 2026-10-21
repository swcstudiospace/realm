# Plan 03-04 Summary: Libpod route table, closed client, fake libpod server

Status: done for unit scope. Live behaviour is gated and unverified (Podman 4.9.3 on the development host; the gated suite needs 5.x).

## Files

- `src/runtime/libpod-routes.ts` (new): provisional route table `LIBPOD_ROUTES` (frozen), path resolution `routeTarget`, route matching `matchLibpodRoute` for the fake, container-id pattern, and the provisional response field paths.
- `src/runtime/libpod-client.ts` (new): closed `LibpodClient` over `node:http` with `socketPath`. Public methods are exactly `info`, `listContainersByLabel`, `inspectContainer`, `stopContainer`, `removeContainer`. All helpers are module-level functions, so the prototype carries no other member.
- `test/support/fake-libpod.ts` (new helper): Unix-socket libpod stand-in. It imports its route matching from the routes module, records every request and every socket close, supports per-route delay, one-shot hang, and one-shot raw reply. It exports `FakeContainerStore`, the store that plan 03-05's OpenShell fake shares.
- `test/runtime/libpod-client.test.ts` (new): 13 tests, all titles cite RT-03 or RT-09.

## Test results

- `node --test dist/test/runtime/libpod-client.test.js`: exit 0, 13 pass, 0 fail, 0 skipped.
- `npx tsc -p tsconfig.json`: exit 2. The only errors are in `test/integration/podman-gate.test.ts` and `test/quality/suite-taxonomy.test.ts`, which import `./podman-version.js` / `../integration/podman-version.js` while a sibling plan is moving that file. Output is still emitted, and no error is in a file this plan owns.
- `npx eslint` on the four owned files: no issues.

## Requirement evidence

- RT-03 (structural guard): the key-set test pins the five-method prototype set. The source test finds no `exec` or `attach` substring in the routes module or the client module, and no `/start` substring in any route path. The guard is structural only: there is no route to call, and there is no live proof.
- RT-03 (no injection): container ids are validated against a pattern before they reach a path, so a crafted id never reaches the socket. A malformed response gives `SCHEMA_INVALID`, and a relative socket path is refused at construction.
- RT-09 (support): list, inspect, stop, and remove round-trip against the fake. A removal of a missing container counts as success. A timed-out request rejects and its socket is destroyed, confirmed by the fake's socket-close record. Live zero-orphan proof is gated (plan 03-08 and the gated suite), not verified here.

## Decisions applied where the plan or catalogue left a choice

- Timeout and transport failure map to `PODMAN_MACHINE_DOWN`. This is the code D-53 already gives a socket timeout. The error catalogue is frozen, so no code was added.
- Malformed body, missing response fields, and unexpected HTTP statuses map to `SCHEMA_INVALID`. The response body is never echoed into an error.
- `withTimeout` is not used for the request bound, because it only rejects. Each request has its own timer, and on expiry it fails the promise and destroys the request's socket (F-P3-05).
- `inspectContainer` returns `null` on 404. It returns the raw inspect object otherwise, and the hardening verifier (D-51) owns its field checks.
- `stopContainer` accepts only 204 and 304. A 404 is an error, so a wrong route cannot report a stop that did not happen. Plan 03-08 must handle an already-removed container explicitly.
- `removeContainer` accepts 204 and 404, as the plan requires. A 409 (running, without force) gives `SCHEMA_INVALID`.
- The list call sets `all=true` so stopped containers are visible to the sweep. The label key is validated and must not contain `=`.
- The routes are unversioned `/libpod/...` paths, and the query names are provisional. They are marked provisional in the routes file and are confirmed only by the gated suite (podman.md Q5, S-09).

## Deviations and open items

- The OpenShell fake (plan 03-05) must add its containers to the `FakeContainerStore` passed to `FakeLibpod`, which is how the two fakes share state.
- AgentOS and the concrete driver are not touched by this plan.
- No new npm dependency was added. The client uses `node:http` with `socketPath` only.
- The test file uses `/run/user/1000/podman/podman.sock` only as an example absolute path that is never opened, because the client constructor does not connect.
