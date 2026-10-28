# Realm hardening plan (H1 to H5)

Status: H1 approved and implemented in this tree on 2026-10-23. Its live
send is not yet run (section 7). H2 to H5 are design only. Nothing in this
document is a claim that a control is live today.
Source references are repo-relative.

## 1. Decisions

- **Posture: software mimic.** Signing keys are held outside the sandbox
  host, in a key file the realm process reads at its entry edge. No
  trusted-execution (TEE) claim is made. Hardware attestation is not
  available on the development host (no SGX, SEV, TDX, or Nitro device
  nodes were observed).
- **Web3 scope: opt-in Solana devnet anchoring first.** No mainnet. An
  anchor records that a log existed in a given state at a given time. It
  does not record what the log says.
- **Policy default: advisory, unchanged.** Fail-closed is documented as a
  per-project opt-in (`docs/policy-reference.md`, `mode`).
- **H1 anchor record.** `{"version":1,"sessionId","lineCount","rootSha256","createdAt"}`
  with fixed key order. `createdAt` is ISO-8601 UTC. The on-chain memo is
  that record as canonical single-line JSON, at most 566 UTF-8 bytes.
- **H1 Merkle rule.** Lines are the audit file split on `\n`, with one
  trailing empty segment dropped. Leaf = SHA-256(0x00 || line). Parent =
  SHA-256(0x01 || left || right). An unpaired node is promoted unchanged.
  Empty input is an error.
- **H1 transaction.** Legacy message, header `[1,0,1]`, accounts
  `[payer, memo program]`, one instruction whose data is the memo. Memo
  program id `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` (spl.solana.com/memo).
- **H1 devnet guard.** Publish refuses unless `getGenesisHash` returns
  `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`. Checked against the live
  RPC on 2026-10-23. Mainnet-beta returns a different hash and is refused.

## 2. Threat model

What a software mimic can prove:

- An anchored root commits to the exact ordered lines of one session's
  audit file at the anchor time. Any later edit, deletion, or reordering
  of a line that was anchored changes the root and is detectable.
- The anchor's `createdAt` and the chain's block time bound when the log
  content existed. Both are recorded facts, not attestations of the
  host clock's accuracy.

What it cannot prove:

- That each action was authorized. The audit log records what happened,
  not what policy allowed it. Authorization is a separate question
  (policy, mutation gate, operator approval).
- That the host is uncompromised. A host that is compromised before an
  anchor is published can write any log it likes and anchor it. The anchor
  proves the log did not change after anchoring, not that it was true when
  written.
- That the signing key was never exposed. A software key outside the host
  is protected only by file mode and by the process boundary. Anyone who
  can read the key file can publish anchors as the realm. Research on
  memory-bus interposers against hardware TEEs (section 5) applies to
  TEEs, not to this design, and H1 claims no TEE protection.
- Confidentiality. Anchors publish only the session id, line count, root,
  and time. Audit content never leaves the host. Session ids are public on
  chain once anchored.

## 3. Mapping to the v1.0 security review

Source: `.planning/milestones/v1.0-phases/07-policy-reference-and-security-review/07-SECURITY-REVIEW.md`.

| Finding | Subject | Status | Relation to H1 |
| --- | --- | --- | --- |
| R10 | Audit result-line durability (no fsync, L-06) | Done (phase 9.7) | `writeAuditLine` fsyncs after the write loop, and a failure is `AUDIT_WRITE_FAILED`. The first append to a new log fsyncs the file and then the directory. A failed fsync after a successful write reports `AUDIT_WRITE_FAILED` although the line is already in the file, so a caller must not blindly retry: a retry would duplicate the line. H1 commits to R10's log; anchoring detects later edits and does not itself make a line durable. |
| R6 | Policy file integrity (location-only check) | Open: owner decision | Not addressed. Recommended rule: the policy file's owner is the daemon user or root, and it has no group or other write bit. A later hash-anchor of the policy file is a candidate for H4. |
| 5.2 | Workspace bound twice: once in composition, again in `create` | Closed (phase 9.7) | String rebind is closed: composition binds once, and `create` verifies the pinned root with `verifyPinnedAt` in `src/lifecycle/controller.ts`. Descriptor pinning for reads is the accepted approximation FS-02. |
| 5.4 | Host `write` and `edit` guard (OQ-P5-02) | Open (residual) | The guard is implemented in `src/omp/plugin.ts`: advisory mode warns and fail-closed mode blocks. It covers the `write` and `edit` tools only. Non-extension paths, launch-time tool flags, restricted SDK sessions and the eval bridge are not covered. |
| R4 | Credential list lacks `**/*.pem`, `**/*.key`, `**/.npmrc`, `**/.pypirc` | Done (phase 9.7) | The four patterns are in the credential denial list (`docs/policy-reference.md`, `credentialAllow`). |
| R7 | Policy root breadth (`/` accepted) | Open in code | Documented in `docs/policy-reference.md`; no breadth refusal is implemented. |

