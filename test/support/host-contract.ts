// The cross-host contract of Phase 26 (TEST-HOST-01 and TEST-HOST-03): one set of rules, stated once, run against every row of the runtime
// table (checkHostRowContract) and against every recipe through the installer engine (lifecycleContract). Both return closed lists of
// violation codes instead of asserting, so a seeded-defect table can call them and prove they can fail. Nothing here is host-specific: the
// recipe kind chooses the seed, and every fact about a host is read from HOST_RUNTIMES at run time.
//
// Fixtures and fakes only: every root is a temporary directory under the realpath of os.tmpdir(); no host runs, no network, no process
// environment is read, and no assertion message carries file content (codes, host ids and counts only).

import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import type { TestContext } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { checkAuditFile } from "../../src/audit/chain.js";
import { SchemaInvalidError, validate, type Policy } from "../../src/contract/validate.js";
import { ERROR_CODES } from "../../src/core/errors.js";
import { createHostAdapter, type HostOperationDetail, type RecipeHostAdapter } from "../../src/host/adapter.js";
import { integrationCeiling, resolveCapabilities } from "../../src/host/capabilities.js";
import type { HostAuditFn } from "../../src/host/host-audit.js";
import type { HostEngineStage } from "../../src/host/install.js";
import { defaultManifestFor, parseHostPluginManifest } from "../../src/host/manifest.js";
import { readReceipt, receiptPath } from "../../src/host/receipt.js";
import { HostRefusal, isSafeKeySegment, isSafeRelPath } from "../../src/host/recipe.js";
import { HOST_RUNTIMES, recipePending, resolveHomeSpecs } from "../../src/host/runtimes.js";
import {
  HOST_IDS,
  type HostCapability,
  type HostEnv,
  type HostHomeSpec,
  type HostId,
  type HostPluginManifest,
  type HostRuntimeEntry,
  type InstallRecipe,
} from "../../src/host/types.js";
import type { LogFields, Logger } from "../../src/observe/logger.js";
import { captureLog, eventsOf, makeFixtureHost, treeHash, writeAt, type CapturedLog, type FixtureHost } from "./fixture-host.js";
import { MARKER, auditFile, auditLineCount, filesUnder, isRecord, refusedWith } from "./host-recipe-suite.js";
import { ENTRY_2, YAML_VALID } from "./host-yaml-cases.js";

function isHostId(value: string): value is HostId {
  return (HOST_IDS as readonly string[]).includes(value);
}

// ---- the static row contract (TEST-HOST-01) ----------------------------------------------------------------------------------------------

export const ROW_VIOLATIONS = Object.freeze([
  "not-frozen",
  "identity",
  "home-unsafe",
  "env-shape",
  "home-resolution",
  "recipe-kind",
  "launch-unsafe",
  "launch-mismatch",
  "manifest",
  "capability-grant",
  "shadow-shape",
  "pending-inert",
] as const);
export type RowViolation = (typeof ROW_VIOLATIONS)[number];

// The collaborators a seeded defect is injected through. Every field defaults to the real implementation.
export interface RowContractDeps {
  // The table the alias-uniqueness rule reads (default HOST_RUNTIMES).
  readonly table?: Readonly<Record<string, HostRuntimeEntry>>;
  readonly resolveHomeSpecs?: typeof resolveHomeSpecs;
  readonly manifestFor?: (id: HostId, pluginVersion: string) => HostPluginManifest;
  readonly resolveCapabilities?: typeof resolveCapabilities;
}

