// Codex against the real `codex` CLI (ADPT-08, ADPT-06). The validator tier only: the production tier is a named gap.
//
// Validator tier (REALM_LIVE_CODEX=1, the codex executable, the built CLI; no Podman). The real recipe installs the owned TOML block
// into an isolated CODEX_HOME and Codex's own commands parse it. `codex mcp get|list` print the registered command and do NOT start the
// server, so no stub invocation is expected and none is asserted to exist.
//   A  dry run names config.toml            B  install; status installed
//   C  `codex mcp get|list` print the registered command and args (E-X2)
//   D  `codex mcp add other` leaves the owned block byte-identical and status installed (OQ-24-05)
//   E  reversed order (second home): `codex mcp add realm` first makes install refuse with foreign-content and leaves the file alone
//   F  `codex mcp remove realm` after D: its effect on the owned block is RECORDED (R-24-04), and uninstall is exercised
//
// The test never sets a gate variable, never edits Codex's file by hand to make a step pass, and never prints file contents except the
// owned block when Codex reformats it. The operator's real ~/.codex/config.toml is hashed before and after and must not change.

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
  HOST_LIVE,
  hostStatusOf,
  hostVersionNote,
  OWNED_BLOCK_BEGIN,
  OWNED_BLOCK_END,
  ownedBlockOf,
  refusalReasonOf,
  requireReturned,
  stripAnsi,
  type HostRig,
  type HostRunResult,
} from "../support/host-live.js";
import { testTimeout } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const REAL_CODEX_CONFIG = join(homedir(), ".codex", "config.toml");

const validator = await collectHostLiveGate("codex", "validator", { env: process.env, platform: process.platform, cliPath: CLI_PATH });

function rigFor(t: TestContext): HostRig {
  const rig = createHostRig({ host: "codex", bin: gateBin(validator), overrides: { CODEX_HOME: "codex" } }, process.env);
  t.after(() => {
    rig.dispose();
  });
  return rig;
}

async function succeeded(run: Promise<HostRunResult>, label: string): Promise<HostRunResult> {
  const result = await run;
  requireReturned(result, label);
  assert.equal(result.exitCode, 0, `${label}: ${describeRun(result)}`);
  return result;
}

type RemovalEffect = "block removed with markers" | "markers left" | "unchanged";

// What `codex mcp remove realm` did to the file that held the owned block.
function removalEffect(before: string, after: string): RemovalEffect {
  if (after === before) {
    return "unchanged";
  }
  return after.includes(OWNED_BLOCK_BEGIN) || after.includes(OWNED_BLOCK_END) ? "markers left" : "block removed with markers";
}

