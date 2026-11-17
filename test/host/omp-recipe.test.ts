// The Omp install recipe (OMPB-04, OMPB-05) on a fixture host: lifecycle, the token expansion of the shipped shim, a real
// import of the installed shim, and every refusal. Temporary directories only; no Omp binary runs.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkAuditFile } from "../../src/audit/chain.js";
import { RealmError } from "../../src/core/errors.js";
import { createHostAdapter, type HostAdapterDeps, type RecipeHostAdapter } from "../../src/host/adapter.js";
import { defaultManifestFor } from "../../src/host/manifest.js";
import { receiptPath } from "../../src/host/receipt.js";
import { HostRefusal, type HostRefusalReason } from "../../src/host/recipe.js";
import { HOST_RUNTIMES } from "../../src/host/runtimes.js";
import type { HostEnv } from "../../src/host/types.js";
import {
  captureLog,
  eventsOf,
  fixtureEntry,
  fixtureRecipe,
  makeFixtureHost,
  treeHash,
  writeAt,
  type CapturedLog,
  type FixtureHost,
} from "../support/fixture-host.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REAL_SHIM = readFileSync(join(REPO_ROOT, "adapters", "omp", "index.js"), "utf8");
const TOKEN = "@realm:extension-url@";
const SHIM_REL = "extensions/realm/index.js";
const LINK_REL = ".omp/plugins/node_modules/agent-realm";
const STUB_KEY = Symbol.for("realm.test.omp-stub");

// A stub of dist/src/omp/extension.js: records the object it was given, then parks on a gate the test opens, so a shim that does
// not await the extension is visible.
const STUB_EXTENSION = `export default async function stubExtension(pi) {
  const state = globalThis[Symbol.for("realm.test.omp-stub")];
  state.received.push(pi);
  state.markEntered();
  await state.gate;
  state.settled += 1;
}
`;

// The executor form is used because tsconfig's ES2023 lib has no Promise.withResolvers.
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

interface StubState {
  readonly received: unknown[];
  settled: number;
  readonly entered: Promise<void>;
  readonly markEntered: () => void;
  readonly gate: Promise<void>;
  readonly release: () => void;
}

function installStub(t: TestContext): StubState {
  const entered = deferred();
  const gate = deferred();
  const state: StubState = {
    received: [],
    settled: 0,
    entered: entered.promise,
    markEntered: entered.resolve,
    gate: gate.promise,
    release: gate.resolve,
  };
  Reflect.set(globalThis, STUB_KEY, state);
  t.after(() => {
    Reflect.deleteProperty(globalThis, STUB_KEY);
  });
  return state;
}

// Imports the installed shim and calls its default export with `pi`. Dynamic import on purpose: the shim only exists after the install
// under test wrote it, so no static import can name it.
async function runShim(shimPath: string, state: StubState, pi: unknown, label: string): Promise<void> {
  const loaded = (await import(pathToFileURL(shimPath).href)) as { default: (api: unknown) => Promise<void> };
  let done = false;
  const pending = loaded.default(pi).then(() => {
    done = true;
  });
  await state.entered;
  // One macrotask turn: a shim that did not await the extension has settled by now.
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(state.received.length, 1, label);
  assert.equal(state.received[0], pi, label);
  assert.equal(done, false, `${label}: the shim waits for the extension`);
  state.release();
  await pending;
  assert.equal(done, true, label);
  assert.equal(state.settled, 1, label);
}

// A package root holding a copy of the real shim under adapters/omp and a stub extension under dist/src/omp. Returns the adapters dir.
function writePackage(root: string, options: { readonly stub?: boolean } = {}): string {
  const adaptersDir = join(root, "adapters");
  writeAt(join(adaptersDir, "omp", "index.js"), REAL_SHIM);
  if (options.stub !== false) {
    writeAt(join(root, "dist", "src", "omp", "extension.js"), STUB_EXTENSION);
  }
  return adaptersDir;
}

