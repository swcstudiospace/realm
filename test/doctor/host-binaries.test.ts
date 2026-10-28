import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { hostBinaryPinsFromEnv, runChecks, type CheckResult, type DoctorOptions } from "../../src/doctor/checks.js";
import type { RunCommand } from "../../src/runtime/podman-probe.js";

// The four host binaries are fake executable files in a temporary directory, and every --version call goes through an injected
// runCommand, so no process runs. The digests are computed from the fake files' own contents.

type BinaryName = "supervisor" | "openshell" | "openshell-gateway" | "podman";

const NAMES: readonly BinaryName[] = ["supervisor", "openshell", "openshell-gateway", "podman"];
const VERSION_OUTPUT: Readonly<Record<string, string>> = {
  "openshell-supervisor": "openshell-sandbox 0.1.5\n",
  openshell: "openshell 0.1.5\n",
  "openshell-gateway": "openshell-gateway 0.1.5\n",
  podman: "podman version 5.0.0\n",
};
const VERSIONS: Readonly<Record<BinaryName, string>> = {
  supervisor: "0.1.5",
  openshell: "0.1.5",
  "openshell-gateway": "0.1.5",
  podman: "5.0.0",
};

// A pin for every binary, each matching its fixture.
type Pins = Partial<Record<BinaryName, { readonly version: string; readonly sha256: string; readonly path: string }>>;

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

interface Fixture {
  readonly policyPath: string;
  readonly stateDir: string;
  readonly binDir: string;
  readonly paths: Readonly<Record<BinaryName, string>>;
  readonly digests: Readonly<Record<BinaryName, string>>;
  readonly env: Readonly<Record<string, string>>;
  readonly calls: Call[];
  readonly runCommand: RunCommand;
}

// Writes the fake binaries except the named ones, so a missing binary can be tested.
function fixtureFor(t: TestContext, omit: readonly BinaryName[] = []): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-host-binaries-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  const binDir = join(base, "bin");
  const supervisorDir = join(base, "supervisor");
  mkdirSync(stateDir);
  chmodSync(stateDir, 0o700);
  mkdirSync(binDir);
  mkdirSync(supervisorDir);
  const paths: Record<BinaryName, string> = {
    supervisor: join(supervisorDir, "openshell-supervisor"),
    openshell: join(binDir, "openshell"),
    "openshell-gateway": join(binDir, "openshell-gateway"),
    podman: join(binDir, "podman"),
  };
  const digests: Record<string, string> = {};
  for (const name of NAMES) {
    const contents = `fixture binary ${name}\n`;
    digests[name] = createHash("sha256").update(contents).digest("hex");
    if (!omit.includes(name)) {
      writeFileSync(paths[name], contents);
      chmodSync(paths[name], 0o755);
    }
  }
  const calls: Call[] = [];
  const runCommand: RunCommand = (file, args, options) => {
    calls.push({ file, args, env: options.env });
    const stdout = VERSION_OUTPUT[basename(file)];
    if (stdout === undefined || args.join(" ") !== "--version") {
      return Promise.reject(Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" }));
    }
    return Promise.resolve({ exitCode: 0, stdout });
  };
  return {
    policyPath: join(base, "policy.json"),
    stateDir,
    binDir,
    paths,
    digests: digests as Record<BinaryName, string>,
    env: {
      PATH: binDir,
      HOME: "/home/realm",
      XDG_RUNTIME_DIR: "/run/user/1000",
      REALM_DRIVER_SUPERVISOR_BINARY: paths.supervisor,
      REALM_SECRET_TOKEN: "do-not-pass",
    },
    calls,
    runCommand,
  };
}

async function hostBinaries(fixture: Fixture, extra: Partial<DoctorOptions> = {}): Promise<CheckResult> {
  const results = await runChecks({
    policyPath: fixture.policyPath,
    stateDir: fixture.stateDir,
    env: fixture.env,
    runCommand: fixture.runCommand,
    readPtraceScope: () => "1\n",
    ...extra,
  });
  const found = results.find((result) => result.id === "host-binaries");
  assert.ok(found, "expected a host-binaries result");
  return found;
}

