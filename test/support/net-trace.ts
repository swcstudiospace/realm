// Network observer for the Omp harness (HARN-03, D-1205).
//
// The harness wraps the Omp process in `strace` (traceArgv) and, after the run, reads the trace file: parseConnects turns the
// `connect`, `sendto`, `sendmsg` and `sendmmsg` lines into NetConnect values, classify says what kind of peer each one names, and
// externalConnects / offenders report every peer that the explicit allowlist does not cover.
//
// Line shapes are those of strace 6.8 run as `strace -f -qq -ttt -o <file>`: with -f and -o each line starts with the bare pid, then
// the epoch time, then the call. A call that another thread interrupts prints as `... <unfinished ...>` and its result later on a
// `<... NAME resumed>` line of the same pid. The `[pid N]` prefix that strace writes to a terminal is accepted as well. Without -f
// strace prints no pid, and such lines are ignored.

/**
 * One socket peer named by a traced call. Frozen: other harness units import it.
 *
 * - `family` is the strace family name, for example `AF_INET`, `AF_INET6`, `AF_UNIX`, `AF_NETLINK`, `AF_UNSPEC`.
 * - `address` and `port` are set for `AF_INET` and `AF_INET6`; `path` is set for `AF_UNIX` (an abstract socket keeps strace's
 *   leading `@`).
 * - `result` is the errno name for a failed call (`EINPROGRESS`, `ECONNREFUSED`), the number strace printed for a call that
 *   returned (`0` for connect, the byte count for a send), `?` when strace printed no value, or `unfinished` when the trace ended
 *   before the call resumed.
 * - `time` is the epoch time in seconds that `-ttt` prints; it is absent when the trace carries none.
 */
export interface NetConnect {
  readonly pid: number;
  readonly family: string;
  readonly address?: string;
  readonly port?: number;
  readonly path?: string;
  readonly result: string;
  readonly time?: number;
}

export type NetClass = "unix" | "loopback" | "external" | "dns" | "ignored";

/** The peers a run may talk to; everything else is an offender. */
export interface NetAllow {
  /** Loopback ports a run may connect to. */
  readonly loopbackPorts: readonly number[];
  /** Allow loopback port 53 (name lookups through the local resolver). Absent or false reports it as an offender. */
  readonly allowDns?: boolean;
}

// Omp's local-model discovery probes these loopback ports at startup whatever the configuration: Ollama (11434), llama.cpp
// (8080) and LM Studio (1234) (12-RESEARCH.md 2.6). The probes are loopback only and carry no request to a remote host.
export const OMP_DISCOVERY_PORTS: readonly number[] = [11434, 8080, 1234];

/** The default allowlist: the scripted stub's port plus Omp's three local-model discovery ports. DNS stays an offender. */
export function defaultAllow(stubPort: number): NetAllow {
  return { loopbackPorts: [stubPort, ...OMP_DISCOVERY_PORTS] };
}

const TRACED_CALLS = "connect,sendto,sendmsg,sendmmsg";

/**
 * The argv prefix that wraps a command in strace, for the `wrap` option of the Omp RPC session:
 * `["strace", "-f", "-qq", "-ttt", "-e", "trace=...", "-o", outFile, "--"]`. The wrapped command follows it.
 */
export function traceArgv(outFile: string): string[] {
  return ["strace", "-f", "-qq", "-ttt", "-e", `trace=${TRACED_CALLS}`, "-o", outFile, "--"];
}

// `<pid> <epoch.time> <rest>`; the pid is bare (strace -f -o) or `[pid N]` (strace to a terminal). A line that starts with a bare
// epoch time (a trace taken without -f) does not match: the pid digits must be followed by whitespace.
const LINE = /^(?:\[pid\s+(\d+)\]|(\d+))\s+(?:(\d+\.\d+)\s+)?(.*)$/;
const CALL = /^(connect|sendto|sendmsg|sendmmsg)\((.*)$/;
const RESUMED = /^<\.\.\.\s+(connect|sendto|sendmsg|sendmmsg)\s+resumed>(.*)$/;
const UNFINISHED = /<unfinished \.\.\.>\s*$/;
const RESULT = /^.*\)\s+=\s+(.*)$/;
const RESULT_VALUE = /^(-?\d+|\?)(?:\s+(E[A-Z0-9]+))?/;
const SOCKADDR_MARK = "sa_family=";

