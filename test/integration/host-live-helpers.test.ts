// The always-running hermetic test of test/support/host-live.ts: no host CLI, no Podman, no network (ADPT-08). It pins the skip-reason
// order of the four live files, the version parsing, the archived-Kimi detection, the stub realm, the isolated-environment allowlist,
// the temporary-directory guard and the process-group kill. The only processes it starts are `sh` and the scripts it writes itself.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { test, type TestContext } from "node:test";
import {
  collectHostLiveGate,
  describeRun,
  fileSha256,
  HOST_LIVE,
  type HostLiveGateInputs,
  hostLiveSkipReason,
  type HostLiveTier,
  isolatedHostEnv,
  isUnderTemp,
  KIMI_CODE_GAP,
  LIVE_HOST_IDS,
  type LiveHostId,
  ownedBlockOf,
  parseHostVersion,
  processAlive,
  readStubArgv,
  refusalReasonOf,
  requireReturned,
  resolveExecutable,
  runHost,
  stripAnsi,
  writeStubRealm,
} from "../support/host-live.js";
import { pollUntil } from "../support/production-live.js";
import { scaledMs } from "../support/timing.js";

const RECORDED_OUTPUT: Readonly<Record<LiveHostId, string>> = {
  claude: "2.1.322 (Claude Code)\n",
  codex: "codex-cli 0.154.0\n",
  opencode: "1.19.5\n",
  kimi: "kimi, version 1.51.0\n",
};

