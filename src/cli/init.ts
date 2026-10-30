// realm init (ONB-01; P15-O1, D-1507). Writes the two templates a realm needs before its first `realm up`:
// config.json (image, stateDir, workspaceRoot) at resolveConfigPath(env), and policy.json at
// defaultPolicyPath(stateDir) with mode fail-closed written explicitly and the workspace as its only root.
// Every check runs before the first write. An existing target or a symlink is refused and never read. The
// image comes from --image only and is validated by loadRuntimeConfig, the daemon's own validator, so init
// never writes a config the daemon would refuse and never invents a digest. Nothing here reads process.env:
// the environment and the working directory arrive as parameters from runCli.

import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { RealmError, type ErrorCode } from "../core/errors.js";
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

export interface InitDeps {
  readonly env: EnvironmentLike;
  // Working directory that --workspace defaults to (the CLI passes process.cwd()).
  readonly cwd: string;
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
// --image is required; a missing value, an unknown flag, or a repeated flag is a usage error (undefined).
export function parseInitArgs(words: readonly string[]): InitArgs | undefined {
  const values = new Map<string, string>();
  for (let index = 0; index < words.length; index += 2) {
    const flag = words[index];
    const value = words[index + 1];
    if (flag === undefined || value === undefined || !Object.hasOwn(INIT_FLAGS, flag) || values.has(flag)) {
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

// Segment comparison, not a string prefix (as core/policy.ts): equality counts as inside. Both paths are absolute
// and lexical, because the targets do not exist yet, so a symlink in either path is not followed here.
function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel.split(sep)[0] !== "..");
}

function errnoOf(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

// The entry's stats without following a symlink, or undefined when nothing is there.
function lstatIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (errnoOf(error) === "ENOENT") {
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
  // The policy file must not sit inside a workspace root the agent can write (D-22, the loader's rule). The
  // config file must not either. The workspace must not sit inside the state directory it protects.
  if (isInside(workspaceRoot, policyPath)) {
    throw new InitRefusal(
      "POLICY_DENIED",
      "the state directory must not be inside the workspace root: policy.json would sit where the agent can write",
    );
  }
  if (isInside(workspaceRoot, configPath)) {
    throw new InitRefusal("SCHEMA_INVALID", "config.json must not be inside the workspace root");
  }
  if (isInside(stateDir, workspaceRoot)) {
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
function ensureLeafDirectory(path: string): void {
  if (lstatIfPresent(path) !== undefined) {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(path, { mode: 0o700 });
  chmodSync(path, 0o700);
}

// Publishes text at path only if nothing is there. The text goes to a private temp file (created wx at 0600,
// fsynced), and linkSync publishes it: linkSync fails with EEXIST if a racing writer created the target, so the
// publish never overwrites. The temp name is removed either way.
function publishNew(path: string, text: string): void {
  const temp = join(dirname(path), `.${basename(path)}.realm-tmp-${randomBytes(8).toString("hex")}`);
  const fd = openSync(temp, "wx", 0o600);
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
  } finally {
    unlinkSync(temp);
  }
}

// The write phase. A failure after preflight is WRITE_NOT_ATOMIC: nothing this run published stays behind. If
// config.json cannot be published after policy.json was, the policy is removed; if that removal fails, the
// leftover is named.
function writeFiles(
  files: { readonly configPath: string; readonly configText: string; readonly policyPath: string; readonly policyText: string },
  stateDir: string,
): void {
  ensureLeafDirectory(stateDir);
  ensureLeafDirectory(dirname(files.configPath));
  try {
    publishNew(files.policyPath, files.policyText);
  } catch (error) {
    if (error instanceof InitRefusal) {
      throw error;
    }
    throw new InitRefusal("WRITE_NOT_ATOMIC", `policy.json could not be written (${errnoOf(error) ?? "unknown error"})`);
  }
  try {
    publishNew(files.configPath, files.configText);
  } catch (error) {
    try {
      unlinkSync(files.policyPath);
    } catch {
      throw new InitRefusal(
        "CLEANUP_FAILED",
        `config.json could not be written and policy.json (${files.policyPath}) could not be removed; remove it before retrying`,
      );
    }
    if (error instanceof InitRefusal) {
      throw error;
    }
    throw new InitRefusal("WRITE_NOT_ATOMIC", `config.json could not be written (${errnoOf(error) ?? "unknown error"})`);
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
  writeFiles({ configPath, configText, policyPath, policyText }, stateDir);
  return { config: configPath, policy: policyPath, stateDir, mode: "fail-closed" };
}
