// The shared recipe suites of Phase 24 (plan 24-02) and Phase 25 (plan 25-02): one lifecycle, drift, concurrency, mode, doctor, override and hostile-content
// suite, run against the REAL table row of each host (never a fixture entry), so a wrong home, file, override, binary or recipe
// value fails a named test. `defineHostRecipeSuite` is for json-merge hosts, `defineHostTomlSuite` for the toml-table host (Codex) and
// `defineHostYamlSuite` for the yaml-map host (Hermes), which also runs the shared YAML case table of host-yaml-cases.ts.
// Every root is a real temporary directory removed when the test ends; nothing outside it is read or written, and no host runs.

import { execFileSync } from "node:child_process";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { checkAuditFile } from "../../src/audit/chain.js";
import { SchemaInvalidError } from "../../src/contract/validate.js";
import { hostPluginsCheck } from "../../src/doctor/host-checks.js";
import { createHostAdapter, type HostAdapterDeps, type RecipeHostAdapter } from "../../src/host/adapter.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { readReceipt, receiptPath } from "../../src/host/receipt.js";
import { HostRefusal, type HostRefusalReason } from "../../src/host/recipe.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import type { HostEnv, HostId } from "../../src/host/types.js";
import { captureLog, makeFixtureHost, treeHash, type CapturedLog, type FixtureHost } from "./fixture-host.js";
import { BLOCK, ENTRY_2, YAML_FOREIGN, YAML_UNPARSEABLE, YAML_VALID } from "./host-yaml-cases.js";

export interface HostSuiteBase {
  readonly id: HostId;
  // The requirement id used as the title prefix, e.g. "ADPT-04".
  readonly req: string;
  // The recipe file's name inside the install home.
  readonly file: string;
  // The install home and the detection home below HOME ("." is HOME itself).
  readonly installHomeRel: string;
  readonly detectHomeRel: string;
  // The binary the table names for detection, or null when the host has none.
  readonly binary: string | null;
  // The override variable and the install home it yields for a given (absolute) variable value; null when the host documents none.
  readonly override: { readonly variable: string; readonly homeOf: (value: string) => string } | null;
}

export interface JsonFormat {
  readonly indent: string;
  readonly eol: string;
  readonly trailing: boolean;
}

export const DEFAULT_FORMAT: JsonFormat = { indent: "  ", eol: "\n", trailing: true };

export interface JsonSuiteDescriptor extends HostSuiteBase {
  // The top-level key above `realm` (mcpServers, mcp).
  readonly parentKey: string;
  // The entry the recipe writes, with the key order the table uses.
  readonly entry: Readonly<Record<string, unknown>>;
  // A realistic existing document without a realm entry, and the format it is stored in.
  readonly seedDoc: Readonly<Record<string, unknown>>;
  readonly seedFormat: JsonFormat;
  // The top-level members a file the install creates holds before the entry (the recipe's seed); absent for a host without one.
  readonly createdSeed?: Readonly<Record<string, unknown>>;
  // The one top-level key whose presence refuses the install (the recipe's refuseIfPresent); absent for a host without one.
  readonly rival?: string;
}

export interface TomlSuiteDescriptor extends HostSuiteBase {
  // The owned table, with its trailing newline.
  readonly table: string;
  readonly seed: string;
}

export const MARKER = "REALM-MARKER-7f3a9c41";
const APPENDED = "appended-by-another-writer";
// The markers of the first Codex recipe. No recipe writes them any more; a file that still holds them is ordinary text.
const OLD_BEGIN = "# BEGIN realm host-plugin";
const OLD_END = "# END realm host-plugin";

// ---- rig ---------------------------------------------------------------------------------------------------------------------

export interface HostRig {
  readonly host: FixtureHost;
  readonly log: CapturedLog;
  readonly adapter: RecipeHostAdapter;
  readonly env: HostEnv;
  // The directory the recipe file lives in (the default one, or the override's).
  readonly homeDir: string;
  readonly file: string;
  readonly binDir: string;
  readonly overrideDir: string;
  readonly adapterWith: (extra: Partial<HostAdapterDeps>) => RecipeHostAdapter;
  // A hash of everything a host could own: HOME and the override directory.
  readonly watched: () => string;
}

export interface RigOptions {
  // Create the detection home and the install home (default true).
  readonly home?: boolean;
  // Point the override variable at <root>/override.
  readonly override?: boolean;
  // Put <root>/bin on the PATH the adapter sees.
  readonly path?: boolean;
  readonly seed?: string | Uint8Array;
  readonly deps?: Partial<HostAdapterDeps>;
}

export function writeSeed(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function executable(path: string): void {
  writeFileSync(path, "#!/bin/sh\n", { mode: 0o755 });
  chmodSync(path, 0o755);
}

export function buildRig(t: TestContext, d: HostSuiteBase, options: RigOptions = {}): HostRig {
  const host = makeFixtureHost(t, { createConfigHome: false });
  assert.ok(host.root.startsWith(realpathSync(tmpdir())), "the root is under the temporary directory");
  const log = captureLog();
  const binDir = join(host.root, "bin");
  mkdirSync(binDir);
  const overrideDir = join(host.root, "override");
  const override = options.override === true ? d.override : null;
  assert.ok(options.override !== true || override !== null, "a host without an override variable has no override rig");
  const homeDir = override === null ? join(host.home, d.installHomeRel) : override.homeOf(overrideDir);
  if (override !== null) {
    mkdirSync(overrideDir);
  }
  if (options.home !== false) {
    mkdirSync(join(host.home, d.detectHomeRel), { recursive: true });
    mkdirSync(homeDir, { recursive: true });
  }
  const file = join(homeDir, d.file);
  if (options.seed !== undefined) {
    writeSeed(file, options.seed);
  }
  const env: HostEnv = {
    home: host.home,
    env: override === null ? {} : { [override.variable]: overrideDir },
    pathDirs: options.path === true ? [binDir] : [],
  };
  let counter = 0;
  const adapterWith = (extra: Partial<HostAdapterDeps>): RecipeHostAdapter =>
    createHostAdapter(HOST_RUNTIMES[d.id], defaultManifestFor(d.id, "0.0.0"), {
      stateDir: host.stateDir,
      adaptersDir: host.adaptersDir,
      logger: log.logger,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      newCorrelationId: () => {
        counter += 1;
        return `corr-${String(counter)}`;
      },
      readTimeoutMs: 2000,
      ...extra,
    });
  return {
    host,
    log,
    adapter: adapterWith(options.deps ?? {}),
    env,
    homeDir,
    file,
    binDir,
    overrideDir,
    adapterWith,
    watched: () => `${treeHash(host.home)}|${treeHash(overrideDir)}`,
  };
}

export function refusedWith(reason: HostRefusalReason, errorCode: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof HostRefusal && error.refusal === reason && error.code === errorCode;
}

// Every regular file under dir, relative, POSIX separators, sorted. Never reads a file.
export function filesUnder(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const relPath = rel === "" ? name : `${rel}/${name}`;
    if (lstatSync(join(dir, name)).isDirectory()) {
      out.push(...filesUnder(join(dir, name), relPath));
    } else {
      out.push(relPath);
    }
  }
  return out;
}

