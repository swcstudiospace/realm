// Network observer tests (HARN-03). They need no strace. The named line constants below were produced by `strace -f -qq -ttt -e
// trace=connect,sendto,sendmsg,sendmmsg -o <file>` (strace 6.8, Linux x64) around a short script that made each kind of call, and
// are pasted as printed. Lines marked "same shape" reuse a captured call's exact text with another address or prefix, and the
// inline lines inside individual tests (sendmmsg, a payload that spells a sockaddr, a line without a time, noise lines) are built
// by hand in the same format.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  defaultAllow,
  describeConnect,
  externalConnects,
  formatOffenders,
  offenders,
  parseConnects,
  traceArgv,
  type NetConnect,
} from "../support/net-trace.js";

const LOOPBACK_V4 =
  '4180502 1793282744.034028 connect(4, {sa_family=AF_INET, sin_port=htons(59329), sin_addr=inet_addr("127.0.0.1")}, 16) = 0';
const EXTERNAL_V6 =
  '4180502 1793282744.034446 connect(6, {sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2606:4700:4700::1111", &sin6_addr), sin6_scope_id=0}, 28) = -1 EINPROGRESS (Operation now in progress)';
const EXTERNAL_V4 =
  '4180502 1793282744.034716 connect(8, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("1.1.1.1")}, 16) = -1 EINPROGRESS (Operation now in progress)';
const RESOLVER_SENDTO =
  '4180502 1793282744.035015 sendto(9, "x", 1, 0, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, 16) = 1';
const EXTERNAL_SENDTO =
  '4180502 1793282744.035329 sendto(9, "x", 1, 0, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("8.8.8.8")}, 16) = 1';
const UNIX_REFUSED =
  '4180502 1793282744.035772 connect(10, {sa_family=AF_UNIX, sun_path="/nonexistent"}, 15) = -1 ECONNREFUSED (Connection refused)';
const UNIX_ABSTRACT =
  '4182545 1793282764.741651 connect(8, {sa_family=AF_UNIX, sun_path=@"abstract"}, 11) = -1 ECONNREFUSED (Connection refused)';
const LOOPBACK_V6 =
  '4180502 1793282744.036042 connect(13, {sa_family=AF_INET6, sin6_port=htons(51143), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "::1", &sin6_addr), sin6_scope_id=0}, 28) = 0';
const UNSPEC =
  '4184004 1793282776.640357 connect(3, {sa_family=AF_UNSPEC, sa_data="\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0"}, 16) = 0';
const NETLINK = '4182545 1793282764.741557 connect(6, {sa_family=AF_NETLINK, nl_pad=0x1555, nl_pid=0, nl_groups=00000000}, 12) = 0';
const SENDMSG_V4 =
  '4182545 1793282764.740665 sendmsg(3, {msg_name={sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("8.8.8.8")}, msg_namelen=16, msg_iov=[{iov_base="x", iov_len=1}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, 0) = 1';
const SENDMSG_V6 =
  '4182545 1793282764.741035 sendmsg(4, {msg_name={sa_family=AF_INET6, sin6_port=htons(53), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2001:4860:4860::8888", &sin6_addr), sin6_scope_id=0}, msg_namelen=28, msg_iov=[{iov_base="x", iov_len=1}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, 0) = 1';
const SENDTO_MAPPED =
  '4182545 1793282764.741201 sendto(4, "x", 1, 0, {sa_family=AF_INET6, sin6_port=htons(9), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "::ffff:127.0.0.1", &sin6_addr), sin6_scope_id=0}, 28) = 1';
const ANY_V4 =
  '4182545 1793282764.741437 connect(3, {sa_family=AF_INET, sin_port=htons(0), sin_addr=inet_addr("0.0.0.0")}, 16) = 0';
const REFUSED_LOOPBACK =
  '4182545 1793282765.422271 connect(10, {sa_family=AF_INET, sin_port=htons(1), sin_addr=inet_addr("127.0.0.1")}, 16) = -1 ECONNREFUSED (Connection refused)';
