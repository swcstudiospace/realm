// Gated live suite for the production stack (PRD-TST-02, PRD-TST-03).
//
// It runs the real stack under the realm account (the realm CLI, the daemon it spawns, the OpenShell gateway, the realm compute
// driver and rootless Podman 5.x) and verifies by behaviour what an operator would otherwise check by hand: the sandbox's
// identity and confinement, its filesystem and device policy, the keyring seccomp rules, the AgentOS probe, file movement in and
// out, egress, recovery after a daemon crash, the MCP exec and file tools through `realm mcp`, and a clean teardown.
//
// Gate. The whole file skips, with a reason that names the FIRST missing prerequisite, unless all of these hold:
//   1. REALM_LIVE_PRODUCTION=1. An explicit operator opt-in; the test never sets it.
//   2. Podman 5.x on PATH.
//   3. REALM_LIVE_IMAGE: the digest-pinned image the running driver was given.
//   4. REALM_LIVE_DRIVER_CONFIG: absolute path of the config.json the running driver reads. The roots come from that file.
//      A stale REALM_DRIVER_*_ROOT variable is ignored.
//   5. A rootless Podman API socket under XDG_RUNTIME_DIR.
//   6. The openshell CLI on PATH.
//   7. The built CLI at dist/src/cli/main.js, next to the compiled tests (npm run build).
// A default npm test therefore skips every scenario below (ten in all: default policy, immediate cycle, egress allowlist, wrong
// image digest, crash recovery, MCP exec, the MCP exec timeout, the AgentOS runner exit, the daemon-side startup budget and a stopped gateway) and
// reports each as skipped.
//
// Preconditions the suite cannot check and the operator must provide:
//   - The gateway and the compute driver run under the realm account with the same image and roots the variables above name.
//   - The openshell CLI has the realm gateway registered as its default (the CLI receives only PATH, HOME and XDG_RUNTIME_DIR).
//   - The pinned workspace root is empty, no other live sandbox holds it, and the account's Podman holds no other container.
//
// Removal scope. The suite creates and removes only its own sandbox (realm-daemon) and its own temporary directories. Each
// scenario builds its own XDG config home with realm/config.json and a policy.json, and runs the CLI through execFile on the
// current node binary with an explicit environment: PATH, HOME and XDG_RUNTIME_DIR from the test's own environment, the
// scenario's XDG_CONFIG_HOME and the three driver roots. Every scenario runs `realm down` in its cleanup, even on failure, and
// then waits (bounded at 90 s) for zero containers, zero realm-* sandboxes, no realm-daemon directory under the secret and
// sandbox-state roots, and an empty pinned workspace. The scenarios share one pinned root, so they run one after another.
// Files the suite may leave in the pinned workspace are named in WORKSPACE_FILES below; cleanup removes exactly those names.
// The only host process it ever signals is the one daemon the crash scenario's own `realm up` started: the process whose whole
// command is the current node binary and the compiled daemon entry, owned by the current uid, SIGKILLed only when exactly one
// such process exists. The runner-exit scenario signals only the AgentOS runner inside its own sandbox, through the sandbox exec.
// The MCP scenarios start one `realm mcp` child each with the same explicit environment, and kill it in cleanup if it is still
// running.
//
// Nothing here prints a secret. Failure messages carry exit codes, error codes, names and clipped probe output.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test, type TestContext } from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { DEFAULT_AGENTOS_PROBE_PATH } from "../../src/runtime/agentos-driver.js";
import { SANDBOX_WORKSPACE_PATH } from "../../src/runtime/openshell.js";
import {
  KILL_RUNNER_ARGV,
  UNKNOWN_DIGEST_IMAGE,
  canConnect,
  cleanupScenario,
  createScenarioEnvironment,
  decodeReadContent,
  describeResult,
  describeValue,
  findDaemonPids,
  isBenchmarkAddress,
  isDirectory,
  isSocket,
  listDaemonContainers,
  listDaemonSandboxes,
  listeningSocketsOf,
  nodeConnectArgv,
  nodeResolveArgv,
  onPath,
  openshellCli,
  parseNodeProbe,
  parseProbeFields,
  pollUntil,
  probePodman,
  noticeOfStatus,
  productionSkipReason,
  readLiveInputs,
  reapCountsOfNotice,
  realmCli,
  runCommand,
  sandboxExec,
  startMcpSession,
  startupReapLineFor,
  stateOfStatus,
  statusFieldsOf,
  toolErrorOf,
  waitForActive,
  waitForNoContainers,
  waitForNoResidue,
  DAEMON_SANDBOX_NAME,
  type CommandResult,
  type StatusFields,
  type NodeProbeResult,
  type LiveInputs,
  type Listing,
  type McpSession,
  type ScenarioEnvironment,
  type ScenarioSpec,
} from "../support/production-live.js";

// The compiled CLI beside the compiled tests: this file runs from dist/test/integration, the CLI from dist/src/cli.
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));
// The compiled daemon entry beside the CLI (dist/src/daemon/main.js). The CLI derives the same path (src/cli/main.ts
// defaultDaemonEntry) and starts the daemon as `<node binary> <entry>` with no other argument (spawnDetachedDaemon).
const DAEMON_ENTRY = fileURLToPath(new URL("../../src/daemon/main.js", import.meta.url));

const probe = await probePodman();
const gate = productionSkipReason({
  env: process.env,
  podman: probe,
  isSocket,
  onPath: (name) => onPath(name, process.env["PATH"]),
  exists: existsSync,
  isDirectory,
  cliPath: CLI_PATH,
});
const live: LiveInputs | undefined = gate === false ? readLiveInputs(process.env, CLI_PATH) : undefined;

function inputs(): LiveInputs {
  if (live === undefined) {
    throw new Error("a production live scenario ran although its gate is closed");
  }
  return live;
}

// Each scenario is bounded at 5 minutes. realm up has its own 200 s startup budget, so a stuck up fails the scenario, not the run.
const SCENARIO_TIMEOUT_MS = 300_000;
// The bounds for one realm CLI call; the scenario timeout still caps the sum.
const UP_TIMEOUT_MS = 240_000;
const DOWN_TIMEOUT_MS = 120_000;
const STATUS_TIMEOUT_MS = 30_000;
// The bound on the crash scenario's checks that the daemon is gone and its sandbox container is still there. Neither follows the
// SIGKILL atomically, so each is polled; both already hold within a moment.
const CRASH_OBSERVE_TIMEOUT_MS = 10_000;
const CRASH_OBSERVE_INTERVAL_MS = 500;
// The bound on `realm status` reaching active after the crashed daemon's replacement came up, and after `realm mcp` attached.
const ACTIVE_TIMEOUT_MS = 120_000;
// The bound on every MCP response. The first one, the answer to initialize, is the exception: realm mcp claims the workspace
// before it reads any input (src/cli/main.ts runMcp: ensure the daemon, then up, then serve), so that answer waits for the
// attach, which has its own 60 s control bound after the daemon start. A hung server fails the test with a clear message, unless
// the 5 minute scenario timeout fires first: the sum of the bounds can exceed it.
const MCP_RESPONSE_TIMEOUT_MS = 60_000;
const MCP_FIRST_RESPONSE_TIMEOUT_MS = 150_000;
// The bound on realm mcp exiting after its stdin closes.
const MCP_EXIT_TIMEOUT_MS = 30_000;
// The most one MCP file read returns in this suite.
const MCP_READ_MAX_BYTES = 4096;
// A transfer moves 16 MiB through the gateway.
const TRANSFER_TIMEOUT_MS = 180_000;
const TRANSFER_BYTES = 16 * 1024 * 1024;

