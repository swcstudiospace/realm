# Phase 58 window record (plan 58-01, KIMV-02)

Date: 2026-11-22. Commit under test: the detached `main` head at the window
(`4dc5540`). Account: the unprivileged live account of the production stack.
Evidence and scratch placeholders: SCRATCH_DIR (mode 0755, outside the
repository), EVIDENCE_DIR (mode 0700, outside the repository). No path, user
name, environment value, credential or message text is in this file.

## 1. Recorder fix — verified present in the tree (O)

The 58-PLAN step 1 fix is present exactly as 58-EVIDENCE §1 states, in
`test/support/host-live-session.ts` (`teeSource`, the generated
`wire-tee.mjs`), lines 432-433:

```js
process.stdin.on("data", (chunk) => { tap("host-to-realm")(chunk); child.stdin.write(chunk); });
child.stdout.on("data", (chunk) => { tap("realm-to-host")(chunk); process.stdout.write(chunk); });
```

A `data` handler per direction logs (tap, synchronous `appendFileSync`)
**before** writing the chunk onward. No `pipe()` forward in either direction
(`child.stdout.pipe(process.stdout)` and `process.stdin.pipe(child.stdin)`
are absent — asserted by the hermetic row). EOF still ends the child's
stdin; SIGTERM/SIGINT forwarding and the exit-code path are unchanged.
The doc comment above `teeSource` (lines 313-315) records the Phase 58
ordering.

The red-first hermetic row required by 58-PLAN step 1 is present and was
not added again (adding it would duplicate it):
`test/support/host-live-recorder.test.ts` — the ordering test over the
**generated** `wire-tee.mjs` (fails pre-fix: it asserts the absence of both
`pipe()` forwards and tap-before-write in both handlers) and the SIGKILL
control (a `tools/list` response is in the wire log when the host kills
the recorder right after reading it). Pre-fix failure was recorded in
58-EVIDENCE §2 (2026-11-21); no rerun of the hermetic suite was made in
this window (the assignment permits code edits only; the orchestrator
verifies the union).

Every live harness that asserts the wire summary uses this one recorder
(`writeWireRecorder` in `test/support/host-live-session.ts`, called from
`test/support/host-live.ts` line 1378 and from the kimi, kimi-code,
codex, muse, capability and timeline live files), so every such harness
gets the log-before-forward ordering; there is no second recorder to fix.

## 2. Scratch reinstall — verified outside the repository (O)

On 2026-11-22, kimi-cli 1.51.0 was installed in SCRATCH_DIR, outside the
repository: a uv virtual environment on the system Python 3.12
(`uv venv`, then `uv pip install kimi-cli==1.51.0` from the package
registry), the uv cache inside SCRATCH_DIR, installed size 250 MB.
The wheel's SHA-256 digest starts `ffb9d0d4725844d3`, equal to the
registry value recorded in 47-WINDOW (upload 2026-09-21); 1.52.0 remains
the deprecation stub. `kimi --version` in a throwaway home prints
`kimi, version 1.51.0`; the venv holds fastmcp 3.2.4 and mcp 1.30.0
(the 47-WINDOW dependency set). The classification rules reused are the
Phase 47 ones (never-written / after-close / error) and the C1/C2
controls. SCRATCH_DIR and the throwaway home were removed after this
check; nothing was installed into the repository, a home directory or a
global location.

## 3. Deciding live rerun — BLOCKED, not run (O)

The cold production tier with the fixed recorder was **not run** in this
window. Preflight on 2026-11-22 (under the shared live lock, which was
free) found the production stack down on this host:

- OpenShell: no gateway configured (`openshell status` reports no gateway;
  the user `openshell-gateway` unit is disabled and inactive).
- Realm gateway and compute-driver user units: not present and inactive.
- Rootless Podman 5.7.1 as the live account: runs, but the image list is
  empty — no digest-pinned image is present.
- No driver config, driver socket or runtime directory for the live
  account was found; the user session was not lingering (this agent
  enabled lingering to probe, and the probe is the finding).

The production tier's gate variables (image digest, driver config, driver
socket, runtime directory) have no values on this host, and bringing the
stack up — gateway registration, unit installation, image pull, driver
configuration — is outside this plan and outside a subagent window.
Per the plan, a failed-to-open window is recorded as blocked; no run was
fabricated and no wire log or `kimi mcp test realm` output exists to
keep. The lock was released after preflight; the stack was left exactly
as found (linger was disabled again after the probe).

## 4. Component and KIMV-02 outcome

**Component: NOT-ESTABLISHED.** The deciding rerun did not run, so
nothing in this window establishes recorder, client or `realm mcp` as
the cause. The narrowed bounds are therefore the Phase 52 bounds plus
the hermetic fix: `realm mcp` exonerated by source
(`src/cli/stdio-host.ts` answers `initialize`/`tools/list` before boot
settles; no `tools/list` error path; teardown only at stdin end or
signal), the recorder instrument indicted by its own code and now fixed
hermetically (tap before forward, §1), and the client's close-after-
response SIGKILL confirmed by Phase 47 observation — the recorder fix
removes the instrument's last-line miss, so a rerun on a host with the
stack up can now decide.

**KIMV-02: carried, narrowed — not met.** No `src/` change was made:
the rerun never indicted `realm mcp`, and per 58-PLAN step 3 a source
change needs that indictment. No bound was measured (no run), so no
25000 ms conclusion is drawn. GAP-43-03 stays `narrowed` and is never
relabelled; the GAP-43-03 row carries this window's outcome, and the
Phase 57 note in that page is kept as written (Phase 57 has no window
record yet, so there is nothing to rebase against beyond keeping it).

## 5. What was not shown

No cold production run, no wire log, no `kimi mcp test realm` output.
One CLI version (1.51.0) re-verified at install only. No model turn, no
tool call, no credential. The 25000 ms cold-connect bound remains
unmeasured for the fixed recorder.
