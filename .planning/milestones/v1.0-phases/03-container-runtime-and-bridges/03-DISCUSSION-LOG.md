# Phase 3: Container Runtime and Bridges - Discussion Log

Mode: `--auto`. Every gray area was resolved by the recommended option, derived from the spec, the settled inputs S-07 to S-12, and the frozen Phase 1 and Phase 2 contracts. No question was put to the user.

## Areas resolved

| Area | Options considered | Chosen | Basis |
|------|--------------------|--------|-------|
| OpenShell launch model | Nested inside a Realm container (spec LAYER_STACK, RT-03 wording) / host gateway creates the sandbox through its Podman driver (settled) | Host gateway, Podman driver (D-46, D-47) | S-08 settled by the user; openshell.md Q1 documents this model |
| Requirement wording for RT-01 and RT-03 | Edit the requirement text / record the conflict and keep the settled layering | Record only (D-46, D-47); reported to the user | Settled inputs must not be reopened; requirement text is not edited by planning |
| Live Podman tests on 4.9.3 | Install 5.x / gate with a skip reason | Gate with `PODMAN_UNSUPPORTED_VERSION`; fake libpod server for units (D-48) | S-09 |
| OpenShell CLI version | Use the docs 0.1.5 verbs / pin the 0.1.2 verbs | Pin 0.1.2; record drift (D-55) | S-10 |
| Anda boundary | Socket JSON-RPC / HTTP / Rust shim | HTTP over `GET /.well-known/information` only (D-61, D-66) | S-12; anda.md Q1 (documented anonymous route) |
| Anda version handshake | Advertised version (not documented) / shape handshake on AppInformation | Shape handshake; limitation recorded (D-61) | anda.md Q4: no version surface documented |
| Anda RPC and credentials | Implement `POST /{id}` now / defer | Defer (OQ-P3-10) | anda.md Q2, Q3: RPC layout and credentials not documented; not needed for the bridge |
| Anda JSON or CBOR | Add a CBOR dependency / JSON only | JSON only, no new dependency (D-61) | No dependency added without registry verification |
| AgentOS mode | Hosted (Docker worker, Podman not documented) / library | Library primary; hosted gated (S-11) | agentos.md Q8, Q1 |
| AgentOS concrete driver | Write the binding now / port only | Port only; binding blocked (D-59; OQ-P3-05, OQ-P3-06) | Package not verified; in-sandbox channel not documented |
| Policy document format | Add a YAML dependency / JSON (valid YAML 1.2) | JSON (D-57; OQ-P3-15) | No dependency added |
| Egress in Phase 3 | Write endpoint allowlist now / deny-all only | Deny-all `network_policies: {}`; allowlist in Phase 4 (D-57) | RT-05 is Phase 4; endpoint key names not recorded |
| Container create | Realm creates it with libpod / OpenShell creates it | OpenShell creates; Realm verifies (D-47) | S-08 |
| Hardening values | Dynamic / one constant | One `HARDENING_PROFILE` constant (D-51) | Single contract for RT-01 |
| Controller and degraded | Probe produces degraded / bridge produces degraded | Bridge produces degraded; probe stays exec-only (D-64) | Phase 2 D-38 deferred this to Phase 3 |
| Startup Anda unreachable | Degraded at startup (no legal edge from connecting) / error after bounded retry | error with `ANDA_UNREACHABLE` (D-64) | Transition table in states.ts; spec FAILURE_CASES |
| CORE-05 gate timing | Queue wait / synchronous decision | Synchronous; queue wait is Phase 4 (D-63) | TOOL-04 is Phase 4; "never hangs" |
| `realm down` | Per-session removal only / labelled sweep with proof | Sweep plus per-session destroy (D-68) | RT-09 wording "every container carrying the realm label" |
| Doctor items in Phase 3 | Register all of D-44's list / only inspectable items | Podman, socket, OpenShell verbs, Anda; no AgentOS (D-69) | D-44 forbids reporting on what cannot be inspected |
| Test directories | Spec file names (`test/runtime/podman.integration.test.ts`) / keep gated bodies in `test/integration/` | `test/integration/` (D-48, D-70) | QUAL-02 taxonomy requires skip reasons under `test/integration/` |

## Open items carried out of this log

OQ-P3-01 to OQ-P3-16 in `03-CONTEXT.md`. Each has a default and the module it blocks. Two requirement-wording conflicts (RT-01, RT-03) are reported for the user, not edited.
