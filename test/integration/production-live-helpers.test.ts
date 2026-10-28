// Hermetic tests for the pieces of the production live suite that need no host: probe output parsing, the polling helper
// (with an injected clock), the 198.18.0.0/15 range check and the skip-reason selection. This file always runs. The live
// scenarios themselves are in production-driver.test.ts and run only when its gate opens.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { PodmanProbe } from "../../src/runtime/podman-version.js";
import {
  isBenchmarkAddress,
  parseNodeProbe,
  parseProbeFields,
  pollUntil,
  productionSkipReason,
  stateOfStatus,
  type PollCheck,
  type PollClock,
  type ProductionGateInputs,
} from "../support/production-live.js";

// ---- parseProbeFields -----------------------------------------------------------------------------------------------------

void test("parseProbeFields reads name: value lines as /proc/self/status writes them", () => {
  const fields = parseProbeFields("Name:\tcat\nUid:\t1001\t1001\t1001\t1001\nCapEff:\t0000000000000000\nNoNewPrivs:\t1\nSeccomp:\t2\n");
  assert.equal(fields.get("Name"), "cat");
  assert.equal(fields.get("Uid"), "1001\t1001\t1001\t1001");
  assert.equal(fields.get("CapEff"), "0000000000000000");
  assert.equal(fields.get("NoNewPrivs"), "1");
  assert.equal(fields.get("Seccomp"), "2");
});

void test("parseProbeFields splits at the first colon, so a value may hold colons", () => {
  const fields = parseProbeFields("endpoint: 2606:4700:4700::1111\n");
  assert.equal(fields.get("endpoint"), "2606:4700:4700::1111");
});

void test("parseProbeFields trims names and values and accepts CRLF line ends", () => {
  const fields = parseProbeFields("  Seccomp  :   2  \r\nNoNewPrivs:1\r\n");
  assert.equal(fields.get("Seccomp"), "2");
  assert.equal(fields.get("NoNewPrivs"), "1");
});

void test("parseProbeFields skips lines without a colon and lines with an empty name", () => {
  const fields = parseProbeFields("no separator here\n: orphan value\n   : spaces only\nKept: yes\n");
  assert.deepEqual([...fields.keys()], ["Kept"]);
});

void test("parseProbeFields keeps the first line when a name repeats", () => {
  const fields = parseProbeFields("Seccomp: 2\nSeccomp: 0\n");
  assert.equal(fields.get("Seccomp"), "2");
});

void test("parseProbeFields returns an empty map for empty output and does not treat a missing name as a value", () => {
  assert.equal(parseProbeFields("").size, 0);
  assert.equal(parseProbeFields("Uid: 1\n").get("CapEff"), undefined);
});

// ---- parseNodeProbe and stateOfStatus ---------------------------------------------------------------------------------------

void test("parseNodeProbe reads ok, ok with a detail, and error lines, taking the last non-empty line", () => {
  assert.deepEqual(parseNodeProbe("ok\n"), { kind: "ok", detail: "" });
  assert.deepEqual(parseNodeProbe('ok ["198.18.0.2"]\n'), { kind: "ok", detail: '["198.18.0.2"]' });
  assert.deepEqual(parseNodeProbe("error EACCES\n"), { kind: "error", code: "EACCES" });
  assert.deepEqual(parseNodeProbe("warning: noise\nerror ENODATA\n\n"), { kind: "error", code: "ENODATA" });
});

void test("parseNodeProbe reports unparsed for empty or unrecognised output", () => {
  assert.deepEqual(parseNodeProbe(""), { kind: "unparsed" });
  assert.deepEqual(parseNodeProbe("okay then\n"), { kind: "unparsed" });
  assert.deepEqual(parseNodeProbe("errors EACCES\n"), { kind: "unparsed" });
});

void test("stateOfStatus reads snapshot.state from the status JSON and nothing else", () => {
  assert.equal(stateOfStatus('{"snapshot":{"state":"active","reason":"ok"},"display":"x","mode":"advisory"}\n'), "active");
  assert.equal(stateOfStatus("disconnected\n"), undefined);
  assert.equal(stateOfStatus('{"snapshot":{"state":7}}'), undefined);
  assert.equal(stateOfStatus('{"state":"active"}'), undefined);
  assert.equal(stateOfStatus("null"), undefined);
});