// A temporary directory removed when the test ends.
function tempDir(t: TestContext, prefix = "rlh-test-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// Inputs under which every prerequisite of `host` holds; a case overrides one field to break it.
function gateInputs(host: LiveHostId, overrides: Partial<HostLiveGateInputs> = {}): HostLiveGateInputs {
  return {
    platform: "linux",
    env: { [HOST_LIVE[host].optIn]: "1" },
    resolveBinary: (nameOrPath) => `/bin/${nameOrPath}`,
    versionProbe: { kind: "output", stdout: RECORDED_OUTPUT[host] },
    cliBuilt: true,
    receiptExists: false,
    production: false,
    ...overrides,
  };
}

const ALL_TIERS: readonly HostLiveTier[] = ["validator", "production"];

// ---- Table ------------------------------------------------------------------------------------------------------------------

void test("HOST_LIVE is a frozen table of the four hosts with the recorded facts", () => {
  assert.deepEqual([...LIVE_HOST_IDS], ["claude", "codex", "opencode", "kimi"]);
  assert.ok(Object.isFrozen(HOST_LIVE));
  const expected: Record<LiveHostId, readonly [string, string, string, string, boolean, boolean]> = {
    claude: ["REALM_LIVE_CLAUDE", "REALM_CLAUDE_BIN", "claude", "2.1.322", true, true],
    codex: ["REALM_LIVE_CODEX", "REALM_CODEX_BIN", "codex", "0.154.0", false, false],
    opencode: ["REALM_LIVE_OPENCODE", "REALM_OPENCODE_BIN", "opencode", "1.19.5", true, true],
    kimi: ["REALM_LIVE_KIMI", "REALM_KIMI_BIN", "kimi", "1.51.0", true, false],
  };
  for (const host of LIVE_HOST_IDS) {
    const spec = HOST_LIVE[host];
    assert.ok(Object.isFrozen(spec), host);
    assert.deepEqual([spec.optIn, spec.binOverride, spec.defaultBinary, spec.recordedVersion, spec.launchesOnValidate, spec.productionTier], expected[host], host);
    assert.deepEqual([...spec.versionArgs], ["--version"], host);
    assert.equal(spec.productionGap === null, spec.productionTier, `${host}: a gap exactly when there is no production tier`);
  }
  assert.match(HOST_LIVE.codex.productionGap ?? "", /`codex mcp list` does not start servers and a session needs model credentials/);
  assert.match(HOST_LIVE.kimi.productionGap ?? "", /no functional Kimi CLI release exists/);
  assert.match(KIMI_CODE_GAP, /no validator command and no listing command \(24-CONTEXT E-K5\)/);
});

// ---- Skip reasons ----------------------------------------------------------------------------------------------------------

void test("hostLiveSkipReason is false when every prerequisite holds, for both tiers of the hosts that have them", () => {
  for (const host of LIVE_HOST_IDS) {
    assert.equal(hostLiveSkipReason(host, "validator", gateInputs(host)), false, host);
  }
  assert.equal(hostLiveSkipReason("claude", "production", gateInputs("claude")), false);
  assert.equal(hostLiveSkipReason("opencode", "production", gateInputs("opencode")), false);
});

void test("hostLiveSkipReason names the opt-in variable first, and only the exact value 1 opens it", () => {
  for (const host of LIVE_HOST_IDS) {
    for (const tier of ALL_TIERS) {
      const nothing = gateInputs(host, {
        env: {},
        platform: "darwin",
        resolveBinary: () => undefined,
        versionProbe: { kind: "unavailable" },
        cliBuilt: false,
        receiptExists: true,
        production: "production reason",
      });
      assert.match(String(hostLiveSkipReason(host, tier, nothing)), new RegExp(`${HOST_LIVE[host].optIn}=1 is not set`), `${host} ${tier}`);
      for (const value of ["0", "true", ""]) {
        assert.match(String(hostLiveSkipReason(host, tier, gateInputs(host, { env: { [HOST_LIVE[host].optIn]: value } }))), /is not set/, `${host} value ${value}`);
      }
    }
  }
});

void test("hostLiveSkipReason names the platform second", () => {
  for (const host of LIVE_HOST_IDS) {
    const reason = hostLiveSkipReason(host, "validator", gateInputs(host, { platform: "darwin", resolveBinary: () => undefined, versionProbe: { kind: "unavailable" } }));
    assert.match(String(reason), /Linux only; this host is darwin/, host);
  }
});

void test("hostLiveSkipReason refuses a relative override before it looks for the executable, and names a missing executable after", () => {
  for (const host of LIVE_HOST_IDS) {
    const spec = HOST_LIVE[host];
    const asked: string[] = [];
    const relative = hostLiveSkipReason(
      host,
      "validator",
      gateInputs(host, {
        env: { [spec.optIn]: "1", [spec.binOverride]: `bin/${spec.defaultBinary}` },
        resolveBinary: (name) => {
          asked.push(name);
          return undefined;
        },
      }),
    );
    assert.match(String(relative), new RegExp(`${spec.binOverride} must be an absolute path`), host);
    assert.equal(asked.length, 0, `${host}: a relative override is never looked up`);

    const missing = hostLiveSkipReason(
      host,
      "validator",
      gateInputs(host, {
        resolveBinary: (name) => {
          asked.push(name);
          return undefined;
        },
      }),
    );
    assert.match(String(missing), new RegExp(`no ${spec.displayName} executable ${spec.defaultBinary}; install ${spec.defaultBinary} or point ${spec.binOverride} at it`), host);
    assert.deepEqual(asked, [spec.defaultBinary], `${host}: the default name is looked up on PATH`);

    const absolute = `/opt/${spec.defaultBinary}-next/${spec.defaultBinary}`;
    const named = hostLiveSkipReason(host, "validator", gateInputs(host, { env: { [spec.optIn]: "1", [spec.binOverride]: absolute }, resolveBinary: () => undefined }));
    assert.ok(typeof named === "string" && named.includes(absolute), `${host}: the absolute override is the name that is missing`);
  }
});

void test("hostLiveSkipReason names an unavailable or versionless --version fourth, and a newer version runs", () => {
  for (const host of LIVE_HOST_IDS) {
    assert.match(String(hostLiveSkipReason(host, "validator", gateInputs(host, { versionProbe: { kind: "unavailable" } }))), /--version did not run to a successful exit/, host);
    assert.match(String(hostLiveSkipReason(host, "validator", gateInputs(host, { versionProbe: { kind: "output", stdout: "no number here" } }))), /--version printed no x\.y\.z version/, host);
    assert.equal(hostLiveSkipReason(host, "validator", gateInputs(host, { versionProbe: { kind: "output", stdout: RECORDED_OUTPUT[host].replace(/\d+\.\d+\.\d+/, "99.0.0") } })), false, `${host}: a newer version never skips`);
    assert.equal(hostLiveSkipReason(host, "validator", gateInputs(host, { versionProbe: { kind: "output", stdout: RECORDED_OUTPUT[host].replace(/\d+\.\d+\.\d+/, "0.0.1") } })), false, `${host}: an older version never skips either`);
  }
});

void test("hostLiveSkipReason recognises the archived Kimi stub, and no other host is skipped for the same text", () => {
  const stub = { kind: "output", stdout: "kimi, version 1.51.0\nThis project is no longer maintained.\n" } as const;
  assert.match(String(hostLiveSkipReason("kimi", "validator", gateInputs("kimi", { versionProbe: stub }))), /archived Python stub, which writes no configuration and answers no subcommand/);
  assert.equal(hostLiveSkipReason("claude", "validator", gateInputs("claude", { versionProbe: { kind: "output", stdout: `${stub.stdout}2.1.322\n` } })), false);
});

void test("hostLiveSkipReason names the missing built CLI before the production prerequisites", () => {
  for (const host of LIVE_HOST_IDS) {
    for (const tier of ALL_TIERS) {
      const reason = hostLiveSkipReason(host, tier, gateInputs(host, { cliBuilt: false, production: "production reason", receiptExists: true }));
      assert.match(String(reason), /dist\/src\/cli\/main\.js is missing; run npm run build first/, `${host} ${tier}`);
    }
  }
});

void test("hostLiveSkipReason: the validator tier ignores the production facts and the receipt", () => {
  for (const host of LIVE_HOST_IDS) {
    assert.equal(hostLiveSkipReason(host, "validator", gateInputs(host, { production: "no Podman", receiptExists: true })), false, host);
  }
});

void test("hostLiveSkipReason: the production tier names the gap of codex and kimi, then the production reason, then an existing receipt", () => {
  assert.equal(hostLiveSkipReason("codex", "production", gateInputs("codex", { production: "no Podman" })), HOST_LIVE.codex.productionGap);
  assert.equal(hostLiveSkipReason("kimi", "production", gateInputs("kimi")), HOST_LIVE.kimi.productionGap);
  for (const host of ["claude", "opencode"] as const) {
    assert.equal(hostLiveSkipReason(host, "production", gateInputs(host, { production: "no Podman 5.x", receiptExists: true })), "no Podman 5.x", host);
    const receipt = hostLiveSkipReason(host, "production", gateInputs(host, { receiptExists: true }));
    assert.ok(typeof receipt === "string" && receipt.includes(`Realm host receipt for ${host}`), `${host}: ${String(receipt)}`);
  }
});

// ---- collectHostLiveGate (no host CLI: only scripts this test writes) -----------------------------------------------------------

void test("collectHostLiveGate probes nothing until the opt-in is set on Linux", async () => {
  const gate = await collectHostLiveGate("claude", "production", { env: {}, platform: "linux", cliPath: "/nonexistent/main.js" });
  assert.match(String(gate.skip), /REALM_LIVE_CLAUDE=1 is not set/);
  assert.equal(gate.bin, undefined);
  const mac = await collectHostLiveGate("claude", "validator", { env: { REALM_LIVE_CLAUDE: "1" }, platform: "darwin", cliPath: "/nonexistent/main.js" });
  assert.match(String(mac.skip), /Linux only/);
  const relative = await collectHostLiveGate("codex", "validator", { env: { REALM_LIVE_CODEX: "1", REALM_CODEX_BIN: "codex" }, platform: "linux", cliPath: "/nonexistent/main.js" });
  assert.match(String(relative.skip), /must be an absolute path/);
});

void test("collectHostLiveGate runs a version probe in a throwaway home and decides from what it prints", async (t) => {
  const dir = tempDir(t);
  const cli = join(dir, "main.js");
  writeFileSync(cli, "");
  const fake = (name: string, output: string): string => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(output)}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const claude = fake("claude-fake", "2.1.322 (Claude Code)");
  const open = await collectHostLiveGate("claude", "validator", { env: { REALM_LIVE_CLAUDE: "1", REALM_CLAUDE_BIN: claude, PATH: "/usr/bin:/bin" }, platform: "linux", cliPath: cli });
  assert.deepEqual([open.skip, open.bin, open.version], [false, claude, "2.1.322"]);
  const noCli = await collectHostLiveGate("claude", "validator", { env: { REALM_LIVE_CLAUDE: "1", REALM_CLAUDE_BIN: claude }, platform: "linux", cliPath: join(dir, "absent.js") });
  assert.match(String(noCli.skip), /dist\/src\/cli\/main\.js is missing/);
  const kimi = fake("kimi-fake", "kimi: this project is no longer maintained, version 1.51.0");
  const stub = await collectHostLiveGate("kimi", "validator", { env: { REALM_LIVE_KIMI: "1", REALM_KIMI_BIN: kimi }, platform: "linux", cliPath: cli });
  assert.match(String(stub.skip), /archived Python stub/);
  const codex = fake("codex-fake", "codex-cli 0.154.0");
  const gap = await collectHostLiveGate("codex", "production", { env: { REALM_LIVE_CODEX: "1", REALM_CODEX_BIN: codex }, platform: "linux", cliPath: cli });
  assert.equal(gap.skip, HOST_LIVE.codex.productionGap);
  const missing = await collectHostLiveGate("opencode", "validator", { env: { REALM_LIVE_OPENCODE: "1", REALM_OPENCODE_BIN: join(dir, "absent") }, platform: "linux", cliPath: cli });
  assert.match(String(missing.skip), /no OpenCode executable/);
});

