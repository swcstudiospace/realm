import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageNotFoundError } from "../check/verify-image-digests.mjs";
import { main, parseArgs } from "./build-image.mjs";

const REVISION = "a".repeat(40);
const CARGO_LOCK = "b".repeat(64);
const RUNTIME = "c".repeat(64);
const RUNNER = "d".repeat(64);
const PROBE = "e".repeat(64);

function fixture() {
  return {
    schema: 1,
    openshellRevision: REVISION,
    cargoLockSha256: CARGO_LOCK,
    runtime: { path: "/usr/local/lib/realm/openshell-sandbox", sha256: RUNTIME },
    agentosRunner: { path: "/usr/local/lib/realm/agentos-runner.js", sha256: RUNNER },
    agentosProbe: { path: "/usr/local/lib/realm/agentos-probe.js", sha256: PROBE },
  };
}

// Runs body with a temp directory holding the digests file and with console output captured.
function withHarness(body, text = JSON.stringify(fixture())) {
  const dir = mkdtempSync(join(tmpdir(), "realm-build-image-"));
  const expected = join(dir, "expected-digests.json");
  writeFileSync(expected, text);
  try {
    return body({ dir, expected });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fakeIo({ buildFails = false, findings = [], verifyThrows = null } = {}) {
  const calls = { build: [], verify: [] };
  return {
    calls,
    io: {
      build(command, args, cwd) {
        calls.build.push({ command, args, cwd });
        if (buildFails) {
          throw new Error("build failed");
        }
      },
      verify(ref, expected, command) {
        calls.verify.push({ ref, expected, command });
        if (verifyThrows !== null) {
          throw verifyThrows;
        }
        return findings;
      },
    },
  };
}

function capture(context) {
  const output = { out: [], err: [] };
  context.mock.method(console, "log", (line) => {
    output.out.push(line);
  });
  context.mock.method(console, "error", (line) => {
    output.err.push(line);
  });
  return output;
}

test("parseArgs applies the defaults and reads every option", () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.tag, "localhost/realm-agentos:build");
  assert.equal(defaults.podman, "podman");
  assert.match(defaults.expected, /sandbox[\\/]expected-digests\.json$/);
  assert.deepEqual(parseArgs(["--tag", "t:1", "--context", "c", "--expected", "e.json", "--podman", "p"]), {
    tag: "t:1",
    context: "c",
    expected: "e.json",
    podman: "p",
  });
  assert.throws(() => parseArgs(["--tag"]), /--tag needs a value/);
  assert.throws(() => parseArgs(["--bogus", "x"]), /unknown argument --bogus/);
});

test("a clean run builds with the exact argv taken from the digests file and exits 0", (context) => {
  const output = capture(context);
  withHarness(({ dir, expected }) => {
    const { calls, io } = fakeIo();
    const code = main(["--expected", expected, "--context", dir, "--tag", "realm:t", "--podman", "podman-x"], io);
    assert.equal(code, 0);
    assert.equal(calls.build.length, 1);
    assert.equal(calls.build[0].command, "podman-x");
    assert.equal(calls.build[0].cwd, dir);
    assert.deepEqual(calls.build[0].args, [
      "build",
      "-f",
      "sandbox/Dockerfile",
      "--build-arg",
      `RUNTIME_SHA256=${RUNTIME}`,
      "--build-arg",
      `CARGO_LOCK_SHA256=${CARGO_LOCK}`,
      "--build-arg",
      `AGENTOS_RUNNER_SHA256=${RUNNER}`,
      "--build-arg",
      `AGENTOS_PROBE_SHA256=${PROBE}`,
      "--build-arg",
      `OPENSHELL_REVISION=${REVISION}`,
      "-t",
      "realm:t",
      dir,
    ]);
    assert.equal(calls.verify.length, 1);
    assert.equal(calls.verify[0].ref, "realm:t");
    assert.equal(calls.verify[0].command, "podman-x");
    assert.equal(calls.verify[0].expected.runtime.sha256, RUNTIME);
  });
  assert.deepEqual(output.err, []);
  assert.deepEqual(output.out, ["build:image: ok (realm:t)"]);
});

test("a malformed digests file exits 2 before any podman call", (context) => {
  const output = capture(context);
  for (const text of ["not json", JSON.stringify({ ...fixture(), runtime: { path: "/x", sha256: "ABC" } })]) {
    withHarness(({ expected }) => {
      const { calls, io } = fakeIo();
      assert.equal(main(["--expected", expected], io), 2);
      assert.deepEqual(calls, { build: [], verify: [] });
    }, text);
  }
  assert.equal(output.err.length, 2);
});

test("an unreadable digests file and bad arguments exit 2 before any podman call", (context) => {
  capture(context);
  withHarness(({ dir }) => {
    const { calls, io } = fakeIo();
    assert.equal(main(["--expected", join(dir, "absent.json")], io), 2);
    assert.equal(main(["--unknown", "x"], io), 2);
    assert.deepEqual(calls, { build: [], verify: [] });
  });
});

test("a build failure exits 2 and skips verification", (context) => {
  const output = capture(context);
  withHarness(({ expected }) => {
    const { calls, io } = fakeIo({ buildFails: true });
    assert.equal(main(["--expected", expected, "--tag", "realm:t"], io), 2);
    assert.equal(calls.build.length, 1);
    assert.deepEqual(calls.verify, []);
  });
  assert.deepEqual(output.err, ["build:image: podman build of realm:t failed"]);
});

test("a verification finding exits 1 and names the entry with short digests only", (context) => {
  const output = capture(context);
  withHarness(({ expected }) => {
    const { io } = fakeIo({
      findings: [{ name: "runtime", kind: "mismatch", expected: RUNTIME, actual: "f".repeat(64) }],
    });
    assert.equal(main(["--expected", expected], io), 1);
  });
  assert.deepEqual(output.err, [
    `build:image: runtime: mismatch (expected ${"c".repeat(12)}, actual ${"f".repeat(12)})`,
  ]);
  assert.deepEqual(output.out, []);
});

test("an image that cannot be verified after the build exits 2", (context) => {
  const output = capture(context);
  withHarness(({ expected }) => {
    const { io } = fakeIo({ verifyThrows: new ImageNotFoundError("realm:t") });
    assert.equal(main(["--expected", expected, "--tag", "realm:t"], io), 2);
  });
  assert.match(output.err[0], /image realm:t is not in local podman storage/);
});

test("no argument is joined into a shell string: hostile values stay single argv elements", (context) => {
  capture(context);
  const tag = "realm:t; rm -rf / && echo $(id)";
  withHarness(({ dir, expected }) => {
    const { calls, io } = fakeIo();
    assert.equal(main(["--expected", expected, "--tag", tag, "--context", dir, "--podman", "podman x"], io), 0);
    const [call] = calls.build;
    assert.equal(call.command, "podman x");
    assert.ok(Array.isArray(call.args));
    assert.ok(call.args.every((argument) => typeof argument === "string"));
    assert.equal(call.args[call.args.indexOf("-t") + 1], tag);
    assert.equal(call.args.at(-1), dir);
  });
});
