// Control channel wire format and run-directory guards (P6-D2, P6-D3, P6-D10, P6-D11).
// Requests and replies cross the Unix socket at controlSocketPath(stateDir) as
// newline-delimited JSON carrying request ids; every reply carries the request id plus
// either a result or an existing catalogue ErrorCode. Control requests are bounded per method
// by CONTROL_TIMEOUT_MS; other socket operations by SOCKET_TIMEOUT_MS through withTimeout. The run directory is created-or-checked at
// mode 0700 and the socket is chmod 0600 after listen; any other mode, a non-directory,
// or a foreign owner refuses with SCHEMA_INVALID. This module owns the wire format plus
// the filesystem guards only; it starts no long-running process and parses no argv.
// Request lines are capped at MAX_CONTROL_LINE_BYTES; a longer line is refused unread with a null-id SCHEMA_INVALID reply.

import type { Socket } from "node:net";
import { chmodSync, mkdirSync, statSync, type Stats } from "node:fs";
import { ERROR_CODES, makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { dialWithin, withTimeout } from "../core/timeout.js";
import { controlSocketPath, isSessionId } from "../session/paths.js";

export const CONTROL_METHODS = ["status", "up", "down", "doctor", "tool", "metrics"] as const;
export type ControlMethod = (typeof CONTROL_METHODS)[number];

const KNOWN_METHODS: readonly string[] = CONTROL_METHODS;
const KNOWN_CODES: readonly string[] = ERROR_CODES;

// Default bound for every socket operation in milliseconds (OQ-P6-01).
export const SOCKET_TIMEOUT_MS = 5000;

// Bound for one control request, per method. down must outlast the controller teardown bound
// (TEARDOWN_TIMEOUT_MS in lifecycle/controller.ts, 30 s), or the CLI gives up while the daemon is
// still tearing down. up must outlast the policy startup budget plus a margin for the reply, or the
// caller reports TOOL_TIMEOUT while the daemon is still inside its own budget. doctor runs the registered items plus the
// runtime checks; probes run together, each bounded at 5 s, so it gets 60 s. tool runs one dispatcher call under its
// own bound, so it gets that bound plus 10 s for the reply.
// STARTUP_BUDGET_DEFAULT_MS mirrors both the default and the maximum of startupBudgetMs in
// policy.schema.json, so policy load refuses a budget the up request cannot wait for. The up bound is
// that maximum plus UP_REPLY_MARGIN_MS. It is mirrored, not imported: this module keeps its
// five-import allowlist (P6-D10), and no control caller reads the daemon-owned policy. The channel
// test asserts the schema maximum equals this constant and that the maximum plus the margin is no
// more than the up bound.
const STARTUP_BUDGET_DEFAULT_MS = 200_000;
// Slack on top of the startup budget for the daemon's reply and the socket round trip.
const UP_REPLY_MARGIN_MS = 30_000;
// The dispatcher's per-call bound (TOOL_CALL_TIMEOUT_MS in src/tools/dispatch.ts). It is mirrored,
// not imported: this module keeps its five-import allowlist (P6-D10), and importing the dispatcher
// would load the tool and lifecycle graph into every channel consumer. The channel test asserts
// that the tool bound exceeds the dispatcher constant, so drift fails the suite.
const TOOL_CALL_BOUND_MS = 30_000;
export const CONTROL_TIMEOUT_MS: Readonly<Record<ControlMethod, number>> = Object.freeze({
  status: 5_000,
  up: STARTUP_BUDGET_DEFAULT_MS + UP_REPLY_MARGIN_MS,
  down: 45_000,
  doctor: 60_000,
  tool: TOOL_CALL_BOUND_MS + 10_000,
  metrics: 5_000,
});

// The socket is chmod to this mode after listen (P6-D3).
export const SOCKET_MODE = 0o600;

// The run directory is created-or-checked at this mode (P6-D3).
const RUN_DIR_MODE = 0o700;
// Mode of directories created as missing ancestors of the state directory: the default, which the umask narrows.
const DEFAULT_DIR_MODE = 0o777;

const PERMISSION_BITS = 0o777;

// The largest control line the channel buffers (1 MiB). A longer line is refused without being read whole.
export const MAX_CONTROL_LINE_BYTES = 1_048_576;

export type ControlId = string | number;

export interface ControlRequest {
  readonly id: ControlId;
  readonly method: string;
  readonly params?: unknown;
}

export interface ControlError {
  readonly code: ErrorCode;
  // Present only when the refusal carries a cause code, such as a libpod code under OPENSHELL_START_FAILED.
  readonly causeCode?: ErrorCode;
}

export interface ControlReply {
  // Null only on the oversized-line refusal, where no id from the line is trusted.
  readonly id: ControlId | null;
  readonly result?: unknown;
  readonly error?: ControlError;
}

export interface SendOptions {
  readonly timeoutMs?: number;
}

// The selection a project-addressed control request carries (contract C4): the canonical workspace root
// and the session id that root maps to. This module checks shape only. Whether sessionId is the id of the
// daemon's pinned root is the daemon's check, so the validator neither canonicalizes the path nor derives the id.
export interface ControlSelection {
  readonly workspaceRoot: string;
  readonly sessionId: string;
}

// The longest workspace root a control selection may carry.
const MAX_WORKSPACE_ROOT_LENGTH = 4096;

function isWorkspaceRoot(value: unknown): value is string {
  return (
    typeof value === "string" && value.length >= 1 && value.length <= MAX_WORKSPACE_ROOT_LENGTH && value.startsWith("/")
  );
}

// True when the record carries exactly the listed own keys, no more and no fewer.
function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function selectionOfRecord(value: unknown): ControlSelection | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["workspaceRoot", "sessionId"])) {
    return undefined;
  }
  const workspaceRoot: unknown = value["workspaceRoot"];
  const sessionId: unknown = value["sessionId"];
  if (!isWorkspaceRoot(workspaceRoot) || typeof sessionId !== "string" || !isSessionId(sessionId)) {
    return undefined;
  }
  return { workspaceRoot, sessionId };
}

