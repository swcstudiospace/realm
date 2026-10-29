import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { renderNetworkPolicies, validateEgressAllow } from "../../src/runtime/egress.js";

const BINARY = "/usr/bin/agent";

// The error thrown by a rejected call. Fails the test when the call is accepted.
function rejection(run: () => unknown): RealmError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof RealmError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to reject the input");
}

function rejectionCode(run: () => unknown): string {
  return rejection(run).code;
}

// The keys D-78 allows at each level of a rendered document.
const ALLOWED_KEYS: Readonly<Record<string, true>> = {
  name: true,
  endpoints: true,
  binaries: true,
  host: true,
  port: true,
  path: true,
};
const FORBIDDEN_KEYS = [
  "allowed_ips",
  "ports",
  "protocol",
  "access",
  "rules",
  "deny_rules",
  "network_middlewares",
] as const;

// Every key of every object in the rendered document, depth first.
function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => keysDeep(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]: [string, unknown]) => [key, ...keysDeep(child)]);
  }
  return [];
}

// ---- Task 1: validateEgressAllow (D-77) -------------------------------------------------------

void test("RT-05: exact multi-label hostnames and IPv4 literals with ports 1 and 65535 are accepted", () => {
  const rules = [
    { host: "registry.example.com", port: 443 },
    { host: "api-2.internal.example.org", port: 8080 },
    { host: "198.17.255.255", port: 1 },
    { host: "203.0.113.9", port: 65535 },
  ];
  assert.deepEqual(validateEgressAllow(rules), rules);
});

void test("RT-05: an empty allowlist validates to an empty list", () => {
  assert.deepEqual(validateEgressAllow([]), []);
});

