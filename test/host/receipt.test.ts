import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { SchemaInvalidError } from "../../src/contract/validate.js";
import { sha256Hex } from "../../src/fs/atomic-write.js";
import {
  parseReceipt,
  readReceipt,
  receiptPath,
  removeReceipt,
  serializeReceipt,
  writeReceipt,
  type Receipt,
} from "../../src/host/receipt.js";
import { resumeDecision, sha256Text } from "../../src/host/recipe.js";
import { makeFixtureHost } from "../support/fixture-host.js";

const H1 = sha256Text("one");
const H2 = sha256Text("two");

function sample(overrides: Partial<Receipt> = {}): Receipt {
  return {
    schemaVersion: 1,
    hostId: "claude",
    recipeKind: "json-merge",
    state: "installed",
    configHome: "/real/config/home",
    createdAt: "2026-01-01T00:00:00.000Z",
    entries: [
      {
        path: "settings.json",
        kind: "json-merge",
        beforeSha256: null,
        afterSha256: H1,
        ownedSha256: H2,
        createdFile: true,
        createdParents: [["mcpServers"]],
        createdDirs: [["sub"]],
      },
    ],
    ...overrides,
  };
}

function codeOf(error: unknown): string | undefined {
  return error instanceof RealmError ? error.code : undefined;
}

void test("a receipt round trips through serialize and parse, with a deterministic text", () => {
  const receipt = sample();
  const text = serializeReceipt(receipt);
  assert.deepEqual(parseReceipt(text), receipt);
  assert.equal(serializeReceipt(parseReceipt(text)), text);
  assert.ok(text.endsWith("\n"));
  const bundle = sample({
    recipeKind: "bundle-copy",
    entries: [{ path: "plugins/a.txt", kind: "bundle-copy", beforeSha256: H2, afterSha256: H1 }],
  });
  assert.deepEqual(parseReceipt(serializeReceipt(bundle)), bundle);
  const textBlock = sample({
    recipeKind: "text-block",
    entries: [{ path: "config.toml", kind: "text-block", beforeSha256: H1, afterSha256: H2, ownedSha256: H1, separatorAdded: true }],
  });
  assert.deepEqual(parseReceipt(serializeReceipt(textBlock)), textBlock);
});

void test("a receipt holds paths, booleans and hashes only", () => {
  const text = serializeReceipt(sample());
  const keys = new Set<string>();
  JSON.stringify(JSON.parse(text), (key, value: unknown) => {
    keys.add(key);
    return value;
  });
  for (const forbidden of ["content", "value", "block", "before", "after", "text"]) {
    assert.ok(!keys.has(forbidden), forbidden);
  }
});

