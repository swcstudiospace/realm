// realm host (HOST-07): list, detect, status, install and uninstall for the 22 hosts of the plugin contract
// (src/host), and token status and token rotate for the capability keyring (CAPT-08, D-32-12). The commands never need a
// running daemon and never spawn a process. Arguments are parsed before
// any file is read, so a usage error changes nothing. Exit codes follow the other subcommands: 0 success (one
// JSON line on stdout), 1 a catalogue refusal (the code on stdout, a fixed reason on stderr), 2 a usage error.
//
// detect needs no state directory. status, install and uninstall resolve it from the runtime config the way
// `realm audit` does, because receipts, the audit chain and host.log live under it. No file content, config
// value or environment value is ever printed or logged: output carries ids, paths relative to the config home,
// actions and byte counts. The environment arrives as a parameter (hostEnvFrom); this module never reads the
// process environment.

import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";
import { capabilityPolicyOf } from "../capability/admit.js";
import { keyringPathOf, readKeyring, rotateKeyring } from "../capability/keyring.js";
import type { Policy } from "../contract/validate.js";
import { ERROR_CATALOGUE, RealmError, type ErrorCode } from "../core/errors.js";
import { loadPolicyFile } from "../core/policy.js";
import { packageVersion } from "../core/package-version.js";
import { readPresence } from "../host/presence.js";
import { createHostAdapter, type HostAdapterDeps, type RecipeHostAdapter } from "../host/adapter.js";
import { hostEnvFrom, hostLogPath } from "../host/env.js";
import { defaultManifestFor } from "../host/manifest.js";
import { HostRefusal } from "../host/recipe.js";
import { HOST_RUNTIMES, resolveHostId } from "../host/runtimes.js";
import { HOST_IDS, type HostEnv, type HostId, type HostOperationOptions, type HostRuntimeEntry } from "../host/types.js";
import { createFileSink } from "../observe/log-file.js";
import { createLogger, nullLogger, parseLogLevel, type Logger } from "../observe/logger.js";
import { loadRuntimeConfig } from "../runtime/config.js";
import { readRuntimeConfigFile } from "../runtime/config-file.js";
import { defaultPolicyPath, resolveConfigPath } from "../runtime/host-paths.js";
import type { EnvironmentLike } from "../session/paths.js";
import type { CliResult } from "./main.js";

const HOST_USAGE =
  "realm host: usage: realm host list | detect [<host>] | status [<host>] | install <host> [--dry-run] [--config-home <absolute path>] | uninstall <host> [--dry-run] [--config-home <absolute path>] | token status | token rotate [--revoke-previous]";

// A user-supplied host name is echoed only when it is short and made of these characters.
const ECHOABLE_NAME = /^[A-Za-z0-9._-]{1,32}$/;

// detect reads no receipt, so it never consults a state directory: this stands in for one.
const NO_STATE_DIR = "";

// The seams the command reads. CliDeps satisfies this shape, so main.ts passes its own deps through.
export interface HostCliDeps {
  readonly env: EnvironmentLike;
  // Reads the runtime config file that names the state directory (default readRuntimeConfigFile).
  readonly readConfig?: (path: string) => unknown;
  readonly now?: () => Date;
  // Test seam, no production caller: the runtime table (default HOST_RUNTIMES).
  readonly hostRuntimes?: Readonly<Record<HostId, HostRuntimeEntry>>;
  // Test seam, no production caller: the shipped adapters/ directory (default: the package's own).
  readonly hostAdaptersDir?: string;
  // Loads the policy file for realm host token status, which reads only its capabilityTokens mode (default loadPolicyFile).
  readonly readPolicy?: (path: string) => Policy;
}

type HostSubcommand = "list" | "detect" | "status" | "install" | "uninstall" | "token status" | "token rotate";

interface MutateArgs {
  readonly kind: "mutate";
  readonly op: "install" | "uninstall";
  readonly host: HostId;
  readonly dryRun: boolean;
  readonly configHome: string | undefined;
}

interface StatusArgs {
  readonly kind: "status";
  readonly host: HostId | undefined;
}

interface TokenArgs {
  readonly kind: "token";
  readonly op: "status" | "rotate";
  readonly revokePrevious: boolean;
}

type HostArgs =
  | { readonly kind: "list" }
  | { readonly kind: "usage"; readonly unknownHost: string | undefined }
  | { readonly kind: "detect"; readonly host: HostId | undefined }
  | StatusArgs
  | MutateArgs
  | TokenArgs;

const USAGE_ERROR: HostArgs = { kind: "usage", unknownHost: undefined };

