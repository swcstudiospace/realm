// The always-running hermetic test of test/support/process-tree-probe.ts (Phase 39, EXEC-01). The live proof that a timed-out exec
// is dead (live closeout C) reads the sandbox's process table through this probe, so the probe is proved here first: its parser and
// verdict on fixtures, its argv refusals, and the real script against a real local process tree (a shell with two sleepers in its own
// process group), including the controls that keep an absence check from passing vacuously. Linux only, like the live suite: the
// probe reads /proc. No gate, no network, no privilege.

import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { promisify } from "node:util";
import { pollUntil } from "../support/timing.js";
import {
  controlsHold,
  describeMembers,
  judgeTree,
  parseTreeListing,
  recordedGroups,
  treeProbeArgv,
  TREE_PROBE_SCRIPT,
  type TreeMember,
} from "../support/process-tree-probe.js";

const runFile = promisify(execFile);

function member(fields: Partial<TreeMember> & Pick<TreeMember, "pid">): TreeMember {
  return { ppid: 1, pgid: fields.pid, state: "S", start: "1000", comm: "sleep", argv: "", ...fields };
}

// ---- The parser ---------------------------------------------------------------------------------------------------------------

void test("parseTreeListing reads a valid listing, the empty tree, and a command name with parentheses", () => {
  const valid = parseTreeListing("count 2\nmember 10 1 10 S 500 sh /bin/sh -c sleep 300 & wait marker-xyz\nmember 11 10 10 S 501 sleep sleep 300\n");
  assert.deepEqual(valid, {
    ok: true,
    members: [
      { pid: 10, ppid: 1, pgid: 10, state: "S", start: "500", comm: "sh", argv: "/bin/sh -c sleep 300 & wait marker-xyz" },
      { pid: 11, ppid: 10, pgid: 10, state: "S", start: "501", comm: "sleep", argv: "sleep 300" },
    ],
  });
  assert.deepEqual(parseTreeListing("count 0\n"), { ok: true, members: [] });
  const zombie = parseTreeListing("count 1\nmember 12 1 10 Z 502 sleep \n");
  assert.deepEqual(zombie, { ok: true, members: [{ pid: 12, ppid: 1, pgid: 10, state: "Z", start: "502", comm: "sleep", argv: "" }] });
  const odd = parseTreeListing("count 1\nmember 13 1 10 S 503 (a)b_(c) /usr/bin/x (a)b (c)\n");
  assert.deepEqual(odd, { ok: true, members: [{ pid: 13, ppid: 1, pgid: 10, state: "S", start: "503", comm: "(a)b_(c)", argv: "/usr/bin/x (a)b (c)" }] });
});

void test("parseTreeListing fails, and never returns zero members, for anything that is not the grammar", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["nothing", ""],
    ["blank lines only", "\n \n"],
    ["no count line", "member 10 1 10 S 500 sh x\n"],
    ["count mismatch (too few)", "count 2\nmember 10 1 10 S 500 sh x\n"],
    ["count mismatch (too many)", "count 0\nmember 10 1 10 S 500 sh x\n"],
    ["garbage", "Segmentation fault\n"],
    ["extra line", "count 0\nwarning: something\n"],
    ["short member line", "count 1\nmember 10 1 10 S 500\n"],
    ["non-numeric pid", "count 1\nmember ten 1 10 S 500 sh x\n"],
    ["non-numeric start", "count 1\nmember 10 1 10 S soon sh x\n"],
    ["two-character state", "count 1\nmember 10 1 10 SS 500 sh x\n"],
  ];
  for (const [name, stdout] of cases) {
    const parsed = parseTreeListing(stdout);
    assert.equal(parsed.ok, false, `${name} must be a failed listing: ${JSON.stringify(parsed)}`);
  }
});

// ---- The verdict --------------------------------------------------------------------------------------------------------------

