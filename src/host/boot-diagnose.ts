// Boot-binding diagnosis (T8580, BOOTF-01..BOOTF-08; blueprint §23; API-RealmBoot 1.0.0). Pure values only:
// no environment, no filesystem, no timers, no process spawning. Every probe result is supplied by the
// caller from the existing seams (ensureDaemon, driverAnswers, the digest-pinned image check, bindRoot),
// so this module orders and names what those seams already observe; it never re-probes on its own.
//
// Binding order (blueprint §23.1): config -> daemon -> driver -> image -> active-proof. The first failing
// binding decides the single catalogue code; later bindings are reported as not probed and no generic boot
// error is emitted. Active means up returned 1 container id AND 1 status readback validated against the
// selection (session id, bound root); the Omp guard lifts in the same turn that readback confirms active.
// Shutdown closes the client, removes the presence marker, and never sends the control method that stops
// the sandbox: the sandbox outlives every host.
//
// Every remedy below is a fixed constant except the image remedy, which interpolates only the configured
// image ref and the short digest prefix. Diagnostic text carries path classes and digest prefixes only:
// 0 file content, 0 tokens, 0 secrets (NFR-S3). This module never reads a token, a file body, or an
// environment value, so nothing secret can enter an envelope by construction.

import type { ErrorCode } from "../core/errors.js";

// The four boot bindings, in probe order.
export type BootBinding = "config" | "daemon" | "driver" | "image";

// One binding's verdict in the operator checklist (SCR-BootBindingDiag `ds/CheckList`): text, never color-only.
export type BindingVerdict = "pass" | "fail" | "not probed";

// The override for a per-call probe shape such as `imageOk`. `undefined` means the binding was not supplied
// by the caller and is treated as a failure of that binding (fail-closed), never as a pass.
export type ProbeOutcome = boolean;

// Note: DAEMON_START_TIMEOUT is the daemon binding's code (blueprint §23.1, BOOTF-01) but is absent from
// the 1.0.0 `DiagnoseResponse.code` enum; the enum gap is a contract change request to A03 (see impl.notes).
export type BootFailureCode = "REALM_NOT_ACTIVE" | "POLICY_DENIED" | "AGENTOS_NOT_CONFIGURED" | "OPENSHELL_START_FAILED" | "OPENSHELL_GATEWAY_LOST" | "DAEMON_START_TIMEOUT";

// The driver failure codes. A driver failure is never reported as POLICY_DENIED (AC-116).
export type DriverFailureCode = "OPENSHELL_START_FAILED" | "OPENSHELL_GATEWAY_LOST";

// The failed step names a driver-side failure can carry (API-RealmBoot `DiagnoseResponse.failedStep`).
export type FailedStep = "create" | "exec-child start" | "stop" | "start";

// One binding's row for the persisted BootBindingRecord / checklist (models.md §18): status plus the code
// that failed it, plus the driver step or the image digest prefix when the binding carries one.
export interface BindingRow {
  readonly binding: BootBinding;
  readonly verdict: BindingVerdict;
  readonly code: ErrorCode | null;
  readonly failedStep?: FailedStep;
  readonly digestPrefix?: string;
}

// What the caller observed for each binding, from the existing seams. Booleans only: the seam that observed
// a fact owns the fact; this module owns the order and the name.
export interface BindingProbes {
  // Config binding (BOOTF-04): a generated config selects a matching daemon and driver, and the workspace
  // root exists. `configSelected` false means no generated config selects matching daemon and driver.
  readonly configSelected: ProbeOutcome;
  readonly workspaceRootOk: ProbeOutcome;
  // Daemon binding (BOOTF-01): the control socket answered within the startup bound after one spawn.
  readonly daemonOk: ProbeOutcome;
  // Driver binding (BOOTF-02): the compute-driver socket answers and the gateway answers behind it.
  // `driverLostAfterActive` true means the gateway was lost after the realm was active (OPENSHELL_GATEWAY_LOST);
  // false or absent means a failed start (OPENSHELL_START_FAILED). A POLICY_DENIED from the driver seam is
  // never surfaced: a driver refusal is a gateway start failure (AC-116).
  readonly driverOk: ProbeOutcome;
  readonly driverLostAfterActive?: boolean;
  readonly driverFailedStep?: FailedStep;
  // Image binding (BOOTF-03): the pulled sandbox image digest equals the configured digest exactly.
  readonly imageOk: ProbeOutcome;
  readonly imageRef?: string;
  readonly expectedDigest?: string;
}

// The bound envelope on failure (API-RealmBoot `DiagnoseResponse`, 1.0.0): 1 code, 1 binding, 1 remedy.
export interface BootDiagnoseResponse {
  readonly active: false;
  readonly code: BootFailureCode;
  readonly binding: BootBinding;
  readonly remedy: string;
  readonly failedStep?: FailedStep;
  readonly correlationId: string;
}