function deps(host: FixtureHost, log: CapturedLog, adaptersDir: string, extra: Partial<HostAdapterDeps> = {}): HostAdapterDeps {
  let counter = 0;
  return {
    stateDir: host.stateDir,
    adaptersDir,
    logger: log.logger,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    newCorrelationId: () => {
      counter += 1;
      return `corr-${String(counter)}`;
    },
    readTimeoutMs: 2000,
    ...extra,
  };
}

interface Rig {
  readonly host: FixtureHost;
  readonly log: CapturedLog;
  readonly adapter: RecipeHostAdapter;
  readonly agentDir: string;
  readonly shimPath: string;
  readonly adaptersDir: string;
}

// An Omp fixture: <home>/.omp/agent exists (unless asked otherwise) and the package root is the fixture root.
function rig(t: TestContext, options: { readonly agentDir?: boolean; readonly stub?: boolean; readonly packageRoot?: string } = {}): Rig {
  const host = makeFixtureHost(t);
  const log = captureLog();
  const agentDir = join(host.home, ".omp", "agent");
  if (options.agentDir !== false) {
    mkdirSync(agentDir, { recursive: true });
  }
  const adaptersDir = writePackage(options.packageRoot ?? host.root, options.stub === undefined ? {} : { stub: options.stub });
  const adapter = createHostAdapter(HOST_RUNTIMES.omp, defaultManifestFor("omp", "1.2.3"), deps(host, log, adaptersDir));
  return { host, log, adapter, agentDir, shimPath: join(agentDir, ...SHIM_REL.split("/")), adaptersDir };
}

function adapterFor(host: FixtureHost, log: CapturedLog, adaptersDir: string): RecipeHostAdapter {
  return createHostAdapter(HOST_RUNTIMES.omp, defaultManifestFor("omp", "1.2.3"), deps(host, log, adaptersDir));
}

function refusedWith(reason: HostRefusalReason, errorCode: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof HostRefusal && error.refusal === reason && error.code === errorCode;
}

function code(error: unknown): string | undefined {
  return error instanceof RealmError ? error.code : undefined;
}

// Every regular file under dir, relative, POSIX separators, sorted.
function filesUnder(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const relPath = rel === "" ? name : `${rel}/${name}`;
    if (lstatSync(path).isDirectory()) {
      out.push(...filesUnder(path, relPath));
    } else {
      out.push(relPath);
    }
  }
  return out;
}

function auditLineCount(stateDir: string): number {
  const file = join(stateDir, "audit", "host-plugins.jsonl");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line !== "").length : 0;
}

function expectedShim(extensionPath: string): string {
  const literal = JSON.stringify(pathToFileURL(extensionPath).href);
  return REAL_SHIM.replaceAll(TOKEN, () => literal);
}

function nothingWritten(r: Rig, before: string): void {
  assert.equal(treeHash(r.host.root), before, "no file changed");
  assert.equal(existsSync(receiptPath(r.host.stateDir, "omp")), false, "no receipt");
  assert.equal(existsSync(join(r.host.stateDir, "audit")), false, "no audit directory");
}

// ---- lifecycle ---------------------------------------------------------------------------------------------------------------