function isFlag(word: string): boolean {
  return word.startsWith("--");
}

function readOnlyArgs(kind: "detect" | "status", rest: readonly string[]): HostArgs {
  if (rest.length > 1 || rest.some(isFlag)) {
    return USAGE_ERROR;
  }
  const [name] = rest;
  const host = name === undefined ? undefined : resolveHostId(name);
  if (name !== undefined && host === undefined) {
    return { kind: "usage", unknownHost: name };
  }
  return kind === "detect" ? { kind: "detect", host } : { kind: "status", host };
}

function mutatingArgs(op: MutateArgs["op"], rest: readonly string[]): HostArgs {
  let name: string | undefined;
  let dryRun = false;
  let configHome: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index];
    if (word === undefined) {
      return USAGE_ERROR;
    }
    if (word === "--dry-run") {
      if (dryRun) {
        return USAGE_ERROR;
      }
      dryRun = true;
    } else if (word === "--config-home") {
      const value = rest[index + 1];
      if (configHome !== undefined || value === undefined || !isAbsolute(value)) {
        return USAGE_ERROR;
      }
      configHome = value;
      index += 1;
    } else if (isFlag(word) || name !== undefined) {
      return USAGE_ERROR;
    } else {
      name = word;
    }
  }
  if (name === undefined) {
    return USAGE_ERROR;
  }
  const host = resolveHostId(name);
  return host === undefined ? { kind: "usage", unknownHost: name } : { kind: "mutate", op, host, dryRun, configHome };
}

// token status takes no argument; token rotate takes the optional --revoke-previous flag at most once.
function tokenArgs(rest: readonly string[]): HostArgs {
  const [op, ...flags] = rest;
  if (op === "status") {
    return flags.length === 0 ? { kind: "token", op, revokePrevious: false } : USAGE_ERROR;
  }
  if (op === "rotate") {
    const [flag, ...extra] = flags;
    if (extra.length > 0 || (flag !== undefined && flag !== "--revoke-previous")) {
      return USAGE_ERROR;
    }
    return { kind: "token", op, revokePrevious: flag !== undefined };
  }
  return USAGE_ERROR;
}

// Exactly the accepted forms; anything else is a usage error.
function parseHostArgs(words: readonly string[]): HostArgs {
  const [sub, ...rest] = words;
  switch (sub) {
    case "list":
      return rest.length === 0 ? { kind: "list" } : USAGE_ERROR;
    case "detect":
    case "status":
      return readOnlyArgs(sub, rest);
    case "install":
    case "uninstall":
      return mutatingArgs(sub, rest);
    case "token":
      return tokenArgs(rest);
    default:
      return USAGE_ERROR;
  }
}

function success(value: unknown): CliResult {
  return { exitCode: 0, stdout: `${JSON.stringify(value)}\n`, stderr: "" };
}

function usageResult(unknownHost: string | undefined): CliResult {
  const named =
    unknownHost === undefined ? "" : `realm host: unknown host: ${ECHOABLE_NAME.test(unknownHost) ? unknownHost : "<invalid>"}\n`;
  return { exitCode: 2, stdout: "", stderr: `${HOST_USAGE}\n${named}` };
}

// The catalogue code on stdout and a fixed reason on stderr. A HostRefusal names its reason id and carries its own fixed
// text (and, for a symlink, the fix); every other RealmError carries its catalogue reason; anything else is SCHEMA_INVALID.
function refusalResult(sub: HostSubcommand, error: unknown): CliResult {
  const code: ErrorCode = error instanceof RealmError ? error.code : "SCHEMA_INVALID";
  const reason = error instanceof HostRefusal ? `${error.refusal}: ${error.message}` : ERROR_CATALOGUE[code].reason;
  return { exitCode: 1, stdout: `${code}\n`, stderr: `realm host ${sub}: ${reason}\n` };
}

function noStateDirResult(sub: HostSubcommand, error: unknown): CliResult {
  const code: ErrorCode = error instanceof RealmError ? error.code : "SCHEMA_INVALID";
  return { exitCode: 1, stdout: `${code}\n`, stderr: `realm host ${sub}: cannot resolve a state directory (run realm init)\n` };
}

// The shipped adapters/ directory: dist/src/cli/host.js lies three levels below the package root.
function defaultAdaptersDir(): string {
  return decodeURIComponent(new URL("../../../adapters", import.meta.url).pathname);
}

interface HostLog {
  readonly logger: Logger;
  // Lines the file sink refused, which stderr receives instead.
  readonly fallback: string[];
  readonly close: () => void;
}

