// A conservative line scanner for the Codex-style owned TOML block (Phase 24). It answers one question about the text OUTSIDE
// the owned markers: does it already define the table the block is about to define, or an ancestor key of it? It is not a
// TOML parser and never claims to parse a file.
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
