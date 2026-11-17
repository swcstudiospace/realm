// A conservative line scanner for the one block-style YAML entry the `yaml-map` recipe owns (Phase 25, Hermes `config.yaml`). It answers
// two questions about a host file: is the entry `parent.child` here, and where do its lines start and end (or where would a new one go)?
// It is not a YAML parser and never claims to parse a file: it claims only "the `parent` mapping is, or is not, here in block style".
//
// Every doubt is a refusal. `unreadable`: over 1 MiB, a NUL, a BOM, a Unicode line break other than LF, a lone CR, mixed line endings, a
// tab used for indentation, an anchor, alias or tag token, a merge key, a complex key, a document marker or directive, a quote that does
// not close on its line, a first line that is not at column 0, a column-0 line that is not a `key:` or `key: value`, and a child line the
// scanner cannot classify. `foreign`: readable, but the target is defined in a form Realm does not own (a duplicate parent or child, a
// parent that is a scalar, a flow mapping other than `{}`, or a sequence).
//
// What it cannot see: the meaning of a plain scalar. A look-alike `mcp_servers:` inside a block scalar (`|` or `>`) is skipped, never
// classified; a look-alike inside a multi-line plain scalar cannot sit at column 0, where the scanner looks for the parent. A token such as
// ` *x` or ` &y` inside a plain scalar is refused (a false positive, which is safe).
//
// Why a regular expression per line is safe: each pattern is anchored, runs over one line of at most 1 MiB, and every quantifier is
// bounded by a character class that excludes the delimiter that follows it, so none can backtrack more than once per character. The
// scan is one pass with no recursion.

import type { InstallRecipe } from "./types.js";

export type YamlEntryValue = Extract<InstallRecipe, { kind: "yaml-map" }>["value"];

const MAX_INPUT_CHARS = 1024 * 1024;
const MAX_CHILD_INDENT = 8;
// NUL, BOM, and the Unicode line breaks YAML 1.1 readers honour (NEL, LS, PS) that this scanner does not.
const FORBIDDEN_CHARS: readonly string[] = ["\u0000", "\uFEFF", "\u0085", "\u2028", "\u2029"];
// A plain key: starts with a letter, digit or underscore; no colon, quote or flow character.
const PLAIN_KEY = /^[A-Za-z0-9_][A-Za-z0-9_./ $()+=~-]*$/;
// A line whose code ends in a block scalar header: `|` or `>`, up to two indicators, after whitespace or at the line start.
const BLOCK_HEADER = /(?:^|[ \t])[|>][1-9+-]{0,2}$/;
// A plain scalar may not start with an indicator.
const PLAIN_START = /^[^\s[\]{},#&*!|>'"%@`]/;

// Where a parent key that exists in block form (or as `{}`) sits in the file. Offsets are into the scanned text.
export interface YamlParent {
  // The header line, its line ending included.
  readonly headerStart: number;
  readonly headerEnd: number;
  // Within the header line text: the offset of the key's colon, and the offset just after `{}` when the value is `{}` (else -1).
  readonly colon: number;
  readonly flowEnd: number;
  // The indent of the children, null when the parent has none.
  readonly childIndent: number | null;
  // Where a new child goes: just after the last content line of the block, else just after the header line.
  readonly insertAt: number;
  // True when nothing but blank lines and column-0 comments lies below the header (a header Realm created and emptied).
  readonly bare: boolean;
}

export interface YamlEntryLocation {
  // The first line of the entry through the end of its last content line, its line ending included when it has one. Blank and
  // comment lines at the tail are not part of it.
  readonly start: number;
  readonly end: number;
  // The entry as the tiny reader parsed it, null when it uses any construct the reader does not accept.
  readonly value: YamlEntryValue | null;
}

export type YamlScan =
  | { readonly state: "unreadable" }
  | { readonly state: "foreign" }
  // The target is absent. parent null: the parent key is absent too.
  | { readonly state: "free"; readonly eol: string; readonly parent: YamlParent | null }
  | { readonly state: "present"; readonly eol: string; readonly childIndent: number; readonly entry: YamlEntryLocation };

interface KeyValue {
  readonly key: string;
  readonly colon: number;
  // The text after the colon, trimmed.
  readonly rest: string;
}

interface Line {
  readonly start: number;
  readonly end: number;
  readonly kind: "blank" | "comment" | "content" | "body";
  readonly indent: number;
  // content only: the text up to a trailing comment, right-trimmed, indentation included.
  readonly code: string;
  // content at column 0 only.
  readonly kv: KeyValue | null;
}

function isWs(char: string): boolean {
  return char === " " || char === "\t";
}

// The offset of the quote that closes the one opened at `open`, or -1. Double quotes skip a backslash pair; single quotes skip `''`.
function closingQuote(text: string, open: number): number {
  const quote = text.charAt(open);
  for (let i = open + 1; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (quote === '"' && char === "\\") {
      i += 1;
      continue;
    }
    if (char === quote) {
      if (quote === "'" && text.charAt(i + 1) === "'") {
        i += 1;
        continue;
      }
      return i;
    }
  }
  return -1;
}

// The line up to a trailing comment, or null when it holds a construct the scanner refuses (anchor, alias, tag, merge key, complex key,
// a quote that does not close). A quote only opens at the start of a token, as in YAML; a `#` starts a comment at the line start or
// after whitespace.
function codeOf(text: string): string | null {
  let tokenStart = true;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charAt(i);
    if (char === "#" && (i === 0 || isWs(text.charAt(i - 1)))) {
      return text.slice(0, i);
    }
    if (tokenStart) {
      if (char === '"' || char === "'") {
        const close = closingQuote(text, i);
        if (close < 0) {
          return null;
        }
        i = close;
        tokenStart = false;
        continue;
      }
      if (char === "&" || char === "*" || char === "!") {
        return null;
      }
      if (char === "?" && (i + 1 === text.length || isWs(text.charAt(i + 1)))) {
        return null;
      }
      if (char === "<" && text.startsWith("<<", i)) {
        let j = i + 2;
        while (j < text.length && isWs(text.charAt(j))) {
          j += 1;
        }
        if (text.charAt(j) === ":") {
          return null;
        }
      }
    }
    tokenStart = isWs(char) || char === "[" || char === "{" || char === ",";
  }
  return text;
}

