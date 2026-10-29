import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  aggregateLcov,
  compareToFloors,
  findUnloaded,
  isTypeOnlyModule,
  percent,
  raiseFloors,
  runCheck,
  validateConfig,
} from "./coverage.mjs";

const DIRECTORIES = ["src/fs", "src/core", "src/tools"];
const RUNTIME_CODE = "export const answer = 42;\n";

function record(path, { lf, lh, brf, brh, fnf, fnh }) {
  return [
    `SF:${path}`,
    "FN:1,alpha",
    "FNDA:2,alpha",
    `FNF:${fnf}`,
    `FNH:${fnh}`,
    "BRDA:3,0,0,1",
    `BRF:${brf}`,
    `BRH:${brh}`,
    "DA:1,1",
    `LF:${lf}`,
    `LH:${lh}`,
    "end_of_record",
  ].join("\n");
}

const FS_A = "<ws>/dist/src/fs/a.js";
const FS_B = "<ws>/dist/src/fs/deep/b.js";
const CORE_A = "<ws>/dist/src/core/a.js";
const OUTSIDE = "<ws>/dist/src/runtime/x.js";

const LCOV = [
  "TN:",
  record(FS_A, { lf: 10, lh: 8, brf: 4, brh: 2, fnf: 2, fnh: 2 }),
  "",
  record(FS_B, { lf: 10, lh: 10, brf: 0, brh: 0, fnf: 3, fnh: 1 }),
  record(CORE_A, { lf: 20, lh: 5, brf: 10, brh: 5, fnf: 4, fnh: 4 }),
  record(OUTSIDE, { lf: 100, lh: 0, brf: 100, brh: 0, fnf: 100, fnh: 0 }),
  "",
].join("\n");

function floorsConfig(overrides = {}) {
  return {
    gateNode: "22.x",
    tolerance: 1,
    reportOnly: false,
    floors: {
      "src/fs": { lines: 50, branches: 50, functions: 50 },
      "src/core": { lines: 20, branches: 50, functions: 100 },
    },
    ...overrides,
  };
}

function withTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), "coverage-test-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  let result;
  try {
    result = body(dir);
  } catch (error) {
    cleanup();
    throw error;
  }
  if (result instanceof Promise) {
    return result.finally(cleanup);
  }
  cleanup();
  return result;
}

