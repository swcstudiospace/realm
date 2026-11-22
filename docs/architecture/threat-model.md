# Threat model — Realm v3.0 (STRIDE)

**Task:** `Tc8fd-arch` · **Capability:** `design.blueprint` (threat-model output) · **Status:** partial — A10 co-sign pending (see §7).
**Containers measured:** `arch_c4_fanout` (budget 100 for inventory): 15 containers, 17 relations, max fan-out 3, over budget none, isolated none. Zones: host operator · daemon surface · policy core · sandbox runtime · CI/tracking (see `blueprint.md` §2).

## 1. Trust zones and boundary crossings

| Crossing | From → To | Data / control |
|---|---|---|
| X1 | Operator / OmpHost → RealmDaemon | `up`/`down`/`status`, tool writes (socket dir 0700, socket 0600) |
| X2 | RealmDaemon → SandboxContainer | Container create/exec, `/workspace` + `/scratch` binds |
| X3 | SandboxContainer → OpenShellGateway | Egress (allowlisted hosts/ports only, IPv6 disabled) |
| X4 | ToolDispatcher → AuditLog | Admission/result lines (seq/prev chain, redacted) |
| X5 | CIPipeline → Release (tarball/SHA256SUMS/SBOM) | Build provenance, attestation |
| X6 | SandboxContainer → AndaEngine | HTTP Anda client (version-shape checked) |
| X7 | LinearTracker → OmpHost (issue text) | Task text is data, never instructions |

## 2. STRIDE grid (one row per crossing)

Legend: **M** = mitigation (control, owner, test).

### X1 — Operator/OmpHost → RealmDaemon (control socket)

| STRIDE | Threat + mitigation |
|---|---|
| Spoofing | Spoofed daemon/socket by another local user. **M:** socket dir 0700 + socket 0600 (user-only); surfaces attach by connecting, no attach/detach protocol. Owner: daemon. Test: `daemon/*` + `lifecycle` file-mode assertions. |
| Tampering | Forged `up`/`write` frames. **M:** schema validation (`contract/validate.ts`) + catalogue codes; no raw runtime text in errors. Owner: tools-dispatcher. Test: `SCHEMA_INVALID` cases. |
| Repudiation | Undocumented `up`/`write`. **M:** every operation records a redacted audit line with correlation id (AUD-01/02). Owner: audit. Test: audit-pair identity (OMPX-05). |
| Information disclosure | Secret leakage via log/audit/CLI output. **M:** audit redaction (sentinel), 0 PII fields, 0 off-machine telemetry; `check:docs` scans abs paths. Owner: audit/observe. Test: redaction suite (NFR-C1). |
| Denial of service | Startup overrun / hung `up`. **M:** 200 s startup budget, `withTimeout` on every async boundary, bounded tool queue. Owner: lifecycle. Test: live production-driver suite (NFR-P1). |
| Elevation of privilege | Host `edit`/write while disconnected (sandbox escape by policy bypass). **M:** fail-closed (D4) — refuse `REALM_NOT_ACTIVE`, 0 host files; Omp guard removes/blocks built-ins per spike-proved mechanism. Owner: omp-plugin. Test: C1/C2 disconnected cases (AC-2/AC-15). |

### X2 — RealmDaemon → SandboxContainer (compute driver)

| STRIDE | Threat + mitigation |
|---|---|
| Spoofing | Foreign container adopted as a session sandbox. **M:** daemon owns sessions; labels + recorded container id must match; startup sweep removes realm-labelled orphans before serving. Owner: lifecycle. Test: reap/adoption cases. |
| Tampering | Verifier-failing container served. **M:** 14-check hardening verifier before serving; verifier-failing or record-less containers removed with cause logs. Owner: daemon/startup. Test: RES-02/05 removal logs. |
| Repudiation | Container deletion without record. **M:** `SessionStore.delete` fsyncs the sessions directory; reap logs container ids + `recordsDeleted`. Owner: session. Test: CRASH-03/04. |
| Information disclosure | Host socket mounted into the sandbox. **M:** 0 host Docker/Podman sockets mounted; 0 privileged containers; mounts only bound workspace + realm state dir. Owner: runtime. Test: hardening verifier + scanner. |
| Denial of service | Orphan containers exhaust the host. **M:** startup sweep reaps realm-labelled orphans; `down` removes the session's container (0 orphans). Owner: daemon. Test: CRASH-01 sweep. |
| Elevation of privilege | Container breakout to host. **M:** rootless only (Podman 5.x), digest-pinned, non-privileged, caps dropped, read-only root + tmpfs scratch, CPU/memory/PID limits; runtime's own policy is the enforcement authority (9.2 helper removed by owner decision). Owner: runtime/A10. Test: hardening verifier + live proof. |

