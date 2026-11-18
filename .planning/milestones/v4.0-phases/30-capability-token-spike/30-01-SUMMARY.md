---
phase: 30-capability-token-spike
plan: "01"
status: executed
requirements: [CAPT-01]
---

# Plan 30-01 summary: criteria frozen, prototype built, experiments E1 to E9 run

Date: 2026-11-17. Environment: Linux 6.8, Node v24.18.0, harness uid 0, `/proc/sys/kernel/yama/ptrace_scope` = 1, uid 65534 (nobody) present. No decision is made here; plan 30-02 decides.

## Files

- `docs/integration/capability-token-spike.md`: sections 1 to 4 written first, the section 3 hash recorded before any prototype file existed; sections 5 to 8 hold the placeholder `Written by plan 30-02.` (section 5 also holds the one pointer sentence the plan prescribes).
- `scripts/spike/capability-token/token.mjs` (62 lines), `gate.mjs` (38), `run.mjs` (299): 399 lines in total, Node built-ins only, no import from `src` or `dist`, not a test, not packaged.
- No file under `src`, `test`, `adapters`, `package.json` or a lockfile changed (`git status --short` lists only the note and the new directory, plus this summary).

## Criteria hash

Section 3 sha256: `535b8cd6fc72b1acc606d4836a15e98196b3390ac58883dd4c69e8ae729e81c0`. Recomputed after the prototype and the recorded run with the Task 1 step 7 command: identical (the verify command printed 1).

## Preflight and inventory (Task 1)

- Phase 29 landed: `grep -rln readOnlyHint src` finds `src/mcp/protocol.ts` and `src/mcp/server.ts` (`TOOL_ANNOTATIONS`, lines 126 to 168).
- E-30-02 confirmed: the host id reaches only `src/cli/stdio-host.ts` and `src/daemon/host-boot.ts`; no match in `daemon.ts`, `client.ts`, `channel.ts` or `dispatch.ts`.
- E-30-03 confirmed: no host, principal or token field in `AuditEntryInput`. The chain hash covers an extra field: `prev` is the sha256 of the previous raw line and the verifier reads only `seq` and `prev` (`src/audit/chain.ts` lines 112 to 114, 258 to 269, 326, 387, 452 to 455).
- E-30-08 settled: by default the mounted state directory is `stateDir/sandboxes/NAME`, a read-only per-sandbox child; it is neither the daemon state directory nor a parent of `run/control.sock` or `audit/`. Residual: `overlapProblems` never compares `sandboxStateRoot` with `stateDir`, so a hand-written layout placing `stateDir` inside `sandboxStateRoot/NAME` is not refused by that check.
- Count correction: the context says fifteen `mcp-config` manifests; the code gives 18 `mcp-config` ids (19 minus `omp`), all requesting the same six capabilities. Fifteen of them carry an install recipe.
- Phase 29 comparison: no tool the mapping treats as a plain read is marked other than read-only; `retry` and the argv/shell split of `exec` are the two noted differences.

## Recorded run (Task 3), `run.mjs --work SCRATCH`, exit 0

Command: `node scripts/spike/capability-token/run.mjs --work SCRATCH` on a fresh directory (SCRATCH had a 0711 parent so uid 65534 could traverse it; the script created WORK with mode 0700 and opened it to 0711 only while the uid 65534 variants ran). The JSON below is the output unchanged. It contains no path, token or key, and no hex run longer than 8 characters.

