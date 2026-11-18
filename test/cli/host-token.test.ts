// realm host token status and realm host token rotate (CAPT-08, D-32-12) through the real runCli: usage rows that change nothing,
// status before and after rotation and revocation, no key, token or path in any output, keyring guard refusals as catalogue
// refusals, and a running enforcing daemon that notices a CLI rotation on its next request. Real files in a temporary directory
// with an injected clock; no root needed.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keyringPathOf } from "../../src/capability/keyring.js";
import { runCli, type CliDeps, type CliResult } from "../../src/cli/main.js";
import { validate } from "../../src/contract/validate.js";
import { connectDaemon, type DaemonClient } from "../../src/daemon/client.js";
import { startRig } from "../support/capability-harness.js";
import { testTimeout } from "../support/timing.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const USAGE_PREFIX = "realm host: usage: realm host list";
const START_MS = Date.UTC(2026, 0, 1);

interface Rig {
  readonly stateDir: string;
  readonly deps: CliDeps;
  readonly clock: { ms: number };
  readonly reads: { count: number };
  readonly modeOf: { value: "off" | "enforce" | "throw" };
}

function rig(t: TestContext): Rig {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-host-token-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "realm");
  mkdirSync(stateDir, { mode: 0o700 });
  const clock = { ms: START_MS };
  const reads = { count: 0 };
  const modeOf: Rig["modeOf"] = { value: "off" };
  const deps: CliDeps = {
    env: { HOME: base, PATH: "", XDG_CONFIG_HOME: join(base, "config") },
    readConfig: () => {
      reads.count += 1;
      return { image: IMAGE, stateDir, workspaceRoot: join(base, "projects") };
    },
    readPolicy: () => {
      if (modeOf.value === "throw") {
        throw new Error("policy cannot be loaded");
      }
      const parsed = validate("policy", { capabilityTokens: { mode: modeOf.value } });
      if (!parsed.ok) {
        throw new Error("the fixture policy does not validate");
      }
      return parsed.value;
    },
    now: () => new Date(clock.ms),
  };
  return { stateDir, deps, clock, reads, modeOf };
}

function token(r: Rig, ...words: string[]): Promise<CliResult> {
  return runCli(["host", "token", ...words], r.deps);
}

function json(result: CliResult): Record<string, unknown> {
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.endsWith("\n"));
  assert.equal(result.stdout.trimEnd().split("\n").length, 1, "one JSON line");
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

// Every string a JSON value holds, at any depth.
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringsOf);
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringsOf);
  }
  return [];
}

function keyTexts(stateDir: string): string[] {
  const file = JSON.parse(readFileSync(keyringPathOf(stateDir), "utf8")) as { keys: { key: string }[] };
  return file.keys.map((entry) => entry.key);
}

void test("CAPT-08: a usage error exits 2 with the host usage text, prints nothing on stdout and reads no config or file", async (t) => {
  const r = rig(t);
  const rows: readonly (readonly string[])[] = [
    [],
    ["bogus"],
    ["status", "--revoke-previous"],
    ["status", "extra"],
    ["rotate", "--bogus"],
    ["rotate", "extra"],
    ["rotate", "--revoke-previous", "--revoke-previous"],
    ["rotate", "--revoke-previous", "extra"],
    ["rotate", "extra", "--revoke-previous"],
    ["rotate", "--revoke-previous=true"],
  ];
  for (const words of rows) {
    const result = await token(r, ...words);
    assert.equal(result.exitCode, 2, words.join(" "));
    assert.equal(result.stdout, "", words.join(" "));
    assert.ok(result.stderr.startsWith(USAGE_PREFIX), `${words.join(" ")}: ${result.stderr}`);
    assert.ok(result.stderr.includes("token status | token rotate [--revoke-previous]"), "the usage text names the new verbs");
  }
  assert.equal(r.reads.count, 0, "arguments are parsed before any config is read");
  assert.equal(existsSync(join(r.stateDir, "capability")), false, "a usage error changes nothing");
});

