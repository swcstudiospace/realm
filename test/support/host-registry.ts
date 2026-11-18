// The registry of Phase 26 (TEST-HOST-02): for every host id exactly one record of the evidence facts no code can derive. Everything the
// table knows (home, file, override, binaries, tier, flag, recipe value) is NOT a field here: tests and the support matrix read those from
// HOST_RUNTIMES. What is left is which test files run a host's recipe suite, which snippet documents it, which live spec it has, the dated
// results a person recorded for the gated tiers (T2 and T3), and the reason of an owner-approved deferral. A host that is added without
// its record fails compilation (the type is a full record over HostId); a record that disagrees with the table or points at a missing
// file fails test/host/host-registry.test.ts, which lists every problem at once.
//
// Nothing here is derived, so nothing here may overclaim: a T2 or T3 value is a dated fact with a comment naming its source, and a cell with
// no dated result says "not run" (GAP-26-02). This module sets no gate variable and starts no process.

import type { HostId, InstallRecipe } from "../../src/host/types.js";
import type { LiveHostId } from "./host-live.js";

export type RegistryFamily = InstallRecipe["kind"] | "none";

// A dated host-validator result, hand-entered from the contract page (docs/integration/host-plugin-contract.md, "Evidence tiers").
export interface RegistryT2 {
  readonly date: string;
  readonly version: string;
  readonly result: string;
  readonly command: string;
}

// none-defined: a config-only host has no production tier (OQ-25-09). not-run: no dated result. gap: the tier cannot be run at all.
// rehearsed: a dated live rehearsal exists (the note names it).
export type RegistryT3Status = "none-defined" | "not-run" | "gap" | "rehearsed";

export interface RegistryT3 {
  readonly status: RegistryT3Status;
  readonly note: string;
}

export interface RegistryDeferral {
  readonly reason: string;
  readonly openQuestion: string;
}

export interface RegistryRecord {
  readonly id: HostId;
  // The recipe kind of the table row, or "none" for a deferred host. The completeness test compares it with HOST_RUNTIMES.
  readonly family: RegistryFamily;
  // Repository-relative paths of the test files that run the host's recipe suite. Empty for a deferred host.
  readonly suites: readonly string[];
  // The page under docs/hosts/snippets that documents the host (the three deferred hosts share deferred-hosts.md).
  readonly snippet: string;
  // The host's key in HOST_LIVE, or null when it has no live spec (Omp has its own helpers, test/support/omp-live.ts).
  readonly live: LiveHostId | null;
  readonly t2: RegistryT2 | null;
  readonly t3: RegistryT3;
  readonly deferral: RegistryDeferral | null;
}

function record(init: RegistryRecord): RegistryRecord {
  return Object.freeze({
    ...init,
    suites: Object.freeze([...init.suites]),
    t2: init.t2 === null ? null : Object.freeze({ ...init.t2 }),
    t3: Object.freeze({ ...init.t3 }),
    deferral: init.deferral === null ? null : Object.freeze({ ...init.deferral }),
  });
}

const WAVE2_SUITE = "test/host/wave2-json-recipes.test.ts";

// 25-CONTEXT OQ-25-09 and docs/integration/host-plugin-contract.md ("no wave 2 host has a production tier").
const WAVE2_T3: RegistryT3 = { status: "none-defined", note: "config-only host: no production tier is defined (OQ-25-09)" };

// The three deferrals were approved by the owner on 2026-11-17 (docs/hosts/snippets/deferred-hosts.md); each lift condition lives there.
const DEFERRED_T3: RegistryT3 = { status: "gap", note: "deferred host: no recipe exists, so no tier can run" };