// Where the runner keeps its heartbeat inside the sandbox: the container's scratch space, never the workspace. The runner and
// its probe each hold a copy of this constant (src/runtime/agentos-runner.ts, agentos-probe.ts), and neither exports it.
const HEARTBEAT_PATH = "/tmp/realm-agentos/heartbeat";
// The scratch file one probe writes lives in the sandbox's tmpfs. The transfer file lives in the sandbox workspace, because the
// OpenShell CLI refuses to download from anywhere else. The workspace is the pinned host root, so the transfer test removes it
// and the cleanup list below names it.
const SCRATCH_WRITE_PATH = "/tmp/realm-live-write";
const WORKSPACE_TRANSFER_NAME = "realm-live-transfer.bin";
const TRANSFER_REMOTE_PATH = `/workspace/${WORKSPACE_TRANSFER_NAME}`;
// Names this suite may leave in the pinned workspace; cleanup removes exactly these.
const WORKSPACE_WRITE_NAME = "realm-live-write-probe";
const WORKSPACE_HOST_NAME = "realm-live-host-visible";
const WORKSPACE_MCP_NAME = "realm-live-mcp-roundtrip";
const WORKSPACE_FILES: readonly string[] = [WORKSPACE_WRITE_NAME, WORKSPACE_HOST_NAME, WORKSPACE_TRANSFER_NAME, WORKSPACE_MCP_NAME];

// The one shell script the write probes run. The target is a positional argument, never interpolated.
const WRITE_SCRIPT = 'printf %s "$1" > "$2"';
// Reads 16 bytes from a device and counts what arrived.
const DEVICE_READ_SCRIPT = 'head -c 16 "$1" | wc -c';
// Calls one syscall with zero arguments and prints errno, or "ok" when it succeeded. Used for keyctl, add_key and request_key.
const SYSCALL_SCRIPT = 'my $r = syscall(0 + $ARGV[0], 0, 0, 0, 0, 0); print(($r == -1 ? $! + 0 : "ok") . "\\n");';
// The x86-64 numbers of the three keyring syscalls the seccomp profile denies with EPERM.
const KEYRING_SYSCALLS: ReadonlyArray<readonly [string, number]> = [
  ["keyctl", 250],
  ["add_key", 248],
  ["request_key", 249],
];
const EPERM = "1";

interface Scenario {
  readonly inputs: LiveInputs;
  readonly environment: ScenarioEnvironment;
}

// Builds the scenario's isolated configuration and registers its cleanup on the test: realm down, then the residue wait. The
// hook runs even when the body failed, so a failing scenario does not leave a sandbox that blocks the next one.
function startScenario(t: TestContext, spec: ScenarioSpec, workspaceFiles: readonly string[] = []): Scenario {
  const liveInputs = inputs();
  const environment = createScenarioEnvironment(liveInputs, spec);
  t.after(async () => {
    const outcome = await cleanupScenario(liveInputs, environment, workspaceFiles);
    assert.ok(outcome.ok, `residue after the scenario's cleanup: ${outcome.detail}`);
  });
  return { inputs: liveInputs, environment };
}

function up(scenario: Scenario): Promise<CommandResult> {
  return realmCli(scenario.inputs, scenario.environment, ["up", "--workspace", scenario.inputs.workspaceRoot], UP_TIMEOUT_MS);
}

function down(scenario: Scenario): Promise<CommandResult> {
  return realmCli(scenario.inputs, scenario.environment, ["down"], DOWN_TIMEOUT_MS);
}

function exec(scenario: Scenario, workload: readonly string[]): Promise<CommandResult> {
  return sandboxExec(scenario.inputs, workload);
}

// realm up exits 0 and realm status reports active.
async function assertActive(scenario: Scenario): Promise<void> {
  const started = await up(scenario);
  assert.equal(started.exitCode, 0, `realm up: ${describeResult(started)}`);
  const status = await realmCli(scenario.inputs, scenario.environment, ["status"], STATUS_TIMEOUT_MS);
  assert.equal(status.exitCode, 0, `realm status: ${describeResult(status)}`);
  assert.equal(stateOfStatus(status.stdout), "active", `realm status: ${describeResult(status)}`);
}

// realm down exits 0 and the residue checks pass.
async function assertDownAndClean(scenario: Scenario): Promise<void> {
  const stopped = await down(scenario);
  assert.equal(stopped.exitCode, 0, `realm down: ${describeResult(stopped)}`);
  const outcome = await waitForNoResidue(scenario.inputs);
  assert.ok(outcome.ok, `residue after realm down: ${outcome.detail}`);
}

function assertExit(result: CommandResult, expected: number, what: string): void {
  assert.equal(result.exitCode, expected, `${what}: ${describeResult(result)}`);
}

