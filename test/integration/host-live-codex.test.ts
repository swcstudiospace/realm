// Codex against the real `codex` CLI (ADPT-08, ADPT-06). The validator tier only: the production tier is a named gap.
//
// Validator tier (REALM_LIVE_CODEX=1, the codex executable, the built CLI; no Podman). The real recipe installs the owned TOML table
// (`[mcp_servers.realm]`, owned by its header, no marker comment) into an isolated CODEX_HOME and Codex's own commands parse it. `codex mcp get|list` print the registered command and do NOT start the
// server, so no stub invocation is expected and none is asserted to exist.
//   A  dry run names config.toml            B  install; status installed
//   C  `codex mcp get|list` print the registered command and args (E-X2)
//   D  `codex mcp add other` leaves the owned table byte-identical and status installed (OQ-24-05)
//   E  reversed order (second home): `codex mcp add realm` first makes install refuse with foreign-content and leaves the file alone
//   F  `codex mcp remove realm` after D: the table is gone, status says missing, and uninstall is a no-op that deletes the receipt
//
// The test never sets a gate variable, never edits Codex's file by hand to make a step pass, and never prints file contents. Observed
// 2026-11-17 with codex-cli 0.154.0: Codex rewrites config.toml with a comment-dropping editor, which is why no marker comment is used. The operator's real ~/.codex/config.toml is hashed before and after and must not change.

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
  ownedTableOf,
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

void test(
  "codex validator: `codex mcp get|list` parse the recipe's table, and the host's own add and remove leave install, status and uninstall consistent",
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

    // B: install writes the table.
    const installed = cliJson(await rig.realm(["install", "codex"]), "realm host install codex");
    assert.equal(installed["status"], "installed");
    assert.equal((await hostStatusOf(rig, "codex"))["status"], "installed");
    const installedText = readFileSync(file, "utf8");
    const ownedTable = ownedTableOf(installedText);
    assert.ok(ownedTable !== undefined, "the install wrote the owned table");
    assert.equal(installedText.includes("host-plugin"), false, "and no marker comment");

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

    // D: a Codex-written entry beside the owned table leaves the table byte-identical and the status ok (OQ-24-05 for this version).
    await succeeded(rig.host(["mcp", "add", "other", "--", "other-cmd"]), "codex mcp add other");
    const afterAdd = readFileSync(file, "utf8");
    assert.ok(afterAdd.includes("[mcp_servers.other]"), "Codex wrote its own entry");
    assert.equal(ownedTableOf(afterAdd), ownedTable, "codex mcp add other must leave the owned table byte-identical");
    const afterAddStatus = await hostStatusOf(rig, "codex");
    assert.equal(afterAddStatus["status"], "installed", "the owned table is still intact");
    assert.deepEqual(afterAddStatus["entries"], [{ path: "config.toml", state: "ok" }]);
    t.diagnostic(
      `codex mcp add other: the other table follows the owned one: ${String(afterAdd.indexOf("[mcp_servers.other]") > afterAdd.indexOf("[mcp_servers.realm]"))}; ` +
        `the file keeps ${String(afterAdd.split("\n").filter((line) => line.startsWith("#")).length)} comment line(s)`,
    );

    // F: Codex's own remover takes the table out. The entry is missing, and uninstall has nothing left to remove.
    const remove = await rig.host(["mcp", "remove", "realm"]);
    requireReturned(remove, "codex mcp remove realm");
    assert.equal(remove.exitCode, 0, describeRun(remove));
    const afterRemove = readFileSync(file, "utf8");
    assert.equal(ownedTableOf(afterRemove), undefined, "codex mcp remove realm removed the owned table");
    assert.equal(afterRemove.includes("[mcp_servers.realm]"), false);
    assert.ok(afterRemove.includes("[mcp_servers.other]"), "and left the other entry");
    const afterRemoveStatus = await hostStatusOf(rig, "codex");
    assert.equal(afterRemoveStatus["status"], "drifted");
    assert.deepEqual(afterRemoveStatus["entries"], [{ path: "config.toml", state: "missing" }]);
    const uninstall = await rig.realm(["uninstall", "codex"]);
    assert.equal(uninstall.exitCode, 0, `uninstall after Codex removed the table must be a no-op: ${describeRun(uninstall)}`);
    assert.equal(cliJson(uninstall, "realm host uninstall codex")["status"], "noop");
    assert.equal(readFileSync(file, "utf8"), afterRemove, "the no-op uninstall leaves the file as Codex left it");
    assert.equal(existsSync(rig.receiptFile("codex")), false, "and deletes the stale receipt");
    t.diagnostic(`codex mcp remove realm (exit ${String(remove.exitCode)}) removed the table; realm host uninstall codex: exit ${String(uninstall.exitCode)}, no refusal`);

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
