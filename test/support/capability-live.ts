// Helpers of the live enforce proof (EVID-03, plan 35-03): the audit check, the leak check, the audit-tamper copies, the keyring
// facts the cleanup needs, the stub MCP server and the claude print-mode shape of the feasibility test. Every piece is pure or
// touches only the files it is given, so test/integration/capability-live-helpers.test.ts covers them against the real audit files
// of the Phase 32 rig. Nothing here starts a process or reads a secret into a message: a problem names a line, a member, a host id, a
// key id or a tool name, never a value.

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOST_IDS } from "../../src/host/types.js";
import { keyringPathOf } from "../../src/capability/keyring.js";
import { isRecord } from "./omp-live.js";

// ---- The audit check -------------------------------------------------------------------------------------------------------

export type AuditLine = Readonly<Record<string, unknown>>;

export interface AuditExpectation {
  readonly sessionId: string;
  // The host id and the active key id of an attached session. Both or neither: with neither, no line may carry a host or a kid and
  // no attach line may exist (the unlabelled session).
  readonly host?: string;
  readonly kid?: string;
  // The number of calls the drive made: at least that many admission lines and result lines must exist.
  readonly calls: number;
  // The least number of refusal lines (outcome POLICY_DENIED, no phase) the file must hold; default 0.
  readonly refusals?: number;
  // True when a refusal line may carry the expected host and kid (a refused call that held a token); default false.
  readonly refusalsCarryPrincipal?: boolean;
}

const ATTACH_TOOL = "capability.attach";
const REFUSAL_OUTCOME = "POLICY_DENIED";
const SAFE_TOOL_NAME = /^[A-Za-z0-9_.]{1,40}$/;

// The lines of an audit file's text. A line that is not a JSON object is an error that names its number.
export function parseAuditLines(text: string): readonly AuditLine[] {
  const lines: AuditLine[] = [];
  const rows = text.split("\n");
  if (rows.at(-1) === "") {
    rows.pop();
  }
  rows.forEach((row, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row);
    } catch (error) {
      throw new Error(`audit line ${String(index + 1)} is not JSON`, { cause: error });
    }
    if (!isRecord(parsed)) {
      throw new Error(`audit line ${String(index + 1)} is not a JSON object`);
    }
    lines.push(parsed);
  });
  return lines;
}

function toolOf(line: AuditLine): string {
  const { tool } = line;
  return typeof tool === "string" && SAFE_TOOL_NAME.test(tool) ? tool : "unknown";
}

function isCallLine(line: AuditLine): boolean {
  return line["phase"] !== undefined;
}

function isAttachLine(line: AuditLine): boolean {
  return line["tool"] === ATTACH_TOOL && line["phase"] === undefined;
}

function isRefusalLine(line: AuditLine): boolean {
  return line["outcome"] === REFUSAL_OUTCOME && line["phase"] === undefined && line["tool"] !== ATTACH_TOOL;
}

