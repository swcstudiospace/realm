// File and stderr sinks for the logger (OBS-02). The file sink opens the log itself with
// O_NOFOLLOW, mode 0600 and fchmod 0600 (the audit file's hardening), tracks its size from
// fstat plus the bytes written, and rotates when a line would pass maxBytes: the file is
// renamed to <path>.1 (replacing it) and a fresh file is opened, so at most two files
// exist. Writes are synchronous: logging is never on an async path that can block a tool
// call. A failure of any step makes write return false (the logger counts it). A write that
// lands some bytes of a line and then fails, and a reopened file whose tail is not a newline,
// are closed with a newline before the next record is appended, so a later line stays valid JSON.

import { Buffer } from "node:buffer";
import { closeSync, constants, fchmodSync, fstatSync, openSync, readSync, renameSync, writeSync } from "node:fs";
import type { LogSink } from "./logger.js";

export const DEFAULT_LOG_MAX_BYTES = 4 * 1024 * 1024;

export interface FileSinkFs {
  open(path: string, flags: number, mode: number): number;
  fchmod(fd: number, mode: number): void;
  fstatSize(fd: number): number;
  write(fd: number, bytes: Buffer, offset: number): number;
  read(fd: number, position: number, length: number): Buffer;
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
  close: (fd) => { closeSync(fd); },
  rename: (from, to) => { renameSync(from, to); },
};

export interface FileSinkOptions {
  path: string;
  maxBytes?: number;
  fs?: Partial<FileSinkFs>;
}

const OPEN_FLAGS = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW;
const LOG_MODE = 0o600;

export function createFileSink(options: FileSinkOptions): LogSink & { close(): boolean } {
  const fs: FileSinkFs = { ...NODE_FS, ...options.fs };
  const maxBytes = options.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
  const rotated = `${options.path}.1`;
  let fd: number | null = null;
  let size = 0;
  let needsBoundary = false;
  const openLog = (): void => {
    needsBoundary = tailNeedsBoundary();
    const opened = fs.open(options.path, OPEN_FLAGS, LOG_MODE);
    try {
      fs.fchmod(opened, LOG_MODE);
      size = fs.fstatSize(opened);
    } catch (error) {
      fs.close(opened);
      throw error;
    }
    fd = opened;
  };

  // The write descriptor is O_WRONLY, so the tail is read through a separate descriptor.
  // A missing file is not a partial line; the write open creates it.
  const tailNeedsBoundary = (): boolean => {
    let probe: number;
    try {
      probe = fs.open(options.path, constants.O_RDONLY | constants.O_NOFOLLOW, LOG_MODE);
    } catch {
      // QUAL-01 named exception (j): absence is not a partial line. The write open reports a real failure.
      return false;
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
          return false;
        }
        offset += written;
        size += written;
      }
      return true;
    } catch {
      // QUAL-01 named exception (j): the bytes that landed stay, and the failure is the return value.
      if (offset > 0) {
        needsBoundary = true;
      }
      return false;
    }
  };

  return {
    write(line: string): boolean {
      try {
        const bytes = Buffer.from(`${line}\n`, "utf8");
        if (fd === null) {
          openLog();
        }
        if (needsBoundary) {
          if (!writeBytes(Buffer.from("\n"))) {
            return false;
          }
          needsBoundary = false;
        }
        if (size > 0 && size + bytes.length > maxBytes) {
          fs.rename(options.path, rotated);
          closeLog();
          openLog();
        }
        return writeBytes(bytes);
      } catch {
        // QUAL-01 named exception (j): reported through the return value, which the logger counts. An
        // open descriptor is kept (and closed by close()); the next write retries.
        return false;
      }
    },
    // Returns false when the descriptor could not be closed; it is dropped either way.
    close(): boolean {
      try {
        closeLog();
        return true;
      } catch {
        // QUAL-01 named exception (j): reported through the return value. The descriptor is dropped either way.
        return false;
      }
    },
  };
}

// Writes to a stream (stderr) for failures before the state directory is known and as the
// fallback when the file sink cannot open. Stream write errors surface asynchronously on the
// stream, so the return value only reports a synchronous failure.
export function createStderrSink(stream: { write(chunk: string): boolean }): LogSink {
  return {
    write(line: string): boolean {
      try {
        stream.write(`${line}\n`);
        return true;
      } catch {
        // QUAL-01 named exception (j): reported through the return value; the logger counts it.
        return false;
      }
    },
  };
}
