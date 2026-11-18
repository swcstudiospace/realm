// Claude Code against the real `claude` CLI (ADPT-08, ADPT-04). Two tiers:
//
// Validator tier (REALM_LIVE_CLAUDE=1, the claude executable, the built CLI; no Podman). The real recipe installs into an isolated
// HOME and Claude Code's own commands parse and launch what it wrote: `claude mcp get|list` launch a stub `realm` that records its argv.
// The host's own writer and remover (`claude mcp add|remove`) interoperate with the recipe in both orders, and CLAUDE_CONFIG_DIR moves
// the file the recipe writes and the file `claude mcp get` reads.
//   A  dry run writes nothing and names .claude.json        B  install; status installed, launch on-path
//   C  `claude mcp get|list` print the entry and launch `realm mcp --host claude`   D  `claude mcp add other` keeps the owned entry
//   E  `claude mcp remove realm -s user` leaves status drifted; uninstall is a clean no-op and deletes the receipt
//   F  reversed order (second HOME): the host's own entry first makes install a no-op; uninstall leaves the entry
//   G  CLAUDE_CONFIG_DIR (third HOME): install and `claude mcp get` agree on <dir>/.claude.json
//
// Production tier (the validator gate plus the production prerequisites: Podman 5.x, the digest-pinned image, the driver config and
// sockets, the openshell CLI, no Realm receipt for claude in the shared state directory). `claude mcp list` is Claude Code's own health
// check: it performs a real MCP handshake (initialize or server/discover) against `realm mcp --host claude` on the production stack. See runHostProduction.
//
// The test never sets a gate variable. No prompt is sent and no credential is forwarded: the environment is an allowlist. The operator's
// real ~/.claude.json is hashed before and after every test and must not change.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
import { testTimeout } from "../support/timing.js";

// The compiled CLI beside the compiled tests: this file runs from dist/test/integration, the CLI from dist/src/cli.
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const REAL_CLAUDE_JSON = join(homedir(), ".claude.json");

const validator = await collectHostLiveGate("claude", "validator", { env: process.env, platform: process.platform, cliPath: CLI_PATH });
const production = await collectHostLiveGate("claude", "production", { env: process.env, platform: process.platform, cliPath: CLI_PATH });

const MCP_ARGV = ["mcp", "--host", "claude"];

// A rig whose root is removed when the test ends.
function rigFor(t: TestContext, overrides: Readonly<Record<string, string>> = {}): HostRig {
  const rig = createHostRig({ host: "claude", bin: gateBin(validator), overrides }, process.env);
  t.after(() => {
    rig.dispose();
  });
  return rig;
}

// A host command that must have returned and exited 0.
async function succeeded(run: Promise<HostRunResult>, label: string): Promise<HostRunResult> {
  const result = await run;
  requireReturned(result, label);
  assert.equal(result.exitCode, 0, `${label}: ${describeRun(result)}`);
  return result;
}

// The mcpServers object of the .claude.json a file holds.
function serversIn(file: string): Record<string, unknown> {
  const servers = jsonObjectAt(file)["mcpServers"];
  assert.ok(isRecord(servers), `${file} must hold an mcpServers object`);
  return servers;
}

// Every invocation the stub realm recorded is exactly `mcp --host claude`, and there is at least one.
function assertLaunched(rig: HostRig, label: string): void {
  const calls = rig.stubInvocations();
  assert.ok(calls.length >= 1, `${label}: the host must launch the registered command; the stub recorded no invocation`);
  for (const call of calls) {
    assert.deepEqual(call, MCP_ARGV, `${label}: the host launched exactly realm mcp --host claude`);
  }
}

