// realm init (ONB-01; P15-O1, D-1507). Writes the two templates a realm needs before its first `realm up`:
// config.json (image, stateDir, workspaceRoot) at resolveConfigPath(env), and policy.json at
// defaultPolicyPath(stateDir) with mode fail-closed written explicitly and the workspace as its only root.
// Every check runs before the first write. An existing target or a symlink is refused and never read. The
// image comes from --image only and is validated by loadRuntimeConfig, the daemon's own validator, so init
// never writes a config the daemon would refuse and never invents a digest. Nothing here reads process.env:
// the environment and the working directory arrive as parameters from runCli.

import {
  chmodSync,
  closeSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { RealmError, type ErrorCode } from "../core/errors.js";
import { syncDirectory, tempFileName } from "../fs/atomic-write.js";
import { loadRuntimeConfig } from "../runtime/config.js";
import { defaultPolicyPath, resolveConfigPath } from "../runtime/host-paths.js";
import type { EnvironmentLike } from "../session/paths.js";

export const INIT_USAGE =
  "realm init: usage: realm init --image <name@sha256:64-hex-digest> [--workspace <absolute path>] [--state-dir <absolute path>]";

// A refusal the operator can act on. The code is a catalogue code; the detail names the file or flag, never a
// file's contents.
export class InitRefusal extends RealmError {
  readonly detail: string;

  constructor(code: ErrorCode, detail: string) {
    super(code);
    this.detail = detail;
  }
}

export interface InitArgs {
  readonly image: string;
  readonly workspace: string | undefined;
  readonly stateDir: string | undefined;
}

// Called after a name is linked. Test seam, as the stage hook in src/fs/atomic-write.ts: a test fails a write after
// its name exists. The CLI does not pass it.
type AfterLink = (path: string) => void;

export interface InitDeps {
  readonly env: EnvironmentLike;
  // Working directory that --workspace defaults to (the CLI passes process.cwd()).
  readonly cwd: string;
  readonly afterLink?: AfterLink;
}

export interface InitSummary {
  readonly config: string;
  readonly policy: string;
  readonly stateDir: string;
  readonly mode: "fail-closed";
}

const INIT_FLAGS: Readonly<Record<string, true>> = {
  "--image": true,
  "--workspace": true,
  "--state-dir": true,
};

// Parses `--image <ref>`, `--workspace <path>` and `--state-dir <path>`, each at most once, in any order.
// --image is required. A missing value, a flag where a value belongs, an unknown flag, or a repeated flag is a usage
// error (undefined).
export function parseInitArgs(words: readonly string[]): InitArgs | undefined {
  const values = new Map<string, string>();
  for (let index = 0; index < words.length; index += 2) {
    const flag = words[index];
    const value = words[index + 1];
    if (
      flag === undefined ||
      value === undefined ||
      value.startsWith("--") ||
      !Object.hasOwn(INIT_FLAGS, flag) ||
      values.has(flag)
    ) {
      return undefined;
    }
    values.set(flag, value);
  }
  const image = values.get("--image");
  if (image === undefined) {
    return undefined;
  }
  return { image, workspace: values.get("--workspace"), stateDir: values.get("--state-dir") };
}

// The state directory when --state-dir is absent: $XDG_STATE_HOME/realm when XDG_STATE_HOME is absolute, else
// $HOME/.local/state/realm. The same absolute-base rule resolveConfigPath applies. Undefined when neither base is.
function defaultStateDir(env: EnvironmentLike): string | undefined {
  const xdg = env["XDG_STATE_HOME"];
  if (xdg !== undefined && isAbsolute(xdg)) {
    return join(xdg, "realm");
  }
  const home = env["HOME"];
  if (home !== undefined && isAbsolute(home)) {
    return join(home, ".local", "state", "realm");
  }
  return undefined;
}

function configPathOf(env: EnvironmentLike): string {
  try {
    return resolveConfigPath(env);
  } catch {
    throw new InitRefusal(
      "SCHEMA_INVALID",
      "config.json has no location: XDG_CONFIG_HOME or HOME must be an absolute path",
    );
  }
}

// Resolves every symlink on the existing part of path. The nearest existing ancestor is resolved with realpath, and
// the missing remainder is appended, so an alias anywhere on the path is followed. A symlink that cannot be resolved
// (dangling or looping) is refused: nothing is known about where it leads.
function resolveThroughAncestors(path: string): string {
  const missing: string[] = [];
  let existing = path;
  while (lstatIfPresent(existing) === undefined && dirname(existing) !== existing) {
    missing.unshift(basename(existing));
    existing = dirname(existing);
  }
  try {
    return join(realpathSync(existing), ...missing);
  } catch (error) {
    const link = lstatIfPresent(existing)?.isSymbolicLink() === true;
    const why = link ? "is a symbolic link that cannot be resolved" : `cannot be resolved (${codeOf(error)})`;
    throw new InitRefusal("SCHEMA_INVALID", `${existing} ${why}; refusing to use it`);
  }
}

// Segment comparison, not a string prefix (as core/policy.ts): equality counts as inside. Both arguments come from
// resolveThroughAncestors, so each is absolute and has no symlink on its existing part.
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
}

function errnoOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

// The code a refusal reports for a failed step: the catalogue code of a RealmError, else the errno.
function codeOf(error: unknown): string {
  if (error instanceof RealmError) {
    return error.code;
  }
  return errnoOf(error) ?? "unknown error";
}

// The entry's stats without following a symlink, or undefined when nothing is there. A path whose parent is a file
// is also nothing here; the directory creation that follows refuses it.
function lstatIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    const code = errnoOf(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw error;
  }
}

function requireAbsolute(flag: string, value: string): void {
  if (!isAbsolute(value)) {
    throw new InitRefusal("SCHEMA_INVALID", `${flag} must be an absolute path`);
  }
}

// Every refusal in this section is raised before the first write, so a refused run leaves nothing behind.
function preflight(
  image: string,
  workspaceRoot: string,
  stateDir: string,
  configPath: string,
  policyPath: string,
): void {
  // The loader's own check: the config must be valid for the daemon, which also validates the image digest.
  try {
    loadRuntimeConfig({ image, stateDir, workspaceRoot });
  } catch {
    throw new InitRefusal(
      "SCHEMA_INVALID",
      "--image must be a digest-pinned reference: <name>@sha256:<64 lowercase hex digits>",
    );
  }
  const workspace = lstatIfPresent(workspaceRoot);
  if (workspace === undefined) {
    throw new InitRefusal("SCHEMA_INVALID", "--workspace does not exist; create it or pass an existing directory");
  }
  if (!workspace.isDirectory()) {
    throw new InitRefusal("SCHEMA_INVALID", "--workspace must be an existing directory, not a symbolic link or file");
  }
  // Containment is decided on resolved paths, so an alias in any part of a path cannot put it inside the workspace.
  // The policy file must not sit inside a workspace root the agent can write (D-22, the loader's rule). The config
  // file must not either. The workspace must not sit inside the state directory it protects.
  const realWorkspace = resolveThroughAncestors(workspaceRoot);
  const realState = resolveThroughAncestors(stateDir);
  const realConfig = resolveThroughAncestors(configPath);
  const realPolicy = resolveThroughAncestors(policyPath);
  if (isInside(realWorkspace, realPolicy)) {
    throw new InitRefusal(
      "POLICY_DENIED",
      "the state directory must not be inside the workspace root: policy.json would sit where the agent can write",
    );
  }
  if (isInside(realWorkspace, realConfig)) {
    throw new InitRefusal("SCHEMA_INVALID", "config.json must not be inside the workspace root");
  }
  if (isInside(realState, realWorkspace)) {
    throw new InitRefusal("SCHEMA_INVALID", "--workspace must not be inside the state directory");
  }
  const state = lstatIfPresent(stateDir);
  if (state !== undefined) {
    if (state.isSymbolicLink()) {
      throw new InitRefusal("SCHEMA_INVALID", "the state directory is a symbolic link; refusing to use it");
    }
    if (!state.isDirectory()) {
      throw new InitRefusal("SCHEMA_INVALID", "the state directory path exists and is not a directory");
    }
    const mode = state.mode & 0o777;
    if (mode !== 0o700) {
      throw new InitRefusal(
        "SCHEMA_INVALID",
        `the state directory exists with mode ${mode.toString(8)}; set it to 0700 (realm doctor --fix) or pass --state-dir`,
      );
    }
  }
  for (const [label, path] of [
    ["config.json", configPath],
    ["policy.json", policyPath],
  ] as const) {
    const entry = lstatIfPresent(path);
    if (entry === undefined) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      throw new InitRefusal("SCHEMA_INVALID", `${label} is a symbolic link; refusing to write through it`);
    }
    throw new InitRefusal("SCHEMA_INVALID", `${label} already exists at ${path}; refusing to overwrite it`);
  }
}

// Creates one directory at 0700 when it is absent. Ancestors take the default mode, which the umask narrows; the
// leaf's mode is then set explicitly so the umask cannot narrow or widen it. An existing directory is untouched.
// A failure is refused with the directory that could not be created and the error code.
function ensureLeafDirectory(path: string): void {
  if (lstatIfPresent(path) !== undefined) {
    return;
  }
  const parent = dirname(path);
  try {
    mkdirSync(parent, { recursive: true });
  } catch (error) {
    throw new InitRefusal("WRITE_NOT_ATOMIC", `${parent} could not be created (${codeOf(error)})`);
  }
  try {
    mkdirSync(path, { mode: 0o700 });
    chmodSync(path, 0o700);
  } catch (error) {
    throw new InitRefusal("WRITE_NOT_ATOMIC", `${path} could not be created (${codeOf(error)})`);
  }
}

