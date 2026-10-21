# Plan 03-03 summary: Anda shape check and Phase 3 decision notes

## Status

Done for the plan's scope. Live behaviour is not claimed: this plan has no network I/O, and the Anda handshake tests belong to plan 03-06.

## Files changed

- `src/anda/shape.ts` (new): hand-written `AppInformation` shape check, `checkAppInformationShape`. Imports `core` only. Failures return `ANDA_VERSION_MISMATCH` with a detail that names the field and never its value.
- `test/anda/boundary-decision.test.ts` (new): six tests that read `docs/integration/anda-decision.md`.
- `test/anda/no-shim.test.ts` (new): checks that `src/anda/native/` is absent, and that the decision note cites `GET /.well-known/information`.
- `docs/integration/anda-decision.md` (new): HTTP boundary (S-12), evidence (anda.md Q1), shape-handshake limitation (D-61, OQ-P3-09), no-shim decision (D-66), licence conflict (OQ-P3-11), no credentials in Phase 3 (OQ-P3-10).
- `docs/integration/runtime-decision.md` (new): layering S-08 with the RT-01 and RT-03 wording conflicts (D-46, D-47, reported, not edited); Podman gate S-09; OpenShell pin S-10; AgentOS mode S-11; all sixteen OQ-P3 items with defaults and blocked modules; F-P3-08 naming decision; host observations.
- `docs/integration/{podman,openshell,agentos,anda}.md`: a "Phase 3 resolution" section appended at the tail. Sourced answers, URLs and read dates are unchanged (the diff has zero removed lines).
- `.planning/phases/03-container-runtime-and-bridges/03-03-SUMMARY.md` (this file).

## Tests

- `test/anda/boundary-decision.test.ts`: six tests, titles cite ANDA-01.
- `test/anda/no-shim.test.ts`: two tests, titles cite ANDA-04.
- Red state before the note existed: both suites failed with ENOENT on the note.
- Green state: `node --test dist/test/anda/boundary-decision.test.js dist/test/anda/no-shim.test.js` exits 0, with 8 pass, 0 fail, 0 skipped.
- `npx eslint` on the three owned `.ts` files: exit 0.
- `npx tsc -p tsconfig.json`: no errors in `src/anda` or `test/anda`. Errors remain in sibling in-progress files (`test/runtime/libpod-client.test.ts`, `test/integration/podman-gate.test.ts`, `test/quality/suite-taxonomy.test.ts`). They were not fixed.

## Requirement evidence

- **ANDA-01:** the boundary tests pass against the written note. The note records the five required items.
- **ANDA-04:** the no-shim tests pass. `src/anda/native/` does not exist.
- **ANDA-02 (partial, by design):** `checkAppInformationShape` exists. Eleven malformed bodies were probed against the compiled module (non-object or null or array body; `engines` not an array or missing; `default_engine` not a string or null or missing; `start_time_ms` negative, fractional, a string, or missing). All fail closed with `ANDA_VERSION_MISMATCH`, and no detail echoed a value. The probe was not committed. The shape-rejection tests belong to plan 03-06 (`test/anda/handshake.test.ts`). This is a shape handshake, not a protocol version check.

## Observations recorded in the notes

- Host Podman is 4.9.3 (`podman --version`), below the 5.x floor.
- `openshell 0.1.2` is installed, and its `sandbox create --help` lists every pinned flag. It also lists `--from`, which is not in the pinned argv. This bears on OQ-P3-03 and is recorded there.
- `podman run --help` on 4.9.3 lists the hardening and limit flags. The help text does not confirm the `no-new-privileges` default, so that stays live-gated.

## Deviations, blockers and open questions

- No deviation from the plan's file list. Shape-rejection tests are deferred to plan 03-06 by file ownership.
- Blocked, not done: the concrete AgentOS driver (OQ-P3-05) and the `@rivet-dev/agentos-core` dependency (OQ-P3-06). Default applied: port and supervisor only.
- Live-gated, fail closed: OQ-P3-01, 02, 03, 12, 14, 15.
- Requirement-wording decision for the user: RT-01 and RT-03 (and ROADMAP SC2, SC3) contradict S-08. The gateway-inside-container wording is superseded by S-08 (D-46, D-47). The requirement text is not edited.
- Licence conflict OQ-P3-11 stays open. No Anda code or dependency is added, so it does not block this phase.
