// OpenCode against the real `opencode` CLI (ADPT-08, ADPT-05). Two tiers:
//
// Validator tier (REALM_LIVE_OPENCODE=1, the opencode executable, the built CLI; no Podman). The real recipe installs into an isolated
// XDG_CONFIG_HOME and `opencode mcp list` parses the file and launches the stub `realm`. Only `opencode mcp list` and no other
// opencode command runs.
//   A  dry run names opencode.json         B  install writes {"mcp": {"realm": {...}}}; status installed, launch on-path
//   C  `opencode mcp list` prints the realm row and launches `realm mcp --host opencode` (E-O2)
//   D  an opencode.jsonc beside it (comment, trailing comma, a server `other`): both listed, install leaves its bytes untouched; the host may add $schema, and uninstall leaves what the host left (E-O3)
//   E  the V2 shape (second config): install adds mcp.realm beside mcp.servers and both are listed (E-O6)
//   F  after the host ran, uninstall removes only the realm entry: the host-added $schema and the host-created .gitignore stay; a run without the host in between removes the file
// A V2 build (a dist-tag `next` or `dev` binary named by REALM_OPENCODE_BIN) is a valid run of the same file and answers OQ-24-02.
//
// Production tier (the validator gate plus the production prerequisites): `opencode mcp list` is OpenCode's own health check, a real MCP
// handshake (initialize or server/discover) against `realm mcp --host opencode` on the production stack. See runHostProduction.
//
// The test never sets a gate variable. No prompt is sent and no credential is forwarded. The operator's real
// ~/.config/opencode/opencode.json is hashed before and after every test and must not change.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  actionsOf,
  cliJson,
  collectHostLiveGate,
  createHostRig,
  describeRun,
  fileSha256,
  gateBin,
  hostStatusOf,
  hostVersionNote,
  jsonObjectAt,
  requireReturned,
  runHostProduction,
  stripAnsi,
  type HostRig,
  type HostRunResult,
} from "../support/host-live.js";
import { isRecord } from "../support/omp-live.js";
import { scaledMs, testTimeout } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const REAL_OPENCODE_JSON = join(homedir(), ".config", "opencode", "opencode.json");

const validator = await collectHostLiveGate("opencode", "validator", { env: process.env, platform: process.platform, cliPath: CLI_PATH });
const production = await collectHostLiveGate("opencode", "production", { env: process.env, platform: process.platform, cliPath: CLI_PATH });

// A cold OpenCode run took about 70 s in the 2026-11-17 observation: the bound per command is 180 s (a failure bound only).
const COMMAND_BOUND_MS = 180_000;

const MCP_ARGV = ["mcp", "--host", "opencode"];

// A rig with the configuration directory OpenCode reads, <root>/config/opencode, created.
function rigFor(t: TestContext): HostRig {
  const rig = createHostRig({ host: "opencode", bin: gateBin(validator) }, process.env);
  t.after(() => {
    rig.dispose();
  });
  mkdirSync(rig.path("config", "opencode"), { recursive: true });
  return rig;
}

// `opencode mcp list` in the project directory: it must have returned and exited 0. The output is returned without colour.
async function listServers(rig: HostRig, label: string): Promise<{ readonly result: HostRunResult; readonly text: string }> {
  const result = await rig.host(["mcp", "list"], { timeoutMs: scaledMs(COMMAND_BOUND_MS) });
  requireReturned(result, label);
  assert.equal(result.exitCode, 0, `${label}: ${describeRun(result)}`);
  return { result, text: stripAnsi(result.stdout) };
}

function mentions(text: string, server: string): boolean {
  return new RegExp(`(^|[^\\w-])${server}([^\\w-]|$)`, "m").test(text);
}

