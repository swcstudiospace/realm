// Seccomp proof for the create-time hardening check. Podman 5.7.1 records `seccomp=<path>` in HostConfig.SecurityOpt only for a container
// the podman CLI created (the CLI sets an annotation the API does not). A container created through the libpod API with
// seccomp_profile_path runs under the profile, but its inspect shows only `no-new-privileges`. The applied profile is visible in the
// container's OCI runtime config, `linux.seccomp`. The inspect names that file in OCIConfigPath, so the keyring, namespace and mount
// syscall denials are proven from there. A container whose config cannot be read and understood fails closed.
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
const ENOSYS = 38;
const ALLOW_ACTION = "SCMP_ACT_ALLOW";
const CLONE_SYSCALL = "clone";
const MASKED_EQ = "SCMP_CMP_MASKED_EQ";
// CLONE_NEWNS, NEWCGROUP, NEWUTS, NEWIPC, NEWUSER, NEWPID and NEWNET.
const CLONE_NAMESPACE_MASK = 2114060288;

// The syscalls that enter or create a namespace, or change the mount tree. Each must be denied with EPERM (errno 1).
const ISOLATION_SYSCALLS = [
  "unshare",
  "setns",
  "mount",
  "umount",
  "umount2",
  "mount_setattr",
  "move_mount",
  "open_tree",
  "pivot_root",
  "fsconfig",
  "fsmount",
  "fsopen",
  "fspick",
] as const;
// clone3 must answer ENOSYS (errno 38), so glibc falls back to clone.
const CLONE3_SYSCALLS = ["clone3"] as const;

// Attaches the seccomp verdict (keyring, namespace and mount denials), read from the container's OCI config through OCIConfigPath. The path must be absolute and must equal
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
    const spec = JSON.parse(text) as unknown;
    const verdict = keyringSyscallsDenied(spec) && isolationSyscallsDenied(spec) && cloneRuleConfined(spec) && defaultErrnoIsEnosys(spec);
    return { ...base, [SECCOMP_EVIDENCE_FIELD]: verdict };
  } catch {
    return base;
  }
}

// The property's evidence: true only when attachSeccompEvidence attached a verdict of exactly true.
export function keyringEvidenceHolds(attached: unknown): boolean {
  return typeof attached === "object" && attached !== null && Reflect.get(attached, SECCOMP_EVIDENCE_FIELD) === true;
}

// The pure decision over a parsed OCI spec, shared by both checks below. The syscalls are denied only when linux.seccomp exists
// with default action SCMP_ACT_ERRNO, and each one is listed by at least one rule with action SCMP_ACT_ERRNO, errnoRet exactly
// `errnoRet` and no args, and by no rule with another action, another errnoRet (a missing errnoRet matches nothing) or an args
// condition: a rule gated by an argument matches only some calls, so it is no denial. A rule whose names are not an array, and
// any non-string name, is ignored for matching, never read as a deny.
function syscallsDeniedWith(spec: unknown, syscalls: readonly string[], errnoRet: number): boolean {
  const seccomp = recordAt(recordAt(spec, "linux"), "seccomp");
  if (seccomp === undefined || seccomp.defaultAction !== DENY_ACTION) {
    return false;
  }
  const rules: unknown = seccomp.syscalls;
  if (!Array.isArray(rules)) {
    return false;
  }
  const entries: readonly unknown[] = rules;
  return syscalls.every((syscall) => {
    let denied = false;
    for (const rule of entries) {
      const names = isRecord(rule) ? rule.names : undefined;
      if (!isRecord(rule) || !Array.isArray(names) || !(names as readonly unknown[]).includes(syscall)) {
        continue;
      }
      if (rule.action === DENY_ACTION && rule.errnoRet === errnoRet && hasNoArgs(rule)) {
        denied = true;
      } else {
        return false;
      }
    }
    return denied;
  });
}

// The keyring syscalls keyctl, add_key and request_key are each denied with EPERM.
export function keyringSyscallsDenied(spec: unknown): boolean {
  return syscallsDeniedWith(spec, KEYRING_SYSCALLS, EPERM);
}

// A sandbox cannot enter or create a namespace or mount: unshare, setns and the mount family are each denied with EPERM, and clone3
// is denied with ENOSYS so glibc falls back to clone, whose namespace flags the profile's clone rule inspects.
export function isolationSyscallsDenied(spec: unknown): boolean {
  return syscallsDeniedWith(spec, ISOLATION_SYSCALLS, EPERM) && syscallsDeniedWith(spec, CLONE3_SYSCALLS, ENOSYS);
}

// The clone rule is the real closure of namespace creation: every rule naming clone must be SCMP_ACT_ALLOW with exactly one argument,
// the masked equality on argument 0 that leaves every namespace flag clear (mask 2114060288, valueTwo 0), and at least one such rule
// must exist. An unconditional clone allow, a rule with another mask, index or valueTwo, a clone rule of another action, or no clone
// rule at all is refused. Argument 0 is the flags argument on x86-64 and arm64 only (it is argument 1 on s390 and s390x).
export function cloneRuleConfined(spec: unknown): boolean {
  const seccomp = recordAt(recordAt(spec, "linux"), "seccomp");
  if (seccomp === undefined || seccomp.defaultAction !== DENY_ACTION) {
    return false;
  }
  const rules: unknown = seccomp.syscalls;
  if (!Array.isArray(rules)) {
    return false;
  }
  let confined = false;
  for (const rule of rules as readonly unknown[]) {
    const names = isRecord(rule) ? rule.names : undefined;
    if (!isRecord(rule) || !Array.isArray(names) || !(names as readonly unknown[]).includes(CLONE_SYSCALL)) {
      continue;
    }
    if (rule.action !== ALLOW_ACTION || !isNamespaceFlagMask(rule.args)) {
      return false;
    }
    confined = true;
  }
  return confined;
}

// The applied default is ERRNO with errno 38 (ENOSYS), so glibc falls back for a syscall the profile does not know.
export function defaultErrnoIsEnosys(spec: unknown): boolean {
  const seccomp = recordAt(recordAt(spec, "linux"), "seccomp");
  return seccomp !== undefined && seccomp.defaultAction === DENY_ACTION && seccomp.defaultErrnoRet === ENOSYS;
}

// True when the rule carries no argument condition: args absent or an empty array.
function hasNoArgs(rule: Readonly<Record<string, unknown>>): boolean {
  const args = rule.args;
  return args === undefined || (Array.isArray(args) && args.length === 0);
}

// True when `args` is exactly one argument: index 0, op SCMP_CMP_MASKED_EQ, value CLONE_NAMESPACE_MASK, valueTwo 0. The OCI runtime
// spec omits a zero valueTwo from its JSON, so an absent valueTwo is the same condition as 0; any other value is refused.
function isNamespaceFlagMask(args: unknown): boolean {
  if (!Array.isArray(args) || args.length !== 1) {
    return false;
  }
  const only: unknown = (args as readonly unknown[])[0];
  return (
    isRecord(only) &&
    only.index === 0 &&
    only.op === MASKED_EQ &&
    only.value === CLONE_NAMESPACE_MASK &&
    (only.valueTwo === undefined || only.valueTwo === 0)
  );
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
