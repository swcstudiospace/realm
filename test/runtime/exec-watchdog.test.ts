// watchdogWorkload (Phase 39, D-39-02, D-39-12) and the kill semantics it relies on. The behaviour that matters (the group kill, the
// escalation, exit 124 and 137, the option order) lives in coreutils `timeout`, so the second half of this file runs the exact argv
// the module returns, on the host's /usr/bin/timeout, against a real local process tree. A fake cannot show the kill. Linux only (it
// reads /proc), regular user, every fixed wait through scaledMs. Every process a test starts is killed in t.after.

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { watchdogWorkload } from "../../src/runtime/exec-watchdog.js";
import { boundedWait, pollUntil } from "../support/timing.js";

// ---- The argv pins (literals, not constants) ------------------------------------------------------------------------------------

void test("watchdogWorkload: the argv form and the shell form at the dispatcher's 28000 ms", () => {
  assert.deepEqual(watchdogWorkload(["echo", "ok"], 28000), ["/usr/bin/timeout", "--kill-after=1.5", "--", "28.5", "echo", "ok"]);
  assert.deepEqual(watchdogWorkload(["/bin/sh", "-c", "echo hi"], 28000), ["/usr/bin/timeout", "--kill-after=1.5", "--", "28.5", "/bin/sh", "-c", "echo hi"]);
});

void test("watchdogWorkload: the duration is the deadline plus 500 ms in plain seconds", () => {
  const duration = (deadlineMs: number): string | undefined => watchdogWorkload(["x"], deadlineMs)[3];
  assert.equal(duration(1000), "1.5");
  assert.equal(duration(500), "1");
  assert.equal(duration(250), "0.75");
  assert.equal(duration(28000), "28.5");
  assert.equal(duration(1), "0.501");
});

void test("watchdogWorkload: the result is frozen, and the caller's array is neither changed nor aliased", () => {
  const workload = ["echo", "a b", "--x"];
  const wrapped = watchdogWorkload(workload, 28000);
  assert.equal(Object.isFrozen(wrapped), true);
  assert.deepEqual(workload, ["echo", "a b", "--x"]);
  assert.equal(Object.is(wrapped, workload), false);
  workload.push("later");
  assert.equal(wrapped.length, 7, "a later change of the caller's array does not reach the result");
});

void test("watchdogWorkload: a deadline that is not a positive integer, and an empty workload, are SCHEMA_INVALID", () => {
  for (const deadline of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => watchdogWorkload(["echo"], deadline), { code: "SCHEMA_INVALID" }, `deadline ${String(deadline)}`);
  }
  assert.throws(() => watchdogWorkload([], 28000), { code: "SCHEMA_INVALID" });
});

void test("watchdogWorkload: a caller element that looks like an option follows the duration verbatim", () => {
  assert.deepEqual(watchdogWorkload(["--help", "-s", "KILL"], 28000), ["/usr/bin/timeout", "--kill-after=1.5", "--", "28.5", "--help", "-s", "KILL"]);
});

// ---- The real coreutils timeout on a real process tree ---------------------------------------------------------------------------

const WAIT_MS = 15_000;
const POLL_MS = 50;

interface Finished {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
}

// Starts a process and resolves when it has exited and its output is closed.
function start(
  argv: readonly string[],
  t: TestContext,
): { readonly child: ChildProcess; readonly done: Promise<Finished>; readonly exited: Promise<void> } {
  const [file, ...args] = argv;
  assert.ok(file !== undefined, "an argv needs a program");
  assert.ok(existsSync("/usr/bin/timeout"), "these tests run the host's /usr/bin/timeout (GNU coreutils), which is missing");
  assert.ok(existsSync("/proc/self/stat"), "these tests read the Linux process table (/proc)");
  const startedAt = performance.now();
  const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => {
    child.kill("SIGKILL");
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const done = new Promise<Finished>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr, elapsedMs: performance.now() - startedAt });
    });
  });
  // The process's own exit, which does not wait for output pipes that a surviving helper still holds open.
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  return { child, done, exited };
}

// The pids of running processes whose whole argv is `args` (a zombie has an empty command line and never matches).
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