```json
{
  "node": "v24.18.0",
  "platform": "linux",
  "experiments": {
    "e1": {
      "expect": "each defect refuses with its own reason in the fixed order; the valid token is accepted",
      "observed": "26 rows, 0 mismatches",
      "ok": true,
      "token": {
        "length": 194,
        "sha8": "5a8e74c9"
      },
      "reasons": [
        "accepted",
        "bad-mac",
        "bad-payload",
        "bad-version",
        "capability-not-granted",
        "format",
        "time-window",
        "unknown-kid",
        "wrong-host",
        "wrong-session"
      ],
      "rows": {
        "valid token": "accepted",
        "tampered payload byte": "bad-mac",
        "tampered MAC byte": "bad-mac",
        "MAC truncated to 31 bytes": "format",
        "wrong key": "bad-mac",
        "unknown kid": "unknown-kid",
        "version 2": "bad-version",
        "payload with an extra key": "bad-payload",
        "exp as a string": "bad-payload",
        "caps unsorted": "bad-payload",
        "caps with a duplicate": "bad-payload",
        "caps containing net.egress": "bad-payload",
        "exp in the past": "time-window",
        "iat 120 s in the future": "time-window",
        "lifetime 86401 s": "time-window",
        "presented for session s2": "wrong-session",
        "presented as host claude": "wrong-host",
        "padded base64url MAC": "format",
        "capability outside the token set": "capability-not-granted",
        "no token": "format",
        "not a token": "format",
        "order: tampered MAC before wrong session": "bad-mac",
        "order: unknown kid before MAC": "unknown-kid",
        "order: version before time window": "bad-version",
        "order: time window before session": "time-window",
        "order: session before host": "wrong-session"
      },
      "mismatches": []
    },
    "e2": {
      "expect": "read-only denies write, both exec forms and retry; a token never widens the policy; shell form needs exec.shell",
      "observed": "6 profile/policy pairs, 0 mismatches against the mapping, named expectations held",
      "ok": true,
      "matrix": {
        "read-only/all-six": "read=allow list=allow write=capability-not-granted exec-argv=capability-not-granted exec-shell=capability-not-granted retry=capability-not-granted status=allow",
        "read-only/no-shell-no-write": "read=allow list=allow write=capability-not-granted exec-argv=capability-not-granted exec-shell=capability-not-granted retry=capability-not-granted status=allow",
        "workspace-edit/all-six": "read=allow list=allow write=allow exec-argv=capability-not-granted exec-shell=capability-not-granted retry=capability-not-granted status=allow",
        "workspace-edit/no-shell-no-write": "read=allow list=allow write=policy-denied exec-argv=capability-not-granted exec-shell=capability-not-granted retry=capability-not-granted status=allow",
        "full/all-six": "read=allow list=allow write=allow exec-argv=allow exec-shell=allow retry=allow status=allow",
        "full/no-shell-no-write": "read=allow list=allow write=policy-denied exec-argv=allow exec-shell=policy-denied retry=allow status=allow"
      },
      "mismatches": []
    },
    "e3": {
      "expect": "a same-uid sibling process reads a 0600 token file (the limit is real)",
      "observed": "sibling obtained the token; sibling obtained the token",
      "ok": true,
      "variants": {
        "harness-uid": {
          "holder": {
            "length": 264,
            "sha8": "887086a8"
          },
          "siblingRead": {
            "sha8": "887086a8"
          },
          "fileMode": "600",
          "siblingObtainedToken": true
        },
        "uid-65534": {
          "holder": {
            "length": 264,
            "sha8": "e2cb12dc"
          },
          "siblingRead": {
            "sha8": "e2cb12dc"
          },
          "fileMode": "600",
          "siblingObtainedToken": true
        }
      }
    },
    "e4": {
      "expect": "a same-uid, non-descendant sibling reads the token from /proc/PID/environ on a default Linux (recorded as observed)",
      "observed": "sibling obtained the token; sibling obtained the token",
      "ok": true,
      "uid": 0,
      "ptrace_scope": "1",
      "variants": {
        "harness-uid": {
          "holder": {
            "length": 264,
            "sha8": "3e7087b4"
          },
          "siblingRead": {
            "sha8": "3e7087b4"
          },
          "siblingObtainedToken": true
        },
        "uid-65534": {
          "holder": {
            "length": 264,
            "sha8": "5ee11392"
          },
          "siblingRead": {
            "sha8": "5ee11392"
          },
          "siblingObtainedToken": true
        }
      }
    },
    "e5": {
      "expect": "the kernel refuses another uid with EACCES or EPERM (the case the 0600 socket already stops)",
      "observed": "open of the token file: EACCES; first refused level: token",
      "ok": true,
      "levels": {
        "WORK": "ok",
        "e5": "ok",
        "dir": "ok",
        "token": "EACCES",
        "open": "EACCES"
      }
    },
    "e6": {
      "expect": "under 400 bytes; verify in microseconds; zero dependencies",
      "observed": "token bytes {\"read-only\":194,\"workspace-edit\":209,\"full\":264}; mint 20.6 us, verify 23.67 us (median of 20000); 0 dependencies",
      "ok": true,
      "lines": [
        62,
        38,
        299
      ],
      "dependencies": 0,
      "relativeImports": 2
    },
    "e7": {
      "expect": "a rcap1 value under key note is not redacted by the value layer; under key token it is redacted by the key layer",
      "observed": "value layer changes the token-shaped value: false; key layer redacts key token: true, key note: false",
      "ok": true,
      "a": {
        "patternsMatchSource": true,
        "valueLayerChangesShapedValue": false,
        "valueLayerChangesRealToken": false,
        "keyLayerRedactsKeyToken": true,
        "keyLayerRedactsKeyNote": false,
        "assignmentLayerRedactsEnvStyle": true,
        "bearerRedacted": true
      },
      "b": "Biscuit probe is a manual shell sequence (npm view, install with --ignore-scripts, import); recorded in the plan summary, not here"
    },
    "e8": {
      "expect": "revocation is key rotation by kid: a retired kid refuses, the active kid is accepted",
      "observed": "k1 token before retiring: accepted; after retiring k1: unknown-kid; k2 token: accepted",
      "ok": true
    },
    "e9": {
      "expect": "the self-declared label is spoofable; a token claim that does not match the token refuses",
      "observed": "label line recorded host claude for a cursor caller (spoofed: true); cursor token claiming claude: wrong-host; valid cursor call recorded host cursor with kid k1",
      "ok": true,
      "limit": "holder of the claude token presented as claude: admitted (possession, not identity)",
      "lines": [
        {
          "sessionId": "s1",
          "tool": "write",
          "host": "claude"
        },
        {
          "sessionId": "s1",
          "tool": "write",
          "host": "cursor",
          "kid": "k1"
        }
      ]
    }
  }
}
```

