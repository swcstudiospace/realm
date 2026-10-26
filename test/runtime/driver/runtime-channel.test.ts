// The runtime channel: the bootstrap and the descriptor agree, and the host supervisor is started with exactly its arguments and
// environment, with no secret value in either. No test reads source text.

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { RealmError } from "../../../src/core/errors.js";
import { ComputeDriver } from "../../../src/runtime/driver/compute-driver.js";
import type { JsonValue } from "../../../src/runtime/driver/isolation/json.js";
import {
  assertRuntimeFilesAgree,
  buildRuntimeChannel,
  type JsonOut,
  type RuntimeChannelInput,
} from "../../../src/runtime/driver/runtime-channel.js";
import { GATEWAY_ID } from "../isolation/supervisor-token.js";
import {
  FakeLibpod,
  FakeLifecycle,
  FakeRuntime,
  GATEWAY_CA_PATH,
  GATEWAY_ENDPOINT,
  SANDBOX_IMAGE,
  SUPERVISOR_BINARY,
  driverConfig,
  validSandbox,
} from "./fakes.js";
import { GATEWAY_LAUNCH_SAMPLE, GATEWAY_PUBLIC_KEY_PEM } from "./gateway-launch-sample.js";

// The session the gateway launch sample names.
const SAMPLE_SESSION_ID = "2f8e68e3-5a95-4ceb-a3fb-6ea438ca82b4";

function channelInput(): RuntimeChannelInput {
  return {
    sandboxId: "sandbox-1",
    containerName: "realm-session-1",
    image: SANDBOX_IMAGE,
    gatewayId: GATEWAY_ID,
    supervisor: {
      sessionId: SAMPLE_SESSION_ID,
      runtimeGeneration: "g0000000000000001",
      sessionRotation: "1",
      authEpoch: "1",
      bundle: new Map<string, JsonValue>([["gateway_token", "fixture-gateway-token"]]),
      hasSshHostPrivateKey: true,
    },
    verificationKeys: [{ keyId: "key-1", publicKeyPem: GATEWAY_PUBLIC_KEY_PEM }],
    serverName: `sandbox.${SAMPLE_SESSION_ID}.openshell.internal`,
    trustAnchorPem: "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n",
    controlSocketHostPath: "/realm-state/secrets/realm-session-1/channel/control.sock",
    evidenceDigest: "a".repeat(64),
  };
}

void test("the bootstrap and the descriptor built from one input agree, and assertRuntimeFilesAgree accepts the pair", () => {
  const channel = buildRuntimeChannel(channelInput());
  assert.doesNotThrow(() => {
    assertRuntimeFilesAgree(channel.bootstrap, channel.descriptor);
  });
});

// The create path builds both documents from one input, so a mismatch cannot arise through it. These cases call the check
// directly with a descriptor altered in one agreed field.
const DISAGREEMENTS: readonly [string, JsonOut, string][] = [
  ["boundary_id", "sandbox-other", "sandbox-other"],
  ["generation", "g0000000000000002", "g0000000000000002"],
  ["session_id", "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000001"],
  [
    "workload_identity",
    { uid: 0, gid: 0, supplementary_gids: [], source: "host-root", resource_digest: "0" },
    "host-root",
  ],
  ["resource_claims", { container: "realm-other-container" }, "realm-other-container"],
  [
    "provisioning_evidence",
    { generation: "g0000000000000001", evidence_digest: "b".repeat(64) },
    "b".repeat(64),
  ],
];

for (const [field, value, needle] of DISAGREEMENTS) {
  void test(`assertRuntimeFilesAgree refuses a descriptor whose ${field} differs from the bootstrap, and names no value`, () => {
    const channel = buildRuntimeChannel(channelInput());
    const altered = { ...channel.descriptor, [field]: value };
    assert.throws(
      () => {
        assertRuntimeFilesAgree(channel.bootstrap, altered);
      },
      (error: unknown) =>
        error instanceof RealmError && error.code === "SCHEMA_INVALID" && !error.message.includes(needle),
    );
  });
}

