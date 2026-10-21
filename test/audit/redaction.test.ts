import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REDACTED,
  SECRET_VALUE_PATTERNS,
  redactString,
  redactValue,
} from "../../src/audit/redact.js";

// Every assertion checks the sentinel's absence from the serialized output, not only
// that a key was replaced (AUD-01, threat T-02-08).
function serialized(value: unknown): string {
  return String(JSON.stringify(redactValue(value)));
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
  test(`key layer: a value under the key ${key} is replaced with [REDACTED] (AUD-01)`, () => {
    const SECRET = `KEYLAYER-SENTINEL-${key}`;
    const out = redactValue({ [key]: SECRET }) as Record<string, unknown>;
    assert.equal(out[key], REDACTED);
    assert.equal(serialized({ [key]: SECRET }).includes(SECRET), false);
  });
}

test("key layer replaces a non-string value under a credential key with [REDACTED] (AUD-01)", () => {
  const out = redactValue({ token: { nested: ["x", "y"] } }) as Record<string, unknown>;
  assert.equal(out["token"], REDACTED);
});

test("key layer applies inside nested objects and arrays (AUD-01)", () => {
  const SECRET = "KEYLAYER-NESTED-SENTINEL";
  const input = { outer: [{ inner: { password: SECRET } }] };
  assert.equal(serialized(input).includes(SECRET), false);
});

test("value layer: a Bearer token is replaced (AUD-01)", () => {
  const SECRET = "SECRETBEARER123abc";
  const text = "Authorization header carried Bearer " + SECRET + " here";
  assert.equal(redactString(text).includes(SECRET), false);
  assert.match(redactString(text), /\[REDACTED\]/);
});

test("value layer: a PEM private key block is replaced (AUD-01)", () => {
  const SECRET = "SECRETPEMBODYLINE";
  const text = `-----BEGIN RSA PRIVATE KEY-----\n${SECRET}\n-----END RSA PRIVATE KEY-----`;
  assert.equal(redactString(text).includes(SECRET), false);
});

test("value layer: a PEM private key truncated before its end marker is still replaced (fail closed)", () => {
  const SECRET = "SECRETPEMTRUNCATEDLINE";
  const text = `-----BEGIN PRIVATE KEY-----\n${SECRET}`;
  assert.equal(redactString(text).includes(SECRET), false);
});

test("value layer: an AWS access key id (AKIA + 16) is replaced (AUD-01)", () => {
  const key = "AKIAABCDEFGHIJKLMNOP";
  assert.equal(redactString(`key=${key}`).includes(key), false);
});

test("value layer: a GitHub token (gh[pousr]_ with 20 or more characters) is replaced (AUD-01)", () => {
  const token = "ghp_SECRETGITHUBTOKEN0123456789";
  assert.equal(redactString(`git push with ${token}`).includes(token), false);
});

test("value layer: an sk- token with 20 or more characters is replaced (AUD-01)", () => {
  const token = "sk-SECRETOPENAIKEY0123456789";
  assert.equal(redactString(`model key ${token}`).includes(token), false);
});

test("value layer: a short gh_ or sk- string below the length threshold is left unchanged", () => {
  assert.equal(redactString("ghp_short123"), "ghp_short123");
  assert.equal(redactString("sk-short"), "sk-short");
});

for (const name of ["GITHUB_TOKEN", "DB_PASSWORD", "API_KEY", "CLIENT_SECRET"]) {
  test(`value layer: NAME=value with ${name} keeps the name and replaces the value (AUD-01)`, () => {
    const SECRET = `SECRETASSIGN${name}123`;
    const out = redactString(`${name}=${SECRET} next`);
    assert.equal(out.includes(SECRET), false);
    assert.equal(out, `${name}=${REDACTED} next`);
  });
}

test("value layer leaves ordinary text unchanged", () => {
  const text = "list the workspace root and report the file count";
  assert.equal(redactString(text), text);
});

test("depth limit fails closed: a secret below the depth limit is replaced with [REDACTED] (T-02-09)", () => {
  const SECRET = "DEEPSENTINEL-LEAF-VALUE";
  let node: Record<string, unknown> = { leaf: SECRET };
  for (let level = 0; level < 20; level += 1) {
    node = { child: node };
  }
  const text = serialized(node);
  assert.equal(text.includes(SECRET), false);
  assert.match(text, /\[REDACTED\]/);
});

test("depth limit keeps shallow values intact", () => {
  const out = redactValue({ shallow: "visible", deep: { a: { b: { c: "x" } } } }) as Record<
    string,
    unknown
  >;
  assert.equal(out["shallow"], "visible");
});

test("a circular structure is serialized without throwing and its cycle is replaced (T-02-09)", () => {
  const node: Record<string, unknown> = { name: "loop" };
  node["self"] = node;
  const text = serialized(node);
  assert.match(text, /"name":"loop"/);
  assert.match(text, /\[REDACTED\]/);
});

test("unusual values never throw and never echo a secret", () => {
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
    assert.equal(text.includes(SECRET), false, `value leaked for ${String(text)}`);
  }
});

test("the frozen secret-pattern table cannot be extended at runtime", () => {
  assert.equal(Object.isFrozen(SECRET_VALUE_PATTERNS), true);
});

test("spec n5 credential leakage: no host secret shape survives a nested tool input (AUD-01)", () => {
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
