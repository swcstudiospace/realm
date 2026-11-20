// The always-running hermetic test of test/support/host-live-kimi.ts (phase 43): no host CLI, no Podman, no network. It pins the fixed
// non-secret key, the Kimi Code session arguments and drive environment, the validator-tier containment and the restored names.
// Phase 47 adds the pins of the legacy production switches (restore set, warm control, evidence directory), of the evidence and reach
// support modules (test/support/host-live-evidence.ts, host-live-reach.ts), of the hash option of the fake MCP server and of the pure
// parts of the expansion and writer probes.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { isolatedHostEnv } from "../support/host-live.js";
import { catalogueCodesIn, checkEvidenceDir, EVIDENCE_REFUSAL_TEXT, type RunEvidenceInput, type RunEvidenceSettings, writeRunEvidence } from "../support/host-live-evidence.js";
import {
  classifyExpansion,
  credentialNamesOf,
  describeMcpJsonShape,
  digest12,
  isDiagnosticVariant,
  KIMI_REHEARSAL_KEY,
  KIMI_REHEARSAL_MODEL,
  KIMI_RESTORED_ENV,
  kimiCodeDriveEnv,
  kimiCodeSessionArgs,
  kimiContainmentEnv,
  kimiEvidenceSettings,
  kimiProductionDrive,
  kimiProductionPlan,
  parseKimiRestore,
  restoreLabel,
  variantLabel,
} from "../support/host-live-kimi.js";
import { observeReach, type ReachSeams } from "../support/host-live-reach.js";
import { CODEX_FORWARDED_ENV, readFakeServerLog, SESSION_PROMPT, writeFakeMcpServer } from "../support/host-live-session.js";
import { REACH_POLL_MS, REACH_WINDOW_MS } from "../support/wire-timeline.js";

