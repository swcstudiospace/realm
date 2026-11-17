// Fixture hosts for the installer tests: a temporary HOME, one HostRuntimeEntry per recipe kind
// (id `claude`, one `config` home `.fixture-host`), a matching HostEnv, a captured logger and a tree
// hash helper that proves "nothing changed". No real host configuration is ever touched.

import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { createLogger, type Logger } from "../../src/observe/logger.js";
import type { HostEnv, HostRuntimeEntry, InstallRecipe } from "../../src/host/types.js";

// The kinds the generic engine fixtures build; toml-table is covered by its own suite (test/host/toml-owned.test.ts).
export type FixtureRecipeKind = Exclude<InstallRecipe["kind"], "toml-table">;

export const FIXTURE_HOME_REL = ".fixture-host";
export const FIXTURE_BUNDLE_SOURCE = "fixture-bundle";
export const FIXTURE_BUNDLE_FILES: Readonly<Record<string, string>> = Object.freeze({
  "a.txt": "alpha\n",
  "b.txt": "beta\n",
});

export const FIXTURE_JSON_VALUE = Object.freeze({ type: "stdio", command: "realm", args: Object.freeze(["mcp"]) });
export const FIXTURE_TEXT_BLOCK = '[mcp_servers.realm]\ncommand = "realm"\nargs = ["mcp"]';

export interface FixtureHost {
  // Real path of the temporary root; removed when the test ends.
  readonly root: string;
  readonly home: string;
  // The fixture host's config home: <home>/.fixture-host (created).
  readonly configHome: string;
  readonly stateDir: string;
  readonly adaptersDir: string;
  readonly env: HostEnv;
}

export function makeFixtureHost(t: TestContext, options: { readonly createConfigHome?: boolean } = {}): FixtureHost {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "realm-host-fixture-")));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const home = join(root, "home");
  const configHome = join(home, FIXTURE_HOME_REL);
  const stateDir = join(root, "state");
  const adaptersDir = join(root, "adapters");
  mkdirSync(home, { recursive: true });
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(adaptersDir, FIXTURE_BUNDLE_SOURCE), { recursive: true });
  for (const [name, content] of Object.entries(FIXTURE_BUNDLE_FILES)) {
    writeFileSync(join(adaptersDir, FIXTURE_BUNDLE_SOURCE, name), content);
  }
  if (options.createConfigHome !== false) {
    mkdirSync(configHome, { recursive: true });
  }
  return { root, home, configHome, stateDir, adaptersDir, env: { home, env: {}, pathDirs: [] } };
}

export function fixtureRecipe(kind: FixtureRecipeKind): InstallRecipe {
  switch (kind) {
    case "json-merge":
      return { kind, file: "settings.json", keyPath: ["mcpServers", "realm"], value: FIXTURE_JSON_VALUE };
    case "text-block":
      return { kind, file: "config.toml", block: FIXTURE_TEXT_BLOCK };
    case "bundle-copy":
      return { kind, source: FIXTURE_BUNDLE_SOURCE, dest: "plugins/realm" };
  }
}

export function fixtureEntry(recipe: InstallRecipe | null): HostRuntimeEntry {
  return {
    id: "claude",
    flag: "--claude",
    aliases: [],
    displayName: "Fixture Host",
    tier: "proven",
    integration: "mcp-config",
    homes: [{ rel: FIXTURE_HOME_REL, role: "config" }],
    homeVerified: true,
    envOverride: null,
    binaries: ["fixture-host"],
    recipe,
  };
}

export interface CapturedLog {
  readonly logger: Logger;
  readonly lines: string[];
}

export function captureLog(): CapturedLog {
  const lines: string[] = [];
  const logger = createLogger({
    sink: {
      write(line: string): boolean {
        lines.push(line);
        return true;
      },
    },
    level: "debug",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  return { logger, lines };
}

// The `event` names of the captured JSON lines, in order.
export function eventsOf(lines: readonly string[]): string[] {
  return lines.map((line) => {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null && "event" in parsed && typeof parsed.event === "string" ? parsed.event : "";
  });
}

// A hash over every path, entry type and content under dir (symlinks by target). Equal hashes mean the
// tree is byte-identical; a missing dir hashes as "absent".
export function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (path: string, rel: string): void => {
    const stats = lstatSync(path);
    if (stats.isSymbolicLink()) {
      hash.update(`L ${rel} ${readlinkSync(path)}\n`);
    } else if (stats.isDirectory()) {
      hash.update(`D ${rel}\n`);
      for (const name of readdirSync(path).sort()) {
        walk(join(path, name), rel === "" ? name : `${rel}/${name}`);
      }
    } else {
      hash.update(`F ${rel} ${createHash("sha256").update(readFileSync(path)).digest("hex")}\n`);
    }
  };
  try {
    lstatSync(dir);
  } catch {
    return "absent";
  }
  walk(dir, "");
  return hash.digest("hex");
}

export function writeAt(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
