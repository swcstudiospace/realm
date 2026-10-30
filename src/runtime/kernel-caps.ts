// Live proof of the container's init process for the create-time hardening check. Podman 5.7.1 does not report KernelCaps in
// libpod inspect, so the five capability sets of the container's init process are read from the host's /proc status (D-51). The
// same read gives the live Seccomp mode and NoNewPrivs flag of the process, which prove that the seccomp filter and no_new_privs
// are applied to the running process and not only configured. A container that cannot be proven to hold no capability fails closed.
import { readFileSync } from "node:fs";
import type { LibpodInspect } from "./libpod-client.js";

// The property the live capability proof reports. The seccomp mode and no_new_privs flag are verifier properties
// (hardening.ts), which read the KernelStatus evidence attached here.
export type LiveProperty = "cap-drop";

// The synthetic inspect field that carries the Seccomp and NoNewPrivs values of /proc/<pid>/status, as the host's text gives them.
export const KERNEL_STATUS_FIELD = "KernelStatus";

// The five capability sets of /proc/<pid>/status. A container's init process must hold all of them empty (D-51).
const CAP_SET_FIELDS = ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"] as const;

// Attaches the capability sets, the seccomp mode and the no_new_privs flag of the container's init process, read through
// State.Pid from the host's status (D-51). A missing pid or a status that cannot be read attaches nothing, so the live proof
// fails closed.
export function attachKernelCaps(inspect: LibpodInspect, readStatus: (pid: number) => string): LibpodInspect {
  const base = withoutKernelEvidence(inspect);
  const pid = pidOf(base);
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
    return base;
  }
  try {
    const status = readStatus(pid);
    return { ...base, KernelCaps: capabilitySetsOf(status), [KERNEL_STATUS_FIELD]: kernelStatusOf(status) };
  } catch {
    return base;
  }
}

// The live proof of a container as attached by attachKernelCaps: every capability set must be present and hold no bit.
// An empty list means the proof holds; otherwise the one failure is reported.
export function liveCapabilityFailures(attached: LibpodInspect): readonly LiveProperty[] {
  return allCapabilitySetsEmpty(attached.KernelCaps) ? [] : ["cap-drop"];
}

// The engine never supplies the kernel evidence. Any inbound value is dropped here, so only the host read can attach one.
function withoutKernelEvidence(inspect: LibpodInspect): LibpodInspect {
  const copy: Record<string, unknown> = { ...inspect };
  Reflect.deleteProperty(copy, "KernelCaps");
  Reflect.deleteProperty(copy, KERNEL_STATUS_FIELD);
  return copy;
}

// State.Pid of an inspect, or undefined when State is not a plain object.
function pidOf(inspect: LibpodInspect): unknown {
  const state = inspect.State;
  return isRecord(state) ? state.Pid : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The Seccomp and NoNewPrivs values of a /proc/<pid>/status text, keyed by field name. The Seccomp_filters line is a different
// field and never matches. A missing or malformed line leaves its field out, so the verifier fails closed on it.
export function kernelStatusOf(status: string): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const line of status.split("\n")) {
    const match = /^(Seccomp|NoNewPrivs):\s*([0-9]+)\s*$/.exec(line);
    const name = match?.[1];
    const value = match?.[2];
    if (name !== undefined && value !== undefined) {
      values[name] = value;
    }
  }
  return values;
}

// The capability masks of a /proc/<pid>/status text, keyed by set name. A missing or malformed line leaves its set out,
// so the live proof fails closed on it.
function capabilitySetsOf(status: string): Readonly<Record<string, string>> {
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
  if (!isRecord(value)) {
    return false;
  }
  return CAP_SET_FIELDS.every((name) => {
    const mask = value[name];
    return typeof mask === "string" && /^0+$/.test(mask);
  });
}

// The host's status text for one process, from /proc. Only the create-time live proof reads it.
export function readHostProcStatus(pid: number): string {
  return readFileSync(`/proc/${String(pid)}/status`, "utf8");
}
