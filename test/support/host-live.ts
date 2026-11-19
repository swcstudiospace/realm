// Gate, isolation and runner pieces of the host live rehearsals (ADPT-08; decisions D-24-07 and D-24-08 of phase 24; BOOTP-01 of phase 31).
//
// Sixteen hosts are in the table. Five have a gated live file of their own: claude, codex, opencode, kimi and kimi-code. The two Kimi
// products share the command name `kimi`, so the gate tells them apart by the installed version (the legacy Python CLI is 1.x, Kimi Code
// is 2.x or newer). Each file has a validator tier (the host's own commands parse, and for some hosts launch, what the real recipe wrote
// into an isolated home) and a production tier. The production tier of claude and opencode is the host's own health check
// (`<host> mcp list`), which performs a real MCP handshake (initialize or server/discover) against `realm mcp --host <id>` on the
// production stack; that of kimi is a command drive (`kimi mcp test realm`, 43-CONTEXT). The production tier of codex and kimi-code is a
// session drive (`codex exec`, `kimi -p` against a refusing loopback provider; 31-CONTEXT D-31-02, and for kimi-code one fixed non-secret
// key) that makes the host launch the registered server and list its tools. In every production run the registered `realm` is a wire
// recorder (test/support/host-live-session.ts) that logs method names and tool names. The eleven wave-2 hosts (qwen, pi, hermes, cursor, kilo, copilot, augment, codebuddy, cline, prime-agent, grok-build) share one
// table-driven validator file, test/integration/host-live-wave2.test.ts, and have no production tier (config-only, 25-CONTEXT D-25-08), except Grok Build (Phase 48: the health
// check `grok mcp doctor`, test/integration/host-live-wave2-production.test.ts) and Muse Code, which has a gated file of its own (test/integration/host-live-muse.test.ts; a command
// drive, `muse exec --provider echo`). Prime Agent has no credential-free drive (48-01 blocker B-48-02, PRIME_AGENT_PRODUCTION_GAP).
// Antigravity has no live file at all (ANTIGRAVITY_GAP).
//
// Gate order of hostLiveSkipReason, the first failing check names the skip (no test ever sets a gate variable):
//   1. the host's opt-in variable is exactly 1 (REALM_LIVE_<HOST>, for example REALM_LIVE_CLAUDE or REALM_LIVE_QWEN)
//   2. the platform is Linux
//   3. the host executable exists: REALM_<HOST>_BIN (an absolute path) or the default name on PATH
//   4. `<bin> --version` runs and prints an x.y.z version (a broken install, such as the Hermes one of E-HM2, fails here)
//   5. the host has a minimum version (`minVersion`, pi 1.3.0) and the installed one is older
//   6. kimi and kimi-code only: the installed kimi is not the archived Python stub, and it is the product the row covers (kimi needs a
//      major version below 2, kimi-code a major version of 2 or more)
//   7. the built CLI dist/src/cli/main.js exists
//   8. production tier only: the host has a production tier, then productionSkipReason (Podman, image, driver, sockets), then
//      no Realm receipt for the host in the shared state directory
//
// Nothing here reads the process environment or touches the host at import time: every function takes what it needs as a
// parameter. The pure pieces (skip reasons, version parsing, the stub realm, the isolated environment, the process-group kill)
// are covered by test/integration/host-live-helpers.test.ts, which always runs without a host CLI, Podman or a network.
//
// Exports (the live files and the helper test import exactly these names):
//   HOST_LIVE, LIVE_HOST_IDS, type LiveHostId          the frozen per-host table (ANTIGRAVITY_GAP, CONFIG_ONLY_GAP: its fixed gap sentences)
//   hostLiveSkipReason, collectHostLiveGate            the pure gate and the probe-and-decide wrapper the live files call
//   parseHostVersion, compareVersions, resolveExecutable   version parsing and comparison, and executable lookup
//   writeStubRealm, readStubArgv                       the stub `realm` that records its argv, and the reader of that record
//   isolatedHostEnv, isUnderTemp                       the allowlisted environment and the temporary-directory guard
//   runHost, describeRun, requireReturned              the bounded process-group runner and its result helpers
//   Capture, signalGroup, shellQuote, the two grace constants   the runner pieces test/support/host-live-session.ts reuses
//   createHostRig                                      one isolated root with the stub, a state directory and the realm CLI
//   runHostProduction                                  the shared production-tier scenario of claude, codex, opencode, kimi and kimi-code
//   bootPhaseCountsOf                                  the per-phase boot report counts of one host in `realm metrics` output
//   fileSha256, stripAnsi, cliJson, refusalReasonOf, ownedTableOf, processAlive   small helpers of the live files

import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import type { TestContext } from "node:test";
import { runCli, type CliResult } from "../../src/cli/main.js";
import { locateTomlTable } from "../../src/host/toml-table.js";
import { controlSocketPath, type EnvironmentLike } from "../../src/session/paths.js";
import { createCleanups, isRecord } from "./omp-live.js";
import {
  type CommandResult,
  createScenarioEnvironment,
  describeResult,
  describeValue,
  isDirectory,
  isSocket,
  listContainers,
  listRealmSandboxes,
  listSandboxContainers,
  listSandboxesNamed,
  LIVE_PRODUCTION_VARIABLE,
  type LiveInputs,
  onPath,
  pollUntil,
  probePodman,
  productionSkipReason,
  readLiveInputs,
  realmCli,
  realmCliWithWorkspace,
  removeSharedStateCreatedBy,
  restoreSharedPolicy,
  sandboxNameFor,
  type ScenarioEnvironment,
  stateOfStatus,
  waitForNoResidue,
} from "./production-live.js";
import { catalogueCodesIn, type RunEvidenceSettings, writeRunEvidence } from "./host-live-evidence.js";
import { observeReach, REACH_WINDOW_MS, type ReachSeams } from "./host-live-reach.js";
import { isLoopbackPeer, readRecorderStarts, readWireLog, REALM_TOOL_NAMES, runHostUntil, type RefusingProvider, wireSummary, writeWireRecorder } from "./host-live-session.js";
import {
  attachAuditOf,
  type AttributionObserved,
  type AttributionCheck,
  attributionProblems,
  bootAuditLinesOf,
  describeAudit,
  doctorCheckNames,
  presenceDirsOf,
  productionWireProblem,
  type WireMode,
} from "./host-live-production.js";
import { scaledMs } from "./timing.js";

// ---- The per-host table ----------------------------------------------------------------------------------------------------

export type LiveHostId = "claude" | "codex" | "opencode" | "kimi" | "kimi-code" | "qwen" | "pi" | "hermes" | "cursor" | "kilo" | "copilot" | "augment" | "codebuddy" | "cline" | "prime-agent" | "grok-build";
export const LIVE_HOST_IDS: readonly LiveHostId[] = Object.freeze(["claude", "codex", "opencode", "kimi", "kimi-code", "qwen", "pi", "hermes", "cursor", "kilo", "copilot", "augment", "codebuddy", "cline", "prime-agent", "grok-build"] as const);
export type HostLiveTier = "validator" | "production";

export interface HostLiveSpec {
  readonly optIn: string;
  readonly binOverride: string;
  readonly defaultBinary: string;
  readonly displayName: string;
  readonly versionArgs: readonly string[];
  // The version the context documents observed. Informational: a newer or older version runs and is recorded, never skipped.
  readonly recordedVersion: string;
  // The first version that can use the recipe, or null for a host without a floor. An older version is skipped (the only skip a version causes).
  readonly minVersion: string | null;
  // Whether the host's own validator commands launch the registered command (the stub realm records the argv).
  readonly launchesOnValidate: boolean;
  readonly productionTier: boolean;
  // The fixed sentence of a host without a production tier; null for a host that has one.
  readonly productionGap: string | null;
  // A host whose `--version` fails on a fresh data root until another command has bootstrapped it (Hermes, 36-CONTEXT E-36-07): the
  // version probe sets `variable` to a directory in its throwaway home and runs the `prepare` arguments once before `versionArgs`.
  readonly versionRoot?: HostVersionRoot;
}

export interface HostVersionRoot {
  readonly variable: string;
  readonly prepare: readonly string[];
}

// The production-tier gap of every wave-2 host.
export const CONFIG_ONLY_GAP = "config-only host: no production tier is defined for it (25-CONTEXT D-25-08)";

// The production-tier gap of Prime Agent (48-01 blocker B-48-02): Prime Agent initialises an MCP server on first use from a model tool call,
// and none of its commands (mcp list, get, add, remove, status, doctor, or a mode with no model) starts the registered server, so no
// credential-free drive exists. The registry T3 of the host is the same gap.
export const PRIME_AGENT_PRODUCTION_GAP = "B-48-02: no credential-free command starts the registered server on Prime Agent 0.10.2 (a start needs a model tool call), so no production tier can be run for it";

interface Wave2SpecInit {
  readonly optIn: string;
  readonly binOverride: string;
  readonly defaultBinary: string;
  readonly displayName: string;
  readonly recordedVersion: string;
  readonly minVersion?: string;
  readonly launchesOnValidate: boolean;
  readonly versionRoot?: HostVersionRoot;
  // The fixed production-gap sentence, or null for a host that has a production tier. Absent: CONFIG_ONLY_GAP.
  readonly productionGap?: string | null;
}

// One wave-2 table entry: a host whose validator runs `<bin> --version`. It has no production tier (CONFIG_ONLY_GAP or the gap sentence
// it names) unless `productionGap` is null.
function wave2Spec(init: Wave2SpecInit): HostLiveSpec {
  return Object.freeze({
    optIn: init.optIn,
    binOverride: init.binOverride,
    defaultBinary: init.defaultBinary,
    displayName: init.displayName,
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: init.recordedVersion,
    minVersion: init.minVersion ?? null,
    launchesOnValidate: init.launchesOnValidate,
    productionTier: init.productionGap === null,
    productionGap: init.productionGap === undefined ? CONFIG_ONLY_GAP : init.productionGap,
    ...(init.versionRoot === undefined ? {} : { versionRoot: Object.freeze({ variable: init.versionRoot.variable, prepare: Object.freeze([...init.versionRoot.prepare]) }) }),
  });
}

