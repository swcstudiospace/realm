// Podman version parser (RT-02, D-49). Pure helpers: no I/O here. The prerequisite probe
// that runs `podman --version` and connects to the rootless API socket is
// src/runtime/podman-probe.ts (D-53). The Podman-gated integration suite imports the
// parser and the skip-reason mapping from this file, so there is one parser in the repo.

// OpenShell requires Podman 5.x; anything below this major is gated off.
export const OPENSHELL_MIN_PODMAN_MAJOR = 5;

export type PodmanVersionParse =
  | { readonly ok: true; readonly version: string; readonly major: number }
  | { readonly ok: false; readonly reason: string };

// Matches "podman version 4.9.3", "podman version 5.0.0", "podman version 5.3.1-rc1".
// Requires at least major.minor; a bare major such as "podman version 5" is malformed.
const VERSION_PATTERN = /podman version ((\d+)\.\d+(?:\.\d+)?)/;

export function parsePodmanVersion(output: string): PodmanVersionParse {
  if (output.trim().length === 0) {
    return { ok: false, reason: "podman --version produced no output" };
  }
  const match = VERSION_PATTERN.exec(output);
  const version = match?.[1];
  const majorText = match?.[2];
  if (version === undefined || majorText === undefined) {
    return { ok: false, reason: "podman --version output holds no recognisable version" };
  }
  return { ok: true, version, major: Number(majorText) };
}

// The outcome of running `podman --version`. "unavailable" covers every failure to run it:
// a missing binary (ENOENT), a non-zero exit, or a timeout.
export type PodmanProbe =
  | { readonly kind: "unavailable" }
  | { readonly kind: "output"; readonly stdout: string };

// Returns the skip reason for the Podman-gated suite, or false when the suite may run.
// Fails closed: output that cannot be parsed is treated as unsupported.
export function podmanSkipReason(probe: PodmanProbe): string | false {
  if (probe.kind === "unavailable") {
    return "podman binary not found or not runnable; PODMAN_MISSING";
  }
  const parsed = parsePodmanVersion(probe.stdout);
  if (!parsed.ok) {
    return `Podman version could not be determined (${parsed.reason}); OpenShell requires Podman 5.x; PODMAN_UNSUPPORTED_VERSION`;
  }
  if (parsed.major < OPENSHELL_MIN_PODMAN_MAJOR) {
    return `Podman ${parsed.version} detected; OpenShell requires Podman 5.x; PODMAN_UNSUPPORTED_VERSION`;
  }
  return false;
}
