---
phase: 12-scripted-provider-harness-and-omp-enforcement-spike
reviewed: 2026-11-13T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/daemon/channel.ts
  - src/omp/plugin.ts
  - test/omp/plugin.test.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-11-13
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found
**Commit:** 0abcb80 (working tree over HEAD; the three files are uncommitted changes)

## Summary

Reviewed the three files changed for the CR-01 fix: `SentRequestError`, `readSentReply` and `sendRequest` in `src/daemon/channel.ts`; the `callDaemon` catch in `src/omp/plugin.ts`; and the new and revised tests in `test/omp/plugin.test.ts`. Gate results were supplied in the assignment and were not re-run.

**CR-01 is closed at HEAD.** The earlier defect was that a `write` or `exec` whose reply was lost in transport reached the caller as a retryable refusal in the default configuration. The fix in `plugin.ts:678-680` maps any `SentRequestError` from a `write` or `exec` to `AUDIT_OUTCOME_UNKNOWN`, whether or not re-attach is on. The class survives the whole chain: `readSentReply` (`channel.ts:492`), `sendRequest` (`channel.ts:516`), `client.request` (`client.ts:172-173`, which rethrows any `RealmError`), and `callDaemon`. The new test at `plugin.test.ts:1902-1913` pins the default-mode case.

No critical issues were found. Two warnings remain: the post-delivery classification is narrower than the `sendRequest` comment promises, and the channel suite does not assert the new class. One info item concerns test naming.

## Warnings

### WR-01: Post-delivery decode, id-mismatch and oversize failures on write or exec are not reported as unknown

**File:** `src/daemon/channel.ts:485-495` (`readSentReply`), `src/daemon/channel.ts:512-516` (`decodeReply` and the id check in `sendRequest`), `src/daemon/channel.ts:501` (doc comment); `src/omp/plugin.ts:678-680`
**Issue:**
`readSentReply` converts only the transport codes (`REALM_NOT_ACTIVE`, `TOOL_TIMEOUT`) into `SentRequestError`. `decodeReply` (line 513) and the reply-id check (lines 514-516) run outside it, so a delivered request whose reply is undecodable, carries a mismatched id, or exceeds the reply cap surfaces as a plain `SCHEMA_INVALID`. The plugin's catch does not map that to `AUDIT_OUTCOME_UNKNOWN`, so a `write` or `exec` that the daemon may already have applied is reported as a definitive protocol error. The model then has no signal that the outcome is unknown and may retry the mutation.

The `sendRequest` doc comment at line 501 says "A failure once the request is written surfaces as SentRequestError". The code does not do that for these three cases. The `readSentReply` comment (lines 483-484) and the `SentRequestError` comment (line 313) describe the narrower transport-only rule, which matches the code. So the comment on `sendRequest` is the inaccurate one.

Severity is WARNING because the trigger is a daemon protocol violation: the daemon must send a malformed, mismatched or oversized reply after applying a write. The socket is mode 0600 and owned by the user. Escalate to BLOCKER if the daemon can emit such a reply after a mutation.

**Fix:**
Widen the `SentRequestError` code union to include `SCHEMA_INVALID` and wrap the post-write decode and id check in the same classification. Then correct the `sendRequest` comment to match.

```ts
export class SentRequestError extends RealmError {
  readonly sent = true;
  constructor(code: "REALM_NOT_ACTIVE" | "TOOL_TIMEOUT" | "SCHEMA_INVALID") {
    super(code);
    this.name = "SentRequestError";
  }
}

// in sendRequest, after writeBounded succeeds:
const raw = await readSentReply(socket, timeoutMs);
let reply: ControlReply;
try {
  reply = decodeReply(raw);
  if (reply.id !== request.id) throw makeRealmError("SCHEMA_INVALID");
} catch (error: unknown) {
  throw new SentRequestError("SCHEMA_INVALID"); // request was delivered; outcome unknown
}
```

Keep the existing pre-write behaviour unchanged. The RT-06 assertions on `SCHEMA_INVALID` still hold. The plugin mapping needs no change, because the `instanceof` check already covers the new code. [INFERENCE] I have not verified that no other caller of `sendRequest` depends on the `SCHEMA_INVALID` class being non-`SentRequestError`.

### WR-02: The new class is not asserted at the channel layer