void test("OMPB-04: detect finds Omp by its agent directory, install writes only the shim, and a second install is a no-op", async (t) => {
  const r = rig(t);
  const found = await r.adapter.detect(r.host.env);
  assert.equal(found.detected, true);
  assert.equal(found.via, "home");
  assert.deepEqual(found.homes, [{ path: r.agentDir, exists: true, symlink: false }]);
  assert.deepEqual(found.conflicts, []);

  const before = filesUnder(r.host.root);
  const homeBefore = treeHash(r.host.home);
  const installed = await r.adapter.install(r.host.env, { dryRun: false });
  assert.equal(installed.status, "installed");
  assert.equal(installed.outcome, "installed");
  assert.equal(installed.changed, true);
  assert.deepEqual(installed.actions.filter((action) => action.kind === "file").map((action) => action.path), [SHIM_REL]);

  // Exactly one host file appeared, and the state directory gained the receipt and the audit chain.
  const created = filesUnder(r.host.root).filter((path) => !before.includes(path));
  assert.deepEqual(created.filter((path) => path.startsWith("home/")), [`home/.omp/agent/${SHIM_REL}`]);
  assert.ok(created.includes("state/hosts/omp.receipt.json"), "the receipt is written");
  assert.ok(created.includes("state/audit/host-plugins.jsonl"), "the audit chain is written");
  assert.notEqual(treeHash(r.host.home), homeBefore);
  assert.equal(readFileSync(r.shimPath, "utf8"), expectedShim(join(r.host.root, "dist", "src", "omp", "extension.js")));
  assert.equal(readFileSync(r.shimPath, "utf8").includes("@realm:"), false, "no token is left in the installed shim");
  assert.equal(existsSync(receiptPath(r.host.stateDir, "omp")), true);
  assert.equal(auditLineCount(r.host.stateDir), 2);
  const check = checkAuditFile(join(r.host.stateDir, "audit", "host-plugins.jsonl"));
  assert.equal(check.ok, true);
  assert.equal(check.lines, 2);

  const status = await r.adapter.status(r.host.env);
  assert.equal(status.status, "installed");
  assert.deepEqual(status.entries, [{ path: SHIM_REL, state: "ok" }]);

  const afterInstall = treeHash(r.host.root);
  const again = await r.adapter.install(r.host.env, { dryRun: false });
  assert.equal(again.outcome, "noop");
  assert.equal(again.changed, false);
  assert.equal(treeHash(r.host.root), afterInstall, "a second install is byte-identical");
  assert.equal(auditLineCount(r.host.stateDir), 2);
});

void test("OMPB-04: --dry-run writes no host file, no receipt and no audit line", async (t) => {
  const r = rig(t);
  const before = treeHash(r.host.root);
  const result = await r.adapter.install(r.host.env, { dryRun: true });
  assert.equal(result.outcome, "planned");
  assert.equal(result.changed, false);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.actions.filter((action) => action.kind === "file").map((action) => action.path), [SHIM_REL]);
  nothingWritten(r, before);
  assert.equal(existsSync(r.shimPath), false);
});

void test("OMPB-04: uninstall removes the shim and the directories the install created, and nothing else", async (t) => {
  // No extensions directory beforehand: the install creates extensions/ and extensions/realm/, uninstall removes both.
  const bare = rig(t);
  const bareHome = treeHash(bare.host.home);
  await bare.adapter.install(bare.host.env, { dryRun: false });
  const removedBare = await bare.adapter.uninstall(bare.host.env, { dryRun: false });
  assert.equal(removedBare.outcome, "removed");
  assert.equal(treeHash(bare.host.home), bareHome, "the home is exactly as before");
  assert.equal(existsSync(join(bare.agentDir, "extensions")), false);
  assert.equal(existsSync(receiptPath(bare.host.stateDir, "omp")), false);
  assert.equal(auditLineCount(bare.host.stateDir), 4);

  // A pre-existing extensions directory and a sibling extension stay.
  const shared = rig(t);
  const sibling = join(shared.agentDir, "extensions", "other.js");
  writeAt(sibling, "export default () => {};\n");
  writeAt(join(shared.agentDir, "settings.yml"), "keep: true\n");
  const sharedHome = treeHash(shared.host.home);
  await shared.adapter.install(shared.host.env, { dryRun: false });
  assert.equal(existsSync(shared.shimPath), true);
  const removed = await shared.adapter.uninstall(shared.host.env, { dryRun: false });
  assert.equal(removed.outcome, "removed");
  assert.equal(treeHash(shared.host.home), sharedHome);
  assert.equal(existsSync(sibling), true);
  assert.equal(existsSync(join(shared.agentDir, "extensions", "realm")), false);

  // A dry-run uninstall changes nothing.
  await shared.adapter.install(shared.host.env, { dryRun: false });
  const installedTree = treeHash(shared.host.root);
  const planned = await shared.adapter.uninstall(shared.host.env, { dryRun: true });
  assert.equal(planned.outcome, "planned");
  assert.equal(treeHash(shared.host.root), installedTree);
});

