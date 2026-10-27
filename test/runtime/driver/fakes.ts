// Shared fakes for the compute driver tests. The libpod fake answers the two listing calls the driver makes. The lifecycle
// fakes record every create, stop and delete, so a test can show that a refused request never reached it. The runtime fake records
// each listener confirmation and each supervisor spawn; a supervisor handle records its stop and can exit on its own.

import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ComputeDriverConfig, DriverSandboxMessage, RuntimeHost } from "../../../src/runtime/driver/compute-driver.js";
import type { ListenerTrust } from "../../../src/runtime/driver/channel.js";
import { DriverLifecycle, type BeforeStart, type LifecycleLibpod } from "../../../src/runtime/driver/lifecycle.js";
import type { SupervisorHandle, SupervisorSpawn } from "../../../src/runtime/driver/supervisor.js";
import type { ContainerSpec, LibpodContainerSummary, LibpodInspect } from "../../../src/runtime/libpod-client.js";
import {
  OPENSHELL_ISOLATION_ROLE_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_VALUE,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
  OPENSHELL_SANDBOX_ROLE_VALUE,
} from "../../../src/runtime/openshell.js";
import { GATEWAY_ID, generateGatewayKey, launchBody } from "../isolation/supervisor-token.js";

export const SANDBOX_IMAGE = `registry.invalid/realm/sandbox@sha256:${"a".repeat(64)}`;
export const OTHER_DIGEST_IMAGE = `registry.invalid/realm/sandbox@sha256:${"b".repeat(64)}`;

// The key every valid create's launch material is signed under.
export const LAUNCH_KEY = generateGatewayKey();

export const SUPERVISOR_BINARY = "/usr/local/libexec/realm/openshell-supervisor";
export const GATEWAY_ENDPOINT = "https://gateway.invalid:8443";
export const GATEWAY_CA_PATH = "/etc/realm/gateway-ca.pem";

interface FakeContainer {
  readonly id: string;
  readonly labels: Readonly<Record<string, string>>;
  running: boolean;
}

