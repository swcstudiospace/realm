// The one table from the realm error catalogue to gRPC status codes (phase 9.4, D-018). Every catalogue code appears,
// and the Record type fails compilation when one is missing. The driver never invents a code: a failure that carries
// no catalogue code is reported as INTERNAL with a fixed text, so no raw runtime message reaches the gateway.

import { Metadata, status, type ServerErrorResponse } from "@grpc/grpc-js";
import { RealmError, type ErrorCode } from "../../core/errors.js";

export const DRIVER_STATUS: Readonly<Record<ErrorCode, status>> = Object.freeze({
  REALM_UNBOUND: status.FAILED_PRECONDITION,
  REALM_NOT_ACTIVE: status.UNAVAILABLE,
  REALM_STOPPING: status.UNAVAILABLE,
  REALM_INVALID_TRANSITION: status.FAILED_PRECONDITION,
  STARTUP_BUDGET_EXCEEDED: status.DEADLINE_EXCEEDED,
  DAEMON_START_TIMEOUT: status.DEADLINE_EXCEEDED,
  TOOL_TIMEOUT: status.DEADLINE_EXCEEDED,
  PODMAN_MISSING: status.FAILED_PRECONDITION,
  PODMAN_MACHINE_DOWN: status.UNAVAILABLE,
  PODMAN_UNSUPPORTED_VERSION: status.FAILED_PRECONDITION,
  OPENSHELL_START_FAILED: status.INTERNAL,
  OPENSHELL_LABEL_AMBIGUOUS: status.FAILED_PRECONDITION,
  AGENTOS_CRASH_LOOP: status.UNAVAILABLE,
  AGENTOS_NOT_CONFIGURED: status.FAILED_PRECONDITION,
  AGENTOS_STOP_FAILED: status.INTERNAL,
  ANDA_UNREACHABLE: status.UNAVAILABLE,
  ANDA_VERSION_MISMATCH: status.FAILED_PRECONDITION,
  POLICY_DENIED: status.PERMISSION_DENIED,
  PATH_ESCAPE: status.INVALID_ARGUMENT,
  CREDENTIAL_PATH_DENIED: status.PERMISSION_DENIED,
  LOCK_CONFLICT: status.ABORTED,
  SANDBOX_NAME_IN_USE: status.ALREADY_EXISTS,
  WRITE_NOT_ATOMIC: status.ABORTED,
  EGRESS_DENIED: status.PERMISSION_DENIED,
  SHELL_NOT_ALLOWED: status.PERMISSION_DENIED,
  SCHEMA_INVALID: status.INVALID_ARGUMENT,
  AUDIT_WRITE_FAILED: status.INTERNAL,
  MCP_INPUT_FAILED: status.INTERNAL,
  CLEANUP_FAILED: status.INTERNAL,
  AUDIT_OUTCOME_UNKNOWN: status.INTERNAL,
  OPENSHELL_GATEWAY_LOST: status.UNAVAILABLE,
});

// A failure as the driver reports it on the wire: a gRPC code and the human-readable details.
export interface DriverFailure {
  readonly code: status;
  readonly details: string;
}

// A failure the driver decides itself, with no catalogue code: a sandbox or workspace that does not exist, or a method
// this driver does not implement. These are gRPC statuses only; they add no error code to the catalogue (D-018).
export function driverNotFound(details: string): DriverFailure {
  return { code: status.NOT_FOUND, details };
}

export function driverUnimplemented(details: string): DriverFailure {
  return { code: status.UNIMPLEMENTED, details };
}

// Carries a driver-decided failure through a throw, so a handler can refuse with a status that has no catalogue code.
export class DriverStatusError extends Error {
  readonly failure: DriverFailure;

  constructor(failure: DriverFailure) {
    super(failure.details);
    this.name = "DriverStatusError";
    this.failure = failure;
  }
}

// The text for a failure that has no catalogue code. It names nothing from the runtime.
const INTERNAL_DETAILS = "internal driver error";

// Maps any thrown value to a failure. A RealmError keeps its catalogue reason, which is fixed text. A driver-decided
// status keeps its own text. Anything else is INTERNAL with a fixed text, so a raw message is never copied out.
export function driverFailureOf(error: unknown): DriverFailure {
  if (error instanceof DriverStatusError) {
    return error.failure;
  }
  if (error instanceof RealmError) {
    return { code: DRIVER_STATUS[error.code], details: error.reason };
  }
  return { code: status.INTERNAL, details: INTERNAL_DETAILS };
}

// The error object a gRPC unary callback or a server stream takes. Its code and details are the wire status.
export function toServerError(failure: DriverFailure): ServerErrorResponse {
  return Object.assign(new Error(failure.details), {
    code: failure.code,
    details: failure.details,
    metadata: new Metadata(),
  });
}
