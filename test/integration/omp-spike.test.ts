// The Omp enforcement spike (OMPX-01, HARN-03; decisions D-1204 to D-1206 of phase 12), kept as a permanent, version-stamped
// regression of what Omp does when an extension removes, shadows, blocks or observes its built-in tools.
//
// Each scenario starts a real Omp in RPC UI mode under an isolated profile, loads the test extension
// test/support/omp-spike-extension.ts (not the Realm plugin) and drives it with a scripted OpenAI-compatible provider that emits
// exactly one tool call per prompt. The extension writes what Omp showed it to a JSONL file; the assertions are on that file, on
// the RPC frames Omp printed, on the requests the provider received and on the workspace. They state what was OBSERVED on Omp
// 18.12.6 (D-1206): a newer Omp that behaves differently fails here, which is the point.
//
// Scenarios (S numbers are those of 12-RESEARCH.md section 4):
//   S1/S9/S10  a shadowed write, extension tools, an invalid call against a raw JSON Schema, an absolute path
//   S2a        setActiveTools removing the native tools that write, with and without a shadowed write
//   S2b/S8     the removal across a new session; the user's own shell command
//   S2c/S3     the transports that survive a removal of write, edit and bash, and the nested device event
//   S7         the eval bridge and ast_edit's propose-then-apply
//   S4         tool_call and tool_result hook semantics
//   S5         registerFileWriteFallback on a read-only workspace
//   S6         a subagent session
//   S12        approval prompts
//   S13/S14    a 1 MiB result and SIGKILL in the middle of a tool call
//   S11        the network trace of a cold and a warm profile, and the lever that gives a clean trace
//
// Gate. The whole file skips, with a reason that names the FIRST missing prerequisite, unless REALM_LIVE_OMP=1 and the Omp
// executable, its version and the built extension are present (ompSkipReason). S11 also needs REALM_OMP_NET_TRACE=1 and a strace
// that can trace; S5 needs `unshare -m`. REALM_OMP_EVIDENCE_DIR optionally names a directory that receives each scenario's raw
// log, RPC frames and provider requests. Waits resolve from events; the bounds of D-1203 are failure bounds only.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  closeWithEvidence,
  collectOmpGateInputs,
  createCleanups,
  isRecord,
  OMP_PROMPT_TIMEOUT_MS,
  OMP_READY_TIMEOUT_MS,
  OMP_SCENARIO_TIMEOUT_MS,
  ompBinary,
  ompSkipReason,
  parseOmpVersion,
  writeEvidence,
  within,
} from "../support/omp-live.js";
import { createOmpProfile, type OmpProfile } from "../support/omp-profile.js";
import { scriptedTurnProblem, startOmp, type OmpFrame, type OmpSession, type PromptOutcome, type ToolEnd } from "../support/omp-rpc.js";
import { runCommand } from "../support/production-live.js";
import { externalConnects, OMP_DISCOVERY_PORTS, parseConnects, traceArgv, classify, formatOffenders, type NetAllow } from "../support/net-trace.js";
import { ScriptedProvider, type ProviderTurn, type RecordedRequest, type TurnPlan } from "../support/scripted-provider.js";
import { SPIKE_BIG_BYTES, SPIKE_CONFIG_VARIABLE, type SpikeConfig, type SpikeLogLine } from "../support/omp-spike-extension.js";

// ---- Gate ------------------------------------------------------------------------------------------------------------------

const EVIDENCE_DIR_VARIABLE = "REALM_OMP_EVIDENCE_DIR";
const SPIKE_EXTENSION_PATH = fileURLToPath(new URL("../support/omp-spike-extension.js", import.meta.url));
// S11 starts Omp three times under strace (a cold profile, the same profile warm, a fresh profile behind the proxy); D-1203's 300 s
// bound is for one scenario with one start.
const NETWORK_SCENARIO_TIMEOUT_MS = 1_200_000;
// Omp needs longer than the helper's 5 s stages to shut down on a loaded host, and under strace longer still.
const CLOSE_OPTIONS = { graceMs: 40_000, termMs: 20_000, killMs: 20_000 } as const;
const HOST_PROBE_TIMEOUT_MS = 15_000;
// A call that starts a runtime (eval's JavaScript kernel, bash's shell) can take longer than a plain call on a loaded host: it gets
// the startup bound, and a scenario that makes such calls gets twice the scenario bound. Both are failure bounds only; every wait
// resolves from the frame handler.
const RUNTIME_START_TIMEOUT_MS = OMP_READY_TIMEOUT_MS;
const SLOW_SCENARIO_TIMEOUT_MS = 2 * OMP_SCENARIO_TIMEOUT_MS;

const platform = process.platform;
// The one Omp executable of this file: REALM_OMP_BIN resolved to an absolute path once (against the working directory at gate time),
// or the bare name `omp`. The version probe, every spawn and the strace wrap use it, so they all see the same file.
const OMP_BIN = ompBinary(process.env);

// `omp --version` runs ONCE for the process (collectOmpGateInputs shares one probe per binary, bounded by a base of 60 s times
// REALM_TEST_TIMEOUT_SCALE); the second call below only adds the strace facts, and probes strace only when REALM_OMP_NET_TRACE=1.
const baseInputs = await collectOmpGateInputs(process.env, { platform, trace: false });
const baseGate = ompSkipReason(baseInputs);
const traceGate = baseGate ?? ompSkipReason(await collectOmpGateInputs(process.env, { platform, trace: true }));
const ompVersionText = baseInputs.version.kind === "output" ? (parseOmpVersion(baseInputs.version.stdout)?.text ?? "unknown") : "unknown";

async function unshareGate(): Promise<string | undefined> {
  if (baseGate !== undefined) {
    return baseGate;
  }
  const probe = await runCommand("unshare", ["-m", "true"], { env: { PATH: process.env["PATH"] ?? "" }, timeoutMs: HOST_PROBE_TIMEOUT_MS, cwd: tmpdir() });
  return probe.exitCode === 0 ? undefined : "`unshare -m` cannot create a mount namespace on this host; the read-only workspace of S5 needs it";
}

const mountGate = await unshareGate();
const skip: string | false = baseGate ?? false;

// ---- Scenario harness ------------------------------------------------------------------------------------------------------

type ConfigWithoutLog = Omit<SpikeConfig, "log">;
type OfProfile<T> = T | ((profile: OmpProfile) => T);

interface ScenarioOptions {
  readonly config?: OfProfile<ConfigWithoutLog>;
  // The agent directory's config.yml: Omp's settings.
  readonly settings?: string;
  // Files written into the workspace before Omp starts.
  readonly seed?: Readonly<Record<string, string>>;
  // An argv prefix put before Omp (see StartOmpOptions.wrap).
  readonly wrap?: OfProfile<readonly string[]>;
}

