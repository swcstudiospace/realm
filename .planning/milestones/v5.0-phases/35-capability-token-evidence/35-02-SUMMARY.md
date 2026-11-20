---
phase: 35-capability-token-evidence
plan: "02"
subsystem: capability-token-memory-probe
tags: [capability-token, memory-probe, proc-pid-mem, yama, non-descendant, verdict-rule]
requires: ["35-01"]
provides:
  - "test/support/memory-probe.ts and memory-probe-run.ts: a non-root probe that reads status, environ and maps of a target, opens /proc/PID/mem read-only and scans every readable private writable region in 1 MiB chunks with a 1280-byte overlap for the token prefix and for the token and key it was given (Latin-1 and UTF-16LE); it never writes to the target and reports digests and counts, never the secret"
  - "the detached starter (the probe is reparented, so it is no descendant of the holder), the descendant control (arm D) and the frozen verdict rule verdictOf (settled, refuted, inconclusive), fixed before any run"
  - "test/daemon/capability-memory-probe.test.ts: the arm test against a real client with a real token from a real daemon in enforce mode; the informational probe test of the earlier capability work is removed"
  - "EVID-02 recorded, verdict settled: arm N (non-root, same uid, not a descendant) was denied at the open of /proc/PID/mem (EACCES) with 0 token hits and 0 key hits; arm D found the synthetic needle and arm R (root) found the real token and key, so both controls found"
affects: [test/support, test/daemon, docs/integration/capability-token-evidence.md, docs/integration/mcp.md]
key-files:
  created:
    - test/support/memory-probe.ts
    - test/support/memory-probe-run.ts
    - test/support/memory-probe.test.ts
    - test/daemon/capability-memory-probe.test.ts
  modified:
    - docs/integration/capability-token-evidence.md
    - test/docs/capability-token-evidence.test.ts
decisions:
  - "The result is read only with its controls: a refusal means nothing when the scanner could not find a token it was allowed to read; the rule counts N denied at the open, or N read in full with zero hits, as settled only when D and R both found"
  - "The overlap is 1280 bytes, not the 512 of the first design, so a 600-character candidate in UTF-16LE and the longest needle both lie inside one chunk"
  - "The environment read is recorded separately and never changes the verdict; the token is never put in the environment"
  - "The result is for one kernel, one ptrace_scope value and one Node version; any other is an Inference"
  - "The self-check of the probe tests was flaky and was made deterministic in PR 176 by using an off-heap buffer needle (run history below)"
requirements: [EVID-02, EVID-01]
metrics:
  tasks: 3
  completed: 2026-11-18
status: merged
---

# 35-02 summary: the memory probe

## What shipped

The probe, its entry, the detached starter, the descendant control and the frozen rule (see `provides`), with the arm test as a regular-user test. PR 175 recorded the live results on the page.

## Observed (2026-11-18, Linux 6.8.0-149-generic, Yama ptrace_scope 1, Node v24.18.0, commit 7c44538, probe as uid 5002)

| Arm | Result |
| --- | --- |
| N, the subject | mem open denied EACCES; 153 regions listed, 0 read; token hits 0, key hits 0 |
| D, the descendant control | mem open ok; the synthetic needle found 4 times in Latin-1; 53 regions read, 53188352 bytes |
| R, the root control | mem open ok; the real token found 16 times in Latin-1, key bytes 3 times raw, key text 14 times in Latin-1; 154 regions listed |
| Key file | readable by the same uid |
| Holder environment | readable by the same uid; no token in it, 0 token shapes |
| Coreutils cross-check | `head -c 64` on the memory file of a same-uid non-descendant holder: Permission denied; the environment file was readable |

Verdict by the frozen rule: settled for that kernel, that `ptrace_scope` and that Node version. Evidence is kept outside the repository.

## Run history

- EVID-01's two final runs of Set A (494 tests each) include the probe test file; the probe tests ran and were not skipped.
- The self-check of the probe tests was flaky. PR 176 (04ca807) made it deterministic with an off-heap buffer needle, changing `test/support/memory-probe.test.ts` and `test/daemon/capability-memory-probe.test.ts` only; no probe logic changed. The cause of the earlier flakiness is not recorded here.

## Not verified here

- Other kernels, other `ptrace_scope` values (0, 2, 3), other Node versions, containers.
- `process_vm_readv` and `ptrace` attach: not exercised; the probe covers `/proc/PID/mem` and `/proc/PID/environ` (Inference that the access check is the same).
- A descendant of the holder, and root, are not stopped; the controls only show that the scanner finds the token when the kernel allows the read.
- A same-uid reader of the key file or of the attach step is not stopped, whatever the memory result is.

## Deviations from plan

- The overlap was widened from 512 to 1280 bytes (see `decisions`), which only widens coverage of the frozen design.