function tempDir(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlk-test-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

void test("the fixed key and model alias are the documented literals", () => {
  assert.equal(KIMI_REHEARSAL_KEY, "rehearsal-key-not-a-secret");
  assert.equal(KIMI_REHEARSAL_MODEL, "rehearsal-model");
});

void test("kimiCodeSessionArgs is the single option -p and the fixed prompt", () => {
  assert.deepEqual(kimiCodeSessionArgs(), ["-p", SESSION_PROMPT]);
  assert.notEqual(kimiCodeSessionArgs(), kimiCodeSessionArgs(), "a fresh list every call");
});

void test("kimiCodeDriveEnv is a frozen record of the model, the fixed key, the loopback base URL and the switches, and never KIMI_CODE_HOME", () => {
  const baseUrl = "http://127.0.0.1:4242/v1";
  const env = kimiCodeDriveEnv(baseUrl);
  assert.ok(Object.isFrozen(env));
  assert.deepEqual(env, {
    KIMI_MODEL_NAME: "rehearsal-model",
    KIMI_MODEL_API_KEY: "rehearsal-key-not-a-secret",
    KIMI_MODEL_BASE_URL: baseUrl,
    KIMI_MODEL_PROVIDER_TYPE: "openai",
    KIMI_DISABLE_TELEMETRY: "1",
    KIMI_CODE_NO_AUTO_UPDATE: "1",
    KIMI_CLI_NO_AUTO_UPDATE: "1",
  });
  assert.equal("KIMI_CODE_HOME" in env, false);
  for (const url of ["https://api.moonshot.ai/v1", "http://localhost:4242/v1", "http://10.0.0.5:80/v1", "http://127.0.0.1", ""]) {
    assert.throws(() => kimiCodeDriveEnv(url), /loopback refusing provider/, url);
  }
});

void test("kimiContainmentEnv switches updates and telemetry off and sends every proxied connection to a dead loopback port, keeping loopback direct", () => {
  const env = kimiContainmentEnv();
  assert.ok(Object.isFrozen(env));
  for (const name of ["KIMI_DISABLE_TELEMETRY", "KIMI_CODE_NO_AUTO_UPDATE", "KIMI_CLI_NO_AUTO_UPDATE"]) {
    assert.equal(env[name], "1", name);
  }
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    assert.equal(env[name], "http://127.0.0.1:9", name);
  }
  for (const name of ["NO_PROXY", "no_proxy"]) {
    assert.equal(env[name], "127.0.0.1,localhost,::1", name);
  }
  assert.deepEqual(Object.keys(env).sort(), ["ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "KIMI_CLI_NO_AUTO_UPDATE", "KIMI_CODE_NO_AUTO_UPDATE", "KIMI_DISABLE_TELEMETRY", "NO_PROXY", "all_proxy", "http_proxy", "https_proxy", "no_proxy"]);
});

void test("KIMI_RESTORED_ENV is the three names of CODEX_FORWARDED_ENV", () => {
  assert.deepEqual([...KIMI_RESTORED_ENV], ["XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "REALM_DRIVER_SOCKET"]);
  assert.deepEqual([...KIMI_RESTORED_ENV], [...CODEX_FORWARDED_ENV]);
});

void test("credentialNamesOf returns the sorted names that look like a credential, and no other", () => {
  assert.deepEqual(
    credentialNamesOf({ PATH: "/bin", HOME: "/h", MOONSHOT_API_KEY: "x", KIMI_API_KEY: "y", OPENAI_API_KEY: "z", GITHUB_TOKEN: "t", LANG: "C", KIMI_CODE_HOME: "/k", HTTP_PROXY: "p" }),
    ["GITHUB_TOKEN", "KIMI_API_KEY", "KIMI_CODE_HOME", "MOONSHOT_API_KEY", "OPENAI_API_KEY"],
  );
  assert.deepEqual(credentialNamesOf({ PATH: "/bin", HOME: "/h" }), []);
});

void test("an isolated Kimi Code drive environment holds no credential name but the Kimi configuration names and the one fixed key", (t) => {
  const root = tempDir(t);
  const home = join(root, "kimi-code");
  const isolated = isolatedHostEnv(root, "kimi-code", {
    stubDir: join(root, "stub"),
    source: { LANG: "C.UTF-8", MOONSHOT_API_KEY: "operator-secret", KIMI_API_KEY: "operator-secret", OPENAI_API_KEY: "operator-secret", GITHUB_TOKEN: "operator-secret" },
    overrides: { KIMI_CODE_HOME: home },
  });
  const env = { ...isolated, ...kimiCodeDriveEnv("http://127.0.0.1:4242/v1"), ...kimiContainmentEnv() };
  // Every KIMI_ name is Kimi configuration, not an operator credential: the isolated environment copies nothing but LANG and TERM from the
  // source. A name outside this list (a MOONSHOT_ variable, another _API_KEY or _TOKEN) would show up here.
  assert.deepEqual(credentialNamesOf(env), [
    "KIMI_CLI_NO_AUTO_UPDATE",
    "KIMI_CODE_HOME",
    "KIMI_CODE_NO_AUTO_UPDATE",
    "KIMI_DISABLE_TELEMETRY",
    "KIMI_MODEL_API_KEY",
    "KIMI_MODEL_BASE_URL",
    "KIMI_MODEL_NAME",
    "KIMI_MODEL_PROVIDER_TYPE",
  ]);
  assert.deepEqual(
    credentialNamesOf(env).filter((name) => name.endsWith("_API_KEY") || name.endsWith("_TOKEN") || name.startsWith("MOONSHOT_")),
    ["KIMI_MODEL_API_KEY"],
    "the fixed key is the only key-shaped name",
  );
  assert.equal(env["KIMI_MODEL_API_KEY"], KIMI_REHEARSAL_KEY);
  assert.equal(JSON.stringify(env).includes("operator-secret"), false, "no operator value enters the environment");
  assert.equal(env["KIMI_CODE_HOME"], home);
});

// ---- Phase 47: the switches of the legacy production test --------------------------------------------------------------------

const [RUNTIME, CONFIG, SOCKET] = KIMI_RESTORED_ENV as [string, string, string];

void test("parseKimiRestore: unset or empty is all three names in table order, none is the empty list, a comma list is the subset in table order", () => {
  assert.deepEqual([...parseKimiRestore(undefined)], [RUNTIME, CONFIG, SOCKET]);
  assert.deepEqual([...parseKimiRestore("")], [RUNTIME, CONFIG, SOCKET]);
  assert.deepEqual([...parseKimiRestore("none")], []);
  assert.deepEqual([...parseKimiRestore(`${SOCKET},${RUNTIME}`)], [RUNTIME, SOCKET], "table order, not the order typed");
  assert.deepEqual([...parseKimiRestore(`${SOCKET},${CONFIG},${RUNTIME}`)], [RUNTIME, CONFIG, SOCKET]);
  assert.deepEqual([...parseKimiRestore(CONFIG)], [CONFIG]);
  assert.notEqual(parseKimiRestore(undefined), KIMI_RESTORED_ENV, "a fresh list, never the shared constant");
});

void test("parseKimiRestore refuses anything else with a message that names the allowed words and never echoes the value", () => {
  for (const bad of ["BOGUS", `${RUNTIME},${RUNTIME}`, `${RUNTIME},`, `,${CONFIG}`, `${RUNTIME}=1`, "all", "None", ` ${RUNTIME}`, `${RUNTIME},secret-value-marker`]) {
    assert.throws(
      () => parseKimiRestore(bad),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /REALM_LIVE_KIMI_RESTORE/);
        assert.match(error.message, /none/);
        for (const name of KIMI_RESTORED_ENV) {
          assert.ok(error.message.includes(name), `the message names ${name}`);
        }
        // A value made of allowed names alone is inside the allowed-names sentence; any other text must not be echoed.
        for (const echoed of ["secret-value-marker", "BOGUS", ...(KIMI_RESTORED_ENV.some((name) => bad.includes(name)) && !bad.includes("=") ? [] : [bad])]) {
          assert.equal(error.message.includes(echoed), false, `the message does not echo ${JSON.stringify(echoed)}`);
        }
        return true;
      },
      bad,
    );
  }
});

void test("restoreLabel is derived: all, none, or minus followed by the missing name", () => {
  assert.equal(restoreLabel([RUNTIME, CONFIG, SOCKET]), "all");
  assert.equal(restoreLabel([SOCKET, CONFIG, RUNTIME]), "all");
  assert.equal(restoreLabel([]), "none");
  assert.equal(restoreLabel([RUNTIME, SOCKET]), `minus-${CONFIG}`);
  assert.equal(restoreLabel([CONFIG, SOCKET]), `minus-${RUNTIME}`);
  assert.equal(restoreLabel([RUNTIME, CONFIG]), `minus-${SOCKET}`);
  assert.equal(restoreLabel([CONFIG]), `minus-${RUNTIME}+${SOCKET}`);
});

void test("only the default restore set with no warm control is not a diagnostic variant; a diagnostic label starts with diagnostic variant", () => {
  assert.equal(isDiagnosticVariant([RUNTIME, CONFIG, SOCKET], false), false);
  assert.equal(isDiagnosticVariant([RUNTIME, CONFIG, SOCKET], true), true);
  assert.equal(isDiagnosticVariant([], false), true);
  assert.equal(isDiagnosticVariant([RUNTIME, SOCKET], false), true);
  assert.doesNotMatch(variantLabel([RUNTIME, CONFIG, SOCKET], false), /diagnostic variant/);
  assert.match(variantLabel([RUNTIME, CONFIG, SOCKET], false), /^production tier/);
  assert.equal(variantLabel([], false), "diagnostic variant: restore none");
  assert.equal(variantLabel([RUNTIME, SOCKET], false), `diagnostic variant: restore minus-${CONFIG}`);
  assert.equal(variantLabel([RUNTIME, CONFIG, SOCKET], true), "diagnostic variant: restore all, warm control");
});

void test("with none of the new environment names set the production drive is exactly the Phase 43 one", () => {
  const plan = kimiProductionPlan({});
  assert.deepEqual(plan, { restore: [RUNTIME, CONFIG, SOCKET], warm: false, diagnostic: false, label: variantLabel([RUNTIME, CONFIG, SOCKET], false) });
  assert.deepEqual(kimiProductionDrive(plan), { kind: "command", args: ["mcp", "test", "realm"], restore: [...KIMI_RESTORED_ENV] });
  assert.deepEqual(kimiProductionDrive(kimiProductionPlan({ REALM_LIVE_KIMI_RESTORE: "", REALM_LIVE_KIMI_WARM: "0", REALM_LIVE_EVIDENCE_DIR: "" })), { kind: "command", args: ["mcp", "test", "realm"], restore: [...KIMI_RESTORED_ENV] }, "an empty or non-1 value changes nothing");
});

void test("the variant switches are read from the three names and reach the drive and the evidence settings", () => {
  const none = kimiProductionPlan({ REALM_LIVE_KIMI_RESTORE: "none" });
  assert.deepEqual([none.restore, none.warm, none.diagnostic], [[], false, true]);
  assert.deepEqual(kimiProductionDrive(none), { kind: "command", args: ["mcp", "test", "realm"], restore: [] });
  const warm = kimiProductionPlan({ REALM_LIVE_KIMI_WARM: "1", REALM_LIVE_EVIDENCE_DIR: "/evidence" });
  assert.equal(warm.warm, true);
  assert.equal(warm.diagnostic, true);
  assert.equal(warm.evidenceDir, "/evidence");
  const settings = kimiEvidenceSettings(warm, "/checked");
  assert.deepEqual(settings, { dir: "/checked", label: "diagnostic variant: restore all, warm control", folderLabel: "all-warm", diagnostic: true, control: "C3" });
  assert.deepEqual(kimiProductionDrive(warm, settings), { kind: "command", args: ["mcp", "test", "realm"], restore: [...KIMI_RESTORED_ENV], warm: true, evidence: settings });
  const minus = kimiEvidenceSettings(kimiProductionPlan({ REALM_LIVE_KIMI_RESTORE: `${RUNTIME},${SOCKET}` }), "/checked");
  assert.deepEqual(minus, { dir: "/checked", label: `diagnostic variant: restore minus-${CONFIG}`, folderLabel: `minus-${CONFIG}`, diagnostic: true });
  assert.throws(() => kimiProductionPlan({ REALM_LIVE_KIMI_RESTORE: "nope" }), /REALM_LIVE_KIMI_RESTORE/);
});

// ---- Phase 47: the evidence directory ----------------------------------------------------------------------------------------

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

void test("checkEvidenceDir passes an existing 0700 directory outside the checkout and refuses every other case with a distinct reason", (t) => {
  const root = tempDir(t);
  const checkout = join(root, "checkout");
  const inside = join(checkout, "evidence");
  const outside = join(root, "outside");
  const loose = join(root, "loose");
  const file = join(root, "a-file");
  const link = join(outside, "link-into-checkout");
  for (const dir of [checkout, inside, outside, loose]) {
    mkdirSync(dir);
    chmodSync(dir, dir === loose ? 0o755 : 0o700);
  }
  writeFileSync(file, "x");
  symlinkSync(inside, link);

  assert.deepEqual(checkEvidenceDir(outside, checkout), { ok: true, dir: outside });
  assert.deepEqual(checkEvidenceDir("evidence", checkout), { ok: false, reason: "not-absolute" });
  assert.deepEqual(checkEvidenceDir(join(root, "missing"), checkout), { ok: false, reason: "missing" });
  assert.equal(existsSync(join(root, "missing")), false, "the directory is never created");
  assert.deepEqual(checkEvidenceDir(file, checkout), { ok: false, reason: "not-a-directory" });
  assert.deepEqual(checkEvidenceDir(inside, checkout), { ok: false, reason: "inside-checkout" });
  assert.deepEqual(checkEvidenceDir(checkout, checkout), { ok: false, reason: "inside-checkout" });
  assert.deepEqual(checkEvidenceDir(link, checkout), { ok: false, reason: "inside-checkout" }, "found by real path, symlinks resolved");
  assert.deepEqual(checkEvidenceDir(loose, checkout), { ok: false, reason: "not-mode-0700" });
  const reasons = new Set(Object.keys(EVIDENCE_REFUSAL_TEXT));
  assert.equal(reasons.size, 5, "five distinct reasons");
  for (const text of Object.values(EVIDENCE_REFUSAL_TEXT)) {
    assert.equal(text.includes(root), false, "no refusal sentence holds a path");
  }
});

// ---- Phase 47: the run folder ------------------------------------------------------------------------------------------------

const SETTINGS = (dir: string): RunEvidenceSettings => ({ dir, label: "diagnostic variant: restore none", folderLabel: "none", diagnostic: true });

function evidenceInput(root: string, dir: string, overrides: Partial<RunEvidenceInput> = {}): RunEvidenceInput {
  const wireLog = join(root, "wire.log");
  const stderrFile = join(root, "server-stderr.txt");
  writeFileSync(wireLog, '{"t":1,"kind":"lifecycle","event":"child-start"}\n');
  writeFileSync(stderrFile, "REALM_NOT_ACTIVE: a message with PLANTED-STDERR-TEXT and /home/planted/path\nplain line\nSCHEMA_INVALID\nNOT_A_REALM_CODE\n");
  return {
    settings: SETTINGS(dir),
    restore: [],
    warm: false,
    cold: true,
    elapsedMs: 18225,
    returned: true,
    exitCode: 0,
    wireLog,
    stdout: "PLANTED-STDOUT-TEXT\n",
    stderr: "PLANTED-COMMAND-STDERR\n",
    serverStderrFile: stderrFile,
    reach: { polls: [{ atMs: 0, sandboxes: 0 }, { atMs: 2000, sandboxes: 1 }], firstReachedIndex: 1, reached: true, catalogueCodes: ["TOOL_TIMEOUT"], failedSeams: [] },
    ...overrides,
  };
}

void test("writeRunEvidence writes the six members with mode 0600 in a folder of mode 0700, names the folder from a counter and the label, and makes two folders when called twice", (t) => {
  const root = tempDir(t);
  const dir = join(root, "evidence");
  mkdirSync(dir, { mode: 0o700 });
  const first = writeRunEvidence(evidenceInput(root, dir));
  const second = writeRunEvidence(evidenceInput(root, dir));
  assert.deepEqual(readdirSync(dir).sort(), ["01-none", "02-none"]);
  assert.equal(first.folder, join(dir, "01-none"));
  assert.equal(second.folder, join(dir, "02-none"));
  assert.deepEqual(first.failures, []);
  assert.equal(modeOf(first.folder), 0o700);
  assert.deepEqual(readdirSync(first.folder).sort(), ["command-stderr.txt", "command-stdout.txt", "reach.json", "run.json", "server-stderr.txt", "wire.log"]);
  for (const name of readdirSync(first.folder)) {
    assert.equal(modeOf(join(first.folder, name)), 0o600, name);
  }
  assert.equal(readFileSync(join(first.folder, "wire.log"), "utf8"), readFileSync(join(root, "wire.log"), "utf8"), "a copy of the recorder log");
  assert.equal(readFileSync(join(first.folder, "command-stdout.txt"), "utf8"), "PLANTED-STDOUT-TEXT\n");
  assert.equal(readFileSync(join(first.folder, "command-stderr.txt"), "utf8"), "PLANTED-COMMAND-STDERR\n");
  assert.ok(readFileSync(join(first.folder, "server-stderr.txt"), "utf8").includes("PLANTED-STDERR-TEXT"), "the full server stderr stays in the evidence directory");

  const record = JSON.parse(readFileSync(join(first.folder, "run.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(record, {
    label: "diagnostic variant: restore none",
    restore: [],
    warm: false,
    diagnostic: true,
    cold: true,
    elapsedMs: 18225,
    returned: true,
    exitCode: 0,
    catalogueCodes: ["REALM_NOT_ACTIVE", "SCHEMA_INVALID", "TOOL_TIMEOUT"],
  });
  const reach = JSON.parse(readFileSync(join(first.folder, "reach.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(reach, { polls: [{ atMs: 0, sandboxes: 0 }, { atMs: 2000, sandboxes: 1 }], firstReachedIndex: 1, reached: true, failedSeams: [] });
  // run.json never holds a message, a path or an output text.
  const text = readFileSync(join(first.folder, "run.json"), "utf8") + readFileSync(join(first.folder, "reach.json"), "utf8");
  for (const planted of ["PLANTED", "/home/", root, "NOT_A_REALM_CODE"]) {
    assert.equal(text.includes(planted), false, `run.json and reach.json never hold ${planted}`);
  }
});

void test("writeRunEvidence records a run that did not return, a control and a member it could not write, and never throws for a member", (t) => {
  const root = tempDir(t);
  const dir = join(root, "evidence");
  mkdirSync(dir, { mode: 0o700 });
  const base = evidenceInput(root, dir);
  const unreturned = writeRunEvidence({
    settings: { ...SETTINGS(dir), control: "C3", folderLabel: "all-warm" },
    restore: [RUNTIME, CONFIG, SOCKET],
    warm: true,
    cold: true,
    elapsedMs: 900_000,
    returned: false,
    wireLog: base.wireLog,
    stdout: "",
    stderr: "",
  });
  const record = JSON.parse(readFileSync(join(unreturned.folder, "run.json"), "utf8")) as Record<string, unknown>;
  assert.equal(record["returned"], false);
  assert.equal("exitCode" in record, false, "no exit code for a command that did not return");
  assert.equal(record["control"], "C3");
  assert.equal(record["warm"], true);
  assert.ok(unreturned.folder.endsWith("01-all-warm"));

  // A server stderr path that cannot be read (a directory) is a named failure, recorded in run.json, and the other members are written.
  const broken = writeRunEvidence(evidenceInput(root, dir, { serverStderrFile: root, wireLog: join(root, "absent.log") }));
  assert.deepEqual(broken.failures, ["server-stderr.txt"]);
  assert.deepEqual((JSON.parse(readFileSync(join(broken.folder, "run.json"), "utf8")) as Record<string, unknown>)["evidenceFailures"], ["server-stderr.txt"]);
  assert.equal(readFileSync(join(broken.folder, "wire.log"), "utf8"), "", "a missing recorder log is an empty copy");
  const bare = writeRunEvidence({ settings: base.settings, restore: [], warm: false, cold: false, elapsedMs: 1, returned: true, wireLog: base.wireLog, stdout: "", stderr: "" });
  assert.deepEqual(JSON.parse(readFileSync(join(bare.folder, "reach.json"), "utf8")), { polls: [], firstReachedIndex: null, reached: false, failedSeams: [] });
});

void test("catalogueCodesIn returns the sorted catalogue codes a text names as whole words, and nothing else", () => {
  assert.deepEqual(catalogueCodesIn("TOOL_TIMEOUT: x\nREALM_NOT_ACTIVE: y\nTOOL_TIMEOUT again"), ["REALM_NOT_ACTIVE", "TOOL_TIMEOUT"]);
  assert.deepEqual(catalogueCodesIn("MY_TOOL_TIMEOUT NOT_REALM_NOT_ACTIVE_AT_ALL TOOL_TIMEOUTS"), []);
  assert.deepEqual(catalogueCodesIn(""), []);
});

// ---- Phase 47: the reach observation -----------------------------------------------------------------------------------------

function fakeClock(): ReachSeams["clock"] {
  let now = 0;
  return {
    now: () => now,
    sleep: (ms) => {
      now += ms;
      return Promise.resolve();
    },
  };
}

function seamsOf(over: Partial<ReachSeams> = {}): ReachSeams {
  return {
    status: () => Promise.resolve("starting"),
    containers: () => Promise.resolve(0),
    sandboxes: () => Promise.resolve(0),
    attached: () => Promise.resolve(0),
    stderrCodes: () => Promise.resolve([]),
    clock: fakeClock(),
    ...over,
  };
}

void test("observeReach polls every REACH_POLL_MS up to REACH_WINDOW_MS and returns reached false when nothing holds", async () => {
  assert.equal(REACH_POLL_MS, 2000);
  assert.equal(REACH_WINDOW_MS, 60_000);
  const observation = await observeReach(seamsOf());
  assert.equal(observation.reached, false);
  assert.equal(observation.firstReachedIndex, null);
  assert.equal(observation.polls.length, 31, "one poll at 0 and one every 2 s up to and including 60 s");
  assert.deepEqual(observation.polls.slice(0, 3).map((poll) => poll.atMs), [0, 2000, 4000]);
  assert.equal(observation.polls.at(-1)?.atMs, 60_000);
  assert.deepEqual(observation.polls[0], { atMs: 0, sandboxes: 0, containers: 0, attached: 0, state: "starting" });
  assert.deepEqual(observation.failedSeams, []);
});

void test("observeReach stops early on the first poll at which a sandbox, a container or an attached boot report exists", async () => {
  for (const seam of ["sandboxes", "containers", "attached"] as const) {
    let calls = 0;
    const observation = await observeReach(
      seamsOf({
        [seam]: () => {
          calls += 1;
          return Promise.resolve(calls >= 3 ? 1 : 0);
        },
        status: () => Promise.resolve(calls >= 2 ? "active" : "starting"),
      }),
    );
    assert.equal(observation.reached, true, seam);
    assert.equal(observation.firstReachedIndex, 2, seam);
    assert.equal(observation.polls.length, 3, `${seam}: no poll after the first reached one`);
    assert.equal(observation.polls[2]?.state, "active");
  }
});

void test("observeReach takes one more poll at the deadline, and records a seam that throws as an observation failure for that poll without aborting", async () => {
  const observation = await observeReach(
    seamsOf({
      containers: () => Promise.reject(new Error("PLANTED-SEAM-MESSAGE")),
      stderrCodes: () => Promise.resolve(["TOOL_TIMEOUT", "REALM_NOT_ACTIVE"]),
    }),
    { windowMs: 5000, pollMs: 2000 },
  );
  assert.deepEqual(observation.polls.map((poll) => poll.atMs), [0, 2000, 4000, 5000]);
  assert.equal(observation.reached, false);
  assert.deepEqual(observation.polls[0], { atMs: 0, sandboxes: 0, attached: 0, state: "starting", failed: ["containers"] });
  assert.deepEqual(observation.failedSeams, ["containers"]);
  assert.deepEqual(observation.catalogueCodes, ["REALM_NOT_ACTIVE", "TOOL_TIMEOUT"]);
  assert.equal(JSON.stringify(observation).includes("PLANTED-SEAM-MESSAGE"), false, "a failure keeps the seam name only");
  const lateReach = await observeReach(seamsOf({ sandboxes: () => Promise.reject(new Error("x")), attached: () => Promise.resolve(1) }), { windowMs: 4000, pollMs: 2000 });
  assert.equal(lateReach.reached, true, "a failing seam never hides another that reached");
  assert.equal(lateReach.polls.length, 1);
});

// ---- Phase 47: the hash option of the fake MCP server ------------------------------------------------------------------------

void test("the fake MCP server logs a 12 hex digest, never a value, for each listed name present in its environment, and its log is unchanged with no list", (t) => {
  const dir = tempDir(t);
  const log = join(dir, "hashed.log");
  const plainLog = join(dir, "plain.log");
  const hashed = writeFakeMcpServer(join(dir, "a"), log, { hashNames: ["PROBE_PRESENT", "PROBE_ABSENT"] });
  const plain = writeFakeMcpServer(join(dir, "b"), plainLog);
  const env = { PATH: process.env["PATH"] ?? "", PROBE_PRESENT: "probe-value-marker", PROBE_OTHER: "other-value-marker" };
  for (const script of [hashed, plain]) {
    const run = spawnSync(process.execPath, [script], { input: "", env, encoding: "utf8" });
    assert.equal(run.status, 0);
  }
  const lines = readFileSync(log, "utf8").split("\n").filter((line) => line !== "");
  const start = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
  assert.deepEqual(start["hashes"], { PROBE_PRESENT: digest12("probe-value-marker") });
  assert.match(digest12("probe-value-marker"), /^[0-9a-f]{12}$/);
  assert.equal(readFileSync(log, "utf8").includes("probe-value-marker"), false, "no value in the log");
  assert.equal(readFakeServerLog(log).starts[0]?.hashes?.["PROBE_PRESENT"], digest12("probe-value-marker"));
  assert.equal(readFakeServerLog(log).eofCount, 1);

  const plainStart = JSON.parse(readFileSync(plainLog, "utf8").split("\n")[0] ?? "") as Record<string, unknown>;
  assert.deepEqual(Object.keys(plainStart).sort(), ["argv", "cwd", "env", "event", "pid"], "with no list the start line is unchanged");
  assert.equal(readFakeServerLog(plainLog).starts[0]?.hashes, undefined);
});

// ---- Phase 47: the pure parts of the two probes ------------------------------------------------------------------------------

void test("classifyExpansion tells absent, an unexpanded reference in either spelling, the host's value and anything else apart", () => {
  const candidates = { brace: digest12("${XDG_RUNTIME_DIR}"), bare: digest12("$XDG_RUNTIME_DIR"), host: digest12("host-value-marker") };
  assert.equal(classifyExpansion(undefined, candidates), "absent");
  assert.equal(classifyExpansion(candidates.brace, candidates), "unexpanded-reference");
  assert.equal(classifyExpansion(candidates.bare, candidates), "unexpanded-reference");
  assert.equal(classifyExpansion(candidates.host, candidates), "host-value");
  assert.equal(classifyExpansion(digest12("something else"), candidates), "other");
  assert.notEqual(candidates.brace, candidates.bare);
});

void test("describeMcpJsonShape reports member names, key order and indent and never a value", () => {
  const text = `${JSON.stringify({ mcpServers: { realm: { command: "SECRET-COMMAND-VALUE", args: ["mcp"], env: { XDG_RUNTIME_DIR: "SECRET-ENV-VALUE" } } } }, null, 4)}\n`;
  const shape = describeMcpJsonShape(text);
  assert.deepEqual(shape, { parsed: true, topLevel: ["mcpServers"], entries: { realm: ["command", "args", "env"] }, envNames: { realm: ["XDG_RUNTIME_DIR"] }, indent: 4, trailingNewline: true });
  assert.equal(JSON.stringify(shape).includes("SECRET"), false);
  assert.equal(describeMcpJsonShape('{"mcpServers":{"realm":{"args":[],"command":"x"}}}').indent, "none");
  assert.equal(describeMcpJsonShape('{\n\t"a": 1\n}').indent, "tab");
  assert.equal(describeMcpJsonShape('{\n  "a": 1\n}').trailingNewline, false);
  assert.deepEqual(describeMcpJsonShape("not json"), { parsed: false, topLevel: [], entries: {}, envNames: {}, indent: "none", trailingNewline: false });
  assert.deepEqual(describeMcpJsonShape("[]").topLevel, []);
});