// `key:` or `key: value` starting at `from` in `code`. null when the text is not one.
function splitKey(code: string, from: number): KeyValue | null {
  const first = code.charAt(from);
  let key: string;
  let colon: number;
  if (first === '"' || first === "'") {
    const close = closingQuote(code, from);
    if (close < 0) {
      return null;
    }
    const inner = code.slice(from + 1, close);
    if (first === '"' && inner.includes("\\")) {
      return null;
    }
    key = first === "'" ? inner.replaceAll("''", "'") : inner;
    let j = close + 1;
    while (j < code.length && isWs(code.charAt(j))) {
      j += 1;
    }
    if (code.charAt(j) !== ":") {
      return null;
    }
    colon = j;
  } else {
    let at = code.indexOf(":", from);
    while (at >= 0 && at + 1 < code.length && !isWs(code.charAt(at + 1))) {
      at = code.indexOf(":", at + 1);
    }
    if (at < 0) {
      return null;
    }
    const raw = code.slice(from, at).trimEnd();
    if (!PLAIN_KEY.test(raw)) {
      return null;
    }
    key = raw;
    colon = at;
  }
  if (colon + 1 < code.length && !isWs(code.charAt(colon + 1))) {
    return null;
  }
  return { key, colon, rest: code.slice(colon + 1).trim() };
}

// ---- The tiny reader of one entry --------------------------------------------------------------------------------------

function unescapeDouble(inner: string): string | null {
  let out = "";
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner.charAt(i);
    if (char !== "\\") {
      out += char;
      continue;
    }
    i += 1;
    const next = inner.charAt(i);
    if (next !== '"' && next !== "\\") {
      return null;
    }
    out += next;
  }
  return out;
}