interface PlannedCall {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

function resolveOf<T>(value: OfProfile<T>, profile: OmpProfile): T {
  return typeof value === "function" ? (value as (profile: OmpProfile) => T)(profile) : value;
}

// The temporary directory Omp is given: inside the profile root, so its `local://` scratch files and artifacts go away with it.
function tmpDirOf(profile: OmpProfile): string {
  return join(profile.root, "tmp");
}

function parseLog(text: string): SpikeLogLine[] {
  // Only whole lines count: the extension appends one line per write, but a read can land between two writes.
  const complete = text.slice(0, text.lastIndexOf("\n") + 1);
  const lines: SpikeLogLine[] = [];
  for (const raw of complete.split("\n")) {
    if (raw === "") {
      continue;
    }
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value["seq"] !== "number" || typeof value["ev"] !== "string") {
      throw new Error(`the spike log has a line that is not an event: ${raw}`);
    }
    lines.push(value as SpikeLogLine);
  }
  return lines;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function stringsOf(value: unknown): string[] {
  assert.ok(Array.isArray(value), "expected an array");
  return (value as unknown[]).map((entry) => {
    assert.equal(typeof entry, "string");
    return entry as string;
  });
}

// What the scripted provider answers: one planned tool call per prompt, "done" after a tool result, and a separate script for a
// subagent (its prompt carries the word CHILD, see S6).
class Script {
  readonly plans: PlannedCall[] = [];
  readonly childPlans: PlannedCall[] = [];
  childDone: (() => void) | undefined;

  turn(turn: ProviderTurn): TurnPlan {
    if (turn.userText.includes("CHILD")) {
      const next = this.childPlans.shift();
      if (next !== undefined) {
        return { call: next };
      }
      if (turn.lastRole === "tool") {
        this.childDone?.();
        return { text: "child done" };
      }
      return { text: "child ack" };
    }
    if (turn.lastRole === "tool") {
      return { text: "done" };
    }
    const next = this.plans.shift();
    return next === undefined ? { text: "ack" } : { call: next };
  }
}

class Scenario {
  #calls = 0;
  #rpcCount = 0;

  private constructor(
    readonly name: string,
    readonly provider: ScriptedProvider,
    readonly script: Script,
    readonly profile: OmpProfile,
    readonly omp: OmpSession,
    readonly logPath: string,
  ) {}

  // Starts the provider, the profile and Omp, waits for ready, and registers one teardown on `t`. The teardown runs EVERY step in
  // reverse order, whatever an earlier step threw: Omp is closed (after its evidence is saved, which is reported and never
  // thrown) before its files go and the provider's listener closes.
  static async start(t: TestContext, name: string, options: ScenarioOptions = {}): Promise<Scenario> {
    t.diagnostic(`omp/${ompVersionText}`);
    const cleanups = createCleanups();
    t.after(() => cleanups.run());
    const provider = new ScriptedProvider();
    const script = new Script();
    provider.onTurn((turn) => script.turn(turn));
    const { port } = await provider.start();
    cleanups.add(() => provider.stop());
    const pathValue = process.env["PATH"];
    const profile = createOmpProfile({ providerPort: port, ...(pathValue === undefined ? {} : { path: pathValue }) });
    cleanups.add(() => {
      profile.dispose();
    });
    for (const [file, content] of Object.entries(options.seed ?? {})) {
      writeFileSync(join(profile.workspace, file), content);
    }
    if (options.settings !== undefined) {
      writeFileSync(join(profile.agentDir, "config.yml"), options.settings);
    }
    const logPath = join(profile.root, "spike.jsonl");
    // Created empty here: a subagent session that loads the extension again appends to the same file.
    writeFileSync(logPath, "");
    mkdirSync(tmpDirOf(profile), { recursive: true });
    const config: SpikeConfig = { log: logPath, ...resolveOf(options.config ?? {}, profile) };
    const wrap = options.wrap === undefined ? undefined : resolveOf(options.wrap, profile);
    const omp = startOmp({
      bin: OMP_BIN,
      env: { ...profile.env, TMPDIR: tmpDirOf(profile), [SPIKE_CONFIG_VARIABLE]: JSON.stringify(config) },
      cwd: profile.workspace,
      extensionPath: SPIKE_EXTENSION_PATH,
      ...(wrap === undefined ? {} : { wrap }),
    });
    const scenario = new Scenario(name, provider, script, profile, omp, logPath);
    cleanups.add(() =>
      closeWithEvidence({
        evidenceDir: process.env[EVIDENCE_DIR_VARIABLE],
        evidence: scenario.#evidenceFiles(),
        report: (problem) => {
          t.diagnostic(problem);
        },
        close: () => omp.close(CLOSE_OPTIONS),
      }),
    );
    await omp.ready(OMP_READY_TIMEOUT_MS);
    // `ready` can arrive before the extension's session_start handler (and its setActiveTools) has run: wait for them.
    const removes = config.deactivate !== undefined || config.activeOnly !== undefined;
    await scenario.waitForLog(
      (lines) => lines.some((line) => line.ev === "session_start") && (!removes || lines.some((line) => line.ev === "set_active_tools" || line.ev === "error")),
      OMP_READY_TIMEOUT_MS,
      "the extension's session_start",
    );
    return scenario;
  }

  get requests(): readonly RecordedRequest[] {
    return this.provider.requests;
  }

  // The calls the subagent of S6 makes, one per turn; the promise resolves when its last turn has been answered.
  planChild(calls: readonly PlannedCall[]): Promise<void> {
    this.script.childPlans.push(...calls);
    return new Promise<void>((resolve) => {
      this.script.childDone = resolve;
    });
  }

  // One prompt, one scripted tool call: the provider emits exactly this call, Omp runs it and the prompt settles. `ms` is the failure
  // bound; a call that starts a runtime (eval's kernel, bash's shell) gets the startup bound.
  async callRaw(name: string, args: Readonly<Record<string, unknown>>, ms: number = OMP_PROMPT_TIMEOUT_MS): Promise<PromptOutcome> {
    this.script.plans.push({ name, args });
    this.#calls += 1;
    return this.omp.prompt(`go ${String(this.#calls)}`, ms);
  }

  // callRaw, then the one tool_execution_end of that call.
  async call(name: string, args: Readonly<Record<string, unknown>>, ms: number = OMP_PROMPT_TIMEOUT_MS): Promise<ToolEnd> {
    const outcome = await this.callRaw(name, args, ms);
    const ends = outcome.toolEnds.filter((end) => end.toolName === name);
    assert.equal(ends.length, 1, `${name}: expected one tool_execution_end, got ${JSON.stringify(outcome.toolEnds.map((end) => end.toolName))}`);
    return ends[0] as ToolEnd;
  }

  log(): SpikeLogLine[] {
    return parseLog(readFileSync(this.logPath, "utf8"));
  }

  events(ev: string): SpikeLogLine[] {
    return this.log().filter((line) => line.ev === ev);
  }

  // The tool_call lines of one tool.
  toolCalls(toolName: string): SpikeLogLine[] {
    return this.events("tool_call").filter((line) => line["toolName"] === toolName);
  }

  // The params of every execute of one extension tool.
  executions(tool: string): SpikeLogLine[] {
    return this.events("exec").filter((line) => line["tool"] === tool);
  }

  // Resolves when the log holds what the predicate accepts: the file is watched first and the predicate is then tested, so a line
  // written in between is never missed. The watcher is closed whether the wait succeeds or runs out.
  async waitForLog(predicate: (lines: readonly SpikeLogLine[]) => boolean, ms: number, label: string): Promise<void> {
    const handle: { watcher?: FSWatcher } = {};
    try {
      await within(
        new Promise<void>((resolve) => {
          const check = (): void => {
            if (predicate(this.log())) {
              resolve();
            }
          };
          handle.watcher = watch(this.logPath, check);
          check();
        }),
        ms,
        label,
      );
    } finally {
      handle.watcher?.close();
    }
  }

