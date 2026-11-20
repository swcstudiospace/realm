// A conservative line scanner for the Codex-style owned TOML table (Phase 24). It answers questions about a host file: does the text
// define the table the recipe owns (or an ancestor key of it), and where does that one table start and end? It is not a TOML
// parser and never claims to parse a file.
//
// What it proves: every table header, every key assignment and every dotted key it can read on one line is compared with the
// target path, in file order, and the first one that defines the target (equal path, a longer path below it, or a shorter
// ancestor key assigned a value) makes the answer "taken". A line starting with `[` that is not a readable header, and an
// input over 1 MiB, make the answer "unreadable". Every doubt is a refusal, never a pass.
//
// What it cannot see: the contents of a multi-line string or array. A look-alike header inside a `"""` string is reported
// as "taken" (a false positive that refuses, which is safe). A bare `["x"]` line inside a multi-line array under an
// ancestor table can hide a real definition from it; the host's own validator is the second line of defense for that.
//
// Why a regular expression per line is safe: each pattern is anchored, runs over one line at most 1 MiB long, and every
// quantifier is bounded by a character class that excludes the delimiter that follows it (a bare key stops at a dot,
// space, bracket or equals sign; a quoted key stops at its closing quote), so no nested or overlapping quantifier can
// backtrack more than once per character.

const MAX_INPUT_CHARS = 1024 * 1024;

// A key: bare, basic-quoted without an escape, or literal-quoted.
const KEY = String.raw`(?:[A-Za-z0-9_-]+|"[^"\\]*"|'[^']*')`;
const DOTTED = String.raw`${KEY}(?:\s*\.\s*${KEY})*`;
// `[` or `[[`, the dotted keys, `]` or `]]`, an optional comment. The two bracket runs must agree (checked after the match).
const HEADER = new RegExp(String.raw`^(\[\[?)\s*(${DOTTED})\s*(\]\]?)\s*(?:#.*)?$`);
const ASSIGNMENT = new RegExp(String.raw`^(${DOTTED})\s*=`);
const KEY_TOKEN = new RegExp(KEY, "g");

function segmentsOf(dotted: string): readonly string[] {
  return (dotted.match(KEY_TOKEN) ?? []).map((token) => (token.startsWith('"') || token.startsWith("'") ? token.slice(1, -1) : token));
}

// True when `prefix` is the start of `whole` (equal paths included).
function startsWith(whole: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= whole.length && prefix.every((segment, index) => segment === whole[index]);
}

export function tomlTableState(outside: string, path: readonly string[]): "free" | "taken" | "unreadable" {
  if (outside.length > MAX_INPUT_CHARS) {
    return "unreadable";
  }
  let context: readonly string[] | null = null;
  for (const raw of outside.split("\n")) {
    const line = (raw.endsWith("\r") ? raw.slice(0, -1) : raw).trimStart();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[")) {
      const header = HEADER.exec(line);
      if (header === null || (header[1]?.length ?? 0) !== (header[3]?.length ?? 0)) {
        return "unreadable";
      }
      const segments = segmentsOf(header[2] ?? "");
      if (startsWith(segments, path)) {
        return "taken";
      }
      context = segments;
      continue;
    }
    const assignment = ASSIGNMENT.exec(line);
    if (assignment === null) {
      continue;
    }
    const keys = segmentsOf(assignment[1] ?? "");
    const full = context === null ? keys : [...context, ...keys];
    if (startsWith(path, full) || startsWith(full, path) || (context === null && keys[0] === path[0])) {
      return "taken";
    }
  }
  return "free";
}

type TomlTableLocation =
  | { readonly state: "absent" }
  // `start`: offset of the header line. `end`: offset just past the last key line of the table, its newline included when it has one.
  // `text`: the header and key lines, carriage returns removed, each followed by "\n".
  | { readonly state: "present"; readonly start: number; readonly end: number; readonly text: string }
  // The path is defined some other way: a second header, a header with a comment or an indent, a subtable, a dotted or inline definition.
  | { readonly state: "foreign" }
  | { readonly state: "unreadable" };

function stateLocation(state: ReturnType<typeof tomlTableState>): TomlTableLocation {
  return { state: state === "free" ? "absent" : state === "taken" ? "foreign" : "unreadable" };
}

// Where the one table `[path]`, written as that exact header on a line of its own, starts and ends. The table runs from its header to
// the line before the next line that starts with `[`; blank and comment lines at its tail belong to what follows and are not part of
// it. Every other definition of the path is "foreign" (see tomlTableState), so a located table is the only definition there is.
export function locateTomlTable(content: string, path: readonly string[]): TomlTableLocation {
  if (content.length > MAX_INPUT_CHARS) {
    return { state: "unreadable" };
  }
  const header = `[${path.join(".")}]`;
  let offset = 0;
  const lines = content.split("\n").map((raw, index, all) => {
    const line = { plain: raw.endsWith("\r") ? raw.slice(0, -1) : raw, start: offset, end: offset + raw.length + (index < all.length - 1 ? 1 : 0) };
    offset = line.end;
    return line;
  });
  const first = lines.findIndex((line) => line.plain === header);
  if (first < 0) {
    return stateLocation(tomlTableState(content, path));
  }
  let last = first;
  for (let index = first + 1; index < lines.length; index += 1) {
    const plain = lines[index]?.plain ?? "";
    const trimmed = plain.trimStart();
    if (trimmed.startsWith("[")) {
      break;
    }
    if (trimmed !== "" && !trimmed.startsWith("#")) {
      last = index;
    }
  }
  const start = lines[first]?.start ?? 0;
  const end = lines[last]?.end ?? content.length;
  const outside = tomlTableState(`${content.slice(0, start)}${content.slice(end)}`, path);
  if (outside !== "free") {
    return stateLocation(outside);
  }
  const text = `${lines
    .slice(first, last + 1)
    .map((line) => line.plain)
    .join("\n")}\n`;
  return { state: "present", start, end, text };
}
