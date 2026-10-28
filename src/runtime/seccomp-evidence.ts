// Seccomp proof for the create-time hardening check. Podman 5.7.1 records `seccomp=<path>` in HostConfig.SecurityOpt only for a container
// the podman CLI created (the CLI sets an annotation the API does not). A container created through the libpod API with
// seccomp_profile_path runs under the profile, but its inspect shows only `no-new-privileges`. The applied profile is visible in the
// container's OCI runtime config, `linux.seccomp`. The inspect names that file in OCIConfigPath, so the keyring syscalls are proven
// denied from there. A container whose config cannot be read and understood fails closed.
import { closeSync, openSync, readSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { LibpodInspect } from "./libpod-client.js";

// The synthetic inspect field that carries the verdict. The engine never supplies it, so any inbound value is dropped first.
export const SECCOMP_EVIDENCE_FIELD = "SeccompKeyringDenied";

// The largest OCI config this module reads. A real config is a few tens of KiB.
export const MAX_OCI_CONFIG_BYTES = 1024 * 1024;

// The syscalls that give access to the kernel keyring. Each must be denied with EPERM (errno 1).
const KEYRING_SYSCALLS = ["keyctl", "add_key", "request_key"] as const;
const DENY_ACTION = "SCMP_ACT_ERRNO";
const EPERM = 1;

// Attaches the keyring verdict, read from the container's OCI config through OCIConfigPath. The path must be absolute and must equal
// StaticDir joined with "config.json", so a forged inspect value cannot point at a file outside the container's own static directory.
// A missing or wrong path, an unreadable, oversize or unparseable file attaches nothing, so the property fails closed. Never throws.
export function attachSeccompEvidence(inspect: LibpodInspect, readFile: (path: string) => string): LibpodInspect {
  const base = withoutSeccompEvidence(inspect);
  const path = configPathOf(base);
  if (path === undefined) {
    return base;
  }
  try {
    const text = readFile(path);
    if (typeof text !== "string" || text.length > MAX_OCI_CONFIG_BYTES) {
      return base;
    }
    return { ...base, [SECCOMP_EVIDENCE_FIELD]: keyringSyscallsDenied(JSON.parse(text) as unknown) };
  } catch {
    return base;
  }
}

// The property's evidence: true only when attachSeccompEvidence attached a verdict of exactly true.
export function keyringEvidenceHolds(attached: unknown): boolean {
  return typeof attached === "object" && attached !== null && Reflect.get(attached, SECCOMP_EVIDENCE_FIELD) === true;
}

// The pure decision over a parsed OCI spec. The keyring syscalls are denied only when linux.seccomp exists with default action
// SCMP_ACT_ERRNO, and each of keyctl, add_key and request_key is listed by at least one rule with action SCMP_ACT_ERRNO and errnoRet
// exactly 1, and by no rule with another action or another errnoRet (a missing errnoRet is not 1). A rule whose names are not an
// array, and any non-string name, is ignored for matching, never read as a deny.
export function keyringSyscallsDenied(spec: unknown): boolean {
  const seccomp = recordAt(recordAt(spec, "linux"), "seccomp");
  if (seccomp === undefined || seccomp.defaultAction !== DENY_ACTION) {
    return false;
  }
  const rules: unknown = seccomp.syscalls;
  if (!Array.isArray(rules)) {
    return false;
  }
  const entries: readonly unknown[] = rules;
  return KEYRING_SYSCALLS.every((syscall) => {
    let denied = false;
    for (const rule of entries) {
      const names = isRecord(rule) ? rule.names : undefined;
      if (!isRecord(rule) || !Array.isArray(names) || !(names as readonly unknown[]).includes(syscall)) {
        continue;
      }
      if (rule.action === DENY_ACTION && rule.errnoRet === EPERM) {
        denied = true;
      } else {
        return false;
      }
    }
    return denied;
  });
}

// The host's OCI config text for one container, bounded to MAX_OCI_CONFIG_BYTES. A longer file throws. Only the create-time proof reads it.
export function readHostOciConfig(path: string): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_OCI_CONFIG_BYTES + 1);
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    if (read > MAX_OCI_CONFIG_BYTES) {
      throw new RangeError("OCI config too large");
    }
    return buffer.toString("utf8", 0, read);
  } finally {
    closeSync(fd);
  }
}

// The engine never supplies the evidence field. Any inbound value is dropped here, so only the host read can attach one.
function withoutSeccompEvidence(inspect: LibpodInspect): LibpodInspect {
  const copy: Record<string, unknown> = { ...inspect };
  Reflect.deleteProperty(copy, SECCOMP_EVIDENCE_FIELD);
  return copy;
}

// OCIConfigPath when it is an absolute path equal to StaticDir (absolute, no ".." segment) joined with "config.json".
function configPathOf(inspect: LibpodInspect): string | undefined {
  const path: unknown = inspect.OCIConfigPath;
  const staticDir: unknown = inspect.StaticDir;
  if (typeof path !== "string" || typeof staticDir !== "string") {
    return undefined;
  }
  if (!isAbsolute(path) || !isAbsolute(staticDir) || path.includes("\0") || staticDir.includes("\0")) {
    return undefined;
  }
  if (staticDir.split("/").includes("..")) {
    return undefined;
  }
  return path === join(staticDir, "config.json") ? path : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordAt(source: unknown, key: string): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(source)) {
    return undefined;
  }
  const value = source[key];
  return isRecord(value) ? value : undefined;
}
