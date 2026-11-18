# Capability token evidence

This page is the measured evidence for capability tokens: one section per requirement (EVID-01 the non-root run, EVID-02 the memory probe, EVID-03 the live enforce proof), and every cell is the result of a dated run or the word `not-run`. A cell that names no date and no version has no result behind it, and a skipped test is `not-run`, never a pass.

This page does not give a defence. A process of the same user that can read the key file or run the attach step is not stopped, whatever the memory result is. The page measures claims; it adds no protection.

## Status of each requirement

| Requirement | Status | Tier | Date | Version and run | Section |
| --- | --- | --- | --- | --- | --- |
| EVID-01 | not-run | - | - | - | EVID-01: the non-root run |
| EVID-02 | not-run | - | - | - | EVID-02: the memory probe |
| EVID-03 | not-run | - | - | - | EVID-03: the live enforce proof |

The vocabulary of the Status cell is exactly four words. `not-run`: no dated run produced a result. `recorded`: a dated run produced the result the requirement asks for. `partial`: a dated run produced part of it, and the row names which part. `failed`: a dated run failed, and the row names the first failing assertion or the catalogue code.

## Machine and run facts

Each value is read in a window and never assumed. The label is `Observed` only for a value a person read in a window, with its date; `From code` and `Inference` are used as in the Phase 32 documents.

| Fact | Value | Evidence label | Date |
| --- | --- | --- | --- |
| Kernel release | not-run | - | - |
| Yama ptrace_scope as read | not-run | - | - |
| Security modules listed | not-run | - | - |
| Node version | not-run | - | - |
| Account uid and gid | not-run | - | - |
| Harness account | not-run | - | - |
| Podman version | not-run | - | - |

## EVID-01: the non-root run

The capability test set (Set A) run twice, and the whole unit suite (Set B) run once, as a regular user (the realmlive account, not root) from a copy of the built tree owned by that account, on a host where Yama `ptrace_scope` was read as 1 in the same window, with a scrubbed environment and no live gate variable. The first run is made before the probe test moves into its own file; the final run is made with the final file list.

| Run | Test set | Commit | Node | Account | ptrace_scope | Tests | Pass | Fail | Skipped | Status | Date |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| first run (plan 35-01 window) | Set A | - | - | - | - | - | - | - | - | not-run | - |
| final run (plan 35-02 window) | Set A | - | - | - | - | - | - | - | - | not-run | - |

Set A file list: not-run (recorded here with the first run). Set B result: not-run. Skip reasons: not-run.

## EVID-02: the memory probe

The question: can a process that is the same user as the token holder, is not root and is not an ancestor of the holder read the capability token or the signing key out of the holder's memory, and what does it learn from the holder's environment? The probe reads `/proc/PID/status`, `/proc/PID/environ` and `/proc/PID/maps`, opens `/proc/PID/mem` read-only and scans every readable private writable region in chunks of 1 MiB with an overlap of 1280 bytes, with no cap on the number or the size of regions and a bound only on the total (2 GiB read and 60 seconds, with a truncated flag when a bound is hit). It searches for the token prefix and for the token and the key it was given, in Latin-1 and in UTF-16LE. It never writes to the target, never attaches with `ptrace` and never signals, and its report holds counts, error names, 8-character digest prefixes and decoded public claims, and never a token, a key or a needle (From code).

The result is read only with its controls, because a refusal means nothing when the scanner could not find a token it was allowed to read. Arm N, the subject, is a non-root probe of the same user, started detached so that it is reparented and is not an ancestor of the holder, aimed at a real client that holds a real token from a real daemon in enforce mode, with the real signing key in the same process. Arm D, the descendant control, is a probe that starts a synthetic holder itself, so the kernel's descendant rule allows the read: it shows that the scanner finds a token in a Node heap when the read is allowed. Arm R, the root control, is the same probe as arm N run as root against the same kind of holder: it shows that the scanner finds the real token and key when no kernel rule applies. Arms N and D run when the test file runs as a regular user and arm R when it runs as root; the file chooses by user, so no gate variable exists (From code).

What the kernel is expected to do (Inference from the kernel's Yama documentation, until a window measures it): opening `/proc/PID/mem` needs the ptrace attach check, which at `ptrace_scope` 1 admits only an ancestor of the target, a process with `CAP_SYS_PTRACE` or a target that allowed it; reading `/proc/PID/environ` needs the weaker read check, which Yama does not restrict. The probe measures both and does not rely on this reading.

The decision rule, fixed before any run (From code: `verdictOf` in the probe support module). With controls D and R both found and the coverage in N complete: N denied at the open of the memory file, or N read every region with zero hits, makes the claim settled for the recorded kernel and `ptrace_scope`; N found makes it refuted for that configuration; a control not found, or coverage incomplete without a recorded cause, makes it inconclusive, and the claim stays an Inference. The environment read is recorded separately and never changes this rule. The result is about one kernel, one `ptrace_scope` value and one Node version, the ones read in the window (Inference for any other).

| Arm | Probe | Target | Result | Coverage | Status | Date |
| --- | --- | --- | --- | --- | --- | --- |
| N (subject) | not-run | the token holder, a real client with a real token | not-run | - | not-run | - |
| D (descendant control) | not-run | a synthetic holder started by the probe | not-run | - | not-run | - |
| R (root control) | not-run | the same target as N | not-run | - | not-run | - |
| Keyring file readability | not-run | the keyring file of the same user | not-run | - | not-run | - |
| Holder environment | not-run | the environment block of the same target | not-run | - | not-run | - |
| Cross-check with coreutils | not-run | a synthetic holder read with head, no probe code | not-run | - | not-run | - |

Verdict: not-run. No run has produced the triple (N, D, R). A negative result would be about one kernel, one `ptrace_scope` value and one Node version, and would not change that a same-user reader of the key file is not stopped (From code).

## EVID-03: the live enforce proof

Claude through the daemon on the production stack with the default policy, the host attached, and the audit lines checked for host and kid. Two drives, each with its own tier: a scripted client driving the registered host command, and the real host driven against a scripted provider when that is feasible.

| Drive | Tier | Version | Result | Audit lines checked | Leak scan | Status | Date |
| --- | --- | --- | --- | --- | --- | --- | --- |
| launcher-driven | not-run | - | not-run | - | not-run | not-run | - |
| host-driven | not-run | - | not-run | - | not-run | not-run | - |
| live probe observation | not-run | - | not-run | - | not-run | not-run | - |

## Not shown

What this evidence does not cover, however the rows above fall:

- Other kernels and other `ptrace_scope` values: only the value read in a window is measured (Inference from the kernel documentation for any other value).
- Node 22.x: CI covers it as a regular user; only the Node version read in a window is run (From code, the CI matrix).
- Any reader that is a descendant of the holder, or root (Inference from the kernel documentation; the root control only shows the scanner works).
- `process_vm_readv` and `ptrace` attach: not exercised; the probe covers the access routes of `/proc/PID/mem` and `/proc/PID/environ` only (Inference from the kernel documentation that the access check is the same).
- A same-user reader of the key file: the key file is readable by the same user, the page records that beside the memory result, and a same-user reader can mint tokens whatever the memory result is (From code).
- A real model turn, if the host-driven drive uses a scripted provider (From code).
- Hosts other than claude (From code).

## Evidence kept outside the repository

Raw evidence is kept in a directory outside the repository, with mode 0700 and files 0600, named on this page only as the evidence directory with the dates of its contents. It holds TAP output, audit-line copies, probe reports, snapshots and wire logs. Nothing from it is copied into the repository except counts, statuses, 8-character digest prefixes and decoded public claims.
