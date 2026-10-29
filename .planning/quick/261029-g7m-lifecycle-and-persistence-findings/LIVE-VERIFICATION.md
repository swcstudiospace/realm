# Live verification record, 2026-10-29

Quick task 261029-g7m. Every block below is output copied from a run made for this task; nothing is retyped. Host paths are replaced by placeholders: `<workspace>` is the pinned workspace directory, `<demo>` the throwaway directory of the checks, `<install>` the installed package, `<realm-home>` the realm account's home, `<xdg-runtime>` its runtime directory, and `<sandbox-tmp>` the scratch directory inside the sandbox.

## Environment and method

| Item | Value |
|---|---|
| Installed build | 0.2.1 on the realm account (`<install>`); `git diff --stat v0.2.1 v0.2.2` shows no change under `src`, `test`, `scripts`, `.github` or `release` |
| Omp | 18.12.6, RPC UI mode over pipes (`--mode rpc-ui`), loading the built extension with `-e` and `--no-extensions` |
| Model | none. A scripted OpenAI-compatible server on loopback answers a prompt `WRITE <path> <content>` with one tool call to Omp's own `write` tool and the follow-up request with the text `done`. No credential and no token is involved, and nothing leaves the host. This is not an LLM-driven run |
| Stack | the production stack: OpenShell 0.1.5 gateway, the Realm compute driver, rootless Podman 5.7.1, the digest-pinned image `localhost/realm-agentos@sha256:9511929b0b1a23120c30c04d2383317c7b8108ec8ee915e9a1538920e1c9596b` |
| Host | 8 CPUs, load average between 46 and 73 during the runs, caused mostly by other work on the machine. Timings below are therefore slower than on a quiet host |
| Isolation | a separate agent directory and `models.yml` for Omp, a separate Realm state directory and `config.json`, `policy.json` in a throwaway directory; `HOME` stays the real home because the OpenShell CLI child reads its gateway registration from it (`src/runtime/session-execution.ts:72`) |
| Safety | the checks signal only processes they started themselves, and every run ends with `realm down`, an empty workspace and no container; the final lines of each block show that |
| Scripts | the driver and probe scripts are not in the repository. Their behaviour is stated per section, and `docs/integration/omp-lifecycle-runbook.md` gives the steps. Proposal 6 in `IMPROVEMENT-PROPOSALS.md` would turn them into a gated test |

## L1. An Omp session start attaches and creates the sandbox

The extension was loaded into a fresh Omp process whose working directory was the pinned workspace. No command was typed. The status item moved from `connecting` to `● realm active · container running` about 57 s after Omp's ready frame, and the sandbox container `realm-daemon` was running (listed through the Podman API socket). `realm status` reported mode `advisory`.

```text
[+0.0s] load average 67.77 71.07 73.18 101/3497 3721558
[+1.0s] workspace before: [] containers before: []
[+1.9s] A. waiting for the plugin to attach on session start
[+60.5s] STATUS  ○ realm disconnected · connecting · 2026-10-29T11:31:32.528Z
[+60.5s] ready frame seen: true
[+116.9s] STATUS  ● realm active · container running · 2026-10-29T11:32:29.234Z
[+117.2s] A. attached and active: true | status: ● realm active · container running · 2026-10-29T11:32:29.234Z
[+117.2s] A. containers: [{"name":"realm-daemon","state":"running","id":"e5f8e12b8def"}]
[+120.6s] A. realm status: {"code":0,"out":"{\"snapshot\":{\"state\":\"active\",\"reason\":\"container running\",\"lastTransitionAt\":\"2026-10-29T11:32:29.234Z\"},\"display\":{\"label\":\"realm active\",\"degraded\":false,\"reaso ...
[+120.6s] B. Omp's own write while the realm is active
[+120.6s] PROMPT p1 "WRITE guard-active.txt written-while-active"
```

## L2. The tool list that Omp offered the model contains no Realm tool

The first request that Omp sent to the scripted provider, as logged by the provider:

```text
tools offered to the model: read, bash, edit, ask, eval, glob, grep, task, wait, todo, web_search, write
write tool parameters: {"type":"object","properties":{"i":{"type":"string","description":"concise intent"},"path":{"type":"string"},"content":{"type":"string"}},"required":["path","i"],"additionalProperties":false}
```