void test("judgeTree: all absent is dead, only zombies is dead with the zombies reported, a running member is not dead", () => {
  const flight = [member({ pid: 10, start: "500" }), member({ pid: 11, ppid: 10, start: "501" })];
  assert.deepEqual(judgeTree(flight, []), { dead: true, running: [], zombies: [], sameProcess: [] });

  const zombies = [member({ pid: 10, start: "500", state: "Z" }), member({ pid: 11, ppid: 10, start: "501", state: "X" })];
  const corpses = judgeTree(flight, zombies);
  assert.equal(corpses.dead, true);
  assert.deepEqual(corpses.running, []);
  assert.deepEqual(corpses.zombies, zombies);
  assert.deepEqual(corpses.sameProcess, []);

  const alive = member({ pid: 11, ppid: 10, start: "501" });
  const survivor = judgeTree(flight, [member({ pid: 10, start: "500", state: "Z" }), alive]);
  assert.equal(survivor.dead, false);
  assert.deepEqual(survivor.running, [alive]);
  assert.deepEqual(survivor.sameProcess, [alive], "the same pid and the same start time is the same process");
});

void test("judgeTree: the same pid with another start time is running but is not the same process", () => {
  const flight = [member({ pid: 11, start: "501" })];
  const recycled = member({ pid: 11, start: "9999" });
  const verdict = judgeTree(flight, [recycled]);
  assert.equal(verdict.dead, false, "a running member found by a rule is not dead");
  assert.deepEqual(verdict.running, [recycled]);
  assert.deepEqual(verdict.sameProcess, []);
});

void test("controlsHold names what the in-flight listing lacks, and recordedGroups reads the marker member's group", () => {
  const marker = "realm-kill-proof-0123abcd";
  const shell = member({ pid: 20, pgid: 20, comm: "sh", argv: `/bin/sh -c script ${marker}` });
  const background = member({ pid: 21, ppid: 20, pgid: 20, argv: "sleep 301" });
  const foreground = member({ pid: 22, ppid: 20, pgid: 20, argv: "/usr/bin/sleep 300" });
  assert.equal(controlsHold([shell, background, foreground], marker, ["300", "301"]), undefined);
  assert.deepEqual(recordedGroups([shell, background, foreground], marker), [20]);
  // A wrapper above the group may be listed and is not required.
  assert.equal(controlsHold([member({ pid: 19, pgid: 19, comm: "timeout", argv: "timeout 28.5 x" }), shell, background, foreground], marker, ["300", "301"]), undefined);

  assert.match(controlsHold([shell, background], marker, ["300", "301"]) ?? "", /only 2 member\(s\) listed, 3 needed; no sleep 300 member/);
  assert.match(controlsHold([background, foreground, member({ pid: 23, pgid: 20, argv: "sleep 5" })], marker, ["300", "301"]) ?? "", /no member holds the marker/);
  assert.match(controlsHold([shell, background, member({ pid: 22, ppid: 20, pgid: 99, argv: "sleep 300" })], marker, ["300", "301"]) ?? "", /sleep 300 \(pid 22\) is in group 99/);
  assert.deepEqual(recordedGroups([background, foreground], marker), []);
  // An escaped duration must be present but may sit in another group.
  const escapee = member({ pid: 24, ppid: 20, pgid: 24, argv: "sleep 330" });
  assert.equal(controlsHold([shell, foreground, escapee], marker, ["300"], ["330"]), undefined);
  assert.match(controlsHold([shell, foreground, member({ pid: 25, pgid: 25 })], marker, ["300"], ["330"]) ?? "", /no sleep 330 member/);
  assert.equal(describeMembers([]), "none");
});

// ---- The argv builder ---------------------------------------------------------------------------------------------------------