**File:** `test/daemon/channel.test.ts:322-345` (RT-04 silent and dropping cases; assertions at lines 329-331 and 341-345); `test/omp/plugin.test.ts:218-226` (fake client)
**Issue:**
The RT-04 cases exercise the post-write boundary: the silent peer reaches the read timeout and the dropping peer closes after the request is written. Both assert only the catalogue code. Neither asserts `instanceof SentRequestError`, so a regression that drops the wrapping in `readSentReply` would still pass the channel suite. No test asserts the complementary pre-write case either.

The plugin tests use `FakeDaemon.lostReply`, which throws a `SentRequestError` directly. No test in the diff runs the real `sendRequest` → `client.request` → `callDaemon` chain that the CR-01 fix depends on.

**Fix:**
In RT-04, add `error instanceof SentRequestError` to the silent and dropping assertions. Add a case where the socket is absent or refuses the connection, asserting `!(error instanceof SentRequestError)`. Test files were read-only for this run; no edits were made.

## Info

### IN-01: The `CR-01` label is used for two unrelated findings in the plugin test file

**File:** `test/omp/plugin.test.ts:897` (existing: "OMP-05 (d) ... (P5-D6, CR-01)"); `test/omp/plugin.test.ts:1902` and `:1915` (new: "CR-01: ...")
**Issue:**
The existing OMP-05 (d) test pins the earlier CR-01 (the unreadable-status verdict). The two new tests reuse the `CR-01:` prefix for the lost-reply defect. The labels collide in the same file, so `grep CR-01` no longer identifies one finding.
**Fix:**
Give the new tests a distinct tag, for example `SENT-01:` for the two tests at lines 1902 and 1915. Leave the OMP-05 (d) label as it is.

## Checked and not flagged

- `callDaemon` behaviour change with re-attach on (`plugin.ts:675-681`): a pre-send `REALM_NOT_ACTIVE` or `TOOL_TIMEOUT` on a `write` now keeps its code and is retryable. Previously it became `AUDIT_OUTCOME_UNKNOWN`. This is correct: the request never reached the socket, so nothing was applied. It is intended, not a regression.
- Write-phase failures (`writeBounded`, `channel.ts:357-369`) are not `SentRequestError`. [INFERENCE] The daemon acts only on newline-terminated request lines, so a partially written line is not applied. This is the basis for the pre-write classification.
- A daemon refusal reply (`{ error: { code } }`) is not `SentRequestError`. `sendRequest` returns the decoded reply, and `client.ts:176-178` rethrows it as `makeRealmError(reply.error.code)`, so the refusal keeps its code. The test at `plugin.test.ts:1915-1925` pins this in the fake-client path.
- `ioFailure` (`channel.ts:339-344`) passes `RealmError` through unchanged, so the class is preserved at each rethrow.
- The `"write" in call || "exec" in call` discriminator matches the call shapes the plugin dispatches (asserted at `plugin.test.ts:1067` and `:1069`).
- `plugin.ts` now imports the runtime value `SentRequestError` from `channel.js`. No import-allowlist test covers `plugin.ts`, and `extension.ts` already imports from `channel.js`.

## Scope and coverage

- `src/daemon/channel.ts`: read at lines 256-278, 300-375, 380-530 and the `sendRequest` body (502-520).
- `src/omp/plugin.ts`: read at lines 640-723 (the `callDaemon` catch and surrounding context). `realmToolDefinitions` and the re-attach internals were not re-read; they are unchanged by this diff.
- `src/daemon/client.ts`: read at lines 159-203 (the request wrapper and `call`).
- `test/omp/plugin.test.ts`: read at the `FakeDaemon` fields and `call` (lines 214-231), the OMP-05 (d) test (897), the write refusal tests (1190-1213), and the O4 R8 and CR-01 tests (1859-1925). The file is 2373 lines and was not reviewed in full.
- `test/daemon/channel.test.ts`: searched for `SentRequestError` and read the RT-04 and RT-06 cases.
- Not reviewed in this run: the other four files from the earlier seven-file run (`src/core/policy.ts`, `src/fs/write.ts`, `src/omp/tools.ts`, `src/tools/dispatch.ts`, `src/tools/workspace.ts`). This regenerated report covers only the three files in this assignment and replaces the earlier report.
- No tests, lint, typecheck, format or builds were run, as the assignment requires. Findings are from reading the code.

---

_Reviewed: 2026-11-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