With the extension loaded, `bash`, `eval`, `read`, `edit`, `write` and the others are Omp's own host tools. `exec`, `read`, `write`, `list` and `status` of Realm are not registered (no `registerTool` call exists in `src/omp`).

## L3. Advisory mode: Omp's own write while the realm is disconnected

After `realm down`: the status item read `○ realm disconnected · REALM_NOT_ACTIVE`, no container existed, and a prompt asking for a write produced the advisory notice and a successful write (the file was present on the host).

```text
[+125.7s] C. realm down, then a write in advisory mode
[+149.1s] C. realm down: {"code":0,"out":"{\"snapshot\":{\"state\":\"unbound\",\"reason\":\"no workspace\",\"lastTransitionAt\":\"2026-10-29T11:33:00.942Z\"},\"display\":{\"label\":\"realm disconnected\",\"degraded\":false,\"reason\":\"no workspace\",\"lastTransitionAt\":\"2026-10-29T11:33:00.942Z\" ...
[+149.5s] C. status: ○ realm disconnected · REALM_NOT_ACTIVE · 2026-10-29T11:32:42.827Z | containers: []
[+149.5s] PROMPT p2 "WRITE guard-advisory.txt written-while-disconnected-advisory"
[+150.0s] NOTIFY  realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy
[+151.8s] TOOL_EXECUTION_START {"toolName":"write","args":{"path":"guard-advisory.txt","content":"written-while-disconnected-advisory"}}
[+151.8s] TOOL_EXECUTION_END {"toolName":"write","isError":false,"result":{"content":[{"type":"text","text":"[guard-advisory.txt#54E2]\nSuccessfully wrote 35 bytes to guard-advisory.txt"}],"details":{"resolvedPath":"<workspace>/guard-advisory.txt"}}}
[+151.8s] C. file on host: "written-while-disconnected-advisory"
```

## L4. Fail-closed mode: allowed while active, blocked while disconnected

`policy.json` was changed to `mode: fail-closed` and `/realm-retry` was sent. The session reattached (about 19 s). A write while active succeeded. After `realm down`, the write was blocked: the tool result was `REALM_NOT_ACTIVE` with `isError` true, and the file did not exist.

```text
[+150.0s] NOTIFY  realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy
[+151.8s] D. policy mode fail-closed, retry, write while active, realm down, write while disconnected
[+151.8s] PROMPT p3 "/realm-retry"
[+172.8s] D. reattached under fail-closed: true | status: ● realm active · container running · 2026-10-29T11:33:23.615Z
[+172.8s] PROMPT p4 "WRITE guard-failclosed-active.txt written-while-active-failclosed"
[+175.4s] TOOL_EXECUTION_END {"toolName":"write","isError":false,"result":{"content":[{"type":"text","text":"[guard-failclosed-active.txt#0D5E]\nSuccessfully wrote 31 bytes to guard-failclosed-active.txt"}],"details":{"resolvedPath":"<workspace>/guard-failclosed-active.txt"}}}
[+175.4s] D. file on host (active, fail-closed): "written-while-active-failclosed"
[+182.7s] D. realm down: {"code":0,"out":"{\"snapshot\":{\"state\":\"unbound\",\"reason\":\"no workspace\",\"lastTransitionAt\":\"2026-10-29T11:33:35.023Z\"},\"display\":{\"label\":\"realm disconnected\",\"degraded\":false,\"reason\":\"no workspace\",\"lastTransitionAt\":\"2026-10-29T11:33:35.023Z\"},\"mode\":\"fail-closed\"}"}
[+183.0s] D. status: ○ realm disconnected · REALM_NOT_ACTIVE · 2026-10-29T11:33:30.533Z
[+183.0s] PROMPT p5 "WRITE guard-blocked.txt must-not-exist"
[+185.4s] TOOL_EXECUTION_END {"toolName":"write","isError":true,"result":{"content":[{"type":"text","text":"REALM_NOT_ACTIVE"}],"details":{}}}
[+185.4s] D. file on host (disconnected, fail-closed): null (null = absent = blocked)
```

