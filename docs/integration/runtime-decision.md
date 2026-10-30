# Runtime decision note (Phase 3)

Status: decided for Phase 3. Not every item is verified. Each one is unit-verified, live-gated (a skipped suite that names its reason), partly observed, recorded as an assumption or limitation, Open, or Blocked. OQ-P3-04 and OQ-P3-07 are Open, OQ-P3-11 is Open, and OQ-P3-16 is Blocked. Nothing here is live-verified on this host.
Read date of external sources: 2026-10-21 (ISO 8601), as recorded in the integration notes.
Scope: the layering, the Podman gate, the OpenShell pin, the AgentOS mode, and every open question OQ-P3-01 to OQ-P3-16 with its default and the module it blocks.

## Host observations (read-only, 2026-10-21)

No install, upgrade, or socket change was made. Each check below is a read-only command.

| Check | Result |
| --- | --- |
| `podman --version` | `podman version 4.9.3` |
| `podman run --help` | Lists `--cap-drop`, `--security-opt`, `--read-only`, `--read-only-tmpfs`, `--tmpfs`, `--memory`/`-m`, `--cpus`, `--pids-limit` (help text default 2048), and `--network`. The help text does not state whether `no-new-privileges` is on by default, and it does not confirm that the value is accepted on 4.9.3. |
| `openshell --version` | `openshell 0.1.2` |
| `openshell sandbox create --help` | Lists `--name`, `--policy`, `--no-auto-providers`, `--no-keep`, `--detach`, `--label`, `--cpu`, `--memory`, `--env`, and `--provider`. The usage line shows the trailing `[-- <COMMAND>...]` form. |

Historical (superseded 2026-10-28): the `openshell 0.1.2` version and the trailing command form in the two OpenShell rows above are superseded. The pin is 0.1.5.

## Layering (S-08) and requirement-wording conflicts (D-46, D-47)

Settled input S-08:

- The **OpenShell gateway runs on the host, rootless**.
- It creates **one OpenShell sandbox per session** through its **Podman driver**.
- The **AgentOS library runs as the sandbox workload**.
- **Anda Engine runs as a separate service**, reached over HTTP from the TypeScript client.
- Nothing nests OpenShell inside the Realm container, and nothing runs privileged.

Evidence: `docs/integration/openshell.md` Q1 records that the documented Podman driver creates its own sandbox container (driver table: "Its own container"), and that the gateway runs "Rootless containers on the gateway host". It does not document a launch inside an externally created container.

**Requirement-wording conflicts (reported, not edited).** The settled layering contradicts the following wording. Each is a requirement-wording decision for the user. The requirement text is not changed in Phase 3.

| Requirement or criterion | Wording | Resolution under S-08 |
| --- | --- | --- |
| RT-03 and ROADMAP Phase 3 SC3 | "OpenShell runs inside the container" | D-46: the gateway is on the host, and the Podman driver creates the sandbox container. RT-03's intent is kept: every agent workload start goes through OpenShell, and no path bypasses it. This is proven by `test/runtime/openshell-routing.test.ts`. |
| RT-01 and ROADMAP Phase 3 SC2 | A "running realm container" that Realm runs | D-47: the container is the session sandbox that OpenShell's Podman driver creates. Realm verifies it through libpod inspect against the hardening profile (D-51). A mismatch destroys the container and moves the session to `error` with `OPENSHELL_START_FAILED`. Realm creates no fallback container without a new decision. |

**Supersession.** The RT-01 and RT-03 wording that places the OpenShell gateway inside the Realm container is superseded by S-08 (D-46, D-47). Phase 3 does not edit the requirement text, and the layering above governs the implementation.

Reversibility: costly. Every runtime module depends on this layering.

## Podman gate (S-09)

- Host Podman is **4.9.3**. The OpenShell Podman driver requires **Podman 5.x** (`openshell.md` Q2).
- The prerequisite probe (D-53) gives `PODMAN_UNSUPPORTED_VERSION` for any major below 5. The reason names the detected version and that OpenShell requires 5.x.
- Realm does not install or upgrade Podman. The local install is not changed.
- Live container and runtime suites skip with `PODMAN_UNSUPPORTED_VERSION` on 4.9.3, and with `PODMAN_MISSING` when the binary is absent (D-48).
- Unit tests use the fake Unix-socket server (`test/support/fake-libpod.ts`) and never depend on Podman.
- Libpod routes are **provisional** (`podman.md` Q5: no route verified). They live only in `src/runtime/libpod-routes.ts`, marked provisional there.
- The "machine" mapping on Linux (OQ-P3-13) is recorded in section "Open questions" below.

## OpenShell pin (S-10)

- The CLI is pinned to the **0.1.2** verbs. Host observation above confirms each pinned flag is listed by `openshell sandbox create --help`.
- Pinned argv (D-55): `sandbox create --name realm-<sessionId> --policy <policyPath> --no-auto-providers --no-keep --detach --label io.realm.managed=true --label io.realm.session=<sessionId> --cpu <cpus> --memory <memory> -- <workloadArgv...>`.
  - Superseded by `docs/integration/openshell.md` (one sandbox per session, named `realm-<sessionId>`, AgentOS as its workload, with no workload command). The pinned argv above is historical.
- The builder never emits `--env` or `--provider`, because AUD-02 forbids host environment or credentials reaching the sandbox. Both flags exist in 0.1.2 and are deliberately not used.
- **Drift.** The docs describe **0.1.5** (`openshell.md` version caveat). The local CLI is 0.1.2. The `--no-keep` combined with `--detach` semantics are documented only for 0.1.5 (OQ-P3-12).
- Default applied (OQ-P3-12): pin 0.1.2 and re-verify on upgrade. A future upgrade must re-read the matching documentation index and re-run `openshell sandbox create --help`.
- The 0.1.2 help also lists `--from` (a rootfs tar or a container image reference). It is not in the pinned argv, and this phase does not use it. Whether it accepts a digest-pinned reference is unverified, so it bears on OQ-P3-03 (recorded below).
- Historical (superseded 2026-10-28): the 0.1.2 pin, the `--no-keep` and `--detach` argv, and the trailing command form above no longer hold. The pin is 0.1.5 (`docs/integration/openshell.md`).
- The doctor's `openshell` check (D-69) greps this help for each pinned flag, so drift is caught at run time.

## AgentOS mode (S-11)

- **Library mode** (`@rivet-dev/agentos-core`, run in the sandbox) is **primary**. `agentos.md` Q1 and Q2 document `AgentOs.create` and `vm.dispose()`.
- **Hosted mode** (the `agentOS` Rivet Actor and worker images) is **secondary and gated**. `agentos.md` Q8 documents the hosted worker as Docker-based, with no Podman command. Hosted mode is not implemented in Phase 3 (D-60).
- Decision (2026-10-28): one sandbox per session, named `realm-<sessionId>`. The runtime's policy is the enforcement authority, and the retired realm helper is removed from the sandbox image (recover it from git history if ever needed). The AgentOS driver is bound (`src/runtime/agentos-driver.ts`); see `docs/integration/openshell.md`.

## Open questions and defaults (OQ-P3-01 to OQ-P3-16)

"Blocked" names the module or phase that the open item prevents from being claimed as done. "Live-gated" means the question is decided only by a gated suite on a host that supports it, and until then the code fails closed.

