// A strict JSON reader for the gateway's launch body (phase 9.5). It accepts the documents serde_json accepts for the gateway's
// launch types and refuses the rest: a byte order mark, bytes that are not UTF-8, a duplicate object key (serde: "duplicate
// field"), a lone surrogate escape, nesting deeper than serde_json's recursion limit of 128, and trailing text. A number keeps its
// source text, so an integer field is the integer the gateway wrote: a fraction or an exponent is not an integer, and no value is
// rounded to a JavaScript number.

// serde_json's default recursion limit: an object or array may nest to this depth and no deeper.
const MAX_DEPTH = 128;
const WHITESPACE = /[ \t\n\r]*/y;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
// A string token: a quote, characters other than quote and backslash, and the JSON escapes. A raw control character is not matched
// here; JSON.parse refuses it when the token's value is read, as serde_json does.
const STRING = /"(?:[^"\\]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"/y;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// The integer text serde_json reads as an integer. A negative zero is not: serde_json reads "-0" as a float, which no integer
// field accepts, so the sign is allowed only before a non-zero digit.
const INTEGER_TEXT = /^(?:0|-?[1-9][0-9]*)$/;

// A number as written in the document. Its text is kept so an integer can be read exactly.
export class JsonNumber {
  constructor(readonly text: string) {}
}

export type JsonValue = null | boolean | string | JsonNumber | readonly JsonValue[] | ReadonlyMap<string, JsonValue>;

// The integer a number names, or undefined when the number has a fraction or an exponent, or is a negative zero.
export function integerOf(value: JsonValue | undefined): bigint | undefined {
  if (!(value instanceof JsonNumber) || !INTEGER_TEXT.test(value.text)) {
    return undefined;
  }
  return BigInt(value.text);
}

// Reads one JSON document. Returns undefined for any text serde_json would refuse as a document.
export function parseJsonDocument(body: Uint8Array): JsonValue | undefined {
  let text: string;
  try {
    // ignoreBOM keeps a leading byte order mark in the text, where the reader refuses it, as serde_json does.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
  } catch {
    return undefined;
  }
  const reader = new Reader(text);
  try {
    const value = reader.value(0);
    reader.end();
    return value;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

class Reader {
  private pos = 0;

  constructor(private readonly text: string) {}

  end(): void {
    this.skipWhitespace();
    if (this.pos !== this.text.length) {
      throw new SyntaxError("trailing text");
    }
  }

  // The value that starts at the next token. depth is the nesting of the container that holds it.
  value(depth: number): JsonValue {
    this.skipWhitespace();
    const next = this.text.charAt(this.pos);
    if (next === "{") {
      return this.object(depth + 1);
    }
    if (next === "[") {
      return this.array(depth + 1);
    }
    if (next === '"') {
      return this.string();
    }
    for (const [word, literal] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (this.text.startsWith(word, this.pos)) {
        this.pos += word.length;
        return literal;
      }
    }
    return this.number();
  }

  private object(depth: number): ReadonlyMap<string, JsonValue> {
    this.enter(depth);
    this.pos += 1;
    const members = new Map<string, JsonValue>();
    this.skipWhitespace();
    if (this.text.charAt(this.pos) === "}") {
      this.pos += 1;
      return members;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.text.charAt(this.pos) !== '"') {
        throw new SyntaxError("object key expected");
      }
      const key = this.string();
      if (members.has(key)) {
        throw new SyntaxError("duplicate object key");
      }
      this.skipWhitespace();
      this.expect(":");
      members.set(key, this.value(depth));
      this.skipWhitespace();
      const next = this.text.charAt(this.pos);
      this.pos += 1;
      if (next === "}") {
        return members;
      }
      if (next !== ",") {
        throw new SyntaxError("object separator expected");
      }
    }
  }

  private array(depth: number): readonly JsonValue[] {
    this.enter(depth);
    this.pos += 1;
    const items: JsonValue[] = [];
    this.skipWhitespace();
    if (this.text.charAt(this.pos) === "]") {
      this.pos += 1;
      return items;
    }
    for (;;) {
      items.push(this.value(depth));
      this.skipWhitespace();
      const next = this.text.charAt(this.pos);
      this.pos += 1;
      if (next === "]") {
        return items;
      }
      if (next !== ",") {
        throw new SyntaxError("array separator expected");
      }
    }
  }

  private string(): string {
    STRING.lastIndex = this.pos;
    const match = STRING.exec(this.text);
    if (match === null) {
      throw new SyntaxError("malformed string");
    }
    this.pos += match[0].length;
    const value = JSON.parse(match[0]) as string;
    if (LONE_SURROGATE.test(value)) {
      throw new SyntaxError("lone surrogate");
    }
    return value;
  }

  private number(): JsonNumber {
    NUMBER.lastIndex = this.pos;
    const match = NUMBER.exec(this.text);
    if (match === null) {
      throw new SyntaxError("value expected");
    }
    this.pos += match[0].length;
    return new JsonNumber(match[0]);
  }

  private expect(token: string): void {
    if (this.text.charAt(this.pos) !== token) {
      throw new SyntaxError(`${token} expected`);
    }
    this.pos += 1;
  }

  private enter(depth: number): void {
    if (depth > MAX_DEPTH) {
      throw new SyntaxError("recursion limit exceeded");
    }
  }

  private skipWhitespace(): void {
    WHITESPACE.lastIndex = this.pos;
    WHITESPACE.exec(this.text);
    this.pos = WHITESPACE.lastIndex;
  }
}