void test("parseReceipt refuses every malformed receipt with SCHEMA_INVALID", () => {
  const good = JSON.parse(serializeReceipt(sample())) as Record<string, unknown>;
  const entry = (good["entries"] as Record<string, unknown>[])[0] ?? {};
  const withEntry = (patch: Record<string, unknown>): unknown => ({ ...good, entries: [{ ...entry, ...patch }] });
  const cases: [string, unknown][] = [
    ["array", []],
    ["null", null],
    ["unknown top key", { ...good, extra: 1 }],
    ["schemaVersion 2", { ...good, schemaVersion: 2 }],
    ["hostId gemini", { ...good, hostId: "gemini" }],
    ["hostId not a string", { ...good, hostId: 3 }],
    ["recipeKind unknown", { ...good, recipeKind: "x" }],
    ["state unknown", { ...good, state: "done" }],
    ["relative configHome", { ...good, configHome: "relative/home" }],
    ["configHome with NUL", { ...good, configHome: "/a\0b" }],
    ["bad createdAt", { ...good, createdAt: "yesterday" }],
    ["entries not an array", { ...good, entries: {} }],
    ["unknown entry key", withEntry({ content: "x" })],
    ["entry kind mismatch", withEntry({ kind: "text-block" })],
    ["entry path with ..", withEntry({ path: "../x" })],
    ["entry nested ..", withEntry({ path: "a/../x" })],
    ["entry absolute path", withEntry({ path: "/etc/x" })],
    ["entry empty path", withEntry({ path: "" })],
    ["non-hex hash", withEntry({ afterSha256: "xyz" })],
    ["short hash", withEntry({ afterSha256: H1.slice(1) })],
    ["uppercase hash", withEntry({ afterSha256: H1.toUpperCase() })],
    ["bad before hash", withEntry({ beforeSha256: 5 })],
    ["bad owned hash", withEntry({ ownedSha256: "zz" })],
    ["createdFile not boolean", withEntry({ createdFile: "yes" })],
    ["separatorAdded not boolean", withEntry({ separatorAdded: 1 })],
    ["createdParents poison key", withEntry({ createdParents: [["__proto__"]] })],
    ["createdParents too deep", withEntry({ createdParents: [["a", "b", "c", "d", "e", "f", "g"]] })],
    ["createdDirs with ..", withEntry({ createdDirs: [[".."]] })],
    ["createdDirs not nested lists", withEntry({ createdDirs: ["a"] })],
    ["301 entries", { ...good, entries: Array.from({ length: 301 }, () => entry) }],
  ];
  for (const [label, input] of cases) {
    assert.throws(() => parseReceipt(JSON.stringify(input)), (error: unknown) => error instanceof SchemaInvalidError && error.code === "SCHEMA_INVALID", label);
  }
  for (const text of ["", "{", "not json", `${" ".repeat(1024 * 1024)}{}`]) {
    assert.throws(() => parseReceipt(text), (error: unknown) => codeOf(error) === "SCHEMA_INVALID", JSON.stringify(text.slice(0, 12)));
  }
  assert.equal(parseReceipt(JSON.stringify({ ...good, entries: Array.from({ length: 300 }, () => entry) })).entries.length, 300);
});

void test("receiptPath is <stateDir>/hosts/<hostId>.receipt.json", () => {
  assert.equal(receiptPath("/state", "opencode"), "/state/hosts/opencode.receipt.json");
});

void test("a receipt is written 0600 in a 0700 hosts directory and read back with its hash", async (t) => {
  const host = makeFixtureHost(t);
  const receipt = sample();
  assert.equal(await readReceipt(host.stateDir, "claude"), null, "absent");
  const sha = writeReceipt(host.stateDir, receipt, { expectedPriorSha256: null });
  assert.equal(statSync(join(host.stateDir, "hosts")).mode & 0o777, 0o700);
  const file = receiptPath(host.stateDir, "claude");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const read = await readReceipt(host.stateDir, "claude");
  assert.ok(read);
  assert.deepEqual(read.receipt, receipt);
  assert.equal(read.sha256, sha);
  assert.equal(sha, sha256Hex(readFileSync(file)));
  // Rewriting with the observed hash works, and the default prior is the hash on disk.
  const next = sample({ state: "pending" });
  const nextSha = writeReceipt(host.stateDir, next, { expectedPriorSha256: read.sha256 });
  assert.notEqual(nextSha, sha);
  writeReceipt(host.stateDir, receipt);
  assert.equal((await readReceipt(host.stateDir, "claude"))?.receipt.state, "installed");
});

void test("two racing writers cannot both win: the loser gets WRITE_NOT_ATOMIC", (t) => {
  const host = makeFixtureHost(t);
  writeReceipt(host.stateDir, sample(), { expectedPriorSha256: null });
  assert.throws(
    () => writeReceipt(host.stateDir, sample({ state: "pending" }), { expectedPriorSha256: null }),
    (error: unknown) => codeOf(error) === "WRITE_NOT_ATOMIC",
  );
  assert.throws(
    () => writeReceipt(host.stateDir, sample({ state: "pending" }), { expectedPriorSha256: H1 }),
    (error: unknown) => codeOf(error) === "WRITE_NOT_ATOMIC",
  );
});

