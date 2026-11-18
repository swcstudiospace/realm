// watchdogWorkload (Phase 39, D-39-02, revised after the live proof) and the behaviour of the bash wrapper it returns. The live lab
// found that inside the sandbox kill(2) on a process group is denied (EPERM), so coreutils `timeout` reaches only its direct child.
// The wrapper therefore finds the exec's processes in /proc and signals each by pid. The second half of this file runs the exact
// script on this host's bash against real process trees. To stay as strict as the sandbox, the tree tests load a BASH_ENV file that
// makes the shell builtin `kill` refuse a group target (the `--` form and the pid 0 form) the way the sandbox does, so a wrapper that
// used a group kill would fail here too. Linux only (it reads /proc), regular user, every fixed wait through scaledMs. Every process
// a test starts is killed in t.after.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { watchdogWorkload } from "../../src/runtime/exec-watchdog.js";
import { boundedWait, pollUntil } from "../support/timing.js";

// ---- The argv pins ----------------------------------------------------------------------------------------------------------------

// The script text is long, so the pins are its hash and its key tokens. A change of the script changes the hash on purpose: the
// hash is the reviewer's cue that the live-validated text moved, and the real-process tests below must still pass.
const SCRIPT_SHA256 = "d6937aadd5135fc0f699b373bb246ac56e0521faf8777879a1c62e867963ac0d";

function scriptOf(argv: readonly string[]): string {
  const script = argv[2];
  assert.ok(script !== undefined, "the wrapper argv carries the script");
  return script;
}

void test("watchdogWorkload: the argv form and the shell form at the dispatcher's 28000 ms", () => {
  const argvForm = watchdogWorkload(["echo", "ok"], 28000);
  assert.deepEqual([argvForm[0], argvForm[1], argvForm[3], argvForm[4]], ["/usr/bin/bash", "-c", "realm-exec-wd", "28.5"]);
  assert.deepEqual(argvForm.slice(5), ["echo", "ok"]);
  const shellForm = watchdogWorkload(["/bin/sh", "-c", "echo hi"], 28000);
  assert.deepEqual([shellForm[0], shellForm[1], shellForm[3], shellForm[4]], ["/usr/bin/bash", "-c", "realm-exec-wd", "28.5"]);
  assert.deepEqual(shellForm.slice(5), ["/bin/sh", "-c", "echo hi"]);
  assert.equal(scriptOf(argvForm), scriptOf(shellForm), "one script for every exec");
});

void test("watchdogWorkload: the script is pinned by hash and by the tokens that carry its design", () => {
  const script = scriptOf(watchdogWorkload(["x"], 28000));
  assert.equal(createHash("sha256").update(script).digest("hex"), SCRIPT_SHA256);
  assert.ok(script.length < 2600, "the script stays small enough to pass as one argument");
  for (const token of [
    "coproc TICK",
    "read -t 0.02",
    'alive()',
    '/proc/$W/stat',
    'wait "$W"',
    "REALM_EXEC_TOKEN",
    "/proc/[0-9]*",
    "kill -STOP",
    "kill -KILL",
    "exit 124",
    "<&0",
    "BASH_VERSINFO",
  ]) {
    assert.ok(script.includes(token), `the script holds ${token}`);
  }
  // The sandbox denies a signal to a process group, and has no timeout-based reach, pkill, pgrep or ps: the script uses none of them.
  assert.doesNotMatch(script, /kill\s+(-\w+\s+)?--/, "no group kill");
  assert.doesNotMatch(script, /\b(timeout|pkill|pgrep|killall|setsid)\b|\bps\b/);
});