// What is wrong with the parsed lines of one session's audit file, as short sentences; empty when everything holds. A sentence names
// a line number (1-based), a member, a tool name, and the expected host id and key id; it never repeats a value found in the file.
export function checkCapabilityAudit(lines: readonly AuditLine[], expected: AuditExpectation): readonly string[] {
  if ((expected.host === undefined) !== (expected.kid === undefined)) {
    throw new Error("an audit expectation names both the host and the kid, or neither");
  }
  const problems: string[] = [];
  const { host, kid } = expected;
  const attached = host !== undefined && kid !== undefined;
  const callIndexes: number[] = [];
  const validAttachIndexes: number[] = [];
  let admissions = 0;
  let results = 0;
  let refusals = 0;

  lines.forEach((line, index) => {
    const at = `line ${String(index + 1)} (tool ${toolOf(line)})`;
    if (line["sessionId"] !== expected.sessionId) {
      problems.push(`${at}: the sessionId member differs from the expected session`);
    }
    if (isAttachLine(line)) {
      if (!attached) {
        problems.push(`${at}: an attach line in a session expected to be unlabelled`);
      } else if (line["outcome"] !== "ok" || line["host"] !== host || line["kid"] !== kid) {
        problems.push(`${at}: the attach line must have outcome ok, host ${host} and kid ${kid}`);
      } else {
        validAttachIndexes.push(index);
      }
      return;
    }
    if (isCallLine(line)) {
      callIndexes.push(index);
      if (line["phase"] === "admission") {
        admissions += 1;
      } else if (line["phase"] === "result") {
        results += 1;
      }
      if (!attached) {
        problems.push(`${at}: a call line in a session expected to hold none`);
      } else {
        if (line["host"] === undefined) {
          problems.push(`${at}: the host member is missing`);
        } else if (line["host"] !== host) {
          problems.push(`${at}: the host member differs from the expected host ${host}`);
        }
        if (line["kid"] === undefined) {
          problems.push(`${at}: the kid member is missing`);
        } else if (line["kid"] !== kid) {
          problems.push(`${at}: the kid member differs from the expected kid ${kid}`);
        }
      }
      return;
    }
    if (isRefusalLine(line)) {
      refusals += 1;
    }
    // Every other line, a refusal included: a host or a kid is allowed only as the expectation lists it.
    const carriesPrincipal = line["host"] !== undefined || line["kid"] !== undefined;
    if (carriesPrincipal) {
      const allowed = attached && expected.refusalsCarryPrincipal === true && isRefusalLine(line) && line["host"] === host && line["kid"] === kid;
      if (!allowed) {
        problems.push(`${at}: a ${isRefusalLine(line) ? "refusal" : "non-call"} line must not carry a host or a kid`);
      }
    }
  });

  if (attached) {
    const firstAttach = validAttachIndexes[0];
    if (firstAttach === undefined) {
      problems.push(`no attach line with outcome ok, host ${host} and kid ${kid} exists`);
    } else {
      const firstCall = callIndexes[0];
      if (firstCall !== undefined && firstCall < firstAttach) {
        problems.push(`line ${String(firstCall + 1)} (tool ${toolOf(lines[firstCall] ?? {})}): a call line comes before the first attach line`);
      }
    }
  }
  if (admissions < expected.calls) {
    problems.push(`expected at least ${String(expected.calls)} admission lines, found ${String(admissions)}`);
  }
  if (results < expected.calls) {
    problems.push(`expected at least ${String(expected.calls)} result lines, found ${String(results)}`);
  }
  if (refusals < (expected.refusals ?? 0)) {
    problems.push(`expected at least ${String(expected.refusals)} refusal lines, found ${String(refusals)}`);
  }
  return problems;
}

// ---- The leak check --------------------------------------------------------------------------------------------------------

// A secret is a pattern (not global or sticky, so a test is stateless) or an exact text, with a label that is safe to print.
export interface Secret {
  readonly label: string;
  readonly pattern?: RegExp;
  readonly text?: string;
}

export interface Sink {
  readonly name: string;
  readonly text: string;
}

// The capability token shape of src/audit/redact.ts: the prefix, a dot, at least 8 base64url characters. A token whose MAC was cut
// off still matches. The helper test pins that this pattern and the redactor agree on a planted token.
export const TOKEN_SHAPE: RegExp = /rcap1\.[A-Za-z0-9_-]{8,}/;

export const TOKEN_SECRET: Secret = Object.freeze({ label: "a capability token shape", pattern: TOKEN_SHAPE });

// What each secret leaks into: one sentence per (sink, secret) pair that matched, naming the sink and the label and nothing else.
export function leakProblems(sinks: readonly Sink[], secrets: readonly Secret[]): readonly string[] {
  for (const secret of secrets) {
    const { pattern, text } = secret;
    if ((pattern === undefined) === (text === undefined)) {
      throw new Error(`the secret ${secret.label} must be a pattern or a text`);
    }
    if (pattern !== undefined && (pattern.global || pattern.sticky)) {
      throw new Error(`the pattern of ${secret.label} must not be global or sticky`);
    }
    if (text !== undefined && text.length === 0) {
      throw new Error(`the text of ${secret.label} is empty`);
    }
  }
  const problems: string[] = [];
  for (const sink of sinks) {
    for (const secret of secrets) {
      const found = secret.pattern !== undefined ? secret.pattern.test(sink.text) : sink.text.includes(secret.text ?? "");
      if (found) {
        problems.push(`sink ${sink.name} holds ${secret.label}`);
      }
    }
  }
  return problems;
}