// The bound envelope on confirmed active. The 1.0.0 contract's `code` enum carries no success code, so the
// active envelope omits `code` by construction rather than naming a failure code it did not hit; see
// impl.notes (contract change request to A03).
export interface BootActiveResponse {
  readonly active: true;
  readonly containerId: string;
  readonly guardLifted: true;
  readonly correlationId: string;
}

// The diagnosis result: a failure envelope, or the active envelope once the proof confirms.
export type BootDiagnosis = BootDiagnoseResponse | BootActiveResponse;

// The active proof (BOOTF-05): the up reply and the status readback, each reduced to what it confirms.
export interface ActiveProofInput {
  // The 1 container id `up` returned (null when up returned none).
  readonly containerId: string | null;
  // The 1 status readback, validated against the selection by the caller (boot-driver): the session id and
  // the bound root the reply named. null when no readback was taken.
  readonly readback: { readonly containerId: string; readonly sessionId: string; readonly boundRoot: string } | null;
  readonly expectedSessionId: string;
  readonly expectedBoundRoot: string;
}

// The shutdown plan (BOOTF-08, AC-119): close the client, remove the 1 presence marker, never send the
// control method that stops the sandbox.
export interface ShutdownPlan {
  readonly closeClient: true;
  readonly removeMarker: true;
  readonly sendDown: false;
}

const CONFIG_REMEDY =
  "Run realm init to generate config selecting a matching daemon and driver, then retry up.";
const WORKSPACE_ROOT_REMEDY =
  "Point workspaceRoot at an existing directory owned by the account, or remove the stale config.";
const DAEMON_REMEDY = "Ensure the daemon starts, then retry up.";
const DRIVER_START_REMEDY = "Fix the compute driver, then retry up.";
const DRIVER_LOST_REMEDY = "Restart the gateway and compute driver, then retry up.";
const IMAGE_REMEDY =
  "Point the config at the pinned image digest, then retry up.";
const UNCONFIRMED_REMEDY = "Confirm the active proof with one container id and one validating readback, then retry up.";

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DIGEST_PREFIX_HEX_CHARS = 12;

// The short pinned prefix of a digest-pinned reference (`sha256:` plus its first 12 hex chars and an
// ellipsis): the only digest material a diagnostic may name (NFR-S3). Returns null when the input is not a
// well-formed digest, so a malformed digest names nothing rather than leaking a raw value.
export function digestPrefix(digest: string): string | null {
  if (!DIGEST_PATTERN.test(digest)) {
    return null;
  }
  return `sha256:${digest.slice(7, 7 + DIGEST_PREFIX_HEX_CHARS)}…`;
}

// Redacts any full digest embedded in an image ref (QF-001): a digest-pinned ref such as
// `sandbox@sha256:<64 hex>` would otherwise carry the full digest into a remedy verbatim.
// Every `sha256:<64 hex>` occurrence becomes its 12-hex prefix, so a remedy can name the ref
// without ever containing a full digest. Refs without a full digest pass through unchanged.
function sanitizeRef(ref: string): string {
  return ref.replace(/sha256:[a-f0-9]{64}/g, (match) => digestPrefix(match) ?? "sha256:…");
}

// Whether a text carries a token or secret value assignment. Remedies in this module are constants, so this
// is a self-gate for anything interpolated: the image remedy carries a ref and a digest prefix only, and a
// digest prefix is not a secret assignment.
export function secretFree(text: string): boolean {
  return !/(token|secret|bearer|password|api[_-]?key)\s*[=:]/i.test(text);
}

// The one-time diagnostic of a capability-token refusal (BOOTF-06, AC-120): names the capabilityTokens mode
// and the key id, never a token value.
export function capabilityRefusal(mode: "enforce" | "off", keyId: string): string {
  return `capabilityTokens mode ${mode}; key id ${keyId}; no token value shown.`;
}

function failedRow(binding: BootBinding, code: ErrorCode, extra?: Partial<BindingRow>): BindingRow {
  return extra === undefined ? { binding, verdict: "fail", code } : { binding, verdict: "fail", code, ...extra };
}

function notProbedRow(binding: BootBinding): BindingRow {
  return { binding, verdict: "not probed", code: null };
}

