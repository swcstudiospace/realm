// The omp-plugin doctor item (HEALTH-01, Phase 55). It reports whether the Omp extension is installed, current and
// loaded, read-only and bounded like every other doctor probe.
//
// What Omp exposes about its own install (docs/integration/omp.md, "Installed by realm host install omp"). Realm owns
// one install route, the shim: `realm host install omp` writes `<agent dir>/extensions/realm/index.js`, which imports
// the built `dist/src/omp/extension.js`, and records a receipt under `<stateDir>/hosts/omp.receipt.json`.
// `realm host status omp` therefore reports a `plugin` object: `target` (`present`, `missing` or `unreadable`, whether
// the file the shim imports exists), `sessions` (live, stale and unreadable presence-marker counts) and `conflicts`
// (the plugin-link path when it exists). While a session runs, the extension keeps
// `<stateDir>/hosts/omp-active/<pid>.json`, written after each settled attach. Omp exposes no dedicated health or
// status API for a plugin (Q3 of that note, "not documented"), so this item reads only those Realm seams and never
// guesses: anything they do not show is a warn or a fail with its fix. The alternative route, a plugin link
// (`omp plugin install <checkout>`, under `<home>/.omp/plugins/node_modules/agent-realm`), writes no Realm receipt,
// so this item does not see it; the runbook verifies that route with `omp plugin list --json` and `omp plugin doctor`
// instead. A live marker means a process of Omp loaded the plugin and its last attach settled; it does not prove the
// sandbox is healthy (that is `realm status`).
//
// This module imports nothing from checks.ts or src/cli and reads no process environment: every input arrives in the
// options, the probe is injectable, and the check never throws. A detail names states and counts only, never a path
// or file content.

import { RealmError } from "../core/errors.js";
import { packageVersion } from "../core/package-version.js";
import { withTimeout } from "../core/timeout.js";
import { createHostAdapter } from "../host/adapter.js";
import { defaultManifestFor } from "../host/manifest.js";
import { readPresence } from "../host/presence.js";
import { DEFAULT_READ_TIMEOUT_MS, readReceipt } from "../host/receipt.js";
import { HOST_RUNTIMES } from "../host/runtimes.js";
import { nullLogger } from "../observe/logger.js";

export interface OmpPluginCheckResult {
  readonly id: "omp-plugin";
  readonly status: "pass" | "warn" | "fail";
  readonly detail: string;
  readonly fix: string | null;
}

// What one probe reading reports about the Omp plugin. `wrong-version` covers an installed extension that is not the
// current build (a drifted shim) and one whose imported entry cannot be used (a missing or unreadable target); the
// reason names states and counts only. Injected fakes pin every outcome, so the check logic carries no file system
// knowledge of its own.
export type OmpPluginReading =
  | { readonly state: "not-installed" }
  | { readonly state: "wrong-version"; readonly reason: string }
  | { readonly state: "not-loaded"; readonly live: number; readonly unreadable: number }
  | { readonly state: "loaded"; readonly live: number; readonly unreadable: number };

export type OmpPluginProbe = () => Promise<OmpPluginReading>;

export interface OmpPluginCheckOptions {
  readonly stateDir: string;
  // The bound on the whole probe, in milliseconds. The caller applies the doctor default.
  readonly probeTimeoutMs: number;
  // Test seam: replaces the probe that reads the receipt, the recorder status and the presence markers.
  readonly probe?: OmpPluginProbe;
  // The bound on each receipt, file and marker read, in milliseconds (default 10000).
  readonly readTimeoutMs?: number;
  // Test seam: the runtime table the adapter is built from (default HOST_RUNTIMES).
  readonly adapters?: Readonly<Record<HostId, HostRuntimeEntry>>;
  // Test seam: whether a process id is alive, for the live plugin session count (default process.kill(pid, 0)).
  readonly isProcessAlive?: (pid: number) => boolean;
}

const FIX_NOT_INSTALLED =
  "Install it yourself with realm host install omp after npm run build, or load the built extension for one session with -e. Realm does not install the plugin for you.";
const FIX_WRONG_VERSION =
  "Rebuild the checkout (npm run build), then repair with realm host install omp, or remove with realm host uninstall omp and install again, then rerun doctor.";
const FIX_NOT_LOADED =
  "Start an Omp session with the extension loaded (the installed shim, or -e for one session), then rerun doctor. A live marker means a process loaded the plugin and settled an attach; realm status, not this item, proves the sandbox is healthy.";