export const HOST_REGISTRY: Readonly<Record<HostId, RegistryRecord>> = Object.freeze({
  // Source: 22-VERIFICATION (live rehearsal, 2026-11-17, Omp 18.22.0, production stack) and GAP-23-04 (the rehearsal predates the Phase 23 boot path).
  omp: record({
    id: "omp",
    family: "bundle-copy",
    suites: ["test/host/omp-recipe.test.ts"],
    snippet: "omp.md",
    live: null,
    t2: null,
    t3: { status: "rehearsed", note: "Omp 18.22.0, Phase 22 live rehearsal 2026-11-17; predates the Phase 23 boot path (GAP-23-04)" },
    deferral: null,
  }),
  // Source: contract page, "Evidence tiers" (Phase 24 table): T2 ran live 2026-11-17, Claude Code 2.1.322, 3 of 3 passed, run twice. T3: the production tier exists and
  // records the wire (Phase 31); no dated result yet, and plan 31-02 (a human-owned window on the realmlive account) writes it.
  claude: record({
    id: "claude",
    family: "json-merge",
    suites: ["test/host/claude-recipe.test.ts"],
    snippet: "claude-code.md",
    live: "claude",
    t2: { date: "2026-11-17", version: "2.1.322", result: "3 of 3 passed, run twice", command: "claude mcp get, claude mcp list" },
    t3: { status: "rehearsed", note: "Claude Code 2.1.322, 2026-11-18, production stack (realmlive account, Podman 5.7.1), cold attach with no warm-up and a new project directory (GAP-31-04, GAP-23-02 closed): claude mcp list connected and returned after 2438 ms against the 25000 ms bound, the wire shows server/discover then tools/list and the six Realm tools, the host left before the realm was ready by design, clean before and after (0 containers, 0 sandboxes, empty workspace); the direct cold attach probe passed on the same stack (handshake answered while realm status was not active, calls in the window refused REALM_NOT_ACTIVE with retryable true, the same process served a call after ready); the validator tier passed 3 of 3 the same day; evidence kept outside the repository" },
    deferral: null,
  }),
  // Source: contract page, Phase 24 table: T2 ran live 2026-11-18 with a scratch install of 1.19.5 (3 of 3 passed). T3: the production tier ran live 2026-11-18 (Phase 31 window 7).
  opencode: record({
    id: "opencode",
    family: "json-merge",
    suites: ["test/host/opencode-recipe.test.ts"],
    snippet: "opencode.md",
    live: "opencode",
    t2: { date: "2026-11-18", version: "1.19.5", result: "3 of 3 passed (scratch install outside the repository, owner approved)", command: "opencode mcp list" },
    t3: { status: "rehearsed", note: "opencode 1.19.5, 2026-11-18, production stack (realmlive account, Podman 5.7.1), cold attach with no warm-up and a new project directory (GAP-31-04, GAP-23-02 closed): opencode mcp list reported realm connected and returned after 2155 ms against the 25000 ms bound, the wire shows initialize, notifications/initialized and tools/list and the six Realm tools, the host left before the realm was ready by design, clean before and after (0 containers, 0 sandboxes, empty workspace); the validator tier passed 3 of 3 the same day; evidence kept outside the repository" },
    deferral: null,
  }),
  // Source: contract page, Phase 25 table (T2: kilo mcp list, no result recorded) and OQ-25-09.
  kilo: record({ id: "kilo", family: "json-merge", suites: [WAVE2_SUITE], snippet: "kilo.md", live: "kilo", t2: null, t3: WAVE2_T3, deferral: null }),
  // Source: contract page, Phase 24 table: T2 ran live 2026-11-17, codex-cli 0.154.0, 5 passed, 0 failed, 2 skipped (production tiers), after the
  // header-owned recipe merged; get and list parse only. T3: the Phase 31 session tier (codex exec against a refusing loopback provider) passed on the production stack on 2026-11-18, after the exit-race fix.
  codex: record({
    id: "codex",
    family: "toml-table",
    suites: ["test/host/codex-recipe.test.ts"],
    snippet: "codex.md",
    live: "codex",
    t2: {
      date: "2026-11-17",
      version: "0.154.0",
      result: "5 passed, 0 failed, 2 skipped (production tiers), after the header-owned recipe",
      command: "codex mcp get, codex mcp list (parse only)",
    },
    t3: { status: "rehearsed", note: "codex-cli 0.154.0, 2026-11-18, production stack (realmlive account, Podman 5.7.1), cold attach with no warm-up and a new project directory (GAP-31-04, GAP-23-02 closed): the production tier passed, the codex exec host command ended after 896 ms (the session drive; the connect bound is 25000 ms), launched realm mcp --host codex against a refusing loopback provider and showed initialize, notifications/initialized and tools/list and the six Realm tools on the wire, the host left before the realm was ready by design, clean before and after, no model turn and no tool call; the validator tier (2) and the validator session tests (2) passed the same day; the validator session result of 2026-11-17 (2 of 2) stands; evidence kept outside the repository" },
    deferral: null,
  }),
  // Source: contract page, Phase 25 table (T2: copilot mcp get realm and list, parse only, no result recorded) and OQ-25-09.
  copilot: record({ id: "copilot", family: "json-merge", suites: [WAVE2_SUITE], snippet: "copilot.md", live: "copilot", t2: null, t3: WAVE2_T3, deferral: null }),
  // Source: contract page, Phase 25 table: documented-only (`agy` never run), no gated tier; HOST_LIVE has no entry for it (ANTIGRAVITY_GAP).
  antigravity: record({
    id: "antigravity",
    family: "json-merge",
    suites: [WAVE2_SUITE],
    snippet: "antigravity.md",
    live: null,
    t2: null,
    t3: WAVE2_T3,
    deferral: null,
  }),
  // Source: contract page, Phase 25 table (T2: agent mcp list, no result recorded) and OQ-25-09.
  cursor: record({ id: "cursor", family: "json-merge", suites: [WAVE2_SUITE], snippet: "cursor.md", live: "cursor", t2: null, t3: WAVE2_T3, deferral: null }),
  // Deferred, owner-approved 2026-11-17 (25-CONTEXT D-25-02, OQ-25-01): deferred-hosts.md, "windsurf (renamed Devin Desktop)".
  windsurf: record({
    id: "windsurf",
    family: "none",
    suites: [],
    snippet: "deferred-hosts.md",
    live: null,
    t2: null,
    t3: DEFERRED_T3,
    deferral: { reason: "the product was renamed and two different MCP files now exist, so the recipe target is ambiguous and the IDE was not observed", openQuestion: "OQ-25-01" },
  }),
  // Source: contract page, Phase 25 table (T2: auggie mcp list, parse only, no result recorded) and OQ-25-09.
  augment: record({ id: "augment", family: "json-merge", suites: [WAVE2_SUITE], snippet: "augment.md", live: "augment", t2: null, t3: WAVE2_T3, deferral: null }),
  // Deferred, owner-approved 2026-11-17 (25-CONTEXT D-25-02, OQ-25-02): deferred-hosts.md, "trae".
  trae: record({
    id: "trae",
    family: "none",
    suites: [],
    snippet: "deferred-hosts.md",
    live: null,
    t2: null,
    t3: DEFERRED_T3,
    deferral: { reason: "no documented global MCP file exists for the IDE", openQuestion: "OQ-25-02" },
  }),
  // Source: contract page, Phase 25 table: qwen mcp list ran live 2026-11-17 through the gated wave 2 validator tier (REALM_LIVE_QWEN=1): PASS, Qwen Code
  // 0.22.0 only (evidence kept outside the repository).
  qwen: record({
    id: "qwen",
    family: "json-merge",
    suites: [WAVE2_SUITE],
    snippet: "qwen.md",
    live: "qwen",
    t2: {
      date: "2026-11-17",
      version: "0.22.0",
      result: "PASS; covers 0.22.0 only",
      command: "qwen mcp list (launches), gated wave 2 validator tier, REALM_LIVE_QWEN=1",
    },
    t3: WAVE2_T3,
    deferral: null,
  }),
  // Source: contract page, Phase 25 table: hermes mcp list and hermes mcp test realm; passed 2026-11-18 (Phase 36) after the gate bootstraps a fresh data root (a fresh root fails --version until bootstrapped).
  hermes: record({
    id: "hermes",
    family: "yaml-map",
    suites: ["test/host/hermes-recipe.test.ts"],
    snippet: "hermes-agent.md",
    live: "hermes",
    t2: {
      date: "2026-11-18",
      version: "0.23.1",
      result: "PASS; covers 0.23.1 only",
      command: "hermes mcp list, hermes mcp test realm (launches), gated wave 2 validator tier, REALM_LIVE_HERMES=1",
    },
    t3: WAVE2_T3,
    deferral: null,
  }),
  // Source: contract page, Phase 25 table (T2: codebuddy mcp list, no result recorded) and OQ-25-09. shadows.test.ts covers the shadow guard on fixture rows.
  codebuddy: record({
    id: "codebuddy",
    family: "json-merge",
    suites: ["test/host/codebuddy-recipe.test.ts", "test/host/shadows.test.ts"],
    snippet: "codebuddy.md",
    live: "codebuddy",
    t2: null,
    t3: WAVE2_T3,
    deferral: null,
  }),
  // Source: contract page, Phase 25 table (T2: cline config mcp --json, parse only, no result recorded) and OQ-25-09.
  cline: record({ id: "cline", family: "json-merge", suites: [WAVE2_SUITE], snippet: "cline.md", live: "cline", t2: null, t3: WAVE2_T3, deferral: null }),
  // Source: contract page, Phase 24 table: T2 not run (no kimi executable, the only published release is an inert stub); T3 gap (the Python CLI is archived; 31-CONTEXT E-31-9).
  kimi: record({
    id: "kimi",
    family: "json-merge",
    suites: ["test/host/kimi-recipe.test.ts"],
    snippet: "kimi.md",
    live: "kimi",
    t2: null,
    t3: { status: "gap", note: "the Python Kimi CLI is archived, its last release is a deprecation stub" },
    deferral: null,
  }),
  // Source: contract page, Phase 24 table: T2 not available (no validator command is documented); T3 gap (not run, none attempted).
  "kimi-code": record({
    id: "kimi-code",
    family: "json-merge",
    suites: ["test/host/kimi-recipe.test.ts"],
    snippet: "kimi.md",
    live: "kimi-code",
    t2: null,
    t3: { status: "gap", note: "functional product, not installed here, no MCP validator command documented (31-CONTEXT E-31-9)" },
    deferral: null,
  }),
  // Deferred, owner-approved 2026-11-17 (25-CONTEXT D-25-02, OQ-25-03): deferred-hosts.md, "zcode".
  zcode: record({
    id: "zcode",
    family: "none",
    suites: [],
    snippet: "deferred-hosts.md",
    live: null,
    t2: null,
    t3: DEFERRED_T3,
    deferral: { reason: "the native config is owned by a GUI application and cannot be observed", openQuestion: "OQ-25-03" },
  }),
  // Source: contract page, Phase 25 table (T2: pi mcp list, launches, skips below pi 1.3.0, no result recorded) and OQ-25-09.
  pi: record({ id: "pi", family: "json-merge", suites: [WAVE2_SUITE], snippet: "pi.md", live: "pi", t2: null, t3: WAVE2_T3, deferral: null }),
});

// The source text without block comments and without full-line double-slash comments, so a source check never matches a comment (a lesson of
// Phase 24: a grep over raw source found a define call inside a comment). A trailing comment on a code line stays.
export function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}
