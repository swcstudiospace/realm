// The installer engine: plan and apply an install or uninstall from a recipe.
//
//  - planHostOperation resolves the config home, reads every target through an lstat walk that
//    refuses a symlink, and asks the pure planner (recipe.ts) what to do. It writes nothing.
//  - applyHostOperation writes. A real operation that changes something is bracketed by an admission
//    and a result audit line; a failed admission append means nothing is written. A dry run writes
//    nothing at all (no host file, no receipt, no audit line) and logs one plan event.
//
// Reads are async and bounded by withTimeout. The writes are synchronous (atomicWriteFile cannot be
// interrupted by a timer), so the write phase is bounded by the file sizes (1 MiB cap per file)
// rather than by a clock. No process.env, no Date.now() and no Math.random(): the context carries
// `now` and `newCorrelationId`.

import { Buffer } from "node:buffer";
import { constants, mkdirSync, realpathSync, rmdirSync, rmSync } from "node:fs";
import { lstat, open, readdir, realpath, stat, type FileHandle } from "node:fs/promises";
import { join, sep } from "node:path";
import { makeRealmError, RealmError } from "../core/errors.js";
import { withTimeout } from "../core/timeout.js";
import { atomicWriteFile, observeSha256 } from "../fs/atomic-write.js";
import { errnoOf, lstatIfPresent } from "../fs/canonicalize.js";
import type { Logger, LogFields } from "../observe/logger.js";
import type { AuditOutcome } from "../audit/log.js";
import { recordHostOperation, type HostAuditFn, type HostAuditTool } from "./host-audit.js";
import {
  HostRefusal,
  MAX_FILE_BYTES,
  planRecipe,
  receiptDirPaths,
  recipeTargetPaths,
  sha256Text,
  type BundleFile,
  type HostOperationKind,
  type PlannedChange,
} from "./recipe.js";
import { readReceipt, removeReceipt, serializeReceipt, writeReceipt, type Receipt, type ReceiptEntry, type ReceiptRead } from "./receipt.js";
import type { HostId, InstallRecipe } from "./types.js";

export type HostOperation = HostOperationKind;

export interface HostFileInfo {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
  readonly mode: number;
}

// Every async file system read the engine and the adapter do goes through this seam, so a test can
// stall it and prove the timeout. Each method resolves null (or rejects with a RealmError) for a
// missing path; none of them follows a symlink except `stat` and `realpath`.
export interface HostFsReader {
  realpath(path: string): Promise<string | null>;
  lstat(path: string): Promise<HostFileInfo | null>;
  stat(path: string): Promise<HostFileInfo | null>;
  // Reads a regular file without following a symlink. More than maxBytes is an unparseable refusal.
  readFile(path: string, maxBytes: number): Promise<Uint8Array>;
  readdir(path: string): Promise<readonly string[]>;
}

