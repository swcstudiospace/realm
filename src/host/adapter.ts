// createHostAdapter: the HostAdapter for any recipe-driven HostRuntimeEntry. detect and status read the
// file system only (no spawn, no content read for detection); install and uninstall run the installer
// engine (install.ts). Construction does no file system access, and nothing here reads process.env:
// the caller hands in HostEnv.

import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SchemaInvalidError } from "../contract/validate.js";
import { makeRealmError } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import { appendAudit } from "../audit/log.js";
import type { Logger } from "../observe/logger.js";
import type { HostAuditFn } from "./host-audit.js";
import { bootHookOf } from "./boot-driver.js";
import {
  defaultHostReader,
  readHostFile,
  runHostOperation,
  type ChangeSummary,
  type HostEngineContext,
  type HostEngineStage,
  type HostFsReader,
  type HostOperation,
  type HostOperationOutcome,
} from "./install.js";
import { parseHostPluginManifest } from "./manifest.js";
import { HostRefusal, MAX_BUNDLE_FILES, MAX_FILE_BYTES, isSafeRelPath, ownedPart, resumeDecision, sha256Text, type BundleFile } from "./recipe.js";
import { DEFAULT_READ_TIMEOUT_MS, readReceipt, type ReceiptEntry } from "./receipt.js";
import { checkedShadows, resolveHomes, resolveHomeSpecs } from "./runtimes.js";
import type {
  HostAdapter,
  HostBootHookFactory,
  HostDetection,
  HostEnv,
  HostHomeSpec,
  HostOperationOptions,
  HostOperationResult,
  HostPluginManifest,
  HostRuntimeEntry,
  HostStatus,
  InstallRecipe,
} from "./types.js";

const MAX_BUNDLE_DEPTH = 8;

export interface HostAdapterDeps {
  // State directory: receipts and the audit chain live under it.
  readonly stateDir: string;
  // Absolute path of the shipped adapters/ directory (bundle-copy sources are relative to it).
  readonly adaptersDir: string;
  readonly logger: Logger;
  readonly now: () => Date;
  // Defaults to appendAudit. A test passes a recording or failing function.
  readonly audit?: HostAuditFn;
  readonly newCorrelationId?: () => string;
  readonly readTimeoutMs?: number;
  readonly reader?: HostFsReader;
  readonly stageHook?: (stage: HostEngineStage, path: string) => void;
  readonly bootHook?: HostBootHookFactory | null;
}

export interface HostHomeStatus {
  readonly path: string;
  readonly exists: boolean;
  // True when the home is a symlink that was followed once with realpath.
  readonly symlink: boolean;
}

export interface HostDetectionDetail extends HostDetection {
  readonly homes: readonly HostHomeStatus[];
  readonly binary: string | null;
  // The entry's `conflicts` paths (relative to the user home, as in the table) that exist: the host already loads Realm another way.
  readonly conflicts: readonly string[];
}

export interface HostOperationDetail extends HostOperationResult {
  readonly outcome: HostOperationOutcome["status"];
  readonly actions: readonly ChangeSummary[];
}

export interface HostEntryStatus {
  readonly path: string;
  // "unreadable": the owned file cannot be read or parsed safely (a refused read, or content the recipe cannot parse), which a
  // reinstall cannot fix. "drifted": the file parses and its owned part differs or is absent.
  // "missing": the file is absent, or (toml-table, yaml-map) the file is there and the owned table or entry is not.
  readonly state: "ok" | "drifted" | "missing" | "unreadable";
}

export interface HostStatusDetail extends HostOperationResult {
  readonly entries: readonly HostEntryStatus[];
  // For an extension host with a receipt: whether the file its owned shim imports exists. "unreadable" means the shim names no
  // single file URL (edited, missing or ambiguous) or the target is not a regular file. null for every other host and with no
  // receipt. The path itself is never returned.
  readonly extensionTarget: "present" | "missing" | "unreadable" | null;
  // For an mcp-config host with a receipt: whether its registered launch command resolves as an executable file in an absolute
  // directory of the PATH this process sees. null for an extension host, with no receipt, and when the manifest has no launch.
  // Reads only; nothing is spawned and the resolved path is never returned.
  readonly launch: "on-path" | "not-on-path" | null;
}