void test("watchdogWorkload: the script is valid bash", () => {
  const checked = spawnSync("/usr/bin/bash", ["-n"], { input: scriptOf(watchdogWorkload(["x"], 28000)), encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
});

void test("watchdogWorkload: the deadline is the runner deadline plus 500 ms in plain seconds", () => {
  const seconds = (deadlineMs: number): string | undefined => watchdogWorkload(["x"], deadlineMs)[4];
  assert.equal(seconds(1000), "1.5");
  assert.equal(seconds(500), "1");
  assert.equal(seconds(250), "0.75");
  assert.equal(seconds(28000), "28.5");
  assert.equal(seconds(1), "0.501");
});

void test("watchdogWorkload: the result is frozen, and the caller's array is neither changed nor aliased", () => {
  const workload = ["echo", "a b", "--x"];
  const wrapped = watchdogWorkload(workload, 28000);
  assert.equal(Object.isFrozen(wrapped), true);
  assert.deepEqual(workload, ["echo", "a b", "--x"]);
  assert.equal(Object.is(wrapped, workload), false);
  workload.push("later");
  assert.equal(wrapped.length, 8, "a later change of the caller's array does not reach the result");
});

void test("watchdogWorkload: a deadline that is not a positive integer, and an empty workload, are SCHEMA_INVALID", () => {
  for (const deadline of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => watchdogWorkload(["echo"], deadline), { code: "SCHEMA_INVALID" }, `deadline ${String(deadline)}`);
  }
  assert.throws(() => watchdogWorkload([], 28000), { code: "SCHEMA_INVALID" });
});

void test("watchdogWorkload: a caller element that looks like an option follows the duration verbatim", () => {
  assert.deepEqual(watchdogWorkload(["--help", "-s", "KILL"], 28000).slice(4), ["28.5", "--help", "-s", "KILL"]);
});

// ---- The wrapper on real process trees ---------------------------------------------------------------------------------------------

const WAIT_MS = 15_000;
const POLL_MS = 50;

interface Finished {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}

interface Started {
  readonly child: ChildProcess;
  readonly done: Promise<Finished>;
}

function randomMark(): string {
  return `realm-wd-test-${createHash("sha256").update(String(performance.now()) + String(process.pid)).digest("hex").slice(0, 12)}`;
}

// The pids of running processes whose command line holds `text` (a zombie has an empty command line and never matches).
function processesHolding(text: string): readonly number[] {
  const found: number[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^[0-9]+$/.test(name) || Number(name) === process.pid) {
      continue;
    }
    try {
      if (readFileSync(`/proc/${name}/cmdline`, "utf8").replaceAll("\0", " ").includes(text)) {
        found.push(Number(name));
      }
    } catch {
      // The process ended while it was read.
    }
  }
  return found;
}

// The pids of running processes whose whole argv is `args`.
function processesWithArgv(args: readonly string[]): readonly number[] {
  const wanted = `${args.join("\0")}\0`;
  const found: number[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^[0-9]+$/.test(name)) {
      continue;
    }
    try {
      if (readFileSync(`/proc/${name}/cmdline`, "utf8") === wanted) {
        found.push(Number(name));
      }
    } catch {
      // The process ended while it was read.
    }
  }
  return found;
}

// True while the pid is a running process: a zombie, or no such process, is gone.
function isRunning(pid: number): boolean {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
  } catch {
    return false;
  }
  const state = stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
  return state !== "Z" && state !== "X";
}