void test("CAPT-08: status with no keyring reports the policy mode and an absent keyring; an unloadable policy is mode unknown, not a refusal", async (t) => {
  const r = rig(t);
  assert.deepEqual(json(await token(r, "status")), { ok: true, mode: "off", keyring: "absent" });
  r.modeOf.value = "enforce";
  assert.deepEqual(json(await token(r, "status")), { ok: true, mode: "enforce", keyring: "absent" });
  r.modeOf.value = "throw";
  assert.deepEqual(json(await token(r, "status")), { ok: true, mode: "unknown", keyring: "absent" });
  assert.equal(existsSync(join(r.stateDir, "capability")), false, "status creates nothing");
});

void test("CAPT-08: rotate creates k1 on an absent keyring, then rotates with a grace, then revokes; status follows each step", async (t) => {
  const r = rig(t);
  r.modeOf.value = "enforce";
  assert.deepEqual(json(await token(r, "rotate")), { ok: true, active: "k1", retired: [], revoked: [] });
  assert.deepEqual(json(await token(r, "status")), { ok: true, mode: "enforce", keyring: "present", active: "k1", retired: [], fileMode: "600" });

  r.clock.ms += 100_000;
  assert.deepEqual(json(await token(r, "rotate")), { ok: true, active: "k2", retired: ["k1"], revoked: [] });
  r.clock.ms += 50_000;
  assert.deepEqual(json(await token(r, "status")), {
    ok: true,
    mode: "enforce",
    keyring: "present",
    active: "k2",
    retired: [{ kid: "k1", ageSeconds: 50 }],
    fileMode: "600",
  });
  assert.equal(keyTexts(r.stateDir).length, 2);

  const third = json(await token(r, "rotate"));
  assert.equal(third["active"], "k3");
  assert.deepEqual(third["retired"], ["k1", "k2"]);
  assert.equal(keyTexts(r.stateDir).length, 3);

  const revoked = json(await token(r, "rotate", "--revoke-previous"));
  assert.equal(revoked["active"], "k4");
  assert.deepEqual(revoked["retired"], []);
  assert.deepEqual([...(revoked["revoked"] as string[])].sort(), ["k1", "k2", "k3"]);
  assert.equal(keyTexts(r.stateDir).length, 1, "revoke-previous leaves only the active key");
  assert.deepEqual(json(await token(r, "status")), { ok: true, mode: "enforce", keyring: "present", active: "k4", retired: [], fileMode: "600" });
});

void test("CAPT-08: rotate twice then revoke-previous leaves one key; revoke on an absent keyring creates k1 with nothing revoked", async (t) => {
  const r = rig(t);
  await token(r, "rotate");
  await token(r, "rotate");
  assert.equal(keyTexts(r.stateDir).length, 2);
  const result = json(await token(r, "rotate", "--revoke-previous"));
  assert.equal(result["active"], "k3");
  assert.equal(keyTexts(r.stateDir).length, 1);

  const fresh = rig(t);
  assert.deepEqual(json(await token(fresh, "rotate", "--revoke-previous")), { ok: true, active: "k1", retired: [], revoked: [] });
});

void test("T-32-22: no output of either verb holds a key, a token shape, a policy value or a slash-bearing value", async (t) => {
  const r = rig(t);
  r.modeOf.value = "enforce";
  const steps: readonly (readonly string[])[] = [
    ["status"],
    ["rotate"],
    ["status"],
    ["rotate"],
    ["status"],
    ["rotate", "--revoke-previous"],
    ["status"],
  ];
  const outputs: CliResult[] = [];
  const seen = new Set<string>();
  for (const words of steps) {
    outputs.push(await token(r, ...words));
    if (existsSync(keyringPathOf(r.stateDir))) {
      keyTexts(r.stateDir).forEach((key) => seen.add(key));
    }
  }
  assert.equal(seen.size, 3, "every key that ever existed is checked, the revoked ones included");
  for (const result of outputs) {
    const text = `${result.stdout}${result.stderr}`;
    for (const key of seen) {
      assert.ok(!text.includes(key), "no key text");
    }
    assert.ok(!text.includes("rcap1"), "no token shape");
    assert.ok(!text.includes(r.stateDir), "no state directory path");
    for (const value of stringsOf(JSON.parse(result.stdout) as unknown)) {
      assert.ok(!value.includes("/"), `a path-like value: ${value}`);
    }
  }
});