| ID | Question | Default applied | Blocked module or phase | Status |
| --- | --- | --- | --- | --- |
| OQ-P3-01 | Does the OpenShell Podman driver apply the `--label` values to the container it creates? | Assume yes. If not, label lookup finds nothing, create times out, and the result is `OPENSHELL_START_FAILED`. Nothing is claimed. | Live proof of label idempotency in `src/runtime/session-execution.ts` (D-56, CORE-06) | Live-gated. Fails closed. |
| OQ-P3-02 | Can the driver bind-mount the workspace, and at what in-sandbox path? | `/workspace` (D-57, a Realm convention). | Live proof of the policy's `read_write` path and the workspace mount in `src/runtime/openshell.ts` | Live-gated. Fails closed. |
| OQ-P3-03 | How is the digest-pinned image reference passed to OpenShell? The pinned set has no image verb. The 0.1.2 help lists `--from`, not in the pinned argv. | The verifier (D-51) refuses any container whose image digest differs from the pin. | `verifyInspect` image-digest property in `src/runtime/hardening.ts` (D-51); live create path in `src/runtime/session-execution.ts` | Live-gated. Fails closed. |
| OQ-P3-04 | Does an OpenShell sandbox record persist after its container is removed? No sandbox delete verb is pinned. | Phase 3 removes containers only. Phase 4 handles records. | Phase 4 reaper and stale-record cleanup (RT-08, `src/session/reap.ts`) | Open. Not a Phase 3 blocker. |
| OQ-P3-05 | No documented channel between the host supervisor and the AgentOS library process inside the sandbox. | `AgentOsDriver` port only. No concrete binding. | **Blocks the concrete AgentOS driver** (`src/runtime/agentos.ts` binding; RT-04 end-to-end) | Blocked. Reported, not claimed. |
| OQ-P3-06 | `@rivet-dev/agentos-core` version, licence, and Node floor are not verified in its registry. | No dependency added. Execution checks `npm view` read-only before any add. | **Blocks adding the AgentOS dependency** (`package.json`, the concrete driver) | Blocked. No dependency added. |
| OQ-P3-07 | Does AgentOS library mode need a native sidecar, and do native ELF binaries run (`agentos.md` Q5)? | Recorded as open. Library mode is primary (S-11). | AgentOS driver binding and any sandbox image that runs native binaries | Open. |
| OQ-P3-08 | Confirm the `podman run` flags against the local 4.9.3 binary. | Run read-only, with no install or upgrade. Result is in "Host observations" above. The flags exist. The `no-new-privileges` default and value acceptance are not confirmed by the help text. | `verifyInspect` checks in `src/runtime/hardening.ts` (D-51) against a real 4.9.3 container | Partly observed. The remaining flag behaviour is live-gated. |
| OQ-P3-09 | Anda publishes no protocol or engine version (`anda.md` Q4). | Shape handshake (D-61). Recorded as a limitation in `anda-decision.md`. | Any claim of a version match in `src/anda/shape.ts` and the ANDA-02 test | Limitation recorded. |
| OQ-P3-10 | Anda RPC body and credential format (`anda.md` Q2, Q3). | Not needed in Phase 3. No credentials are produced. | **Blocks the phase that first calls `POST /{id}`** (Phase 4 or 5 tool calls through Anda) | Blocked for that phase. |
| OQ-P3-11 | Anda licence conflict (`anda.md` Q6). | No Anda code or dependency added. | Any vendoring of Anda code. It does not block Phase 3. | Open. Must be resolved before vendoring. |
| OQ-P3-12 | OpenShell drift: docs 0.1.5, pinned verbs 0.1.2 (S-10). `--no-keep` with `--detach` is documented only for 0.1.5. Historical (superseded 2026-10-28): the pin is 0.1.5 and the create passes no `--no-keep`. | Pin 0.1.2 and gate. Re-verify on upgrade. | The argv builder in `src/runtime/openshell.ts` (D-55) and the live `--no-keep`/`--detach` lifecycle | Live-gated. Fails closed. |
| OQ-P3-13 | On Linux, "Podman machine" is mapped to the rootless API socket (`$XDG_RUNTIME_DIR/podman/podman.sock`). | This mapping, recorded here. A refused socket gives `PODMAN_MACHINE_DOWN` with the fix `systemctl --user start podman.socket`. | `src/runtime/podman-probe.ts` step 3 (D-53) | Recorded assumption. |
| OQ-P3-14 | Does the OpenShell driver apply the PID limit, read-only root, and capability drop? | The verifier (D-51) fails closed when it does not. | Live proof that `verifyInspect` passes on an OpenShell-created container (`src/runtime/hardening.ts`, `session-execution.ts`) | Live-gated. Fails closed. |
| OQ-P3-15 | Does OpenShell accept the policy written as JSON (valid YAML 1.2)? | JSON (D-57). No YAML dependency. | Live acceptance of the policy document in `src/runtime/openshell.ts` (`buildPolicyDocument`) | Live-gated. Fails closed. |
| OQ-P3-16 | The `binaries` key and endpoint shape for `network_policies` are not recorded in `openshell.md` Q3. | No endpoints in Phase 3. `network_policies` is deny-all. | **Blocks Phase 4 egress allowlist mapping** (RT-05, `src/runtime/egress.ts`) | Blocked for Phase 4. |

## Finding and naming decisions

- **F-P3-08 (runtime/ versus run/).** Policy files live under `<stateDir>/runtime/` (D-57). The control socket lives under `<stateDir>/run/control.sock` (`src/session/paths.ts`, `controlSocketPath`). The names differ on purpose, and nothing collides. Phase 6 keeps the control socket under `run/`. Phase 3 writes only under `runtime/`.

## Verification status

- **Unit-verified in Phase 3:** argv and policy shape (D-55, D-57), the libpod client method set (D-54), the probe mapping (D-53), config rules (D-52), and the lifecycle gates (D-63 to D-68). All run against in-process fakes and the fake libpod socket.
- **Live-gated (skip with a stated reason, fail closed):** OQ-P3-01, 02, 03, 12, 14, and 15. Live suites skip on 4.9.3 with `PODMAN_UNSUPPORTED_VERSION`.
- **Not claimed:** any live container, OpenShell sandbox, AgentOS run, or Anda RPC call. No Phase 3 report may say "live verified".

## Phase 4: Reaper, Egress Guard, and Shared Dispatcher (D-100)

Phase 4 status: decided for Phase 4. The RT-05 egress, RT-08 reaper, and TOOL-03 exec live bodies that this note once placed in `test/integration/podman-gate.test.ts` were removed on 2026-10-28; `test/integration/production-driver.test.ts` now carries the live egress, hardening, create, and down-sweep scenarios, a crash recovery scenario (RT-08: after the daemon is killed, the next `realm up` reaps the sandbox it left and reaches `active` with exactly one sandbox), the MCP scenarios (TOOL-03: `realm mcp` serves `exec`, `write` and `read` over stdio, and an `exec` that outlives the per-call bound fails with a retryable `TOOL_TIMEOUT`), the AgentOS runner exit scenario, and the daemon-side startup budget scenario: nine scenarios in all. They are gated. They were run live on the production stack (Podman 5.7.1) on 2026-10-28 and passed 31 of 31 assertions (see `docs/integration/openshell.md`, "Running the production live suite"). The Phase 3 status line at the top of this note records the state when Phase 3 was decided and is not updated by this run. ACP and the Anda engine were not exercised live.
Scope: the startup reaper (RT-08), the egress allowlist and its OpenShell rendering (RT-05), the shared dispatcher (TOOL-03, TOOL-04), and every open question OQ-P4-01 to OQ-P4-12 with its default.

### OQ-P3-16 resolution (D-82)

OQ-P3-16 is resolved for the fields Realm writes. Source: `https://docs.nvidia.com/openshell/v0.1.2/how-it-works/policies/schema.md`, read 2026-10-21 (the pinned CLI is 0.1.2, so the v0.1.2 index is used, not the v0.1.5 page). The page documents: `network_policies` as a map of rules; a rule with `name`, `endpoints` (list), and `binaries` (list); an endpoint with `host` and `port` or `ports`; a binary object with `path`; and that an empty `binaries` list matches no binary. Realm writes only `name`, `endpoints[].host`, `endpoints[].port`, and `binaries[].path` (D-78). The inspection and protocol fields are not used. Live acceptance of the rendered document stays gated (OQ-P4-02).

### Exec verb pin (D-93)

Phase 3 deferred exec because no exec verb was in the pinned OpenShell set. The local 0.1.2 CLI now shows `openshell sandbox exec` (read-only `--help` check, 2026-10-21). It lists `-n/--name`, `--workdir`, `--timeout`, `--tty/--no-tty`, `--no-login-shell`, and `--env` (which is never used). The `sandbox exec` verb and the four flags used in D-92 are added to the pinned set (S-10). Pinned argv (D-92): `openshell sandbox exec --name realm-<sessionId> --workdir /workspace --no-tty --no-login-shell -- <argv...>`. The live exec path stays gated (OQ-P4-04).

### IPv6 partial status (D-76)

RT-05 says "IPv6 is disabled". Realm does not create the container and cannot set its sysctls, so Realm cannot disable IPv6 directly. Phase 4 enforces what Realm can and reports the rest: (a) no IPv6 host or address appears in any rendered `network_policies` entry (D-80 refuses IPv6 literals); (b) the hardening verifier keeps `NetworkMode: none` (D-51), so the workload container has no interface and no IPv6 address; (c) whether the supervisor proxy blocks IPv6 egress is unverified and live-gated (OQ-P4-01). The unit suite reports RT-05 IPv6 as partially unit-verified.

### Single-owner precondition (D-87, OQ-P4-06)

`reapStartup` must run before any `LifecycleController` or `ToolDispatcher` exists in the process, and only one host daemon may own the state directory (S-19, Phase 6). Phase 4 has no cross-process owner check. A second host process could reap a live session. The reap precondition and the single-daemon rule in Phase 6 are the mitigation; until then this is an accepted residual risk (OQ-P4-06).