Deviation from the plan text, stated: the children of E3 and E4 receive the minted token from the harness (stdin for the file holder, the child environment for the environment holder) instead of minting it themselves, because the uid 65534 variants cannot read the repository to import `token.mjs`. The holder and the reader are still separate processes spawned by the harness, and the reader is not a descendant of the holder. Added beyond the plan: uid 65534 variants of E3 and E4 (a genuinely non-root same-uid pair, since the harness is root and root bypasses file modes), a per-level stat probe in E5, 5 ordering rows and 3 extra rows in E1, a nobody-free fallback ("not run" with the reason) for a non-root harness, and the assignment-pattern and Bearer checks in E7(a).

## Experiment results, as measured

| ID | Result |
| --- | --- |
| E1 | 26 rows, 0 mismatches; every refusal reason appears (format, unknown-kid, bad-mac, bad-payload, bad-version, time-window, wrong-session, wrong-host, capability-not-granted); the valid token is accepted; the five ordering rows hold the fixed order. |
| E2 | 6 profile and policy pairs, 0 mismatches against the independently computed mapping; read-only denies write, both exec forms and retry and allows read, list, status; `full` under the policy without exec.shell and fs.write is denied write and shell exec with `policy-denied` and allowed argv exec. |
| E3 | A sibling process of the same uid read the 0600 token file: obtained, for the harness uid (root) and for uid 65534. |
| E4 | A non-descendant sibling read the token from `/proc/PID/environ`: obtained, for the harness uid (root) and for uid 65534, with ptrace_scope 1. |
| E5 | uid 65534 against a 0600 token under a 0700 root-owned directory: `open` gives EACCES; WORK, e5 and the directory were statable, the token path was the first refused level (it needs search permission on the 0700 directory). |
| E6 | Token bytes: read-only 194, workspace-edit 209, full 264. Median mint 20.6 us, verify 23.67 us over 20000 iterations. 399 lines in three files, 0 dependencies (2 relative imports). |
| E7(a) | The patterns match the text of `src/audit/redact.ts`. A `rcap1.` value shaped as two 20-character base64url parts is not changed by the value layer (a real minted token neither); the key layer redacts under the key `token` and not under `note`; the assignment layer redacts `REALM_SPIKE_TOKEN=rcap1...`; `Bearer` plus the value is redacted. |
| E8 | Token under k1 accepted; after retiring k1 it refuses `unknown-kid`; the k2 token is accepted. |
| E9 | The self-declared label line records `claude` for a cursor caller (nothing refuses it); the cursor token presented with the claim `claude` refuses `wrong-host`; a valid cursor call records host `cursor` and kid `k1`, and the line does not contain the token. Limit recorded: a holder of the claude token presented as claude is admitted (possession, not identity). |