// The 4 binding rows in probe order (config, daemon, driver, image), models.md §18. The first failing
// binding carries its code; every later binding reads not probed, never pass.
export function bindingRows(probes: BindingProbes): BindingRow[] {
  if (!probes.configSelected) {
    return [
      failedRow("config", "AGENTOS_NOT_CONFIGURED"),
      notProbedRow("daemon"),
      notProbedRow("driver"),
      notProbedRow("image"),
    ];
  }
  if (!probes.workspaceRootOk) {
    return [
      failedRow("config", "POLICY_DENIED"),
      notProbedRow("daemon"),
      notProbedRow("driver"),
      notProbedRow("image"),
    ];
  }
  if (!probes.daemonOk) {
    return [
      { binding: "config", verdict: "pass", code: null },
      failedRow("daemon", "DAEMON_START_TIMEOUT"),
      notProbedRow("driver"),
      notProbedRow("image"),
    ];
  }
  if (!probes.driverOk) {
    const code: DriverFailureCode = probes.driverLostAfterActive === true ? "OPENSHELL_GATEWAY_LOST" : "OPENSHELL_START_FAILED";
    return [
      { binding: "config", verdict: "pass", code: null },
      { binding: "daemon", verdict: "pass", code: null },
      failedRow("driver", code, probes.driverFailedStep === undefined ? undefined : { failedStep: probes.driverFailedStep }),
      notProbedRow("image"),
    ];
  }
  if (!probes.imageOk) {
    const prefix = probes.expectedDigest === undefined ? null : digestPrefix(probes.expectedDigest);
    return [
      { binding: "config", verdict: "pass", code: null },
      { binding: "daemon", verdict: "pass", code: null },
      { binding: "driver", verdict: "pass", code: null },
      failedRow("image", "POLICY_DENIED", prefix === null ? undefined : { digestPrefix: prefix }),
    ];
  }
  return [
    { binding: "config", verdict: "pass", code: null },
    { binding: "daemon", verdict: "pass", code: null },
    { binding: "driver", verdict: "pass", code: null },
    { binding: "image", verdict: "pass", code: null },
  ];
}

// Diagnoses the first failing binding in probe order, or confirms active when every binding passes and the
// active proof confirms. The remedy is a fixed constant per failure, except the image remedy, which names
// the configured ref and the expected digest prefix only. A driver failure is never POLICY_DENIED: a lost
// gateway after active is OPENSHELL_GATEWAY_LOST, a failed start is OPENSHELL_START_FAILED.
export function diagnoseBoot(probes: BindingProbes, correlationId: string, proof?: ActiveProofInput): BootDiagnosis {
  if (!probes.configSelected) {
    return { active: false, code: "AGENTOS_NOT_CONFIGURED", binding: "config", remedy: CONFIG_REMEDY, correlationId };
  }
  if (!probes.workspaceRootOk) {
    return { active: false, code: "POLICY_DENIED", binding: "config", remedy: WORKSPACE_ROOT_REMEDY, correlationId };
  }
  if (!probes.daemonOk) {
    return { active: false, code: "DAEMON_START_TIMEOUT", binding: "daemon", remedy: DAEMON_REMEDY, correlationId };
  }
  if (!probes.driverOk) {
    const lost = probes.driverLostAfterActive === true;
    const base: BootDiagnoseResponse = lost
      ? { active: false, code: "OPENSHELL_GATEWAY_LOST", binding: "driver", remedy: DRIVER_LOST_REMEDY, correlationId }
      : { active: false, code: "OPENSHELL_START_FAILED", binding: "driver", remedy: DRIVER_START_REMEDY, correlationId };
    return probes.driverFailedStep === undefined ? base : { ...base, failedStep: probes.driverFailedStep };
  }
  if (!probes.imageOk) {
    const prefix = probes.expectedDigest === undefined ? null : digestPrefix(probes.expectedDigest);
    const ref = sanitizeRef(probes.imageRef ?? "the configured image");
    const remedy = prefix === null ? IMAGE_REMEDY : `Point the config at the pinned image digest ${prefix} for ${ref}, then retry up.`;
    return { active: false, code: "POLICY_DENIED", binding: "image", remedy, correlationId };
  }
  if (proof !== undefined && confirmActiveProof(proof)) {
    return { active: true, containerId: proof.containerId as string, guardLifted: true, correlationId };
  }
  return { active: false, code: "REALM_NOT_ACTIVE", binding: "daemon", remedy: UNCONFIRMED_REMEDY, correlationId };
}

// Whether the active proof confirms: up returned 1 non-empty container id and the 1 readback named that
// container under the expected session id and bound root. Up alone never confirms; a readback naming
// another session or root is not adopted.
export function confirmActiveProof(proof: ActiveProofInput): boolean {
  if (proof.containerId === null || proof.containerId === "") {
    return false;
  }
  if (proof.readback === null) {
    return false;
  }
  return (
    proof.readback.containerId === proof.containerId &&
    proof.readback.sessionId === proof.expectedSessionId &&
    proof.readback.boundRoot === proof.expectedBoundRoot
  );
}

// Whether the Omp guard lifts: only when the readback confirmed active, in the same turn as the
// confirmation. Up alone never lifts the guard.
export function guardLifted(proof: ActiveProofInput): boolean {
  return confirmActiveProof(proof);
}

// The shutdown plan (BOOTF-08): the client closes, the 1 presence marker is removed, and the sandbox is
// never sent the control method that stops it, so it stays up for the next attach.
export function planShutdown(): ShutdownPlan {
  return { closeClient: true, removeMarker: true, sendDown: false };
}
