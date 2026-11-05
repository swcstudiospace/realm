// File and stderr sinks for the logger (OBS-02). The file sink opens the log itself with
// O_NOFOLLOW, mode 0600 and fchmod 0600 (the audit file's hardening), tracks its size from
// fstat plus the bytes written, and rotates when a line would pass maxBytes: the file is
// renamed to <path>.1 (replacing it) and a fresh file is opened, so at most two files
// exist. Writes are synchronous: logging is never on an async path that can block a tool
// call. A failure of any step makes write return false and names its category (lastFailure); the logger counts it. A write that
// lands some bytes of a line and then fails, and a reopened file whose tail is not a newline,
// are closed with a newline before the next record is appended, so a later line stays valid JSON.

import { Buffer } from "node:buffer";
import { closeSync, constants, fchmodSync, fstatSync, lstatSync, openSync, readSync, renameSync, writeSync } from "node:fs";
import type { LogFailureCategory, LogSink } from "./logger.js";

export const DEFAULT_LOG_MAX_BYTES = 4 * 1024 * 1024;

export interface FileSinkFs {
  open(path: string, flags: number, mode: number): number;
  fchmod(fd: number, mode: number): void;
  fstatSize(fd: number): number;
  write(fd: number, bytes: Buffer, offset: number): number;
  read(fd: number, position: number, length: number): Buffer;
  isRegular(fd: number): boolean;
  close(fd: number): void;
  rename(from: string, to: string): void;
}

const NODE_FS: FileSinkFs = {
  open: (path, flags, mode) => openSync(path, flags, mode),
  fchmod: (fd, mode) => { fchmodSync(fd, mode); },
  fstatSize: (fd) => fstatSync(fd).size,
  write: (fd, bytes, offset) => writeSync(fd, bytes, offset, bytes.length - offset),
  read: (fd, position, length) => {
    const bytes = Buffer.alloc(length);
    const read = readSync(fd, bytes, 0, length, position);
    return bytes.subarray(0, read);
  },
  isRegular: (fd) => fstatSync(fd).isFile(),
  close: (fd) => { closeSync(fd); },
  rename: (from, to) => { renameSync(from, to); },
};

export interface FileSinkOptions {
  path: string;
  maxBytes?: number;
  fs?: Partial<FileSinkFs>;
}

const OPEN_FLAGS = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const LOG_MODE = 0o600;

// A named pipe opened write-only blocks until a reader appears. Refuse anything that is
// not a regular file before that open. A missing path is not a refusal; the open creates it.
function existingNonRegular(path: string): boolean {
  try {
    return !lstatSync(path).isFile();
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return false;
    }
    // Any other lstat failure is thrown; the open stage records it as "open".
    throw error;
  }
}

// The errno code of a Node fs error, or undefined.
function errnoCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) {
    return undefined;
  }
  const code: unknown = error.code;
  return typeof code === "string" ? code : undefined;
}

