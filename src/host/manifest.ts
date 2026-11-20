// Strict HostPluginManifest validator and per-host default manifests. Hand-written, no dependency.
// Every refusal is SCHEMA_INVALID with a fixed message: no input text is ever echoed.

import { SchemaInvalidError } from "../contract/validate.js";
import { HOST_CAPABILITIES, isWithinCeiling } from "./capabilities.js";
import { HOST_RUNTIMES } from "./runtimes.js";
import {
  HOST_IDS,
  type BootBounds,
  type HostCapability,
  type HostCapabilityRequest,
  type HostId,
  type HostLaunch,
  type HostPluginManifest,
  type IntegrationKind,
} from "./types.js";

// Same pattern as VERSION_PATTERN in src/core/package-version.ts (that constant is module-private).
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const COMMAND_PATTERN = /^[A-Za-z0-9._-]+$/;
const ARG_PATTERN = /^[A-Za-z0-9._:=-]{1,64}$/;
const MAX_CAPABILITIES = 16;
const MAX_ARGS = 8;
const MAX_SCOPE_LENGTH = 256;
const MAX_ENTRY_LENGTH = 256;
const POISON_KEYS = ["__proto__", "constructor", "prototype"] as const;

function reject(): never {
  throw new SchemaInvalidError("host plugin manifest is not valid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// An object whose own keys are all in `allowed` and none is a prototype key.
function strictObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) {
    return reject();
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if ((POISON_KEYS as readonly string[]).includes(key) || !allowed.includes(key)) {
      reject();
    }
  }
  return value;
}

function integerIn(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return reject();
  }
  return value;
}

function parseCapabilities(value: unknown): readonly HostCapabilityRequest[] {
  if (!Array.isArray(value) || value.length > MAX_CAPABILITIES) {
    return reject();
  }
  const seen = new Set<string>();
  const out: HostCapabilityRequest[] = [];
  for (const item of value as unknown[]) {
    const obj = strictObject(item, ["capability", "scope"]);
    const capability = obj["capability"];
    if (typeof capability !== "string" || !(HOST_CAPABILITIES as readonly string[]).includes(capability)) {
      reject();
    }
    const scope = obj["scope"];
    if (scope !== undefined && (typeof scope !== "string" || scope === "" || scope.length > MAX_SCOPE_LENGTH)) {
      reject();
    }
    const key = JSON.stringify([capability, scope ?? null]);
    if (seen.has(key)) {
      reject();
    }
    seen.add(key);
    out.push(
      Object.freeze(
        scope === undefined
          ? { capability: capability as HostCapability }
          : { capability: capability as HostCapability, scope },
      ),
    );
  }
  return Object.freeze(out);
}

function parseLaunch(value: unknown): HostLaunch {
  const obj = strictObject(value, ["command", "args"]);
  const command = obj["command"];
  const args = obj["args"];
  if (typeof command !== "string" || !COMMAND_PATTERN.test(command)) {
    reject();
  }
  if (!Array.isArray(args) || args.length > MAX_ARGS) {
    return reject();
  }
  const argList: unknown[] = args;
  const checked: string[] = [];
  for (const arg of argList) {
    if (typeof arg !== "string" || !ARG_PATTERN.test(arg)) {
      reject();
    }
    checked.push(arg);
  }
  return Object.freeze({ command, args: Object.freeze(checked) });
}

function parseEntry(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ENTRY_LENGTH ||
    value.startsWith("/") ||
    value.includes("\\") ||
    !value.endsWith(".js") ||
    value.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    return reject();
  }
  return value;
}