// ---- Version ---------------------------------------------------------------------------------------------------------------

void test("parseHostVersion reads the four recorded outputs and refuses garbage", () => {
  for (const host of LIVE_HOST_IDS) {
    assert.equal(parseHostVersion(host, RECORDED_OUTPUT[host]), HOST_LIVE[host].recordedVersion, host);
  }
  assert.equal(parseHostVersion("claude", "Node v22.1.0 warning\n2.1.322 (Claude Code)\n"), "2.1.322", "the product line wins over an earlier number");
  for (const garbage of ["", "no version here", "1.2", "abc 12.x.7"]) {
    assert.equal(parseHostVersion("opencode", garbage), undefined, `${JSON.stringify(garbage)} has no x.y.z`);
  }
});

// ---- Stub realm ------------------------------------------------------------------------------------------------------------

void test("the stub realm records each invocation, survives odd arguments and a log path with a quote, and exits 0", (t) => {
  const dir = tempDir(t);
  const log = join(dir, "it's.log");
  const stub = writeStubRealm(join(dir, "bin"), log);
  assert.equal(stub, join(dir, "bin", "realm"));
  assert.equal(statSync(stub).mode & 0o777, 0o755);
  assert.deepEqual(readStubArgv(log), [], "no invocation before the first");
  execFileSync("sh", [stub, "mcp", "--host", "claude"]);
  assert.deepEqual(readStubArgv(log), [["mcp", "--host", "claude"]]);
  execFileSync("sh", [stub, "a b", "it's", 'say "hi"', "line1\nline2"]);
  execFileSync("sh", [stub]);
  assert.deepEqual(readStubArgv(log), [["mcp", "--host", "claude"], ["a b", "it's", 'say "hi"', "line1", "line2"], []]);
});

