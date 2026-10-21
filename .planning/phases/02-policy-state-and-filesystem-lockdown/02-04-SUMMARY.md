# Plan 02-04 summary: audit redaction, append-only audit log, tool-input gate gaps (AUD-01, TOOL-01)

Status: done. All three tasks implemented. Checkpoint decision (D-42 entry format) was approved by the orchestrator before the log writer landed. No tests, compiler, or lint were run during this plan, per the wave rules; the orchestrator runs the gates once after the wave.

## Files changed

| File | Change |
| --- | --- |
| `src/audit/redact.ts` | New. Two-layer redaction (`redactValue`, `redactString`), frozen pattern constants, depth limit `REDACT_MAX_DEPTH = 8`, never throws. |
| `src/audit/log.ts` | New. `appendAudit` (redact whole entry, then `O_APPEND` JSONL at `<stateDir>/audit/<sessionId>.jsonl`, mode 0600), `summarizeExec` (argv redacted; shell form reduced to UTF-8 byte length and sha256). |
| `test/audit/redaction.test.ts` | New. Key layer, value layer, length thresholds, depth fail-closed, circular input, unusual values never throw, frozen table, spec n5 credential-leakage case. |
| `test/audit/log.test.ts` | New. One object per line, entry fields, modes 0600 (file) and 0700 (directory), narrowing of a wider pre-existing file, redaction before append, no content field, shell and argv exec summaries. |
| `test/contract/tool-input-gate.test.ts` | New. Only the D-40 cases missing from `tools.schema.test.ts` (see below). |
| `.planning/phases/02-policy-state-and-filesystem-lockdown/02-04-SUMMARY.md` | This file. |

No frozen file was edited (`src/core/states.ts`, `src/core/errors.ts`, `src/contract/*`, `src/core/policy.schema.json`). `src/audit/log.ts` imports only the `ErrorCode` type from `core` and the sibling `redact.ts`; it does not import `src/fs`.

## Must-have evidence (test names)

- **Credential shapes replaced before serialization (AUD-01):** `key layer: a value under the key …` (one test per key: token, accessToken, client_secret, db-password, passwd, x-api-key, API_KEY, apikey, Authorization, Cookie, credentials, private-key, privateKey); `key layer replaces a non-string value under a credential key …`; `key layer applies inside nested objects and arrays`; `value layer: a Bearer token is replaced`; `value layer: a PEM private key block is replaced`; `value layer: a PEM private key truncated before its end marker …`; `value layer: an AWS access key id …`; `value layer: a GitHub token …`; `value layer: an sk- token …`; `value layer: NAME=value with <NAME> …` (GITHUB_TOKEN, DB_PASSWORD, API_KEY, CLIENT_SECRET); `value layer: a short gh_ or sk- string below the length threshold is left unchanged`; `value layer leaves ordinary text unchanged`.
- **Depth-limited, fail-closed, never throws (T-02-09):** `depth limit fails closed: …`; `depth limit keeps shallow values intact`; `a circular structure is serialized without throwing …`; `unusual values never throw and never echo a secret`; `the frozen secret-pattern table cannot be extended at runtime`.
- **Spec n5 credential leakage:** `spec n5 credential leakage: no host secret shape survives a nested tool input (AUD-01)`.
- **One JSON object per line at `<stateDir>/audit/<sessionId>.jsonl`:** `each append adds one JSON object per line at …`; `an entry carries at, sessionId, tool, outcome, path, bytes, and sha256 (AUD-01, D-42)`.
- **Mode 0600:** `the audit file and its directory are created with modes 0600 and 0700 …`; `a pre-existing audit file with a wider mode is narrowed to 0600 on append (AUD-01)`.
- **Redaction before append (T-02-08):** `redaction runs before the append: a secret in path or argv never reaches the file …` (the test asserts the sentinel is absent from the raw file text).
- **No file content in write entries (D-42):** `a write entry never carries a content field, even when a caller passes one (D-42)`.
- **Exec entries (D-42):** `a shell exec entry records only script byte length and sha256, never the script (D-42)`; `a shell script's recorded length is its UTF-8 byte length …`; `an argv exec entry records argv after redaction (D-42)`.
- **Tool-input gate (TOOL-01), gap cases only:**
  - `write with an unknown key is rejected and the key is named (TOOL-01)` → `/write/mode`
  - `list with an unknown key is rejected and the key is named (TOOL-01)` → `/list/follow`
  - `the shell exec form with an unknown key is rejected and the key is named (TOOL-01)` → `/exec/cwd`
  - `the shell exec form with no script key is rejected and the missing key is named (TOOL-01)` → `/exec/script`
  - `the shell exec form with an empty script is rejected and the script is named (TOOL-01)` → `/exec/script`
  - `write with no content key is rejected and the missing key is named (TOOL-01)` → `/write/content`
  - `list with no depth key is rejected and the missing key is named (TOOL-01)` → `/list/depth`
  - `status holding read-shaped params is rejected and the first unknown key is named (TOOL-01)` → `/status/path`
  - `retry holding write-shaped params is rejected and the first unknown key is named (TOOL-01)` → `/retry/path`
  - `an extra top-level key beside a valid tool is rejected at the envelope root (TOOL-01)` → `(root)`