void test(
  "codex validator: `codex mcp get|list` parse the recipe's block, and the host's own add and remove interoperate with install and uninstall",
  { skip: validator.skip, ...testTimeout(900_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("codex", validator));
    const realBefore = fileSha256(REAL_CODEX_CONFIG);
    const rig = rigFor(t);
    const file = rig.path("codex", "config.toml");

    // A: a dry run names config.toml and writes nothing.
    const planned = cliJson(await rig.realm(["install", "codex", "--dry-run"]), "realm host install codex --dry-run");
    assert.equal(planned["status"], "planned");
    assert.equal(planned["dryRun"], true);
    assert.deepEqual(actionsOf(planned, "dry run"), [{ path: "config.toml", action: "create" }]);
    assert.equal(existsSync(file), false, "a dry run writes nothing");

    // B: install writes the block.
    const installed = cliJson(await rig.realm(["install", "codex"]), "realm host install codex");
    assert.equal(installed["status"], "installed");
    assert.equal((await hostStatusOf(rig, "codex"))["status"], "installed");
    const installedText = readFileSync(file, "utf8");
    const ownedBlock = ownedBlockOf(installedText);
    assert.ok(ownedBlock !== undefined, "the install wrote the owned block between its markers");

    // C: Codex's own commands print the registered command. They do not start the server (E-X2).
    const got = await succeeded(rig.host(["mcp", "get", "realm"]), "codex mcp get realm");
    const gotText = stripAnsi(got.stdout);
    for (const expected of ["transport: stdio", "command: realm", "args: mcp --host codex"]) {
      assert.ok(gotText.includes(expected), `codex mcp get realm must print ${JSON.stringify(expected)}: ${describeRun(got)}`);
    }
    const listed = await succeeded(rig.host(["mcp", "list"]), "codex mcp list");
    const row = stripAnsi(listed.stdout)
      .split("\n")
      .find((line) => /^\s*realm\s+realm\s+mcp --host codex\b/.test(line));
    assert.ok(row !== undefined, `codex mcp list must have a realm row with the command and args: ${describeRun(listed)}`);
    assert.ok(/\benabled\b/.test(row), `the realm row must be enabled: ${JSON.stringify(row)}`);
    assert.deepEqual(rig.stubInvocations(), [], "codex mcp get and list do not start the server: the stub realm was never launched");

    // D: a Codex-written entry beside the owned block leaves the block byte-identical (OQ-24-05 for this version).
    await succeeded(rig.host(["mcp", "add", "other", "--", "other-cmd"]), "codex mcp add other");
    const afterAdd = readFileSync(file, "utf8");
    assert.ok(afterAdd.includes("[mcp_servers.other]"), "Codex wrote its own entry");
    assert.equal(ownedBlockOf(afterAdd), ownedBlock, "codex mcp add other must leave the owned block (markers and table text) byte-identical");
    assert.equal((await hostStatusOf(rig, "codex"))["status"], "installed", "the owned block is still intact");

    // F: Codex's own remover. The effect on the owned block is recorded, not assumed (R-24-04).
    const beforeRemove = readFileSync(file, "utf8");
    const remove = await rig.host(["mcp", "remove", "realm"]);
    requireReturned(remove, "codex mcp remove realm");
    const effect = removalEffect(beforeRemove, existsSync(file) ? readFileSync(file, "utf8") : "");
    assert.ok(["block removed with markers", "markers left", "unchanged"].includes(effect));
    t.diagnostic(`R-24-04: codex mcp remove realm (exit ${String(remove.exitCode)}) left the owned block: ${effect}`);
    const uninstall = await rig.realm(["uninstall", "codex"]);
    const refusal = refusalReasonOf(uninstall);
    t.diagnostic(`R-24-04: realm host uninstall codex after that removal: exit ${String(uninstall.exitCode)}, refusal ${refusal ?? "none"}`);

    assert.equal(fileSha256(REAL_CODEX_CONFIG), realBefore, "the operator's real ~/.codex/config.toml must be unchanged");
  },
);

void test(
  "codex validator: an entry written by `codex mcp add realm` first makes install refuse with foreign-content and leaves the file alone",
  { skip: validator.skip, ...testTimeout(600_000) },
  async (t) => {
    const realBefore = fileSha256(REAL_CODEX_CONFIG);
    const rig = rigFor(t);
    const file = rig.path("codex", "config.toml");

    // E: the reverse order, in a second isolated home (the guard, live).
    await succeeded(rig.host(["mcp", "add", "realm", "--", "realm", "mcp", "--host", "codex"]), "codex mcp add realm");
    const before = readFileSync(file);
    const refused = await rig.realm(["install", "codex"]);
    assert.equal(refused.exitCode, 1, `the install must refuse: ${refused.stdout}${refused.stderr}`);
    assert.equal(refusalReasonOf(refused), "foreign-content", refused.stderr);
    assert.ok(readFileSync(file).equals(before), "a refused install leaves the file byte-identical");
    assert.equal(existsSync(rig.receiptFile("codex")), false, "and writes no receipt");
    assert.equal(fileSha256(REAL_CODEX_CONFIG), realBefore, "the operator's real ~/.codex/config.toml must be unchanged");
  },
);

void test("codex production: a named gap", { skip: HOST_LIVE.codex.productionGap ?? "codex has no production tier" }, () => {
  assert.fail("the codex production tier never runs");
});
