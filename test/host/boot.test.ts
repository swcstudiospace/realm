import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ERROR_CODES, makeRealmError, RealmError } from "../../src/core/errors.js";
import {
  attachFailureDisposition,
  backstopVerdict,
  BOOT_BOUNDS,
  equalJitterDelayMs,
  reattachTransitionAllowed,
  resolveBoot,
  withStartupBudget,
  type BootLink,
} from "../../src/host/boot.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import type { HostPluginManifest } from "../../src/host/types.js";
import {
  GUARD_STATUS_BUDGET_MS,
  STARTUP_BUDGET_MS,
  STATUS_POLL_MS,
} from "../../src/omp/plugin.js";
import * as ompReattach from "../../src/omp/reattach.js";

const LINKS: readonly BootLink[] = ["off", "linked", "reconnecting", "attaching", "failed"];

function thrownBy(work: () => unknown): unknown {
  try {
    work();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

function activeTimeouts(): number {
  return process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;
}

// ---- Parity with the Omp constants (src/omp is read, never edited) -----------

void test("BOOT_BOUNDS equals the Omp constants", () => {
  assert.equal(BOOT_BOUNDS.startupBudgetMs, STARTUP_BUDGET_MS);
  assert.equal(BOOT_BOUNDS.guardStatusBudgetMs, GUARD_STATUS_BUDGET_MS);
  assert.equal(BOOT_BOUNDS.statusPollMs, STATUS_POLL_MS);
  assert.equal(BOOT_BOUNDS.reattach.retryCap, ompReattach.REATTACH_RETRY_CAP);
  assert.equal(BOOT_BOUNDS.reattach.baseDelayMs, ompReattach.REATTACH_BASE_DELAY_MS);
  assert.equal(BOOT_BOUNDS.reattach.capDelayMs, ompReattach.REATTACH_DELAY_CAP_MS);
  assert.deepEqual([...BOOT_BOUNDS.linkLostCodes], [...ompReattach.LINK_LOST_CODES]);
  assert.deepEqual([...BOOT_BOUNDS.retryableAttachCodes], [...ompReattach.RETRYABLE_ATTACH_CODES]);
});

void test("BOOT_BOUNDS holds the documented values and is frozen", () => {
  assert.equal(BOOT_BOUNDS.startupBudgetMs, 200_000);
  assert.equal(BOOT_BOUNDS.guardStatusBudgetMs, 5_000);
  assert.equal(BOOT_BOUNDS.statusPollMs, 2_000);
  assert.deepEqual({ ...BOOT_BOUNDS.reattach }, { enabled: false, retryCap: 8, baseDelayMs: 1_000, capDelayMs: 60_000 });
  assert.deepEqual([...BOOT_BOUNDS.linkLostCodes], ["REALM_NOT_ACTIVE", "TOOL_TIMEOUT"]);
  assert.deepEqual(
    [...BOOT_BOUNDS.retryableAttachCodes],
    ["REALM_NOT_ACTIVE", "TOOL_TIMEOUT", "STARTUP_BUDGET_EXCEEDED", "DAEMON_START_TIMEOUT"],
  );
  for (const frozen of [BOOT_BOUNDS, BOOT_BOUNDS.reattach, BOOT_BOUNDS.linkLostCodes, BOOT_BOUNDS.retryableAttachCodes]) {
    assert.equal(Object.isFrozen(frozen), true);
  }
  for (const code of [...BOOT_BOUNDS.linkLostCodes, ...BOOT_BOUNDS.retryableAttachCodes]) {
    assert.ok(ERROR_CODES.includes(code), code);
  }
});

void test("startupBudgetMs equals the policy schema default", () => {
  const schema = JSON.parse(readFileSync(new URL("../../../src/core/policy.schema.json", import.meta.url), "utf8")) as {
    properties: { startupBudgetMs: { default: number } };
  };
  assert.equal(BOOT_BOUNDS.startupBudgetMs, schema.properties.startupBudgetMs.default);
});

void test("reattachTransitionAllowed agrees with Omp on all 25 pairs", () => {
  let pairs = 0;
  for (const from of LINKS) {
    for (const to of LINKS) {
      assert.equal(reattachTransitionAllowed(from, to), ompReattach.reattachTransitionAllowed(from, to), `${from} -> ${to}`);
      pairs += 1;
    }
  }
  assert.equal(pairs, 25);
});

void test("equalJitterDelayMs agrees with Omp over the attempt and random grid", () => {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    for (const random of [0, 0.5, 1]) {
      const here = equalJitterDelayMs(attempt, BOOT_BOUNDS.reattach.baseDelayMs, BOOT_BOUNDS.reattach.capDelayMs, () => random);
      const there = ompReattach.equalJitterDelayMs(attempt, ompReattach.REATTACH_BASE_DELAY_MS, ompReattach.REATTACH_DELAY_CAP_MS, () => random);
      assert.equal(here, there, `attempt ${String(attempt)} random ${String(random)}`);
    }
  }
  // The delay is never near zero: random 0 gives half the ceiling.
  assert.equal(equalJitterDelayMs(1, 1_000, 60_000, () => 0), 500);
  assert.equal(equalJitterDelayMs(1, 1_000, 60_000, () => 1), 1_000);
  assert.equal(equalJitterDelayMs(12, 1_000, 60_000, () => 1), 60_000);
});

void test("equalJitterDelayMs throws the same RangeError as Omp on bad input", () => {
  const bad: readonly (readonly [number, number, number, () => number])[] = [
    [0, 1_000, 60_000, () => 0.5],
    [1.5, 1_000, 60_000, () => 0.5],
    [Number.NaN, 1_000, 60_000, () => 0.5],
    [1, -1, 60_000, () => 0.5],
    [1, 1_000, Number.POSITIVE_INFINITY, () => 0.5],
    [1, 2_000, 1_000, () => 0.5],
    [1, 1_000, 60_000, () => 2],
    [1, 1_000, 60_000, () => -0.1],
    [1, 1_000, 60_000, () => Number.NaN],
  ];
  for (const [attempt, base, cap, random] of bad) {
    const here = thrownBy(() => equalJitterDelayMs(attempt, base, cap, random));
    const there = thrownBy(() => ompReattach.equalJitterDelayMs(attempt, base, cap, random));
    assert.ok(here instanceof RangeError, `${String(attempt)} ${String(base)} ${String(cap)}`);
    assert.ok(there instanceof RangeError);
    assert.equal(here.message, there.message);
  }
});

// ---- resolveBoot ---------------------------------------------------------------

const extension = (boot?: HostPluginManifest["boot"]): HostPluginManifest => {
  const base = defaultManifestFor("omp", "1.0.0");
  return boot === undefined ? base : { ...base, boot };
};

void test("resolveBoot fills every absent field from BOOT_BOUNDS", () => {
  const resolved = resolveBoot(extension());
  assert.equal(resolved.startupBudgetMs, BOOT_BOUNDS.startupBudgetMs);
  assert.deepEqual({ ...resolved.reattach }, { ...BOOT_BOUNDS.reattach });
  assert.equal(resolved.reattach.enabled, false);
  assert.deepEqual([...resolved.linkLostCodes], [...BOOT_BOUNDS.linkLostCodes]);
  assert.deepEqual([...resolved.retryableAttachCodes], [...BOOT_BOUNDS.retryableAttachCodes]);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.reattach), true);
});

