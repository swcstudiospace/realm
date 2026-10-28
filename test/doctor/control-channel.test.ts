import { after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOCKET_TIMEOUT_MS } from "../../src/daemon/channel.js";
import {
  runChecks,
  type CheckId,
  type CheckResult,
  type ConnectSocket,
  type DoctorOptions,
} from "../../src/doctor/checks.js";
import { controlSocketPath } from "../../src/session/paths.js";

// Every seam is injected, so no process runs and no socket opens in these tests (CLI-03). PATH names an empty directory, so no host
// binary is found, hashed or run.
// The run directory itself is real filesystem state, created per test at the needed mode.
const EMPTY_PATH_DIR = realpathSync(mkdtempSync(join(tmpdir(), "realm-control-empty-path-")));
after(() => {
  rmSync(EMPTY_PATH_DIR, { recursive: true, force: true });
});

const EXPECTED_IDS: readonly CheckId[] = [
  "policy-file",
  "state-dir",
  "session-store",
  "podman",
  "podman-service",
  "openshell",
  "anda-bridge",
  "control-channel",
  "agentos",
  "host-binaries",
  "kernel-hardening",
];

interface Layout {
  readonly stateDir: string;
  readonly policyPath: string;
}

// A temporary base with a state directory at mode 0700 (set explicitly, so the umask does
// not decide it) and a policy path that does not exist yet.
function layout(t: TestContext): Layout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-control-channel-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  mkdirSync(stateDir);
  chmodSync(stateDir, 0o700);
  return { stateDir, policyPath: join(base, "policy.json") };
}

function makeRunDir(stateDir: string, mode = 0o700): string {
  const runDir = join(stateDir, "run");
  mkdirSync(runDir);
  chmodSync(runDir, mode);
  return runDir;
}

interface SeenDials {
  readonly dials: string[];
  readonly timeouts: number[];
}

function fakeConnect(outcome: "connect" | Error, seen: SeenDials): ConnectSocket {
  return (socketPath, timeoutMs) => {
    seen.dials.push(socketPath);
    seen.timeouts.push(timeoutMs);
    return outcome === "connect" ? Promise.resolve() : Promise.reject(outcome);
  };
}

function silentBase(policyPath: string, stateDir: string): DoctorOptions {
  return {
    policyPath,
    stateDir,
    env: { PATH: EMPTY_PATH_DIR, HOME: "/home/realm", XDG_RUNTIME_DIR: "/run/user/1000" },
    runCommand: () => Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    fetchInformation: () => Promise.reject(new Error("no engine is listening")),
  };
}

function resultOf(results: readonly CheckResult[], id: CheckId): CheckResult {
  const found = results.find((result) => result.id === id);
  assert.ok(found, `expected a result for ${id}`);
  return found;
}

function fixOf(result: CheckResult): string {
  assert.equal(typeof result.fix, "string", `${result.id} must carry a fix when it is not a pass`);
  return result.fix ?? "";
}

function enoent(message: string): Error {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

void test("CLI-03: the full report lists all eleven items in order, with control-channel, agentos, host-binaries and kernel-hardening appended (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  makeRunDir(stateDir);
  const seen: SeenDials = { dials: [], timeouts: [] };
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", seen),
    agentos: () => Promise.resolve({ bound: true, alive: true }),
  });
  assert.deepEqual(
    results.map((result) => result.id),
    EXPECTED_IDS,
  );
});

void test("CLI-03: control-channel passes when the run directory is 0700 and the socket accepts (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  makeRunDir(stateDir);
  const seen: SeenDials = { dials: [], timeouts: [] };
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", seen),
  });
  const result = resultOf(results, "control-channel");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  assert.deepEqual(seen.dials, [controlSocketPath(stateDir)]);
  assert.deepEqual(seen.timeouts, [SOCKET_TIMEOUT_MS]);
});

void test("CLI-03: control-channel fails with a chmod fix and dials nothing when the run directory mode is wrong (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  makeRunDir(stateDir, 0o755);
  const seen: SeenDials = { dials: [], timeouts: [] };
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", seen),
  });
  const result = resultOf(results, "control-channel");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /mode is 755, expected 700/);
  assert.match(fixOf(result), /chmod 700/);
  assert.deepEqual(seen.dials, []);
});

