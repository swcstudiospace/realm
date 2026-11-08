// The environment a detached daemon may inherit (ONB-07, D-1505). Both start paths (the CLI spawn and
// startDetachedDaemon) pass this and nothing else. A name that is not on the allowlist, including a stale
// REALM_DRIVER_*_ROOT variable, does not reach the child. The gateway endpoint and its CA are kept: realm
// doctor runs inside the daemon and probes that endpoint with the CA. Phase 15-06 stops that TLS dial and
// must drop REALM_DRIVER_GATEWAY_ENDPOINT and REALM_DRIVER_GATEWAY_CA together; leaving only the CA would
// be a stale pass-through. REALM_LOG_LEVEL is kept so the entry can set the request log level.

import type { EnvironmentLike } from "../session/paths.js";

const ALLOWED_EXACT: Readonly<Record<string, true>> = {
  PATH: true,
  HOME: true,
  XDG_RUNTIME_DIR: true,
  XDG_CONFIG_HOME: true,
  REALM_DRIVER_SOCKET: true,
  REALM_DRIVER_GATEWAY_ENDPOINT: true,
  REALM_DRIVER_GATEWAY_CA: true,
  REALM_DRIVER_SUPERVISOR_BINARY: true,
  REALM_DRIVER_SUPERVISOR_SHA256: true,
  REALM_LOG_LEVEL: true,
};

const HOST_PIN_PREFIX = "REALM_HOST_PIN_";

export function daemonSpawnEnv(source: EnvironmentLike): Readonly<Record<string, string>> {
  const selected: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    if (Object.hasOwn(ALLOWED_EXACT, name) || name.startsWith(HOST_PIN_PREFIX)) {
      selected[name] = value;
    }
  }
  return selected;
}