export const HOST_LIVE: Readonly<Record<LiveHostId, HostLiveSpec>> = Object.freeze({
  claude: Object.freeze({
    optIn: "REALM_LIVE_CLAUDE",
    binOverride: "REALM_CLAUDE_BIN",
    defaultBinary: "claude",
    displayName: "Claude Code",
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: "2.1.322",
    minVersion: null,
    launchesOnValidate: true,
    productionTier: true,
    productionGap: null,
  }),
  codex: Object.freeze({
    optIn: "REALM_LIVE_CODEX",
    binOverride: "REALM_CODEX_BIN",
    defaultBinary: "codex",
    displayName: "Codex",
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: "0.154.0",
    minVersion: null,
    launchesOnValidate: false,
    productionTier: true,
    productionGap: null,
  }),
  opencode: Object.freeze({
    optIn: "REALM_LIVE_OPENCODE",
    binOverride: "REALM_OPENCODE_BIN",
    defaultBinary: "opencode",
    displayName: "OpenCode",
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: "1.19.5",
    minVersion: null,
    launchesOnValidate: true,
    productionTier: true,
    productionGap: null,
  }),
  kimi: Object.freeze({
    optIn: "REALM_LIVE_KIMI",
    binOverride: "REALM_KIMI_BIN",
    defaultBinary: "kimi",
    displayName: "Kimi CLI",
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: "1.51.0",
    minVersion: null,
    launchesOnValidate: true,
    productionTier: true,
    productionGap: null,
  }),
  // Kimi Code (the 2.x product) shares the command name `kimi` with the legacy Python CLI; hostLiveSkipReason tells them apart by version.
  // It documents no command that launches a registered server (43-CONTEXT E-43-06), so its validator tier proves the session instead.
  "kimi-code": Object.freeze({
    optIn: "REALM_LIVE_KIMI_CODE",
    binOverride: "REALM_KIMI_CODE_BIN",
    defaultBinary: "kimi",
    displayName: "Kimi Code",
    versionArgs: Object.freeze(["--version"]),
    recordedVersion: "2.6.3",
    minVersion: null,
    launchesOnValidate: false,
    productionTier: true,
    productionGap: null,
  }),
  qwen: wave2Spec({ optIn: "REALM_LIVE_QWEN", binOverride: "REALM_QWEN_BIN", defaultBinary: "qwen", displayName: "Qwen Code", recordedVersion: "0.22.0", launchesOnValidate: true }),
  // pi below 1.3.0 has no MCP and ignores mcp.json (E-PI2): the floor skips it.
  pi: wave2Spec({ optIn: "REALM_LIVE_PI", binOverride: "REALM_PI_BIN", defaultBinary: "pi", displayName: "Pi", recordedVersion: "1.5.2", minVersion: "1.3.0", launchesOnValidate: true }),
  hermes: wave2Spec({ optIn: "REALM_LIVE_HERMES", binOverride: "REALM_HERMES_BIN", defaultBinary: "hermes", displayName: "Hermes Agent", recordedVersion: "0.23.2", launchesOnValidate: true, versionRoot: { variable: "HERMES_HOME", prepare: ["mcp", "list"] } }),
  cursor: wave2Spec({ optIn: "REALM_LIVE_CURSOR", binOverride: "REALM_CURSOR_BIN", defaultBinary: "cursor-agent", displayName: "Cursor", recordedVersion: "2026.11.13", launchesOnValidate: true }),
  kilo: wave2Spec({ optIn: "REALM_LIVE_KILO", binOverride: "REALM_KILO_BIN", defaultBinary: "kilo", displayName: "Kilo Code", recordedVersion: "7.8.27", launchesOnValidate: true }),
  copilot: wave2Spec({ optIn: "REALM_LIVE_COPILOT", binOverride: "REALM_COPILOT_BIN", defaultBinary: "copilot", displayName: "GitHub Copilot CLI", recordedVersion: "1.0.112", launchesOnValidate: false }),
  augment: wave2Spec({ optIn: "REALM_LIVE_AUGMENT", binOverride: "REALM_AUGMENT_BIN", defaultBinary: "auggie", displayName: "Augment (Auggie)", recordedVersion: "1.2.1", launchesOnValidate: false }),
  codebuddy: wave2Spec({ optIn: "REALM_LIVE_CODEBUDDY", binOverride: "REALM_CODEBUDDY_BIN", defaultBinary: "codebuddy", displayName: "CodeBuddy Code", recordedVersion: "2.185.0", launchesOnValidate: true }),
  cline: wave2Spec({ optIn: "REALM_LIVE_CLINE", binOverride: "REALM_CLINE_BIN", defaultBinary: "cline", displayName: "Cline CLI", recordedVersion: "3.0.74", launchesOnValidate: false }),
  // Phase 40 (40-CONTEXT D-40-07): `prime-agent mcp list|get` print the name and the transport only and start nothing (E-40-06); `grok mcp doctor`
  // starts the registered server (E-40-08), `grok mcp list` does not.
  // Phase 48 (48-01, 48-02): Prime Agent has no credential-free drive (B-48-02); Grok Build has a production tier, the health check `grok mcp doctor`.
  "prime-agent": wave2Spec({ optIn: "REALM_LIVE_PRIME_AGENT", binOverride: "REALM_PRIME_AGENT_BIN", defaultBinary: "prime-agent", displayName: "Prime Agent", recordedVersion: "0.10.2", launchesOnValidate: false, productionGap: PRIME_AGENT_PRODUCTION_GAP }),
  "grok-build": wave2Spec({ optIn: "REALM_LIVE_GROK_BUILD", binOverride: "REALM_GROK_BUILD_BIN", defaultBinary: "grok", displayName: "Grok Build", recordedVersion: "1.0.77", launchesOnValidate: true, productionGap: null }),
});

// The sentence of the Antigravity gap: no live file exists for it, because `agy` was never observed.
export const ANTIGRAVITY_GAP =
  "Antigravity's CLI `agy` was never installed or run: its MCP file is documented by three Google pages and no listing command was observed (25-CONTEXT E-AG2); its recipe is proven on a fixture host only";

// The text the archived Python kimi prints for any invocation.
const KIMI_STUB_MARKER = "no longer maintained";

// ---- Version ---------------------------------------------------------------------------------------------------------------

const VERSION_PATTERN = /(?<!\d)(\d+\.\d+\.\d+)(?!\d)/;

// Compares two x.y.z versions numerically, part by part: negative when `left` is older, 0 when equal, positive when newer. A part that
// is not a number counts as 0, so a malformed string never throws.
export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

// A product word only for a host whose `--version` prints another x.y.z before the product's own; none of the eleven wave-2 hosts does
// (a date or a commit hash follows the version: `2026.11.13-eacade1`, `v0.23.2 (2026.11.13)`).
const PRODUCT_WORDS: Readonly<Record<LiveHostId, RegExp | undefined>> = Object.freeze({
  claude: /Claude Code/i,
  codex: /codex-cli/i,
  opencode: undefined,
  kimi: /kimi/i,
  // `kimi --version` of Kimi Code prints a bare version (2.6.3, no product word; 43-CONTEXT E-43-08).
  "kimi-code": undefined,
  qwen: undefined,
  pi: undefined,
  hermes: undefined,
  cursor: undefined,
  kilo: undefined,
  copilot: undefined,
  augment: undefined,
  codebuddy: undefined,
  cline: undefined,
  "prime-agent": undefined,
  // `grok --version` prints `grok 1.0.77 (50ca579fa996) [stable]`: the first x.y.z is the product's own, the commit hash has no dots.
  "grok-build": undefined,
});

// The first x.y.z of `<bin> --version`: the one on the line that names the product when there is one (`2.1.322 (Claude Code)`,
// `codex-cli 0.154.0`, `kimi, version 1.51.0`), else the first in the output (`1.19.5`). Undefined when there is none.
export function parseHostVersion(host: LiveHostId, stdout: string): string | undefined {
  const word = PRODUCT_WORDS[host];
  if (word !== undefined) {
    for (const line of stdout.split("\n")) {
      if (word.test(line)) {
        const named = VERSION_PATTERN.exec(line)?.[1];
        if (named !== undefined) {
          return named;
        }
      }
    }
  }
  return VERSION_PATTERN.exec(stdout)?.[1];
}

// ---- Gate ------------------------------------------------------------------------------------------------------------------

// The result of `<bin> --version`: its stdout, or "unavailable" when it could not start, timed out or exited non-zero.
export type HostVersionProbe = { readonly kind: "output"; readonly stdout: string } | { readonly kind: "unavailable" };

// The host facts the gate decides from. Each is injected, so the hermetic test can cover every branch.
export interface HostLiveGateInputs {
  readonly platform: string;
  readonly env: EnvironmentLike;
  // The absolute path of the executable a name (looked up on PATH) or an absolute path names, or undefined.
  readonly resolveBinary: (nameOrPath: string) => string | undefined;
  readonly versionProbe: HostVersionProbe;
  // Whether dist/src/cli/main.js exists.
  readonly cliBuilt: boolean;
  // Whether the shared state directory already holds a Realm receipt for this host (production tier only).
  readonly receiptExists: boolean;
  // productionSkipReason of the production gate, consulted for the production tier only.
  readonly production: string | false;
}

// The reason the live rehearsal of `host` at `tier` cannot run, or false when every prerequisite holds. The reason names the FIRST
// missing prerequisite in the order of the header. A version newer than the recorded one never skips.
export function hostLiveSkipReason(host: LiveHostId, tier: HostLiveTier, inputs: HostLiveGateInputs): string | false {
  const spec = HOST_LIVE[host];
  const { env } = inputs;
  if (env[spec.optIn] !== "1") {
    return `${spec.optIn}=1 is not set; the live ${spec.displayName} rehearsal needs an explicit operator opt-in`;
  }
  if (inputs.platform !== "linux") {
    return `the live host rehearsals are verified on Linux only; this host is ${inputs.platform}`;
  }
  const override = env[spec.binOverride];
  const overridden = override !== undefined && override !== "";
  if (overridden && !isAbsolute(override)) {
    return `${spec.binOverride} must be an absolute path to the ${spec.defaultBinary} executable; a relative path is refused`;
  }
  const named = overridden ? override : spec.defaultBinary;
  if (inputs.resolveBinary(named) === undefined) {
    return `no ${spec.displayName} executable ${named}; install ${spec.defaultBinary} or point ${spec.binOverride} at it`;
  }
  if (inputs.versionProbe.kind === "unavailable") {
    return `${named} --version did not run to a successful exit`;
  }
  const parsed = parseHostVersion(host, inputs.versionProbe.stdout);
  if (parsed === undefined) {
    return `${named} --version printed no x.y.z version`;
  }
  if (spec.minVersion !== null && compareVersions(parsed, spec.minVersion) < 0) {
    return `${spec.displayName} ${parsed} is below ${spec.minVersion}, the first release with built-in MCP; a recipe for it would be silently ignored (25-CONTEXT E-PI2)`;
  }
  if ((host === "kimi" || host === "kimi-code") && inputs.versionProbe.stdout.includes(KIMI_STUB_MARKER)) {
    return "the installed kimi is the archived Python stub, which writes no configuration and answers no subcommand";
  }
  // The two Kimi products share the command name: the major version says which one is installed.
  const major = Number.parseInt(parsed.split(".")[0] ?? "", 10);
  if (host === "kimi" && major >= 2) {
    return `the installed kimi is Kimi Code (${parsed}), not the legacy Python CLI this row covers; point ${spec.binOverride} at the pinned legacy package kimi-cli 1.51.0`;
  }
  if (host === "kimi-code" && major < 2) {
    return `the installed kimi is the legacy Python CLI (${parsed}), not Kimi Code; point ${spec.binOverride} at the npm package @moonshot-ai/kimi-code`;
  }
  if (!inputs.cliBuilt) {
    return "the built CLI dist/src/cli/main.js is missing; run npm run build first";
  }
  if (tier === "validator") {
    return false;
  }
  if (spec.productionGap !== null) {
    return spec.productionGap;
  }
  if (inputs.production !== false) {
    return inputs.production;
  }
  if (inputs.receiptExists) {
    return `the shared state directory already holds a Realm host receipt for ${host}; refusing to touch a real install`;
  }
  return false;
}

