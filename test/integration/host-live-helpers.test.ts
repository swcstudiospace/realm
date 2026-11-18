// The always-running hermetic test of test/support/host-live.ts: no host CLI, no Podman, no network (ADPT-08). It pins the skip-reason
// order of the five live files, the version parsing, the archived-Kimi detection, the stub realm, the isolated-environment allowlist,
// the temporary-directory guard and the process-group kill. The only processes it starts are `sh` and the scripts it writes itself.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ANTIGRAVITY_GAP,
  bootPhaseCountsOf,
  collectHostLiveGate,
  compareVersions,
  CONFIG_ONLY_GAP,
  createHostRig,
  downAcceptable,
  describeRun,
  fileSha256,
  HOST_LIVE,
  HOST_OVERRIDE_VARIABLES,
  type HostLiveGateInputs,
  hostLiveSkipReason,
  type HostCommandDrive,
  type HostDrive,
  type HostLiveTier,
  type HostProductionId,
  type HostSessionDrive,
  isolatedHostEnv,
  isUnderTemp,
  LIVE_HOST_IDS,
  type LiveHostId,
  ownedTableOf,
  parseHostVersion,
  processAlive,
  productionOverrides,
  readStubArgv,
  refusalReasonOf,
  requireReturned,
  resolveExecutable,
  runHost,
  stripAnsi,
  writeStubRealm,
} from "../support/host-live.js";
import { WAVE2_LIVE, WAVE2_LIVE_IDS, wave2Recipe, type Wave2LiveId } from "../support/host-live-wave2.js";
import { pollUntil } from "../support/production-live.js";
import { scaledMs } from "../support/timing.js";

// The recorded `--version` output of each host. The first four are observed shapes of the wave-1 hosts and qwen and pi were observed in
// phase 25 research; the other wave-2 shapes are fixtures of the shapes research saw (a date after the version, a commit hash, a sentence
// around the number): parseHostVersion takes the first x.y.z of the output, so a different shape parses the same.
const RECORDED_OUTPUT: Readonly<Record<LiveHostId, string>> = {
  claude: "2.1.322 (Claude Code)\n",
  codex: "codex-cli 0.154.0\n",
  opencode: "1.19.5\n",
  kimi: "kimi, version 1.51.0\n",
  "kimi-code": "2.6.3\n",
  qwen: "0.22.0\n",
  pi: "1.5.2\n",
  hermes: "Hermes Agent v0.23.2 (2026.11.13)\n",
  cursor: "2026.11.13-eacade1\n",
  kilo: "7.8.27\n",
  copilot: "GitHub Copilot CLI 1.0.112.\n",
  augment: "1.2.1 (commit 0a1b2c3)\n",
  codebuddy: "2.185.0\n",
  cline: "3.0.74\n",
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

// A display name may hold regular-expression metacharacters (Augment (Auggie)); match the text literally.
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

void test("HOST_LIVE is a frozen table of the fourteen hosts with the recorded facts", () => {
  assert.deepEqual([...LIVE_HOST_IDS], ["claude", "codex", "opencode", "kimi", "kimi-code", "qwen", "pi", "hermes", "cursor", "kilo", "copilot", "augment", "codebuddy", "cline"]);
  assert.ok(Object.isFrozen(HOST_LIVE));
  const expected: Record<LiveHostId, readonly [string, string, string, string, boolean, boolean]> = {
    claude: ["REALM_LIVE_CLAUDE", "REALM_CLAUDE_BIN", "claude", "2.1.322", true, true],
    codex: ["REALM_LIVE_CODEX", "REALM_CODEX_BIN", "codex", "0.154.0", false, true],
    opencode: ["REALM_LIVE_OPENCODE", "REALM_OPENCODE_BIN", "opencode", "1.19.5", true, true],
    kimi: ["REALM_LIVE_KIMI", "REALM_KIMI_BIN", "kimi", "1.51.0", true, true],
    "kimi-code": ["REALM_LIVE_KIMI_CODE", "REALM_KIMI_CODE_BIN", "kimi", "2.6.3", false, true],
    qwen: ["REALM_LIVE_QWEN", "REALM_QWEN_BIN", "qwen", "0.22.0", true, false],
    pi: ["REALM_LIVE_PI", "REALM_PI_BIN", "pi", "1.5.2", true, false],
    hermes: ["REALM_LIVE_HERMES", "REALM_HERMES_BIN", "hermes", "0.23.2", true, false],
    cursor: ["REALM_LIVE_CURSOR", "REALM_CURSOR_BIN", "cursor-agent", "2026.11.13", true, false],
    kilo: ["REALM_LIVE_KILO", "REALM_KILO_BIN", "kilo", "7.8.27", true, false],
    copilot: ["REALM_LIVE_COPILOT", "REALM_COPILOT_BIN", "copilot", "1.0.112", false, false],
    augment: ["REALM_LIVE_AUGMENT", "REALM_AUGMENT_BIN", "auggie", "1.2.1", false, false],
    codebuddy: ["REALM_LIVE_CODEBUDDY", "REALM_CODEBUDDY_BIN", "codebuddy", "2.185.0", true, false],
    cline: ["REALM_LIVE_CLINE", "REALM_CLINE_BIN", "cline", "3.0.74", false, false],
  };
  const displayNames: Record<Wave2LiveId, string> = {
    qwen: "Qwen Code",
    pi: "Pi",
    hermes: "Hermes Agent",
    cursor: "Cursor",
    kilo: "Kilo Code",
    copilot: "GitHub Copilot CLI",
    augment: "Augment (Auggie)",
    codebuddy: "CodeBuddy Code",
    cline: "Cline CLI",
  };
  for (const host of LIVE_HOST_IDS) {
    const spec = HOST_LIVE[host];
    assert.ok(Object.isFrozen(spec), host);
    assert.deepEqual([spec.optIn, spec.binOverride, spec.defaultBinary, spec.recordedVersion, spec.launchesOnValidate, spec.productionTier], expected[host], host);
    assert.deepEqual([...spec.versionArgs], ["--version"], host);
    assert.equal(spec.productionGap === null, spec.productionTier, `${host}: a gap exactly when there is no production tier`);
  }
  for (const host of WAVE2_LIVE_IDS) {
    assert.equal(HOST_LIVE[host].displayName, displayNames[host], host);
  }
  assert.equal(new Set(LIVE_HOST_IDS.map((host) => HOST_LIVE[host].optIn)).size, LIVE_HOST_IDS.length, "the opt-in variables are unique");
  assert.equal(new Set(LIVE_HOST_IDS.map((host) => HOST_LIVE[host].binOverride)).size, LIVE_HOST_IDS.length, "the executable override variables are unique");
  // The default binary name is shared by design: the two Kimi products are both `kimi`, and the gate tells them apart by version.
  assert.equal(HOST_LIVE.kimi.defaultBinary, HOST_LIVE["kimi-code"].defaultBinary);
  assert.equal(new Set(LIVE_HOST_IDS.map((host) => HOST_LIVE[host].defaultBinary)).size, LIVE_HOST_IDS.length - 1);
  assert.equal(HOST_LIVE.codex.productionTier, true);
  assert.equal(HOST_LIVE.codex.productionGap, null);
  assert.equal(HOST_LIVE.kimi.productionGap, null);
  assert.equal(HOST_LIVE["kimi-code"].productionGap, null);
  assert.equal(HOST_LIVE["kimi-code"].displayName, "Kimi Code");
});

// ---- Skip reasons ----------------------------------------------------------------------------------------------------------

void test("hostLiveSkipReason is false when every prerequisite holds, for both tiers of the hosts that have them", () => {
  for (const host of LIVE_HOST_IDS) {
    assert.equal(hostLiveSkipReason(host, "validator", gateInputs(host)), false, host);
  }
  assert.equal(hostLiveSkipReason("claude", "production", gateInputs("claude")), false);
  assert.equal(hostLiveSkipReason("codex", "production", gateInputs("codex")), false);
  assert.equal(hostLiveSkipReason("opencode", "production", gateInputs("opencode")), false);
  assert.equal(hostLiveSkipReason("kimi", "production", gateInputs("kimi")), false);
  assert.equal(hostLiveSkipReason("kimi-code", "production", gateInputs("kimi-code")), false);
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
    assert.match(String(missing), new RegExp(escapeRegExp(`no ${spec.displayName} executable ${spec.defaultBinary}; install ${spec.defaultBinary} or point ${spec.binOverride} at it`)), host);
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
    // The legacy Kimi CLI is 1.x by definition: a 99.x kimi is Kimi Code and skips with the product sentence (tested below).
    const newer = host === "kimi" ? "1.99.0" : "99.0.0";
    assert.equal(hostLiveSkipReason(host, "validator", gateInputs(host, { versionProbe: { kind: "output", stdout: RECORDED_OUTPUT[host].replace(/\d+\.\d+\.\d+/, newer) } })), false, `${host}: a newer version never skips`);
    // 0.0.1 is below the guard of kimi-code (Kimi Code is 2.x or newer): its sentence is asserted below.
    if (HOST_LIVE[host].minVersion === null && host !== "kimi-code") {
      assert.equal(hostLiveSkipReason(host, "validator", gateInputs(host, { versionProbe: { kind: "output", stdout: RECORDED_OUTPUT[host].replace(/\d+\.\d+\.\d+/, "0.0.1") } })), false, `${host}: an older version never skips either`);
    }
  }
});