function writeText(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test("aggregateLcov sums per directory and ignores records outside them", () => {
  const totals = aggregateLcov(LCOV, DIRECTORIES);
  assert.deepEqual(totals["src/fs"], {
    lines: { found: 20, hit: 18 },
    branches: { found: 4, hit: 2 },
    functions: { found: 5, hit: 3 },
    files: [FS_A, FS_B],
  });
  assert.deepEqual(totals["src/core"], {
    lines: { found: 20, hit: 5 },
    branches: { found: 10, hit: 5 },
    functions: { found: 4, hit: 4 },
    files: [CORE_A],
  });
});

test("aggregateLcov gives a directory without records an empty entry that reads as 100 percent", () => {
  const totals = aggregateLcov(LCOV, DIRECTORIES);
  const tools = totals["src/tools"];
  assert.deepEqual(tools.files, []);
  assert.deepEqual(tools.lines, { found: 0, hit: 0 });
  assert.equal(percent(tools.lines), 100);
  assert.equal(percent(tools.branches), 100);
  assert.equal(percent(tools.functions), 100);
});

test("aggregateLcov matches an absolute or Windows-style prefix and does not confuse nested directory names", () => {
  const text = [
    record("/work/space/dist/src/tools/t.js", { lf: 2, lh: 2, brf: 0, brh: 0, fnf: 1, fnh: 1 }),
    record("C:\\work\\dist\\src\\core\\tools\\c.js", { lf: 4, lh: 1, brf: 0, brh: 0, fnf: 1, fnh: 0 }),
    record("dist/src/fs/relative.js", { lf: 1, lh: 1, brf: 0, brh: 0, fnf: 1, fnh: 1 }),
  ].join("\n");
  const totals = aggregateLcov(text, DIRECTORIES);
  assert.deepEqual(totals["src/tools"].files, ["/work/space/dist/src/tools/t.js"]);
  assert.deepEqual(totals["src/core"].files, ["C:/work/dist/src/core/tools/c.js"]);
  assert.deepEqual(totals["src/fs"].files, ["dist/src/fs/relative.js"]);
  assert.deepEqual(totals["src/core"].lines, { found: 4, hit: 1 });
});

test("aggregateLcov rejects a malformed lcov text", () => {
  assert.throws(() => aggregateLcov("SF:<ws>/dist/src/fs/a.js\nLF:1\n", DIRECTORIES), /no end_of_record/);
  assert.throws(() => aggregateLcov("end_of_record\n", DIRECTORIES), /without an SF record/);
  assert.throws(() => aggregateLcov("LF:1\n", DIRECTORIES), /LF outside an SF record/);
  assert.throws(() => aggregateLcov("SF:a\nLF:many\nend_of_record\n", DIRECTORIES), /LF needs a non-negative integer/);
  assert.throws(() => aggregateLcov("SF:a\nSF:b\n", DIRECTORIES), /starts before the previous record ended/);
});

test("percent divides hit by found and treats nothing found as 100", () => {
  assert.equal(percent({ found: 8, hit: 2 }), 25);
  assert.equal(percent({ found: 0, hit: 0 }), 100);
});

test("compareToFloors reports ok and below rows and clears ok only for a below row", () => {
  const totals = aggregateLcov(LCOV, DIRECTORIES);
  const result = compareToFloors(totals, floorsConfig());
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.rows.map((row) => `${row.directory} ${row.metric} ${row.status}`),
    [
      "src/fs lines ok",
      "src/fs branches ok",
      "src/fs functions ok",
      "src/core lines ok",
      "src/core branches ok",
      "src/core functions ok",
    ],
  );
  assert.equal(result.rows.length, 6);
  const stricter = compareToFloors(
    totals,
    floorsConfig({ floors: { "src/fs": { lines: 91, branches: 50, functions: 61 }, "src/core": { lines: 25, branches: 50, functions: 100 } } }),
  );
  assert.equal(stricter.ok, false);
  const below = stricter.rows.filter((row) => row.status === "below");
  assert.deepEqual(
    below.map((row) => [row.directory, row.metric, row.actual, row.floor]),
    [
      ["src/fs", "lines", 90, 91],
      ["src/fs", "functions", 60, 61],
    ],
  );
});

test("compareToFloors marks a shortfall as report and stays ok while reportOnly is true", () => {
  const totals = aggregateLcov(LCOV, DIRECTORIES);
  const config = floorsConfig({
    reportOnly: true,
    floors: { "src/fs": { lines: 99, branches: 0, functions: 0 }, "src/tools": { lines: 100, branches: 100, functions: 100 } },
  });
  const result = compareToFloors(totals, config);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.rows.filter((row) => row.status !== "ok").map((row) => `${row.directory} ${row.metric} ${row.status}`),
    ["src/fs lines report"],
  );
  assert.equal(compareToFloors(totals, { ...config, reportOnly: false }).ok, false);
});

test("compareToFloors and validateConfig throw a precise message for a bad config", () => {
  const totals = aggregateLcov(LCOV, DIRECTORIES);
  const bad = [
    [null, /top level must be an object/],
    [floorsConfig({ gateNode: "" }), /"gateNode" must be a non-empty string/],
    [floorsConfig({ tolerance: -1 }), /"tolerance" must be a number >= 0/],
    [floorsConfig({ tolerance: "1" }), /"tolerance" must be a number >= 0/],
    [floorsConfig({ reportOnly: "yes" }), /"reportOnly" must be true or false/],
    [floorsConfig({ floors: [] }), /"floors" must be an object/],
    [floorsConfig({ floors: {} }), /at least one directory/],
    [floorsConfig({ floors: { "dist/fs": { lines: 0, branches: 0, functions: 0 } } }), /must look like "src\/<name>"/],
    [floorsConfig({ floors: { "src/fs": 5 } }), /floors\["src\/fs"\] must be an object/],
    [floorsConfig({ floors: { "src/fs": { lines: 0, branches: 0 } } }), /floors\["src\/fs"\]\.functions must be a number from 0 to 100/],
    [floorsConfig({ floors: { "src/fs": { lines: 101, branches: 0, functions: 0 } } }), /\.lines must be a number from 0 to 100/],
  ];
  for (const [config, pattern] of bad) {
    assert.throws(() => compareToFloors(totals, config), pattern);
    assert.throws(() => validateConfig(config), pattern);
  }
  assert.throws(
    () => compareToFloors({}, floorsConfig()),
    /no coverage totals for src\/fs/,
  );
});

