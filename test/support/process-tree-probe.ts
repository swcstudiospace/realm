// A read-only probe of the process table, for the live proof that a timed-out exec is dead and not merely finished (Phase 39,
// EXEC-01; finding F-3 of the archived v5.0 ledger). The probe runs inside the sandbox as `node -e SCRIPT marker secondsList
// pgidList` through an argv exec. It lists every process of the exec's tree and never signals one.
//
// A process is a member when any rule holds:
//   1. one element of its argv equals the marker (the unique argument the exec carries);
//   2. its argv has exactly two elements, the first with the base name sleep and the second one of the sleeper durations;
//   3. its process group id is one of the group ids already seen in flight;
//   4. its parent is a member (repeated until nothing changes, so descendants are found).
// A zombie has an empty command line, so it is found only through rules 3 and 4. The probe skips its own pid, every ancestor of
// its own pid, and pid 1, so the AgentOS runner and the supervisor are never listed.
//
// Output, one line each: `count N`, then N lines `member PID PPID PGID STATE START COMM ARGV`. START is field 22 of the stat file,
// read after the last closing parenthesis, so a command name with spaces or parentheses cannot shift the fields. COMM has its spaces
// replaced by underscores. ARGV is the argv joined by single spaces, control characters replaced by question marks, clipped to
// 160 characters. A process that vanishes while it is read is skipped; any other read error prints nothing and exits 1.
//
// The module holds fixed text only: no secret and no environment value. The script contains no template literal, so it survives
// being passed as one argument.

// The process identity is the pid and the start time, so a recycled pid is neither a survivor nor a corpse.
export interface TreeMember {
  readonly pid: number;
  readonly ppid: number;
  readonly pgid: number;
  readonly state: string;
  readonly start: string;
  readonly comm: string;
  readonly argv: string;
}

const ARGV_CLIP = 160;

export const TREE_PROBE_SCRIPT =
  'const fs = require("node:fs");' +
  "const marker = process.argv[1];" +
  'const seconds = process.argv[2] === "-" ? [] : process.argv[2].split(",");' +
  'const groups = process.argv[3] === "-" ? [] : process.argv[3].split(",").map(Number);' +
  "const NUL = String.fromCharCode(0);" +
  'function vanished(error) { return error !== null && typeof error === "object" && (error.code === "ENOENT" || error.code === "ESRCH"); }' +
  "function readStat(pid) {" +
  "  let raw;" +
  '  try { raw = fs.readFileSync("/proc/" + pid + "/stat", "utf8"); } catch (error) { if (vanished(error)) { return null; } throw error; }' +
  '  const open = raw.indexOf("(");' +
  '  const close = raw.lastIndexOf(")");' +
  '  if (open < 0 || close < open) { throw new Error("unparseable stat file for " + pid); }' +
  '  const rest = raw.slice(close + 2).split(" ");' +
  '  if (rest.length < 20) { throw new Error("short stat file for " + pid); }' +
  "  return {" +
  "    pid: pid, ppid: Number(rest[1]), pgid: Number(rest[2]), state: rest[0], start: rest[19]," +
  '    comm: raw.slice(open + 1, close).replace(/[\\s\\u0000-\\u001f\\u007f]/g, "_") || "?",' +
  "    argv: []," +
  "  };" +
  "}" +
  "function run() {" +
  "  const skip = new Set([1, process.pid]);" +
  "  let cursor = process.pid;" +
  "  for (let hops = 0; hops < 64 && cursor > 1; hops += 1) {" +
  "    const self = readStat(cursor);" +
  "    if (self === null) { break; }" +
  "    skip.add(self.ppid);" +
  "    cursor = self.ppid;" +
  "  }" +
  "  const all = [];" +
  '  for (const name of fs.readdirSync("/proc")) {' +
  "    if (!/^[0-9]+$/.test(name)) { continue; }" +
  "    const pid = Number(name);" +
  "    if (skip.has(pid)) { continue; }" +
  "    const entry = readStat(pid);" +
  "    if (entry === null) { continue; }" +
  "    let raw;" +
  '    try { raw = fs.readFileSync("/proc/" + name + "/cmdline", "utf8"); } catch (error) { if (vanished(error)) { continue; } throw error; }' +
  "    const argv = raw.split(NUL);" +
  '    if (argv.length > 0 && argv[argv.length - 1] === "") { argv.pop(); }' +
  "    entry.argv = argv;" +
  "    all.push(entry);" +
  "  }" +
  "  const members = new Map();" +
  "  for (const entry of all) {" +
  "    const argv = entry.argv;" +
  "    const named = argv.indexOf(marker) >= 0;" +
  '    const sleeper = argv.length === 2 && argv[0].split("/").pop() === "sleep" && seconds.indexOf(argv[1]) >= 0;' +
  "    if (named || sleeper || groups.indexOf(entry.pgid) >= 0) { members.set(entry.pid, entry); }" +
  "  }" +
  "  let changed = true;" +
  "  while (changed) {" +
  "    changed = false;" +
  "    for (const entry of all) {" +
  "      if (!members.has(entry.pid) && members.has(entry.ppid)) { members.set(entry.pid, entry); changed = true; }" +
  "    }" +
  "  }" +
  "  const list = Array.from(members.values()).sort((left, right) => left.pid - right.pid);" +
  '  const lines = ["count " + list.length];' +
  "  for (const entry of list) {" +
  '    const text = entry.argv.join(" ").replace(/[\\u0000-\\u001f\\u007f]/g, "?").slice(0, ' +
  String(ARGV_CLIP) +
  ");" +
  '    lines.push(["member", entry.pid, entry.ppid, entry.pgid, entry.state, entry.start, entry.comm].join(" ") + " " + text);' +
  "  }" +
  '  console.log(lines.join("\\n"));' +
  "}" +
  "try { run(); } catch (error) { process.exitCode = 1; }";

