// createHostAdapter: the HostAdapter for any recipe-driven HostRuntimeEntry. detect and status read the
// file system only (no spawn, no content read for detection); install and uninstall run the installer
// engine (install.ts). Construction does no file system access, and nothing here reads process.env:
// the caller hands in HostEnv.

import { randomBytes } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { SchemaInvalidError } from "../contract/validate.js";
import { makeRealmError } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import { appendAudit } from "../audit/log.js";
import type { Logger } from "../observe/logger.js";
import type { HostAuditFn } from "./host-audit.js";
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
import { HostRefusal, MAX_BUNDLE_FILES, MAX_FILE_BYTES, isSafeRelPath, ownedPartSha256, resumeDecision, sha256Text, type BundleFile } from "./recipe.js";
import { DEFAULT_READ_TIMEOUT_MS, readReceipt, type ReceiptEntry } from "./receipt.js";
import { resolveHomes } from "./runtimes.js";
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
  readonly state: "ok" | "drifted" | "missing";
}

export interface HostStatusDetail extends HostOperationResult {
  readonly entries: readonly HostEntryStatus[];
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

// Replaces BUNDLE_TOKEN in each bundle file with a JSON string literal of the entry's file URL (the package root is the parent of
// the adapters directory, the entry comes from the validated manifest). Any other `@realm:` token, a token with a manifest that has
// no entry, or a relative adapters directory is SCHEMA_INVALID. `entryPath` is the absolute entry path, or null when no file used
// the token. Files without a token are returned unchanged.
function expandBundleTokens(
  files: readonly BundleFile[],
  manifest: HostPluginManifest,
  adaptersDir: string,
): { readonly files: readonly BundleFile[]; readonly entryPath: string | null } {
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
    const literal = JSON.stringify(pathToFileURL(entryPath).href);
    out.push({ rel: file.rel, content: file.content.replaceAll(BUNDLE_TOKEN, () => literal) });
  }
  return { files: out, entryPath };
}

// Whether the receipt entry still matches what is on disk. The owned part is compared for json-merge and
// text-block (an edit elsewhere in the file is not drift); a recipe of another kind falls back to the whole file.
function entryState(entry: ReceiptEntry, content: string | null, recipe: InstallRecipe | null): HostEntryStatus["state"] {
  if (content === null) {
    return "missing";
  }
  if (recipe === null || recipe.kind !== entry.kind || recipe.kind === "bundle-copy") {
    return resumeDecision(entry, sha256Text(content)) === "done" ? "ok" : "drifted";
  }
  return ownedPartSha256(recipe, content) === entry.ownedSha256 ? "ok" : "drifted";
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
    let binary: string | null = null;
    for (const name of entry.binaries) {
      for (const dir of env.pathDirs) {
        if (dir === "" || !isAbsolute(dir)) {
          continue;
        }
        const info = await bounded(reader.stat(join(dir, name)));
        if (info !== null && info.isFile && (info.mode & 0o111) !== 0) {
          binary = name;
          break;
        }
      }
      if (binary !== null) {
        break;
      }
    }
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
      return { id: entry.id, status: state, changed: false, dryRun: false, detail: state, entries: [] };
    }
    const dirs = new Set<string>();
    const entries: HostEntryStatus[] = [];
    for (const owned of receipt.receipt.entries) {
      let state: HostEntryStatus["state"];
      try {
        const content = await readHostFile(ctx, receipt.receipt.configHome, owned.path, dirs);
        state = entryState(owned, content, entry.recipe);
      } catch (error: unknown) {
        if (!(error instanceof HostRefusal)) {
          throw error;
        }
        state = "drifted";
      }
      entries.push({ path: owned.path, state });
    }
    const intact = entries.filter((item) => item.state === "ok").length;
    const verdict: HostStatus = receipt.receipt.state === "installed" && intact === entries.length ? "installed" : "drifted";
    const detail = `${receipt.receipt.state} receipt, ${String(intact)} of ${String(entries.length)} entries intact`;
    return { id: entry.id, status: verdict, changed: false, dryRun: false, detail, entries };
  }

  // The home an install writes to: the operator's --config-home, else the first home of the recipe's role
  // that exists, else the first one of that role.
  async function installHome(env: HostEnv, role: HostHomeSpec["role"], override: string | undefined): Promise<string> {
    if (override !== undefined) {
      return override;
    }
    const candidates = resolveHomes(entry, env).filter((_, index) => (entry.homes[index]?.role ?? "config") === role);
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
    const expanded = expandBundleTokens(out, checked, deps.adaptersDir);
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
    bootHook: deps.bootHook ?? null,
    detect,
    status,
    install: (env: HostEnv, options: HostOperationOptions) => operate("install", env, options),
    uninstall: (env: HostEnv, options: HostOperationOptions) => operate("uninstall", env, options),
  });
}