const TIERS: readonly string[] = ["reference", "proven", "config-only"];
const INTEGRATIONS: readonly string[] = ["extension", "mcp-config"];
const ROLES: readonly string[] = ["config", "skills", "mcp"];
const SHADOW_BASES: readonly string[] = ["home", "config"];
const RECIPE_KINDS: readonly string[] = ["json-merge", "text-block", "toml-table", "yaml-map", "bundle-copy"];
// 25-CONTEXT E-G2: GSD Core's own environment names for these hosts. A recipe uses the host's own variable or none.
const GSD_ONLY_NAMES: readonly string[] = [
  "COPILOT_CONFIG_DIR",
  "CURSOR_CONFIG_DIR",
  "AUGMENT_CONFIG_DIR",
  "TRAE_CONFIG_DIR",
  "WINDSURF_CONFIG_DIR",
  "KILO_CONFIG_DIR",
  "CLINE_CONFIG_DIR",
  "ANTIGRAVITY_CONFIG_DIR",
];
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const KEY_NAME = /^[A-Za-z0-9_-]+$/;
const DRIVE_PREFIX = /^[A-Za-z]:/;
// A path separator, whitespace or a shell metacharacter. A leading tilde is checked separately.
const PATH_OR_SHELL = /[\s/\\;&|`$<>(){}[\]*?!'"#]/;
const MANIFEST_VERSION = "1.0.0";
const FIXTURE_HOME = "/home/u";
const OVERRIDE_DIR = "/opt/override";

// True when the value and everything below it is frozen. Primitives are frozen by definition.
export function isDeepFrozen(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return true;
  }
  if (!Object.isFrozen(value)) {
    return false;
  }
  const children: readonly unknown[] = Object.values(value);
  return children.every((child) => isDeepFrozen(child));
}

function identityViolation(id: string, row: HostRuntimeEntry, table: Readonly<Record<string, HostRuntimeEntry>>): boolean {
  if (!isHostId(id) || row.id !== id || row.flag !== `--${id}`) {
    return true;
  }
  const others = Object.values(table).filter((entry) => entry.id !== id);
  for (const alias of row.aliases) {
    if (isHostId(alias) || others.some((other) => other.aliases.includes(alias))) {
      return true;
    }
  }
  if (!TIERS.includes(row.tier) || !INTEGRATIONS.includes(row.integration)) {
    return true;
  }
  // omp is the only extension row and the only reference row.
  const isOmp = id === "omp";
  return (row.integration === "extension") !== isOmp || (row.tier === "reference") !== isOmp;
}

// A relative POSIX path (a single dot allowed) with no parent segment, no backslash and no drive prefix.
function safeHomeRel(rel: string): boolean {
  if (rel === ".") {
    return true;
  }
  if (rel === "" || rel.startsWith("/") || rel.includes("\\") || DRIVE_PREFIX.test(rel)) {
    return false;
  }
  return rel.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function homeUnsafe(row: HostRuntimeEntry): boolean {
  return !row.homes.some((home) => home.role === "config") || row.homes.some((home) => !ROLES.includes(home.role) || !safeHomeRel(home.rel));
}

function envShape(row: HostRuntimeEntry): boolean {
  if (row.envOverride !== null && row.envBase !== undefined) {
    return true;
  }
  const names: string[] = [];
  if (row.envOverride !== null) {
    names.push(row.envOverride);
  }
  if (row.envBase !== undefined) {
    names.push(row.envBase.name);
    if (!isSafeRelPath(row.envBase.sub) || row.envBase.sub.includes("/")) {
      return true;
    }
  }
  return names.some((name) => !ENV_NAME.test(name) || GSD_ONLY_NAMES.includes(name));
}

function throwsInvalid(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch (error: unknown) {
    return error instanceof SchemaInvalidError && error.code === "SCHEMA_INVALID";
  }
}

type ResolvedSpecs = readonly { readonly path: string; readonly role: HostHomeSpec["role"] }[];

function sameSpecs(actual: ResolvedSpecs, expected: ResolvedSpecs): boolean {
  return actual.length === expected.length && actual.every((spec, index) => spec.path === expected[index]?.path && spec.role === expected[index]?.role);
}

// Resolution against an absolute fixture home: no variable gives join(home, rel) in table order; an absolute override value moves every
// config and mcp home and no skills home; an absolute envBase value moves the config homes only (to base plus sub); an empty and a relative
// value are SCHEMA_INVALID. By equality with those expectations no resolved path lies outside the override directory or the home.
function homeResolutionViolation(row: HostRuntimeEntry, resolve: typeof resolveHomeSpecs): boolean {
  const envOf = (vars: Readonly<Record<string, string>>): HostEnv => ({ home: FIXTURE_HOME, env: vars, pathDirs: [] });
  const byDefault = (rel: string): string => join(FIXTURE_HOME, rel);
  try {
    if (!sameSpecs(resolve(row, envOf({})), row.homes.map((home) => ({ path: byDefault(home.rel), role: home.role })))) {
      return true;
    }
    const variables: string[] = [];
    if (row.envOverride !== null) {
      if (!row.homes.some((home) => home.role !== "skills")) {
        return true;
      }
      variables.push(row.envOverride);
      const moved = row.homes.map((home) => ({ path: home.role === "skills" ? byDefault(home.rel) : OVERRIDE_DIR, role: home.role }));
      if (!sameSpecs(resolve(row, envOf({ [row.envOverride]: OVERRIDE_DIR })), moved)) {
        return true;
      }
    }
    if (row.envBase !== undefined) {
      if (!row.homes.some((home) => home.role === "config")) {
        return true;
      }
      variables.push(row.envBase.name);
      const sub = row.envBase.sub;
      const based = row.homes.map((home) => ({ path: home.role === "config" ? join(OVERRIDE_DIR, sub) : byDefault(home.rel), role: home.role }));
      if (!sameSpecs(resolve(row, envOf({ [row.envBase.name]: OVERRIDE_DIR })), based)) {
        return true;
      }
    }
    return variables.some((name) => ["", "relative/dir"].some((bad) => !throwsInvalid(() => resolve(row, envOf({ [name]: bad })))));
  } catch {
    // A resolver that throws for a valid input is itself a violation.
    return true;
  }
}

function recipeKindViolation(row: HostRuntimeEntry): boolean {
  const recipe = row.recipe;
  if (recipe === null) {
    return false;
  }
  if (!RECIPE_KINDS.some((kind) => kind === recipe.kind)) {
    return true;
  }
  if (!row.homes.some((home) => home.role === (recipe.homeRole ?? "config"))) {
    return true;
  }
  const key = (segment: string): boolean => KEY_NAME.test(segment) && isSafeKeySegment(segment);
  switch (recipe.kind) {
    case "json-merge":
      return !isSafeRelPath(recipe.file) || recipe.keyPath.length === 0 || !recipe.keyPath.every(key);
    case "text-block":
      return !isSafeRelPath(recipe.file);
    case "toml-table":
      return !isSafeRelPath(recipe.file) || recipe.table.length === 0 || !recipe.table.every(key);
    case "yaml-map":
      return !isSafeRelPath(recipe.file) || !recipe.path.every(key);
    case "bundle-copy":
      return !isSafeRelPath(recipe.source) || !isSafeRelPath(recipe.dest);
  }
}

function stringsOf(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string") ? value : null;
}

function jsonOf(text: string | undefined): unknown {
  if (text === undefined) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

// The argv a recipe registers with the host, read back from the recipe value: json-merge takes value.command as a string plus value.args,
// or value.command as an array alone; yaml-map takes value.command plus value.args; toml-table parses the command and args lines of the
// owned text. Anything else a recipe holds (claude's env object) is ignored. null: not an mcp-config row with a recipe, or no argv can be read.
export function registeredArgvOf(row: HostRuntimeEntry): readonly string[] | null {
  const recipe = row.recipe;
  if (row.integration !== "mcp-config" || recipe === null) {
    return null;
  }
  const argvOf = (command: unknown, args: unknown): readonly string[] | null => {
    const rest = stringsOf(args);
    return typeof command === "string" && rest !== null ? [command, ...rest] : null;
  };
  switch (recipe.kind) {
    case "toml-table": {
      const lines = recipe.text.split("\n");
      return argvOf(jsonOf(/^command = (".*")$/.exec(lines[1] ?? "")?.[1]), jsonOf(/^args = (\[.*\])$/.exec(lines[2] ?? "")?.[1]));
    }
    case "yaml-map":
      return argvOf(recipe.value["command"], recipe.value["args"]);
    case "json-merge": {
      if (!isRecord(recipe.value)) {
        return null;
      }
      const command = recipe.value["command"];
      return typeof command === "string" ? argvOf(command, recipe.value["args"]) : stringsOf(command);
    }
    case "text-block":
    case "bundle-copy":
      return null;
  }
}

// Bare command realm, then mcp, then --host, then a host id; no element holds a path separator, whitespace, a shell metacharacter or a
// leading tilde. That the id is this row's own is launch-mismatch's rule, so one defect trips one code.
function launchUnsafe(argv: readonly string[] | null): boolean {
  if (argv === null) {
    return true;
  }
  const shaped = argv.length === 4 && argv[0] === "realm" && argv[1] === "mcp" && argv[2] === "--host" && isHostId(argv[3] ?? "");
  return !shaped || argv.some((part) => PATH_OR_SHELL.test(part) || part.startsWith("~"));
}

function policies(): readonly Policy[] {
  const base = validate("policy", {});
  if (!base.ok) {
    throw new Error("the default policy is invalid");
  }
  const made = (over: Partial<Policy>): Policy => Object.freeze({ ...base.value, ...over });
  return [
    made({ mode: "fail-closed", shellEnabled: false, workspaceRoots: ["/workspace"] }),
    made({ mode: "advisory", shellEnabled: true, workspaceRoots: ["/workspace"] }),
    made({ mode: "fail-closed", shellEnabled: false, workspaceRoots: [] }),
  ];
}

// What the catalogue says about a requested capability under a policy; undefined: the capability is scope-based and has no rule here.
function expectedGrant(capability: HostCapability, policy: Policy): boolean | undefined {
  switch (capability) {
    case "daemon.attach":
    case "exec.argv":
      return true;
    case "exec.shell":
      return policy.shellEnabled;
    case "fs.read":
    case "fs.write":
    case "fs.list":
      return policy.workspaceRoots.length > 0;
    case "host.tools.restrict":
      return policy.mode === "fail-closed";
    case "net.egress":
    case "credential.read":
      return undefined;
  }
}

function capabilityViolation(manifest: HostPluginManifest, resolve: typeof resolveCapabilities): boolean {
  for (const policy of policies()) {
    const result = resolve(manifest.capabilities, policy);
    if (result.granted.some((grant) => !manifest.capabilities.includes(grant))) {
      return true;
    }
    if (result.denied.some((denial) => !ERROR_CODES.some((code) => code === denial.code))) {
      return true;
    }
    for (const request of manifest.capabilities) {
      const expected = expectedGrant(request.capability, policy);
      if (expected !== undefined && result.granted.some((grant) => grant.capability === request.capability) !== expected) {
        return true;
      }
    }
  }
  return false;
}

// The manifest rule: parses, survives a JSON round trip, and carries the ceiling of its integration kind.
function manifestViolation(row: HostRuntimeEntry, manifest: HostPluginManifest): boolean {
  try {
    const parsed = parseHostPluginManifest(manifest);
    const trip: unknown = JSON.parse(JSON.stringify(manifest));
    if (!isDeepStrictEqual(parseHostPluginManifest(trip), parsed) || manifest.integration !== row.integration) {
      return true;
    }
    if (row.integration === "extension") {
      return manifest.entry === undefined || manifest.launch !== undefined;
    }
    const asked = manifest.capabilities.map((request) => request.capability);
    return manifest.entry !== undefined || manifest.capabilities.some((request) => request.scope !== undefined) || !isDeepStrictEqual(asked, [...integrationCeiling("mcp-config")]);
  } catch {
    return true;
  }
}

function shadowShapeViolation(row: HostRuntimeEntry): boolean {
  const shadows = row.shadows;
  if (shadows === undefined) {
    return false;
  }
  return shadows.length > 4 || (shadows.length > 0 && row.recipe === null) || shadows.some((shadow) => !isSafeRelPath(shadow.rel) || !SHADOW_BASES.includes(shadow.base));
}

function pendingInertViolation(id: string, row: HostRuntimeEntry): boolean {
  if (row.recipe !== null) {
    return false;
  }
  return (row.conflicts?.length ?? 0) > 0 || row.envBase !== undefined || (row.shadows?.length ?? 0) > 0 || (isHostId(id) && !recipePending(id));
}

// The sorted, de-duplicated violation codes of one table row (an empty list is a pass). Codes only: no message carries file content.
// A rule that needs the host's manifest is skipped for an id that is not a host id (identity already reports it).
export function checkHostRowContract(id: string, row: HostRuntimeEntry, deps: RowContractDeps = {}): readonly RowViolation[] {
  const table = deps.table ?? HOST_RUNTIMES;
  const found = new Set<RowViolation>();
  const flag = (code: RowViolation, failed: boolean): void => {
    if (failed) {
      found.add(code);
    }
  };
  flag("not-frozen", !isDeepFrozen(row));
  flag("identity", identityViolation(id, row, table));
  flag("home-unsafe", homeUnsafe(row));
  flag("env-shape", envShape(row));
  flag("home-resolution", homeResolutionViolation(row, deps.resolveHomeSpecs ?? resolveHomeSpecs));
  flag("recipe-kind", recipeKindViolation(row));
  flag("shadow-shape", shadowShapeViolation(row));
  flag("pending-inert", pendingInertViolation(id, row));
  const argv = registeredArgvOf(row);
  const hasLaunch = row.integration === "mcp-config" && row.recipe !== null;
  flag("launch-unsafe", hasLaunch && launchUnsafe(argv));
  if (isHostId(id)) {
    const manifestFor = deps.manifestFor ?? defaultManifestFor;
    let manifest: HostPluginManifest | null;
    try {
      manifest = manifestFor(id, MANIFEST_VERSION);
    } catch {
      manifest = null;
    }
    flag("manifest", manifest === null || manifestViolation(row, manifest));
    if (manifest !== null) {
      const launch = manifest.launch;
      flag("launch-mismatch", hasLaunch && (argv === null || launch === undefined || !isDeepStrictEqual([...argv], [launch.command, ...launch.args])));
      let parses = true;
      try {
        parseHostPluginManifest(manifest);
      } catch {
        parses = false;
      }
      flag("capability-grant", parses && capabilityViolation(manifest, deps.resolveCapabilities ?? resolveCapabilities));
    }
  }
  return [...found].sort();
}

// ---- the generic lifecycle contract (TEST-HOST-03) -----------------------------------------------------------------------------------------

export const LIFECYCLE_VIOLATIONS = Object.freeze([
  "dry-run-wrote",
  "outside-write",
  "receipt-content",
  "audit-chain",
  "audit-secret",
  "log-secret",
  "log-vocabulary",
  "install-not-applied",
  "reinstall-not-noop",
  "neighbor-lost",
  "unowned-removed",
  "uninstall-not-restoring",
  "override-leak",
  "pending-wrote",
] as const);
export type LifecycleViolation = (typeof LIFECYCLE_VIOLATIONS)[number];

// A neighbor added after the install. Neither planted string contains the other.
export const LATER_NEIGHBOR = "REALM-NEIGHBOR-2c8e51d0";

// Where a stage hook is called from: which fresh rig of the scenario (the neighbor rig runs the whole scenario, the restore rig the
// install and uninstall of the unmodified seed, the override rig the install with the override variable set) and which operation.
export interface LifecycleScene {
  readonly rig: "neighbor" | "restore" | "override";
  readonly op: "install" | "uninstall";
  readonly root: string;
  readonly home: string;
  readonly installHome: string;
  // The recipe file, or the bundle destination directory.
  readonly recipeFile: string;
}

// The seams a defect is injected through (the same ones createHostAdapter takes). `logger` wraps the capturing logger so the contract can
// still read the lines; `stageHook` also receives the scene, because the fixture root is created inside the contract.
export interface LifecycleOptions {
  readonly audit?: HostAuditFn;
  readonly logger?: (base: Logger) => Logger;
  readonly stageHook?: (stage: HostEngineStage, path: string, scene: LifecycleScene) => void;
}

interface SeedFile {
  readonly path: string;
  readonly content: string;
}

interface Seed {
  readonly files: readonly SeedFile[];
  // Adds a second neighbor through the same format, after the install.
  readonly addLater: () => void;
}

const HEX64 = /^[0-9a-f]{64}$/;
const STUB_BUNDLE_FILE = "export default function realmFixtureStub() {}\n";
const LOG_EVENTS: readonly string[] = ["host.install.plan", "host.install.applied", "host.uninstall.plan", "host.uninstall.applied"];

function renderJson(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function jsonSeed(recipe: Extract<InstallRecipe, { kind: "json-merge" }>, installHome: string): Seed {
  const path = join(installHome, recipe.file);
  const parentPath = recipe.keyPath.slice(0, -1);
  const doc: Record<string, unknown> = { "unrelated-setting": "kept" };
  let cursor = doc;
  for (const key of parentPath) {
    const next: Record<string, unknown> = {};
    cursor[key] = next;
    cursor = next;
  }
  cursor["neighbor-server"] = { command: "other-cmd", note: MARKER };
  return {
    files: [{ path, content: renderJson(doc) }],
    addLater: () => {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isRecord(parsed)) {
        throw new Error("the seeded file is no longer a JSON object");
      }
      let node: Record<string, unknown> = parsed;
      for (const key of parentPath) {
        const next = node[key];
        if (!isRecord(next)) {
          throw new Error("the seeded parent object is gone");
        }
        node = next;
      }
      node["later-neighbor"] = { command: "other-cmd", note: LATER_NEIGHBOR };
      writeFileSync(path, renderJson(parsed));
    },
  };
}

function tomlSeed(recipe: Extract<InstallRecipe, { kind: "toml-table" }>, installHome: string): Seed {
  const path = join(installHome, recipe.file);
  const parent = recipe.table.slice(0, -1).join(".");
  const named = (leaf: string): string => (parent === "" ? leaf : `${parent}.${leaf}`);
  const content = `# ${MARKER}\nmodel = "x"\n\n[profile.local]\nname = "x"\n\n[${named("other")}]\ncommand = "other-cmd"\nargs = ["hi"]\n`;
  return {
    files: [{ path, content }],
    addLater: () => {
      writeFileSync(path, `${readFileSync(path, "utf8")}\n[${named("later")}]\ncommand = "other-cmd"\nnote = "${LATER_NEIGHBOR}"\n`);
    },
  };
}

