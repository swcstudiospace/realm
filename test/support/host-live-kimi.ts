// The Kimi pieces the shared live harness does not have (phase 43; 43-CONTEXT E-43-08, E-43-09, D-43-04 to D-43-07).
//
// Two products share the command name `kimi`: the legacy Python CLI (1.x, kimi-cli) and Kimi Code (2.x, @moonshot-ai/kimi-code). Kimi Code
// needs a key variable to define a provider at all, and it forwards its whole environment to a stdio server; the legacy CLI forwards only
// HOME and PATH. This module holds what the two live files need on top of host-live.ts and host-live-session.ts:
//   KIMI_REHEARSAL_KEY, KIMI_REHEARSAL_MODEL         the one fixed non-secret key and the model alias of a Kimi Code session drive
//   kimiCodeSessionArgs, kimiCodeDriveEnv            the Kimi Code argument list and the variables its session needs
//   kimiContainmentEnv                               the validator-tier containment: no update check, no telemetry, a dead proxy
//   KIMI_RESTORED_ENV                                the names the legacy command drive gives back to the realm server
//   credentialNamesOf                                the names in an environment that look like a credential, for the hermetic proof
//   parseKimiRestore, restoreLabel, isDiagnosticVariant, variantLabel, kimiProductionPlan, kimiProductionDrive, kimiEvidenceSettings
//                                                    the switches of the legacy production test (phase 47): which names the recorder gives
//                                                    back, the warm control, the evidence directory; the default is the Phase 43 drive
//   digest12, classifyExpansion, describeMcpJsonShape  the pure parts of the two validator probes (expansion and writer)
//
// Nothing here reads the process environment or starts a process at import time. The hermetic test is
// test/integration/host-live-kimi-helpers.test.ts.

import { createHash } from "node:crypto";
import type { HostCommandDrive } from "./host-live.js";
import type { RunEvidenceSettings } from "./host-live-evidence.js";
import { CODEX_FORWARDED_ENV, SESSION_PROMPT } from "./host-live-session.js";

// The one fixed literal a Kimi Code session drive uses as KIMI_MODEL_API_KEY. It is NOT a credential: it is a throwaway placeholder that
// opens no account, and it is never replaced by an operator value. The refusing loopback provider is the only endpoint it is ever sent to.
export const KIMI_REHEARSAL_KEY = "rehearsal-key-not-a-secret";

// The model alias of a Kimi Code session drive. No model by that name exists; the provider refuses every request.
export const KIMI_REHEARSAL_MODEL = "rehearsal-model";

// The argument list of Kimi Code for one non-interactive session: the single option `-p` and the fixed prompt. No other flag.
export function kimiCodeSessionArgs(): string[] {
  return ["-p", SESSION_PROMPT];
}

// The switches that stop Kimi Code from checking for updates and from sending telemetry.
const SWITCHES: Readonly<Record<string, string>> = Object.freeze({
  KIMI_DISABLE_TELEMETRY: "1",
  KIMI_CODE_NO_AUTO_UPDATE: "1",
  KIMI_CLI_NO_AUTO_UPDATE: "1",
});

// The variables a Kimi Code session needs on top of the isolated or production environment: a model name, the fixed key, the loopback
// provider as the base URL and an OpenAI-compatible provider type, plus the update and telemetry switches. It never sets KIMI_CODE_HOME
// (the rig or the runner owns that). `baseUrl` must be a loopback URL of the refusing provider.
export function kimiCodeDriveEnv(baseUrl: string): Readonly<Record<string, string>> {
  if (!baseUrl.startsWith("http://127.0.0.1:")) {
    throw new Error("the Kimi Code drive may only point at the loopback refusing provider (http://127.0.0.1:PORT/...)");
  }
  return Object.freeze({
    KIMI_MODEL_NAME: KIMI_REHEARSAL_MODEL,
    KIMI_MODEL_API_KEY: KIMI_REHEARSAL_KEY,
    KIMI_MODEL_BASE_URL: baseUrl,
    KIMI_MODEL_PROVIDER_TYPE: "openai",
    ...SWITCHES,
  });
}

// A loopback port nothing listens on: a connection through it is refused at once.
const DEAD_PROXY = "http://127.0.0.1:9";
const NO_PROXY = "127.0.0.1,localhost,::1";

