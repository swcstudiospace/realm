// Host-neutral plugin contract types (Phase 21). Types and `as const` lists only: no logic.
//
// Every host adapter (Omp, the proven hosts, the config-only hosts) is written against these
// shapes. src/host never reads process.env; the CLI fills HostEnv at the edge.

import type { Policy, PolicyMode } from "../contract/validate.js";
import type { DaemonClient } from "../daemon/client.js";
import type { ErrorCode, RealmError } from "../core/errors.js";
import type { State } from "../core/states.js";
import type { EnvironmentLike } from "../session/paths.js";

// The 22 hosts: the Omp reference, the 18 GSD Core installer flags and the three Realm-only hosts of Phase 40 (muse-code, prime-agent, grok-build).
export const HOST_IDS = Object.freeze([
  "omp",
  "claude",
  "opencode",
  "kilo",
  "codex",
  "copilot",
  "antigravity",
  "cursor",
  "windsurf",
  "augment",
  "trae",
  "qwen",
  "hermes",
  "codebuddy",
  "cline",
  "kimi",
  "kimi-code",
  "zcode",
  "pi",
  "muse-code",
  "prime-agent",
  "grok-build",
] as const);
export type HostId = (typeof HOST_IDS)[number];

export type HostTier = "reference" | "proven" | "config-only";
export type IntegrationKind = "extension" | "mcp-config";

// Everything the host layer may know about the machine. Filled once at the CLI edge.
export interface HostEnv {
  readonly home: string;
  readonly env: EnvironmentLike;
  readonly pathDirs: readonly string[];
}

// A home is always a directory, relative to the user's home, POSIX separators.
export interface HostHomeSpec {
  readonly rel: string;
  // "mcp": the directory holding a host's user-level MCP file when that is not its config home. Never a detection home.
  readonly role: "config" | "skills" | "mcp";
}

// Declared here, implemented by the installer. `file` and `dest` are relative to the resolved
// home of role `homeRole` (default "config"); `source` is relative to the package adapters/ dir.
export type InstallRecipe =
  | {
      readonly kind: "json-merge";
      readonly file: string;
      readonly keyPath: readonly string[];
      readonly value: unknown;
      readonly homeRole?: HostHomeSpec["role"];
      // Top-level members written ahead of the entry only when the install creates the file; an existing file never receives them.
      readonly seed?: Readonly<Record<string, unknown>>;
      // Top-level keys whose presence in the document refuses an install or reinstall (the host reads a rival spelling of the entry).
      readonly refuseIfPresent?: readonly string[];
    }
  | {
      readonly kind: "text-block";
      readonly file: string;
      readonly block: string;
      readonly homeRole?: HostHomeSpec["role"];
    }
  | {
      readonly kind: "toml-table";
      readonly file: string;
      // The table Realm owns, as 1 to 6 bare keys. It is located by its exact header line; there are no markers.
      readonly table: readonly string[];
      // The owned text: the header line and its key lines joined with "\n", no comment, no blank line, no trailing newline.
      readonly text: string;
      readonly homeRole?: HostHomeSpec["role"];
    }
  | {
      readonly kind: "yaml-map";
      readonly file: string;
      // The one entry Realm owns, `path[0].path[1]` of a block-style YAML file: a parent key and a child key, owned by key and by parsed value.
      readonly path: readonly [string, string];
      // A flat mapping of plain-scalar strings and arrays of them (`command`, `args`).
      readonly value: { readonly [key: string]: string | readonly string[] };
      readonly homeRole?: HostHomeSpec["role"];
    }
  | { readonly kind: "bundle-copy"; readonly source: string; readonly dest: string; readonly homeRole?: HostHomeSpec["role"] };

// A path whose presence means a new recipe file would hide older host content: below the user's home ("home") or below the
// resolved install home ("config").
export interface HostShadow {
  readonly rel: string;
  readonly base: "home" | "config";
}

export interface HostRuntimeEntry {
  readonly id: HostId;
  readonly flag: string;
  readonly aliases: readonly string[];
  readonly displayName: string;
  readonly tier: HostTier;
  readonly integration: IntegrationKind;
  readonly homes: readonly HostHomeSpec[];
  readonly homeVerified: boolean;
  readonly envOverride: string | null;
  // The variable names a base directory and the home is `<base>/<sub>` (OpenCode: XDG_CONFIG_HOME + "opencode"). An entry has at
  // most one of envOverride and envBase. `sub` is one safe path segment.
  readonly envBase?: { readonly name: string; readonly sub: string };
  readonly binaries: readonly string[];
  readonly recipe: InstallRecipe | null;
  // Paths relative to the user home (POSIX separators, no `..`) whose presence means the host already loads
  // Realm another way, so an install would load it twice. Optional so fixture entries in tests still compile.
  readonly conflicts?: readonly string[];
  // Files that an older host version still reads and that a NEW recipe file would hide (CodeBuddy: a new .mcp.json hides mcp.json).
  // An install that would create the recipe file while one of these exists is refused. Optional so fixture entries still compile.
  readonly shadows?: readonly HostShadow[];
}