function yamlSeed(recipe: Extract<InstallRecipe, { kind: "yaml-map" }>, installHome: string): Seed {
  const path = join(installHome, recipe.file);
  const valid = YAML_VALID.find((item) => item.name === "the shape of a real Hermes file");
  if (valid === undefined) {
    throw new Error("the shared YAML case table lost the Hermes-shaped seed");
  }
  return {
    files: [{ path, content: `# ${MARKER}\n${valid.seed}` }],
    addLater: () => {
      const text = readFileSync(path, "utf8");
      if (!text.includes(ENTRY_2)) {
        throw new Error("the installed YAML entry is not in the shared shape");
      }
      writeFileSync(path, text.replace(ENTRY_2, () => `${ENTRY_2}  later-neighbor:\n    command: other-cmd\n    description: ${LATER_NEIGHBOR}\n`));
    },
  };
}

function textSeed(recipe: Extract<InstallRecipe, { kind: "text-block" }>, installHome: string): Seed {
  const path = join(installHome, recipe.file);
  return {
    files: [{ path, content: `# ${MARKER}\nsetting = "kept"\n` }],
    addLater: () => {
      writeFileSync(path, `${readFileSync(path, "utf8")}# ${LATER_NEIGHBOR}\n`);
    },
  };
}

function bundleSeed(recipe: Extract<InstallRecipe, { kind: "bundle-copy" }>, installHome: string): Seed {
  const beside = dirname(join(installHome, recipe.dest));
  return {
    files: [{ path: join(beside, "neighbor.txt"), content: `${MARKER}\n` }],
    addLater: () => {
      writeFileSync(join(beside, "later-neighbor.txt"), `${LATER_NEIGHBOR}\n`);
    },
  };
}