The raw blocked frame, as Omp emitted it:

```text
{"type":"tool_execution_end","toolCallId":"call_zbupea","toolName":"write","result":{"content":[{"type":"text","text":"REALM_NOT_ACTIVE"}],"details":{}},"isError":true,"_t":183581}
```

Together L3 and L4 are the behaviour that OMP-05 describes, observed in a real Omp host through the real `tool_call` hook. The model was a script, so this is not an LLM-driven run, and the status of OMP-05 remains the owner's decision.

## L5. Daemon SIGKILL, restart and SIGTERM (persistence probe)

Through `realm mcp` (the Realm tools), the probe wrote a file with Realm's atomic `write`, then ran `exec` inside the sandbox to write one file to `/workspace` and one to the sandbox scratch directory. It then SIGKILLed only the daemon it had started, inspected, restarted with `realm up`, and finally sent SIGTERM to the new daemon.

```text
[+0.1s] load average 60.72 66.39 70.73 76/3412 3734391
[+0.5s] before: workspace {} containers []
[+33.9s] 1. realm up {"code":0,"out":"{\"snapshot\":{\"state\":\"active\",\"reason\":\"container running\",\"lastTransitionAt\":\"2026-10-29T11:34:58.930Z\"},\"display\":{\"label\":\"realm active\",\"degraded\":false,\"reason\":\"container running\",\"lastTransitionAt\":\"2026-10-29T11:34:58.930Z\"},\"mode\":\"advisory\"}"}
[+34.0s] 1. containers: [{"name":"realm-daemon","state":"running","id":"75909636125a"}]
[+34.9s] 1. daemon pid: 3734565
[+39.6s] 2. mcp initialize: {"name":"agent-realm","version":"0.2.1"}
[+40.9s] 2a. write (Realm atomic path): {"outcome":"done","tool":"write","value":{"sha256":"e0e6b78c0b4f9c8110c6753e13e9144180e25d9150b96faf7f37499f92def484","bytes":21,"warning":null}}
[+47.6s] 2b. exec writes /workspace and <sandbox-tmp> inside the sandbox: {"outcome":"done","tool":"exec","value":{"exitCode":0,"stdout":"","stderr":"","truncated":false}}
[+48.7s] 2c. exec reads <sandbox-tmp> marker inside the sandbox: {"outcome":"done","tool":"exec","value":{"exitCode":0,"stdout":"tmp-f28c7af0","stderr":"","truncated":false}}
[+48.7s] 2. workspace on host: {"persist-exec-workspace.txt":"d67b1628880ac72e 11B","persist-realm-atomic.txt":"e0e6b78c0b4f9c81 21B"}
[+48.7s] 3. SIGKILL daemon 3734565
[+56.0s] 3. daemon alive after SIGKILL: false | realm status: {"code":0,"out":"disconnected\nrealm status: daemon absent (REALM_NOT_ACTIVE); local report"}
[+56.4s] 3. containers after SIGKILL (orphan expected): [{"name":"realm-daemon","state":"running","id":"75909636125a"}]
[+58.3s] 3. orphan still holds <sandbox-tmp> marker: {"code":0,"out":"tmp-f28c7af0"}
[+58.3s] 3. workspace after SIGKILL identical to before: true {"persist-exec-workspace.txt":"d67b1628880ac72e 11B","persist-realm-atomic.txt":"e0e6b78c0b4f9c81 21B"}
[+89.7s] 4. realm up (restart) {"code":0,"out":"{\"snapshot\":{\"state\":\"active\",\"reason\":\"container running\",\"lastTransitionAt\":\"2026-10-29T11:35:54.443Z\"},\"display\":{\"label\":\"realm active\",\"degraded\":false,\"reason\":\"container running\",\"lastTransitionAt\":\"2026-10-29T11:35:54.443Z\"},\"mode\":\"advisory\"}"}
[+90.2s] 4. containers after restart: [{"name":"realm-daemon","state":"running","id":"3901d238c384"}] | same container id as before the kill: false
[+95.3s] 4. /workspace marker readable in the new sandbox: {"outcome":"done","tool":"exec","value":{"exitCode":0,"stdout":"ws-f28c7af0","stderr":"","truncated":false}}
[+96.1s] 4. <sandbox-tmp> marker in the new sandbox: {"outcome":"done","tool":"exec","value":{"exitCode":1,"stdout":"","stderr":"cat: <sandbox-tmp>/persist-exec-tmp.txt: No such file or directory\n","truncated":false}}
[+96.5s] 4. Realm-written file read back: {"outcome":"done","tool":"read","value":{"status":"found","content":{"type":"Buffer","data":[114,101,97,108,109,45,97,116,111,109,105,99,45,102,50,56,99,55,97,102,48]},"sha256":"e0e6b78c0b4f9c8110c6753e13e9144180e25d9150b96faf7f37499f92def4
[+96.5s] 4. workspace after restart identical to before: true
[+96.9s] 5. SIGTERM daemon 3738907
[+122.0s] 5. daemon alive after SIGTERM: false | containers: [] | realm status: {"code":0,"out":"disconnected\nrealm status: daemon absent (REALM_NOT_ACTIVE); local report"}
[+122.3s] 5. workspace after SIGTERM identical to before: true
[+122.3s] cleanup
[+125.2s] realm down: {"code":0,"out":"disconnected\nalready down"}
[+125.4s] workspace after cleanup: [] | containers after cleanup: []
```