void test("treeProbeArgv builds the node exec and refuses a loose marker, seconds or group", () => {
  const marker = "realm-kill-proof-0123abcd";
  assert.deepEqual(treeProbeArgv(marker, ["300", "301"], [42, 7]), ["node", "-e", TREE_PROBE_SCRIPT, marker, "300,301", "42,7"]);
  assert.deepEqual(treeProbeArgv(marker, [], []), ["node", "-e", TREE_PROBE_SCRIPT, marker, "-", "-"]);
  for (const bad of ["", "short", "UPPER-CASE-MARKER", "has space in it", "semi;colon-marker", "x".repeat(65), "-"]) {
    assert.throws(() => treeProbeArgv(bad, [], []), Error, `marker ${JSON.stringify(bad)}`);
  }
  assert.throws(() => treeProbeArgv(marker, ["30x"], []), Error);
  assert.throws(() => treeProbeArgv(marker, [""], []), Error);
  assert.throws(() => treeProbeArgv(marker, ["-"], []), Error);
  assert.throws(() => treeProbeArgv(marker, [], [-1]), Error);
  assert.throws(() => treeProbeArgv(marker, [], [1.5]), Error);
  assert.doesNotMatch(TREE_PROBE_SCRIPT, /`/, "the script holds no template literal, so it survives being one argument");
});

// ---- The script against a real local process tree -----------------------------------------------------------------------------

// Long enough that no sleeper ends by itself during the test; odd values so no other process on the host matches rule 2.
const SECONDS: readonly string[] = ["3170", "3171"];
const TREE_WAIT_MS = 10_000;
const POLL_MS = 50;

interface LocalTree {
  readonly marker: string;
  readonly shell: ChildProcess;
  readonly pgid: number;
  readonly exited: Promise<void>;
}

// `sh -c 'sleep A & sleep B; wait' MARKER`, detached into its own process group, so the marker is the shell's $0 and a member of rule 1.
function startTree(): LocalTree {
  const marker = `realm-tree-probe-${randomBytes(6).toString("hex")}`;
  const shell = spawn("/bin/sh", ["-c", `sleep ${SECONDS[0] ?? ""} & sleep ${SECONDS[1] ?? ""}; wait`, marker], { detached: true, stdio: "ignore" });
  assert.ok(shell.pid !== undefined, "the local shell must start");
  const exited = new Promise<void>((resolve) => {
    shell.once("exit", () => {
      resolve();
    });
  });
  return { marker, shell, pgid: shell.pid, exited };
}

function killGroup(tree: LocalTree): void {
  try {
    process.kill(-tree.pgid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

async function listTree(marker: string, seconds: readonly string[], groups: readonly number[]): Promise<readonly TreeMember[]> {
  // The probe's argv[0] is "node" inside the sandbox; here the current node binary runs the same script.
  const [, ...args] = treeProbeArgv(marker, seconds, groups);
  const result = await runFile(process.execPath, args, { encoding: "utf8" });
  const parsed = parseTreeListing(result.stdout);
  assert.ok(parsed.ok, `the probe output must parse: ${parsed.ok ? "" : parsed.detail}`);
  return parsed.members;
}

async function withTree(body: (tree: LocalTree) => Promise<void>): Promise<void> {
  assert.ok(existsSync("/proc/self/stat"), "this test reads the Linux process table (/proc); the live suite is Linux only");
  const tree = startTree();
  try {
    await body(tree);
  } finally {
    killGroup(tree);
    await tree.exited;
  }
}

async function waitForTree(tree: LocalTree): Promise<readonly TreeMember[]> {
  let last: readonly TreeMember[] = [];
  await pollUntil(
    async () => {
      last = await listTree(tree.marker, SECONDS, [tree.pgid]);
      return controlsHold(last, tree.marker, SECONDS) === undefined;
    },
    "the probe lists the shell and both sleepers",
    { timeoutMs: TREE_WAIT_MS, intervalMs: POLL_MS },
  );
  return last;
}

void test("the script lists a live tree with its controls, excludes itself, and reports a killed tree dead", async () => {
  await withTree(async (tree) => {
    const flight = await waitForTree(tree);
    assert.ok(flight.length >= 3, `at least three members: ${describeMembers(flight)}`);
    assert.equal(controlsHold(flight, tree.marker, SECONDS), undefined);
    assert.deepEqual(recordedGroups(flight, tree.marker), [tree.pgid]);
    assert.ok(
      flight.every((entry) => entry.pgid === tree.pgid),
      `every member is in the tree's group: ${describeMembers(flight)}`,
    );
    // The probe's own argv holds the marker; it must not list itself or an ancestor (this test process, the runner): the only
    // processes of this tree are the shell and the sleepers.
    assert.ok(
      flight.every((entry) => entry.comm === "sh" || entry.comm === "sleep"),
      `the probe must not list itself or an ancestor: ${describeMembers(flight)}`,
    );

    // Nothing in the tree is signalled by the probe: it is the same tree a second later.
    const again = await listTree(tree.marker, SECONDS, [tree.pgid]);
    assert.deepEqual(
      again.map((entry) => [entry.pid, entry.start, entry.state]),
      flight.map((entry) => [entry.pid, entry.start, entry.state]),
    );

    // (e) the surviving control: the tree left running is not dead.
    const survivors = judgeTree(flight, again);
    assert.equal(survivors.dead, false);
    assert.equal(survivors.sameProcess.length, flight.length);

    killGroup(tree);
    await tree.exited;
    let verdict = judgeTree(flight, again);
    await pollUntil(
      async () => {
        verdict = judgeTree(flight, await listTree(tree.marker, SECONDS, [tree.pgid]));
        return verdict.dead;
      },
      "the killed tree reads as dead",
      { timeoutMs: TREE_WAIT_MS, intervalMs: POLL_MS },
    );
    assert.equal(verdict.dead, true);
    assert.deepEqual(verdict.sameProcess, []);
  });
});