// The first whitespace-separated field of a `sha256sum` line.
function hashOf(sha256sumOutput: string): string {
  return sha256sumOutput.trim().split(/\s+/)[0] ?? "";
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// The hash of the file `openshell sandbox download` produced. The CLI may name the destination as the file or as a directory
// that holds it, so both are accepted.
function downloadedFile(destination: string, remotePath: string): string {
  return statSync(destination).isDirectory() ? join(destination, basename(remotePath)) : destination;
}

// ---- Scenario 1: default policy -----------------------------------------------------------------------------------------

void test("production live 1: the default policy confines the sandbox and keeps the workspace, the probe and the transfer working", { skip: gate, timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = startScenario(t, { image: inputs().image }, WORKSPACE_FILES);
  await assertActive(scenario);

  await t.test("realm status reports fail-closed for the suite's policy, which sets no mode (the real default)", async () => {
    const status = await realmCli(scenario.inputs, scenario.environment, ["status"], STATUS_TIMEOUT_MS);
    assert.equal(status.exitCode, 0, `realm status: ${describeResult(status)}`);
    assert.equal(field(JSON.parse(status.stdout) as unknown, "mode"), "fail-closed", `realm status: ${describeResult(status)}`);
  });

  await t.test("the workload is uid 1001 with no capabilities, no_new_privs and a seccomp filter", async () => {
    const result = await exec(scenario, ["cat", "/proc/self/status"]);
    assertExit(result, 0, "cat /proc/self/status");
    const fields = parseProbeFields(result.stdout);
    assert.deepEqual(fields.get("Uid")?.split(/\s+/), ["1001", "1001", "1001", "1001"], "Uid (real, effective, saved, filesystem)");
    assert.match(fields.get("CapEff") ?? "", /^0+$/, "CapEff");
    assert.match(fields.get("CapBnd") ?? "", /^0+$/, "CapBnd");
    assert.equal(fields.get("NoNewPrivs"), "1", "NoNewPrivs");
    assert.equal(fields.get("Seccomp"), "2", "Seccomp (2 is filter mode)");
  });

  await t.test("IPv6 is disabled and the resolver is the sandbox's relay", async () => {
    const ipv6 = await exec(scenario, ["cat", "/proc/sys/net/ipv6/conf/all/disable_ipv6"]);
    assertExit(ipv6, 0, "read disable_ipv6");
    assert.equal(ipv6.stdout.trim(), "1", "disable_ipv6");
    const resolver = await exec(scenario, ["cat", "/etc/resolv.conf"]);
    assertExit(resolver, 0, "read /etc/resolv.conf");
    assert.equal(resolver.stdout.replace(/\r?\n$/, ""), "nameserver 127.0.0.53", "/etc/resolv.conf");
  });

  await t.test("/tmp, /workspace and /dev/null are writable", async () => {
    assertExit(await exec(scenario, ["sh", "-c", WRITE_SCRIPT, "sh", "probe", SCRATCH_WRITE_PATH]), 0, "write to /tmp");
    assertExit(await exec(scenario, ["rm", "-f", SCRATCH_WRITE_PATH]), 0, "remove the /tmp probe file");
    const workspacePath = `${SANDBOX_WORKSPACE_PATH}/${WORKSPACE_WRITE_NAME}`;
    assertExit(await exec(scenario, ["sh", "-c", WRITE_SCRIPT, "sh", "probe", workspacePath]), 0, "write to /workspace");
    assertExit(await exec(scenario, ["rm", "-f", workspacePath]), 0, "remove the /workspace probe file");
    assertExit(await exec(scenario, ["sh", "-c", WRITE_SCRIPT, "sh", "probe", "/dev/null"]), 0, "write to /dev/null");
  });

  await t.test("/etc and /home are read-only", async () => {
    for (const directory of ["/etc", "/home"]) {
      const result = await exec(scenario, ["sh", "-c", WRITE_SCRIPT, "sh", "probe", `${directory}/realm-live-write`]);
      assert.notEqual(result.exitCode, 0, `a write to ${directory} must fail: ${describeResult(result)}`);
      assert.notEqual(result.exitCode, undefined, `the write to ${directory} did not run: ${describeResult(result)}`);
      assert.match(`${result.stdout}\n${result.stderr}`, /read-only file system/i, `a write to ${directory} must fail as read-only: ${describeResult(result)}`);
    }
  });

  await t.test("/dev/zero and /dev/random are readable", async () => {
    for (const device of ["/dev/zero", "/dev/random"]) {
      const result = await exec(scenario, ["sh", "-c", DEVICE_READ_SCRIPT, "sh", device]);
      assertExit(result, 0, `read ${device}`);
      assert.equal(result.stdout.trim(), "16", `bytes read from ${device}`);
    }
  });

  // The syscall numbers are x86-64's; another architecture skips these three checks with a stated reason.
  const syscallSkip = process.arch === "x64" ? false : `the keyring syscall numbers 250, 248 and 249 are x86-64 only and this host is ${process.arch}`;
  for (const [name, number] of KEYRING_SYSCALLS) {
    await t.test(`${name} (syscall ${String(number)}) fails with EPERM`, { skip: syscallSkip }, async () => {
      const result = await exec(scenario, ["perl", "-e", SYSCALL_SCRIPT, String(number)]);
      assertExit(result, 0, `perl syscall ${String(number)}`);
      assert.equal(result.stdout.trim(), EPERM, `errno of ${name}`);
    });
  }

  await t.test("the runner's heartbeat is in scratch space, and the workspace holds no realm-agentos directory", async () => {
    assertExit(await exec(scenario, ["test", "-f", HEARTBEAT_PATH]), 0, "the heartbeat file exists in scratch space");
    assert.equal(existsSync(join(scenario.inputs.workspaceRoot, "realm-agentos")), false, "the pinned workspace must hold no realm-agentos directory");
  });

  await t.test("the AgentOS runner probe exits 0", async () => {
    assertExit(await exec(scenario, ["node", DEFAULT_AGENTOS_PROBE_PATH]), 0, "node agentos-probe.js");
  });

  await t.test("a command that exits 7 is reported as 7", async () => {
    // The CLI that reports it is the openshell CLI: `openshell sandbox exec ... -- sh -c 'exit 7'` exits with the remote
    // command's status. The realm CLI has no exec command.
    assertExit(await exec(scenario, ["sh", "-c", "exit 7"]), 7, "sh -c 'exit 7'");
  });

  await t.test("a file written in the sandbox's /workspace appears in the pinned root on the host", async () => {
    const token = `realm-live-${randomUUID()}`;
    const remote = `${SANDBOX_WORKSPACE_PATH}/${WORKSPACE_HOST_NAME}`;
    const hostPath = join(scenario.inputs.workspaceRoot, WORKSPACE_HOST_NAME);
    assertExit(await exec(scenario, ["sh", "-c", WRITE_SCRIPT, "sh", token, remote]), 0, "write the marker in /workspace");
    assert.equal(readFileSync(hostPath, "utf8"), token, "the marker must appear in the pinned root on the host");
    rmSync(hostPath);
    assertExit(await exec(scenario, ["test", "!", "-e", remote]), 0, "the marker is gone from the sandbox once removed on the host");
  });

  await t.test("a 16 MiB file uploads and downloads byte-identical, checked by SHA-256 on the host and in the sandbox", async () => {
    const bytes = randomBytes(TRANSFER_BYTES);
    const expected = sha256Hex(bytes);
    const uploadSource = join(scenario.environment.root, "upload.bin");
    const downloadTarget = join(scenario.environment.root, "download");
    writeFileSync(uploadSource, bytes);
    const root = scenario.environment.root;
    const uploaded = await openshellCli(scenario.inputs, ["sandbox", "upload", "--no-git-ignore", DAEMON_SANDBOX_NAME, uploadSource, TRANSFER_REMOTE_PATH], root, TRANSFER_TIMEOUT_MS);
    assertExit(uploaded, 0, "openshell sandbox upload");
    const inside = await exec(scenario, ["sha256sum", TRANSFER_REMOTE_PATH]);
    assertExit(inside, 0, "sha256sum in the sandbox");
    assert.equal(hashOf(inside.stdout), expected, "the SHA-256 inside the sandbox must match the host's");
    const downloaded = await openshellCli(scenario.inputs, ["sandbox", "download", DAEMON_SANDBOX_NAME, TRANSFER_REMOTE_PATH, downloadTarget], root, TRANSFER_TIMEOUT_MS);
    assertExit(downloaded, 0, "openshell sandbox download");
    const roundTrip = readFileSync(downloadedFile(downloadTarget, TRANSFER_REMOTE_PATH));
    assert.equal(roundTrip.length, TRANSFER_BYTES, "the downloaded size");
    assert.equal(sha256Hex(roundTrip), expected, "the downloaded file must be byte-identical (SHA-256)");
    assertExit(await exec(scenario, ["rm", "-f", TRANSFER_REMOTE_PATH]), 0, "remove the file from the sandbox");
    assertExit(await exec(scenario, ["test", "!", "-e", TRANSFER_REMOTE_PATH]), 0, "the file is gone from the sandbox");
  });

  await t.test("a connection to a public address is refused (deny-all by default)", async () => {
    const result = await exec(scenario, nodeConnectArgv("1.1.1.1", 443, 4));
    assertExit(result, 0, "node connect probe");
    const parsed = parseNodeProbe(result.stdout);
    assert.equal(parsed.kind, "error", `1.1.1.1:443 must be refused: ${describeResult(result)}`);
  });

  await assertDownAndClean(scenario);
});

// ---- Scenario 2: immediate cycle ----------------------------------------------------------------------------------------

void test("production live 2: realm up right after a down reaches active without PODMAN_MACHINE_DOWN", { skip: gate, timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  // Scenario 1 ended with its own down and a clean residue check, so this up is the immediate cycle. It is the regression check
  // for the 30 s libpod info bound: a cold libpod info call used to time out at 5 s and report PODMAN_MACHINE_DOWN.
  const scenario = startScenario(t, { image: inputs().image });
  const started = await up(scenario);
  assert.equal(started.exitCode, 0, `realm up: ${describeResult(started)}`);
  assert.doesNotMatch(`${started.stdout}\n${started.stderr}`, /PODMAN_MACHINE_DOWN/, "realm up must not report PODMAN_MACHINE_DOWN");
  const status = await realmCli(scenario.inputs, scenario.environment, ["status"], STATUS_TIMEOUT_MS);
  assert.equal(status.exitCode, 0, `realm status: ${describeResult(status)}`);
  assert.equal(stateOfStatus(status.stdout), "active", `realm status: ${describeResult(status)}`);
  await assertDownAndClean(scenario);
});

// ---- Scenario 3: egress allowlist ---------------------------------------------------------------------------------------

const ALLOWED_IP = "1.1.1.1";
const ALLOWED_HOST = "example.com";
const DENIED_IP = "8.8.8.8";
const DENIED_HOST = "example.org";
const DENIED_IPV6 = "2606:4700:4700::1111";
const HOST_PROBE_TIMEOUT_MS = 5_000;

void test("production live 3: an egress allowlist admits exactly its host:port pairs, and the resolver is synthetic", { skip: gate, timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  // The scenario needs the real internet from the host: the supervisor connects out on the sandbox's behalf.
  if (!(await canConnect(ALLOWED_IP, 443, HOST_PROBE_TIMEOUT_MS))) {
    t.skip(`the host has no outbound connectivity: a TCP connection to ${ALLOWED_IP}:443 did not open within ${String(HOST_PROBE_TIMEOUT_MS / 1000)} s`);
    return;
  }
  const scenario = startScenario(t, {
    image: inputs().image,
    egressAllow: [
      { host: ALLOWED_IP, port: 443 },
      { host: ALLOWED_HOST, port: 443 },
    ],
  });
  await assertActive(scenario);

  // One probe: the node connect script's single-line answer, with the exit checked first.
  const connectAnswer = async (host: string, family: 4 | 6): Promise<NodeProbeResult> => {
    const result = await exec(scenario, nodeConnectArgv(host, 443, family));
    assertExit(result, 0, `node connect probe for ${host}`);
    return parseNodeProbe(result.stdout);
  };
  const resolveAnswer = async (kind: "resolve4" | "resolve6" | "resolveTxt", name: string): Promise<NodeProbeResult> => {
    const result = await exec(scenario, nodeResolveArgv(kind, name));
    assertExit(result, 0, `node ${kind} probe for ${name}`);
    return parseNodeProbe(result.stdout);
  };

  await t.test(`a connection to the allowed address ${ALLOWED_IP}:443 succeeds`, async () => {
    assert.deepEqual(await connectAnswer(ALLOWED_IP, 4), { kind: "ok", detail: "" });
  });

  await t.test(`a connection to ${DENIED_IP}:443, which is not allowed, fails with EACCES`, async () => {
    assert.deepEqual(await connectAnswer(DENIED_IP, 4), { kind: "error", code: "EACCES" });
  });

  await t.test(`a connection to the allowed host ${ALLOWED_HOST}:443 (family 4) succeeds`, async () => {
    assert.deepEqual(await connectAnswer(ALLOWED_HOST, 4), { kind: "ok", detail: "" });
  });

  await t.test(`a connection to ${DENIED_HOST}:443, which is not allowed, fails with EACCES`, async () => {
    assert.deepEqual(await connectAnswer(DENIED_HOST, 4), { kind: "error", code: "EACCES" });
  });

  await t.test(`a connection to the IPv6 literal ${DENIED_IPV6}:443 fails with EACCES`, async () => {
    assert.deepEqual(await connectAnswer(DENIED_IPV6, 6), { kind: "error", code: "EACCES" });
  });

  await t.test("an AAAA lookup for an allowed host returns ENODATA", async () => {
    assert.deepEqual(await resolveAnswer("resolve6", ALLOWED_HOST), { kind: "error", code: "ENODATA" });
  });

  await t.test("an A lookup for a made-up name returns one address inside 198.18.0.0/15", async () => {
    const name = `realm-live-${randomBytes(4).toString("hex")}.example.net`;
    const answer = await resolveAnswer("resolve4", name);
    assert.equal(answer.kind, "ok", `resolve4 ${name}: ${JSON.stringify(answer)}`);
    const addresses: unknown = JSON.parse(answer.detail);
    assert.ok(Array.isArray(addresses), "the A answer is a list");
    assert.equal(addresses.length, 1, "exactly one address");
    const address: unknown = addresses[0];
    assert.ok(typeof address === "string" && isBenchmarkAddress(address), "the address must be inside 198.18.0.0/15 (the range, not an exact address)");
  });

  await t.test("a TXT lookup returns ENOTIMP", async () => {
    assert.deepEqual(await resolveAnswer("resolveTxt", ALLOWED_HOST), { kind: "error", code: "ENOTIMP" });
  });

  // The packet capture that shows no DNS packet leaves the host for a denied name needs root and tcpdump, so it is not part of
  // this suite; docs/integration/openshell.md records it.
  await assertDownAndClean(scenario);
});

// ---- Scenario 4: wrong image digest -------------------------------------------------------------------------------------

void test("production live 4: an image digest that does not exist fails closed with OPENSHELL_START_FAILED", { skip: gate, timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = startScenario(t, { image: UNKNOWN_DIGEST_IMAGE });
  const started = await up(scenario);
  assert.notEqual(started.exitCode, 0, `realm up must fail for an unknown image digest: ${describeResult(started)}`);
  assert.notEqual(started.exitCode, undefined, `realm up did not run to an exit: ${describeResult(started)}`);
  assert.match(`${started.stdout}\n${started.stderr}`, /OPENSHELL_START_FAILED/, `realm up must give OPENSHELL_START_FAILED: ${describeResult(started)}`);
  const containers = await waitForNoContainers(scenario.inputs);
  assert.ok(containers.ok, `no container may exist after the failed up: ${containers.detail}`);
  await assertDownAndClean(scenario);
});

// ---- Scenario 5: crash recovery -----------------------------------------------------------------------------------------

// The daemon processes this account runs from the compiled daemon entry. A listing that fails is a failed scenario.
async function daemonPids(scenario: Scenario): Promise<readonly number[]> {
  const listing = await findDaemonPids(scenario.inputs, DAEMON_ENTRY);
  if (!listing.ok) {
    assert.fail(`listing the daemon processes: ${listing.detail}`);
  }
  return listing.pids;
}

// The items of a container or sandbox listing. A listing that fails is a failed scenario.
async function itemsOf(listing: Promise<Listing>, what: string): Promise<readonly string[]> {
  const listed = await listing;
  if (!listed.ok) {
    assert.fail(`listing ${what}: ${listed.detail}`);
  }
  return listed.items;
}

function jsonLinesSinceStartup(log: string): boolean {
  const lines = log.split("\n");
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line === "") {
      continue;
    }
    try {
      const value = JSON.parse(line) as { event?: unknown; containersRemoved?: unknown };
      if (value.event === "daemon.startup" && value.containersRemoved === 1) {
        start = index;
      }
    } catch {
      // A line from before the restart is not part of this check.
    }
  }
  if (start < 0) {
    return false;
  }
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line === "") {
      continue;
    }
    try {
      JSON.parse(line);
    } catch {
      return false;
    }
  }
  return true;
}
void test("production live 5: after the daemon is killed, the next realm up reaps the sandbox it left and reaches active with exactly one", { skip: gate, timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = startScenario(t, { image: inputs().image });
  await assertActive(scenario);

  // The daemon this scenario's own realm up started: the one process whose whole command is the node binary and the daemon entry.
  const started = await daemonPids(scenario);
  assert.equal(started.length, 1, `exactly one daemon process must run from the compiled daemon entry; found ${String(started.length)} (pids: ${started.length === 0 ? "none" : started.join(", ")})`);
  const daemonPid = started[0];
  assert.ok(daemonPid !== undefined, "the daemon pid");
  const primed = startMcpSession(scenario.inputs, scenario.environment);
  try {
    await initializeMcp(primed);
    await callTool(primed, "status", {});
  } finally {
    primed.closeInput();
    await primed.waitForExit(MCP_EXIT_TIMEOUT_MS);
    primed.kill();
  }

  try {
    // The container the crash will leave behind, listed before the kill: the restarted daemon must report destroying this one.
    const before = await itemsOf(listDaemonContainers(scenario.inputs), `the ${DAEMON_SANDBOX_NAME} containers before the kill`);
    assert.equal(before.length, 1, `exactly one ${DAEMON_SANDBOX_NAME} container must exist before the kill; found ${String(before.length)}`);
    const crashedContainerId = before[0];
    assert.ok(crashedContainerId !== undefined && crashedContainerId !== "", "the id of the container the crash leaves behind");
    process.kill(daemonPid, "SIGKILL");
    const gone = await pollUntil(
      async () => {
        const remaining = await daemonPids(scenario);
        return remaining.length === 0 ? { done: true } : { done: false, detail: `daemon pid(s) still running: ${remaining.join(", ")}` };
      },
      { timeoutMs: CRASH_OBSERVE_TIMEOUT_MS, intervalMs: CRASH_OBSERVE_INTERVAL_MS },
    );
    assert.ok(gone.ok, `the daemon must be gone after SIGKILL: ${gone.detail}`);

    // The crash never ran the daemon's shutdown, so its sandbox is still there. This is what proves the crash was real.
    const left = await pollUntil(
      async () => {
        const containers = await itemsOf(listDaemonContainers(scenario.inputs), `the ${DAEMON_SANDBOX_NAME} containers`);
        return containers.length > 0 ? { done: true } : { done: false, detail: `no ${DAEMON_SANDBOX_NAME} container is left behind` };
      },
      { timeoutMs: CRASH_OBSERVE_TIMEOUT_MS, intervalMs: CRASH_OBSERVE_INTERVAL_MS },
    );
    assert.ok(left.ok, `the crash must leave the sandbox container behind: ${left.detail}`);

    // The next start reaps what the crash left and creates the sandbox again. Its failure is reported with the CLI's reason code.
    const restarted = await up(scenario);
    assertExit(restarted, 0, "realm up after the daemon crash");
    const active = await waitForActive(scenario.inputs, scenario.environment, ACTIVE_TIMEOUT_MS);
    assert.ok(active.ok, `realm status must reach active after the restart: ${active.detail}`);

    const replacement = await daemonPids(scenario);
    assert.equal(replacement.length, 1, `exactly one daemon process must run after the restart; found ${String(replacement.length)} (pids: ${replacement.length === 0 ? "none" : replacement.join(", ")})`);
    assert.notEqual(replacement[0], daemonPid, "the restarted daemon must be a new process");
    const replacementReady = await pollUntil(
      async () => {
        const sandboxes = await itemsOf(listDaemonSandboxes(scenario.inputs), "the realm-daemon sandboxes");
        const containers = await itemsOf(listDaemonContainers(scenario.inputs), `the ${DAEMON_SANDBOX_NAME} containers`);
        return sandboxes.length === 1 && containers.length === 1
          ? { done: true }
          : { done: false, detail: `sandboxes ${String(sandboxes.length)}, containers ${String(containers.length)}` };
      },
      { timeoutMs: CRASH_OBSERVE_TIMEOUT_MS, intervalMs: CRASH_OBSERVE_INTERVAL_MS },
    );
    assert.ok(replacementReady.ok, `exactly one ${DAEMON_SANDBOX_NAME} sandbox and container after the restart: ${replacementReady.detail}`);

    // D-1410: the startup reap is visible. The notice rides on the status reply, and the daemon log names the destroyed container.
    const status = await realmCli(scenario.inputs, scenario.environment, ["status"], STATUS_TIMEOUT_MS);
    assertExit(status, 0, "realm status after the daemon crash");
    const notice = noticeOfStatus(status.stdout);
    assert.ok(notice !== undefined && notice.includes("destroyed at startup"), `realm status must carry the startup notice: ${describeResult(status)}`);
    const counts = reapCountsOfNotice(notice);
    assert.ok(counts !== undefined, `the notice must state its counts: ${notice}`);
    assert.equal(counts.containers, 1, `the notice must count one container: ${notice}`);
    assert.ok(counts.sessionRecords >= 1, `the notice must count at least one session record: ${notice}`);
    const daemonLog = readFileSync(join(scenario.environment.stateDir, "daemon.log"), "utf8");
    assert.ok(startupReapLineFor(daemonLog, crashedContainerId) !== undefined, `daemon.log must hold a daemon.startup record for one container that names ${crashedContainerId}`);
    assert.equal(jsonLinesSinceStartup(daemonLog), true, "every daemon.log line from the restart's daemon.startup record must be JSON");
    const auditFile = join(scenario.environment.stateDir, "audit", "daemon.jsonl");
    const verified = await realmCli(scenario.inputs, scenario.environment, ["audit", "verify", auditFile], STATUS_TIMEOUT_MS);
    assertExit(verified, 0, "realm audit verify after the restart");
    const report = JSON.parse(verified.stdout) as { ok?: boolean; unparsedLines?: readonly number[] };
    assert.equal(report.ok, true, `realm audit verify must report ok: ${verified.stdout}`);
    assert.ok(Array.isArray(report.unparsedLines) && report.unparsedLines.length <= 1, `unparsedLines must be empty or only a torn tail: ${verified.stdout}`);
  } catch (error) {
    // With no daemon running, `realm down` reports "already down" and reaps nothing, so the sandbox the crash left would stay
    // and block the next scenario. One more realm up lets a daemon reap it for the cleanup's down. Its result is not judged and
    // the original failure is rethrown.
    await up(scenario);
    throw error;
  }

  await assertDownAndClean(scenario);
});

