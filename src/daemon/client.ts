// Daemon control client. A typed face over the control channel: each method sends one request
// through sendRequest (channel.ts), bounded by that method's CONTROL_TIMEOUT_MS entry, and checks
// the reply shape before returning it. The client owns no socket: every request dials, exchanges
// one NDJSON line, and closes. close() ends the client, so later requests refuse with
// REALM_NOT_ACTIVE; requests already in flight finish within their own bounds. Every failure
// leaves this module as a RealmError carrying a catalogue code. The module reads no environment
// and spawns no process.
//
// A client is built for one selection: a canonical workspace root and the session id it maps to. The selection is
// fixed at construction and never inferred from the socket or from a previous up, and every selected request carries
// it. close() marks this client closed and affects no other client and no session; a client holds no session state,
// so a new client for the same selection starts from nothing. The one thing a host client holds is the capability token
// it was given at attach (CAPT-06): a variable of the connectDaemon closure, in no property, log or error.

import { realpathSync } from "node:fs";
import { ERROR_CODES, makeRealmError, RealmError } from "../core/errors.js";
import { STATES } from "../core/states.js";
import { STATUS_LABELS } from "../core/status.js";
import type { StateSnapshot } from "../core/state-machine.js";
import type { DisplayStatus } from "../core/status.js";
import {
  CONTROL_TIMEOUT_MS,
  parseControlSelection,
  selectionParams,
  sendRequest,
  type ControlMethod,
  type ControlReply,
  type ControlRequest,
  type ControlSelection,
} from "./channel.js";
import { isMetricsSnapshot, type MetricsSnapshot } from "../observe/metrics.js";
import type { StatusValue, ToolOutcome } from "../tools/dispatch.js";
import type { PolicyMode } from "../contract/validate.js";
import type { HostId } from "../host/types.js";
import { isSessionId, sessionIdOfWorkspace } from "../session/paths.js";

// The status value plus the policy mode the daemon reports (src/contract/validate.ts PolicyMode).
// notice is present only when the daemon's startup reap destroyed a previous sandbox; it is user-facing text.
export interface DaemonStatus extends StatusValue {
  readonly mode: PolicyMode;
  readonly notice?: string;
  // boundRoot is the realpath of the root the daemon is pinned to, on status and up replies. Absent from a daemon that predates
  // the field: the host then cannot know the root, so it keeps no client whose up was refused.
  readonly boundRoot?: string;
  // The session id of the pinned root (contract C4). Every status and up reply carries it.
  readonly sessionId: string;
}

