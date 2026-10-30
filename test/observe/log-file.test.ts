// File sink: mode, append, rotation to at most two files, symlink refusal, unwritable directory.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LOG_MAX_BYTES, createFileSink, createStderrSink } from "../../src/observe/log-file.js";

const roots: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "realm-logfile-"));
  roots.push(dir);
  return dir;
}
after(() => {
  for (const dir of roots) {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
});

const mode = (path: string): number => statSync(path).mode & 0o777;

void test("the default cap is 4 MiB", () => {
  assert.equal(DEFAULT_LOG_MAX_BYTES, 4 * 1024 * 1024);
});

void test("creates the file 0600 even under a permissive umask-style existing mode, and appends", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  writeFileSync(path, "old\n", { mode: 0o644 });
  const sink = createFileSink({ path, maxBytes: 1 << 20 });
  assert.equal(sink.write("one"), true);
  assert.equal(sink.write("two"), true);
  sink.close();
  assert.equal(readFileSync(path, "utf8"), "old\none\ntwo\n");
  assert.equal(mode(path), 0o600);
});

void test("a new file is created with mode 0600", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  const sink = createFileSink({ path });
  assert.equal(sink.write("x"), true);
  sink.close();
  assert.equal(mode(path), 0o600);
});

void test("rotation leaves exactly two files, each 0600, with no line lost", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  const sink = createFileSink({ path, maxBytes: 64 });
  const written: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const line = `line-${String(i)}-${"x".repeat(20)}`;
    written.push(line);
    assert.equal(sink.write(line), true);
  }
  sink.close();
  assert.deepEqual(readdirSync(dir).sort(), ["daemon.log", "daemon.log.1"]);
  assert.equal(mode(path), 0o600);
  assert.equal(mode(`${path}.1`), 0o600);
  const current = readFileSync(path, "utf8").split("\n").filter((l) => l !== "");
  const previous = readFileSync(`${path}.1`, "utf8").split("\n").filter((l) => l !== "");
  assert.ok(statSync(path).size <= 64);
  assert.ok(statSync(`${path}.1`).size <= 64);
  // Only the newest lines survive (at most two files), but they are contiguous and the
  // newest line is in the current file.
  const survivors = [...previous, ...current];
  assert.deepEqual(survivors, written.slice(written.length - survivors.length));
  assert.equal(current.at(-1), written.at(-1));
  assert.ok(previous.length > 0);
});

void test("rotation counts the size of an existing file", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  writeFileSync(path, `${"y".repeat(50)}\n`, { mode: 0o600 });
  const sink = createFileSink({ path, maxBytes: 64 });
  assert.equal(sink.write("z".repeat(30)), true);
  sink.close();
  assert.equal(readFileSync(`${path}.1`, "utf8"), `${"y".repeat(50)}\n`);
  assert.equal(readFileSync(path, "utf8"), `${"z".repeat(30)}\n`);
});

void test("a line larger than the cap is still written, alone, to an empty file", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  const sink = createFileSink({ path, maxBytes: 8 });
  assert.equal(sink.write("a-line-longer-than-eight-bytes"), true);
  sink.close();
  assert.equal(readFileSync(path, "utf8"), "a-line-longer-than-eight-bytes\n");
  assert.equal(existsSync(`${path}.1`), false);
});

void test("a symlink at the path is refused and nothing is written through it", () => {
  const dir = tmp();
  const target = join(dir, "target.txt");
  writeFileSync(target, "keep\n");
  const path = join(dir, "daemon.log");
  symlinkSync(target, path);
  const sink = createFileSink({ path });
  assert.equal(sink.write("secret"), false);
  assert.equal(readFileSync(target, "utf8"), "keep\n");
});

void test("an unwritable directory returns false, and writing recovers once it is writable", { skip: process.getuid?.() === 0 }, () => {
  const dir = tmp();
  const sub = join(dir, "ro");
  mkdirSync(sub, { mode: 0o500 });
  const sink = createFileSink({ path: join(sub, "daemon.log") });
  assert.equal(sink.write("x"), false);
  chmodSync(sub, 0o700);
  assert.equal(sink.write("y"), true);
  sink.close();
});

void test("a missing directory returns false", () => {
  const dir = tmp();
  assert.equal(createFileSink({ path: join(dir, "nope", "daemon.log") }).write("x"), false);
});

void test("an injected write failure returns false and the next write retries", () => {
  const dir = tmp();
  let fail = true;
  const sink = createFileSink({
    path: join(dir, "daemon.log"),
    fs: {
      write: (_fd, bytes, offset) => {
        if (fail) {
          throw new Error("ENOSPC");
        }
        return bytes.length - offset;
      },
    },
  });
  assert.equal(sink.write("a"), false);
  fail = false;
  assert.equal(sink.write("b"), true);
  sink.close();
});

void test("the stderr sink writes one line per call and reports a throwing stream as false", () => {
  const chunks: string[] = [];
  assert.equal(createStderrSink({ write: (c) => (chunks.push(c), true) }).write("hello"), true);
  assert.deepEqual(chunks, ["hello\n"]);
  const broken = createStderrSink({
    write: () => {
      throw new Error("EPIPE");
    },
  });
  assert.equal(broken.write("x"), false);
});