// The file logger beside daemon.log and requests.log, built as the daemon builds its request logger: the level from
// REALM_LOG_LEVEL, stderr as the fallback when the file cannot take a line.
function openHostLog(stateDir: string, env: EnvironmentLike, now: () => Date): HostLog {
  const parsed = parseLogLevel(env["REALM_LOG_LEVEL"]);
  const file = createFileSink({ path: hostLogPath(stateDir) });
  const fallback: string[] = [];
  const logger = createLogger({
    sink: {
      write: (line) => {
        try {
          if (file.write(line)) {
            return true;
          }
        } catch {
          // The file sink refused the path. stderr still receives the line.
        }
        fallback.push(line);
        return true;
      },
    },
    level: parsed.level,
    now,
  });
  if (parsed.invalid) {
    logger.warn("host.log-level", { value: parsed.level });
  }
  return {
    logger,
    fallback,
    close: () => {
      file.close();
    },
  };
}

// The log lines the file sink could not take go to stderr, after the command's own text.
function withFallbackLines(result: CliResult, log: HostLog): CliResult {
  return log.fallback.length === 0 ? result : { ...result, stderr: `${result.stderr}${log.fallback.map((line) => `${line}\n`).join("")}` };
}

function listRows(runtimes: Readonly<Record<HostId, HostRuntimeEntry>>): readonly unknown[] {
  return HOST_IDS.map((id) => {
    const entry = runtimes[id];
    return {
      id,
      flag: entry.flag,
      aliases: entry.aliases,
      tier: entry.tier,
      integration: entry.integration,
      homeVerified: entry.homeVerified,
      recipe: entry.recipe === null ? "pending" : "ready",
    };
  });
}

function subOf(args: MutateArgs | StatusArgs): HostSubcommand {
  return args.kind === "mutate" ? args.op : args.kind;
}

interface Ports {
  readonly runtimes: Readonly<Record<HostId, HostRuntimeEntry>>;
  readonly env: HostEnv;
  readonly adapterDeps: HostAdapterDeps;
}

function adapterOf(id: HostId, ports: Ports): RecipeHostAdapter {
  return createHostAdapter(ports.runtimes[id], defaultManifestFor(id, packageVersion()), ports.adapterDeps);
}

async function runDetect(host: HostId | undefined, ports: Ports): Promise<CliResult> {
  const rows: unknown[] = [];
  for (const id of host === undefined ? HOST_IDS : [host]) {
    const found = await adapterOf(id, ports).detect(ports.env);
    rows.push({ id, detected: found.detected, homes: found.homes.map((home) => ({ path: home.path, exists: home.exists })), binary: found.binary });
  }
  return success(host === undefined ? rows : rows[0]);
}

async function runStatus(host: HostId | undefined, ports: Ports): Promise<CliResult> {
  const rows: unknown[] = [];
  for (const id of host === undefined ? HOST_IDS : [host]) {
    const adapter = adapterOf(id, ports);
    const found = await adapter.status(ports.env);
    if (ports.runtimes[id].integration === "extension") {
      // An extension host also reports whether its shim target exists, how many live processes loaded the plugin (presence
      // markers: counts only) and which table `conflicts` already exist under the home, so a doubled install is visible.
      const sessions = await readPresence(ports.adapterDeps.stateDir, id);
      const conflicts = (await adapter.detect(ports.env)).conflicts;
      rows.push({ id, status: found.status, entries: found.entries, plugin: { target: found.extensionTarget, sessions, conflicts } });
    } else {
      // Any other host reports presence only when it has markers (a `realm mcp --host <id>` session): counts, never a path.
      const sessions = await readPresence(ports.adapterDeps.stateDir, id);
      // `launch` (a host with a receipt only) says whether the registered command resolves on this process's PATH.
      const base = { id, status: found.status, entries: found.entries };
      const row = found.launch === null ? base : { ...base, launch: found.launch };
      rows.push(sessions.live + sessions.unreadable > 0 ? { ...row, plugin: { sessions } } : row);
    }
  }
  return success(host === undefined ? rows : rows[0]);
}

async function runMutation(args: MutateArgs, ports: Ports): Promise<CliResult> {
  const adapter = adapterOf(args.host, ports);
  const options: HostOperationOptions = args.configHome === undefined ? { dryRun: args.dryRun } : { dryRun: args.dryRun, configHome: args.configHome };
  const result = args.op === "install" ? await adapter.install(ports.env, options) : await adapter.uninstall(ports.env, options);
  return success({
    id: result.id,
    status: result.outcome,
    dryRun: result.dryRun,
    actions: result.actions.map((action) => ({ path: action.path, action: action.action, bytes: action.bytes })),
  });
}