void test("CLI-03: control-channel fails with a move-aside fix when the run directory path is not a directory (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  writeFileSync(join(stateDir, "run"), "not a directory");
  const seen: SeenDials = { dials: [], timeouts: [] };
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", seen),
  });
  const result = resultOf(results, "control-channel");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /not a directory/);
  assert.match(fixOf(result), /Move the file/);
  assert.deepEqual(seen.dials, []);
});

void test("CLI-03: control-channel warns with a fix when the socket is absent because the daemon is down (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  makeRunDir(stateDir);
  const seen: SeenDials = { dials: [], timeouts: [] };
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect(enoent("connect ENOENT control.sock"), seen),
  });
  const result = resultOf(results, "control-channel");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /daemon looks stopped/);
  assert.match(fixOf(result), /realm up/);
  assert.deepEqual(seen.dials, [controlSocketPath(stateDir)]);
});

void test("CLI-03: control-channel warns with a fix when the run directory is absent (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  const seen: SeenDials = { dials: [], timeouts: [] };
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", seen),
  });
  const result = resultOf(results, "control-channel");
  assert.equal(result.status, "warn");
  assert.match(fixOf(result), /realm up/);
  assert.deepEqual(seen.dials, []);
});

void test("CLI-03: control-channel fails with a fix and never echoes the socket error when the dial is refused (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  makeRunDir(stateDir);
  const seen: SeenDials = { dials: [], timeouts: [] };
  const refused = Object.assign(new Error("connect ECONNREFUSED secret-socket-9c1d"), {
    code: "ECONNREFUSED",
  });
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect(refused, seen),
  });
  const result = resultOf(results, "control-channel");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /REALM_NOT_ACTIVE/);
  assert.notEqual(result.fix, null);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /secret-socket-9c1d/);
});

void test("CLI-03: agentos warns with REALM_NOT_ACTIVE and the realm-up fix when no daemon answers (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  makeRunDir(stateDir);
  const seen: SeenDials = { dials: [], timeouts: [] };
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", seen),
  });
  const result = resultOf(results, "agentos");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /REALM_NOT_ACTIVE/);
  assert.match(fixOf(result), /realm up/);
});

void test("CLI-03: agentos passes when the injected probe reports a live session (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", { dials: [], timeouts: [] }),
    agentos: () => Promise.resolve({ bound: true, alive: true }),
  });
  const result = resultOf(results, "agentos");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
});

void test("CLI-03: agentos fails with a fix when the injected probe reports no live session (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", { dials: [], timeouts: [] }),
    agentos: () => Promise.resolve({ bound: true, alive: false }),
  });
  const result = resultOf(results, "agentos");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /AGENTOS_CRASH_LOOP/);
  assert.match(fixOf(result), /realm up/);
});

void test("CLI-03: agentos fails with a fix when the injected probe does not answer (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", { dials: [], timeouts: [] }),
    agentos: () => Promise.reject(new Error("agentos probe timed out")),
  });
  const result = resultOf(results, "agentos");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /AGENTOS_CRASH_LOOP/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /timed out/);
});

void test("CLI-03: agentos fails with AGENTOS_NOT_CONFIGURED and a driver fix when the daemon has no driver bound (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  const results = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", { dials: [], timeouts: [] }),
    agentos: () => Promise.resolve({ bound: false }),
  });
  const result = resultOf(results, "agentos");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /AGENTOS_NOT_CONFIGURED/);
  assert.match(fixOf(result), /AgentOS driver/);
});

void test("CLI-03: every non-pass across both items carries a fix and every pass carries none (CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  makeRunDir(stateDir);
  const seen: SeenDials = { dials: [], timeouts: [] };
  const passing = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect("connect", seen),
    agentos: () => Promise.resolve({ bound: true, alive: true }),
  });
  for (const id of ["control-channel", "agentos"] as const) {
    const result = resultOf(passing, id);
    assert.equal(result.status, "pass", `${id} passes in the healthy layout`);
    assert.equal(result.fix, null, `${id} passes with no fix`);
  }
  const failing = await runChecks({
    ...silentBase(policyPath, stateDir),
    connectSocket: fakeConnect(enoent("connect ENOENT control.sock"), { dials: [], timeouts: [] }),
  });
  for (const id of ["control-channel", "agentos"] as const) {
    const result = resultOf(failing, id);
    assert.notEqual(result.status, "pass", `${id} does not pass without a daemon or a live session`);
    assert.notEqual(result.fix, null, `${id} must carry a fix when it is not a pass`);
  }
});
