// The production-tier pieces of Muse Code, Prime Agent and Grok Build (Phase 48, HTIER-02 to HTIER-04). Pure data and functions only: nothing
// here reads the process environment at import time, starts a process or touches a host. test/support/host-live.ts (runHostProduction)
// runs the drives and calls the checks below; test/integration/host-live-wave2-production.test.ts and host-live-muse.test.ts are the gated
// tests; test/integration/host-live-helpers.test.ts covers every function here with no host CLI, no Podman and no network.
//
// The drives (48-01 drive table):
//   Muse Code   a command drive: `muse exec --provider echo --trust-workspace` with the fixed prompt of the validator tier. The echo provider
//               answers locally; no credential and no network. Muse starts the registered required entry and waits for the handshake.
//   Grok Build  a health-check drive: `grok mcp doctor` with a per-run leader socket inside the scenario. Doctor starts the registered server and
//               sends initialize, tools/list and the six names (48-01 OQ-48-1), so the full wire is asserted.
//   Prime Agent no drive (48-01 blocker B-48-02): an MCP server starts on first use from a model tool call, so the host is wired as a blocker
//               (PRIME_AGENT_PRODUCTION_GAP in host-live.ts and a registry gap), never as a drive that cannot run.
//
// Exports: WireMode, HANDSHAKE_ONLY_NOTE, productionWireProblem, BOOT_AUDIT_FILE, bootAuditLinesOf, AttachAudit, attachAuditOf, presenceDirsOf,
// AttributionCheck, attributionProblems, SERVER_ENV_NAMES, museProductionDrive, GROK_LEADER_SOCKET, GROK_WARM_VARIABLE, grokProductionDrive,
// doctorCheckNames.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { HostId } from "../../src/host/types.js";
import type { HostCommandDrive } from "./host-live.js";
import { REALM_TOOL_NAMES, SESSION_PROMPT, type WireSummary } from "./host-live-session.js";
import { isRecord } from "./omp-live.js";

// ---- The wire assertion ------------------------------------------------------------------------------------------------------------

// full: the handshake of either era, tools/list and the six Realm tool names. handshake-only: the handshake alone, for a host whose drive
// sends no tools/list; it is a named mode with its own failure text and is never used for a host whose drive sends tools/list.
export type WireMode = "full" | "handshake-only";

export const HANDSHAKE_ONLY_NOTE = "handshake only";

export interface ProductionWire {
  readonly summary: WireSummary;
  // The argument lists of the server starts the recorder logged (readRecorderStarts).
  readonly starts: readonly (readonly string[])[];
  // The host id the registered launcher must name: the argument list is exactly mcp --host ID.
  readonly host: string;
  readonly mode: WireMode;
}

// One sentence naming the first thing the wire gets wrong, or undefined when it is right. Exactly one server start whose arguments are
// `mcp --host ID` (a second start is a second realm server); the handshake of either era (initialize, or server/discover); and in the
// full mode tools/list answered with the six Realm tool names. The handshake-only mode asserts nothing about tools, and says so.
export function productionWireProblem(wire: ProductionWire): string | undefined {
  const tag = wire.mode === "handshake-only" ? ` (${HANDSHAKE_ONLY_NOTE})` : "";
  if (wire.starts.length !== 1) {
    return `the recorder must log exactly one realm server start; it logged ${String(wire.starts.length)}${tag}`;
  }
  const argv = wire.starts[0] ?? [];
  if (argv.length !== 3 || argv[0] !== "mcp" || argv[1] !== "--host" || argv[2] !== wire.host) {
    return `the realm server must be started with the arguments mcp --host ${wire.host}; it was started with [${argv.join(" ")}]${tag}`;
  }
  const { summary } = wire;
  if (!summary.hostMethods.includes("initialize") && !summary.hostMethods.includes("server/discover")) {
    return `the host must have sent initialize or server/discover; methods seen: [${summary.hostMethods.join(", ")}]${tag}`;
  }
  if (wire.mode === "handshake-only") {
    return undefined;
  }
  if (!summary.answered) {
    return `the host must have listed the Realm tools (tools/list answered with tool names); methods seen: [${summary.hostMethods.join(", ")}]`;
  }
  if ([...summary.toolNames].join(",") !== [...REALM_TOOL_NAMES].join(",")) {
    return `the listed tools must be the six Realm tools; saw [${summary.toolNames.join(", ")}]`;
  }
  return undefined;
}