// ---- isBenchmarkAddress -----------------------------------------------------------------------------------------------------

void test("isBenchmarkAddress accepts exactly 198.18.0.0 to 198.19.255.255", () => {
  for (const address of ["198.18.0.0", "198.18.0.2", "198.18.255.255", "198.19.0.0", "198.19.255.255"]) {
    assert.equal(isBenchmarkAddress(address), true, address);
  }
});

void test("isBenchmarkAddress refuses the neighbouring ranges and every other address", () => {
  for (const address of ["198.17.255.255", "198.20.0.0", "197.18.0.1", "199.18.0.1", "1.1.1.1", "8.8.8.8", "10.0.0.1", "127.0.0.1"]) {
    assert.equal(isBenchmarkAddress(address), false, address);
  }
});

void test("isBenchmarkAddress refuses malformed text", () => {
  for (const text of ["", "198.18", "198.18.0", "198.18.0.2.1", "198.18.0.256", "198.18.0.-1", "198.018.0.1", "198.18.0.x", " 198.18.0.2", "::ffff:198.18.0.2", "2606:4700:4700::1111"]) {
    assert.equal(isBenchmarkAddress(text), false, JSON.stringify(text));
  }
});

// ---- pollUntil ---------------------------------------------------------------------------------------------------------------

// A clock that only moves when the poll sleeps, so a poll is deterministic and takes no wall time.
function fakeClock(): { readonly clock: PollClock; readonly sleeps: number[]; readonly elapsed: () => number } {
  let current = 1_000;
  const sleeps: number[] = [];
  const clock: PollClock = {
    now: () => current,
    sleep: (ms) => {
      sleeps.push(ms);
      current += ms;
      return Promise.resolve();
    },
  };
  return { clock, sleeps, elapsed: () => current - 1_000 };
}

void test("pollUntil returns at once, without sleeping, when the first check is done", async () => {
  const fake = fakeClock();
  const outcome = await pollUntil(() => Promise.resolve<PollCheck>({ done: true }), { timeoutMs: 1_000, intervalMs: 100, clock: fake.clock });
  assert.deepEqual(outcome, { ok: true, attempts: 1, detail: "" });
  assert.deepEqual(fake.sleeps, []);
});

void test("pollUntil sleeps one interval between checks and stops at the first done", async () => {
  const fake = fakeClock();
  let calls = 0;
  const outcome = await pollUntil(
    () => {
      calls += 1;
      return Promise.resolve<PollCheck>(calls < 3 ? { done: false, detail: `call ${String(calls)}` } : { done: true });
    },
    { timeoutMs: 1_000, intervalMs: 100, clock: fake.clock },
  );
  assert.deepEqual(outcome, { ok: true, attempts: 3, detail: "" });
  assert.deepEqual(fake.sleeps, [100, 100]);
});

void test("pollUntil fails at the bound with the last detail, after one last check at the deadline", async () => {
  const fake = fakeClock();
  let calls = 0;
  const outcome = await pollUntil(
    () => {
      calls += 1;
      return Promise.resolve<PollCheck>({ done: false, detail: `still busy, call ${String(calls)}` });
    },
    { timeoutMs: 250, intervalMs: 100, clock: fake.clock },
  );
  // Checks run at 0, 100, 200 and, after a shortened 50 ms sleep, at the 250 ms deadline.
  assert.deepEqual(fake.sleeps, [100, 100, 50]);
  assert.equal(fake.elapsed(), 250);
  assert.deepEqual(outcome, { ok: false, attempts: 4, detail: "still busy, call 4" });
});

void test("pollUntil accepts a condition that clears at the deadline", async () => {
  const fake = fakeClock();
  let calls = 0;
  const outcome = await pollUntil(
    () => {
      calls += 1;
      return Promise.resolve<PollCheck>(calls < 4 ? { done: false, detail: "busy" } : { done: true });
    },
    { timeoutMs: 250, intervalMs: 100, clock: fake.clock },
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.attempts, 4);
});

