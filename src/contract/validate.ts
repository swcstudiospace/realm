// Named-schema validation wrapper (D-12, spec n2). This is the only module that
// imports the JSON Schema validator (ajv). It returns either a typed value or a
// SchemaInvalidError (a RealmError with code SCHEMA_INVALID).
//
// Privacy rule: a failure names the offending key or JSON pointer and the rule it
// broke. It never includes the offending value, because the value may be a
// credential. Messages are built from the keyword and pointer only, never from
// ajv's message text.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// ajv 8 is CommonJS. Its /2020 entry exports the draft 2020-12 class as a named
// export, which NodeNext types correctly and Node's CJS lexer detects. The default
// import is typed as the module namespace under NodeNext, so it is not used.
import { Ajv2020, type ErrorObject, type SchemaObject, type ValidateFunction } from "ajv/dist/2020.js";
import { RealmError } from "../core/errors.js";
import { STATES, type State } from "../core/states.js";

// ---- Typed values -----------------------------------------------------------

export type PolicyMode = "advisory" | "fail-closed";

export interface EgressRule {
  readonly host: string;
  readonly port: number;
}

// Output of validating the policy schema: defaults are already applied.
export interface Policy {
  readonly mode: PolicyMode;
  readonly workspaceRoots: readonly string[];
  readonly credentialAllow: readonly string[];
  readonly egressAllow: readonly EgressRule[];
  readonly shellEnabled: boolean;
  readonly startupBudgetMs: number;
  readonly toolQueueMs: number;
}

export type ExecParams =
  | { readonly argv: readonly string[] }
  | { readonly shell: true; readonly script: string };

export interface ReadParams {
  readonly path: string;
  readonly maxBytes: number;
}

export interface WriteParams {
  readonly path: string;
  readonly content: string;
  readonly ifMatchSha256?: string;
}

export interface ListParams {
  readonly path: string;
  readonly depth: number;
}

export type NoParams = Readonly<Record<string, never>>;

export interface ToolParams {
  readonly exec: ExecParams;
  readonly read: ReadParams;
  readonly write: WriteParams;
  readonly list: ListParams;
  readonly status: NoParams;
  readonly retry: NoParams;
}

export type ToolName = keyof ToolParams;

// A tool call: an object with exactly one key, the tool name (D-13 map shape).
export type ToolCall = {
  [K in ToolName]: { readonly [P in K]: ToolParams[P] };
}[ToolName];

export interface SessionRecord {
  readonly realmId: string;
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly state: State;
  readonly controlSocketPath: string;
  readonly containerId?: string | null;
}

export interface SchemaValues {
  readonly policy: Policy;
  readonly tools: ToolCall;
  readonly sessionRecord: SessionRecord;
}

export type SchemaName = keyof SchemaValues;

// ---- Results and errors -----------------------------------------------------

// Returned by validate() inside a failed ValidationResult, never thrown.
export class SchemaInvalidError extends RealmError {
  // The offending key or JSON pointer and the rule it broke. Never the value.
  readonly detail: string;

  constructor(detail: string) {
    super("SCHEMA_INVALID");
    this.detail = detail;
    this.message = `${this.reason} ${detail}`;
  }
}

export interface ValidationOk<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly error: SchemaInvalidError;
}

export type ValidationResult<T> = ValidationOk<T> | ValidationFailure;

// ---- Schema loading ---------------------------------------------------------

const SCHEMA_FILES: Readonly<Record<SchemaName, readonly string[]>> = {
  policy: ["src", "core", "policy.schema.json"],
  tools: ["src", "contract", "tools.schema.json"],
  sessionRecord: ["src", "contract", "session-record.schema.json"],
};

// The JSON schemas live in src/, and tsc does not copy them into dist/. Walking
// up to the package root works from both the source and the compiled layout.
function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("package.json not found above the validation module");
    }
    dir = parent;
  }
}

// strictRequired is off because the exec if/then/else names keys declared in its
// parent object. Every other strict check stays on.
const ajv = new Ajv2020({
  strict: true,
  strictRequired: false,
  allErrors: false,
  useDefaults: true,
});
const compiled = new Map<SchemaName, ValidateFunction>();