void test("a corrupt receipt on disk is SCHEMA_INVALID, not a missing one", async (t) => {
  const host = makeFixtureHost(t);
  mkdirSync(join(host.stateDir, "hosts"), { mode: 0o700 });
  writeFileSync(receiptPath(host.stateDir, "claude"), "{ not json");
  await assert.rejects(readReceipt(host.stateDir, "claude"), (error: unknown) => codeOf(error) === "SCHEMA_INVALID");
  // A receipt file that belongs to another host is corrupt too.
  writeFileSync(receiptPath(host.stateDir, "claude"), serializeReceipt(sample({ hostId: "opencode" })));
  await assert.rejects(readReceipt(host.stateDir, "claude"), (error: unknown) => codeOf(error) === "SCHEMA_INVALID");
  // A receipt over the size cap is refused without parsing.
  writeFileSync(receiptPath(host.stateDir, "claude"), "x".repeat(1024 * 1024 + 1));
  await assert.rejects(readReceipt(host.stateDir, "claude"), (error: unknown) => codeOf(error) === "SCHEMA_INVALID");
});

void test("a symlinked hosts directory or receipt file is PATH_ESCAPE for read, write and remove", async (t) => {
  const host = makeFixtureHost(t);
  const elsewhere = join(host.root, "elsewhere");
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(host.stateDir, "hosts"));
  await assert.rejects(readReceipt(host.stateDir, "claude"), (error: unknown) => codeOf(error) === "PATH_ESCAPE");
  assert.throws(() => writeReceipt(host.stateDir, sample()), (error: unknown) => codeOf(error) === "PATH_ESCAPE");
  assert.throws(() => { removeReceipt(host.stateDir, "claude", H1); }, (error: unknown) => codeOf(error) === "PATH_ESCAPE");
  assert.deepEqual(statSync(elsewhere).isDirectory(), true);
  assert.equal(existsSync(join(elsewhere, "claude.receipt.json")), false);

  const other = makeFixtureHost(t);
  mkdirSync(join(other.stateDir, "hosts"), { mode: 0o700 });
  const target = join(other.root, "target.json");
  writeFileSync(target, serializeReceipt(sample()));
  symlinkSync(target, receiptPath(other.stateDir, "claude"));
  await assert.rejects(readReceipt(other.stateDir, "claude"), (error: unknown) => codeOf(error) === "PATH_ESCAPE");
});

void test("removeReceipt deletes the receipt only while it has the hash that was read", async (t) => {
  const host = makeFixtureHost(t);
  const sha = writeReceipt(host.stateDir, sample(), { expectedPriorSha256: null });
  assert.throws(() => { removeReceipt(host.stateDir, "claude", H1); }, (error: unknown) => codeOf(error) === "WRITE_NOT_ATOMIC");
  assert.ok(existsSync(receiptPath(host.stateDir, "claude")));
  removeReceipt(host.stateDir, "claude", sha);
  assert.equal(existsSync(receiptPath(host.stateDir, "claude")), false);
  assert.equal(await readReceipt(host.stateDir, "claude"), null);
  // No hosts directory at all is not an error.
  removeReceipt(join(host.root, "no-such-state"), "claude", sha);
});

void test("resumeDecision: a pending receipt is resumable by install and reversible by uninstall", () => {
  const entry = { beforeSha256: H1, afterSha256: H2 };
  assert.equal(resumeDecision(entry, H2), "done");
  assert.equal(resumeDecision(entry, H1), "apply");
  assert.equal(resumeDecision(entry, sha256Text("third party")), "conflict");
  assert.equal(resumeDecision({ beforeSha256: null, afterSha256: H2 }, null), "apply");
  assert.equal(resumeDecision({ beforeSha256: null, afterSha256: H2 }, H1), "conflict");
});