// One scalar: plain, single-quoted or double-quoted (only the escapes `\"` and `\\`), and nothing after it.
function readScalar(text: string): string | null {
  const first = text.charAt(0);
  if (first === '"' || first === "'") {
    if (closingQuote(text, 0) !== text.length - 1) {
      return null;
    }
    const inner = text.slice(1, -1);
    return first === "'" ? inner.replaceAll("''", "'") : unescapeDouble(inner);
  }
  const second = text.charAt(1);
  const indicator = (first === "-" || first === "?" || first === ":") && (second === "" || isWs(second));
  if (text === "" || !PLAIN_START.test(text) || indicator || text.includes(": ") || text.endsWith(":")) {
    return null;
  }
  return text;
}

// `[a, "b", 'c']` on one line. An empty item or a trailing comma, a nested collection: null.
function readFlowSequence(text: string): readonly string[] | null {
  if (!text.startsWith("[") || !text.endsWith("]")) {
    return null;
  }
  const end = text.length - 1;
  const items: string[] = [];
  let i = 1;
  const skip = (): void => {
    while (i < end && isWs(text.charAt(i))) {
      i += 1;
    }
  };
  skip();
  if (i === end) {
    return items;
  }
  for (;;) {
    skip();
    if (i >= end) {
      return null;
    }
    let item: string | null;
    const char = text.charAt(i);
    if (char === '"' || char === "'") {
      const close = closingQuote(text, i);
      if (close < 0 || close >= end) {
        return null;
      }
      item = readScalar(text.slice(i, close + 1));
      i = close + 1;
    } else {
      let j = i;
      while (j < end && text.charAt(j) !== ",") {
        if ("[]{}".includes(text.charAt(j))) {
          return null;
        }
        j += 1;
      }
      item = readScalar(text.slice(i, j).trim());
      i = j;
    }
    if (item === null) {
      return null;
    }
    items.push(item);
    skip();
    if (i === end) {
      return items;
    }
    if (text.charAt(i) !== ",") {
      return null;
    }
    i += 1;
  }
}

// The text after `- ` of a block sequence item line, null when the line is not an item. An item with no text gives "".
function itemOf(code: string, indent: number): string | null {
  const text = code.slice(indent);
  if (text === "-") {
    return "";
  }
  return text.startsWith("- ") ? text.slice(2).trim() : null;
}

// The entry whose key line is lines[from] and whose last content line is lines[to]: only `key: scalar`, `key:` plus a block sequence
// of scalars (indented under the key or level with it), and `key: [scalar, ...]`. Anything else, a repeated key included: null.
function readEntry(lines: readonly Line[], from: number, to: number, header: KeyValue): YamlEntryValue | null {
  if (header.rest !== "") {
    return null;
  }
  const body: Line[] = [];
  for (let i = from + 1; i <= to; i += 1) {
    const line = lines[i];
    if (line === undefined || line.kind === "body") {
      return null;
    }
    if (line.kind === "content") {
      body.push(line);
    }
  }
  const first = body[0];
  if (first === undefined) {
    return null;
  }
  const keyIndent = first.indent;
  const pairs = new Map<string, string | readonly string[]>();
  let at = 0;
  while (at < body.length) {
    const line = body[at];
    if (line === undefined || line.indent !== keyIndent) {
      return null;
    }
    const kv = splitKey(line.code, keyIndent);
    if (kv === null || pairs.has(kv.key)) {
      return null;
    }
    at += 1;
    if (kv.rest === "") {
      const items: string[] = [];
      let seqIndent = -1;
      for (; at < body.length; at += 1) {
        const next = body[at];
        const text = next === undefined ? null : itemOf(next.code, next.indent);
        if (next === undefined || text === null) {
          break;
        }
        seqIndent = seqIndent < 0 ? next.indent : seqIndent;
        const item = next.indent === seqIndent ? readScalar(text) : null;
        if (item === null) {
          return null;
        }
        items.push(item);
      }
      if (items.length === 0) {
        return null;
      }
      pairs.set(kv.key, items);
      continue;
    }
    const value = kv.rest.startsWith("[") ? readFlowSequence(kv.rest) : readScalar(kv.rest);
    if (value === null) {
      return null;
    }
    pairs.set(kv.key, value);
  }
  return Object.fromEntries(pairs);
}