test("findUnloaded lists compiled files that have no lcov record, per directory", () => {
  const unloaded = findUnloaded(
    [FS_A, CORE_A],
    [
      "/other/prefix/dist/src/fs/a.js",
      "/other/prefix/dist/src/fs/never.js",
      "/other/prefix/dist/src/core/a.js",
      "/other/prefix/dist/src/core/also-never.js",
      "/other/prefix/dist/src/runtime/not-listed.js",
    ],
    DIRECTORIES,
  );
  assert.deepEqual(unloaded, {
    "src/fs": ["dist/src/fs/never.js"],
    "src/core": ["dist/src/core/also-never.js"],
    "src/tools": [],
  });
});

test("raiseFloors sets floor(actual) minus the tolerance, never lowers, and leaves its input alone", () => {
  const totals = aggregateLcov(LCOV, DIRECTORIES);
  const config = floorsConfig({
    floors: {
      "src/fs": { lines: 50, branches: 90, functions: 0 },
      "src/core": { lines: 0, branches: 0, functions: 0 },
      "src/tools": { lines: 0, branches: 0, functions: 0 },
    },
  });
  const snapshot = structuredClone(config);
  const raised = raiseFloors(config, totals);
  // fs: lines 90 -> 89, branches 50 -> 49 but the floor 90 stays, functions 60 -> 59.
  assert.deepEqual(raised.floors["src/fs"], { lines: 89, branches: 90, functions: 59 });
  // core: lines 25 -> 24, branches 50 -> 49, functions 100 -> 99.
  assert.deepEqual(raised.floors["src/core"], { lines: 24, branches: 49, functions: 99 });
  // tools has nothing to measure, so no floor is set from it.
  assert.deepEqual(raised.floors["src/tools"], { lines: 0, branches: 0, functions: 0 });
  assert.equal(raised.tolerance, 1);
  assert.equal(raised.reportOnly, false);
  assert.deepEqual(config, snapshot);
  assert.deepEqual(raiseFloors(raised, totals), raised);
});

test("raiseFloors rounds the measured value down before the tolerance", () => {
  const totals = aggregateLcov(
    record(FS_A, { lf: 3, lh: 2, brf: 0, brh: 0, fnf: 0, fnh: 0 }),
    ["src/fs"],
  );
  const config = { gateNode: "22.x", tolerance: 0.5, reportOnly: true, floors: { "src/fs": { lines: 0, branches: 0, functions: 0 } } };
  // 66.67 -> 66 -> 65.5
  assert.equal(raiseFloors(config, totals).floors["src/fs"].lines, 65.5);
});

// A suite stand-in that returns `code` and, when lcovText is given, leaves that report under <root>/coverage like Node does.
function stubSuite(root, code, lcovText) {
  const calls = [];
  const runSuite = (suiteRoot) => {
    calls.push(suiteRoot);
    if (lcovText !== undefined) {
      writeText(join(suiteRoot, "coverage", "lcov.info"), lcovText);
    }
    return code;
  };
  return { calls, runSuite };
}

test("runCheck runs the suite, reads its lcov and returns 0 when every floor holds", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    writeText(floors, JSON.stringify(floorsConfig()));
    const suite = stubSuite(dir, 0, LCOV);
    const result = await runCheck(["--floors", floors], {
      root: dir,
      runSuite: suite.runSuite,
      listDistFiles: () => ["dist/src/fs/a.js", "dist/src/fs/deep/b.js", "dist/src/core/a.js"],
    });
    assert.equal(result.code, 0);
    assert.deepEqual(suite.calls, [dir]);
    assert.match(result.output, /directory +metric +actual% +floor% +status/);
    assert.match(result.output, /src\/fs +lines +90\.00 +50\.00 +ok/);
    assert.match(result.output, /src\/core +functions +100\.00 +100\.00 +ok/);
    assert.match(result.output, /coverage: ok/);
  });
});