// Kills every sleeper of the given durations and every process holding the mark: the cleanup of a test, whatever its outcome. This
// is the test's own tidying on the host, not something the wrapper does.
function cleanUp(durations: readonly string[], mark?: string): void {
  const pids = [...durations.flatMap((duration) => processesWithArgv(["sleep", duration])), ...(mark === undefined ? [] : processesHolding(mark))];
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-watchdog-"));
  chmodSync(dir, 0o755);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// A BASH_ENV file that makes `kill` refuse a group target the way the sandbox's seccomp filter does (EPERM for a pid at or below
// zero), and pass everything else to the builtin. Only bash reads BASH_ENV, so the dash shells in a tree are unaffected.
const DENY_GROUP_KILL = [
  "kill() {",
  "  local a",
  '  for a in "$@"; do',
  '    if [[ $a == -- || $a == 0 ]]; then echo "kill: ($a): Operation not permitted" >&2; return 1; fi',
  "  done",
  '  builtin kill "$@"',
  "}",
  "",
].join("\n");

function denyGroupKillEnv(t: TestContext): NodeJS.ProcessEnv {
  const file = join(scratch(t), "deny-group-kill.sh");
  writeFileSync(file, DENY_GROUP_KILL);
  return { ...process.env, BASH_ENV: file };
}

interface RunOptions {
  readonly deadlineMs: number;
  readonly stdin?: string;
  readonly env?: NodeJS.ProcessEnv;
}

// A sandbox exec runs as an unprivileged user (uid 1001), which also keeps the sweep cheap: it cannot read other users' fd tables.
// When this test process is root, the wrapper drops to the conventional nobody user so the tree behaves as it does in the sandbox.
function unprivileged(): { readonly uid?: number; readonly gid?: number } {
  return process.getuid?.() === 0 ? { uid: 65534, gid: 65534 } : {};
}

// Runs the wrapper on this host, as the sandbox runs an exec: its own process group (detached makes it a group leader), stdout and
// stderr on pipes. Resolves when the wrapper has exited and its output pipes are closed, which a stray timer would delay.
function runWrapper(t: TestContext, workload: readonly string[], options: RunOptions): Started {
  const [file, ...args] = watchdogWorkload(workload, options.deadlineMs);
  assert.ok(file !== undefined);
  assert.ok(existsSync(file), `these tests run the wrapper on ${file}, which is missing`);
  assert.ok(existsSync("/proc/self/stat"), "these tests read the Linux process table (/proc)");
  const startedAt = performance.now();
  const child = spawn(file, args, { detached: true, stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"], env: options.env ?? process.env, ...unprivileged() });
  t.after(() => {
    try {
      // The test's own cleanup on the host: the wrapper never signals a group.
      process.kill(-(child.pid ?? 0), "SIGKILL");
    } catch {
      // The group is already gone.
    }
  });
  if (options.stdin !== undefined) {
    child.stdin?.end(options.stdin);
  }
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const done = new Promise<Finished>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr, elapsedMs: performance.now() - startedAt });
    });
  });
  return { child, done };
}

async function allGone(what: string, pids: () => readonly number[]): Promise<void> {
  await pollUntil(() => pids().length === 0, `${what} are gone`, { timeoutMs: WAIT_MS, intervalMs: POLL_MS });
}

// The tree of the plan, in one script run by bash with the mark as $0: a plain background sleep, a nested subshell with its own
// background and foreground sleeps, a bash that ignores SIGTERM around a sleep, a bash that forks a new sleep over and over, and a
// foreground sleep. Every inner bash carries the mark so a survivor is found by it.
const TREE_SECONDS = ["7101", "7102", "7103", "7104", "7105", "7106"] as const;
const TREE_SCRIPT = [
  "sleep 7101 &",
  "( sleep 7102 & sleep 7103; wait ) &",
  `bash -c 'trap "" TERM; sleep 7104' "$0" &`,
  `bash -c 'while :; do sleep 7105 & sleep 0.02; done' "$0" &`,
  "sleep 7106; wait",
].join("\n");

function treeRunning(): boolean {
  return TREE_SECONDS.every((seconds) => processesWithArgv(["sleep", seconds]).length >= 1);
}

void test("a deadline ends a whole tree: background sleeps, a nested subshell, a SIGTERM-ignoring child and a child that forks repeatedly, with exit 124", async (t) => {
  const mark = randomMark();
  t.after(() => {
    cleanUp(TREE_SECONDS, mark);
  });
  const { done } = runWrapper(t, ["bash", "-c", TREE_SCRIPT, mark], { deadlineMs: 4000, env: denyGroupKillEnv(t) });
  await pollUntil(treeRunning, "the whole tree is running", { timeoutMs: WAIT_MS, intervalMs: POLL_MS });
  assert.ok(processesHolding(mark).length >= 3, "the inner shells carry the mark while the tree runs");
  const finished = await boundedWait(done, "the wrapper ends the tree", WAIT_MS);
  assert.equal(finished.code, 124, `the wrapper's own deadline is exit 124: ${JSON.stringify(finished)}`);
  await allGone("the marked shells", () => processesHolding(mark));
  await allGone("the tree's sleeps", () => TREE_SECONDS.flatMap((seconds) => processesWithArgv(["sleep", seconds])));
});

void test("an unrelated process outside the exec survives the sweep", async (t) => {
  t.after(() => {
    cleanUp(["7110", ...TREE_SECONDS]);
  });
  const sibling = spawn("sleep", ["7110"], { detached: true, stdio: "ignore" });
  t.after(() => {
    sibling.kill("SIGKILL");
  });
  const mark = randomMark();
  t.after(() => {
    cleanUp([], mark);
  });
  const { done } = runWrapper(t, ["bash", "-c", TREE_SCRIPT, mark], { deadlineMs: 2000, env: denyGroupKillEnv(t) });
  await pollUntil(treeRunning, "the tree is running", { timeoutMs: WAIT_MS, intervalMs: POLL_MS });
  assert.equal((await boundedWait(done, "the wrapper ends the tree", WAIT_MS)).code, 124);
  assert.equal(sibling.pid !== undefined && isRunning(sibling.pid), true, "the sibling is still running");
  assert.equal(processesWithArgv(["sleep", "7110"]).length, 1);
});

