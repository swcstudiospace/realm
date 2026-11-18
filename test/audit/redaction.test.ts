import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mintToken } from "../../src/capability/token.js";
import {
  REDACTED,
  SECRET_VALUE_PATTERNS,
  redactString,
  redactValue,
} from "../../src/audit/redact.js";

// Every assertion checks the sentinel's absence from the serialized output, not only
// that a key was replaced (AUD-01, threat T-02-08).
function serialized(value: unknown): string {
  // JSON.stringify returns undefined, not a string, for undefined input; String keeps that output text.
  const json = JSON.stringify(redactValue(value)) as string | undefined;
  return String(json);
}

const CREDENTIAL_KEYS = [
  "token",
  "accessToken",
  "client_secret",
  "db-password",
  "passwd",
  "x-api-key",
  "API_KEY",
  "apikey",
  "Authorization",
  "Cookie",
  "credentials",
  "private-key",
  "privateKey",
];

for (const key of CREDENTIAL_KEYS) {
  void test(`key layer: a value under the key ${key} is replaced with [REDACTED] (AUD-01)`, () => {
    const SECRET = `KEYLAYER-SENTINEL-${key}`;
    const out = redactValue({ [key]: SECRET }) as Record<string, unknown>;
    assert.equal(out[key], REDACTED);
    assert.equal(serialized({ [key]: SECRET }).includes(SECRET), false);
  });
}

void test("key layer replaces a non-string value under a credential key with [REDACTED] (AUD-01)", () => {
  const out = redactValue({ token: { nested: ["x", "y"] } }) as Record<string, unknown>;
  assert.equal(out["token"], REDACTED);
});

void test("key layer applies inside nested objects and arrays (AUD-01)", () => {
  const SECRET = "KEYLAYER-NESTED-SENTINEL";
  const input = { outer: [{ inner: { password: SECRET } }] };
  assert.equal(serialized(input).includes(SECRET), false);
});

void test("value layer: a Bearer token is replaced (AUD-01)", () => {
  const SECRET = "SECRETBEARER123abc";
  const text = "Authorization header carried Bearer " + SECRET + " here";
  assert.equal(redactString(text).includes(SECRET), false);
  assert.match(redactString(text), /\[REDACTED\]/);
});

void test("value layer: a PEM private key block is replaced (AUD-01)", () => {
  const SECRET = "SECRETPEMBODYLINE";
  const text = `-----BEGIN RSA PRIVATE KEY-----\n${SECRET}\n-----END RSA PRIVATE KEY-----`;
  assert.equal(redactString(text).includes(SECRET), false);
});

void test("value layer: a PEM private key truncated before its end marker is still replaced (fail closed)", () => {
  const SECRET = "SECRETPEMTRUNCATEDLINE";
  const text = `-----BEGIN PRIVATE KEY-----\n${SECRET}`;
  assert.equal(redactString(text).includes(SECRET), false);
});

void test("value layer: an AWS access key id (AKIA + 16) is replaced (AUD-01)", () => {
  const key = "AKIAABCDEFGHIJKLMNOP";
  assert.equal(redactString(`key=${key}`).includes(key), false);
});

void test("value layer: a GitHub token (gh[pousr]_ with 20 or more characters) is replaced (AUD-01)", () => {
  const token = "ghp_SECRETGITHUBTOKEN0123456789";
  assert.equal(redactString(`git push with ${token}`).includes(token), false);
});

void test("value layer: an sk- token with 20 or more characters is replaced (AUD-01)", () => {
  const token = "sk-SECRETOPENAIKEY0123456789";
  assert.equal(redactString(`model key ${token}`).includes(token), false);
});

void test("value layer: a short gh_ or sk- string below the length threshold is left unchanged", () => {
  assert.equal(redactString("ghp_short123"), "ghp_short123");
  assert.equal(redactString("sk-short"), "sk-short");
});