void test("resolveBoot keeps what the manifest sets and defaults the rest", () => {
  const resolved = resolveBoot(extension({ startupBudgetMs: 30, reattach: { enabled: true, retryCap: 3 } }));
  assert.equal(resolved.startupBudgetMs, 30);
  assert.deepEqual({ ...resolved.reattach }, { enabled: true, retryCap: 3, baseDelayMs: 1_000, capDelayMs: 60_000 });
  assert.equal(resolveBoot(extension({ reattach: {} })).reattach.enabled, false);
  assert.equal(resolveBoot(extension({ startupBudgetMs: 7 })).reattach.retryCap, 8);
});

void test("an mcp-config manifest resolves to the pure defaults", () => {
  const resolved = resolveBoot(defaultManifestFor("claude", "1.0.0"));
  assert.equal(resolved.startupBudgetMs, BOOT_BOUNDS.startupBudgetMs);
  assert.deepEqual({ ...resolved.reattach }, { ...BOOT_BOUNDS.reattach });
});

// ---- withStartupBudget -----------------------------------------------------------

void test("withStartupBudget rejects a never-settling attach with STARTUP_BUDGET_EXCEEDED and leaves no timer", async () => {
  const before = activeTimeouts();
  await assert.rejects(
    withStartupBudget(new Promise<never>(() => undefined), 20),
    (error: unknown) => error instanceof RealmError && error.code === "STARTUP_BUDGET_EXCEEDED",
  );
  assert.equal(activeTimeouts(), before);
});