## Overlap check against `test/contract/tools.schema.test.ts`

Already covered there, so not repeated: exec argv and shell acceptance; argv and shell mixing; unknown key on exec argv form and on read; empty argv; key-presence on exec (`undefined` values); shell `false`; argv with `script`; argv with `shell: true` and no script; unknown tool name; empty envelope; two-tool envelope; absolute, `..`, and Windows paths for read, write, and list; `ifMatchSha256` shape; `maxBytes` bounds including 1048577 and 0; read without `maxBytes`; list with negative depth; status and retry with one extra key each.

The D-40 items "absolute and `..` paths" and "over-large maxBytes" are already fully covered by that file, so the gap file adds no duplicate of them.

## Decisions applied (defaults, recorded)

- **Redaction depth limit = 8.** Root is depth 0. Any value deeper than 8, including scalars, becomes `[REDACTED]` (fail closed). The plan did not fix a number; 8 is the default applied.
- **Key layer also redacts key names** through the value layer (`redactString(key)`). Key names are kept, so a sensitive key still shows which credential was present.
- **`NAME=value` matching is case-insensitive** on the NAME part (`GITHUB_TOKEN=`, `db_password=` both redact). The NAME is kept; only the value becomes `[REDACTED]`. This may over-redact a few benign names containing `key` (for example `monkey=`), which fails closed.
- **Frozen constants:** the arrays are frozen; the RegExp objects are not. A frozen global RegExp makes `String.prototype.replace` throw when it writes `lastIndex`.
- **Null-prototype output objects** in `redactValue`, so a key named `__proto__` remains an ordinary property.
- **Shell exec summary field names:** `scriptBytes` (UTF-8 byte length) and `sha256`. The plan said "script length"; the byte count is chosen so the value is unambiguous for Phase 7 consumers.
- **Audit file opened with `O_NOFOLLOW`** and `fchmod` to 0600 after open. The plan named `O_APPEND` and mode 0600; these two are added so a symlink planted at the audit path cannot redirect the append, and a wider mode left by a previous writer is narrowed.
- **Envelope-level unknown key test** asserts the `(root)` pointer. ajv checks `maxProperties` before `additionalProperties`, so an envelope holding a valid tool plus an extra key is reported at the root with `too many keys`, not by the extra key's name. The test names the root pointer, as the privacy rule permits.

## Residual risks and open questions

- **`sessionId` is used unvalidated in the file name.** `appendAudit` joins `<sessionId>.jsonl` into the audit directory without checking the id. The lifecycle layer supplies a random UUID (D-37/D-38), so the path is trusted input at this layer. A caller that passed a separator would write outside `audit/`. Default applied: trust the caller. Recommend a check in Phase 3 or the Phase 7 review if the id can ever come from a host.
- **Audit write failures propagate as raw Node errors** (for example `ENOSPC`, `EACCES`). No audit error code exists in the frozen catalogue, and a raw error message carries a path, not a value. Default applied: propagate, so the caller sees the failure. Whether a failed audit line should block the tool call is a Phase 3 gating question.
- **Hash-of-script residual.** The shell summary records sha256 of the script (D-42). A short script can be guessed and its hash matched; this is accepted by the decision and noted for the Phase 7 review.
- **Partial line after a killed process.** Q-3 applies: a line cut short by a crash is not cleaned up in Phase 2; the reaper candidate is Phase 4.
- **Value-layer coverage is pattern-based.** Secret shapes outside the D-41 list are not caught. Accepted per D-41.

## Requirements

- **AUD-01** covered by the redaction and log test files listed above.
- **TOOL-01** covered by `test/contract/tool-input-gate.test.ts` (gap cases) together with the Phase 1 suite `test/contract/tools.schema.test.ts`.