void test("OMPB-04: an absolute PI_CODING_AGENT_DIR redirects the install", async (t) => {
  const r = rig(t);
  const alt = join(r.host.root, "alt-agent");
  mkdirSync(alt);
  const env: HostEnv = { ...r.host.env, env: { PI_CODING_AGENT_DIR: alt } };
  const found = await r.adapter.detect(env);
  assert.deepEqual(found.homes, [{ path: alt, exists: true, symlink: false }]);
  await r.adapter.install(env, { dryRun: false });
  assert.deepEqual(filesUnder(alt), [SHIM_REL]);
  assert.deepEqual(filesUnder(r.agentDir), [], "the default agent directory is untouched");
  assert.equal((await r.adapter.status(env)).status, "installed");
  await r.adapter.uninstall(env, { dryRun: false });
  assert.deepEqual(filesUnder(alt), []);
});

void test("OMPB-04: after the package root moved, install rewrites the shim as an update and uninstall still works", async (t) => {
  const r = rig(t);
  await r.adapter.install(r.host.env, { dryRun: false });
  const first = readFileSync(r.shimPath, "utf8");
  const moved = join(r.host.root, "moved-package");
  const movedAdapters = writePackage(moved);
  const movedAdapter = adapterFor(r.host, r.log, movedAdapters);
  const updated = await movedAdapter.install(r.host.env, { dryRun: false });
  assert.equal(updated.outcome, "installed");
  assert.deepEqual(updated.actions.filter((action) => action.kind === "file").map((action) => [action.path, action.action]), [[SHIM_REL, "update"]]);
  const second = readFileSync(r.shimPath, "utf8");
  assert.notEqual(second, first);
  assert.equal(second, expectedShim(join(moved, "dist", "src", "omp", "extension.js")));
  assert.equal((await movedAdapter.status(r.host.env)).status, "installed");
  const removed = await movedAdapter.uninstall(r.host.env, { dryRun: false });
  assert.equal(removed.outcome, "removed");
  assert.equal(existsSync(r.shimPath), false);
});

// ---- the installed shim ------------------------------------------------------------------------------------------------------

void test("OMPB-04: the installed shim awaits the extension it delegates to, with the host API object it was given", async (t) => {
  const state = installStub(t);
  const r = rig(t);
  await r.adapter.install(r.host.env, { dryRun: false });
  await runShim(r.shimPath, state, { marker: "fake-pi" }, "default package root");
});

void test("OMPB-04: a package path with a quote, space, percent, hash or question mark still imports", async (t) => {
  const names = ['quote"dir', "space dir", "pct%41", "hash#dir", "query?dir", 'mixed "q" %41 # ?'];
  for (const name of names) {
    const state = installStub(t);
    const host = makeFixtureHost(t);
    const log = captureLog();
    const agentDir = join(host.home, ".omp", "agent");
    mkdirSync(agentDir, { recursive: true });
    const adaptersDir = writePackage(join(host.root, name));
    const adapter = adapterFor(host, log, adaptersDir);
    await adapter.install(host.env, { dryRun: false });
    const shimPath = join(agentDir, ...SHIM_REL.split("/"));
    const text = readFileSync(shimPath, "utf8");
    assert.equal(text.includes("@realm:"), false, name);
    assert.equal(text, expectedShim(join(host.root, name, "dist", "src", "omp", "extension.js")), name);
    await runShim(shimPath, state, { name }, name);
  }
});