export interface KeyringSecrets {
  readonly secrets: readonly Secret[];
  // Set when no key text could be built: an absent, unreadable or malformed keyring. The live test fails on it when enforce attached.
  readonly note: string | undefined;
}

// The texts a key could leak as: the stored form (base64url), the base64 form with padding and the hex form of the raw bytes, per key.
// The file is read to build search strings only; the strings are returned inside the secrets, never printed, and each label names the
// key id and the form.
export function keyringSecrets(keyringFile: string): KeyringSecrets {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(keyringFile, "utf8"));
  } catch {
    return { secrets: [], note: "the keyring is absent or unreadable: the key sweep was skipped" };
  }
  const keys = isRecord(parsed) ? parsed["keys"] : undefined;
  if (!Array.isArray(keys)) {
    return { secrets: [], note: "the keyring holds no key list: the key sweep was skipped" };
  }
  const secrets: Secret[] = [];
  for (const entry of keys as unknown[]) {
    if (!isRecord(entry) || typeof entry["kid"] !== "string" || typeof entry["key"] !== "string" || entry["key"].length === 0) {
      continue;
    }
    const { kid } = entry;
    const stored = entry["key"];
    const bytes = Buffer.from(stored, "base64url");
    const forms: [string, string][] = [
      ["stored form", stored],
      ["base64 form", bytes.toString("base64")],
      ["hex form", bytes.toString("hex")],
    ];
    const seen = new Set<string>();
    for (const [form, text] of forms) {
      if (text.length > 0 && !seen.has(text)) {
        seen.add(text);
        secrets.push({ label: `the keyring key ${kid} (${form})`, text });
      }
    }
  }
  return secrets.length === 0 ? { secrets, note: "the keyring holds no usable key: the key sweep was skipped" } : { secrets, note: undefined };
}

// ---- The tampered copies ---------------------------------------------------------------------------------------------------

export interface TamperedCopies {
  readonly hostEdited: string;
  readonly kidEdited: string;
}

// The text of an audit file with the value of one string member of its first line that has the member replaced. The replacement keeps
// the member's shape (a valid host id, a valid key id), so only the chain, not the shape, can tell.
function withMemberReplaced(text: string, member: "host" | "kid", replacement: (old: string) => string): string {
  const rows = text.split("\n");
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] ?? "";
    if (row === "") {
      continue;
    }
    const parsed: unknown = JSON.parse(row);
    const old = isRecord(parsed) ? parsed[member] : undefined;
    if (typeof old !== "string") {
      continue;
    }
    const fragment = `${JSON.stringify(member)}:${JSON.stringify(old)}`;
    if (!row.includes(fragment)) {
      throw new Error(`the ${member} member of audit line ${String(index + 1)} is not in the canonical form`);
    }
    rows[index] = row.replace(fragment, `${JSON.stringify(member)}:${JSON.stringify(replacement(old))}`);
    return rows.join("\n");
  }
  throw new Error(`no audit line has a ${member} member`);
}

// Two copies of an audit file's text for realm audit verify --file: one with the host of its first host-bearing line changed to another
// valid host id, one with the kid of its first kid-bearing line changed to another valid key id. Each copy differs from the original
// in exactly one member.
export function tamperedCopies(text: string): TamperedCopies {
  return {
    hostEdited: withMemberReplaced(text, "host", (old) => HOST_IDS.find((id) => id !== old) ?? "omp"),
    kidEdited: withMemberReplaced(text, "kid", (old) => (old === "kz9" ? "kz8" : "kz9")),
  };
}

// ---- The doctor item -------------------------------------------------------------------------------------------------------

export interface DoctorItem {
  readonly status: string;
  readonly detail: string;
}

const DOCTOR_ITEM_ID = "capability-tokens";

