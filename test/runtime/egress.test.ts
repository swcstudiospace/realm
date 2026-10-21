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

test("RT-05: exact multi-label hostnames and IPv4 literals with ports 1 and 65535 are accepted", () => {
  const rules = [
    { host: "registry.example.com", port: 443 },
    { host: "api-2.internal.example.org", port: 8080 },
    { host: "10.0.0.5", port: 1 },
    { host: "203.0.113.9", port: 65535 },
  ];
  assert.deepEqual(validateEgressAllow(rules), rules);
});

test("RT-05: an empty allowlist validates to an empty list", () => {
  assert.deepEqual(validateEgressAllow([]), []);
});

test("RT-05: an IPv6 literal, with or without brackets, is refused with SCHEMA_INVALID", () => {
  for (const host of ["::1", "2001:db8::1", "[2001:db8::1]", "fe80::1%eth0", "::ffff:203.0.113.9"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

test("RT-05: a wildcard host is refused with SCHEMA_INVALID", () => {
  for (const host of ["*", "*.example.com", "api.*.example.com"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

test("RT-05: localhost and names under .localhost are refused with SCHEMA_INVALID", () => {
  for (const host of ["localhost", "LOCALHOST", "api.localhost"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 80 }])), "SCHEMA_INVALID", host);
  }
});

test("RT-05: loopback 127.0.0.0/8, link-local 169.254.0.0/16, and unspecified 0.0.0.0 are refused with SCHEMA_INVALID", () => {
  for (const host of ["127.0.0.1", "127.255.0.9", "169.254.169.254", "0.0.0.0"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

test("RT-05: a port outside 1 to 65535, or not an integer, is refused with SCHEMA_INVALID", () => {
  for (const port of [0, -1, 65536, 1.5, Number.NaN, "443", null]) {
    assert.equal(
      rejectionCode(() => validateEgressAllow([{ host: "registry.example.com", port }])),
      "SCHEMA_INVALID",
      String(port),
    );
  }
});

test("RT-05: a malformed hostname or IPv4 literal is refused with SCHEMA_INVALID", () => {
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
    `${"a".repeat(64)}.example.com`,
  ];
  for (const host of hosts) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

test("RT-05: an IPv4 literal with a leading-zero octet is refused with SCHEMA_INVALID, so no octal reading can differ from the decimal one", () => {
  for (const host of ["010.0.0.1", "127.000.0.1", "0177.0.0.1", "10.00.0.1", "10.0.0.01", "10.0.09.1"]) {
    assert.equal(rejectionCode(() => validateEgressAllow([{ host, port: 443 }])), "SCHEMA_INVALID", host);
  }
});

test("RT-05: canonical IPv4 literals, including single-digit 0 octets, are still accepted", () => {
  const rules = [
    { host: "10.0.0.1", port: 443 },
    { host: "10.10.0.1", port: 443 },
    { host: "203.0.113.0", port: 443 },
  ];
  assert.deepEqual(validateEgressAllow(rules), rules);
});

test("RT-05: a non-string host is refused with SCHEMA_INVALID", () => {
  assert.equal(rejectionCode(() => validateEgressAllow([{ host: 443, port: 443 }])), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => validateEgressAllow([{ host: null, port: 443 }])), "SCHEMA_INVALID");
});

test("RT-05: an allowlist that is not an array, or an entry that is not an object, is refused with SCHEMA_INVALID", () => {
  assert.equal(rejectionCode(() => validateEgressAllow({ host: "registry.example.com", port: 443 })), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => validateEgressAllow(["registry.example.com:443"])), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => validateEgressAllow([null])), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => validateEgressAllow([["registry.example.com", 443]])), "SCHEMA_INVALID");
});

test("RT-05: a refused entry's value does not appear in the thrown error", () => {
  const host = "fe80::1";
  const error = rejection(() => validateEgressAllow([{ host, port: 443 }]));
  assert.equal(error.code, "SCHEMA_INVALID");
  assert.ok(!error.message.includes("fe80"), "the error message must not carry the host");
  assert.ok(!JSON.stringify(error).includes("fe80"), "the serialized error must not carry the host");
});

test("RT-05: the validated list is a frozen copy, so later changes to the caller's entries do not reach it", () => {
  const input = [{ host: "registry.example.com", port: 443 }];
  const validated = validateEgressAllow(input);
  input[0] = { host: "10.0.0.5", port: 80 };
  assert.deepEqual(validated, [{ host: "registry.example.com", port: 443 }]);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated[0]));
});

// ---- Task 2: renderNetworkPolicies (D-78) -----------------------------------------------------

test("RT-05: an empty allowlist renders to {} (deny-all)", () => {
  assert.deepEqual(renderNetworkPolicies([], BINARY), {});
});

test("RT-05: a non-empty allowlist renders the exact D-78 shape, sorted by host then port and keyed egress_<n> from 0", () => {
  const rendered = renderNetworkPolicies(
    [
      { host: "registry.example.com", port: 443 },
      { host: "10.0.0.5", port: 80 },
    ],
    BINARY,
  );
  assert.deepEqual(rendered, {
    egress_0: {
      name: "10.0.0.5:80",
      endpoints: [{ host: "10.0.0.5", port: 80 }],
      binaries: [{ path: BINARY }],
    },
    egress_1: {
      name: "registry.example.com:443",
      endpoints: [{ host: "registry.example.com", port: 443 }],
      binaries: [{ path: BINARY }],
    },
  });
});

test("RT-05: rules with the same host are ordered by port", () => {
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

test("RT-05: no rendered host contains a colon, and every key is in the D-78 set", () => {
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

test("RT-05: the rendered document writes none of the forbidden fields and no _provider_ key", () => {
  const rendered = renderNetworkPolicies([{ host: "registry.example.com", port: 443 }], BINARY);
  const keys = new Set(keysDeep(rendered));
  for (const forbidden of FORBIDDEN_KEYS) {
    assert.ok(!keys.has(forbidden), `forbidden key "${forbidden}" was rendered`);
  }
  assert.ok(![...keys].some((key) => key.startsWith("_provider_")), "no _provider_ key may be rendered");
});

test("RT-05: a shuffled allowlist renders identical output, so the order is deterministic", () => {
  const a = { host: "alpha.example.com", port: 443 };
  const b = { host: "beta.example.com", port: 80 };
  const c = { host: "beta.example.com", port: 8080 };
  const forward = renderNetworkPolicies([a, b, c], BINARY);
  const shuffled = renderNetworkPolicies([c, a, b], BINARY);
  assert.deepEqual(shuffled, forward);
  assert.equal(JSON.stringify(shuffled), JSON.stringify(forward));
});

test("RT-05: the renderer does not reorder the caller's allowlist", () => {
  const input = [
    { host: "registry.example.com", port: 443 },
    { host: "10.0.0.5", port: 80 },
  ];
  renderNetworkPolicies(input, BINARY);
  assert.deepEqual(input, [
    { host: "registry.example.com", port: 443 },
    { host: "10.0.0.5", port: 80 },
  ]);
});

test("RT-05: the rendered document and its entries are frozen", () => {
  const rendered = renderNetworkPolicies([{ host: "registry.example.com", port: 443 }], BINARY);
  assert.ok(Object.isFrozen(rendered));
  const entry = rendered["egress_0"];
  assert.ok(entry !== undefined && Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry.endpoints));
  assert.ok(Object.isFrozen(entry.binaries));
});

test("RT-05: an invalid host is refused by the renderer with SCHEMA_INVALID before anything is rendered", () => {
  assert.equal(rejectionCode(() => renderNetworkPolicies([{ host: "[::1]", port: 443 }], BINARY)), "SCHEMA_INVALID");
});

test("RT-05: a workload binary that is not an absolute path is refused with SCHEMA_INVALID, because an empty binaries match matches nothing (D-79)", () => {
  const rules = [{ host: "registry.example.com", port: 443 }];
  assert.equal(rejectionCode(() => renderNetworkPolicies(rules, "agent")), "SCHEMA_INVALID");
  assert.equal(rejectionCode(() => renderNetworkPolicies(rules, "")), "SCHEMA_INVALID");
});
