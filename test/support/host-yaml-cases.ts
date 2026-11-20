// The shared table of YAML seeds for the `yaml-map` recipe (Phase 25, plan 25-02): the files the scanner must refuse as unreadable, the
// ones it must refuse as foreign, and the valid ones with the bytes an install must produce. The unit tests of the scanner and the
// planner and the real-row Hermes suite all read this one table, so a case added here is checked at every layer. Every seed is a string
// built from template literals; the recipe is `mcp_servers.realm = {command: realm, args: [mcp, --host, hermes]}`.

import { HERMES_REAL_SHAPED_FILE, HERMES_REAL_SHAPED_PARTS } from "./host-config-goldens.js";

export interface YamlCase {
  readonly name: string;
  readonly seed: string;
}

export interface YamlValidCase extends YamlCase {
  // What an install writes over the seed. Equal to the seed when the seed already holds an entry equal to the recipe's (no write).
  readonly expected: string;
  // The scan state of the seed: the entry is absent (`free`) or present.
  readonly scan: "free" | "present";
}

// The entry the recipe writes under a 2-space child indent, and under a 4-space one (body one step deeper, sequence items two).
export const ENTRY_2 = "  realm:\n    command: realm\n    args:\n      - mcp\n      - --host\n      - hermes\n";
export const ENTRY_4 = "    realm:\n        command: realm\n        args:\n            - mcp\n            - --host\n            - hermes\n";
export const BLOCK = `mcp_servers:\n${ENTRY_2}`;

export function crlf(text: string): string {
  return text.replaceAll("\n", "\r\n");
}

// Without the last line ending.
function unterminated(text: string): string {
  return text.endsWith("\r\n") ? text.slice(0, -2) : text.slice(0, -1);
}

export const YAML_UNPARSEABLE: readonly YamlCase[] = [
  { name: "a file over 1 MiB", seed: `${"#".repeat(1024 * 1024 + 1)}\n` },
  { name: "a NUL", seed: "a: 1\n\u0000\n" },
  { name: "a BOM", seed: "\uFEFFa: 1\n" },
  { name: "a Unicode line separator", seed: 'a: "x\u2028y"\n' },
  { name: "a tab-indented child", seed: "mcp_servers:\n\tother:\n\t\tcommand: x\n" },
  { name: "a flow root", seed: "{a: 1}\n" },
  { name: "a flow root sequence", seed: "[a, b]\n" },
  { name: "a leading document marker", seed: "---\na: 1\n" },
  { name: "a document end marker", seed: "a: 1\n...\n" },
  { name: "a %YAML directive", seed: "%YAML 1.2\n---\na: 1\n" },
  { name: "an anchor", seed: "base: &b {a: 1}\n" },
  { name: "an alias", seed: "base: 1\nx: *b\n" },
  { name: "a tag", seed: "x: !!str y\n" },
  { name: "a merge key", seed: "servers:\n  <<: {a: 1}\n" },
  { name: "a complex key", seed: "? mcp_servers\n: x\n" },
  { name: "mixed LF and CRLF line endings", seed: "a: 1\r\nb: 2\n" },
  { name: "a lone carriage return", seed: "a: 1\rb: 2\n" },
  { name: "an unclassifiable column-0 line", seed: "just some words\n" },
  { name: "a column-0 sequence item", seed: "- item\n" },
  { name: "a first line that is indented", seed: "  a: 1\n" },
  { name: "a quote that does not close on its line", seed: 'a: "never closed\nb: 2\n' },
  { name: "a child indent of 9", seed: "mcp_servers:\n         other:\n           command: x\n" },
  { name: "a child line that is not a key", seed: "mcp_servers:\n  other\n" },
  { name: "a child line less indented than the first child", seed: "mcp_servers:\n    a:\n      command: x\n  b:\n    command: y\n" },
  { name: "children below an empty flow mapping", seed: "mcp_servers: {}\n  a:\n    command: x\n" },
  { name: "an anchor-looking token inside a plain scalar", seed: "title: see *this* and &that\n" },
];