// ---- The attach audit line and the presence directories -----------------------------------------------------------------------------

// The audit file of the daemon's host boot reports below the state directory (the session id the host boot recorder writes to).
export const BOOT_AUDIT_FILE = "host-boot.jsonl";

// The lines of the host boot audit file in file order, without their line ends. An absent file has no line.
export function bootAuditLinesOf(stateDir: string): readonly string[] {
  const file = join(stateDir, "audit", BOOT_AUDIT_FILE);
  if (!existsSync(file)) {
    return [];
  }
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

// What the attach audit lines of a run name. named: exactly one attach line and it names a host id (`host`). unlabelled: exactly one attach
// line and it names no host (the word `unlabelled`, or an empty host part). none: no attach line. several: more than one. Never a guess.
export type AttachAudit = { readonly word: "named"; readonly host: string } | { readonly word: "none" | "several" | "unlabelled" };

// The attach lines (tool host.boot, path HOST/TRANSPORT/attached) among `lines`, read as the audit file holds them. A line that is not a
// JSON object, another tool or another phase is not an attach line.
export function attachAuditOf(lines: readonly string[]): AttachAudit {
  const hosts: string[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed["tool"] !== "host.boot" || typeof parsed["path"] !== "string") {
      continue;
    }
    const parts = parsed["path"].split("/");
    if (parts.length === 3 && parts[2] === "attached") {
      hosts.push(parts[0] ?? "");
    }
  }
  if (hosts.length === 0) {
    return { word: "none" };
  }
  const first = hosts[0] ?? "";
  if (hosts.length > 1) {
    return { word: "several" };
  }
  return first === "" || first === "unlabelled" ? { word: "unlabelled" } : { word: "named", host: first };
}

// The names of the presence directories (`ID-active`) below <stateDir>/hosts, sorted. An absent directory has none.
export function presenceDirsOf(stateDir: string): readonly string[] {
  const hosts = join(stateDir, "hosts");
  if (!existsSync(hosts)) {
    return [];
  }
  return readdirSync(hosts)
    .filter((name) => name.endsWith("-active") && statSync(join(hosts, name)).isDirectory())
    .sort();
}

// ---- The attribution check ---------------------------------------------------------------------------------------------------------

// The extra assertions of a production run (Phase 48): which recipes the run installs (the host's own, and for the Grok attribution test
// the Claude file beside it), which host id the attach must be attributed to, and whether the audit line is mandatory (the attribution
// tests: an audit line that cannot be found fails) or a diagnostic (the plain production tests, where the presence directory and the boot
// report decide). `alsoReal` names more of the operator's real files that must be byte-equal afterwards.
export interface AttributionCheck {
  readonly installs: readonly HostId[];
  readonly attributedTo: HostId;
  readonly audit: "required" | "diagnostic";
  readonly alsoReal?: (home: string) => readonly string[];
}

export interface AttributionObserved {
  readonly attributedTo: string;
  readonly audit: AttachAudit;
  // The presence directories this run created (the listing after the host command minus the listing before it).
  readonly createdPresence: readonly string[];
  // The attached boot reports the daemon holds for the attributed host.
  readonly attachedBoots: number;
}

export function describeAudit(audit: AttachAudit): string {
  return audit.word === "named" ? `one attach line naming ${audit.host}` : audit.word === "none" ? "no attach line" : audit.word === "several" ? "several attach lines" : "an attach line naming no host";
}