// The seed a recipe kind gets: an unrelated neighbor holding the planted secret, in the recipe's own format. No per-host knowledge.
function seedFor(recipe: InstallRecipe, installHome: string): Seed {
  switch (recipe.kind) {
    case "json-merge":
      return jsonSeed(recipe, installHome);
    case "toml-table":
      return tomlSeed(recipe, installHome);
    case "yaml-map":
      return yamlSeed(recipe, installHome);
    case "text-block":
      return textSeed(recipe, installHome);
    case "bundle-copy":
      return bundleSeed(recipe, installHome);
  }
}

// Whether the realm-owned entry is still in the file (or the bundle destination still exists). An unreadable file counts as still owned.
function ownedPresent(recipe: InstallRecipe, target: string): boolean {
  if (!existsSync(target)) {
    return false;
  }
  switch (recipe.kind) {
    case "bundle-copy":
      return true;
    case "json-merge": {
      try {
        let node: unknown = JSON.parse(readFileSync(target, "utf8"));
        for (const key of recipe.keyPath) {
          if (!isRecord(node) || !Object.hasOwn(node, key)) {
            return false;
          }
          node = node[key];
        }
        return true;
      } catch {
        return true;
      }
    }
    case "toml-table":
      return readFileSync(target, "utf8").includes(recipe.text);
    case "text-block":
      return readFileSync(target, "utf8").includes(recipe.block);
    case "yaml-map":
      return readFileSync(target, "utf8").split("\n").some((line) => line.trim() === `${recipe.path[1]}:`);
  }
}

