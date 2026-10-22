# Anda decision note (ANDA-01, ANDA-04)

Status: decided for Phase 3. Sourced facts live in `docs/integration/anda.md` and are not repeated as new claims here.
Owner phase: Phase 3 (container runtime and bridges). Module: `src/anda/` (`shape.ts` now; `client.ts` in plan 03-06).
Read date of the sources: 2026-10-21 (ISO 8601), as recorded in `anda.md`.

## Decision summary

| Item | Decision | Reference |
| --- | --- | --- |
| Boundary | TypeScript client over the Anda Engine HTTP API. Phase 3 uses only the anonymous route `GET /.well-known/information`. | S-12, D-61 |
| Version handshake | A shape handshake, not a version check. Anda publishes no version surface. | D-61, OQ-P3-09 |
| Rust shim | None. No `src/anda/native/` directory. | D-66, ANDA-04 |
| Credentials | None are produced in Phase 3. `POST /{id}` and its credential format are not used. | OQ-P3-10 |
| Licence | Conflict in the sources. Open. It blocks vendoring any Anda code, not Phase 3. | OQ-P3-11 |

## 1. HTTP boundary (S-12)

Settled input S-12: the Anda bridge is a **TypeScript client over the Anda Engine HTTP API**. There is **no Rust shim**. A version handshake runs on connect, and reconnection uses bounded exponential backoff with jitter.

Phase 3 narrows the surface to one route:

- Used: `GET /.well-known/information`, documented as anonymous and returning `AppInformation`. The check in `src/anda/shape.ts` runs on this body.
- Not used: `POST /{id}`. Its RPC body layout and credential format are undocumented in the sources (`anda.md` Q2 and Q3). Calls through it are deferred (OQ-P3-10).

## 2. Evidence

Evidence comes from `docs/integration/anda.md` Q1, which read the server README "HTTP contract" table and the server source at the URLs listed in that note:

- The engine runtime is `anda_engine`. `anda_engine_server` is "a thin, stateless HTTP front-end".
- The documented routes are `GET /`, `GET /.well-known/information`, and `GET /.well-known/agents`, each returning `AppInformation` and allowing anonymous access. Also documented are `GET /.well-known/agents/{id}` and `POST /{id}`.
- Q2 records that the wire contract is language-agnostic HTTP. No TypeScript binding is documented, which is why the client is hand-written.

## 3. Shape-handshake limitation (D-61, OQ-P3-09)

`anda.md` Q4 records that no protocol or engine version is documented on any route. The `app_version` value is written only to the server startup log. `extra_info` is operator metadata and is not a protocol version.

Consequence: the ANDA-02 "version handshake" is implemented as a **shape handshake**. `checkAppInformationShape` in `src/anda/shape.ts` requires:

- the body is a JSON object;
- `engines` is an array;
- `default_engine` is a string or `null`;
- `start_time_ms` is a non-negative integer.

Any mismatch returns `ANDA_VERSION_MISMATCH`, and the failure detail names the field but never its value. Extra fields are ignored. This check is **not a protocol version check**. A pass means only that the body has the documented shape. It does not show that the engine's protocol matches what Realm expects.

When Anda publishes a version surface, it replaces this shape check, and this note records the change.

## 4. No-shim decision (D-66, ANDA-04)

ANDA-04 allows a Rust shim only when the documented surface is insufficient for a TypeScript client. The evidence shows a documented, language-agnostic HTTP surface (section 2). The documented anonymous route covers the Phase 3 handshake, so the shim condition is **not met**.

Decision: no shim. `src/anda/native/` is not created. The no-shim test (`test/anda/no-shim.test.ts`) asserts this, and asserts that this note cites `GET /.well-known/information`.

A shim is revisited only if the documented HTTP surface is found insufficient for a later phase. Adding one requires a new decision.

## 5. Licence conflict (OQ-P3-11)

`anda.md` Q6 records a conflict that this note does not resolve and no legal determination is made here:

- The workspace `Cargo.toml` says `MIT OR Apache-2.0`, and the root `LICENSE-MIT` and `LICENSE-APACHE` files are both present.
- The README sections and the anda_engine_server and anda_cli READMEs say MIT only.
- The GitHub sidebar reads "Apache-2.0, MIT licenses found".

Status: **open**. Default applied (OQ-P3-11): no Anda code, no Anda dependency, and no vendored file is added in Phase 3. The conflict must be resolved before any of them is added. It does **not** block Phase 3.

## 6. Credentials (OQ-P3-10)

Phase 3 produces **no credentials** for Anda. The only route used is anonymous. The ICP envelope and the bearer CWT are not implemented (`anda.md` Q3). Calls through `POST /{id}` need the RPC body layout and credential format first. That work belongs to the first phase that calls `POST /{id}`, which is Phase 4 or 5.

## 7. Phase 5 direction: Anda consumes Realm over MCP (P5-D1)

Recorded 2026-10-22. Anda consumes Realm over MCP: Realm exposes an MCP stdio server with revision 2026-07-28 semantics (`server/discover` probe plus `initialize` handshake; `docs/integration/mcp.md` Q5). The Anda MCP client speaks stdio with revision 2026-07-28 and older `initialize`-based revisions (`docs/integration/anda.md` Q5). This section introduces no new revision string and no Anda code; the Phase 3 HTTP boundary above is unchanged.

## 8. Revisit triggers

- Anda publishes a version surface: replace the shape check and record the change here.
- The documented HTTP surface proves insufficient for a required call: revisit the no-shim decision with a new decision ID.
- The licence conflict is resolved: record the result, then any vendoring decision.
