import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appendAudit, type AuditEntryInput } from "../../src/audit/log.js";
import { checkAuditFile } from "../../src/audit/chain.js";
import { RealmError } from "../../src/core/errors.js";
import type { HostAuditFn } from "../../src/host/host-audit.js";
import {
  applyHostOperation,
  defaultHostReader,
  planHostOperation,
  readHostFile,
  runHostOperation,
  type HostEngineContext,
  type HostEngineStage,
  type HostFileInfo,
  type HostFsReader,
  type HostOperation,
  type HostOperationRequest,
} from "../../src/host/install.js";
import { readReceipt, receiptPath } from "../../src/host/receipt.js";
import { HostRefusal, type HostRefusalReason } from "../../src/host/recipe.js";
import type { InstallRecipe } from "../../src/host/types.js";
import {
  captureLog,
  eventsOf,
  FIXTURE_BUNDLE_FILES,
  fixtureRecipe,
  makeFixtureHost,
  treeHash,
  writeAt,
  type CapturedLog,
  type FixtureHost,
  type FixtureRecipeKind,
} from "../support/fixture-host.js";

interface Rig {
  readonly host: FixtureHost;
  readonly log: CapturedLog;
  readonly ctx: HostEngineContext;
}

interface RigOptions {
  readonly audit?: HostAuditFn;
  readonly reader?: HostFsReader;
  readonly readTimeoutMs?: number;
  readonly stageHook?: (stage: HostEngineStage, path: string) => void;
  readonly createConfigHome?: boolean;
}

function makeCtx(host: FixtureHost, log: CapturedLog, options: RigOptions): HostEngineContext {
  let counter = 0;
  return {
    stateDir: host.stateDir,
    logger: log.logger,
    audit: options.audit ?? appendAudit,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    newCorrelationId: () => {
      counter += 1;
      return `corr-${String(counter)}`;
    },
    readTimeoutMs: options.readTimeoutMs ?? 5000,
    reader: options.reader ?? defaultHostReader,
    ...(options.stageHook === undefined ? {} : { stageHook: options.stageHook }),
  };
}

function rig(t: TestContext, options: RigOptions = {}): Rig {
  const host = makeFixtureHost(t, options.createConfigHome === undefined ? {} : { createConfigHome: options.createConfigHome });
  const log = captureLog();
  return { host, log, ctx: makeCtx(host, log, options) };
}

const BUNDLE = Object.entries(FIXTURE_BUNDLE_FILES).map(([rel, content]) => ({ rel, content }));

function request(r: Rig, op: HostOperation, recipe: InstallRecipe | null, home: string = r.host.configHome): HostOperationRequest {
  return { op, hostId: "claude", recipe, home, bundle: recipe?.kind === "bundle-copy" ? BUNDLE : [] };
}

function run(r: Rig, op: HostOperation, recipe: InstallRecipe | null, dryRun = false, ctx: HostEngineContext = r.ctx) {
  return runHostOperation(request(r, op, recipe), ctx, { dryRun });
}