const UNFINISHED_A =
  '4184058 1793282776.645127 connect(6, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("10.255.255.1")}, 16 <unfinished ...>';
const UNFINISHED_B =
  '4184060 1793282776.645916 connect(10, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("10.255.255.1")}, 16 <unfinished ...>';
const RESUMED_B = "4184060 1793282777.727654 <... connect resumed>) = -1 ETIMEDOUT (Connection timed out)";
const RESUMED_A = "4184058 1793282777.727705 <... connect resumed>) = -1 ETIMEDOUT (Connection timed out)";
// Same shape as LOOPBACK_V4 with the systemd-resolved stub address and port, and with the bracketed pid prefix strace writes
// to a terminal.
const RESOLVER_CONNECT =
  '4180502 1793282744.035100 connect(9, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, 16) = 0';
const BRACKETED_PID =
  '[pid  4180502] 1793282744.034028 connect(4, {sa_family=AF_INET, sin_port=htons(59329), sin_addr=inet_addr("127.0.0.1")}, 16) = 0';

function only(line: string): NetConnect {
  const parsed = parseConnects(line);
  assert.equal(parsed.length, 1, `one peer expected from: ${line}`);
  const first = parsed[0];
  assert.ok(first !== undefined);
  return first;
}

void test("traceArgv builds the strace prefix with the output file and the end-of-options marker", () => {
  assert.deepEqual(traceArgv("trace.out"), [
    "strace",
    "-f",
    "-qq",
    "-ttt",
    "-e",
    "trace=connect,sendto,sendmsg,sendmmsg",
    "-o",
    "trace.out",
    "--",
  ]);
});

void test("a loopback IPv4 connect parses to its pid, time, address, port and result", () => {
  const connect = only(LOOPBACK_V4);
  assert.deepEqual(connect, {
    pid: 4180502,
    family: "AF_INET",
    address: "127.0.0.1",
    port: 59329,
    result: "0",
    time: 1793282744.034028,
  });
  assert.equal(classify(connect), "loopback");
});

void test("a loopback IPv6 connect classifies as loopback", () => {
  const connect = only(LOOPBACK_V6);
  assert.equal(connect.family, "AF_INET6");
  assert.equal(connect.address, "::1");
  assert.equal(connect.port, 51143);
  assert.equal(classify(connect), "loopback");
});

void test("an IPv4-mapped loopback sendto classifies as loopback", () => {
  const connect = only(SENDTO_MAPPED);
  assert.equal(connect.address, "::ffff:127.0.0.1");
  assert.equal(connect.port, 9);
  assert.equal(classify(connect), "loopback");
});

void test("a refused connect to loopback is still loopback and keeps the errno name", () => {
  const connect = only(REFUSED_LOOPBACK);
  assert.equal(connect.result, "ECONNREFUSED");
  assert.equal(classify(connect), "loopback");
});

void test("loopback port 53 classifies as dns for connect and sendto", () => {
  const viaConnect = only(RESOLVER_CONNECT);
  assert.equal(viaConnect.address, "127.0.0.53");
  assert.equal(viaConnect.port, 53);
  assert.equal(classify(viaConnect), "dns");
  const viaSendto = only(RESOLVER_SENDTO);
  assert.equal(viaSendto.result, "1");
  assert.equal(classify(viaSendto), "dns");
});

void test("an external IPv4 connect is external and reports EINPROGRESS", () => {
  const connect = only(EXTERNAL_V4);
  assert.equal(connect.address, "1.1.1.1");
  assert.equal(connect.port, 443);
  assert.equal(connect.result, "EINPROGRESS");
  assert.equal(classify(connect), "external");
});

void test("an external IPv6 connect is external", () => {
  const connect = only(EXTERNAL_V6);
  assert.equal(connect.family, "AF_INET6");
  assert.equal(connect.address, "2606:4700:4700::1111");
  assert.equal(connect.port, 443);
  assert.equal(connect.result, "EINPROGRESS");
  assert.equal(classify(connect), "external");
});