for (const name of ["GITHUB_TOKEN", "DB_PASSWORD", "API_KEY", "CLIENT_SECRET"]) {
  void test(`value layer: NAME=value with ${name} keeps the name and replaces the value (AUD-01)`, () => {
    const SECRET = `SECRETASSIGN${name}123`;
    const out = redactString(`${name}=${SECRET} next`);
    assert.equal(out.includes(SECRET), false);
    assert.equal(out, `${name}=${REDACTED} next`);
  });
}

void test("value layer leaves ordinary text unchanged", () => {
  const text = "list the workspace root and report the file count";
  assert.equal(redactString(text), text);
});

void test("depth limit fails closed: a secret below the depth limit is replaced with [REDACTED] (T-02-09)", () => {
  const SECRET = "DEEPSENTINEL-LEAF-VALUE";
  let node: Record<string, unknown> = { leaf: SECRET };
  for (let level = 0; level < 20; level += 1) {
    node = { child: node };
  }
  const text = serialized(node);
  assert.equal(text.includes(SECRET), false);
  assert.match(text, /\[REDACTED\]/);
});

void test("depth limit keeps shallow values intact", () => {
  const out = redactValue({ shallow: "visible", deep: { a: { b: { c: "x" } } } }) as Record<
    string,
    unknown
  >;
  assert.equal(out["shallow"], "visible");
});

void test("a circular structure is serialized without throwing and its cycle is replaced (T-02-09)", () => {
  const node: Record<string, unknown> = { name: "loop" };
  node["self"] = node;
  const text = serialized(node);
  assert.match(text, /"name":"loop"/);
  assert.match(text, /\[REDACTED\]/);
});

void test("unusual values never throw and never echo a secret", () => {
  const SECRET = "UNUSUAL-SENTINEL-VALUE";
  const hostile: unknown[] = [
    undefined,
    null,
    Number.NaN,
    Symbol(SECRET),
    () => SECRET,
    10n,
    new Map([[SECRET, SECRET]]),
    Object.create(null),
    new Proxy({}, {
      ownKeys() {
        throw new Error(SECRET);
      },
    }),
    {
      get boom(): string {
        throw new Error(SECRET);
      },
    },
  ];
  for (const item of hostile) {
    const text = serialized(item);
    assert.equal(text.includes(SECRET), false, `value leaked for ${text}`);
  }
});

void test("the frozen secret-pattern table cannot be extended at runtime", () => {
  assert.equal(Object.isFrozen(SECRET_VALUE_PATTERNS), true);
});

void test("spec n5 credential leakage: no host secret shape survives a nested tool input (AUD-01)", () => {
  const input = {
    argv: [
      "curl",
      "-H",
      "Authorization: Bearer SECRETBEARERN5VALUE",
      "--token=SECRETFLAGN5VALUE",
    ],
    env: { GITHUB_TOKEN: "ghp_SECRETGITHUBN5TOKEN0123", PLAIN: "ok" },
    key: "AKIAN5LEAKEDKEYABCDEF",
    pem: "-----BEGIN OPENSSH PRIVATE KEY-----\nSECRETN5PEMBODY\n-----END OPENSSH PRIVATE KEY-----",
  };
  const text = serialized(input);
  for (const secret of [
    "SECRETBEARERN5VALUE",
    "SECRETFLAGN5VALUE",
    "ghp_SECRETGITHUBN5TOKEN0123",
    "AKIAN5LEAKEDKEYABCDEF",
    "SECRETN5PEMBODY",
  ]) {
    assert.equal(text.includes(secret), false, `secret survived: ${secret}`);
  }
  assert.match(text, /"PLAIN":"ok"/);
});

void test("a long name run with many credential words keeps its name and redacts only its own value (OBS-01)", () => {
  const name = "key".repeat(5000);
  assert.equal(redactString(`${name}=hunter2 plain=ok`), `${name}=${REDACTED} plain=ok`);
});

// CAPT-05: the token shape rcap1.PAYLOAD.MAC is redacted in every position, linearly.
// redactValue returns null-prototype objects, and strict deep equality compares prototypes; a JSON round trip gives
// plain objects without changing what redactValue returns.
function plainOf(value: unknown): unknown {
  return JSON.parse(JSON.stringify(redactValue(value))) as unknown;
}

