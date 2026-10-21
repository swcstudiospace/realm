# Plan 03-05 Summary: OpenShell adapter, argv, policy document, fake

Status: done for unit scope. Live behaviour is gated and unverified: the development host runs Podman 4.9.3, and the OpenShell Podman driver needs 5.x (S-09). Nothing here claims a live sandbox start.

## Files

- `src/runtime/openshell.ts` (new): pinned create argv builder `buildCreateArgv`, idempotent create `runOpenShellCreate` (label lookup, one run, 250 ms poll to a caller deadline), policy document `buildPolicyDocument`, and the atomic policy write `writePolicyDocument` (`<stateDir>/runtime/<sessionId>.policy.json`).
- `test/support/fake-openshell.ts` (new helper): scripted `FakeOpenShell` runner. It records each argv exactly as built, and a successful create adds a labelled container to the `FakeContainerStore` that `FakeLibpod` serves, so the two fakes share one store.
- `test/runtime/openshell-argv.test.ts` (new): 12 tests.
- `test/runtime/openshell-policy.test.ts` (new): 8 tests.

## Test results

- `npx tsc -p tsconfig.json`: no errors in the files this plan owns. The remaining errors are the known `podman-gate` and `suite-taxonomy` imports (plan 03-10), and `agentos` imports from a sibling plan that is still landing.
- `node --test dist/test/runtime/openshell-argv.test.js dist/test/runtime/openshell-policy.test.js`: exit 0, 20 pass, 0 fail, 0 skipped.
- `npx eslint` on the four owned files: no issues.

Test titles (all cite RT-03, with AUD-02 or CORE-06 where they apply):

- argv: exact pinned 0.1.2 sequence; no `--env` or `--provider` (or prefixed form) before `--`; workload follows `--`; every pre-separator flag is in the pinned set; invalid inputs refused with `SCHEMA_INVALID` before any run; repeated create runs the runner once (CORE-06); runner receives the exact argv; non-zero exit gives `OPENSHELL_START_FAILED` after one run; a runner that cannot start gives `OPENSHELL_START_FAILED` with no raw text; no labelled container gives `OPENSHELL_START_FAILED` at the deadline; a hung runner is bounded and told its budget; two labelled containers fail closed with no run (CORE-06).
- policy: JSON round trip; version 1, `hard_requirement`, non-root run user; read-write `/workspace` only; empty `network_policies`; file path and mode 0600; second write is identical and stays 0600; exact top-level key set and no secret, environment, or endpoint token; invalid session id or relative state dir refused with no runtime directory created.

## Requirement evidence

- RT-03 (argv and policy, unit): the argv and the policy document are pinned by deep-equality tests, and the create path is the only builder of the sandbox start argv. The no-bypass structural proof (`openshell-routing.test.ts`) belongs to plan 03-08 and is not claimed here.
- AUD-02 (unit): `--env` and `--provider` are absent before the separator; the workload may contain those strings only after `--`.
- CORE-06 (unit): a repeated create reuses the labelled container with one runner call.
- Live-gated and unverified, each with the default applied: OQ-P3-01 (driver applies `--label`; default yes), OQ-P3-02 (`/workspace` bind path), OQ-P3-03 (digest passing; the D-51 verifier refuses a mismatch), OQ-P3-12 (`--no-keep` with `--detach` semantics; verbs stay pinned), OQ-P3-14 (PID, read-only, and cap-drop enforcement), OQ-P3-15 (OpenShell accepts the policy as JSON).

## Deviations and decisions

- `buildPolicyDocument()` takes no argument. The plan wrote `buildPolicyDocument(config)`. The document reads no configuration field, so passing a config would only invite a leak into the file.
- The runner contract is `(argv, { timeoutMs }) => Promise<{ exitCode }>`, where `argv[0]` is the binary. It differs from the probe's `(file, args, options)` shape so that the argv under test is the exact `openshell sandbox create ...` sequence. The runner must start argv[0] with no shell and must stop the process when `timeoutMs` expires, because `withTimeout` only rejects (F-P3-05).
- The poll treats a failed or late label lookup as "not visible yet" until the deadline. A failed lookup before create propagates the client's own code (for example `PODMAN_MACHINE_DOWN`), because it says why the start could not be checked.
- An ambiguous label match (more than one container for one session) fails closed with `OPENSHELL_START_FAILED`. This is a small guard I added; no requirement named it.
- `writePolicyDocument` writes through `atomicWriteFile`, which creates new files at 0600 and carries over the mode of an existing file. A file already present with a wider mode would keep that mode. Realm-created files are 0600. The runtime directory is 0700 and realm-owned, so no extra check was added.
- `SESSION_ID_PATTERN` is not exported from `src/session/paths.ts`, and that file is not in this plan's ownership. The session id is validated through `recordFileName`, which applies the same rule and throws `SCHEMA_INVALID`.
- The OQ-P3-12 note (`--no-keep` with `--detach`) belongs in `docs/integration/runtime-decision.md`, which this plan does not own. The code header records it, and the decision note needs the same entry from its owner.

## Open items for later plans

- Plan 03-08 (`session-execution.ts`) must supply the production runner. It must spawn argv[0] with no shell and must pass an explicit minimal environment to the `openshell` CLI, because this adapter passes no environment option. It must also kill the process on `timeoutMs`, and it must never echo runner output into an error.
- Plan 03-08 must order the policy write before the create, and must pass `policyPath` from `writePolicyDocument`, which returns the resolved path.
- Plan 03-08 owns the 1 GiB and 2-CPU values for `--memory` and `--cpu`. The `memory` argument must match `^[1-9][0-9]{0,11}[bkmgBKMG]?$`, so use a value such as `1g`.
