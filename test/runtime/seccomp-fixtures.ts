// Shared fixtures for the seccomp keyring proof. The layout is the one Podman 5.7.1 reports for a container created through the libpod
// API: StaticDir is the container's userdata directory, and OCIConfigPath is the config.json inside it. The paths are placeholders.
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
        defaultErrnoRet: 38,
        architectures: ["SCMP_ARCH_X86_64", "SCMP_ARCH_X86", "SCMP_ARCH_X32"],
        syscalls,
      },
    },
  };
}

export const ALLOW_RULE = { names: ["landlock_create_ruleset", "landlock_add_rule", "landlock_restrict_self", "seccomp"], action: "SCMP_ACT_ALLOW" };
export const KEYRING_DENY_RULE = { names: ["add_key", "keyctl", "request_key"], action: "SCMP_ACT_ERRNO", errnoRet: 1 };

// An OCI config whose seccomp section conforms.
export function conformingOciSpec(): Record<string, unknown> {
  return ociSpec([ALLOW_RULE, KEYRING_DENY_RULE]);
}

// An OCI config where keyctl is allowed by a rule of its own, besides the denying rule.
export function keyctlAllowedOciSpec(): Record<string, unknown> {
  return ociSpec([KEYRING_DENY_RULE, { names: ["keyctl"], action: "SCMP_ACT_ALLOW" }]);
}

export const CONFORMING_OCI_CONFIG_TEXT = JSON.stringify(conformingOciSpec());
export const KEYCTL_ALLOWED_OCI_CONFIG_TEXT = JSON.stringify(keyctlAllowedOciSpec());

// A reader that serves one config text for the one conforming path, and refuses any other path.
export function ociReaderOf(text: string): (path: string) => string {
  return (path) => {
    if (path !== OCI_CONFIG_PATH) {
      throw new Error("unexpected path");
    }
    return text;
  };
}