// ---- Scenario 6: MCP exec -----------------------------------------------------------------------------------------------

// The two revisions one realm mcp process serves (src/mcp/protocol.ts): the session below handshakes with a legacy revision the
// way Claude Code does, and later sends a modern request that names MCP_MODERN_REVISION in its _meta, the way Grok Build does.
const MCP_LEGACY_REVISION = "2025-11-25";
const MCP_MODERN_REVISION = "2026-07-28";
const MCP_TOOL_NAMES: readonly string[] = ["exec", "read", "write", "list", "status", "retry"];

// The value under key of a JSON object, or undefined for anything else.
function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

// One tools/call. The result is an MCP tool result: structuredContent is the dispatcher outcome unchanged ({outcome: "done", tool,
// value} for a tool that ran) and content carries the same JSON as a text block, which is what a host shows to the model. A refusal
// or a RealmError comes back as a tool error (isError, structuredContent with the catalogue code), because the daemon client throws
// the refusal's code. Both fail the scenario with that code.
async function callTool(session: McpSession, tool: string, args: Readonly<Record<string, unknown>>): Promise<unknown> {
  const result = await session.request("tools/call", { name: tool, arguments: args }, MCP_RESPONSE_TIMEOUT_MS);
  const outcome = field(result, "structuredContent");
  if (field(result, "isError") === true) {
    assert.fail(`tools/call ${tool} returned a tool error: ${describeValue(outcome)}; realm mcp stderr ${session.stderr()}`);
  }
  assert.equal(field(outcome, "outcome"), "done", `tools/call ${tool}: ${describeValue(result)}; realm mcp stderr ${session.stderr()}`);
  assert.equal(field(outcome, "tool"), tool, `tools/call ${tool}: the outcome names another tool: ${describeValue(result)}`);
  const blocks = field(result, "content");
  const first: unknown = Array.isArray(blocks) ? (blocks as unknown[])[0] : undefined;
  assert.equal(field(first, "type"), "text", `tools/call ${tool}: the result needs a text content block for the model: ${describeValue(result)}`);
  return field(outcome, "value");
}