// ---- The scan ----------------------------------------------------------------------------------------------------------

interface RawLine {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

// The lines of `content` and its line ending, or null for mixed line endings and a lone carriage return.
function splitLines(content: string): { readonly raws: readonly RawLine[]; readonly eol: string } | null {
  const raws: RawLine[] = [];
  let offset = 0;
  let crlf = 0;
  let lf = 0;
  while (offset < content.length) {
    const nl = content.indexOf("\n", offset);
    let text = content.slice(offset, nl < 0 ? content.length : nl);
    if (nl >= 0) {
      if (text.endsWith("\r")) {
        text = text.slice(0, -1);
        crlf += 1;
      } else {
        lf += 1;
      }
    }
    if (text.includes("\r")) {
      return null;
    }
    const end = nl < 0 ? content.length : nl + 1;
    raws.push({ start: offset, end, text });
    offset = end;
  }
  if (crlf > 0 && lf > 0) {
    return null;
  }
  return { raws, eol: crlf > 0 ? "\r\n" : "\n" };
}

// Classifies every line, or null when anything in the file is unreadable (see the header).
function classify(raws: readonly RawLine[]): readonly Line[] | null {
  const lines: Line[] = [];
  // The indent of the line that opened a block scalar, -1 outside one.
  let bodyParent = -1;
  let seenContent = false;
  for (const raw of raws) {
    const text = raw.text;
    let lead = 0;
    while (lead < text.length && isWs(text.charAt(lead))) {
      lead += 1;
    }
    let spaces = 0;
    while (spaces < text.length && text.charAt(spaces) === " ") {
      spaces += 1;
    }
    const base = { start: raw.start, end: raw.end, code: "", kv: null };
    if (lead === text.length) {
      lines.push({ ...base, kind: "blank", indent: 0 });
      continue;
    }
    if (bodyParent >= 0 && spaces > bodyParent) {
      lines.push({ ...base, kind: "body", indent: spaces });
      continue;
    }
    bodyParent = -1;
    if (text.slice(0, lead).includes("\t")) {
      return null;
    }
    const rest = text.slice(lead);
    if (rest.startsWith("#")) {
      lines.push({ ...base, kind: "comment", indent: lead });
      continue;
    }
    if (!seenContent && lead !== 0) {
      return null;
    }
    seenContent = true;
    if (lead === 0) {
      const marker = rest.startsWith("---") || rest.startsWith("...");
      if ((marker && (rest.length === 3 || isWs(rest.charAt(3)))) || rest.startsWith("%")) {
        return null;
      }
    }
    const code = codeOf(text)?.trimEnd();
    if (code === undefined) {
      return null;
    }
    const kv = lead === 0 ? splitKey(code, 0) : null;
    if (lead === 0 && kv === null) {
      return null;
    }
    if (BLOCK_HEADER.test(code)) {
      bodyParent = lead;
    }
    lines.push({ start: raw.start, end: raw.end, kind: "content", indent: lead, code, kv });
  }
  return lines;
}

type ParentScan = { readonly kind: "foreign" } | { readonly kind: "unreadable" } | { readonly kind: "block"; readonly parent: YamlParent; readonly entry: YamlEntryLocation | null };

function scanParent(lines: readonly Line[], at: number, child: string): ParentScan {
  const header = lines[at];
  const kv = header?.kv;
  if (header === undefined || kv === null || kv === undefined || (kv.rest !== "" && kv.rest !== "{}")) {
    return { kind: "foreign" };
  }
  const flow = kv.rest === "{}";
  let regionEnd = lines.length;
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line?.kind === "content" && line.indent === 0) {
      regionEnd = i;
      break;
    }
  }
  const region = lines.slice(at + 1, regionEnd);
  const contents: number[] = [];
  let lastUsed = -1;
  for (let i = at + 1; i < regionEnd; i += 1) {
    const kind = lines[i]?.kind;
    if (kind === "content") {
      contents.push(i);
    }
    if (kind === "content" || kind === "body") {
      lastUsed = i;
    }
  }
  const bare = region.every((line) => line.kind === "blank" || (line.kind === "comment" && line.indent === 0));
  const flowEnd = flow ? header.code.indexOf("{", kv.colon + 1) + 2 : -1;
  const parentOf = (childIndent: number | null, insertAt: number): YamlParent => ({
    headerStart: header.start,
    headerEnd: header.end,
    colon: kv.colon,
    flowEnd,
    childIndent,
    insertAt,
    bare,
  });
  const firstAt = contents[0];
  const first = firstAt === undefined ? undefined : lines[firstAt];
  if (firstAt === undefined || first === undefined) {
    return { kind: "block", parent: parentOf(null, header.end), entry: null };
  }
  if (flow) {
    return { kind: "unreadable" };
  }
  const childIndent = first.indent;
  const lead = first.code.slice(childIndent);
  if (childIndent > MAX_CHILD_INDENT) {
    return { kind: "unreadable" };
  }
  if (lead === "-" || lead.startsWith("- ")) {
    return { kind: "foreign" };
  }
  const children: { readonly key: string; readonly at: number; readonly kv: KeyValue }[] = [];
  for (const index of contents) {
    const line = lines[index];
    if (line === undefined || line.indent < childIndent) {
      return { kind: "unreadable" };
    }
    if (line.indent === childIndent) {
      const childKv = splitKey(line.code, childIndent);
      if (childKv === null) {
        return { kind: "unreadable" };
      }
      children.push({ key: childKv.key, at: index, kv: childKv });
    }
  }
  const matches = children.filter((candidate) => candidate.key === child);
  const lastUsedLine = lines[lastUsed];
  const parent = parentOf(childIndent, lastUsedLine === undefined ? header.end : lastUsedLine.end);
  const match = matches[0];
  if (matches.length > 1) {
    return { kind: "foreign" };
  }
  if (match === undefined) {
    return { kind: "block", parent, entry: null };
  }
  const next = children[children.indexOf(match) + 1];
  let last = (next === undefined ? regionEnd : next.at) - 1;
  while (last > match.at && lines[last]?.kind !== "content" && lines[last]?.kind !== "body") {
    last -= 1;
  }
  const startLine = lines[match.at];
  const endLine = lines[last];
  if (startLine === undefined || endLine === undefined) {
    return { kind: "unreadable" };
  }
  return { kind: "block", parent, entry: { start: startLine.start, end: endLine.end, value: readEntry(lines, match.at, last, match.kv) } };
}