// The text a receipt must not hold: the recipe's own value. (Hashes only: a receipt never carries what Realm wrote.)
function recipeTexts(recipe: InstallRecipe): readonly string[] {
  switch (recipe.kind) {
    case "json-merge":
    case "yaml-map":
      return [JSON.stringify(recipe.value)];
    case "toml-table":
      return [recipe.text];
    case "text-block":
      return [recipe.block];
    case "bundle-copy":
      return [];
  }
}

function targetOf(recipe: InstallRecipe | null, installHome: string): string {
  if (recipe === null) {
    return installHome;
  }
  return join(installHome, recipe.kind === "bundle-copy" ? recipe.dest : recipe.file);
}

interface LifecycleRig {
  readonly host: FixtureHost;
  readonly log: CapturedLog;
  readonly env: HostEnv;
  readonly adapter: RecipeHostAdapter;
  readonly installHome: string;
  readonly target: string;
  readonly overrideDir: string;
  // The operation a stage hook reports; the scenario sets it before each call.
  readonly state: { op: LifecycleScene["op"] };
}

// A fresh fixture root with the row's homes created. The "override" rig sets the row's variable to <root>/override.
function buildLifecycleRig(t: TestContext, id: HostId, rigName: LifecycleScene["rig"], options: LifecycleOptions): LifecycleRig {
  const row = HOST_RUNTIMES[id];
  const host = makeFixtureHost(t, { createConfigHome: false });
  if (!host.root.startsWith(realpathSync(tmpdir()))) {
    throw new Error(`${id}: the fixture root is not under the temporary directory`);
  }
  const overrideDir = join(host.root, "override");
  const variable = row.envOverride ?? row.envBase?.name ?? null;
  const env: HostEnv = { home: host.home, env: rigName === "override" && variable !== null ? { [variable]: overrideDir } : {}, pathDirs: [] };
  if (rigName === "override") {
    if (variable === null) {
      throw new Error(`${id}: the row has no override variable`);
    }
    mkdirSync(overrideDir);
  }
  const specs = resolveHomeSpecs(row, env);
  for (const spec of specs) {
    mkdirSync(spec.path, { recursive: true });
  }
  const recipe = row.recipe;
  const role = recipe?.homeRole ?? "config";
  const installHome = specs.find((spec) => spec.role === role)?.path ?? host.home;
  const target = targetOf(recipe, installHome);
  if (recipe?.kind === "bundle-copy") {
    writeAt(join(host.adaptersDir, recipe.source, "index.js"), STUB_BUNDLE_FILE);
  }
  const log = captureLog();
  const state: { op: LifecycleScene["op"] } = { op: "install" };
  let counter = 0;
  const adapter = createHostAdapter(row, defaultManifestFor(id, MANIFEST_VERSION), {
    stateDir: host.stateDir,
    adaptersDir: host.adaptersDir,
    logger: options.logger === undefined ? log.logger : options.logger(log.logger),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    newCorrelationId: () => {
      counter += 1;
      return `corr-${String(counter)}`;
    },
    readTimeoutMs: 2000,
    ...(options.audit === undefined ? {} : { audit: options.audit }),
    stageHook: (stage, path) => {
      options.stageHook?.(stage, path, { rig: rigName, op: state.op, root: host.root, home: host.home, installHome, recipeFile: target });
    },
  });
  return { host, log, env, adapter, installHome, target, overrideDir, state };
}