// ---- Isolation -------------------------------------------------------------------------------------------------------------

void test("isUnderTemp is true only strictly inside the real temporary directory, symlinks resolved", (t) => {
  const dir = tempDir(t);
  assert.equal(isUnderTemp(dir), true);
  assert.equal(isUnderTemp(join(dir, "not", "created", "yet")), true);
  assert.equal(isUnderTemp(realpathSync(tmpdir())), false, "the temporary directory itself is not inside it");
  assert.equal(isUnderTemp(dirname(realpathSync(tmpdir()))), false);
  assert.equal(isUnderTemp("/etc"), false);
  const link = join(dir, "link");
  symlinkSync("/etc", link);
  assert.equal(isUnderTemp(link), false, "a link that leaves the temporary directory is outside it");
});

void test("isolatedHostEnv is an allowlist: it drops every operator credential and keeps nothing outside the root but PATH, LANG and TERM", (t) => {
  const root = tempDir(t);
  const source = {
    ANTHROPIC_API_KEY: "sk-ant-secret",
    OPENAI_API_KEY: "sk-secret",
    GITHUB_TOKEN: "ghp_secret",
    HTTPS_PROXY: "http://proxy.invalid:3128",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    HOME: "/home/operator",
    XDG_CONFIG_HOME: "/home/operator/.config",
    LANG: "en_US.UTF-8",
    TERM: "xterm",
  };
  const stubDir = join(root, "stub");
  const env = isolatedHostEnv(root, "claude", { stubDir, hostBinDir: "/opt/host/bin", source, overrides: { CLAUDE_CONFIG_DIR: join(root, "cfg") } });
  assert.deepEqual(Object.keys(env).sort(), ["CLAUDE_CONFIG_DIR", "HOME", "LANG", "PATH", "TERM", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"]);
  const serialised = JSON.stringify(env);
  for (const secret of ["sk-ant-secret", "sk-secret", "ghp_secret", "proxy.invalid", "aws-secret", "/home/operator"]) {
    assert.equal(serialised.includes(secret), false, `no ${secret}`);
  }
  assert.equal(env["PATH"], [stubDir, "/opt/host/bin", "/usr/bin", "/bin"].join(":"));
  assert.equal(env["LANG"], "en_US.UTF-8");
  assert.equal(env["TERM"], "xterm");
  for (const [name, value] of Object.entries(env)) {
    if (name !== "PATH" && name !== "LANG" && name !== "TERM") {
      assert.ok(value.startsWith(`${root}${sep}`), `${name} lies inside the root`);
    }
  }
  assert.equal(env["HOME"], join(root, "home"));
  for (const dir of [env["HOME"], env["TMPDIR"], env["XDG_CONFIG_HOME"], env["XDG_DATA_HOME"], env["XDG_CACHE_HOME"], env["XDG_STATE_HOME"]]) {
    assert.ok(dir !== undefined && existsSync(dir), `${String(dir)} exists`);
  }
  const bare = isolatedHostEnv(root, "opencode", { stubDir });
  assert.equal(bare["LANG"], "C.UTF-8");
  assert.equal(bare["TERM"], "dumb");
  assert.equal(bare["PATH"], [stubDir, "/usr/bin", "/bin"].join(":"));
});

void test("isolatedHostEnv throws, before it creates anything, for a root, stub directory or override path outside the temporary directory", (t) => {
  const root = tempDir(t);
  const stubDir = join(root, "stub");
  const outside = join(dirname(realpathSync(tmpdir())), "rlh-outside-root");
  assert.throws(() => isolatedHostEnv(outside, "claude", { stubDir }), /isolated root must lie inside the temporary directory/);
  assert.equal(existsSync(join(outside, "home")), false, "nothing was created outside");
  assert.throws(() => isolatedHostEnv(root, "claude", { stubDir: "/usr/bin" }), /stub directory must lie inside the temporary directory/);
  assert.throws(() => isolatedHostEnv(root, "claude", { stubDir, overrides: { CLAUDE_CONFIG_DIR: "/etc/claude" } }), /override CLAUDE_CONFIG_DIR must lie inside the temporary directory/);
  assert.throws(() => isolatedHostEnv(root, "codex", { stubDir, overrides: { CODEX_HOME: join(outside, "codex") } }), /override CODEX_HOME must lie inside the temporary directory/);
  assert.throws(() => isolatedHostEnv(root, "opencode", { stubDir, overrides: { CODEX_HOME: join(root, "codex") } }), /CODEX_HOME is not an override variable of opencode/);
  assert.throws(() => isolatedHostEnv(root, "kimi", { stubDir, overrides: { CLAUDE_CONFIG_DIR: join(root, "cfg") } }), /CLAUDE_CONFIG_DIR is not an override variable of kimi/);
  assert.equal(existsSync(join(root, "home")), false, "a refused call created nothing in the root either");
  assert.doesNotThrow(() => isolatedHostEnv(root, "kimi", { stubDir, overrides: { KIMI_SHARE_DIR: join(root, "kimi") } }));
});

// ---- Process-group runner --------------------------------------------------------------------------------------------------

async function waitUntilGone(pid: number): Promise<void> {
  const outcome = await pollUntil(() => (processAlive(pid) ? { done: false, detail: `pid ${String(pid)} is still alive` } : { done: true }), {
    timeoutMs: scaledMs(3_000),
    intervalMs: 50,
  });
  assert.ok(outcome.ok, outcome.detail);
}

void test("runHost returns the exit code and both streams of a command that ends on its own", async (t) => {
  const dir = tempDir(t);
  const result = await runHost("sh", ["-c", "echo out; echo err >&2; exit 3"], { PATH: "/usr/bin:/bin" }, dir, scaledMs(10_000));
  assert.deepEqual({ ...result }, { exitCode: 3, stdout: "out\n", stderr: "err\n", timedOut: false });
  assert.match(describeRun(result), /^exit 3; stdout "out"; stderr "err"$/);
  const missing = await runHost(join(dir, "no-such-host"), [], {}, dir, scaledMs(10_000));
  assert.equal(missing.exitCode, undefined);
  assert.equal(missing.timedOut, false);
  assert.match(missing.stderr, /ENOENT/);
  assert.match(describeRun(missing), /^did not exit;/);
});

void test("runHost caps each stream at 1 MiB", async (t) => {
  const dir = tempDir(t);
  const result = await runHost("sh", ["-c", "dd if=/dev/zero bs=1048576 count=3 2>/dev/null"], { PATH: "/usr/bin:/bin" }, dir, scaledMs(30_000));
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 1024 * 1024);
});

void test("runHost kills the whole process group on timeout: the grandchild is gone within 3 s", async (t) => {
  const dir = tempDir(t);
  const result = await runHost("sh", ["-c", "sleep 30 & echo $!; wait"], { PATH: "/usr/bin:/bin" }, dir, 300);
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, undefined);
  assert.match(describeRun(result), /^did not return \(timed out\)/);
  assert.throws(() => {
    requireReturned(result, "the probe");
  }, /the probe: did not return within the bound/);
  const pid = Number.parseInt(result.stdout.trim(), 10);
  assert.ok(Number.isInteger(pid) && pid > 1, `the grandchild pid was printed: ${JSON.stringify(result.stdout)}`);
  await waitUntilGone(pid);
});

