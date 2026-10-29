// Shared fixtures for the seccomp keyring proof. The layout is the one Podman 5.7.1 reports for a container created through the libpod
// API: StaticDir is the container's userdata directory, and OCIConfigPath is the config.json inside it. The paths are placeholders.
import { SECCOMP_PROFILE } from "../../src/runtime/driver/seccomp-profile.js";

export const STATIC_DIR = "/realm/containers/c1/userdata";
export const OCI_CONFIG_PATH = `${STATIC_DIR}/config.json`;

// The structure of the OCI seccomp section of an API-created container: default action ERRNO (defaultErrnoRet 38), one rule denying
// the three keyring syscalls with EPERM, and allow rules for others.
export function ociSpec(syscalls: readonly unknown[]): Record<string, unknown> {
  return {
    ociVersion: "1.2.0",
    linux: {
      seccomp: {
        defaultAction: "SCMP_ACT_ERRNO",
        defaultErrnoRet: SECCOMP_PROFILE.defaultErrnoRet,
        architectures: ["SCMP_ARCH_X86_64", "SCMP_ARCH_X86", "SCMP_ARCH_X32"],
        syscalls,
      },
    },
  };
}

export const ALLOW_RULE = { names: ["landlock_create_ruleset", "landlock_add_rule", "landlock_restrict_self", "seccomp"], action: "SCMP_ACT_ALLOW" };
export const KEYRING_DENY_RULE = { names: ["add_key", "keyctl", "request_key"], action: "SCMP_ACT_ERRNO", errnoRet: 1 };
export const NAMESPACE_DENY_RULE = { names: ["setns", "unshare"], action: "SCMP_ACT_ERRNO", errnoRet: 1 };
export const MOUNT_DENY_RULE = {
  names: ["fsconfig", "fsmount", "fsopen", "fspick", "mount", "mount_setattr", "move_mount", "open_tree", "pivot_root", "umount", "umount2"],
  action: "SCMP_ACT_ERRNO",
  errnoRet: 1,
};
export const CLONE3_DENY_RULE = { names: ["clone3"], action: "SCMP_ACT_ERRNO", errnoRet: 38 };

// The clone rule exactly as the real profile carries it (the masked equality that leaves every namespace flag clear), derived from
// the profile's exported rules so the fixture cannot drift from it.
function cloneRuleOfProfile(): { names: string[]; action: string; args: { index: number; value: number; valueTwo: number; op: string }[] } {
  const rule = SECCOMP_PROFILE.syscalls.find((candidate) => candidate.names.includes("clone"));
  if (rule === undefined) {
    throw new Error("the seccomp profile has no clone rule");
  }
  return { names: [...rule.names], action: rule.action, args: (rule.args ?? []).map((arg) => ({ ...arg })) };
}
export const CLONE_MASKED_RULE = cloneRuleOfProfile();

// The rules that make a seccomp section conform besides the allow rule: namespace entry, mount family, clone3 and the masked clone.
export const ISOLATION_DENY_RULES = [NAMESPACE_DENY_RULE, MOUNT_DENY_RULE, CLONE3_DENY_RULE, CLONE_MASKED_RULE];

// An OCI config whose seccomp section conforms.
export function conformingOciSpec(): Record<string, unknown> {
  return ociSpec([ALLOW_RULE, KEYRING_DENY_RULE, ...ISOLATION_DENY_RULES]);
}

// An OCI config where keyctl is allowed by a rule of its own, besides the denying rule.
export function keyctlAllowedOciSpec(): Record<string, unknown> {
  return ociSpec([KEYRING_DENY_RULE, ...ISOLATION_DENY_RULES, { names: ["keyctl"], action: "SCMP_ACT_ALLOW" }]);
}

// An OCI config where unshare is allowed by a rule of its own, besides the rules that deny the rest.
export function unshareAllowedOciSpec(): Record<string, unknown> {
  return ociSpec([KEYRING_DENY_RULE, ...ISOLATION_DENY_RULES, { names: ["unshare"], action: "SCMP_ACT_ALLOW" }]);
}

export const CONFORMING_OCI_CONFIG_TEXT = JSON.stringify(conformingOciSpec());
export const KEYCTL_ALLOWED_OCI_CONFIG_TEXT = JSON.stringify(keyctlAllowedOciSpec());
export const UNSHARE_ALLOWED_OCI_CONFIG_TEXT = JSON.stringify(unshareAllowedOciSpec());

// A reader that serves one config text for the one conforming path, and refuses any other path.
export function ociReaderOf(text: string): (path: string) => string {
  return (path) => {
    if (path !== OCI_CONFIG_PATH) {
      throw new Error("unexpected path");
    }
    return text;
  };
}
