// The host-plugins doctor item (HOST-08). It reads Realm's own receipts under <stateDir>/hosts and, for each, asks the host
// adapter whether the files the receipt names still match. It reads only the files a receipt names (for Claude Code that is a
// file in the user's home), never runs a host binary and never reads the process environment: a receipt names its config home,
// and the adapter resolves paths against that. A detail names host ids and counts, never a path or file content. This module
// imports nothing from checks.ts or src/cli, and the check never throws: every failure is a `fail` result carrying a catalogue
// code.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { makeRealmError, RealmError, type ErrorCode } from "../core/errors.js";
import { packageVersion } from "../core/package-version.js";
import { withTimeout } from "../core/timeout.js";
import { errnoOf, lstatIfPresent } from "../fs/canonicalize.js";
import { createHostAdapter } from "../host/adapter.js";
import { defaultManifestFor } from "../host/manifest.js";
import { readAllPresence, readPresence, type HostPresenceReport } from "../host/presence.js";
import { DEFAULT_READ_TIMEOUT_MS } from "../host/receipt.js";
import { HOST_RUNTIMES } from "../host/runtimes.js";
import { HOST_IDS, type HostEnv, type HostId, type HostRuntimeEntry } from "../host/types.js";
import { nullLogger } from "../observe/logger.js";

export interface HostPluginsCheckResult {
  readonly id: "host-plugins";
  readonly status: "pass" | "warn" | "fail";
  readonly detail: string;
  readonly fix: string | null;
}

export interface HostPluginsCheckOptions {
  readonly stateDir: string;
  // The bound on the directory listing and on each receipt and file read, in milliseconds (default 10000).
  readonly readTimeoutMs?: number;
  // Test seam: the runtime table the adapters are built from (default HOST_RUNTIMES).
  readonly adapters?: Readonly<Record<HostId, HostRuntimeEntry>>;
  // Test seam: lists the hosts directory (default fs/promises readdir).
  readonly readDir?: (path: string) => Promise<readonly string[]>;
  // Test seam: whether a process id is alive, for the live plugin session count (default process.kill(pid, 0)).
  readonly isProcessAlive?: (pid: number) => boolean;
}

const RECEIPT_SUFFIX = ".receipt.json";
// status never copies a bundle, so no adapters directory is consulted.
const NO_ADAPTERS_DIR = "";

function codeOf(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : "SCHEMA_INVALID";
}

// The receipt file names present in the hosts directory, null when the directory is absent. A symlinked or non-directory
// path is PATH_ESCAPE; a listing that fails or does not finish in time is a catalogue error.
async function listReceiptHosts(options: HostPluginsCheckOptions, hostsDir: string, readTimeoutMs: number): Promise<readonly HostId[] | null> {
  const stats = lstatIfPresent(hostsDir);
  if (stats === null) {
    return null;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw makeRealmError("PATH_ESCAPE");
  }
  const readDir = options.readDir ?? ((path: string): Promise<readonly string[]> => readdir(path));
  let names: readonly string[];
  try {
    names = await withTimeout(readDir(hostsDir), readTimeoutMs, "TOOL_TIMEOUT");
  } catch (error: unknown) {
    if (error instanceof RealmError) {
      throw error;
    }
    if (errnoOf(error) === "ENOENT") {
      return null;
    }
    throw makeRealmError("PATH_ESCAPE");
  }
  return HOST_IDS.filter((id) => names.includes(`${id}${RECEIPT_SUFFIX}`));
}

interface Drift {
  readonly id: HostId;
  readonly detail: string;
  // True when an owned file cannot be read or parsed safely: a reinstall or uninstall refuses until it is repaired by hand.
  readonly unreadable?: true;
}

// An installed host with the sentence the doctor adds for it ("" when there is nothing to add).
interface InstalledHost {
  readonly id: HostId;
  readonly note: string;
}

function sessionsPhrase(live: number): string {
  return `${String(live)} live plugin session${live === 1 ? "" : "s"}`;
}

interface Failure {
  readonly id: HostId;
  readonly code: ErrorCode;
}

// "; live host sessions: claude 1, omp 2": hosts with a live marker that the detail does not already describe, by id and
// count only. "" when there are none.
function liveSuffix(presence: readonly HostPresenceReport[], described: ReadonlySet<HostId>): string {
  const live = presence.flatMap((report) =>
    "counts" in report && report.counts.live > 0 && !described.has(report.id) ? [`${report.id} ${String(report.counts.live)}`] : [],
  );
  return live.length === 0 ? "" : `; live host sessions: ${live.join(", ")}`;
}