void test("runHost sweeps the group when the command ends on its own: a process it left behind does not outlive the call", async (t) => {
  const dir = tempDir(t);
  const result = await runHost("sh", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { PATH: "/usr/bin:/bin" }, dir, scaledMs(10_000));
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 0);
  const pid = Number.parseInt(result.stdout.trim(), 10);
  assert.ok(Number.isInteger(pid) && pid > 1);
  await waitUntilGone(pid);
  requireReturned(result, "a finished command");
});

// ---- Small helpers ---------------------------------------------------------------------------------------------------------

void test("processAlive is true for this process and false for a pid that does not exist", () => {
  assert.equal(processAlive(process.pid), true);
  assert.equal(processAlive(2_147_483_646), false);
});

void test("resolveExecutable finds an executable by absolute path or on an absolute PATH entry, and never a plain file", (t) => {
  const dir = tempDir(t);
  const tool = join(dir, "tool");
  writeFileSync(tool, "#!/bin/sh\n");
  chmodSync(tool, 0o755);
  const plain = join(dir, "plain");
  writeFileSync(plain, "x");
  chmodSync(plain, 0o644);
  mkdirSync(join(dir, "adir"));
  assert.equal(resolveExecutable(tool, undefined), tool);
  assert.equal(resolveExecutable(plain, undefined), undefined);
  assert.equal(resolveExecutable(join(dir, "adir"), undefined), undefined);
  assert.equal(resolveExecutable("tool", `/nonexistent:${dir}`), tool);
  assert.equal(resolveExecutable("plain", dir), undefined);
  assert.equal(resolveExecutable("tool", "relative/dir"), undefined, "a relative PATH entry is ignored");
  assert.equal(resolveExecutable("tool", undefined), undefined);
});