function isMissing(error: unknown): boolean {
  const code = errnoOf(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

function fileInfo(stats: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; mode: number }): HostFileInfo {
  return { isFile: stats.isFile(), isDirectory: stats.isDirectory(), isSymbolicLink: stats.isSymbolicLink(), mode: stats.mode };
}

export const defaultHostReader: HostFsReader = Object.freeze({
  async realpath(path: string): Promise<string | null> {
    try {
      return await realpath(path);
    } catch (error: unknown) {
      if (isMissing(error)) {
        return null;
      }
      throw makeRealmError("PATH_ESCAPE");
    }
  },
  async lstat(path: string): Promise<HostFileInfo | null> {
    try {
      return fileInfo(await lstat(path));
    } catch (error: unknown) {
      if (isMissing(error)) {
        return null;
      }
      throw makeRealmError("PATH_ESCAPE");
    }
  },
  async stat(path: string): Promise<HostFileInfo | null> {
    try {
      return fileInfo(await stat(path));
    } catch (error: unknown) {
      if (isMissing(error)) {
        return null;
      }
      throw makeRealmError("PATH_ESCAPE");
    }
  },
  async readFile(path: string, maxBytes: number): Promise<Uint8Array> {
    let handle: FileHandle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch (error: unknown) {
      throw errnoOf(error) === "ELOOP" ? new HostRefusal("symlink") : makeRealmError("PATH_ESCAPE");
    }
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        throw makeRealmError("PATH_ESCAPE");
      }
      if (stats.size > maxBytes) {
        throw new HostRefusal("unparseable");
      }
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
      if (bytesRead > maxBytes) {
        throw new HostRefusal("unparseable");
      }
      return new Uint8Array(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  },
  async readdir(path: string): Promise<readonly string[]> {
    try {
      return await readdir(path);
    } catch {
      throw makeRealmError("PATH_ESCAPE");
    }
  },
});

export type HostEngineStage = "after-pending-receipt" | "after-change";

export interface HostEngineContext {
  readonly stateDir: string;
  readonly logger: Logger;
  readonly audit: HostAuditFn;
  readonly now: () => Date;
  readonly newCorrelationId: () => string;
  readonly readTimeoutMs: number;
  readonly reader: HostFsReader;
  // Test seam: called after the pending receipt and after each applied change. No production caller.
  readonly stageHook?: (stage: HostEngineStage, path: string) => void;
}

export interface HostOperationRequest {
  readonly op: HostOperation;
  readonly hostId: HostId;
  // The recipe, or null when the host has none. Install then refuses recipe-pending, and so does an
  // uninstall that has a receipt to undo (the recipe says how).
  readonly recipe: InstallRecipe | null;
  // The config home to install into (not yet resolved). An uninstall uses the home in the receipt.
  readonly home: string;
  // The files of a bundle-copy install; [] for the other kinds.
  readonly bundle: readonly BundleFile[];
}

export interface HostPlan {
  readonly op: HostOperation;
  readonly hostId: HostId;
  readonly recipeKind: InstallRecipe["kind"] | null;
  // The real path of the home the paths are relative to; null when an uninstall has no receipt.
  readonly configHome: string | null;
  readonly changes: readonly PlannedChange[];
  // The receipt entries Realm owns after an install.
  readonly entries: readonly ReceiptEntry[];
  readonly prior: ReceiptRead | null;
}

// A change without its content: what dry runs, logs and the CLI may show.
export interface ChangeSummary {
  readonly path: string;
  readonly kind: "file" | "dir";
  readonly action: PlannedChange["action"];
  readonly beforeSha256: string | null;
  readonly afterSha256: string | null;
  readonly bytes: number;
}

export interface HostOperationOutcome {
  readonly status: "planned" | "noop" | "installed" | "removed";
  readonly dryRun: boolean;
  readonly actions: readonly ChangeSummary[];
}

export interface ApplyOptions {
  readonly dryRun: boolean;
}

function bounded<T>(ctx: HostEngineContext, work: Promise<T>): Promise<T> {
  return withTimeout(work, ctx.readTimeoutMs, "TOOL_TIMEOUT");
}

async function symlinkRefusal(ctx: HostEngineContext, path: string): Promise<HostRefusal> {
  const real = (await bounded(ctx, ctx.reader.realpath(path))) ?? path;
  return new HostRefusal("symlink", `use --config-home ${real}`);
}

// Reads the regular file at home/rel, walking each directory with lstat so a symlink anywhere below the home
// is refused. Existing directories seen on the way are added to `dirs`. null: the file does not exist.
export async function readHostFile(
  ctx: HostEngineContext,
  home: string,
  rel: string,
  dirs: Set<string>,
): Promise<string | null> {
  const segments = rel.split("/");
  let current = home;
  for (let i = 0; i < segments.length - 1; i += 1) {
    current = join(current, segments[i] ?? "");
    const info = await bounded(ctx, ctx.reader.lstat(current));
    if (info === null) {
      return null;
    }
    if (info.isSymbolicLink) {
      throw await symlinkRefusal(ctx, current);
    }
    if (!info.isDirectory) {
      throw new HostRefusal("foreign-content");
    }
    dirs.add(segments.slice(0, i + 1).join("/"));
  }
  const target = join(current, segments[segments.length - 1] ?? "");
  if (!target.startsWith(`${home}${sep}`)) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const info = await bounded(ctx, ctx.reader.lstat(target));
  if (info === null) {
    return null;
  }
  if (info.isSymbolicLink) {
    throw await symlinkRefusal(ctx, target);
  }
  if (!info.isFile) {
    throw new HostRefusal("foreign-content");
  }
  const bytes = await bounded(ctx, ctx.reader.readFile(target, MAX_FILE_BYTES));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HostRefusal("unparseable");
  }
}