void test("an AF_UNIX connect carries its path and classifies as unix, abstract sockets keep their @", () => {
  const filesystem = only(UNIX_REFUSED);
  assert.equal(filesystem.family, "AF_UNIX");
  assert.equal(filesystem.path, "/nonexistent");
  assert.equal(filesystem.address, undefined);
  assert.equal(filesystem.result, "ECONNREFUSED");
  assert.equal(classify(filesystem), "unix");
  const abstract = only(UNIX_ABSTRACT);
  assert.equal(abstract.path, "@abstract");
  assert.equal(classify(abstract), "unix");
});

void test("AF_UNSPEC and AF_NETLINK are ignored", () => {
  const unspec = only(UNSPEC);
  assert.equal(unspec.family, "AF_UNSPEC");
  assert.equal(classify(unspec), "ignored");
  const netlink = only(NETLINK);
  assert.equal(netlink.family, "AF_NETLINK");
  assert.equal(classify(netlink), "ignored");
});

void test("unconnected UDP is caught through the destination name of sendto and sendmsg", () => {
  const sendto = only(EXTERNAL_SENDTO);
  assert.equal(sendto.address, "8.8.8.8");
  assert.equal(sendto.port, 53);
  assert.equal(classify(sendto), "external");
  const sendmsg = only(SENDMSG_V4);
  assert.equal(sendmsg.address, "8.8.8.8");
  assert.equal(sendmsg.port, 53);
  assert.equal(classify(sendmsg), "external");
  const sendmsg6 = only(SENDMSG_V6);
  assert.equal(sendmsg6.address, "2001:4860:4860::8888");
  assert.equal(sendmsg6.port, 53);
  assert.equal(classify(sendmsg6), "external");
});

void test("a sendto payload that spells a sockaddr does not replace the real destination", () => {
  const line =
    '77 1793282744.5 sendto(9, "{sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr(\\"127.0.0.1\\")}", 70, 0, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("9.9.9.9")}, 16) = 70';
  const connect = only(line);
  assert.equal(connect.address, "9.9.9.9");
  assert.equal(classify(connect), "external");
});

void test("a send without a destination name and the strace noise lines yield no entry", () => {
  const text = [
    '4180502 1793282744.1 sendto(9, "x", 1, 0, NULL, 0) = 1',
    '4180502 1793282744.2 sendmsg(9, {msg_name=NULL, msg_namelen=0, msg_iov=[{iov_base="x", iov_len=1}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, 0) = 1',
    "4180502 1793282744.3 +++ exited with 0 +++",
    "4180502 1793282744.4 --- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=4180503, si_uid=0, si_status=0, si_utime=0, si_stime=0} ---",
    "1793282744.5 connect(4, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr(\"1.1.1.1\")}, 16) = 0",
    "",
    "garbage",
  ].join("\n");
  assert.deepEqual(parseConnects(text), []);
});

void test("a sendmmsg with two names yields one entry per name", () => {
  const line =
    '55 1793282744.9 sendmmsg(3, [{msg_hdr={msg_name={sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, msg_namelen=16, msg_iov=[{iov_base="a", iov_len=1}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, msg_len=1}, {msg_hdr={msg_name={sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("8.8.4.4")}, msg_namelen=16, msg_iov=[{iov_base="b", iov_len=1}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, msg_len=1}], 2, 0) = 2';
  const parsed = parseConnects(line);
  assert.deepEqual(
    parsed.map((connect) => [connect.address, classify(connect), connect.result]),
    [
      ["127.0.0.53", "dns", "2"],
      ["8.8.4.4", "external", "2"],
    ],
  );
});

void test("the bracketed pid prefix of a terminal trace parses like the bare one", () => {
  assert.deepEqual(only(BRACKETED_PID), only(LOOPBACK_V4));
});

void test("a line without a time keeps no time", () => {
  const connect = only('300 connect(4, {sa_family=AF_INET, sin_port=htons(8080), sin_addr=inet_addr("127.0.0.1")}, 16) = 0');
  assert.equal(connect.pid, 300);
  assert.equal(connect.port, 8080);
  assert.equal("time" in connect, false);
});