  inWorkspace(relative: string): boolean {
    return existsSync(join(this.profile.workspace, relative));
  }

  readWorkspace(relative: string): string {
    return readFileSync(join(this.profile.workspace, relative), "utf8");
  }

  workspaceFiles(): string[] {
    return sorted(readdirSync(this.profile.workspace, { recursive: true }).map(String));
  }

  // The frame that answers an RPC command, waited for from the frame handler.
  async rpc(command: Readonly<Record<string, unknown>>): Promise<OmpFrame> {
    this.#rpcCount += 1;
    const id = `rpc${String(this.#rpcCount)}`;
    this.omp.send({ id, ...command });
    const isAnswer = (frame: OmpFrame): boolean => frame["type"] === "response" && frame["id"] === id;
    await this.omp.waitFor((session) => session.frames.some(isAnswer), OMP_PROMPT_TIMEOUT_MS, `the response to ${String(command["type"])}`);
    const answer = this.omp.frames.find(isAnswer);
    assert.ok(answer !== undefined);
    return answer;
  }

  // The evidence files of this scenario, produced on demand (a failure to read one is reported by writeEvidence, not thrown).
  #evidenceFiles(): Record<string, () => string> {
    return {
      [`${this.name}.log.jsonl`]: () => readFileSync(this.logPath, "utf8"),
      [`${this.name}.frames.jsonl`]: () => this.omp.frames.map((frame) => JSON.stringify(frame)).join("\n"),
      [`${this.name}.requests.json`]: () => JSON.stringify(this.requests, null, 1),
    };
  }
}

// The names of the tools the last provider request offered.
function offeredToolsOf(scenario: Scenario): string[] {
  const last = scenario.requests.at(-1);
  assert.ok(last !== undefined, "the provider received no request");
  return sorted(last.toolsOffered);
}

// The built-in tools the removal rule of the spike takes out: everything that writes a file or runs a command on the host.
const MUTATING_NATIVES = ["write", "edit", "bash", "eval", "ast_edit", "lsp", "debug", "task"] as const;
// What Omp 18.12.6 leaves active after that removal.
const SURVIVORS = ["ask", "glob", "grep", "read", "todo", "wait", "web_search"] as const;

function sessionStartOf(scenario: Scenario): SpikeLogLine {
  const lines = scenario.events("session_start");
  const first = lines[0];
  assert.ok(first !== undefined, "no session_start line");
  return first;
}

function assertNotFound(end: ToolEnd, name: string): void {
  assert.equal(end.isError, true, `${name} must fail`);
  assert.equal(end.text, `Tool ${name} not found`);
}

// ---- S1, S9, S10 -----------------------------------------------------------------------------------------------------------

void test("S1 S9 S10: an extension tool named write replaces the built-in; extension tools run; an invalid call against a raw JSON Schema fails before execute", { skip, timeout: OMP_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s1-shadow", { config: { shadowWrite: true, tools: ["exec", "status", "list"] } });

  const start = sessionStartOf(scenario);
  const all = stringsOf(start["all"]);
  assert.ok(all.includes("write:extension"), `getAllTools lists write:extension: ${all.join(",")}`);
  assert.ok(!all.includes("write:builtin"), "the built-in write is gone from getAllTools");
  for (const name of ["exec", "status", "list"]) {
    assert.ok(all.includes(`${name}:extension`), `${name} is registered`);
    assert.ok(stringsOf(start["active"]).includes(name), `${name} is active`);
  }

  // S1: the model's write reaches the extension's execute; nothing is written; the hook still fires around it.
  const shadow = await scenario.call("write", { path: "a.txt", content: "X" });
  assert.equal(shadow.isError, false);
  assert.equal(shadow.text, "SPIKE-SHADOW-WRITE a.txt");
  assert.equal(scenario.inWorkspace("a.txt"), false, "the shadowed write wrote no file");
  const executions = scenario.executions("write");
  assert.equal(executions.length, 1);
  assert.deepEqual(executions[0]?.["params"], { path: "a.txt", content: "X" });
  assert.equal(executions[0]["invokeTool"], "function", "a tool that replaces a built-in receives ctx.invokeTool");
  assert.equal(scenario.toolCalls("write").length, 1, "tool_call fired for the shadowed write");
  assert.equal(scenario.events("tool_result").filter((line) => line["toolName"] === "write").length, 1, "tool_result fired for the shadowed write");

  // S10: an absolute path reaches execute unchanged; Omp does not relativise it.
  const absolute = join(scenario.profile.workspace, "abs.txt");
  const absoluteEnd = await scenario.call("write", { path: absolute, content: "Y" });
  assert.equal(absoluteEnd.text, `SPIKE-SHADOW-WRITE ${absolute}`);
  assert.equal((scenario.executions("write").at(-1)?.["params"] as { path?: unknown } | undefined)?.path, absolute);

  // S1b: tools registered under their own names run, and a net-new name gets no ctx.invokeTool.
  const exec = await scenario.call("exec", { argv: ["echo", "hi"] });
  assert.equal(exec.isError, false);
  assert.equal(exec.text, 'SPIKE-EXEC {"argv":["echo","hi"]}');
  assert.equal(scenario.executions("exec")[0]?.["invokeTool"], "undefined");
  const status = await scenario.call("status", {});
  assert.equal(status.isError, false);
  assert.equal(status.text, "SPIKE-STATUS {}");
  const list = await scenario.call("list", { path: ".", depth: 1 });
  assert.equal(list.isError, false);
  assert.equal(list.text, 'SPIKE-LIST {"path":".","depth":1}');

  // S9: the raw JSON Schema is enforced by Omp: the call fails with a validation error and execute never runs.
  const invalid = await scenario.call("list", { path: "/abs" });
  assert.equal(invalid.isError, true);
  assert.match(invalid.text, /^Validation failed for tool "list":/);
  assert.match(invalid.text, /depth: is required/);
  assert.equal(scenario.executions("list").length, 1, "execute ran for the valid call only");

  // The transport is gone: with write shadowed nothing is mounted under xd://.
  const devices = await scenario.call("read", { path: "xd://" });
  assert.match(devices.text, /^xd:\/\/ 0 mounted tool devices\./);

  // The natives that were not shadowed still work: bash writes a file (the control for the removals of S2a).
  const bash = await scenario.call("bash", { command: "echo CONTROL > bash-control.txt" }, RUNTIME_START_TIMEOUT_MS);
  assert.equal(bash.isError, false, bash.text);
  assert.equal(scenario.readWorkspace("bash-control.txt"), "CONTROL\n");
  const offered = offeredToolsOf(scenario);
  for (const name of ["write", "exec", "status", "list", "bash"]) {
    assert.ok(offered.includes(name), `the provider was offered ${name}: ${offered.join(",")}`);
  }
});

// ---- S2a -------------------------------------------------------------------------------------------------------------------