void test("OMPB-05: a package path with a backslash cannot be imported through a file URL, so install refuses it and writes nothing", async (t) => {
  // Node rejects a module URL that encodes a backslash (%5C), so a shim naming such a path could never load.
  for (const name of ["back\\slash", 'all "\\ %41 # ?']) {
    const host = makeFixtureHost(t);
    const log = captureLog();
    mkdirSync(join(host.home, ".omp", "agent"), { recursive: true });
    const adapter = adapterFor(host, log, writePackage(join(host.root, name)));
    const before = treeHash(host.root);
    for (const dryRun of [false, true]) {
      await assert.rejects(adapter.install(host.env, { dryRun }), refusedWith("unsupported-path", "POLICY_DENIED"), name);
    }
    assert.equal(treeHash(host.root), before, name);
    assert.equal(existsSync(receiptPath(host.stateDir, "omp")), false, name);
    assert.equal(existsSync(join(host.stateDir, "audit")), false, name);
    assert.ok(eventsOf(log.lines).includes("host.install.refused"), name);
  }
});

void test("the shipped shim holds one token, is short, and reads nothing from the environment", () => {
  assert.equal(REAL_SHIM.split(TOKEN).length - 1, 1);
  assert.equal([...REAL_SHIM.matchAll(/@realm:[a-z-]+@/g)].length, 1);
  assert.ok(REAL_SHIM.split("\n").filter((line, index, lines) => line !== "" || index < lines.length - 1).length <= 20);
  assert.ok(REAL_SHIM.startsWith("//"), "a header comment comes first");
  assert.match(REAL_SHIM, /managed by `realm host install omp`/i);
  assert.match(REAL_SHIM, /do not edit/i);
  for (const forbidden of ["process", "require(", "eval(", "child_process", "node:fs"]) {
    assert.equal(REAL_SHIM.includes(forbidden), false, forbidden);
  }
});

// ---- refusals ----------------------------------------------------------------------------------------------------------------

void test("OMPB-05: an unbuilt extension entry refuses install, dry run included, and writes nothing", async (t) => {
  const r = rig(t, { stub: false });
  const before = treeHash(r.host.root);
  for (const dryRun of [false, true]) {
    await assert.rejects(r.adapter.install(r.host.env, { dryRun }), refusedWith("extension-unbuilt", "POLICY_DENIED"));
  }
  nothingWritten(r, before);
  const refused = r.log.lines.filter((line) => line.includes("host.install.refused"));
  assert.equal(refused.length, 2);
  assert.ok(refused.every((line) => line.includes("extension-unbuilt") && !line.includes(r.host.root)), "the log line names a reason and no path");
  // A directory where the entry should be is not a built entry either.
  mkdirSync(join(r.host.root, "dist", "src", "omp", "extension.js"), { recursive: true });
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: false }), refusedWith("extension-unbuilt", "POLICY_DENIED"));
  nothingWritten(r, treeHash(r.host.root));
});

void test("OMPB-05: a plugin link refuses install with and without --config-home, and detect names it", async (t) => {
  const r = rig(t);
  const link = join(r.host.home, ...LINK_REL.split("/"));
  for (const makeLink of [
    () => {
      mkdirSync(link, { recursive: true });
    },
    () => {
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(join(r.host.root, "no-such-checkout"), link);
    },
  ]) {
    makeLink();
    assert.deepEqual((await r.adapter.detect(r.host.env)).conflicts, [LINK_REL]);
    const before = treeHash(r.host.root);
    for (const options of [{ dryRun: false }, { dryRun: true }, { dryRun: false, configHome: r.agentDir }]) {
      await assert.rejects(r.adapter.install(r.host.env, options), refusedWith("already-loaded", "POLICY_DENIED"));
    }
    assert.equal(treeHash(r.host.root), before);
    assert.equal(existsSync(receiptPath(r.host.stateDir, "omp")), false);
    assert.equal(existsSync(join(r.host.stateDir, "audit")), false);
    rmSync(link, { recursive: true, force: true });
  }
  assert.deepEqual((await r.adapter.detect(r.host.env)).conflicts, []);
  const refused = r.log.lines.filter((line) => line.includes("host.install.refused"));
  assert.equal(refused.length, 6);
  assert.ok(refused.every((line) => line.includes("already-loaded") && !line.includes(r.host.root)));
});