void test(
  "claude validator: the recipe's file is parsed and launched by `claude mcp get|list`, and the host's own add and remove interoperate with install and uninstall",
  { skip: validator.skip, ...testTimeout(1_200_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("claude", validator));
    const realBefore = fileSha256(REAL_CLAUDE_JSON);
    const rig = rigFor(t);
    const file = join(rig.home, ".claude.json");

    // A: a dry run writes nothing and names .claude.json.
    const planned = cliJson(await rig.realm(["install", "claude", "--dry-run"]), "realm host install claude --dry-run");
    assert.equal(planned["status"], "planned");
    assert.equal(planned["dryRun"], true);
    assert.deepEqual(actionsOf(planned, "dry run"), [{ path: ".claude.json", action: "create" }]);
    assert.equal(existsSync(file), false, "a dry run writes nothing");
    assert.equal(existsSync(rig.receiptFile("claude")), false, "and no receipt");

    // B: the real install writes a fresh file with no Claude keys; status installed, launch on-path.
    const installed = cliJson(await rig.realm(["install", "claude"]), "realm host install claude");
    assert.equal(installed["status"], "installed");
    assert.deepEqual(Object.keys(jsonObjectAt(file)), ["mcpServers"], "a fresh file holds the owned entry and no Claude key");
    const afterInstall = await hostStatusOf(rig, "claude");
    assert.equal(afterInstall["status"], "installed", JSON.stringify(afterInstall));
    assert.equal(afterInstall["launch"], "on-path", JSON.stringify(afterInstall));

    // C: the host's own commands print the entry and launch the registered argv (E-C3).
    const got = await succeeded(rig.host(["mcp", "get", "realm"]), "claude mcp get realm");
    const gotText = stripAnsi(got.stdout);
    for (const expected of ["Scope: User config", "Command: realm", "Args: mcp --host claude"]) {
      assert.ok(gotText.includes(expected), `claude mcp get realm must print ${JSON.stringify(expected)}: ${describeRun(got)}`);
    }
    assertLaunched(rig, "after claude mcp get realm");
    const listed = await succeeded(rig.host(["mcp", "list"]), "claude mcp list");
    assert.ok(/(^|\s)realm\b/m.test(stripAnsi(listed.stdout)), `claude mcp list must list realm: ${describeRun(listed)}`);
    assertLaunched(rig, "after claude mcp list");

    // D: a Claude-written file. The host's own rewrite keeps the owned entry (OQ-24-04 for a fresh HOME).
    await succeeded(rig.host(["mcp", "add", "--scope", "user", "other", "--", "other-cmd"]), "claude mcp add other");
    const afterAdd = await hostStatusOf(rig, "claude");
    assert.equal(afterAdd["status"], "installed", `the host's own rewrite must leave the owned entry intact: ${JSON.stringify(afterAdd)}`);
    assert.deepEqual(Object.keys(serversIn(file)).sort(), ["other", "realm"], "the file holds both servers");

    // E: the host's own remover. Status drifts; uninstall is a clean no-op and deletes the receipt; `other` stays.
    await succeeded(rig.host(["mcp", "remove", "realm", "-s", "user"]), "claude mcp remove realm -s user");
    const afterRemove = await hostStatusOf(rig, "claude");
    assert.equal(afterRemove["status"], "drifted", `a removal by the host must read as drifted: ${JSON.stringify(afterRemove)}`);
    const removed = cliJson(await rig.realm(["uninstall", "claude"]), "realm host uninstall claude after the host's own removal");
    assert.deepEqual(
      actionsOf(removed, "uninstall").filter((action) => action.action !== "noop"),
      [],
      `the uninstall must change nothing: ${JSON.stringify(removed)}`,
    );
    assert.equal(existsSync(rig.receiptFile("claude")), false, "the uninstall deletes the receipt");
    assert.deepEqual(Object.keys(serversIn(file)), ["other"], "the host's other server is still configured");

    assert.equal(fileSha256(REAL_CLAUDE_JSON), realBefore, "the operator's real ~/.claude.json must be unchanged");
  },
);

void test(
  "claude validator: an entry written by `claude mcp add` first makes install a no-op, and uninstall leaves it",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    const realBefore = fileSha256(REAL_CLAUDE_JSON);
    const rig = rigFor(t);
    const file = join(rig.home, ".claude.json");

    // F: reversed order, in a second isolated HOME.
    await succeeded(rig.host(["mcp", "add", "--scope", "user", "realm", "--", "realm", "mcp", "--host", "claude"]), "claude mcp add realm");
    const before = readFileSync(file, "utf8");
    const installed = cliJson(await rig.realm(["install", "claude"]), "realm host install claude after the host's own add");
    assert.equal(installed["status"], "noop", `the recipe value equals what the host itself writes: ${JSON.stringify(installed)}`);
    assert.equal(readFileSync(file, "utf8"), before, "the install changed nothing");
    const receipt = rig.receiptFile("claude");
    if (existsSync(receipt)) {
      const record = jsonObjectAt(receipt);
      assert.deepEqual(record["entries"], [], "the receipt holds no entry for what the host wrote");
    }
    const removed = cliJson(await rig.realm(["uninstall", "claude"]), "realm host uninstall claude after the host's own add");
    assert.deepEqual(
      actionsOf(removed, "uninstall").filter((action) => action.action !== "noop"),
      [],
      `the uninstall must not touch an entry Realm did not write: ${JSON.stringify(removed)}`,
    );
    assert.deepEqual(Object.keys(serversIn(file)), ["realm"], "the host's own entry is still there");
    assert.equal(fileSha256(REAL_CLAUDE_JSON), realBefore, "the operator's real ~/.claude.json must be unchanged");
  },
);

void test(
  "claude validator: CLAUDE_CONFIG_DIR moves the file the recipe writes and the file `claude mcp get` reads",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    const realBefore = fileSha256(REAL_CLAUDE_JSON);
    const rig = rigFor(t, { CLAUDE_CONFIG_DIR: "cfg" });
    const moved = rig.path("cfg", ".claude.json");

    // G: install lands in <dir>/.claude.json; the host with the same variable finds it.
    const installed = cliJson(await rig.realm(["install", "claude"]), "realm host install claude with CLAUDE_CONFIG_DIR");
    assert.equal(installed["status"], "installed");
    assert.ok(existsSync(moved), "the install writes <CLAUDE_CONFIG_DIR>/.claude.json");
    assert.deepEqual(Object.keys(serversIn(moved)), ["realm"]);
    const got = await succeeded(rig.host(["mcp", "get", "realm"]), "claude mcp get realm with CLAUDE_CONFIG_DIR");
    assert.ok(stripAnsi(got.stdout).includes("Command: realm"), `claude mcp get realm must find the moved entry: ${describeRun(got)}`);
    assert.equal(fileSha256(REAL_CLAUDE_JSON), realBefore, "the operator's real ~/.claude.json must be unchanged");
  },
);

void test(
  "claude production: `claude mcp list` performs a real MCP handshake (initialize or server/discover) against realm mcp --host claude on the production stack",
  { skip: production.skip, ...testTimeout(1_800_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("claude", production));
    await runHostProduction(t, { host: "claude", bin: gateBin(production), cliPath: CLI_PATH, env: process.env, realFile: (home) => join(home, ".claude.json") });
  },
);