H1 itself addresses none of these findings and closes no finding. The rows marked Done or Closed were closed by phase 9.7, not by H1.

## 4. Phases

### H1: anchoring (approved)

- **Interface.** `src/audit/anchor.ts` (pure, node builtins only) and
  `src/cli/anchor.ts` (`runAnchor`). CLI: `realm anchor --session <id>`
  (dry run), `--publish` (sends), `--rpc <url>` (default devnet).
- **Acceptance.** Dry run prints the record and memo with zero network
  calls. Publish refuses on a genesis mismatch and sends nothing. Key
  loading refuses any file with group or other bits, a key inside the state
  directory, or a mismatched public half. Tests run with a fake RPC and
  keys generated into a temporary directory.
- **Non-goals.** No hash chain (H2). No mainnet. No key custody beyond a
  file. No verification command that reads the chain back.

### H2: hash-chained audit lines

- **Interface.** Each audit line carries the hash of the previous line.
  This is a file-format change and needs agreement with existing readers.
- **Acceptance.** A single-line edit in the middle of a file is detected by
  a verifier without any on-chain data. Existing v1 files remain readable.
- **Non-goals.** Encryption of audit content. Rotation policy.

### H3: dedicated signer and key custody

- **Interface.** A signer process separate from the realm process, with a
  narrow request surface (sign one memo). Options and their fit are in
  section 5.
- **Acceptance.** The realm process holds no key material. The signer
  refuses any payload that is not a valid anchor record.
- **Non-goals.** Threshold signing. Multisig governance of the anchor
  program. Hardware custody.

### H4: software attestation of the binary and policy hash

- **Interface.** The anchor record gains a field for the realm binary
  digest and the policy file digest. This addresses R6 for the anchor
  path only.
- **Acceptance.** A verifier can detect a policy file that changed after
  the last anchor.
- **Non-goals.** Any claim that the attestation is hardware-backed.

### H5: mutual authentication (design only)

- **Interface.** Peers prove possession of anchored keys before the control
  channel accepts requests. Design only in this plan.
- **Acceptance.** Written design reviewed. No code.
- **Non-goals.** Implementation. Any claim about the daemon control socket
  beyond its current `0o600` mode.

## 5. Research basis

Anything not listed here is [UNVERIFIED].

| Option | Source | Fit for H1 to H5 |
| --- | --- | --- |
| TEE.fail memory-bus interposer | tee.fail, disclosed 2025-10-28 | Shows Intel SGX, TDX and SEV-SNP attestation keys can be extracted by a sub-$1,000 interposer. Reason H1 claims no TEE. |
| AWS Nitro enclaves | Not established by sources read | [UNVERIFIED] whether Nitro is affected. Not used in H1. |
| Anda dTEE over Nitro via IC-TEE | github.com/ldclabs/ic-tee | Reference for H3 only. Licence is inconsistent (Apache-2.0 header, MIT README); resolve before vendoring. |
| Squads v4 multisig | github.com/Squads-Protocol/v4 (AGPL-3.0) | Relevant only if Realm deploys its own program. Not needed for H1. |
| Drift Protocol incident, 2026-04-01 (about $285M) | halborn.com, trmlabs.com | Pre-signed durable-nonce admin approvals were the failure. Lesson: no durable-nonce pre-signed approvals; timelocks; thresholds above 2-of-5. |
| Solana Operational Security Standard v0.3 | publish.obsidian.md/sos | Recommends 3-of-5 and a 48 to 72 h upgrade timelock. No primary source found; reference only. |
| Solana Attestation Service | github.com/solana-foundation/solana-attestation-service (MIT) | Signed-claims registry. Later option, not used in H1. |
| Turnkey signing in Nitro | turnkey.com blog | Third-party custody. Not adopted in H1. |
| Lit Protocol threshold network | Reported shut down April 2026 | [UNVERIFIED]. Not considered. |
| Ika Solana signing path | Reported pre-alpha | [UNVERIFIED]. Not considered. |
| FROST, RFC 9591 | rfc-editor.org/rfc/rfc9591 | Threshold Schnorr. Relevant to threshold custody only, not H1. |
| Agent Flight Recorder | arXiv 2609.01931 (2026-09-01) | Hash-chained events with on-chain epoch roots. Pattern adopted: anchor roots, never content. Its overhead figures (about 48 µs per event, 512 bytes per event, $2.30 per 100K events) are paper-reported and not reproduced here. |

## 6. Operator guide: `realm anchor`

Prerequisites: a session audit file at `<stateDir>/audit/<sessionId>.jsonl`
created by a run of the realm. The state directory comes from
`$XDG_CONFIG_HOME/realm/config.json` (or `$HOME/.config/realm/config.json`);
the runtime configuration section of `docs/policy-reference.md` gives the
schema.