void test("a process that left the group with setsid keeps the token in its environment and is reached; one that also clears its environment and detaches its stdio survives", async (t) => {
  t.after(() => {
    cleanUp(["7112", "7113", "7115"]);
  });
  // 7112: orphaned (its subshell exits), new session, environment intact, stdio detached: reached through the token.
  // 7113: new session, environment intact, still a child of the workload shell: reached through its parent.
  // 7115: orphaned, new session, `env -i` clears the token, stdio detached: indistinguishable from an unrelated process. It survives.
  // This is the documented limit (D-39-05); the survivor is removed by cleanUp, as the sandbox's deletion removes it.
  const script = [
    "( setsid sleep 7112 </dev/null >/dev/null 2>&1 & )",
    "setsid sleep 7113 </dev/null >/dev/null 2>&1 &",
    "( env -i setsid sleep 7115 </dev/null >/dev/null 2>&1 & )",
    "sleep 7114; wait",
  ].join("\n");
  const { done } = runWrapper(t, ["bash", "-c", script], { deadlineMs: 3000, env: denyGroupKillEnv(t) });
  await pollUntil(
    () => ["7112", "7113", "7114", "7115"].every((seconds) => processesWithArgv(["sleep", seconds]).length === 1),
    "the four sleeps are running",
    { timeoutMs: WAIT_MS, intervalMs: POLL_MS },
  );
  assert.equal((await boundedWait(done, "the wrapper ends", WAIT_MS)).code, 124);
  await allGone("the sleeps the wrapper can reach", () => ["7112", "7113", "7114"].flatMap((seconds) => processesWithArgv(["sleep", seconds])));
  assert.equal(processesWithArgv(["sleep", "7115"]).length, 1, "the fully detached orphan with a cleared environment is out of reach");
});

void test("exit codes pass through: 0, 3, 127 for a missing command and 143 for a command ended by SIGTERM", async (t) => {
  const cases: ReadonlyArray<readonly [readonly string[], number]> = [
    [["true"], 0],
    [["sh", "-c", "exit 3"], 3],
    [["realm-no-such-command-x"], 127],
    [["sh", "-c", "kill -TERM $$"], 143],
  ];
  for (const [workload, code] of cases) {
    const finished = await boundedWait(runWrapper(t, workload, { deadlineMs: 20_000 }).done, `the wrapper ends ${workload.join(" ")}`, WAIT_MS);
    assert.equal(finished.code, code, `${workload.join(" ")}: ${JSON.stringify(finished)}`);
  }
});

void test("stdout and stderr pass through unchanged, a missing command names itself on stderr, and stdin reaches the workload", async (t) => {
  const both = await boundedWait(runWrapper(t, ["sh", "-c", "echo out; echo err >&2"], { deadlineMs: 20_000 }).done, "the wrapper ends", WAIT_MS);
  assert.deepEqual([both.stdout, both.stderr], ["out\n", "err\n"]);
  const missing = await boundedWait(runWrapper(t, ["realm-no-such-command-x"], { deadlineMs: 20_000 }).done, "the wrapper ends", WAIT_MS);
  assert.match(missing.stderr, /realm-no-such-command-x: command not found/);
  const echoed = await boundedWait(runWrapper(t, ["cat"], { deadlineMs: 20_000, stdin: "hello\nworld\n" }).done, "the wrapper ends", WAIT_MS);
  assert.deepEqual([echoed.code, echoed.stdout], [0, "hello\nworld\n"]);
});

void test("the caller's argv is not reparsed: an element that looks like an option reaches the command verbatim", async (t) => {
  const finished = await boundedWait(runWrapper(t, ["echo", "--version", "-n", "$HOME", "a b"], { deadlineMs: 20_000 }).done, "the wrapper ends", WAIT_MS);
  assert.equal(finished.stdout, "--version -n $HOME a b\n");
});