// The containment of a validator-tier Kimi command (D-43-07): the update and telemetry switches and a proxy that goes nowhere, so a Kimi
// binary that contacts a Moonshot endpoint despite the switches is refused instead of connecting. Loopback stays direct (NO_PROXY), so
// the refusing provider is still reached. The production tiers do not use it: the production stack needs the network its sandbox uses.
export function kimiContainmentEnv(): Readonly<Record<string, string>> {
  return Object.freeze({
    ...SWITCHES,
    HTTP_PROXY: DEAD_PROXY,
    HTTPS_PROXY: DEAD_PROXY,
    ALL_PROXY: DEAD_PROXY,
    http_proxy: DEAD_PROXY,
    https_proxy: DEAD_PROXY,
    all_proxy: DEAD_PROXY,
    NO_PROXY,
    no_proxy: NO_PROXY,
  });
}

// The names the legacy command drive restores: the same set as CODEX_FORWARDED_ENV (the daemon needs them to find the account's runtime
// directory and the compute driver), but for a different reason. Codex forwards them on request; the legacy Kimi CLI forwards HOME and
// PATH only (43-CONTEXT E-43-09), so the recorder gives them back to `realm mcp`.
export const KIMI_RESTORED_ENV: readonly string[] = CODEX_FORWARDED_ENV;

// The sorted names in `env` that look like a credential: a KIMI_ or MOONSHOT_ variable, or one that ends in _API_KEY or _TOKEN.
export function credentialNamesOf(env: Readonly<Record<string, string>>): string[] {
  return Object.keys(env)
    .filter((name) => name.startsWith("KIMI_") || name.startsWith("MOONSHOT_") || name.endsWith("_API_KEY") || name.endsWith("_TOKEN"))
    .sort();
}

// ---- The switches of the legacy production test (phase 47; 47-CONTEXT D-47-02 item 4) ------------------------------------------

export const KIMI_RESTORE_VARIABLE = "REALM_LIVE_KIMI_RESTORE";
export const KIMI_WARM_VARIABLE = "REALM_LIVE_KIMI_WARM";
export const EVIDENCE_DIR_VARIABLE = "REALM_LIVE_EVIDENCE_DIR";
export const KIMI_PROBES_VARIABLE = "REALM_LIVE_KIMI_PROBES";

// The names the recorder restores, from the raw value of REALM_LIVE_KIMI_RESTORE. Unset or empty: all three names, in the order of
// KIMI_RESTORED_ENV (the Phase 43 default). `none`: no name. Otherwise a comma list of the three names, returned in table order. Anything
// else (an unknown name, a duplicate, an empty member, a member with an equals sign) throws a message that names the allowed words and
// never echoes the value.
export function parseKimiRestore(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw === "") {
    return [...KIMI_RESTORED_ENV];
  }
  if (raw === "none") {
    return [];
  }
  const members = raw.split(",");
  const refused = (): Error => new Error(`${KIMI_RESTORE_VARIABLE} must be unset, none, or a comma list of distinct names from: ${KIMI_RESTORED_ENV.join(", ")}`);
  if (members.some((member) => !KIMI_RESTORED_ENV.includes(member)) || new Set(members).size !== members.length) {
    throw refused();
  }
  return KIMI_RESTORED_ENV.filter((name) => members.includes(name));
}

// The label of a restore set, derived and never typed: all, none, or minus followed by the missing name (names joined with a plus when
// more than one is missing).
export function restoreLabel(restore: readonly string[]): string {
  const missing = KIMI_RESTORED_ENV.filter((name) => !restore.includes(name));
  if (missing.length === 0) {
    return "all";
  }
  return missing.length === KIMI_RESTORED_ENV.length ? "none" : `minus-${missing.join("+")}`;
}

// A run is a diagnostic variant unless it restores all three names and has no warm control.
export function isDiagnosticVariant(restore: readonly string[], warm: boolean): boolean {
  return warm || restoreLabel(restore) !== "all";
}

// The label of a run. A diagnostic variant starts with the words `diagnostic variant`; the default says it is the production tier.
export function variantLabel(restore: readonly string[], warm: boolean): string {
  if (!isDiagnosticVariant(restore, warm)) {
    return "production tier (restore all, default drive)";
  }
  return `diagnostic variant: restore ${restoreLabel(restore)}${warm ? ", warm control" : ""}`;
}

export interface KimiProductionPlan {
  readonly restore: readonly string[];
  readonly warm: boolean;
  readonly diagnostic: boolean;
  readonly label: string;
  // The raw REALM_LIVE_EVIDENCE_DIR, when set and not empty; checked by checkEvidenceDir before use.
  readonly evidenceDir?: string;
}

