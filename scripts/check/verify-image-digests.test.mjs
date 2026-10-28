import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ImageNotFoundError,
  ImageReadError,
  compareDirectory,
  compareLabels,
  formatFinding,
  parseArgs,
  parseExpected,
  verifyImage,
} from "./verify-image-digests.mjs";

const REVISION = "a".repeat(40);
const CARGO_LOCK = "b".repeat(64);
const SCRIPT = fileURLToPath(new URL("./verify-image-digests.mjs", import.meta.url));

const FILES = {
  runtime: { path: "usr/local/lib/realm/openshell-sandbox", content: "runtime bytes" },
  agentosRunner: { path: "usr/local/lib/realm/agentos-runner.js", content: "runner bytes" },
  agentosProbe: { path: "usr/local/lib/realm/agentos-probe.js", content: "probe bytes" },
};

function digest(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fixtureJson() {
  const entry = (file) => ({ path: file.path, sha256: digest(file.content) });
  return {
    schema: 1,
    openshellRevision: REVISION,
    cargoLockSha256: CARGO_LOCK,
    runtime: entry(FILES.runtime),
    agentosRunner: entry(FILES.agentosRunner),
    agentosProbe: entry(FILES.agentosProbe),
  };
}

function writeTree(dir, overrides = {}) {
  for (const [name, file] of Object.entries(FILES)) {
    if (overrides[name] === null) {
      continue;
    }
    const target = join(dir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, overrides[name] ?? file.content);
  }
}

function withTempDir(body) {
  const dir = mkdtempSync(join(tmpdir(), "realm-verify-digests-"));
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("compareDirectory returns no findings when every file matches", () => {
  withTempDir((dir) => {
    writeTree(dir);
    assert.deepEqual(compareDirectory(parseExpected(JSON.stringify(fixtureJson())), dir), []);
  });
});

test("compareDirectory reports a changed file as a mismatch with 12-character prefixes only", () => {
  withTempDir((dir) => {
    writeTree(dir, { agentosRunner: "tampered runner" });
    const findings = compareDirectory(parseExpected(JSON.stringify(fixtureJson())), dir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].name, "agentosRunner");
    assert.equal(findings[0].kind, "mismatch");
    const line = formatFinding(findings[0]);
    assert.ok(line.includes(digest(FILES.agentosRunner.content).slice(0, 12)));
    assert.ok(line.includes(digest("tampered runner").slice(0, 12)));
    assert.ok(!line.includes(digest("tampered runner")));
  });
});

test("compareDirectory reports an absent file as missing", () => {
  withTempDir((dir) => {
    writeTree(dir, { runtime: null });
    const findings = compareDirectory(parseExpected(JSON.stringify(fixtureJson())), dir);
    assert.deepEqual(
      findings.map((finding) => [finding.name, finding.kind]),
      [["runtime", "missing"]],
    );
    assert.match(formatFinding(findings[0]), /actual none/);
  });
});

test("parseExpected rejects malformed JSON and every invalid field", () => {
  assert.throws(() => parseExpected("{not json"), /not valid JSON/);
  assert.throws(() => parseExpected("[]"), /JSON object/);
  assert.throws(() => parseExpected(JSON.stringify({ ...fixtureJson(), schema: 2 })), /schema must be 1/);
  assert.throws(
    () => parseExpected(JSON.stringify({ ...fixtureJson(), openshellRevision: "abc" })),
    /openshellRevision/,
  );
  assert.throws(
    () => parseExpected(JSON.stringify({ ...fixtureJson(), cargoLockSha256: "ABC" })),
    /cargoLockSha256/,
  );
  assert.throws(
    () => parseExpected(JSON.stringify({ ...fixtureJson(), runtime: { path: "../etc/passwd", sha256: CARGO_LOCK } })),
    /runtime\.path/,
  );
  assert.throws(
    () => parseExpected(JSON.stringify({ ...fixtureJson(), agentosProbe: { path: "x", sha256: "short" } })),
    /agentosProbe\.sha256/,
  );
  const { agentosRunner, ...withoutRunner } = fixtureJson();
  assert.ok(agentosRunner);
  assert.throws(() => parseExpected(JSON.stringify(withoutRunner)), /agentosRunner/);
});

test("compareLabels reports an absent and a differing label", () => {
  const expected = parseExpected(JSON.stringify(fixtureJson()));
  const labels = {
    "io.realm.openshell.revision": REVISION,
    "io.realm.runtime.sha256": digest(FILES.runtime.content),
    "io.realm.cargo-lock.sha256": "c".repeat(64),
    "io.realm.agentos.runner.sha256": digest(FILES.agentosRunner.content),
  };
  assert.deepEqual(
    compareLabels(expected, labels).map((finding) => [finding.name, finding.kind]),
    [
      ["io.realm.cargo-lock.sha256", "mismatch"],
      ["io.realm.agentos.probe.sha256", "missing"],
    ],
  );
});

test("parseArgs requires exactly one of --dir and --image", () => {
  assert.throws(() => parseArgs([]), /exactly one/);
  assert.throws(() => parseArgs(["--dir", "a", "--image", "b"]), /exactly one/);
  assert.throws(() => parseArgs(["--dir"]), /needs a value/);
  assert.throws(() => parseArgs(["--bogus", "x"]), /unknown argument/);
  assert.equal(parseArgs(["--dir", "built"]).dir, "built");
  assert.equal(parseArgs(["--image", "realm:test"]).image, "realm:test");
});

function fakePodman(files, labels, calls) {
  return (args) => {
    calls.push(args[0]);
    if (args[0] === "create") {
      return "container-1\n";
    }
    if (args[0] === "cp") {
      const [, path] = args[1].split(":");
      const file = Object.values(files).find((candidate) => `/${candidate.path}` === path);
      if (file === undefined || file.content === null) {
        throw Object.assign(new Error("Command failed: podman cp"), {
          status: 125,
          stderr: ABSENT_STDERR(path),
        });
      }
      writeFileSync(args[2], file.content);
      return "";
    }
    if (args[0] === "image") {
      return JSON.stringify(labels);
    }
    return "";
  };
}

function matchingLabels() {
  return {
    "io.realm.openshell.revision": REVISION,
    "io.realm.runtime.sha256": digest(FILES.runtime.content),
    "io.realm.cargo-lock.sha256": CARGO_LOCK,
    "io.realm.agentos.runner.sha256": digest(FILES.agentosRunner.content),
    "io.realm.agentos.probe.sha256": digest(FILES.agentosProbe.content),
  };
}

function imageFiles() {
  return Object.fromEntries(Object.entries(FILES).map(([name, file]) => [name, { ...file }]));
}

// The digests file names in-image absolute paths, as the real file does.
function imageExpected() {
  const json = fixtureJson();
  for (const name of ["runtime", "agentosRunner", "agentosProbe"]) {
    json[name].path = `/${json[name].path}`;
  }
  return parseExpected(JSON.stringify(json));
}

test("verifyImage copies the files out of the image, compares labels, and removes the container", () => {
  const calls = [];
  assert.deepEqual(verifyImage("realm:test", imageExpected(), fakePodman(imageFiles(), matchingLabels(), calls)), []);
  assert.equal(calls[1], "create");
  assert.equal(calls.at(-1), "image");
  assert.ok(calls.includes("rm"));
});

test("verifyImage reports a file absent from the image and still removes the container", () => {
  const files = imageFiles();
  files.agentosProbe.content = null;
  const calls = [];
  const findings = verifyImage("realm:test", imageExpected(), fakePodman(files, matchingLabels(), calls));
  assert.deepEqual(
    findings.map((finding) => [finding.name, finding.kind]),
    [["agentosProbe", "missing"]],
  );
  assert.ok(calls.includes("rm"));
});

test("verifyImage never lets podman pull: create carries --pull=never and follows an existence check", () => {
  const argvs = [];
  const inner = fakePodman(imageFiles(), matchingLabels(), []);
  const run = (args) => {
    argvs.push(args);
    return inner(args);
  };
  assert.deepEqual(verifyImage("realm:test", imageExpected(), run), []);
  assert.deepEqual(argvs[0], ["image", "exists", "realm:test"]);
  assert.deepEqual(argvs[1], ["create", "--pull=never", "--entrypoint", "/bin/true", "realm:test"]);
});

test("verifyImage names a missing local image, which differs from a file missing in the image", () => {
  const argvs = [];
  const run = (args) => {
    argvs.push(args);
    throw Object.assign(new Error("exit 1"), { status: 1 });
  };
  assert.throws(
    () => verifyImage("realm:absent", imageExpected(), run),
    (error) =>
      error instanceof ImageNotFoundError &&
      /image realm:absent is not in local podman storage/.test(error.message),
  );
  assert.equal(argvs.length, 1);
  const files = imageFiles();
  files.agentosProbe.content = null;
  const [finding] = verifyImage("realm:test", imageExpected(), fakePodman(files, matchingLabels(), []));
  assert.doesNotMatch(formatFinding(finding), /podman storage/);
});

test("verifyImage rethrows a podman failure that is not an absent image", () => {
  const run = () => {
    throw Object.assign(new Error("podman broke"), { status: 125 });
  };
  assert.throws(
    () => verifyImage("realm:test", imageExpected(), run),
    (error) => !(error instanceof ImageNotFoundError) && error.message === "podman broke",
  );
});

test("verifyImage keeps its findings when the container removal fails and reports the failure on stderr", (context) => {
  const lines = [];
  context.mock.method(console, "error", (line) => {
    lines.push(line);
  });
  const files = imageFiles();
  files.agentosProbe.content = null;
  const inner = fakePodman(files, matchingLabels(), []);
  const run = (args) => {
    if (args[0] === "rm") {
      throw new Error("rm failed");
    }
    return inner(args);
  };
  const findings = verifyImage("realm:test", imageExpected(), run);
  assert.deepEqual(
    findings.map((finding) => [finding.name, finding.kind]),
    [["agentosProbe", "missing"]],
  );
  assert.deepEqual(lines, ["check:image-digests: could not remove scratch container container-1"]);
});

// The stderr podman prints for a path that is absent from the container filesystem, as measured.
const ABSENT_STDERR = (path) =>
  `Error: "${path}" could not be found on container container-1: no such file or directory\n`;
// The stderr podman prints when the host destination cannot be written, as measured.
const UNWRITABLE_STDERR = "Error: 1 error occurred:\n\t* copying to host: open /unwritable/host/dest: permission denied\n\n";

function failingCopy(stderr) {
  const inner = fakePodman(imageFiles(), matchingLabels(), []);
  return (args) => {
    if (args[0] === "cp") {
      throw Object.assign(new Error("Command failed: podman cp"), { status: 125, stderr });
    }
    return inner(args);
  };
}

test("verifyImage treats a copy failure that is not an absent file as a read failure and removes the container", () => {
  for (const stderr of [UNWRITABLE_STDERR, "", "Error: something else entirely\n"]) {
    const calls = [];
    const run = failingCopy(stderr);
    const recording = (args) => {
      calls.push(args[0]);
      return run(args);
    };
    assert.throws(
      () => verifyImage("realm:test", imageExpected(), recording),
      (error) =>
        error instanceof ImageReadError &&
        error.message === "could not copy runtime out of the image" &&
        !error.message.includes("unwritable"),
    );
    assert.ok(calls.includes("rm"));
  }
});

test("verifyImage counts only the no-such-file stderr of podman as a missing file, ignoring case", () => {
  const findings = verifyImage(
    "realm:test",
    imageExpected(),
    failingCopy(ABSENT_STDERR("/usr/local/lib/realm/x").toUpperCase()),
  );
  assert.deepEqual(
    findings.filter((finding) => finding.kind === "missing").map((finding) => finding.name),
    ["runtime", "agentosRunner", "agentosProbe"],
  );
});

test("parseArgs refuses an --image value that podman would read as an option", () => {
  assert.throws(() => parseArgs(["--image", "--rm"]), /--image must be an image reference/);
  assert.throws(() => parseArgs(["--image", "-x"]), /--image must be an image reference/);
  assert.equal(parseArgs(["--dir", "-built"]).dir, "-built");
});

// Runs the script with a fake `podman` first on PATH. The fake is a node script that answers by mode.
function runScript(args, mode) {
  const dir = mkdtempSync(join(tmpdir(), "realm-verify-digests-cli-"));
  try {
    const bin = join(dir, "podman");
    writeFileSync(
      bin,
      [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        "const mode = process.env.FAKE_PODMAN_MODE;",
        'if (args[0] === "create") { console.log("container-1"); }',
        'else if (args[0] === "cp") {',
        '  if (mode === "absent") { process.stderr.write(`Error: "${args[1]}" could not be found on container container-1: no such file or directory\\n`); process.exit(125); }',
        '  if (mode === "unwritable") { process.stderr.write("Error: 1 error occurred:\\n\\t* copying to host: open /unwritable/host/dest: permission denied\\n\\n"); process.exit(125); }',
        "  process.exit(1);",
        '} else if (args[0] === "image" && args[1] === "inspect") { console.log("{}"); }',
        "",
      ].join("\n"),
    );
    chmodSync(bin, 0o755);
    const expected = join(dir, "expected-digests.json");
    writeFileSync(expected, JSON.stringify(fixtureJson()));
    const result = spawnSync(process.execPath, [SCRIPT, ...args(expected)], {
      encoding: "utf8",
      env: { PATH: `${dir}${delimiter}${dirname(process.execPath)}`, FAKE_PODMAN_MODE: mode },
      timeout: 30_000,
    });
    return { status: result.status, stderr: result.stderr, dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the script exits 1 with the finding when podman reports the file absent from the image", () => {
  const result = runScript((expected) => ["--image", "realm:test", "--expected", expected], "absent");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /check:image-digests: runtime: missing \(expected [0-9a-f]{12}, actual none\)/);
});

test("the script exits 2 naming the entry when the host destination is unwritable", () => {
  const result = runScript((expected) => ["--image", "realm:test", "--expected", expected], "unwritable");
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "check:image-digests: could not copy runtime out of the image\n");
});

test("the script exits 2 when podman cp fails with an empty stderr, as a timeout does", () => {
  const result = runScript((expected) => ["--image", "realm:test", "--expected", expected], "silent");
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "check:image-digests: could not copy runtime out of the image\n");
});

test("the script exits 2 for an --image value starting with a dash, without calling podman", () => {
  const result = runScript((expected) => ["--image", "--rm", "--expected", expected], "absent");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--image must be an image reference/);
});