void test("OMPB-05: a plugin link never blocks uninstall or status", async (t) => {
  const r = rig(t);
  await r.adapter.install(r.host.env, { dryRun: false });
  mkdirSync(join(r.host.home, ...LINK_REL.split("/")), { recursive: true });
  assert.equal((await r.adapter.status(r.host.env)).status, "installed");
  const removed = await r.adapter.uninstall(r.host.env, { dryRun: false });
  assert.equal(removed.outcome, "removed");
  assert.equal(existsSync(r.shimPath), false);
});

void test("OMPB-05: a different index.js already in place is foreign content and stays untouched", async (t) => {
  const r = rig(t);
  writeAt(r.shimPath, "export default () => {};\n");
  const before = treeHash(r.host.root);
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: false }), refusedWith("foreign-content", "POLICY_DENIED"));
  assert.equal(treeHash(r.host.root), before);
  assert.equal(readFileSync(r.shimPath, "utf8"), "export default () => {};\n");
});

void test("OMPB-05: a symlinked extensions directory is PATH_ESCAPE with the --config-home fix", async (t) => {
  const r = rig(t);
  const real = join(r.host.root, "real-extensions");
  mkdirSync(real);
  symlinkSync(real, join(r.agentDir, "extensions"));
  const before = treeHash(r.host.root);
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: false }), (error: unknown) => {
    assert.ok(error instanceof HostRefusal);
    assert.equal(error.refusal, "symlink");
    assert.equal(error.code, "PATH_ESCAPE");
    assert.match(error.fix ?? "", /^use --config-home /);
    return true;
  });
  assert.equal(treeHash(r.host.root), before);
  assert.deepEqual(filesUnder(real), []);
});

void test("OMPB-05: an edited installed shim is drift: status reports it and uninstall refuses", async (t) => {
  const r = rig(t);
  await r.adapter.install(r.host.env, { dryRun: false });
  const text = readFileSync(r.shimPath, "utf8");
  writeFileSync(r.shimPath, `${text}// edited\n`);
  const status = await r.adapter.status(r.host.env);
  assert.equal(status.status, "drifted");
  assert.deepEqual(status.entries, [{ path: SHIM_REL, state: "drifted" }]);
  await assert.rejects(r.adapter.uninstall(r.host.env, { dryRun: false }), refusedWith("drifted", "POLICY_DENIED"));
  assert.equal(readFileSync(r.shimPath, "utf8"), `${text}// edited\n`);
  // A reinstall over an edited shim is refused too: the edit is not Realm's to overwrite.
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: false }), (error: unknown) => error instanceof HostRefusal);
});

void test("OMPB-05: an unknown @realm: token in a bundle file is SCHEMA_INVALID, and so is the token under an mcp-config manifest", async (t) => {
  const r = rig(t);
  writeAt(join(r.adaptersDir, "omp", "index.js"), `${REAL_SHIM}// @realm:other@\n`);
  const unchanged = (): string => treeHash(r.host.root);
  const first = unchanged();
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: false }), (error: unknown) => code(error) === "SCHEMA_INVALID");
  assert.equal(unchanged(), first, "a refused install writes nothing");
  // The bundle itself is edited between the two attempts, so the baseline is taken again after the edit.
  writeAt(join(r.adaptersDir, "omp", "index.js"), "// @realm:Extension_URL@ is not a token, @realm:extension-url@ is\nexport default null;\n// @realm:path@\n");
  const second = unchanged();
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: true }), (error: unknown) => code(error) === "SCHEMA_INVALID");
  assert.equal(unchanged(), second, "a refused dry run writes nothing");
  assert.equal(existsSync(receiptPath(r.host.stateDir, "omp")), false);

  // The mcp-config manifest has no entry for the token to name.
  const host = makeFixtureHost(t);
  writeAt(join(host.adaptersDir, "fixture-bundle", "a.txt"), `url: ${TOKEN}\n`);
  const adapter = createHostAdapter(fixtureEntry(fixtureRecipe("bundle-copy")), defaultManifestFor("claude", "1.2.3"), deps(host, captureLog(), host.adaptersDir));
  const hostBefore = treeHash(host.root);
  await assert.rejects(adapter.install(host.env, { dryRun: false }), (error: unknown) => code(error) === "SCHEMA_INVALID");
  assert.equal(treeHash(host.root), hostBefore);
});

