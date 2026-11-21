// The capability-tokens doctor item (CAPT-08, D-32-12, D34-1): off (a warn, the opt-out), off with profiles, enforce with a
// valid keyring, enforce with no keyring yet (a warn, the daemon creates it), and every failing keyring class, with real files in a temporary directory and injected uid, clock and lstat seams. No result text may carry key
// material or a path (T-32-22).

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCapabilityGate } from "../../src/capability/gate.js";
import { ensureKeyring, keyringPathOf, rotateKeyring } from "../../src/capability/keyring.js";
import { validate, type Policy } from "../../src/contract/validate.js";
import { createLogger } from "../../src/observe/logger.js";
import { capabilityTokensCheck } from "../../src/doctor/capability-checks.js";
import { runChecks, type CheckResult } from "../../src/doctor/checks.js";
import type { RuntimeConfig } from "../../src/runtime/config.js";

const UID = process.getuid?.() ?? 0;
const GRACE = 86400 + 60;

// The seams the item takes, spelled out so the test depends on behaviour and not on the item's option type.
interface Overrides {
  readonly lstat?: (path: string) => Stats;
  readonly uid?: number;
  readonly now?: () => number;
  readonly runtimeConfig?: RuntimeConfig;
}
const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const ENFORCE = { capabilityTokens: { mode: "enforce" } };

interface Scratch {
  readonly base: string;
  readonly stateDir: string;
  readonly policyPath: string;
}

// Every result this file produces, so one scan at the end covers them all.
const produced: CheckResult[] = [];
const keysSeen = new Set<string>();

function scratch(t: TestContext): Scratch {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-capt-doctor-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  mkdirSync(stateDir, { mode: 0o700 });
  return { base, stateDir, policyPath: join(base, "policy.json") };
}

function validatedPolicy(): Policy {
  const parsed = validate("policy", {});
  assert.ok(parsed.ok);
  return parsed.value;
}

function writePolicy(s: Scratch, value: unknown): void {
  writeFileSync(s.policyPath, JSON.stringify(value));
}

function remember(s: Scratch): void {
  try {
    const file = JSON.parse(readFileSync(keyringPathOf(s.stateDir), "utf8")) as { keys: { key: string }[] };
    file.keys.forEach((entry) => keysSeen.add(entry.key));
  } catch {
    // No readable keyring in this case.
  }
}

function check(s: Scratch, extra: Overrides = {}): CheckResult {
  remember(s);
  const result = capabilityTokensCheck({ stateDir: s.stateDir, policyPath: s.policyPath, ...extra });
  produced.push(result);
  return result;
}

function failsWith(result: CheckResult, phrase: string): void {
  assert.equal(result.id, "capability-tokens");
  assert.equal(result.status, "fail", result.detail);
  assert.ok(result.detail.includes(phrase), result.detail);
  assert.ok(result.fix !== null && result.fix.length > 0, "a fail carries a fix");
}

function enforcing(t: TestContext): Scratch {
  const s = scratch(t);
  writePolicy(s, ENFORCE);
  return s;
}

void test("D34-1: mode off with no profiles is a warn that names the opt-out and the fix", (t) => {
  const s = scratch(t);
  writePolicy(s, { capabilityTokens: { mode: "off" } });
  const off = check(s);
  assert.equal(off.id, "capability-tokens");
  assert.equal(off.status, "warn");
  assert.ok(off.detail.includes("capability tokens are off") && off.detail.includes("opt-out"), off.detail);
  assert.ok(off.detail.includes("without one"), off.detail);
  assert.ok(off.fix?.includes("capabilityTokens.mode") && off.fix.includes("enforce"), String(off.fix));
});

void test("D34-1: no policy file is the default, enforce: with no keyring yet it is a warn, and after a started gate it passes", (t) => {
  const s = scratch(t);
  const noFile = capabilityTokensCheck({ stateDir: s.stateDir });
  produced.push(noFile);
  assert.equal(noFile.status, "warn");
  assert.ok(noFile.detail.includes("capability tokens enforce"), noFile.detail);
  assert.ok(noFile.detail.includes("creates it when it starts"), noFile.detail);
  const gate = createCapabilityGate({
    stateDir: s.stateDir,
    policy: validatedPolicy(),
    now: () => Date.now(),
    logger: createLogger({ sink: { write: () => true }, level: "debug", now: () => new Date() }),
  });
  assert.ok(gate !== undefined);
  const started = capabilityTokensCheck({ stateDir: s.stateDir });
  produced.push(started);
  assert.equal(started.status, "pass", started.detail);
  assert.ok(started.detail.includes("active key k1"), started.detail);
});

void test("D34-1: a policy file with no capabilityTokens key enforces too", (t) => {
  const s = scratch(t);
  writePolicy(s, { workspaceRoots: [] });
  const result = check(s);
  assert.equal(result.status, "warn");
  assert.ok(result.detail.includes("capability tokens enforce"), result.detail);
});