async function listCreatedDir(ctx: HostEngineContext, home: string, rel: string): Promise<readonly string[] | undefined> {
  let current = home;
  for (const segment of rel.split("/")) {
    current = join(current, segment);
    const info = await bounded(ctx, ctx.reader.lstat(current));
    if (info === null) {
      return undefined;
    }
    if (info.isSymbolicLink) {
      throw await symlinkRefusal(ctx, current);
    }
    if (!info.isDirectory) {
      return undefined;
    }
  }
  return bounded(ctx, ctx.reader.readdir(current));
}

function summarizeChange(change: PlannedChange): ChangeSummary {
  return {
    path: change.path,
    kind: change.kind,
    action: change.action,
    beforeSha256: change.beforeSha256,
    afterSha256: change.afterSha256,
    bytes: change.bytes,
  };
}

function emptyPlan(request: HostOperationRequest, prior: ReceiptRead | null): HostPlan {
  return { op: request.op, hostId: request.hostId, recipeKind: request.recipe?.kind ?? null, configHome: null, changes: [], entries: [], prior };
}

// Resolves the home and reads every file the recipe and the receipt name. Nothing is written.
export async function planHostOperation(request: HostOperationRequest, ctx: HostEngineContext): Promise<HostPlan> {
  const prior = await readReceipt(ctx.stateDir, request.hostId, ctx.readTimeoutMs);
  const uninstall = request.op === "uninstall";
  if (uninstall && prior === null) {
    return emptyPlan(request, null);
  }
  const recipe = request.recipe;
  if (recipe === null) {
    throw new HostRefusal("recipe-pending");
  }
  if (prior !== null && prior.receipt.recipeKind !== recipe.kind) {
    throw new HostRefusal("drifted");
  }
  const homeInput = uninstall && prior !== null ? prior.receipt.configHome : request.home;
  const home = await bounded(ctx, ctx.reader.realpath(homeInput));
  const homeInfo = home === null ? null : await bounded(ctx, ctx.reader.lstat(home));
  const priorEntries = prior?.receipt.entries ?? [];
  const files = new Map<string, string | null>();
  const dirs = new Set<string>([""]);
  const listings = new Map<string, readonly string[]>();

  if (home === null || homeInfo === null || !homeInfo.isDirectory) {
    // Realm never creates a host home. An uninstall of a home that is gone has nothing left to remove.
    if (!uninstall) {
      throw new HostRefusal("config-home-missing");
    }
    for (const path of recipeTargetPaths(recipe, "uninstall", [], priorEntries)) {
      files.set(path, null);
    }
    const changes = planRecipe(recipe, { operation: "uninstall", files, dirs, listings, receipt: priorEntries, bundle: [] }).changes;
    return { op: request.op, hostId: request.hostId, recipeKind: recipe.kind, configHome: homeInput, changes, entries: [], prior };
  }
  if (prior !== null && !uninstall && prior.receipt.configHome !== home) {
    throw new HostRefusal("drifted");
  }

  for (const path of recipeTargetPaths(recipe, request.op, request.bundle, priorEntries)) {
    files.set(path, await readHostFile(ctx, home, path, dirs));
  }
  if (uninstall) {
    for (const dir of receiptDirPaths(priorEntries)) {
      const names = await listCreatedDir(ctx, home, dir);
      if (names !== undefined) {
        listings.set(dir, names);
      }
    }
  }
  const plan = planRecipe(recipe, { operation: request.op, files, dirs, listings, receipt: priorEntries, bundle: request.bundle });
  return {
    op: request.op,
    hostId: request.hostId,
    recipeKind: recipe.kind,
    configHome: home,
    changes: plan.changes,
    entries: plan.entries,
    prior,
  };
}

// ---- Apply ----------------------------------------------------------------------------

function toolOf(op: HostOperation): HostAuditTool {
  return op === "install" ? "host.install" : "host.uninstall";
}

function logFields(plan: HostPlan, changes: readonly ChangeSummary[], dryRun: boolean): LogFields {
  const real = changes.filter((change) => change.action !== "noop");
  return {
    host: plan.hostId,
    recipeKind: plan.recipeKind,
    files: real.length,
    bytes: real.reduce((total, change) => total + change.bytes, 0),
    dryRun,
  };
}