void test("S2a: setActiveTools without write, edit, bash, eval, ast_edit, lsp, debug and task refuses every one of them, through the xd:// transport too", { skip, timeout: OMP_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s2a-denylist", { config: { deactivate: MUTATING_NATIVES }, seed: { "seed.txt": "hello\n" } });

  const start = sessionStartOf(scenario);
  assert.deepEqual(sorted(stringsOf(start["active"])), sorted(["read", "bash", "edit", "ask", "eval", "glob", "grep", "task", "wait", "todo", "web_search", "write", "ast_edit", "debug", "lsp"]), "the active set before the removal");
  const afterRemoval = scenario.events("set_active_tools")[0];
  assert.deepEqual(sorted(stringsOf(afterRemoval?.["active"])), SURVIVORS, "getActiveTools() after setActiveTools");

  // Each removed tool is refused by Omp before anything runs: the same text for every name, even for a valid-looking call.
  const refused: readonly PlannedCall[] = [
    { name: "write", args: { path: "a.txt", content: "X" } },
    { name: "bash", args: { command: "echo X > b.txt" } },
    { name: "edit", args: { input: "[a.txt#0000]\nREM" } },
    { name: "eval", args: { language: "js", code: "await Bun.write('e.txt','X')" } },
    { name: "ast_edit", args: { ops: [{ pat: "x", out: "y" }], paths: ["."] } },
    { name: "lsp", args: { action: "diagnostics", file: "*" } },
    { name: "debug", args: { action: "launch", program: "/bin/true" } },
    { name: "task", args: { context: "c", tasks: [{ task: "t", solutionSpace: "s" }] } },
    // The device transport: write is removed too, so every xd:// path is refused as a write.
    { name: "write", args: { path: "xd://ast_edit", content: "{}" } },
    { name: "write", args: { path: "xd://eval", content: "{}" } },
    { name: "write", args: { path: "local://scratch.txt", content: "hello" } },
  ];
  for (const call of refused) {
    assertNotFound(await scenario.call(call.name, call.args), call.name);
  }
  assert.deepEqual(scenario.workspaceFiles(), ["seed.txt"], "no call created or changed a file in the workspace");
  assert.equal(scenario.readWorkspace("seed.txt"), "hello\n");

  // What is left still works, and nothing is mounted under xd://.
  const devices = await scenario.call("read", { path: "xd://" });
  assert.match(devices.text, /^xd:\/\/ 0 mounted tool devices\./);
  const seed = await scenario.call("read", { path: "seed.txt" });
  assert.equal(seed.isError, false);
  assert.match(seed.text, /1:hello/);

  // The hook never saw a removed tool: only the two read calls reached tool_call.
  assert.deepEqual([...new Set(scenario.events("tool_call").map((line) => line["toolName"]))], ["read"]);
  assert.deepEqual(offeredToolsOf(scenario), SURVIVORS, "the provider's tool list is the active set");
});

void test("S2a (shadow): with write shadowed by an extension tool and the other mutating natives removed, only the extension tools can reach a file", { skip, timeout: OMP_SCENARIO_TIMEOUT_MS }, async (t) => {
  const removed = MUTATING_NATIVES.filter((name) => name !== "write");
  const scenario = await Scenario.start(t, "s2a-shadow", { config: { shadowWrite: true, tools: ["exec", "status", "list"], deactivate: removed } });

  const afterRemoval = scenario.events("set_active_tools")[0];
  assert.deepEqual(sorted(stringsOf(afterRemoval?.["active"])), sorted([...SURVIVORS, "write", "exec", "status", "list"]), "getActiveTools() after setActiveTools");

  for (const name of removed) {
    const args = name === "bash" ? { command: "echo X > b.txt" } : {};
    assertNotFound(await scenario.call(name, args), name);
  }
  // write is the extension's tool now: a device path is just a string for it, and nothing is mounted.
  const device = await scenario.call("write", { path: "xd://ast_edit", content: "{}" });
  assert.equal(device.text, "SPIKE-SHADOW-WRITE xd://ast_edit");
  const devices = await scenario.call("read", { path: "xd://" });
  assert.match(devices.text, /^xd:\/\/ 0 mounted tool devices\./);
  assert.deepEqual(scenario.workspaceFiles(), [], "nothing was written");
  assert.deepEqual(offeredToolsOf(scenario), sorted([...SURVIVORS, "write", "exec", "status", "list"]));
});

// ---- S2b, S8 ---------------------------------------------------------------------------------------------------------------

void test("S2b S8: a removal survives a new session without a second session_start; the user's own shell command bypasses both the removal and the hook", { skip, timeout: OMP_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s2b-lifecycle", { config: { deactivate: ["bash", "edit"] } });
  assertNotFound(await scenario.call("bash", { command: "echo X > b1.txt" }), "bash");
  const firstSession = scenario.events("session_start")[0]?.["sessionId"];

  // S8: the RPC `bash` command is the user's shell, not a model tool.
  const shell = await scenario.rpc({ type: "bash", command: "echo USER > user.txt" });
  assert.equal(shell["success"], true);
  assert.equal((shell["data"] as { exitCode?: unknown } | undefined)?.exitCode, 0);
  assert.equal(scenario.readWorkspace("user.txt"), "USER\n", "the user's command ran although bash is removed");
  assert.equal(scenario.toolCalls("bash").length, 0, "the hook saw neither the refused model call nor the user's command");

  // S2b: a new session.
  const created = await scenario.rpc({ type: "new_session" });
  assert.equal(created["success"], true);
  assert.deepEqual((created["data"] as { cancelled?: unknown } | undefined)?.cancelled, false);
  assert.equal(scenario.events("session_start").length, 1, "session_start does not fire again for a new session");
  const switched = scenario.events("session_switch");
  assert.equal(switched.length, 1, "session_switch fires once");
  assert.notEqual(switched[0]?.["sessionId"], firstSession, "the new session has its own id");
  assert.deepEqual(sorted(stringsOf(switched[0]?.["active"])), sorted(["read", "ask", "eval", "glob", "grep", "task", "wait", "todo", "web_search", "write", "ast_edit", "debug", "lsp"]), "the removal persists");
  assertNotFound(await scenario.call("bash", { command: "echo X > b2.txt" }), "bash");
  assert.equal(scenario.inWorkspace("b1.txt") || scenario.inWorkspace("b2.txt"), false);
});

// ---- S2c, S3 ---------------------------------------------------------------------------------------------------------------