void test("withStartupBudget passes the work's result and clears its timer", async () => {
  const before = activeTimeouts();
  assert.equal(await withStartupBudget(Promise.resolve(42), 60_000), 42);
  await assert.rejects(withStartupBudget(Promise.reject(makeRealmError("POLICY_DENIED")), 60_000), (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED");
  assert.equal(activeTimeouts(), before);
});

// ---- attachFailureDisposition ---------------------------------------------------

void test("attachFailureDisposition is retryable only for the listed RealmError codes", () => {
  for (const code of ERROR_CODES) {
    const expected = BOOT_BOUNDS.retryableAttachCodes.includes(code) ? "retryable" : "terminal";
    assert.equal(attachFailureDisposition(makeRealmError(code)), expected, code);
  }
  assert.equal(attachFailureDisposition(makeRealmError("POLICY_DENIED")), "terminal");
  assert.equal(attachFailureDisposition(makeRealmError("DAEMON_START_TIMEOUT")), "retryable");
});

void test("attachFailureDisposition treats anything that is not a RealmError as terminal", () => {
  for (const value of [new Error("REALM_NOT_ACTIVE"), "TOOL_TIMEOUT", { code: "TOOL_TIMEOUT" }, null, undefined, 7, Symbol("x")]) {
    assert.equal(attachFailureDisposition(value), "terminal");
  }
});

// ---- backstopVerdict ---------------------------------------------------------------

const PASS: readonly string[] = ["realm_status", "realm_list"];

void test("backstopVerdict refuses a name that is not a string", () => {
  const hostile = {
    toString(): string {
      throw new Error("toString must not be called");
    },
    [Symbol.toPrimitive](): string {
      throw new Error("toPrimitive must not be called");
    },
  };
  for (const name of [undefined, null, 7, true, {}, [], Symbol("x"), hostile, () => "edit"]) {
    for (const mode of ["advisory", "fail-closed", null] as const) {
      assert.deepEqual(backstopVerdict(name, mode, PASS), { block: true, reason: "realm bad tool call" });
    }
  }
});

void test("backstopVerdict passes listed names and decides the rest by mode", () => {
  for (const mode of ["advisory", "fail-closed", null] as const) {
    assert.equal(backstopVerdict("realm_status", mode, PASS), undefined);
  }
  assert.deepEqual(backstopVerdict("edit", "fail-closed", PASS), { block: true, reason: "POLICY_DENIED" });
  assert.deepEqual(backstopVerdict("edit", null, PASS), { block: true, reason: "POLICY_DENIED" });
  assert.equal(backstopVerdict("edit", "advisory", PASS), undefined);
  assert.deepEqual(backstopVerdict("realm_status", "fail-closed", []), { block: true, reason: "POLICY_DENIED" });
});

// ---- Boundaries --------------------------------------------------------------------

void test("src/host/boot.ts imports nothing from src/omp and reads no environment", () => {
  const source = readFileSync(new URL("../../../src/host/boot.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.equal(source.includes('from "../omp'), false);
  assert.equal(source.includes("process.env"), false);
});