async function runMcpSession(scenario: Scenario, session: McpSession): Promise<void> {
  // 1. The legacy handshake. realm mcp claims the workspace before it reads any input, so the first answer waits for the attach.
  const initialized = await session.request(
    "initialize",
    { protocolVersion: MCP_LEGACY_REVISION, capabilities: {}, clientInfo: { name: "realm-live-suite", version: "0" } },
    MCP_FIRST_RESPONSE_TIMEOUT_MS,
  );
  assert.equal(field(initialized, "protocolVersion"), MCP_LEGACY_REVISION, `initialize: ${describeValue(initialized)}`);
  assert.equal(typeof field(field(initialized, "serverInfo"), "name"), "string", `initialize serverInfo: ${describeValue(initialized)}`);
  assert.equal(typeof field(field(initialized, "capabilities"), "tools"), "object", `initialize capabilities.tools: ${describeValue(initialized)}`);
  // A message without an id takes no reply.
  session.notify("notifications/initialized");

  // 2. The six tools.
  const listed = await session.request("tools/list", {}, MCP_RESPONSE_TIMEOUT_MS);
  const tools = field(listed, "tools");
  assert.ok(Array.isArray(tools), `tools/list must return a tools array: ${describeValue(listed)}`);
  const names: readonly unknown[] = tools.map((tool: unknown) => field(tool, "name"));
  for (const name of MCP_TOOL_NAMES) {
    assert.ok(names.includes(name), `tools/list must name ${name}: ${describeValue(names)}`);
  }
  for (const tool of tools) {
    assert.equal(typeof field(tool, "description"), "string", `a tool descriptor needs a description: ${describeValue(tool)}`);
    assert.equal(typeof field(tool, "inputSchema"), "object", `a tool descriptor needs an inputSchema: ${describeValue(tool)}`);
  }

  // 3. The attach must be active before the first call.
  const active = await waitForActive(scenario.inputs, scenario.environment, ACTIVE_TIMEOUT_MS);
  assert.ok(active.ok, `the realm mcp attach must reach active: ${active.detail}; realm mcp stderr ${session.stderr()}`);

  // 4. exec in argv form: the marker comes back on stdout, which the daemon's exec runner captures.
  const marker = `realm-live-${randomBytes(6).toString("hex")}`;
  const echoed = await callTool(session, "exec", { argv: ["echo", marker] });
  assert.equal(field(echoed, "exitCode"), 0, `exec echo: ${describeValue(echoed)}`);
  const echoedStdout = field(echoed, "stdout");
  assert.ok(typeof echoedStdout === "string" && echoedStdout.includes(marker), `exec echo must print the marker on stdout: ${describeValue(echoed)}`);

  // 5. A non-zero exit is a successful call that carries its exit code.
  const exited = await callTool(session, "exec", { argv: ["sh", "-c", "exit 3"] });
  assert.equal(field(exited, "exitCode"), 3, `exec sh -c 'exit 3': ${describeValue(exited)}`);

  // 6. write, then the host sees the file, then read returns the same bytes.
  const content = `realm-live-mcp-${randomUUID()}`;
  const hostPath = join(scenario.inputs.workspaceRoot, WORKSPACE_MCP_NAME);
  const written = await callTool(session, "write", { path: WORKSPACE_MCP_NAME, content });
  assert.equal(field(written, "bytes"), Buffer.byteLength(content), `write bytes: ${describeValue(written)}`);
  assert.equal(field(written, "sha256"), sha256Hex(Buffer.from(content)), `write sha256: ${describeValue(written)}`);
  assert.equal(readFileSync(hostPath, "utf8"), content, "the written file must appear in the pinned root on the host with exactly the written content");
  const readBack = await callTool(session, "read", { path: WORKSPACE_MCP_NAME, maxBytes: MCP_READ_MAX_BYTES });
  assert.equal(field(readBack, "status"), "found", `read status: ${describeValue(readBack)}`);
  assert.equal(decodeReadContent(field(readBack, "content")), content, `read content: ${describeValue(readBack)}`);
  assert.equal(field(readBack, "truncated"), false, `read truncated: ${describeValue(readBack)}`);
  rmSync(hostPath);
  const metrics = await realmCli(scenario.inputs, scenario.environment, ["metrics"], STATUS_TIMEOUT_MS);
  assertExit(metrics, 0, "realm metrics after the write");
  const snap = JSON.parse(metrics.stdout) as {
    toolCalls?: readonly { tool?: string; outcome?: string; count?: number }[];
    timings?: { attachMs?: { count?: number } };
  };
  const writeDone = snap.toolCalls?.find((row) => row.tool === "write" && row.outcome === "done");
  assert.ok(writeDone !== undefined && (writeDone.count ?? 0) >= 1, `realm metrics must count the write: ${metrics.stdout}`);
  assert.ok((snap.timings?.attachMs?.count ?? 0) >= 1, `realm metrics must count the attach: ${metrics.stdout}`);
  // 7. The same process answers a modern request: the protocol version in _meta, resultType on every result, and the model-facing
  // content block beside structuredContent.
  const modernMeta = { "io.modelcontextprotocol/protocolVersion": MCP_MODERN_REVISION };
  const discovered = await session.request("server/discover", { _meta: modernMeta }, MCP_RESPONSE_TIMEOUT_MS);
  assert.equal(field(discovered, "resultType"), "complete", `server/discover: ${describeValue(discovered)}`);
  const supported = field(discovered, "supportedVersions");
  assert.ok(Array.isArray(supported) && supported.includes(MCP_MODERN_REVISION) && supported.includes(MCP_LEGACY_REVISION), `server/discover supportedVersions: ${describeValue(discovered)}`);
  const modernStatus = await session.request("tools/call", { name: "status", arguments: {}, _meta: modernMeta }, MCP_RESPONSE_TIMEOUT_MS);
  assert.equal(field(modernStatus, "resultType"), "complete", `modern tools/call: ${describeValue(modernStatus)}`);
  assert.equal(field(modernStatus, "isError"), false, `modern tools/call isError: ${describeValue(modernStatus)}`);
  assert.equal(field(field(modernStatus, "structuredContent"), "outcome"), "done", `modern tools/call outcome: ${describeValue(modernStatus)}`);

  // 8. Closing stdin ends the session, and realm mcp exits 0.
  session.closeInput();
  const ended = await session.waitForExit(MCP_EXIT_TIMEOUT_MS);
  assert.notEqual(ended, undefined, `realm mcp must exit within ${String(MCP_EXIT_TIMEOUT_MS / 1000)} s of its stdin closing; stderr ${session.stderr()}`);
  assert.deepEqual(ended, { code: 0, signal: null }, `realm mcp must exit 0; stderr ${session.stderr()}`);
}

