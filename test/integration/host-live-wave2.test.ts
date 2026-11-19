// The eleven wave-2 hosts against their real CLIs (WAVE2-07, 25-CONTEXT D-25-08 and D-25-09). The validator tier only, table-driven from
// test/support/host-live-wave2.ts: no wave-2 host has a production tier here (config-only hosts, D-25-08; the Phase 48 production tier of Grok Build
// and the blocker of Prime Agent are in host-live-wave2-production.test.ts), and `antigravity` has no live file
// at all (ANTIGRAVITY_GAP, E-AG2: `agy` was never observed).
//
// Per host the real recipe (json-merge, yaml-map or toml-table) installs, through `realm host install <id>` with the real table, into an isolated HOME and the host's own
// override variable, and the host's own listing command parses what the recipe wrote:
//   launches the stub `realm` (the stub records `mcp --host <id>`):  qwen, kilo, codebuddy and pi (`<host> mcp list`), cursor (`agent mcp
//                                                                    list`, an interactive menu: only the stub argv is asserted),
//                                                                    hermes (`hermes mcp test realm`), grok-build (`grok mcp doctor`)
//   prints the registered entry and starts nothing (no stub run is expected and none is asserted to exist):  copilot (`mcp get realm`,
//                                                                    `mcp list --json`), augment (`auggie mcp list`), cline (`config mcp
//                                                                    --json`), hermes (`mcp list`), prime-agent (`mcp list`, `mcp get realm`), grok-build (`grok mcp list`)
// Hosts with an add command (qwen, pi, copilot, augment, codebuddy, cline, prime-agent, grok-build) then run it, and the test records whether the host left Realm's
// entry value-identical and what `realm host status` says: a host that normalizes the entry shows as `drifted`, which is recorded and
// never hidden (OQ-25-10). Kilo, Cursor and Hermes have no usable add command (interactive or absent) and skip that step.
//
// Steps of every scenario:
//   A  dry run names the recipe's file and writes nothing
//   B  install writes the recipe's value; status installed, launch on-path (the stub realm directory is on the isolated PATH)
//   C  each validator command: exit, the expected output, and the stub argv (launches) or no stub run (prints only)
//   C2 Grok Build only (48-01, D-48-05): the source cells. With the real recipe's config.toml entry and the Claude file both present the
//      server named realm carries grok-build; with the Claude file alone it carries claude; both from `grok mcp doctor --json` and from the
//      stub's recorded arguments. The HOME is put back before step D
//   D  the host's own add command, when there is one: Realm's entry value-identical or recorded as drifted; the host's entry present
//   E  uninstall removes Realm's entry (and the file and directories install created, when the host never touched the file); the host's
//      own entries survive. A drifted entry is refused by uninstall; that refusal is recorded and asserted instead
//   F  the operator's real configuration files of the host are byte-equal to before
//
// Opt in per host: REALM_LIVE_QWEN, REALM_LIVE_PI, REALM_LIVE_HERMES, REALM_LIVE_CURSOR, REALM_LIVE_KILO, REALM_LIVE_COPILOT,
// REALM_LIVE_AUGMENT, REALM_LIVE_CODEBUDDY, REALM_LIVE_CLINE, REALM_LIVE_PRIME_AGENT, REALM_LIVE_GROK_BUILD (each exactly 1), and optionally
// REALM_<ID>_BIN (an absolute path to the host executable; cursor's executable is `cursor-agent`, grok-build's is `grok`, and the two new
// ones are REALM_PRIME_AGENT_BIN and REALM_GROK_BUILD_BIN). Run one host with, for example:
//   REALM_LIVE_QWEN=1 node --test dist/test/integration/host-live-wave2.test.js
// A host whose opt-in is unset, whose CLI is missing, whose `--version` fails (a broken Hermes install, E-HM2) or whose version is below the
// floor (pi below 1.3.0, E-PI2) produces a skip naming the first missing prerequisite; none of these ever fails.
//
// The test never sets a gate variable, never edits a host file by hand to make a step pass, never sends a model prompt, never forwards a
// credential (the environment is the isolated allowlist) and never prints file contents. The operator's real files are hashed before and
// after.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  actionsOf,
  cliJson,
  collectHostLiveGate,
  createHostRig,
  describeRun,
  fileSha256,
  gateBin,
  HOST_LIVE,
  type HostLiveGate,
  hostStatusOf,
  hostVersionNote,
  jsonObjectAt,
  ownedTableOf,
  refusalReasonOf,
  requireReturned,
  stripAnsi,
  VALIDATOR_TIMEOUT_MS,
} from "../support/host-live.js";
import { doctorRealmLabel, parseLooseJson, valueAt, WAVE2_LIVE, WAVE2_LIVE_IDS, wave2Recipe, type Wave2LiveId } from "../support/host-live-wave2.js";
import { isRecord } from "../support/omp-live.js";
import { scaledMs, testTimeout } from "../support/timing.js";

