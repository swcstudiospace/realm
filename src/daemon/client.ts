// Daemon control client. A typed face over the control channel: each method sends one request
// through sendRequest (channel.ts), bounded by that method's CONTROL_TIMEOUT_MS entry, and checks
// the reply shape before returning it. The client owns no socket: every request dials, exchanges
// one NDJSON line, and closes. close() ends the client, so later requests refuse with
// REALM_NOT_ACTIVE; requests already in flight finish within their own bounds. Every failure
// leaves this module as a RealmError carrying a catalogue code. The module reads no environment
// and spawns no process.

import { ERROR_CODES, makeRealmError, RealmError } from "../core/errors.js";
import { STATES } from "../core/states.js";
import { STATUS_LABELS } from "../core/status.js";
import type { StateSnapshot } from "../core/state-machine.js";
import type { DisplayStatus } from "../core/status.js";
import { CONTROL_TIMEOUT_MS, sendRequest, type ControlMethod, type ControlReply, type ControlRequest } from "./channel.js";
import { isMetricsSnapshot, type MetricsSnapshot } from "../observe/metrics.js";
import type { StatusValue, ToolOutcome } from "../tools/dispatch.js";
import type { PolicyMode } from "../contract/validate.js";

// The status value plus the policy mode the daemon reports (src/contract/validate.ts PolicyMode).
// notice is present only when the daemon's startup reap destroyed a previous sandbox; it is user-facing text.
export interface DaemonStatus extends StatusValue {
  readonly mode: PolicyMode;
  readonly notice?: string;
}

export interface DaemonClient {
  // Reads the daemon's lifecycle snapshot, its display status, and its policy mode.
  status(): Promise<DaemonStatus>;
  // Asks the daemon to create the sandbox for workspaceRoot (idempotent).
  up(workspaceRoot: string): Promise<DaemonStatus>;
  // Dispatches one raw ToolCall. A refusal is a resolved ToolOutcome, not a throw. Same signature
  // as Pick<ToolDispatcher, "call">, so the MCP server and ACP adapter accept the client unchanged.
  call(tool: unknown): Promise<ToolOutcome>;
  // Reads the in-memory counters. Absent daemon is REALM_NOT_ACTIVE; there is no local report.
  metrics(): Promise<MetricsSnapshot>;
  // Ends the client. Idempotent. Later requests refuse with REALM_NOT_ACTIVE.
  close(): void;
}

const KNOWN_STATES: readonly string[] = STATES;
const KNOWN_LABELS: readonly string[] = Object.values(STATUS_LABELS);
const KNOWN_CODES: readonly string[] = ERROR_CODES;

// The policy mode union (src/contract/validate.ts). The Record gives one entry per PolicyMode member,
// so adding a mode fails to compile here until this list is updated.
const POLICY_MODE_FLAGS: Readonly<Record<PolicyMode, true>> = { advisory: true, "fail-closed": true };
const KNOWN_MODES: readonly string[] = Object.keys(POLICY_MODE_FLAGS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStateSnapshot(value: unknown): value is StateSnapshot {
  return (
    isRecord(value) &&
    typeof value["state"] === "string" &&
    KNOWN_STATES.includes(value["state"]) &&
    typeof value["reason"] === "string" &&
    typeof value["lastTransitionAt"] === "string"
  );
}

function isDisplayStatus(value: unknown): value is DisplayStatus {
  return (
    isRecord(value) &&
    typeof value["label"] === "string" &&
    KNOWN_LABELS.includes(value["label"]) &&
    typeof value["degraded"] === "boolean" &&
    typeof value["reason"] === "string" &&
    typeof value["lastTransitionAt"] === "string"
  );
}

function isStatusValue(value: unknown): value is StatusValue {
  return isRecord(value) && isStateSnapshot(value["snapshot"]) && isDisplayStatus(value["display"]);
}

function isPolicyMode(value: unknown): value is PolicyMode {
  return typeof value === "string" && KNOWN_MODES.includes(value);
}

function isDaemonStatus(value: unknown): value is DaemonStatus {
  return (
    isRecord(value) &&
    isPolicyMode(value["mode"]) &&
    (value["notice"] === undefined || typeof value["notice"] === "string") &&
    isStatusValue(value)
  );
}

function isToolOutcome(value: unknown): value is ToolOutcome {
  if (!isRecord(value)) {
    return false;
  }
  if (value["outcome"] === "refused") {
    const tool = value["tool"];
    const code = value["code"];
    const causeCode = value["causeCode"];
    return (
      (tool === null || typeof tool === "string") &&
      typeof code === "string" &&
      KNOWN_CODES.includes(code) &&
      typeof value["retryable"] === "boolean" &&
      (causeCode === undefined || (typeof causeCode === "string" && KNOWN_CODES.includes(causeCode)))
    );
  }
  if (value["outcome"] === "done") {
    return typeof value["tool"] === "string" && "value" in value;
  }
  return false;
}

export function connectDaemon(socketPath: string): DaemonClient {
  let nextId = 0;
  let closed = false;

  // One request over the channel. The reply's error becomes a RealmError with the daemon's code and causeCode.
  // Its message is the catalogue reason for that code, the same text the daemon's own RealmError carries.
  // Channel failures already arrive as RealmError; any other throw can only come from encoding the
  // request body (a value JSON cannot serialize), so it maps to SCHEMA_INVALID.
  const request = async (method: ControlMethod, params?: unknown): Promise<unknown> => {
    if (closed) {
      throw makeRealmError("REALM_NOT_ACTIVE");
    }
    nextId += 1;
    const message: ControlRequest =
      params === undefined ? { id: nextId, method } : { id: nextId, method, params };
    let reply: ControlReply;
    try {
      reply = await sendRequest(socketPath, message, { timeoutMs: CONTROL_TIMEOUT_MS[method] });
    } catch (error: unknown) {
      if (error instanceof RealmError) {
        throw error;
      }
      throw makeRealmError("SCHEMA_INVALID");
    }
    if (reply.error !== undefined) {
      throw makeRealmError(reply.error.code, reply.error.causeCode);
    }
    return reply.result;
  };

  return {
    async status(): Promise<DaemonStatus> {
      const result = await request("status");
      if (!isDaemonStatus(result)) {
        throw makeRealmError("SCHEMA_INVALID");
      }
      return result;
    },
    async up(workspaceRoot: string): Promise<DaemonStatus> {
      const result = await request("up", { workspaceRoot });
      if (!isDaemonStatus(result)) {
        throw makeRealmError("SCHEMA_INVALID");
      }
      return result;
    },
    async call(tool: unknown): Promise<ToolOutcome> {
      const result = await request("tool", { tool });
      if (!isToolOutcome(result)) {
        throw makeRealmError("SCHEMA_INVALID");
      }
      return result;
    },
    async metrics(): Promise<MetricsSnapshot> {
      const result = await request("metrics");
      if (!isMetricsSnapshot(result)) {
        throw makeRealmError("SCHEMA_INVALID");
      }
      return result;
    },
    close(): void {
      closed = true;
    },
  };
}
