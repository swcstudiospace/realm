---
phase: 58-kimi-recorder-fix-and-rerun
verified: 2026-11-25T00:00:00Z
status: passed-with-gaps
score: 1/3 criteria verified, 2/3 carried (gate-blocked)
head: 404da2b
date: 2026-11-25
---

# Phase 58: KIMV-02 recorder fix and rerun — Verification Record

**Phase Goal (ROADMAP):** The wire recorder logs before forwarding (fixing the indicted instrument), and the deciding live rerun closes GAP-43-03: the response the log-after-forward recorder missed is shown, or the client's close-after-response race is established as the narrowed cause.

**Verdict:** `passed-with-gaps` — the hermetic recorder fix is verified in the tree; the deciding live rerun is CARRIED, gate-blocked (production stack down on this host, reproducibly probed below). GAP-43-03 stays `narrowed`; KIMV-02 is carried, narrowed — not met.

**Scope of this verification:** read-only targeted reads/greps plus the gate probe against HEAD `404da2b` (2026-11-25). No builds/lint/format run, per assignment. Files/structure verified: `58-CONTEXT.md`, `58-PLAN.md`, `58-EVIDENCE.md`, `58-WINDOW.md`, ROADMAP Phase 58 block, `test/support/host-live-recorder.test.ts`, `test/support/host-live-session.ts` (`teeSource`/`writeWireRecorder`), `docs/integration/host-plugin-gaps.md` GAP-43-03 row.

## Per-criterion evidence table

