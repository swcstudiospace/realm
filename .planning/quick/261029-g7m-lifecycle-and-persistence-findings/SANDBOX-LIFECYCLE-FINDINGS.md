# Sandbox lifecycle findings: does the Omp plugin create the sandbox on a new session?

Quick task 261029-g7m, 2026-10-29. Repository at main 00e0003 (release v0.2.2). The live checks ran the installed build 0.2.1; `git diff --stat v0.2.1 v0.2.2` shows no change under `src`, `test`, `scripts`, `.github` or `release`, so the compiled code is the same (VERIFIED_BY_EXECUTION).

Evidence labels. VERIFIED_BY_CODE_READING: the cited lines were read. VERIFIED_BY_EXECUTION: a command or live run was observed; the record is in `LIVE-VERIFICATION.md` in this directory (sections L1 to L7). UNVERIFIED: inferred, with what would verify it. All paths are repository-relative.

## 1. Terms and the interpretation used

| Term | Meaning in this repository | Evidence |
|---|---|---|
| Omp | An external coding-agent host (oh-my-pi, command `omp`; 18.12.6 on the check host). It is not part of this repository. Realm loads into it as an extension declared under the `omp` key. | `package.json:30-34`; `docs/integration/omp.md:45`. VERIFIED_BY_CODE_READING |
| the plugin | Realm's Omp extension: the edge `src/omp/extension.ts` and the logic `src/omp/plugin.ts`. | VERIFIED_BY_CODE_READING |
| session | Two things. Omp's session (events `session_start` and `session_shutdown`), and the Realm session record, of which the daemon owns exactly one with the constant id `daemon`. | `src/omp/plugin.ts:318`, `:340`; `src/daemon/main.ts:21`. VERIFIED_BY_CODE_READING |
| sandbox | One rootless Podman container, created through the OpenShell gateway and the Realm compute driver. Read-only root, tmpfs `/tmp` and `/run`, the pinned host workspace bound read-write at `/workspace`, the AgentOS runner as the workload. Its name was `realm-daemon` live. | `src/runtime/hardening.ts:47-57`; `src/runtime/driver/sandbox-binding.ts:18`; `test/support/production-live.ts` (daemon session id). VERIFIED_BY_CODE_READING; name VERIFIED_BY_EXECUTION (L1) |

The repository supports no other meaning of sandbox (no worktree or temporary-directory sandbox exists under `src`).

## 2. Verdict

**Conditionally yes for the attach, and no for use of the sandbox by Omp's own tools.**

1. Opening an Omp session starts the attach with no user step. The first session creates the sandbox; later sessions in the same workspace attach to the same one. VERIFIED_BY_CODE_READING and VERIFIED_BY_EXECUTION (L1, L7).
2. The attach needs the conditions in section 4. Without them it ends in a disconnected status item with a stable code, and the session continues.
3. Omp's own tools do not run in the sandbox. With the extension loaded, the tool list that Omp offered the model was `read, bash, edit, ask, eval, glob, grep, task, wait, todo, web_search, write`: no Realm tool, and `bash` and `eval` are Omp's host tools. The extension only gates `write` and `edit` on the realm's state. VERIFIED_BY_EXECUTION (L2); `src/omp/plugin.ts:123` and no `registerTool` call in `src` (VERIFIED_BY_CODE_READING).
4. One workspace per daemon. The session directory must be the exact configured workspace root; any other directory, including a subdirectory of it, is refused with `POLICY_DENIED`. VERIFIED_BY_CODE_READING (section 6).

## 3. Trigger table

| Event | Handler | Reaches a sandbox primitive | Evidence |
|---|---|---|---|
| Omp session start | `pi.on("session_start")` runs a detached `attach` and returns at once | Yes: `attachDaemon` spawns the daemon when none answers, then `up(cwd)` creates the container | `src/omp/plugin.ts:318-338`, `:214-266`; `src/omp/extension.ts:23-41`; `src/daemon/ensure.ts:41-55`; `src/daemon/daemon.ts:381-402`. VERIFIED_BY_CODE_READING; VERIFIED_BY_EXECUTION (L1) |
| first tool use | none. The `tool_call` guard only reads status and never creates anything | No | `src/omp/plugin.ts:371-394` |
| Omp `/realm-retry` | re-runs the same attach | Yes | `src/omp/plugin.ts:303-316`, `:346-349`; VERIFIED_BY_EXECUTION (L1, about 19 s) |
| resume or switch of an Omp session | a second `session_start` first ends the previous session object, then attaches again | Yes, and reuses the running sandbox | `src/omp/plugin.ts:318-320` |
| Omp session end | `pi.on("session_shutdown")` closes the client and clears timers; it never sends `down` | No teardown | `src/omp/plugin.ts:187-210`, `:340-342`; VERIFIED_BY_EXECUTION (L7) |

The attach is not blocking: the handler returns while `attach` runs, with a 200 s budget (`STARTUP_BUDGET_MS`, `src/omp/plugin.ts:106`) and a 2 s status poll (`:114`). Whether Omp's own startup stays responsive under that attach is UI-01, still an accepted limitation (`docs/integration/omp.md:164-166`).

