// Kernel capability reader for the create-time hardening check. libpod inspect does not report the five
// capability sets of the container's init process, so the host reads them from /proc (D-51).
import { readFileSync } from "node:fs";
import type { LibpodInspect } from "./libpod-client.js";
import { capabilitySetsOf } from "./hardening.js";

// Attaches the capability sets of the container's init process, read through State.Pid from the host's status
// (D-51). A missing pid or a status that cannot be read attaches nothing, so the cap-drop check fails closed.
export function attachKernelCaps(inspect: LibpodInspect, readStatus: (pid: number) => string): LibpodInspect {
  const base = withoutKernelCaps(inspect);
  const state = base.State as Readonly<{ Pid?: unknown }> | undefined;
  const pid = state?.Pid;
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return base;
  }
  try {
    return { ...base, KernelCaps: capabilitySetsOf(readStatus(pid)) };
  } catch {
    return base;
  }
}

// The engine never supplies KernelCaps. Any inbound value is dropped here, so only the host read can attach one.
function withoutKernelCaps(inspect: LibpodInspect): LibpodInspect {
  const copy: Record<string, unknown> = { ...inspect };
  delete copy.KernelCaps;
  return copy;
}

// The host's status text for one process, from /proc. Only the create-time capability check reads it.
export function readHostProcStatus(pid: number): string {
  return readFileSync(`/proc/${String(pid)}/status`, "utf8");
}