export async function hostPluginsCheck(options: HostPluginsCheckOptions): Promise<HostPluginsCheckResult> {
  const hostsDir = join(options.stateDir, "hosts");
  const inspect = `Inspect ${hostsDir} and the receipt named in the detail without following symlinks; restore the receipt from a known-good copy.`;
  const readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  let hosts: readonly HostId[] | null;
  try {
    hosts = await listReceiptHosts(options, hostsDir, readTimeoutMs);
  } catch (error: unknown) {
    return { id: "host-plugins", status: "fail", detail: `the hosts directory cannot be read (${codeOf(error)})`, fix: inspect };
  }
  // Markers are read for every host, receipt or not: a hand-registered `realm mcp --host claude` has markers and no receipt.
  const presence = await readAllPresence(options.stateDir, {
    readTimeoutMs,
    ...(options.isProcessAlive === undefined ? {} : { isAlive: options.isProcessAlive }),
  });
  const markersUnreadable = presence.some((report) => "error" in report || report.counts.unreadable > 0);
  const described = new Set<HostId>();
  if (hosts === null || hosts.length === 0) {
    const detail = `no host plugin installed${liveSuffix(presence, described)}`;
    return markersUnreadable
      ? { id: "host-plugins", status: "warn", detail, fix: inspect }
      : { id: "host-plugins", status: "pass", detail, fix: null };
  }
  const runtimes = options.adapters ?? HOST_RUNTIMES;
  // A receipt names its own config home and status resolves paths against it. This env only serves the detection fallback
  // that runs if a receipt vanishes between the listing and the read, so it points inside the state directory, never at a real home.
  const env: HostEnv = { home: options.stateDir, env: {}, pathDirs: [] };
  const installed: InstalledHost[] = [];
  let unreadableMarkers = markersUnreadable;
  const drifted: Drift[] = [];
  const failed: Failure[] = [];
  for (const id of hosts) {
    try {
      const adapter = createHostAdapter(runtimes[id], defaultManifestFor(id, packageVersion()), {
        stateDir: options.stateDir,
        adaptersDir: NO_ADAPTERS_DIR,
        logger: nullLogger,
        now: () => new Date(),
        readTimeoutMs,
      });
      const found = await adapter.status(env);
      if (found.status === "installed" && found.extensionTarget !== null && found.extensionTarget !== "present") {
        drifted.push({ id, detail: `extension target ${found.extensionTarget}` });
      } else if (found.status === "installed" && found.extensionTarget === "present") {
        const sessions = await readPresence(options.stateDir, id, {
          readTimeoutMs,
          ...(options.isProcessAlive === undefined ? {} : { isAlive: options.isProcessAlive }),
        });
        const unreadable = sessions.unreadable === 0 ? "" : `, ${String(sessions.unreadable)} unreadable presence marker(s)`;
        unreadableMarkers ||= sessions.unreadable > 0;
        installed.push({ id, note: `extension target present, ${sessionsPhrase(sessions.live)}${unreadable}` });
        described.add(id);
      } else if (found.status === "installed") {
        installed.push({ id, note: "" });
      } else if (found.status === "drifted") {
        const unreadable = found.entries.some((item) => item.state === "unreadable");
        drifted.push(unreadable ? { id, detail: found.detail, unreadable } : { id, detail: found.detail });
      }
    } catch (error: unknown) {
      failed.push({ id, code: codeOf(error) });
    }
  }
  if (failed.length > 0) {
    return {
      id: "host-plugins",
      status: "fail",
      detail: `unreadable host receipt: ${failed.map((item) => `${item.id} (${item.code})`).join("; ")}`,
      fix: inspect,
    };
  }
  const [first] = drifted;
  if (first !== undefined) {
    const stuck = drifted.find((item) => item.unreadable === true);
    const fix =
      stuck === undefined
        ? `Repair with realm host install ${first.id}, or remove with realm host uninstall ${first.id}.`
        : `A file this receipt owns cannot be read or parsed safely (a symlink, a file over 1 MiB, invalid content or a lone Realm marker); inspect it, repair it by hand as docs/hosts/snippets/${stuck.id}.md describes, then run realm host uninstall ${stuck.id}.`;
    return {
      id: "host-plugins",
      status: "warn",
      detail: `host plugin drift: ${drifted.map((item) => `${item.id}: ${item.detail}`).join("; ")}${liveSuffix(presence, described)}`,
      fix,
    };
  }
  // A receipt that vanished between the listing and the read leaves nothing installed.
  const detail = `${
    installed.length === 0
      ? "no host plugin installed"
      : `installed: ${installed.map((item) => (item.note === "" ? item.id : `${item.id} (${item.note})`)).join(", ")}`
  }${liveSuffix(presence, described)}`;
  if (unreadableMarkers) {
    return { id: "host-plugins", status: "warn", detail, fix: inspect };
  }
  return { id: "host-plugins", status: "pass", detail, fix: null };
}