void test("RT-05: an IPv6 literal, with or without brackets, is refused with SCHEMA_INVALID", () => {
  for (const host of ["::1", "2001:db8::1", "[2001:db8::1]", "fe80::1%eth0", "::ffff:203.0.113.9"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

void test("RT-05: a wildcard host is refused with SCHEMA_INVALID", () => {
  for (const host of ["*", "*.example.com", "api.*.example.com"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

void test("RT-05: localhost and names under .localhost are refused with SCHEMA_INVALID", () => {
  for (const host of ["localhost", "LOCALHOST", "api.localhost"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 80 }])), "SCHEMA_INVALID", host);
  }
});

void test("RT-05: loopback 127.0.0.0/8, link-local 169.254.0.0/16, and unspecified 0.0.0.0 are refused with SCHEMA_INVALID", () => {
  for (const host of ["127.0.0.1", "127.255.0.9", "169.254.169.254", "0.0.0.0"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

// Each refused range with its first and last address; each pair of neighbours is the address just outside.
const REFUSED_RANGES: readonly { readonly name: string; readonly first: string; readonly last: string; readonly below: string | undefined; readonly above: string | undefined }[] = [
  { name: "0.0.0.0/8", first: "0.0.0.0", last: "0.255.255.255", below: undefined, above: "1.0.0.0" },
  { name: "10.0.0.0/8", first: "10.0.0.0", last: "10.255.255.255", below: "9.255.255.255", above: "11.0.0.0" },
  { name: "100.64.0.0/10", first: "100.64.0.0", last: "100.127.255.255", below: "100.63.255.255", above: "100.128.0.0" },
  { name: "127.0.0.0/8", first: "127.0.0.0", last: "127.255.255.255", below: "126.255.255.255", above: "128.0.0.0" },
  { name: "169.254.0.0/16", first: "169.254.0.0", last: "169.254.255.255", below: "169.253.255.255", above: "169.255.0.0" },
  { name: "172.16.0.0/12", first: "172.16.0.0", last: "172.31.255.255", below: "172.15.255.255", above: "172.32.0.0" },
  { name: "192.0.0.0/24", first: "192.0.0.0", last: "192.0.0.255", below: "191.255.255.255", above: "192.0.1.0" },
  { name: "192.168.0.0/16", first: "192.168.0.0", last: "192.168.255.255", below: "192.167.255.255", above: "192.169.0.0" },
  { name: "198.18.0.0/15", first: "198.18.0.0", last: "198.19.255.255", below: "198.17.255.255", above: "198.20.0.0" },
  { name: "224.0.0.0/4 and 240.0.0.0/4", first: "224.0.0.0", last: "255.255.255.255", below: "223.255.255.255", above: undefined },
];

void test("RT-05: the first and last address of every non-public IPv4 range are refused with SCHEMA_INVALID", () => {
  for (const range of REFUSED_RANGES) {
    for (const host of [range.first, range.last]) {
      assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", `${range.name}: ${host}`);
    }
  }
});

void test("RT-05: an address inside a non-public range, away from its edges, is refused with SCHEMA_INVALID", () => {
  for (const host of ["10.1.2.3", "100.100.100.100", "172.20.5.5", "192.0.0.8", "192.168.1.1", "198.18.0.2", "224.0.0.251", "239.255.255.250", "240.0.0.1", "255.255.255.254"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

void test("RT-05: the address just outside every non-public IPv4 range is accepted", () => {
  for (const range of REFUSED_RANGES) {
    for (const host of [range.below, range.above]) {
      if (host === undefined) {
        continue;
      }
      assert.deepEqual(validateEgressAllow([{ host, port: 443 }]), [{ host, port: 443 }], `${range.name}: ${host}`);
    }
  }
});

void test("RT-05: public IPv4 literals stay accepted", () => {
  for (const host of ["1.1.1.1", "8.8.8.8", "203.0.113.9", "172.15.0.1", "172.32.0.1", "192.0.2.1", "192.169.0.1"]) {
    assert.deepEqual(validateEgressAllow([{ host, port: 443 }]), [{ host, port: 443 }], host);
  }
});

void test("RT-05: a port outside 1 to 65535, or not an integer, is refused with SCHEMA_INVALID", () => {
  for (const port of [0, -1, 65536, 1.5, Number.NaN, "443", null]) {
    assert.equal(
      rejectionCode(() => validateEgressAllow([{ host: "registry.example.com", port }])),
      "SCHEMA_INVALID",
      String(port),
    );
  }
});

void test("RT-05: a malformed hostname or IPv4 literal is refused with SCHEMA_INVALID", () => {
  const hosts = [
    "",
    "intranet",
    "example.com.",
    "-a.example.com",
    "a-.example.com",
    "my_host.example.com",
    "exa mple.com",
    "example..com",
    "10.0.0",
    "1.2.3.256",
    "010.0.0.1",
    "example.123",
    "8.8.8.8.",
    "8.8.8.\uff18",
    "example\u3002com",
    `${"a".repeat(64)}.example.com`,
  ];
  for (const host of hosts) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

void test("RT-05: an IPv4 literal with a leading-zero octet is refused with SCHEMA_INVALID, so no octal reading can differ from the decimal one", () => {
  for (const host of ["010.0.0.1", "127.000.0.1", "0177.0.0.1", "10.00.0.1", "10.0.0.01", "10.0.09.1"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

void test("RT-05: canonical IPv4 literals, including single-digit 0 octets, are still accepted", () => {
  const rules = [
    { host: "1.1.1.1", port: 443 },
    { host: "8.8.0.1", port: 443 },
    { host: "203.0.113.0", port: 443 },
  ];
  assert.deepEqual(validateEgressAllow(rules), rules);
});

void test("RT-05: IPv4 literals in hex or mixed notation are refused with SCHEMA_INVALID, because inet_aton would read them as private addresses", () => {
  const hosts = [
    "127.0.0.0x1",
    "0x7f.0.0.0x1",
    "169.254.169.0xfe",
    "10.0.0.0X1",
    "0x7f.0x0.0x0.0x1",
    "0X7F.0X0.0X0.0X1",
    "127.0.0.0x",
    "8.8.8.0x8",
    "1.1.1.0x01",
  ];
  for (const host of hosts) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

void test("RT-05: short decimal and hex forms, and a hex-only single label, are refused with SCHEMA_INVALID", () => {
  for (const host of ["127.1", "0x7f.1", "10.1", "2130706433", "0x7f000001", "0x7f", "0x", "a.0x7f", "example.0x7f"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

void test("RT-05: hostnames with a normal final label stay accepted even when an earlier label looks like hex", () => {
  for (const host of ["example.com", "a.b.c.internal", "nip.io", "host-0x7f.example.com", "0x.example.com", "0xdeadbeef.example.com", "0x7f.0x0.example.org", "1.1.1.1", "8.8.8.8"]) {
    assert.deepEqual(validateEgressAllow([{ host, port: 443 }]), [{ host, port: 443 }], host);
  }
});

void test("RT-05: a non-string host is refused with SCHEMA_INVALID", () => {
  assert.equal(rejectionCode(() => validateEgressAllow([{ host: 443, port: 443 }])), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => validateEgressAllow([{ host: null, port: 443 }])), "SCHEMA_INVALID");
});

void test("RT-05: an allowlist that is not an array, or an entry that is not an object, is refused with SCHEMA_INVALID", () => {
  assert.equal(rejectionCode(() => validateEgressAllow({ host: "registry.example.com", port: 443 })), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => validateEgressAllow(["registry.example.com:443"])), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => validateEgressAllow([null])), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => validateEgressAllow([["registry.example.com", 443]])), "SCHEMA_INVALID");
});

void test("RT-05: a refused entry's value does not appear in the thrown error", () => {
  const host = "fe80::1";
  const error = rejection(() => validateEgressAllow([{ host, port: 443 }]));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.ok(!error.message.includes("fe80"), "the error message must not carry the host");
  assert.ok(!JSON.stringify(error).includes("fe80"), "the serialized error must not carry the host");
});

void test("RT-05: the validated list is a frozen copy, so later changes to the caller's entries do not reach it", () => {
  const input = [{ host: "registry.example.com", port: 443 }];
  const validated = validateEgressAllow(input);
  input[0] = { host: "10.0.0.5", port: 80 };
  assert.deepEqual(validated, [{ host: "registry.example.com", port: 443 }]);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated[0]));
});

// ---- Task 2: renderNetworkPolicies (D-78) -----------------------------------------------------

void test("RT-05: an empty allowlist renders to {} (deny-all)", () => {
  assert.deepEqual(renderNetworkPolicies([], BINARY), {});
});

void test("RT-05: a non-empty allowlist renders the exact D-78 shape, sorted by host then port and keyed egress_<n> from 0", () => {
  const rendered = renderNetworkPolicies(
    [
      { host: "registry.example.com", port: 443 },
      { host: "203.0.113.5", port: 80 },
    ],
    BINARY,
  );
  assert.deepEqual(rendered, {
    egress_0: {
      name: "203.0.113.5:80",
      endpoints: [{ host: "203.0.113.5", port: 80 }],
      binaries: [{ path: BINARY }],
    },
    egress_1: {
      name: "registry.example.com:443",
      endpoints: [{ host: "registry.example.com", port: 443 }],
      binaries: [{ path: BINARY }],
    },
  });
});

void test("RT-05: rules with the same host are ordered by port", () => {
  const rendered = renderNetworkPolicies(
    [
      { host: "registry.example.com", port: 8443 },
      { host: "registry.example.com", port: 443 },
    ],
    BINARY,
  );
  assert.deepEqual(Object.keys(rendered), ["egress_0", "egress_1"]);
  assert.equal(rendered["egress_0"]?.name, "registry.example.com:443");
  assert.equal(rendered["egress_1"]?.name, "registry.example.com:8443");
});

void test("RT-05: no rendered host contains a colon, and every key is in the D-78 set", () => {
  const rendered = renderNetworkPolicies(
    [
      { host: "registry.example.com", port: 443 },
      { host: "203.0.113.9", port: 65535 },
    ],
    BINARY,
  );
  for (const entry of Object.values(rendered)) {
    for (const endpoint of entry.endpoints) {
      assert.ok(!endpoint.host.includes(":"), "a rendered host must not contain a colon");
    }
  }
  for (const key of Object.keys(rendered)) {
    assert.match(key, /^egress_\d+$/);
  }
  for (const key of keysDeep(rendered)) {
    assert.ok(ALLOWED_KEYS[key] === true || /^egress_\d+$/.test(key), `key "${key}" is outside the D-78 set`);
  }
});

void test("RT-05: the rendered document writes none of the forbidden fields and no _provider_ key", () => {
  const rendered = renderNetworkPolicies([{ host: "registry.example.com", port: 443 }], BINARY);
  const keys = new Set(keysDeep(rendered));
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.ok(!keys.has(forbidden), `forbidden key "${forbidden}" was rendered`);
  }
  assert.ok(![...keys].some((key) => key.startsWith("_provider_")), "no _provider_ key may be rendered");
});

void test("RT-05: a shuffled allowlist renders identical output, so the order is deterministic", () => {
  const a = { host: "alpha.example.com", port: 443 };
  const b = { host: "beta.example.com", port: 80 };
  const c = { host: "beta.example.com", port: 8080 };
  const forward = renderNetworkPolicies([a, b, c], BINARY);
  const shuffled = renderNetworkPolicies([c, a, b], BINARY);
  assert.deepEqual(shuffled, forward);
  assert.equal(JSON.stringify(shuffled), JSON.stringify(forward));
});

void test("RT-05: the renderer does not reorder the caller's allowlist", () => {
  const input = [
    { host: "registry.example.com", port: 443 },
    { host: "203.0.113.5", port: 80 },
  ];
  renderNetworkPolicies(input, BINARY);
  assert.deepEqual(input, [
    { host: "registry.example.com", port: 443 },
    { host: "203.0.113.5", port: 80 },
  ]);
});

void test("RT-05: the rendered document and its entries are frozen", () => {
  const rendered = renderNetworkPolicies([{ host: "registry.example.com", port: 443 }], BINARY);
  assert.ok(Object.isFrozen(rendered));
  const entry = rendered["egress_0"];
  assert.ok(entry !== undefined && Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.endpoints));
  assert.ok(Object.isFrozen(entry.binaries));
});

void test("RT-05: an invalid host is refused by the renderer with SCHEMA_INVALID before anything is rendered", () => {
  assert.equal(rejectionCode(() => renderNetworkPolicies([{ host: "[::1]", port: 443 }], BINARY)), "SCHEMA_INVALID");
});

void test("RT-05: a workload binary that is not an absolute path is refused with SCHEMA_INVALID, because an empty binaries match matches nothing (D-79)", () => {
  const rules = [{ host: "registry.example.com", port: 443 }];
  assert.equal(rejectionCode(() => renderNetworkPolicies(rules, "agent")), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => renderNetworkPolicies(rules, "")), "SCHEMA_INVALID");
});