void test("production live 6: realm mcp serves exec, write and read over stdio against the live sandbox", { skip: gate, timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = startScenario(t, { image: inputs().image }, WORKSPACE_FILES);
  const session = startMcpSession(scenario.inputs, scenario.environment);
  try {
    await runMcpSession(scenario, session);
  } finally {
    // A child that is still running (a failed step, or no exit after stdin closed) is killed; the cleanup's realm down follows.
    session.kill();
  }
  await assertDownAndClean(scenario);
});

// ---- Scenario 7: MCP exec timeout ---------------------------------------------------------------------------------------

// The request bound for the call that must time out: well above the fixed 30 s per-call bound (src/tools/dispatch.ts
// TOOL_CALL_TIMEOUT_MS), so the answer the test waits for is the tool's own TOOL_TIMEOUT, not this bound.
const TOOL_TIMEOUT_REQUEST_BOUND_MS = 60_000;
// The per-call bound is a constant (30 s) and the exec runner's own deadline is 28 s; there is no per-call timeout parameter.
// The elapsed time of the timed-out call falls between these two limits.
const TOOL_TIMEOUT_MIN_ELAPSED_MS = 25_000;
const TOOL_TIMEOUT_MAX_ELAPSED_MS = 40_000;
// Longer than the per-call bound, so the workload is still running when the bound fires.
const TOOL_TIMEOUT_SLEEP_SECONDS = "45";