void test("OMPB-05: a relative adapters directory cannot name the package root", async (t) => {
  const r = rig(t);
  const adapter = adapterFor(r.host, r.log, "adapters");
  await assert.rejects(adapter.install(r.host.env, { dryRun: false }), (error: unknown) => code(error) === "SCHEMA_INVALID");
  assert.equal(existsSync(r.shimPath), false);
});

void test("OMPB-05: the omp binary on an absolute PATH directory without an agent directory is config-home-missing, and Realm creates nothing", async (t) => {
  const r = rig(t, { agentDir: false });
  const bin = join(r.host.root, "bin");
  mkdirSync(bin);
  const binary = join(bin, "omp");
  writeFileSync(binary, "#!/bin/sh\n");
  chmodSync(binary, 0o755);
  const env: HostEnv = { ...r.host.env, pathDirs: [bin] };
  const found = await r.adapter.detect(env);
  assert.equal(found.detected, true);
  assert.equal(found.via, "binary");
  const before = treeHash(r.host.root);
  await assert.rejects(r.adapter.install(env, { dryRun: false }), refusedWith("config-home-missing", "POLICY_DENIED"));
  assert.equal(treeHash(r.host.root), before);
  assert.equal(existsSync(r.agentDir), false);
  // Nothing detected and no binary: refused as not-detected, with no read of the package.
  await assert.rejects(r.adapter.install(r.host.env, { dryRun: false }), refusedWith("not-detected", "POLICY_DENIED"));
  assert.ok(eventsOf(r.log.lines).includes("host.install.refused"));
});

// ---- extension target status ---------------------------------------------------------------------------------------------------

void test("OMPB-07: status reports the shim target present after install, missing once the entry is removed, and null with no receipt", async (t) => {
  const r = rig(t);
  assert.equal((await r.adapter.status(r.host.env)).extensionTarget, null, "no receipt");
  await r.adapter.install(r.host.env, { dryRun: false });
  const present = await r.adapter.status(r.host.env);
  assert.equal(present.status, "installed");
  assert.equal(present.extensionTarget, "present");
  rmSync(join(r.host.root, "dist", "src", "omp", "extension.js"));
  const missing = await r.adapter.status(r.host.env);
  assert.equal(missing.status, "installed", "the shim itself is intact");
  assert.equal(missing.extensionTarget, "missing");
  assert.equal(JSON.stringify(missing).includes(r.host.root), false, "no path is returned");
});

void test("OMPB-07: a shim holding two import literals reports an unreadable target", async (t) => {
  const r = rig(t);
  writeAt(
    join(r.adaptersDir, "omp", "index.js"),
    `export default async function realmExtension(pi) {\n  await import(${TOKEN});\n  const { default: factory } = await import(${TOKEN});\n  await factory(pi);\n}\n`,
  );
  await r.adapter.install(r.host.env, { dryRun: false });
  assert.equal((await r.adapter.status(r.host.env)).extensionTarget, "unreadable");
});

void test("OMPB-07: the extension target is null for a host that is not an extension host", async (t) => {
  const host = makeFixtureHost(t);
  const log = captureLog();
  const adapter = createHostAdapter(fixtureEntry(fixtureRecipe("json-merge")), defaultManifestFor("claude", "1.2.3"), deps(host, log, host.adaptersDir));
  await adapter.install(host.env, { dryRun: false });
  const found = await adapter.status(host.env);
  assert.equal(found.status, "installed");
  assert.equal(found.extensionTarget, null);
});
