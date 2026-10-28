// Gated live suite for the production stack (PRD-TST-02, PRD-TST-03).
//
// It runs the real stack under the realm account (the realm CLI, the daemon it spawns, the OpenShell gateway, the realm compute
// driver and rootless Podman 5.x) and verifies by behaviour what an operator would otherwise check by hand: the sandbox's
// identity and confinement, its filesystem and device policy, the keyring seccomp rules, the AgentOS probe, file movement in and
// out, egress, and a clean teardown.
//
// Gate. The whole file skips, with a reason that names the FIRST missing prerequisite, unless all of these hold:
//   1. REALM_LIVE_PRODUCTION=1. An explicit operator opt-in; the test never sets it.
//   2. Podman 5.x on PATH.
//   3. REALM_LIVE_IMAGE: the digest-pinned image the running driver was given.
//   4. REALM_DRIVER_STATE_ROOT, REALM_DRIVER_SECRET_ROOT and REALM_DRIVER_WORKSPACE_ROOT: absolute, and equal to the roots the
//      running driver was given.
//   5. A rootless Podman API socket under XDG_RUNTIME_DIR.
//   6. The openshell CLI on PATH.
//   7. The built CLI at dist/src/cli/main.js, next to the compiled tests (npm run build).
// A default npm test therefore skips every scenario below and reports each as skipped.
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
//
// Nothing here prints a secret. Failure messages carry exit codes, error codes, names and clipped probe output.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { DEFAULT_AGENTOS_PROBE_PATH } from "../../src/runtime/agentos-driver.js";
import { SANDBOX_WORKSPACE_PATH } from "../../src/runtime/openshell.js";
import {
  UNKNOWN_DIGEST_IMAGE,
  canConnect,
  cleanupScenario,
  createScenarioEnvironment,
  describeResult,
  isBenchmarkAddress,
  isDirectory,
  isSocket,
  nodeConnectArgv,
  nodeResolveArgv,
  onPath,
  openshellCli,
  parseNodeProbe,
  parseProbeFields,
  probePodman,
  productionSkipReason,
  readLiveInputs,
  realmCli,
  sandboxExec,
  stateOfStatus,
  waitForNoContainers,
  waitForNoResidue,
  DAEMON_SANDBOX_NAME,
  type CommandResult,
  type NodeProbeResult,
  type LiveInputs,
  type ScenarioEnvironment,
  type ScenarioSpec,
} from "../support/production-live.js";

// The compiled CLI beside the compiled tests: this file runs from dist/test/integration, the CLI from dist/src/cli.
const CLI_PATH = fileURLToPath(new URL("../../src/cli/main.js", import.meta.url));

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
// A transfer moves 16 MiB through the gateway.
const TRANSFER_TIMEOUT_MS = 180_000;
const TRANSFER_BYTES = 16 * 1024 * 1024;

// Where the runner keeps its heartbeat inside the sandbox: the container's scratch space, never the workspace. The runner and
// its probe each hold a copy of this constant (src/runtime/agentos-runner.ts, agentos-probe.ts), and neither exports it.
const HEARTBEAT_PATH = "/tmp/realm-agentos/heartbeat";
// The scratch file one probe writes and the transfer test round-trips. Both live in the sandbox's tmpfs.
const SCRATCH_WRITE_PATH = "/tmp/realm-live-write";
const TRANSFER_REMOTE_PATH = "/tmp/realm-live-transfer.bin";
// Names this suite may leave in the pinned workspace; cleanup removes exactly these.
const WORKSPACE_WRITE_NAME = "realm-live-write-probe";
const WORKSPACE_HOST_NAME = "realm-live-host-visible";
const WORKSPACE_FILES: readonly string[] = [WORKSPACE_WRITE_NAME, WORKSPACE_HOST_NAME];

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