void test("hostLiveSkipReason recognises the archived Kimi stub, and no other host is skipped for the same text", () => {
  const stub = { kind: "output", stdout: "kimi, version 1.51.0\nThis project is no longer maintained.\n" } as const;
  assert.match(String(hostLiveSkipReason("kimi", "validator", gateInputs("kimi", { versionProbe: stub }))), /archived Python stub, which writes no configuration and answers no subcommand/);
  assert.equal(hostLiveSkipReason("claude", "validator", gateInputs("claude", { versionProbe: { kind: "output", stdout: `${stub.stdout}2.1.322\n` } })), false);
  // The stub marker skips the Kimi Code row too, before the product guard.
  assert.match(String(hostLiveSkipReason("kimi-code", "validator", gateInputs("kimi-code", { versionProbe: stub }))), /archived Python stub, which writes no configuration and answers no subcommand/);
});

void test("hostLiveSkipReason separates the two Kimi products behind the shared command name by version", () => {
  const output = (stdout: string): HostLiveGateInputs["versionProbe"] => ({ kind: "output", stdout });
  const kimiCodeSentence = /the installed kimi is Kimi Code \(2\.6\.3\), not the legacy Python CLI this row covers; point REALM_KIMI_BIN at the pinned legacy package kimi-cli 1\.51\.0/;
  const legacySentence = /the installed kimi is the legacy Python CLI \(1\.51\.0\), not Kimi Code; point REALM_KIMI_CODE_BIN at the npm package @moonshot-ai\/kimi-code/;
  assert.match(String(hostLiveSkipReason("kimi", "validator", gateInputs("kimi", { versionProbe: output("2.6.3\n") }))), kimiCodeSentence);
  assert.match(String(hostLiveSkipReason("kimi", "production", gateInputs("kimi", { versionProbe: output("2.6.3\n") }))), kimiCodeSentence);
  assert.equal(hostLiveSkipReason("kimi", "validator", gateInputs("kimi", { versionProbe: output("kimi, version 1.51.0\n") })), false);
  assert.match(String(hostLiveSkipReason("kimi-code", "validator", gateInputs("kimi-code", { versionProbe: output("kimi, version 1.51.0\n") }))), legacySentence);
  assert.match(String(hostLiveSkipReason("kimi-code", "production", gateInputs("kimi-code", { versionProbe: output("kimi, version 1.51.0\n") }))), legacySentence);
  assert.match(String(hostLiveSkipReason("kimi-code", "validator", gateInputs("kimi-code", { versionProbe: output("0.0.1\n") }))), /the installed kimi is the legacy Python CLI \(0\.0\.1\)/);
  assert.equal(hostLiveSkipReason("kimi-code", "validator", gateInputs("kimi-code", { versionProbe: output("2.6.3\n") })), false);
  assert.equal(hostLiveSkipReason("kimi-code", "validator", gateInputs("kimi-code", { versionProbe: output("10.0.0\n") })), false);
  // The guard comes after the version floor and before the built CLI: a wrong product is named even without a build.
  assert.match(String(hostLiveSkipReason("kimi", "validator", gateInputs("kimi", { versionProbe: output("2.6.3\n"), cliBuilt: false }))), /is Kimi Code/);
  // No other host is ever skipped for the Kimi product text.
  for (const host of LIVE_HOST_IDS) {
    if (host !== "kimi" && host !== "kimi-code") {
      assert.doesNotMatch(String(hostLiveSkipReason(host, "validator", gateInputs(host, { versionProbe: output(`${RECORDED_OUTPUT[host]}2.6.3\n`) }))), /installed kimi/, host);
    }
  }
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

void test("hostLiveSkipReason: the production tier names the production reason first, then an existing receipt", () => {
  for (const host of ["claude", "codex", "opencode", "kimi", "kimi-code"] as const) {
    assert.equal(hostLiveSkipReason(host, "production", gateInputs(host, { production: "no Podman 5.x", receiptExists: true })), "no Podman 5.x", host);
    const receipt = hostLiveSkipReason(host, "production", gateInputs(host, { receiptExists: true }));
    assert.ok(typeof receipt === "string" && receipt.includes(`Realm host receipt for ${host}`), `${host}: ${String(receipt)}`);
  }
});

void test("hostLiveSkipReason: every wave-2 host has no production tier, and its production query names the config-only sentence", () => {
  for (const host of WAVE2_LIVE_IDS) {
    assert.equal(HOST_LIVE[host].productionTier, false, host);
    assert.equal(HOST_LIVE[host].productionGap, CONFIG_ONLY_GAP, host);
    assert.equal(hostLiveSkipReason(host, "production", gateInputs(host, { production: "no Podman" })), CONFIG_ONLY_GAP, host);
    assert.equal(hostLiveSkipReason(host, "production", gateInputs(host, { receiptExists: true })), CONFIG_ONLY_GAP, host);
  }
  assert.equal(CONFIG_ONLY_GAP, "config-only host: no production tier is defined for it (25-CONTEXT D-25-08)");
});

void test("hostLiveSkipReason names, for each wave-2 host, the first missing prerequisite in the fixed order", () => {
  const broken = (host: Wave2LiveId, overrides: Partial<HostLiveGateInputs>): string => {
    const spec = HOST_LIVE[host];
    return String(
      hostLiveSkipReason(
        host,
        "validator",
        gateInputs(host, { env: { [spec.optIn]: "1" }, resolveBinary: () => undefined, versionProbe: { kind: "unavailable" }, cliBuilt: false, ...overrides }),
      ),
    );
  };
  for (const host of WAVE2_LIVE_IDS) {
    const spec = HOST_LIVE[host];
    // 1 opt-in, then 2 platform, then 3 the absolute override, then 4 the executable, then 5 --version, then the x.y.z, then the floor, then the built CLI.
    assert.match(broken(host, { env: {}, platform: "darwin" }), new RegExp(`${spec.optIn}=1 is not set`), `${host}: opt-in first`);
    assert.match(broken(host, { platform: "darwin" }), /Linux only; this host is darwin/, `${host}: platform second`);
    assert.match(broken(host, { env: { [spec.optIn]: "1", [spec.binOverride]: `bin/${spec.defaultBinary}` } }), new RegExp(`${spec.binOverride} must be an absolute path`), `${host}: a relative override`);
    assert.match(broken(host, {}), new RegExp(escapeRegExp(`no ${spec.displayName} executable ${spec.defaultBinary}; install ${spec.defaultBinary} or point ${spec.binOverride} at it`)), `${host}: the executable`);
    assert.match(broken(host, { resolveBinary: (name) => `/bin/${name}` }), /--version did not run to a successful exit/, `${host}: a --version that fails (the Hermes broken-install case)`);
    assert.match(broken(host, { resolveBinary: (name) => `/bin/${name}`, versionProbe: { kind: "output", stdout: "no number here" } }), /--version printed no x\.y\.z version/, `${host}: a versionless output`);
    const recorded = broken(host, { resolveBinary: (name) => `/bin/${name}`, versionProbe: { kind: "output", stdout: RECORDED_OUTPUT[host] } });
    assert.match(recorded, /dist\/src\/cli\/main\.js is missing; run npm run build first/, `${host}: the built CLI last`);
    const old = broken(host, { resolveBinary: (name) => `/bin/${name}`, versionProbe: { kind: "output", stdout: "0.84.3\n" } });
    if (host === "pi") {
      assert.equal(old, "Pi 0.84.3 is below 1.3.0, the first release with built-in MCP; a recipe for it would be silently ignored (25-CONTEXT E-PI2)", "pi: the floor comes before the built CLI");
    } else {
      assert.match(old, /dist\/src\/cli\/main\.js is missing/, `${host}: no floor, an older version never skips`);
    }
  }
});

void test("hostLiveSkipReason applies the pi floor of 1.3.0: older skips, the floor, a newer and a numerically larger version run", () => {
  assert.equal(HOST_LIVE.pi.minVersion, "1.3.0");
  for (const host of LIVE_HOST_IDS) {
    if (host !== "pi") {
      assert.equal(HOST_LIVE[host].minVersion, null, `${host} has no floor`);
    }
  }
  const probe = (stdout: string): string | false => hostLiveSkipReason("pi", "validator", gateInputs("pi", { versionProbe: { kind: "output", stdout } }));
  for (const old of ["0.84.3\n", "1.2.99\n", "0.0.1\n"]) {
    assert.match(String(probe(old)), /^Pi \d+\.\d+\.\d+ is below 1\.3\.0, the first release with built-in MCP/, JSON.stringify(old));
  }
  for (const runs of ["1.3.0\n", "1.5.2\n", "1.10.0\n", "2.0.0\n", "99.0.0\n"]) {
    assert.equal(probe(runs), false, JSON.stringify(runs));
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
  const kimiCodeStub = await collectHostLiveGate("kimi-code", "validator", { env: { REALM_LIVE_KIMI_CODE: "1", REALM_KIMI_CODE_BIN: kimi }, platform: "linux", cliPath: cli });
  assert.match(String(kimiCodeStub.skip), /archived Python stub/);
  const kimiCode = fake("kimi-code-fake", "2.6.3");
  const kimiCodeOpen = await collectHostLiveGate("kimi-code", "validator", { env: { REALM_LIVE_KIMI_CODE: "1", REALM_KIMI_CODE_BIN: kimiCode }, platform: "linux", cliPath: cli });
  assert.deepEqual([kimiCodeOpen.skip, kimiCodeOpen.bin, kimiCodeOpen.version], [false, kimiCode, "2.6.3"]);
  const wrongProduct = await collectHostLiveGate("kimi", "validator", { env: { REALM_LIVE_KIMI: "1", REALM_KIMI_BIN: kimiCode }, platform: "linux", cliPath: cli });
  assert.match(String(wrongProduct.skip), /is Kimi Code \(2\.6\.3\)/);
  const codex = fake("codex-fake", "codex-cli 0.154.0");
  const closed = await collectHostLiveGate("codex", "production", { env: { REALM_LIVE_CODEX: "1", REALM_CODEX_BIN: codex }, platform: "linux", cliPath: cli });
  assert.match(String(closed.skip), /REALM_LIVE_PRODUCTION=1 is not set/, "a closed production gate of codex names the production reason, not a gap sentence");
  const missing = await collectHostLiveGate("opencode", "validator", { env: { REALM_LIVE_OPENCODE: "1", REALM_OPENCODE_BIN: join(dir, "absent") }, platform: "linux", cliPath: cli });
  assert.match(String(missing.skip), /no OpenCode executable/);
});

void test("collectHostLiveGate skips a broken Hermes install and a pi below its floor, and runs a pi and a Cursor of the recorded shapes", async (t) => {
  const dir = tempDir(t);
  const cli = join(dir, "main.js");
  writeFileSync(cli, "");
  const fake = (name: string, script: string): string => {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${script}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const hermes = fake("hermes-broken", "echo 'hermes: no dependency environment is committed for this install; run `hermes pm repair`' >&2\nexit 1");
  const broken = await collectHostLiveGate("hermes", "validator", { env: { REALM_LIVE_HERMES: "1", REALM_HERMES_BIN: hermes }, platform: "linux", cliPath: cli });
  assert.match(String(broken.skip), /--version did not run to a successful exit/, "the Hermes broken-install case is the generic version skip");
  assert.equal(broken.version, undefined);
  const oldPi = fake("pi-old", "echo 0.84.3");
  const floor = await collectHostLiveGate("pi", "validator", { env: { REALM_LIVE_PI: "1", REALM_PI_BIN: oldPi }, platform: "linux", cliPath: cli });
  assert.equal(floor.skip, "Pi 0.84.3 is below 1.3.0, the first release with built-in MCP; a recipe for it would be silently ignored (25-CONTEXT E-PI2)");
  const newPi = fake("pi-new", "echo 1.5.2");
  const runs = await collectHostLiveGate("pi", "validator", { env: { REALM_LIVE_PI: "1", REALM_PI_BIN: newPi }, platform: "linux", cliPath: cli });
  assert.deepEqual([runs.skip, runs.bin, runs.version], [false, newPi, "1.5.2"]);
  const cursor = fake("cursor-agent-fake", "echo 2026.11.13-eacade1");
  const dated = await collectHostLiveGate("cursor", "validator", { env: { REALM_LIVE_CURSOR: "1", REALM_CURSOR_BIN: cursor }, platform: "linux", cliPath: cli });
  assert.deepEqual([dated.skip, dated.version], [false, "2026.11.13"]);
  const noCli = await collectHostLiveGate("pi", "validator", { env: { REALM_LIVE_PI: "1", REALM_PI_BIN: newPi }, platform: "linux", cliPath: join(dir, "absent.js") });
  assert.match(String(noCli.skip), /dist\/src\/cli\/main\.js is missing/);
  const wave2Gap = await collectHostLiveGate("qwen", "production", { env: { REALM_LIVE_QWEN: "1", REALM_QWEN_BIN: fake("qwen-fake", "echo 0.22.0") }, platform: "linux", cliPath: cli });
  assert.equal(wave2Gap.skip, CONFIG_ONLY_GAP);
});

// ---- Version ---------------------------------------------------------------------------------------------------------------

void test("parseHostVersion reads every recorded --version shape and refuses garbage", () => {
  for (const host of LIVE_HOST_IDS) {
    assert.equal(parseHostVersion(host, RECORDED_OUTPUT[host]), HOST_LIVE[host].recordedVersion, host);
  }
  assert.equal(parseHostVersion("claude", "Node v22.1.0 warning\n2.1.322 (Claude Code)\n"), "2.1.322", "the product line wins over an earlier number");
  const shapes: readonly (readonly [LiveHostId, string, string | undefined])[] = [
    ["qwen", "0.22.0\n", "0.22.0"],
    ["pi", "0.84.3\n", "0.84.3"],
    ["pi", "1.5.2\n", "1.5.2"],
    ["hermes", "Hermes Agent v0.23.2 (2026.11.13)\nProject: /opt/hermes\n", "0.23.2"],
    ["cursor", "2026.11.13-eacade1\n", "2026.11.13"],
    ["kilo", "7.8.27\n", "7.8.27"],
    ["copilot", "GitHub Copilot CLI 1.0.112.\nRun 'copilot update' to check for updates.\n", "1.0.112"],
    ["augment", "1.2.1 (commit 0a1b2c3)\n", "1.2.1"],
    ["codebuddy", "2.185.0\n", "2.185.0"],
    ["cline", "3.0.74\n", "3.0.74"],
    ["hermes", "hermes: no dependency environment is committed for this install; run `hermes pm repair`\n", undefined],
  ];
  for (const [host, stdout, expected] of shapes) {
    assert.equal(parseHostVersion(host, stdout), expected, `${host} ${JSON.stringify(stdout)}`);
  }
  for (const host of LIVE_HOST_IDS) {
    for (const garbage of ["", "no version here", "1.2", "abc 12.x.7"]) {
      assert.equal(parseHostVersion(host, garbage), undefined, `${host} ${JSON.stringify(garbage)} has no x.y.z`);
    }
  }
});

void test("compareVersions compares x.y.z numerically, part by part", () => {
  assert.equal(compareVersions("1.3.0", "1.3.0"), 0);
  assert.ok(compareVersions("0.84.3", "1.3.0") < 0);
  assert.ok(compareVersions("1.2.99", "1.3.0") < 0);
  assert.ok(compareVersions("1.10.0", "1.9.0") > 0, "numeric, not lexical");
  assert.ok(compareVersions("2026.11.13", "1.3.0") > 0);
  assert.equal(compareVersions("1.3", "1.3.0"), 0, "a missing part counts as 0");
  assert.equal(compareVersions("1.x.0", "1.0.0"), 0, "a part that is not a number counts as 0");
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
  assert.throws(() => isolatedHostEnv(root, "kimi-code", { stubDir, overrides: { KIMI_SHARE_DIR: join(root, "kimi") } }), /KIMI_SHARE_DIR is not an override variable of kimi-code/);
  assert.throws(() => isolatedHostEnv(root, "kimi", { stubDir, overrides: { KIMI_CODE_HOME: join(root, "kimi-code") } }), /KIMI_CODE_HOME is not an override variable of kimi$/);
  assert.equal(existsSync(join(root, "home")), false, "the refused Kimi calls created nothing either");
  assert.doesNotThrow(() => isolatedHostEnv(root, "kimi", { stubDir, overrides: { KIMI_SHARE_DIR: join(root, "kimi") } }));
  assert.equal(isolatedHostEnv(root, "kimi-code", { stubDir, overrides: { KIMI_CODE_HOME: join(root, "kimi-code") } })["KIMI_CODE_HOME"], join(root, "kimi-code"));
});

const WAVE2_OVERRIDES: Readonly<Record<Wave2LiveId, readonly string[]>> = {
  qwen: ["QWEN_HOME"],
  pi: ["PI_CODING_AGENT_DIR"],
  hermes: ["HERMES_HOME"],
  cursor: [],
  kilo: ["XDG_CONFIG_HOME"],
  copilot: ["COPILOT_HOME"],
  augment: ["AUGMENT_CACHE_DIR"],
  codebuddy: ["CODEBUDDY_CONFIG_DIR"],
  cline: ["CLINE_DIR"],
};

void test("isolatedHostEnv of each wave-2 host keeps only its own override variable inside the root and drops every credential", (t) => {
  const root = tempDir(t);
  const stubDir = join(root, "stub");
  const outside = join(dirname(realpathSync(tmpdir())), "rlh-outside-root");
  const source = {
    ANTHROPIC_API_KEY: "sk-ant-secret",
    OPENAI_API_KEY: "sk-secret",
    GITHUB_TOKEN: "ghp_secret",
    GH_TOKEN: "gh-secret",
    COPILOT_GITHUB_TOKEN: "copilot-secret",
    QWEN_API_KEY: "qwen-secret",
    CLINE_API_KEY: "cline-secret",
    HTTPS_PROXY: "http://proxy.invalid:3128",
    HOME: "/home/operator",
    LANG: "en_US.UTF-8",
    TERM: "xterm",
  };
  const baseKeys = ["HOME", "LANG", "PATH", "TERM", "TMPDIR", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"];
  for (const host of WAVE2_LIVE_IDS) {
    const variables = WAVE2_OVERRIDES[host];
    assert.deepEqual([...HOST_OVERRIDE_VARIABLES[host]], [...variables], host);
    const overrides = Object.fromEntries(variables.map((name) => [name, join(root, `override-${name.toLowerCase()}`)]));
    const env = isolatedHostEnv(root, host, { stubDir, hostBinDir: "/opt/host/bin", source, overrides });
    assert.deepEqual(Object.keys(env).sort(), [...new Set([...baseKeys, ...variables])].sort(), `${host}: only the allowlist and its own override variables`);
    const serialised = JSON.stringify(env);
    for (const secret of ["sk-ant-secret", "sk-secret", "ghp_secret", "gh-secret", "copilot-secret", "qwen-secret", "cline-secret", "proxy.invalid", "/home/operator"]) {
      assert.equal(serialised.includes(secret), false, `${host}: no ${secret}`);
    }
    for (const [name, value] of Object.entries(env)) {
      if (name !== "PATH" && name !== "LANG" && name !== "TERM") {
        assert.ok(value.startsWith(`${root}${sep}`), `${host}: ${name} lies inside the root`);
      }
    }
    for (const name of variables) {
      assert.throws(() => isolatedHostEnv(root, host, { stubDir, overrides: { [name]: join(outside, "x") } }), new RegExp(`override ${name} must lie inside the temporary directory`), `${host} ${name}`);
    }
    const foreign = host === "qwen" ? "COPILOT_HOME" : "QWEN_HOME";
    assert.throws(() => isolatedHostEnv(root, host, { stubDir, overrides: { [foreign]: join(root, "x") } }), new RegExp(`${foreign} is not an override variable of ${host}`), `${host}: a cross-host variable`);
  }
});

// ---- The wave-2 script table (test/support/host-live-wave2.ts) -----------------------------------------------------------------

void test("the wave-2 script table covers the nine hosts, runs only commands that need no login and no prompt, and agrees with the live table and the real recipes", (t) => {
  assert.deepEqual([...WAVE2_LIVE_IDS], LIVE_HOST_IDS.slice(5), "the nine wave-2 ids are the hosts after the five wave-1 hosts (claude, codex, opencode, kimi, kimi-code)");
  assert.deepEqual(Object.keys(WAVE2_LIVE).sort(), [...WAVE2_LIVE_IDS].sort());
  const allowed = new Set(["mcp list", "mcp get realm", "mcp list --json", "mcp test realm", "config mcp --json"]);
  const noAdd = new Set<LiveHostId>(["kilo", "cursor", "hermes"]);
  for (const host of WAVE2_LIVE_IDS) {
    const script = WAVE2_LIVE[host];
    assert.deepEqual(Object.keys(script.overrides).sort(), [...WAVE2_OVERRIDES[host]].sort(), `${host}: the script overrides exactly the host's variables`);
    for (const validator of script.validators) {
      assert.ok(allowed.has(validator.args.join(" ")), `${host}: ${validator.args.join(" ")} is not a listing, get, test or config command`);
    }
    assert.equal(
      script.validators.some((validator) => validator.launches),
      HOST_LIVE[host].launchesOnValidate,
      `${host}: launches agrees with the live table`,
    );
    assert.equal(script.addOther === undefined, noAdd.has(host), `${host}: an add step exactly for the hosts with a usable add command`);
    assert.ok(script.validators.length >= 1, host);
    const recipe = wave2Recipe(host);
    assert.equal(recipe.yaml, host === "hermes", host);
    const rig = createHostRig({ host, bin: "/bin/sh", overrides: script.overrides }, {});
    t.after(() => {
      rig.dispose();
    });
    assert.ok(rig.root.startsWith(`${realpathSync(tmpdir())}${sep}`));
    assert.equal(script.configFile(rig), join(script.homeDir(rig), recipe.file), `${host}: the config file is the recipe's file below the home`);
    assert.ok(script.homeDir(rig).startsWith(`${rig.root}${sep}`), `${host}: the home lies inside the rig`);
    for (const dir of script.createdDirs(rig)) {
      assert.ok(dir.startsWith(`${script.homeDir(rig)}${sep}`) && script.configFile(rig).startsWith(`${dir}${sep}`), `${host}: a created directory lies between the home and the file`);
    }
    for (const real of script.realFiles("/operator-home")) {
      assert.ok(real.startsWith("/operator-home/"), `${host}: ${real}`);
    }
    assert.ok(script.realFiles("/operator-home").length >= 1, host);
  }
  const codebuddyAdd = WAVE2_LIVE.codebuddy.addOther;
  assert.ok(codebuddyAdd !== undefined);
  assert.deepEqual(codebuddyAdd.args.slice(0, 4), ["mcp", "add-json", "--scope", "user"], "CodeBuddy's golden writer is `mcp add-json --scope user`, never `mcp add` (E-CB1)");
  assert.equal(WAVE2_LIVE.cursor.validators[0]?.boundKillExpected, true, "the Cursor menu ends by its bound (E-CU3)");
  assert.deepEqual([...(WAVE2_LIVE.pi.validators[0]?.exitCodes ?? [])], [0, 1]);
  assert.deepEqual([...(WAVE2_LIVE.hermes.validators[1]?.exitCodes ?? [])], [0, 1]);
  assert.equal(WAVE2_LIVE.hermes.validators[0]?.launches, false, "`hermes mcp list` prints the entry and starts nothing");
  assert.equal(WAVE2_LIVE.hermes.validators[1]?.launches, true, "`hermes mcp test` launches the server");
  const ids: readonly string[] = LIVE_HOST_IDS;
  assert.equal(ids.includes("antigravity"), false, "antigravity has no live file");
  assert.equal(
    ANTIGRAVITY_GAP,
    "Antigravity's CLI `agy` was never installed or run: its MCP file is documented by three Google pages and no listing command was observed (25-CONTEXT E-AG2); its recipe is proven on a fixture host only",
  );
});

// ---- Process-group runner --------------------------------------------------------------------------------------------------

async function waitUntilGone(pid: number): Promise<void> {
  const outcome = await pollUntil(() => Promise.resolve(processAlive(pid) ? { done: false, detail: `pid ${String(pid)} is still alive` } : { done: true }), {
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

void test("fileSha256, stripAnsi, ownedTableOf and refusalReasonOf", (t) => {
  const dir = tempDir(t);
  const file = join(dir, "f");
  writeFileSync(file, "abc");
  assert.equal(fileSha256(file), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(fileSha256(join(dir, "absent")), null);
  assert.equal(stripAnsi("\u001b[32m✓\u001b[0m realm \u001b[1mconnected\u001b[22m"), "✓ realm connected");
  const table = '[mcp_servers.realm]\ncommand = "realm"\nargs = ["mcp", "--host", "codex"]\n';
  assert.equal(ownedTableOf(`[a]\nx = 1\n\n${table}\n# next\n[b]\n`), table);
  assert.equal(ownedTableOf(table.replaceAll("\n", "\r\n")), table.replaceAll("\n", "\r\n"));
  assert.equal(ownedTableOf("[a]\nx = 1\n"), undefined);
  assert.equal(ownedTableOf(`${table}\n${table}`), undefined, "a duplicate is not an owned table");
  assert.equal(refusalReasonOf({ exitCode: 1, stdout: "POLICY_DENIED\n", stderr: "realm host install: foreign-content: the host configuration holds content that Realm does not own\n" }), "foreign-content");
  assert.equal(refusalReasonOf({ exitCode: 1, stdout: "", stderr: "realm host uninstall: drifted: changed\n" }), "drifted");
  assert.equal(refusalReasonOf({ exitCode: 0, stdout: "{}\n", stderr: "" }), undefined);
});

// ---- The Hermes version root (36-CONTEXT E-36-07) ------------------------------------------------------------------------------

// A fake `hermes` for the version probe. Its data root is the directory HERMES_HOME names: `--version` fails with the sentence of a fresh
// install until the root holds a marker, and the command `mcp list` creates the marker only when `bootstraps` is true.
function writeFakeHermes(dir: string, bootstraps: boolean): string {
  const path = join(dir, bootstraps ? "hermes-fresh" : "hermes-never");
  const create = bootstraps ? 'mkdir -p "$HERMES_HOME" && : > "$HERMES_HOME/bootstrapped"; ' : "";
  const script = [
    "#!/bin/sh",
    `if [ "$1" = "mcp" ]; then ${create}echo realm; exit 0; fi`,
    'if [ -n "$HERMES_HOME" ] && [ -f "$HERMES_HOME/bootstrapped" ]; then echo "Hermes Agent v0.23.1 (2026.9.24)"; exit 0; fi',
    "echo 'hermes: no dependency environment is committed for this install; run hermes pm repair' >&2",
    "exit 1",
    "",
  ].join("\n");
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
}

void test("V1LIVE-01 the version probe bootstraps a fresh Hermes data root, and a Hermes that never bootstraps still skips", async (t) => {
  const dir = tempDir(t);
  const cli = join(dir, "main.js");
  writeFileSync(cli, "");
  const fresh = writeFakeHermes(dir, true);
  const repaired = await collectHostLiveGate("hermes", "validator", { env: { REALM_LIVE_HERMES: "1", REALM_HERMES_BIN: fresh }, platform: "linux", cliPath: cli });
  assert.deepEqual([repaired.skip, repaired.bin, repaired.version], [false, fresh, "0.23.1"]);
  const never = writeFakeHermes(dir, false);
  const broken = await collectHostLiveGate("hermes", "validator", { env: { REALM_LIVE_HERMES: "1", REALM_HERMES_BIN: never }, platform: "linux", cliPath: cli });
  assert.match(String(broken.skip), /--version did not run to a successful exit/, "the repair does not turn a broken Hermes into a pass");
  assert.equal(broken.version, undefined);
});

void test("V1LIVE-01 only the hermes record carries a version root, and the hermes validators bound a cold bootstrap", () => {
  assert.deepEqual(HOST_LIVE.hermes.versionRoot, { variable: "HERMES_HOME", prepare: ["mcp", "list"] });
  for (const host of LIVE_HOST_IDS) {
    if (host !== "hermes") {
      assert.equal(Object.hasOwn(HOST_LIVE[host], "versionRoot"), false, `${host} has no version root`);
    }
  }
  for (const validator of WAVE2_LIVE.hermes.validators) {
    assert.ok((validator.timeoutMs ?? 0) >= 300_000, `hermes ${validator.args.join(" ")} bounds a cold bootstrap`);
  }
  const explicit: Record<string, number[]> = {};
  for (const host of WAVE2_LIVE_IDS) {
    if (host !== "hermes") {
      explicit[host] = WAVE2_LIVE[host].validators.flatMap((validator) => (validator.timeoutMs === undefined ? [] : [validator.timeoutMs]));
    }
  }
  assert.deepEqual(explicit, { qwen: [], pi: [], cursor: [60_000], kilo: [], copilot: [], augment: [120_000], codebuddy: [120_000, 120_000], cline: [] });
});

void test("bootPhaseCountsOf sums the hostBoot rows of one host per phase and tolerates malformed metrics", () => {
  const rows = [
    { hostId: "claude", transport: "stdio", phase: "attached", count: 2 },
    { hostId: "claude", transport: "stdio", phase: "attached", count: 1 },
    { hostId: "claude", transport: "stdio", phase: "failed", code: "REALM_NOT_ACTIVE", count: 4 },
    { hostId: "codex", transport: "stdio", phase: "refused", count: 9 },
    { hostId: "claude", transport: "stdio", phase: "closed", count: "3" },
    { hostId: "claude", transport: "stdio", count: 5 },
    "not a row",
    null,
  ];
  assert.deepEqual(bootPhaseCountsOf(JSON.stringify({ hostBoot: rows }), "claude"), { attached: 3, failed: 4 });
  assert.deepEqual(bootPhaseCountsOf(JSON.stringify({ hostBoot: rows }), "codex"), { refused: 9 });
  assert.deepEqual(bootPhaseCountsOf(JSON.stringify({ hostBoot: rows }), "opencode"), {});
  assert.deepEqual(bootPhaseCountsOf(JSON.stringify({ timings: {} }), "claude"), {}, "a daemon without the hostBoot member yields no counts");
  assert.deepEqual(bootPhaseCountsOf(JSON.stringify({ hostBoot: "nope" }), "claude"), {});
  assert.deepEqual(bootPhaseCountsOf("not json", "claude"), {});
  assert.deepEqual(bootPhaseCountsOf("[]", "claude"), {});
});

void test("the production body of host-live.ts never warms the session: no realm up, no up argument", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../test/support/host-live.ts", import.meta.url)), "utf8");
  const start = source.indexOf("export async function runHostProduction(");
  const end = source.indexOf("// ---- Helpers shared by the live files");
  assert.ok(start > 0 && end > start, "the production body must be found between runHostProduction and the shared helpers marker");
  const body = source.slice(start, end);
  assert.equal(body.includes("realm up"), false, "the production tier attaches cold: the text realm up must not appear in its body");
  assert.equal(body.includes('["up"'), false, "the production tier must not run an up command");
  assert.equal(source.includes("WARM_UP_TIMEOUT_MS"), false, "the warm-up timeout constant is gone");
});

void test("the production body asserts no readiness for the host tiers: no status-active poll, no metrics read", () => {
  const source = readFileSync(fileURLToPath(new URL("../../../test/support/host-live.ts", import.meta.url)), "utf8");
  const start = source.indexOf("export async function runHostProduction(");
  const end = source.indexOf("// ---- Helpers shared by the live files");
  const body = source.slice(start, end);
  assert.equal(body.includes("COLD_READY_TIMEOUT_MS"), false, "no bound waits for the realm to become active after the host has left");
  assert.equal(body.includes("must answer active"), false, "the default drive does not assert realm status active");
  assert.equal(body.includes("never answered active"), false, "the session exit path does not assert realm status active");
  assert.equal(body.includes('"metrics"') && body.includes("boot reports by phase"), false, "the default drive does not read the boot reports");
});

void test("downAcceptable tolerates a down for a session that never became active and refuses any other failure", () => {
  assert.equal(downAcceptable({ exitCode: 0, stdout: "disconnected\n", stderr: "already down (REALM_NOT_ACTIVE)\n" }), true);
  assert.equal(downAcceptable({ exitCode: 1, stdout: "", stderr: "realm down: daemon absent (REALM_NOT_ACTIVE)\n" }), true);
  assert.equal(downAcceptable({ exitCode: 1, stdout: "REALM_NOT_ACTIVE\n", stderr: "" }), true);
  assert.equal(downAcceptable({ exitCode: 1, stdout: "", stderr: "realm down: POLICY_DENIED\n" }), false);
  assert.equal(downAcceptable({ exitCode: undefined, stdout: "", stderr: "" }), false);
});

// ---- Production drives and the host configuration homes ----------------------------------------------------------------------

void test("the production drive types accept a session drive with a fixed key and a command drive, and the host union has five hosts", () => {
  const session: HostSessionDrive = {
    kind: "session",
    provider: { baseUrl: "http://127.0.0.1:1/v1", requests: () => [], close: () => Promise.resolve() },
    args: ["-p", "x"],
    env: { A: "1" },
    credential: "fixed-key",
  };
  const command: HostCommandDrive = { kind: "command", args: ["mcp", "test", "realm"], restore: ["XDG_RUNTIME_DIR"] };
  const drives: readonly HostDrive[] = [session, command];
  assert.deepEqual(
    drives.map((drive) => drive.kind),
    ["session", "command"],
  );
  const hosts: readonly HostProductionId[] = ["claude", "codex", "opencode", "kimi", "kimi-code"];
  for (const host of hosts) {
    assert.equal(HOST_LIVE[host].productionTier, true, host);
  }
});

void test("productionOverrides creates each host's own configuration home inside the scenario, and refuses an unknown host", (t) => {
  const root = tempDir(t);
  const configHome = join(root, "config");
  const expected: Readonly<Record<HostProductionId, readonly [string, string] | null>> = {
    claude: ["CLAUDE_CONFIG_DIR", "cfg"],
    codex: ["CODEX_HOME", "codex"],
    opencode: null,
    kimi: ["KIMI_SHARE_DIR", "kimi"],
    "kimi-code": ["KIMI_CODE_HOME", "kimi-code"],
  };
  for (const host of Object.keys(expected) as HostProductionId[]) {
    const overrides = productionOverrides(host, root, configHome);
    const entry = expected[host];
    if (entry === null) {
      assert.deepEqual(overrides, {}, host);
      assert.equal(existsSync(join(configHome, "opencode")), true, "opencode reads its own subdirectory of XDG_CONFIG_HOME");
    } else {
      assert.deepEqual(overrides, { [entry[0]]: join(root, entry[1]) }, host);
      assert.equal(statSync(join(root, entry[1])).isDirectory(), true, `${host}: the directory exists`);
      assert.ok(HOST_OVERRIDE_VARIABLES[host].includes(entry[0]), `${host}: the variable is one of its override variables`);
    }
  }
  assert.throws(() => productionOverrides("bogus" as HostProductionId, root, configHome), /no production configuration home is defined for host bogus/);
});