Dry run (no network, no key needed):

```
realm anchor --session <sessionId>
```

Prints `{"mode":"dry-run","record":{...},"memo":"...","memoBytes":N}`.
Check that `memoBytes` is at most 566.

Publish to devnet:

```
REALM_ANCHOR_KEY_FILE=<path-to-keypair.json> realm anchor --session <sessionId> --publish
```

- `REALM_ANCHOR_KEY_FILE` is read only at the CLI entry (`src/cli/main.ts`).
- The key file is a Solana CLI keypair JSON: 64 integers, a 32-byte seed
  followed by the 32-byte public key.
- The key file must be a regular file with mode `0600`. Any group or other
  permission bit causes refusal. It must not sit inside the state directory.
- `--rpc <url>` overrides the default `https://api.devnet.solana.com`.
  The genesis guard applies to any URL.
- Output: `{"mode":"published","cluster":"devnet","signature":"...","explorer":"https://explorer.solana.com/tx/<sig>?cluster=devnet","record":{...}}`.
- Funding: the publishing key's address must hold devnet SOL for the
  transaction fee. Without it the node answers `AccountNotFound`. Fund the
  address from faucet.solana.com before `--publish`.

Published fields: session id, line count, root, and creation time. Audit
content is never published, and neither are file paths, argv, or host
details.

Failure modes of the audit file. Each exits 1 and prints one line to
standard error, with no host path in it:

- No audit file for the session: `realm anchor: no audit log exists for session <id>`.
- The audit file is not a regular file: `realm anchor: audit log for session <id> is not a regular file`
  (code `PATH_ESCAPE`).
- The audit file has no lines: `realm anchor: audit log for session <id> has no lines`.
- The audit file cannot be inspected or read (a permission or I/O error):
  `realm anchor: audit log for session <id> could not be inspected` or
  `realm anchor: audit log for session <id> could not be read`, code
  `SCHEMA_INVALID`. Such an error is reported the same way as the other
  failures above; it no longer ends the command with an uncaught Node error.

To verify later, recompute the Merkle root from the audit file and compare
it with `rootSha256` in the anchor record. Verification tooling is not part
of H1 [INFERENCE from the plan scope].

## 7. Not observed

- No funded devnet send was made. The public devnet faucet refused the
  airdrop request on 2026-10-23 (daily limit or empty faucet), so no send was
  attempted. A devnet `simulateTransaction` with `sigVerify` accepted the
  signed H1 transaction up to account loading (unfunded payer:
  `AccountNotFound`) and rejected the same transaction with one signature bit
  flipped (`SignatureFailure`). That validates the signature and message
  layout. It does not validate fee payment or inclusion.
- No Podman 5 suite was run (historical; live evidence is in section 10). Container
  hardening claims remain as stated in the v1.0 review (R1, R13).
- No hardware TEE was available.
- No Anda or ICP credentials were used.
- Memo size limit (566 bytes) and genesis hashes were read from the sources
  in section 5 and a live RPC call on 2026-10-23; they were not re-checked
  against a later cluster state.

## 8. Fail-closed posture

- The advisory mode is the default. In advisory mode a write in a
  non-active state proceeds with a warning (R2).
- Fail-closed is a per-project opt-in: a project that expects containment
  sets `"mode": "fail-closed"` in its policy file.
- Anchoring does not change the mode. An anchor is evidence after the fact,
  not a gate on writes.
- Operators who need containment must also address 5.4 and R7 in
  their deployment. The mode switch alone does not cover them.

## 9. Container capability proof (phase 9.6, C3)

- **Removed inspect property.** `cap-drop` is no longer in `HARDENING_PROPERTIES` and is no
  longer checked by `verifyInspect`. Removing it left 14 properties; it checked 15 before.
  The `seccomp-keyring` property (below) was then added, giving 15. Phase 9.7 added 11 more
  (below), so the verifier now checks 26.
- **Reason.** Podman 5.7.1 does not report `KernelCaps` in libpod inspect. An inspect-level
  check of the five capability sets therefore reads a field the engine never supplies, and
  cannot prove them empty.
- **Replacement: the live proof.** `attachKernelCaps` (`src/runtime/kernel-caps.ts`) reads
  `/proc/<State.Pid>/status` on the host, and `liveCapabilityFailures` requires every one of
  CapInh, CapPrm, CapEff, CapBnd and CapAmb to be present and hold no bit. A missing or
  unreadable status, a missing pid, a missing set, or any non-zero set refuses with `cap-drop`.
  The proof runs at both create-time verifiers: the driver's post-start check
  (`src/runtime/driver/lifecycle.ts`) and the session's `verifyOrRemove`
  (`src/runtime/session-execution.ts`). An inbound `KernelCaps` from the engine is dropped
  before the host read, so only the host read can pass the proof.