### X3 — SandboxContainer → OpenShellGateway (egress)

| STRIDE | Threat + mitigation |
|---|---|
| Spoofing | DNS spoofing to a non-allowlisted host. **M:** default-deny egress; IPv6 disabled; host-networking config refused at load. Owner: runtime. Test: egress validator/renderer. |
| Tampering | Gateway policy tampering. **M:** policy document pinned via `sandbox create --policy`; CLI verbs pinned to 0.1.5. Owner: openshell-adapter. Test: argv/create-poll cases. |
| Repudiation | Unlogged egress attempt. **M:** `EGRESS_DENIED` catalogue code surfaces identically over MCP/ACP/in-process (CRASH-06). Owner: tools-dispatcher. Test: 3-surface code equality. |
| Information disclosure | Allowlist leak via config/docs. **M:** no secrets in repo/images/logs; allowlist is host/port pairs only. Owner: runtime. Test: `check:docs` + scanner. |
| Denial of service | Gateway loss masquerades as crash loop. **M:** health probe runs `openshell status` on the failure path only → `OPENSHELL_GATEWAY_LOST` distinct from `AGENTOS_CRASH_LOOP`. Owner: runtime. Test: OBS-04 status coding. |
| Elevation of privilege | Sandbox reaches host network. **M:** mediated egress + DNS; no workload before `StartAgent`. Owner: runtime/A10. Test: isolation backend cases. |

### X4 — ToolDispatcher → AuditLog (hash chain)

| STRIDE | Threat + mitigation |
|---|---|
| Spoofing | Forged audit lines. **M:** `seq`/`prev` chain verified at startup (`realm audit verify`); head recovered from the last line. Owner: audit. Test: OBS-01 untouched/edited/removed/reordered copies. |
| Tampering | Line edited, deleted, or reordered undetected. **M:** chain breaks name the first broken line; reconciliation appends exactly 1 marked line per stranded admission, 0 on the second start. Owner: audit. Test: CRASH-02 + OBS-01. |
| Repudiation | Admission without outcome. **M:** admission + result pair share 1 correlation id; `AUDIT_OUTCOME_UNKNOWN` reconciliation for stranded admissions. Owner: audit. Test: OMPX-05 audit-pair identity. |
| Information disclosure | PII/secrets in audit lines. **M:** redaction sentinel; 0 PII fields; JSONL shape with level/code/correlation id. Owner: audit. Test: redaction suite. |
| Denial of service | Audit write failure hangs the tool call. **M:** `AUDIT_WRITE_FAILED` catalogue code; `withTimeout` on every async boundary. Owner: audit. Test: write-failure cases. |
| Elevation of privilege | Audit write escapes policy. **M:** `SCHEMA_INVALID` for unknown keys; canonical paths reject `PATH_ESCAPE`/`CREDENTIAL_PATH_DENIED`. Owner: fs/policy. Test: policy/canonicalize properties. |

### X5 — CIPipeline → Release (provenance)

| STRIDE | Threat + mitigation |
|---|---|
| Spoofing | Forged release artifacts. **M:** build job (contents:read, 0 write grants, no persisted checkout credential) → publish job (4 write grants, 0 npm install/build/pack); `gh attestation verify` on tarball + SHA256SUMS + SBOM. Owner: CI/release. Test: attestation verification on a real release run. |
| Tampering | Mutated tarball post-build. **M:** publish regenerates version files and `CHANGELOG.md` and fails unless byte-equal to the packed copy; atomic push (release commit + tag). Owner: release. Test: release workflow cases. |
| Repudiation | Release without record. **M:** release action/tag/version/date recorded in `plan.txt`; changelog from `git log` grouped by Conventional Commit type; removed-feature filter via revert pairs / `Removes:` trailers. Owner: release. Test: changelog/remove cases. |
| Information disclosure | Secret in SBOM/logs. **M:** scanner output contains 0 secrets; vulnerability reports via private GitHub reporting. Owner: A10. Test: publish scanner. |
| Denial of service | Rollback availability. **M:** manual rollback marks the test release a prerelease and re-points docs to a validated known-good tag; changes no tag/asset/main. Owner: release. Test: rollback workflow case. |
| Elevation of privilege | Build code with publish privileges. **M:** privilege split — build holds read-only, publish downloads only the build artifact. Owner: CI/A10. Test: job permission sets. |