void test("the negative control: a fresh marker and durations with no tree list nothing", async () => {
  const marker = `realm-tree-probe-${randomBytes(6).toString("hex")}`;
  assert.deepEqual(await listTree(marker, SECONDS, []), []);
});

void test("the orphan case: with the shell killed alone, the sleepers are still found through the group and the tree is not dead", async () => {
  await withTree(async (tree) => {
    const flight = await waitForTree(tree);
    const shellPid = tree.shell.pid;
    assert.ok(shellPid !== undefined);
    process.kill(shellPid, "SIGKILL");
    await tree.exited;
    let orphans: readonly TreeMember[] = [];
    await pollUntil(
      async () => {
        orphans = await listTree(tree.marker, [], [tree.pgid]);
        return orphans.filter((entry) => entry.state !== "Z").length >= 2;
      },
      "the two sleepers outlive the shell and are found through the group",
      { timeoutMs: TREE_WAIT_MS, intervalMs: POLL_MS },
    );
    const verdict = judgeTree(flight, orphans);
    assert.equal(verdict.dead, false, `the sleepers are alive: ${describeMembers(orphans)}`);
    assert.equal(verdict.sameProcess.length >= 2, true, `they are the same processes as in flight: ${describeMembers(verdict.sameProcess)}`);
    assert.ok(
      SECONDS.every((duration) => verdict.running.some((entry) => entry.argv.endsWith(`sleep ${duration}`))),
      `both sleepers are running: ${describeMembers(verdict.running)}`,
    );
    killGroup(tree);
    await pollUntil(
      async () => judgeTree(flight, await listTree(tree.marker, SECONDS, [tree.pgid])).dead,
      "the orphans are killed with the group",
      { timeoutMs: TREE_WAIT_MS, intervalMs: POLL_MS },
    );
  });
});

void test("descendants are found through the parent rule alone: the marker on the shell is enough", async () => {
  await withTree(async (tree) => {
    const shellPid = tree.shell.pid;
    assert.ok(shellPid !== undefined);
    let found: readonly TreeMember[] = [];
    await pollUntil(
      async () => {
        found = await listTree(tree.marker, [], []);
        return found.length >= 3;
      },
      "the shell and its two children are listed with no durations and no groups",
      { timeoutMs: TREE_WAIT_MS, intervalMs: POLL_MS },
    );
    assert.ok(found.some((entry) => entry.pid === shellPid));
    const children = found.filter((entry) => entry.ppid === shellPid);
    assert.equal(children.length, 2, `both sleepers are children of the shell: ${describeMembers(found)}`);
  });
});
