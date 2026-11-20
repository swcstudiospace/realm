# Phase 47 window record (plan 47-02)

Computed by the frozen rules of plan 47-01 (the verdict runner over the run folders), nothing decided by hand. Tiers: O is observed in the
window on 2026-11-19; I is an inference and is never stated as a result. Every number names its run folder (01 to 12, in the order the test
wrote them). No path, user name, environment value or message text is in this file; the evidence directory is outside the repository and is
named nowhere in it (placeholder EVIDENCE_DIR; scratch placeholder SCRATCH_DIR).

## 1. Header (O)

| Item | Value |
| --- | --- |
| Date | 2026-11-19, one window, serial runs, 10:06 to 10:27 local time |
| Commit under test | 3c675c39d6f4d3d0dbcd255b8ca3a90ed430b6e5 (main after the merge of plan 47-01, v0.7.3 tag commit), built from a clean dist |
| Account | the unprivileged live account of the production stack (a copy of the built tree without .git ran from its home) |
| Person and lock | the window was run by the orchestrating agent on the owner authorization of 2026-11-19 (HITL); each command held the shared live lock exclusively (non-blocking flock; the lock was free at the start) |
| Stack | production stack, rootless Podman 5.7.1 first on the path, gateway and compute-driver units active, openshell connected, digest-pinned image |
| Legacy CLI | kimi-cli 1.51.0, scratch install from the registry wheel (digest equal to the registry value ffb9d0d4725844d36d6c78e8d3914a96b2d6a17678c217f3abe7336fb7e02d0e), fastmcp 3.2.4, mcp 1.30.0, 127 frozen packages (not hash-pinned: accepted residual) |
| Node | v24.18.0 |
| Host load | shared host under other work: CPU pressure (PSI some avg10) 64 to 81 percent and load average 3 to 38 across the window; recorded per run in the snapshot file. Nothing below is claimed about timings beyond the frozen rules. |
| Credentials | none in the shell; no model turn, no tool call |

## 2. Controls (O)

| Control | Run | Result |
| --- | --- | --- |
| C1, the client alone against the fake server through the recorder | folder 01 | ANSWERED with the six tools, tools/list request at mark 1193 ms, response at 1193 ms (L 0), no host end mark logged. `kimi mcp test realm` took 30497 ms in total (exit 0). |
| C2, the realm alone cold, the existing cold attach probe | folder 02 (record written by hand from the test output) | handshake replies at 1720 ms (bound 10000 ms), 12 tool calls refused REALM_NOT_ACTIVE retryable, first success at 27940 ms on the same process, boot report attached 1. One run. |
| C3, the client warm | not run | the reproduction did not end REPRODUCED (rule of Step E). |

## 3. Reproduction table (Step C, default drive, all three names restored, cold) (O)

| Folder | Valid | Cold | Class | sixTools | L ms | G ms | Child exit logged | Host command ms | Returned (exit) | First failing assertion of the test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 03-all | yes | yes | ANSWERED | yes | 2 | none | none | 31393 | yes (0) | host command under 25000 ms bound |
| 04-all | yes | yes | ANSWERED | yes | 93 | 100 (host end after the response) | none | 32301 | yes (0) | host command under 25000 ms bound |
| 05-all | yes | yes | ANSWERED | yes | 4 | none | none | 28804 | yes (0) | host command under 25000 ms bound |

Outcome by D-47-04: **NOT-REPRODUCED** (three attempts, three valid cold runs in the 2026-11-18 condition, none failing; the stop rule held
after the third). In every run the client printed the connected line and the six tools, and the recorder logged the six names. The three
production tests nevertheless failed their own assertion that the host command returns below 25000 ms (the client took 28804 to 32301 ms on
a loaded host); that assertion is the Phase 33 cold connect bound and is not part of the frozen classification. The failure of 2026-11-18 stays
recorded as it was; these are dated runs of the tier with a result of their own, and this record does not call any of them a pass of the tier.

## 4. Cause by D-47-05 (O)

**NOT-ESTABLISHED** (no rule row fires: the reproduction did not reproduce). The cause of GAP-43-03 is not established. What the window does
and does not show:

- Shows: C1 is ANSWERED (the client answers a server that answers at once), C2 answers the handshake at 1720 ms, and three cold production runs were
  ANSWERED with the six names. The client alone takes 30497 ms in total against the fake server, so most of the time of `kimi mcp test realm` is
  the client's own (consistent with E-47-02) on this loaded host.
- Does not show: why the run of 2026-11-18 had no tool names in the recorder summary.
- I-tier (inference, not a result): in the ablation, folder 10 (restore minus XDG_RUNTIME_DIR) the recorder log has no response to tools/list (the verdict
  runner classifies it NEVER-WRITTEN) while the client printed the connected line and all six tools. The same client, observed without the
  stack by a direct process trace in the window, sends SIGKILL to the stdio server process a few milliseconds after the tools/list response, and
  the recorder writes its log line after it forwards the bytes. So a recorder log can miss the last lines when the shim is killed first; the
  run of 2026-11-18 (18225 ms, no tool names in the summary, exit 0) has the same shape as folder 10 (18294 ms, exit 0). This is a candidate
  explanation of the instrument, not a stated cause.

## 5. Environment ablation by D-47-06 (O)

Runs are cold, each with the recorder restoring the named set; diagnostic variants, never the tier. Reach polls every 2 s up to 60 s. Counts are
container, sandbox, attached boot report at the first reached poll (or the last poll).

| Folder | Restore set | Class | Reached | First reached poll ms | State, containers, sandboxes, attached at that poll | Host command ms (exit) | Catalogue codes of the server stderr |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 03, 04, 05 | all three (SA) | ANSWERED x3 | yes x3 | 11110, 9307, 7406 | connecting; container, sandbox, attached counts 1, 1, 0 then 0, 1, 0 then 0, 1, 0 | see section 3 | none |
| 06-none | none (S0) | NOT-REQUESTED | no | none (9 polls) | no state, 0, 0, no count | 31791 (1) | SCHEMA_INVALID |
| 07-minus-XDG_CONFIG_HOME | XDG_RUNTIME_DIR, REALM_DRIVER_SOCKET | NOT-REQUESTED | no | none (10 polls) | no state, 0, 0 | 31206 (1) | SCHEMA_INVALID |
| 08-minus-XDG_CONFIG_HOME | same | NOT-REQUESTED | no | none (10 polls) | no state, 0, 0 | 29300 (1) | SCHEMA_INVALID |
| 09-minus-XDG_RUNTIME_DIR | XDG_CONFIG_HOME, REALM_DRIVER_SOCKET | ANSWERED | no | none (11 polls) | no state, 0, 0 | 24208 (0) | none |
| 10-minus-XDG_RUNTIME_DIR | same | NEVER-WRITTEN (see section 4, I-tier) | no | none (11 polls) | no state, 0, 0 | 18294 (0) | none |
| 11-minus-REALM_DRIVER_SOCKET | XDG_RUNTIME_DIR, XDG_CONFIG_HOME | ANSWERED | yes | 6911 | connecting, 1, 1, 0 | 24113 (0) | none |
| 12-minus-REALM_DRIVER_SOCKET | same | ANSWERED | yes | 6200 | connecting, 1, 1, 0 | 20996 (0) | none |

Verdict per name (for this non-default stack, as the runner computes it):

| Name | Verdict | Basis |
| --- | --- | --- |
| XDG_CONFIG_HOME | NEEDED for this non-default stack | both minus runs not reached; with it missing `realm mcp` exits at start (stderr names the state directory and the config file under an absolute XDG_CONFIG_HOME or HOME, code SCHEMA_INVALID, exit code 2 of the server) |
| XDG_RUNTIME_DIR | NEEDED for this non-default stack | both minus runs not reached (the handshake and tool list are answered, the stack is never created) |
| REALM_DRIVER_SOCKET | NOT-NEEDED for this non-default stack | both minus runs reached |

The XDG_CONFIG_HOME verdict holds for this non-default stack: the production scenario relocates the config home (E-47-06), so a user with the
default config location may not need it. The window does not show that. S0 (nothing restored, the real-user condition): **not reached**; `kimi mcp
test realm` exited 1 with a connection failure because `realm mcp` exited at start (folder 06).

## 6. Probes and source notes (O)