void test("fileSha256, stripAnsi, ownedBlockOf and refusalReasonOf", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "f");
  writeFileSync(file, "abc");
  assert.equal(fileSha256(file), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(fileSha256(join(dir, "absent")), null);
  assert.equal(stripAnsi("\u001b[32m✓\u001b[0m realm \u001b[1mconnected\u001b[22m"), "✓ realm connected");
  const block = '# BEGIN realm host-plugin\n[mcp_servers.realm]\ncommand = "realm"\n# END realm host-plugin';
  assert.equal(ownedBlockOf(`[a]\nx = 1\n\n${block}\n[b]\n`), block);
  assert.equal(ownedBlockOf("[a]\nx = 1\n"), undefined);
  assert.equal(ownedBlockOf("# END realm host-plugin\n# BEGIN realm host-plugin\n"), undefined);
  assert.equal(refusalReasonOf({ exitCode: 1, stdout: "POLICY_DENIED\n", stderr: "realm host install: foreign-content: the host configuration holds content that Realm does not own\n" }), "foreign-content");
  assert.equal(refusalReasonOf({ exitCode: 1, stdout: "", stderr: "realm host uninstall: drifted: changed\n" }), "drifted");
  assert.equal(refusalReasonOf({ exitCode: 0, stdout: "{}\n", stderr: "" }), undefined);
});