void test("CAPT-08: mode off with profiles configured is a warn that says the profiles have no effect", (t) => {
  const s = scratch(t);
  writePolicy(s, { capabilityTokens: { mode: "off", profiles: { cursor: ["fs.read"], claude: [] } } });
  const result = check(s);
  assert.equal(result.status, "warn");
  assert.ok(result.detail.includes("2 host profile(s)") && result.detail.includes("no effect"), result.detail);
  assert.ok(result.fix?.includes("enforce"), String(result.fix));
});

void test("CAPT-08: enforce with a valid keyring passes and names the mode, the active kid, the retired count and the profile count", (t) => {
  const s = scratch(t);
  writePolicy(s, { capabilityTokens: { mode: "enforce", profiles: { cursor: ["fs.read"] } } });
  ensureKeyring(s.stateDir);
  const result = check(s);
  assert.equal(result.status, "pass", result.detail);
  assert.equal(result.fix, null);
  assert.ok(result.detail.startsWith("capability tokens enforce: active key k1, 0 retired key(s), 1 host(s) with a profile"), result.detail);
  assert.ok(result.detail.includes("stale or unlabelled"), "the pass carries the stale-or-unlabelled guidance");
  assert.ok(result.detail.includes("--host ID") && result.detail.includes("capabilityTokens.mode to off"), result.detail);
  rotateKeyring(s.stateDir, { revokePrevious: false });
  assert.ok(
    check(s).detail.startsWith("capability tokens enforce: active key k2, 1 retired key(s), 1 host(s) with a profile"),
    "the detail names the new kid and the retired count",
  );
});

void test("CAPT-08: a retired key past its prune time is a warn; one inside its grace is a pass", (t) => {
  const s = enforcing(t);
  const start = 1_800_000_000;
  rotateKeyring(s.stateDir, { revokePrevious: false }, { now: () => start });
  rotateKeyring(s.stateDir, { revokePrevious: false }, { now: () => start + 10 });
  assert.equal(check(s, { now: () => start + 20 }).status, "pass");
  const stale = check(s, { now: () => start + 10 + GRACE + 1 });
  assert.equal(stale.status, "warn");
  assert.ok(stale.detail.includes("past their prune time"), stale.detail);
  assert.ok(stale.fix?.includes("realm host token rotate"), String(stale.fix));
});

function warnsMissing(result: CheckResult): void {
  assert.equal(result.id, "capability-tokens");
  assert.equal(result.status, "warn", result.detail);
  assert.ok(result.detail.includes("the daemon creates it when it starts"), result.detail);
  assert.ok(result.fix?.includes("realm host token rotate"), String(result.fix));
}

void test("D34-1: enforce with no keyring yet is a warn that says the daemon creates it and names realm host token rotate", (t) => {
  const s = enforcing(t);
  warnsMissing(check(s));
  // A capability directory with no key file is missing too.
  mkdirSync(join(s.stateDir, "capability"), { mode: 0o700 });
  warnsMissing(check(s));
});

void test("CAPT-08: a symlink at the directory and a symlink at the file are each a fail", (t) => {
  const s = enforcing(t);
  const elsewhere = join(s.base, "elsewhere");
  mkdirSync(elsewhere, { mode: 0o700 });
  symlinkSync(elsewhere, join(s.stateDir, "capability"));
  failsWith(check(s), "symlink");
  rmSync(join(s.stateDir, "capability"));

  const t2 = enforcing(t);
  ensureKeyring(t2.stateDir);
  const real = join(t2.base, "real-keys.json");
  writeFileSync(real, readFileSync(keyringPathOf(t2.stateDir)));
  chmodSync(real, 0o600);
  rmSync(keyringPathOf(t2.stateDir));
  symlinkSync(real, keyringPathOf(t2.stateDir));
  failsWith(check(t2), "symlink");
});

void test("CAPT-08: a directory or a file owned by another user is a fail", (t) => {
  const s = enforcing(t);
  ensureKeyring(s.stateDir);
  failsWith(check(s, { uid: UID + 1 }), "owned by another user");
});

void test("CAPT-08: a directory that is not mode 700 and a file that is not mode 600 are each a fail", (t) => {
  const s = enforcing(t);
  ensureKeyring(s.stateDir);
  chmodSync(join(s.stateDir, "capability"), 0o755);
  failsWith(check(s), "not mode 700");
  chmodSync(join(s.stateDir, "capability"), 0o700);
  chmodSync(keyringPathOf(s.stateDir), 0o644);
  failsWith(check(s), "not mode 700, or the key file is not mode 600");
});