// The labels a container the realm creates carries: the managed marker, the sandbox name, and the sandbox role.
export function realmLabels(name: string): Record<string, string> {
  return {
    [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE,
    [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: name,
    [OPENSHELL_ISOLATION_ROLE_LABEL_KEY]: OPENSHELL_SANDBOX_ROLE_VALUE,
  };
}

// Answers listContainersByLabel and inspectContainer from an in-memory table keyed by container name.
export class FakeLibpod {
  readonly containers = new Map<string, FakeContainer>();
  inspectCalls = 0;

  add(name: string, running: boolean): void {
    this.containers.set(name, { id: `id-${name}`, labels: realmLabels(name), running });
  }

  listContainersByLabel(key: string, value: string): Promise<LibpodContainerSummary[]> {
    const listed = [...this.containers.values()]
      .filter((container) => container.labels[key] === value)
      .map((container) => ({ id: container.id, labels: container.labels }));
    return Promise.resolve(listed);
  }

  inspectContainer(name: string): Promise<LibpodInspect | null> {
    this.inspectCalls += 1;
    const container = this.containers.get(name);
    if (container === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      Id: container.id,
      State: { Status: container.running ? "running" : "exited" },
    });
  }
}

// Records each create and delete, and writes the container into the libpod fake on create. A beforeStart hook runs once the
// container exists; when it fails the container is removed again, as the real lifecycle does.
export class FakeLifecycle implements Pick<DriverLifecycle, "create" | "delete" | "stop"> {
  readonly creates: ContainerSpec[] = [];
  readonly deletes: string[] = [];
  readonly stops: string[] = [];

  constructor(private readonly libpod: FakeLibpod) {}

  async create(spec: ContainerSpec, beforeStart?: BeforeStart): Promise<string> {
    this.creates.push(spec);
    this.libpod.add(spec.sandboxName, true);
    const id = `id-${spec.sandboxName}`;
    if (beforeStart !== undefined) {
      try {
        await beforeStart(id);
      } catch (error: unknown) {
        this.libpod.containers.delete(spec.sandboxName);
        throw error;
      }
    }
    return id;
  }

  delete(sandboxName: string): Promise<void> {
    this.deletes.push(sandboxName);
    this.libpod.containers.delete(sandboxName);
    return Promise.resolve();
  }

  stop(sandboxName: string): Promise<void> {
    this.stops.push(sandboxName);
    const container = this.libpod.containers.get(sandboxName);
    if (container !== undefined) {
      container.running = false;
    }
    return Promise.resolve();
  }
}

export interface DiskLifecycle extends Pick<DriverLifecycle, "create" | "delete" | "stop"> {
  readonly creates: ContainerSpec[];
  readonly deletes: string[];
  readonly stops: string[];
}

// A libpod stub for a lifecycle that never finds a container: nothing is listed or found, and every removal succeeds.
function noContainers(): LifecycleLibpod {
  const stub = {
    listContainersByLabel: () => Promise.resolve([]),
    inspectContainer: () => Promise.resolve(null),
    stopContainer: () => Promise.resolve(),
    removeContainer: () => Promise.resolve(),
  };
  return stub as unknown as LifecycleLibpod;
}

// A lifecycle that keeps files on disk the way the real one does. Create runs the beforeStart hook and records the container in
// the libpod fake; delete removes the sandbox's state directory and secret entries through DriverLifecycle. The sweep runs first,
// as the real driver's startup does.
export async function diskLifecycle(config: ComputeDriverConfig, libpod: FakeLibpod): Promise<DiskLifecycle> {
  const disk = new DriverLifecycle({
    libpod: noContainers(),
    sandboxStateRoot: config.sandboxStateRoot,
    secretRoot: config.secretRoot,
  });
  await disk.startupSweep();
  const creates: ContainerSpec[] = [];
  const deletes: string[] = [];
  const stops: string[] = [];
  return {
    creates,
    deletes,
    stops,
    create: async (spec: ContainerSpec, beforeStart?: BeforeStart): Promise<string> => {
      creates.push(spec);
      const id = `id-${spec.sandboxName}`;
      libpod.add(spec.sandboxName, true);
      if (beforeStart !== undefined) {
        try {
          await beforeStart(id);
        } catch (error: unknown) {
          libpod.containers.delete(spec.sandboxName);
          throw error;
        }
      }
      return id;
    },
    delete: async (sandboxName: string): Promise<void> => {
      deletes.push(sandboxName);
      libpod.containers.delete(sandboxName);
      await disk.delete(sandboxName);
    },
    stop: (sandboxName: string): Promise<void> => {
      stops.push(sandboxName);
      const container = libpod.containers.get(sandboxName);
      if (container !== undefined) {
        container.running = false;
      }
      return Promise.resolve();
    },
  };
}

// The host supervisor a spawn returned. stop records each call and ends the process. exit ends it without a stop, as a crash does.
export class FakeSupervisor implements SupervisorHandle {
  stops = 0;
  readonly exited: Promise<void>;
  private exitedNow = false;
  private readonly markExited: () => void;

  constructor(exitedAtSpawn: boolean) {
    let resolveExit: () => void = () => undefined;
    this.exited = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    this.markExited = () => {
      this.exitedNow = true;
      resolveExit();
    };
    if (exitedAtSpawn) {
      this.markExited();
    }
  }

  hasExited(): boolean {
    return this.exitedNow;
  }

  exit(): void {
    this.markExited();
  }

  stop(): Promise<void> {
    this.stops += 1;
    this.markExited();
    return Promise.resolve();
  }
}

// The process-level effects of the driver. Each call is recorded. A test sets listenerError or spawnError to make the next call of
// that step fail with the error, or exitOnSpawn to make each supervisor exit as it is spawned.
export class FakeRuntime implements RuntimeHost {
  // Each listener confirmation, with the control socket it was given and whether server.key was still on disk at that moment.
  readonly confirmations: { readonly controlSocket: string; readonly trust: ListenerTrust; readonly keyPresent: boolean }[] = [];
  readonly spawns: SupervisorSpawn[] = [];
  readonly supervisors: FakeSupervisor[] = [];
  listenerError: Error | undefined = undefined;
  spawnError: Error | undefined = undefined;
  exitOnSpawn = false;

  awaitListener(controlSocket: string, trust: ListenerTrust): Promise<void> {
    this.confirmations.push({ controlSocket, trust, keyPresent: existsSync(join(dirname(controlSocket), "server.key")) });
    return this.listenerError === undefined ? Promise.resolve() : Promise.reject(this.listenerError);
  }

  spawnSupervisor(options: SupervisorSpawn): Promise<SupervisorHandle> {
    this.spawns.push(options);
    if (this.spawnError !== undefined) {
      return Promise.reject(this.spawnError);
    }
    const handle = new FakeSupervisor(this.exitOnSpawn);
    this.supervisors.push(handle);
    return Promise.resolve(handle);
  }
}

export const IMPLEMENTATION_VERSION = "0.1.2";

// A driver config with fresh temporary roots. The state root and the pinned workspace root exist, so a create starts from real roots.
// The pinned workspace root stands for the operator's directory, so the fixture creates it; the driver never does. The secret root is
// not created here: the secret store creates it at 0700 on the first write. Refusals are logged to a silent sink by default, so the
// expected refusals of the suite do not fill the test output; a test that checks the refusal log passes its own sink.
export function driverConfig(overrides: Partial<ComputeDriverConfig> = {}): ComputeDriverConfig {
  const base = mkdtempSync(join(tmpdir(), "realm-driver-test-"));
  const config: ComputeDriverConfig = {
    driverName: "realm",
    sandboxImage: SANDBOX_IMAGE,
    sandboxStateRoot: join(base, "state"),
    secretRoot: join(base, "secrets"),
    workspaceRoot: join(base, "workspace"),
    implementationVersion: IMPLEMENTATION_VERSION,
    gatewayId: GATEWAY_ID,
    supervisor: { binary: SUPERVISOR_BINARY, gatewayEndpoint: GATEWAY_ENDPOINT, gatewayCaPath: GATEWAY_CA_PATH },
    refusalLog: () => undefined,
    ...overrides,
  };
  mkdirSync(config.sandboxStateRoot, { recursive: true });
  mkdirSync(config.workspaceRoot, { recursive: true });
  return config;
}

// A create request the realm profile accepts, carrying launch material the driver can verify with. Each test changes one field
// to make a refusal.
export function validSandbox(overrides: Partial<DriverSandboxMessage> = {}): DriverSandboxMessage {
  return {
    id: "sandbox-1",
    name: "realm-session-1",
    workspace: "workspace-a",
    spec: {
      environment: {},
      command: ["/usr/bin/true"],
      resource_requirements: null,
      isolation_backend: null,
      launch_authentication: launchBody(LAUNCH_KEY),
      template: {
        image: SANDBOX_IMAGE,
        environment: {},
        platform_config: null,
        driver_config: null,
        user_namespaces: null,
        resources: { cpu_request: "", cpu_limit: "2", memory_request: "", memory_limit: "1Gi" },
      },
    },
    ...overrides,
  };
}

// A fresh directory for a socket. It is short, because a unix socket path has a small length limit.
export function socketDirectory(): string {
  return mkdtempSync(join(tmpdir(), "realm-driver-sock-"));
}