// The capability-tokens item of the JSON a realm doctor run printed, wherever it sits in the document; undefined when the output is not
// JSON or holds no such item.
export function doctorItemOf(stdout: string): DoctorItem | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const visit = (value: unknown, depth: number): DoctorItem | undefined => {
    if (depth > 6) {
      return undefined;
    }
    if (Array.isArray(value)) {
      for (const entry of value as unknown[]) {
        const found = visit(entry, depth + 1);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    if (!isRecord(value)) {
      return undefined;
    }
    if (value["id"] === DOCTOR_ITEM_ID && typeof value["status"] === "string") {
      return { status: value["status"], detail: typeof value["detail"] === "string" ? value["detail"] : "" };
    }
    for (const child of Object.values(value)) {
      const found = visit(child, depth + 1);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  };
  return visit(parsed, 0);
}

// ---- Keyring facts for the cleanup -----------------------------------------------------------------------------------------

export interface KeyringFact {
  readonly present: boolean;
  // The sha256 of the keyring file when it is present; the content is never kept.
  readonly sha256: string | null;
}

export function keyringFactOf(stateDir: string): KeyringFact {
  const file = keyringPathOf(stateDir);
  if (!existsSync(file)) {
    return { present: false, sha256: null };
  }
  return { present: true, sha256: createHash("sha256").update(readFileSync(file)).digest("hex") };
}

// ---- Sinks of a directory --------------------------------------------------------------------------------------------------

const SINK_FILE_LIMIT_BYTES = 4 * 1024 * 1024;

// Every regular file under dir as a sink named by its path relative to dir (the leak sentence names the sink, so a path beneath a
// scenario directory is all it shows). A file over the limit is read up to the limit; a symbolic link is not followed.
export function sinksUnder(dir: string, prefix: string): readonly Sink[] {
  const sinks: Sink[] = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(dir, relative), { withFileTypes: true })) {
      const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile() && !lstatSync(join(dir, child)).isSymbolicLink()) {
        sinks.push({ name: `${prefix}/${child}`, text: readFileSync(join(dir, child)).subarray(0, SINK_FILE_LIMIT_BYTES).toString("utf8") });
      }
    }
  };
  if (existsSync(dir)) {
    walk("");
  }
  return sinks;
}

// ---- The stub MCP server ---------------------------------------------------------------------------------------------------

const STUB_TOOLS = ["exec", "list", "read", "retry", "status", "write"];

// The text of a Node script (builtins only) that stands in for `realm mcp` in the feasibility test. It speaks line-delimited JSON-RPC on
// stdio, answers server/discover, initialize, tools/list (the six Realm tool names) and tools/call with a plain text result, and
// appends one JSON line per request or notification to `logFile` holding the method name and, for tools/call, the tool name. It carries
// no capability logic: it is a test double.
function stubServerSource(logFile: string): string {
  return [
    'import { appendFileSync } from "node:fs";',
    'import { createInterface } from "node:readline";',
    "",
    `const LOG = ${JSON.stringify(logFile)};`,
    `const TOOLS = ${JSON.stringify(STUB_TOOLS)};`,
    'const note = (value) => { appendFileSync(LOG, JSON.stringify(value) + "\\n"); };',
    'const write = (message) => { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n"); };',
    "const resultOf = (message) => {",
    '  const params = message.params !== null && typeof message.params === "object" ? message.params : {};',
    "  switch (message.method) {",
    '    case "initialize":',
    '      return { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stub-realm", version: "0.0.0" } };',
    '    case "server/discover":',
    '      return { resultType: "complete", supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "stub-realm", version: "0.0.0" } }, ttlMs: 3600000, cacheScope: "public" };',
    '    case "tools/list":',
    '      return { tools: TOOLS.map((name) => ({ name, description: "stub " + name, inputSchema: { type: "object", properties: {} } })) };',
    '    case "tools/call":',
    '      return { content: [{ type: "text", text: "{\\"outcome\\":\\"done\\"}" }] };',
    "    default:",
    "      return {};",
    "  }",
    "};",
    "const rl = createInterface({ input: process.stdin });",
    'rl.on("line", (line) => {',
    "  let message;",
    "  try { message = JSON.parse(line); } catch { return; }",
    '  if (message === null || typeof message !== "object" || typeof message.method !== "string") { return; }',
    '  const tool = message.method === "tools/call" && message.params !== null && typeof message.params === "object" && typeof message.params.name === "string" ? message.params.name : undefined;',
    "  note(tool === undefined ? { method: message.method } : { method: message.method, tool });",
    "  if (message.id === undefined || message.id === null) { return; }",
    "  write({ id: message.id, result: resultOf(message) });",
    "});",
    "",
  ].join("\n");
}