// ---- Executables and the version probe -------------------------------------------------------------------------------------

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The absolute path of the executable `nameOrPath` names: itself when absolute and executable, else the first absolute PATH entry
// that holds an executable of that name. The file is inspected, never run. Undefined when there is none.
export function resolveExecutable(nameOrPath: string, pathValue: string | undefined): string | undefined {
  if (isAbsolute(nameOrPath)) {
    return isExecutableFile(nameOrPath) ? nameOrPath : undefined;
  }
  for (const dir of (pathValue ?? "").split(delimiter)) {
    if (dir === "" || !isAbsolute(dir)) {
      continue;
    }
    const candidate = join(dir, nameOrPath);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

// The bound of the one-time bootstrap command of a host with a version root: a cold bootstrap took 20 to 36 s here and up to 230 s on a loaded host.
const VERSION_PREPARE_TIMEOUT_MS = 300_000;

const versionProbes = new Map<string, Promise<HostVersionProbe>>();

// `<bin> --version` once per binary for the process, run in a throwaway temporary home so the probe never reads or writes a real
// host configuration. Never rejects.
function versionOnce(host: LiveHostId, bin: string): Promise<HostVersionProbe> {
  const known = versionProbes.get(bin);
  if (known !== undefined) {
    return known;
  }
  const probe = (async (): Promise<HostVersionProbe> => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "rlh-ver-")));
    try {
      const base = { PATH: [dirname(bin), dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: home, LANG: "C.UTF-8", TERM: "dumb" };
      const { versionRoot } = HOST_LIVE[host];
      const env: Record<string, string> = versionRoot === undefined ? base : { ...base, [versionRoot.variable]: join(home, "version-root") };
      if (versionRoot !== undefined) {
        // The first command bootstraps the data root; its exit code and output are ignored (36-CONTEXT E-36-07).
        await runHost(bin, versionRoot.prepare, env, home, scaledMs(VERSION_PREPARE_TIMEOUT_MS));
      }
      const result = await runHost(bin, HOST_LIVE[host].versionArgs, env, home, scaledMs(VALIDATOR_TIMEOUT_MS));
      return result.exitCode === 0 ? { kind: "output", stdout: result.stdout } : { kind: "unavailable" };
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  })();
  versionProbes.set(bin, probe);
  return probe;
}

export interface HostLiveGate {
  // The reason the rehearsal skips, or false.
  readonly skip: string | false;
  // The resolved absolute host executable, when the gate found one.
  readonly bin: string | undefined;
  // The observed host version, when the probe ran and printed one.
  readonly version: string | undefined;
}

export interface CollectHostLiveGate {
  readonly env: EnvironmentLike;
  readonly platform: string;
  // dist/src/cli/main.js beside the compiled tests.
  readonly cliPath: string;
}

// Reads the host facts hostLiveSkipReason decides from and decides. Nothing is started until the opt-in is set on Linux, so a plain
// `npm test` never runs a host CLI, `podman --version` or anything else.
export async function collectHostLiveGate(host: LiveHostId, tier: HostLiveTier, options: CollectHostLiveGate): Promise<HostLiveGate> {
  const spec = HOST_LIVE[host];
  const { env, platform, cliPath } = options;
  const resolveBinary = (nameOrPath: string): string | undefined => resolveExecutable(nameOrPath, env["PATH"]);
  const unprobed: HostLiveGateInputs = {
    platform,
    env,
    resolveBinary,
    versionProbe: { kind: "unavailable" },
    cliBuilt: false,
    receiptExists: false,
    production: false,
  };
  if (env[spec.optIn] !== "1" || platform !== "linux") {
    return { skip: hostLiveSkipReason(host, tier, unprobed), bin: undefined, version: undefined };
  }
  const override = env[spec.binOverride];
  const named = override === undefined || override === "" ? spec.defaultBinary : override;
  const relativeOverride = override !== undefined && override !== "" && !isAbsolute(override);
  const bin = relativeOverride ? undefined : resolveBinary(named);
  const versionProbe: HostVersionProbe = bin === undefined ? { kind: "unavailable" } : await versionOnce(host, bin);
  const cliBuilt = existsSync(cliPath);
  let production: string | false = false;
  let receiptExists = false;
  if (tier === "production" && spec.productionGap === null && cliBuilt) {
    production = productionSkipReason({
      env,
      // podmanSkipReason is reached only after the production opt-in, so a run without it never starts `podman --version`.
      podman: env[LIVE_PRODUCTION_VARIABLE] === "1" ? await probePodman() : { kind: "unavailable" },
      isSocket,
      onPath: (name) => onPath(name, env["PATH"]),
      exists: existsSync,
      isDirectory,
      cliPath,
    });
    if (production === false) {
      const stateDir = readLiveInputs(env, cliPath).driverStateDir;
      receiptExists = stateDir !== undefined && existsSync(join(stateDir, "hosts", `${host}.receipt.json`));
    }
  }
  const inputs: HostLiveGateInputs = { platform, env, resolveBinary, versionProbe, cliBuilt, receiptExists, production };
  const version = versionProbe.kind === "output" ? parseHostVersion(host, versionProbe.stdout) : undefined;
  return { skip: hostLiveSkipReason(host, tier, inputs), bin, version };
}

// ---- Stub realm ------------------------------------------------------------------------------------------------------------

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// Writes `<dir>/realm`, mode 0755: a POSIX sh script that appends each argument on its own line followed by a line `--` to
// `logFile` (one printf, so concurrent invocations do not interleave) and exits 0. It reads no environment and no network.
export function writeStubRealm(dir: string, logFile: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "realm");
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' "$@" '--' >> ${shellQuote(logFile)}\nexit 0\n`);
  chmodSync(path, 0o755);
  return path;
}

