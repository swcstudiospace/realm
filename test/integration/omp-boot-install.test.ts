// Omp on boot through the production stack: `realm host install omp` writes the extension shim into an isolated Omp profile, and a
// real Omp that loads that shim (no explicit extension path) opens Realm by itself, with no `realm up` and no daemon before it.
//
// One scenario in a fixed order, because each step leaves the state the next one needs:
//   D  No Node. With no daemon, an Omp whose PATH holds no directory with `node` (only the directory of the omp binary) cannot
//      spawn the daemon: its status shows REALM_NOT_ACTIVE and no daemon process appears. The shim is not installed yet, so this
//      session loads the built extension explicitly, as the other live Omp tests do.
//   A  Install. `realm host install omp --dry-run` writes nothing and names one file under extensions/realm/; the real install
//      writes it. `realm host status omp` reports installed, target present, 0 live sessions, no conflicts, and
//      `omp plugin list --json` does not list agent-realm (the shim is not a plugin link).
//   B  Boot. With no daemon and no `realm up`, an Omp started WITHOUT an extension path loads the installed shim, starts the daemon
//      and paints `realm active`. No extension_error frame arrives, `realm-retry` is listed, `realm status` answers, the daemon log
//      holds no daemon.failed, `realm host status omp` counts 1 live session while Omp runs and 0 after it closes.
//   C  Outside every policy root. Omp started in a directory outside the policy roots paints a POLICY_DENIED refusal and no
//      sandbox exists for that directory.
//   E  Uninstall. `realm host uninstall omp` removes the shim and the directory install created; the isolated profile's other
//      files are byte-identical to a snapshot taken just before the uninstall (after every Omp run, so Omp's own state is
//      unchanged by the uninstall), and the files the profile held before any Omp ran are unchanged. `realm down` follows and
//      the residue checks find no container and no sandbox of this scenario.
//
// No prompt runs: Omp needs a model configuration to start, so one scripted provider serves models.yml and is never asked a turn.
//
// Gate. The file skips, naming the first missing prerequisite, unless both of these hold:
//   1. REALM_LIVE_OMP=1 and the Omp prerequisites (ompSkipReason): Linux, the omp executable, its version, the built extension.
//   2. REALM_LIVE_PRODUCTION=1 and the production prerequisites (productionSkipReason): the opt-in, Podman 5.x, the digest-pinned
//      image, the driver config, a rootless Podman socket, the openshell CLI and the built CLI.
// The test never sets either variable. It also skips, without touching anything, when the state directory already holds a Realm
// host receipt for omp: that receipt belongs to a real install, and this test must not replace it.
//
// Removal scope. The isolated profile is a temporary root, removed afterwards. The test creates one directory under the pinned
// workspace root, omp-boot-<random>, and removes exactly that name. The shared state directory gets the entries the run created
// (the host receipt and the presence markers under hosts/) removed, and nothing that existed before.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  closeWithEvidence,
  collectOmpGateInputs,
  createCleanups,
  EXTENSION_PATH,
  isRecord,
  OMP_READY_TIMEOUT_MS,
  ompBinary,
  ompSkipReason,
  writeEvidence,
} from "../support/omp-live.js";
import { createOmpProfile, type OmpProfile } from "../support/omp-profile.js";
import { killGroup, OmpSession, startOmp, type OmpExit } from "../support/omp-rpc.js";
import { ScriptedProvider } from "../support/scripted-provider.js";
import {
  createScenarioEnvironment,
  type CommandResult,
  describeResult,
  describeValue,
  findDaemonPids,
  isDirectory,
  isSocket,
  listSandboxContainers,
  listSandboxesNamed,
  type LiveInputs,
  onPath,
  pollUntil,
  probePodman,
  productionSkipReason,
  readLiveInputs,
  realmCliWithWorkspace,
  removeSharedStateCreatedBy,
  restoreSharedPolicy,
  runCommand,
  sandboxNameFor,
  type ScenarioEnvironment,
  stateOfStatus,
  waitForNoResidue,
} from "../support/production-live.js";

