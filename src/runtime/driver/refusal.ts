// The refusal log of the compute driver (phase 9.5). Every refusal that the create check (planCreate) or the launch-material decoder
// raises writes one line: the RPC it arrived on, the check that refused it, and the catalogue code. The RPC and the check are closed
// sets of constant names, so a line never carries a value, a path, a key or a token. An operator reads the check name to see why a
// create was refused.

import { makeRealmError, type RealmError } from "../../core/errors.js";

// The driver entry point a refusal arrived on. Both are compute RPCs.
export const DRIVER_RPCS = ["ValidateSandboxCreate", "CreateSandbox"] as const;
export type DriverRpc = (typeof DRIVER_RPCS)[number];

// The checks that refuse a create. Each names one rule, and none names a value.
export const REFUSAL_CHECKS = [
  "create.sandbox",
  "create.identity",
  "create.workspace",
  "create.spec",
  "create.image",
  "create.gpu",
  "create.resources",
  "create.runtime_config",
  "create.user_namespaces",
  "create.isolation_backend",
  "create.environment",
  "create.command",
  "create.launch_authentication",
  "launch.json",
  "launch.fields",
  "launch.supervisor",
  "launch.session_id",
  "launch.runtime_generation",
  "launch.session_rotation",
  "launch.auth_epoch",
  "launch.token",
  "launch.expires_at",
  "launch.gateway_id",
  "launch.verification_keys",
  "launch.key_id",
  "launch.key_bytes",
  "launch.key_material",
] as const;
export type RefusalCheck = (typeof REFUSAL_CHECKS)[number];

// Receives one refusal line without its newline. The driver writes to stderr unless a caller injects another sink.
export type RefusalLog = (line: string) => void;

export interface RefusalScope {
  readonly rpc: DriverRpc;
  readonly log: RefusalLog;
}

export function stderrRefusalLog(line: string): void {
  process.stderr.write(`${line}\n`);
}

// The scope of one RPC: its name, and the sink the driver was configured with (stderr when none).
export function refusalScope(rpc: DriverRpc, log: RefusalLog | undefined): RefusalScope {
  return { rpc, log: log ?? stderrRefusalLog };
}

// Writes the refusal line and returns the error to throw. Every such refusal carries SCHEMA_INVALID.
export function refusal(scope: RefusalScope, check: RefusalCheck): RealmError {
  scope.log(`realm compute driver refused: rpc=${scope.rpc} check=${check} code=SCHEMA_INVALID`);
  return makeRealmError("SCHEMA_INVALID");
}
