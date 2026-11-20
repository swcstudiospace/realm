// The support matrix of Phase 26 (TEST-HOST-07, D-26-08): one markdown block, derived from the runtime table, the evidence registry and
// the live specs, and nothing else. docs/integration/host-support-matrix.md holds the block between two HTML comment markers;
// test/docs/host-support-matrix.test.ts renders it again and compares byte for byte, so the page is a view of those three sources and
// cannot drift from them. The renderer is pure over its three arguments: the test passes the real values, a seeded test passes injected ones.
//
// It states only facts its inputs hold. A T2 or T3 cell without a dated result in the registry reads "not run" (GAP-26-02), and the
// matrices of Phase 26 prove fixtures and fakes, never a real host (GAP-26-01). A source string that cannot be written safely into a
// markdown cell (an angle bracket, a line break, a backtick inside a code span) throws instead of being repaired, so a bad registry value
// fails loudly in the test rather than breaking the published page.

import { HOST_IDS, type HostId, type HostRuntimeEntry } from "../../src/host/types.js";
import type { HostLiveSpec, LiveHostId } from "./host-live.js";
import type { RegistryRecord } from "./host-registry.js";

export const MATRIX_BEGIN = "<!-- host-support-matrix:begin -->";
export const MATRIX_END = "<!-- host-support-matrix:end -->";

// A cell is one line of text with no angle bracket. A pipe is escaped, so it cannot end the cell.
function cell(text: string, where: string): string {
  if (text.includes("<") || text.includes(">")) {
    throw new Error(`host support matrix: ${where} holds an angle bracket`);
  }
  if (text.includes("\n") || text.includes("\r")) {
    throw new Error(`host support matrix: ${where} holds a line break`);
  }
  return text.replaceAll("|", "\\|");
}

function code(text: string, where: string): string {
  if (text.includes("`")) {
    throw new Error(`host support matrix: ${where} holds a backtick`);
  }
  return `\`${text}\``;
}

// A home is relative to the user's home: the dot home is the home itself.
function homePath(rel: string): string {
  return rel === "." ? "~" : `~/${rel}`;
}

function idCell(id: HostId, entry: HostRuntimeEntry): string {
  const aliases = entry.aliases.map((alias) => code(alias, `${id} alias`));
  return aliases.length === 0 ? code(id, `${id} id`) : `${code(id, `${id} id`)} (${aliases.join(", ")})`;
}

function configHomeCell(id: HostId, entry: HostRuntimeEntry): string {
  const homes = entry.homes.map((home) =>
    home.role === "skills" ? `skills ${code(homePath(home.rel), `${id} home`)} (detection only)` : code(homePath(home.rel), `${id} home`),
  );
  const parts = [homes.join(", ")];
  if (entry.envOverride !== null) {
    parts.push(`override ${code(entry.envOverride, `${id} override`)}`);
  }
  if (entry.envBase !== undefined) {
    parts.push(`base ${code(`${entry.envBase.name}/${entry.envBase.sub}`, `${id} base`)}`);
  }
  return parts.join("; ");
}

function fileCell(id: HostId, entry: HostRuntimeEntry): string {
  if (entry.recipe === null) {
    return "-";
  }
  return code(entry.recipe.kind === "bundle-copy" ? entry.recipe.dest : entry.recipe.file, `${id} file`);
}

function tableRow(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function supportRow(id: HostId, entry: HostRuntimeEntry, record: RegistryRecord): string {
  const binaries = entry.binaries.length === 0 ? "-" : entry.binaries.map((binary) => code(binary, `${id} binary`)).join(", ");
  return tableRow([
    cell(idCell(id, entry), `${id} id`),
    cell(entry.displayName, `${id} display name`),
    cell(entry.tier, `${id} tier`),
    cell(entry.integration, `${id} integration`),
    cell(entry.recipe === null ? "pending (deferred)" : entry.recipe.kind, `${id} recipe`),
    cell(configHomeCell(id, entry), `${id} config home`),
    cell(fileCell(id, entry), `${id} file`),
    cell(binaries, `${id} binaries`),
    cell(`[${record.snippet}](../hosts/snippets/${record.snippet})`, `${id} snippet`),
  ]);
}

function evidenceRow(id: HostId, record: RegistryRecord, live: Readonly<Partial<Record<LiveHostId, HostLiveSpec>>>): string {
  const spec = record.live === null ? undefined : live[record.live];
  const gate = spec === undefined ? "none" : `${code(`${spec.optIn}=1`, `${id} gate`)}${spec.minVersion === null ? "" : `, floor ${spec.minVersion}`}`;
  const suites = record.suites.length === 0 ? "-" : record.suites.map((suite) => code(suite, `${id} suite`)).join(", ");
  const t2 = record.t2 === null ? "not run" : `${record.t2.date}, ${record.t2.version}: ${record.t2.result}`;
  const deferral = record.deferral === null ? "-" : `${record.deferral.reason} (${record.deferral.openQuestion})`;
  return tableRow([
    cell(code(id, `${id} id`), `${id} id`),
    cell(suites, `${id} suites`),
    cell(gate, `${id} gate`),
    cell(t2, `${id} T2 result`),
    cell(`${record.t3.status}: ${record.t3.note}`, `${id} T3`),
    cell(deferral, `${id} deferral`),
  ]);
}

// The text between the markers: two tables in HOST_IDS order, LF only, ending in one newline.
export function renderHostSupportMatrix(
  table: Readonly<Record<HostId, HostRuntimeEntry>>,
  registry: Readonly<Record<HostId, RegistryRecord>>,
  live: Readonly<Partial<Record<LiveHostId, HostLiveSpec>>>,
): string {
  const lines: string[] = [
    "### Support",
    "",
    tableRow(["Id", "Name", "Tier", "Integration", "Recipe", "Config home", "File", "Binaries", "Snippet"]),
    tableRow(["---", "---", "---", "---", "---", "---", "---", "---", "---"]),
  ];
  for (const id of HOST_IDS) {
    lines.push(supportRow(id, table[id], registry[id]));
  }
  lines.push(
    "",
    "### Evidence",
    "",
    tableRow(["Id", "T1 fixture suites", "T2 gate", "T2 recorded result", "T3", "Deferral"]),
    tableRow(["---", "---", "---", "---", "---", "---"]),
  );
  for (const id of HOST_IDS) {
    lines.push(evidenceRow(id, registry[id], live));
  }
  return `${lines.join("\n")}\n`;
}