// An error from the write phase as the caller should see it: a changed file is a concurrent-change refusal,
// any other RealmError passes through, anything else is an interrupted write.
function classify(error: unknown): RealmError {
  if (error instanceof HostRefusal) {
    return error;
  }
  if (error instanceof RealmError) {
    return error.code === "WRITE_NOT_ATOMIC" || error.code === "LOCK_CONFLICT" ? new HostRefusal("concurrent-change") : error;
  }
  return makeRealmError("WRITE_NOT_ATOMIC");
}

function realParentOrRefuse(home: string, rel: string, create: boolean): boolean {
  const segments = rel.split("/");
  let current = home;
  for (let i = 0; i < segments.length - 1; i += 1) {
    current = join(current, segments[i] ?? "");
    const stats = lstatIfPresent(current);
    if (stats === null) {
      if (!create) {
        return false;
      }
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (error: unknown) {
        if (errnoOf(error) !== "EEXIST") {
          throw makeRealmError("PATH_ESCAPE");
        }
      }
      continue;
    }
    if (stats.isSymbolicLink()) {
      throw new HostRefusal("symlink", `use --config-home ${realpathSync(current)}`);
    }
    if (!stats.isDirectory()) {
      throw new HostRefusal("foreign-content");
    }
  }
  return true;
}