function auditLines(stateDir: string): Record<string, unknown>[] {
  const file = join(stateDir, "audit", "host-plugins.jsonl");
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function code(error: unknown): string | undefined {
  return error instanceof RealmError ? error.code : undefined;
}

function refusedWith(reason: HostRefusalReason, errorCode: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof HostRefusal && error.refusal === reason && error.code === errorCode;
}

function trees(r: Rig): string {
  return `${treeHash(r.host.configHome)}|${treeHash(r.host.stateDir)}`;
}

// Existing user content for each recipe kind: [file, content] or null for none.
const SEEDS: readonly [FixtureRecipeKind, string, string | null][] = [
  ["json-merge", "settings.json", `${JSON.stringify({ z: 1, a: [true, null], m: { deep: "x" } }, null, 2)}\n`],
  ["json-merge", "settings.json", null],
  ["text-block", "config.toml", "a = 1"],
  ["text-block", "config.toml", "# user settings\nb = 2\n"],
  ["text-block", "config.toml", null],
  ["bundle-copy", "", null],
];

function seed(r: Rig, file: string, content: string | null): void {
  if (content !== null) {
    writeAt(join(r.host.configHome, file), content);
  }
}

const KINDS: readonly FixtureRecipeKind[] = ["json-merge", "text-block", "bundle-copy"];

void test("a dry run plans every kind and writes nothing: no host file, no receipt, no audit line", async (t) => {
  for (const kind of KINDS) {
    const r = rig(t);
    const found = SEEDS.find((entry) => entry[0] === kind);
    assert.ok(found);
    const [, file, content] = found;
    seed(r, file, content);
    const before = trees(r);
    const outcome = await run(r, "install", fixtureRecipe(kind), true);
    assert.equal(outcome.status, "planned", kind);
    assert.equal(outcome.dryRun, true);
    assert.ok(outcome.actions.length > 0 && outcome.actions.every((action) => action.action !== "noop"), kind);
    assert.equal(trees(r), before, kind);
    assert.equal(existsSync(join(r.host.stateDir, "hosts")), false);
    assert.equal(existsSync(join(r.host.stateDir, "audit")), false);
    assert.deepEqual(eventsOf(r.log.lines), ["host.install.plan"]);
    const serialized = JSON.stringify(outcome);
    assert.ok(!serialized.includes("alpha") && !serialized.includes("mcpServers") && !serialized.includes("BEGIN"), "no content in the outcome");
    assert.ok(r.log.lines.every((line) => !line.includes("alpha") && !line.includes("mcpServers")));
  }
});

void test("install then uninstall is an exact inverse with a verifiable four-line audit chain", async (t) => {
  for (const [kind, file, content] of SEEDS) {
    const r = rig(t);
    seed(r, file, content);
    const preHome = treeHash(r.host.configHome);
    const preState = treeHash(r.host.stateDir);
    const recipe = fixtureRecipe(kind);

    const installed = await run(r, "install", recipe);
    assert.equal(installed.status, "installed", kind);
    assert.notEqual(treeHash(r.host.configHome), preHome, kind);
    const receipt = await readReceipt(r.host.stateDir, "claude");
    assert.equal(receipt?.receipt.state, "installed");
    assert.equal(receipt.receipt.configHome, r.host.configHome);
    assert.equal(receipt.receipt.recipeKind, kind);

    // A second install is a byte-identical no-op: no write and no audit line.
    const afterInstall = treeHash(r.host.configHome);
    const stateAfterInstall = treeHash(r.host.stateDir);
    const again = await run(r, "install", recipe);
    assert.equal(again.status, "noop", kind);
    assert.equal(treeHash(r.host.configHome), afterInstall);
    assert.equal(treeHash(r.host.stateDir), stateAfterInstall);
    assert.equal(auditLines(r.host.stateDir).length, 2);

    const removed = await run(r, "uninstall", recipe);
    assert.equal(removed.status, "removed", kind);
    assert.equal(treeHash(r.host.configHome), preHome, `${kind}: home restored`);
    assert.equal(existsSync(receiptPath(r.host.stateDir, "claude")), false);
    assert.notEqual(treeHash(r.host.stateDir), preState, "audit lines remain");

    const lines = auditLines(r.host.stateDir);
    assert.deepEqual(
      lines.map((line) => [line["tool"], line["phase"], line["outcome"]]),
      [
        ["host.install", "admission", "ok"],
        ["host.install", "result", "ok"],
        ["host.uninstall", "admission", "ok"],
        ["host.uninstall", "result", "ok"],
      ],
    );
    assert.equal(lines[0]?.["correlationId"], lines[1]?.["correlationId"]);
    assert.equal(lines[2]?.["correlationId"], lines[3]?.["correlationId"]);
    assert.notEqual(lines[0]?.["correlationId"], lines[2]?.["correlationId"]);
    assert.ok(lines.every((line) => line["sessionId"] === "host-plugins" && line["path"] === r.host.configHome));
    const check = checkAuditFile(join(r.host.stateDir, "audit", "host-plugins.jsonl"));
    assert.equal(check.ok, true);
    assert.equal(check.lines, 4);
    assert.deepEqual(
      eventsOf(r.log.lines).filter((event) => event.endsWith("applied")),
      ["host.install.applied", "host.uninstall.applied"],
    );
  }
});

void test("no secret, file content or host text reaches a log line, an audit line or a receipt", async (t) => {
  const secrets = ["sk-live-0123456789abcdef0123456789abcdef", "Bearer abcdefghijklmnop", "abcdefghijklmnop", "0123456789abcdef"];
  const files: [FixtureRecipeKind, string, string][] = [
    [
      "json-merge",
      "settings.json",
      `${JSON.stringify({ apiKey: secrets[0], note: `Authorization: ${secrets[1] ?? ""}`, other: "plain host text" }, null, 2)}\n`,
    ],
    ["text-block", "config.toml", `api_key = "${secrets[0] ?? ""}"\nheader = "Authorization: ${secrets[1] ?? ""}"\nname = "plain host text"\n`],
  ];
  for (const [kind, file, content] of files) {
    const r = rig(t);
    seed(r, file, content);
    await run(r, "install", fixtureRecipe(kind));
    const receiptText = readFileSync(receiptPath(r.host.stateDir, "claude"), "utf8");
    // The host file keeps the user's secret; everything Realm wrote about it does not.
    assert.ok(readFileSync(join(r.host.configHome, file), "utf8").includes(secrets[0] ?? ""));
    await run(r, "uninstall", fixtureRecipe(kind));
    assert.equal(readFileSync(join(r.host.configHome, file), "utf8"), content, "the user's bytes come back");
    const artifacts = [r.log.lines.join("\n"), readFileSync(join(r.host.stateDir, "audit", "host-plugins.jsonl"), "utf8"), receiptText];
    for (const artifact of artifacts) {
      for (const secret of secrets) {
        assert.ok(!artifact.includes(secret), `${kind}: ${secret}`);
      }
      assert.ok(!artifact.includes("plain host text"), kind);
      assert.ok(!artifact.includes("apiKey") && !artifact.includes("api_key"), kind);
    }
  }
});

void test("a refusal during planning logs host.<op>.refused and appends no audit line", async (t) => {
  const cases: [string, FixtureRecipeKind, string, string, HostRefusalReason, string][] = [
    ["invalid JSON", "json-merge", "settings.json", "{", "unparseable", "SCHEMA_INVALID"],
    ["a JSON array", "json-merge", "settings.json", "[]", "unparseable", "SCHEMA_INVALID"],
    ["foreign value", "json-merge", "settings.json", `${JSON.stringify({ mcpServers: { realm: { command: "other" } } })}\n`, "foreign-content", "POLICY_DENIED"],
    ["foreign block", "text-block", "config.toml", "# BEGIN realm host-plugin\nother\n# END realm host-plugin\n", "foreign-content", "POLICY_DENIED"],
    ["lone marker", "text-block", "config.toml", "# BEGIN realm host-plugin\n", "unparseable", "SCHEMA_INVALID"],
    ["foreign bundle file", "bundle-copy", "plugins/realm/a.txt", "mine", "foreign-content", "POLICY_DENIED"],
  ];
  for (const [label, kind, file, content, reason, errorCode] of cases) {
    const r = rig(t);
    seed(r, file, content);
    const before = trees(r);
    await assert.rejects(run(r, "install", fixtureRecipe(kind)), refusedWith(reason, errorCode), label);
    assert.equal(trees(r), before, label);
    assert.equal(auditLines(r.host.stateDir).length, 0, label);
    assert.deepEqual(eventsOf(r.log.lines), ["host.install.refused"], label);
    assert.ok(r.log.lines[0]?.includes(`"code":"${errorCode}"`), label);
  }
});

void test("a host file over 1 MiB, and one that is not UTF-8, are refused as unparseable", async (t) => {
  const r = rig(t);
  writeAt(join(r.host.configHome, "settings.json"), " ".repeat(1024 * 1024 + 1));
  await assert.rejects(run(r, "install", fixtureRecipe("json-merge")), refusedWith("unparseable", "SCHEMA_INVALID"));
  writeFileSync(join(r.host.configHome, "settings.json"), Buffer.from([0x7b, 0xff, 0xfe, 0x7d]));
  await assert.rejects(run(r, "install", fixtureRecipe("json-merge")), refusedWith("unparseable", "SCHEMA_INVALID"));
});

void test("a missing config home is refused and never created", async (t) => {
  const r = rig(t, { createConfigHome: false });
  const before = trees(r);
  await assert.rejects(run(r, "install", fixtureRecipe("json-merge")), refusedWith("config-home-missing", "POLICY_DENIED"));
  assert.equal(existsSync(r.host.configHome), false);
  assert.equal(trees(r), before);
  assert.equal(auditLines(r.host.stateDir).length, 0);
});

void test("a symlinked final file is refused with PATH_ESCAPE and no --config-home hint, a symlinked directory keeps its hint, and the target is untouched", async (t) => {
  const r = rig(t);
  const outside = join(r.host.root, "outside.json");
  writeFileSync(outside, "{}\n");
  symlinkSync(outside, join(r.host.configHome, "settings.json"));
  await assert.rejects(
    run(r, "install", fixtureRecipe("json-merge")),
    (error: unknown) => refusedWith("symlink", "PATH_ESCAPE")(error) && error instanceof HostRefusal && error.fix === undefined && !error.message.includes("--config-home"),
  );
  assert.equal(readFileSync(outside, "utf8"), "{}\n");
  assert.equal(auditLines(r.host.stateDir).length, 0);
  assert.equal(existsSync(join(r.host.stateDir, "hosts")), false);

  const second = rig(t);
  const outsideDir = join(second.host.root, "outside-dir");
  mkdirSync(outsideDir);
  symlinkSync(outsideDir, join(second.host.configHome, "plugins"));
  await assert.rejects(
    run(second, "install", fixtureRecipe("bundle-copy")),
    (error: unknown) => refusedWith("symlink", "PATH_ESCAPE")(error) && error instanceof HostRefusal && error.fix === `use --config-home ${outsideDir}`,
  );
  assert.deepEqual(readdirSync(outsideDir), []);
  assert.equal(existsSync(join(outsideDir, "realm")), false);
});

void test("a symlinked config home is followed once and the receipt records the real path", async (t) => {
  const r = rig(t);
  const link = join(r.host.home, "linked-home");
  symlinkSync(r.host.configHome, link);
  const outcome = await runHostOperation(request(r, "install", fixtureRecipe("json-merge"), link), r.ctx, { dryRun: false });
  assert.equal(outcome.status, "installed");
  assert.equal((await readReceipt(r.host.stateDir, "claude"))?.receipt.configHome, r.host.configHome);
  assert.ok(existsSync(join(r.host.configHome, "settings.json")));
});

void test("an admission line that cannot be written means nothing is written", async (t) => {
  for (const failure of [new Error("disk full"), new RealmError("POLICY_DENIED")]) {
    const r = rig(t, {
      audit: () => {
        throw failure;
      },
    });
    writeAt(join(r.host.configHome, "settings.json"), '{\n  "z": 1\n}\n');
    const before = trees(r);
    await assert.rejects(run(r, "install", fixtureRecipe("json-merge")), (error: unknown) => code(error) === (failure instanceof RealmError ? "POLICY_DENIED" : "AUDIT_WRITE_FAILED"));
    assert.equal(trees(r), before, "home and state are unchanged");
    assert.ok(eventsOf(r.log.lines).includes("host.install.audit_failed"));
  }
});

void test("a result line that cannot be written is AUDIT_WRITE_FAILED, the change stays and the failure is logged", async (t) => {
  let calls = 0;
  const r = rig(t, {
    audit: (stateDir: string, input: AuditEntryInput) => {
      calls += 1;
      if (calls === 2) {
        throw new Error("disk full");
      }
      appendAudit(stateDir, input);
    },
  });
  await assert.rejects(run(r, "install", fixtureRecipe("json-merge")), (error: unknown) => code(error) === "AUDIT_WRITE_FAILED");
  assert.ok(existsSync(join(r.host.configHome, "settings.json")), "not rolled back");
  assert.equal((await readReceipt(r.host.stateDir, "claude"))?.receipt.state, "installed");
  assert.ok(eventsOf(r.log.lines).includes("host.install.audit_failed"));
  assert.equal(auditLines(r.host.stateDir).length, 1, "only the admission line landed");
});

void test("a stalled read is TOOL_TIMEOUT with nothing applied", async (t) => {
  const stalled: HostFsReader = {
    ...defaultHostReader,
    lstat: () => new Promise<HostFileInfo | null>(() => undefined),
  };
  const r = rig(t, { reader: stalled, readTimeoutMs: 30 });
  const before = trees(r);
  await assert.rejects(run(r, "install", fixtureRecipe("json-merge")), (error: unknown) => code(error) === "TOOL_TIMEOUT");
  assert.equal(trees(r), before);
  assert.equal(auditLines(r.host.stateDir).length, 0);
});

void test("a file that changes between plan and apply is a concurrent-change refusal, the receipt stays pending", async (t) => {
  const r = rig(t);
  const file = join(r.host.configHome, "settings.json");
  writeAt(file, '{\n  "z": 1\n}\n');
  const plan = await planHostOperation(request(r, "install", fixtureRecipe("json-merge")), r.ctx);
  writeFileSync(file, '{\n  "z": 2\n}\n');
  assert.throws(() => applyHostOperation(plan, r.ctx, { dryRun: false }), refusedWith("concurrent-change", "WRITE_NOT_ATOMIC"));
  assert.equal(readFileSync(file, "utf8"), '{\n  "z": 2\n}\n', "the other writer's bytes survive");
  assert.equal((await readReceipt(r.host.stateDir, "claude"))?.receipt.state, "pending");
  const lines = auditLines(r.host.stateDir);
  assert.deepEqual(lines.map((line) => [line["phase"], line["outcome"]]), [["admission", "ok"], ["result", "WRITE_NOT_ATOMIC"]]);
});

void test("a crash between files leaves a pending receipt; a second install resumes and ends installed", async (t) => {
  const crashing = rig(t, {
    stageHook: (stage, path) => {
      if (stage === "after-change" && path.endsWith("a.txt")) {
        throw new Error("simulated crash");
      }
    },
  });
  const recipe = fixtureRecipe("bundle-copy");
  await assert.rejects(run(crashing, "install", recipe), (error: unknown) => code(error) === "WRITE_NOT_ATOMIC");
  const pending = await readReceipt(crashing.host.stateDir, "claude");
  assert.equal(pending?.receipt.state, "pending");
  assert.equal(readFileSync(join(crashing.host.configHome, "plugins/realm/a.txt"), "utf8"), "alpha\n");
  assert.equal(existsSync(join(crashing.host.configHome, "plugins/realm/b.txt")), false);
  assert.equal(auditLines(crashing.host.stateDir).at(-1)?.["outcome"], "WRITE_NOT_ATOMIC");

  const resumed = await run(crashing, "install", recipe, false, makeCtx(crashing.host, crashing.log, {}));
  assert.equal(resumed.status, "installed");
  assert.deepEqual(resumed.actions.map((action) => [action.path, action.action]), [
    ["plugins/realm/a.txt", "noop"],
    ["plugins/realm/b.txt", "create"],
  ]);
  const done = await readReceipt(crashing.host.stateDir, "claude");
  assert.equal(done?.receipt.state, "installed");

  // The same end state as an install that never crashed.
  const straight = rig(t);
  await run(straight, "install", recipe);
  assert.equal(treeHash(crashing.host.configHome), treeHash(straight.host.configHome));
  const straightReceipt = await readReceipt(straight.host.stateDir, "claude");
  assert.deepEqual(done.receipt.entries, straightReceipt?.receipt.entries);
  assert.equal(readFileSync(join(crashing.host.configHome, "plugins/realm/b.txt"), "utf8"), "beta\n");
});

void test("a crash between files, then an uninstall, restores the pre-install tree", async (t) => {
  const crashing = rig(t, {
    stageHook: (stage, path) => {
      if (stage === "after-change" && path.endsWith("a.txt")) {
        throw new Error("simulated crash");
      }
    },
  });
  const pre = treeHash(crashing.host.configHome);
  const recipe = fixtureRecipe("bundle-copy");
  await assert.rejects(run(crashing, "install", recipe));
  assert.notEqual(treeHash(crashing.host.configHome), pre);
  const outcome = await run(crashing, "uninstall", recipe, false, makeCtx(crashing.host, crashing.log, {}));
  assert.equal(outcome.status, "removed");
  assert.equal(treeHash(crashing.host.configHome), pre);
  assert.equal(await readReceipt(crashing.host.stateDir, "claude"), null);
});

void test("uninstall refuses drift before any write, and an unrelated edit in the same file is not drift", async (t) => {
  const tampers: [FixtureRecipeKind, string, (current: string) => string][] = [
    ["json-merge", "settings.json", () => `${JSON.stringify({ mcpServers: { realm: { command: "evil" } } }, null, 2)}\n`],
    ["text-block", "config.toml", (current) => current.replace("command", "cmd")],
    ["bundle-copy", "plugins/realm/a.txt", () => "changed\n"],
  ];
  for (const [kind, file, tamper] of tampers) {
    const r = rig(t);
    const recipe = fixtureRecipe(kind);
    await run(r, "install", recipe);
    const target = join(r.host.configHome, file);
    writeFileSync(target, tamper(readFileSync(target, "utf8")));
    const before = trees(r);
    await assert.rejects(run(r, "uninstall", recipe), refusedWith("drifted", "POLICY_DENIED"), kind);
    assert.equal(trees(r), before, kind);
    assert.equal(auditLines(r.host.stateDir).length, 2, kind);
    assert.ok(eventsOf(r.log.lines).includes("host.uninstall.refused"));
  }

  const r = rig(t);
  writeAt(join(r.host.configHome, "config.toml"), "a = 1\n");
  await run(r, "install", fixtureRecipe("text-block"));
  const target = join(r.host.configHome, "config.toml");
  writeFileSync(target, readFileSync(target, "utf8").replace("a = 1", "a = 2"));
  await run(r, "uninstall", fixtureRecipe("text-block"));
  assert.equal(readFileSync(target, "utf8"), "a = 2\n");
});

void test("an owned part that is already gone is not an uninstall refusal: it is a no-op and the receipt is removed", async (t) => {
  const r = rig(t);
  const recipe = fixtureRecipe("json-merge");
  await run(r, "install", recipe);
  rmSync(join(r.host.configHome, "settings.json"));
  const outcome = await run(r, "uninstall", recipe);
  assert.equal(outcome.status, "noop");
  assert.equal(existsSync(receiptPath(r.host.stateDir, "claude")), false);
  assert.equal(auditLines(r.host.stateDir).length, 2, "bookkeeping is not audited");

  const bundle = rig(t);
  const pre = treeHash(bundle.host.configHome);
  await run(bundle, "install", fixtureRecipe("bundle-copy"));
  rmSync(join(bundle.host.configHome, "plugins/realm/a.txt"));
  const partial = await run(bundle, "uninstall", fixtureRecipe("bundle-copy"));
  assert.equal(partial.status, "removed");
  assert.equal(treeHash(bundle.host.configHome), pre);
});

void test("uninstall with no receipt is a no-op that needs no recipe and writes nothing", async (t) => {
  const r = rig(t);
  const before = trees(r);
  assert.equal((await run(r, "uninstall", fixtureRecipe("json-merge"))).status, "noop");
  assert.equal((await run(r, "uninstall", null)).status, "noop");
  assert.equal(trees(r), before);
  assert.deepEqual(eventsOf(r.log.lines), ["host.uninstall.plan", "host.uninstall.plan"]);
  await assert.rejects(run(r, "install", null), refusedWith("recipe-pending", "POLICY_DENIED"));
});

void test("a receipt for another recipe kind is not silently reused", async (t) => {
  const r = rig(t);
  await run(r, "install", fixtureRecipe("json-merge"));
  await assert.rejects(run(r, "install", fixtureRecipe("text-block")), refusedWith("drifted", "POLICY_DENIED"));
  await assert.rejects(run(r, "uninstall", null), refusedWith("recipe-pending", "POLICY_DENIED"));
});

void test("an uninstall whose config home has vanished removes the stale receipt", async (t) => {
  const r = rig(t);
  const recipe = fixtureRecipe("json-merge");
  await run(r, "install", recipe);
  rmSync(r.host.configHome, { recursive: true, force: true });
  const outcome = await run(r, "uninstall", recipe);
  assert.equal(outcome.status, "noop");
  assert.equal(existsSync(receiptPath(r.host.stateDir, "claude")), false);
  assert.equal(existsSync(r.host.configHome), false, "the home is never recreated");
});

void test("a BOM-prefixed JSON file is unparseable and untouched, and a BOM-prefixed text file keeps its BOM through install and uninstall", async (t) => {
  const r = rig(t);
  const json = join(r.host.configHome, "settings.json");
  const bomJson = Buffer.from("\uFEFF{}\n", "utf8");
  writeFileSync(json, bomJson);
  await assert.rejects(run(r, "install", fixtureRecipe("json-merge")), refusedWith("unparseable", "SCHEMA_INVALID"));
  assert.deepEqual(readFileSync(json), bomJson);
  assert.equal(existsSync(join(r.host.stateDir, "hosts")), false);

  const text = join(r.host.configHome, "config.toml");
  const bomText = "\uFEFFa = 1\n";
  writeFileSync(text, bomText, "utf8");
  assert.equal(await readHostFile(r.ctx, r.host.configHome, "config.toml", new Set()), bomText);
  await run(r, "install", fixtureRecipe("text-block"));
  const installed = readFileSync(text, "utf8");
  assert.ok(installed.startsWith("\uFEFFa = 1\n"));
  await run(r, "uninstall", fixtureRecipe("text-block"));
  assert.deepEqual(readFileSync(text), Buffer.from(bomText, "utf8"));
});