function plant(seed: Seed): void {
  for (const file of seed.files) {
    writeAt(file.path, file.content);
  }
}

function treeText(dir: string): string {
  return filesUnder(dir)
    .map((rel) => readFileSync(join(dir, rel), "utf8"))
    .join("\n");
}

// Every path under root with its kind and, for a file, its content hash: D (directory), F:hash, L:target.
function snapshot(root: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const relPath = rel === "" ? name : `${rel}/${name}`;
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) {
        out.set(relPath, `L:${readlinkSync(path)}`);
      } else if (stats.isDirectory()) {
        out.set(relPath, "D");
        walk(path, relPath);
      } else {
        out.set(relPath, `F:${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
      }
    }
  };
  walk(root, "");
  return out;
}

interface Change {
  readonly path: string;
  readonly dir: boolean;
}

function changedPaths(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): readonly Change[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => before.get(path) !== after.get(path))
    .sort()
    .map((path) => ({ path, dir: (after.get(path) ?? before.get(path)) === "D" }));
}

// A hash of everything under root except the named subtrees.
function outsideHash(root: string, excluded: readonly string[]): string {
  const hash = createHash("sha256");
  for (const name of readdirSync(root).sort()) {
    if (!excluded.includes(join(root, name))) {
      hash.update(`${name} ${treeHash(join(root, name))}\n`);
    }
  }
  return hash.digest("hex");
}

function posixRel(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

// An install may change the recipe file (or the bundle destination), directories below the resolved home, and the receipt, the audit chain
// and host.log under the state directory. Anything else is a write outside.
function installChangeAllowed(change: Change, rig: LifecycleRig, recipe: InstallRecipe): boolean {
  const root = rig.host.root;
  const state = posixRel(root, rig.host.stateDir);
  if (change.path === `${state}/host.log` || change.path === `${state}/hosts` || change.path === `${state}/audit`) {
    return true;
  }
  if (change.path.startsWith(`${state}/hosts/`) || change.path.startsWith(`${state}/audit/`)) {
    return true;
  }
  const home = posixRel(root, rig.installHome);
  const inHome = change.path === home || change.path.startsWith(`${home}/`);
  if (!inHome) {
    return false;
  }
  if (change.dir) {
    return true;
  }
  const target = posixRel(root, rig.target);
  return recipe.kind === "bundle-copy" ? change.path === target || change.path.startsWith(`${target}/`) : change.path === target;
}

async function uninstallRefused(run: () => Promise<HostOperationDetail>): Promise<HostOperationDetail | null> {
  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof HostRefusal) {
      return null;
    }
    throw error;
  }
}

async function pendingScenario(t: TestContext, id: HostId, options: LifecycleOptions, found: Set<LifecycleViolation>): Promise<void> {
  const rig = buildLifecycleRig(t, id, "neighbor", options);
  const before = treeHash(rig.host.root);
  const refusal = refusedWith("recipe-pending", "POLICY_DENIED");
  let accepted = false;
  for (const dryRun of [true, false]) {
    try {
      await rig.adapter.install(rig.env, { dryRun });
      accepted = true;
    } catch (error: unknown) {
      accepted = accepted || !refusal(error);
    }
  }
  const undone = await rig.adapter.uninstall(rig.env, { dryRun: false });
  const wrote =
    accepted ||
    undone.changed ||
    treeHash(rig.host.root) !== before ||
    existsSync(receiptPath(rig.host.stateDir, id)) ||
    existsSync(join(rig.host.stateDir, "audit"));
  if (wrote) {
    found.add("pending-wrote");
  }
}

async function receiptViolation(rig: LifecycleRig, id: HostId, recipe: InstallRecipe): Promise<boolean> {
  try {
    const read = await readReceipt(rig.host.stateDir, id, 2000);
    if (read === null) {
      return true;
    }
    const receipt = read.receipt;
    const entriesOk = receipt.entries.every(
      (entry) =>
        isSafeRelPath(entry.path) &&
        HEX64.test(entry.afterSha256) &&
        (entry.beforeSha256 === null || HEX64.test(entry.beforeSha256)) &&
        (entry.ownedSha256 === undefined || HEX64.test(entry.ownedSha256)),
    );
    if (receipt.hostId !== id || receipt.recipeKind !== recipe.kind || receipt.configHome !== rig.installHome || !entriesOk) {
      return true;
    }
    const bytes = readFileSync(receiptPath(rig.host.stateDir, id), "utf8");
    return bytes.includes(MARKER) || recipeTexts(recipe).some((text) => bytes.includes(text));
  } catch {
    return true;
  }
}

function hostOfLine(line: string): unknown {
  const parsed: unknown = JSON.parse(line);
  return isRecord(parsed) ? parsed["host"] : undefined;
}

// The scenario of D-26-05 on the real row: the neighbor rig (steps 1 to 7), the restore rig (8) and, for a row with a variable, the override rig (9).
async function recipeScenario(t: TestContext, id: HostId, recipe: InstallRecipe, options: LifecycleOptions, found: Set<LifecycleViolation>): Promise<void> {
  const rig = buildLifecycleRig(t, id, "neighbor", options);
  const { host } = rig;
  const seed = seedFor(recipe, rig.installHome);
  plant(seed);
  const seeded = treeHash(host.root);
  const outsideBefore = outsideHash(host.root, [host.home, host.stateDir]);
  const receiptFile = receiptPath(host.stateDir, id);
  const audit = auditFile(host.stateDir);

  // 1. dry run: nothing is written.
  rig.state.op = "install";
  await rig.adapter.install(rig.env, { dryRun: true });
  if (treeHash(host.root) !== seeded || existsSync(receiptFile) || existsSync(join(host.stateDir, "audit"))) {
    found.add("dry-run-wrote");
  }

  // 2. install: only the recipe file or bundle, directories below the resolved home, and the state files change.
  const before = snapshot(host.root);
  const installed = await rig.adapter.install(rig.env, { dryRun: false });
  const stray = changedPaths(before, snapshot(host.root)).filter((change) => !installChangeAllowed(change, rig, recipe));
  if (!installed.changed || installed.outcome !== "installed") {
    found.add("install-not-applied");
  }
  if (stray.length > 0 || outsideHash(host.root, [host.home, host.stateDir]) !== outsideBefore) {
    found.add("outside-write");
  }
  if ((await rig.adapter.status(rig.env)).status !== "installed") {
    found.add("install-not-applied");
  }

  // 3. the receipt holds relative paths and hashes only. 4. the audit chain verifies and holds two lines.
  if (await receiptViolation(rig, id, recipe)) {
    found.add("receipt-content");
  }
  const chain = checkAuditFile(audit);
  if (!chain.ok || chain.lines !== 2) {
    found.add("audit-chain");
  }

  // 6. a reinstall is a no-op.
  const installedTree = treeHash(host.root);
  const again = await rig.adapter.install(rig.env, { dryRun: false });
  if (again.changed || again.outcome !== "noop" || auditLineCount(host.stateDir) !== 2 || treeHash(host.root) !== installedTree) {
    found.add("reinstall-not-noop");
  }

  // 7. a neighbor added after the install survives the uninstall, and so does the seeded one; the owned entry is gone.
  seed.addLater();
  rig.state.op = "uninstall";
  const removed = await uninstallRefused(() => rig.adapter.uninstall(rig.env, { dryRun: false }));
  const text = treeText(host.home);
  if (!text.includes(MARKER)) {
    found.add("unowned-removed");
  }
  if (!text.includes(LATER_NEIGHBOR)) {
    found.add("neighbor-lost");
  }
  if (removed?.outcome !== "removed" || existsSync(receiptFile) || ownedPresent(recipe, rig.target)) {
    found.add("uninstall-not-restoring");
  }
  const chainAfter = checkAuditFile(audit);
  if (!chainAfter.ok || chainAfter.lines !== 4) {
    found.add("audit-chain");
  }
  const second = await uninstallRefused(() => rig.adapter.uninstall(rig.env, { dryRun: false }));
  if (second === null || second.changed || second.outcome !== "noop") {
    found.add("uninstall-not-restoring");
  }

  // 4 and 5. no planted string reaches the audit chain or the log, and the log holds the closed event vocabulary and this host only.
  const auditText = existsSync(audit) ? readFileSync(audit, "utf8") : "";
  if (auditText.includes(MARKER) || auditText.includes(LATER_NEIGHBOR)) {
    found.add("audit-secret");
  }
  const logText = rig.log.lines.join("\n");
  if (logText.includes(MARKER) || logText.includes(LATER_NEIGHBOR)) {
    found.add("log-secret");
  }
  if (eventsOf(rig.log.lines).some((event) => !LOG_EVENTS.includes(event)) || rig.log.lines.some((line) => hostOfLine(line) !== id)) {
    found.add("log-vocabulary");
  }

  // 8. restoration: the unmodified seed comes back byte for byte (the home subtree), the receipt is gone, a second uninstall is a no-op.
  const restore = buildLifecycleRig(t, id, "restore", options);
  plant(seedFor(recipe, restore.installHome));
  const seededHome = treeHash(restore.host.home);
  restore.state.op = "install";
  await restore.adapter.install(restore.env, { dryRun: false });
  restore.state.op = "uninstall";
  const restoreRemoved = await uninstallRefused(() => restore.adapter.uninstall(restore.env, { dryRun: false }));
  const restoreSecond = await uninstallRefused(() => restore.adapter.uninstall(restore.env, { dryRun: false }));
  if (
    restoreRemoved?.outcome !== "removed" ||
    treeHash(restore.host.home) !== seededHome ||
    existsSync(receiptPath(restore.host.stateDir, id)) ||
    restoreSecond === null ||
    restoreSecond.changed
  ) {
    found.add("uninstall-not-restoring");
  }

  // 9. override: the variable moves everything and nothing is written in the default home.
  const entry = HOST_RUNTIMES[id];
  if (entry.envOverride !== null || entry.envBase !== undefined) {
    const over = buildLifecycleRig(t, id, "override", options);
    plant(seedFor(recipe, over.installHome));
    const defaultBefore = treeHash(over.host.home);
    over.state.op = "install";
    await over.adapter.install(over.env, { dryRun: false });
    if (!over.installHome.startsWith(over.overrideDir) || !existsSync(over.target) || treeHash(over.host.home) !== defaultBefore) {
      found.add("override-leak");
    }
  }
}

// Runs the scenario on HOST_RUNTIMES[id] (the real row) in fresh fixture roots that `t` removes when its test ends, and returns the sorted
// violation codes. A row without a recipe runs only the refusal scenario. It never throws for a contract violation, only for a harness error.
export async function lifecycleContract(t: TestContext, id: HostId, options: LifecycleOptions = {}): Promise<readonly LifecycleViolation[]> {
  const found = new Set<LifecycleViolation>();
  const recipe = HOST_RUNTIMES[id].recipe;
  if (recipe === null) {
    await pendingScenario(t, id, options, found);
  } else {
    await recipeScenario(t, id, recipe, options, found);
  }
  return [...found].sort();
}

// A log call that carries the planted secret as a field: the defect of the seeded-defect table, exported so the table and the unit tests share one.
export function leakingLogger(base: Logger): Logger {
  const add = (fields: LogFields | undefined): LogFields => ({ ...fields, leak: MARKER });
  return {
    debug: (event, fields) => {
      base.debug(event, add(fields));
    },
    info: (event, fields) => {
      base.info(event, add(fields));
    },
    warn: (event, fields) => {
      base.warn(event, add(fields));
    },
    error: (event, fields) => {
      base.error(event, add(fields));
    },
    child: (fields) => leakingLogger(base.child(fields)),
    droppedLines: (category) => base.droppedLines(category),
  };
}
