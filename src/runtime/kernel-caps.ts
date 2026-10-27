// Live capability proof for the create-time hardening check. Podman 5.7.1 does not report KernelCaps in libpod inspect, so
// the five capability sets of the container's init process are read from the host's /proc status (D-51). A container that
// cannot be proven to hold no capability fails closed.
import { readFileSync } from "node:fs";
import type { LibpodInspect } from "./libpod-client.js";

// The property the live proof reports. It is the only property the host read checks.
export type LiveProperty = "cap-drop";

// The five capability sets of /proc/<pid>/status. A container's init process must hold all of them empty (D-51).
const CAP_SET_FIELDS = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"] as const;

// Attaches the capability sets of the container's init process, read through State.Pid from the host's status
// (D-51). A missing pid or a status that cannot be read attaches nothing, so the live proof fails closed.
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

// The live proof of a container as attached by attachKernelCaps: every capability set must be present and hold no bit.
// An empty list means the proof holds; otherwise the one failure is reported.
export function liveCapabilityFailures(attached: LibpodInspect): readonly LiveProperty[] {
  return allCapabilitySetsEmpty(attached.KernelCaps) ? [] : ["cap-drop"];
}

// The engine never supplies KernelCaps. Any inbound value is dropped here, so only the host read can attach one.
function withoutKernelCaps(inspect: LibpodInspect): LibpodInspect {
  const copy: Record<string, unknown> = { ...inspect };
  delete copy.KernelCaps;
  return copy;
}

// The capability masks of a /proc/<pid>/status text, keyed by set name. A missing or malformed line leaves its set out,
// so the live proof fails closed on it.
export function capabilitySetsOf(status: string): Readonly<Record<string, string>> {
  const sets: Record<string, string> = {};
  for (const line of status.split("\n")) {
    const match = /^(Cap(?:Inh|Prm|Eff|Bnd|Amb)):\s*([0-9a-fA-F]+)\s*$/.exec(line);
    const name = match?.[1];
    const mask = match?.[2];
    if (name !== undefined && mask !== undefined) {
      sets[name] = mask;
    }
  }
  return sets;
}

// True only when every capability set is present and holds no bit.
function allCapabilitySetsEmpty(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const sets = value as Readonly<Record<string, unknown>>;
  return CAP_SET_FIELDS.every((name) => {
    const mask = sets[name];
    return typeof mask === "string" && /^0+$/.test(mask);
  });
}

// The host's status text for one process, from /proc. Only the create-time live proof reads it.
export function readHostProcStatus(pid: number): string {
  return readFileSync(`/proc/${String(pid)}/status`, "utf8");
}