## 4. What must exist for the attach to succeed, and what the user sees otherwise

| Missing | Status item after `connecting` | Evidence |
|---|---|---|
| `config.json` unreadable or invalid (image digest, `stateDir`, `workspaceRoot`) | the extension throws at load and no status item appears | `src/omp/extension.ts:17-26`. The Omp-side display of that throw is UNVERIFIED (would be verified by loading with a broken config) |
| `policy.json` absent, or the workspace outside its roots | `○ realm disconnected · POLICY_DENIED` | `docs/integration/omp.md:145`. VERIFIED_BY_EXECUTION on 2026-10-23 (recorded there) |
| Podman 5.x missing or its rootless service down | `PODMAN_MISSING`, `PODMAN_UNSUPPORTED_VERSION` or `PODMAN_MACHINE_DOWN` | `src/daemon/daemon.ts:381-402` (probe before create); `docs/integration/omp.md:146-148` |
| `REALM_DRIVER_STATE_ROOT`, `REALM_DRIVER_SECRET_ROOT` or `REALM_DRIVER_WORKSPACE_ROOT` unset in the daemon's environment | `SCHEMA_INVALID` (generic; tech debt TD-03) | `src/daemon/main.ts:50-56`; `src/runtime/session-execution.ts:425-447` |
| OpenShell 0.1.5 gateway, compute driver or image absent | `OPENSHELL_START_FAILED` or `AGENTOS_CRASH_LOOP` | `src/runtime/session-execution.ts:260`, `:480`. The exact paths are UNVERIFIED |
| attach exceeds 200 s | `STARTUP_BUDGET_EXCEEDED` | `src/omp/plugin.ts:227-236` |

Every item above except the first is a refusal with a code, so none continues into an unsandboxed run of the sandbox itself. The Omp session, however, continues (section 7).

Install: the manifest key is `omp.extensions` (`package.json:30-34`). The proven load is `omp -e <path to dist/src/omp/extension.js>` (`docs/hosts/snippets/omp.md:17-28`). The persistent `omp plugin install --scope=user` is documented as unverified (`docs/hosts/snippets/omp.md:38-47`), and `README.md` carries no install commands. VERIFIED_BY_CODE_READING.

## 5. Creation facts

| Item | Fact | Evidence |
|---|---|---|
| Location | container in the realm account's rootless Podman store; daemon state under the configured `stateDir`, which must be mode 0700 | `docs/integration/omp.md:173`; VERIFIED_BY_EXECUTION (L1: container `realm-daemon`) |
| Name and id | `realm-<sessionId>` with the session id `daemon` | `src/runtime/session-execution.ts:211` (name helper), `src/daemon/main.ts:21`; VERIFIED_BY_EXECUTION (L1) |
| Image | digest-pinned in `config.json`; refused otherwise | `src/runtime/config.ts:19`. VERIFIED_BY_CODE_READING |
| Isolation | read-only root, tmpfs `/tmp` and `/run` (noexec, nosuid, nodev), `/workspace` read-write bind, `/realm-state` read-only, non-root workload uid, seccomp and Landlock, pids 512, 1 GiB memory | `src/runtime/hardening.ts:47-79`; live scenario 1 (`test/integration/production-driver.test.ts:241`) |
| Create bound | 60 s for the OpenShell create; 180 s for the AgentOS runner start | `src/runtime/session-execution.ts:56`; `src/daemon/main.ts:58` |
| Cold attach time | about 57 s from Omp's ready frame to `● realm active · container running` at a host load average of about 68 on 8 CPUs (about 24 s at a load of 30 on 2026-10-28) | VERIFIED_BY_EXECUTION (L1); `docs/integration/omp.md:166` |

## 6. Reuse, resume, concurrency

- `up` is idempotent. A second Omp session in the same workspace attaches to the same container (VERIFIED_BY_EXECUTION, L7).
- One container per daemon and one daemon per state directory: a second daemon on the same socket exits with `LOCK_CONFLICT` (`src/daemon/daemon.ts:216-221`).
- The workspace rule: `verifyPinnedAt` accepts only the pinned directory itself (same device and inode, same real path) (`src/fs/root.ts:63-80`), and the session create refuses with `POLICY_DENIED` unless the session workspace and the pinned root are one directory (`src/runtime/session-execution.ts:204`, `:486-497`). The daemon's own session is single (`src/daemon/main.ts:21`) and the compute driver's workspace id "selects no directory" (`src/runtime/driver/compute-driver.ts:122-124`, `:1130`). VERIFIED_BY_CODE_READING. The status text shown for an Omp session opened in another directory is UNVERIFIED; it would be verified by starting the driver of `LIVE-VERIFICATION.md` with another working directory.

## 7. Failure behaviour: where continuing unsandboxed is possible

The sandbox creation itself fails closed: Podman or driver failures end the attach with a code and create no container (`src/runtime/session-execution.ts:414-421`, `AGENTOS_NOT_CONFIGURED` when no driver is bound). What happens to the Omp session afterwards is set by the policy mode:

