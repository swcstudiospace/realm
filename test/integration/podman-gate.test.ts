// Podman gate and live bodies (RT-01, RT-03, RT-09).
//
// The suite skips below Podman 5.x. Each live body also needs a rootless Podman API socket, an openshell
// CLI on PATH and REALM_LIVE_IMAGE (a digest-pinned image).
// liveInputsSkipReason names the first missing prerequisite, so a host without one skips the body.
//
// Removal scope: a live body removes only the containers it creates (createLiveContainer). The RT-09
// sweep runs the production removeAllRealmContainers through a client scoped to those container ids, so
// realm-labelled containers that belong to other sessions on the host are never removed or counted.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import type { EgressRule } from "../../src/contract/validate.js";
import { createEventBus } from "../../src/core/events.js";
import { loadPolicyFile } from "../../src/core/policy.js";
import { LockTable } from "../../src/fs/locks.js";
import { bindRoot } from "../../src/fs/root.js";
import { loadRuntimeConfig, type RuntimeConfig } from "../../src/runtime/config.js";
import { HARDENING_PROFILE, verifyInspect } from "../../src/runtime/hardening.js";
import { sandboxBindingOf } from "../../src/runtime/driver/sandbox-binding.js";
import { LibpodClient, type LibpodInspect } from "../../src/runtime/libpod-client.js";
import {
  OPENSHELL_MANAGED_LABEL_KEY,
  runOpenShellCreate,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
  realmSandboxName,
  writePolicyDocument,
  type OpenShellRunner,
} from "../../src/runtime/openshell.js";
import { parsePodmanVersion, podmanSkipReason, type PodmanProbe } from "../../src/runtime/podman-version.js";
import { removeAllRealmContainers, type SweepClient } from "../../src/runtime/sweep.js";
import { AGENTOS_WORKLOAD_BINARY, runSandboxExec, selectOpenShellEnvironment, spawnOpenShellRunner } from "../../src/runtime/session-execution.js";
import { reapStartup } from "../../src/session/reap.js";
import { SessionStore } from "../../src/session/store.js";
import { createThrough } from "../support/sandbox-create.js";
import { ToolDispatcher, type DispatcherController } from "../../src/tools/dispatch.js";

// `podman --version` is local and fast; the timeout keeps a hung binary from hanging the run.
const PROBE_TIMEOUT_MS = 5_000;

// Runs `podman --version`. Any failure (ENOENT, non-zero exit, timeout) is reported as
// "unavailable" and is mapped to PODMAN_MISSING by podmanSkipReason.
function probePodman(): Promise<PodmanProbe> {
  return new Promise((resolve) => {
    execFile("podman", ["--version"], { timeout: PROBE_TIMEOUT_MS }, (error, stdout) => {
      if (error !== null) {
        resolve({ kind: "unavailable" });
        return;
      }
      resolve({ kind: "output", stdout });
    });
  });
}

const probe = await probePodman();
const gate = podmanSkipReason(probe);

// Below Podman 5.x every test in this file is skipped with a reason that names the detected
// version; the skip is the gate, not a suppression. The live bodies below also need a rootless API
// socket, an openshell CLI on PATH, and a digest-pinned image. The gate checks that the socket and the CLI
// are present; it does not run the CLI, so the 0.1.5 version is checked by the doctor's openshell item.
// Phase 3 verification runs on a 4.9.3 host, so none of them executes there.
void test("Podman gate: the host reports Podman 5.x or newer (RT-02)", { skip: gate }, () => {
  if (probe.kind !== "output") {
    assert.fail("the gate ran the suite without a successful podman --version probe");
  }
  const parsed = parsePodmanVersion(probe.stdout);
  if (!parsed.ok) {
    assert.fail(`podman --version output did not parse: ${parsed.reason}`);
  }
  assert.ok(parsed.major >= 5, `expected Podman 5.x or newer, found ${parsed.version}`);
});

// ---- Live bodies (RT-01, RT-03, RT-05, RT-08, RT-09, TOOL-03). Each needs the 5.x host described
// above and a digest-pinned image in REALM_LIVE_IMAGE. A host without them skips each body with a stated reason. The bodies
// drive the production create path, so a 5.x run observes real behaviour; nothing in this file claims a live result that has
// not run.