// `realm status` printed as its lifecycle fields. The CLI exits 0 and prints JSON for any lifecycle state.
async function statusOf(scenario: Scenario): Promise<StatusFields> {
  const status = await realmCli(scenario.inputs, scenario.environment, ["status"], STATUS_TIMEOUT_MS);
  assert.equal(status.exitCode, 0, `realm status: ${describeResult(status)}`);
  const fields = statusFieldsOf(status.stdout);
  if (fields === undefined) {
    assert.fail(`realm status must print the status JSON: ${describeResult(status)}`);
  }
  return fields;
}

// The initialize handshake of a realm mcp session, as scenario 6 opens it.
async function initializeMcp(session: McpSession): Promise<void> {
  const initialized = await session.request(
    "initialize",
    { protocolVersion: MCP_LEGACY_REVISION, capabilities: {}, clientInfo: { name: "realm-live-suite", version: "0" } },
    MCP_FIRST_RESPONSE_TIMEOUT_MS,
  );
  assert.equal(field(initialized, "protocolVersion"), MCP_LEGACY_REVISION, `initialize: ${describeValue(initialized)}`);
  session.notify("notifications/initialized");
}

void test("production live 7: an exec that outlives the per-call bound fails with a retryable TOOL_TIMEOUT and leaves the session usable", { skip: gate, timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = startScenario(t, { image: inputs().image });
  const session = startMcpSession(scenario.inputs, scenario.environment);
  try {
    await initializeMcp(session);
    const active = await waitForActive(scenario.inputs, scenario.environment, ACTIVE_TIMEOUT_MS);
    assert.ok(active.ok, `the realm mcp attach must reach active: ${active.detail}; realm mcp stderr ${session.stderr()}`);

    // A raw tools/call: callTool fails the scenario on isError, and the timeout is exactly the error this scenario asserts.
    const startedAt = performance.now();
    const timedOut = await session.request("tools/call", { name: "exec", arguments: { argv: ["sleep", TOOL_TIMEOUT_SLEEP_SECONDS] } }, TOOL_TIMEOUT_REQUEST_BOUND_MS);
    const elapsedMs = performance.now() - startedAt;
    assert.equal(field(timedOut, "isError"), true, `exec sleep ${TOOL_TIMEOUT_SLEEP_SECONDS} must return a tool error: ${describeValue(timedOut)}`);
    const failure = toolErrorOf(timedOut);
    assert.deepEqual(failure, { code: "TOOL_TIMEOUT", retryable: true }, `exec sleep ${TOOL_TIMEOUT_SLEEP_SECONDS}: ${describeValue(field(timedOut, "structuredContent"))}`);
    assert.ok(
      elapsedMs >= TOOL_TIMEOUT_MIN_ELAPSED_MS && elapsedMs <= TOOL_TIMEOUT_MAX_ELAPSED_MS,
      `the timed-out call must take between ${String(TOOL_TIMEOUT_MIN_ELAPSED_MS / 1000)} and ${String(TOOL_TIMEOUT_MAX_ELAPSED_MS / 1000)} s; it took ${String(Math.round(elapsedMs / 100) / 10)} s`,
    );

    // The session survives: the next call runs, the status is still active, and the child exits cleanly when its input closes.
    const echoed = await callTool(session, "exec", { argv: ["echo", "ok"] });
    assert.equal(field(echoed, "exitCode"), 0, `exec echo after the timeout: ${describeValue(echoed)}`);
    const echoedStdout = field(echoed, "stdout");
    assert.ok(typeof echoedStdout === "string" && echoedStdout.includes("ok"), `exec echo after the timeout must print ok: ${describeValue(echoed)}`);
    assert.equal((await statusOf(scenario)).state, "active", "realm status must still report active after the timeout");

    session.closeInput();
    const ended = await session.waitForExit(MCP_EXIT_TIMEOUT_MS);
    assert.notEqual(ended, undefined, `realm mcp must exit within ${String(MCP_EXIT_TIMEOUT_MS / 1000)} s of its stdin closing; stderr ${session.stderr()}`);
    assert.deepEqual(ended, { code: 0, signal: null }, `realm mcp must exit 0; stderr ${session.stderr()}`);
  } finally {
    session.kill();
  }
  await assertDownAndClean(scenario);
});

// ---- Scenario 8: AgentOS runner exit ------------------------------------------------------------------------------------

// The daemon's health loop runs about every 10 s; the session reaches error well within this bound after the runner is gone.
const RUNNER_EXIT_OBSERVE_TIMEOUT_MS = 45_000;
const RUNNER_EXIT_OBSERVE_INTERVAL_MS = 2_000;

void test("production live 8: after the AgentOS runner is killed the session moves to error with AGENTOS_CRASH_LOOP, and down then up recover it", { skip: gate, timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = startScenario(t, { image: inputs().image });
  await assertActive(scenario);

  try {
    const killed = await exec(scenario, KILL_RUNNER_ARGV);
    assertExit(killed, 0, "killing the AgentOS runner in the sandbox");
    const result = parseNodeProbe(killed.stdout);
    assert.equal(result.kind, "ok", `the runner kill must find and signal the runner: ${describeResult(killed)}`);

    // The health loop notices that the runner is gone and moves the session to error.
    const errored = await pollUntil(
      async () => {
        const status = await realmCli(scenario.inputs, scenario.environment, ["status"], STATUS_TIMEOUT_MS);
        const fields = status.exitCode === 0 ? statusFieldsOf(status.stdout) : undefined;
        const reached = fields?.state === "error" && fields.reason === "AGENTOS_CRASH_LOOP" && fields.label === "realm disconnected";
        return reached ? { done: true } : { done: false, detail: `realm status: ${describeResult(status)}` };
      },
      { timeoutMs: RUNNER_EXIT_OBSERVE_TIMEOUT_MS, intervalMs: RUNNER_EXIT_OBSERVE_INTERVAL_MS },
    );
    assert.ok(errored.ok, `realm status must report state error, reason AGENTOS_CRASH_LOOP and label realm disconnected within ${String(RUNNER_EXIT_OBSERVE_TIMEOUT_MS / 1000)} s: ${errored.detail}`);

    // Down removes the sandbox the dead runner left, and the next up starts one daemon and reaches active again.
    await assertDownAndClean(scenario);
    await assertActive(scenario);
    const replacement = await daemonPids(scenario);
    assert.equal(replacement.length, 1, `exactly one daemon process must run after the recovery; found ${String(replacement.length)} (pids: ${replacement.length === 0 ? "none" : replacement.join(", ")})`);
  } catch (error) {
    // A failed assertion still stops the stack, so the sandbox does not block the next scenario. The result is not judged and
    // the original failure is rethrown.
    await down(scenario);
    throw error;
  }

  await assertDownAndClean(scenario);
});