export const YAML_FOREIGN: readonly YamlCase[] = [
  { name: "two mcp_servers parents, one quoted", seed: 'mcp_servers:\n  a:\n    command: x\n"mcp_servers":\n  b:\n    command: y\n' },
  { name: "a flow mapping parent", seed: "mcp_servers: {a: 1}\n" },
  { name: "an empty flow sequence parent", seed: "mcp_servers: []\n" },
  { name: "a null parent", seed: "mcp_servers: ~\n" },
  { name: "a quoted scalar parent", seed: 'mcp_servers: "x"\n' },
  { name: "a block scalar parent", seed: "mcp_servers: |\n  text\n" },
  { name: "a sequence parent", seed: "mcp_servers:\n  - a\n" },
  { name: "two realm children", seed: "mcp_servers:\n  realm:\n    command: a\n  realm:\n    command: b\n" },
  { name: "a realm with another command", seed: "mcp_servers:\n  realm:\n    command: evil\n" },
  { name: "an inline realm mapping", seed: "mcp_servers:\n  realm: {command: evil}\n" },
  { name: "a realm with an extra args element", seed: "mcp_servers:\n  realm:\n    command: realm\n    args: [mcp, --host, hermes, extra]\n" },
  { name: "a realm with an extra key", seed: "mcp_servers:\n  realm:\n    command: realm\n    args: [mcp, --host, hermes]\n    enabled: true\n" },
  { name: "a quoted realm key with another value", seed: 'mcp_servers:\n  "realm":\n    command: other\n' },
  { name: "an empty realm", seed: "mcp_servers:\n  realm:\n" },
  { name: "a realm that is a scalar", seed: "mcp_servers:\n  realm: text\n" },
  { name: "a realm with a block scalar command", seed: "mcp_servers:\n  realm:\n    command: |\n      realm\n" },
  { name: "a realm with a nested mapping", seed: "mcp_servers:\n  realm:\n    command: realm\n    env:\n      A: b\n" },
];

const LAST_WORD = "  # last word\nz: 1\n";