// The compiled CLI beside the compiled tests: this file runs from dist/test/integration, the CLI from dist/src/cli.
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
// The compiled daemon entry beside the CLI (dist/src/daemon/main.js), the argument of every daemon process.
const DAEMON_ENTRY = fileURLToPath(new URL("../../src/daemon/main.js", import.meta.url));
const OMP_BIN = ompBinary(process.env);

// The Omp prerequisites are checked first, then the production ones, so the first missing one names the skip.
const ompGate = ompSkipReason(await collectOmpGateInputs(process.env, { platform: process.platform, trace: false }));
const productionGate = productionSkipReason({
  env: process.env,
  podman: await probePodman(),
  isSocket,
  onPath: (name) => onPath(name, process.env["PATH"]),
  exists: existsSync,
  isDirectory,
  cliPath: CLI_PATH,
});
const skip: string | false = ompGate ?? productionGate;
const live: LiveInputs | undefined = skip === false ? readLiveInputs(process.env, CLI_PATH) : undefined;

function requireLive(): LiveInputs {
  if (live === undefined) {
    throw new Error("the Omp boot install scenario ran although its gate is closed");
  }
  return live;
}

// The bounds of the one scenario. Its parts: two refused sessions (180 s and 240 s to their status), the stack start of the boot
// session (360 s: the daemon, OpenShell and Podman start cold), the presence and status polls, and the teardown.
const SCENARIO_TIMEOUT_MS = 1_800_000;
const HOST_TIMEOUT_MS = 90_000;
const NO_NODE_REFUSAL_TIMEOUT_MS = OMP_READY_TIMEOUT_MS;
const POLICY_REFUSAL_TIMEOUT_MS = 240_000;
const BOOT_ACTIVE_TIMEOUT_MS = 360_000;
const STATUS_POLL_TIMEOUT_MS = 90_000;
const COMMANDS_TIMEOUT_MS = 60_000;
const DOWN_TIMEOUT_MS = 120_000;
const EVIDENCE_DIR_VARIABLE = "REALM_OMP_EVIDENCE_DIR";
const EVIDENCE_PREFIX = "omp-boot-install";
const CLOSE_OPTIONS = { graceMs: 40_000, termMs: 20_000, killMs: 20_000 } as const;

// The Omp arguments of a session that must load what the profile installed: ompArgs of omp-rpc.ts without --no-extensions and -e.
const INSTALLED_OMP_ARGS: readonly string[] = ["--mode", "rpc-ui", "--model", "stub/scripted", "--no-session"];