void test(
  "opencode validator: `opencode mcp list` parses and launches the recipe's entry, an opencode.jsonc beside it is untouched, and uninstall removes only the realm entry",
  { skip: validator.skip, ...testTimeout(1_200_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("opencode", validator));
    const major = Number.parseInt((validator.version ?? "1").split(".")[0] ?? "1", 10);
    if (major !== 1) {
      t.diagnostic(`opencode major version ${String(major)}: a newer line than the recorded 1.x; it runs and is recorded`);
    }
    const realBefore = fileSha256(REAL_OPENCODE_JSON);
    const rig = rigFor(t);
    const dir = rig.path("config", "opencode");
    const file = join(dir, "opencode.json");

    // A: a dry run names opencode.json and writes nothing.
    const planned = cliJson(await rig.realm(["install", "opencode", "--dry-run"]), "realm host install opencode --dry-run");
    assert.equal(planned["status"], "planned");
    assert.equal(planned["dryRun"], true);
    assert.deepEqual(actionsOf(planned, "dry run"), [{ path: "opencode.json", action: "create" }]);
    assert.equal(existsSync(file), false, "a dry run writes nothing");

    // B: install writes {"mcp": {"realm": {...}}}; status installed, launch on-path.
    const installed = cliJson(await rig.realm(["install", "opencode"]), "realm host install opencode");
    assert.equal(installed["status"], "installed");
    const written = jsonObjectAt(file);
    assert.deepEqual(Object.keys(written), ["mcp"], "a fresh file holds the mcp section only");
    assert.deepEqual(written["mcp"], { realm: { type: "local", command: ["realm", "mcp", "--host", "opencode"] } });
    const afterInstall = await hostStatusOf(rig, "opencode");
    assert.equal(afterInstall["status"], "installed", JSON.stringify(afterInstall));
    assert.equal(afterInstall["launch"], "on-path", JSON.stringify(afterInstall));

    // C: the host prints a row for realm with its argv and launches that argv (E-O2).
    const first = await listServers(rig, "opencode mcp list");
    assert.ok(mentions(first.text, "realm"), `opencode mcp list must list realm: ${describeRun(first.result)}`);
    assert.ok(first.text.includes("realm mcp --host opencode"), `opencode mcp list must print the argv realm mcp --host opencode: ${describeRun(first.result)}`);
    const calls = rig.stubInvocations();
    assert.ok(calls.length >= 1, "the host must launch the registered command; the stub recorded no invocation");
    for (const call of calls) {
      assert.deepEqual(call, MCP_ARGV, "the host launched exactly realm mcp --host opencode");
    }

    // D: an opencode.jsonc beside it (a comment, a trailing comma, a server `other`). Both servers are listed. Install, with no host run in
    // between, leaves the file's bytes unchanged (E-O3 re-proved with the recipe's own file); the host's own run may rewrite it (below).
    const jsonc = join(dir, "opencode.jsonc");
    writeFileSync(jsonc, '{\n  // a server the recipe does not own\n  "mcp": {\n    "other": { "type": "local", "command": ["other-cmd"], },\n  },\n}\n');
    const jsoncHash = fileSha256(jsonc);
    const again = cliJson(await rig.realm(["install", "opencode"]), "realm host install opencode again");
    assert.equal(again["status"], "noop", JSON.stringify(again));
    assert.equal(fileSha256(jsonc), jsoncHash, "install must not touch opencode.jsonc");
    const both = await listServers(rig, "opencode mcp list with opencode.jsonc");
    assert.ok(mentions(both.text, "realm") && mentions(both.text, "other"), `opencode mcp list must list realm and other: ${describeRun(both.result)}`);
    // The real `opencode mcp list` also rewrites an existing opencode.jsonc (it adds $schema; observed 2026-11-18). What the host left is
    // the baseline from here on: the Realm engine never touches the jsonc, so uninstall must leave exactly these bytes.
    const jsoncAfterHost = fileSha256(jsonc);
    const jsoncText = readFileSync(jsonc, "utf8");
    assert.ok(jsoncText.includes('"other"'), "the host left the other server in opencode.jsonc");
    assert.equal(jsoncText.includes('"realm"'), false, "no realm key was added to opencode.jsonc");

    // F: the host ran (`opencode mcp list` writes {"$schema": ...} into opencode.json and creates a .gitignore beside it; observed with
    // 1.19.5). Uninstall removes only the realm entry: the host-added $schema key, the file it lives in and the host-created .gitignore
    // stay as the host left them, and the jsonc stays as the host left it. The file is removed only when the host never touched it (the next test).
    const gitignore = join(dir, ".gitignore");
    const gitignoreHash = fileSha256(gitignore);
    assert.ok(gitignoreHash !== null, "opencode mcp list creates a .gitignore beside opencode.json");
    const hostWrote = jsonObjectAt(file);
    assert.ok("$schema" in hostWrote, `opencode mcp list adds $schema to opencode.json: keys ${Object.keys(hostWrote).join(", ")}`);
    const removed = cliJson(await rig.realm(["uninstall", "opencode"]), "realm host uninstall opencode");
    assert.equal(removed["status"], "removed", JSON.stringify(removed));
    assert.equal(existsSync(file), true, "uninstall leaves the file the host also wrote to");
    const left = jsonObjectAt(file);
    assert.equal("mcp" in left, false, "uninstall removed the realm entry and the mcp section it alone held");
    assert.deepEqual(left, { $schema: hostWrote["$schema"] }, "uninstall leaves the host-added keys untouched");
    assert.equal(fileSha256(gitignore), gitignoreHash, "uninstall leaves the host-created .gitignore untouched");
    assert.equal(fileSha256(jsonc), jsoncAfterHost, "uninstall must leave opencode.jsonc exactly as the host left it");
    const jsoncLeft = readFileSync(jsonc, "utf8");
    assert.ok(jsoncLeft.includes('"other"'), "the other server entry remains in opencode.jsonc after uninstall");
    assert.equal(jsoncLeft.includes('"realm"'), false, "no realm key is in opencode.jsonc after uninstall");
    assert.notEqual((await hostStatusOf(rig, "opencode"))["status"], "installed");

    assert.equal(fileSha256(REAL_OPENCODE_JSON), realBefore, "the operator's real opencode.json must be unchanged");
  },
);