// Removes a name if it is there; ENOENT counts as removed. False when the removal failed.
function unlinkIfPresent(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch (error) {
    return errnoOf(error) === "ENOENT";
  }
}

// Flushes a directory entry. False when the flush failed, so cleanup can name what it could not confirm.
function syncOrFalse(dir: string): boolean {
  try {
    syncDirectory(dir);
    return true;
  } catch {
    return false;
  }
}

// Gives text to path only if nothing is there. The text goes to a private temp file (created wx at 0600, fsynced),
// and linkSync gives it the final name. linkSync fails with EEXIST if a racing writer created the target, so the
// publish never overwrites. The temp name is removed and the directory synced after the link. A failure at any later
// step removes the final name again; the temp name is removed on every path. A name that cannot be removed is named
// in the refusal.
function publishNew(path: string, text: string, afterLink: AfterLink | undefined): void {
  const dir = dirname(path);
  const temp = join(dir, tempFileName(basename(path)));
  let tempCreated = false;
  let linked = false;
  try {
    const fd = openSync(temp, "wx", 0o600);
    tempCreated = true;
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      linkSync(temp, path);
    } catch (error) {
      if (errnoOf(error) === "EEXIST") {
        throw new InitRefusal("SCHEMA_INVALID", `${path} already exists; refusing to overwrite it`);
      }
      throw error;
    }
    linked = true;
    afterLink?.(path);
    unlinkSync(temp);
    syncDirectory(dir);
  } catch (error) {
    const leftovers: string[] = [];
    if (tempCreated && !unlinkIfPresent(temp)) {
      leftovers.push(temp);
    }
    if (linked && !(unlinkIfPresent(path) && syncOrFalse(dir))) {
      leftovers.push(path);
    }
    const cause =
      error instanceof InitRefusal
        ? error
        : new InitRefusal("WRITE_NOT_ATOMIC", `${path} could not be written (${codeOf(error)})`);
    if (leftovers.length === 0) {
      throw cause;
    }
    throw new InitRefusal(
      cause.code,
      `${cause.detail}; ${leftovers.join(" and ")} could not be removed, so remove it before retrying`,
    );
  }
}

// The write phase. A failure after preflight is WRITE_NOT_ATOMIC, and nothing this run published stays behind. If
// config.json cannot be published after policy.json was, the policy is removed; if that removal fails, the leftover
// is named.
function writeFiles(
  files: { readonly configPath: string; readonly configText: string; readonly policyPath: string; readonly policyText: string },
  stateDir: string,
  afterLink: AfterLink | undefined,
): void {
  ensureLeafDirectory(stateDir);
  ensureLeafDirectory(dirname(files.configPath));
  publishNew(files.policyPath, files.policyText, afterLink);
  try {
    publishNew(files.configPath, files.configText, afterLink);
  } catch (error) {
    if (!(unlinkIfPresent(files.policyPath) && syncOrFalse(dirname(files.policyPath)))) {
      throw new InitRefusal(
        "CLEANUP_FAILED",
        `config.json could not be written and policy.json (${files.policyPath}) could not be removed; remove it before retrying`,
      );
    }
    throw error;
  }
}

// realm init. Returns the paths written and the explicit mode. Every refusal throws InitRefusal before any write.
export function runInit(args: InitArgs, deps: InitDeps): InitSummary {
  const workspaceRoot = args.workspace ?? deps.cwd;
  requireAbsolute("--workspace", workspaceRoot);
  if (workspaceRoot === "/") {
    throw new InitRefusal("SCHEMA_INVALID", "--workspace must not be the filesystem root");
  }
  const stateDir = args.stateDir ?? defaultStateDir(deps.env);
  if (stateDir === undefined) {
    throw new InitRefusal(
      "SCHEMA_INVALID",
      "--state-dir is required: XDG_STATE_HOME or HOME must be an absolute path to derive it",
    );
  }
  requireAbsolute("--state-dir", stateDir);
  const configPath = configPathOf(deps.env);
  const policyPath = defaultPolicyPath(stateDir);
  preflight(args.image, workspaceRoot, stateDir, configPath, policyPath);

  const configText = `${JSON.stringify({ image: args.image, stateDir, workspaceRoot }, null, 2)}\n`;
  const policyText = `${JSON.stringify({ mode: "fail-closed", workspaceRoots: [workspaceRoot] }, null, 2)}\n`;
  writeFiles({ configPath, configText, policyPath, policyText }, stateDir, deps.afterLink);
  return { config: configPath, policy: policyPath, stateDir, mode: "fail-closed" };
}