void test("T-32-23: a symlinked capability directory is a catalogue refusal for both verbs and nothing is written through it", async (t) => {
  const r = rig(t);
  const elsewhere = join(r.stateDir, "elsewhere");
  mkdirSync(elsewhere, { mode: 0o700 });
  symlinkSync(elsewhere, join(r.stateDir, "capability"));
  for (const words of [["status"], ["rotate"], ["rotate", "--revoke-previous"]]) {
    const result = await token(r, ...words);
    assert.equal(result.exitCode, 1, words.join(" "));
    assert.equal(result.stdout, "POLICY_DENIED\n");
    assert.ok(result.stderr.startsWith(`realm host token ${words[0] ?? ""}: `), result.stderr);
    assert.ok(!result.stderr.includes(r.stateDir), "no path in the reason");
  }
  assert.deepEqual(readdirSync(elsewhere), [], "no key file was written through the symlink");
});

void test("T-32-23: a loose key directory is a catalogue refusal for both verbs", async (t) => {
  const r = rig(t);
  await token(r, "rotate");
  chmodSync(join(r.stateDir, "capability"), 0o755);
  for (const words of [["status"], ["rotate"]]) {
    const result = await token(r, ...words);
    assert.equal(result.exitCode, 1, words.join(" "));
    assert.equal(result.stdout, "POLICY_DENIED\n");
  }
});

void test("CAPT-08: a runtime config that cannot name a state directory is exit 1 for both verbs, with a fixed reason", async (t) => {
  const r = rig(t);
  const deps: CliDeps = {
    ...r.deps,
    readConfig: () => {
      throw new Error("no config");
    },
  };
  for (const words of [["status"], ["rotate"]]) {
    const result = await runCli(["host", "token", ...words], deps);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "SCHEMA_INVALID\n");
    assert.ok(result.stderr.includes("cannot resolve a state directory"), result.stderr);
  }
});

void test("CAPT-08: a running enforcing daemon notices a CLI rotation with no restart: an old token verifies during the grace and a new attach carries the new kid", testTimeout(60_000), async (t) => {
  const rig3 = await startRig(t, { capabilityTokens: { mode: "enforce" } });
  await rig3.up();
  const read = { read: { path: "doc.txt", maxBytes: 64 } };
  const connect = (): DaemonClient =>
    connectDaemon(rig3.socketPath, rig3.selection(), { host: "claude", now: () => rig3.nowMs() });
  const first = connect();
  assert.equal((await first.call(read)).outcome, "done");

  const deps: CliDeps = { env: rig3.cli.env, now: () => new Date(rig3.nowMs()) };
  const rotated = json(await runCli(["host", "token", "rotate"], deps));
  assert.equal(rotated["active"], "k2");
  assert.deepEqual(rotated["retired"], ["k1"]);

  // The token the first client holds was signed by k1, which is retired but inside its grace.
  assert.equal((await first.call(read)).outcome, "done");
  // A client that attaches after the rotation is minted by the new active key.
  const second = connect();
  assert.equal((await second.call(read)).outcome, "done");
  const kids = rig3
    .auditLines()
    .filter((line) => line["phase"] !== undefined && line["tool"] === "read")
    .map((line) => line["kid"]);
  assert.deepEqual([...new Set(kids)], ["k1", "k2"]);
  assert.equal(kids.at(-1), "k2");
});