void test("CAPT-08: a malformed keyring, a keyring with no active key and a keyring that is not JSON are each a fail", (t) => {
  const s = enforcing(t);
  ensureKeyring(s.stateDir);
  const file = keyringPathOf(s.stateDir);
  const valid = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  for (const content of ["{not json", JSON.stringify({ ...valid, active: "k9" }), JSON.stringify({ ...valid, version: 2 }), "[]"]) {
    writeFileSync(file, content);
    chmodSync(file, 0o600);
    failsWith(check(s), "malformed or has no active key");
  }
});

void test("CAPT-08: a key file over 64 KiB is a fail", (t) => {
  const s = enforcing(t);
  ensureKeyring(s.stateDir);
  writeFileSync(keyringPathOf(s.stateDir), " ".repeat(64 * 1024 + 1));
  chmodSync(keyringPathOf(s.stateDir), 0o600);
  failsWith(check(s), "larger than 64 KiB");
});

void test("CAPT-08: a keyring that cannot be statted is a fail of class unreadable, and a non-directory capability path too", (t) => {
  const s = enforcing(t);
  ensureKeyring(s.stateDir);
  const denied = (): never => {
    throw Object.assign(new Error("EACCES"), { code: "EACCES" });
  };
  failsWith(check(s, { lstat: denied }), "cannot be read");
  const t2 = enforcing(t);
  writeFileSync(join(t2.stateDir, "capability"), "not a directory");
  failsWith(check(t2), "cannot be read");
  // The injected lstat is also the one that reports a vanished file.
  const t3 = enforcing(t);
  ensureKeyring(t3.stateDir);
  warnsMissing(
    check(t3, {
      lstat: (path) => {
        if (path.endsWith("keys.json")) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return lstatSync(path);
      },
    }),
  );
});

void test("CAPT-08: a keyring under the configured sandbox state root is a fail with its own detail; a separate root passes", (t) => {
  const s = enforcing(t);
  ensureKeyring(s.stateDir);
  const elsewhere = join(s.base, "other");
  mkdirSync(elsewhere);
  const config = (sandboxStateRoot: string): RuntimeConfig => ({
    image: IMAGE,
    stateDir: s.stateDir,
    workspaceRoot: join(elsewhere, "work"),
    secretRoot: join(elsewhere, "secrets"),
    sandboxStateRoot,
  });
  const overlap = check(s, { runtimeConfig: config(s.base) });
  failsWith(overlap, "sandbox state root");
  assert.ok(overlap.fix?.includes("Move the sandbox state root"), String(overlap.fix));
  assert.equal(check(s, { runtimeConfig: config(join(elsewhere, "sandboxes")) }).status, "pass");
  assert.equal(check(s, { runtimeConfig: { image: IMAGE, stateDir: s.stateDir, workspaceRoot: join(elsewhere, "work") } }).status, "pass");
});

void test("CAPT-08: a policy that cannot be loaded is a warn that names the policy-file item and leaves the detail to it", (t) => {
  const s = scratch(t);
  writeFileSync(s.policyPath, "{not json");
  const result = check(s);
  assert.equal(result.status, "warn");
  assert.ok(result.detail.includes("policy-file"), result.detail);
  assert.ok(result.fix?.includes("policy-file"), String(result.fix));
  writePolicy(s, { capabilityTokens: { mode: "enforce", ttlSeconds: 1 } });
  assert.equal(check(s).status, "warn", "a schema failure is a warn too");
});

void test("CAPT-08: runChecks appends the item after host-plugins, with omp-plugin last and every earlier position unchanged", async (t) => {
  const s = enforcing(t);
  const emptyPath = join(s.base, "empty-path");
  mkdirSync(emptyPath);
  const results = await runChecks({
    policyPath: s.policyPath,
    stateDir: s.stateDir,
    env: { PATH: emptyPath, HOME: join(s.base, "no-such-home") },
    runCommand: () => Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    connectSocket: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })),
  });
  assert.equal(results.at(-1)?.id, "omp-plugin");
  assert.equal(results.at(-2)?.id, "capability-tokens");
  assert.equal(results.at(-3)?.id, "host-plugins");
  const last = results.at(-2);
  assert.equal(last?.status, "warn", "enforce with no keyring yet is a warn through runChecks");
  produced.push(last);
});

void test("T-32-22: no result text of any case carries a key, a token shape or a slash-bearing path", () => {
  assert.ok(produced.length > 15, `the earlier cases produced ${String(produced.length)} results`);
  assert.ok(keysSeen.size > 0, "key texts were collected");
  for (const result of produced) {
    const text = `${result.detail}\n${result.fix ?? ""}`;
    for (const key of keysSeen) {
      assert.ok(!text.includes(key), "no key text");
    }
    assert.ok(!text.includes("rcap1"), "no token shape");
    assert.ok(!text.includes("/"), `a path-like value: ${text}`);
  }
});