### Audit: two lines per call (D-90)

A dispatcher call writes two audit lines: an admission line before execution and a result line after. Both use the Phase 2 entry format (D-42) with one additive, optional field, `phase`, valued `admission` or `result`. Outcome alone cannot separate the two lines, because a successful call has outcome `ok` on both. Phase 7 review must read both lines of one call as one call.

### Audit: reconciliation and sweep lines (Phase 14, CRASH-02)

Phase 14 adds two values to the audit line format. Both are additive, and a log written before this change still parses.

- **`phase: "reconciliation"`** (`AuditPhase`, `src/audit/log.ts`). A reconciliation line has outcome `AUDIT_OUTCOME_UNKNOWN` (see "Catalogue extension (Phase 14)"). It closes an admission line that has no result line.
- **`tool: "temp-sweep"`**, on lines with no `phase`. These are the orphan temp-file sweep lines (next section). With no `phase`, a sweep line keeps the pre-stage shape and is never counted as an admission, a result or a reconciliation.

**Torn-tail rule.** A process killed in the middle of an append can leave a last line with no newline. `writeAuditLine` (`src/audit/log.ts`) checks an existing, non-empty file: if its last byte is not a newline, the next write is a newline followed by the new line, in one write call. The torn line stays in the file as an unparseable line, and the new line is not glued onto it. The rule lives only in `writeAuditLine`, so it covers every writer of the file.

**How reconciliation pairs lines** (`reconcileAuditLogs`, `src/audit/reconcile.ts`).

