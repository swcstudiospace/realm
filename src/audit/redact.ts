// Redaction before serialization (D-41, AUD-01, spec n5). Two layers: a key layer
// that replaces the value of any credential-named key, and a value layer that
// replaces credential-shaped substrings of strings. Redaction never throws. Any
// input it cannot walk safely is replaced with REDACTED, so a failure is never a
// pass-through of the original value.
//
// Privacy rule: nothing in this module reports the value it redacted.

export const REDACTED = "[REDACTED]";

// Values nested deeper than this are replaced with REDACTED, not walked (fail closed).
export const REDACT_MAX_DEPTH = 8;

// Key layer (D-41). Matched against each object key, case-insensitively.
export const SENSITIVE_KEY_PATTERN: RegExp =
  /token|secret|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key/i;

// Value layer (D-41). Each pattern is global and replaced with REDACTED in order.
// The array is frozen; the RegExp objects are not, because String.prototype.replace
// writes lastIndex on a global RegExp and a frozen RegExp would throw.
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = Object.freeze([
  /Bearer\s+\S+/gi,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
]);

// NAME=value where NAME contains TOKEN, SECRET, PASSWORD, or KEY. Only the value is
// replaced; the NAME is kept so the entry still says which credential was present.
export const SECRET_ASSIGNMENT_PATTERN: RegExp =
  /([A-Za-z0-9_]*(?:token|secret|password|key)[A-Za-z0-9_]*)=\S+/gi;

export function redactString(text: string): string {
  let out = text;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out.replace(SECRET_ASSIGNMENT_PATTERN, `$1=${REDACTED}`);
}

// Returns a redacted copy of value. Input is not mutated. Never throws.
export function redactValue(value: unknown): unknown {
  try {
    return redactAt(value, 0, new Set<object>());
  } catch {
    // A getter, proxy trap, or other hostile value failed while being walked. The
    // error text is not used: it may carry the value.
    return REDACTED;
  }
}

function redactAt(value: unknown, depth: number, ancestors: Set<object>): unknown {
  if (depth > REDACT_MAX_DEPTH) {
    return REDACTED;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === undefined) {
    return value;
  }
  if (typeof value === "bigint") {
    // JSON.stringify throws on bigint; the decimal text is carried as a string.
    return value.toString();
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "object") {
    // Symbols and functions cannot be carried by JSON; they are replaced.
    return REDACTED;
  }
  // A cycle back to an ancestor is replaced, not followed.
  if (ancestors.has(value)) {
    return REDACTED;
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item: unknown) => redactAt(item, depth + 1, ancestors));
    }
    // Null prototype: a key such as "__proto__" stays an ordinary property.
    const out: Record<string, unknown> = Object.create(null);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      out[redactString(key)] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactAt(record[key], depth + 1, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}