void test("only 127.x.y.z is loopback: other private and wildcard addresses are external", () => {
  const external = ["10.0.0.1", "172.16.0.9", "192.168.1.1", "0.0.0.0", "128.0.0.1", "127.0.0.1.5", "1127.0.0.1"];
  for (const address of external) {
    const connect: NetConnect = { pid: 1, family: "AF_INET", address, port: 80, result: "0" };
    assert.equal(classify(connect), "external", address);
  }
  const loopback = ["127.0.0.1", "127.1.2.3", "127.255.255.255"];
  for (const address of loopback) {
    const connect: NetConnect = { pid: 1, family: "AF_INET", address, port: 80, result: "0" };
    assert.equal(classify(connect), "loopback", address);
  }
  assert.equal(only(ANY_V4).address, "0.0.0.0");
  assert.equal(classify(only(ANY_V4)), "external");
  const unnamed: NetConnect = { pid: 1, family: "AF_INET", result: "0" };
  assert.equal(classify(unnamed), "external");
  const other: NetConnect = { pid: 1, family: "AF_PACKET", result: "0" };
  assert.equal(classify(other), "external");
});

void test("several pids interleave in trace order and keep their own pid", () => {
  const text = [LOOPBACK_V4, EXTERNAL_V4, UNIX_REFUSED, SENDMSG_V4, `4182608 1793282764.930279 ${EXTERNAL_V4.split(" ").slice(2).join(" ")}`].join("\n");
  const parsed = parseConnects(text);
  assert.deepEqual(
    parsed.map((connect) => connect.pid),
    [4180502, 4180502, 4180502, 4182545, 4182608],
  );
  assert.equal(parsed[4]?.time, 1793282764.930279);
});

void test("an unfinished call takes the result of its resumed line, per pid, even when the lines interleave", () => {
  const text = [UNFINISHED_A, UNFINISHED_B, LOOPBACK_V4, RESUMED_B, RESUMED_A].join("\n");
  const parsed = parseConnects(text);
  assert.deepEqual(
    parsed.map((connect) => [connect.pid, connect.result]),
    [
      [4184058, "ETIMEDOUT"],
      [4184060, "ETIMEDOUT"],
      [4180502, "0"],
    ],
  );
  // The entry keeps the address and the time of the call, not of the resume.
  assert.equal(parsed[0]?.address, "10.255.255.1");
  assert.equal(parsed[0].time, 1793282776.645127);
  assert.equal(classify(parsed[0]), "external");
});

void test("an unfinished call that never resumes is reported as unfinished, and a resumed line without a call is skipped", () => {
  const parsed = parseConnects([RESUMED_A, UNFINISHED_A].join("\n"));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.result, "unfinished");
  assert.equal(classify(parsed[0]), "external");
});

void test("a resumed line that succeeds replaces the unfinished marker with its number", () => {
  const resumed = "4184058 1793282776.9 <... connect resumed>) = 0";
  const parsed = parseConnects([UNFINISHED_A, resumed].join("\n"));
  assert.equal(parsed[0]?.result, "0");
});

void test("windows line endings do not break the parse", () => {
  const parsed = parseConnects(`${LOOPBACK_V4}\r\n${EXTERNAL_V4}\r\n`);
  assert.deepEqual(
    parsed.map((connect) => connect.result),
    ["0", "EINPROGRESS"],
  );
});

void test("the default allowlist covers the stub port and Omp's three local-model discovery ports", () => {
  const allow = defaultAllow(43210);
  assert.deepEqual([...allow.loopbackPorts].sort((a, b) => a - b), [1234, 8080, 11434, 43210]);
  const probes = [43210, 11434, 8080, 1234].map(
    (port): NetConnect => ({ pid: 1, family: "AF_INET", address: "127.0.0.1", port, result: "0" }),
  );
  assert.deepEqual(offenders(probes, allow), []);
});

