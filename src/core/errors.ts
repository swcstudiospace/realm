// Typed error catalogue (D-10, spec n6). Exactly these 31 codes; no others.
// The 20 spec n6 codes plus PODMAN_UNSUPPORTED_VERSION (plan 01-06, explicit override), AUDIT_WRITE_FAILED,
// and three codes from the 2026-10-22 closure: AGENTOS_NOT_CONFIGURED, AGENTOS_STOP_FAILED, OPENSHELL_LABEL_AMBIGUOUS.
// MCP_INPUT_FAILED and CLEANUP_FAILED are catalogued after the closure codes, then DAEMON_START_TIMEOUT and SANDBOX_NAME_IN_USE,
// then AUDIT_OUTCOME_UNKNOWN (phase 14, D-1403), then OPENSHELL_GATEWAY_LOST (phase 17, D5).
// Only this file defines retryable values or reasons. Every code surfaces to
// MCP and ACP hosts, so renaming one is a costly change.

export const ERROR_CODES = Object.freeze([
  "REALM_UNBOUND",
  "REALM_NOT_ACTIVE",
  "REALM_STOPPING",
  "REALM_INVALID_TRANSITION",
  "STARTUP_BUDGET_EXCEEDED",
  "DAEMON_START_TIMEOUT",
  "TOOL_TIMEOUT",
  "PODMAN_MISSING",
  "PODMAN_MACHINE_DOWN",
  "PODMAN_UNSUPPORTED_VERSION",
  "OPENSHELL_START_FAILED",
  "OPENSHELL_LABEL_AMBIGUOUS",
  "AGENTOS_CRASH_LOOP",
  "AGENTOS_NOT_CONFIGURED",
  "AGENTOS_STOP_FAILED",
  "ANDA_UNREACHABLE",
  "ANDA_VERSION_MISMATCH",
  "POLICY_DENIED",
  "PATH_ESCAPE",
  "CREDENTIAL_PATH_DENIED",
  "LOCK_CONFLICT",
  "SANDBOX_NAME_IN_USE",
  "WRITE_NOT_ATOMIC",
  "EGRESS_DENIED",
  "SHELL_NOT_ALLOWED",
  "SCHEMA_INVALID",
  "AUDIT_WRITE_FAILED",
  "MCP_INPUT_FAILED",
  "CLEANUP_FAILED",
  "AUDIT_OUTCOME_UNKNOWN",
  "OPENSHELL_GATEWAY_LOST",
] as const);

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface CatalogueEntry {
  readonly reason: string;
  readonly retryable: boolean;
}

// Object.freeze is shallow. Freezing the record alone would leave each entry
// editable in place, so every entry is frozen as well.
function freezeCatalogue(
  table: Record<ErrorCode, CatalogueEntry>,
): Readonly<Record<ErrorCode, CatalogueEntry>> {
  for (const entry of Object.values(table)) {
    Object.freeze(entry);
  }
  return Object.freeze(table);
}