// Writes `<dir>/status-stub-server.mjs` (mode 0644) and returns its path.
export function writeStatusStubServer(dir: string, logFile: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "status-stub-server.mjs");
  writeFileSync(path, stubServerSource(logFile));
  chmodSync(path, 0o644);
  return path;
}

export interface StubCall {
  readonly method: string;
  readonly tool?: string;
}

// The requests and notifications the stub recorded, in order. A missing log is none; a malformed line is skipped.
export function readStubCalls(logFile: string): readonly StubCall[] {
  if (!existsSync(logFile)) {
    return [];
  }
  const calls: StubCall[] = [];
  for (const row of readFileSync(logFile, "utf8").split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row);
    } catch {
      continue;
    }
    if (isRecord(parsed) && typeof parsed["method"] === "string") {
      calls.push(typeof parsed["tool"] === "string" ? { method: parsed["method"], tool: parsed["tool"] } : { method: parsed["method"] });
    }
  }
  return calls;
}

// ---- The claude print-mode shape -------------------------------------------------------------------------------------------

// The tool claude names for the status tool of the MCP server registered as realm.
export const CLAUDE_STATUS_TOOL = "mcp__realm__status";
export const CLAUDE_TURN_PROMPT = "Call the realm status tool once, then reply with the single word done.";
export const CLAUDE_TURN_MAX_TURNS = 3;

// The variables the claude print-mode run sets besides the isolated configuration. Observed against claude 2.1.322 on 2026-11-18:
// with ENABLE_TOOL_SEARCH unset claude defers the schemas of MCP tools behind its ToolSearch tool and offers none of them, so a
// scripted provider that waits for the status tool never sees it (observed, mcp tool count 0); with ENABLE_TOOL_SEARCH=false the six
// tools are offered by name. The other three switch the telemetry, the update check and the non-essential traffic off (the host
// documents them [INFERENCE: not re-read from the CLI documentation]; the run does not depend on them to reach the provider).
export const CLAUDE_TURN_VARIABLES: Readonly<Record<string, string>> = Object.freeze({
  ENABLE_TOOL_SEARCH: "false",
  DISABLE_TELEMETRY: "1",
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
});

const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/;

// The environment of one claude turn: the caller's isolated environment, the fixed variables, the provider's origin and the
// provider's placeholder key. The origin must be a literal loopback origin, so a run can never address another host.
export function claudeTurnEnv(base: Readonly<Record<string, string>>, providerOrigin: string, placeholderKey: string): Record<string, string> {
  if (!LOOPBACK_ORIGIN.test(providerOrigin)) {
    throw new Error("the claude turn must address a literal loopback origin");
  }
  if (placeholderKey.length === 0) {
    throw new Error("the claude turn needs the provider's placeholder key");
  }
  return { ...base, ...CLAUDE_TURN_VARIABLES, ANTHROPIC_BASE_URL: providerOrigin, ANTHROPIC_API_KEY: placeholderKey };
}

// The claude arguments of one print-mode turn: the prompt, the one allowed tool, a turn bound and a machine-readable result.
export function claudePrintArgs(prompt: string = CLAUDE_TURN_PROMPT): readonly string[] {
  return ["-p", prompt, "--allowedTools", CLAUDE_STATUS_TOOL, "--max-turns", String(CLAUDE_TURN_MAX_TURNS), "--output-format", "json"];
}

// ---- Audit counts for the diagnostics --------------------------------------------------------------------------------------

export interface AuditCounts {
  readonly lines: number;
  readonly attach: number;
  readonly admission: number;
  readonly result: number;
  readonly refusal: number;
  readonly other: number;
}

// The counts of an audit file's lines by kind: the diagnostics of the live run carry counts, never a line.
export function auditCountsOf(lines: readonly AuditLine[]): AuditCounts {
  let attach = 0;
  let admission = 0;
  let result = 0;
  let refusal = 0;
  for (const line of lines) {
    if (isAttachLine(line)) {
      attach += 1;
    } else if (line["phase"] === "admission") {
      admission += 1;
    } else if (line["phase"] === "result") {
      result += 1;
    } else if (isRefusalLine(line)) {
      refusal += 1;
    }
  }
  return { lines: lines.length, attach, admission, result, refusal, other: lines.length - attach - admission - result - refusal };
}
