// The key-level reasons a realm command that cannot load the config prints (ONB-04 follow-up). The derivation lives
// here and nowhere else: runCli (main.ts) for the doctor branch and the state-directory refusal, audit.ts and
// checkpoint.ts for their refusals. Every phrase is fixed text (D-1506): never a config value, never a path.

import { lstatSync } from "node:fs";
import { describeRuntimeConfigProblems, loadRuntimeConfig, type RuntimeConfig } from "../runtime/config.js";
import { readRuntimeConfigFile } from "../runtime/config-file.js";
import { resolveConfigPath } from "../runtime/host-paths.js";
import type { EnvironmentLike } from "../session/paths.js";

// The loaded config, or the key-level reasons it did not load. Both come from one read of the config file.
export type ConfigOutcome = { readonly config: RuntimeConfig } | { readonly problems: readonly string[] };

// The seams the config is read through. CliDeps and CheckpointDeps both satisfy this shape.
export interface ConfigSource {
  readonly env: EnvironmentLike;
  readonly readConfig?: (path: string) => unknown;
}

// A file that is absent at configPath, or a location that cannot be resolved, is `config.json is absent`; a present file
// that cannot be read as JSON is named as such; a file that parsed is described key by key.
export function configProblemsOf(raw: unknown, readFailed: boolean, configPath: string | undefined): readonly string[] {
  if (readFailed) {
    return [configFileIsAbsent(configPath) ? "config.json is absent" : "config.json is not a readable JSON file"];
  }
  const problems = describeRuntimeConfigProblems(raw);
  return problems.length === 0 ? ["config.json does not load"] : problems;
}

// Reads the config file once and loads it. A read failure, and a parsed value that does not load, both become problems.
export function readConfigOutcome(deps: ConfigSource): ConfigOutcome {
  let configPath: string | undefined;
  let raw: unknown;
  try {
    configPath = resolveConfigPath(deps.env);
    raw = (deps.readConfig ?? readRuntimeConfigFile)(configPath);
  } catch {
    return { problems: configProblemsOf(undefined, true, configPath) };
  }
  try {
    return { config: loadRuntimeConfig(raw) };
  } catch {
    return { problems: configProblemsOf(raw, false, configPath) };
  }
}

// The one message a state-directory command prints when the config does not load: the shipped sentence, the key-level
// reasons, then the pointer to realm doctor. The shipped sentence is the prefix, so prefix assertions still hold.
export function noStateDirectoryText(prefix: string, problems: readonly string[]): string {
  const reasons = problems.length === 0 ? "" : `; ${problems.join("; ")}`;
  return `${prefix}: cannot resolve a state directory (the realm config file under an absolute XDG_CONFIG_HOME or HOME must be present and valid)${reasons}. Run realm doctor for the full report.`;
}

function configFileIsAbsent(configPath: string | undefined): boolean {
  if (configPath === undefined) {
    return true;
  }
  try {
    lstatSync(configPath);
    return false;
  } catch (error: unknown) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return code === "ENOENT" || code === "ENOTDIR";
  }
}