const MARKER_PATTERN = /^[a-z0-9-]{8,64}$/;
const DIGITS = /^[0-9]+$/;

// The argv of the probe exec. Refuses anything the script would have to interpret loosely.
export function treeProbeArgv(marker: string, seconds: readonly string[], groups: readonly number[]): readonly string[] {
  if (!MARKER_PATTERN.test(marker)) {
    throw new Error("the process-tree probe marker must be 8 to 64 lowercase letters, digits and dashes");
  }
  if (!seconds.every((value) => DIGITS.test(value))) {
    throw new Error("the process-tree probe sleeper durations must be digits");
  }
  if (!groups.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("the process-tree probe group ids must be non-negative integers");
  }
  return ["node", "-e", TREE_PROBE_SCRIPT, marker, seconds.length === 0 ? "-" : seconds.join(","), groups.length === 0 ? "-" : groups.join(",")];
}

export type TreeListing = { readonly ok: true; readonly members: readonly TreeMember[] } | { readonly ok: false; readonly detail: string };

const COUNT_LINE = /^count ([0-9]+)$/;
const MEMBER_LINE = /^member ([0-9]+) ([0-9]+) ([0-9]+) (\S) ([0-9]+) (\S+)(?: (.*))?$/;

function clipForDetail(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > ARGV_CLIP ? `${flat.slice(0, ARGV_CLIP)}...` : flat;
}

// Reads the probe's stdout. A listing that is not exactly the grammar above is a failure, never "no process": the empty tree is
// the valid answer `count 0` and nothing else.
export function parseTreeListing(stdout: string): TreeListing {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
  const first = lines[0];
  if (first === undefined) {
    return { ok: false, detail: "the process-tree probe printed nothing" };
  }
  const counted = COUNT_LINE.exec(first);
  if (counted === null) {
    return { ok: false, detail: `the process-tree probe did not start with a count line: ${clipForDetail(first)}` };
  }
  const count = Number(counted[1]);
  const members: TreeMember[] = [];
  for (const line of lines.slice(1)) {
    const parts = MEMBER_LINE.exec(line);
    if (parts === null) {
      return { ok: false, detail: `the process-tree probe printed an unexpected line: ${clipForDetail(line)}` };
    }
    members.push({
      pid: Number(parts[1]),
      ppid: Number(parts[2]),
      pgid: Number(parts[3]),
      state: parts[4] ?? "",
      start: parts[5] ?? "",
      comm: parts[6] ?? "",
      argv: parts[7] ?? "",
    });
  }
  if (members.length !== count) {
    return { ok: false, detail: `the process-tree probe announced ${String(count)} member(s) and printed ${String(members.length)}` };
  }
  return { ok: true, members };
}