function parseBoot(value: unknown): BootBounds {
  const obj = strictObject(value, ["startupBudgetMs", "reattach"]);
  const out: { startupBudgetMs?: number; reattach?: NonNullable<BootBounds["reattach"]> } = {};
  if (obj["startupBudgetMs"] !== undefined) {
    out.startupBudgetMs = integerIn(obj["startupBudgetMs"], 1, 200000);
  }
  if (obj["reattach"] !== undefined) {
    const re = strictObject(obj["reattach"], ["enabled", "retryCap", "baseDelayMs", "capDelayMs"]);
    const reattach: { enabled?: boolean; retryCap?: number; baseDelayMs?: number; capDelayMs?: number } = {};
    if (re["enabled"] !== undefined) {
      if (typeof re["enabled"] !== "boolean") {
        reject();
      }
      reattach.enabled = re["enabled"];
    }
    if (re["retryCap"] !== undefined) {
      reattach.retryCap = integerIn(re["retryCap"], 0, 8);
    }
    if (re["capDelayMs"] !== undefined) {
      reattach.capDelayMs = integerIn(re["capDelayMs"], 1, 60000);
    }
    if (re["baseDelayMs"] !== undefined) {
      reattach.baseDelayMs = integerIn(re["baseDelayMs"], 1, reattach.capDelayMs ?? 60000);
    }
    out.reattach = Object.freeze(reattach);
  }
  return Object.freeze(out);
}

export function parseHostPluginManifest(input: unknown): HostPluginManifest {
  const obj = strictObject(input, [
    "schemaVersion",
    "hostId",
    "integration",
    "pluginName",
    "pluginVersion",
    "launch",
    "entry",
    "capabilities",
    "boot",
  ]);
  if (obj["schemaVersion"] !== 1 || obj["pluginName"] !== "realm") {
    reject();
  }
  const hostId = obj["hostId"];
  if (typeof hostId !== "string" || !(HOST_IDS as readonly string[]).includes(hostId)) {
    return reject();
  }
  const integrationValue = obj["integration"];
  if (integrationValue !== "extension" && integrationValue !== "mcp-config") {
    return reject();
  }
  const integration: IntegrationKind = integrationValue;
  const pluginVersion = obj["pluginVersion"];
  if (typeof pluginVersion !== "string" || !VERSION_PATTERN.test(pluginVersion)) {
    return reject();
  }
  const capabilities = parseCapabilities(obj["capabilities"]);
  for (const request of capabilities) {
    if (!isWithinCeiling(integration, request)) {
      reject();
    }
  }
  const base = {
    schemaVersion: 1 as const,
    hostId: hostId as HostId,
    integration,
    pluginName: "realm" as const,
    pluginVersion,
    capabilities,
  };
  if (integration === "mcp-config") {
    if (obj["launch"] === undefined || obj["entry"] !== undefined) {
      reject();
    }
    const launch = parseLaunch(obj["launch"]);
    return Object.freeze(obj["boot"] === undefined ? { ...base, launch } : { ...base, launch, boot: parseBoot(obj["boot"]) });
  }
  if (obj["entry"] === undefined || obj["launch"] !== undefined) {
    reject();
  }
  const entry = parseEntry(obj["entry"]);
  return Object.freeze(
    obj["boot"] === undefined ? { ...base, entry } : { ...base, entry, boot: parseBoot(obj["boot"]) },
  );
}

const MCP_CAPABILITIES: readonly HostCapability[] = ["daemon.attach", "fs.read", "fs.write", "fs.list", "exec.argv", "exec.shell"];
const OMP_CAPABILITIES: readonly HostCapability[] = [...MCP_CAPABILITIES, "host.tools.restrict"];
// The value package.json already declares in omp.extensions, without the leading "./".
const OMP_ENTRY = "dist/src/omp/extension.js";

// The manifest the installer uses for a host. Always passes parseHostPluginManifest. An mcp-config host launches
// `realm mcp --host <id>`, so the session names the host it serves (presence, boot reports).
export function defaultManifestFor(id: HostId, pluginVersion: string): HostPluginManifest {
  const runtime = HOST_RUNTIMES[id];
  const capabilities = (runtime.integration === "extension" ? OMP_CAPABILITIES : MCP_CAPABILITIES).map((capability) => ({ capability }));
  return parseHostPluginManifest(
    runtime.integration === "extension"
      ? { schemaVersion: 1, hostId: id, integration: "extension", pluginName: "realm", pluginVersion, entry: OMP_ENTRY, capabilities }
      : {
          schemaVersion: 1,
          hostId: id,
          integration: "mcp-config",
          pluginName: "realm",
          pluginVersion,
          launch: { command: "realm", args: ["mcp", "--host", id] },
          capabilities,
        },
  );
}
