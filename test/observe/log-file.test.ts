// File sink: mode, append, rotation to at most two files, symlink refusal, unwritable directory.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LOG_MAX_BYTES, createFileSink, createStderrSink } from "../../src/observe/log-file.js";
import { createLogger } from "../../src/observe/logger.js";

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

void test("a short write that then fails is closed before the next line is appended", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  let calls = 0;
  const sink = createFileSink({
    path,
    fs: {
      write: (fd, bytes, offset) => {
        calls += 1;
        if (calls === 1) {
          const count = Math.min(3, bytes.length - offset);
          writeSync(fd, bytes, offset, count);
          return count;
        }
        if (calls === 2) {
          throw new Error("ENOSPC");
        }
        return writeSync(fd, bytes, offset, bytes.length - offset);
      },
    },
  });
  assert.equal(sink.write("abcdef"), false);
  assert.equal(sink.write("next"), true);
  sink.close();
  assert.equal(readFileSync(path, "utf8"), "abc\nnext\n");
});

void test("reopening a log with an unfinished tail closes that line before appending", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  writeFileSync(path, "partial", { mode: 0o600 });
  const sink = createFileSink({ path });
  assert.equal(sink.write("next"), true);
  sink.close();
  assert.equal(readFileSync(path, "utf8"), "partial\nnext\n");
});

void test("a named pipe is refused and the open does not block", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  execFileSync("mkfifo", [path]);
  const started = Date.now();
  assert.equal(createFileSink({ path }).write("x"), false);
  assert.ok(Date.now() - started < 1_000, "opening a named pipe blocked");
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

void test("a path under a regular file is recorded as an open failure and creates nothing", () => {
  const dir = tmp();
  const parent = join(dir, "plain-file");
  writeFileSync(parent, "x");
  const sink = createFileSink({ path: join(parent, "daemon.log") });
  assert.equal(sink.write("x"), false);
  assert.equal(sink.lastFailure(), "open");
  assert.equal(sink.close(), true);
  assert.equal(existsSync(join(parent, "daemon.log")), false);
});

void test("an open that fails with an error other than ENOENT is recorded as open, and nothing is written", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  writeFileSync(path, "partial", { mode: 0o600 });
  const sink = createFileSink({
    path,
    fs: {
      open: () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    },
  });
  assert.equal(sink.write("next"), false);
  assert.equal(sink.lastFailure(), "open");
  assert.equal(readFileSync(path, "utf8"), "partial");
});

void test("a failed write is recorded as write, and the next good write clears it", () => {
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
  assert.equal(sink.lastFailure(), "write");
  fail = false;
  assert.equal(sink.write("b"), true);
  assert.equal(sink.lastFailure(), undefined);
  sink.close();
});

void test("a failed rename during rotation is recorded as rotate, and the next write retries the rotation", () => {
  const dir = tmp();
  const path = join(dir, "daemon.log");
  let failRename = true;
  const sink = createFileSink({
    path,
    maxBytes: 16,
    fs: {
      rename: (from, to) => {
        if (failRename) {
          throw new Error("EBUSY");
        }
        renameSync(from, to);
      },
    },
  });
  assert.equal(sink.write("a".repeat(10)), true);
  assert.equal(sink.write("b".repeat(10)), false);
  assert.equal(sink.lastFailure(), "rotate");
  failRename = false;
  assert.equal(sink.write("b".repeat(10)), true);
  assert.equal(sink.lastFailure(), undefined);
  sink.close();
  assert.equal(readFileSync(`${path}.1`, "utf8"), `${"a".repeat(10)}\n`);
  assert.equal(readFileSync(path, "utf8"), `${"b".repeat(10)}\n`);
});

void test("a close that fails is recorded as close and returned as false", () => {
  const dir = tmp();
  let failClose = false;
  const sink = createFileSink({
    path: join(dir, "daemon.log"),
    fs: {
      close: (fd) => {
        closeSync(fd);
        if (failClose) {
          throw new Error("EIO");
        }
      },
    },
  });
  assert.equal(sink.write("x"), true);
  failClose = true;
  assert.equal(sink.close(), false);
  assert.equal(sink.lastFailure(), "close");
});

void test("a stream that throws is recorded as stderr, and a good write clears it", () => {
  let broken = true;
  const sink = createStderrSink({
    write: () => {
      if (broken) {
        throw new Error("EPIPE");
      }
      return true;
    },
  });
  assert.equal(sink.write("x"), false);
  assert.equal(sink.lastFailure(), "stderr");
  broken = false;
  assert.equal(sink.write("y"), true);
  assert.equal(sink.lastFailure(), undefined);
});

void test("a file sink's failure category is counted by the logger under that category", () => {
  const dir = tmp();
  const log = createLogger({
    sink: createFileSink({
      path: join(dir, "daemon.log"),
      fs: {
        write: () => {
          throw new Error("ENOSPC");
        },
      },
    }),
    level: "debug",
    now: () => new Date("2026-10-29T12:00:00.000Z"),
  });
  log.info("a");
  log.info("b");
  assert.equal(log.droppedLines(), 2);
  assert.equal(log.droppedLines("write"), 2);
  assert.equal(log.droppedLines("open"), 0);
});