// Applies the override to the four fixture binaries only; every other doctor check keeps the fixture runner.
function overrideBinaries(fixture: Fixture, override: RunCommand): RunCommand {
  const binaryPaths = new Set<string>(NAMES.map((name) => fixture.paths[name]));
  return (file, args, options) => (binaryPaths.has(file) ? override(file, args, options) : fixture.runCommand(file, args, options));
}

function binaryCalls(fixture: Fixture): Call[] {
  const binaryPaths = new Set<string>(NAMES.map((name) => fixture.paths[name]));
  return fixture.calls.filter((call) => binaryPaths.has(call.file));
}

function prefixOf(digest: string): string {
  return digest.slice(0, 12);
}

function assertNoPaths(fixture: Fixture, result: CheckResult): void {
  const text = `${result.detail} ${result.fix ?? ""}`;
  assert.ok(!text.includes(fixture.binDir), "the result must not carry the binary directory");
  assert.ok(!text.includes(fixture.paths.supervisor), "the result must not carry the supervisor path");
}

void test("host-binaries: every binary present and every set pin matching passes with name, version and digest prefix", async (t) => {
  const fixture = fixtureFor(t);
  const hostBinaryPins: Pins = {};
  for (const name of NAMES) {
    hostBinaryPins[name] = { version: VERSIONS[name], sha256: fixture.digests[name], path: fixture.paths[name] };
  }
  const result = await hostBinaries(fixture, { hostBinaryPins });
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  for (const name of NAMES) {
    assert.ok(result.detail.includes(`${name} ${VERSIONS[name]} ${prefixOf(fixture.digests[name])}`), `detail lists ${name}`);
  }
  assertNoPaths(fixture, result);
});

void test("host-binaries: with no pin set the item warns about the unpinned supervisor only, and still reports every version and digest", async (t) => {
  const fixture = fixtureFor(t);
  const result = await hostBinaries(fixture);
  assert.equal(result.status, "warn");
  assert.match(result.detail, /supervisor has no sha256 pin/);
  assert.ok(result.detail.includes(fixture.digests.supervisor), "the full digest is shown so it can be pinned");
  assert.doesNotMatch(result.detail, /(openshell|openshell-gateway|podman) (has no|sha256 differs|was not found|version could not)/);
  assert.ok(result.detail.includes(`podman 5.0.0 ${prefixOf(fixture.digests.podman)}`));
  assert.ok((result.fix ?? "").includes("set REALM_DRIVER_SUPERVISOR_SHA256 to the sha256 shown above"));
  assert.doesNotMatch(result.fix ?? "", /REALM_HOST_PIN/, "no other problem, so no generic pin advice");
  assertNoPaths(fixture, result);
});

void test("host-binaries: REALM_DRIVER_SUPERVISOR_SHA256 alone pins the supervisor, so one variable pins both the driver and the doctor", async (t) => {
  const fixture = fixtureFor(t);
  const result = await hostBinaries(fixture, { env: { ...fixture.env, REALM_DRIVER_SUPERVISOR_SHA256: fixture.digests.supervisor } });
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  const wrong = await hostBinaries(fixture, { env: { ...fixture.env, REALM_DRIVER_SUPERVISOR_SHA256: "c".repeat(64) } });
  assert.equal(wrong.status, "warn");
  assert.match(wrong.detail, /supervisor sha256 differs from its pin/);
});

void test("host-binaries: REALM_HOST_PIN_SUPERVISOR_SHA256 takes precedence over REALM_DRIVER_SUPERVISOR_SHA256", async (t) => {
  const fixture = fixtureFor(t);
  const result = await hostBinaries(fixture, {
    env: {
      ...fixture.env,
      REALM_HOST_PIN_SUPERVISOR_SHA256: "d".repeat(64),
      REALM_DRIVER_SUPERVISOR_SHA256: fixture.digests.supervisor,
    },
  });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /supervisor sha256 differs from its pin/);
});