// The mode the policy sets for capability tokens, or unknown when the policy cannot be loaded: the policy-file doctor item
// reports that failure, so status never makes it an exit-1 reason.
function policyModeOf(stateDir: string, deps: HostCliDeps): "off" | "enforce" | "unknown" {
  try {
    return capabilityPolicyOf((deps.readPolicy ?? loadPolicyFile)(defaultPolicyPath(stateDir))).mode;
  } catch {
    return "unknown";
  }
}

// One JSON line of kids, ages in seconds, counts and mode names. Never a key, a token, a policy value or a path.
function tokenStatus(stateDir: string, deps: HostCliDeps, nowSeconds: () => number): CliResult {
  const mode = policyModeOf(stateDir, deps);
  const read = readKeyring(stateDir, { now: nowSeconds });
  if (!read.present) {
    return success({ ok: true, mode, keyring: "absent" });
  }
  const { active, retired } = read.snapshot;
  const now = nowSeconds();
  return success({
    ok: true,
    mode,
    keyring: "present",
    active,
    retired: retired.map((key) => ({ kid: key.kid, ageSeconds: Math.max(0, now - key.retiredAt) })),
    fileMode: (lstatSync(keyringPathOf(stateDir)).mode & 0o777).toString(8),
  });
}

// Rotation never needs the daemon: a running daemon notices the changed key file on its next request (D-32-04).
function runToken(args: TokenArgs, deps: HostCliDeps): CliResult {
  const sub: HostSubcommand = args.op === "status" ? "token status" : "token rotate";
  let stateDir: string;
  try {
    stateDir = loadRuntimeConfig((deps.readConfig ?? readRuntimeConfigFile)(resolveConfigPath(deps.env))).stateDir;
  } catch (error: unknown) {
    return noStateDirResult(sub, error);
  }
  const now = deps.now ?? ((): Date => new Date());
  const nowSeconds = (): number => Math.floor(now().getTime() / 1000);
  try {
    if (args.op === "status") {
      return tokenStatus(stateDir, deps, nowSeconds);
    }
    const result = rotateKeyring(stateDir, { revokePrevious: args.revokePrevious }, { now: nowSeconds });
    return success({ ok: true, active: result.active, retired: result.retired, revoked: result.revoked });
  } catch (error: unknown) {
    return refusalResult(sub, error);
  }
}

async function runWithStateDir(
  args: MutateArgs | StatusArgs,
  deps: HostCliDeps,
  runtimes: Readonly<Record<HostId, HostRuntimeEntry>>,
  now: () => Date,
): Promise<CliResult> {
  let stateDir: string;
  try {
    stateDir = loadRuntimeConfig((deps.readConfig ?? readRuntimeConfigFile)(resolveConfigPath(deps.env))).stateDir;
  } catch (error: unknown) {
    return noStateDirResult(subOf(args), error);
  }
  const log = openHostLog(stateDir, deps.env, now);
  try {
    const ports: Ports = {
      runtimes,
      env: hostEnvFrom(deps.env),
      adapterDeps: { stateDir, adaptersDir: deps.hostAdaptersDir ?? defaultAdaptersDir(), logger: log.logger, now },
    };
    const result = args.kind === "mutate" ? await runMutation(args, ports) : await runStatus(args.host, ports);
    return withFallbackLines(result, log);
  } catch (error: unknown) {
    return withFallbackLines(refusalResult(subOf(args), error), log);
  } finally {
    log.close();
  }
}

// Runs one realm host command. Never rejects: every failure is a catalogue-coded result.
export async function runHostCommand(words: readonly string[], deps: HostCliDeps): Promise<CliResult> {
  const args = parseHostArgs(words);
  if (args.kind === "usage") {
    return usageResult(args.unknownHost);
  }
  const runtimes = deps.hostRuntimes ?? HOST_RUNTIMES;
  if (args.kind === "token") {
    return runToken(args, deps);
  }
  if (args.kind === "list") {
    return success(listRows(runtimes));
  }
  const now = deps.now ?? ((): Date => new Date());
  if (args.kind === "detect") {
    try {
      const ports: Ports = {
        runtimes,
        env: hostEnvFrom(deps.env),
        adapterDeps: { stateDir: NO_STATE_DIR, adaptersDir: deps.hostAdaptersDir ?? defaultAdaptersDir(), logger: nullLogger, now },
      };
      return await runDetect(args.host, ports);
    } catch (error: unknown) {
      return refusalResult("detect", error);
    }
  }
  return runWithStateDir(args, deps, runtimes, now);
}