void test("S2c S3: after write, edit and bash are removed, write stays as the xd:// device transport; a nested device call emits its own tool_call; eval still writes files", { skip, timeout: SLOW_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s2c-transports", {
    config: { deactivate: ["write", "edit", "bash"], onToolCall: [{ tool: "ast_edit", mode: "block", reason: "SPIKE-BLOCK-AST" }] },
    seed: { "a.ts": "foo(1);\nfoo(2);\n" },
  });
  const afterRemoval = scenario.events("set_active_tools")[0];
  const active = stringsOf(afterRemoval?.["active"]);
  assert.ok(!active.includes("bash") && !active.includes("edit"), "bash and edit are removed");
  assert.ok(active.includes("write"), "write is still active after setActiveTools removed it");

  assertNotFound(await scenario.call("bash", { command: "echo X > b.txt" }), "bash");
  const refusal = await scenario.call("write", { path: "a.txt", content: "X" });
  assert.equal(refusal.isError, true);
  assert.match(refusal.text, /limited to the xd:\/\/ device transport and local:\/\/ session scratch/);
  assert.equal(scenario.inWorkspace("a.txt"), false);

  // The devices that stay mountable are exactly the tools that rewrite files or run code.
  const devices = await scenario.call("read", { path: "xd://" });
  assert.match(devices.text, /^xd:\/\/ 3 mounted tool devices\./);
  for (const device of ["ast_edit", "debug", "lsp"]) {
    assert.match(devices.text, new RegExp(`xd://${device}\\s`));
  }

  // S3: a valid nested call emits a tool_call for the outer write and then one for the inner ast_edit, with the same id; blocking
  // the inner tool blocks the call, while the outer write is only seen.
  const nested = await scenario.call("write", { path: "xd://ast_edit", content: JSON.stringify({ ops: [{ pat: "foo($$$A)", out: "bar($$$A)" }], paths: ["a.ts"] }) });
  assert.equal(nested.isError, true);
  assert.equal(nested.text, "SPIKE-BLOCK-AST");
  const calls = scenario.events("tool_call").filter((line) => line["toolName"] === "write" || line["toolName"] === "ast_edit");
  const outer = calls.filter((line) => line["toolName"] === "write").at(-1);
  const inner = calls.filter((line) => line["toolName"] === "ast_edit").at(-1);
  assert.ok(outer !== undefined && inner !== undefined, "both tool_call events fired");
  assert.ok(outer.seq < inner.seq, "the outer call comes first");
  assert.equal(inner["toolCallId"], outer["toolCallId"]);
  assert.deepEqual((inner["input"] as { paths?: unknown } | undefined)?.paths, ["a.ts"]);
  assert.equal(scenario.events("tool_result").filter((line) => line["toolName"] === "ast_edit").length, 0, "the blocked inner call has no tool_result");
  assert.equal(scenario.readWorkspace("a.ts"), "foo(1);\nfoo(2);\n");

  // local:// is a native write path outside the workspace and the realm.
  const scratch = await scenario.call("write", { path: "local://scratch.txt", content: "hello" });
  assert.equal(scratch.isError, false);
  assert.match(scratch.text, /Successfully wrote 5 bytes to local:\/\/scratch\.txt/);
  // The scratch file is under the session's own directory in the temporary directory, outside the workspace.
  const sessionId = String(scenario.events("session_start")[0]?.["sessionId"]);
  assert.equal(readFileSync(join(tmpDirOf(scenario.profile), "omp-local", sessionId, "scratch.txt"), "utf8"), "hello");

  // eval is not removed here, and it writes a file natively.
  const evalEnd = await scenario.call("eval", { language: "js", code: "await Bun.write('e.txt','X'); return 1" }, RUNTIME_START_TIMEOUT_MS);
  assert.equal(evalEnd.isError, false, evalEnd.text);
  assert.equal(scenario.readWorkspace("e.txt"), "X");
  assert.deepEqual(scenario.workspaceFiles(), ["a.ts", "e.txt"], "the local:// write left no file in the workspace");
});

// ---- S7 --------------------------------------------------------------------------------------------------------------------

void test("S7: the eval bridge emits tool_call for a nested session tool, but eval itself writes files unhooked; ast_edit stages a proposal and xd://resolve applies it", { skip, timeout: SLOW_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s7-eval", {
    config: { onToolCall: [{ tool: "bash", mode: "block", reason: "SPIKE-BLOCK-BASH" }] },
    seed: { "a.ts": "foo(1);\nfoo(2);\n" },
  });

  const direct = await scenario.call("bash", { command: "echo X > direct.txt" });
  assert.equal(direct.isError, true);
  assert.equal(direct.text, "SPIKE-BLOCK-BASH");
  assert.equal(scenario.inWorkspace("direct.txt"), false);

  // eval writes a file with the runtime's own API: no hook on bash can see it.
  const written = await scenario.call("eval", { language: "js", code: "await Bun.write('e.txt','X'); return 1" }, RUNTIME_START_TIMEOUT_MS);
  assert.equal(written.isError, false, written.text);
  assert.equal(written.text, "1");
  assert.equal(scenario.readWorkspace("e.txt"), "X");
  assert.equal(scenario.toolCalls("eval").length, 1, "one tool_call for the eval that wrote a file");

  // The bridge call tool.bash(...) emits its own tool_call, with a js-bash id, and the block holds.
  const bridged = await scenario.call("eval", { language: "js", code: "return await tool.bash({command:'echo X > viaeval.txt'})" }, RUNTIME_START_TIMEOUT_MS);
  assert.equal(bridged.isError, true);
  assert.match(bridged.text, /SPIKE-BLOCK-BASH/);
  const bridgeCall = scenario.toolCalls("bash").find((line) => String(line["toolCallId"]).startsWith("js-bash-"));
  assert.ok(bridgeCall !== undefined, "the bridge call reached the tool_call hook");
  assert.deepEqual(bridgeCall["input"], { command: "echo X > viaeval.txt" });
  assert.equal(scenario.inWorkspace("viaeval.txt"), false);

  // ast_edit through the device transport is a proposal; the file changes only when xd://resolve is written.
  const proposal = await scenario.call("write", { path: "xd://ast_edit", content: JSON.stringify({ ops: [{ pat: "foo($$$A)", out: "bar($$$A)" }], paths: ["a.ts"] }) });
  assert.equal(proposal.isError, false, proposal.text);
  assert.match(proposal.text, /^Staged as a proposal — files NOT modified yet\./);
  assert.equal(scenario.readWorkspace("a.ts"), "foo(1);\nfoo(2);\n");
  assert.equal(scenario.toolCalls("ast_edit").length, 1, "the nested ast_edit call reached the hook");
  const applied = await scenario.call("write", { path: "xd://resolve", content: "apply the codemod" });
  assert.equal(applied.isError, false, applied.text);
  assert.match(applied.text, /^Applied 2 replacements in 1 file\./);
  assert.equal(scenario.readWorkspace("a.ts"), "bar(1);\nbar(2);\n");
  assert.equal(scenario.toolCalls("resolve").length, 0, "resolve is not a tool: only the outer write reached the hook");
});

// ---- S4 --------------------------------------------------------------------------------------------------------------------