void test("host-binaries: a supervisor pin that names only a version still counts as unpinned, and the other problems keep the generic fix", async (t) => {
  const fixture = fixtureFor(t, ["podman"]);
  const result = await hostBinaries(fixture, { hostBinaryPins: { supervisor: { version: VERSIONS.supervisor } } });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /supervisor has no sha256 pin/);
  assert.match(result.detail, /podman was not found on PATH/);
  assert.match(result.fix ?? "", /REALM_HOST_PIN_<NAME>_SHA256/);
  assert.match(result.fix ?? "", /set REALM_DRIVER_SUPERVISOR_SHA256 to the sha256 shown above/);
});

void test("host-binaries: each binary is run with --version only, under a minimal environment", async (t) => {
  const fixture = fixtureFor(t);
  await hostBinaries(fixture);
  assert.deepEqual(
    binaryCalls(fixture).map((call) => call.file).sort(),
    NAMES.map((name) => fixture.paths[name]).sort(),
    "the resolved executables are run, so the same paths are hashed and run",
  );
  for (const call of binaryCalls(fixture)) {
    assert.deepEqual(call.args, ["--version"]);
    assert.deepEqual(Object.keys(call.env).sort(), ["HOME", "PATH", "XDG_RUNTIME_DIR"]);
  }
});

void test("host-binaries: a missing binary warns with a fix that says how to record a pin, and never fails", async (t) => {
  const fixture = fixtureFor(t, ["openshell-gateway"]);
  const result = await hostBinaries(fixture);
  assert.equal(result.status, "warn");
  assert.match(result.detail, /openshell-gateway was not found on PATH/);
  assert.ok(result.detail.includes(`podman 5.0.0 ${prefixOf(fixture.digests.podman)}`), "the binaries that were found are still listed");
  assert.match(result.fix ?? "", /REALM_HOST_PIN_<NAME>_SHA256/);
  assert.match(result.fix ?? "", /REALM_HOST_PIN_<NAME>_VERSION/);
  assertNoPaths(fixture, result);
});

void test("host-binaries: an unset or non-executable supervisor path warns", async (t) => {
  const fixture = fixtureFor(t, ["supervisor"]);
  const result = await hostBinaries(fixture);
  assert.equal(result.status, "warn");
  assert.match(result.detail, /supervisor is not configured or not executable/);
  const withoutSupervisor = Object.fromEntries(
    Object.entries(fixture.env).filter(([key]) => key !== "REALM_DRIVER_SUPERVISOR_BINARY"),
  );
  const unset = await hostBinaries(fixtureFor(t), { env: withoutSupervisor });
  assert.equal(unset.status, "warn");
  assert.match(unset.detail, /supervisor is not configured or not executable/);
});

void test("host-binaries: a version that differs from its pin warns and names both versions", async (t) => {
  const fixture = fixtureFor(t);
  const result = await hostBinaries(fixture, { hostBinaryPins: { openshell: { version: "0.1.2" } } });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /openshell reports 0\.1\.5 but its pin says 0\.1\.2/);
  assert.notEqual(result.fix, null);
});

void test("host-binaries: a digest that differs from its pin warns without echoing the pinned digest", async (t) => {
  const fixture = fixtureFor(t);
  const pinned = "a".repeat(64);
  const result = await hostBinaries(fixture, { hostBinaryPins: { podman: { sha256: pinned } } });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /podman sha256 differs from its pin/);
  assert.ok(!result.detail.includes(pinned));
  assert.ok(!result.detail.includes(fixture.digests.podman), "only a digest prefix is reported");
});

void test("host-binaries: a digest pin in upper case is a problem, because the driver accepts only lowercase hex", async (t) => {
  const fixture = fixtureFor(t);
  const result = await hostBinaries(fixture, {
    hostBinaryPins: { supervisor: { sha256: fixture.digests.supervisor }, podman: { sha256: fixture.digests.podman.toUpperCase() } },
  });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /podman sha256 pin is not 64 lowercase hex characters/);
  assert.doesNotMatch(result.detail, /podman sha256 differs from its pin/);
  assert.ok((result.fix ?? "").includes("a pin must be 64 lowercase hex characters"));
});