export interface DaemonClient {
  // Reads the daemon's lifecycle snapshot, its display status, and its policy mode.
  status(): Promise<DaemonStatus>;
  // Asks the daemon to create the sandbox for this client's workspace root (idempotent).
  up(): Promise<DaemonStatus>;
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
    (value["boundRoot"] === undefined || typeof value["boundRoot"] === "string") &&
    (typeof value["sessionId"] === "string" && isSessionId(value["sessionId"])) &&
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

// The one derivation of a selection in src/: the realpath of the workspace root and the session id that root maps to.
// A path that does not resolve is POLICY_DENIED, as bindRoot refuses it.
export function selectionOf(workspaceRoot: string): ControlSelection {
  let real: string;
  try {
    real = realpathSync(workspaceRoot);
  } catch {
    throw makeRealmError("POLICY_DENIED");
  }
  return { workspaceRoot: real, sessionId: sessionIdOfWorkspace(real) };
}

// What a host client adds to the plain one (CAPT-06, D-32-08). Without a host the client never attaches and never sends a
// token member, so its behaviour is the behaviour of a client from before capability tokens.
export interface ConnectDaemonOptions {
  // The host id this client attaches as. realm mcp and realm acp pass their --host id and the Omp extension passes omp.
  // realm status, realm checkpoint and the doctor pass none.
  readonly host?: HostId;
  // Milliseconds. Test seam for the renewal and the mode off cache; defaults to Date.now.
  readonly now?: () => number;
}

// A token is renewed this long before its expiry, and a mode off answer is remembered for this long.
const RENEW_MARGIN_MS = 120_000;
const MODE_OFF_MEMORY_MS = 60_000;
const MAX_TOKEN_CHARS = 512;

type AttachReply =
  | { readonly mode: "off" }
  | { readonly mode: "enforce"; readonly token: string; readonly expiresAt: number };

// The two shapes of the capability-attach reply. Anything else is SCHEMA_INVALID. The token is read here and never put in an
// error, a log or a property: the caller keeps it in a closure.
function attachReplyOf(value: unknown): AttachReply {
  if (isRecord(value) && value["mode"] === "off") {
    return { mode: "off" };
  }
  if (isRecord(value) && value["mode"] === "enforce") {
    const token = value["token"];
    const expiresAt = value["expiresAt"];
    if (typeof token === "string" && token.length <= MAX_TOKEN_CHARS && typeof expiresAt === "number" && Number.isSafeInteger(expiresAt)) {
      return { mode: "enforce", token, expiresAt };
    }
  }
  throw makeRealmError("SCHEMA_INVALID");
}

// One client for one selection. The selection is validated here, before any socket is opened: up's shape first,
// then status's shape. Its params are copied, so the fixed selection cannot be changed after construction.
export function connectDaemon(
  socketPath: string,
  selection: ControlSelection,
  options: ConnectDaemonOptions = {},
): DaemonClient {
  parseControlSelection("up", { workspaceRoot: selection.workspaceRoot });
  parseControlSelection("status", { selection });
  const selected = selectionParams(selection);
  const { host } = options;
  const now = options.now ?? ((): number => Date.now());
  let nextId = 0;
  let closed = false;
  // The capability token, held only here: a variable of this closure, never a property of the client, never logged, never put
  // in an error. expiresAtMs is the token's expiry; offUntilMs is when a mode off (or older daemon) answer is asked again.
  const held: { token: string | undefined; expiresAtMs: number; offUntilMs: number; pending: Promise<string | undefined> | undefined } = {
    token: undefined,
    expiresAtMs: 0,
    offUntilMs: 0,
    pending: undefined,
  };

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

  // The token for the next tool request, or undefined when none is to be sent: no host, a daemon whose mode is off (asked
  // again after MODE_OFF_MEMORY_MS), or an older daemon that does not know the method (its SCHEMA_INVALID is read as off,
  // which is right because such a daemon enforces nothing). The first call, and any call within RENEW_MARGIN_MS of the
  // expiry, attaches. Concurrent callers share one attach. A failed attach is thrown as its RealmError.
  const attach = async (attachAs: HostId): Promise<string | undefined> => {
    const at = now();
    held.token = undefined;
    let answer: unknown;
    try {
      answer = await request("capability-attach", { ...selected, host: attachAs });
    } catch (error: unknown) {
      if (error instanceof RealmError && error.code === "SCHEMA_INVALID") {
        held.offUntilMs = at + MODE_OFF_MEMORY_MS;
        return undefined;
      }
      throw error;
    }
    // A reply that is neither shape is SCHEMA_INVALID and is thrown: only the daemon's own refusal means an older daemon.
    const reply = attachReplyOf(answer);
    if (reply.mode === "off") {
      held.offUntilMs = at + MODE_OFF_MEMORY_MS;
      return undefined;
    }
    held.token = reply.token;
    held.expiresAtMs = reply.expiresAt * 1000;
    return reply.token;
  };
  const tokenForCall = (): Promise<string | undefined> => {
    if (host === undefined) {
      return Promise.resolve(undefined);
    }
    const at = now();
    if (held.token !== undefined && at < held.expiresAtMs - RENEW_MARGIN_MS) {
      return Promise.resolve(held.token);
    }
    if (held.token === undefined && at < held.offUntilMs) {
      return Promise.resolve(undefined);
    }
    held.pending ??= attach(host).finally(() => {
      held.pending = undefined;
    });
    return held.pending;
  };

  return {
    async status(): Promise<DaemonStatus> {
      const result = await request("status", selected);
      if (!isDaemonStatus(result)) {
        throw makeRealmError("SCHEMA_INVALID");
      }
      return result;
    },
    async up(): Promise<DaemonStatus> {
      const result = await request("up", { workspaceRoot: selected.selection.workspaceRoot });
      if (!isDaemonStatus(result) || result.sessionId !== selected.selection.sessionId) {
        throw makeRealmError("SCHEMA_INVALID");
      }
      return result;
    },
    async call(tool: unknown): Promise<ToolOutcome> {
      const token = await tokenForCall();
      const result = await request("tool", { tool, ...selected, ...(token === undefined ? {} : { token }) });
      if (!isToolOutcome(result)) {
        throw makeRealmError("SCHEMA_INVALID");
      }
      return result;
    },
    async metrics(): Promise<MetricsSnapshot> {
      const result = await request("metrics", selected);
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
