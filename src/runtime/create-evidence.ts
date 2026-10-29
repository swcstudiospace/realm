// The host-side evidence the create-time verifier reads besides the libpod inspect (RT-01, D-51). The libpod inspect is the
// engine's report. The evidence is read on the host, from the container's OCI config and from its init process's /proc status,
// so the engine's answer is not the only proof. attachRuntimeEvidence attaches all of it in one step: the seccomp verdict
// (seccomp-evidence.ts), the capability sets, seccomp mode and no_new_privs flag of the init process (kernel-caps.ts), and the
// OCI config's rlimits, sysctls, masked paths and read-only paths. Any inbound value of an evidence field is dropped first, so only
// a host read attaches one, and a config that cannot be read attaches nothing, so every property that needs it fails closed.
import type { LibpodInspect } from "./libpod-client.js";
import { attachKernelCaps } from "./kernel-caps.js";
import { attachSeccompEvidence, MAX_OCI_CONFIG_BYTES } from "./seccomp-evidence.js";

// The synthetic inspect field that carries the projection of the OCI config. The engine never supplies it.
export const OCI_RUNTIME_FIELD = "OciRuntimeConfig";

// Attaches the evidence of one container. The OCI config is read once, through the path attachSeccompEvidence accepts, so the
// seccomp verdict and the projection come from the same bytes and from the same validated location. An unreadable or oversize
// config, or one that is not a JSON object, attaches no projection.
export function attachRuntimeEvidence(
  inspect: LibpodInspect,
  readOciConfig: (path: string) => string,
  readProcStatus: (pid: number) => string,
): LibpodInspect {
  const captured: { text?: string } = {};
  const capture = (path: string): string => {
    const text = readOciConfig(path);
    if (typeof text === "string") {
      captured.text = text;
    }
    return text;
  };
  const withSeccomp = attachSeccompEvidence(withoutOciRuntime(inspect), capture);
  const withConfig = captured.text === undefined ? withSeccomp : withOciRuntime(withSeccomp, captured.text);
  return attachKernelCaps(withConfig, readProcStatus);
}

// The engine never supplies the projection. Any inbound value is dropped here.
function withoutOciRuntime(inspect: LibpodInspect): LibpodInspect {
  const copy: Record<string, unknown> = { ...inspect };
  Reflect.deleteProperty(copy, OCI_RUNTIME_FIELD);
  return copy;
}

// Adds the fields of the OCI config the verifier compares. The values are kept as parsed: the verifier checks their types, so a
// missing or mistyped field fails its property.
function withOciRuntime(inspect: LibpodInspect, text: string): LibpodInspect {
  if (text.length > MAX_OCI_CONFIG_BYTES) {
    return inspect;
  }
  let spec: unknown;
  try {
    spec = JSON.parse(text);
  } catch {
    // Unparseable text attaches nothing, so every property that reads the projection fails.
    return inspect;
  }
  if (!isRecord(spec)) {
    return inspect;
  }
  const processSection = recordAt(spec, "process");
  const linux = recordAt(spec, "linux");
  return {
    ...inspect,
    [OCI_RUNTIME_FIELD]: {
      rlimits: processSection?.rlimits,
      sysctl: linux?.sysctl,
      maskedPaths: linux?.maskedPaths,
      readonlyPaths: linux?.readonlyPaths,
    },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(source: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> | undefined {
  const value = source[key];
  return isRecord(value) ? value : undefined;
}