Reading: the two workspace files survived with identical hashes at every step. After SIGKILL the container was still running, still held the scratch-directory file, and `realm status` said the daemon was absent. The restart created one new container with a different id; the `/workspace` file was readable in it and the scratch file was gone. SIGTERM removed the container (about 25 s) and left the workspace identical.

## L6. The two write paths under process death

### L6a. Realm's atomic write, SIGKILL at each hookable stage

A child process called `atomicWriteFile` from the built `dist/src/fs/atomic-write.js` against a target holding `OLD-CONTENT` and SIGKILLed itself at each stage, in a throwaway directory. The four hookable stages are `after-temp-write`, `after-fsync`, `before-rename` and `after-recheck`; all of them fire before `renameSync`, and no hook exists after the rename. A later clean write to the same target followed.

```text
{"killedAt":"after-temp-write","childExit":"SIGKILL","target":"OLD-CONTENT","orphanTempFiles":1,"orphanContent":"NEW-CONTENT-after-temp-write","secondWrite":"completed -> target \"SECOND-WRITE\", orphans left 1"}
{"killedAt":"after-fsync","childExit":"SIGKILL","target":"OLD-CONTENT","orphanTempFiles":1,"orphanContent":"NEW-CONTENT-after-fsync","secondWrite":"completed -> target \"SECOND-WRITE\", orphans left 1"}
{"killedAt":"before-rename","childExit":"SIGKILL","target":"OLD-CONTENT","orphanTempFiles":1,"orphanContent":"NEW-CONTENT-before-rename","secondWrite":"completed -> target \"SECOND-WRITE\", orphans left 1"}
{"killedAt":"after-recheck","childExit":"SIGKILL","target":"OLD-CONTENT","orphanTempFiles":1,"orphanContent":"NEW-CONTENT-after-recheck","secondWrite":"completed -> target \"SECOND-WRITE\", orphans left 1"}
{"killedAt":"(no kill)","childExit":"exit 0 (completed)","target":"NEW-CONTENT-(no kill)","orphanTempFiles":0,"orphanContent":null}
```

Reading: at each of the four stages, all before the rename, the target kept its old content, never a torn mix. A complete temp file `.target.txt.realm-tmp-<16 hex>` holding the new content stayed in the directory, and a later clean write did not remove it. The control run without a kill left no temp file. A kill after the rename and before the call returns cannot be hooked and was not run; it leaves the complete new file and no temp file, because `rename(2)` is atomic (INFERENCE).

### L6b. Omp's own write, under strace

Omp (without the Realm extension) overwrote an existing file through the scripted provider, traced with `strace -f -P <target>`. The first trace shortened a 24-byte file to 23 bytes; the second grew a 3-byte file to 46 bytes.

