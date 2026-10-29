// The sandbox create as the AgentOS driver runs it, through the given OpenShell runner. The tests that drive the
// label lookup around a create use it, so the create they run is the driver's own argv and not a copy of it.

import { createOpenShellAgentOsDriver } from "../../src/runtime/agentos-driver.js";
import type { OpenShellRunner, SandboxCreateRequest } from "../../src/runtime/openshell.js";

export function createThrough(
  runner: OpenShellRunner,
): (request: SandboxCreateRequest, timeoutMs: number) => Promise<void> {
  return (request, timeoutMs) =>
    createOpenShellAgentOsDriver({
      runner,
      spawnRunner: () => {
        throw new Error("a create test starts no runner child");
      },
      startTimeoutMs: timeoutMs,
      callTimeoutMs: timeoutMs,
    }).create(request, timeoutMs);
}