export interface TreeVerdict {
  // True when no member of the later listing is running (a zombie is dead but still visible).
  readonly dead: boolean;
  readonly running: readonly TreeMember[];
  readonly zombies: readonly TreeMember[];
  // The running members that are the same process as a member of the in-flight listing (pid and start time both equal).
  readonly sameProcess: readonly TreeMember[];
}

// Judges a later listing against the last in-flight one.
export function judgeTree(flight: readonly TreeMember[], after: readonly TreeMember[]): TreeVerdict {
  // Z (zombie) and X (dead) are dead but may stay visible until the parent reaps them.
  const isDead = (member: TreeMember): boolean => member.state === "Z" || member.state === "X";
  const running = after.filter((member) => !isDead(member));
  const zombies = after.filter(isDead);
  const sameProcess = running.filter((member) => flight.some((seen) => seen.pid === member.pid && seen.start === member.start));
  return { dead: running.length === 0, running, zombies, sameProcess };
}

function argvTokens(member: TreeMember): readonly string[] {
  return member.argv === "" ? [] : member.argv.split(" ");
}

export function holdsMarker(member: TreeMember, marker: string): boolean {
  return argvTokens(member).includes(marker);
}

export function isSleeperOf(member: TreeMember, seconds: string): boolean {
  const tokens = argvTokens(member);
  return tokens.length === 2 && tokens[0]?.split("/").pop() === "sleep" && tokens[1] === seconds;
}

// The positive control. Undefined when the in-flight listing shows at least three members, one that holds the marker, one for
// each wanted sleeper duration, with the marker member and every duration member in one process group; otherwise a one-line
// detail naming what is missing. A wrapper process the sandbox adds above the group, or the timeout process of a fixed build, may
// or may not be listed and is not required. A duration in `escaped` must be present but may sit in another group (a process that
// left the group on purpose).
export function controlsHold(flight: readonly TreeMember[], marker: string, seconds: readonly string[], escaped: readonly string[] = []): string | undefined {
  const named = flight.find((member) => holdsMarker(member, marker));
  const missing: string[] = [];
  if (flight.length < 3) {
    missing.push(`only ${String(flight.length)} member(s) listed, 3 needed`);
  }
  if (named === undefined) {
    missing.push("no member holds the marker");
  }
  for (const duration of [...seconds, ...escaped]) {
    const found = flight.find((member) => isSleeperOf(member, duration));
    if (found === undefined) {
      missing.push(`no sleep ${duration} member`);
    } else if (named !== undefined && !escaped.includes(duration) && found.pgid !== named.pgid) {
      missing.push(`sleep ${duration} (pid ${String(found.pid)}) is in group ${String(found.pgid)}, not the marker member's group ${String(named.pgid)}`);
    }
  }
  return missing.length === 0 ? undefined : `${missing.join("; ")}; listed: ${describeMembers(flight)}`;
}

// The process group the exec's tree ran in: the group of the member that holds the marker. Undefined when none holds it.
export function recordedGroups(flight: readonly TreeMember[], marker: string): readonly number[] {
  const named = flight.find((member) => holdsMarker(member, marker));
  return named === undefined ? [] : [named.pgid];
}

// One member as text: pid, state, group and argv, for messages and the evidence files.
export function describeMember(member: TreeMember): string {
  return `pid ${String(member.pid)} ppid ${String(member.ppid)} pgid ${String(member.pgid)} state ${member.state} start ${member.start} [${member.argv === "" ? member.comm : member.argv}]`;
}

export function describeMembers(members: readonly TreeMember[]): string {
  return members.length === 0 ? "none" : members.map(describeMember).join("; ");
}
