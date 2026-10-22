import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks, type CheckId, type CheckResult } from "../../src/doctor/checks.js";

const REGISTERED_IDS: readonly CheckId[] = [
  "policy-file",
  "state-dir",
  "session-store",
  "podman",
  "podman-service",
  "openshell",
  "anda-bridge",
  "control-channel",
  "agentos",
];

// The explicit host environment each doctor run receives in these tests. The doctor reads no process environment.
const DOCTOR_ENV = { PATH: "/usr/bin", HOME: "/root" };

interface Layout {
  readonly base: string;
  readonly workspace: string;
  readonly stateDir: string;
  readonly policyPath: string;
}

// A temporary base with a workspace, a state directory at mode 0700 (set explicitly, so the
// umask does not decide it), and a policy path that does not exist yet.
function layout(t: TestContext): Layout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-doctor-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const workspace = join(base, "workspace");
  const stateDir = join(base, "state");
  mkdirSync(workspace);
  mkdirSync(stateDir);
  chmodSync(stateDir, 0o700);
  return { base, workspace, stateDir, policyPath: join(base, "policy.json") };
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

function writePolicy(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value));
}

void test("policy-file: an absent policy file warns that defaults are in effect, with a fix (D-21, D-44)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /defaults in effect/);
  assert.match(fixOf(result), /workspaceRoots/);
});

void test("policy-file: a configured path with no policy file set in the options warns with a fix (D-21)", async (t) => {
  const { stateDir } = layout(t);
  const result = resultOf(await runChecks({ stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /no policy file path is configured/);
  assert.match(fixOf(result), /POLICY_DENIED/);
});

void test("policy-file: a valid policy outside its workspace roots passes with no fix (D-44)", async (t) => {
  const { workspace, policyPath, stateDir } = layout(t);
  writePolicy(policyPath, { workspaceRoots: [workspace] });
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
});

void test("policy-file: an unknown key fails and the fix names the key, never the value (D-15, D-44)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  writePolicy(policyPath, { bogus: "secret-value-7f3a" });
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /\/bogus: unknown key/);
  assert.match(fixOf(result), /schema/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /secret-value-7f3a/);
});

void test("policy-file: a relative workspace root fails and names the index, never the value (D-22, F-3)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  writePolicy(policyPath, { workspaceRoots: ["relative-root-value"] });
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /\/workspaceRoots\/0 must be an absolute path/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /relative-root-value/);
});

void test("policy-file: a file that is not JSON fails with a fix and without echoing its content (D-15, D-44)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  writeFileSync(policyPath, "{ not json secret-value-9c1d");
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /not valid JSON/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /secret-value-9c1d/);
});

void test("policy-file: a policy file inside its own workspace root fails with a move fix (D-22, D-44)", async (t) => {
  const { workspace, stateDir } = layout(t);
  const policyPath = join(workspace, "policy.json");
  writePolicy(policyPath, { workspaceRoots: [workspace] });
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "fail");
  assert.match(fixOf(result), /move it outside every workspace root/);
});

void test("state-dir: a missing directory warns that it is created on first use (D-37, D-44)", async (t) => {
  const { base, policyPath } = layout(t);
  const result = resultOf(await runChecks({ policyPath, stateDir: join(base, "not-yet"), env: DOCTOR_ENV }), "state-dir");
  assert.equal(result.status, "warn");
  assert.match(fixOf(result), /creates the state directory with mode 700 on first use/);
});

void test("state-dir: mode 0700 passes with no fix (D-37, D-44)", async (t) => {
  const { stateDir, policyPath } = layout(t);
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "state-dir");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
});

void test("state-dir: a wider mode fails with a chmod 700 fix (D-44)", async (t) => {
  const { stateDir, policyPath } = layout(t);
  chmodSync(stateDir, 0o755);
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "state-dir");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /mode is 755, expected 700/);
  assert.match(fixOf(result), /chmod 700/);
});

void test("state-dir: a file at the state directory path fails with a move-aside fix (D-44)", async (t) => {
  const { base, policyPath } = layout(t);
  const stateDir = join(base, "state-file");
  writeFileSync(stateDir, "not a directory");
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "state-dir");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /not a directory/);
  assert.match(fixOf(result), /Move the file/);
});

void test("session-store: a writable session directory passes, and the check writes no probe file (D-44)", async (t) => {
  const { stateDir, policyPath } = layout(t);
  const sessionsDir = join(stateDir, "sessions");
  mkdirSync(sessionsDir, { mode: 0o700 });
  const before = readdirSync(sessionsDir);

  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "session-store");

  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  assert.deepEqual(readdirSync(sessionsDir), before);
});

// A probe that refuses writes, with the error text the default probe would report.
const refused = (): { readonly writable: false; readonly reason: string } => ({
  writable: false,
  reason: "EACCES: permission denied",
});

void test("session-store: an unwritable session directory fails with an ownership fix (D-44)", async (t) => {
  const { stateDir, policyPath } = layout(t);
  mkdirSync(join(stateDir, "sessions"), { mode: 0o700 });
  const result = resultOf(await runChecks({ policyPath, stateDir, canWrite: refused, env: DOCTOR_ENV }), "session-store");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /not writable/);
  assert.match(fixOf(result), /ownership/);
});

void test("session-store: a refused write keeps the probe's error text as the detail reason (QUAL-01)", async (t) => {
  const { stateDir, policyPath } = layout(t);
  mkdirSync(join(stateDir, "sessions"), { mode: 0o700 });
  const canWrite = (): { readonly writable: false; readonly reason: string } => ({
    writable: false,
    reason: "EACCES: permission denied, access 'sessions'",
  });
  const result = resultOf(await runChecks({ policyPath, stateDir, canWrite, env: DOCTOR_ENV }), "session-store");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /EACCES: permission denied, access 'sessions'/);
});

void test("session-store: an absent session directory warns when its nearest ancestor is writable (D-37, D-44)", async (t) => {
  const { stateDir, policyPath } = layout(t);
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "session-store");
  assert.equal(result.status, "warn");
  assert.match(fixOf(result), /creates the session store on first use/);
});

void test("session-store: an absent session directory fails when no ancestor is writable (D-44)", async (t) => {
  const { stateDir, policyPath } = layout(t);
  const result = resultOf(await runChecks({ policyPath, stateDir, canWrite: refused, env: DOCTOR_ENV }), "session-store");
  assert.equal(result.status, "fail");
  assert.match(fixOf(result), /ownership/);
});

void test("the nine checks are registered in report order, with control-channel and agentos after anda-bridge (D-44, D-69, CLI-03)", async (t) => {
  const { policyPath, stateDir } = layout(t);
  // Every seam is injected: each command fails to start and each socket is refused, so the run spawns no
  // process and opens no socket. The andaUrl is absent, so no engine is contacted either.
  const results = await runChecks({
    policyPath,
    stateDir,
    env: { PATH: "/usr/bin:/bin", HOME: "/home/realm", XDG_RUNTIME_DIR: "/run/user/1000" },
    runCommand: () => Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    connectSocket: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })),
  });
  assert.deepEqual(
    results.map((result) => result.id),
    REGISTERED_IDS,
  );
});
