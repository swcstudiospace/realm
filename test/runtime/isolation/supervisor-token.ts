// Test fixtures for the gateway's launch material: a gateway-style Ed25519 key, the verification key a launch body carries, and
// launch bodies in the gateway's JSON shape. A negative case builds its body by hand, so a refusal does not depend on the
// decoder's own code.

import { generateKeyPairSync } from "node:crypto";

// The gateway id the realm's gateway configuration renders, and the one every driver in these tests is pinned to.
export const GATEWAY_ID = "realm";
// The session the launch material names: a canonical lowercase non-nil UUID, as the gateway writes it.
export const LAUNCH_SESSION_ID = "5a3c1f7e-9b2d-4e8a-8c61-3d7f0e2b4a19";
const GENERATION_ID = "generation-1";
// An expiry far beyond any test run, so the launch material never lapses during a test.
const FAR_FUTURE_SECONDS = 4102444800;

export interface GatewayKey {
  readonly keyId: string;
  readonly publicPem: Uint8Array;
}

// A fresh Ed25519 key. The key id defaults to one fixed value, so two keys made with the default share an id on purpose.
export function generateGatewayKey(keyId: string = "gateway-key-1"): GatewayKey {
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ format: "pem", type: "spki" });
  return { keyId, publicPem: Buffer.from(publicPem as string, "utf8") };
}

// The supervisor half of a valid launch body: a session, its generation and rotation, the epoch, two tokens that expire far in the
// future, and the SSH host key the gateway sends with the supervisor's SSH socket. An override replaces one field; an override of undefined removes it.
export function launchSupervisor(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    session_id: LAUNCH_SESSION_ID,
    runtime_generation: GENERATION_ID,
    session_rotation: 1,
    auth_epoch: 1,
    gateway_token: "gateway-token-1",
    gateway_expires_at: FAR_FUTURE_SECONDS,
    sandbox_token: "sandbox-token-1",
    sandbox_expires_at: FAR_FUTURE_SECONDS,
    ssh_host_private_key: "ssh-host-key-1",
    ...overrides,
  };
}

// The gateway's JSON encoding of SandboxLaunchAuthentication for the key: the supervisor, the pinned gateway id, and the key as
// its PEM bytes. An override replaces a top-level field; an override of undefined removes it.
export function launchBody(key: GatewayKey, overrides: Readonly<Record<string, unknown>> = {}): Buffer {
  const body = {
    supervisor: launchSupervisor(),
    gateway_id: GATEWAY_ID,
    verification_keys: [{ key_id: key.keyId, public_key_pem: Array.from(key.publicPem) }],
    ...overrides,
  };
  return Buffer.from(JSON.stringify(body), "utf8");
}