| # | ROADMAP Phase 58 success criterion | Verdict | Evidence (file:line / commit) |
|---|-------------------------------------|---------|-------------------------------|
| 1 | A hermetic test shows the recorder log-before-forward change red-first (a response visible after the fix that the old code dropped) and the fixed recorder in use by every live harness that asserts the wire summary. | **PASSED** | Fix: `test/support/host-live-session.ts:432-433` (`teeSource`): `process.stdin.on("data", (chunk) => { tap("host-to-realm")(chunk); child.stdin.write(chunk); })` and `child.stdout.on("data", (chunk) => { tap("realm-to-host")(chunk); process.stdout.write(chunk); })` — tap (sync `appendFileSync`) before forward in both directions; no `pipe()` forward. Ordering test: `test/support/host-live-recorder.test.ts` — ordering test over the **generated** `wire-tee.mjs` (asserts absence of both `pipe()` forwards, tap-before-write in both handlers) plus the SIGKILL control (a `tools/list` response with the six tool names is in the wire log when the host kills the recorder right after reading it). Red-first recorded: `58-EVIDENCE.md` §2 (failed pre-fix `the tee must not pipe-forward the target's stdout`, passes after; local run 53 passed / 0 failed, 2026-11-21). Fixed recorder in use by every wire-summary harness: single `writeWireRecorder` (`host-live-session.ts:451`) called from `test/support/host-live.ts:1378` and the kimi, kimi-code, codex, muse, capability and timeline live files (grep `writeWireRecorder` across `test/`); no second recorder exists. Commits: `f7ac5c1` (`fix(test): log recorder lines before forwarding; live kimi rerun bloc...`), `2f25bc0`. |
| 2 | A live rerun with the fixed recorder keeps the wire log and the full `kimi mcp test realm` output: if the response appears, the recorder was the cause; otherwise the client's close-after-response race is recorded; version and date recorded. | **CARRIED** (gate-blocked) | `58-WINDOW.md` §3 (2026-11-22): preflight under the free shared live lock found the production stack down — no OpenShell gateway, realm gateway/compute-driver units absent and inactive, rootless Podman image list empty (no digest-pinned image), no driver config/socket/runtime dir. No cold production run was made; no wire log or `kimi mcp test realm` output exists to keep. **Gate reproduced by this verifier 2026-11-25:** `su realmlive -c 'openshell status'` → `Status: No gateway configured`; `env \| grep REALM_DRIVER` → no values; `the realmlive home directory/.config/realm/` absent; `podman images` shows no digest-pinned realm image (only unrelated images, e.g. `docker.io/library/alpine:latest`, `node:22`). The gate is closed; the live rerun cannot open. Details below. |
| 3 | KIMV-02 is met with the cause established and recorded in the phase and the gap rows, or carried with a stated, tested reason; GAP-43-03 is not relabelled and the recorder inference is no longer inference once the rerun runs. | **CARRIED** (follows from #2) | `58-WINDOW.md` §4: component NOT-ESTABLISHED; KIMV-02 carried, narrowed — not met; no `src/` change (rerun never indicted `realm mcp`). `docs/integration/host-plugin-gaps.md` GAP-43-03 row (line 72): status `narrowed` (unverified-behavior), with the 2026-11-21 hermetic fix and the 2026-11-22 BLOCKED rerun recorded as written; the row is **not relabelled** and not closed by inference. The recorder fix removes the instrument's last-line miss, so the rerun can now decide — but it has not run. |

## Gate probe (criterion 2, reproduced)

Commands run by this verifier (read-only), 2026-11-25, HEAD `404da2b`:

- `su realmlive -c 'openshell status'` → `Status: No gateway configured.` ( `/usr/bin/openshell` present )
- `env | grep -i REALM_DRIVER` → `no-REALM_DRIVER-env` (production tier gate variables have no values)
- `ls the realmlive home directory/.config/realm/` → `No such file or directory`; `ls the realmlive home directory/.local/share/realm*` → absent
- `podman images` → no digest-pinned realm image (only unrelated images: `alpine:latest/3`, `node:22/22-slim`, `dragonfly:v1.27.1`, `timescaledb:2.13.1-pg16`, etc.)
- `systemctl --user ...` as `realmlive` → `Failed to connect to bus: Permission denied` (bus not reachable from this probe; recorded as a probe limitation, not as evidence about unit state — the window's 2026-11-22 preflight of absent/inactive systemd user units stands as the unit-state evidence)

Bringing the stack up (gateway registration, unit installation, image pull, driver configuration) is outside this phase's plan and outside a verifier window. The failure is a reproducible gate closure, not an implementation defect: marking criterion 2 FAILED would misreport the cause. Per the roadmap carry language, it is CARRIED with a stated, tested reason.

## What was verified vs. what is carried

- **Verified hermetic (criterion 1):** log-before-forward tee in the tree, red-first ordering test present (generated-tee assertions + SIGKILL control), pre-fix failure and 53-pass local run recorded, one recorder (`writeWireRecorder`) serving every live wire-summary harness. This is code-evidence verification at HEAD `404da2b`; no test suite was re-run by this verifier (per assignment: record what was run, do not run builds).
- **Carried (criteria 2–3):** the deciding live rerun (wire log + full `kimi mcp test realm` output, version and date, component named with bounding evidence) and therefore cause establishment / GAP-43-03 relabelling. The WINDOW record is the evidence of the blocked attempt; this verification reproduces the gate closure that blocks it.

## Resume command for the carried part

On a host with the production stack up (or after bringing it up: `openshell gateway add <endpoint>`; install/activate the realm gateway and compute-driver user units; ensure the digest-pinned image is present; set the production tier's gate variables — image digest, driver config, driver socket, runtime directory):

```bash
# acquire the shared live lock, then run the gated legacy kimi production tier
# with the fixed recorder, keeping the wire log and full output outside the repository
npm run build   # hermetic ordering test run:
node --test dist/test/support/host-live-recorder.test.js
# live rerun (gated; records version, date, wire log, full `kimi mcp test realm` output):
node --test dist/test/integration/host-live-kimi.test.ts
```

Then record the failing component (client / recorder / `realm mcp` / stack) in `58-WINDOW.md` and the GAP-43-03 row with the bounding evidence (58-PLAN steps 3–4); if the response appears, the recorder was the cause; otherwise record the client's close-after-response race as the narrowed cause. Never relabel GAP-43-03 before that evidence exists (D-58-3/D-58-4).

_Verified: 2026-11-25 · HEAD 404da2b · Verifier (gsd-verifier), read-only_
