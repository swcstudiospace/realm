# Anda decision note (superseded)

Status: superseded on 2026-11-17 by the owner decision to remove the Anda bridge in the 0.4 release line (milestone v4.0). The removal is done (Phase 28). This note records what was removed and where the rationale lives. It is not guidance.

Removed: the TypeScript bridge `src/anda/`, the `andaUrl` key of `config.json`, the error codes `ANDA_UNREACHABLE` and `ANDA_VERSION_MISMATCH`, the `degraded` session state and the `display.degraded` status field, the `anda-bridge` item of `realm doctor`, and the `anda.listener_failed` log event.

Rationale: `docs/integration/anda-replacement-research.md`. In short, the bridge made one anonymous GET of the well-known information route and carried no call and no credential. No host is recorded as running an engine. The direction of 2026-10-22, that Anda is an MCP client of Realm, needs no bridge.

What stays true: Anda, like any MCP client that speaks stdio, can launch `realm mcp` (see `docs/integration/mcp.md`). Nothing in Realm dials an Anda engine. The Phase 3 open questions OQ-P3-09 to OQ-P3-11 are dispositioned in the v4.0 decision section of `docs/integration/runtime-decision.md`.

History: the source note `docs/integration/anda.md`, this note's earlier content and `src/anda/` are at tag `v0.3.54`. The research note cites those files as read at that tag.