export function createFileSink(options: FileSinkOptions): LogSink & { close(): boolean; lastFailure(): LogFailureCategory | undefined } {
  const fs: FileSinkFs = { ...NODE_FS, ...options.fs };
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
  const rotated = `${options.path}.1`;
  let fd: number | null = null;
  let size = 0;
  let needsBoundary = false;
  // The category of the most recent refusal; undefined after a write that succeeded.
  let failure: LogFailureCategory | undefined;
  const openLog = (): void => {
    if (existingNonRegular(options.path)) {
      throw new Error("log path is not a regular file");
    }
    needsBoundary = tailNeedsBoundary();
    const opened = fs.open(options.path, OPEN_FLAGS, LOG_MODE);
    try {
      fs.fchmod(opened, LOG_MODE);
      if (!fs.isRegular(opened)) {
        throw new Error("log path is not a regular file");
      }
      size = fs.fstatSize(opened);
    } catch (error) {
      fs.close(opened);
      throw error;
    }
    fd = opened;
  };

  // The write descriptor is O_WRONLY, so the tail is read through a separate descriptor.
  // A missing file is not a partial line; the write open creates it. O_NONBLOCK so a named
  // pipe cannot park the caller.
  const tailNeedsBoundary = (): boolean => {
    let probe: number;
    try {
      probe = fs.open(options.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, LOG_MODE);
    } catch (error) {
      // Only ENOENT is absence. Any other failure is the open's, thrown to write, which records it.
      if (errnoCode(error) === "ENOENT") {
        return false;
      }
      throw error;
    }
    try {
      const fileSize = fs.fstatSize(probe);
      if (fileSize <= 0) {
        return false;
      }
      const tail = fs.read(probe, fileSize - 1, 1);
      return !(tail.length === 1 && tail[0] === 0x0a);
    } finally {
      fs.close(probe);
    }
  };

  const closeLog = (): void => {
    const current = fd;
    fd = null;
    if (current !== null) {
      fs.close(current);
    }
  };

  // Writes every byte, or returns false. A partial line (some bytes, then a stop or a throw)
  // marks the file so the next record starts on its own line.
  const writeBytes = (bytes: Buffer): boolean => {
    const target = fd;
    if (target === null) {
      failure = "open";
      return false;
    }
    let offset = 0;
    try {
      while (offset < bytes.length) {
        const written = fs.write(target, bytes, offset);
        if (written <= 0) {
          if (offset > 0) {
            needsBoundary = true;
          }
          failure = "write";
          return false;
        }
        offset += written;
        size += written;
      }
      return true;
    } catch {
      // The bytes that landed stay, and the next record starts on its own line.
      failure = "write";
      if (offset > 0) {
        needsBoundary = true;
      }
      return false;
    }
  };

  return {
    write(line: string): boolean {
      failure = undefined;
      // The step that is running when a throw happens; the catch records it as the failure's category.
      let stage: LogFailureCategory = "open";
      try {
        const bytes = Buffer.from(`${line}\n`, "utf8");
        if (fd === null) {
          openLog();
        }
        if (needsBoundary && !(size > 0 && size + bytes.length > maxBytes)) {
          if (!writeBytes(Buffer.from("\n"))) {
            return false;
          }
          needsBoundary = false;
        }
        if (size > 0 && size + bytes.length > maxBytes) {
          stage = "rotate";
          fs.rename(options.path, rotated);
          stage = "close";
          closeLog();
          stage = "open";
          openLog();
        }
        if (needsBoundary) {
          if (!writeBytes(Buffer.from("\n"))) {
            return false;
          }
          needsBoundary = false;
        }
        return writeBytes(bytes);
      } catch {
        // Named by the stage that threw, and returned as false; the logger counts it. An open
        // descriptor is kept (and closed by close()); the next write retries.
        failure = stage;
        return false;
      }
    },
    // Returns false when the descriptor could not be closed; the failure is recorded as "close".
    close(): boolean {
      failure = undefined;
      try {
        closeLog();
        return true;
      } catch {
        // Recorded as "close" (lastFailure). The descriptor is dropped either way.
        failure = "close";
        return false;
      }
    },
    lastFailure: () => failure,
  };
}

// Writes to a stream (stderr) for failures before the state directory is known and as the
// fallback when the file sink cannot open. Stream write errors surface asynchronously on the
// stream, so the return value only reports a synchronous failure.
export function createStderrSink(stream: { write(chunk: string): boolean }): LogSink & { lastFailure(): LogFailureCategory | undefined } {
  let failure: LogFailureCategory | undefined;
  return {
    write(line: string): boolean {
      failure = undefined;
      try {
        stream.write(`${line}\n`);
        return true;
      } catch {
        // Recorded as "stderr" (lastFailure) and returned as false; the logger counts it.
        failure = "stderr";
        return false;
      }
    },
    lastFailure: () => failure,
  };
}
