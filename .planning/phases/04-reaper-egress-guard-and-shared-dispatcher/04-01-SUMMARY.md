# Plan 04-01 Summary: Egress guard core (RT-05, D-77, D-78)

## Status

Implemented by inspection. Build, typecheck, and tests were not run by this lane, per the wave
instructions. The orchestrator runs `npx tsc -p tsconfig.json && node --test dist/test/runtime/egress.test.js`
after the wave lands. Nothing here is live-verified; the live egress proof is gated (OQ-P4-01, OQ-P4-02).

## Files

- `src/runtime/egress.ts` (new): `validateEgressAllow(rules)` (D-77) and `renderNetworkPolicies(rules, workloadBinary)` (D-78).
- `test/runtime/egress.test.ts` (new): RT-05 accept, refuse, empty, shape, forbidden-key, and determinism tests.

## Evidence for the must_haves

Truth 1 (D-77 accept and refuse): exact hostnames and IPv4 literals are accepted by
"RT-05: exact multi-label hostnames and IPv4 literals with ports 1 and 65535 are accepted". IPv6 literals,
wildcards, localhost, loopback, link-local, and unspecified hosts are refused with SCHEMA_INVALID by
"RT-05: an IPv6 literal, with or without brackets, is refused with SCHEMA_INVALID", "RT-05: a wildcard host is
refused with SCHEMA_INVALID", "RT-05: localhost and names under .localhost are refused with SCHEMA_INVALID", and
"RT-05: loopback 127.0.0.0/8, link-local 169.254.0.0/16, and unspecified 0.0.0.0 are refused with SCHEMA_INVALID".
Out-of-range ports are refused by "RT-05: a port outside 1 to 65535, or not an integer, is refused with SCHEMA_INVALID".

Truth 2 (D-78 render): an empty allowlist renders to `{}` by "RT-05: an empty allowlist renders to {} (deny-all)".
The exact entry shape and `egress_<n>` keys are pinned by "RT-05: a non-empty allowlist renders the exact D-78 shape,
sorted by host then port and keyed egress_<n> from 0". Determinism is pinned by "RT-05: a shuffled allowlist renders
identical output, so the order is deterministic" and "RT-05: rules with the same host are ordered by port".

Truth 3 (no colon in host, no key outside D-78): "RT-05: no rendered host contains a colon, and every key is in the
D-78 set" and "RT-05: the rendered document writes none of the forbidden fields and no _provider_ key".

## Decisions applied beyond the plan text

- `validateEgressAllow` takes `unknown` (the runtime path is untrusted) and returns a frozen copy of `{host, port}`
  entries. The copy means later changes to the caller's array cannot reach the validated list.
- `renderNetworkPolicies` runs `validateEgressAllow` before rendering, so an invalid host is never rendered.
- `renderNetworkPolicies` refuses a non-absolute `workloadBinary` with SCHEMA_INVALID, because an empty `binaries`
  list matches no executable (D-79). Covered by the last test in the file.
- Refusals beyond the named host classes, all within D-77's "exact DNS hostname" wording:
  - names under `.localhost` are refused, not only `localhost`;
  - a final all-digit label must be a valid dotted IPv4 literal, so `10.0.0` and `example.123` are refused;
  - octets with leading zeros are refused.
- Host case is not normalized. `Example.com` and `example.com` would render as two entries.

## Open items

- Duplicate `host:port` rules render as two entries with the same `name`. The plan does not address duplicates,
  so the default is to leave them as rendered. Revisit with OQ-P4-02 if OpenShell rejects duplicate names.
- No new error code, policy key, or dependency is added (D-101).
