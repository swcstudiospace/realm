// Runtime config file reader for the daemon entry (RT-01). The file is read as UTF-8 JSON and
// returned unvalidated: loadRuntimeConfig owns the schema. A missing path, a path that is not a
// regular file, a file over MAX_CONFIG_BYTES, and invalid JSON are all SCHEMA_INVALID. This module
// reads no environment.

import { readFileSync, statSync } from "node:fs";
import { makeRealmError } from "../core/errors.js";

// Largest config file accepted, in bytes. The runtime config is a handful of short fields.
const MAX_CONFIG_BYTES = 65536;

export function readRuntimeConfigFile(path: string): unknown {
  const text = readWithinLimit(path);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// Stats first so a FIFO, device, or directory is refused before it is opened. The byte check
// after the read covers a file that grew between the stat and the read.
function readWithinLimit(path: string): string {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size > MAX_CONFIG_BYTES) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const text = readFileSync(path, "utf8");
    if (Buffer.byteLength(text, "utf8") > MAX_CONFIG_BYTES) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return text;
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}
