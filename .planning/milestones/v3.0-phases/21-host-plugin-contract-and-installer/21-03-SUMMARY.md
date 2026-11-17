---
phase: 21-host-plugin-contract-and-installer
plan: 03
subsystem: host-installer-engine
tags: [host, installer, receipts, audit, atomic-write, dry-run, crash-resume]
requires: ["21-01"]
provides:
  - "Pure recipe planning for json-merge, text-block and bundle-copy with an exact inverse"
  - "Ownership receipts under <stateDir>/hosts/<host>.receipt.json (0700 directory, 0600 file)"
  - "planHostOperation and applyHostOperation: dry-run, optimistic atomic writes, admission and result audit lines, redacted structured log"
  - "createHostAdapter: detect, install, uninstall, status for any runtime table entry"
affects: [src/host/recipe.ts, src/host/receipt.ts, src/host/host-audit.ts, src/host/install.ts, src/host/adapter.ts, test/support/fixture-host.ts]
key-files:
  created:
    - src/host/recipe.ts
    - src/host/receipt.ts
    - src/host/host-audit.ts
    - src/host/install.ts
    - src/host/adapter.ts
    - test/support/fixture-host.ts
    - test/host/recipe.test.ts
    - test/host/receipt.test.ts
    - test/host/install.test.ts
    - test/host/adapter.test.ts
  modified: []
decisions:
  - "Host operations are audited on the existing hash chain under the reserved session id `host-plugins` (tools `host.install` and `host.uninstall`), not a per-plugin chain"
  - "A result-line audit failure after the change landed is AUDIT_WRITE_FAILED and is not rolled back (a retried append could duplicate the line); a failed admission append writes nothing"
  - "Real runtime table entries keep recipe null, so install on a real host refuses as recipe-pending (POLICY_DENIED) until Phases 24 and 25; the engine takes an injected table for fixture proof"
requirements: [HOST-05, HOST-06]
metrics:
  tasks: 4
  completed: 2026-11-17
status: merged
---

# Phase 21 Plan 03: installer engine, receipts, audit and logging Summary

Merged to main in PR 102 (squash `bf70847`). The engine changes only what a Realm receipt owns, and every real operation is bracketed on the audit chain.

## What shipped

- `src/host/recipe.ts` (898 lines): pure planners for `json-merge` (a key path in a JSON file; foreign content at the key, JSONC or invalid JSON is refused), `text-block` (a marker block in a text or TOML file, never parsed) and `bundle-copy` (a shipped adapter bundle). Limits: 1 MiB per file, 256 bundle files. Refusal reasons map to existing catalogue codes: `recipe-pending`, `not-detected`, `foreign-content`, `drifted`, `config-home-missing` to POLICY_DENIED; `symlink` to PATH_ESCAPE; `unparseable` to SCHEMA_INVALID; `concurrent-change` to WRITE_NOT_ATOMIC. Fixed refusal text per reason, never file content.
- `src/host/receipt.ts`: strict receipt schema and parse (paths, booleans, hashes, created-parent and created-directory records; no file content), `writeReceipt` through `atomicWriteFile` with the observed prior hash, `removeReceipt` with an expected hash, bounded reads.
- `src/host/install.ts`: `planHostOperation` resolves the home and reads every target through an lstat walk that refuses a symlink anywhere below the home (fix text names `--config-home <real path>`); reads are bounded by `TOOL_TIMEOUT`. `applyHostOperation`: dry run returns the plan and writes no host file, no receipt and no audit line; an all-noop plan writes no host file and no audit line; otherwise admission line, pending receipt (install), each change by `atomicWriteFile(…, { expectedPriorSha256 })`, final receipt, result line.
- `src/host/host-audit.ts`: `recordHostOperation` appends via the injected `appendAudit` with host id, tool, config home, byte count and sha256 only.
- `src/host/adapter.ts`: `createHostAdapter(entry, manifest, deps)`; detection by home directory or executable on an absolute PATH directory, running no host binary; status from the receipt (`not-detected`, `detected`, `recipe-pending`, `installed`, `drifted`); a manifest for another host is refused at construction.
- Tests (all in the merged tree): `install.test.ts` 19 cases, `adapter.test.ts` 21, `receipt.test.ts` and `recipe.test.ts` over the planners. They cover: dry run writes nothing; install then uninstall is an exact inverse with a four-line verifiable audit chain; no secret, file content or host text in a log line, audit line or receipt; an unwritable admission line means nothing is written; a result-line failure is AUDIT_WRITE_FAILED with the change kept; stalled read is TOOL_TIMEOUT; plan-to-apply change is a concurrent-change refusal with the receipt left pending; a crash between files then a second install resumes, and a crash then uninstall restores the pre-install tree; uninstall refuses drift but not an unrelated edit in the same file; a symlinked file or home is refused or followed once and recorded.

## Observed

- Read of `origin/main` at `bf70847`: all five source files and four test files exist; `planHostOperation` (install.ts l.281), `applyHostOperation` (l.450), `runHostOperation` (l.560), `createHostAdapter` (adapter.ts l.110), `writeReceipt` (receipt.ts l.295), `removeReceipt` (l.319). `src/host` reads no `process.env` and calls no dispatcher gate.
- CI on the PR head passed (Verify 22.x and 24.x, docs site, dependency audit). The orchestrator reported 215 host, cli and doctor tests passing locally before the PR.

## Not verified here

- The engine was exercised only on fixture hosts in temporary homes with an injected runtime table. No real host configuration was read or written, and no real-host recipe exists (every real entry has recipe null).
- The write phase is synchronous and bounded by file size, not by a timer (documented residual).
