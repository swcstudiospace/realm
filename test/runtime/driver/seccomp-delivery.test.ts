import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../../src/core/errors.js";
import { startDriver, type DriverProcessConfig } from "../../../src/runtime/driver/main.js";
import { installSeccompProfile, SECCOMP_DIRECTORY_NAME } from "../../../src/runtime/driver/seccomp-delivery.js";
import { SECCOMP_PROFILE_FILE_NAME, SECCOMP_PROFILE_TEXT } from "../../../src/runtime/driver/seccomp-profile.js";
import { driverConfig } from "./fakes.js";

const PRIVATE_BITS = 0o077;

interface Layout {
  readonly base: string;
  readonly parent: string;
  readonly socketPath: string;
  readonly directory: string;
  readonly file: string;
}

// A temporary tree whose driver socket path is <base>/run/driver.sock. Nothing exists below the base yet.
function layoutFor(t: TestContext): Layout {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-seccomp-delivery-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const parent = join(base, "run");
  const directory = join(parent, SECCOMP_DIRECTORY_NAME);
  return { base, parent, socketPath: join(parent, "driver.sock"), directory, file: join(directory, SECCOMP_PROFILE_FILE_NAME) };
}

// Every entry under the base, relative to it, sorted.
function treeOf(layout: Layout): readonly string[] {
  return readdirSync(layout.base, { recursive: true, encoding: "utf8" }).sort();
}

function refusedWithSchemaInvalid(layout: Layout): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof RealmError &&
    error.code === "SCHEMA_INVALID" &&
    !error.message.includes(layout.base) &&
    !error.reason.includes(layout.base);
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

void test("phase 9.6: the driver writes the profile text to realm-seccomp-<digest16>.json in a seccomp directory beside its socket", (t) => {
  const layout = layoutFor(t);
  const path = installSeccompProfile(layout.socketPath);
  assert.equal(path, layout.file);
  assert.equal(readFileSync(layout.file, "utf8"), SECCOMP_PROFILE_TEXT);
  assert.equal(modeOf(layout.parent), 0o700, "the socket's parent is user-only");
  assert.equal(modeOf(layout.directory), 0o700, "the profile directory is user-only");
  assert.equal(modeOf(layout.file) & PRIVATE_BITS, 0, "the file grants nothing to the group or others");
});

void test("phase 9.6: the install writes nothing outside the profile directory and its parent, and leaves no temporary file", (t) => {
  const layout = layoutFor(t);
  installSeccompProfile(layout.socketPath);
  assert.deepEqual(treeOf(layout), ["run", `run/${SECCOMP_DIRECTORY_NAME}`, `run/${SECCOMP_DIRECTORY_NAME}/${SECCOMP_PROFILE_FILE_NAME}`]);
  assert.deepEqual(readdirSync(layout.directory), [SECCOMP_PROFILE_FILE_NAME]);
});

void test("phase 9.6: a second start with the same file is idempotent and does not rewrite it", (t) => {
  const layout = layoutFor(t);
  installSeccompProfile(layout.socketPath);
  const before = statSync(layout.file);
  assert.equal(installSeccompProfile(layout.socketPath), layout.file);
  const after = statSync(layout.file);
  assert.equal(after.ino, before.ino, "the same file, not a replacement");
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(readFileSync(layout.file, "utf8"), SECCOMP_PROFILE_TEXT);
  assert.equal(readdirSync(layout.directory).length, 1);
});

void test("phase 9.6: a file of the profile's name with other content is refused and left byte for byte as found", (t) => {
  const layout = layoutFor(t);
  installSeccompProfile(layout.socketPath);
  const tampered = [
    SECCOMP_PROFILE_TEXT.replace('"SCMP_ACT_ERRNO"', '"SCMP_ACT_ALLOW"'),
    `${SECCOMP_PROFILE_TEXT}\n`,
    SECCOMP_PROFILE_TEXT.slice(0, -1),
    "",
    "not a profile",
  ];
  for (const content of tampered) {
    writeFileSync(layout.file, content);
    const before = statSync(layout.file);
    assert.throws(() => installSeccompProfile(layout.socketPath), refusedWithSchemaInvalid(layout));
    assert.equal(readFileSync(layout.file, "utf8"), content, "the file is not overwritten");
    assert.equal(statSync(layout.file).ino, before.ino);
    assert.deepEqual(readdirSync(layout.directory), [SECCOMP_PROFILE_FILE_NAME], "no temporary file is left behind");
  }
});

void test("phase 9.6: a profile directory that is a symbolic link is refused and never followed", (t) => {
  const layout = layoutFor(t);
  const elsewhere = join(layout.base, "elsewhere");
  mkdirSync(layout.parent, { mode: 0o700 });
  mkdirSync(elsewhere, { mode: 0o700 });
  symlinkSync(elsewhere, layout.directory);
  assert.throws(() => installSeccompProfile(layout.socketPath), refusedWithSchemaInvalid(layout));
  assert.deepEqual(readdirSync(elsewhere), [], "nothing is written through the link");
});