- **Channel binding.** Every sandbox binding names its channel directory (`sandboxBindingOf`),
  so `HardeningBinding.channelDir` is required. The channel-less binding and its paths
  (`tmpfsDestinationsOf`, the optional channel mount and PID 1 exemption) are removed.
- **Not claimed.** This proof is observed on the host at create time. It does not
  re-verify the capability sets after create. The design was not run against a live Podman 5.7.1
  engine in the change that introduced it; live evidence is in section 10.
- **Added property: `seccomp-keyring`.** Podman 5.7.1 records `seccomp=<path>` in
  `HostConfig.SecurityOpt` only for containers the `podman` CLI created, because the CLI sets the
  `io.podman.annotations.seccomp` annotation and the API does not. A container created through the
  API with `seccomp_profile_path` runs under the profile, visible in `linux.seccomp` of its OCI
  config, while its inspect shows only `no-new-privileges`. The property therefore ignores
  `SecurityOpt` and the annotations. `attachSeccompEvidence` (`src/runtime/seccomp-evidence.ts`)
  reads the config through the inspect's `OCIConfigPath`, which must equal `StaticDir` joined with
  `config.json`, and the property passes only when the default action is `SCMP_ACT_ERRNO` and
  `keyctl`, `add_key` and `request_key` are each denied with `EPERM` and allowed by no rule. Since
  phase 9.7 it also requires the isolation denials (`EPERM`) and `clone3` (`ENOSYS`). An
  absent, unreadable, oversize or unparseable config fails it, so a daemon that cannot read the
  config refuses the create. The whole profile is not compared with the vendored file, because
  Podman filters and expands rules by capability and architecture.
  Both verifiers run it, with the reader injectable as `readOciConfig`. Details:
  `docs/integration/openshell.md`, section "Sandbox create hardening: seccomp profile".
- **Phase 9.7 properties.** The verifier now checks 26 properties. The 11 added in phase 9.7 are
  `live-seccomp`, `live-no-new-privs`, `namespaces`, `devices`, `user`, `security-opt`,
  `memory-swap`, `ulimits`, `sysctls`, `masked-paths` and `readonly-paths`. Details:
  `docs/integration/openshell.md`, section "Sandbox create hardening: verified properties and
  workspace scan (phase 9.7)".

## 10. Production stack evidence (2026-10-28)

The live runs on the production stack (OpenShell 0.1.5 gateway, the Realm compute driver, rootless Podman 5.x) verified the following. The OMP-LIVE items and the live egress results are recorded in the phase verification file, not here.

- `realm up` reaches `active`, and `realm status` reports it.
- The in-sandbox runner probe passes.
- The workload runs as uid 1001 with CapEff 0, CapBnd 0, NoNewPrivs 1, seccomp mode 2, and IPv6 disabled.
- The realm policy holds: `/tmp`, `/workspace` and `/dev/null` are writable; `/etc` and `/home` are read-only; `/dev/zero`, `/dev/random` and `/dev/urandom` are readable.
- `keyctl`, `add_key` and `request_key` return EPERM, and the host account's keyring is not readable.
- The pinned workspace is bound and receives no realm files.
- A 16 MiB upload and download round trip is byte-identical (SHA-256 matches on both sides).
- A non-zero exit status is propagated.
- Egress is deny-all by default.
- With an allowlist, the allowed `host:port` connects. A non-allowlisted IP, a non-allowlisted host and an IPv6 literal fail to connect with `EACCES`. The connection is refused, not the lookup (verified on the rebuilt image, 2026-10-28).
- The sandbox resolver is synthetic and answers only A queries: every A query, including for a made-up or `.invalid` name, gets the next address from `198.18.0.0/15`, and policy is enforced at connect time on the name behind it. AAAA returns no data (`ENODATA`) and TXT returns not-implemented (`ENOTIMP`). A host packet capture on ports 53 and 853 showed zero DNS packets for the made-up, `.invalid` and denied names, and packets for the allowed name only, so a name outside the allowlist is never forwarded as a DNS query (verified on the rebuilt image, 2026-10-28). A sandbox can obtain addresses in `198.18.0.0/15` for any name, so logged resolved addresses are synthetic.
- `realm down` leaves zero containers, sandboxes, supervisors and secret directories.
- A wrong image digest fails closed.

Decisions recorded with this evidence:

- One sandbox per session, named `realm-<sessionId>`.
- `active` needs no Anda bridge when no `andaUrl` is configured.
- One live sandbox per pinned root.
- The runtime's policy is the enforcement authority, and the retired realm helper is removed (recover it from git history if needed).

Residual risks, accepted items and open review findings of the production sandbox: `docs/integration/openshell.md`, section "Residual risks of the production sandbox (reviewed 2026-10-28)".