function applyChange(home: string, change: PlannedChange): void {
  const target = join(home, change.path);
  if (!target.startsWith(`${home}${sep}`)) {
    throw makeRealmError("PATH_ESCAPE");
  }
  if (change.kind === "dir") {
    if (realParentOrRefuse(home, change.path, false)) {
      try {
        rmdirSync(target);
      } catch (error: unknown) {
        const code = errnoOf(error);
        if (code !== "ENOTEMPTY" && code !== "ENOENT") {
          throw makeRealmError("CLEANUP_FAILED");
        }
      }
    }
    return;
  }
  if (change.action === "remove") {
    if (realParentOrRefuse(home, change.path, false)) {
      if (observeSha256(target) !== change.beforeSha256) {
        throw makeRealmError("WRITE_NOT_ATOMIC");
      }
      rmSync(target, { force: true });
    }
    return;
  }
  if (change.after === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  realParentOrRefuse(home, change.path, true);
  atomicWriteFile(target, change.after, { expectedPriorSha256: change.beforeSha256 });
}

function buildReceipt(plan: HostPlan, state: Receipt["state"], createdAt: string): Receipt {
  if (plan.configHome === null || plan.recipeKind === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return {
    schemaVersion: 1,
    hostId: plan.hostId,
    recipeKind: plan.recipeKind,
    state,
    configHome: plan.configHome,
    createdAt,
    entries: plan.entries,
  };
}

// Applies a plan. A dry run returns the plan and writes nothing. A plan whose changes are all no-ops
// writes no host file and no audit line. Otherwise: admission line, pending receipt (install), every
// change, final receipt, result line.
export function applyHostOperation(plan: HostPlan, ctx: HostEngineContext, options: ApplyOptions): HostOperationOutcome {
  const actions = plan.changes.map(summarizeChange);
  const event = `host.${plan.op}`;
  if (options.dryRun) {
    ctx.logger.info(`${event}.plan`, logFields(plan, actions, true));
    return { status: "planned", dryRun: true, actions };
  }
  if (plan.changes.every((change) => change.action === "noop")) {
    settleWithoutChange(plan, ctx);
    ctx.logger.info(`${event}.plan`, logFields(plan, actions, false));
    return { status: "noop", dryRun: false, actions };
  }
  const configHome = plan.configHome;
  if (configHome === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const createdAt = ctx.now().toISOString();
  const correlationId = ctx.newCorrelationId();
  const bytes = actions.reduce((total, change) => total + change.bytes, 0);
  const pending = plan.op === "install" ? serializeReceipt(buildReceipt(plan, "pending", createdAt)) : null;
  const audit = { stateDir: ctx.stateDir, audit: ctx.audit };
  const line = (outcome: AuditOutcome, sha256: string | undefined) => ({
    tool: toolOf(plan.op),
    outcome,
    configHome,
    bytes,
    sha256,
    correlationId,
  });

  try {
    recordHostOperation(audit, "admission", line("ok", pending === null ? plan.prior?.sha256 : sha256Text(pending)));
  } catch (error: unknown) {
    const failure = error instanceof RealmError ? error : makeRealmError("AUDIT_WRITE_FAILED");
    ctx.logger.error(`${event}.audit_failed`, { ...logFields(plan, actions, false), code: failure.code });
    throw failure;
  }

  let finalSha: string | undefined;
  try {
    finalSha = writeChanges(plan, ctx, createdAt);
  } catch (error: unknown) {
    const failure = classify(error);
    try {
      recordHostOperation(audit, "result", line(failure.code, undefined));
    } catch (auditError: unknown) {
      const auditFailure = auditError instanceof RealmError ? auditError : makeRealmError("AUDIT_WRITE_FAILED");
      ctx.logger.error(`${event}.audit_failed`, { ...logFields(plan, actions, false), code: auditFailure.code });
    }
    ctx.logger.warn(`${event}.refused`, { ...logFields(plan, actions, false), code: failure.code });
    throw failure;
  }

  try {
    recordHostOperation(audit, "result", line("ok", finalSha));
  } catch (error: unknown) {
    const failure = error instanceof RealmError ? error : makeRealmError("AUDIT_WRITE_FAILED");
    // The change landed and is not rolled back: a retried append could duplicate the line.
    ctx.logger.error(`${event}.audit_failed`, { ...logFields(plan, actions, false), code: failure.code });
    throw makeRealmError("AUDIT_WRITE_FAILED");
  }
  ctx.logger.info(`${event}.applied`, logFields(plan, actions, false));
  return { status: plan.op === "install" ? "installed" : "removed", dryRun: false, actions };
}

// Applies the changes and settles the receipt. Returns the hash of the receipt now on disk (install) or of
// the one that was removed (uninstall).
function writeChanges(plan: HostPlan, ctx: HostEngineContext, createdAt: string): string | undefined {
  const home = plan.configHome;
  if (home === null) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  let receiptSha = plan.prior?.sha256 ?? null;
  if (plan.op === "install") {
    receiptSha = writeReceipt(ctx.stateDir, buildReceipt(plan, "pending", createdAt), { expectedPriorSha256: receiptSha });
    ctx.stageHook?.("after-pending-receipt", "");
  }
  for (const change of plan.changes) {
    if (change.action === "noop") {
      continue;
    }
    applyChange(home, change);
    ctx.stageHook?.("after-change", change.path);
  }
  if (plan.op === "install") {
    return writeReceipt(ctx.stateDir, buildReceipt(plan, "installed", createdAt), { expectedPriorSha256: receiptSha });
  }
  if (plan.prior !== null) {
    removeReceipt(ctx.stateDir, plan.hostId, plan.prior.sha256);
  }
  return plan.prior?.sha256;
}

// Bookkeeping for a plan with nothing to change on disk: it touches no host file and is not audited.
// An uninstall deletes the now-stale receipt. An install whose receipt is still pending finishes it.
function settleWithoutChange(plan: HostPlan, ctx: HostEngineContext): void {
  if (plan.op === "uninstall") {
    if (plan.prior !== null) {
      removeReceipt(ctx.stateDir, plan.hostId, plan.prior.sha256);
    }
    return;
  }
  if (plan.prior !== null && plan.prior.receipt.state === "pending" && plan.entries.length > 0) {
    writeReceipt(ctx.stateDir, buildReceipt(plan, "installed", plan.prior.receipt.createdAt), {
      expectedPriorSha256: plan.prior.sha256,
    });
  }
}

// Plan then apply, logging a refusal that stops the operation before anything was attempted.
export async function runHostOperation(
  request: HostOperationRequest,
  ctx: HostEngineContext,
  options: ApplyOptions,
): Promise<HostOperationOutcome> {
  let plan: HostPlan;
  try {
    plan = await planHostOperation(request, ctx);
  } catch (error: unknown) {
    const failure = classify(error);
    ctx.logger.warn(`host.${request.op}.refused`, {
      host: request.hostId,
      recipeKind: request.recipe?.kind ?? null,
      dryRun: options.dryRun,
      code: failure.code,
      ...(failure instanceof HostRefusal ? { reason: failure.refusal } : {}),
    });
    throw failure;
  }
  return applyHostOperation(plan, ctx, options);
}
