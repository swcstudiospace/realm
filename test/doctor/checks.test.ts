import { after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks as runDoctor, type CheckId, type CheckResult, type DoctorOptions } from "../../src/doctor/checks.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../../src/runtime/config.js";

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
  "host-binaries",
  "kernel-hardening",
  "runtime-roots",
];

// The explicit host environment each doctor run receives in these tests. The doctor reads no process environment. PATH names an
// empty directory, so no host binary is found, hashed or run, and every command fails to start.
const EMPTY_PATH_DIR = realpathSync(mkdtempSync(join(tmpdir(), "realm-doctor-empty-path-")));
after(() => {
  rmSync(EMPTY_PATH_DIR, { recursive: true, force: true });
});
const DOCTOR_ENV = { PATH: EMPTY_PATH_DIR, HOME: "/root" };

function runChecks(options: DoctorOptions): Promise<readonly CheckResult[]> {
  return runDoctor({
    runCommand: () => Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    ...options,
  });
}

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
  assert.match(result.detail, /defaults in effect \(fail-closed mode, no workspace roots, shell disabled\)/);
  assert.match(fixOf(result), /workspaceRoots/);
});

void test("policy-file: a configured path with no policy file set in the options warns with a fix (D-21)", async (t) => {
  const { stateDir } = layout(t);
  const result = resultOf(await runChecks({ stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /no policy file path is configured/);
  assert.match(fixOf(result), /POLICY_DENIED/);
});

void test("policy-file: a valid policy with no mode passes and says fail-closed is the default (D4, D-44)", async (t) => {
  const { workspace, policyPath, stateDir } = layout(t);
  writePolicy(policyPath, { workspaceRoots: [workspace] });
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "pass");
  assert.match(result.detail, /mode fail-closed \(the default; the file sets no mode\)/);
  assert.equal(result.fix, null);
});

void test("policy-file: a policy that names fail-closed passes and names the mode (D4)", async (t) => {
  const { workspace, policyPath, stateDir } = layout(t);
  writePolicy(policyPath, { mode: "fail-closed", workspaceRoots: [workspace] });
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "pass");
  assert.match(result.detail, /mode fail-closed$/);
  assert.equal(result.fix, null);
});

void test("policy-file: an explicit advisory mode warns that it is not containment and says how to fix it (D4)", async (t) => {
  const { workspace, policyPath, stateDir } = layout(t);
  writePolicy(policyPath, { mode: "advisory", workspaceRoots: [workspace] });
  const result = resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV }), "policy-file");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /mode advisory \(explicit\)/);
  assert.match(result.detail, /host writes proceed with a warning while the realm is not active/);
  assert.match(result.detail, /not containment/);
  assert.match(fixOf(result), /"mode": "fail-closed"/);
  assert.match(fixOf(result), /delete the key/);
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

void test("the checks are registered in report order, with runtime-roots appended when no runtime config is passed", async (t) => {
  const { policyPath, stateDir } = layout(t);
  // Every seam is injected: each command fails to start and each socket is refused, so the run spawns no
  // process and opens no socket. The andaUrl is absent, so no engine is contacted either.
  const results = await runChecks({
    policyPath,
    stateDir,
    env: { PATH: EMPTY_PATH_DIR, HOME: "/home/realm", XDG_RUNTIME_DIR: "/run/user/1000" },
    runCommand: () => Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    connectSocket: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })),
  });
  assert.deepEqual(
    results.map((result) => result.id),
    REGISTERED_IDS,
  );
});

// ---- ONB-04 driver roots. runtime-roots reports each condition of the three roots once: unset, relative, mode-wrong, absent, or
// pass. The roots resolve from config.json (ONB-03). Each test writes real directories, so the modes are real.

const ROOT_IMAGE = `ghcr.io/example/realm-agent@sha256:${"a".repeat(64)}`;

function privateDir(path: string): void {
  mkdirSync(path);
  chmodSync(path, 0o700);
}

// A config whose roots sit under the test layout. The optional roots are named only when extra names them, so the others take their
// defaults under stateDir.
function rootConfig(stateDir: string, workspaceRoot: string, extra: Readonly<Record<string, string>> = {}): RuntimeConfig {
  return loadRuntimeConfig({ image: ROOT_IMAGE, stateDir, workspaceRoot, ...extra });
}

async function rootsReport(policyPath: string, stateDir: string, runtimeConfig: RuntimeConfig): Promise<CheckResult> {
  return resultOf(await runChecks({ policyPath, stateDir, env: DOCTOR_ENV, runtimeConfig }), "runtime-roots");
}