void test("phase 9.6: a profile directory that is not a directory is refused", (t) => {
  const layout = layoutFor(t);
  mkdirSync(layout.parent, { mode: 0o700 });
  writeFileSync(layout.directory, "not a directory");
  assert.throws(() => installSeccompProfile(layout.socketPath), refusedWithSchemaInvalid(layout));
  assert.equal(readFileSync(layout.directory, "utf8"), "not a directory");
});

void test("phase 9.6: a profile directory the group or others can write is refused, and nothing is written into it", (t) => {
  for (const mode of [0o770, 0o707, 0o777, 0o720, 0o702]) {
    const layout = layoutFor(t);
    mkdirSync(layout.parent, { mode: 0o700 });
    mkdirSync(layout.directory);
    chmodSync(layout.directory, mode);
    assert.throws(() => installSeccompProfile(layout.socketPath), refusedWithSchemaInvalid(layout), mode.toString(8));
    assert.deepEqual(readdirSync(layout.directory), [], `nothing is written when the directory is ${mode.toString(8)}`);
    assert.equal(modeOf(layout.directory), mode, "the refused directory is left as found");
  }
});

void test("phase 9.6: a profile directory owned by another account is refused (checked when the tests run as root)", { skip: process.getuid?.() !== 0 }, (t) => {
  const layout = layoutFor(t);
  mkdirSync(layout.parent, { mode: 0o700 });
  mkdirSync(layout.directory, { mode: 0o700 });
  chownSync(layout.directory, 12345, 12345);
  assert.throws(() => installSeccompProfile(layout.socketPath), refusedWithSchemaInvalid(layout));
  assert.deepEqual(readdirSync(layout.directory), []);
});

void test("phase 9.6: a profile directory that is group- or world-readable but not writable is tightened to 0700", (t) => {
  const layout = layoutFor(t);
  mkdirSync(layout.parent, { mode: 0o700 });
  mkdirSync(layout.directory);
  chmodSync(layout.directory, 0o755);
  installSeccompProfile(layout.socketPath);
  assert.equal(modeOf(layout.directory), 0o700);
  assert.equal(readFileSync(layout.file, "utf8"), SECCOMP_PROFILE_TEXT);
});

void test("phase 9.6: a file of the profile's name that is a symbolic link is refused, even when its target holds the profile", (t) => {
  const layout = layoutFor(t);
  mkdirSync(layout.parent, { mode: 0o700 });
  mkdirSync(layout.directory, { mode: 0o700 });
  const target = join(layout.base, "target.json");
  writeFileSync(target, SECCOMP_PROFILE_TEXT);
  symlinkSync(target, layout.file);
  assert.throws(() => installSeccompProfile(layout.socketPath), refusedWithSchemaInvalid(layout));
  assert.equal(readFileSync(target, "utf8"), SECCOMP_PROFILE_TEXT);
});

void test("phase 9.6: a file of the profile's name that others can write is refused, even when its content is the profile", (t) => {
  const layout = layoutFor(t);
  installSeccompProfile(layout.socketPath);
  chmodSync(layout.file, 0o666);
  assert.throws(() => installSeccompProfile(layout.socketPath), refusedWithSchemaInvalid(layout));
  assert.equal(readFileSync(layout.file, "utf8"), SECCOMP_PROFILE_TEXT);
});

void test("phase 9.6: a socket path that is not absolute is refused", () => {
  assert.throws(() => installSeccompProfile("run/driver.sock"), (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID");
});

// A process configuration whose libpod socket does not exist, so a start that reaches the sweep fails there.
function startConfigFor(layout: Layout): DriverProcessConfig {
  return {
    socketPath: layout.socketPath,
    libpodSocketPath: join(layout.base, "missing", "podman.sock"),
    driver: driverConfig(),
  };
}

void test("phase 9.6: startDriver writes the profile before the sweep, and binds no socket when the sweep fails", async (t) => {
  const layout = layoutFor(t);
  await assert.rejects(startDriver(startConfigFor(layout)), (error: unknown) => error instanceof RealmError && error.code === "PODMAN_MACHINE_DOWN");
  assert.equal(readFileSync(layout.file, "utf8"), SECCOMP_PROFILE_TEXT, "the profile was in place before the sweep ran");
  assert.equal(existsSync(layout.socketPath), false, "no socket is bound ahead of the sweep");
});

void test("phase 9.6: startDriver refuses a tampered profile file before it touches libpod, and leaves the file as found", async (t) => {
  const layout = layoutFor(t);
  installSeccompProfile(layout.socketPath);
  writeFileSync(layout.file, "{}");
  await assert.rejects(startDriver(startConfigFor(layout)), refusedWithSchemaInvalid(layout));
  assert.equal(readFileSync(layout.file, "utf8"), "{}");
  assert.equal(existsSync(layout.socketPath), false);
});
