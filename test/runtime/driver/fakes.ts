// Shared fakes for the compute driver tests. The libpod fake answers the two listing calls the driver makes. The lifecycle
// fake records every create, so a test can show that a refused request never reached it.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DriverLifecycle } from "../../../src/runtime/driver/lifecycle.js";
import type { ComputeDriverConfig, DriverSandboxMessage } from "../../../src/runtime/driver/compute-driver.js";
import type { ContainerSpec, LibpodContainerSummary, LibpodInspect } from "../../../src/runtime/libpod-client.js";
import {
  OPENSHELL_ISOLATION_ROLE_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_VALUE,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
  OPENSHELL_SANDBOX_ROLE_VALUE,
} from "../../../src/runtime/openshell.js";

export const SANDBOX_IMAGE = `registry.invalid/realm/sandbox@sha256:${"a".repeat(64)}`;
export const OTHER_DIGEST_IMAGE = `registry.invalid/realm/sandbox@sha256:${"b".repeat(64)}`;

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

// Records each create and delete, and writes the container into the libpod fake on create.
export class FakeLifecycle implements Pick<DriverLifecycle, "create" | "delete"> {
  readonly creates: ContainerSpec[] = [];
  readonly deletes: string[] = [];

  constructor(private readonly libpod: FakeLibpod) {}

  create(spec: ContainerSpec): Promise<string> {
    this.creates.push(spec);
    this.libpod.add(spec.sandboxName, true);
    return Promise.resolve(`id-${spec.sandboxName}`);
  }

  delete(sandboxName: string): Promise<void> {
    this.deletes.push(sandboxName);
    this.libpod.containers.delete(sandboxName);
    return Promise.resolve();
  }
}

// A driver config with fresh temporary roots. The roots are real directories so workspace tests can use them.
export function driverConfig(overrides: Partial<ComputeDriverConfig> = {}): ComputeDriverConfig {
  const base = mkdtempSync(join(tmpdir(), "realm-driver-test-"));
  const workspaceRoot = join(base, "workspaces");
  return {
    driverName: "realm",
    sandboxImage: SANDBOX_IMAGE,
    sandboxStateRoot: join(base, "state"),
    workspaceRoot,
    ...overrides,
  };
}

// A create request the realm profile accepts. Each test changes one field to make a refusal.
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