// The session-record state enum comes from the STATES constant, not from the JSON
// file, so the file cannot carry a second copy that drifts from it.
function withStateEnum(schema: SchemaObject): SchemaObject {
  const properties = schema.properties as SchemaObject;
  const state = properties.state as SchemaObject;
  return { ...schema, properties: { ...properties, state: { ...state, enum: [...STATES] } } };
}

// The schema object handed to ajv for a named schema.
function schemaObject(name: SchemaName): SchemaObject {
  const path = join(packageRoot(), ...SCHEMA_FILES[name]);
  const raw = JSON.parse(readFileSync(path, "utf8")) as SchemaObject;
  return name === "sessionRecord" ? withStateEnum(raw) : raw;
}

// The state enum the session-record validator enforces, exactly as ajv receives it.
// Exported so a test can compare it with STATES in both directions.
export function sessionRecordStateEnum(): readonly string[] {
  const properties = schemaObject("sessionRecord").properties as SchemaObject;
  return (properties.state as SchemaObject).enum as readonly string[];
}

function compiledSchema(name: SchemaName): ValidateFunction {
  const cached = compiled.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const validator = ajv.compile(schemaObject(name));
  compiled.set(name, validator);
  return validator;
}

// ---- Failure description (keyword and pointer only) --------------------------

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

// The key named by an additionalProperties or required failure, if any.
function keyNameOf(error: ErrorObject): string | undefined {
  if (error.keyword === "additionalProperties") {
    const raw: unknown = error.params["additionalProperty"];
    return typeof raw === "string" ? raw : undefined;
  }
  if (error.keyword === "required") {
    const raw: unknown = error.params["missingProperty"];
    return typeof raw === "string" ? raw : undefined;
  }
  return undefined;
}

function pointerOf(error: ErrorObject): string {
  const name = keyNameOf(error);
  const pointer =
    name === undefined
      ? error.instancePath
      : `${error.instancePath}/${escapePointerSegment(name)}`;
  return pointer === "" ? "(root)" : pointer;
}

// Fixed phrases per keyword. Any keyword not listed gets a generic phrase, so no
// schema or input text is echoed.
function ruleOf(error: ErrorObject): string {
  switch (error.keyword) {
    case "additionalProperties":
      return "unknown key";
    case "required":
      return "required key is missing";
    case "type":
      return "wrong type";
    case "enum":
      return "not one of the allowed values";
    case "const":
      return "not the required constant";
    case "pattern":
      return "does not match the required pattern";
    case "not":
      return "matches a forbidden form";
    case "minLength":
      return "too short";
    case "minItems":
      return "too few items";
    case "minimum":
      return "below the minimum";
    case "maximum":
      return "above the maximum";
    case "minProperties":
      return "too few keys";
    case "maxProperties":
      return "too many keys";
    default:
      return `violates the ${error.keyword} rule`;
  }
}

function describeFailure(errors: readonly ErrorObject[] | null | undefined): string {
  const first = errors?.[0];
  if (first === undefined) {
    return "(root): input does not match the schema";
  }
  return `${pointerOf(first)}: ${ruleOf(first)}`;
}

// ---- Public API -------------------------------------------------------------

// Validates input against a named frozen schema. Defaults are filled in on a
// copy, so the caller's object is never mutated. Input that JSON cannot carry
// (a function, a symbol) is a SCHEMA_INVALID failure, not a thrown error.
export function validate<N extends SchemaName>(
  schema: N,
  input: unknown,
): ValidationResult<SchemaValues[N]> {
  let working: unknown;
  try {
    working = structuredClone(input);
  } catch {
    // structuredClone throws DataCloneError for values JSON cannot carry. The
    // thrown error is not used: V8 builds its message from the value itself,
    // which may be a credential.
    return {
      ok: false,
      error: new SchemaInvalidError("input holds a value that is not JSON-compatible"),
    };
  }
  const validator = compiledSchema(schema);
  if (validator(working)) {
    return { ok: true, value: working as SchemaValues[N] };
  }
  return {
    ok: false,
    error: new SchemaInvalidError(describeFailure(validator.errors)),
  };
}