// The one validator for control selections. The daemon calls it on every request, and the client builds only
// values it accepts. up carries only workspaceRoot and yields no selection; doctor may carry no params at all.
// Every refusal is SCHEMA_INVALID.
export function parseControlSelection(
  method: ControlMethod,
  params: unknown,
): { readonly selection: ControlSelection | null } {
  if (method === "up") {
    if (!isRecord(params) || !hasExactKeys(params, ["workspaceRoot"]) || !isWorkspaceRoot(params["workspaceRoot"])) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return { selection: null };
  }
  if (method === "doctor" && params === undefined) {
    return { selection: null };
  }
  if (!isRecord(params)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const selection = selectionOfRecord(params["selection"]);
  if (selection === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  // tool carries its ToolCall under `tool` beside the selection; every other method carries the selection alone.
  if (method !== "tool" && !hasExactKeys(params, ["selection"])) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return { selection };
}

// The params every selected request sends. Only the two fields are copied, so nothing else crosses the wire.
export function selectionParams(selection: ControlSelection): { readonly selection: ControlSelection } {
  return { selection: { workspaceRoot: selection.workspaceRoot, sessionId: selection.sessionId } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isControlId(value: unknown): value is ControlId {
  if (typeof value === "string") {
    return value.length > 0;
  }
  return typeof value === "number" && Number.isFinite(value);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && KNOWN_CODES.includes(value);
}

export function isControlMethod(method: string): method is ControlMethod {
  return KNOWN_METHODS.includes(method);
}

// The reply for a request whose method is not in CONTROL_METHODS. The failure
// surfaces a catalogue code only; no raw message crosses the boundary.
export function unknownMethodReply(id: ControlId): ControlReply {
  return { id, error: { code: "SCHEMA_INVALID" } };
}

// A malformed line never throws across the boundary. Returns null when the line is
// well-formed (nothing to answer for) or when no id can be recovered; otherwise
// returns a catalogue-code reply carrying the recovered id.
export function replyForMalformedLine(line: string): ControlReply | null {
  try {
    decodeRequest(line);
    return null;
  } catch {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return null;
    }
    if (isRecord(parsed) && isControlId(parsed["id"])) {
      return { id: parsed["id"], error: { code: "SCHEMA_INVALID" } };
    }
    return null;
  }
}

export function encodeRequest(request: ControlRequest): string {
  if (!isControlId(request.id)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (typeof request.method !== "string" || request.method.length === 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (request.params === undefined) {
    return `${JSON.stringify({ id: request.id, method: request.method })}\n`;
  }
  return `${JSON.stringify({ id: request.id, method: request.method, params: request.params })}\n`;
}

export function decodeRequest(line: string): ControlRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (!isRecord(parsed)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const id: unknown = parsed["id"];
  const method: unknown = parsed["method"];
  if (!isControlId(id) || typeof method !== "string" || method.length === 0) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if ("params" in parsed) {
    return { id, method, params: parsed["params"] };
  }
  return { id, method };
}

export function encodeReply(reply: ControlReply): string {
  if (!isReplyId(reply.id)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (reply.error !== undefined) {
    const { code, causeCode } = reply.error;
    if (reply.result !== undefined || !isErrorCode(code) || (causeCode !== undefined && !isErrorCode(causeCode))) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return `${JSON.stringify({ id: reply.id, error: causeCode === undefined ? { code } : { code, causeCode } })}\n`;
  }
  if (reply.result === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return `${JSON.stringify({ id: reply.id, result: reply.result })}\n`;
}

export function decodeReply(line: string): ControlReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (!isRecord(parsed)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const id: unknown = parsed["id"];
  if (!isReplyId(id)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const hasResult = "result" in parsed;
  const hasError = "error" in parsed;
  if (hasResult === hasError) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (hasError) {
    const error: unknown = parsed["error"];
    if (
      !isRecord(error) ||
      !isErrorCode(error["code"]) ||
      !Object.keys(error).every((key) => key === "code" || key === "causeCode")
    ) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const causeCode: unknown = error["causeCode"];
    if (causeCode === undefined) {
      return { id, error: { code: error["code"] } };
    }
    if (!isErrorCode(causeCode)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return { id, error: { code: error["code"], causeCode } };
  }
  return { id, result: parsed["result"] };
}

// The control socket path names no daemon: nothing listens there (the socket file is missing, ENOENT) or nothing
// accepts the connection (ECONNREFUSED). It is still REALM_NOT_ACTIVE, so every caller that handles that code is
// unchanged; a caller that must tell "no daemon" from "a daemon that did not answer" tests instanceof. A dial timeout,
// a peer that closes before replying and an error reply are never this class.
export class DaemonAbsentError extends RealmError {
  constructor() {
    super("REALM_NOT_ACTIVE");
    this.name = "DaemonAbsentError";
  }
}

// The errno codes of a dial that reached no listener.
const NO_DAEMON_ERRNO: readonly string[] = ["ENOENT", "ECONNREFUSED"];

function isNoDaemonError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    NO_DAEMON_ERRNO.includes(error.code)
  );
}

// Any socket IO failure that is neither a timeout nor a decode refusal surfaces
// REALM_NOT_ACTIVE: the peer is absent or went away. RealmError instances
// (timeouts, decode refusals) pass through untouched, so every failure that
// leaves this module carries a catalogue code only.
function ioFailure(error: unknown): RealmError {
  if (error instanceof RealmError) {
    return error;
  }
  return makeRealmError("REALM_NOT_ACTIVE");
}

async function dial(socketPath: string, timeoutMs: number): Promise<Socket> {
  try {
    return await dialWithin(socketPath, timeoutMs, "TOOL_TIMEOUT");
  } catch (error: unknown) {
    if (isNoDaemonError(error)) {
      throw new DaemonAbsentError();
    }
    throw ioFailure(error);
  }
}

async function writeBounded(socket: Socket, line: string, timeoutMs: number): Promise<void> {
  const written = new Promise<void>((resolve, reject) => {
    socket.write(line, (cause: unknown) => {
      if (cause === undefined || cause === null) {
        resolve();
      } else {
        reject(ioFailure(cause));
      }
    });
  });
  try {
    await withTimeout(written, timeoutMs, "TOOL_TIMEOUT");
  } catch (error: unknown) {
    throw ioFailure(error);
  }
}

async function readBounded(socket: Socket, timeoutMs: number): Promise<string> {
  const line = new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    // A reply is capped like a request line. The bytes before its newline are counted chunk by chunk, so an
    // oversized reply is refused and its socket closed without the whole line ever being held.
    const onData = (chunk: unknown): void => {
      const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const end = bytes.indexOf(0x0a);
      const take = end === -1 ? bytes.length : end;
      size += take;
      if (size > MAX_CONTROL_LINE_BYTES) {
        cleanup();
        socket.destroy();
        reject(makeRealmError("SCHEMA_INVALID"));
        return;
      }
      chunks.push(bytes.subarray(0, take));
      if (end !== -1) {
        cleanup();
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    };
    const onError = (cause: unknown): void => {
      cleanup();
      reject(ioFailure(cause));
    };
    const onClose = (): void => {
      cleanup();
      reject(makeRealmError("REALM_NOT_ACTIVE"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
  try {
    return await withTimeout(line, timeoutMs, "TOOL_TIMEOUT");
  } catch (error: unknown) {
    throw ioFailure(error);
  }
}

function isReplyId(value: unknown): value is ControlId | null {
  return value === null || isControlId(value);
}

// The reply for a request line longer than MAX_CONTROL_LINE_BYTES. The line was never read whole,
// so no id from it is trusted: the reply carries a null id, and the server closes the socket after it.
export function oversizedLineReply(): ControlReply {
  return { id: null, error: { code: "SCHEMA_INVALID" } };
}

export type ControlLineRead =
  | { readonly ok: true; readonly line: string }
  | { readonly ok: false; readonly reason: "oversized" };

// Reads one newline-terminated request line, buffering at most MAX_CONTROL_LINE_BYTES. Once the
// line passes the cap, buffering stops, the rest of the line is discarded, and the result reports
// it oversized. Timeouts and socket failures surface as catalogue codes, as readBounded does.
export async function readControlLine(socket: Socket, timeoutMs: number): Promise<ControlLineRead> {
  const line = new Promise<ControlLineRead>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = (): void => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk: unknown): void => {
      const bytes: Buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      const end = bytes.indexOf(0x0a);
      const take = end === -1 ? bytes.length : end;
      size += take;
      if (size > MAX_CONTROL_LINE_BYTES) {
        cleanup();
        resolve({ ok: false, reason: "oversized" });
        return;
      }
      chunks.push(bytes.subarray(0, take));
      if (end !== -1) {
        cleanup();
        resolve({ ok: true, line: Buffer.concat(chunks).toString("utf8") });
      }
    };
    const onError = (cause: unknown): void => {
      cleanup();
      reject(ioFailure(cause));
    };
    const onClose = (): void => {
      cleanup();
      reject(makeRealmError("REALM_NOT_ACTIVE"));
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
  try {
    return await withTimeout(line, timeoutMs, "TOOL_TIMEOUT");
  } catch (error: unknown) {
    throw ioFailure(error);
  }
}

// Sends one request over the socket at socketPath and resolves with the reply.
// Connect, write, and read are each bounded by timeoutMs (default
// SOCKET_TIMEOUT_MS); a peer that never answers rejects with TOOL_TIMEOUT.
export async function sendRequest(
  socketPath: string,
  request: ControlRequest,
  options?: SendOptions,
): Promise<ControlReply> {
  const timeoutMs = options?.timeoutMs ?? SOCKET_TIMEOUT_MS;
  const line = encodeRequest(request);
  const socket = await dial(socketPath, timeoutMs);
  try {
    await writeBounded(socket, line, timeoutMs);
    const raw = await readBounded(socket, timeoutMs);
    const reply = decodeReply(raw);
    if (reply.id !== request.id) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return reply;
  } catch (error: unknown) {
    throw ioFailure(error);
  } finally {
    socket.destroy();
  }
}

// Minimal stat shape ensureSocketDir reads; node:fs Stats satisfies it.
export type SocketStat = Pick<Stats, "mode" | "uid" | "isDirectory">;

// Filesystem and owner seams for ensureSocketDir. Omitted seams use node:fs and process.getuid.
export interface SocketDirDeps {
  readonly stat?: (path: string) => SocketStat;
  readonly mkdir?: (path: string, options: { readonly recursive: boolean; readonly mode: number }) => void;
  readonly getuid?: () => number;
}

// Stats one directory: undefined when the path is absent. Any other stat failure refuses with SCHEMA_INVALID.
function observeDir(stat: (path: string) => SocketStat, path: string): SocketStat | undefined {
  try {
    return stat(path);
  } catch (error: unknown) {
    const missing =
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
    if (!missing) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return undefined;
  }
}

// Creates the state directory and the run directory at mode 0700 when the state directory is absent, so a
// fresh start never leaves the state directory at the default mode. When the state directory exists, an
// absent run directory is created at 0700. An existing directory is checked, never chmodded: a run directory
// that is not exactly 0700 owned by the current user refuses with SCHEMA_INVALID. Returns the run directory
// path. The stat/mkdir/getuid seams keep tests hermetic.
export function ensureSocketDir(stateDir: string, deps?: SocketDirDeps): string {
  const socketPath = controlSocketPath(stateDir);
  const slash = socketPath.lastIndexOf("/");
  if (slash === -1) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const runDir = socketPath.slice(0, slash);
  const parent = runDir.lastIndexOf("/");
  if (parent === -1) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const stateDirPath = runDir.slice(0, parent);
  const stat = deps?.stat ?? ((path: string): SocketStat => statSync(path));
  const mkdir =
    deps?.mkdir ??
    ((path: string, options: { readonly recursive: boolean; readonly mode: number }): void => {
      mkdirSync(path, options);
    });
  if (observeDir(stat, stateDirPath) === undefined) {
    // Missing ancestors above the state directory take the default mode, which the umask narrows. Only the state
    // directory and its run directory are created at RUN_DIR_MODE, one level at a time.
    const parentDir = stateDirPath.slice(0, stateDirPath.lastIndexOf("/"));
    try {
      if (parentDir !== "") {
        mkdir(parentDir, { recursive: true, mode: DEFAULT_DIR_MODE });
      }
      mkdir(stateDirPath, { recursive: false, mode: RUN_DIR_MODE });
      mkdir(runDir, { recursive: false, mode: RUN_DIR_MODE });
    } catch {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return runDir;
  }
  const observed = observeDir(stat, runDir);
  if (observed === undefined) {
    try {
      mkdir(runDir, { recursive: true, mode: RUN_DIR_MODE });
    } catch {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return runDir;
  }
  if (!observed.isDirectory()) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if ((observed.mode & PERMISSION_BITS) !== RUN_DIR_MODE) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const systemGetuid: (() => number) | undefined = process.getuid;
  const uid = (deps?.getuid ?? systemGetuid)?.();
  if (uid === undefined || observed.uid !== uid) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return runDir;
}

export interface ChmodDeps {
  readonly chmod?: (path: string, mode: number) => void;
}

// Applies SOCKET_MODE to the bound socket path after listen (P6-D3). Any failure
// refuses with SCHEMA_INVALID so the socket never serves unguarded.
export function chmodSocket(socketPath: string, deps?: ChmodDeps): void {
  const chmod = deps?.chmod ?? ((path: string, mode: number): void => {
    chmodSync(path, mode);
  });
  try {
    chmod(socketPath, SOCKET_MODE);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}