// ---- Manifest ---------------------------------------------------------------

export type HostCapability =
  | "daemon.attach"
  | "fs.read"
  | "fs.write"
  | "fs.list"
  | "exec.argv"
  | "exec.shell"
  | "net.egress"
  | "credential.read"
  | "host.tools.restrict";

export interface HostCapabilityRequest {
  readonly capability: HostCapability;
  readonly scope?: string;
}

// Boot bounds for `extension` hosts. Every field is optional: defaults are applied by the boot hook.
export interface BootBounds {
  readonly startupBudgetMs?: number;
  readonly reattach?: {
    readonly enabled?: boolean;
    readonly retryCap?: number;
    readonly baseDelayMs?: number;
    readonly capDelayMs?: number;
  };
}

export interface HostLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

export interface HostPluginManifest {
  readonly schemaVersion: 1;
  readonly hostId: HostId;
  readonly integration: IntegrationKind;
  readonly pluginName: "realm";
  readonly pluginVersion: string;
  readonly launch?: HostLaunch;
  readonly entry?: string;
  readonly capabilities: readonly HostCapabilityRequest[];
  readonly boot?: BootBounds;
}

// ---- Adapter and boot-hook port -----------------------------------------------

export type HostStatus = "not-detected" | "detected" | "recipe-pending" | "installed" | "drifted";

export interface HostDetection {
  readonly id: HostId;
  readonly detected: boolean;
  readonly via: "binary" | "home" | "none";
}

export interface HostOperationOptions {
  readonly dryRun: boolean;
  readonly configHome?: string;
}

export interface HostOperationResult {
  readonly id: HostId;
  readonly status: HostStatus;
  readonly changed: boolean;
  readonly dryRun: boolean;
  readonly detail: string;
}

export interface HostLinkStatus {
  readonly state: State;
  readonly mode: PolicyMode | null;
  readonly link: "off" | "linked" | "reconnecting" | "attaching" | "failed";
  readonly code?: ErrorCode;
}

export interface HostGuardVerdict {
  readonly block: true;
  readonly reason: string;
}

export interface HostTimers {
  setTimeout(cb: () => void, ms: number): unknown;
  setInterval(cb: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

// The two-method subset of OmpStatusUi in src/omp/plugin.ts.
export interface HostStatusSink {
  setStatus(key: string, text: string): void;
  notify(message: string): void;
}

// One step of a host boot, reported to HostBootDeps.observe. The six phases are the same vocabulary as HOST_BOOT_PHASES in
// src/host/boot-report.ts. attempt is 1-based within the current attach streak (1 to 9) and durationMs is a non-negative
// integer number of milliseconds (at most 600000), so each event is a valid boot report field. No event carries a path or text.
export interface HostBootEvent {
  readonly phase: "attached" | "refused" | "failed" | "link-lost" | "reattached" | "closed";
  readonly code?: ErrorCode;
  readonly attempt: number;
  readonly durationMs: number;
  readonly state: State | null;
}

export interface HostBootDeps {
  attachDaemon(workspaceRoot: string): Promise<{ client: DaemonClient; refusal: RealmError | null }>;
  now(): Date;
  readonly random: () => number;
  timers: HostTimers;
  sink: HostStatusSink;
  // Optional observer of boot events. A hook calls it inside a try: a throwing observer changes nothing.
  readonly observe?: (event: HostBootEvent) => void;
}

export interface HostBootHook {
  start(workspaceRoot: string): Promise<void>;
  switchWorkspace(workspaceRoot: string): Promise<void>;
  status(): HostLinkStatus;
  guard(toolName: unknown): Promise<HostGuardVerdict | undefined>;
  retry(): Promise<void>;
  shutdown(): Promise<void>;
}

export type HostBootHookFactory = (deps: HostBootDeps, manifest: HostPluginManifest) => HostBootHook;

export interface HostAdapter {
  readonly id: HostId;
  readonly tier: HostTier;
  detect(env: HostEnv): Promise<HostDetection>;
  install(env: HostEnv, options: HostOperationOptions): Promise<HostOperationResult>;
  uninstall(env: HostEnv, options: HostOperationOptions): Promise<HostOperationResult>;
  status(env: HostEnv): Promise<HostOperationResult>;
  readonly bootHook: HostBootHookFactory | null;
}

// Re-exported so adapters name the policy type through this module.
export type { Policy };