void test("host-binaries: a lowercase digest pin of the same digest passes", async (t) => {
  const fixture = fixtureFor(t);
  const result = await hostBinaries(fixture, {
    hostBinaryPins: { supervisor: { sha256: fixture.digests.supervisor }, podman: { sha256: fixture.digests.podman } },
  });
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
});

void test("host-binaries: a binary that resolves outside its pinned location warns", async (t) => {
  const fixture = fixtureFor(t);
  const result = await hostBinaries(fixture, { hostBinaryPins: { podman: { path: join(fixture.binDir, "elsewhere", "podman") } } });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /podman does not resolve to its pinned location/);
  assertNoPaths(fixture, result);
});

void test("host-binaries: a version command that cannot run warns instead of failing, and the digest is still reported", async (t) => {
  const fixture = fixtureFor(t);
  const result = await hostBinaries(fixture, {
    runCommand: overrideBinaries(fixture, () => Promise.reject(new Error("spawn failed with a raw runtime message"))),
  });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /podman version could not be read/);
  assert.ok(result.detail.includes(`podman unknown ${prefixOf(fixture.digests.podman)}`));
  assert.ok(!result.detail.includes("raw runtime message"));
});

void test("host-binaries: a version command that exits non-zero warns", async (t) => {
  const fixture = fixtureFor(t);
  const result = await hostBinaries(fixture, {
    runCommand: overrideBinaries(fixture, () => Promise.resolve({ exitCode: 1, stdout: "podman version 5.0.0\n" })),
  });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /podman version could not be read/);
});

void test("host-binaries: a version command that never finishes is bounded by the probe timeout", async (t) => {
  const fixture = fixtureFor(t);
  const started = Date.now();
  const result = await hostBinaries(fixture, {
    probeTimeoutMs: 100,
    runCommand: overrideBinaries(fixture, () => new Promise(() => undefined)),
  });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /podman version could not be read/);
  assert.ok(Date.now() - started < 2000, "the probe ends at its deadline");
});

// A fixture whose podman is 16 MiB, so hashing it takes far longer than a 1 ms bound without making the test slow.
function writeLargePodman(fixture: Fixture): string {
  const contents = Buffer.alloc(16 * 1024 * 1024, 7);
  writeFileSync(fixture.paths.podman, contents);
  chmodSync(fixture.paths.podman, 0o755);
  return createHash("sha256").update(contents).digest("hex");
}

void test("host-binaries: the digest has its own bound, so a probe timeout shorter than the read does not hide it", async (t) => {
  const fixture = fixtureFor(t);
  const digest = writeLargePodman(fixture);
  const result = await hostBinaries(fixture, { probeTimeoutMs: 1 });
  assert.ok(result.detail.includes(`podman 5.0.0 ${prefixOf(digest)}`), result.detail);
  assert.doesNotMatch(result.detail, /podman sha256 could not be computed/);
});

void test("host-binaries: a digest that outlasts its own bound warns that it could not be computed and reports it as unknown", async (t) => {
  const fixture = fixtureFor(t);
  writeLargePodman(fixture);
  const result = await hostBinaries(fixture, { hashTimeoutMs: 1 });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /podman sha256 could not be computed/);
  assert.ok(result.detail.includes("podman 5.0.0 unknown"), result.detail);
});

void test("host-binaries: the first executable of a name on PATH is the one inspected", async (t) => {
  const fixture = fixtureFor(t);
  const shadow = join(fixture.binDir, "shadow");
  mkdirSync(shadow);
  writeFileSync(join(shadow, "podman"), "a different podman\n");
  chmodSync(join(shadow, "podman"), 0o755);
  const result = await hostBinaries(fixture, { env: { ...fixture.env, PATH: `${shadow}:${fixture.binDir}` } });
  const shadowDigest = createHash("sha256").update("a different podman\n").digest("hex");
  assert.ok(result.detail.includes(`podman 5.0.0 ${prefixOf(shadowDigest)}`));
});