## E7(b) Biscuit probe (commands run by hand in SCRATCH2, outside the repository and the real home's dot-directories; removed afterwards)

1. `npm view @biscuit-auth/biscuit-wasm version license dependencies engines --json`: exit 0, `{"version":"0.6.0","license":"Apache-2.0","engines":{"node":">=22.0.0"}}`; no `dependencies` key printed.
2. `npm install --prefix SCRATCH2 --ignore-scripts --no-audit --no-fund @biscuit-auth/biscuit-wasm` (working directory SCRATCH2): exit 0, "added 1 package in 11s"; `node_modules` 2.5 MB; the package ships `module/biscuit_bg.wasm`, `biscuit.js`, `biscuit_bg.js`, `biscuit.d.ts`; its `package.json` has `engines.node >=22.0.0`, `type: module`, only a prettier devDependency.
3. Import from SCRATCH2 under Node v24.18.0 (the Node in use): `node --input-type=module -e "await import('@biscuit-auth/biscuit-wasm')"` without the flag: exit 0, printed `imported`, with `ExperimentalWarning: Importing WebAssembly module instances is an experimental feature`. With `--experimental-wasm-modules`: exit 0, same output.
4. Added, because the package's declared Node floor is lower than the Node in use: the same import under Node v22.13.0 (the repository's `engines.node` floor; the tarball was downloaded into SCRATCH2 from nodejs.org, run from there). Without the flag: exit 1, `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".wasm" for SCRATCH2/node_modules/@biscuit-auth/biscuit-wasm/module/biscuit_bg.wasm`. With `--experimental-wasm-modules`: exit 0, `imported`, with `ExperimentalWarning: Importing WebAssembly modules is an experimental feature`.
5. A first attempt to obtain Node 22.13.0 through `npx --yes node@22.13.0` timed out at 170 s (exit 124) and the second attempt failed (npx cache ENOENT); neither produced a result, and the direct download in step 4 replaced them.

Reading: the research claim (the wasm wrapper needs `--experimental-wasm-modules`) is confirmed on Node 22.13.0 and not needed on Node 24.18.0, where the import works unflagged but still emits an ExperimentalWarning. Only these two Node versions were tried.

## M1 statement (stop rule D-30-02)

M1 not demonstrated at end of Task 3. E3 and E4 show a same-uid reader obtains the token at rest and from the process environment (as root and as uid 65534). E5 shows a different uid is refused, by the kernel's file modes, which is the case the 0600 socket already stops; no experiment has a row where the same reader is admitted without a token and refused with one. E1 and E9 show what a token refuses (a wrong claim, a wrong host), not an attacker class that today's model admits and a token stops. No further delivery channel or candidate was tried.

## What could not be run or was not modelled

- Different kernels, `hidepid` mounts and non-dumpable processes (accepted residual R-30-01): E4 ran on one Linux kernel and one Node version, with ptrace_scope 1; a reader confined by a host's own sandbox was not emulated beyond the uid 65534 case.
- The E7(b) probe tried two Node versions only.
- `npx`-based acquisition of Node 22.13.0 failed (step 5 above); the tarball route worked.
- The parent's commands (`npx eslint scripts/spike/capability-token`, `node scripts/check/host-paths.mjs`) were not run by the executor, as instructed.

## Cleanup

All children were killed in the run's `finally` block (no process of the harness remained). The scratch directories (SCRATCH for the experiments, SCRATCH2 for the Biscuit probe, including the Node 22.13.0 tarball and its extraction) are removed.