void test("pollUntil runs a slow check to completion and counts its time against the bound", async () => {
  let current = 0;
  const clock: PollClock = {
    now: () => current,
    sleep: (ms) => {
      current += ms;
      return Promise.resolve();
    },
  };
  let calls = 0;
  const outcome = await pollUntil(
    () => {
      calls += 1;
      current += 600;
      return Promise.resolve<PollCheck>({ done: false, detail: `slow ${String(calls)}` });
    },
    { timeoutMs: 1_000, intervalMs: 100, clock },
  );
  // The first check ends at 600 ms and sleeps 100; the second ends at 1300 ms, past the bound, so the poll stops there.
  assert.deepEqual(outcome, { ok: false, attempts: 2, detail: "slow 2" });
});

void test("pollUntil propagates a check that throws", async () => {
  const fake = fakeClock();
  await assert.rejects(
    pollUntil(() => Promise.reject(new Error("probe broke")), { timeoutMs: 1_000, intervalMs: 100, clock: fake.clock }),
    /probe broke/,
  );
});

void test("pollUntil refuses a timeout or interval that is not a positive integer", async () => {
  const done = (): Promise<PollCheck> => Promise.resolve({ done: true });
  for (const options of [
    { timeoutMs: 0, intervalMs: 10 },
    { timeoutMs: -1, intervalMs: 10 },
    { timeoutMs: 10, intervalMs: 0 },
    { timeoutMs: 10.5, intervalMs: 10 },
    { timeoutMs: 10, intervalMs: Number.NaN },
  ]) {
    await assert.rejects(pollUntil(done, options), RangeError);
  }
});

// ---- productionSkipReason ----------------------------------------------------------------------------------------------------

const CLI_PATH = "dist/src/cli/main.js";
const PODMAN_5: PodmanProbe = { kind: "output", stdout: "podman version 5.7.1\n" };

// A host where every prerequisite holds. Each test removes one prerequisite and expects the gate to name it.
function openInputs(overrides: Partial<ProductionGateInputs> = {}): ProductionGateInputs {
  return {
    env: {
      REALM_LIVE_PRODUCTION: "1",
      REALM_LIVE_IMAGE: "localhost/realm-agentos@sha256:" + "a".repeat(64),
      REALM_DRIVER_STATE_ROOT: "/state-root",
      REALM_DRIVER_SECRET_ROOT: "/secret-root",
      REALM_DRIVER_WORKSPACE_ROOT: "/workspace-root",
      XDG_RUNTIME_DIR: "/run-user",
      PATH: "/bin",
    },
    podman: PODMAN_5,
    isSocket: (path) => path === "/run-user/podman/podman.sock",
    onPath: (name) => name === "openshell",
    exists: () => true,
    isDirectory: () => true,
    cliPath: CLI_PATH,
    ...overrides,
  };
}

// The same inputs with one environment variable changed or, when value is undefined, removed.
function withEnv(name: string, value: string | undefined): ProductionGateInputs {
  const base = openInputs();
  const env: Record<string, string | undefined> = { ...base.env, [name]: value };
  return { ...base, env };
}

void test("productionSkipReason lets the suite run when every prerequisite holds", () => {
  assert.equal(productionSkipReason(openInputs()), false);
});

void test("productionSkipReason names REALM_LIVE_PRODUCTION first, whatever else is missing", () => {
  const nothing: ProductionGateInputs = {
    env: {},
    podman: { kind: "unavailable" },
    isSocket: () => false,
    onPath: () => false,
    exists: () => false,
    isDirectory: () => false,
    cliPath: CLI_PATH,
  };
  assert.match(String(productionSkipReason(nothing)), /REALM_LIVE_PRODUCTION=1 is not set/);
});

void test("productionSkipReason accepts only the exact opt-in value 1", () => {
  for (const value of [undefined, "", "0", "true", "yes", "11", " 1"]) {
    assert.match(String(productionSkipReason(withEnv("REALM_LIVE_PRODUCTION", value))), /REALM_LIVE_PRODUCTION=1 is not set/, String(value));
  }
});