// Starts Omp the way a user does after `realm host install omp`: no extension path, so only the installed shim can load Realm.
// The process leads its own group and is signalled as a group, as startOmp does.
function startInstalledOmp(options: { readonly bin: string; readonly env: Readonly<Record<string, string>>; readonly cwd: string }): OmpSession {
  const child = spawn(options.bin, [...INSTALLED_OMP_ARGS], {
    cwd: options.cwd,
    env: { ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  const exited = new Promise<OmpExit>((resolve) => {
    child.once("error", (error) => {
      resolve({ code: null, signal: null, error: error.message });
    });
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
  return new OmpSession(
    { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, kill: (signal) => killGroup(child, signal) },
    exited,
  );
}

// The first executable regular file `bin` names: itself when absolute, else the first absolute PATH entry that holds it.
function locateExecutable(bin: string, pathValue: string | undefined): string | undefined {
  const isExecutableFile = (candidate: string): boolean => {
    try {
      accessSync(candidate, constants.X_OK);
      return statSync(candidate).isFile();
    } catch {
      // Not there, or not executable: the search goes on.
      return false;
    }
  };
  if (isAbsolute(bin)) {
    return isExecutableFile(bin) ? bin : undefined;
  }
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (dir !== "" && isAbsolute(dir) && isExecutableFile(join(dir, bin))) {
      return join(dir, bin);
    }
  }
  return undefined;
}

// Whether a directory holds anything named node.
function holdsNode(dir: string): boolean {
  try {
    return statSync(join(dir, "node")).isFile();
  } catch {
    return false;
  }
}

// The command and PATH of the no-Node session: the omp binary and the directory it lives in, which is the only PATH entry. When
// that directory itself holds a node, the PATH names a private directory holding a link to omp instead, so no directory that
// holds node is on it either way.
function noNodeSession(profileRoot: string, ompPath: string): { readonly bin: string; readonly pathValue: string; readonly note: string } {
  const ompDir = dirname(ompPath);
  if (!holdsNode(ompDir)) {
    return { bin: ompPath, pathValue: ompDir, note: "PATH is the directory of the omp binary" };
  }
  const privateDir = join(profileRoot, "nonode-bin");
  mkdirSync(privateDir);
  const link = join(privateDir, basename(ompPath));
  symlinkSync(ompPath, link);
  return { bin: link, pathValue: privateDir, note: "the omp binary's directory holds a node: PATH is a private directory holding a link to omp" };
}

// path -> "dir", "link <target>", or "file <sha256>" for every entry under the profile's agent and home directories, relative to the
// profile root. tmp, config, state and the workspace are not part of the Omp profile the uninstall must leave alone.
function snapshotOf(profile: OmpProfile): Map<string, string> {
  const entries = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const key = relative(profile.root, full);
      const info = lstatSync(full);
      if (info.isSymbolicLink()) {
        entries.set(key, `link ${readlinkSync(full)}`);
      } else if (info.isDirectory()) {
        entries.set(key, "dir");
        walk(full);
      } else if (info.isFile()) {
        entries.set(key, `file ${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
      } else {
        entries.set(key, "other");
      }
    }
  };
  for (const root of [profile.agentDir, profile.home]) {
    entries.set(relative(profile.root, root), "dir");
    walk(root);
  }
  return entries;
}

// What differs between two snapshots, one line each. An entry that `removable` accepts may be missing from `after`.
function snapshotProblems(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>, removable: (key: string) => boolean): string[] {
  const problems: string[] = [];
  for (const [key, value] of before) {
    const now = after.get(key);
    if (now === undefined) {
      if (!removable(key)) {
        problems.push(`removed: ${key}`);
      }
    } else if (now !== value) {
      problems.push(`changed: ${key}`);
    }
  }
  for (const key of after.keys()) {
    if (!before.has(key)) {
      problems.push(`added: ${key}`);
    }
  }
  return problems;
}

// The parsed single JSON line a realm host command printed. The command must have exited 0.
function jsonLineOf(result: CommandResult, label: string): Record<string, unknown> {
  assert.equal(result.exitCode, 0, `${label}: ${describeResult(result)}`);
  const parsed: unknown = JSON.parse(result.stdout.trim());
  assert.ok(isRecord(parsed), `${label} must print one JSON object: ${describeResult(result)}`);
  return parsed;
}

// The file actions of an install or uninstall result, each { path, action, bytes }.
function actionsOf(line: Record<string, unknown>, label: string): Record<string, unknown>[] {
  const actions = line["actions"];
  assert.ok(Array.isArray(actions), `${label} must name its actions: ${describeValue(line)}`);
  return (actions as unknown[]).map((action) => {
    assert.ok(isRecord(action), `${label}: an action must be an object: ${describeValue(action)}`);
    return action;
  });
}

// The size of a file, 0 when it does not exist: the offset the daemon log is read from.
function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

void test(
  "Omp loads the installed shim and opens Realm on boot: no daemon before it, a refusal outside the policy roots, no Node, and a clean uninstall",
  { skip, timeout: SCENARIO_TIMEOUT_MS },
  async (t) => {
    const inputs = requireLive();

    // The receipt of a real install must never be replaced: the scenario shares the live state directory.
    const hostsDir = inputs.driverStateDir === undefined ? undefined : join(inputs.driverStateDir, "hosts");
    if (hostsDir !== undefined && existsSync(join(hostsDir, "omp.receipt.json"))) {
      t.skip(`the state directory already holds a Realm host receipt for omp (${join(hostsDir, "omp.receipt.json")}); refusing to touch a real install`);
      return;
    }
    const hostsDirExisted = hostsDir !== undefined && existsSync(hostsDir);
    const presenceDirExisted = hostsDir !== undefined && existsSync(join(hostsDir, "omp-active"));

    const scenario: ScenarioEnvironment = createScenarioEnvironment(inputs, { image: inputs.image });
    const suffix = randomBytes(6).toString("hex");
    // The project Omp starts in: a directory inside the pinned workspace root, so it is inside a policy root.
    const projectDir = join(inputs.workspaceRoot, `omp-boot-${suffix}`);

    // Cleanups run last-in, first-out: Omp is closed first, then the profile and the provider go, then the daemon is stopped and
    // the scenario's files are removed.
    const cleanups = createCleanups();
    t.after(() => cleanups.run());
    const sandboxes: string[] = [];
    cleanups.add(async () => {
      // The body removes projectDir after its own `realm down`; a selection for a directory that no longer exists is
      // POLICY_DENIED at the CLI, so the safety-net down runs only when the body failed before reaching that point.
      if (existsSync(projectDir)) {
        const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
        assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
      }
      restoreSharedPolicy(scenario);
      removeSharedStateCreatedBy(scenario);
      if (hostsDir !== undefined) {
        // The receipt and the presence directory of this run. Nothing that existed before the run is removed.
        rmSync(join(hostsDir, "omp.receipt.json"), { force: true });
        if (!presenceDirExisted) {
          rmSync(join(hostsDir, "omp-active"), { recursive: true, force: true });
        }
        if (!hostsDirExisted) {
          rmSync(hostsDir, { recursive: true, force: true });
        }
      }
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(scenario.root, { recursive: true, force: true });
      const residue = await waitForNoResidue(inputs, sandboxes);
      assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
    });

    // The scripted provider only serves models.yml: no prompt is sent, so it is never asked a turn.
    const provider = new ScriptedProvider();
    cleanups.add(() => provider.stop());
    provider.onTurn(() => ({ text: "unused" }));
    const { port } = await provider.start();

    const pathValue = process.env["PATH"];
    const profile: OmpProfile = createOmpProfile({
      providerPort: port,
      ...(pathValue === undefined ? {} : { path: pathValue }),
    });
    cleanups.add(() => {
      profile.dispose();
    });
    const profileAtStart = snapshotOf(profile);

    mkdirSync(projectDir);
    const outsideDir = join(profile.root, "outside");
    mkdirSync(outsideDir);
    const tmpDir = join(profile.root, "tmp");
    mkdirSync(tmpDir);
    sandboxes.push(sandboxNameFor(projectDir), sandboxNameFor(outsideDir));
    assert.ok(
      !outsideDir.startsWith(`${inputs.workspaceRoot}${sep}`) && outsideDir !== inputs.workspaceRoot,
      "the isolated profile root must lie outside the pinned workspace root",
    );

    // Everything Omp and the realm CLI run with: the scenario's own configuration home (the plugin and the CLI read the production
    // config from it), the profile's HOME and agent directory (so nothing lands in the operator's profile) and its temporary
    // directory. The scenario environment supplies the runtime and driver variables the daemon the plugin spawns needs.
    const configHome = scenario.cliEnvironment["XDG_CONFIG_HOME"];
    assert.ok(configHome !== undefined, "the scenario environment must name its configuration home");
    // The daemon the plugin spawns inherits HOME. The OpenShell CLI it runs resolves the gateway registration from the account's
    // own HOME, so a profile HOME makes the sandbox stop fail with AGENTOS_STOP_FAILED (measured 2026-11-17). Omp keeps the
    // profile's agent directory (PI_CODING_AGENT_DIR), which is where the shim and everything else Omp stores lands.
    const hostHome = scenario.cliEnvironment["HOME"];
    assert.ok(hostHome !== undefined, "the scenario environment must name the account home");
    const ompEnv: Readonly<Record<string, string>> = { ...scenario.cliEnvironment, ...profile.env, HOME: hostHome, XDG_CONFIG_HOME: configHome, TMPDIR: tmpDir };

    // The transcript of every command, saved as evidence at the end.
    const transcript: string[] = [];
    const note = (text: string): void => {
      transcript.push(text);
      t.diagnostic(text);
    };
    cleanups.add(() => {
      for (const problem of writeEvidence(process.env[EVIDENCE_DIR_VARIABLE], { [`${EVIDENCE_PREFIX}.commands.txt`]: () => transcript.join("\n\n") })) {
        t.diagnostic(problem);
      }
    });
    const recorded = (label: string, result: CommandResult): CommandResult => {
      transcript.push(`$ ${label}\n${describeResult(result)}`);
      return result;
    };

    // `realm <args>` with the profile's environment. The built CLI runs on this test's own node binary.
    const realmHost = async (args: readonly string[]): Promise<CommandResult> =>
      recorded(`realm host ${args.join(" ")}`, await runCommand(process.execPath, [CLI_PATH, "host", ...args], { env: ompEnv, timeoutMs: HOST_TIMEOUT_MS, cwd: profile.workspace }));
    const realmStatus = async (workspace: string): Promise<CommandResult> =>
      recorded(`realm status --workspace ${basename(workspace)}`, await realmCliWithWorkspace(inputs, scenario, ["status"], workspace, 30_000));
    const hostStatus = async (): Promise<Record<string, unknown>> => jsonLineOf(await realmHost(["status", "omp"]), "realm host status omp");
    const liveSessionsOf = (status: Record<string, unknown>): number | undefined => {
      const plugin = status["plugin"];
      const sessions = isRecord(plugin) ? plugin["sessions"] : undefined;
      const count = isRecord(sessions) ? sessions["live"] : undefined;
      return typeof count === "number" ? count : undefined;
    };

    // Starts Omp, registers its teardown (evidence first, then close), and returns the session. Without an extension path the
    // session loads whatever the profile installed.
    const openOmp = (label: string, options: { readonly bin: string; readonly env: Readonly<Record<string, string>>; readonly cwd: string; readonly extensionPath?: string }): OmpSession => {
      const omp =
        options.extensionPath === undefined
          ? startInstalledOmp(options)
          : startOmp({ bin: options.bin, env: options.env, cwd: options.cwd, extensionPath: options.extensionPath });
      cleanups.add(() =>
        closeWithEvidence({
          evidenceDir: process.env[EVIDENCE_DIR_VARIABLE],
          evidence: {
            [`${EVIDENCE_PREFIX}.${label}.frames.jsonl`]: () => omp.frames.map((frame) => JSON.stringify(frame)).join("\n"),
            [`${EVIDENCE_PREFIX}.${label}.stderr.txt`]: () => omp.stderr(),
          },
          report: (problem) => {
            t.diagnostic(problem);
          },
          close: () => omp.close(CLOSE_OPTIONS),
        }),
      );
      return omp;
    };
    const extensionErrorsOf = (omp: OmpSession): string[] =>
      omp.frames.map((frame) => JSON.stringify(frame)).filter((frame) => frame.includes("extension_error"));

    const daemonLog = join(scenario.stateDir, "daemon.log");
    const ompPath = locateExecutable(OMP_BIN, pathValue);
    assert.ok(ompPath !== undefined, `the omp executable ${OMP_BIN} must be found for the no-Node session`);

    // ---- D: no Node, no daemon -------------------------------------------------------------------------------------------------
    // Nothing may answer before the scenario starts: a daemon already running on this state directory would hide what boots it.
    const absentBefore = await realmStatus(projectDir);
    assert.equal(absentBefore.exitCode, 0, `realm status before the scenario: ${describeResult(absentBefore)}`);
    assert.equal(absentBefore.stdout.trim(), "disconnected", `no daemon may answer before the scenario starts: ${describeResult(absentBefore)}`);
    const pidsBefore = await findDaemonPids(inputs, DAEMON_ENTRY);
    assert.ok(pidsBefore.ok, `list the daemon processes: ${describeValue(pidsBefore)}`);

    const noNode = noNodeSession(profile.root, ompPath);
    note(`D: no-Node session, ${noNode.note}`);
    const noNodeOmp = openOmp("no-node", {
      bin: noNode.bin,
      env: { ...ompEnv, PATH: noNode.pathValue },
      cwd: projectDir,
      extensionPath: EXTENSION_PATH,
    });
    await noNodeOmp.ready(OMP_READY_TIMEOUT_MS);
    await noNodeOmp.waitFor(
      (session) => session.status()?.includes("REALM_NOT_ACTIVE") === true,
      NO_NODE_REFUSAL_TIMEOUT_MS,
      "the plugin's REALM_NOT_ACTIVE status without a Node",
    );
    const pidsAfterNoNode = await findDaemonPids(inputs, DAEMON_ENTRY);
    assert.ok(pidsAfterNoNode.ok, `list the daemon processes after the no-Node session: ${describeValue(pidsAfterNoNode)}`);
    const knownPids = new Set(pidsBefore.pids);
    assert.deepEqual(
      pidsAfterNoNode.pids.filter((pid) => !knownPids.has(pid)),
      [],
      "no daemon process may appear when Omp has no Node on its PATH",
    );
    const stillAbsent = await realmStatus(projectDir);
    assert.equal(stillAbsent.stdout.trim(), "disconnected", `no daemon may answer after the no-Node session: ${describeResult(stillAbsent)}`);
    await noNodeOmp.close(CLOSE_OPTIONS);

    // ---- A: install -------------------------------------------------------------------------------------------------------------
    const shimDir = join(profile.agentDir, "extensions", "realm");
    const planned = jsonLineOf(await realmHost(["install", "omp", "--dry-run"]), "realm host install omp --dry-run");
    assert.equal(planned["dryRun"], true, `the dry run must say so: ${describeValue(planned)}`);
    const plannedFiles = actionsOf(planned, "dry run").filter((action) => action["action"] !== "noop");
    assert.equal(plannedFiles.length, 1, `the dry run must name exactly one file: ${describeValue(planned)}`);
    const [plannedFile] = plannedFiles;
    const plannedPath = plannedFile?.["path"];
    assert.ok(typeof plannedPath === "string", `the dry run must name its file: ${describeValue(planned)}`);
    assert.match(plannedPath, /(^|\/)extensions\/realm\/[^/]+$/, `the planned file must lie under extensions/realm/: ${describeValue(planned)}`);
    assert.ok(!existsSync(shimDir), "the dry run must write nothing");

    const profileBeforeInstall = snapshotOf(profile);
    const installed = jsonLineOf(await realmHost(["install", "omp"]), "realm host install omp");
    assert.equal(installed["dryRun"], false, `the install is not a dry run: ${describeValue(installed)}`);
    const writtenFiles = actionsOf(installed, "install").filter((action) => action["action"] !== "noop");
    assert.equal(writtenFiles.length, 1, `the install must name exactly one file: ${describeValue(installed)}`);
    const [writtenFile] = writtenFiles;
    const writtenPath = writtenFile?.["path"];
    assert.ok(typeof writtenPath === "string", `the install must name its file: ${describeValue(installed)}`);
    assert.match(writtenPath, /(^|\/)extensions\/realm\/[^/]+$/, `the installed file must lie under extensions/realm/: ${describeValue(installed)}`);
    assert.ok(existsSync(isAbsolute(writtenPath) ? writtenPath : join(profile.agentDir, writtenPath)), `the shim ${writtenPath} must exist in the isolated agent directory`);
    assert.deepEqual(readdirSync(shimDir), [basename(writtenPath)], "the install must create one file under extensions/realm/ and nothing else");

    const afterInstall = await hostStatus();
    assert.equal(afterInstall["status"], "installed", `realm host status omp must report installed: ${describeValue(afterInstall)}`);
    const plugin = afterInstall["plugin"];
    assert.ok(isRecord(plugin), `realm host status omp must carry a plugin object: ${describeValue(afterInstall)}`);
    assert.equal(plugin["target"], "present", `the shim's target must be present: ${describeValue(plugin)}`);
    assert.equal(liveSessionsOf(afterInstall), 0, `no Omp is running, so no live plugin session: ${describeValue(plugin)}`);
    assert.deepEqual(plugin["conflicts"], [], `no conflicting plugin link: ${describeValue(plugin)}`);

    const pluginList = recorded(
      "omp plugin list --json",
      await runCommand(OMP_BIN, ["plugin", "list", "--json"], { env: ompEnv, timeoutMs: HOST_TIMEOUT_MS, cwd: profile.workspace }),
    );
    assert.notEqual(pluginList.exitCode, undefined, `omp plugin list must run to an exit: ${describeResult(pluginList)}`);
    assert.ok(!pluginList.stdout.includes("agent-realm"), `the shim is not a plugin link, so agent-realm must not be listed: ${describeResult(pluginList)}`);

    // ---- B: boot with no daemon and no realm up ---------------------------------------------------------------------------------
    const bootLogOffset = sizeOf(daemonLog);
    const bootOmp = openOmp("boot", { bin: OMP_BIN, env: ompEnv, cwd: projectDir });
    await bootOmp.ready(OMP_READY_TIMEOUT_MS);
    await bootOmp.waitFor(
      (session) => session.status()?.includes("realm active") === true,
      BOOT_ACTIVE_TIMEOUT_MS,
      "the installed shim's realm active status (the plugin starts the daemon itself)",
    );
    const commandsId = `commands-${suffix}`;
    bootOmp.send({ id: commandsId, type: "get_available_commands" });
    await bootOmp.waitFor(
      (session) => session.frames.some((frame) => frame["type"] === "response" && frame["id"] === commandsId),
      COMMANDS_TIMEOUT_MS,
      "the get_available_commands response",
    );
    const commandsReply = bootOmp.frames.find((frame) => frame["type"] === "response" && frame["id"] === commandsId);
    assert.ok(JSON.stringify(commandsReply).includes("realm-retry"), `realm-retry must be listed: ${JSON.stringify(commandsReply)}`);

    const answering = await pollUntil(
      async () => {
        const status = await realmStatus(projectDir);
        const state = status.exitCode === 0 ? stateOfStatus(status.stdout) : undefined;
        return state === "active" ? { done: true } : { done: false, detail: `realm status: ${describeResult(status)}` };
      },
      { timeoutMs: STATUS_POLL_TIMEOUT_MS, intervalMs: 2_000 },
    );
    assert.ok(answering.ok, `realm status must now answer active for the project Omp opened: ${answering.detail}`);
    const bootLog = existsSync(daemonLog) ? readFileSync(daemonLog).subarray(bootLogOffset).toString("utf8") : "";
    assert.ok(!bootLog.includes("daemon.failed"), "the daemon log must hold no daemon.failed since the boot session started");

    // The plugin writes its presence marker once it has painted; the count is the number of Omp processes that loaded it.
    const oneSession = await pollUntil(
      async () => {
        const count = liveSessionsOf(await hostStatus());
        return count === 1 ? { done: true } : { done: false, detail: `live plugin sessions: ${String(count)}` };
      },
      { timeoutMs: STATUS_POLL_TIMEOUT_MS, intervalMs: 2_000 },
    );
    assert.ok(oneSession.ok, `realm host status omp must count 1 live session while Omp runs: ${oneSession.detail}`);
    assert.deepEqual(extensionErrorsOf(bootOmp), [], "the installed shim must load without an extension_error frame");
    await bootOmp.close(CLOSE_OPTIONS);
    const noSession = await pollUntil(
      async () => {
        const count = liveSessionsOf(await hostStatus());
        return count === 0 ? { done: true } : { done: false, detail: `live plugin sessions: ${String(count)}` };
      },
      { timeoutMs: STATUS_POLL_TIMEOUT_MS, intervalMs: 2_000 },
    );
    assert.ok(noSession.ok, `realm host status omp must count 0 live sessions after Omp closed: ${noSession.detail}`);

    // ---- C: a directory outside every policy root -------------------------------------------------------------------------------
    const outsideOmp = openOmp("outside", { bin: OMP_BIN, env: ompEnv, cwd: outsideDir });
    await outsideOmp.ready(OMP_READY_TIMEOUT_MS);
    await outsideOmp.waitFor(
      (session) => session.status()?.includes("POLICY_DENIED") === true,
      POLICY_REFUSAL_TIMEOUT_MS,
      "the plugin's POLICY_DENIED status outside every policy root",
    );
    assert.deepEqual(extensionErrorsOf(outsideOmp), [], "the refused session must not raise an extension_error frame");
    const outsideSandbox = sandboxNameFor(outsideDir);
    const outsideSandboxes = await listSandboxesNamed(inputs, outsideSandbox);
    assert.ok(outsideSandboxes.ok, `list the sandboxes: ${describeValue(outsideSandboxes)}`);
    assert.deepEqual(outsideSandboxes.items, [], `no sandbox may exist for the directory outside the policy roots (${outsideSandbox})`);
    const outsideContainers = await listSandboxContainers(inputs, outsideSandbox);
    assert.ok(outsideContainers.ok, `list the containers: ${describeValue(outsideContainers)}`);
    assert.deepEqual(outsideContainers.items, [], `no container may exist for the directory outside the policy roots (${outsideSandbox})`);
    await outsideOmp.close(CLOSE_OPTIONS);

    // ---- E: uninstall and teardown ----------------------------------------------------------------------------------------------
    const profileBeforeUninstall = snapshotOf(profile);
    const removed = jsonLineOf(await realmHost(["uninstall", "omp"]), "realm host uninstall omp");
    assert.equal(removed["dryRun"], false, `the uninstall is not a dry run: ${describeValue(removed)}`);
    assert.ok(!existsSync(shimDir), "the shim and the directory the install created must be gone");
    const afterUninstall = snapshotOf(profile);
    const realmDirKey = relative(profile.root, shimDir);
    const extensionsDirKey = relative(profile.root, dirname(shimDir));
    const uninstallProblems = snapshotProblems(
      profileBeforeUninstall,
      afterUninstall,
      (key) => key === realmDirKey || key.startsWith(`${realmDirKey}${sep}`) || (key === extensionsDirKey && !profileBeforeInstall.has(extensionsDirKey)),
    );
    assert.deepEqual(uninstallProblems, [], "the uninstall must remove the shim and change nothing else in the isolated profile");
    const startProblems = snapshotProblems(profileAtStart, afterUninstall, () => false).filter((problem) => !problem.startsWith("added: "));
    assert.deepEqual(startProblems, [], "the files the profile held before any Omp ran must be byte-identical after the uninstall");
    const afterRemoval = await hostStatus();
    assert.notEqual(afterRemoval["status"], "installed", `realm host status omp must no longer report installed: ${describeValue(afterRemoval)}`);

    const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
    assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
    rmSync(projectDir, { recursive: true, force: true });
    const residue = await waitForNoResidue(inputs, sandboxes);
    assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
    for (const sandbox of sandboxes) {
      const containers = await listSandboxContainers(inputs, sandbox);
      assert.ok(containers.ok, `list the containers of ${sandbox} after realm down: ${describeValue(containers)}`);
      assert.deepEqual(containers.items, [], `no container of ${sandbox} may remain after realm down`);
    }
  },
);