const FIX_INSPECT =
  "Inspect the hosts directory and the receipt named in the detail without following symlinks; restore the receipt from a known-good copy, then rerun doctor.";

function fromReading(reading: OmpPluginReading): OmpPluginCheckResult {
  switch (reading.state) {
    case "not-installed":
      return { id: "omp-plugin", status: "warn", detail: "the Omp extension is not installed", fix: FIX_NOT_INSTALLED };
    case "wrong-version":
      return {
        id: "omp-plugin",
        status: "warn",
        detail: `the installed Omp extension is not the current build (${reading.reason})`,
        fix: FIX_WRONG_VERSION,
      };
    case "not-loaded":
      return {
        id: "omp-plugin",
        status: "warn",
        detail: `the Omp extension is installed but not loaded: 0 live plugin sessions${reading.unreadable === 0 ? "" : `, ${String(reading.unreadable)} unreadable presence marker(s)`}`,
        fix: reading.unreadable > 0 ? FIX_INSPECT : FIX_NOT_LOADED,
      };
    case "loaded":
      if (reading.unreadable > 0) {
        return {
          id: "omp-plugin",
          status: "warn",
          detail: `the Omp extension is loaded: ${String(reading.live)} live plugin session${reading.live === 1 ? "" : "s"}, ${String(reading.unreadable)} unreadable presence marker(s)`,
          fix: FIX_INSPECT,
        };
      }
      return {
        id: "omp-plugin",
        status: "pass",
        detail: `the Omp extension is installed and loaded: ${String(reading.live)} live plugin session${reading.live === 1 ? "" : "s"}`,
        fix: null,
      };
  }
}

// The default probe: receipt, recorder status and presence markers, read-only. A receipt that does not exist means
// the shim route is not installed; the plugin-link route writes no receipt and is verified by the runbook instead.
// A receipt whose owned files no longer match the recorder (drift) or whose imported entry is missing or unreadable
// is not the current build.
async function defaultProbe(options: OmpPluginCheckOptions): Promise<OmpPluginReading> {
  const readTimeoutMs = options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
  const receipt = await readReceipt(options.stateDir, "omp", readTimeoutMs);
  if (receipt === null) {
    return { state: "not-installed" };
  }
  const runtimes = options.adapters ?? HOST_RUNTIMES;
  const adapter = createHostAdapter(runtimes.omp, defaultManifestFor("omp", packageVersion()), {
    stateDir: options.stateDir,
    adaptersDir: "",
    logger: nullLogger,
    now: () => new Date(),
    readTimeoutMs,
  });
  // A receipt names its own config home and status resolves paths against it. This env only serves the detection
  // fallback that runs if a receipt vanishes between the read and the status call, so it points inside the state
  // directory, never at a real home.
  const env: HostEnv = { home: options.stateDir, env: {}, pathDirs: [] };
  const found = await adapter.status(env);
  if (found.status !== "installed") {
    return { state: "wrong-version", reason: found.detail };
  }
  if (found.extensionTarget !== "present") {
    return { state: "wrong-version", reason: `extension target ${found.extensionTarget ?? "unreadable"}` };
  }
  const presence = await readPresence(options.stateDir, "omp", {
    readTimeoutMs,
    ...(options.isProcessAlive === undefined ? {} : { isAlive: options.isProcessAlive }),
  });
  if (presence.live === 0) {
    return { state: "not-loaded", live: 0, unreadable: presence.unreadable };
  }
  return { state: "loaded", live: presence.live, unreadable: presence.unreadable };
}

// Never throws: a probe that fails or does not finish in time is a `fail` result carrying a catalogue code.
export async function ompPluginCheck(options: OmpPluginCheckOptions): Promise<OmpPluginCheckResult> {
  const probe = options.probe ?? ((): Promise<OmpPluginReading> => defaultProbe(options));
  let reading: OmpPluginReading;
  try {
    reading = await withTimeout(probe(), options.probeTimeoutMs, "TOOL_TIMEOUT");
  } catch (error: unknown) {
    return {
      id: "omp-plugin",
      status: "fail",
      detail: `the Omp plugin state cannot be read (${error instanceof RealmError ? error.code : "SCHEMA_INVALID"})`,
      fix: FIX_INSPECT,
    };
  }
  return fromReading(reading);
}
