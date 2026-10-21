// Podman gate and live bodies (RT-01, RT-03, RT-09).
//
// The suite skips below Podman 5.x. Each live body also needs a rootless Podman API socket, an openshell
// CLI on PATH, REALM_LIVE_IMAGE (a digest-pinned image) and REALM_LIVE_WORKLOAD (a JSON string array).
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
import { loadRuntimeConfig, type RuntimeConfig } from "../../src/runtime/config.js";
import { HARDENING_PROFILE, verifyInspect } from "../../src/runtime/hardening.js";
import { LibpodClient, type LibpodInspect } from "../../src/runtime/libpod-client.js";
import {
  MANAGED_LABEL_KEY,
  runOpenShellCreate,
  SESSION_LABEL_KEY,
  writePolicyDocument,
  type OpenShellRunner,
} from "../../src/runtime/openshell.js";
import { parsePodmanVersion, podmanSkipReason, type PodmanProbe } from "../../src/runtime/podman-version.js";
import { removeAllRealmContainers, selectOpenShellEnvironment, spawnOpenShellRunner, type SweepClient } from "../../src/runtime/session-execution.js";

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
// are present; it does not run the CLI, so the 0.1.2 version is checked by the doctor's openshell item.
// Phase 3 verification runs on a 4.9.3 host, so none of them executes there.
test("Podman gate: the host reports Podman 5.x or newer (RT-02)", { skip: gate }, () => {
  if (probe.kind !== "output") {
    assert.fail("the gate ran the suite without a successful podman --version probe");
  }
  const parsed = parsePodmanVersion(probe.stdout);
  if (!parsed.ok) {
    assert.fail(`podman --version output did not parse: ${parsed.reason}`);
  }
  assert.ok(parsed.major >= 5, `expected Podman 5.x or newer, found ${parsed.version}`);
});

// ---- Live bodies (RT-01, RT-03, RT-09). Each needs the 5.x host described above, a digest-pinned
// image in REALM_LIVE_IMAGE, and a JSON string array in REALM_LIVE_WORKLOAD. A host without them
// skips each body with a stated reason. The bodies drive the production create path, so a 5.x run
// observes real behaviour; nothing in this file claims a live result that has not run.

const LIVE_IMAGE_VARIABLE = "REALM_LIVE_IMAGE";
const LIVE_WORKLOAD_VARIABLE = "REALM_LIVE_WORKLOAD";
// The bound for one OpenShell create, the same as the composition's create deadline.
const LIVE_CREATE_DEADLINE_MS = 60_000;
// The sandbox limits come from the frozen hardening profile, as the composition derives them.
const SANDBOX_CPUS = HARDENING_PROFILE.nanoCpus / 1_000_000_000;
const SANDBOX_MEMORY = `${HARDENING_PROFILE.memoryBytes / 1024 ** 3}g`;

const liveGate: string | false = gate === false ? liveInputsSkipReason() : gate;

function liveInputsSkipReason(): string | false {
  const missing = [LIVE_IMAGE_VARIABLE, LIVE_WORKLOAD_VARIABLE].filter((name) => (process.env[name] ?? "") === "");
  if (missing.length > 0) {
    return `${missing.join(" and ")} not set; the live bodies need a digest-pinned image and a workload argv`;
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
  readonly rootless: boolean;
  // Every argv the OpenShell runner was given, in order.
  readonly argvSeen: string[][];
}

// Reads the live configuration. A malformed value throws, so a misconfigured live run fails loudly.
function liveConfig(stateDir: string, workspaceRoot: string): RuntimeConfig {
  const workload: unknown = JSON.parse(process.env[LIVE_WORKLOAD_VARIABLE] ?? "[]");
  return loadRuntimeConfig({
    image: process.env[LIVE_IMAGE_VARIABLE],
    workloadArgv: workload,
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
// container is removed when the test ends. Every argv the runner receives is recorded.
async function createLiveContainer(t: TestContext): Promise<LiveContainer> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "realm-live-")));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const stateDir = join(root, "state");
  const workspaceRoot = join(root, "workspace");
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
  const policyPath = writePolicyDocument(config.stateDir, sessionId);
  const containerId = await runOpenShellCreate(
    { containers: libpod, runner },
    { sessionId, policyPath, cpus: SANDBOX_CPUS, memory: SANDBOX_MEMORY, workloadArgv: config.workloadArgv },
    LIVE_CREATE_DEADLINE_MS,
  );
  t.after(async () => {
    await libpod.removeContainer(containerId, { force: true });
  });
  return { libpod, containerId, sessionId, config, rootless: info.rootless, argvSeen };
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

test("RT-01 live: a session container created through OpenShell conforms to the hardening profile (RT-01)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t);
  const inspect = await live.libpod.inspectContainer(live.containerId);
  assert.notEqual(inspect, null, "the created container must be inspectable");
  const failed = verifyInspect(
    {
      image: live.config.image,
      rootless: live.rootless,
      workspaceRoot: live.config.workspaceRoot,
      stateDir: live.config.stateDir,
    },
    inspect,
  );
  assert.deepEqual(failed, [], `hardening properties that do not conform: ${failed.join(", ")}`);
});

test("RT-03 live: the workload starts only through the pinned OpenShell create argv, and the container carries the session label (RT-03)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t);
  assert.equal(live.argvSeen.length, 1, "one OpenShell create run is expected");
  const argv = live.argvSeen[0] ?? [];
  assert.deepEqual(argv.slice(0, 3), ["openshell", "sandbox", "create"]);
  const separator = argv.indexOf("--");
  assert.ok(separator > 0, "the argv must carry the -- separator before the workload");
  assert.deepEqual(argv.slice(separator + 1), live.config.workloadArgv);
  const inspect = await live.libpod.inspectContainer(live.containerId);
  assert.equal(labelOf(inspect, SESSION_LABEL_KEY), live.sessionId);
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

test("RT-09 live: the down sweep leaves none of the containers this test created (RT-09)", { skip: liveGate }, async (t) => {
  const live = await createLiveContainer(t);
  const created = new Set([live.containerId]);
  await removeAllRealmContainers(scopedSweep(live.libpod, created));
  const remaining = (await live.libpod.listContainersByLabel(MANAGED_LABEL_KEY, "true")).filter((container) =>
    created.has(container.id),
  );
  assert.deepEqual(remaining, [], "a zero-orphan sweep leaves no container this test created");
});
