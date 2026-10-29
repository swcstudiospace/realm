// A launch body in the shape the gateway writes: serde_json::to_vec(SandboxLaunchAuthentication), from openshell-core/src/jwt.rs. The
// field order and names are the gateway's, the optional supervisor fields are present, and each PEM key is a JSON array of its bytes
// (serde Vec<u8>). It was produced by the gateway's own type, built from a freshly generated Ed25519 key whose private half was
// discarded at once. The tokens and the optional secret values are placeholders, so this file holds only the public key.

// The public half of the sample key, as the gateway stores it: a PEM text with a trailing newline.
export const GATEWAY_PUBLIC_KEY_PEM =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAbf5bs35b/DAXIbngI3JfMHeE4fPoDj7AWH/xcedrdQg=\n-----END PUBLIC KEY-----\n";

const publicKeyBytes = JSON.stringify(Array.from(Buffer.from(GATEWAY_PUBLIC_KEY_PEM, "utf8")));

export const GATEWAY_LAUNCH_SAMPLE =
  `{"supervisor":{"session_id":"2f8e68e3-5a95-4ceb-a3fb-6ea438ca82b4","runtime_generation":"g0000000000000001",` +
  `"session_rotation":1,"auth_epoch":1,"gateway_token":"fixture-gateway-token","gateway_expires_at":1793004954,` +
  `"sandbox_token":"fixture-sandbox-token","sandbox_expires_at":1793004954,"ssh_host_private_key":"fixture-ssh-host-key",` +
  `"ocsf_otlp_headers":"fixture-otlp-headers"},"gateway_id":"realm",` +
  `"verification_keys":[{"key_id":"key-1","public_key_pem":${publicKeyBytes}}]}`;
