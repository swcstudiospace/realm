// Shared fixtures for the create-time hardening proof beyond the seccomp keyring: the OCI config fields the verifier compares
// (rlimits, sysctls, masked and read-only paths) and the /proc status of the init process. Every value comes from the hardening
// profile, as the create body does, so a fixture conforms exactly when the body and the verifier agree. The seccomp section is the
// one of seccomp-fixtures.ts.
import { HARDENING_PROFILE } from "../../src/runtime/hardening.js";
import { ALLOW_RULE, ISOLATION_DENY_RULES, KEYRING_DENY_RULE, ociSpec } from "./seccomp-fixtures.js";

// An OCI config whose seccomp section is built from the given rules and whose other fields are the ones the profile asks for. Podman
// also lists masked and read-only paths beyond the required ones, so the fixture carries one extra of each.
export function runtimeOciSpec(syscalls: readonly unknown[] = [ALLOW_RULE, KEYRING_DENY_RULE, ...ISOLATION_DENY_RULES]): Record<string, unknown> {
  const base = ociSpec(syscalls);
  const linux = base.linux as Record<string, unknown>;
  return {
    ...base,
    process: { rlimits: HARDENING_PROFILE.rlimits.map(({ type, limit }) => ({ type, hard: limit, soft: limit })) },
    linux: {
      ...linux,
      sysctl: { ...HARDENING_PROFILE.sysctls },
      maskedPaths: [...HARDENING_PROFILE.maskedPaths, "/proc/timer_list"],
      readonlyPaths: [...HARDENING_PROFILE.readonlyPaths, "/proc/asound"],
    },
  };
}

// The config text of a container whose OCI config the caller changes after it is built, to break exactly one field.
export function runtimeOciTextWith(change: (spec: Record<string, unknown>) => void): string {
  const spec = runtimeOciSpec();
  change(spec);
  return JSON.stringify(spec);
}

// The config text of a conforming container, and of one whose seccomp section lets keyctl through.
export const RUNTIME_OCI_CONFIG_TEXT = JSON.stringify(runtimeOciSpec());
export const RUNTIME_KEYCTL_ALLOWED_OCI_CONFIG_TEXT = JSON.stringify(
  runtimeOciSpec([KEYRING_DENY_RULE, ...ISOLATION_DENY_RULES, { names: ["keyctl"], action: "SCMP_ACT_ALLOW" }]),
);

// The text of a /proc/<pid>/status file of a conforming init process: every capability set empty, a seccomp filter in force
// (mode 2, with the separate filter count line a real kernel prints) and no_new_privs set. Each override replaces its line's value.
export function procStatusOf(overrides: Readonly<Record<string, string>> = {}): string {
  const values: Record<string, string> = {
    CapInh: "0000000000000000",
    CapPrm: "0000000000000000",
    CapEff: "0000000000000000",
    CapBnd: "0000000000000000",
    CapAmb: "0000000000000000",
    NoNewPrivs: "1",
    Seccomp: "2",
    Seccomp_filters: "1",
    ...overrides,
  };
  return Object.entries(values)
    .map(([name, value]) => `${name}:\t${value}`)
    .join("\n");
}

export const CONFORMING_PROC_STATUS = procStatusOf();