/** The value strace printed after `=`: the errno name of a failure, else the number (or `?`). */
function resultOf(text: string): string {
  const match = RESULT.exec(text);
  if (match === null) return "unknown";
  const value = (match[1] ?? "").trim();
  const parts = RESULT_VALUE.exec(value);
  if (parts === null) return value === "" ? "unknown" : value;
  return parts[2] ?? parts[1] ?? "unknown";
}

/** The text of every sockaddr the call names, each starting at its `sa_family=`. */
function sockaddrSegments(call: string, args: string): string[] {
  if (call === "connect" || call === "sendto") {
    // connect names its peer first; sendto names it last, after a payload that is quoted and could itself contain the marker.
    const marker = `{${SOCKADDR_MARK}`;
    const at = call === "connect" ? args.indexOf(marker) : args.lastIndexOf(marker);
    return at < 0 ? [] : [args.slice(at + 1)];
  }
  const starts: number[] = [];
  for (const match of args.matchAll(/msg_name=\{sa_family=/g)) {
    starts.push(match.index + "msg_name={".length);
  }
  return starts.map((start, i) => args.slice(start, starts[i + 1] ?? args.length));
}

/** One sockaddr segment (starting at `sa_family=`) as a peer, or undefined when it has no family. */
function peerOf(pid: number, time: number | undefined, result: string, segment: string): NetConnect | undefined {
  const familyMatch = /^sa_family=(AF_[A-Z0-9_]+|\d+)/.exec(segment);
  const family = familyMatch?.[1];
  if (family === undefined) return undefined;
  let address: string | undefined;
  let port: number | undefined;
  let path: string | undefined;
  if (family === "AF_UNIX") {
    // A path can hold a brace, so the segment is not cut at the closing brace here.
    path = /sun_path=(@?"(?:[^"\\]|\\.)*")/.exec(segment)?.[1];
    if (path !== undefined) path = path.replace(/^(@?)"(.*)"$/, "$1$2");
  } else if (family === "AF_INET" || family === "AF_INET6") {
    const close = segment.indexOf("}");
    const body = close < 0 ? segment : segment.slice(0, close);
    const portText =
      family === "AF_INET" ? /sin_port=htons\((\d+)\)/.exec(body)?.[1] : /sin6_port=htons\((\d+)\)/.exec(body)?.[1];
    address =
      family === "AF_INET"
        ? /sin_addr=inet_addr\("([^"]*)"\)/.exec(body)?.[1]
        : /inet_pton\(AF_INET6, "([^"]*)"/.exec(body)?.[1];
    if (portText !== undefined) port = Number(portText);
  }
  return {
    pid,
    family,
    ...(address !== undefined ? { address } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(path !== undefined ? { path } : {}),
    result,
    ...(time !== undefined ? { time } : {}),
  };
}

/**
 * Parses an strace file into the peers its traced calls named, in trace order. Lines that are not a traced call (exit notices,
 * signals, blank lines) are skipped. A call split by `<unfinished ...>` is one entry whose result comes from the matching
 * `resumed` line of the same pid. A send without a destination name (a connected socket) names no peer and yields no entry.
 */
