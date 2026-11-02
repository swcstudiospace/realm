# HARN-03 warm-proof probe (Lane C), Omp 18.15.0

Result: **BLOCKED** at step 3 of the lane brief. The shell guard refused to run the omp binary, so the warm measurement did not execute. No PASS or FAIL is claimed. Phase 12 deferral is unchanged (owner decision 2026-11-01); this file records evidence only.

## Scope

- Lane branch `gsd/v3-lane-c`, cut from `gsd/v3-autonomous` at a47016f.
- Evidence only. No ROADMAP or STATE change, no live window, no provider key, no push, no merge.

## Omp version

| Source | Observed value | How observed |
| --- | --- | --- |
| omp binary on PATH (`$HOME/.local/share/reflex/bun/bin/omp`, a compiled Bun binary, mtime 2026-11-02 10:59 UTC) | `18.15.0` | Read-only byte search of the binary for the version string (`grep -a -o '18\.1[45]\.[0-9]*'`): the only version string found is `18.15.0` (3 occurrences). |
| Global package manifest under `$HOME/.local/share/reflex/bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/package.json` | `18.14.2` | Read of `package.json`. This copy is the previous install. It is not what the PATH binary runs. |

The version that the probe targets is **18.15.0**, the binary on PATH. The 18.14.2 manifest is a stale install, not the executed binary. This discrepancy is recorded, not resolved.

## Procedure used

The warm-proof procedure is the one authored in the repository, not a new one:

- `docs/integration/omp.md`, "HARN-03 network finding" and the run record: the harness is `test/integration/omp-spike.test.ts`, built with `tsc -p tsconfig.json`, and run as `REALM_LIVE_OMP=1 REALM_OMP_NET_TRACE=1 node --test --test-concurrency=1 dist/test/integration/omp-spike.test.js`. The warm measurement runs under `strace` (`traceArgv`, `test/support/net-trace.ts`). The warm trace must show zero external connections, zero DNS connections and zero offenders against the allowlist `defaultAllow(stubPort)` (stub port plus 11434, 8080 and 1234).
- `docs/integration/omp-lifecycle-runbook.md`, built-Realm warm proof: the same isolated profile for a separately labelled cold warm-up and a measured warm run, evidence names `built-realm-cold.*` and `built-realm-warm.*`, and the requirement that the completed measured warm subtest is present.
- Omp is driven with `--model stub/scripted` against the local scripted stub. No provider key is used, so this is not the owner-gated first live LLM-driven run.

## Commands and exit codes

| # | Command | Exit | Observed output |
| --- | --- | --- | --- |
| 1 | `which omp` | 0 | `$HOME/.local/share/reflex/bun/bin/omp` |
| 2 | `omp --version` (the shell guard's refusal) | not captured (the tool returned an error result) | `BLOCKED needs: human-approval (mcp: nested-agent)` |
| 3 | Read-only checks: `readlink -f`, `ls`, `grep -a` on the binary, `cat package.json` | 0 | The version evidence above. These do not execute omp. |
| 4 | `df -BG /` | 0 | `/dev/sda1 387G 377G 11G 98% /`. 11 GiB free, above the 8 GiB floor. |
| 5 | `ls node_modules` in the lane worktree | non-zero | `node_modules absent`. A fresh worktree has no dependencies. |

Command 2 is the exact guard message. Per the lane brief, the guard was not bypassed. I did not run the omp binary by any other route, and I did not run `node --test` on `omp-spike.test.js`. That test spawns omp itself, so running it would route omp execution through the same guarded path.

## Observation

- The probe cannot produce a warm-run result in this session. The omp binary cannot be executed from this shell (guard refusal above).
- The lane worktree also has no `node_modules`. The warm test needs `npm ci` and `tsc -p tsconfig.json` first. That step is heavy and needs a heavy slot lock (`flock -w 3600`). It was not run, because the omp step was already blocked and the brief stops the probe there.
- Compared with the 18.14.2 failure: **UNVERIFIED**. This probe measured nothing, so it neither matches nor differs from the 2026-10-31 result of 44 offenders (38 external and 6 DNS) on 18.14.2. That result stays historical evidence, and it is not re-observed here.

## Owner decision that would follow

1. Authorise a bounded warm-proof run on Omp 18.15.0. This needs either a shell that is permitted to execute omp, or an explicit owner exception to the nested-agent guard for this single scripted (non-LLM) run, plus heavy-slot time for `npm ci` and the build.
2. Or accept that HARN-03 stays unverified on 18.15.0 and leave Phase 12 deferred as recorded.

No option here changes the Phase 12 deferral or the Phase 16 dependency waiver. Neither is decided by this probe.