const LIVE_IMAGE_VARIABLE = "REALM_LIVE_IMAGE";
// The bound for one OpenShell create, the same as the composition's create deadline.
const LIVE_CREATE_DEADLINE_MS = 60_000;
// The sandbox limits come from the frozen hardening profile, as the composition derives them.
const SANDBOX_CPUS = HARDENING_PROFILE.nanoCpus / 1_000_000_000;
const SANDBOX_MEMORY = `${String(HARDENING_PROFILE.memoryBytes / 1024 ** 3)}Gi`;

const liveGate: string | false = gate === false ? liveInputsSkipReason() : gate;

function liveInputsSkipReason(): string | false {
  if ((process.env[LIVE_IMAGE_VARIABLE] ?? "") === "") {
    return `${LIVE_IMAGE_VARIABLE} not set; the live bodies need a digest-pinned image`;
  }
  if (!isAbsolute(process.env["XDG_RUNTIME_DIR"] ?? "")) {
    return "XDG_RUNTIME_DIR is not an absolute path, so the rootless Podman API socket cannot be located";
  }
  if (!isSocket(liveSocketPath())) {
    return "no rootless Podman API socket under XDG_RUNTIME_DIR; start it with systemctl --user start podman.socket";
  }
  if (!onPath("openshell")) {
    return "no openshell CLI on PATH; the live bodies run it through the pinned create argv";
  }
  return false;
}

// True when path is a Unix socket. A path that cannot be read is not a socket.
function isSocket(path: string): boolean {
  try {
    return statSync(path).isSocket();
  } catch {
    return false;
  }
}

// True when an executable named name is on PATH. The file is inspected, never run.
function onPath(name: string): boolean {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") {
      continue;
    }
    const candidate = join(dir, name);
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK);
        return true;
      }
    } catch {
      // Not executable at this PATH entry; the next entry may still hold it.
    }
  }
  return false;
}

interface LiveContainer {
  readonly libpod: LibpodClient;
  readonly containerId: string;
  readonly sessionId: string;
  readonly config: RuntimeConfig;
  readonly secretRoot: string;
  readonly rootless: boolean;
  // Every argv the OpenShell runner was given, in order.
  readonly argvSeen: string[][];
}

// Reads the live configuration. A malformed value throws, so a misconfigured live run fails loudly.
function liveConfig(stateDir: string, workspaceRoot: string): RuntimeConfig {
  return loadRuntimeConfig({
    image: process.env[LIVE_IMAGE_VARIABLE],
    stateDir,
    workspaceRoot,
  });
}

// The rootless Podman API socket, derived as the probe derives it (OQ-P3-13).
function liveSocketPath(): string {
  return join(process.env["XDG_RUNTIME_DIR"] ?? "", "podman", "podman.sock");
}

// Creates one session container through the production create path: the policy document is written
// first, then the pinned OpenShell argv runs once and the label lookup resolves the container. The
// container is removed when the test ends. Every argv the runner receives is recorded. The egress
// allowlist is rendered into the session's policy document (deny-all when empty, S-20), so the RT-05
// bodies can admit exactly the probe host.
async function createLiveContainer(t: TestContext, egress: readonly EgressRule[] = []): Promise<LiveContainer> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "realm-live-")));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const stateDir = join(root, "state");
  const workspaceRoot = join(root, "workspace");
  const secretRoot = join(root, "secrets");
  mkdirSync(stateDir, { mode: 0o700 });
  mkdirSync(workspaceRoot, { mode: 0o700 });
  chmodSync(stateDir, 0o700);
  const config = liveConfig(stateDir, workspaceRoot);
  const libpod = new LibpodClient(liveSocketPath());
  const info = await libpod.info();
  const sessionId = `live-${randomUUID()}`;
  const argvSeen: string[][] = [];
  const spawnRunner = spawnOpenShellRunner(selectOpenShellEnvironment(process.env));
  const runner: OpenShellRunner = (argv, options) => {
    argvSeen.push([...argv]);
    return spawnRunner(argv, options);
  };
  const policyPath = writePolicyDocument(config.stateDir, sessionId, egress, AGENTOS_WORKLOAD_BINARY);
  const containerId = await runOpenShellCreate(
    { containers: libpod, createSandbox: createThrough(runner) },
    { sessionId, policyPath, cpus: SANDBOX_CPUS, memory: SANDBOX_MEMORY },
    LIVE_CREATE_DEADLINE_MS,
  );
  t.after(async () => {
    await libpod.removeContainer(containerId, { force: true });
  });
  return { libpod, containerId, sessionId, config, secretRoot, rootless: info.rootless, argvSeen };
}

