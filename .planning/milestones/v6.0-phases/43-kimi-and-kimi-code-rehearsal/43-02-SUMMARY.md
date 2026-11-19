---
phase: 43-kimi-and-kimi-code-rehearsal
plan: "02"
requirements: [KIMI-01, KIMI-02]
---

# 43-02 summary: scratch installs, the window and the recorded results

Written from the window evidence of 2026-11-18 (kept outside the repository, never named here). Nothing under `src` changed, and the window ran no model turn and no tool call.

## Install records (Task 1)

| CLI | Source and command shape | Facts |
| --- | --- | --- |
| Kimi Code 2.6.3 | npm registry, `npm install --prefix SCRATCH_DIR --ignore-scripts --no-audit --no-fund @moonshot-ai/kimi-code@2.6.3` | the lockfile integrity equals the registry `dist.integrity`; Node `>=22.19.0` required, 24.18.0 used; 57 MB; `--version` prints 2.6.3 as the `realmlive` account; scripts off works (OQ-43-04 answered: it runs without its postinstall) |
| kimi-cli 1.51.0 (legacy) | PyPI wheel, a virtual environment on the system Python 3.12 (`uv venv` with the system interpreter, `uv pip install kimi-cli==1.51.0`) | the wheel SHA-256 of a separate `pip download --no-deps` equals the PyPI digest; 209 MB; 127 frozen dependencies, not hash-pinned (accepted residual); `--version` prints `kimi, version 1.51.0`; the 1.52.0 release is the archived stub |

Both trees were made readable and runnable by the `realmlive` account and sit outside the repository (OQ-43-05 answered: the free space on the system disk stayed at 11 GB, 98 percent, before and after the installs). The install date is 2026-11-18.

## The window (Task 4)

Account `realmlive`, production stack, rootless Podman 5.7.1, the shared live lock held, `main` at commit 8c4c62b. Each production run was cold: no warm-up, a new project directory, and the stack showed 0 containers, 0 sandboxes, an empty workspace and no daemon before the window. The tests never set a gate variable; the person set them for the command.

| Host | Tier | Result | Marks and diagnostics |
| --- | --- | --- | --- |
| kimi 1.51.0 | validator | passed 1 of 1 | `kimi mcp list` and `kimi mcp test` against the stub realm, `kimi mcp remove` drifted; 60.2 s for the test |
| kimi 1.51.0 | validator session | passed 1 of 1 | `kimi mcp test realm` against the fake server returned after 18058 ms and printed `Testing connection to 'realm'...` (OQ-43-02 answered: the wording of the first line is that; no success word was asserted); XDG_RUNTIME_DIR, XDG_CONFIG_HOME and REALM_DRIVER_SOCKET not forwarded |
| kimi 1.51.0 | production | **failed**, 0 of 1 | `kimi mcp test realm` exited 0 after 18225 ms (below the 25000 ms bound); first failing assertion: "the host must have listed the Realm tools through the recorder: host methods [initialize, notifications/initialized, tools/list], tools []"; the recorder restored REALM_DRIVER_SOCKET, XDG_CONFIG_HOME and XDG_RUNTIME_DIR |
| Kimi Code 2.6.3 | validator | passed 1 of 1 | `kimi doctor` exit 0 (first line `Kimi doctor`); `kimi mcp list` is `unknown command 'mcp'` (OQ-43-01 and B-43-03 are not triggered: see the session row) |
| Kimi Code 2.6.3 | validator session | passed 1 of 1 | `kimi -p` launched the registered server: `initialize`, `notifications/initialized`, `tools/list`, the six tools; ready after 12005 ms; the provider saw 0 requests; the server saw the whole host environment, including the placeholder `KIMI_MODEL_API_KEY` |
| Kimi Code 2.6.3 | production | passed 1 of 1 | the wire shows the handshake, `tools/list` and the six tools; the host command took 37405 ms because Kimi Code retries the refused model request and the drive ended it after the boot was observed; the provider saw 6 requests, 6 with the fixed key, loopback peers only |