```text
ready: true
write finished: true
file now: "NEW-CONTENT-LONGER-THAN-THE-OLD-ONE-1234567890" (46 bytes; old was 3)
syscalls on the target (in order, 12):
statx(AT_FDCWD, "<demo>/strace-ws2/grow-target.txt", AT_STATX_SYNC_AS_STAT, STATX_ALL, {stx_mask=STATX_ALL|STATX_MNT_ID, stx_attributes=0, stx_mode=S_IFREG|0644, stx_size=3, ...}) = 
openat(AT_FDCWD, "<demo>/strace-ws2/grow-target.txt", O_RDONLY|O_CLOEXEC) = 46
read(46, "OLD", 1024)           = 3
read(46, "", 1021)              = 0
close(46)                       = 0
newfstatat(AT_FDCWD, "<demo>/strace-ws2/grow-target.txt", {st_mode=S_IFREG|0644, st_size=3, ...}, 0) = 0
openat(AT_FDCWD, "<demo>/strace-ws2/grow-target.txt", O_WRONLY|O_CREAT|O_NONBLOCK|O_LARGEFILE, 0664) = 46
write(46, "NEW-CONTENT-LONGER-THAN-THE-OLD-"..., 46) = 46
ftruncate(46, 46)               = 0
close(46)                       = 0
readlink("<demo>/strace-ws2/grow-target.txt", 0x7fffddbdbad0, 1023) = -1 EINVAL (Invalid argument)
readlink("<demo>/strace-ws2/grow-target.txt", 0x7fffddbdb970, 1023) = -1 EINVAL (Invalid argument)
strace-order exit=0
```

In the first trace (a shortening overwrite) the same sequence appeared as `openat(O_WRONLY|O_CREAT|O_NONBLOCK) = 40`, then `ftruncate(40, 23)`; no rename of the target occurred and no `fsync` was issued on the target's descriptor (the `fsync` calls in that trace belong to Omp's own SQLite files on other descriptors).

Reading: Omp overwrites in place: open without truncation, one `write` of the whole content at offset 0, `ftruncate` to the new length, `close`. There is no temp file, no rename and no `fsync`. Two consequences follow from that order and are INFERENCE, not observed: a kill between the `write` and the `ftruncate` of a shortening overwrite leaves the new content followed by the old tail, and after a machine crash (not a process kill) the new content may not have reached the disk.

## L7. Abrupt end of an Omp session, and reuse by the next session

For SIGHUP (what a closed terminal sends) and then SIGKILL, the check wrote a file through Omp's own `write`, signalled the Omp process it had started, and inspected. A third session was started afterwards.

```text
[+1.3s] load average 72.88 62.85 65.05 64/3371 3765051 | containers before: [] | workspace before: []
[+1.5s] SIGHUP: session start, waiting for attach
[+50.6s] SIGHUP STATUS ○ realm disconnected · connecting · 2026-10-29T11:43:50.216Z
[+90.4s] SIGHUP STATUS ● realm active · container running · 2026-10-29T11:44:29.445Z
[+90.6s] SIGHUP: attached=true container=7798b87c1e3c 
[+94.3s] SIGHUP: Omp's own write finished; file on host: "written-before-SIGHUP"
[+94.7s] SIGHUP: sending SIGHUP to the Omp process this check started (pid 3765071); daemon pid before: 3767069
[+96.2s] SIGHUP: Omp ended: {"code":129,"signal":null}
[+99.4s] SIGHUP: daemon alive: true (pid 3767069) | same daemon: true
[+102.6s] SIGHUP: containers: [{"name":"realm-daemon","state":"running","id":"7798b87c1e3c"}] | realm status: {"snapshot":{"state":"active","reason":"container running","lastTransitionAt":"2026-10-29T11:44:29.445Z"},"display":{"label":"realm active","degraded":false,"reason":"container running","lastTransitio
[+102.6s] SIGHUP: file still on host: "written-before-SIGHUP"
[+102.7s] SIGKILL: session start, waiting for attach
[+157.9s] SIGKILL STATUS ○ realm disconnected · connecting · 2026-10-29T11:45:37.536Z
[+171.6s] SIGKILL STATUS ● realm active · container running · 2026-10-29T11:44:29.445Z
[+172.2s] SIGKILL: attached=true container=7798b87c1e3c | same container as the previous session: true
[+175.0s] SIGKILL: Omp's own write finished; file on host: "written-before-SIGKILL"
[+175.3s] SIGKILL: sending SIGKILL to the Omp process this check started (pid 3769485); daemon pid before: 3767069
[+176.6s] SIGKILL: Omp ended: {"code":null,"signal":"SIGKILL"}
[+179.7s] SIGKILL: daemon alive: true (pid 3767069) | same daemon: true
[+181.7s] SIGKILL: containers: [{"name":"realm-daemon","state":"running","id":"7798b87c1e3c"}] | realm status: {"snapshot":{"state":"active","reason":"container running","lastTransitionAt":"2026-10-29T11:44:29.445Z"},"display":{"label":"realm active","degraded":false,"reason":"container running","lastTransitio
[+181.7s] SIGKILL: file still on host: "written-before-SIGKILL"
[+232.0s] reuse STATUS ○ realm disconnected · connecting · 2026-10-29T11:46:51.629Z
[+240.9s] reuse STATUS ● realm active · container running · 2026-10-29T11:44:29.445Z
[+241.6s] reuse: attached=true container=7798b87c1e3c | same container as before the abrupt ends: true | containers: [{"name":"realm-daemon","state":"running","id":"7798b87c1e3c"}]
[+266.7s] cleanup: realm down: {"snapshot":{"state":"unbound","reason":"no workspace","lastTransitionAt":"2026-10-29T11:47:25.930Z"},"display":{"label":"realm disconnected","degraded":false,"reason":"no workspace","lastTransitionAt
[+267.1s] workspace after: [] | containers after: []
```