void test("S4: a tool_call block, rewrite, throw or timeout stops or changes the call; a tool_result can replace the result; an error result and a throw both reach the model as errors", { skip, timeout: OMP_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s4-hooks", {
    config: {
      shadowWrite: true,
      tools: ["exec", "status", "list", "fail"],
      onToolCall: [
        { tool: "exec", mode: "block", reason: "SPIKE-BLOCK" },
        { tool: "status", mode: "rewrite", input: { argv: ["rewritten"] } },
        { tool: "list", mode: "throw", reason: "SPIKE-THROW" },
        { tool: "write", mode: "hang" },
      ],
      onToolResult: [{ tool: "status", text: "MODIFIED", isError: true }],
    },
    // The hang rule is ended by Omp's own budget; the profile shortens it from 30 s.
    settings: "extensionHandlers:\n  toolCallTimeoutMs: 3000\n",
  });

  // block: the reason is the result text, execute never runs, and no tool_result event is emitted.
  const blocked = await scenario.call("exec", { argv: ["a"] });
  assert.equal(blocked.isError, true);
  assert.equal(blocked.text, "SPIKE-BLOCK");
  assert.equal(scenario.executions("exec").length, 0);
  assert.equal(scenario.events("tool_result").filter((line) => line["toolName"] === "exec").length, 0);
  assert.ok(scenario.requests.some((request) => request.toolResultText === "SPIKE-BLOCK"), "the model's next request carries the reason");

  // rewrite and result replacement: execute receives the rewritten input; the tool_result event shows the result before its own
  // replacement; the wire carries the replacement.
  const rewritten = await scenario.call("status", { argv: ["orig"] });
  assert.deepEqual(scenario.toolCalls("status")[0]?.["input"], { argv: ["orig"] }, "tool_call saw the original input");
  assert.deepEqual(scenario.executions("status")[0]?.["params"], { argv: ["rewritten"] });
  const statusResult = scenario.events("tool_result").find((line) => line["toolName"] === "status");
  assert.equal(statusResult?.["isError"], false);
  assert.equal(statusResult["text"], 'SPIKE-STATUS {"argv":["rewritten"]}');
  assert.equal(rewritten.isError, true);
  assert.equal(rewritten.text, "MODIFIED");
  assert.ok(scenario.requests.some((request) => request.toolResultText === "MODIFIED"));

  // throw: the call is blocked fail-closed and execute never runs.
  const thrown = await scenario.call("list", { path: "x", depth: 1 });
  assert.equal(thrown.isError, true);
  assert.match(thrown.text, /^Extension .+ failed: SPIKE-THROW$/);
  assert.equal(scenario.executions("list").length, 0);

  // hang: Omp's tool_call budget (3000 ms here) blocks the call; execute never runs.
  const hung = await scenario.call("write", { path: "h.txt", content: "X" });
  assert.equal(hung.isError, true);
  assert.match(hung.text, /^Extension .+ timed out after 3000ms$/);
  assert.equal(scenario.executions("write").length, 0);

  // execute: an error result and a thrown error both become tool errors.
  const failed = await scenario.call("fail", {});
  assert.equal(failed.isError, true);
  assert.equal(failed.text, "SPIKE-ERROR-RESULT");
  const failedThrow = await scenario.call("fail", { throw: true });
  assert.equal(failedThrow.isError, true);
  assert.equal(failedThrow.text, "SPIKE-THROWN");
  assert.deepEqual(scenario.workspaceFiles(), []);
});

// ---- S5 --------------------------------------------------------------------------------------------------------------------

// A mount namespace of its own in which the workspace is read-only, then Omp with that workspace as its cwd.
const READ_ONLY_WRAP = ["unshare", "-m", "sh", "-c", 'ws="$0"; mount --bind "$ws" "$ws" && mount -o remount,bind,ro "$ws" && cd "$ws" && exec "$@"'] as const;

void test("S5: registerFileWriteFallback runs only after a native write fails with EROFS, and its true makes Omp report success for bytes that went elsewhere", { skip: mountGate ?? false, timeout: OMP_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s5-fallback", {
    config: (profile) => ({ fallbackTarget: join(profile.root, "brokered.txt") }),
    wrap: (profile) => [...READ_ONLY_WRAP, profile.workspace],
  });

  // The control: a write to a writable path does not reach the fallback.
  const writable = join(scenario.profile.home, "ok.txt");
  const control = await scenario.call("write", { path: writable, content: "FINE" });
  assert.equal(control.isError, false, control.text);
  assert.equal(readFileSync(writable, "utf8"), "FINE");
  assert.equal(scenario.events("fallback").length, 0, "the fallback did not run for a write that succeeded");

  const denied = await scenario.call("write", { path: "ro.txt", content: "FALLBACK-BYTES" });
  assert.equal(denied.isError, false, denied.text);
  assert.match(denied.text, /Successfully wrote 14 bytes to ro\.txt/);
  const fallbacks = scenario.events("fallback");
  assert.equal(fallbacks.length, 1);
  assert.equal(fallbacks[0]?.["dst"], join(scenario.profile.workspace, "ro.txt"));
  assert.equal(fallbacks[0]["content"], "FALLBACK-BYTES");
  assert.equal(fallbacks[0]["cause"], "EROFS");
  assert.equal(fallbacks[0]["hasSessionId"], true);
  assert.equal(readFileSync(join(scenario.profile.root, "brokered.txt"), "utf8"), "FALLBACK-BYTES");
  assert.equal(scenario.inWorkspace("ro.txt"), false, "the bytes went to the handler's file, not to the path Omp reported");
});

// ---- S6 --------------------------------------------------------------------------------------------------------------------

void test("S6: a subagent session loads the extension again, sets its own active tools and meets the tool_call hook", { skip, timeout: OMP_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s6-subagent", {
    config: { deactivate: ["bash"], onToolCall: [{ tool: "write", mode: "block", reason: "SPIKE-BLOCK-WRITE" }] },
  });
  const finished = scenario.planChild([
    { name: "bash", args: { command: "echo CHILD > child.txt" } },
    { name: "write", args: { path: "child.txt", content: "C" } },
  ]);
  const spawned = await scenario.call("task", { context: "CHILD context", tasks: [{ task: "CHILD create child.txt", solutionSpace: "one fix: trivial" }] });
  assert.equal(spawned.isError, false, spawned.text);
  assert.match(spawned.text, /^Spawned agent `\w+` \(job `\w+`\)\.$/);
  await within(finished, OMP_READY_TIMEOUT_MS, "the subagent's last turn");

  const starts = scenario.events("session_start");
  assert.equal(starts.length, 2, "the subagent session ran session_start again");
  const [parent, child] = starts;
  assert.notEqual(parent?.["sessionId"], child?.["sessionId"]);
  assert.equal(parent?.["pid"], child?.["pid"], "the subagent runs inside the same Omp process");
  assert.equal(scenario.events("load").length, 2, "the extension was loaded for the subagent session too");
  // The child's own setActiveTools removed bash from its own set, and its requests did not offer bash.
  const removals = scenario.events("set_active_tools");
  assert.equal(removals.length, 2, "setActiveTools ran once per session");
  assert.ok(removals.every((line) => !stringsOf(line["active"]).includes("bash")));
  const childRequests = scenario.requests.filter((request) => request.userText.includes("CHILD"));
  assert.ok(childRequests.length >= 3, "the subagent made its own provider requests");
  for (const request of childRequests) {
    assert.ok(!request.toolsOffered.includes("bash"), `the subagent was not offered bash: ${request.toolsOffered.join(",")}`);
  }
  assert.ok(childRequests.some((request) => request.toolResultText === "Tool bash not found"), "bash is refused in the subagent");
  assert.ok(childRequests.some((request) => request.toolResultText === "SPIKE-BLOCK-WRITE"), "the subagent's write met the tool_call block");
  const childWrite = scenario.toolCalls("write").find((line) => line["sessionId"] === child?.["sessionId"]);
  assert.ok(childWrite !== undefined, "tool_call fired in the subagent's session");
  assert.equal(scenario.inWorkspace("child.txt"), false);
});

// ---- S12 -------------------------------------------------------------------------------------------------------------------