void test("runtime-roots: the three roots named in config.json pass with the valid-config detail and no fix (ONB-04)", async (t) => {
  const { base, workspace, stateDir, policyPath } = layout(t);
  const secrets = join(base, "secrets");
  const sandboxes = join(base, "sandboxes");
  privateDir(secrets);
  privateDir(sandboxes);
  const result = await rootsReport(policyPath, stateDir, rootConfig(stateDir, workspace, { secretRoot: secrets, sandboxStateRoot: sandboxes }));
  assert.equal(result.status, "pass");
  assert.equal(
    result.detail,
    "secretRoot and sandboxStateRoot are absolute directories at mode 0700; workspaceRoot is an account-owned directory",
  );
  assert.equal(result.fix, null);
});

void test("runtime-roots: a secretRoot or sandboxStateRoot that config.json omits warns once, as its default under stateDir (ONB-03, ONB-04)", async (t) => {
  const { workspace, stateDir, policyPath } = layout(t);
  privateDir(join(stateDir, "secrets"));
  privateDir(join(stateDir, "sandboxes"));
  const result = await rootsReport(policyPath, stateDir, rootConfig(stateDir, workspace));
  assert.equal(result.status, "warn");
  assert.match(result.detail, /secretRoot not named in config\.json; the default under stateDir is in effect/);
  assert.match(result.detail, /sandboxStateRoot not named in config\.json/);
  assert.match(fixOf(result), /config\.json/);
  assert.match(fixOf(result), /realm init/);
});

void test("runtime-roots: an omitted root whose default is absent fails as absent, and is not also reported as omitted (ONB-04)", async (t) => {
  const { workspace, stateDir, policyPath } = layout(t);
  const result = await rootsReport(policyPath, stateDir, rootConfig(stateDir, workspace));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /secretRoot is absent/);
  assert.doesNotMatch(result.detail, /not named in config\.json/);
  assert.match(fixOf(result), /realm init/);
});

void test("runtime-roots: an empty root fails as unset and names the root, never its value (ONB-04)", async (t) => {
  const { workspace, stateDir, policyPath } = layout(t);
  const runtimeConfig: RuntimeConfig = { ...rootConfig(stateDir, workspace), workspaceRoot: "" };
  const result = await rootsReport(policyPath, stateDir, runtimeConfig);
  assert.equal(result.status, "fail");
  assert.match(result.detail, /workspaceRoot is unset/);
  assert.doesNotMatch(result.detail, /workspaceRoot is not absolute/);
  assert.match(fixOf(result), /config\.json/);
});

void test("runtime-roots: a relative root fails as not absolute, names the key and never the value (ONB-04)", async (t) => {
  const { workspace, stateDir, policyPath } = layout(t);
  const runtimeConfig: RuntimeConfig = { ...rootConfig(stateDir, workspace), workspaceRoot: "relative-root-4c9e" };
  const result = await rootsReport(policyPath, stateDir, runtimeConfig);
  assert.equal(result.status, "fail");
  assert.match(result.detail, /workspaceRoot is not absolute/);
  assert.doesNotMatch(result.detail, /workspaceRoot is unset/);
  assert.match(fixOf(result), /absolute path/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /relative-root-4c9e/);
});

void test("runtime-roots: a secretRoot at 0755 fails as mode-wrong and names the mode and the root, never a path (ONB-04)", async (t) => {
  const { base, workspace, stateDir, policyPath } = layout(t);
  const secrets = join(base, "secrets");
  mkdirSync(secrets);
  chmodSync(secrets, 0o755);
  const sandboxes = join(base, "sandboxes");
  privateDir(sandboxes);
  const result = await rootsReport(policyPath, stateDir, rootConfig(stateDir, workspace, { secretRoot: secrets, sandboxStateRoot: sandboxes }));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /secretRoot mode is 0755, expected 0700/);
  assert.match(fixOf(result), /chmod 0700/);
  assert.doesNotMatch(result.detail, /\//);
});

void test("runtime-roots: private roots at 0700 pass, and the workspace is not held to a mode (ONB-04)", async (t) => {
  const { base, workspace, stateDir, policyPath } = layout(t);
  chmodSync(workspace, 0o755);
  const secrets = join(base, "secrets");
  const sandboxes = join(base, "sandboxes");
  privateDir(secrets);
  privateDir(sandboxes);
  const result = await rootsReport(policyPath, stateDir, rootConfig(stateDir, workspace, { secretRoot: secrets, sandboxStateRoot: sandboxes }));
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
});

void test("the driver roots add no check id: a config adds only driver-socket and gateway after the runtime items, with no id twice (ONB-04)", async (t) => {
  const { workspace, stateDir, policyPath } = layout(t);
  const results = await runChecks({ policyPath, stateDir, env: DOCTOR_ENV, runtimeConfig: rootConfig(stateDir, workspace) });
  const ids = results.map((result) => result.id);
  assert.deepEqual(ids, [...REGISTERED_IDS, "driver-socket", "gateway"]);
  assert.equal(new Set(ids).size, ids.length, "no check id appears twice");
});