const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));

// Every gate is decided once, at module top: nothing is probed for a host whose opt-in is unset.
const gateEntries: [Wave2LiveId, HostLiveGate][] = [];
for (const host of WAVE2_LIVE_IDS) {
  gateEntries.push([host, await collectHostLiveGate(host, "validator", { env: process.env, platform: process.platform, cliPath: CLI_PATH })]);
}
const GATES = new Map(gateEntries);

// Whether the YAML text of the Hermes file still defines a `realm` server under `mcp_servers`.
function yamlHasRealm(text: string): boolean {
  return /^[ \t]+realm:/m.test(text);
}

// The owned `[mcp_servers.realm]` table as the recipe states it: the scanner's slice ends with the line break of its last key line.
function ownedTableText(text: string): string | undefined {
  return ownedTableOf(text)?.replace(/\n$/, "");
}

async function scenario(t: TestContext, host: Wave2LiveId, gate: HostLiveGate): Promise<void> {
  const spec = HOST_LIVE[host];
  const script = WAVE2_LIVE[host];
  const recipe = wave2Recipe(host);
  const mcpArgv = ["mcp", "--host", host];
  t.diagnostic(hostVersionNote(host, gate));
  const realFiles = script.realFiles(homedir());
  const realBefore = realFiles.map((path) => fileSha256(path));
  const rig = createHostRig({ host, bin: gateBin(gate), overrides: script.overrides }, process.env);
  t.after(() => {
    rig.dispose();
  });
  mkdirSync(script.homeDir(rig), { recursive: true });
  const file = script.configFile(rig);

  // A: a dry run names the recipe's file and writes nothing.
  const planned = cliJson(await rig.realm(["install", host, "--dry-run"]), `realm host install ${host} --dry-run`);
  assert.equal(planned["status"], "planned");
  assert.equal(planned["dryRun"], true);
  assert.ok(
    actionsOf(planned, "dry run").some((action) => action.path === recipe.file && action.action === "create"),
    `the dry run must create ${recipe.file}: ${JSON.stringify(planned["actions"])}`,
  );
  assert.equal(existsSync(file), false, "a dry run writes nothing");

  // B: the real recipe installs; the file holds its value; status installed, launch on-path.
  const installed = cliJson(await rig.realm(["install", host]), `realm host install ${host}`);
  assert.equal(installed["status"], "installed", JSON.stringify(installed));
  if (recipe.yaml) {
    const text = readFileSync(file, "utf8");
    assert.ok(/^mcp_servers:/m.test(text) && yamlHasRealm(text), "the install wrote a realm server under mcp_servers");
  } else if (recipe.toml) {
    assert.equal(ownedTableText(readFileSync(file, "utf8")), recipe.value, "the file holds the recipe's owned table");
  } else {
    assert.deepEqual(valueAt(jsonObjectAt(file), recipe.keyPath), recipe.value, "the file holds the recipe's value at its key path");
  }
  const afterInstall = await hostStatusOf(rig, host);
  assert.equal(afterInstall["status"], "installed", JSON.stringify(afterInstall));
  assert.equal(afterInstall["launch"], "on-path", JSON.stringify(afterInstall));
  let installedHash = fileSha256(file);

  // C: the host's own commands.
  for (const validator of script.validators) {
    const label = `${spec.defaultBinary} ${validator.args.join(" ")}`;
    const before = rig.stubInvocations().length;
    const result = await rig.host(validator.args, { timeoutMs: scaledMs(validator.timeoutMs ?? VALIDATOR_TIMEOUT_MS) });
    const calls = rig.stubInvocations().slice(before);
    if (validator.boundKillExpected === true) {
      // An interactive menu never ends with stdin closed; its bound kill is the expected end (E-CU3) and only the stub argv matters.
      t.diagnostic(`${label}: ${describeRun(result)}`);
    } else {
      requireReturned(result, label);
      const allowed = validator.exitCodes ?? [0];
      assert.ok(allowed.includes(result.exitCode ?? -1), `${label}: exit must be one of ${allowed.join(",")}: ${describeRun(result)}`);
      const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
      for (const pattern of validator.expect) {
        assert.match(output, pattern, `${label} must print the registered entry (${pattern.source}): ${describeRun(result)}`);
      }
    }
    if (validator.launches) {
      assert.ok(calls.length >= 1, `${label} must launch the registered command; the stub recorded no invocation: ${describeRun(result)}`);
      for (const call of calls) {
        assert.deepEqual(call, mcpArgv, `${label} launched exactly realm mcp --host ${host}`);
      }
    } else {
      assert.equal(calls.length, 0, `${label} prints the entry and starts nothing: the stub realm must never be launched`);
    }
  }
  const afterValidators = await hostStatusOf(rig, host);
  t.diagnostic(`after the host's own commands: file ${fileSha256(file) === installedHash ? "untouched" : "rewritten"} by the host; realm host status ${String(afterValidators["status"])}`);

  // C2: the source-precedence cells (48-01, CONTEXT D-48-05): the label the started server carries, per cell, from the stub's recorded arguments
  // and from the doctor JSON. A Grok Build that changes the precedence fails here with the cell name, the label seen and the version.
  if (script.sourceMatrix !== undefined) {
    const matrix = script.sourceMatrix;
    for (const cell of matrix.cells) {
      for (const words of cell.setup) {
        const step = cliJson(await rig.realm(words), `realm host ${words.join(" ")}`);
        assert.ok(step["status"] === "installed" || step["status"] === "removed", `${cell.name}: realm host ${words.join(" ")}: ${JSON.stringify(step)}`);
      }
      const before = rig.stubInvocations().length;
      const result = await rig.host(matrix.doctorArgs(rig), { timeoutMs: scaledMs(VALIDATOR_TIMEOUT_MS) });
      requireReturned(result, `${spec.defaultBinary} ${matrix.doctorArgs(rig).slice(0, 3).join(" ")}`);
      const seen = doctorRealmLabel(stripAnsi(result.stdout));
      const calls = rig.stubInvocations().slice(before);
      t.diagnostic(`source cell "${cell.name}": ${hostVersionNote(host, gate)}; the server named realm carried ${seen}; the stub was started ${String(calls.length)} time(s)`);
      assert.equal(seen, cell.expectLabel, `source cell "${cell.name}": the doctor JSON must show the server named realm with --host ${cell.expectLabel}: ${describeRun(result)}`);
      assert.ok(calls.length >= 1, `source cell "${cell.name}": doctor must start the registered command: ${describeRun(result)}`);
      for (const call of calls) {
        assert.deepEqual(call, ["mcp", "--host", cell.expectLabel], `source cell "${cell.name}": the stub must see exactly realm mcp --host ${cell.expectLabel}`);
      }
    }
    for (const words of matrix.restore) {
      const step = cliJson(await rig.realm(words), `realm host ${words.join(" ")}`);
      assert.ok(step["status"] === "installed" || step["status"] === "removed", `restore: realm host ${words.join(" ")}: ${JSON.stringify(step)}`);
    }
    installedHash = fileSha256(file);
  }

  // D: the host's own add command, when there is one.
  let drifted = afterValidators["status"] === "drifted";
  if (script.addOther !== undefined) {
    const label = `${spec.defaultBinary} ${script.addOther.args.slice(0, 2).join(" ")} other`;
    const add = await rig.host(script.addOther.args);
    requireReturned(add, label);
    assert.equal(add.exitCode, 0, `${label}: ${describeRun(add)}`);
    const afterText = readFileSync(file, "utf8");
    let identical: boolean;
    if (recipe.toml) {
      assert.ok(afterText.includes("[mcp_servers.other]"), `${label} must add the host's own entry beside Realm's`);
      identical = ownedTableText(afterText) === recipe.value;
    } else {
      const parsed = parseLooseJson(afterText);
      const container = valueAt(parsed, recipe.keyPath.slice(0, -1));
      assert.ok(isRecord(container) && Object.hasOwn(container, "other"), `${label} must add the host's own entry beside Realm's`);
      identical = isDeepStrictEqual(valueAt(parsed, recipe.keyPath), recipe.value);
    }
    const afterAdd = await hostStatusOf(rig, host);
    drifted = afterAdd["status"] === "drifted";
    assert.equal(afterAdd["status"], identical ? "installed" : "drifted", `${label}: the entry is ${identical ? "" : "not "}value-identical, so status must say so (OQ-25-10): ${JSON.stringify(afterAdd)}`);
    t.diagnostic(`${script.addOther.note}: Realm's entry is ${identical ? "value-identical" : "CHANGED"}; realm host status ${afterAdd["status"]}; entries ${JSON.stringify(afterAdd["entries"])}`);
  }

  // E: uninstall. `touched` is whether the host rewrote the file Realm's install created.
  const touched = fileSha256(file) !== installedHash;
  const uninstall = await rig.realm(["uninstall", host]);
  if (drifted) {
    // A drifted entry is the host's normalization: uninstall refuses and leaves the file alone (OQ-25-10 records it).
    assert.notEqual(uninstall.exitCode, 0, "uninstall of a drifted entry must refuse");
    assert.equal(refusalReasonOf(uninstall), "drifted", describeRun(uninstall));
    t.diagnostic(`${host}: realm host status says drifted after the host's own commands; realm host uninstall refused it`);
  } else {
    const removed = cliJson(uninstall, `realm host uninstall ${host}`);
    assert.equal(removed["status"], "removed", JSON.stringify(removed));
    assert.equal(existsSync(script.homeDir(rig)), true, "the host's home survives uninstall");
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8");
      if (recipe.yaml) {
        assert.equal(yamlHasRealm(text), false, "uninstall removed the realm server");
      } else if (recipe.toml) {
        assert.equal(ownedTableOf(text), undefined, "uninstall removed Realm's owned table");
        if (script.addOther !== undefined) {
          assert.ok(text.includes("[mcp_servers.other]"), "the host's own entry survives uninstall");
        }
      } else {
        const remaining = parseLooseJson(text);
        assert.equal(valueAt(remaining, recipe.keyPath), undefined, "uninstall removed Realm's entry");
        if (script.addOther !== undefined) {
          const container = valueAt(remaining, recipe.keyPath.slice(0, -1));
          assert.ok(isRecord(container) && Object.hasOwn(container, "other"), "the host's own entry survives uninstall");
        }
      }
      assert.ok(touched || script.addOther !== undefined, "a file install created and the host never touched must be removed whole, not left behind");
    } else {
      for (const dir of script.createdDirs(rig)) {
        const leftover = existsSync(dir) ? readdirSync(dir).join(",") : "";
        assert.equal(existsSync(dir), false, `uninstall removes the directory install created: ${dir.slice(rig.root.length)} still holds ${leftover}`);
      }
    }
  }

  // F: the operator's real configuration files are untouched.
  realFiles.forEach((path, index) => {
    assert.equal(fileSha256(path), realBefore[index], `the operator's real ${path.slice(homedir().length)} must be unchanged`);
  });
}

for (const host of WAVE2_LIVE_IDS) {
  const gate = GATES.get(host);
  if (gate === undefined) {
    throw new Error(`no gate was collected for ${host}`);
  }
  void test(
    `WAVE2-07 ${host}: the real recipe installs into an isolated home, ${HOST_LIVE[host].displayName}'s own commands parse it, and uninstall removes only what install created`,
    { skip: gate.skip, ...testTimeout(1_800_000) },
    async (t) => {
      await scenario(t, host, gate);
    },
  );
}