// A label value from the inspect's Config.Labels, or undefined when the path is absent.
function labelOf(inspect: LibpodInspect | null, key: string): unknown {
  const config = inspect?.["Config"];
  if (typeof config !== "object" || config === null) {
    return undefined;
  }
  const labels = (config as Record<string, unknown>)["Labels"];
  if (typeof labels !== "object" || labels === null) {
    return undefined;
  }
  return (labels as Record<string, unknown>)[key];
}

void test("RT-01 live: a session container created through OpenShell conforms to the hardening profile (RT-01)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t);
  const inspect = await live.libpod.inspectContainer(live.containerId);
  assert.notEqual(inspect, null, "the created container must be inspectable");
  const binding = sandboxBindingOf(
    { workspaceRoot: live.config.workspaceRoot, stateRoot: live.config.stateDir, secretRoot: live.secretRoot },
    realmSandboxName(live.sessionId),
  );
  const failed = verifyInspect({ image: live.config.image, rootless: live.rootless, ...binding }, inspect);
  assert.deepEqual(failed, [], `hardening properties that do not conform: ${failed.join(", ")}`);
});

void test("RT-03 live: the create argv names no command, and the container carries the session label (RT-03)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t);
  assert.equal(live.argvSeen.length, 1, "one OpenShell create run is expected");
  const argv = live.argvSeen[0] ?? [];
  assert.deepEqual(argv.slice(0, 3), ["openshell", "sandbox", "create"]);
  assert.equal(argv.includes("--"), false, "the create argv names no command");
  const inspect = await live.libpod.inspectContainer(live.containerId);
  assert.equal(labelOf(inspect, OPENSHELL_SANDBOX_NAME_LABEL_KEY), realmSandboxName(live.sessionId));
});

// Removes only the containers this test created. The sweep is the production removeAllRealmContainers,
// run through a client that lists and removes nothing else, so realm-labelled containers that belong to
// other sessions on the host are neither removed nor counted.
function scopedSweep(libpod: LibpodClient, created: ReadonlySet<string>): SweepClient {
  return {
    listContainersByLabel: async (key, value) =>
      (await libpod.listContainersByLabel(key, value)).filter((container) => created.has(container.id)),
    removeContainer: (id, options) => {
      if (!created.has(id)) {
        throw new Error("the scoped sweep refuses a container this test did not create");
      }
      return libpod.removeContainer(id, options);
    },
  };
}

void test("RT-09 live: the down sweep leaves none of the containers this test created (RT-09)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t);
  const created = new Set([live.containerId]);
  await removeAllRealmContainers(scopedSweep(live.libpod, created));
  const remaining = (await live.libpod.listContainersByLabel(OPENSHELL_MANAGED_LABEL_KEY, "true")).filter((container) =>
    created.has(container.id),
  );
  assert.deepEqual(remaining, [], "a zero-orphan sweep leaves no container this test created");
});

// ---- Live bodies (RT-05, RT-08, TOOL-03). Each runs under the same gate as the bodies above and
// skips with PODMAN_UNSUPPORTED_VERSION on 4.9.3. Nothing here runs without a 5.x host, a rootless
// API socket, an openshell CLI, and the digest-pinned image.

// Egress is observed from inside the sandbox through the supervisor proxy, not from inside the
// container (D-75): the workload container keeps NetworkMode none (D-83), so each probe runs through
// the pinned exec path. Each body assumes the sandbox provides /bin/sh (OQ-P4-04, live-gated).
const LIVE_EGRESS_HOST = process.env["REALM_LIVE_EGRESS_HOST"] ?? "registry.example.com";
const parsedLiveEgressPort = Number.parseInt(process.env["REALM_LIVE_EGRESS_PORT"] ?? "443", 10);
const LIVE_EGRESS_PORT = Number.isInteger(parsedLiveEgressPort) ? parsedLiveEgressPort : 443;
// The bound for one exec probe, the same TOOL_CALL_TIMEOUT_MS the dispatcher enforces (D-91).
const LIVE_PROBE_TIMEOUT_MS = 30_000;

