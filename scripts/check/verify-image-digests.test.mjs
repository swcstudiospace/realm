import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  ImageNotFoundError,
  compareDirectory,
  compareLabels,
  formatFinding,
  parseArgs,
  parseExpected,
  verifyImage,
} from "./verify-image-digests.mjs";

const REVISION = "a".repeat(40);
const CARGO_LOCK = "b".repeat(64);

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
        throw new Error("no such file");
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