export const YAML_VALID: readonly YamlValidCase[] = [
  { name: "an empty file", seed: "", expected: BLOCK, scan: "free" },
  { name: "a file with no trailing newline", seed: "a: 1", expected: `a: 1\n${unterminated(BLOCK)}`, scan: "free" },
  { name: "a file that ends with a blank line", seed: "a: 1\n\n", expected: `a: 1\n\n${BLOCK}`, scan: "free" },
  { name: "a file without mcp_servers", seed: "# header\na: 1\nb:\n  c: 2\n", expected: `# header\na: 1\nb:\n  c: 2\n${BLOCK}`, scan: "free" },
  {
    name: "a 4-space child indent",
    seed: "mcp_servers:\n    other:\n        command: x\n",
    expected: `mcp_servers:\n    other:\n        command: x\n${ENTRY_4}`,
    scan: "free",
  },
  {
    name: "CRLF line endings with a block",
    seed: crlf("a: 1\nmcp_servers:\n  other:\n    command: x\n"),
    expected: crlf(`a: 1\nmcp_servers:\n  other:\n    command: x\n${ENTRY_2}`),
    scan: "free",
  },
  { name: "CRLF line endings without a block", seed: crlf("a: 1\n"), expected: crlf(`a: 1\n${BLOCK}`), scan: "free" },
  {
    name: "CRLF line endings and no trailing newline",
    seed: "mcp_servers:\r\n  a:\r\n    command: x",
    expected: `mcp_servers:\r\n  a:\r\n    command: x\r\n${unterminated(crlf(ENTRY_2))}`,
    scan: "free",
  },
  { name: "mcp_servers: {}", seed: "a: 1\nmcp_servers: {}\nb: 2\n", expected: `a: 1\nmcp_servers:\n${ENTRY_2}b: 2\n`, scan: "free" },
  { name: "mcp_servers: {} with a trailing comment", seed: "mcp_servers: {}   # none\n", expected: `mcp_servers:   # none\n${ENTRY_2}`, scan: "free" },
  {
    name: "mcp_servers: with only comments below it",
    seed: "a: 1\nmcp_servers:\n  # nothing yet\nb: 2\n",
    expected: `a: 1\nmcp_servers:\n${ENTRY_2}  # nothing yet\nb: 2\n`,
    scan: "free",
  },
  { name: "mcp_servers: with nothing below it", seed: "a: 1\nmcp_servers:\nb: 2\n", expected: `a: 1\nmcp_servers:\n${ENTRY_2}b: 2\n`, scan: "free" },
  { name: "mcp_servers: as the last line, with a line ending", seed: "a: 1\nmcp_servers:\n", expected: `a: 1\nmcp_servers:\n${ENTRY_2}`, scan: "free" },
  { name: "mcp_servers: as the last line, without one", seed: "a: 1\nmcp_servers:", expected: `a: 1\nmcp_servers:\n${unterminated(ENTRY_2)}`, scan: "free" },
  {
    name: "a comment directly after the last child",
    seed: `mcp_servers:\n  other:\n    command: x\n${LAST_WORD}`,
    expected: `mcp_servers:\n  other:\n    command: x\n${ENTRY_2}${LAST_WORD}`,
    scan: "free",
  },
  {
    name: "blank lines and comments between children",
    seed: "mcp_servers:\n  a:\n    command: x\n\n  # about b\n  b:\n    command: y\n\nz: 1\n",
    expected: `mcp_servers:\n  a:\n    command: x\n\n  # about b\n  b:\n    command: y\n${ENTRY_2}\nz: 1\n`,
    scan: "free",
  },
  {
    name: "a sibling with a block scalar below its last line",
    seed: "mcp_servers:\n  a:\n    command: x\n    description: |\n      text *x\n\n  # c\n",
    expected: `mcp_servers:\n  a:\n    command: x\n    description: |\n      text *x\n${ENTRY_2}\n  # c\n`,
    scan: "free",
  },
  {
    name: "look-alike keys, anchors and tags inside a block scalar",
    seed: "note: |\n  *x &y !z\n  mcp_servers:\n    realm: nope\nb: 2\n",
    expected: `note: |\n  *x &y !z\n  mcp_servers:\n    realm: nope\nb: 2\n${BLOCK}`,
    scan: "free",
  },
  {
    name: "a single-quoted parent key",
    seed: "'mcp_servers':\n  other:\n    command: x\n",
    expected: `'mcp_servers':\n  other:\n    command: x\n${ENTRY_2}`,
    scan: "free",
  },
  { name: "a child named like realm", seed: "mcp_servers:\n  realm2:\n    command: x\n", expected: `mcp_servers:\n  realm2:\n    command: x\n${ENTRY_2}`, scan: "free" },
  { name: "mcp_servers nested below another key", seed: "outer:\n  mcp_servers:\n    realm: x\n", expected: `outer:\n  mcp_servers:\n    realm: x\n${BLOCK}`, scan: "free" },
  {
    name: "the shape of a real Hermes file",
    seed: HERMES_REAL_SHAPED_FILE,
    expected: `${HERMES_REAL_SHAPED_PARTS.head}${HERMES_REAL_SHAPED_PARTS.servers}${ENTRY_2}${HERMES_REAL_SHAPED_PARTS.tail}`,
    scan: "free",
  },
  {
    name: "the host's own re-quoted entry",
    seed: 'mcp_servers:\n  realm:\n    command: "realm"\n    args: ["mcp", "--host", "hermes"]\n',
    expected: 'mcp_servers:\n  realm:\n    command: "realm"\n    args: ["mcp", "--host", "hermes"]\n',
    scan: "present",
  },
  {
    name: "an entry in single quotes with a level sequence and comments",
    seed: "mcp_servers:\n  realm:   # ours\n    # about command\n    command: 'realm'\n\n    args:\n    - mcp\n    - '--host'\n    - hermes   # note\n",
    expected: "mcp_servers:\n  realm:   # ours\n    # about command\n    command: 'realm'\n\n    args:\n    - mcp\n    - '--host'\n    - hermes   # note\n",
    scan: "present",
  },
];