const TOKEN = mintToken(randomBytes(32), {
  kid: "k1",
  sid: "11111111-2222-4333-8444-555555555555",
  host: "cursor",
  caps: ["fs.read", "fs.list"],
  iat: 1_700_000_000,
  exp: 1_700_003_600,
});
// The same token with its MAC cut off, and cut short inside the payload (still at least 8 payload characters).
const TOKEN_NO_MAC = TOKEN.slice(0, TOKEN.lastIndexOf("."));
const TOKEN_CUT = TOKEN.slice(0, 24);

for (const [name, text] of [
  ["a full token", TOKEN],
  ["a token with its MAC cut off", TOKEN_NO_MAC],
  ["a token cut inside the payload", TOKEN_CUT],
] as const) {
  void test(`token shape: ${name} is replaced by redactString and redactValue in every position (CAPT-05)`, () => {
    assert.equal(redactString(text), REDACTED);
    assert.equal(redactString(`the host sent ${text} twice`), `the host sent ${REDACTED} twice`);
    assert.equal(redactString(`Bearer ${text}`), REDACTED);
    assert.equal(redactString(`Authorization: Bearer ${text}`), `Authorization: ${REDACTED}`);
    assert.equal(redactString(`${text} and ${text}`), `${REDACTED} and ${REDACTED}`);
    // Under a key whose name carries no credential word, so only the value layer can catch it.
    assert.deepEqual(plainOf({ note: text }), { note: REDACTED });
    assert.deepEqual(plainOf({ outer: { list: [text, "plain"] } }), { outer: { list: [REDACTED, "plain"] } });
    // An exec argv element, as the audit line of an exec that names a token records it.
    assert.deepEqual(plainOf({ argv: ["curl", "-H", `X-Cap: ${text}`, "url"] }), {
      argv: ["curl", "-H", `X-Cap: ${REDACTED}`, "url"],
    });
    assert.equal(serialized({ argv: ["echo", text] }).includes(text.slice(6)), false);
    // The key layer still catches a key named token.
    assert.deepEqual(plainOf({ token: text }), { token: REDACTED });
  });
}

void test("token shape: the pattern is the last of the table, so the existing order is unchanged (CAPT-05)", () => {
  assert.equal(SECRET_VALUE_PATTERNS.length, 6);
  const last = SECRET_VALUE_PATTERNS.at(-1);
  assert.ok(last?.global === true && last.source.startsWith("rcap1"));
  assert.match(SECRET_VALUE_PATTERNS[0]?.source ?? "", /Bearer/);
});

void test("token shape: the word rcap1 alone, a short tail and ordinary text are unchanged (CAPT-05)", () => {
  for (const text of [
    "rcap1",
    "rcap1 is the token prefix",
    "rcap1.",
    "rcap1.abc",
    "rcap1.abcdefg",
    "rcap1.abcdefg and more words",
    "rcap2.abcdefghijkl",
    "RCAP1.abcdefghijkl",
    "list the workspace root",
  ]) {
    assert.equal(redactString(text), text);
    assert.deepEqual(plainOf({ note: text }), { note: text });
  }
});

void test("token shape: the minimum, 8 payload characters, is replaced and a trailing dot is kept in the match (CAPT-05)", () => {
  assert.equal(redactString("rcap1.abcdefgh"), REDACTED);
  assert.equal(redactString("rcap1.abcdefgh."), REDACTED);
  assert.equal(redactString("rcap1.abcdefgh.x y"), `${REDACTED} y`);
});

void test("token shape: redaction is linear in the length of the input (CAPT-05)", () => {
  // Guards against quadratic behaviour, not a benchmark: the bound is generous.
  const inputs = [
    `rcap1.${"a".repeat(100_000)}`,
    `rcap1.${"a".repeat(100_000)}.${"b".repeat(100_000)}`,
    ".".repeat(100_000),
    "rcap1.".repeat(20_000),
    "rcap1.abcdefg".repeat(10_000),
  ];
  for (const input of inputs) {
    const started = performance.now();
    redactString(input);
    assert.ok(performance.now() - started < 500, "redactString took 500 ms or more");
  }
});