// Where the entry `path[0].path[1]` of a block-style YAML file is. See the header for what each state means.
export function scanYamlMap(content: string, path: readonly [string, string]): YamlScan {
  if (content.length > MAX_INPUT_CHARS || FORBIDDEN_CHARS.some((char) => content.includes(char))) {
    return { state: "unreadable" };
  }
  const split = splitLines(content);
  const lines = split === null ? null : classify(split.raws);
  if (split === null || lines === null) {
    return { state: "unreadable" };
  }
  const { eol } = split;
  const parents: number[] = [];
  lines.forEach((line, index) => {
    if (line.kind === "content" && line.indent === 0 && line.kv?.key === path[0]) {
      parents.push(index);
    }
  });
  const first = parents[0];
  if (first === undefined) {
    return { state: "free", eol, parent: null };
  }
  let foreign = parents.length > 1;
  let found: ParentScan | null = null;
  for (const index of parents) {
    const scanned = scanParent(lines, index, path[1]);
    if (scanned.kind === "unreadable") {
      return { state: "unreadable" };
    }
    foreign = foreign || scanned.kind === "foreign";
    found = index === first ? scanned : found;
  }
  if (foreign || found === null || found.kind !== "block") {
    return { state: "foreign" };
  }
  if (found.entry === null) {
    return { state: "free", eol, parent: found.parent };
  }
  return { state: "present", eol, childIndent: found.parent.childIndent ?? 0, entry: found.entry };
}