void test("S12: in always-ask mode a tool without a declared tier or with the exec tier prompts, the read tier does not, and tool_call runs before the prompt", { skip, timeout: OMP_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s12-approval", {
    config: { tools: ["exec", "status", "list"] },
    settings: "tools:\n  approvalMode: always-ask\n",
    seed: { "a.txt": "hello\n" },
  });

  const read = await scenario.call("list", { path: ".", depth: 1 });
  assert.equal(read.isError, false);
  assert.equal(scenario.omp.dialogs().length, 0, "a tool declared approval:read prompted nothing");
  // The harness answers a select dialog with a cancel, which Omp treats as a denial.
  const undeclared = await scenario.call("status", {});
  assert.equal(undeclared.isError, true);
  assert.equal(undeclared.text, "Tool call denied by user: status");
  const exec = await scenario.call("exec", { argv: ["x"] });
  assert.equal(exec.isError, true);
  assert.equal(exec.text, "Tool call denied by user: exec");
  const native = await scenario.call("read", { path: "a.txt" });
  assert.equal(native.isError, false);

  const dialogs = scenario.omp.dialogs();
  assert.deepEqual(
    dialogs.map((dialog) => [dialog["method"], dialog["title"], dialog["options"]]),
    [
      ["select", "Allow tool: status", ["Approve", "Approve status for this session", "Deny"]],
      ["select", "Allow tool: exec", ["Approve", "Approve exec for this session", "Deny"]],
    ],
  );
  const requested = scenario.events("tool_approval_requested");
  assert.deepEqual(requested.map((line) => [line["toolName"], line["approvalMode"]]), [["status", "always-ask"], ["exec", "always-ask"]]);
  const callSeq = scenario.toolCalls("status")[0]?.seq ?? Number.POSITIVE_INFINITY;
  assert.ok(callSeq < (requested[0]?.seq ?? 0), "tool_call fired before the approval prompt");
  assert.equal(scenario.executions("status").length + scenario.executions("exec").length, 0, "a denied tool did not run");
});

// ---- S13, S14 --------------------------------------------------------------------------------------------------------------

void test("S13 S14: a 1 MiB result is truncated in the middle before the hook sees it; SIGKILL in the middle of a tool call ends Omp with the call unfinished", { skip, timeout: OMP_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = await Scenario.start(t, "s13-s14", { config: { tools: ["big", "hold"] } });

  const big = await scenario.call("big", {});
  assert.equal(big.isError, false);
  const details = (big.frame["result"] as { details?: { bytes?: unknown; meta?: { truncation?: Record<string, unknown> } } } | undefined)?.details;
  assert.equal(details?.bytes, SPIKE_BIG_BYTES, "the tool's own details survive");
  const truncation = details.meta?.truncation;
  assert.ok(truncation !== undefined, "Omp attaches truncation metadata");
  assert.equal(truncation["direction"], "middle");
  assert.equal(truncation["totalBytes"], SPIKE_BIG_BYTES);
  assert.equal(truncation["maxBytes"], 40_960);
  assert.equal(truncation["elidedBytes"], SPIKE_BIG_BYTES - 40_960);
  assert.ok(big.text.length < 50_000, `the visible text is ${String(big.text.length)} characters, not 1 MiB`);
  const seen = scenario.events("tool_result").find((line) => line["toolName"] === "big");
  assert.equal(seen?.["textLength"], big.text.length, "tool_result sees the truncated text");
  const forwarded = scenario.requests.find((request) => request.toolResultText?.startsWith("BBBB") === true);
  assert.equal(forwarded?.toolResultText?.length, big.text.length, "the model's next request carries the same truncated text");

  // S14: the call is in flight (execute has started and never settles) when the process is killed.
  scenario.script.plans.push({ name: "hold", args: {} });
  scenario.omp.send({ id: "kill-prompt", type: "prompt", message: "go hold" });
  await scenario.omp.waitFor((session) => session.toolStarts().some((start) => start.toolName === "hold"), OMP_PROMPT_TIMEOUT_MS, "the hold call to start");
  await scenario.waitForLog((lines) => lines.some((line) => line.ev === "exec" && line["tool"] === "hold"), OMP_PROMPT_TIMEOUT_MS, "execute of hold to start");
  assert.equal(scenario.omp.signal("SIGKILL"), true);
  const exit = await scenario.omp.exited;
  assert.equal(exit.signal, "SIGKILL");
  assert.equal(scenario.omp.toolEnds().filter((end) => end.toolName === "hold").length, 0, "the killed call never finished");
  assert.equal(scenario.events("tool_result").filter((line) => line["toolName"] === "hold").length, 0);
  assert.equal(scenario.events("session_shutdown").length, 0, "no shutdown handler ran");
});

// ---- S11 -------------------------------------------------------------------------------------------------------------------
//
// The levers of D-1205, in the order the spike tried them (Omp 18.12.6; the measurements are summarised in docs/integration/omp.md):
//   1. a setting that disables the catalog refresh and provider discovery: none exists as one switch. The `disabledProviders` setting
//      with every provider id of the installed catalog (89 ids) gave a clean cold trace, but the list is Omp-internal and grows with
//      each version, so it is not asserted here.
//   2. a registry that exposes only the stub: the profile's models.yml already does, and the cold trace is not clean; the
//      `enabledProviders: [stub]` setting changed nothing (46 external connects, as with no setting).
//   3. a warm profile seeded by an earlier run: works (asserted below), but the warm-up run itself goes to the internet.
//   4. an empty network namespace: the external connects disappear, the name lookups (28 DNS connects) remain, and the stub in the
//      test process is unreachable from inside, so no scripted turn can run. Not usable with an in-process provider.
// The lever this test asserts besides the warm profile is the proxy: HTTP(S)_PROXY pointing at a refusing loopback proxy.

// A loopback HTTP proxy that refuses every request and records the first line of each (`CONNECT host:443 HTTP/1.1`). It is the
// lever that gives a cold profile a clean trace: Omp's outbound requests go to it, so the only connect they make is to loopback.
class RefusingProxy {
  readonly requests: string[] = [];
  readonly #sockets = new Set<Socket>();
  readonly #server: Server;

  constructor() {
    this.#server = createServer((socket) => {
      this.#sockets.add(socket);
      socket.on("close", () => {
        this.#sockets.delete(socket);
      });
      socket.on("error", () => {
        socket.destroy();
      });
      socket.once("data", (chunk: Buffer) => {
        this.requests.push(chunk.toString("latin1").split("\r\n")[0] ?? "");
        socket.end("HTTP/1.1 403 Forbidden\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
      });
    });
  }

  async start(): Promise<number> {
    await within(
      new Promise<void>((resolve) => {
        this.#server.listen(0, "127.0.0.1", resolve);
      }),
      HOST_PROBE_TIMEOUT_MS,
      "proxy listen",
    );
    const address = this.#server.address();
    assert.ok(address !== null && typeof address === "object");
    return address.port;
  }

  async stop(): Promise<void> {
    for (const socket of this.#sockets) {
      socket.destroy();
    }
    await within(
      new Promise<void>((resolve) => {
        this.#server.close(() => {
          resolve();
        });
      }),
      HOST_PROBE_TIMEOUT_MS,
      "proxy close",
    );
  }
}

interface TraceSummary {
  readonly offenders: ReturnType<typeof externalConnects>;
  readonly external: number;
  readonly dns: number;
  readonly loopbackPorts: number[];
}