5 of 6 tests passed. The stack was clean before and after the window. Snapshots show one container, one sandbox and one daemon right after the legacy kimi production run; they were gone by the snapshot after the Kimi Code runs, and the evidence read for this summary does not say which step removed them [INFERENCE: the failed run's cleanup or a `realm down` between the runs; the orchestrator should confirm].

### Why the legacy production tier failed

Established from the evidence: the host sent `initialize`, `notifications/initialized` and `tools/list`; `kimi mcp test realm` exited 0 below the bound; the recorder logged no response to `tools/list` that carried tool names; the same command against the fake server returned after a similar time (18058 ms) and the recorder logged the six tools there, so the recorder and the legacy CLI's client work together; the stack was reached (a container, a sandbox and a daemon existed afterwards), so `realm mcp` started with the restored environment.

Not established: whether the response to `tools/list` was not yet written when kimi closed the connection (the early-served answer comes from a heavier Node process than the fake server, on a host that had a load of 27 before the window), or was an error response. The recorder summary cannot tell these apart, and the window kept only the summary line, not the wire log or the full output of `kimi mcp test realm`. **That is INFERENCE.** It is recorded as GAP-43-03; a rerun that keeps both would settle it. The legacy CLI is the archived product and Kimi Code is the supported one.

## Outcomes (the four host and tier results)

| Host | Validator | Production |
| --- | --- | --- |
| kimi 1.51.0 | passed (2 of 2), registry t2 | failed, registry t3 a gap whose note starts `rehearsal failed`, page row `failed` |
| Kimi Code 2.6.3 | passed as a session proof (2 of 2), registry t2 | passed, registry t3 `rehearsed` |

No blocker of D-43-09 (B-43-01 to B-43-05) applied: both CLIs installed and ran, a non-interactive drive exists for Kimi Code (B-43-03 not triggered), the legacy CLI answered a handshake against the fake server (B-43-04 not triggered) and the window opened (B-43-05 not triggered).

## Documents and registry changed (Task 5)

- `test/support/host-registry.ts`: the t2 and t3 records of `kimi` and `kimi-code`.
- `docs/integration/wave1-boot-matrix.md`: the two rows (`failed` and `rehearsed`), the paragraph after the table, the `kimi` and `kimi-code` bullets of How a host is booted, the Kimi window paragraph and the Not shown list.
- `docs/integration/host-support-matrix.md`: the generated block, regenerated; only the kimi and kimi-code rows changed.
- `docs/integration/host-plugin-gaps.md`: GAP-24-02 narrowed (not closed: the legacy production tier failed), GAP-24-03 and GAP-21-03 updated, GAP-43-01 (the legacy CLI forwards only HOME and PATH; open, unverified-behavior; OQ-43-03 is the owner question), GAP-43-02 (the unmeasured network use; accepted residual), GAP-43-03 (the failed legacy production tier; open). `test/docs/host-gaps.test.ts` accepted phases 21 to 34 only, so its upper bound became 43 (the closed lists and every other check are unchanged).
- `docs/integration/host-plugin-contract.md`, `docs/integration/hosts.md`, `docs/hosts/snippets/kimi.md`: the Phase 24 evidence rows, the Kimi paragraphs, the sources and dates, an Observed 2026-11-18 subsection, the Evidence reached table and Known limits.

## Cleanup (Task 6)

The scratch installs (a scratch directory under the system optional-software directory) are removed by the orchestrator after this recording; this change does not remove them. Free space before the installs and after them was 11 GB (98 percent). The window left the production stack as found (0 containers, 0 sandboxes, an empty workspace, no daemon). The repository holds only documents, the registry and one test bound; no scratch file and nothing under `src`.

## The four ROADMAP success criteria

1. Both CLIs installed outside the repository with version, date and integrity facts recorded: met.
2. The validator and production tiers were run for each CLI that could run, and each of the four results is recorded with version and date: met (three passes and one failure).
3. Every result is recorded at the evidence tier reached, with no label stronger than the evidence: met (the failed tier is `failed` with a gap row and an unestablished cause stated as INFERENCE; GAP-24-02 is narrowed, not closed).
4. The scratch installs are removed and the stack is as found: the stack is as found; the scratch removal is the orchestrator's step and is stated, not done, here.

## Answers to the open questions

OQ-43-01: Kimi Code in `-p` mode starts its MCP servers before the first model request and requests `tools/list` (yes). OQ-43-02: the first line of `kimi mcp test realm` is `Testing connection to 'realm'...`, and its outbound calls were not measured. OQ-43-04: it runs with its postinstall skipped. OQ-43-05: the disk had room (11 GB free) and the account could read and run both trees. OQ-43-03 (an `env` block in the `kimi` recipe) stays an owner question, recorded as GAP-43-01.
