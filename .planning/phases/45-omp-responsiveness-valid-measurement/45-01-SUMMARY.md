# 45-01 summary: feasibility record and frozen design

## What the record shows

- A transient scope can be made from a scrubbed environment and the
  detached child stays in it (P3); its pressure total moves under a
  burner and stays near zero for a sleeper (P5); per-thread run-queue
  delay is readable (P6).
- The host and account descriptions of load differ by an order of
  magnitude (Part E); the account's own slice was idle while the host
  stalled.
- Kernel facts (PSI on, scheduler stats on, systemd 255, node v24.18.0,
  omp 19.0.0) are in P9.

## What the record does not show

- That the Omp main thread is the JavaScript thread; only calibration
  shows that.
- That a scope does not change the scheduling share; stated as a limit,
  handled by identical scopes.
- That the host will be quiet enough for a verdict; it was not quiet
  during the probes.

## Branch, amendments, owner answers

Branch S, decided by the P3, P5 and P6 literal results. Branch X is in
scope by OD-45-1 (approved); the default tier remains `loaded, scoped`.
Amendments recorded in 45-DESIGN.md: the `OmpSession` pid accessor drift
(read through the accessor) and the E-45-12 minor drift (an extra later
src commit outside the PR 211 paths; reversal still conflicts only in
planning and docs). Owner answers: OD-45-1 approved, OD-45-2 accepted,
OD-45-3 no, OD-45-4 yes.

## Probes not usable, and what the design does about each

- P4 (AllowedCPUs/cpuset): silently ignored, no cpuset files. The design
  does not use pinning by default; Branch X records the root step that
  would change it, and the isolation prefix seam carries it.
- P10 (CPU weight): usable but not used; the scope is tuned by nothing.
- P6 permission-listing sample: not tried (target shell had exited);
  readability is shown by the three successful reads instead.

## What plans 45-03 and 45-04 can rely on

The wrapper argv (`systemd-run --user --scope --quiet --collect --`,
pinned by value), the files and fields (scope `cpu.pressure` "some"
total; `schedstat` three fields), Branch S, and the frozen constants
table with the four calibration-pending constants unset. 45-03 has
already landed the harness against this design (provisional branch S);
no code change was needed beyond the existing `scopedWrap` isolation
seam, and `DESIGN_BRANCH` stays S.