- It reads each `<stateDir>/audit/<sessionId>.jsonl`. The file stem is the session id and must match the same pattern `appendAudit` enforces; the reconciliation line is appended for that session id.
- Per file it counts, for each key, the admission lines against the result and reconciliation lines. The key is built by the one exported function `pairingKey`: `tool`, `path` (empty when absent) and the JSON of `execSummary` (`null` when absent), separated by NUL. Order is not used, because calls may overlap and their lines interleave.
- For each key with more admissions than closing lines it appends one reconciliation line per missing closing line, through `appendAudit` only. The line copies `tool`, `path` and `execSummary` from the admission and never `bytes` or `sha256`.
- It is idempotent. After the append the counts are equal, so a second run appends nothing (VERIFIED_BY_CODE_READING).
- Ignored lines: a line that is not JSON, not an object, has no string `phase` or `tool`, has a `path` or `execSummary` of the wrong type, or has a `phase` other than the three named. A torn last admission is therefore ignored, which is right: the admission is appended before execution, so nothing ran.
- A missing audit directory is zero work. A symlinked or non-directory audit directory, a symlinked or non-regular log, a log whose stem is not a safe session id, an unreadable log, a log over the cap (`RECONCILE_MAX_FILE_BYTES`, 256 MiB; the log has no rotation, so it is read in 1 MiB steps and never held whole), and a log whose append throws are each counted in `failed` and are not fatal. The other logs are still reconciled, and the caller reports the counts. The result is `{ files, appended, failed, unfinished, complete, skippedUnchanged }`; `files` counts the logs checked completely, scanned or skipped as unchanged, and `skippedUnchanged` how many of them were skipped.
- Listing, ordering and the per-start scan cap. The directory is read entry by entry (never as one array) and every `*.jsonl` name is kept, up to `RECONCILE_MAX_LISTED_ENTRIES` (100 000) entries (names and other entries alike); a further entry, or the deadline, makes the listing truncated (`listingTruncated`, `complete` false, `maintenanceComplete` false). The record, its temp files and any other file are ignored. The listing takes no prefix of the directory, so a stable directory order cannot hide logs from later starts. There is ONE ordering: all listed logs newest modified first, ties by name. A crash leaves unmatched admissions in the logs written last, so the logs that matter are reached first, whether they are recorded or not. A recorded log whose size and mtime are unchanged is skipped after its `lstat`; stats are cheap and bounded by the deadline and the listing bound, so a skip does not count against the cap. `RECONCILE_MAX_FILES` (10 000) caps only the logs whose content is scanned per start, applied in the newest-first order; a log that needs a scan after the cap is spent is reported in `unfinished`. The deadline is checked every 256 entries while listing and before each `lstat` of the ordering pass; logs not stat'ed in time are reported unfinished, in listing order. A log the run refuses (an unsafe name, not a regular file, over a size or key limit) is not counted against the cap, because it is never recorded and would otherwise use the cap on every start. Because the record holds every log one start can list (below), each start records what it finished and the unscanned remainder shrinks until it is empty. If the audit directory holds more than 100 000 entries the remainder cannot be listed and is reported only as `listingTruncated`; an operator should then prune old audit logs. A record that holds fewer logs than exist (injected limits, or names near the 134-character maximum that cut the 16 MiB bound) makes the oldest scanned logs fall out of it; they are then scanned again after every newer log, which costs time only up to the deadline, and logs older still may wait; pruning old logs is the remedy there too.
- Progress record. `<stateDir>/audit/.reconciled.json` maps each completely checked log's base name to `{ size, mtimeMs }`, measured after the reconciler's own appends. A log whose current size and mtime equal its record is skipped without being read, so repeated starts with the same budget make progress through the history instead of re-reading the same old logs from byte zero. The map is kept in memory for the run and written once, with `atomicWriteFile`, when the run ends (complete, out of time, or after an unexpected error) and only if it changed or the stored record needed healing; a kill during a run loses only that run's progress. A log cut off by the deadline records nothing. A log is recorded only when what was scanned is what the stat before the scan described (the descriptor's size and mtime after the last byte equal that stat) and nothing but this run's own appends changed it since; otherwise it is scanned again next run. The writer and the reader share one set of limits: at most `MAX_PROGRESS_ENTRIES` (100 000, the listing bound, so the record can hold every log one start can list) entries and `MAX_PROGRESS_BYTES` (16 MiB, about 85 bytes per entry for ordinary session-id names). The writer drops entries of logs that are no longer listed (only when the listing was complete), then the entries of the oldest modified logs until both limits hold, so a record it wrote is always one the reader accepts. The reader opens the record without following a link, reads through the descriptor at most the size it reported (refusing a record over the byte limit, or one that grew meanwhile), and treats an unreadable, corrupt, oversized, over-entry-limit, non-regular or wrong-shaped record, or an entry of the wrong shape, as empty, never as an error; the run then rewrites it. A record that is a link, not a regular file, or over the byte limit is removed before the write, so the atomic writer never hashes a foreign or huge file (a directory in its place cannot be removed this way and makes the write fail, which is counted once in `failed`). The record is a cache: deleting it only costs one rescan. It is a dot file that does not end in `.jsonl`, so it is not read as a log, and its name is not a temp name, so the orphan sweep never touches it. A log whose content changed while keeping both size and mtime would be missed; the log is append-only, so a change moves both.
- Scan bounds. A log is read in 1 MiB steps. A line over `RECONCILE_MAX_LINE_BYTES` (16 MiB) is skipped, not held, and the lines after it are still counted. A log with more than `RECONCILE_MAX_KEYS` (200 000) distinct (tool, path, exec) keys is refused like an over-sized log and counted in `failed`. Each reconciliation line is one `appendAudit` (the single writer), which opens, writes and fsyncs the log; that is the one repeated disk cost, and the deadline is checked before each append.
- Why no append races with the scan. The reconciliation runs inside `runStartupMaintenance` before the gate opens. The control socket is bound first, so a second daemon on the same state directory fails with `LOCK_CONFLICT` before it reaches its own maintenance, and every connection waits on the gate, so no tool call reaches the dispatcher and this process appends no audit line while the scan runs (the only audit writer in that window is the temp-file sweep's sink, which runs before the reconciliation, not alongside it).
- Deadline. `ReconcileOptions` takes an optional absolute `deadline` on an injectable `now` clock (default `performance.now()`). It is checked between logs, before every 1 MiB read and every 5000 lines of a scan, and before each append. A log whose scan is cut off gets no line, because a partial count could label a call unknown that has its result line further on. That log and every log not reached are listed by base name in `unfinished`, and `complete` is false. A deadline that expires between two appends of a fully scanned log leaves the rest of that log's lines to the next run, which finds the written lines as closings; the lines of both runs together are those one complete run appends. Without a deadline nothing is bounded.
- Precondition: run it before any dispatcher exists in the process, as the startup reaper does (D-87). A call that is still running would otherwise be labelled unknown.

**What "unknown" covers.** A reconciliation line says only that no closing line exists. A lone admission has two origins. Either the process ended after the admission and before the result, so the call may have run, or the admission append itself threw `AUDIT_WRITE_FAILED`, so nothing ran. The second case can leave the line in the file anyway: a failed fsync after a successful write reports `AUDIT_WRITE_FAILED` although the line is already there (`writeAuditLine` comment). A lone admission from a failed append is labelled unknown too, because the log cannot tell the two apart.

**Status.** `reconcileAuditLogs` and `sweepOrphanTempFiles` are libraries, and the daemon calls both at start, before it serves, inside `runStartupMaintenance` (`src/daemon/daemon.ts`; see "Startup maintenance (Phase 14, CRASH-04)" below). A running daemon therefore writes reconciliation lines and sweep lines at each start, as long as there is something to reconcile or to remove.

### Orphan temp-file sweep (Phase 14, CRASH-01)

`atomicWriteFile` writes a temp file beside its target and renames it. A process killed between the two leaves the temp file. `sweepOrphanTempFiles(roots, options)` in `src/fs/temp-sweep.ts` removes such files and only such files. As built:

- **Name.** The file name must match `TEMP_NAME_PATTERN`, `^\.(.+)\.realm-tmp-[0-9a-f]{16}$`, exported from `src/fs/atomic-write.ts`. The writer builds its names with `tempFileName` in the same file, so the writer and the sweep share one definition.
- **Regular files only.** A directory entry must be a regular file (`Dirent.isFile`) and again an `lstat` regular file. A symlink named like a temp file is not removed.
- **Owner.** The file's uid must equal `options.ownerUid`. The caller supplies the uid.
- **Age.** `now - mtimeMs` must be at least `options.minAgeMs`. `ORPHAN_TEMP_MIN_AGE_MS` is 60 000 ms and is what production is meant to pass; the library takes the bound as an option. A user file that is named like a temp file, is owned by the daemon's user and is older than the bound is removed by design.
- **Same device.** A subdirectory is entered only when its device equals the root's device. A root is skipped when its bound device and inode differ from the opened descriptor's.
- **No symlinks.** Each directory is opened with `O_NOFOLLOW|O_DIRECTORY` through the parent descriptor, and later steps act through `/proc/self/fd/<fd>/<name>`, as `atomic-write.ts` does. A symlinked directory is not entered, and a directory swapped for a symlink during the walk cannot redirect the sweep. Without `/proc` the root cannot be pinned and is skipped.
- **Audit before unlink.** The injected `audit` callback is called with `{ tool: "temp-sweep", outcome: "ok", path, bytes }` before the unlink. If it throws, the file is kept and counted in `skipped`. If the unlink then fails, the failure is counted in `failed` and a second line with outcome `CLEANUP_FAILED` is passed to the callback; if that callback throws, that is counted in `failed` too. The entries have no `phase` (see the audit section above).
- **Bounds.** The walk stops with `truncated: true` when it has examined `maxEntries` directory entries (default `DEFAULT_SWEEP_MAX_ENTRIES`, 500 000) or when its wall budget `deadlineMs` (default `DEFAULT_SWEEP_DEADLINE_MS`, 15 000 ms) is spent. A truncated walk skips the remaining roots.
- **Result.** `{ removed, skipped, failed, truncated }`. A root that does not bind never aborts the sweep; it is counted in `skipped`. The sweep reads no file content, no process state and no environment: the clock, owner, age bound and audit sink are all injected.

The roots are the caller's choice, and the library does not call itself. The daemon passes these roots (`sweepRootsOf`, `src/daemon/daemon.ts`): every entry of `policy.workspaceRoots`, then `<stateDir>/sessions`, then `<stateDir>/runtime`, then `<stateDir>/audit`. The audit directory is a root because the reconciliation's progress record is written atomically there, and a kill during that write leaves a `..reconciled.json.realm-tmp-<hex>` temp file that no other root reaches when the state directory is outside the workspace roots. Each root is bound with `bindRoot`; a root that lies inside an earlier root is dropped only when that root's walk reaches it, that is when both are on the same device (`statSync(...).dev` of the two real paths, injectable as the third argument of `sweepRootsOf`), so no directory is walked twice. The walk never crosses a device boundary, so a root on its own mount (for example `/projects/ssd` under `/projects`) is kept, and so is a root whose device cannot be read. A root that does not bind (for example a `runtime` directory that was never created) is passed on unchanged and counted in `skipped` by the sweep. There is no skip list (VERIFIED_BY_CODE_READING).

### Startup maintenance (Phase 14, CRASH-04)

Decision D-1409 (`.planning/phases/14-crash-safety-pack/14-CONTEXT.md`). `startDaemon` runs one function, `runStartupMaintenance` (`src/daemon/daemon.ts`), after the control socket is bound and before the gate opens, so no request is served before it finishes. Order:

1. **The reap** (`reapStartup`, `src/session/reap.ts`): every realm container is removed and proven gone, then every session record is deleted.
2. **The orphan temp-file sweep** (`sweepOrphanTempFiles`, `src/fs/temp-sweep.ts`) over `policy.workspaceRoots`, `<stateDir>/sessions`, `<stateDir>/runtime` and `<stateDir>/audit`. The daemon passes `now`, `ORPHAN_TEMP_MIN_AGE_MS` (60 000 ms), its own uid (`process.getuid()`) and an audit sink that appends each sweep line to `<stateDir>/audit/<sessionId>.jsonl` through `appendAudit`, under the daemon's own session id.
3. **The audit reconciliation** (`reconcileAuditLogs`, `src/audit/reconcile.ts`) over `<stateDir>/audit`, under the same deadline as step 2.
4. **The report**: the `StartupReport` is built, the notice is derived from it, and the `onStartup` observer receives it.
5. **The gate opens** (`openGate()`).

**Budget.** Steps 2 and 3 are optional cleanup, so they share one deadline, `STARTUP_MAINTENANCE_BUDGET_MS` (10 000 ms, `src/daemon/daemon.ts`), computed when the reap has ended; the budget and a monotonic clock are injectable (`StartDaemonOptions.startupMaintenanceBudgetMs` and `monotonicNow`). The sweep may spend at most half of what remains, and never more than its own 15 s budget, so a very large workspace cannot starve the reconciliation start after start; the reconciliation gets what is left. Work the deadline cuts off is not lost: the sweep reports the root it was walking and every root it did not reach (`unfinishedRoots`), the reconciliation reports its unfinished logs, and a later start does the work. The reconciliation takes all logs newest modified first and skips those its progress record shows as unchanged since they were last checked completely, so repeated small budgets reach the whole history instead of re-reading the same old logs; the record is a cache whose deletion only costs one rescan. The gate therefore opens at most the budget plus one chunk of work (one directory read batch, 1 MiB of log, or one audit append) after the reap ends. The reap itself keeps its own 60 s bound and is not part of this budget. Unfinished maintenance does not change the notice, which is about a destroyed sandbox only.

**Failure handling.** Only the reap can stop the start: a reap that does not prove zero containers rejects (and a timeout of 60 s, `REAP_SWEEP_TIMEOUT_MS`, rejects with `PODMAN_MACHINE_DOWN`), and `startDaemon` aborts, because nothing may be served while an old sandbox might survive. A failure in step 2 or 3 never aborts the start. When the reap fails after it had already removed containers or deleted records, the daemon still builds a partial report from what was collected (the ids through `onRemoved`, the record deletions it counted, `reapFailure` set to the failing code, `failures` 1, `maintenanceComplete` false), hands it to `onStartup` so `daemon.log` has it, and then rethrows the original error; no sweep or reconciliation runs. Each is counted in `failures` and the start goes on. The count adds the sweep's `failed` and the reconciliation's `failed`, plus 1 when the sweep or the reconciliation itself throws, plus 1 when the process has no uid (`process.getuid` is unavailable), in which case nothing is swept because the owner rule cannot be applied. Entries the sweep counted as `skipped`, and work the budget left unfinished, are not in `failures`; they are reported through `unfinishedSweepRoots`, `unfinishedAuditFiles` and `maintenanceComplete`. The reason for the rule: a skipped cleanup costs disk space and a missing reconciliation line, while a daemon that will not start costs the user the sandbox (VERIFIED_BY_CODE_READING of the comment on `runStartupMaintenance`). An `onStartup` observer that throws does abort the start.

Request lines (`up.begin`, `up.end`, `tool.result`, `health.probe_failed`) go to `<stateDir>/requests.log`, which the file sink rotates at 4 MiB. They do not share `daemon.log`: a detached daemon inherits that file as stderr, and rotating it would leave a later `daemon.failed` line on an unlinked inode. If `requests.log` cannot be opened, the line falls back to stderr.

Counters and timings are read with `realm metrics`, which sends `metrics` on the control socket. There is no network listener and no MCP or ACP tool for them. The counts reset when the daemon starts.

**`StartupReport`** (`src/daemon/daemon.ts`), handed to the optional `onStartup` observer of `StartDaemonOptions` once per start:

| Field | Meaning |
| --- | --- |
| `containerIds` | Ids of the realm containers the reap removed, in removal order. Empty when an injected sweep names none. |
| `containersRemoved` | Number of containers the reap removed. |
| `recordsDeleted` | Number of session records the reap deleted. |
| `tempFilesRemoved` | Number of orphan temp files the sweep removed. |
| `auditLinesReconciled` | Number of reconciliation lines appended (`appended`). |
| `truncated` | True when the sweep stopped at its wall or entry bound. It is not part of the log line. |
| `unfinishedSweepRoots` | The sweep roots the budget left unfinished, as paths: the root being walked when the budget ran out and every root not reached. |
| `unfinishedAuditFiles` | The audit logs the budget left unfinished, as base names without a directory. |
| `auditListingTruncated` | True when the audit directory held more logs than one start considers, or the deadline ended its listing, so logs that were not considered cannot be named in `unfinishedAuditFiles`. |
| `maintenanceComplete` | True when no sweep root is unfinished and the reconciliation is complete (no unfinished log, listing not truncated). |
| `reapFailure` | Present only when the reap failed: the catalogue code. The report is then partial, as described under failure handling. |
| `failures` | The count described above. |

**The `daemon.log` record.** The daemon entry (`src/daemon/main.ts`, `startupLine`) writes one JSON object per start to its standard error. The detached daemon is spawned with that stream on `<stateDir>/daemon.log` (`startDetachedDaemon`, `src/cli/main.ts`), so the record lands there. The object has `level` `info` and `event` `daemon.startup`, then the report fields in the table above. `unfinishedAuditFiles` and `unfinishedSweepRoots` are a sample of at most ten names; `unfinishedAuditFileCount` and `unfinishedSweepRootCount` are the full counts. `reapFailure` is omitted when the reap did not fail. The record is written on every start, including when everything is zero. A start failure is a separate line, `event` `daemon.failed`, with the catalogue `code`.

**`onRemoved` of `removeAllRealmContainers`** (`src/runtime/sweep.ts`, D-1405). The function takes an optional second argument `onRemoved?: (id: string) => void`. It is called with each container's id right after that container's removal succeeded; a removal that failed is not reported when it fails, and the callback must not throw. A removal whose reply was lost (the container was removed but the request failed or timed out) is reported once after the proving listing, when that listing no longer holds the id, so the reported ids always match the count; a container that is still listed is never reported. The return type (the count removed) and the other callers are unchanged. The daemon's default reap sweep passes a callback that collects the ids for `StartupReport.containerIds`; a sweep injected through `StartDaemonOptions.sweep` is called without one and reports no ids.

**The `notice` on `status`, `up` and `down` replies** (D-1404). The daemon's `status`, `up` and `down` results (`statusResult`, `src/daemon/daemon.ts`) carry an optional `notice` string, and only when the reap destroyed something: `containersRemoved` or `recordsDeleted` is not zero (`startupNoticeOf`). With nothing destroyed the reply has no `notice` key. The text is exactly:

```text
A previous daemon's sandbox was destroyed at startup: <n> container(s), <m> session record(s). Files in the workspace were kept; state outside it was lost.
```

`<n>` is `containersRemoved` and `<m>` is `recordsDeleted`.

- **Kept for the daemon's lifetime.** The text is computed once, after the maintenance, and every later `status`, `up` and `down` reply carries it. It is not consumed on read, because the Omp attach calls `up` before it calls `status` (`docs/integration/omp.md`).
- **Not in the tool contract, the snapshot or the session record.** It is a field of the control reply only. `src/contract/` and the session record schema are unchanged, and the `StateSnapshot` inside the reply is unchanged.
- **Precedent.** The `mode` field the replies already carry: an optional, additive field on the control reply, outside the frozen contracts.
- **Who shows it.** The Omp plugin once per attach through `ui.notify` (`docs/integration/omp.md`). `realm mcp` and `realm acp` write it, followed by a newline, to their diagnostics stream (standard error) after their attach `up`, and never to standard output, which carries only protocol frames (`writeNotice`, `src/cli/main.ts`). `realm status` and `realm down` print the reply result as JSON on standard output (`replyToResult`), so the field appears there. `realm up` does not call `writeNotice`; it prints through `upResult`, which this note did not read. The client validator accepts the field only as a string (`src/daemon/client.ts`, `DaemonStatus`).

The live suite checks it: scenario 5 of `test/integration/production-driver.test.ts` (the daemon is killed and restarted) asserts that `realm status` after the restart carries a notice that contains "destroyed at startup" and counts one container and at least one session record, and that `daemon.log` holds a `daemon.startup` record with `containersRemoved` 1 naming the destroyed container (VERIFIED_BY_CODE_READING of the test; it was not run for this note).

### Session record delete is durable (Phase 14, CRASH-03)

`SessionStore.delete` (`src/session/store.ts`) removes the record file and then syncs the sessions directory (`syncDirectory`). A directory fsync that fails is a `WRITE_NOT_ATOMIC` error: the unlink has already happened, and its durability is not known. A directory that cannot be opened, or that is not a directory, is `PATH_ESCAPE` and is rethrown unchanged (`syncDirectory`, `src/fs/atomic-write.ts`). Deleting a record that does not exist is still a no-op, and so is deleting when the sessions directory does not exist.

### Lost-container retry in `create` (Phase 14, TD-04)

`LifecycleController.create` (`src/lifecycle/controller.ts`) now recovers a recorded container that no longer starts. The rule as built:

- It applies only when the session record already names a container and no create ran in this call, so the container being started is the recorded one.
- It applies only when the start fails with `OPENSHELL_START_FAILED`. A port failure that is not a `RealmError` is mapped to that code (`portFailureCode`), so it qualifies too. Any other code, such as `AGENTOS_CRASH_LOOP`, goes to the usual failure path and the container is kept; a dead runner in a live container is recovered in place by `/realm-retry` (`docs/integration/omp.md`, "Runner killed in the sandbox").
- Recovery runs once per `create` call. `recoverStaleContainer` destroys the recorded container within the remaining startup budget, writes the record with no container id (before the new create, RT-07), creates a new container and starts it. If that second start fails, the failure takes the usual path and the new id stays recorded.
- If the destroy fails, it throws its own code and the old container id stays recorded. A stop that took the session over during recovery makes `create` return the snapshot the stop left.

**Known limit.** The trigger is the code alone (VERIFIED_BY_CODE_READING). The port gives no distinction between a container that is gone and one that is stopped but still present, so a stopped-but-present container is destroyed and recreated as well, and what the old container held is dropped with it.

### Open questions and defaults (OQ-P4-01 to OQ-P4-12)

| ID | Question | Default applied | Blocked module or phase | Status |
| --- | --- | --- | --- | --- |
| OQ-P4-01 | Does the OpenShell supervisor proxy block IPv6 egress, and does it enforce `network_policies` when the workload container has networking off? | Rely on the proxy and the rendered IPv4-only policy; the live property is gated. | Live egress proof in `test/integration/production-driver.test.ts` (RT-05, D-75) | Live-gated. Fails closed. |
| OQ-P4-02 | Does the OpenShell 0.1.2 gateway accept the D-78 document at `--policy` create? | The document as rendered. | Live acceptance of the policy document in `src/runtime/openshell.ts` | Live-gated. Fails closed. |
| OQ-P4-03 | The v0.1.2 page documents the endpoint fields Realm uses, but the inspection and protocol fields were read only in part. | Realm writes none of them. Re-verify on upgrade. | The rendered shape in `src/runtime/egress.ts` (D-78) | Recorded assumption. |
| OQ-P4-04 | Does `openshell sandbox exec --name realm-<id> --workdir /workspace --no-tty --no-login-shell` run against a gateway-created sandbox, and does the sandbox have `/bin/sh` for shell form? | The argv form is the tested path. The shell form (`/bin/sh -c`) is refused with `SHELL_NOT_ALLOWED` unless `policy.shellEnabled` is true (D-24), and the live suite does not turn that policy on. | The production live suite covers the argv form through the same exec form: scenario 1 runs `sh -c` with `openshell sandbox exec` directly, and scenario 6 runs `exec` through `realm mcp` and the daemon (TOOL-03, D-92). Gated; passed live on the production stack, 2026-10-28 | Live-gated. Fails closed. |
| OQ-P4-05 | Does `sandbox exec` return the remote exit code through the CLI exit status? | Yes (the 0.1.2 help says "The CLI exits with the remote command's exit code"); the gated suite verifies it. | Exec result mapping in `src/runtime/session-execution.ts` (D-94) | Live-gated. Fails closed. |
| OQ-P4-06 | Reaping has no cross-process owner check. A second host process could reap a live session. | The reap precondition (D-87) and the single-daemon rule in Phase 6. | Phase 6 single-daemon control channel (RT-06) | Residual risk. Accepted in Phase 6. |
| OQ-P4-07 | A result-audit failure after a write has landed. | Return `AUDIT_WRITE_FAILED` to the caller and do not roll back. The caller must treat the outcome as unknown. | Dispatcher result stage in `src/tools/dispatch.ts` (D-89) | Decided. |
| OQ-P4-08 | The queue-wait error for advisory writes. | After the wait, writes proceed with a warning under an explicit `"mode": "advisory"` policy; exec and `fail-closed` writes return `REALM_NOT_ACTIVE`. The default mode is `fail-closed` (decision D4, 2026-10-29), so a policy with no `mode` refuses those writes too; this answer still holds for explicit advisory. | Dispatcher queue wait in `src/tools/dispatch.ts` (D-91) | Decided. |
| OQ-P4-09 | The value of `TOOL_CALL_TIMEOUT_MS` (30000). | The constant. Revisit only with a measured need, not as a policy key. | Dispatcher timeout in `src/tools/dispatch.ts` (D-91) | Decided. |
| OQ-P4-10 | Egress changes after create. | Fixed at create; changing it means destroy and recreate. Live `openshell policy set` is not used in Phase 4. | Session lifecycle after create (RT-05, D-81) | Decided. |
| OQ-P4-11 | Retry and status surface. | The dispatcher implements both (D-95); Phase 5 exposes `retry` through OMP-03. | Phase 5 OMP surface (TOOL-05, OMP-03) | Decided. Phase 5 exposes. |
| OQ-P4-12 | An allowlisted hostname that resolves to a private address is reachable under OpenShell's documented rule for exact hostnames. | Realm does not add `allowed_ips`, so the allowlist must contain only hosts the user intends to reach. | Egress allowlist review (RT-05, D-77) | Residual risk. Recorded. |

Superseded by `docs/integration/openshell.md`: `workloadArgv` is no longer a configuration key, and the sandbox has no workload command (one sandbox per session, named `realm-<sessionId>`).

## Catalogue extension (closure, 2026-10-22)

This section records an explicit contract extension to the error catalogue in `src/core/errors.ts`. The extension removes misleading code reuse. No existing code was renamed or removed. The catalogue held 25 codes at the closure on 2026-10-22; that count is historical, and the current count is in "Catalogue extension (Phase 14)". Three codes were added:

| Code | Retryable | What it replaces |
| --- | --- | --- |
| `AGENTOS_NOT_CONFIGURED` | false | `SCHEMA_INVALID`, which was used for a missing AgentOS driver. |
| `AGENTOS_STOP_FAILED` | true | `AGENTOS_CRASH_LOOP`, which was used for a stop failure. |
| `OPENSHELL_LABEL_AMBIGUOUS` | false | A per-instance reason override in `src/runtime/openshell.ts`. A later unit removes that override. |

Each new code now covers its own situation. The code it replaces keeps its own meaning and its catalogue entry is unchanged.

### Optional cause code (`causeCode`)

`RealmError` has an optional, readonly `causeCode` of type `ErrorCode`. It is present only when a cause is given. `makeRealmError(code, causeCode?)` takes it as an optional second argument, and one-argument calls behave as before.

- The cause is itself a catalogue code, so no raw runtime text can enter an error.
- The reason and the retryable flag always come from the primary `code`. `causeCode` never changes them.
- Example: `makeRealmError("OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN")` gives code `OPENSHELL_START_FAILED`, `causeCode` `PODMAN_MACHINE_DOWN`, and the `OPENSHELL_START_FAILED` reason.

## Catalogue extension (Phase 14)

This section records the second explicit contract extension to the error catalogue in `src/core/errors.ts`. The owner approved exactly this one addition (decision D5, 2026-10-29). No existing code was renamed or removed. After this change the catalogue held **30 codes** (`ERROR_CODES` and the header comment "Exactly these 30 codes" in `src/core/errors.ts`); that count is historical, and the current count is in "Catalogue extension (Phase 17)". The count of 25 in "Catalogue extension (closure, 2026-10-22)" is historical too: four codes were catalogued after it (`MCP_INPUT_FAILED`, `CLEANUP_FAILED`, `DAEMON_START_TIMEOUT`, `SANDBOX_NAME_IN_USE`, named in the same header comment), and this one is the fifth.

| Code | Retryable | gRPC status | Reason text (`src/core/errors.ts`) |
| --- | --- | --- | --- |
| `AUDIT_OUTCOME_UNKNOWN` | false | `INTERNAL` (`DRIVER_STATUS`, `src/runtime/driver/grpc-status.ts`) | The process ended before this call's result was recorded; whether the call took effect is unknown. |

**Why no existing code fits.** The code labels a call whose admission audit line has no result line, so the call may or may not have run. `AUDIT_WRITE_FAILED` says "audit log could not be written; the tool call did not run" and is retryable, which is false and unsafe for a call that may have run. `OPENSHELL_START_FAILED`, `WRITE_NOT_ATOMIC` and the other codes describe other events. The code is not retryable because it only labels a historical line and must not invite a blind retry.

**Where it appears.** In this change the code is the `outcome` of a reconciliation audit line (`src/audit/reconcile.ts`, `reconcileAuditLogs`) and nowhere else in `src/`: no tool reply carries it (VERIFIED_BY_CODE_READING: a search of `src/` finds it only in `errors.ts`, `grpc-status.ts`, `reconcile.ts` and comments in `log.ts`).

**Files that enumerate the catalogue.** A new code is added by hand in three places: `src/core/errors.ts` (the header comment, the `ERROR_CODES` tuple and the `ERROR_CATALOGUE` record), `src/runtime/driver/grpc-status.ts` (`DRIVER_STATUS`), and `test/core/errors.test.ts` (`EXPECTED_CODES`, the retryable partition and `CATALOGUE_SIZE`). `ERROR_CATALOGUE` and `DRIVER_STATUS` are typed `Record<ErrorCode, ...>`, so a missing entry fails compilation (VERIFIED_BY_CODE_READING). `src/daemon/channel.ts`, `src/daemon/client.ts`, `src/daemon/ensure.ts` and `src/cli/main.ts` read `ERROR_CODES` and need no edit.

## Catalogue extension (Phase 17)

This section records the third explicit contract extension to the error catalogue in `src/core/errors.ts`, and a settled-decision change that the extension needs. The owner approved exactly this one addition (decision D5, 2026-10-29). No existing code was renamed or removed. The catalogue now holds **31 codes** (`ERROR_CODES` and the header comment "Exactly these 31 codes" in `src/core/errors.ts`). The counts of 25 and 30 in the two sections above are historical. The decision is recorded here before the code that uses it (requirement OBS-04, debt item TD-05).

| Code | Retryable | gRPC status | Reason text (`src/core/errors.ts`) |
| --- | --- | --- | --- |
| `OPENSHELL_GATEWAY_LOST` | true | `UNAVAILABLE` (`DRIVER_STATUS`, `src/runtime/driver/grpc-status.ts`) | The OpenShell gateway, or the compute driver behind it, did not answer, so the sandbox cannot be reached; restore the gateway, then retry. |

**Why no existing code fits.** Today the runner crash and the gateway loss both read `AGENTOS_CRASH_LOOP`: the health probe (`AgentOsSupervisor.check`) holds the supervisor on a runner exit, a stale heartbeat, and a probe that fails or does not answer, and every hold throws `AGENTOS_CRASH_LOOP`. The probe is an `openshell sandbox exec` child, and `openshell sandbox exec` exits with the remote command's exit code, so a dead gateway and a stale heartbeat both end with exit code 1; the exit code cannot tell them apart. `AGENTOS_CRASH_LOOP` says the runner crashed, which is false when the gateway is gone. `OPENSHELL_START_FAILED` describes a failed create or start. `ANDA_UNREACHABLE` and `PODMAN_MACHINE_DOWN` name other services. The new code is retryable like `AGENTOS_CRASH_LOOP` and `PODMAN_MACHINE_DOWN`: the session is in `error`, and a retry, or `realm down` then `realm up`, works once the gateway is back.

**Settled decision: the pinned OpenShell CLI verbs gain `openshell status`.** The pinned verbs are `sandbox create`, `sandbox exec` and `sandbox delete` (`AGENTS.md`, "Settled runtime decisions"; "Exec verb pin (D-93)"). `openshell status` is added to that set as a read-only gateway check. Source record: `docs/integration/openshell.md`, Q6 ("Gateway and CLI surface", read 2026-10-21), which lists `openshell status` among the CLI surface of the Installation and Gateway pages. Q6 records the verb and nothing about its exit codes. The exit codes below are not recorded in `openshell.md`; they come from a read-only local execution during the Phase 17 research (openshell 0.1.5, scratch `HOME`, no gateway running): with a registered gateway at a closed port `openshell status` exits 1, and with no gateway configured it prints "No gateway configured" and exits 0. The output of a healthy gateway was not observed in that execution. Only `src/runtime/openshell.ts` names the binary: `buildGatewayStatusArgv()` returns `openshell status`, and the check runs with the same environment as the exec path (`selectOpenShellEnvironment`).

**What the code does.** Only the failure path of the probe classifies. When the runner has exited or the probe does not answer true, `AgentOsSupervisor.check` holds the supervisor and asks the driver `gatewayAnswers()`, which runs `openshell status` under a 10 s bound (`GATEWAY_STATUS_TIMEOUT_MS`) and answers true only for exit 0. The thrown code is `AGENTOS_CRASH_LOOP` when the gateway answers and `OPENSHELL_GATEWAY_LOST` when it does not (non-zero exit, rejection or timeout). A stop or a new start that overtakes the classification makes `check` return false. A held supervisor keeps its code until `start()`. The state machine is unchanged: the code becomes the state's reason, so `realm status` and the Omp status item show it. The `realm doctor` `agentos` item prints the thrown code when it is `OPENSHELL_GATEWAY_LOST` and otherwise keeps `AGENTOS_CRASH_LOOP`. A healthy tick runs no extra command.

**What is covered and what is not.**

- (a) Driver loss: the compute driver behind the gateway is detected only if `openshell status` fails while that driver is down. That is not yet verified live; the reason text says "or the compute driver behind it" on that basis.
- (b) `openshell status` exits 0 with "No gateway configured". If the daemon's `HOME` loses the gateway configuration, the classification reads `AGENTOS_CRASH_LOOP`. The exec path and the status path share one environment, so they stay consistent.
- (c) A runner that dies in the same second the gateway is restarted reads `AGENTOS_CRASH_LOOP`, because the gateway answers by the time it is asked.
- (d) A TLS failure of the gateway (for example `BadSignature`) also reads `OPENSHELL_GATEWAY_LOST`. That is intended: the gateway is unusable.

**Not changed.** `create` and `up` with the gateway down still fail with `OPENSHELL_START_FAILED`. The `exec` tool path is unchanged (it returns the command's exit code or `REALM_NOT_ACTIVE`). Only the health-probe path (`AgentOsSupervisor.check`) classifies.

**Files that enumerate the catalogue.** As in "Catalogue extension (Phase 14)": `src/core/errors.ts` (header comment, `ERROR_CODES`, `ERROR_CATALOGUE`), `src/runtime/driver/grpc-status.ts` (`DRIVER_STATUS`) and `test/core/errors.test.ts`. `src/core/errors.ts` stays import-free because it is a gate-closure entry.

## Closure decisions (2026-10-22)

These decisions were recorded by the user on 2026-10-22. Each is checked against the source named in its line. Nothing in this section is a live host run.

- **Session owner.** The daemon owns sessions: the sandbox, the policy, and the session. Hosts attach to the daemon and do not own the sandbox (`src/omp/extension.ts`, `src/omp/plugin.ts`).
- **Attach.** A surface attaches by connecting to the control socket and calling `up`. `up` is idempotent (`src/daemon/client.ts`). There is no attach or detach protocol.
- **Lifetime.** The sandbox persists until `realm down`. A host shutdown closes that host's client and never sends `down` (`endSession`, `src/omp/plugin.ts`).
- **Grace-period detach.** The grace-period detach is deferred. It is recorded as a deviation from the spec.
- **Tool method.** The `tool` method carries `{ tool }`. Its reply is the tool outcome (`done` or `refused`) or a catalogue code (`src/daemon/client.ts`, `call` and `isToolOutcome`; `src/daemon/daemon.ts`, case `tool`). TD-01 (Phase 14): a refusal's error reply now also carries `causeCode` when the dispatcher's refused outcome has one. The refused `ToolOutcome` variant gained an optional `causeCode` (`src/tools/dispatch.ts`, `refused`), and the `tool` case copies it into `{ code, causeCode }` (`src/daemon/daemon.ts`). Without a cause the reply is `{ code }` as before. The shapes seen over the daemon and in process are not unified: in process a caller gets the refused outcome (`outcome`, `tool`, `code`, `retryable`, optional `causeCode`), and over the daemon it gets an error reply of `code` and optional `causeCode` only, which `DaemonClient` rethrows as a `RealmError`. Unifying them is a recorded candidate owner decision and is not made here.
- **Control line cap.** A control line is capped at 1 MiB (`MAX_CONTROL_LINE_BYTES`, `src/daemon/channel.ts`). An oversized request is refused unread with a null-id `SCHEMA_INVALID` reply, and the connection then closes (`oversizedLineReply`, `src/daemon/channel.ts`; `src/daemon/daemon.ts`).
- **Policy mode in replies.** `status` and `up` replies carry the policy mode, `advisory` or `fail-closed` (`DaemonStatus.mode`, `src/daemon/client.ts`). A policy with no `mode` reports `fail-closed`; `advisory` appears only when the policy file sets it.
- **Directory modes.** On a fresh start the state directory and the run directory are created at 0700. An existing run directory must be exactly 0700 and owned by the current user, or the call is `SCHEMA_INVALID` (`ensureSocketDir`, `src/daemon/channel.ts`).
- **Omp guard with unknown mode.** When the status read fails and no mode has been reported yet, the Omp guard blocks the host write. With a known explicit advisory mode, the write proceeds with a warning; with `fail-closed`, the default, it is blocked (`src/omp/plugin.ts`, the fallback in `stateVerdict` and the status-failure path).


## Closure follow-ups (2026-10-22)

**Startup output.** A detached daemon's stdout and stderr go to `<stateDir>/daemon.log`. `startDetachedDaemon` and the CLI's `withDaemonLog` (`src/cli/main.ts`) open that file in append mode at mode 0600, set it to 0600 with `fchmodSync`, and close the parent's descriptor after the spawn returns. The stderr hint `realm: the daemon's startup output is in <path>` comes from `daemonLogHint`. `up` adds it when its ensure step throws or when its `up` request throws, which covers a transport failure. An `up` reply that carries an error or a non-active state does not add it; that refusal is written as `CODE: reason` alone. `mcp` and `acp` add it through `attachFailure` when their ensure step throws or when their `up` call throws, and a daemon error reply reaches that catch as a throw. `acp` does not add it when its `up` returns a state other than active or degraded; that refusal is written as `CODE: reason` alone. The log is never printed.

**Reply cap.** Replies from the daemon are capped at `MAX_CONTROL_LINE_BYTES` (1 MiB), as requests are. `readBounded` in `src/daemon/channel.ts` counts the bytes before the reply's newline. Past the cap it destroys the socket and rejects with `SCHEMA_INVALID`, and `sendRequest` passes that error through, so the client's `request` in `src/daemon/client.ts` rejects with `SCHEMA_INVALID`. The reply is never buffered past the cap.

**Ensure timeout.** `ensureDaemon` (`src/daemon/ensure.ts`) asks a probe what the control socket holds: a daemon that answers, a daemon that holds the socket but has not answered yet (a reply cut short while it binds, or a timeout while it is busy with its startup reap), or nothing. It spawns at most once, and only when the socket is absent: a second daemon spawned over one that holds the socket would only refuse with `LOCK_CONFLICT` (found by the Greptile review of the pull request that shared this probe between the CLI and the Omp extension). A held socket is waited for, for the whole bound. It then polls until a daemon answers or its bound elapses. When the bound elapses it throws `DAEMON_START_TIMEOUT`. That code is retryable (`src/core/errors.ts`). Its reason reads: "The daemon did not answer on its control socket within the daemon start timeout after it was spawned."

**Control request limits.** `CONTROL_TIMEOUT_MS` (`src/daemon/channel.ts`) bounds each request per method: `status` 5 s, `down` 45 s, `doctor` 60 s, `tool` the dispatcher's 30 s plus a 10 s reply margin, and `up` 230 s, which is the default startup budget of 200 s plus a 30 s margin. The caller reports `TOOL_TIMEOUT` when its limit passes. No CLI or plugin caller reads the daemon-owned policy, so a policy that sets `startupBudgetMs` above 200 s can still exceed the `up` limit; the plugin's own 200 s startup timer is unchanged and fires first.

**Directory modes.** `withDaemonLog` (`src/cli/main.ts`) creates the missing ancestors of the state directory with no mode argument, so they take the default mode, which the umask narrows. It then creates only the state directory, with `mkdirSync(stateDir, { recursive: true, mode: 0o700 })`. `ensureSocketDir` (`src/daemon/channel.ts`) applies the same rule on the daemon side: missing ancestors of the state directory are created at `DEFAULT_DIR_MODE` (0777), which the umask narrows, and only the state directory and its run directory are created at `RUN_DIR_MODE` (0700).

## Driver roots (Phase 15, ONB-03)

The secret root, the pinned workspace root and the sandbox state root are fields of `config.json` (`secretRoot`, `workspaceRoot`, `sandboxStateRoot`). `workspaceRoot` is required. When `secretRoot` or `sandboxStateRoot` is omitted, `runtimeRootsOf` (`src/runtime/config.ts`) derives `<stateDir>/secrets` and `<stateDir>/sandboxes`. The daemon (`src/daemon/main.ts`) and the compute driver (`src/runtime/driver/main.ts`) both read that file. A stale `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT` or `REALM_DRIVER_STATE_ROOT` variable is ignored. `REALM_DRIVER_SOCKET`, the image, the gateway variables and the supervisor variables are unchanged.

## Per-project sessions (Phase 18, MULTI-01)

Status: recorded 2026-10-30, before the code that needs it. Source: owner decision D5 item (i) (2026-10-29, `.planning/MILESTONE-CONTEXT.md`) and requirements MULTI-01 to MULTI-06 (`.planning/REQUIREMENTS.md`). Not live-verified.

**Decision.** The daemon holds one session per project workspace. A project workspace is a directory that is a descendant of a configured root. This supersedes "one session per daemon". The code still has the superseded form: `src/daemon/main.ts` sets `SESSION_ID = "daemon"`, so every `up` on the host shares one record, one sandbox and one audit file.

**Reasons.**

- The driver pins one workspace root in `config.json` (`workspaceRoot`, see "Driver roots (Phase 15, ONB-03)"). One daemon therefore cannot give two projects separate `/workspace` contents.
- Owner decision D5 item (i) approves the change. Proposal 3 of `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/IMPROVEMENT-PROPOSALS.md` asks for a recorded decision that supersedes one session per daemon.

**Consequences.**

- **Session id.** The session id is derived from the pinned project workspace. It is a deterministic function of the workspace's canonical path, fixed when the session is created, and it must match the session-id pattern that the store and `appendAudit` already enforce. The fixed id `"daemon"` is removed, and no alias is kept.
- **Sandbox.** One sandbox per workspace, named `realm-<sessionId>`.
- **Per-session state.** Each session owns its record, its pinned subdirectory under the workspace root, its audit file `<stateDir>/audit/<sessionId>.jsonl`, its lock table and its status snapshot. No file is shared between sessions.
- **Lifecycle.** `realm down` for one session removes that session's sandbox and leaves the other sessions active.
- **Maintenance.** The startup reconciliation already reads every `<stateDir>/audit/<sessionId>.jsonl`, so it needs no change for several logs. The startup reap is per session (RES-01 below).
- **Resource bound.** The aggregate memory and CPU of concurrent sessions is bounded and documented with existing configuration and no new catalogue code (MULTI-06).

**What does not change.**

- **One container per session.** A session is one container, and no two sessions share one. V2-02 (one container per workspace, with cross-session lock leases and refcounted reaping) stays deferred.
- **The daemon owns sessions.** Hosts attach by calling `up` on the control socket and do not own the sandbox ("Closure decisions (2026-10-22)").
- **Lifetime.** A sandbox lasts until `realm down` for its session. A host shutdown still never sends `down`.
- **Single owner.** One host daemon owns the state directory (D-87, OQ-P4-06).
- **Driver scope.** This decision does not amend PRD-DRV-01. MULTI-04 handles it only as far as Phase 18 needs.
- **Catalogue.** No error code is added.

**Reversibility.** Costly. Session ids, sandbox names, paths and audit file names all depend on it.

## Startup reaper and scratch volume (Phase 19, RES-01)

Status: recorded 2026-10-30, before the code that needs it. Source: owner decision D5 items (ii) and (iii) (2026-10-29, `.planning/MILESTONE-CONTEXT.md`) and requirements RES-01 to RES-05 (`.planning/REQUIREMENTS.md`). Not live-verified.

**Decision (reaper).** At startup the reaper re-adopts a running realm container that passes the create-time hardening verifier (D-51) and is recorded for a session. It removes every other realm container. This supersedes the "remove everything" form of D-84, D-86 and RT-08 (`reapStartup`, `removeAllRealmContainers`; "Startup maintenance (Phase 14, CRASH-04)" above). That form removed every realm container and deleted every session record, so a running sandbox and its state were lost when the daemon crashed (`ABRUPT-END-PERSISTENCE-FINDINGS.md`).

**Definitions.**

- **Adopted.** A realm container (label `io.realm.managed=true`) for which all of these hold: its `io.realm.session` label names a session; that session's record names its container id; it is running; and it passes the hardening verifier with the mount list in the second part of this section.
- **Orphan.** A realm container that is not adopted. Two causes give an orphan: no session record names it, or it fails the verifier (including an inspection that fails, because such a container cannot be proven good).

**The no-orphan guarantee.** After startup maintenance, and before the gate opens, every realm container is either adopted, or was removed and its removal proven by the same listing as before. No realm container that is not adopted survives startup, and no orphan is skipped silently. If a container cannot be removed or proven gone, the start aborts as it does now, because nothing may be served while an unknown container might survive.

**Records.** A session record that names no adopted container is deleted, as today. The session starts again on the next `up`.

**Logging.** Each adoption and each removal is logged once per start. The `StartupReport` and the `daemon.startup` record in `daemon.log` carry the adopted container ids and the removed container ids, and each removal carries its cause: `no-record`, or the catalogue code of the verifier failure or inspection failure. The notice on `status`, `up` and `down` (D-1404) is still emitted only when a container was removed or a record was deleted, so an adoption alone produces no notice.

**Order.** Adoption runs inside the reap, before any `LifecycleController` or `ToolDispatcher` exists (D-87). The reap timeout (`REAP_SWEEP_TIMEOUT_MS`) still applies.

**Decision (scratch volume).** RT-01's mount list gains one session-owned scratch volume. The earlier RT-01 wording is not edited; this section amends it.

- **Name and labels.** A Podman named volume `realm-scratch-<sessionId>`, labelled `io.realm.managed=true` and `io.realm.session=<sessionId>`.
- **Mount.** Read-write at `/scratch` in the sandbox. `/scratch` is the stated path. It is not `/workspace`, and no other mount uses it.
- **Rest of the list.** Unchanged in substance. The pinned project workspace stays the only host path mounted, and the verifier still refuses any other mount.
- **Verifier.** The mounts property admits exactly one volume mount: the volume `realm-scratch-<sessionId>` for the adopted session, at destination `/scratch`, read-write. A tmpfs, any other volume and any other destination still fail the mounts property (RT-01).
- **Ownership.** The volume belongs to one session. No other session mounts it.
- **Lifetime.** The volume outlives the container and the daemon, so a restart that adopts the container keeps it. `realm down` removes the session's sandbox and then its volume, and the volume's removal is checked by a listing, as the container sweep is.

**Not verified.** Attachment at create goes through OpenShell, and the pinned surface does not document an extra-mount option. This is recorded as OQ-P19-01. Realm creates no fallback mount and no fallback container (D-47).

**Open questions and defaults (RES-01 to RES-05)**

| ID | Question | Default applied | Blocked module or phase | Status |
| --- | --- | --- | --- | --- |
| OQ-P19-01 | Can the OpenShell 0.1.5 Podman driver attach the named scratch volume at `/scratch` when it creates the sandbox, and keep its labels? | Fail closed. If the create cannot attach it, the create fails with `OPENSHELL_START_FAILED`. No fallback mount or container. | RES-03 live proof in `src/runtime/openshell.ts` and `src/runtime/session-execution.ts` | Live-gated. Fails closed. |
| OQ-P19-02 | Does libpod inspect report the scratch volume as a mount of type `volume` with the name and destination that the verifier reads? | The verifier reads only those fields. Any other shape fails closed. | `verifyInspect` mounts property in `src/runtime/hardening.ts` (D-51); RES-05 live scenario | Live-gated. Fails closed. |
| OQ-P19-03 | Does a re-adopted container keep running, with `/workspace` intact, across a daemon kill on the host? | Assumed yes. RES-05 is the test. | RES-02 and RES-05 live scenario | Live-gated. Fails closed: a container that fails the verifier is removed. |

**Reversibility.** Costly for the reaper, because every restart depends on it. Moderate for the mount list, because only the scratch volume and its verifier rule change.
