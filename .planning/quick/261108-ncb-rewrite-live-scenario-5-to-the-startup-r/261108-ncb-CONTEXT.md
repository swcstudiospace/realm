# Quick task L1: rewrite live scenario 5 to the startup re-adoption behaviour

## Why (evidence, not opinion)

Owner decision D5 (`docs/integration/runtime-decision.md`, section "Startup reaper and scratch volume", around line 457) made the startup reaper RE-ADOPT a running realm container that passes the hardening verifier. It removes only what it cannot prove good.

A live run on 2026-11-08 confirmed it. After the daemon was SIGKILLed, the next `realm up` reached active with exactly one sandbox and one container, and `realm status` carried a notice beginning "1 session(s) from the previous daemon were adopted and kept." (`src/daemon/daemon.ts`, function `startupNoticeOf`), not "destroyed at startup". The scenario "production live 5" in `test/integration/production-driver.test.ts` still asserts the superseded behaviour (a "destroyed at startup" notice, a removal count of 1, a `daemon.startup` line naming the removed container) and failed at exactly that assertion.

The daemon writes one `daemon.startup` JSON line per start (`src/daemon/main.ts`, function `emitStartup`) with `containersRemoved`, `containerIds`, `recordsDeleted`, `adopted`, and more.

## Locked decisions

- Scenario 5 becomes "adopt after crash". Keep its steps up to the SIGKILL and the daemon-gone poll.
- Before the kill, write a marker file into the project workspace through the MCP `write` tool (see scenario 6 for `startMcpSession`, `initializeMcp`, `callTool`). Every file the scenario leaves in the pinned workspace is named in `WORKSPACE_FILES`, so cleanup removes it.
- After `realm up` restarts the daemon, assert all of these:
  - status reaches active;
  - exactly one daemon process from the compiled daemon entry, and its pid is new;
  - exactly one sandbox and one container for the sandbox name;
  - the container id equals the id captured before the kill (compare by prefix in either direction: the list taken before the kill prints Podman's short id, the daemon logs the full one);
  - the status notice (`noticeOfStatus`) contains "adopted and kept", states the count 1, and does NOT contain "destroyed at startup";
  - `daemon.log` holds a `daemon.startup` JSON line with `adopted === 1`, `containersRemoved === 0` and `recordsDeleted === 0`;
  - the workspace marker reads back through the MCP `read` tool with identical bytes;
  - `realm audit verify` still reports ok, exactly as the scenario does today.
- Keep the catch block that runs one extra `up`, so a failure cannot strand a sandbox.
- In `test/support/production-live.ts`, replace `startupReapLineFor` by pure helpers with explicit parameters:
  - `startupLineWith(log, expected)` returns the first `daemon.startup` JSON line whose `adopted`, `containersRemoved` and `recordsDeleted` equal the numbers given in `expected` (each field optional; a field not named is not compared) and, when `expected.containerId` is given, whose `containerIds` include an id equal to it, or starting with it, or that it starts with;
  - `adoptedCountOfNotice(notice)` parses "<n> session(s) from the previous daemon were adopted and kept".
  Remove helpers that become unused (clean cutover) and fix the import list in `production-driver.test.ts`.
- Hermetic fixed-input tests in `test/integration/production-live-helpers.test.ts` for each new or changed helper: positive; wrong counts; non-JSON lines skipped; line without the `daemon.startup` event; notice without the adopted sentence; notice with both sentences; id prefix match in both directions.

## Files in scope

`test/integration/production-driver.test.ts`, `test/support/production-live.ts`, `test/integration/production-live-helpers.test.ts`. Nothing else.

## Execution notes

- The live scenarios are gated (`REALM_LIVE_PRODUCTION=1`) and must stay skipped here. Do not run them, and do not touch the live stack: nothing under the live account's home directory, no podman, openshell or systemctl.
- Verify with the hermetic helper tests only: `flock -w 7200 <heavy-slot lock> npm run typecheck`, then the same lock around `npm run build && node --test dist/test/integration/production-live-helpers.test.js`, then `npm run lint` under the lock.
- Do not edit CHANGELOG.md, package.json, package-lock.json, `.github/**` or `release/**`. `.planning/config.json` has an uncommitted orchestrator change: never stage it.