Reading: Omp ended with exit code 129 (SIGHUP) and by SIGKILL. In both cases the daemon kept its pid, the container kept its id, the status stayed active, and the file written through Omp was on the host. The next session attached to the same container (same id, same `lastTransitionAt`) about 9 s after Omp's ready frame, against 40 to 57 s for a cold attach.

## L8. The daemon inherits the environment of the process that starts it

Two fake sentinel variables were added to the Omp environment. After the attach, the names (not values) in the daemon's process environment were read.

```text
attached: ● realm active · container running · 2026-10-29T11:49:06.517
daemon pid: 3779892
variables in the daemon environment: 14
sentinel names present in the daemon environment: ["DEMO_SENTINEL_PROVIDER_KEY","DEMO_SENTINEL_TOKEN"]
every name that Omp's environment passed to the extension host is in the daemon: true
realm down exit: 0
env-passthrough exit=0
```

Reading: `startDetachedDaemon` (`src/cli/main.ts:340-345`) passes no `env` option, so the daemon holds every variable of the Omp process for its whole life.

## L9. Baseline of the repository gates, before any change

Run once at main 00e0003, in this order, with the tree clean before and after:

```text
typecheck exit=0 secs=255
lint exit=0 secs=791
test:scripts exit=0 secs=24
check:docs exit=0 secs=4
check:pack exit=0 secs=237
check:mcp exit=0 secs=14
test exit=0 secs=425

git status after: 0 entries
```

`npm test` reported 1872 tests, 1862 passed, 0 failed, 10 skipped (duration 168.7 s of test time). The numbers equal the final run of pull request 7. No source file was changed by this task, so the gates were not run a second time.

## Not tested, with the reason

| Scenario | Why not | Status |
|---|---|---|
| power loss, kernel panic | not safe to cause on a shared host | UNVERIFIED by construction; the write paths above say what was and was not synced |
| disk full | needs a full filesystem; not caused on a shared host | UNVERIFIED; the atomic path removes its temp file on failure (`src/fs/atomic-write.ts:204-205`, exception-injection tests only) |
| Omp SIGTERM or SIGINT | the daemon is detached into its own session (`src/cli/main.ts:342`), so signals sent to Omp do not reach it; SIGHUP and SIGKILL were run | UNVERIFIED for those two signals, expected the same as L7 |
| sandbox container death | covered by live scenario 8 of the production suite and the 2026-10-28 Omp run (`docs/integration/omp.md:160`) | not re-run today |
| a session opened in a directory other than the pinned root | not run | UNVERIFIED: the code refuses with `POLICY_DENIED`; the status text shown in Omp is not observed |