test("runCheck prints the table of a failed suite run and still returns the suite's exit code", async () => {
  await withTempDir(async (dir) => {
    const passing = join(dir, "floors.json");
    const strict = join(dir, "strict.json");
    writeText(passing, JSON.stringify(floorsConfig()));
    writeText(
      strict,
      JSON.stringify(
        floorsConfig({ floors: { "src/fs": { lines: 99, branches: 0, functions: 0 }, "src/core": { lines: 0, branches: 0, functions: 0 } } }),
      ),
    );
    for (const floors of [passing, strict]) {
      const suite = stubSuite(dir, 3, LCOV);
      const result = await runCheck(["--floors", floors], {
        root: dir,
        runSuite: suite.runSuite,
        listDistFiles: () => ["dist/src/fs/a.js", "dist/src/fs/never.js"],
        readFile: () => RUNTIME_CODE,
      });
      assert.equal(result.code, 3);
      assert.match(result.output, /directory +metric +actual% +floor% +status/);
      assert.match(result.output, /src\/fs +lines +90\.00/);
      assert.match(result.output, / {2}src\/fs: dist\/src\/fs\/never\.js/);
      assert.match(result.output, /coverage: suite failed with exit code 3; the table above comes from that run/);
      assert.doesNotMatch(result.output, /coverage: (ok|FAILED|report-only run)/);
    }
  });
});

test("runCheck returns the suite's exit code with a message when a failed suite wrote no lcov report", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    writeText(floors, JSON.stringify(floorsConfig()));
    let listed = false;
    const suite = stubSuite(dir, 3, undefined);
    const result = await runCheck(["--floors", floors], {
      root: dir,
      runSuite: suite.runSuite,
      listDistFiles: () => {
        listed = true;
        return [];
      },
    });
    assert.equal(result.code, 3);
    assert.equal(listed, false);
    assert.match(result.output, /test suite failed with exit code 3 and wrote no lcov report; coverage was not compared/);
    assert.doesNotMatch(result.output, /directory +metric/);
  });
});

test("runCheck returns the suite's exit code when a failed suite left an unreadable lcov report", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    writeText(floors, JSON.stringify(floorsConfig()));
    const suite = stubSuite(dir, 3, "SF:<ws>/dist/src/fs/a.js\n");
    const result = await runCheck(["--floors", floors], { root: dir, runSuite: suite.runSuite, listDistFiles: () => [] });
    assert.equal(result.code, 3);
    assert.match(result.output, /no end_of_record/);
  });
});

test("isTypeOnlyModule is true only for compiled output without statements", () => {
  assert.equal(isTypeOnlyModule(""), true);
  assert.equal(isTypeOnlyModule("\n  \n"), true);
  assert.equal(isTypeOnlyModule("// only a line comment\n/* and a\n block comment */\n"), true);
  assert.equal(isTypeOnlyModule("export {};\n//# sourceMappingURL=ports.js.map\n"), true);
  assert.equal(isTypeOnlyModule("/** Ports. */\nexport {};\n"), true);
  assert.equal(isTypeOnlyModule("const x = 1;\n"), false);
  assert.equal(isTypeOnlyModule("// types erased\nexport function run() {\n  return 1;\n}\n//# sourceMappingURL=a.js.map\n"), false);
  assert.equal(isTypeOnlyModule("export {};\nconst x = 1;\n"), false);
  assert.equal(isTypeOnlyModule('const url = "http://example.invalid/*";\n'), false);
});

test("runCheck does not report an unrecorded type-only module and reports one with code", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    const lcov = join(dir, "report.info");
    writeText(floors, JSON.stringify(floorsConfig()));
    writeText(lcov, LCOV);
    const sources = new Map([
      [join(dir, "dist/src/core/ports.js"), "export {};\n//# sourceMappingURL=ports.js.map\n"],
      [join(dir, "dist/src/core/orphan.js"), "export function orphan() {\n  return 1;\n}\n"],
    ]);
    const run = (argv) =>
      runCheck(argv, {
        root: dir,
        listDistFiles: () => ["dist/src/core/a.js", "dist/src/core/ports.js", "dist/src/core/orphan.js"],
        readFile: (path) => {
          const source = sources.get(path);
          assert.notEqual(source, undefined, `unexpected read of ${path}`);
          return source;
        },
      });

    const enforced = await run(["--floors", floors, "--lcov", lcov]);
    assert.equal(enforced.code, 1);
    assert.match(enforced.output, /type-only modules without runtime code: 1\n/);
    assert.match(enforced.output, / {2}src\/core: dist\/src\/core\/orphan\.js/);
    assert.doesNotMatch(enforced.output, /ports\.js/);
    assert.match(enforced.output, /coverage: FAILED \(0 metric\(s\) below a floor, 1 unloaded file\(s\)\)/);
  });
});

