import { after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import {
  MIN_OMP_VERSION,
  runChecks as runDoctor,
  type CheckResult,
  type DoctorOptions,
  type OmpPluginProbe,
  type OmpPluginReading,
} from "../../src/doctor/checks.js";

// Enumerating hermetic tests for the omp-plugin doctor item (Phase 55, HEALTH-01). Every case
// injects a fake probe, so no receipt, marker or `omp --version` output is read from disk and no
// process runs for this item. The other items run with the same fakes checks.test.ts uses.

const EMPTY_PATH_DIR = realpathSync(mkdtempSync(join(tmpdir(), "realm-doctor-empty-path-")));
after(() => {
  rmSync(EMPTY_PATH_DIR, { recursive: true, force: true });
});
const DOCTOR_ENV = { PATH: EMPTY_PATH_DIR, HOME: "/root" };

interface Layout {
  readonly base: string;
  readonly workspace: string;
  readonly stateDir: string;
  readonly policyPath: string;
}

function layout(t: TestContext): Layout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-doctor-omp-")));
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

async function ompResult(
  t: TestContext,
  probeOmpPlugin: OmpPluginProbe,
  extra: Partial<DoctorOptions> = {},
): Promise<CheckResult> {
  const { policyPath, stateDir } = layout(t);
  const results = await runDoctor({
    policyPath,
    stateDir,
    env: DOCTOR_ENV,
    runCommand: () => Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
    connectSocket: () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })),
    probeOmpPlugin,
    ...extra,
  });
  const found = results.find((result) => result.id === "omp-plugin");
  assert.ok(found, "expected a result for omp-plugin");
  assert.equal(results.at(-1)?.id, "omp-plugin", "omp-plugin is the last item in report order");
  return found;
}

function fixOf(result: CheckResult): string {
  assert.equal(typeof result.fix, "string", `${result.id} must carry a fix when it is not a pass`);
  return result.fix ?? "";
}

const healthy: Extract<OmpPluginReading, { readonly installed: true }> = {
  installed: true,
  version: MIN_OMP_VERSION,
  target: "present",
  liveSessions: 1,
  unreadableMarkers: 0,
};

void test("omp-plugin: installed, right version, target present and loaded passes with no fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve(healthy));
  assert.equal(result.status, "pass");
  assert.match(result.detail, /installed and loaded/);
  assert.match(result.detail, /\d+ live plugin session/);
  assert.equal(result.fix, null);
});

void test("omp-plugin: a newer Omp version also passes (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ ...healthy, version: "19.0.0" }));
  assert.equal(result.status, "pass");
  assert.match(result.detail, /19\.0\.0/);
});

void test("omp-plugin: not installed warns with the install fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ installed: false }));
  assert.equal(result.status, "warn");
  assert.match(result.detail, /not installed/);
  assert.match(fixOf(result), /realm host install omp/);
  assert.match(fixOf(result), /Doctor installs, removes and repairs nothing/);
});

void test("omp-plugin: a version below the minimum fails with the upgrade fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ ...healthy, version: "18.12.5" }));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /18\.12\.5 is not 18\.12\.6 or later/);
  assert.match(fixOf(result), /Upgrade Omp to 18\.12\.6 or later/);
  assert.match(fixOf(result), /Realm does not install or upgrade Omp/);
});

void test("omp-plugin: an older major version fails with the upgrade fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ ...healthy, version: "17.99.99" }));
  assert.equal(result.status, "fail");
  assert.match(fixOf(result), /Upgrade Omp/);
});

void test("omp-plugin: an unreadable version fails with the upgrade fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ ...healthy, version: null }));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /version could not be read/);
  assert.match(fixOf(result), /Upgrade Omp/);
});

void test("omp-plugin: an unparseable version fails with the upgrade fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ ...healthy, version: "unknown" }));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /unknown is not 18\.12\.6 or later/);
  assert.match(fixOf(result), /Upgrade Omp/);
});

void test("omp-plugin: a missing extension target fails with the build fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ ...healthy, target: "missing" }));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /extension target missing/);
  assert.match(fixOf(result), /npm run build/);
  assert.match(fixOf(result), /realm host install omp/);
});

void test("omp-plugin: an unreadable extension target fails with the shim fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ ...healthy, target: "unreadable" }));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /extension target unreadable/);
  assert.match(fixOf(result), /repair it by hand/);
});

void test("omp-plugin: unreadable presence markers warn with the inspect fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ ...healthy, unreadableMarkers: 2 }));
  assert.equal(result.status, "warn");
  assert.match(result.detail, /2 unreadable presence marker/);
  assert.match(fixOf(result), /without following symlinks/);
});

void test("omp-plugin: installed but not loaded warns with the start-a-session fix (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.resolve({ ...healthy, liveSessions: 0 }));
  assert.equal(result.status, "warn");
  assert.match(result.detail, /installed but not loaded/);
  assert.match(fixOf(result), /Start an Omp session yourself/);
  assert.match(fixOf(result), /Doctor never signals a process/);
});

void test("omp-plugin: a probe that throws a catalogue error fails with that code (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.reject(new RealmError("PATH_ESCAPE")));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /could not be read \(PATH_ESCAPE\)/);
  assert.match(fixOf(result), /without following symlinks/);
});

void test("omp-plugin: a probe that throws a plain error fails with SCHEMA_INVALID, never silently (HEALTH-01)", async (t) => {
  const result = await ompResult(t, () => Promise.reject(new Error("boom")));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /could not be read \(SCHEMA_INVALID\)/);
});

void test("omp-plugin: a probe that never answers times out as TOOL_TIMEOUT (HEALTH-01)", async (t) => {
  const never: OmpPluginProbe = () => new Promise<OmpPluginReading>(() => {});
  const result = await ompResult(t, never, { probeTimeoutMs: 50 });
  assert.equal(result.status, "fail");
  assert.match(result.detail, /could not be read \(TOOL_TIMEOUT\)/);
});

void test("omp-plugin: the check is read-only, it writes nothing, spawns nothing and opens no socket (HEALTH-01)", async (t) => {
  const { stateDir } = layout(t);
  const before = readdirSync(stateDir).sort();
  const commands: string[] = [];
  const sockets: string[] = [];
  const results = await runDoctor({
    stateDir,
    env: DOCTOR_ENV,
    runCommand: (file: string) => {
      commands.push(file);
      return Promise.reject(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
    },
    connectSocket: (socketPath: string) => {
      sockets.push(socketPath);
      return Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
    },
    probeOmpPlugin: () => Promise.resolve(healthy),
  });
  const found = results.find((result) => result.id === "omp-plugin");
  assert.ok(found);
  assert.equal(found.status, "pass");
  assert.deepEqual(readdirSync(stateDir).sort(), before, "the omp-plugin check wrote no file");
  // The only commands and socket dials are the other items' seams; with the probe injected the
  // omp-plugin item itself starts no `omp` process and dials nothing.
  assert.ok(!commands.includes("omp"), "the omp-plugin check spawned no omp process");
  assert.ok(!sockets.some((socketPath) => socketPath.includes("omp")), "the omp-plugin check opened no socket");
});