// True when the sandbox can open a TCP connection to host:port through the supervisor proxy. A
// refused or timed-out probe is false, never a throw, so the bodies assert reachability directly.
async function egressReachable(sessionId: string, host: string, port: number): Promise<boolean> {
  try {
    const outcome = await runSandboxExec(
      spawnOpenShellRunner(selectOpenShellEnvironment(process.env)),
      sessionId,
      ["/bin/sh", "-c", `exec 3<>/dev/tcp/${host}/${String(port)}`],
      LIVE_PROBE_TIMEOUT_MS,
    );
    return outcome.exitCode === 0;
  } catch {
    return false;
  }
}

void test("RT-05 live: an allowlisted host and port is reachable from inside the sandbox through the supervisor proxy (RT-05)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t, [{ host: LIVE_EGRESS_HOST, port: LIVE_EGRESS_PORT }]);
  assert.equal(
    await egressReachable(live.sessionId, LIVE_EGRESS_HOST, LIVE_EGRESS_PORT),
    true,
    `an allowlisted ${LIVE_EGRESS_HOST}:${String(LIVE_EGRESS_PORT)} must be reachable through the supervisor proxy`,
  );
});

void test("RT-05 live: a non-allowlisted host is not reachable from inside the sandbox (RT-05)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t);
  assert.equal(
    await egressReachable(live.sessionId, "never-allowlisted.invalid", 443),
    false,
    "a host outside the deny-all allowlist must not be reachable",
  );
});

void test("RT-05 live: IPv6 is not reachable from inside the sandbox (RT-05)", { skip: liveGate }, async (t) => {
  // Realm renders no IPv6 host into any network_policies entry (D-76), so no IPv6 destination can be
  // allowlisted and the loopback probe below must fail.
  const live = await createLiveContainer(t);
  assert.equal(
    await egressReachable(live.sessionId, "::1", 80),
    false,
    "an IPv6 destination is never allowlisted and must not be reachable",
  );
});

void test("RT-08 live: a crash during up is reaped on the next start on a live host (RT-08)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t);
  // A crash during realm up leaves a record with a null container id (D-86) while the
  // session-labelled container exists on the host.
  const store = new SessionStore(live.config.stateDir);
  store.save({
    realmId: "7b1c2d3e-4f50-4a61-8b72-9c83d4e5f601",
    sessionId: live.sessionId,
    workspaceRoot: live.config.workspaceRoot,
    state: "connecting",
    controlSocketPath: join(live.config.stateDir, "run", "control.sock"),
    containerId: null,
  });
  const created = new Set([live.containerId]);
  const result = await reapStartup({
    store,
    sweep: () => removeAllRealmContainers(scopedSweep(live.libpod, created)),
  });
  assert.equal(result.containersRemoved, 1, "the orphan container is removed");
  assert.equal(result.recordsDeleted, 1, "the stale record is deleted after the sweep");
  assert.deepEqual(store.list(), [], "no record survives the reap");
  const remaining = (await live.libpod.listContainersByLabel(OPENSHELL_MANAGED_LABEL_KEY, "true")).filter((container) =>
    created.has(container.id),
  );
  assert.deepEqual(remaining, [], "no created container survives the reap");
});

void test("TOOL-03 live: an exec through the shared dispatcher runs in the live sandbox (TOOL-03)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t);
  // The controller is a stub pinned to active: only the dispatcher's schema, state, audit, and
  // execution stages run, and the execution reaches the live sandbox through the pinned exec argv.
  const events = createEventBus();
  const controller: DispatcherController = {
    events,
    snapshot: () => ({ state: "active", reason: "live gated exec", lastTransitionAt: new Date().toISOString() }),
    mutationGate: () => {
      throw new Error("the live exec body never reaches the mutation gate");
    },
    bridgeAttached: () => true,
    create: () => {
      throw new Error("the live exec body never creates a session");
    },
  };
  const dispatcher = new ToolDispatcher({
    sessionId: live.sessionId,
    boundRoot: bindRoot(live.config.workspaceRoot),
    policy: loadPolicyFile(join(live.config.stateDir, "policy.json")),
    controller,
    locks: new LockTable(),
    stateDir: live.config.stateDir,
    runOpenShell: spawnOpenShellRunner(selectOpenShellEnvironment(process.env)),
  });
  const outcome = await dispatcher.call({ exec: { argv: ["true"] } });
  assert.equal(outcome.outcome, "done", "the dispatcher exec against the live sandbox succeeds");
  assert.equal(outcome.tool, "exec");
});