void test("offenders reports external peers, DNS and loopback ports off the list, and spares unix, netlink and unspec", () => {
  const text = [
    LOOPBACK_V4, // port 59329, not on the list
    EXTERNAL_V6,
    EXTERNAL_V4,
    RESOLVER_SENDTO,
    UNIX_REFUSED,
    NETLINK,
    UNSPEC,
    '9 1793282745.0 connect(5, {sa_family=AF_INET, sin_port=htons(43210), sin_addr=inet_addr("127.0.0.1")}, 16) = 0',
    '9 1793282745.1 connect(5, {sa_family=AF_INET, sin_port=htons(11434), sin_addr=inet_addr("127.0.0.1")}, 16) = -1 ECONNREFUSED (Connection refused)',
  ].join("\n");
  const found = externalConnects(text, defaultAllow(43210));
  assert.deepEqual(
    found.map((connect) => `${connect.address ?? ""}:${String(connect.port ?? "")}`),
    ["127.0.0.1:59329", "2606:4700:4700::1111:443", "1.1.1.1:443", "127.0.0.53:53"],
  );
});

void test("allowDns lets the resolver through and nothing else changes", () => {
  const text = [RESOLVER_SENDTO, RESOLVER_CONNECT, EXTERNAL_V4].join("\n");
  const strict = externalConnects(text, defaultAllow(1));
  assert.equal(strict.length, 3);
  const withDns = externalConnects(text, { ...defaultAllow(1), allowDns: true });
  assert.deepEqual(
    withDns.map((connect) => connect.address),
    ["1.1.1.1"],
  );
});

void test("a clean trace has no offenders and an empty report", () => {
  const text = [
    '10 1793282746.0 connect(5, {sa_family=AF_INET, sin_port=htons(43210), sin_addr=inet_addr("127.0.0.1")}, 16) = 0',
    UNIX_REFUSED,
    NETLINK,
  ].join("\n");
  const found = externalConnects(text, defaultAllow(43210));
  assert.deepEqual(found, []);
  assert.equal(formatOffenders(found), "");
});

void test("the offender report lists the first 10 with pid and time and counts the rest", () => {
  const many: NetConnect[] = Array.from({ length: 13 }, (_, i) => ({
    pid: 1000 + i,
    family: "AF_INET",
    address: `203.0.113.${String(i + 1)}`,
    port: 443,
    result: "EINPROGRESS",
    time: 1793282744 + i / 1000,
  }));
  const report = formatOffenders(many);
  const lines = report.split("\n");
  assert.equal(lines.length, 12, "header, ten offenders, the remainder line");
  assert.equal(lines[0], "13 unexpected network peer(s), first 10:");
  assert.equal(lines[1], "pid=1000 t=1793282744.000000 AF_INET 203.0.113.1:443 -> EINPROGRESS [external]");
  assert.equal(lines[10], "pid=1009 t=1793282744.009000 AF_INET 203.0.113.10:443 -> EINPROGRESS [external]");
  assert.equal(lines[11], "... and 3 more");
  assert.ok(!report.includes("203.0.113.11:"), "the eleventh offender is not listed");
});

void test("the offender report has no remainder line at or below the limit, and honours a custom limit", () => {
  const three: NetConnect[] = [1, 2, 3].map((i) => ({ pid: i, family: "AF_INET6", address: "2001:db8::1", port: 443, result: "?" }));
  const full = formatOffenders(three);
  assert.equal(full.split("\n").length, 4);
  assert.ok(!full.includes("more"));
  const limited = formatOffenders(three, 2).split("\n");
  assert.deepEqual(limited, [
    "3 unexpected network peer(s), first 2:",
    "pid=1 t=? AF_INET6 [2001:db8::1]:443 -> ? [external]",
    "pid=2 t=? AF_INET6 [2001:db8::1]:443 -> ? [external]",
    "... and 1 more",
  ]);
});

void test("describeConnect names a unix path and a peer without an address", () => {
  assert.equal(
    describeConnect({ pid: 7, family: "AF_UNIX", path: "/run/x.sock", result: "0", time: 1.5 }),
    "pid=7 t=1.500000 AF_UNIX /run/x.sock -> 0 [unix]",
  );
  assert.equal(describeConnect({ pid: 8, family: "AF_PACKET", result: "0" }), "pid=8 t=? AF_PACKET unknown -> 0 [external]");
});
