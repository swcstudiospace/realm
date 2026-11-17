// The boot report a host process sends the daemon through the `host-boot` control method (BOOT-06).
//
// A report is self-reported by the host process: nothing authorizes on it, and the daemon records it as a label
// ("a process claiming host X reported phase Y"). So every field is a closed vocabulary or a bounded integer, and no
// path, session id, daemon text or free string can cross: a hostile process can select a label, never inject text.
// This module owns the vocabulary and the strict parser. It reads no environment and does no I/O.

import { ERROR_CODES, makeRealmError, type ErrorCode } from "../core/errors.js";
import { STATES, type State } from "../core/states.js";
import { isCorrelationId } from "../observe/ids.js";
import { HOST_IDS } from "./types.js";

export const HOST_BOOT_PHASES = Object.freeze(["attached", "refused", "failed", "link-lost", "reattached", "closed"] as const);
export type HostBootPhase = (typeof HOST_BOOT_PHASES)[number];

export const HOST_BOOT_TRANSPORTS = Object.freeze(["extension", "mcp", "acp"] as const);
export type HostBootTransport = (typeof HOST_BOOT_TRANSPORTS)[number];

// The 19 host ids plus the label of a session started with no `--host`.
export const BOOT_REPORT_HOSTS = Object.freeze([...HOST_IDS, "unlabelled"] as const);
export type BootReportHost = (typeof BOOT_REPORT_HOSTS)[number];

export interface HostBootReport {
  readonly schemaVersion: 1;
  readonly bootId: string;
  readonly hostId: BootReportHost;
  readonly transport: HostBootTransport;
  readonly phase: HostBootPhase;
  // Non-null exactly for refused, failed and link-lost.
  readonly code: ErrorCode | null;
  readonly attempt: number;
  readonly durationMs: number;
  readonly state: State | null;
}

const REPORT_KEYS: readonly string[] = [
  "schemaVersion",
  "bootId",
  "hostId",
  "transport",
  "phase",
  "code",
  "attempt",
  "durationMs",
  "state",
];
const PHASES: readonly string[] = HOST_BOOT_PHASES;
const TRANSPORTS: readonly string[] = HOST_BOOT_TRANSPORTS;
const HOSTS: readonly string[] = BOOT_REPORT_HOSTS;
const CODES: readonly string[] = ERROR_CODES;
const STATE_NAMES: readonly string[] = STATES;
// The phases that carry a catalogue code.
const CODED_PHASES: readonly string[] = ["refused", "failed", "link-lost"];
const MAX_ATTEMPT = 9;
const MAX_DURATION_MS = 600_000;

export function isBootPhase(value: unknown): value is HostBootPhase {
  return typeof value === "string" && PHASES.includes(value);
}

export function isBootTransport(value: unknown): value is HostBootTransport {
  return typeof value === "string" && TRANSPORTS.includes(value);
}

export function isBootReportHost(value: unknown): value is BootReportHost {
  return typeof value === "string" && HOSTS.includes(value);
}

function isErrorCodeValue(value: unknown): value is ErrorCode {
  return typeof value === "string" && CODES.includes(value);
}

function isStateValue(value: unknown): value is State {
  return typeof value === "string" && STATE_NAMES.includes(value);
}

function reject(): never {
  throw makeRealmError("SCHEMA_INVALID");
}

// A plain object: a literal or a null-prototype object, never an array or a class instance.
function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Own data properties only: exactly the nine report keys, no symbol, no accessor, no prototype key.
function ownFields(input: unknown): Map<string, unknown> {
  if (!isPlainObject(input)) {
    return reject();
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length !== REPORT_KEYS.length) {
    return reject();
  }
  const fields = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string" || !REPORT_KEYS.includes(key)) {
      return reject();
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      return reject();
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function integerIn(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return reject();
  }
  return value;
}

// Parses one report. Anything outside the closed vocabulary is SCHEMA_INVALID with the catalogue's fixed message:
// nothing about the input is echoed. The result is a frozen copy built from the validated values.
export function parseHostBootReport(input: unknown): HostBootReport {
  const fields = ownFields(input);
  const bootId = fields.get("bootId");
  const hostId = fields.get("hostId");
  const transport = fields.get("transport");
  const phase = fields.get("phase");
  const code = fields.get("code");
  const state = fields.get("state");
  if (
    fields.get("schemaVersion") !== 1 ||
    !isCorrelationId(bootId) ||
    !isBootReportHost(hostId) ||
    !isBootTransport(transport) ||
    !isBootPhase(phase)
  ) {
    return reject();
  }
  // Omp is the only extension host; every other host and the unlabelled session speaks MCP or ACP.
  if ((hostId === "omp") !== (transport === "extension")) {
    return reject();
  }
  let reportedCode: ErrorCode | null = null;
  if (CODED_PHASES.includes(phase)) {
    if (!isErrorCodeValue(code)) {
      return reject();
    }
    reportedCode = code;
  } else if (code !== null) {
    return reject();
  }
  let reportedState: State | null = null;
  if (state !== null) {
    if (!isStateValue(state)) {
      return reject();
    }
    reportedState = state;
  }
  const report: HostBootReport = {
    schemaVersion: 1,
    bootId,
    hostId,
    transport,
    phase,
    code: reportedCode,
    attempt: integerIn(fields.get("attempt"), 1, MAX_ATTEMPT),
    durationMs: integerIn(fields.get("durationMs"), 0, MAX_DURATION_MS),
    state: reportedState,
  };
  return Object.freeze(report);
}