export function parseConnects(text: string): NetConnect[] {
  const out: NetConnect[] = [];
  const pending = new Map<number, number[]>();
  for (const raw of text.split("\n")) {
    const line = LINE.exec(raw.replace(/\r$/, ""));
    if (line === null) continue;
    const pid = Number(line[1] ?? line[2]);
    const time = line[3] === undefined ? undefined : Number(line[3]);
    const rest = line[4] ?? "";

    const resumed = RESUMED.exec(rest);
    if (resumed !== null) {
      const indexes = pending.get(pid);
      if (indexes === undefined) continue;
      pending.delete(pid);
      const result = resultOf(resumed[2] ?? "");
      for (const index of indexes) {
        const entry = out[index];
        if (entry !== undefined) out[index] = { ...entry, result };
      }
      continue;
    }

    const call = CALL.exec(rest);
    const callName = call?.[1];
    if (callName === undefined) continue;
    const args = call?.[2] ?? "";
    const unfinished = UNFINISHED.test(args);
    const result = unfinished ? "unfinished" : resultOf(args);
    const indexes: number[] = [];
    for (const segment of sockaddrSegments(callName, args)) {
      const peer = peerOf(pid, time, result, segment);
      if (peer === undefined) continue;
      indexes.push(out.length);
      out.push(peer);
    }
    if (unfinished && indexes.length > 0) pending.set(pid, indexes);
  }
  return out;
}

const LOOPBACK_V4 = /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const LOOPBACK_V4_MAPPED = /^::ffff:(127(?:\.\d{1,3}){3})$/i;
const DNS_PORT = 53;

function isLoopbackAddress(family: string, address: string | undefined): boolean {
  if (address === undefined) return false;
  if (family === "AF_INET") return LOOPBACK_V4.test(address);
  if (family === "AF_INET6") {
    if (address === "::1") return true;
    const mapped = LOOPBACK_V4_MAPPED.exec(address)?.[1];
    return mapped !== undefined && LOOPBACK_V4.test(mapped);
  }
  return false;
}

/**
 * Says what kind of peer a call named. `AF_UNIX` is `unix`; `AF_NETLINK` and `AF_UNSPEC` are `ignored`; an IPv4 `127.x.y.z`, IPv6
 * `::1` or `::ffff:127.x.y.z` peer is `loopback`, except port 53, which is `dns` (a lookup through the local resolver); every
 * other peer, including an `AF_INET*` peer with no readable address and any other family, is `external`. The call's result is not
 * considered: a refused or unreachable attempt still reached for the peer.
 */
export function classify(connect: NetConnect): NetClass {
  if (connect.family === "AF_UNIX") return "unix";
  if (connect.family === "AF_NETLINK" || connect.family === "AF_UNSPEC") return "ignored";
  if (isLoopbackAddress(connect.family, connect.address)) {
    return connect.port === DNS_PORT ? "dns" : "loopback";
  }
  return "external";
}

/** The peers that the allowlist does not cover: external peers, DNS unless allowed, and loopback ports not on the list. */
export function offenders(connects: readonly NetConnect[], allow: NetAllow): NetConnect[] {
  return connects.filter((connect) => {
    const kind = classify(connect);
    if (kind === "unix" || kind === "ignored") return false;
    if (kind === "dns") return allow.allowDns !== true;
    if (kind === "loopback") return connect.port === undefined || !allow.loopbackPorts.includes(connect.port);
    return true;
  });
}

/** Parses a trace file and returns its offenders for the allowlist. */
export function externalConnects(text: string, allow: NetAllow): NetConnect[] {
  return offenders(parseConnects(text), allow);
}

/** One peer as a report line: pid, time, family, target and result. */
export function describeConnect(connect: NetConnect): string {
  let target = "unknown";
  if (connect.path !== undefined) {
    target = connect.path;
  } else if (connect.address !== undefined) {
    const host = connect.address.includes(":") ? `[${connect.address}]` : connect.address;
    target = connect.port === undefined ? host : `${host}:${String(connect.port)}`;
  }
  const time = connect.time === undefined ? "?" : connect.time.toFixed(6);
  return `pid=${String(connect.pid)} t=${time} ${connect.family} ${target} -> ${connect.result} [${classify(connect)}]`;
}

/** The offender report for a failure message: the first `limit` (default 10) lines, then how many more there were. Empty for none. */
export function formatOffenders(list: readonly NetConnect[], limit = 10): string {
  if (list.length === 0) return "";
  const shown = list.slice(0, limit).map(describeConnect);
  const more = list.length - shown.length;
  const head = `${String(list.length)} unexpected network peer(s), first ${String(shown.length)}:`;
  return [head, ...shown, ...(more > 0 ? [`... and ${String(more)} more`] : [])].join("\n");
}