export interface RecipeHostAdapter extends HostAdapter {
  detect(env: HostEnv): Promise<HostDetectionDetail>;
  install(env: HostEnv, options: HostOperationOptions): Promise<HostOperationDetail>;
  uninstall(env: HostEnv, options: HostOperationOptions): Promise<HostOperationDetail>;
  status(env: HostEnv): Promise<HostStatusDetail>;
}

function defaultCorrelationId(): string {
  return randomBytes(12).toString("hex");
}

// The one install-time token a shipped bundle file may carry: the file URL of the built extension entry.
const BUNDLE_TOKEN = "@realm:extension-url@";
const ANY_BUNDLE_TOKEN = /@realm:[a-z-]+@/g;
// Node refuses a module URL that encodes a path separator (ERR_INVALID_MODULE_SPECIFIER).
const ENCODED_SEPARATOR = /%2f|%5c/i;
// The one string literal an installed shim imports: import("file:///..."). Strict: a JSON string literal, nothing else.
const SHIM_IMPORT = /\bimport\(\s*("(?:[^"\\\n]|\\.)*")\s*\)/g;

interface ExpandedBundle {
  readonly files: readonly BundleFile[];
  readonly entryPath: string | null;
}

// Replaces BUNDLE_TOKEN in each bundle file with a JSON string literal of the entry's file URL (the package root is the parent of
// the adapters directory, the entry comes from the validated manifest). Any other `@realm:` token, a token with a manifest that has
// no entry, or a relative adapters directory is SCHEMA_INVALID. A path whose file URL encodes a slash or backslash (a backslash in a
// POSIX directory name) cannot be imported by Node, so it is refused as `unsupported-path` rather than written into a shim that
// could never load. `entryPath` is the absolute entry path, or null when no file used the token. Files without a token are
// returned unchanged.
function expandBundleTokens(
  files: readonly BundleFile[],
  manifest: HostPluginManifest,
  adaptersDir: string,
): ExpandedBundle {
  const out: BundleFile[] = [];
  let entryPath: string | null = null;
  for (const file of files) {
    const tokens = [...file.content.matchAll(ANY_BUNDLE_TOKEN)].map((match) => match[0]);
    if (tokens.length === 0) {
      out.push(file);
      continue;
    }
    if (tokens.some((token) => token !== BUNDLE_TOKEN) || manifest.entry === undefined || !isAbsolute(adaptersDir)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    entryPath ??= join(dirname(adaptersDir), manifest.entry);
    const href = pathToFileURL(entryPath).href;
    if (ENCODED_SEPARATOR.test(href)) {
      throw new HostRefusal("unsupported-path");
    }
    const literal = JSON.stringify(href);
    out.push({ rel: file.rel, content: file.content.replaceAll(BUNDLE_TOKEN, () => literal) });
  }
  return { files: out, entryPath };
}

// Whether the receipt entry still matches what is on disk. The owned part is compared for json-merge and
// text-block, toml-table and yaml-map (an edit elsewhere in the file is not drift); a recipe of another kind falls back to the whole file.
function entryState(entry: ReceiptEntry, content: string | null, recipe: InstallRecipe | null): HostEntryStatus["state"] {
  if (content === null) {
    return "missing";
  }
  if (recipe === null || recipe.kind !== entry.kind || recipe.kind === "bundle-copy") {
    return resumeDecision(entry, sha256Text(content)) === "done" ? "ok" : "drifted";
  }
  const owned = ownedPart(recipe, content);
  if (!owned.parsed) {
    return "unreadable";
  }
  if (owned.sha256 === null && (recipe.kind === "toml-table" || recipe.kind === "yaml-map")) {
    // The entry is gone (the host's own remover, or the user): the file is fine, what Realm owned is not there.
    return "missing";
  }
  return owned.sha256 === entry.ownedSha256 ? "ok" : "drifted";
}

export function createHostAdapter(
  entry: HostRuntimeEntry,
  manifest: HostPluginManifest,
  deps: HostAdapterDeps,
): RecipeHostAdapter {
  const checked = parseHostPluginManifest(manifest);
  if (checked.hostId !== entry.id) {
    throw new SchemaInvalidError("host plugin manifest does not match its host");
  }
  const shadows = checkedShadows(entry.shadows ?? []);
  const readTimeoutMs = deps.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const reader = deps.reader ?? defaultHostReader;
  const ctx: HostEngineContext = {
    stateDir: deps.stateDir,
    logger: deps.logger,
    audit: deps.audit ?? appendAudit,
    now: deps.now,
    newCorrelationId: deps.newCorrelationId ?? defaultCorrelationId,
    readTimeoutMs,
    reader,
    ...(deps.stageHook === undefined ? {} : { stageHook: deps.stageHook }),
  };
  const bounded = <T>(work: Promise<T>): Promise<T> => withTimeout(work, readTimeoutMs, "TOOL_TIMEOUT");

  // The table's `conflicts` that exist under the user's home. lstat, so a dangling symlink counts. Reads the file system only.
  async function findConflicts(env: HostEnv): Promise<readonly string[]> {
    const paths = entry.conflicts ?? [];
    if (paths.length === 0) {
      return [];
    }
    if (!isAbsolute(env.home)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const found: string[] = [];
    for (const rel of paths) {
      if ((await bounded(reader.lstat(join(env.home, rel)))) !== null) {
        found.push(rel);
      }
    }
    return found;
  }

  // The first of `names` that is a regular file with an execute bit in an absolute directory of env.pathDirs (stat follows
  // symlinks). A name containing "/" is checked directly. null: none found. Reads the file system only.
  async function findExecutable(names: readonly string[], env: HostEnv): Promise<string | null> {
    for (const name of names) {
      const candidates = name.includes("/") ? [name] : env.pathDirs.filter((dir) => dir !== "" && isAbsolute(dir)).map((dir) => join(dir, name));
      for (const path of candidates) {
        const info = await bounded(reader.stat(path));
        if (info !== null && info.isFile && (info.mode & 0o111) !== 0) {
          return name;
        }
      }
    }
    return null;
  }

  async function detect(env: HostEnv): Promise<HostDetectionDetail> {
    const homes: HostHomeStatus[] = [];
    for (const path of resolveHomes(entry, env)) {
      const info = await bounded(reader.lstat(path));
      if (info === null) {
        homes.push({ path, exists: false, symlink: false });
      } else if (info.isSymbolicLink) {
        const real = await bounded(reader.realpath(path));
        const target = real === null ? null : await bounded(reader.lstat(real));
        homes.push({ path, exists: target !== null && target.isDirectory, symlink: true });
      } else {
        homes.push({ path, exists: info.isDirectory, symlink: false });
      }
    }
    const binary = await findExecutable(entry.binaries, env);
    const homeFound = homes.some((home) => home.exists);
    return {
      id: entry.id,
      detected: homeFound || binary !== null,
      via: homeFound ? "home" : binary !== null ? "binary" : "none",
      homes,
      binary,
      conflicts: await findConflicts(env),
    };
  }

  async function status(env: HostEnv): Promise<HostStatusDetail> {
    const receipt = await readReceipt(deps.stateDir, entry.id, readTimeoutMs);
    if (receipt === null) {
      const found = await detect(env);
      const state: HostStatus = !found.detected ? "not-detected" : entry.recipe === null ? "recipe-pending" : "detected";
      return { id: entry.id, status: state, changed: false, dryRun: false, detail: state, entries: [], extensionTarget: null, launch: null };
    }
    const dirs = new Set<string>();
    const entries: HostEntryStatus[] = [];
    const contents: string[] = [];
    for (const owned of receipt.receipt.entries) {
      let state: HostEntryStatus["state"];
      try {
        const content = await readHostFile(ctx, receipt.receipt.configHome, owned.path, dirs);
        if (content !== null) {
          contents.push(content);
        }
        state = entryState(owned, content, entry.recipe);
      } catch (error: unknown) {
        if (!(error instanceof HostRefusal)) {
          throw error;
        }
        state = "unreadable";
      }
      entries.push({ path: owned.path, state });
    }
    const intact = entries.filter((item) => item.state === "ok").length;
    const unreadable = entries.filter((item) => item.state === "unreadable").length;
    const verdict: HostStatus = receipt.receipt.state === "installed" && intact === entries.length ? "installed" : "drifted";
    const detail = `${receipt.receipt.state} receipt, ${String(intact)} of ${String(entries.length)} entries intact${unreadable > 0 ? `, ${String(unreadable)} unreadable` : ""}`;
    const extensionTarget =
      entry.integration === "extension" && entry.recipe?.kind === "bundle-copy" ? await extensionTargetOf(contents) : null;
    let launch: HostStatusDetail["launch"] = null;
    if (entry.integration === "mcp-config" && checked.launch !== undefined) {
      launch = (await findExecutable([checked.launch.command], env)) === null ? "not-on-path" : "on-path";
    }
    return { id: entry.id, status: verdict, changed: false, dryRun: false, detail, entries, extensionTarget, launch };
  }

  // Whether the file the owned shim imports exists. Exactly one import literal across the owned files, a JSON string that is a
  // file: URL naming an absolute path; anything else is "unreadable". A path that is not a regular file is "unreadable" too.
  async function extensionTargetOf(contents: readonly string[]): Promise<"present" | "missing" | "unreadable"> {
    const literals = contents.flatMap((content) => [...content.matchAll(SHIM_IMPORT)].map((match) => match[1] ?? ""));
    const [literal] = literals;
    if (literals.length !== 1 || literal === undefined) {
      return "unreadable";
    }
    let target: string;
    try {
      const url: unknown = JSON.parse(literal);
      if (typeof url !== "string" || !url.startsWith("file:///")) {
        return "unreadable";
      }
      target = fileURLToPath(url);
    } catch {
      return "unreadable";
    }
    if (!isAbsolute(target)) {
      return "unreadable";
    }
    const info = await bounded(reader.stat(target));
    if (info === null) {
      return "missing";
    }
    return info.isFile ? "present" : "unreadable";
  }

  // The home an install writes to: the operator's --config-home, else the first home of the recipe's role
  // that exists, else the first one of that role.
  async function installHome(env: HostEnv, role: HostHomeSpec["role"], override: string | undefined): Promise<string> {
    if (override !== undefined) {
      return override;
    }
    const candidates = resolveHomeSpecs(entry, env)
      .filter((spec) => spec.role === role)
      .map((spec) => spec.path);
    for (const path of candidates) {
      if ((await bounded(reader.lstat(path))) !== null) {
        return path;
      }
    }
    const first = candidates[0];
    if (first === undefined) {
      throw new HostRefusal("config-home-missing");
    }
    return first;
  }

  async function readBundleDir(dir: string, rel: string, depth: number, out: BundleFile[]): Promise<void> {
    if (depth > MAX_BUNDLE_DEPTH) {
      throw new HostRefusal("unparseable");
    }
    const names = [...(await bounded(reader.readdir(dir)))].sort();
    for (const name of names) {
      const path = join(dir, name);
      const relPath = rel === "" ? name : `${rel}/${name}`;
      const info = await bounded(reader.lstat(path));
      if (info === null) {
        continue;
      }
      if (info.isSymbolicLink) {
        throw new HostRefusal("symlink");
      }
      if (info.isDirectory) {
        await readBundleDir(path, relPath, depth + 1, out);
        continue;
      }
      if (!info.isFile || out.length >= MAX_BUNDLE_FILES) {
        throw new HostRefusal("unparseable");
      }
      const bytes = await bounded(reader.readFile(path, MAX_FILE_BYTES));
      try {
        out.push({ rel: relPath, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) });
      } catch {
        throw new HostRefusal("unparseable");
      }
    }
  }

  // The shipped files of a bundle-copy source, read through the same lstat discipline as host files.
  async function readBundle(recipe: InstallRecipe, dryRun: boolean): Promise<readonly BundleFile[]> {
    if (recipe.kind !== "bundle-copy") {
      return [];
    }
    if (!isSafeRelPath(recipe.source)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const dir = join(deps.adaptersDir, recipe.source);
    const info = await bounded(reader.lstat(dir));
    if (info === null || !info.isDirectory) {
      throw info?.isSymbolicLink === true ? new HostRefusal("symlink") : makeRealmError("SCHEMA_INVALID");
    }
    const out: BundleFile[] = [];
    await readBundleDir(dir, "", 0, out);
    let expanded: ExpandedBundle;
    try {
      expanded = expandBundleTokens(out, checked, deps.adaptersDir);
    } catch (error: unknown) {
      if (error instanceof HostRefusal) {
        deps.logger.warn("host.install.refused", { host: entry.id, recipeKind: recipe.kind, dryRun, code: error.code, reason: error.refusal });
      }
      throw error;
    }
    if (expanded.entryPath !== null) {
      const built = await bounded(reader.stat(expanded.entryPath));
      if (built === null || !built.isFile) {
        deps.logger.warn("host.install.refused", { host: entry.id, recipeKind: recipe.kind, dryRun, code: "POLICY_DENIED", reason: "extension-unbuilt" });
        throw new HostRefusal("extension-unbuilt");
      }
    }
    return expanded.files;
  }

  function requireAbsolute(options: HostOperationOptions): string | undefined {
    if (options.configHome !== undefined && !isAbsolute(options.configHome)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return options.configHome;
  }

  // True when the install would CREATE `file` below `home` while a table `shadows` path exists (lstat, so a dangling symlink counts).
  // An existing recipe file skips the guard: the host already reads it and ignores the older files.
  async function shadowsRecipeFile(env: HostEnv, home: string, file: string): Promise<boolean> {
    if (!isAbsolute(env.home)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    if ((await bounded(reader.lstat(join(home, file)))) !== null) {
      return false;
    }
    for (const shadow of shadows) {
      if ((await bounded(reader.lstat(join(shadow.base === "home" ? env.home : home, shadow.rel)))) !== null) {
        return true;
      }
    }
    return false;
  }

  async function operate(op: HostOperation, env: HostEnv, options: HostOperationOptions): Promise<HostOperationDetail> {
    const override = requireAbsolute(options);
    const recipe = entry.recipe;
    if (op === "install" && recipe === null) {
      deps.logger.warn("host.install.refused", { host: entry.id, recipeKind: null, dryRun: options.dryRun, code: "POLICY_DENIED", reason: "recipe-pending" });
      throw new HostRefusal("recipe-pending");
    }
    let home = "";
    let bundle: readonly BundleFile[] = [];
    if (op === "install" && recipe !== null) {
      // An explicit --config-home names the host: detection is skipped and the engine checks the home exists.
      if (override === undefined && !(await detect(env)).detected) {
        deps.logger.warn("host.install.refused", { host: entry.id, recipeKind: recipe.kind, dryRun: options.dryRun, code: "POLICY_DENIED", reason: "not-detected" });
        throw new HostRefusal("not-detected");
      }
      if ((await findConflicts(env)).length > 0) {
        deps.logger.warn("host.install.refused", { host: entry.id, recipeKind: recipe.kind, dryRun: options.dryRun, code: "POLICY_DENIED", reason: "already-loaded" });
        throw new HostRefusal("already-loaded");
      }
      home = await installHome(env, recipe.homeRole ?? "config", override);
      if (recipe.kind !== "bundle-copy" && shadows.length > 0 && (await shadowsRecipeFile(env, home, recipe.file))) {
        deps.logger.warn("host.install.refused", { host: entry.id, recipeKind: recipe.kind, dryRun: options.dryRun, code: "POLICY_DENIED", reason: "foreign-content" });
        throw new HostRefusal("foreign-content");
      }
      bundle = await readBundle(recipe, options.dryRun);
    }
    const outcome = await runHostOperation({ op, hostId: entry.id, recipe, home, bundle }, ctx, { dryRun: options.dryRun });
    const changed = outcome.status === "installed" || outcome.status === "removed";
    const installedAfter = op === "install" ? outcome.status !== "planned" : outcome.status === "planned";
    const files = outcome.actions.filter((action) => action.action !== "noop").length;
    return {
      id: entry.id,
      status: installedAfter ? "installed" : "detected",
      changed,
      dryRun: options.dryRun,
      detail: `${outcome.status}: ${String(files)} file change(s)`,
      outcome: outcome.status,
      actions: outcome.actions,
    };
  }

  return Object.freeze({
    id: entry.id,
    tier: entry.tier,
    bootHook: deps.bootHook === undefined ? bootHookOf(entry) : deps.bootHook,
    detect,
    status,
    install: (env: HostEnv, options: HostOperationOptions) => operate("install", env, options),
    uninstall: (env: HostEnv, options: HostOperationOptions) => operate("uninstall", env, options),
  });
}