// Kills every sleeper of the given durations: the cleanup of a test whose assertion failed half way.
function killSleepers(durations: readonly string[]): void {
  for (const duration of durations) {
    for (const pid of processesWithArgv(["sleep", duration])) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

// The tree of live scenario C in miniature: a shell that starts a background sleep, writes its own pid and the helper's to the file
// named by $0, then runs a foreground sleep and waits. Plain text, no quoting of the caller's input.
function treeScript(helper: string, foreground: string): string {
  return `sleep ${helper} & echo "$$ $!" > "$0"; sleep ${foreground}; wait`;
}

interface Tree {
  readonly pidFile: string;
  readonly shellPid: number;
  readonly helperPid: number;
  readonly foregroundPid: number;
}

// Waits until the shell, the helper and the foreground sleep all run, and reads their pids.
async function treeRunning(pidFile: string, helper: string, foreground: string): Promise<Tree> {
  let tree: Tree | undefined;
  await pollUntil(
    () => {
      if (!existsSync(pidFile)) {
        return false;
      }
      const [shell, background] = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
      const foregrounds = processesWithArgv(["sleep", foreground]);
      const helpers = processesWithArgv(["sleep", helper]);
      if (shell === undefined || background === undefined || foregrounds.length !== 1 || helpers.length !== 1) {
        return false;
      }
      tree = { pidFile, shellPid: shell, helperPid: background, foregroundPid: foregrounds[0] ?? 0 };
      return true;
    },
    "the shell, the helper and the foreground sleep are running",
    { timeoutMs: WAIT_MS, intervalMs: POLL_MS },
  );
  assert.ok(tree !== undefined);
  return tree;
}

function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-watchdog-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function everyoneGone(pids: readonly number[]): Promise<void> {
  await pollUntil(() => pids.every((pid) => !isRunning(pid)), "every process of the tree is gone", { timeoutMs: WAIT_MS, intervalMs: POLL_MS });
}

void test("the watchdog ends a shell, its background helper and its foreground sleep at the duration with exit 124", async (t) => {
  t.after(() => {
    killSleepers(["6101", "6102"]);
  });
  const pidFile = join(scratch(t), "pids");
  const { done } = start(watchdogWorkload(["/bin/sh", "-c", treeScript("6101", "6102"), pidFile], 500), t);
  const tree = await treeRunning(pidFile, "6101", "6102");
  const finished = await boundedWait(done, "the watchdog ends the tree", WAIT_MS);
  assert.equal(finished.code, 124, `a timeout is exit 124: ${JSON.stringify(finished)}`);
  await everyoneGone([tree.shellPid, tree.helperPid, tree.foregroundPid]);
});

void test("a command that ignores SIGTERM is killed after the grace, with exit 137, and nothing is left", async (t) => {
  t.after(() => {
    killSleepers(["6103"]);
  });
  const pidFile = join(scratch(t), "pid");
  const script = 'trap "" TERM; echo $$ > "$0"; sleep 6103';
  const { done } = start(watchdogWorkload(["/bin/sh", "-c", script, pidFile], 500), t);
  await pollUntil(() => existsSync(pidFile) && processesWithArgv(["sleep", "6103"]).length === 1, "the TERM-ignoring tree is running", {
    timeoutMs: WAIT_MS,
    intervalMs: POLL_MS,
  });
  const shellPid = Number(readFileSync(pidFile, "utf8").trim());
  const finished = await boundedWait(done, "the watchdog escalates to SIGKILL", WAIT_MS);
  // `timeout` sends SIGKILL to the group and then to itself, so a shell parent reads 137 (128 plus 9) and a direct parent reads the signal.
  assert.ok(finished.code === 137 || (finished.code === null && finished.signal === "SIGKILL"), `a command that needed SIGKILL ends as 137: ${JSON.stringify(finished)}`);
  assert.ok(finished.elapsedMs >= 2000, `the SIGKILL comes after the 1 s duration and the 1.5 s grace, not before: ${String(finished.elapsedMs)} ms`);
  await everyoneGone([shellPid, ...processesWithArgv(["sleep", "6103"])]);
  assert.deepEqual(processesWithArgv(["sleep", "6103"]), []);
});

void test("an unrelated process outside the group survives the watchdog", async (t) => {
  t.after(() => {
    killSleepers(["6104", "6105", "6106"]);
  });
  const sibling = spawn("sleep", ["6104"], { detached: true, stdio: "ignore" });
  t.after(() => {
    sibling.kill("SIGKILL");
  });
  const pidFile = join(scratch(t), "pids");
  const { done } = start(watchdogWorkload(["/bin/sh", "-c", treeScript("6105", "6106"), pidFile], 500), t);
  await treeRunning(pidFile, "6105", "6106");
  assert.equal((await boundedWait(done, "the watchdog ends the tree", WAIT_MS)).code, 124);
  assert.equal(sibling.pid !== undefined && isRunning(sibling.pid), true, "the sibling is still running");
  assert.equal(processesWithArgv(["sleep", "6104"]).length, 1);
});

void test("a command that ends by itself passes its exit code, stdout and stderr through", async (t) => {
  const { done } = start(watchdogWorkload(["/bin/sh", "-c", "echo out; echo err >&2; exit 7"], 5000), t);
  const finished = await boundedWait(done, "the command ends", WAIT_MS);
  assert.equal(finished.code, 7);
  assert.equal(finished.stdout, "out\n");
  assert.equal(finished.stderr, "err\n");
});

void test("the caller's argv is never reparsed as options: a first element --version is a command name and fails with 127", async (t) => {
  const { done } = start(watchdogWorkload(["--version"], 5000), t);
  const finished = await boundedWait(done, "timeout reports the missing command", WAIT_MS);
  assert.equal(finished.code, 127);
  assert.match(finished.stderr, /failed to run command/);
  assert.equal(finished.stdout, "", "timeout did not print its own version");
});

void test("control: without the wrapper, killing only the shell (the local client) leaves the background helper running", async (t) => {
  t.after(() => {
    killSleepers(["6107", "6108"]);
  });
  const pidFile = join(scratch(t), "pids");
  const { child, exited } = start(["/bin/sh", "-c", treeScript("6107", "6108"), pidFile], t);
  const tree = await treeRunning(pidFile, "6107", "6108");
  child.kill("SIGKILL");
  await boundedWait(exited, "the shell ends", WAIT_MS);
  assert.equal(isRunning(tree.shellPid), false, "the shell is gone");
  assert.equal(isRunning(tree.helperPid), true, "the helper outlives the shell: nothing but the wrapper ends the tree");
  assert.equal(isRunning(tree.foregroundPid), true, "the foreground sleep outlives the shell too");
});