void test(
  "opencode validator: without the host running between install and uninstall, uninstall removes the file install created",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    const realBefore = fileSha256(REAL_OPENCODE_JSON);
    const rig = rigFor(t);
    const file = join(rig.path("config", "opencode"), "opencode.json");
    assert.equal(cliJson(await rig.realm(["install", "opencode"]), "realm host install opencode")["status"], "installed");
    assert.equal(existsSync(file), true, "install created the file");
    const removed = cliJson(await rig.realm(["uninstall", "opencode"]), "realm host uninstall opencode");
    assert.equal(removed["status"], "removed", JSON.stringify(removed));
    assert.equal(existsSync(file), false, "no host touched the file, so uninstall removes the file install created");
    assert.notEqual((await hostStatusOf(rig, "opencode"))["status"], "installed");
    assert.equal(fileSha256(REAL_OPENCODE_JSON), realBefore, "the operator's real opencode.json must be unchanged");
  },
);

void test(
  "opencode validator: the V2 shape (mcp.servers) is recognised beside the V1 entry the recipe adds",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    const realBefore = fileSha256(REAL_OPENCODE_JSON);
    const rig = rigFor(t);
    const file = join(rig.path("config", "opencode"), "opencode.json");

    // E: a second isolated config whose opencode.json holds only the V2 section; install adds mcp.realm beside it.
    writeFileSync(file, `${JSON.stringify({ mcp: { servers: { v2: { type: "local", command: ["v2-cmd"] } } } })}\n`);
    const installed = cliJson(await rig.realm(["install", "opencode"]), "realm host install opencode next to a V2 section");
    assert.equal(installed["status"], "installed");
    const mcp = jsonObjectAt(file)["mcp"];
    assert.ok(isRecord(mcp), "the file keeps its mcp section");
    assert.deepEqual(Object.keys(mcp).sort(), ["realm", "servers"], "the V1 entry sits beside the V2 section");
    const listed = await listServers(rig, "opencode mcp list with a V2 section");
    assert.ok(mentions(listed.text, "realm") && mentions(listed.text, "v2"), `opencode mcp list must list realm and v2: ${describeRun(listed.result)}`);
    assert.equal(fileSha256(REAL_OPENCODE_JSON), realBefore, "the operator's real opencode.json must be unchanged");
  },
);

void test(
  "opencode production: `opencode mcp list` performs a real MCP handshake (initialize or server/discover) against realm mcp --host opencode on the production stack",
  { skip: production.skip, ...testTimeout(1_800_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("opencode", production));
    await runHostProduction(t, {
      host: "opencode",
      bin: gateBin(production),
      cliPath: CLI_PATH,
      env: process.env,
      realFile: (home) => join(home, ".config", "opencode", "opencode.json"),
    });
  },
);