// The invocations the stub recorded, in order, each the list of its arguments. An argument that holds a newline is recorded as
// several lines. A log that does not exist yet is no invocation.
export function readStubArgv(logFile: string): string[][] {
  if (!existsSync(logFile)) {
    return [];
  }
  const invocations: string[][] = [];
  let current: string[] = [];
  const lines = readFileSync(logFile, "utf8").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  for (const line of lines) {
    if (line === "--") {
      invocations.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  return invocations;
}

// ---- Isolation -------------------------------------------------------------------------------------------------------------

// True when `path` lies strictly inside the real temporary directory.
export function isUnderTemp(path: string): boolean {
  const base = realpathSync(tmpdir());
  let real = resolve(path);
  try {
    real = realpathSync(real);
  } catch {
    // Not created yet: the resolved path stands.
  }
  return real.startsWith(`${base}${sep}`);
}

// The override variables each host reads, and the only ones isolatedHostEnv accepts for it.
export const HOST_OVERRIDE_VARIABLES: Readonly<Record<LiveHostId, readonly string[]>> = Object.freeze({
  claude: Object.freeze(["CLAUDE_CONFIG_DIR"]),
  codex: Object.freeze(["CODEX_HOME"]),
  opencode: Object.freeze([] as string[]),
  kimi: Object.freeze(["KIMI_SHARE_DIR"]),
  "kimi-code": Object.freeze(["KIMI_CODE_HOME"]),
  qwen: Object.freeze(["QWEN_HOME"]),
  pi: Object.freeze(["PI_CODING_AGENT_DIR"]),
  hermes: Object.freeze(["HERMES_HOME"]),
  cursor: Object.freeze([] as string[]),
  // XDG_CONFIG_HOME is already inside the isolated root; the override names the same directory explicitly.
  kilo: Object.freeze(["XDG_CONFIG_HOME"]),
  copilot: Object.freeze(["COPILOT_HOME"]),
  augment: Object.freeze(["AUGMENT_CACHE_DIR"]),
  codebuddy: Object.freeze(["CODEBUDDY_CONFIG_DIR"]),
  cline: Object.freeze(["CLINE_DIR"]),
  "prime-agent": Object.freeze(["PRIME_AGENT_CODING_AGENT_DIR"]),
  // Grok Build documents no relocation variable (40-CONTEXT E-40-08): its isolated runs set HOME, which the isolated environment always does.
  "grok-build": Object.freeze([] as string[]),
});

export interface IsolatedHostEnvOptions {
  // The directory that holds the stub `realm`: first on PATH.
  readonly stubDir: string;
  // The directory of the host executable: second on PATH.
  readonly hostBinDir?: string;
  // Further PATH directories after the host's own and before /usr/bin:/bin (for a host that is a script needing `node`).
  readonly extraPathDirs?: readonly string[];
  // The environment LANG and TERM are read from. Nothing else of it is ever copied.
  readonly source?: EnvironmentLike;
  // Override variable -> absolute path under `root`; only the variables of HOST_OVERRIDE_VARIABLES[host].
  readonly overrides?: Readonly<Record<string, string>>;
}

function requireTemp(path: string, what: string): void {
  if (!isUnderTemp(path)) {
    throw new Error(`${what} must lie inside the temporary directory; refusing to build a host environment that could touch a real configuration`);
  }
}

// A fresh environment built from an allowlist, never from the whole process environment: PATH (the stub directory, the host's
// directory, /usr/bin:/bin), LANG, TERM, and HOME, TMPDIR and the four XDG directories inside `root`, plus only the override
// variables the caller names for this host. No credential, token, proxy or *_API_KEY variable ever appears. Throws before it
// creates anything when `root`, the stub directory or an override path is not inside the temporary directory.
export function isolatedHostEnv(root: string, host: LiveHostId, options: IsolatedHostEnvOptions): Record<string, string> {
  requireTemp(root, "the isolated root");
  requireTemp(options.stubDir, "the stub directory");
  const overrides = options.overrides ?? {};
  for (const [name, path] of Object.entries(overrides)) {
    if (!HOST_OVERRIDE_VARIABLES[host].includes(name)) {
      throw new Error(`${name} is not an override variable of ${host}`);
    }
    requireTemp(path, `the override ${name}`);
  }
  const source = options.source ?? {};
  const dirs = { HOME: join(root, "home"), TMPDIR: join(root, "tmp"), XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state") };
  for (const dir of Object.values(dirs)) {
    mkdirSync(dir, { recursive: true });
  }
  const pathEntries = [options.stubDir, ...(options.hostBinDir === undefined ? [] : [options.hostBinDir]), ...(options.extraPathDirs ?? []), "/usr/bin", "/bin"];
  return {
    PATH: pathEntries.join(delimiter),
    LANG: source["LANG"] ?? "C.UTF-8",
    TERM: source["TERM"] ?? "dumb",
    ...dirs,
    ...overrides,
  };
}

// ---- Bounded process-group runner ------------------------------------------------------------------------------------------

// Failure bounds only: a pass never waits on them. Scaled by REALM_TEST_TIMEOUT_SCALE.
export const VALIDATOR_TIMEOUT_MS = 120_000;
export const PRODUCTION_TIMEOUT_MS = 300_000;
const OUTPUT_LIMIT_BYTES = 1024 * 1024;
export const GROUP_KILL_GRACE_MS = 2_000;
export const PIPE_CLOSE_GRACE_MS = 1_000;

export interface HostRunResult {
  // Undefined when the command could not start, was signalled or timed out.
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export class Capture {
  private readonly chunks: Buffer[] = [];
  private size = 0;

  push(chunk: Buffer): void {
    const room = OUTPUT_LIMIT_BYTES - this.size;
    if (room <= 0) {
      return;
    }
    const piece = chunk.length > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(piece);
    this.size += piece.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Runs `bin args` with no shell as the leader of its own process group, stdout and stderr capped at 1 MiB each. On timeout the whole
// group gets SIGTERM, then SIGKILL after 2 s; when the command ends on its own the group is swept with SIGKILL as well, so nothing
// the host started outlives the call. Never rejects.
export function runHost(bin: string, args: readonly string[], env: Readonly<Record<string, string>>, cwd: string, timeoutMs: number): Promise<HostRunResult> {
  return new Promise((resolveResult) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(bin, [...args], { env: { ...env }, cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolveResult({ exitCode: undefined, stdout: "", stderr: messageOf(error), timedOut: false });
      return;
    }
    const stdout = new Capture();
    const stderr = new Capture();
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    const { pid } = child;
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let hardTimer: NodeJS.Timeout | undefined;
    let exitTimer: NodeJS.Timeout | undefined;
    const finish = (exitCode: number | undefined, note?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(hardTimer);
      clearTimeout(exitTimer);
      if (pid !== undefined) {
        signalGroup(pid, "SIGKILL");
      }
      resolveResult({ exitCode, stdout: stdout.text(), stderr: note === undefined ? stderr.text() : `${stderr.text()}${note}`, timedOut });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (pid === undefined) {
        return;
      }
      signalGroup(pid, "SIGTERM");
      killTimer = setTimeout(() => {
        signalGroup(pid, "SIGKILL");
        hardTimer = setTimeout(() => {
          finish(undefined);
        }, GROUP_KILL_GRACE_MS);
      }, GROUP_KILL_GRACE_MS);
    }, timeoutMs);
    child.on("error", (error) => {
      finish(undefined, messageOf(error));
    });
    child.on("exit", (code) => {
      // The pipes normally close with the process; a grandchild that kept them open is not waited for beyond a short grace.
      exitTimer = setTimeout(() => {
        finish(timedOut ? undefined : (code ?? undefined));
      }, PIPE_CLOSE_GRACE_MS);
    });
    child.on("close", (code) => {
      finish(timedOut ? undefined : (code ?? undefined));
    });
  });
}

const CLIP_LIMIT = 300;

function clip(text: string): string {
  const trimmed = text.trim();
  return JSON.stringify(trimmed.length > CLIP_LIMIT ? `${trimmed.slice(0, CLIP_LIMIT)}...` : trimmed);
}

// One line for an assertion message: the exit, then the clipped output.
export function describeRun(result: Pick<HostRunResult, "exitCode" | "stdout" | "stderr"> & { readonly timedOut?: boolean }): string {
  const exit = result.timedOut === true ? "did not return (timed out)" : result.exitCode === undefined ? "did not exit" : `exit ${String(result.exitCode)}`;
  return `${exit}; stdout ${clip(result.stdout)}; stderr ${clip(result.stderr)}`;
}

// Fails a test with the sentence `did not return` when the command timed out instead of finishing.
export function requireReturned(result: HostRunResult, label: string): void {
  assert.equal(result.timedOut, false, `${label}: did not return within the bound; ${describeRun(result)}`);
}

// Whether a process is alive. A zombie waiting to be reaped is not: a killed grandchild whose parent is gone stays one until init
// reaps it, and the group kill's job is done at the signal.
export function processAlive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${String(pid)}/stat`, "utf8");
    // The state letter follows the last `)` of the command name, which may itself hold one.
    const state = stat.slice(stat.lastIndexOf(")") + 2)[0];
    return state !== undefined && state !== "Z" && state !== "X";
  } catch {
    if (existsSync("/proc/self")) {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---- Small helpers ---------------------------------------------------------------------------------------------------------

// The sha256 of a file, or null when it does not exist. The content is never read into a message.
export function fileSha256(path: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return null;
  }
}

const ESCAPE = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESCAPE}\\[[0-9;?]*[A-Za-z]`, "g");

// Terminal output without its colour and cursor sequences.
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

// The single JSON object a successful realm command printed on one line. The command must have exited 0.
export function cliJson(result: CliResult, label: string): Record<string, unknown> {
  assert.equal(result.exitCode, 0, `${label}: exit ${String(result.exitCode)}; stderr ${clip(result.stderr)}`);
  const parsed: unknown = JSON.parse(result.stdout.trim());
  assert.ok(isRecord(parsed), `${label} must print one JSON object`);
  return parsed;
}

// The refusal reason of a failed `realm host install|uninstall`: the word after the command in its stderr line, or undefined.
export function refusalReasonOf(result: CliResult): string | undefined {
  return /^realm host (?:install|uninstall): ([a-z-]+):/.exec(result.stderr)?.[1];
}

// The owned `[mcp_servers.realm]` table of a Codex config, byte for byte (its header through its last key line, line endings
// included), or undefined when the table is absent or defined in any other form.
export function ownedTableOf(text: string): string | undefined {
  const found = locateTomlTable(text, ["mcp_servers", "realm"]);
  return found.state === "present" ? text.slice(found.start, found.end) : undefined;
}

// ---- Rig: one isolated root ------------------------------------------------------------------------------------------------

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;

export interface HostRigOptions {
  readonly host: LiveHostId;
  // The resolved absolute host executable.
  readonly bin: string;
  // Override variable -> directory name below the root (created): CLAUDE_CONFIG_DIR, CODEX_HOME or KIMI_SHARE_DIR.
  readonly overrides?: Readonly<Record<string, string>>;
}

export interface HostRig {
  readonly root: string;
  readonly home: string;
  // The project directory the host commands run in.
  readonly cwd: string;
  readonly stateDir: string;
  readonly env: Readonly<Record<string, string>>;
  readonly bin: string;
  // `root`-relative path to an absolute one.
  readonly path: (...parts: readonly string[]) => string;
  // `realm host <words>` in process, on the real table and the real adapters directory, against this rig's own state directory.
  readonly realm: (words: readonly string[]) => Promise<CliResult>;
  // The host's own command, in the isolated environment.
  readonly host: (args: readonly string[], options?: { readonly timeoutMs?: number; readonly cwd?: string }) => Promise<HostRunResult>;
  // The invocations the stub realm recorded.
  readonly stubInvocations: () => string[][];
  // The receipt file of a host in this rig's state directory.
  readonly receiptFile: (host: LiveHostId) => string;
  readonly dispose: () => void;
}

// One isolated root under the temporary directory with an isolated HOME, XDG directories and TMPDIR, the stub realm first on PATH, a
// state directory of its own and a project directory. The root is removed by `t.after` of the caller via dispose().
export function createHostRig(options: HostRigOptions, source: EnvironmentLike): HostRig {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rlh-")));
  const stubDir = join(root, "stub");
  const stubLog = join(root, "stub.log");
  writeStubRealm(stubDir, stubLog);
  const overrides: Record<string, string> = {};
  for (const [name, dir] of Object.entries(options.overrides ?? {})) {
    const absolute = join(root, dir);
    mkdirSync(absolute, { recursive: true });
    overrides[name] = absolute;
  }
  const env = isolatedHostEnv(root, options.host, { stubDir, hostBinDir: dirname(options.bin), extraPathDirs: [dirname(process.execPath)], source, overrides });
  const cwd = join(root, "proj");
  const stateDir = join(root, "realm-state");
  mkdirSync(cwd);
  mkdirSync(stateDir, { mode: 0o700 });
  const home = env["HOME"];
  assert.ok(home !== undefined, "the isolated environment names its HOME");
  return {
    root,
    home,
    cwd,
    stateDir,
    env,
    bin: options.bin,
    path: (...parts) => join(root, ...parts),
    realm: (words) =>
      runCli(["host", ...words], {
        env,
        readConfig: () => ({ image: IMAGE, stateDir, workspaceRoot: join(root, "projects") }),
        now: () => new Date(),
      }),
    host: (args, runOptions = {}) => runHost(options.bin, args, env, runOptions.cwd ?? cwd, runOptions.timeoutMs ?? scaledMs(VALIDATOR_TIMEOUT_MS)),
    stubInvocations: () => readStubArgv(stubLog),
    receiptFile: (host) => join(stateDir, "hosts", `${host}.receipt.json`),
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---- Production tier -------------------------------------------------------------------------------------------------------

const REAL_HOST_TIMEOUT_MS = PRODUCTION_TIMEOUT_MS;
const REALM_COMMAND_TIMEOUT_MS = 60_000;
const DOWN_TIMEOUT_MS = 120_000;
const POLL_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;
// The host command of the default drive must return below this bound: it is below OpenCode's 30 s connect timeout, so a host whose
// own health check fits the shortest known connect timeout passes, and one that waits for the sandbox does not (33-CONTEXT D-33-07).
const COLD_CONNECT_BOUND_MS = 25_000;

// `realm down` for a project whose session never became active: the host's health check left mid bring-up, so the daemon may be absent or
// hold no session. The CLI answers that with exit 0 ("already down") or a refusal naming REALM_NOT_ACTIVE or an absent daemon; anything else fails.
export function downAcceptable(result: Pick<CommandResult, "exitCode" | "stdout" | "stderr">): boolean {
  return result.exitCode === 0 || /REALM_NOT_ACTIVE|daemon absent|already down/.test(`${result.stdout}\n${result.stderr}`);
}

// The session drive: the host command is the host binary run with `args` against `provider`, a loopback provider that refuses every
// request. The session is ended once the boot is observed, or judged from the wire when the host exits on its own.
// The default drive (no `drive`) runs `<host> mcp list`.
export interface HostSessionDrive {
  readonly kind: "session";
  readonly provider: RefusingProvider;
  readonly args: readonly string[];
  // Variables added to the host command's environment only, never to the realm commands the runner runs (Kimi Code needs a key variable
  // and a base URL to define a provider at all; 43-CONTEXT E-43-08).
  readonly env?: Readonly<Record<string, string>>;
  // none (the default): the host must send no Authorization header. fixed-key: the host may send the one fixed non-secret key the provider
  // was started with (`startRefusingProvider({ expectedKey })`) and every header it sends must carry exactly that key.
  readonly credential?: "none" | "fixed-key";
}

// The command drive: the host command is the host binary run with `args` (a health check that launches the registered server and exits,
// `kimi mcp test realm`). `restore` names the scenario variables the host does not forward to a stdio server (the legacy Kimi CLI
// forwards HOME and PATH only, 43-CONTEXT E-43-09): the wire recorder gives them back to the server and logs the names, never a value.
// The two optional members are the phase 47 switches and change nothing when absent: `warm` brings the project's session up before the
// host command (a diagnostic control), and `evidence` keeps the run's wire log, full command output and server stderr in a checked
// evidence directory outside the repository, written before any assertion of the run, with a reach observation after the command.
export interface HostCommandDrive {
  readonly kind: "command";
  readonly args: readonly string[];
  readonly restore: readonly string[];
  readonly warm?: boolean;
  readonly evidence?: RunEvidenceSettings;
  // The Phase 48 members, all optional and inert when absent (the Phase 43 and 47 drives are unchanged):
  // `rootArgs` adds arguments after `args` that name a path inside the scenario root (a per-run leader socket); `force` names scenario
  // variables the recorder gives the real server with the ACCOUNT's value even though the host forwards another one (Grok Build runs with
  // an isolated HOME, 48-CONTEXT E-48-10); `exitCodes` are the exit codes of the host command that are not a failure (default: 0);
  // `boundedConnect` false drops the cold connect bound of a health check (the failure bound still applies; default true); `output` says
  // what a diagnostic prints of the command's output (`first-line`, the default, or `check-names`: only the names of the doctor checks);
  // `wire` is the assertion mode (default full; handshake-only only for a drive that sends no tools/list).
  readonly rootArgs?: (scenarioRoot: string) => readonly string[];
  readonly force?: readonly string[];
  readonly exitCodes?: readonly number[];
  readonly boundedConnect?: boolean;
  readonly output?: "first-line" | "check-names";
  readonly wire?: WireMode;
}

export type HostDrive = HostSessionDrive | HostCommandDrive;

export type HostProductionId = "claude" | "codex" | "opencode" | "kimi" | "kimi-code" | "muse-code" | "grok-build";

export interface HostProductionOptions {
  readonly host: HostProductionId;
  // The resolved absolute host executable and the compiled CLI beside the compiled tests.
  readonly bin: string;
  readonly cliPath: string;
  readonly env: EnvironmentLike;
  // The operator's real host configuration file: its sha256 must be equal before and after the run.
  readonly realFile: (home: string) => string;
  readonly drive?: HostDrive;
  // Phase 48: the recipes the run installs, the host id the attach is attributed to and the audit rule. Absent: the five original hosts run
  // exactly as before (their own recipe, no audit read, no argument check).
  readonly attribution?: AttributionCheck;
}

// The line(s) of a host listing that name the realm server.
function realmLines(listing: string): string[] {
  return stripAnsi(listing)
    .split("\n")
    .filter((line) => /(^|[^\w-])realm([^\w-]|$)/.test(line));
}

// The boot reports the daemon recorded for `host` in `realm metrics` output, summed per phase over the hostBoot rows. A missing or
// unparsable hostBoot member, a row of another host and a row whose count is not a number contribute nothing.
export function bootPhaseCountsOf(stdout: string, host: string): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return counts;
  }
  const rows = isRecord(parsed) ? parsed["hostBoot"] : undefined;
  if (!Array.isArray(rows)) {
    return counts;
  }
  for (const row of rows as unknown[]) {
    if (isRecord(row) && row["hostId"] === host && typeof row["phase"] === "string" && typeof row["count"] === "number") {
      counts[row["phase"]] = (counts[row["phase"]] ?? 0) + row["count"];
    }
  }
  return counts;
}

// The number of `attached` boot reports for `host`: the evidence of a host that was still alive when the session became ready.
function attachedBootsOf(stdout: string, host: string): number {
  return bootPhaseCountsOf(stdout, host)["attached"] ?? 0;
}

function presenceEntries(stateDir: string, host: string): string[] {
  const dir = join(stateDir, "hosts", `${host}-active`);
  return existsSync(dir) ? readdirSync(dir) : [];
}

// The directory of Grok Build's isolated HOME below the scenario root (48-CONTEXT E-48-10: Grok documents no relocation variable, so its
// scenario runs with HOME set here and the recorder gives the real `realm mcp` the account's HOME).
export const GROK_HOME_DIR = "grok-home";

// What a production run saw of the attach before the host command: the number of host boot audit lines and the presence directories.
interface AttributionBefore {
  readonly auditLines: number;
  readonly presence: readonly string[];
}

// The attach as the daemon and the state directory show it after the host command: the attach audit lines written since `before` (the
// daemon's host boot audit file), the presence directories that are new (the attributed host's own counts even when it existed before, as
// a directory cannot say who made it), and the attached boot reports of the attributed host in `realm metrics`.
async function observeAttribution(inputs: LiveInputs, scenario: ScenarioEnvironment, projectDir: string, check: AttributionCheck, before: AttributionBefore): Promise<AttributionObserved> {
  const metrics = await realmCli(inputs, scenario, ["metrics", "--workspace", projectDir], REALM_COMMAND_TIMEOUT_MS);
  const wanted = `${check.attributedTo}-active`;
  return {
    attributedTo: check.attributedTo,
    audit: attachAuditOf(bootAuditLinesOf(scenario.stateDir).slice(before.auditLines)),
    createdPresence: presenceDirsOf(scenario.stateDir).filter((name) => name === wanted || !before.presence.includes(name)),
    attachedBoots: metrics.exitCode === 0 ? attachedBootsOf(metrics.stdout, check.attributedTo) : 0,
  };
}

// The attribution assertion of a run. A mandatory rule (the attribution tests) polls until the audit line, the presence directory and the
// attached boot report all name the attributed host, and fails with the problems otherwise: the audit line is read, never inferred. A
// diagnostic rule (the plain production tests) reads once and prints; the wire and the quiet end decide there.
async function checkAttribution(t: TestContext, inputs: LiveInputs, scenario: ScenarioEnvironment, projectDir: string, check: AttributionCheck, before: AttributionBefore): Promise<void> {
  const seen: { current?: AttributionObserved } = {};
  const observe = async (): Promise<AttributionObserved> => {
    seen.current = await observeAttribution(inputs, scenario, projectDir, check, before);
    return seen.current;
  };
  if (check.audit === "required") {
    const outcome = await pollUntil(
      async () => {
        const problems = attributionProblems(await observe());
        return problems.length === 0 ? { done: true } : { done: false, detail: problems.join("; ") };
      },
      { timeoutMs: scaledMs(POLL_TIMEOUT_MS), intervalMs: POLL_INTERVAL_MS },
    );
    const last = seen.current;
    if (last !== undefined) {
      t.diagnostic(`attribution to ${check.attributedTo}: audit ${describeAudit(last.audit)}; presence directories [${last.createdPresence.join(", ")}]; attached boot reports ${String(last.attachedBoots)}`);
    }
    assert.ok(outcome.ok, `the attach must be attributed to ${check.attributedTo}: ${outcome.detail}`);
    return;
  }
  const once = await observe();
  t.diagnostic(`attribution to ${check.attributedTo} (diagnostic): audit ${describeAudit(once.audit)}; presence directories [${once.createdPresence.join(", ")}]; attached boot reports ${String(once.attachedBoots)}${once.attachedBoots === 0 ? "; the host left before the realm was ready (judged from the wire)" : ""}`);
}

// The host's own configuration home inside the scenario, created here: Claude a `cfg` directory named by CLAUDE_CONFIG_DIR, Codex a
// `codex` directory named by CODEX_HOME, OpenCode the `opencode` directory beside the scenario's realm/config.json (both tools read
// their own subdirectory of one XDG_CONFIG_HOME), Kimi a `kimi` directory named by KIMI_SHARE_DIR, Kimi Code a `kimi-code` directory named
// by KIMI_CODE_HOME, Muse Code the `muse` directory of the scenario's XDG_CONFIG_HOME (as OpenCode), Grok Build a HOME of its own
// (GROK_HOME_DIR; no relocation variable exists). Returns the override variables to add to the scenario environment. A host that is none
// of these is a programming error.
export function productionOverrides(host: HostProductionId, scenarioRoot: string, configHome: string): Record<string, string> {
  const overrides: Record<string, string> = {};
  switch (host) {
    case "claude":
      overrides["CLAUDE_CONFIG_DIR"] = join(scenarioRoot, "cfg");
      break;
    case "codex":
      overrides["CODEX_HOME"] = join(scenarioRoot, "codex");
      break;
    case "opencode":
      mkdirSync(join(configHome, "opencode"), { recursive: true });
      break;
    case "kimi":
      overrides["KIMI_SHARE_DIR"] = join(scenarioRoot, "kimi");
      break;
    case "kimi-code":
      overrides["KIMI_CODE_HOME"] = join(scenarioRoot, "kimi-code");
      break;
    case "muse-code":
      mkdirSync(join(configHome, "muse"), { recursive: true });
      break;
    case "grok-build":
      overrides["HOME"] = join(scenarioRoot, GROK_HOME_DIR);
      break;
    default:
      throw new Error(`no production configuration home is defined for host ${String(host)}`);
  }
  for (const dir of Object.values(overrides)) {
    mkdirSync(dir, { recursive: true });
  }
  return overrides;
}

// The warm control of the command drive (phase 47, a diagnostic variant, never the production tier): the project's session is brought up
// and answers active before the host command, so the host attaches to a stack that is no longer cold. Every wait is bounded; the cleanup
// of the production scenario still brings the project down. It lives beside the other drive helpers, outside the production body, which
// attaches cold and is pinned never to bring a session up itself.
async function warmControl(inputs: LiveInputs, scenario: ScenarioEnvironment, projectDir: string, status: () => Promise<CommandResult>): Promise<void> {
  const started = await realmCli(inputs, scenario, ["up", "--workspace", projectDir], scaledMs(DOWN_TIMEOUT_MS));
  assert.equal(started.exitCode, 0, `the warm control: the session did not start: ${describeResult(started)}`);
  const warmed = await pollUntil(
    async () => {
      const answer = await status();
      return answer.exitCode === 0 && stateOfStatus(answer.stdout) === "active" ? { done: true } : { done: false, detail: describeResult(answer) };
    },
    { timeoutMs: scaledMs(POLL_TIMEOUT_MS), intervalMs: POLL_INTERVAL_MS },
  );
  assert.ok(warmed.ok, `the warm control: the session must be active before the host command: ${warmed.detail}`);
}

// The cold snapshot of an evidence run (47-CONTEXT D-47-04): no daemon of the account (no control socket), 0 containers, 0 sandboxes and an
// empty workspace root. A listing that fails is not cold.
async function isColdStack(inputs: LiveInputs, scenario: ScenarioEnvironment): Promise<boolean> {
  try {
    const containers = await listContainers(inputs);
    const sandboxes = await listRealmSandboxes(inputs);
    return containers.ok && containers.items.length === 0 && sandboxes.ok && sandboxes.items.length === 0 && readdirSync(inputs.workspaceRoot).length === 0 && !existsSync(controlSocketPath(scenario.stateDir));
  } catch {
    return false;
  }
}

interface ReachSeamInputs {
  readonly inputs: LiveInputs;
  readonly scenario: ScenarioEnvironment;
  readonly host: string;
  readonly projectDir: string;
  readonly sandbox: string;
  readonly serverStderrFile: string;
}

// The production seams of the reach observation: `realm status`, the containers and sandboxes of the project, the attached boot reports of
// `realm metrics`, and the catalogue codes of the server's stderr copy. A listing that fails throws, which the observation records as a
// failed seam of that poll.
function productionReachSeams(seam: ReachSeamInputs): ReachSeams {
  const { inputs, scenario } = seam;
  return {
    status: async () => {
      const status = await realmCliWithWorkspace(inputs, scenario, ["status"], seam.projectDir, REALM_COMMAND_TIMEOUT_MS);
      return status.exitCode === 0 ? stateOfStatus(status.stdout) : undefined;
    },
    containers: async () => {
      const listing = await listSandboxContainers(inputs, seam.sandbox);
      if (!listing.ok) {
        throw new Error("the container listing failed");
      }
      return listing.items.length;
    },
    sandboxes: async () => {
      const listing = await listSandboxesNamed(inputs, seam.sandbox);
      if (!listing.ok) {
        throw new Error("the sandbox listing failed");
      }
      return listing.items.length;
    },
    attached: async () => {
      const metrics = await realmCli(inputs, scenario, ["metrics", "--workspace", seam.projectDir], REALM_COMMAND_TIMEOUT_MS);
      if (metrics.exitCode !== 0) {
        throw new Error("realm metrics failed");
      }
      return attachedBootsOf(metrics.stdout, seam.host);
    },
    stderrCodes: () => Promise.resolve(existsSync(seam.serverStderrFile) ? catalogueCodesIn(readFileSync(seam.serverStderrFile, "utf8")) : []),
    clock: {
      now: () => performance.now(),
      sleep: (ms) =>
        new Promise<void>((done) => {
          setTimeout(done, ms);
        }),
    },
  };
}

interface KeptRun {
  readonly evidence: RunEvidenceSettings;
  readonly restore: readonly string[];
  readonly warm: boolean;
  readonly cold: boolean;
  readonly elapsedMs: number;
  readonly ran: HostRunResult;
  readonly wireLog: string;
  readonly serverStderrFile: string;
  readonly seams: ReachSeams;
}

// Observes the reach of the stack, then writes the run folder. Every failure is a diagnostic: this never throws, so it cannot mask the
// run's own failure, and the reach observation records a failing seam in its own record.
async function keepRunEvidence(t: TestContext, kept: KeptRun): Promise<void> {
  try {
    const reach = await observeReach(kept.seams, { windowMs: scaledMs(REACH_WINDOW_MS) });
    t.diagnostic(`reach: ${reach.reached ? "the stack was reached" : "the stack was not reached"} after ${String(reach.polls.length)} poll(s)${reach.failedSeams.length > 0 ? `; failed observations [${reach.failedSeams.join(", ")}]` : ""}`);
    const written = writeRunEvidence({
      settings: kept.evidence,
      restore: kept.restore,
      warm: kept.warm,
      cold: kept.cold,
      elapsedMs: kept.elapsedMs,
      returned: !kept.ran.timedOut,
      ...(kept.ran.exitCode === undefined ? {} : { exitCode: kept.ran.exitCode }),
      wireLog: kept.wireLog,
      stdout: kept.ran.stdout,
      stderr: kept.ran.stderr,
      serverStderrFile: kept.serverStderrFile,
      reach,
    });
    t.diagnostic(`run evidence kept in the run folder ${basename(written.folder)}${written.failures.length > 0 ? `; members not written [${written.failures.join(", ")}]` : ""}`);
  } catch {
    t.diagnostic("run evidence could not be kept");
  }
}

// The production-tier scenario of claude, codex, opencode, kimi, kimi-code, muse-code and grok-build. The default drive is the real host's own health check (`<host> mcp list`):
// it performs a real MCP handshake (initialize or server/discover) against `realm mcp --host <id>` on the production stack. The session drive (codex, kimi-code) runs the host as a
// session against a refusing loopback provider and ends it once the daemon shows the boot and the recorder shows the tool listing. The
// command drive (kimi, muse-code, grok-build) runs the host's own command (`kimi mcp test realm`, `muse exec --provider echo`, `grok mcp doctor`) and gives the recorder the scenario variables the host does not forward. The
// registered `realm` is a wire recorder: it forwards the stream to the real CLI and logs method names, tool names and the server start. The gate has
// already passed. The host's configuration home is isolated (CLAUDE_CONFIG_DIR, CODEX_HOME, KIMI_SHARE_DIR, KIMI_CODE_HOME, or the
// scenario's own XDG_CONFIG_HOME for opencode and muse-code); HOME stays the account's, because the daemon the host starts needs it (Phase 22 measured AGENTOS_STOP_FAILED with a profile
// HOME). The one exception is Grok Build, which has no relocation variable (48-CONTEXT E-48-10): it runs with HOME set to a scenario directory and the recorder
// gives the real `realm mcp` the account's HOME (forced, names logged, never values). The operator's real host file must be byte-equal afterwards. No model turn happens and no credential is used.
// With `attribution` (Phase 48) the run also installs the named recipes, asserts the server start (exactly `mcp --host ID`, once), and reads the attach audit line, the presence directory and the attached boot report of the attributed host.
export async function runHostProduction(t: TestContext, options: HostProductionOptions): Promise<void> {
  const { host } = options;
  const { attribution } = options;
  // The recipes the run installs and the host id the attach is attributed to: the host's own, unless the attribution says otherwise.
  const installs: readonly string[] = attribution?.installs ?? [host];
  const attributedTo: string = attribution?.attributedTo ?? host;
  const touched: readonly string[] = [...new Set<string>([host, ...installs, attributedTo])];
  const inputs: LiveInputs = readLiveInputs(options.env, options.cliPath);
  const hostsDir = inputs.driverStateDir === undefined ? undefined : join(inputs.driverStateDir, "hosts");
  const hostsDirExisted = hostsDir !== undefined && existsSync(hostsDir);
  const presenceExisted = new Map<string, boolean>(touched.map((id): [string, boolean] => [id, hostsDir !== undefined && existsSync(join(hostsDir, `${id}-active`))]));
  // A recipe the run installs beside the host's own (the Claude file) must not collide with a real install: its receipt must be absent.
  for (const id of installs) {
    if (id !== host && hostsDir !== undefined) {
      assert.equal(existsSync(join(hostsDir, `${id}.receipt.json`)), false, `the shared state directory already holds a Realm host receipt for ${id}; refusing to touch a real install`);
    }
  }

  const scenario: ScenarioEnvironment = createScenarioEnvironment(inputs, { image: inputs.image });
  const hostHome = scenario.cliEnvironment["HOME"];
  assert.ok(hostHome !== undefined, "the scenario environment must name the account home");
  const configHome = scenario.cliEnvironment["XDG_CONFIG_HOME"];
  assert.ok(configHome !== undefined, "the scenario environment must name its configuration home");
  const realFile = options.realFile(hostHome);
  const realBefore = fileSha256(realFile);
  const alsoReal = attribution?.alsoReal?.(hostHome) ?? [];
  const alsoBefore = alsoReal.map((path) => fileSha256(path));
  // The cold snapshot of an evidence run is taken before this run creates anything (its project directory included).
  const evidence = options.drive?.kind === "command" ? options.drive.evidence : undefined;
  const cold = evidence === undefined ? false : await isColdStack(inputs, scenario);

  const suffix = randomBytes(6).toString("hex");
  const projectDir = join(inputs.workspaceRoot, `host-boot-${host}-${suffix}`);
  // The directory must exist first: sandboxNameFor resolves its real path. The cleanup below runs `realm down` only while it exists.
  mkdirSync(projectDir);
  const sandboxes = [sandboxNameFor(projectDir)];
  const cleanups = createCleanups();
  t.after(() => cleanups.run());
  // Set once the recipe is installed: the cleanup then uninstalls it, whatever failed in the body.
  const recipe: { uninstall?: () => Promise<void> } = {};
  cleanups.add(async () => {
    // Every step runs even when an earlier one fails (the failures are reported together at the end), so a failed assertion never
    // leaves the host receipt behind: the next run's gate refuses to start over a Realm receipt for the host.
    const failures: unknown[] = [];
    const step = async (work: () => void | Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (error) {
        failures.push(error);
      }
    };
    // The body removes projectDir after its own `realm down`; the safety-net down runs only while the directory exists (realm down on a
    // removed directory is refused as POLICY_DENIED).
    await step(async () => {
      if (existsSync(projectDir)) {
        const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
        assert.ok(downAcceptable(stopped), `realm down: ${describeResult(stopped)}`);
      }
    });
    await step(async () => {
      await recipe.uninstall?.();
    });
    await step(() => {
      restoreSharedPolicy(scenario);
    });
    await step(() => {
      removeSharedStateCreatedBy(scenario);
    });
    await step(() => {
      if (hostsDir !== undefined) {
        // The receipts and the presence directories of this run. Nothing that existed before the run is removed.
        for (const id of touched) {
          rmSync(join(hostsDir, `${id}.receipt.json`), { force: true });
          if (presenceExisted.get(id) !== true) {
            rmSync(join(hostsDir, `${id}-active`), { recursive: true, force: true });
          }
        }
        if (!hostsDirExisted) {
          rmSync(hostsDir, { recursive: true, force: true });
        }
      }
    });
    await step(() => {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(scenario.root, { recursive: true, force: true });
    });
    await step(async () => {
      const residue = await waitForNoResidue(inputs, sandboxes);
      assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
    });
    if (failures.length > 0) {
      throw new AggregateError(failures, `host production cleanup: ${failures.map((failure) => (failure instanceof Error ? failure.message : String(failure))).join("; ")}`);
    }
  });

  // The host's own configuration home (productionOverrides).
  const overrides = productionOverrides(host, scenario.root, configHome);
  const shimDir = join(scenario.root, "shim");
  const wireLog = join(scenario.root, "wire.log");
  // The production PATH stays ahead of the host binary's directory: the host spawns `realm mcp`, which probes `podman --version`, and
  // the production Podman 5 sits early on that PATH while the host's own directory (for example /usr/bin) may hold Podman 4.
  const productionPath = inputs.hostEnvironment["PATH"];
  const pathValue = [shimDir, productionPath, dirname(options.bin)].filter((entry): entry is string => entry !== undefined && entry !== "").join(delimiter);
  const env: Readonly<Record<string, string>> = { ...scenario.cliEnvironment, PATH: pathValue, ...overrides };
  // The names a command drive gives back to the server: each must exist in the scenario environment, else the drive is wrong.
  const { drive } = options;
  const restoreEnv: Record<string, string> = {};
  for (const name of drive?.kind === "command" ? drive.restore : []) {
    const value = env[name];
    if (value === undefined) {
      throw new Error(`the command drive restores ${name}, which the scenario environment does not define`);
    }
    restoreEnv[name] = value;
  }
  // The names forced to the ACCOUNT's value (Grok's HOME): the scenario environment's own value, not the host's isolated one.
  const forceEnv: Record<string, string> = {};
  for (const name of drive?.kind === "command" ? (drive.force ?? []) : []) {
    const value = scenario.cliEnvironment[name];
    if (value === undefined) {
      throw new Error(`the command drive forces ${name}, which the scenario environment does not define`);
    }
    forceEnv[name] = value;
  }
  const wireMode: WireMode = drive?.kind === "command" ? (drive.wire ?? "full") : "full";
  const serverStderrFile = join(scenario.root, "server-stderr.txt");
  writeWireRecorder(shimDir, {
    nodePath: process.execPath,
    target: [process.execPath, options.cliPath],
    logFile: wireLog,
    ...(drive?.kind === "command" ? { restoreEnv } : {}),
    ...(Object.keys(forceEnv).length === 0 ? {} : { forceEnv }),
    ...(evidence === undefined ? {} : { stderrFile: serverStderrFile }),
  });

  const realmHost = (words: readonly string[]): Promise<CliResult> => runCli(["host", ...words], { env, now: () => new Date() });
  const realmStatus = (): Promise<CommandResult> => realmCliWithWorkspace(inputs, scenario, ["status"], projectDir, REALM_COMMAND_TIMEOUT_MS);
  const liveSessionsOf = async (): Promise<number> => {
    const row = cliJson(await realmHost(["status", attributedTo]), `realm host status ${attributedTo}`);
    const plugin = row["plugin"];
    const sessions = isRecord(plugin) ? plugin["sessions"] : undefined;
    const live = isRecord(sessions) ? sessions["live"] : undefined;
    return typeof live === "number" ? live : 0;
  };

  // Install through the real table against the scenario's state directory: the host's own recipe and, for the Grok attribution test, the
  // Claude file beside it. From the first install on, the cleanup uninstalls what is installed (a no-op when the body already did).
  const installedIds: string[] = [];
  recipe.uninstall = async () => {
    for (const id of [...installedIds].reverse()) {
      const removedAtEnd = await realmHost(["uninstall", id]);
      assert.equal(removedAtEnd.exitCode, 0, `realm host uninstall ${id} at cleanup: ${describeRun({ ...removedAtEnd, timedOut: false })}`);
    }
  };
  for (const id of installs) {
    const planned = cliJson(await realmHost(["install", id, "--dry-run"]), `realm host install ${id} --dry-run`);
    assert.equal(planned["dryRun"], true, `the dry run must say so: ${describeValue(planned)}`);
    const installed = cliJson(await realmHost(["install", id]), `realm host install ${id}`);
    installedIds.push(id);
    assert.equal(installed["status"], "installed", `the install must report installed: ${describeValue(installed)}`);
    const afterInstall = cliJson(await realmHost(["status", id]), `realm host status ${id}`);
    assert.equal(afterInstall["status"], "installed", `realm host status ${id} must report installed: ${describeValue(afterInstall)}`);
    assert.equal(afterInstall["launch"], "on-path", `the shim realm must resolve on PATH: ${describeValue(afterInstall)}`);
  }

  // The warm control, a diagnostic variant of the command drive only (see warmControl above).
  if (drive?.kind === "command" && drive.warm === true) {
    await warmControl(inputs, scenario, projectDir, realmStatus);
  }
  // What the attach audit and the presence directories hold before the host command: the attribution reads only what is new.
  const before: AttributionBefore = { auditLines: bootAuditLinesOf(scenario.stateDir).length, presence: presenceDirsOf(scenario.stateDir) };

  // The host attaches cold: nothing has started the daemon or the sandbox for this run's new project directory, so the host's own
  // `realm mcp` creates both. The host command is run from a directory under the pinned workspace root with the production PATH
  // ahead of the host binary's directory (set above: the host spawns `realm mcp`, which runs `podman --version`, and the production
  // Podman 5 must come first). A health check connects, lists the tools and leaves before the realm is ready, and that is correct: the
  // host tiers assert the connect within COLD_CONNECT_BOUND_MS and the six tools on the wire, not readiness. The recorder's wire summary
  // is what the tool listing is asserted from; the ready transition on one connection is proved by the cold attach probe.
  const wireText = (): string => {
    const summary = wireSummary(readWireLog(wireLog));
    return `host methods [${summary.hostMethods.join(", ")}], tools [${summary.toolNames.join(", ")}]`;
  };
  let commandElapsedMs: number | undefined;
  const startedAt = Date.now();
  if (drive === undefined) {
    // The host's own health check.
    const listed = await runHost(options.bin, ["mcp", "list"], env, projectDir, scaledMs(REAL_HOST_TIMEOUT_MS));
    requireReturned(listed, `${host} mcp list`);
    assert.equal(listed.exitCode, 0, `${host} mcp list: ${describeRun(listed)}`);
    const lines = realmLines(listed.stdout);
    assert.ok(lines.length > 0, `${host} mcp list must list realm: ${describeRun(listed)}`);
    const joined = lines.join("\n");
    assert.match(joined, /\bconnected\b/i, `${host} must report realm connected: ${describeRun(listed)}`);
    assert.doesNotMatch(joined, /\bfailed\b/i, `${host} must not report realm failed: ${describeRun(listed)}`);
    t.diagnostic(`${host} mcp list reported: ${JSON.stringify(joined.trim())}`);
    const connectMs = Date.now() - startedAt;
    t.diagnostic(`${host} mcp list returned after ${String(connectMs)} ms (the cold connect bound is ${String(COLD_CONNECT_BOUND_MS)} ms)`);
    assert.ok(connectMs < COLD_CONNECT_BOUND_MS, `${host} mcp list must return below ${String(COLD_CONNECT_BOUND_MS)} ms on a cold attach; it took ${String(connectMs)} ms`);
  } else if (drive.kind === "command") {
    // The host's own command (`kimi mcp test realm`): it launches the registered server through the recorder, connects, lists the tools
    // and returns. The legacy CLI's success wording is not known in advance (43-CONTEXT OQ-43-02), so no connected word is asserted:
    // the exit code, the elapsed time and the wire carry the proof, and the first line of its output is recorded.
    const ran = await runHost(options.bin, [...drive.args, ...(drive.rootArgs?.(scenario.root) ?? [])], env, projectDir, scaledMs(REAL_HOST_TIMEOUT_MS));
    const ranMs = Date.now() - startedAt;
    commandElapsedMs = ranMs;
    const label = `${host} ${drive.args.join(" ")}`;
    if (evidence !== undefined) {
      // The evidence of the run is kept before any assertion, so a failing run still leaves it. A failure here is a diagnostic and never
      // masks the run's own failure.
      t.diagnostic(`run label: ${evidence.label}`);
      await keepRunEvidence(t, {
        evidence,
        restore: drive.restore,
        warm: drive.warm === true,
        cold,
        elapsedMs: ranMs,
        ran,
        wireLog,
        serverStderrFile,
        seams: productionReachSeams({ inputs, scenario, host, projectDir, sandbox: sandboxNameFor(projectDir), serverStderrFile }),
      });
    }
    requireReturned(ran, label);
    if (drive.exitCodes === undefined) {
      assert.equal(ran.exitCode, 0, `${label}: ${describeRun(ran)}`);
    } else {
      assert.ok(ran.exitCode !== undefined && drive.exitCodes.includes(ran.exitCode), `${label}: the exit code must be one of [${drive.exitCodes.join(", ")}]; ${describeRun(ran)}`);
      t.diagnostic(`${label} exited ${String(ran.exitCode)} (accepted exit codes [${drive.exitCodes.join(", ")}])`);
    }
    const commandMs = ranMs;
    if (drive.output === "check-names") {
      t.diagnostic(`${label} printed the checks [${doctorCheckNames(stripAnsi(`${ran.stdout}\n${ran.stderr}`)).join(", ")}]`);
    } else {
      const firstLine =
        stripAnsi(`${ran.stdout}\n${ran.stderr}`)
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line !== "") ?? "";
      t.diagnostic(`${label} printed: ${JSON.stringify(firstLine.slice(0, 200))}`);
    }
    t.diagnostic(`${label} returned after ${String(commandMs)} ms; the recorder restored [${wireSummary(readWireLog(wireLog)).restoredNames.join(", ")}]`);
    if (drive.boundedConnect === false) {
      t.diagnostic(`${label} has no cold connect bound; its failure bound is ${String(scaledMs(REAL_HOST_TIMEOUT_MS))} ms`);
    } else {
      assert.ok(commandMs < COLD_CONNECT_BOUND_MS, `${label} must return below ${String(COLD_CONNECT_BOUND_MS)} ms on a cold attach; it took ${String(commandMs)} ms`);
    }
  } else {
    // A session may or may not outlive its handshake. While it runs, poll for the boot evidence (the recorder shows the tool listing,
    // `realm status` answers active and the daemon counts an attached boot report) and end the process group once it holds. A host that
    // finishes its turn and exits on its own (codex-cli 0.154.0 against the refusing provider exits within seconds, observed 2026-11-18)
    // takes its `realm mcp` child with it, usually before the realm is ready, so the ready observation can lose the race. The exit is
    // then judged from the wire alone, below.
    const bootSeen = async (): Promise<boolean> => {
      if (!wireSummary(readWireLog(wireLog)).answered) {
        return false;
      }
      const status = await realmStatus();
      if (status.exitCode !== 0 || stateOfStatus(status.stdout) !== "active") {
        return false;
      }
      const metrics = await realmCli(inputs, scenario, ["metrics", "--workspace", projectDir], REALM_COMMAND_TIMEOUT_MS);
      return metrics.exitCode === 0 && attachedBootsOf(metrics.stdout, host) >= 1;
    };
    const session = await runHostUntil(options.bin, drive.args, { ...env, ...drive.env }, projectDir, { ready: bootSeen, timeoutMs: scaledMs(REAL_HOST_TIMEOUT_MS), pollMs: POLL_INTERVAL_MS });
    if (session.endedBy === "exit") {
      // The host ended on its own, typically before the realm was ready: a health-check style exit must not need a started sandbox, so
      // this is a boot attach when the wire shows the handshake and tools/list with the six names. Readiness is not asserted (the
      // bring-up may have been cut with the host); the attached boot report is asserted only for a host that was still alive.
      const exited = wireSummary(readWireLog(wireLog));
      const handshook = exited.hostMethods.includes("initialize") || exited.hostMethods.includes("server/discover");
      const sixTools = exited.answered && [...exited.toolNames].join(",") === [...REALM_TOOL_NAMES].join(",");
      assert.ok(handshook && sixTools, `${host} session ended by exit before the boot was observed; wire: ${wireText()}; ${describeRun(session)}`);
      t.diagnostic(`${host} session ended by exit after the handshake and the six tools (readiness is proved by the cold attach probe)`);
    } else {
      assert.equal(session.endedBy, "ready", `${host} session ended by ${session.endedBy} before the boot was observed; wire: ${wireText()}; ${describeRun(session)}`);
    }
  }
  const elapsedMs = commandElapsedMs ?? Date.now() - startedAt;

  const summary = wireSummary(readWireLog(wireLog));
  t.diagnostic(`${host} wire: ${wireText()}; the host command took ${String(elapsedMs)} ms`);
  // The handshake differs by MCP era: a legacy-era host sends `initialize`, a modern-era host (claude 2.1.322, observed 2026-11-18) sends
  // `server/discover` and no initialize. Either is the host's own connect; tools/list and the six tools are still required below.
  assert.ok(
    summary.hostMethods.includes("initialize") || summary.hostMethods.includes("server/discover"),
    `the host must have sent initialize or server/discover to realm mcp; methods seen: [${summary.hostMethods.join(", ")}]; ${wireText()}`,
  );
  if (attribution !== undefined) {
    const problem = productionWireProblem({ summary, starts: readRecorderStarts(wireLog), host: attributedTo, mode: wireMode });
    assert.equal(problem, undefined, `${problem ?? "the wire"}; ${wireText()}`);
  }
  // The listing is part of every cold attach: the host connected, listed the Realm tools through the recorder, and may have left before
  // the realm was ready. The ready transition on one connection is proved by test/integration/cold-attach-live.test.ts, not here. A
  // handshake-only wire (a drive that sends no tools/list) asserts none of it and requires the attach to be counted instead.
  if (wireMode === "full") {
    assert.equal(summary.answered, true, `the host must have listed the Realm tools through the recorder: ${wireText()}`);
    assert.deepEqual([...summary.toolNames], [...REALM_TOOL_NAMES], `the listed tools must be the six Realm tools: ${wireText()}`);
  }
  if (attribution !== undefined) {
    await checkAttribution(t, inputs, scenario, projectDir, wireMode === "handshake-only" ? { ...attribution, audit: "required" } : attribution, before);
  }

  if (drive?.kind === "session") {
    // The provider saw no foreign credential and no foreign peer. Counts, flags and addresses only: never a header value.
    const requests = drive.provider.requests();
    const peers = [...new Set(requests.map((request) => request.peer))];
    const withAuthorization = requests.filter((request) => request.authorization).length;
    if (drive.credential === "fixed-key") {
      // The one fixed non-secret key of the rehearsal: every header a host sends must carry exactly that literal.
      const matched = requests.filter((request) => request.matchesKey === true).length;
      const mismatched = requests.filter((request) => request.matchesKey === false).length;
      t.diagnostic(`${host} provider: ${String(requests.length)} request(s), ${String(withAuthorization)} with an Authorization header, ${String(matched)} with the fixed key, peers [${peers.join(", ")}]`);
      assert.equal(withAuthorization, matched + mismatched, "the refusing provider must have been started with the fixed key (expectedKey) to judge the Authorization headers");
      assert.equal(mismatched, 0, `every credential-bearing request must carry the fixed non-secret key (${String(mismatched)} request(s) carried another one)`);
    } else {
      t.diagnostic(`${host} provider: ${String(requests.length)} request(s), ${String(withAuthorization)} with an Authorization header, peers [${peers.join(", ")}]`);
      assert.equal(withAuthorization, 0, `the refusing provider must never see an Authorization header (${String(withAuthorization)} request(s) carried one)`);
    }
    for (const peer of peers) {
      assert.ok(isLoopbackPeer(peer), `the refusing provider must only see loopback peers; saw ${peer}`);
    }
  }

  // The host command ended, so its realm session ended: no live session and an empty presence directory.
  const quiet = await pollUntil(
    async () => {
      const live = await liveSessionsOf();
      const markers = touched.flatMap((id) => presenceEntries(scenario.stateDir, id));
      return live === 0 && markers.length === 0 ? { done: true } : { done: false, detail: `live sessions ${String(live)}, presence markers ${String(markers.length)}` };
    },
    { timeoutMs: scaledMs(POLL_TIMEOUT_MS), intervalMs: POLL_INTERVAL_MS },
  );
  assert.ok(quiet.ok, `realm host status ${attributedTo} must show 0 live sessions and an empty presence directory after the command ends: ${quiet.detail}`);

  const stopped = await realmCliWithWorkspace(inputs, scenario, ["down"], projectDir, DOWN_TIMEOUT_MS);
  assert.ok(downAcceptable(stopped), `realm down: ${describeResult(stopped)}`);
  rmSync(projectDir, { recursive: true, force: true });
  const residue = await waitForNoResidue(inputs, sandboxes);
  assert.ok(residue.ok, `residue after realm down: ${residue.detail}`);
  for (const sandbox of sandboxes) {
    const containers = await listSandboxContainers(inputs, sandbox);
    assert.ok(containers.ok, `list the containers of ${sandbox} after realm down: ${describeValue(containers)}`);
    assert.deepEqual(containers.items, [], `no container of ${sandbox} may remain after realm down`);
  }

  for (const id of [...installs].reverse()) {
    const removed = cliJson(await realmHost(["uninstall", id]), `realm host uninstall ${id}`);
    assert.equal(removed["status"], "removed", `the uninstall must report removed: ${describeValue(removed)}`);
    const afterUninstall = cliJson(await realmHost(["status", id]), `realm host status ${id}`);
    assert.notEqual(afterUninstall["status"], "installed", `realm host status ${id} must no longer report installed: ${describeValue(afterUninstall)}`);
  }
  assert.equal(fileSha256(realFile), realBefore, "the operator's real host configuration must be byte-identical after the run");
  assert.deepEqual(
    alsoReal.map((path) => fileSha256(path)),
    alsoBefore,
    "the operator's other real host files must be byte-identical after the run",
  );
}

// ---- Helpers shared by the live files --------------------------------------------------------------------------------------

// The host executable of a gate that is open. A closed gate never reaches a test body, so this throws only on a programming error.
export function gateBin(gate: HostLiveGate): string {
  if (gate.bin === undefined) {
    throw new Error("the live rehearsal ran although its gate is closed");
  }
  return gate.bin;
}

// One diagnostic line: the observed host version against the recorded one. A different version runs and is recorded, never skipped.
export function hostVersionNote(host: LiveHostId, gate: HostLiveGate): string {
  const spec = HOST_LIVE[host];
  const version = gate.version ?? "unknown";
  const same = version === spec.recordedVersion ? "the recorded version" : `a different version than the recorded ${spec.recordedVersion}; it runs and is recorded`;
  return `${spec.displayName} ${version}: ${same}`;
}

// The { path, action } pairs of an install or uninstall result line.
export function actionsOf(line: Record<string, unknown>, label: string): { readonly path: string; readonly action: string }[] {
  const actions = line["actions"];
  assert.ok(Array.isArray(actions), `${label} must name its actions: ${describeValue(line)}`);
  return (actions as unknown[]).map((action) => {
    assert.ok(isRecord(action), `${label}: an action must be an object: ${describeValue(action)}`);
    const path = action["path"];
    const kind = action["action"];
    assert.ok(typeof path === "string" && typeof kind === "string", `${label}: an action must carry a path and an action: ${describeValue(action)}`);
    return { path, action: kind };
  });
}

// The parsed JSON object a file holds.
export function jsonObjectAt(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(isRecord(parsed), "the file must hold a JSON object");
  return parsed;
}

// The `realm host status <host>` line of one host.
export async function hostStatusOf(rig: HostRig, host: LiveHostId): Promise<Record<string, unknown>> {
  return cliJson(await rig.realm(["status", host]), `realm host status ${host}`);
}