// The single code-to-retryable lookup. Typed as a full Record over ErrorCode,
// so a missing or extra key fails compilation.
export const ERROR_CATALOGUE: Readonly<Record<ErrorCode, CatalogueEntry>> =
  freezeCatalogue({
    REALM_UNBOUND: {
      reason: "No workspace is bound to this realm session; bind a workspace root first.",
      retryable: false,
    },
    REALM_NOT_ACTIVE: {
      reason: "The realm is not active; the request can run once the session reaches active.",
      retryable: true,
    },
    REALM_STOPPING: {
      reason: "The realm is stopping and refuses new requests.",
      retryable: false,
    },
    REALM_INVALID_TRANSITION: {
      reason: "The requested state transition is not allowed by the state table.",
      retryable: false,
    },
    STARTUP_BUDGET_EXCEEDED: {
      reason: "Realm startup did not finish within the configured startup budget.",
      retryable: true,
    },
    DAEMON_START_TIMEOUT: {
      reason: "The daemon did not answer on its control socket within the daemon start timeout after it was spawned.",
      retryable: true,
    },
    TOOL_TIMEOUT: {
      reason: "A tool call did not finish within its queue timeout.",
      retryable: true,
    },
    PODMAN_MISSING: {
      reason: "The podman binary was not found on this host.",
      retryable: false,
    },
    PODMAN_MACHINE_DOWN: {
      reason: "The podman machine is not running, so containers cannot start.",
      retryable: true,
    },
    PODMAN_UNSUPPORTED_VERSION: {
      reason: "Podman version is below the 5.x that OpenShell requires.",
      retryable: false,
    },
    OPENSHELL_START_FAILED: {
      reason: "OpenShell failed to start inside the session container.",
      retryable: true,
    },
    OPENSHELL_LABEL_AMBIGUOUS: {
      reason:
        "More than one container matches this session label, so the sandbox cannot be identified. No container was chosen.",
      retryable: false,
    },
    AGENTOS_CRASH_LOOP: {
      reason: "AgentOS is restarting repeatedly and has been held.",
      retryable: true,
    },
    AGENTOS_NOT_CONFIGURED: {
      reason:
        "AgentOS is not configured, so no sandbox session can start. Bind an AgentOS driver before starting a realm.",
      retryable: false,
    },
    AGENTOS_STOP_FAILED: {
      reason:
        "AgentOS did not stop cleanly: its sandbox delete may still be pending, so no success was reported. Its sandbox container is stopped regardless, and the stop can be retried.",
      retryable: true,
    },
    ANDA_UNREACHABLE: {
      reason: "The Anda engine could not be reached.",
      retryable: true,
    },
    ANDA_VERSION_MISMATCH: {
      reason: "The Anda engine version is not one that Realm supports.",
      retryable: false,
    },
    POLICY_DENIED: {
      reason: "The active policy denies this operation.",
      retryable: false,
    },
    PATH_ESCAPE: {
      reason: "The path resolves outside the workspace root.",
      retryable: false,
    },
    CREDENTIAL_PATH_DENIED: {
      reason: "The path is credential-shaped and is not on the credential allowlist.",
      retryable: false,
    },
    LOCK_CONFLICT: {
      reason: "Another writer holds the advisory lock on this file.",
      retryable: true,
    },
    SANDBOX_NAME_IN_USE: {
      reason: "A container with this sandbox name already exists.",
      retryable: false,
    },
    WRITE_NOT_ATOMIC: {
      reason: "The write could not complete atomically and was not applied.",
      retryable: true,
    },
    EGRESS_DENIED: {
      reason: "The outbound destination is not in the egress allowlist.",
      retryable: false,
    },
    SHELL_NOT_ALLOWED: {
      reason: "Shell execution is disabled by policy; use the argv form.",
      retryable: false,
    },
    SCHEMA_INVALID: {
      reason: "The input does not match its published schema.",
      retryable: false,
    },
    AUDIT_WRITE_FAILED: {
      reason: "audit log could not be written; the tool call did not run",
      retryable: true,
    },
    MCP_INPUT_FAILED: {
      reason: "the MCP input stream failed",
      retryable: false,
    },
    CLEANUP_FAILED: {
      reason: "A temporary file or descriptor could not be released after a failed operation; the original failure is the error thrown.",
      retryable: false,
    },
    AUDIT_OUTCOME_UNKNOWN: {
      reason: "The process ended before this call's result was recorded; whether the call took effect is unknown.",
      retryable: false,
    },
    OPENSHELL_GATEWAY_LOST: {
      reason:
        "The OpenShell gateway, or the compute driver behind it, did not answer, so the sandbox cannot be reached; restore the gateway, then retry.",
      retryable: true,
    },
  });

// A typed error. Its reason and retryable values come only from the catalogue,
// so every instance carries a catalogue code and, when one is given, a catalogue
// cause code. Nothing else enters an error.
export class RealmError extends Error {
  readonly code: ErrorCode;
  readonly reason: string;
  readonly retryable: boolean;
  // Present only when a cause was given. `declare` emits no class field, so an
  // absent cause leaves no own property behind (ES2023 class fields would define it as undefined).
  declare readonly causeCode?: ErrorCode;

  constructor(code: ErrorCode, causeCode?: ErrorCode) {
    const entry = ERROR_CATALOGUE[code];
    super(entry.reason);
    this.name = "RealmError";
    this.code = code;
    this.reason = entry.reason;
    this.retryable = entry.retryable;
    if (causeCode !== undefined) {
      this.causeCode = causeCode;
    }
  }
}

// The optional cause is a catalogue code, so no raw runtime text can enter an error.
// It never changes the reason, which always comes from the primary code.
export function makeRealmError(code: ErrorCode, causeCode?: ErrorCode): RealmError {
  return new RealmError(code, causeCode);
}
