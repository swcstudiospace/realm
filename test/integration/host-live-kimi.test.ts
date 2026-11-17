// Kimi CLI against the real `kimi` CLI (ADPT-08, ADPT-07). The validator tier only: the production tier and Kimi Code are named gaps.
//
// Validator tier (REALM_LIVE_KIMI=1, a kimi executable that is NOT the archived Python stub, the built CLI; no Podman). The real recipe
// installs mcp.json into an isolated KIMI_SHARE_DIR and Kimi's own commands parse and launch it. The only kimi commands that run are
// `kimi mcp list`, `kimi mcp test realm` and `kimi mcp remove realm`: `kimi mcp add` is never run (not needed, and it is the command that
// did not return within 60 s in the 2026-11-17 observation, cause unknown). A command that does not return fails the test with the
// sentence `did not return` instead of hanging.
//   A  dry run names mcp.json          B  install; status installed
//   C  `kimi mcp list` prints realm; `kimi mcp test realm` launches the stub realm: `mcp --host kimi`
//   D  `kimi mcp remove realm` leaves status drifted; uninstall is a clean no-op
//
// The test never sets a gate variable. No prompt is sent and no credential is forwarded. The operator's real ~/.kimi/mcp.json is hashed
// before and after and must not change.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  KIMI_CODE_GAP,
  requireReturned,
  stripAnsi,
  type HostRig,
} from "../support/host-live.js";
import { testTimeout } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
const REAL_KIMI_MCP = join(homedir(), ".kimi", "mcp.json");

const validator = await collectHostLiveGate("kimi", "validator", { env: process.env, platform: process.platform, cliPath: CLI_PATH });

function rigFor(t: TestContext): HostRig {
  const rig = createHostRig({ host: "kimi", bin: gateBin(validator), overrides: { KIMI_SHARE_DIR: "kimi" } }, process.env);
  t.after(() => {
    rig.dispose();
  });
  return rig;
}

void test(
  "kimi validator: `kimi mcp list|test` parse and launch the recipe's mcp.json, and the host's own remover leaves status drifted",
  { skip: validator.skip, ...testTimeout(900_000) },
  async (t) => {
    t.diagnostic(hostVersionNote("kimi", validator));
    const realBefore = fileSha256(REAL_KIMI_MCP);
    const rig = rigFor(t);
    const file = rig.path("kimi", "mcp.json");

    // A: a dry run names mcp.json and writes nothing.
    const planned = cliJson(await rig.realm(["install", "kimi", "--dry-run"]), "realm host install kimi --dry-run");
    assert.equal(planned["status"], "planned");
    assert.equal(planned["dryRun"], true);
    assert.deepEqual(actionsOf(planned, "dry run"), [{ path: "mcp.json", action: "create" }]);
    assert.equal(existsSync(file), false, "a dry run writes nothing");

    // B: install writes it; status installed.
    const installed = cliJson(await rig.realm(["install", "kimi"]), "realm host install kimi");
    assert.equal(installed["status"], "installed");
    assert.equal(existsSync(file), true, "the install writes <KIMI_SHARE_DIR>/mcp.json");
    assert.equal((await hostStatusOf(rig, "kimi"))["status"], "installed");

    // C: the host lists realm, and `kimi mcp test realm` launches the registered argv. The test's own exit status is not asserted: the stub
    // realm exits at once, so the host reports a failed connection. That it LAUNCHED the argv is the evidence.
    const listed = await rig.host(["mcp", "list"]);
    requireReturned(listed, "kimi mcp list");
    assert.equal(listed.exitCode, 0, `kimi mcp list: ${describeRun(listed)}`);
    assert.ok(/(^|[^\w-])realm([^\w-]|$)/m.test(stripAnsi(listed.stdout)), `kimi mcp list must list realm: ${describeRun(listed)}`);
    const tested = await rig.host(["mcp", "test", "realm"]);
    requireReturned(tested, "kimi mcp test realm");
    const calls = rig.stubInvocations();
    assert.ok(calls.length >= 1, `kimi mcp test realm must launch the registered command; the stub recorded no invocation (${describeRun(tested)})`);
    for (const call of calls) {
      assert.deepEqual(call, ["mcp", "--host", "kimi"], "the host launched exactly realm mcp --host kimi");
    }

    // D: the host's own remover. Status drifts; uninstall is a clean no-op.
    const removal = await rig.host(["mcp", "remove", "realm"]);
    requireReturned(removal, "kimi mcp remove realm");
    assert.equal(removal.exitCode, 0, `kimi mcp remove realm: ${describeRun(removal)}`);
    const afterRemove = await hostStatusOf(rig, "kimi");
    assert.equal(afterRemove["status"], "drifted", `a removal by the host must read as drifted: ${JSON.stringify(afterRemove)}`);
    const removed = cliJson(await rig.realm(["uninstall", "kimi"]), "realm host uninstall kimi after the host's own removal");
    assert.deepEqual(
      actionsOf(removed, "uninstall").filter((action) => action.action !== "noop"),
      [],
      `the uninstall must change nothing: ${JSON.stringify(removed)}`,
    );
    assert.equal(existsSync(rig.receiptFile("kimi")), false, "the uninstall deletes the receipt");

    assert.equal(fileSha256(REAL_KIMI_MCP), realBefore, "the operator's real ~/.kimi/mcp.json must be unchanged");
  },
);

void test("kimi production: a named gap", { skip: HOST_LIVE.kimi.productionGap ?? "kimi has no production tier" }, () => {
  assert.fail("the kimi production tier never runs");
});

void test("kimi-code: a named gap", { skip: KIMI_CODE_GAP }, () => {
  assert.fail("the kimi-code live tier never runs");
});