- Expansion probe (OQ-47-01 answered), an env block of the three names in the rig's own mcp.json, the server logging a 12 character digest only: with the brace
  reference spelling, each of the three names reached the server as the **unexpanded reference** text; with the bare dollar spelling, the same
  (unexpanded-reference for all three); with a plain literal text, the literal arrived unchanged for all three names. The legacy client
  does not expand references in an env value.
- Writer probe (OQ-47-02 answered): the host's own `kimi mcp add --transport stdio --env NAME=VALUE realm -- realm mcp --host kimi` in the isolated home under the containment
  environment **returned with exit code 0** (it did not hang) and wrote mcp.json. Shape (names, order, indent only): top level mcpServers; entry
  realm members in order command, args, env; the env object names the one name given; indent 2; **no** trailing newline. The recipe output
  (written beside it): entry members command, args; indent 2; trailing newline. So the host writer differs from the recipe in the env member and in the trailing
  newline.
- Source notes of the installed 1.51.0 (read, then partly confirmed by the probes): the test command passes no timeout to fastmcp (init timeout disabled by default, disconnect timeout 5 s);
  after the tool listing the stdio client closes the server stdin, and waits up to 2 s for exit before a terminate; the observed trace shows a SIGKILL of the server process a few
  milliseconds after the response; the stdio server receives a default environment (HOME, LOGNAME, PATH, SHELL, TERM, USER taken from the client process) merged with the entry env member, and no
  expansion of env values appears in the client, fastmcp or the SDK source (confirmed by the expansion probe).

## 7. The stack as found (O)

The before snapshot (first line) and the after snapshot (last line) of the snapshot file are equal in every count and name: 0 containers, 0 Realm
sandboxes, empty workspace root, 0 daemon processes, the same presence directories of other hosts in the shared hosts directory (none for kimi),
the same shared policy digest, and the account real Kimi config absent before and after. The top-level entry names of the account home are the same
set as at the start (the built tree copy was removed). Between every two runs the same check was made; no leftover occurred, so no `realm down`
was needed. One slip is recorded: during result reading the account home directory mode was changed once by mistake and restored to its original
mode within the same minute; no content changed.

## 8. Branch table for plan 47-03 (O, from the rules)

| Branch | Taken | Reason |
| --- | --- | --- |
| A (cause REALM-MCP, or a red early-close case) | not taken | cause NOT-ESTABLISHED; the five early-close cases of plan 47-01 are green |
| B (cause CLIENT) | not taken | no cause attributed |
| C (cause STACK) | not taken | no cause attributed |
| D (NOT-REPRODUCED, INCONCLUSIVE or UNDETERMINED) | taken | outcome NOT-REPRODUCED: nothing to fix; the narrowing is recorded (sections 3 and 4); GAP-43-03 stays open, narrowed |
| E-A (needed, and the client expands references) | not taken | the expansion probe shows no expansion |
| E-B (needed, and the client does not expand references) | taken | XDG_CONFIG_HOME and XDG_RUNTIME_DIR are needed for this non-default stack and references are not expanded. Owner decision OD-47-1 of 2026-11-19: option a, an install-time capture capability in its own phase (a CAPT-09 amendment later); noted here, not implemented in this phase. Until then GAP-43-01 is recorded with the manual workaround (`kimi mcp add --env NAME=VALUE`, or editing the env object of the entry, with the exact names). |
| E-C (none needed) | not taken | two names are needed |
| mixed | not taken | the verdicts are decided by reach for all three names |

Plan 47-03 therefore makes no change that the production tier exercises, so its live re-run is skipped by its own rule, and the scratch install is
not needed by a later plan: it was removed at the end of this run (see the summary).

## 9. What was not shown

No model turn and no tool call through the legacy CLI. One version of the CLI (1.51.0) on one machine. The network use of the CLI is not measured.
The dependencies are not hash-pinned. The host was under heavy load, so the 25000 ms bound of the production test failed in all three default
runs for a reason this window cannot separate from the client's own startup. Whether the 2026-11-18 failure was a recorder log miss (section 4,
I-tier) is not shown. The warm control C3 was not run. The C2 folder is a hand-written record of the existing probe output (handshake mark and
exit), not a recorder log.