| Mode | Omp `write` or `edit` while the realm is not active | Evidence |
|---|---|---|
| advisory (the default) | allowed, with a notice | `src/omp/plugin.ts:433`, `:447-449`; VERIFIED_BY_EXECUTION (L3): after `realm down` the notice was `realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy` and the file was written |
| fail-closed (opt-in through `policy.json` `mode`) | blocked with `REALM_NOT_ACTIVE`, `REALM_UNBOUND` or `REALM_STOPPING` (or the read-failure code) | `src/omp/plugin.ts:436`, `:451`, `:454-465`; VERIFIED_BY_EXECUTION (L4): the tool result was `REALM_NOT_ACTIVE` with `isError` true and the file was absent |

Under fail-closed, a call made before the first attach finishes (state `connecting`) is blocked too (`:460-463`). Other Omp tools are never inspected (`GUARDED_HOST_TOOLS`, `src/omp/plugin.ts:123`).

## 8. Teardown and states

- States: `unbound`, `connecting`, `active`, `degraded`, `error`, `stopping` (the cases of `denyCodeFor`, `src/omp/plugin.ts:454-465`; `src/core/states.ts`). An orphaned sandbox has no state name: it is a container left after a daemon crash, removed by the next daemon start (`src/session/reap.ts:33-39`; VERIFIED_BY_EXECUTION, L5).
- The sandbox is kept after an Omp quit (VERIFIED_BY_EXECUTION, L7), after a closed terminal or SIGKILL of Omp (L7), and removed by `realm down` (L3) or a daemon SIGTERM (L5). No idle shutdown exists (`git grep` of `src/daemon` for idle finds none).

## 9. Host guarantees the plugin relies on (Omp, outside this repository)

| Guarantee | Documented | Evidence |
|---|---|---|
| `session_start` and `session_shutdown` handlers run, with `(event, ctx)` and the session `cwd` | yes | `docs/integration/omp.md:54-62`; observed (L1) |
| managed timers (`ctx.setInterval`, `ctx.clearTimer`) and `ctx.ui.setStatus` / `notify` | yes (setStatus signature upstream-sourced, OQ-P5-01) | `docs/integration/omp.md:64-72`; observed (L1) |
| a `tool_call` return of `{ block, reason }` stops the call, and the handler's error or timeout blocks | yes | `docs/integration/omp.md:90-94`; observed (L4) |
| `tool_call` covers every path that mutates a file | no: calls through the eval-prelude bridge do not emit it | `docs/integration/omp.md:94`, `:209` (OQ-P5-02) |

## 10. Security findings

| Severity | Finding | Evidence |
|---|---|---|
| High | **The sandbox is not used by Omp.** The product claim "runs an agent's execution and file mutations inside a locked-down sandbox" holds for MCP and ACP hosts, which call Realm's tools, not for Omp, whose tools run on the host. | `README.md:13`; section 2, item 3; VERIFIED_BY_EXECUTION (L2) |
| High (documented, by design) | **Advisory mode fails open.** While the realm is disconnected, Omp's `write` and `edit` proceed. Containment needs the opt-in fail-closed mode. | `README.md:15`; VERIFIED_BY_EXECUTION (L3) |
| Medium | **The daemon inherits the whole environment of the process that starts it.** `startDetachedDaemon` passes no `env` option, so Node's default applies; every variable in the Omp environment, provider keys included, is in the long-lived daemon's environment. The daemon passes only `PATH`, `HOME` and `XDG_RUNTIME_DIR` to the OpenShell CLI (`src/runtime/session-execution.ts:72`). | `src/cli/main.ts:340-345`. VERIFIED_BY_CODE_READING; see L8 for the execution check |
| Low | **No leveled lifecycle log.** The daemon log carries start-failure codes only (`realm daemon: <CODE>`); there is no record of create, attach or teardown transitions. | `docs/integration/omp.md:139` |
| none found | Session identifiers and paths are validated: the session id set is restricted (`src/session/paths.ts:22`), workspace paths are canonicalized and pinned, the state directory must be 0700. | `src/session/paths.ts`; `src/fs/root.ts`; `docs/integration/omp.md:173` |

## 11. README claims that the code or the live runs did not support, and what this task changed

| Claim | Where | Finding and action |
|---|---|---|
| "runs an agent's execution and file mutations inside a locked-down sandbox" | `README.md:13` | holds for MCP and ACP hosts; for Omp only the write and edit gate exists (section 2). The sentence is unchanged; the Omp line of the Hosts list (`README.md:38`) now says what the extension does and does not do |
| the Omp guard when disconnected "is not verified live" | `README.md:22` before this task | observed with a scripted provider (L3, L4); the sentence now says so and keeps the model-driven run outstanding. The status of OMP-05 stays the owner's decision |
| the extension "loaded from `dist/src/omp/extension.js`" | `README.md:38` before this task | only the `-e` load is proven and the persistent install is unverified (`docs/hosts/snippets/omp.md:38-47`); the line now also states the session-directory rule and that Omp's own tools run on the host |