// The plan of the production test from its three optional variables. With none set it is the Phase 43 plan.
export function kimiProductionPlan(env: Readonly<Record<string, string | undefined>>): KimiProductionPlan {
  const restore = parseKimiRestore(env[KIMI_RESTORE_VARIABLE]);
  const warm = env[KIMI_WARM_VARIABLE] === "1";
  const evidenceDir = env[EVIDENCE_DIR_VARIABLE];
  return {
    restore,
    warm,
    diagnostic: isDiagnosticVariant(restore, warm),
    label: variantLabel(restore, warm),
    ...(evidenceDir === undefined || evidenceDir === "" ? {} : { evidenceDir }),
  };
}

// The evidence settings of a plan under a checked directory. The folder name is the restore label (plus `-warm`); a warm run is the
// control C3.
export function kimiEvidenceSettings(plan: KimiProductionPlan, dir: string): RunEvidenceSettings {
  return {
    dir,
    label: plan.label,
    folderLabel: `${restoreLabel(plan.restore)}${plan.warm ? "-warm" : ""}`,
    diagnostic: plan.diagnostic,
    ...(plan.warm ? { control: "C3" as const } : {}),
  };
}

// The command drive of the production test. With the default plan and no evidence it is exactly the Phase 43 drive.
export function kimiProductionDrive(plan: KimiProductionPlan, evidence?: RunEvidenceSettings): HostCommandDrive {
  return {
    kind: "command",
    args: ["mcp", "test", "realm"],
    restore: plan.restore,
    ...(plan.warm ? { warm: true } : {}),
    ...(evidence === undefined ? {} : { evidence }),
  };
}

// ---- The pure parts of the two validator probes ---------------------------------------------------------------------------------

// The first 12 hex characters of the SHA-256 of a text: a short digest that classifies a few known candidates and is no means to recover a
// value (the fake MCP server logs the same prefix).
export function digest12(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export type ExpansionClass = "absent" | "unexpanded-reference" | "host-value" | "other";

export interface ExpansionCandidates {
  // The digest of the reference spelled with braces, the reference spelled with a bare dollar, and the host's value.
  readonly brace: string;
  readonly bare: string;
  readonly host: string;
}

// What the server received for an env entry whose configured text was a reference: no value at all (absent), the reference text itself
// (unexpanded-reference), the value of the host's own environment (host-value, the client expanded it) or something else (other).
export function classifyExpansion(logged: string | undefined, candidates: ExpansionCandidates): ExpansionClass {
  if (logged === undefined) {
    return "absent";
  }
  if (logged === candidates.brace || logged === candidates.bare) {
    return "unexpanded-reference";
  }
  return logged === candidates.host ? "host-value" : "other";
}

export interface McpJsonShape {
  // The text parsed as a JSON object.
  readonly parsed: boolean;
  readonly topLevel: readonly string[];
  // Per server entry of `mcpServers`: its member names in file order.
  readonly entries: Readonly<Record<string, readonly string[]>>;
  // Per server entry: the NAMES of its `env` object, in file order (never a value).
  readonly envNames: Readonly<Record<string, readonly string[]>>;
  // The spaces of the first indented line, `tab`, or `none` for a document with no indented line.
  readonly indent: number | "tab" | "none";
  readonly trailingNewline: boolean;
}

function memberNames(value: unknown): string[] {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
}

// The shape of an mcp.json text: member names, key order, indent and the final newline. Never a value.
export function describeMcpJsonShape(text: string): McpJsonShape {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return { parsed: false, topLevel: [], entries: {}, envNames: {}, indent: "none", trailingNewline: text.endsWith("\n") };
  }
  const servers = typeof document === "object" && document !== null ? (document as Record<string, unknown>)["mcpServers"] : undefined;
  const entries: Record<string, string[]> = {};
  const envNames: Record<string, string[]> = {};
  for (const name of memberNames(servers)) {
    const entry = (servers as Record<string, unknown>)[name];
    entries[name] = memberNames(entry);
    envNames[name] = memberNames(typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>)["env"] : undefined);
  }
  const indented = text.split("\n").find((line) => /^[ \t]/.test(line));
  const indent = indented === undefined ? "none" : indented.startsWith("\t") ? "tab" : (/^ */.exec(indented)?.[0].length ?? 0);
  return { parsed: true, topLevel: memberNames(document), entries, envNames, indent, trailingNewline: text.endsWith("\n") };
}