### X6 — SandboxContainer → AndaEngine (HTTP bridge)

| STRIDE | Threat + mitigation |
|---|---|
| Spoofing | Version-mismatched bridge. **M:** version handshake; mismatch fails `ANDA_VERSION_MISMATCH`. Owner: anda-client. Test: handshake cases. |
| Tampering | Malformed bridge response. **M:** shape check (`anda/shape.ts`); unreachable → `ANDA_UNREACHABLE`, degraded, bounded backoff + jitter. Owner: anda-client. Test: bridge cases. |
| Repudiation | Bridge calls unlogged. **M:** same dispatch/audit path as other tools. Owner: tools-dispatcher. Test: dispatch coverage. |
| Information disclosure | Engine licence violation (ANDA-01..04). **M:** licence-blocked, carried outside v3.0; no shim — Realm reaches Anda over HTTP, Anda consumes Realm over MCP. Owner: A10. Test: licence checks. |
| Denial of service | Bridge outage hangs the session. **M:** `withTimeout` + reconnect backoff. Owner: anda-client. Test: backoff schedule. |
| Elevation of privilege | Bridge escalation into the sandbox. **M:** Anda runs as a separate service, reached over HTTP; nothing nests OpenShell inside the Realm container. Owner: runtime. Test: runtime-decision invariants. |

## 3. Open questions (for A10/A01 — not resolved by A03)

1. **X2 guard vs containment (D3, OMPX-03):** the spike recorded a `write` transport surviving removal of the built-in `write`. Product claims must follow what the spike proves; the residual containment risk on the native transport needs A10's acceptance, not A03's.
2. **X5 release licence window:** AGPL-3.0-only + Apache-2.0 `NOTICE` matrix needs A10 sign-off for the 0.3.x line.
3. **HARN-03 (X1):** port 9931 allowlisting + `LLAMA_CPP_BASE_URL` lever — owner decision; does not change the threat grid but changes the AC-3 evidence bar.
4. **Security policy absent in the handover:** no `security.policy` artifact was attached to `Tc8fd-arch` inputs. This grid is derived from spec/AGENTS.md/ROADMAP instead; A10 should confirm or supersede with a written policy before implementation tasks open.

## 4. Out of scope

No new threat-model text is invented beyond the containers already in the blueprint; cells that cannot be filled with a control + owner + test would be open questions (§3), never marked accepted.

## 5. v9.0 addendum (Ta08e-arch) — toggle, widget paint, start diagnostic

**Status:** proposed deltas, A10 co-sign pending. No risk is marked accepted by A03.

### X1 addendum — Operator/OmpHost → RealmDaemon (toggle)

| STRIDE | Threat + mitigation |
|---|---|
|---|---|
| Spoofing | Forged toggle value silencing the plugin. **M:** toggle is operator-owned persisted state (manifest/settings), not model input; invalid values fail the load, never silence silently. Owner: omp-extension edge. Test: invalid-toggle load refusal. |
| Elevation of privilege | Off-path leaves built-ins free to mutate unsandboxed. **M:** off registers 0 Realm tools and arms 0 attach paths; the fail-closed guard is the host's own default, not Realm's to weaken. Residual: with the plugin off, Omp runs unguarded by design — operator choice, stated in the contract, never a pass. Owner: omp-plugin. Test: hermetic 0-registration/0-paint/0-mutation |

### X7 addendum — OmpHost additional UI (widget paint)

| STRIDE | Threat + mitigation |
|---|---|
| Tampering | Widget text spoofing a state Realm never reported. **M:** painted text is `renderRealmStatus` output from the daemon snapshot via the single `paint()` funnel; 0 second paint paths; cache keyed per UI. Owner: omp-plugin. Test: 4-of-4 snapshot equality (AC-40) |
| Information disclosure | Path or secret in widget text. **M:** status text carries label, reason (catalogue code or fixed reason), time, mode only; never a path, token, or daemon text. Owner: plugin/status. Test: text-shape assertions |

### X1 addendum — start diagnostic (workspaceRoot)

| STRIDE | Threat + mitigation |
|---|---|
| Information disclosure | Missing-directory naming leaks a path. **M:** naming is operator-local only (stderr/doctor); audit and request logs keep fixed text with 0 values; no telemetry. Owner: daemon/fs. Test: audit redaction suite (NFR-C1) + log-shape check |