// The problems of a mandatory attribution (the attribution tests): the audit line, the presence directory and the attached boot report must
// all name the attributed host, and no other host's presence directory may have appeared. Empty when all three agree.
export function attributionProblems(observed: AttributionObserved): readonly string[] {
  const problems: string[] = [];
  if (observed.audit.word !== "named") {
    problems.push(`the attach audit line must name ${observed.attributedTo}; found ${describeAudit(observed.audit)}`);
  } else if (observed.audit.host !== observed.attributedTo) {
    problems.push(`the attach audit line names ${observed.audit.host}, not ${observed.attributedTo}`);
  }
  const wanted = `${observed.attributedTo}-active`;
  if (!observed.createdPresence.includes(wanted)) {
    problems.push(`the presence directory ${wanted} must have been created; created: [${observed.createdPresence.join(", ")}]`);
  }
  const foreign = observed.createdPresence.filter((name) => name !== wanted);
  if (foreign.length > 0) {
    problems.push(`a presence directory of another host appeared: [${foreign.join(", ")}]`);
  }
  if (observed.attachedBoots < 1) {
    problems.push(`the daemon must hold an attached boot report for ${observed.attributedTo}; it holds ${String(observed.attachedBoots)}`);
  }
  return problems;
}

// ---- The drives --------------------------------------------------------------------------------------------------------------------

// The names the recorder gives back to the real `realm mcp` when the host does not forward them (the three of CODEX_FORWARDED_ENV, which the
// legacy Kimi drive restores too, 43-CONTEXT E-43-09; written out here because host-live-session.ts and host-live.ts import each other and a
// top-level read of the constant would meet an uninitialised module; a hermetic row pins the equality). The recorder logs the names it
// restored, never a value.
export const SERVER_ENV_NAMES: readonly string[] = Object.freeze(["XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "REALM_DRIVER_SOCKET"]);

// Muse Code (48-01 drive table): `muse exec --provider echo --trust-workspace` with the validator tier's fixed prompt, from a new project
// directory. The echo provider answers locally. The failure bound is the run bound; no cold connect bound applies (a real cold attach took
// 26 s in Phase 40 and Muse waits for the server).
export function museProductionDrive(): HostCommandDrive {
  return {
    kind: "command",
    args: ["exec", "--provider", "echo", "--trust-workspace", SESSION_PROMPT],
    restore: SERVER_ENV_NAMES,
    boundedConnect: false,
  };
}

// The leader socket of a Grok run: a name inside the scenario root, so no leader process outlives the scenario.
export const GROK_LEADER_SOCKET = "grok-leader.sock";

// REALM_LIVE_GROK_WARM=1 turns the Grok attribution tests into the warm diagnostic variant of the Kimi switch (the session is brought up
// before the host command, so a health check that leaves before the realm is ready still meets an attached session). Not the production
// tier; the label says so. The tests never set it.
export const GROK_WARM_VARIABLE = "REALM_LIVE_GROK_WARM";

// Grok Build (48-01 drive table): `grok mcp doctor` with a per-run leader socket inside the scenario. Grok runs with HOME set to a scenario
// directory (its only relocation, 48-CONTEXT E-48-10); the recorder that is the registered realm gives the real `realm mcp` the account's
// HOME (forced, because the host forwards its own) and the three server names (restored when the host does not forward them). Doctor exits
// 0 or 1 after its rows (host-live-wave2.ts): the wire and the daemon decide, the exit code is a diagnostic.
export function grokProductionDrive(warm: boolean): HostCommandDrive {
  return {
    kind: "command",
    args: ["mcp", "doctor"],
    rootArgs: (root) => ["--leader-socket", join(root, GROK_LEADER_SOCKET)],
    restore: SERVER_ENV_NAMES,
    force: ["HOME"],
    exitCodes: [0, 1],
    boundedConnect: false,
    output: "check-names",
    ...(warm ? { warm: true } : {}),
  };
}

const DOCTOR_CHECKS: readonly RegExp[] = [/command found/i, /server started/i, /handshake OK/i, /\d+ tools? discovered/i];

// The names of the doctor checks present in its output (never a line of it): the diagnostic of a Grok run prints these and nothing else.
export function doctorCheckNames(output: string): string[] {
  return DOCTOR_CHECKS.flatMap((check) => {
    const found = check.exec(output)?.[0];
    return found === undefined ? [] : [found.replace(/\d+/, "N")];
  });
}
