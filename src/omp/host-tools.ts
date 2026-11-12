// Host tool set (OMPX-03, OMPX-04): the Omp built-ins this plugin removes or restores as the daemon's policy mode changes.
// This module does not import plugin.ts. It reads Omp through the structural HostToolsApi, which OmpExtensionApi satisfies.

import { makeRealmError } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import type { PolicyMode } from "../contract/validate.js";
import type { DaemonStatus } from "../daemon/client.js";
import { planHostTools, sameToolNames } from "./tools.js";

// The Omp tool surface the host tool set reads and changes. Only these three members are used.
interface HostToolsApi {
  getAllTools(): readonly { readonly name: string }[];
  getActiveTools(): readonly string[];
  setActiveTools(names: string[]): Promise<void>;
}

// The host's tool set as this plugin left it (OMPX-03, OMPX-04). Omp keeps every removal for the life of the process, so one
// set serves every session of the registration: a new session, a retry or a restarted daemon starts from what was last applied.
export interface HostToolSet {
  readonly pi: HostToolsApi;
  // The built-ins this plugin removed in fail-closed mode and has not put back, as the last change read them back from Omp. An
  // advisory plan gives back the ones Omp still registers.
  removed: string[];
  // Changes accepted and not yet settled: one running and at most one waiting (MAX_HOST_CHANGES).
  inFlight: number;
  // Changes run one at a time, so a setter already in flight finishes before the next one starts.
  queue: Promise<void>;
}

// The most changes the set holds at once: one running and one waiting. A change past that is refused at once, so no queue grows
// behind a setter that does not return.
const MAX_HOST_CHANGES = 2;

// The longest one host tool setter may take. A setter that has not settled by then fails its change with TOOL_TIMEOUT, so the
// queue moves on and no later change is refused behind it.
export const HOST_TOOL_SET_BUDGET_MS = 5_000;

// A fresh host tool set for one registration: nothing is removed yet and no change is in flight.
export function hostToolSetOf(pi: HostToolsApi): HostToolSet {
  return { pi, removed: [], inFlight: 0, queue: Promise.resolve() };
}

// The policy mode a status reports. A mode that cannot be read is refused, so the status changes no host tool (P16 e).
export function modeOf(status: DaemonStatus): PolicyMode {
  if (!isPolicyMode(status.mode)) {
    throw makeRealmError("POLICY_DENIED");
  }
  return status.mode;
}

function isPolicyMode(value: unknown): value is PolicyMode {
  return value === "advisory" || value === "fail-closed";
}

// Brings the host tool set to posture. A change starts only if isCurrent still holds when its turn in the queue comes, so a
// superseded attempt, an attempt past its budget, or a shut-down session changes nothing. Rejects with POLICY_DENIED when the
// set does not read back as wanted, and at once when MAX_HOST_CHANGES changes are already accepted and unsettled.
export function setHostMode(tools: HostToolSet, mode: PolicyMode, isCurrent: () => boolean): Promise<void> {
  if (tools.inFlight >= MAX_HOST_CHANGES) {
    return Promise.reject(makeRealmError("POLICY_DENIED"));
  }
  tools.inFlight += 1;
  const change = tools.queue.then(() => applyHostMode(tools, mode, isCurrent)).finally(() => {
    tools.inFlight -= 1;
  });
  tools.queue = change.then(
    () => undefined,
    () => undefined,
  );
  return change;
}

// Plans from what Omp reports now, not from the last applied mode, so a drift in the same mode is restored too (P16 c). Once a
// setter has started it runs to the end, whoever owns it by then. The owed list is read back from the set Omp holds, on success or
// failure, so the next owner plans from actual state (P16 b).
async function applyHostMode(tools: HostToolSet, mode: PolicyMode, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) {
    return;
  }
  const { pi } = tools;
  const plan = planHostTools(mode, pi.getAllTools().map((tool) => tool.name), pi.getActiveTools(), tools.removed);
  // Owed going into the change, so a removal that only partly holds is still owed a restore.
  const owedIn = [...new Set([...tools.removed, ...plan.owed])];
  const readBack = (): void => {
    const reported = pi.getActiveTools();
    const registered = pi.getAllTools().map((tool) => tool.name);
    const owed = new Set([...tools.removed, ...owedIn]);
    tools.removed = [...owed].filter((name) => registered.includes(name) && !reported.includes(name));
  };
  let setter: Promise<void> | undefined;
  try {
    if (!sameToolNames(pi.getActiveTools(), plan.wanted)) {
      setter = pi.setActiveTools(plan.wanted);
      await withTimeout(setter, HOST_TOOL_SET_BUDGET_MS, "TOOL_TIMEOUT");
    }
  } finally {
    // Read back whether or not the setter held, and whether or not this change is still current.
    readBack();
    if (setter !== undefined) {
      // A setter past its budget may still apply later. Its read-back then replaces the record, so the next owner plans from the host.
      setter.then(readBack, readBack);
    }
  }
  if (!sameToolNames(pi.getActiveTools(), plan.wanted)) {
    throw makeRealmError("POLICY_DENIED");
  }
}