void test("a workload that runs into the wrapper's deadline gives exit 124 after about the duration, and nothing is left", async (t) => {
  t.after(() => {
    cleanUp(["7111"]);
  });
  const finished = await boundedWait(runWrapper(t, ["sleep", "7111"], { deadlineMs: 500, env: denyGroupKillEnv(t) }).done, "the wrapper times out", WAIT_MS);
  assert.equal(finished.code, 124);
  assert.ok(finished.elapsedMs >= 900, `the deadline is 1 s (500 ms plus the 500 ms margin): ${String(finished.elapsedMs)} ms`);
  await allGone("the sleeper", () => processesWithArgv(["sleep", "7111"]));
});

// The pids of running processes in the given process group.
function processesInGroup(pgid: number): readonly number[] {
  const found: number[] = [];
  for (const name of readdirSync("/proc")) {
    if (!/^[0-9]+$/.test(name)) {
      continue;
    }
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (Number(fields[2]) === pgid && fields[0] !== "Z" && fields[0] !== "X") {
        found.push(Number(name));
      }
    } catch {
      // The process ended while it was read.
    }
  }
  return found;
}

void test("a workload that wins leaves nothing of the wrapper behind: it exits at once, the pipes close, and its poll coprocess is gone", async (t) => {
  // A workload that is still running at the first check starts the poll coprocess; one that ends first never does. Both leave no process.
  for (const workload of [["true"], ["sleep", "0.5"]]) {
    const { child, done } = runWrapper(t, workload, { deadlineMs: 20_000 });
    const finished = await boundedWait(done, "the wrapper ends and releases its pipes", 5000);
    assert.equal(finished.code, 0);
    assert.ok(finished.elapsedMs < 5000, `the wrapper does not wait for its deadline: ${String(finished.elapsedMs)} ms`);
    assert.deepEqual(processesInGroup(child.pid ?? 0), [], `${workload.join(" ")}: no process of the wrapper's group remains`);
  }
});

void test("a workload that ends before the wrapper first looks, and one that ends a moment later, are both seen, over many quick runs", async (t) => {
  // The first version of the wrapper missed a workload that ended before its wait began (a bash wait -n race) and ran to the deadline.
  const started = performance.now();
  for (let i = 0; i < 60; i += 1) {
    const finished = await boundedWait(runWrapper(t, i % 2 === 0 ? ["true"] : ["sh", "-c", "exit 3"], { deadlineMs: 20_000 }).done, "a quick run ends", 5000);
    assert.equal(finished.code, i % 2 === 0 ? 0 : 3, `run ${String(i)}: ${JSON.stringify(finished)}`);
  }
  assert.ok(performance.now() - started < 20_000, "sixty quick runs never wait for the deadline");
});

void test("the group-kill denial of the sandbox is reproduced by the BASH_ENV used above", (t) => {
  const env = denyGroupKillEnv(t);
  const denied = spawnSync("/usr/bin/bash", ["-c", "kill -0 -- 0"], { env, encoding: "utf8" });
  assert.equal(denied.status, 1);
  assert.match(denied.stderr, /Operation not permitted/);
  const single = spawnSync("/usr/bin/bash", ["-c", "kill -0 $$"], { env, encoding: "utf8" });
  assert.equal(single.status, 0, "a signal to one process still works");
});

void test("control: without the wrapper, killing only the shell (the local client) leaves the tree running", async (t) => {
  const mark = randomMark();
  t.after(() => {
    cleanUp(TREE_SECONDS, mark);
  });
  const child = spawn("bash", ["-c", TREE_SCRIPT, mark], { detached: true, stdio: "ignore" });
  t.after(() => {
    try {
      process.kill(-(child.pid ?? 0), "SIGKILL");
    } catch {
      // Already gone.
    }
  });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  await pollUntil(treeRunning, "the whole tree is running", { timeoutMs: WAIT_MS, intervalMs: POLL_MS });
  child.kill("SIGKILL");
  await boundedWait(exited, "the shell ends", WAIT_MS);
  assert.ok(
    TREE_SECONDS.every((seconds) => processesWithArgv(["sleep", seconds]).length >= 1),
    "every sleep outlives the shell: nothing but the wrapper ends the tree",
  );
});