export function auditFile(stateDir: string): string {
  return join(stateDir, "audit", "host-plugins.jsonl");
}

export function auditLineCount(stateDir: string): number {
  return existsSync(auditFile(stateDir)) ? readFileSync(auditFile(stateDir), "utf8").split("\n").filter((line) => line !== "").length : 0;
}

export function nothingWritten(r: HostRig, d: HostSuiteBase, before: string): void {
  assert.equal(treeHash(r.host.root), before, "no file changed");
  assert.equal(existsSync(receiptPath(r.host.stateDir, d.id)), false, "no receipt");
  assert.equal(existsSync(join(r.host.stateDir, "audit")), false, "no audit directory");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDoc(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  assert.ok(isRecord(parsed), "the file holds a JSON object");
  return parsed;
}

export function render(doc: unknown, format: JsonFormat = DEFAULT_FORMAT): string {
  let text = JSON.stringify(doc, null, format.indent);
  if (format.eol === "\r\n") {
    text = text.replace(/\n/g, "\r\n");
  }
  return format.trailing ? `${text}${format.eol}` : text;
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

// ---- flavors: what differs between a JSON file and a TOML file -----------------------------------------------------------------

interface Flavor {
  readonly seed: string;
  // What an install over `seed` writes, and what an install writes when there is no file.
  readonly seedResult: string;
  readonly created: string;
  // Whether `text` holds the owned entry exactly as the recipe writes it.
  readonly owns: (text: string) => boolean;
  // The user changes the owned part, removes it as the host's own remover would, or adds an unrelated server.
  readonly edit: (text: string) => string;
  readonly remove: (text: string) => string;
  // The status of the entry after `remove`: a JSON entry or a text block removed is "drifted"; a TOML table removed is "missing".
  readonly removedState?: "missing";
  readonly addOther: (text: string) => string;
  readonly keepsOther: (text: string) => boolean;
  // Another writer adds one sibling key; and a text that carries a unique marker value.
  readonly append: (text: string) => string;
  readonly hasAppended: (text: string) => boolean;
  readonly mark: (text: string) => string;
}

export function withEntry(d: JsonSuiteDescriptor, doc: Record<string, unknown>): Record<string, unknown> {
  const existing = doc[d.parentKey];
  return { ...doc, [d.parentKey]: { ...(isRecord(existing) ? existing : {}), realm: d.entry } };
}

function jsonFlavor(d: JsonSuiteDescriptor): Flavor {
  const parentOf = (doc: Record<string, unknown>): Record<string, unknown> => {
    const parent = doc[d.parentKey];
    assert.ok(isRecord(parent), "the parent object is present");
    return parent;
  };
  const rewrite = (text: string, change: (doc: Record<string, unknown>) => void): string => {
    const doc = parseDoc(text);
    change(doc);
    return render(doc);
  };
  return {
    seed: render(d.seedDoc, d.seedFormat),
    seedResult: render(withEntry(d, { ...d.seedDoc }), d.seedFormat),
    created: render(withEntry(d, { ...d.createdSeed })),
    // False, not an assertion failure, when the parent object is absent: a seed without it has no Realm entry either.
    owns: (text) => {
      const parent = parseDoc(text)[d.parentKey];
      return isRecord(parent) && isDeepStrictEqual(parent["realm"], d.entry);
    },
    edit: (text) =>
      rewrite(text, (doc) => {
        parentOf(doc)["realm"] = { ...d.entry, command: "evil" };
      }),
    remove: (text) =>
      rewrite(text, (doc) => {
        Reflect.deleteProperty(parentOf(doc), "realm");
      }),
    addOther: (text) =>
      rewrite(text, (doc) => {
        parentOf(doc)["other"] = { command: "other" };
      }),
    keepsOther: (text) => isDeepStrictEqual(parentOf(parseDoc(text))["other"], { command: "other" }),
    append: (text) =>
      rewrite(text, (doc) => {
        doc[APPENDED] = true;
      }),
    hasAppended: (text) => parseDoc(text)[APPENDED] === true,
    mark: (text) =>
      rewrite(text, (doc) => {
        doc["note"] = MARKER;
      }),
  };
}

// What the engine writes for an install over `seed` (null: no file): the table after one blank line, in the file's line ending.
export function expectedTable(table: string, seed: string | null): string {
  if (seed === null) {
    return table;
  }
  const eol = seed.includes("\r\n") ? "\r\n" : "\n";
  const body = table.replaceAll("\n", eol);
  if (seed === "" || /\n\r?\n$/.test(seed)) {
    return `${seed}${body}`;
  }
  return `${seed}${seed.endsWith("\n") ? eol : `${eol}${eol}`}${body}`;
}

function tomlFlavor(d: TomlSuiteDescriptor): Flavor {
  return {
    seed: d.seed,
    seedResult: expectedTable(d.table, d.seed),
    created: expectedTable(d.table, null),
    owns: (text) => text.includes(d.table.replaceAll("\n", text.includes("\r\n") ? "\r\n" : "\n")),
    edit: (text) => text.replace('command = "realm"', 'command = "evil"'),
    // What `codex mcp remove realm` does: the table is gone, nothing else is touched.
    remove: (text) => {
      assert.ok(text.includes(d.table), "the owned table is present");
      return text.replace(d.table, "");
    },
    removedState: "missing",
    addOther: (text) => `${text}\n[mcp_servers.other]\ncommand = "other"\n`,
    keepsOther: (text) => text.includes('[mcp_servers.other]\ncommand = "other"\n'),
    append: (text) => `${text}\n# ${APPENDED}\n`,
    hasAppended: (text) => text.includes(`# ${APPENDED}`),
    mark: (text) => `${text}\n# ${MARKER}\n`,
  };
}

// ---- cases shared by both kinds --------------------------------------------------------------------------------------------------

function defineCommonCases(d: HostSuiteBase, flavor: Flavor): void {
  const tag = `${d.req} ${d.id}`;

  void test(`${tag}: detect by the config home alone, by the binary alone, never by a look-alike, and not at all on an empty machine`, async (t) => {
    const byHome = buildRig(t, d);
    const home = await byHome.adapter.detect(byHome.env);
    assert.equal(home.detected, true);
    assert.equal(home.via, "home");
    assert.equal(home.binary, null);

    const bare = buildRig(t, d, { home: false, path: true });
    if (d.binary === null) {
      // `kimi` is the command of two different products, so a binary on PATH says nothing about which one it is.
      executable(join(bare.binDir, "kimi"));
      const found = await bare.adapter.detect(bare.env);
      assert.equal(found.detected, false);
      assert.equal(found.binary, null);
    } else {
      executable(join(bare.binDir, d.binary));
      const found = await bare.adapter.detect(bare.env);
      assert.equal(found.detected, true);
      assert.equal(found.via, "binary");
      assert.equal(found.binary, d.binary);
      const plain = buildRig(t, d, { home: false, path: true });
      writeFileSync(join(plain.binDir, d.binary), "#!/bin/sh\n", { mode: 0o644 });
      chmodSync(join(plain.binDir, d.binary), 0o644);
      assert.equal((await plain.adapter.detect(plain.env)).detected, false, "a file without an execute bit is not a binary");
    }

    const empty = buildRig(t, d, { home: false });
    assert.equal((await empty.adapter.detect(empty.env)).detected, false);
    const before = treeHash(empty.host.root);
    for (const dryRun of [true, false]) {
      await assert.rejects(empty.adapter.install(empty.env, { dryRun }), refusedWith("not-detected", "POLICY_DENIED"));
    }
    nothingWritten(empty, d, before);
  });

  for (const variant of ["fresh", "seeded"] as const) {
    void test(`${tag}: lifecycle on a ${variant} home: dry run, install, status, no-op reinstall, uninstall, no-op uninstall`, async (t) => {
      const seed = variant === "seeded" ? flavor.seed : null;
      const r = buildRig(t, d, seed === null ? {} : { seed });
      const homeBefore = r.watched();
      const rootBefore = treeHash(r.host.root);
      const action = seed === null ? "create" : "update";
      assert.deepEqual(filesUnder(r.homeDir), seed === null ? [] : [d.file]);

      const dry = await r.adapter.install(r.env, { dryRun: true });
      assert.equal(dry.outcome, "planned");
      assert.equal(dry.changed, false);
      assert.deepEqual(dry.actions.map((item) => [item.path, item.action]), [[d.file, action]]);
      nothingWritten(r, d, rootBefore);

      const installed = await r.adapter.install(r.env, { dryRun: false });
      assert.equal(installed.outcome, "installed");
      assert.equal(installed.status, "installed");
      assert.equal(installed.changed, true);
      assert.deepEqual(installed.actions.map((item) => [item.path, item.action]), [[d.file, action]]);
      assert.deepEqual(filesUnder(r.homeDir), [d.file], "exactly one host file");
      assert.equal(readFileSync(r.file, "utf8"), seed === null ? flavor.created : flavor.seedResult);
      assert.equal(existsSync(receiptPath(r.host.stateDir, d.id)), true);
      assert.equal(auditLineCount(r.host.stateDir), 2);
      const chain = checkAuditFile(auditFile(r.host.stateDir));
      assert.equal(chain.ok, true);
      assert.equal(chain.lines, 2);

      const status = await r.adapter.status(r.env);
      assert.equal(status.status, "installed");
      assert.deepEqual(status.entries, [{ path: d.file, state: "ok" }]);
      assert.equal(status.launch, "not-on-path");
      executable(join(r.binDir, "realm"));
      assert.equal((await r.adapter.status({ ...r.env, pathDirs: [r.binDir] })).launch, "on-path");

      const installedTree = treeHash(r.host.root);
      const again = await r.adapter.install(r.env, { dryRun: false });
      assert.equal(again.outcome, "noop");
      assert.equal(again.changed, false);
      assert.equal(treeHash(r.host.root), installedTree, "a second install changes nothing");
      assert.equal(auditLineCount(r.host.stateDir), 2);

      const planned = await r.adapter.uninstall(r.env, { dryRun: true });
      assert.equal(planned.outcome, "planned");
      assert.equal(treeHash(r.host.root), installedTree);

      const removed = await r.adapter.uninstall(r.env, { dryRun: false });
      assert.equal(removed.outcome, "removed");
      assert.equal(removed.status, "detected");
      assert.equal(r.watched(), homeBefore, "the home is exactly as before");
      if (d.file.includes("/")) {
        // A file below subdirectories (Cline): the directories Realm created are removed, the host home itself never is.
        assert.equal(existsSync(r.homeDir), true, "the host home is never removed");
        assert.equal(existsSync(join(r.homeDir, d.file.slice(0, d.file.indexOf("/")))), seed !== null, "created directories are removed, a seeded one stays");
      }
      assert.equal(existsSync(r.file), seed !== null);
      if (seed !== null) {
        assert.equal(readFileSync(r.file, "utf8"), seed);
      }
      assert.equal(existsSync(receiptPath(r.host.stateDir, d.id)), false);
      assert.equal(auditLineCount(r.host.stateDir), 4);
      assert.equal(checkAuditFile(auditFile(r.host.stateDir)).lines, 4);

      const second = await r.adapter.uninstall(r.env, { dryRun: false });
      assert.equal(second.outcome, "noop");
      assert.equal(second.changed, false);
      assert.equal(r.watched(), homeBefore);
    });
  }

  void test(`${tag}: an edited owned entry is drifted: uninstall and reinstall refuse; a removed entry is drifted (a removed TOML table: missing) and uninstall is a clean no-op`, async (t) => {
    const edited = buildRig(t, d, { seed: flavor.seed });
    await edited.adapter.install(edited.env, { dryRun: false });
    writeFileSync(edited.file, flavor.edit(readFileSync(edited.file, "utf8")));
    const status = await edited.adapter.status(edited.env);
    assert.equal(status.status, "drifted");
    assert.deepEqual(status.entries, [{ path: d.file, state: "drifted" }]);
    const before = treeHash(edited.host.root);
    await assert.rejects(edited.adapter.uninstall(edited.env, { dryRun: false }), refusedWith("drifted", "POLICY_DENIED"));
    await assert.rejects(edited.adapter.install(edited.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
    assert.equal(treeHash(edited.host.root), before, "a refusal changes nothing");

    const removed = buildRig(t, d, { seed: flavor.seed });
    await removed.adapter.install(removed.env, { dryRun: false });
    writeFileSync(removed.file, flavor.remove(readFileSync(removed.file, "utf8")));
    const gone = await removed.adapter.status(removed.env);
    assert.equal(gone.status, "drifted");
    assert.deepEqual(gone.entries, [{ path: d.file, state: flavor.removedState ?? "drifted" }]);
    const noop = await removed.adapter.uninstall(removed.env, { dryRun: false });
    assert.equal(noop.outcome, "noop");
    assert.equal(existsSync(receiptPath(removed.host.stateDir, d.id)), false, "the stale receipt is deleted");
  });

  void test(`${tag}: an unrelated server added after install survives uninstall; a deleted file is missing; a symlinked file is unreadable`, async (t) => {
    const other = buildRig(t, d, { seed: flavor.seed });
    await other.adapter.install(other.env, { dryRun: false });
    writeFileSync(other.file, flavor.addOther(readFileSync(other.file, "utf8")));
    assert.equal((await other.adapter.status(other.env)).status, "installed", "an edit elsewhere is not drift");
    assert.equal((await other.adapter.uninstall(other.env, { dryRun: false })).outcome, "removed");
    const left = readFileSync(other.file, "utf8");
    assert.equal(flavor.keepsOther(left), true);
    assert.equal(flavor.owns(left), false);

    const deleted = buildRig(t, d, { seed: flavor.seed });
    await deleted.adapter.install(deleted.env, { dryRun: false });
    rmSync(deleted.file);
    const missing = await deleted.adapter.status(deleted.env);
    assert.equal(missing.status, "drifted");
    assert.deepEqual(missing.entries, [{ path: d.file, state: "missing" }]);
    assert.equal((await deleted.adapter.uninstall(deleted.env, { dryRun: false })).outcome, "noop");

    const linked = buildRig(t, d, { seed: flavor.seed });
    await linked.adapter.install(linked.env, { dryRun: false });
    const target = join(linked.host.root, "elsewhere");
    writeFileSync(target, readFileSync(linked.file));
    rmSync(linked.file);
    symlinkSync(target, linked.file);
    const unreadable = await linked.adapter.status(linked.env);
    assert.equal(unreadable.status, "drifted");
    assert.deepEqual(unreadable.entries, [{ path: d.file, state: "unreadable" }]);
  });

  void test(`${tag}: a change between plan and write is concurrent-change, the other writer's key survives and a re-run resumes`, async (t) => {
    let file = "";
    let fired = false;
    const r = buildRig(t, d, {
      seed: flavor.seed,
      deps: {
        stageHook: (stage) => {
          if (stage === "after-pending-receipt" && !fired) {
            fired = true;
            writeFileSync(file, flavor.append(readFileSync(file, "utf8")));
          }
        },
      },
    });
    file = r.file;
    await assert.rejects(r.adapter.install(r.env, { dryRun: false }), refusedWith("concurrent-change", "WRITE_NOT_ATOMIC"));
    const interrupted = readFileSync(r.file, "utf8");
    assert.equal(flavor.hasAppended(interrupted), true, "the other writer's key is still there");
    assert.equal(flavor.owns(interrupted), false, "the realm entry is not");
    assert.equal((await readReceipt(r.host.stateDir, d.id))?.receipt.state, "pending");

    const resumed = await r.adapterWith({}).install(r.env, { dryRun: false });
    assert.equal(resumed.outcome, "installed");
    const done = readFileSync(r.file, "utf8");
    assert.equal(flavor.hasAppended(done), true);
    assert.equal(flavor.owns(done), true);
    assert.equal((await readReceipt(r.host.stateDir, d.id))?.receipt.state, "installed");
  });

  void test(`${tag}: an existing file mode is kept (0600 and 0644), a created file is 0600, and no config value is logged or hashed in the clear`, async (t) => {
    for (const wanted of [0o600, 0o644]) {
      const r = buildRig(t, d, { seed: flavor.seed });
      chmodSync(r.file, wanted);
      await r.adapter.install(r.env, { dryRun: false });
      assert.equal(mode(r.file), wanted);
      await r.adapter.uninstall(r.env, { dryRun: false });
      assert.equal(mode(r.file), wanted);
    }
    const fresh = buildRig(t, d);
    await fresh.adapter.install(fresh.env, { dryRun: false });
    assert.equal(mode(fresh.file), 0o600);

    const marked = buildRig(t, d, { seed: flavor.mark(flavor.seed) });
    await marked.adapter.install(marked.env, { dryRun: false });
    await marked.adapter.uninstall(marked.env, { dryRun: false });
    const sources = [marked.log.lines.join("\n"), readFileSync(auditFile(marked.host.stateDir), "utf8")];
    assert.ok(marked.log.lines.length > 0, "the operations were logged");
    for (const text of sources) {
      assert.equal(text.includes(MARKER), false, "no config value reaches the log or the audit chain");
    }
    await marked.adapter.install(marked.env, { dryRun: false });
    assert.equal(readFileSync(receiptPath(marked.host.stateDir, d.id), "utf8").includes(MARKER), false, "nor the receipt");
  });

  void test(`${tag}: doctor passes after install, warns on drift and counts an unreadable file, naming hosts and counts only`, async (t) => {
    const r = buildRig(t, d, { seed: flavor.seed });
    await r.adapter.install(r.env, { dryRun: false });
    const installedText = readFileSync(r.file, "utf8");
    const pass = await hostPluginsCheck({ stateDir: r.host.stateDir, readTimeoutMs: 2000 });
    assert.deepEqual(pass, { id: "host-plugins", status: "pass", detail: `installed: ${d.id}`, fix: null });

    writeFileSync(r.file, flavor.edit(installedText));
    const drift = await hostPluginsCheck({ stateDir: r.host.stateDir, readTimeoutMs: 2000 });
    assert.equal(drift.status, "warn");
    assert.ok(drift.detail.startsWith(`host plugin drift: ${d.id}: `), drift.detail);
    assert.equal(drift.detail.includes(", 1 unreadable"), false);

    rmSync(r.file);
    const target = join(r.host.root, "elsewhere");
    writeFileSync(target, installedText);
    symlinkSync(target, r.file);
    const unreadable = await hostPluginsCheck({ stateDir: r.host.stateDir, readTimeoutMs: 2000 });
    assert.equal(unreadable.status, "warn");
    assert.ok(unreadable.detail.includes(", 1 unreadable"), unreadable.detail);
    for (const result of [pass, drift, unreadable]) {
      assert.equal(`${result.detail} ${result.fix ?? ""}`.includes(r.host.root), false, "no path in the doctor output");
    }
  });

  // A host that documents no relocation variable (Cursor E-CU2, Antigravity E-AG1) has no override tests: there is no variable to set.
  const override = d.override;
  if (override !== null) {
    void test(`${tag}: the ${override.variable} override redirects everything and leaves the default home alone; an empty or relative value is SCHEMA_INVALID`, async (t) => {
      const r = buildRig(t, d, { override: true });
      const defaultHome = join(r.host.home, d.installHomeRel);
      const defaultBefore = treeHash(defaultHome);
      const found = await r.adapter.detect(r.env);
      assert.deepEqual(found.homes.filter((home) => home.path === r.homeDir), [{ path: r.homeDir, exists: true, symlink: false }]);
      assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "installed");
      assert.deepEqual(filesUnder(r.homeDir), [d.file]);
      assert.equal(treeHash(defaultHome), defaultBefore, "the default home is untouched");
      assert.equal((await r.adapter.status(r.env)).status, "installed");
      assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
      assert.deepEqual(filesUnder(r.homeDir), []);
      assert.equal(treeHash(defaultHome), defaultBefore);

      const before = treeHash(r.host.root);
      for (const bad of ["", "relative/dir"]) {
        const badEnv: HostEnv = { ...r.env, env: { [override.variable]: bad } };
        for (const dryRun of [true, false]) {
          await assert.rejects(r.adapter.install(badEnv, { dryRun }), (error: unknown) => error instanceof SchemaInvalidError && error.code === "SCHEMA_INVALID", bad);
        }
      }
      assert.equal(treeHash(r.host.root), before);
    });

    void test(`${tag}: a symlinked override directory is followed once and the receipt records the real path`, async (t) => {
      const r = buildRig(t, d);
      const real = join(r.host.root, "real-base");
      const link = join(r.host.root, "link-base");
      mkdirSync(override.homeOf(real), { recursive: true });
      symlinkSync(real, link);
      const env: HostEnv = { ...r.env, env: { [override.variable]: link } };
      assert.equal((await r.adapter.install(env, { dryRun: false })).outcome, "installed");
      assert.deepEqual(filesUnder(override.homeOf(real)), [d.file]);
      assert.equal((await readReceipt(r.host.stateDir, d.id))?.receipt.configHome, realpathSync(override.homeOf(link)));
      assert.equal((await r.adapter.uninstall(env, { dryRun: false })).outcome, "removed");
      assert.deepEqual(filesUnder(override.homeOf(real)), []);
    });
  }

  void test(`${tag}: a symlinked recipe file is PATH_ESCAPE without a --config-home hint and its target is untouched`, async (t) => {
    const r = buildRig(t, d);
    const target = join(r.host.root, "elsewhere");
    writeFileSync(target, flavor.seed);
    mkdirSync(dirname(r.file), { recursive: true });
    symlinkSync(target, r.file);
    const before = treeHash(r.host.root);
    for (const dryRun of [true, false]) {
      await assert.rejects(
        r.adapter.install(r.env, { dryRun }),
        (error: unknown) => refusedWith("symlink", "PATH_ESCAPE")(error) && error instanceof HostRefusal && error.fix === undefined && !error.message.includes("--config-home"),
      );
    }
    nothingWritten(r, d, before);
    assert.equal(readFileSync(target, "utf8"), flavor.seed);
  });

  void test(`${tag}: a directory or a FIFO at the file name is foreign-content, never a hang, and nothing is written`, async (t) => {
    const asDir = buildRig(t, d);
    mkdirSync(asDir.file, { recursive: true });
    const before = treeHash(asDir.host.root);
    await assert.rejects(asDir.adapter.install(asDir.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
    nothingWritten(asDir, d, before);

    const asFifo = buildRig(t, d);
    mkdirSync(dirname(asFifo.file), { recursive: true });
    execFileSync("mkfifo", [asFifo.file]);
    await assert.rejects(asFifo.adapter.install(asFifo.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
    assert.equal(lstatSync(asFifo.file).isFIFO(), true);
    assert.equal(existsSync(receiptPath(asFifo.host.stateDir, d.id)), false);
    assert.equal(existsSync(join(asFifo.host.stateDir, "audit")), false);
  });
}

// ---- refusal tables ---------------------------------------------------------------------------------------------------------------

interface RefusalCase {
  readonly name: string;
  readonly seed: string | Uint8Array;
  readonly refusal: HostRefusalReason;
  readonly code: string;
}

function defineRefusals(d: HostSuiteBase, cases: readonly RefusalCase[]): void {
  for (const c of cases) {
    void test(`${d.req} ${d.id}: ${c.name} is refused as ${c.refusal} and nothing is written`, async (t) => {
      const r = buildRig(t, d, { seed: c.seed });
      const before = treeHash(r.host.root);
      for (const dryRun of [true, false]) {
        await assert.rejects(r.adapter.install(r.env, { dryRun }), refusedWith(c.refusal, c.code), c.name);
      }
      nothingWritten(r, d, before);
      assert.equal((await r.adapter.status(r.env)).status, "detected", "with no receipt the host is merely detected");
    });
  }
}

const UNPARSEABLE = { refusal: "unparseable", code: "SCHEMA_INVALID" } as const;
const FOREIGN = { refusal: "foreign-content", code: "POLICY_DENIED" } as const;

// ---- JSON hosts -----------------------------------------------------------------------------------------------------------------------

export function defineHostRecipeSuite(d: JsonSuiteDescriptor): void {
  const tag = `${d.req} ${d.id}`;
  const flavor = jsonFlavor(d);
  defineCommonCases(d, flavor);
  const under = (value: unknown): string => render({ [d.parentKey]: value });
  defineRefusals(d, [
    { name: "a JSON array", seed: "[]\n", ...UNPARSEABLE },
    { name: "a JSON string", seed: '"text"\n', ...UNPARSEABLE },
    { name: "JSON null", seed: "null\n", ...UNPARSEABLE },
    { name: "truncated JSON", seed: '{"a": ', ...UNPARSEABLE },
    { name: "an empty file", seed: "", ...UNPARSEABLE },
    { name: "a file that begins with a BOM", seed: "\uFEFF{}\n", ...UNPARSEABLE },
    { name: "invalid UTF-8", seed: Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x7d]), ...UNPARSEABLE },
    { name: "a file of 1 MiB plus one byte", seed: new Uint8Array(1024 * 1024 + 1).fill(0x20), ...UNPARSEABLE },
    { name: "an integer above 2^53", seed: '{\n  "big": 12345678901234567890\n}\n', ...UNPARSEABLE },
    { name: `${d.parentKey} as an array`, seed: under([]), ...FOREIGN },
    { name: `${d.parentKey} as a string`, seed: under("text"), ...FOREIGN },
    { name: `${d.parentKey} as null`, seed: under(null), ...FOREIGN },
    { name: `${d.parentKey} as a number`, seed: under(5), ...FOREIGN },
    { name: "a different realm entry", seed: under({ realm: { command: "other" } }), ...FOREIGN },
  ]);

  void test(`${tag}: an identical realm entry is a no-op that Realm does not claim: no receipt, and uninstall leaves it`, async (t) => {
    const seed = render(withEntry(d, { ...d.seedDoc }), d.seedFormat);
    const r = buildRig(t, d, { seed });
    const before = treeHash(r.host.root);
    const again = await r.adapter.install(r.env, { dryRun: false });
    assert.equal(again.outcome, "noop");
    assert.equal(again.changed, false);
    nothingWritten(r, d, before);
    assert.equal((await r.adapter.status(r.env)).status, "detected");
    const removed = await r.adapter.uninstall(r.env, { dryRun: false });
    assert.equal(removed.outcome, "noop");
    assert.equal(readFileSync(r.file, "utf8"), seed, "an entry Realm did not write stays");
  });

  const createdSeed = d.createdSeed;
  if (createdSeed !== undefined) {
    void test(`${tag}: a created file holds the seed members before the entry, and an existing file never receives them`, async (t) => {
      const fresh = buildRig(t, d);
      await fresh.adapter.install(fresh.env, { dryRun: false });
      const created = readFileSync(fresh.file, "utf8");
      assert.equal(created, flavor.created);
      assert.deepEqual(Object.keys(parseDoc(created)).slice(0, Object.keys(createdSeed).length), Object.keys(createdSeed), "the seed comes first");
      assert.equal(flavor.owns(created), true);

      const existing = buildRig(t, d, { seed: flavor.seed });
      await existing.adapter.install(existing.env, { dryRun: false });
      assert.equal(readFileSync(existing.file, "utf8"), flavor.seedResult, "only the entry was added to an existing file");
      await existing.adapter.uninstall(existing.env, { dryRun: false });
      assert.equal(readFileSync(existing.file, "utf8"), flavor.seed);
    });

    void test(`${tag}: uninstall keeps a created file that holds more than the seed and the entry`, async (t) => {
      const r = buildRig(t, d);
      await r.adapter.install(r.env, { dryRun: false });
      writeFileSync(r.file, flavor.append(readFileSync(r.file, "utf8")));
      assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
      const left = parseDoc(readFileSync(r.file, "utf8"));
      assert.equal(flavor.hasAppended(JSON.stringify(left)), true);
      for (const [key, value] of Object.entries(createdSeed)) {
        assert.deepEqual(left[key], value);
      }
    });
  }

  const rival = d.rival;
  if (rival !== undefined) {
    void test(`${tag}: a document that holds the rival key ${rival} is refused as foreign-content, even over an owned entry, and nothing is written`, async (t) => {
      const seed = render({ ...d.seedDoc, [rival]: { other: { command: "other" } } }, d.seedFormat);
      const r = buildRig(t, d, { seed });
      const before = treeHash(r.host.root);
      for (const dryRun of [true, false]) {
        await assert.rejects(
          r.adapter.install(r.env, { dryRun }),
          (error: unknown) => refusedWith("foreign-content", "POLICY_DENIED")(error) && error instanceof Error && !error.message.includes(rival),
        );
      }
      nothingWritten(r, d, before);

      const ok = buildRig(t, d, { seed: flavor.seed });
      await ok.adapter.install(ok.env, { dryRun: false });
      const installedText = readFileSync(ok.file, "utf8");
      writeFileSync(ok.file, render({ ...parseDoc(installedText), [rival]: { other: { command: "other" } } }));
      const owned = treeHash(ok.host.root);
      await assert.rejects(ok.adapter.install(ok.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
      assert.equal(treeHash(ok.host.root), owned, "a refused reinstall changes nothing");
    });
  }

  void test(`${tag}: __proto__, constructor and prototype keys are preserved byte for byte and pollute nothing`, async (t) => {
    const seed = '{\n  "__proto__": {\n    "polluted": true\n  },\n  "constructor": {\n    "polluted": true\n  },\n  "prototype": 1\n}\n';
    const r = buildRig(t, d, { seed });
    await r.adapter.install(r.env, { dryRun: false });
    const text = readFileSync(r.file, "utf8");
    assert.ok(text.includes('"__proto__": {\n    "polluted": true\n  }'));
    assert.equal(Reflect.get(Object.prototype, "polluted"), undefined);
    assert.equal(Reflect.get({}, "polluted"), undefined);
    assert.equal(flavor.owns(text), true);
    await r.adapter.uninstall(r.env, { dryRun: false });
    assert.equal(readFileSync(r.file, "utf8"), seed);
  });

  void test(`${tag}: CRLF, 4-space, tab indent and a missing or present trailing newline survive install and uninstall exactly`, async (t) => {
    const formats: readonly JsonFormat[] = [
      { indent: "  ", eol: "\r\n", trailing: true },
      { indent: "  ", eol: "\r\n", trailing: false },
      { indent: "    ", eol: "\n", trailing: true },
      { indent: "    ", eol: "\n", trailing: false },
      { indent: "\t", eol: "\n", trailing: true },
      { indent: "\t", eol: "\n", trailing: false },
    ];
    for (const format of formats) {
      const seed = render(d.seedDoc, format);
      const r = buildRig(t, d, { seed });
      await r.adapter.install(r.env, { dryRun: false });
      assert.equal(readFileSync(r.file, "utf8"), render(withEntry(d, { ...d.seedDoc }), format), JSON.stringify(format));
      await r.adapter.uninstall(r.env, { dryRun: false });
      assert.equal(readFileSync(r.file, "utf8"), seed, JSON.stringify(format));
    }
  });
}

// ---- the toml-table host ------------------------------------------------------------------------------------------------------------------

// The look-alikes of `[mcp_servers.realm]` that test/host/toml-table.test.ts pins as foreign.
const TAKEN_FORMS: readonly string[] = [
  '[mcp_servers.realm]\ncommand = "x"\n',
  "[ mcp_servers . realm ]\n",
  '[mcp_servers."realm"]\n',
  "['mcp_servers'.'realm']\n",
  "[mcp_servers.realm.env]\n",
  "[[mcp_servers.realm]]\n",
  '[mcp_servers]\nrealm = { command = "x" }\n',
  '[mcp_servers]\nrealm.command = "x"\n',
  'mcp_servers.realm.command = "x"\n',
  "mcp_servers = { realm = {} }\n",
  "[other]\nx = 1\n\n[mcp_servers.realm]\n",
  "    [mcp_servers.realm]\n",
  "[mcp_servers.realm] # note\n",
];

export function defineHostTomlSuite(d: TomlSuiteDescriptor): void {
  const tag = `${d.req} ${d.id}`;
  defineCommonCases(d, tomlFlavor(d));
  defineRefusals(d, [
    { name: "a file of 1 MiB plus one byte", seed: new Uint8Array(1024 * 1024 + 1).fill(0x23), ...UNPARSEABLE },
    { name: "invalid UTF-8", seed: Uint8Array.from([0x23, 0xff, 0x0a]), ...UNPARSEABLE },
    { name: "an unreadable table header", seed: "[mcp_servers.realm\n", ...UNPARSEABLE },
    { name: "an unreadable header after the table", seed: `${d.table}[oops\n`, ...UNPARSEABLE },
    { name: "the owned table text with no receipt", seed: d.table, ...FOREIGN },
    { name: "the owned table text twice", seed: `${d.table}\n${d.table}`, ...FOREIGN },
    ...TAKEN_FORMS.map((seed) => ({ name: `the existing definition ${JSON.stringify(seed)}`, seed, ...FOREIGN })),
  ]);

  const clean: readonly { readonly name: string; readonly seed: string }[] = [
    { name: "CRLF line endings", seed: "[features]\r\nhooks = true\r\n" },
    { name: "CRLF line endings and no trailing newline", seed: "[features]\r\nhooks = true" },
    { name: "a BOM", seed: "\uFEFF[features]\nhooks = true\n" },
    { name: "no trailing newline", seed: "[features]\nhooks = true" },
    { name: "a final blank line", seed: "[features]\nhooks = true\n\n" },
    { name: "an empty file", seed: "" },
    { name: "a look-alike only in a comment", seed: "# [mcp_servers.realm]\n[features]\nhooks = true\n" },
    { name: "comment lines the first Codex recipe used as markers", seed: `${OLD_BEGIN}\n[features]\nhooks = true\n${OLD_END}\n` },
    { name: "mcp_servers.realm2 and mcp_servers.railway", seed: '[mcp_servers.realm2]\ncommand = "a"\n\n[mcp_servers.railway]\ncommand = "b"\n' },
    { name: "a file shaped like a real user config", seed: d.seed },
  ];
  for (const c of clean) {
    void test(`${tag}: ${c.name} installs, and uninstall restores the original bytes`, async (t) => {
      const r = buildRig(t, d, { seed: c.seed });
      const installed = await r.adapter.install(r.env, { dryRun: false });
      assert.equal(installed.outcome, "installed", c.name);
      assert.equal(readFileSync(r.file, "utf8"), expectedTable(d.table, c.seed), c.name);
      if (c.seed.startsWith("\uFEFF")) {
        assert.deepEqual([...readFileSync(r.file).subarray(0, 3)], [0xef, 0xbb, 0xbf], "the BOM is still the first three bytes");
      }
      assert.equal((await r.adapter.status(r.env)).status, "installed");
      const removed = await r.adapter.uninstall(r.env, { dryRun: false });
      assert.equal(removed.outcome, "removed", c.name);
      assert.equal(readFileSync(r.file, "utf8"), c.seed, c.name);
      if (c.seed.startsWith("\uFEFF")) {
        assert.deepEqual([...readFileSync(r.file).subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      }
    });
  }
}

// ---- the yaml-map host ----------------------------------------------------------------------------------------------------------------

export interface YamlSuiteDescriptor extends HostSuiteBase {
  // A realistic existing file that ends with a line ending and has no `mcp_servers` key and no `command: realm` line.
  readonly seed: string;
}

function yamlFlavor(d: YamlSuiteDescriptor): Flavor {
  const other = "  other:\n    command: other\n";
  const unix = (text: string): string => text.replaceAll("\r\n", "\n");
  return {
    seed: d.seed,
    seedResult: `${d.seed}${BLOCK}`,
    created: BLOCK,
    owns: (text) => unix(text).includes(ENTRY_2),
    edit: (text) => text.replace("command: realm", "command: evil"),
    // What the host's own remover does: the entry is gone, the header and everything else stay.
    remove: (text) => {
      assert.ok(text.includes(ENTRY_2), "the owned entry is present");
      return text.replace(ENTRY_2, "");
    },
    removedState: "missing",
    addOther: (text) => text.replace(ENTRY_2, `${ENTRY_2}${other}`),
    keepsOther: (text) => text.includes(other),
    append: (text) => `${text}# ${APPENDED}\n`,
    hasAppended: (text) => text.includes(`# ${APPENDED}`),
    mark: (text) => `${text}# ${MARKER}\n`,
  };
}

export function defineHostYamlSuite(d: YamlSuiteDescriptor): void {
  const tag = `${d.req} ${d.id}`;
  defineCommonCases(d, yamlFlavor(d));
  defineRefusals(d, [
    ...YAML_UNPARSEABLE.map((c) => ({ name: c.name, seed: c.seed, ...UNPARSEABLE })),
    { name: "invalid UTF-8", seed: Uint8Array.from([0x23, 0xff, 0x0a]), ...UNPARSEABLE },
    ...YAML_FOREIGN.map((c) => ({ name: c.name, seed: c.seed, ...FOREIGN })),
  ]);

  for (const c of YAML_VALID) {
    void test(`${tag}: ${c.name} installs to the expected bytes, and uninstall restores the original bytes`, async (t) => {
      const r = buildRig(t, d, { seed: c.seed });
      if (c.expected === c.seed) {
        // An entry equal to the recipe's that Realm did not write: a no-op that is not claimed and that uninstall leaves.
        const before = treeHash(r.host.root);
        const same = await r.adapter.install(r.env, { dryRun: false });
        assert.equal(same.outcome, "noop", c.name);
        nothingWritten(r, d, before);
        assert.equal((await r.adapter.status(r.env)).status, "detected");
        assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "noop");
        assert.equal(readFileSync(r.file, "utf8"), c.seed);
        return;
      }
      const installed = await r.adapter.install(r.env, { dryRun: false });
      assert.equal(installed.outcome, "installed", c.name);
      assert.equal(readFileSync(r.file, "utf8"), c.expected, c.name);
      assert.equal((await r.adapter.status(r.env)).status, "installed");
      assert.equal((await r.adapter.install(r.env, { dryRun: false })).outcome, "noop");
      const removed = await r.adapter.uninstall(r.env, { dryRun: false });
      assert.equal(removed.outcome, "removed", c.name);
      assert.equal(readFileSync(r.file, "utf8"), c.seed, c.name);
      assert.equal(existsSync(receiptPath(r.host.stateDir, d.id)), false);
    });
  }

  void test(`${tag}: the host's own re-quoted and re-flowed rewrite of the entry keeps the status ok, and uninstall still removes it`, async (t) => {
    const r = buildRig(t, d, { seed: d.seed });
    await r.adapter.install(r.env, { dryRun: false });
    writeFileSync(
      r.file,
      readFileSync(r.file, "utf8").replace(ENTRY_2, '  realm:\n    command: "realm"\n\n    args: ["mcp", "--host", "hermes"]\n'),
    );
    const status = await r.adapter.status(r.env);
    assert.equal(status.status, "installed");
    assert.deepEqual(status.entries, [{ path: d.file, state: "ok" }]);
    assert.equal((await r.adapter.uninstall(r.env, { dryRun: false })).outcome, "removed");
    assert.equal(readFileSync(r.file, "utf8"), d.seed);
  });
}