void test("productionSkipReason names Podman next: a missing binary and a 4.x release", () => {
  assert.match(String(productionSkipReason(openInputs({ podman: { kind: "unavailable" } }))), /PODMAN_MISSING/);
  assert.match(
    String(productionSkipReason(openInputs({ podman: { kind: "output", stdout: "podman version 4.9.3\n" } }))),
    /PODMAN_UNSUPPORTED_VERSION/,
  );
  assert.match(
    String(productionSkipReason(openInputs({ podman: { kind: "output", stdout: "garbled\n" } }))),
    /PODMAN_UNSUPPORTED_VERSION/,
  );
});

void test("productionSkipReason names REALM_LIVE_IMAGE after Podman", () => {
  for (const value of [undefined, ""]) {
    assert.match(String(productionSkipReason(withEnv("REALM_LIVE_IMAGE", value))), /REALM_LIVE_IMAGE not set/);
  }
});

void test("productionSkipReason names each driver root that is missing, relative or absent from the host", () => {
  const roots: ReadonlyArray<readonly [string, string]> = [
    ["REALM_DRIVER_STATE_ROOT", "/state-root"],
    ["REALM_DRIVER_SECRET_ROOT", "/secret-root"],
    ["REALM_DRIVER_WORKSPACE_ROOT", "/workspace-root"],
  ];
  for (const [name, path] of roots) {
    for (const value of [undefined, "", "relative/root"]) {
      const reason = String(productionSkipReason(withEnv(name, value)));
      assert.ok(reason.startsWith(`${name} is not an absolute path`), `${name}=${String(value)}: ${reason}`);
    }
    const absent = String(productionSkipReason(openInputs({ isDirectory: (candidate) => candidate !== path })));
    assert.ok(absent.startsWith(`${name} is not an absolute path`), absent);
  }
});

void test("productionSkipReason reports the first of several missing roots in state, secret, workspace order", () => {
  const base = openInputs();
  const env: Record<string, string | undefined> = { ...base.env, REALM_DRIVER_SECRET_ROOT: undefined, REALM_DRIVER_WORKSPACE_ROOT: undefined };
  assert.ok(String(productionSkipReason({ ...base, env })).startsWith("REALM_DRIVER_SECRET_ROOT"));
});

void test("productionSkipReason names the rootless socket: an unusable XDG_RUNTIME_DIR, then an absent socket", () => {
  for (const value of [undefined, "", "run-user"]) {
    assert.match(String(productionSkipReason(withEnv("XDG_RUNTIME_DIR", value))), /XDG_RUNTIME_DIR is not an absolute path/);
  }
  assert.match(String(productionSkipReason(openInputs({ isSocket: () => false }))), /no rootless Podman API socket/);
});

void test("productionSkipReason names the openshell CLI, then the built CLI", () => {
  assert.match(String(productionSkipReason(openInputs({ onPath: () => false }))), /no openshell CLI on PATH/);
  assert.match(String(productionSkipReason(openInputs({ exists: (path) => path !== CLI_PATH }))), /built CLI .* is missing; run npm run build/);
});

void test("productionSkipReason reports the earlier prerequisite when two are missing", () => {
  // No openshell and no built CLI: the openshell CLI comes first.
  assert.match(String(productionSkipReason(openInputs({ onPath: () => false, exists: (path) => path !== CLI_PATH }))), /no openshell CLI/);
  // No socket and no openshell: the socket comes first.
  assert.match(String(productionSkipReason(openInputs({ isSocket: () => false, onPath: () => false }))), /no rootless Podman API socket/);
  // No image and no socket: the image comes first.
  assert.match(String(productionSkipReason({ ...withEnv("REALM_LIVE_IMAGE", undefined), isSocket: () => false })), /REALM_LIVE_IMAGE not set/);
});

void test("a skip reason names no host path", () => {
  const reasons = [
    productionSkipReason(withEnv("REALM_LIVE_PRODUCTION", undefined)),
    productionSkipReason(withEnv("REALM_DRIVER_STATE_ROOT", undefined)),
    productionSkipReason(openInputs({ isSocket: () => false })),
    productionSkipReason(openInputs({ exists: (path) => path !== CLI_PATH })),
  ];
  for (const reason of reasons) {
    assert.equal(typeof reason, "string");
    assert.doesNotMatch(String(reason), /\/(root|home|tmp|Users)\//);
  }
});