void test("the host supervisor is started with exactly its listed arguments and six environment variables, and no secret reaches either", async () => {
  const config = driverConfig();
  const runtime = new FakeRuntime();
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(config, { lifecycle: new FakeLifecycle(libpod), libpod, runtime });
  const sample = { ...validSandbox(), spec: { ...validSandbox().spec, launch_authentication: Buffer.from(GATEWAY_LAUNCH_SAMPLE, "utf8") } };
  await driver.createSandbox(sample);
  const [spawn] = runtime.spawns;
  assert.ok(spawn !== undefined);
  const secretDir = join(config.secretRoot, "realm-session-1");
  assert.equal(spawn.binary, SUPERVISOR_BINARY);
  assert.deepEqual(spawn.args, [
    "--role",
    "isolation-backend",
    "--sandbox-id",
    "sandbox-1",
    "--sandbox",
    "realm-session-1",
    "--openshell-endpoint",
    GATEWAY_ENDPOINT,
    "--ssh-socket-path",
    join(secretDir, "ssh", "ssh.sock"),
    "--backend-descriptor-file",
    join(secretDir, "descriptor.json"),
    "--auth-bundle-file",
    join(secretDir, "auth.json"),
    "--main-exit-marker",
    join(secretDir, "main-exit"),
    "--parent-liveness-stdin",
  ]);
  const sshSocket = spawn.args[spawn.args.indexOf("--ssh-socket-path") + 1];
  assert.ok(sshSocket !== undefined);
  assert.equal(sshSocket.startsWith(join(secretDir, "channel") + "/"), false, "the SSH socket is not under the channel directory");
  assert.equal(sshSocket.startsWith(join(secretDir, "tls") + "/"), false, "the SSH socket is not under the TLS work directory");
  assert.deepEqual(spawn.env, {
    OPENSHELL_ADMITTED_ISOLATION_BACKEND: "openshell-sandbox",
    OPENSHELL_SANDBOX_ID: "sandbox-1",
    OPENSHELL_SANDBOX: "realm-session-1",
    OPENSHELL_ENDPOINT: GATEWAY_ENDPOINT,
    OPENSHELL_TLS_CA: GATEWAY_CA_PATH,
    OPENSHELL_CONTAINER_IMAGE: SANDBOX_IMAGE,
  });
  const shown = JSON.stringify({ args: spawn.args, env: spawn.env });
  for (const secret of [
    "fixture-gateway-token",
    "fixture-sandbox-token",
    "fixture-ssh-host-key",
    "fixture-otlp-headers",
    "MCowBQYDK2VwAyEAbf5bs35b/DAXIbngI3JfMHeE4fPoDj7AWH/xcedrdQg=",
  ]) {
    assert.equal(shown.includes(secret), false);
  }
});

void test("a supervisor spawn without the SSH host key is refused with SCHEMA_INVALID, and no supervisor starts (phase 9.6)", async () => {
  const config = driverConfig();
  const runtime = new FakeRuntime();
  const libpod = new FakeLibpod();
  const driver = new ComputeDriver(config, { lifecycle: new FakeLifecycle(libpod), libpod, runtime });
  const keyless = GATEWAY_LAUNCH_SAMPLE.replace('"ssh_host_private_key":"fixture-ssh-host-key",', "");
  assert.notEqual(keyless, GATEWAY_LAUNCH_SAMPLE, "the sample carries the key the test removes");
  const sample = { ...validSandbox(), spec: { ...validSandbox().spec, launch_authentication: Buffer.from(keyless, "utf8") } };
  await assert.rejects(driver.createSandbox(sample), (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID");
  assert.equal(runtime.spawns.length, 0, "no supervisor is spawned");
  assert.equal(JSON.stringify(runtime.spawns).includes("fixture-ssh-host-key"), false);
});