test("runCheck passes an enforced run when the only unrecorded file is type-only", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    const lcov = join(dir, "report.info");
    writeText(floors, JSON.stringify(floorsConfig()));
    writeText(lcov, LCOV);
    const result = await runCheck(["--floors", floors, "--lcov", lcov], {
      root: dir,
      listDistFiles: () => ["dist/src/core/a.js", "dist/src/core/ports.js"],
      readFile: () => "export {};\n",
    });
    assert.equal(result.code, 0);
    assert.match(result.output, /type-only modules without runtime code: 1\n/);
    assert.doesNotMatch(result.output, /unloaded \(no test imports/);
    assert.match(result.output, /coverage: ok/);
  });
});

test("runCheck with --lcov evaluates the file without running the suite and lists unloaded files", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    const lcov = join(dir, "report.info");
    const allThree = {
      "src/fs": { lines: 0, branches: 0, functions: 0 },
      "src/core": { lines: 0, branches: 0, functions: 0 },
      "src/tools": { lines: 0, branches: 0, functions: 0 },
    };
    writeText(floors, JSON.stringify(floorsConfig({ reportOnly: true, floors: allThree })));
    writeText(lcov, LCOV);
    const result = await runCheck(["--floors", floors, "--lcov", lcov], {
      root: dir,
      runSuite: () => assert.fail("the suite must not run with --lcov"),
      listDistFiles: () => ["dist/src/fs/a.js", "dist/src/fs/never-imported.js"],
      readFile: () => RUNTIME_CODE,
    });
    assert.equal(result.code, 0);
    assert.match(result.output, /unloaded \(no test imports these/);
    assert.match(result.output, / {2}src\/fs: dist\/src\/fs\/never-imported\.js/);
    assert.match(result.output, /no lcov records for src\/tools/);
    assert.match(result.output, /coverage: report-only run, no floor enforced \(0 metric\(s\) below a floor, 1 unloaded file\(s\)\)/);
  });
});

test("runCheck returns 0 below a floor in report-only mode and 1 otherwise", async () => {
  await withTempDir(async (dir) => {
    const lcov = join(dir, "report.info");
    writeText(lcov, LCOV);
    const strict = { "src/fs": { lines: 99, branches: 0, functions: 0 }, "src/core": { lines: 0, branches: 0, functions: 0 } };
    const enforced = join(dir, "enforced.json");
    const reportOnly = join(dir, "report-only.json");
    writeText(enforced, JSON.stringify(floorsConfig({ floors: strict })));
    writeText(reportOnly, JSON.stringify(floorsConfig({ floors: strict, reportOnly: true })));
    const overrides = { root: dir, listDistFiles: () => [] };

    const failing = await runCheck(["--floors", enforced, "--lcov", lcov], overrides);
    assert.equal(failing.code, 1);
    assert.match(failing.output, /src\/fs +lines +90\.00 +99\.00 +below/);
    assert.match(failing.output, /coverage: FAILED \(1 metric\(s\) below a floor/);

    const reporting = await runCheck(["--floors", reportOnly, "--lcov", lcov], overrides);
    assert.equal(reporting.code, 0);
    assert.match(reporting.output, /src\/fs +lines +90\.00 +99\.00 +report/);

    const forced = await runCheck(["--floors", enforced, "--lcov", lcov, "--report-only"], overrides);
    assert.equal(forced.code, 0);
    assert.match(forced.output, /report-only run/);
  });
});

test("runCheck fails an enforced run for an unloaded file even when every floor holds", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    const lcov = join(dir, "report.info");
    writeText(floors, JSON.stringify(floorsConfig()));
    writeText(lcov, LCOV);
    const result = await runCheck(["--floors", floors, "--lcov", lcov], {
      root: dir,
      listDistFiles: () => ["dist/src/core/never.js"],
      readFile: () => RUNTIME_CODE,
    });
    assert.equal(result.code, 1);
    assert.match(result.output, / {2}src\/core: dist\/src\/core\/never\.js/);
    assert.match(result.output, /coverage: FAILED \(0 metric\(s\) below a floor, 1 unloaded file\(s\)\)/);
  });
});

