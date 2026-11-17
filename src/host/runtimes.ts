// Declarative runtime table: the 18 GSD Core installer flags plus the Omp reference entry.
// Source: 21-DISCOVERY.md (GSD Core `next`, commit 69d604e, 2026-11-16). No gemini (retired), no
// vscode (registered upstream but not installable). Pure data and pure functions: no file system.

import { isAbsolute, join } from "node:path";
import { SchemaInvalidError } from "../contract/validate.js";
import {
  HOST_IDS,
  type HostEnv,
  type HostHomeSpec,
  type HostId,
  type HostRuntimeEntry,
  type HostTier,
  type IntegrationKind,
} from "./types.js";

interface EntryInit {
  readonly flag: string;
  readonly aliases?: readonly string[];
  readonly displayName: string;
  readonly tier: HostTier;
  readonly homes: readonly string[] | readonly HostHomeSpec[];
  readonly homeVerified?: boolean;
  readonly envOverride?: string;
  readonly binaries?: readonly string[];
}

function toHomes(homes: EntryInit["homes"]): readonly HostHomeSpec[] {
  return homes.map((home) => (typeof home === "string" ? { rel: home, role: "config" as const } : home));
}

function entry(id: HostId, init: EntryInit): HostRuntimeEntry {
  const integration: IntegrationKind = id === "omp" ? "extension" : "mcp-config";
  return Object.freeze({
    id,
    flag: init.flag,
    aliases: Object.freeze([...(init.aliases ?? [])]),
    displayName: init.displayName,
    tier: init.tier,
    integration,
    homes: Object.freeze(toHomes(init.homes).map((home) => Object.freeze({ ...home }))),
    homeVerified: init.homeVerified ?? true,
    envOverride: init.envOverride ?? null,
    binaries: Object.freeze([...(init.binaries ?? [])]),
    recipe: null,
  });
}

// Typed as a full Record over HostId, so a missing host fails compilation.
export const HOST_RUNTIMES: Readonly<Record<HostId, HostRuntimeEntry>> = Object.freeze({
  omp: entry("omp", { flag: "--omp", displayName: "Omp", tier: "reference", homes: [], homeVerified: false, binaries: ["omp"] }),
  claude: entry("claude", { flag: "--claude", displayName: "Claude Code", tier: "proven", homes: [".claude"], envOverride: "CLAUDE_CONFIG_DIR", binaries: ["claude"] }),
  opencode: entry("opencode", { flag: "--opencode", displayName: "OpenCode", tier: "proven", homes: [".config/opencode"] }),
  kilo: entry("kilo", { flag: "--kilo", displayName: "Kilo", tier: "config-only", homes: [".config/kilo", ".kilo"] }),
  codex: entry("codex", { flag: "--codex", displayName: "Codex", tier: "proven", homes: [".codex"] }),
  copilot: entry("copilot", { flag: "--copilot", displayName: "Copilot", tier: "config-only", homes: [".copilot"] }),
  antigravity: entry("antigravity", { flag: "--antigravity", displayName: "Antigravity", tier: "config-only", homes: [], homeVerified: false }),
  cursor: entry("cursor", { flag: "--cursor", displayName: "Cursor", tier: "config-only", homes: [".cursor"] }),
  windsurf: entry("windsurf", { flag: "--windsurf", aliases: ["devin-desktop"], displayName: "Windsurf", tier: "config-only", homes: [".codeium/windsurf"] }),
  augment: entry("augment", { flag: "--augment", displayName: "Augment", tier: "config-only", homes: [".augment"] }),
  trae: entry("trae", { flag: "--trae", displayName: "Trae", tier: "config-only", homes: [".trae"] }),
  qwen: entry("qwen", { flag: "--qwen", displayName: "Qwen", tier: "config-only", homes: [".qwen"] }),
  hermes: entry("hermes", { flag: "--hermes", displayName: "Hermes", tier: "config-only", homes: [".hermes"] }),
  codebuddy: entry("codebuddy", { flag: "--codebuddy", displayName: "CodeBuddy", tier: "config-only", homes: [".codebuddy"] }),
  cline: entry("cline", { flag: "--cline", displayName: "Cline", tier: "config-only", homes: [".cline"] }),
  kimi: entry("kimi", {
    flag: "--kimi",
    displayName: "Kimi CLI",
    tier: "proven",
    homes: [
      { rel: ".config/agents", role: "skills" },
      { rel: ".kimi", role: "config" },
    ],
  }),
  "kimi-code": entry("kimi-code", { flag: "--kimi-code", displayName: "Kimi Code", tier: "config-only", homes: [".kimi-code"] }),
  zcode: entry("zcode", { flag: "--zcode", displayName: "ZCode", tier: "config-only", homes: [".zcode"] }),
  pi: entry("pi", { flag: "--pi", displayName: "Pi", tier: "config-only", homes: [".pi/agent"] }),
});

// Alias -> id, derived from the table. Null prototype so a name like "__proto__" never matches.
function buildAliases(): Readonly<Record<string, HostId>> {
  const table = Object.create(null) as Record<string, HostId>;
  for (const id of HOST_IDS) {
    for (const alias of HOST_RUNTIMES[id].aliases) {
      table[alias] = id;
    }
  }
  return Object.freeze(table);
}
export const HOST_ALIASES: Readonly<Record<string, HostId>> = buildAliases();

// A bare id or alias only, case-sensitive. Flags (`--claude`) are an installer concern.
export function resolveHostId(name: string): HostId | undefined {
  if (Object.hasOwn(HOST_RUNTIMES, name)) {
    return name as HostId;
  }
  if (Object.hasOwn(HOST_ALIASES, name)) {
    return HOST_ALIASES[name];
  }
  return undefined;
}

// Phase 21 invariant: no recipe exists yet. Later phases change this deliberately.
export function recipePending(id: HostId): boolean {
  return HOST_RUNTIMES[id].recipe === null;
}

function refuse(): never {
  throw new SchemaInvalidError("host home base is not an absolute path");
}

// Pure: joins env.home with each candidate. An absolute env override (claude) replaces the default.
export function resolveHomes(entryValue: HostRuntimeEntry, env: HostEnv): readonly string[] {
  if (!isAbsolute(env.home)) {
    refuse();
  }
  if (entryValue.envOverride !== null) {
    const override = env.env[entryValue.envOverride];
    if (override !== undefined) {
      if (override === "" || !isAbsolute(override)) {
        refuse();
      }
      return [override];
    }
  }
  return entryValue.homes.map((home) => join(env.home, home.rel));
}
