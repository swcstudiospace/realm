// The refusal log of the compute driver (phase 9.5). Every refusal that the create check (planCreate), the launch-material decoder,
// or a create stage (compute-driver.ts) raises writes one line: the RPC it arrived on, the check that refused it,
// and the catalogue code. The RPC and the check are closed sets of constant names, so a line never carries a value, a path, a key
// or a token. An operator reads the check name to see why a create was refused.

import { makeRealmError, RealmError, type ErrorCode } from "../../core/errors.js";

// The driver entry point a refusal arrived on. Both are compute RPCs.
export const DRIVER_RPCS = ["ValidateSandboxCreate", "CreateSandbox"] as const;
export type DriverRpc = (typeof DRIVER_RPCS)[number];

// The checks that refuse a create. Each names one rule, and none names a value.
export const REFUSAL_CHECKS = [
  "create.sandbox",
  "create.identity",
  "create.workspace",
  // No live sandbox of this driver still runs on the pinned root, and no other create holds it.
  "create.pinned_root_held",
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
  // The state directory is new, and its root exists or was created for it.
  "create.state_dir",
  // The sandbox's secret directory does not exist yet.
  "create.secret_dir",
  // The control socket path fits a unix socket address on the host and in the container.
  "create.socket_path",
  // The launch material is written to the secret directory.
  "create.launch_material",
  // The channel directory, the runtime's TLS identity and its channel are built.
  "create.channel",
  // The bootstrap and the descriptor agree before the lifecycle runs.
  "create.runtime_files",
  // The lifecycle creates the container, and the runtime's files are written before it starts.
  "create.container",
  // The runtime's listener, the removal of its key, and the host supervisor start.
  "create.start",
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

function stderrRefusalLog(line: string): void {
  process.stderr.write(`${line}\n`);
}

// The scope of one RPC: its name, and the sink the driver was configured with (stderr when none).
export function refusalScope(rpc: DriverRpc, log: RefusalLog | undefined): RefusalScope {
  return { rpc, log: log ?? stderrRefusalLog };
}

// Writes the refusal line for a check. The line names the RPC, the check and the code, and no value.
function logRefusal(scope: RefusalScope, check: RefusalCheck, code: ErrorCode): void {
  scope.log(`realm compute driver refused: rpc=${scope.rpc} check=${check} code=${code}`);
}

// Writes the refusal line and returns the error to throw. A refusal carries SCHEMA_INVALID unless the caller names the code of
// the state it refuses on, and that code is logged too.
export function refusal(scope: RefusalScope, check: RefusalCheck, code: ErrorCode = "SCHEMA_INVALID"): RealmError {
  logRefusal(scope, check, code);
  return makeRealmError(code);
}

// Logs a stage's refusal when the error the stage raised is SCHEMA_INVALID. The check names the stage. Any other error writes nothing.
export function logStageRefusal(scope: RefusalScope, check: RefusalCheck, error: unknown): void {
  if (error instanceof RealmError && error.code === "SCHEMA_INVALID") {
    logRefusal(scope, check, "SCHEMA_INVALID");
  }
}