test("runCheck --write raises the floors file, prints what rose and keeps reportOnly", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    const lcov = join(dir, "report.info");
    writeText(
      floors,
      JSON.stringify(
        floorsConfig({
          reportOnly: true,
          floors: { "src/fs": { lines: 0, branches: 95, functions: 0 }, "src/core": { lines: 0, branches: 0, functions: 0 } },
        }),
      ),
    );
    writeText(lcov, LCOV);
    const result = await runCheck(["--floors", floors, "--lcov", lcov, "--write"], { root: dir, listDistFiles: () => [] });
    assert.equal(result.code, 0);
    assert.match(result.output, /floors raised:/);
    assert.match(result.output, / {2}src\/fs lines: 0 -> 89/);
    assert.doesNotMatch(result.output, /src\/fs branches/);
    const written = JSON.parse(readFileSync(floors, "utf8"));
    assert.deepEqual(written.floors, {
      "src/fs": { lines: 89, branches: 95, functions: 59 },
      "src/core": { lines: 24, branches: 49, functions: 99 },
    });
    assert.equal(written.reportOnly, true);
    assert.equal(written.tolerance, 1);

    const again = await runCheck(["--floors", floors, "--lcov", lcov, "--write"], { root: dir, listDistFiles: () => [] });
    assert.match(again.output, /floors unchanged/);
  });
});

test("runCheck --write does not touch the floors file when the suite fails", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    const original = JSON.stringify(floorsConfig());
    writeText(floors, original);
    const suite = stubSuite(dir, 1, LCOV);
    const result = await runCheck(["--floors", floors, "--write"], {
      root: dir,
      runSuite: suite.runSuite,
      listDistFiles: () => [],
    });
    assert.equal(result.code, 1);
    assert.match(result.output, /floors not written: the suite failed in this run/);
    assert.equal(readFileSync(floors, "utf8"), original);
  });
});

test("runCheck returns 2 for usage, floors file and lcov errors", async () => {
  await withTempDir(async (dir) => {
    const floors = join(dir, "floors.json");
    const badFloors = join(dir, "bad.json");
    const notJson = join(dir, "not-json.json");
    const brokenLcov = join(dir, "broken.info");
    writeText(floors, JSON.stringify(floorsConfig()));
    writeText(badFloors, JSON.stringify(floorsConfig({ tolerance: -5 })));
    writeText(notJson, "{");
    writeText(brokenLcov, "SF:<ws>/dist/src/fs/a.js\n");
    const overrides = {
      root: dir,
      runSuite: () => assert.fail("the suite must not run after a usage or config error"),
      listDistFiles: () => [],
    };
    const cases = [
      [["--nope"], /unknown argument "--nope"; usage:/],
      [["positional"], /unknown argument "positional"/],
      [["--lcov"], /--lcov needs a value/],
      [["--floors", "--write"], /--floors needs a value/],
      [["--report-only", "--report-only"], /--report-only given more than once/],
      [["--floors", floors, "--floors", floors], /--floors given more than once/],
      [["--floors", join(dir, "missing.json")], /cannot read floors file/],
      [["--floors", notJson], /cannot read floors file/],
      [["--floors", badFloors], /"tolerance" must be a number >= 0/],
      [["--floors", floors, "--lcov", join(dir, "missing.info")], /cannot read lcov file/],
      [["--floors", floors, "--lcov", brokenLcov], /no end_of_record/],
    ];
    for (const [argv, pattern] of cases) {
      const result = await runCheck(argv, overrides);
      assert.equal(result.code, 2, argv.join(" "));
      assert.match(result.output, pattern, argv.join(" "));
    }
  });
});

test("the committed floors file is valid and every floor is a number", () => {
  const committed = JSON.parse(readFileSync(new URL("./coverage-floors.json", import.meta.url), "utf8"));
  validateConfig(committed);
  assert.deepEqual(Object.keys(committed.floors), DIRECTORIES);
});