void test("host-binaries: pins are read from the REALM_HOST_PIN names of the caller's environment when none are passed", async (t) => {
  const fixture = fixtureFor(t);
  const env = {
    ...fixture.env,
    REALM_HOST_PIN_OPENSHELL_GATEWAY_VERSION: "0.1.2",
    REALM_HOST_PIN_PODMAN_SHA256: fixture.digests.podman,
  };
  const result = await hostBinaries(fixture, { env });
  assert.equal(result.status, "warn");
  assert.match(result.detail, /openshell-gateway reports 0\.1\.5 but its pin says 0\.1\.2/);
  assert.doesNotMatch(result.detail, /podman sha256 differs/);
});

void test("host-binaries: hostBinaryPinsFromEnv reads the path, version and digest of each binary and ignores empty values", () => {
  const pins = hostBinaryPinsFromEnv({
    REALM_HOST_PIN_SUPERVISOR_SHA256: "b".repeat(64),
    REALM_HOST_PIN_OPENSHELL_VERSION: " 0.1.5 ",
    REALM_HOST_PIN_OPENSHELL_PATH: "/usr/local/bin/openshell",
    REALM_HOST_PIN_OPENSHELL_GATEWAY_SHA256: "",
    REALM_HOST_PIN_PODMAN_VERSION: "5.0.0",
  });
  assert.deepEqual(pins, {
    supervisor: { sha256: "b".repeat(64) },
    openshell: { version: "0.1.5", path: "/usr/local/bin/openshell" },
    podman: { version: "5.0.0" },
  });
});

void test("host-binaries: hostBinaryPinsFromEnv falls back to REALM_DRIVER_SUPERVISOR_SHA256 for the supervisor digest only", () => {
  assert.deepEqual(hostBinaryPinsFromEnv({ REALM_DRIVER_SUPERVISOR_SHA256: "e".repeat(64) }), { supervisor: { sha256: "e".repeat(64) } });
  assert.deepEqual(
    hostBinaryPinsFromEnv({ REALM_HOST_PIN_SUPERVISOR_SHA256: "b".repeat(64), REALM_DRIVER_SUPERVISOR_SHA256: "e".repeat(64) }),
    { supervisor: { sha256: "b".repeat(64) } },
  );
  assert.deepEqual(hostBinaryPinsFromEnv({ REALM_DRIVER_SUPERVISOR_SHA256: "  " }), { supervisor: { sha256: "  " } });
  assert.deepEqual(hostBinaryPinsFromEnv({ REALM_DRIVER_SUPERVISOR_SHA256: "" }), { supervisor: { sha256: "" } });
  assert.deepEqual(hostBinaryPinsFromEnv({ REALM_HOST_PIN_SUPERVISOR_SHA256: "  " }), {});
});

void test("host-binaries: a REALM_DRIVER_SUPERVISOR_SHA256 the driver would refuse (padded, newline-terminated or empty) warns as a malformed pin", async (t) => {
  const fixture = fixtureFor(t);
  for (const value of [`${fixture.digests.supervisor}\n`, ` ${fixture.digests.supervisor} `, ""]) {
    const result = await hostBinaries(fixture, { env: { ...fixture.env, REALM_DRIVER_SUPERVISOR_SHA256: value } });
    assert.equal(result.status, "warn", JSON.stringify(value));
    assert.match(result.detail, /supervisor sha256 pin is not 64 lowercase hex characters/, JSON.stringify(value));
    assert.doesNotMatch(result.detail, /supervisor has no sha256 pin/, JSON.stringify(value));
    assert.ok((result.fix ?? "").includes("a pin must be 64 lowercase hex characters"), JSON.stringify(value));
  }
  const clean = await hostBinaries(fixture, { env: { ...fixture.env, REALM_DRIVER_SUPERVISOR_SHA256: fixture.digests.supervisor } });
  assert.equal(clean.status, "pass");
  assert.equal(clean.fix, null);
});