// ---- Scenario 9: daemon-side startup budget -----------------------------------------------------------------------------

// The smallest startup budget the policy schema admits (policy.schema.json startupBudgetMs, minimum 1).
const STARTUP_BUDGET_MIN_MS = 1;
// A create that outlives the expired budget may still finish after the failed up and leave a container, so this scenario waits
// longer for the residue than the others, and its own timeout covers two such waits.
const BUDGET_RESIDUE_TIMEOUT_MS = 180_000;
const BUDGET_SCENARIO_TIMEOUT_MS = 600_000;

// Registered last: a late create can leave a container behind, and no other scenario should start while one may still appear.
// Caveat: the Omp plugin's own 200 s startup timer is a constant, proven by unit tests. This scenario proves the daemon-side
// budget (policy.startupBudgetMs) that Omp displays: the daemon reports STARTUP_BUDGET_EXCEEDED and keeps running.
void test("production live 9: a startup budget of 1 ms fails realm up with STARTUP_BUDGET_EXCEEDED, reports error, and leaves the daemon running until down", { skip: gate, timeout: BUDGET_SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = startScenario(t, { image: inputs().image, policyExtra: { startupBudgetMs: STARTUP_BUDGET_MIN_MS } });
  const started = await up(scenario);
  assertExit(started, 1, "realm up with a 1 ms startup budget");
  assert.match(`${started.stdout}\n${started.stderr}`, /STARTUP_BUDGET_EXCEEDED/, `realm up must give STARTUP_BUDGET_EXCEEDED: ${describeResult(started)}`);

  const fields = await statusOf(scenario);
  assert.equal(fields.state, "error", `realm status state: ${JSON.stringify(fields)}`);
  assert.equal(fields.label, "realm disconnected", `realm status label: ${JSON.stringify(fields)}`);
  assert.equal(fields.reason, "STARTUP_BUDGET_EXCEEDED", `realm status reason: ${JSON.stringify(fields)}`);
  // The session continues: the daemon that reported the expiry is still running.
  const pids = await daemonPids(scenario);
  assert.equal(pids.length, 1, `the daemon must still run after the expired budget; found ${String(pids.length)} (pids: ${pids.length === 0 ? "none" : pids.join(", ")})`);

  const stopped = await down(scenario);
  assertExit(stopped, 0, "realm down after the expired budget");
  let residue = await waitForNoResidue(scenario.inputs, BUDGET_RESIDUE_TIMEOUT_MS);
  if (!residue.ok) {
    // The late create may have finished after the first down; one more down removes what it left. Its own result is not judged:
    // the residue wait below is the verdict.
    await down(scenario);
    residue = await waitForNoResidue(scenario.inputs, BUDGET_RESIDUE_TIMEOUT_MS);
  }
  assert.ok(residue.ok, `residue after realm down with an expired budget: ${residue.detail}`);
});

const GATEWAY_UNIT = process.env["REALM_LIVE_GATEWAY_UNIT"] ?? "realm-openshell-gateway.service";

void test("production live 10: a stopped gateway is OPENSHELL_GATEWAY_LOST, not AGENTOS_CRASH_LOOP, and the daemon listens only on its Unix socket", { skip: gate, timeout: SCENARIO_TIMEOUT_MS }, async (t) => {
  const scenario = startScenario(t, { image: inputs().image });
  let stopped = false;
  // The shared gateway must come back whatever happens below. The restart runs in this finally, inside the test body, before the
  // scenario cleanup runs, and a failed restart is retried here rather than left to a hook that may run after the cleanup.
  const restoreGateway = async (): Promise<void> => {
    if (!stopped) {
      return;
    }
    const restarted = await runCommand("systemctl", ["--user", "start", GATEWAY_UNIT], {
      env: scenario.environment.cliEnvironment,
      timeoutMs: 30_000,
      cwd: tmpdir(),
    });
    if (restarted.exitCode === 0) {
      stopped = false;
    }
  };
  try {
    await assertActive(scenario);
    const started = await daemonPids(scenario);
    assert.equal(started.length, 1, `exactly one daemon must run; found ${String(started.length)}`);
    const daemonPid = started[0];
    assert.ok(daemonPid !== undefined, "the daemon pid");
    const sockets = listeningSocketsOf(daemonPid);
    assert.deepEqual(sockets.tcp, [], `the daemon must not listen on TCP: ${sockets.tcp.join(", ")}`);
    assert.deepEqual(sockets.udp, [], `the daemon must not listen on UDP: ${sockets.udp.join(", ")}`);
    assert.equal(sockets.unix.length, 1, `the daemon must have one Unix socket: ${sockets.unix.join(", ")}`);

    // Set before the stop runs: a stop that fails or times out can still leave the unit down, so the finally must try to start it.
    stopped = true;
    const stop = await runCommand("systemctl", ["--user", "stop", GATEWAY_UNIT], {
      env: scenario.environment.cliEnvironment,
      timeoutMs: 30_000,
      cwd: tmpdir(),
    });
    assertExit(stop, 0, `systemctl --user stop ${GATEWAY_UNIT}`);
    let sawCrashLoop = false;
    const errored = await pollUntil(
      async () => {
        const status = await realmCli(scenario.inputs, scenario.environment, ["status"], STATUS_TIMEOUT_MS);
        const fields = status.exitCode === 0 ? statusFieldsOf(status.stdout) : undefined;
        if (fields?.reason === "AGENTOS_CRASH_LOOP") {
          sawCrashLoop = true;
        }
        const reached = fields?.state === "error" && fields.reason === "OPENSHELL_GATEWAY_LOST" && fields.label === "realm disconnected";
        return reached ? { done: true } : { done: false, detail: `realm status: ${describeResult(status)}` };
      },
      { timeoutMs: RUNNER_EXIT_OBSERVE_TIMEOUT_MS, intervalMs: RUNNER_EXIT_OBSERVE_INTERVAL_MS },
    );
    assert.equal(sawCrashLoop, false, "a stopped gateway must not be reported as AGENTOS_CRASH_LOOP");
    assert.ok(errored.ok, `realm status must report OPENSHELL_GATEWAY_LOST within ${String(RUNNER_EXIT_OBSERVE_TIMEOUT_MS / 1000)} s: ${errored.detail}`);
    const metrics = await realmCli(scenario.inputs, scenario.environment, ["metrics"], STATUS_TIMEOUT_MS);
    assertExit(metrics, 0, "realm metrics after the gateway stop");
    const snap = JSON.parse(metrics.stdout) as { healthProbeFailures?: readonly { code?: string; count?: number }[] };
    const lost = snap.healthProbeFailures?.find((row) => row.code === "OPENSHELL_GATEWAY_LOST");
    assert.ok(lost !== undefined && (lost.count ?? 0) >= 1, `realm metrics must count OPENSHELL_GATEWAY_LOST: ${metrics.stdout}`);

    await restoreGateway();
    assert.equal(stopped, false, "the gateway unit must start again");
    await assertDownAndClean(scenario);
    await assertActive(scenario);
    await assertDownAndClean(scenario);
  } finally {
    await restoreGateway();
  }
});