function summarise(trace: string, allow: NetAllow): TraceSummary {
  const connects = parseConnects(trace);
  return {
    offenders: externalConnects(trace, allow),
    external: connects.filter((connect) => classify(connect) === "external").length,
    dns: connects.filter((connect) => classify(connect) === "dns").length,
    loopbackPorts: [...new Set(connects.filter((connect) => classify(connect) === "loopback").map((connect) => connect.port ?? 0))].sort((a, b) => a - b),
  };
}

// One Omp start under strace over `profile`, one scripted turn (a text answer), a clean close; returns the trace. The trace counts
// as evidence only when the turn is proven: the provider received the prompt and answered it, and Omp ended the turn without an
// error. A turn that failed (a model error also has no tool results) would otherwise leave startup traffic to satisfy the
// assertions that follow.
async function tracedRun(
  provider: ScriptedProvider,
  report: (problem: string) => void,
  profile: OmpProfile,
  label: string,
  extraEnv: Readonly<Record<string, string>>,
): Promise<string> {
  const traceFile = join(profile.root, `${label}.strace`);
  const logPath = join(profile.root, `${label}.jsonl`);
  writeFileSync(logPath, "");
  mkdirSync(tmpDirOf(profile), { recursive: true });
  const omp = startOmp({
    bin: OMP_BIN,
    env: { ...profile.env, TMPDIR: tmpDirOf(profile), ...extraEnv, [SPIKE_CONFIG_VARIABLE]: JSON.stringify({ log: logPath } satisfies SpikeConfig) },
    cwd: profile.workspace,
    extensionPath: SPIKE_EXTENSION_PATH,
    wrap: traceArgv(traceFile),
  });
  const requestsBefore = provider.requests.length;
  let frames: readonly OmpFrame[];
  try {
    await omp.ready(OMP_READY_TIMEOUT_MS);
    // A cold profile's first prompt competes with the startup network traffic that S11 measures, and the host may be loaded: it gets
    // the startup bound, which is a failure bound only.
    const outcome = await omp.prompt("hello", OMP_READY_TIMEOUT_MS);
    assert.equal(outcome.toolEnds.length, 0);
    frames = outcome.frames;
  } finally {
    await omp.close(CLOSE_OPTIONS);
  }
  const problem = scriptedTurnProblem({ prompt: "hello", requests: provider.requests.slice(requestsBefore), frames });
  assert.equal(problem, undefined, `the ${label} run's scripted turn is not proven, so its trace is not evidence: ${problem ?? ""}`);
  const trace = readFileSync(traceFile, "utf8");
  for (const evidenceProblem of writeEvidence(process.env[EVIDENCE_DIR_VARIABLE], { [`s11-${label}.strace`]: () => trace })) {
    report(evidenceProblem);
  }
  return trace;
}

// S11 exempts no host. Omp's model-catalog refresh (`catalog.stencil.so:443`; Omp 18.12.6's `online-if-uncached` strategy fetches
// the model catalog when its cache is empty, 12-RESEARCH.md 2.6) happens at startup of a cold profile only. A cold run is reported as
// skipped; a warm run fails on any connection outside the allowlist, DNS queries included, whatever address a host resolves to.

void test("S11: a warm Omp profile connects only to loopback, and a cold profile is skipped with its reason (HARN-03)", { skip: traceGate ?? false, timeout: NETWORK_SCENARIO_TIMEOUT_MS }, async (t) => {
  t.diagnostic(`omp/${ompVersionText}`);
  const cleanups = createCleanups();
  t.after(() => cleanups.run());
  const report = (problem: string): void => {
    t.diagnostic(problem);
  };
  const provider = new ScriptedProvider();
  const { port } = await provider.start();
  cleanups.add(() => provider.stop());
  const pathValue = process.env["PATH"];
  const pathOption = pathValue === undefined ? {} : { path: pathValue };
  // Loopback peers a run may talk to: the stub and Omp's three local-model discovery probes (OMP_DISCOVERY_PORTS).
  const allow: NetAllow = { loopbackPorts: [port, ...OMP_DISCOVERY_PORTS] };

  // Lever 3 first, because it needs no change to the profile: the same directory, used twice. The first run is the cold one.
  const profile = createOmpProfile({ providerPort: port, ...pathOption });
  cleanups.add(() => {
    profile.dispose();
  });
  // The cold run is the warm-up that makes the profile warmed. Its trace is not the claim: a cold profile is reported as skipped with
  // its reason, never passed on the strength of its startup traffic.
  let warmed = false;
  await t.test("cold profile: warm-up run, reported as skipped", async (c) => {
    const cold = summarise(await tracedRun(provider, report, profile, "cold", {}), allow);
    warmed = true;
    c.diagnostic(`cold: ${String(cold.external)} external connects, ${String(cold.dns)} DNS connects, loopback ports ${cold.loopbackPorts.join(",")}; ${String(cold.offenders.length)} connection(s) outside the allowlist`);
    c.skip("the profile is cold; Omp's model-catalog refresh is observed only on a cold profile");
  });

  await t.test("warm profile: no connection outside the loopback stub, its discovery probes, or any DNS query", async (w) => {
    assert.ok(warmed, "the warm run needs the cold run to have warmed the profile");
    const warm = summarise(await tracedRun(provider, report, profile, "warm", {}), allow);
    w.diagnostic(`warm: ${String(warm.external)} external connects, ${String(warm.dns)} DNS connects, loopback ports ${warm.loopbackPorts.join(",")}`);
    assert.equal(warm.offenders.length, 0, `the warm run connected outside the allowlist or queried DNS; no host is exempt: ${formatOffenders(warm.offenders)}`);
    assert.deepEqual(warm.loopbackPorts.filter((candidate) => !allow.loopbackPorts.includes(candidate)), []);
    assert.ok(warm.loopbackPorts.includes(port), "the warm run reached the stub");
  });

  // The proxy lever: a fresh profile (cold again) whose outbound HTTP(S) goes to a loopback proxy that refuses it.
  const proxy = new RefusingProxy();
  const proxyPort = await proxy.start();
  cleanups.add(() => proxy.stop());
  const fresh = createOmpProfile({ providerPort: port, ...pathOption });
  cleanups.add(() => {
    fresh.dispose();
  });
  const proxyUrl = `http://127.0.0.1:${String(proxyPort)}`;
  const proxied = summarise(
    await tracedRun(provider, report, fresh, "proxy", {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      NO_PROXY: "127.0.0.1,localhost",
      no_proxy: "127.0.0.1,localhost",
    }),
    { loopbackPorts: [...allow.loopbackPorts, proxyPort] },
  );
  const hosts = [...new Set(proxy.requests)].sort();
  t.diagnostic(`proxy lever: ${String(proxied.external)} external connects, ${String(proxied.dns)} DNS connects; the proxy refused ${String(proxy.requests.length)} requests for ${hosts.join(", ")}`);
  assert.equal(proxied.offenders.length, 0, formatOffenders(proxied.offenders));
  assert.equal(proxied.external, 0);
  assert.equal(proxied.dns, 0);
  assert.ok(proxy.requests.length > 0, "the startup traffic reached the proxy, so the clean trace is the lever's doing");
  assert.ok(proxy.requests.every((line) => /^CONNECT \S+:443 HTTP\/1\.1$/.test(line)), `every refused request is a CONNECT to port 443: ${hosts.join(" | ")}`);
});
