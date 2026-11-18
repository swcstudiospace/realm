// The always-running hermetic test of test/support/host-live-kimi.ts (phase 43): no host CLI, no Podman, no network. It pins the fixed
// non-secret key, the Kimi Code session arguments and drive environment, the validator-tier containment and the restored names.

import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { isolatedHostEnv } from "../support/host-live.js";
import { CODEX_FORWARDED_ENV, SESSION_PROMPT } from "../support/host-live-session.js";
import { credentialNamesOf, KIMI_REHEARSAL_KEY, KIMI_REHEARSAL_MODEL, KIMI_RESTORED_ENV, kimiCodeDriveEnv, kimiCodeSessionArgs, kimiContainmentEnv } from "../support/host-live-kimi.js";

function tempDir(t: TestContext): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlk-test-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

void test("the fixed key and model alias are the documented literals", () => {
  assert.equal(KIMI_REHEARSAL_KEY, "rehearsal-key-not-a-secret");
  assert.equal(KIMI_REHEARSAL_MODEL, "rehearsal-model");
});

void test("kimiCodeSessionArgs is the single option -p and the fixed prompt", () => {
  assert.deepEqual(kimiCodeSessionArgs(), ["-p", SESSION_PROMPT]);
  assert.notEqual(kimiCodeSessionArgs(), kimiCodeSessionArgs(), "a fresh list every call");
});

void test("kimiCodeDriveEnv is a frozen record of the model, the fixed key, the loopback base URL and the switches, and never KIMI_CODE_HOME", () => {
  const baseUrl = "http://127.0.0.1:4242/v1";
  const env = kimiCodeDriveEnv(baseUrl);
  assert.ok(Object.isFrozen(env));
  assert.deepEqual(env, {
    KIMI_MODEL_NAME: "rehearsal-model",
    KIMI_MODEL_API_KEY: "rehearsal-key-not-a-secret",
    KIMI_MODEL_BASE_URL: baseUrl,
    KIMI_MODEL_PROVIDER_TYPE: "openai",
    KIMI_DISABLE_TELEMETRY: "1",
    KIMI_CODE_NO_AUTO_UPDATE: "1",
    KIMI_CLI_NO_AUTO_UPDATE: "1",
  });
  assert.equal("KIMI_CODE_HOME" in env, false);
  for (const url of ["https://api.moonshot.ai/v1", "http://localhost:4242/v1", "http://10.0.0.5:80/v1", "http://127.0.0.1", ""]) {
    assert.throws(() => kimiCodeDriveEnv(url), /loopback refusing provider/, url);
  }
});

void test("kimiContainmentEnv switches updates and telemetry off and sends every proxied connection to a dead loopback port, keeping loopback direct", () => {
  const env = kimiContainmentEnv();
  assert.ok(Object.isFrozen(env));
  for (const name of ["KIMI_DISABLE_TELEMETRY", "KIMI_CODE_NO_AUTO_UPDATE", "KIMI_CLI_NO_AUTO_UPDATE"]) {
    assert.equal(env[name], "1", name);
  }
  for (const name of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    assert.equal(env[name], "http://127.0.0.1:9", name);
  }
  for (const name of ["NO_PROXY", "no_proxy"]) {
    assert.equal(env[name], "127.0.0.1,localhost,::1", name);
  }
  assert.deepEqual(Object.keys(env).sort(), ["ALL_PROXY", "HTTPS_PROXY", "HTTP_PROXY", "KIMI_CLI_NO_AUTO_UPDATE", "KIMI_CODE_NO_AUTO_UPDATE", "KIMI_DISABLE_TELEMETRY", "NO_PROXY", "all_proxy", "http_proxy", "https_proxy", "no_proxy"]);
});

void test("KIMI_RESTORED_ENV is the three names of CODEX_FORWARDED_ENV", () => {
  assert.deepEqual([...KIMI_RESTORED_ENV], ["XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "REALM_DRIVER_SOCKET"]);
  assert.deepEqual([...KIMI_RESTORED_ENV], [...CODEX_FORWARDED_ENV]);
});

void test("credentialNamesOf returns the sorted names that look like a credential, and no other", () => {
  assert.deepEqual(
    credentialNamesOf({ PATH: "/bin", HOME: "/h", MOONSHOT_API_KEY: "x", KIMI_API_KEY: "y", OPENAI_API_KEY: "z", GITHUB_TOKEN: "t", LANG: "C", KIMI_CODE_HOME: "/k", HTTP_PROXY: "p" }),
    ["GITHUB_TOKEN", "KIMI_API_KEY", "KIMI_CODE_HOME", "MOONSHOT_API_KEY", "OPENAI_API_KEY"],
  );
  assert.deepEqual(credentialNamesOf({ PATH: "/bin", HOME: "/h" }), []);
});

void test("an isolated Kimi Code drive environment holds no credential name but the Kimi configuration names and the one fixed key", (t) => {
  const root = tempDir(t);
  const home = join(root, "kimi-code");
  const isolated = isolatedHostEnv(root, "kimi-code", {
    stubDir: join(root, "stub"),
    source: { LANG: "C.UTF-8", MOONSHOT_API_KEY: "operator-secret", KIMI_API_KEY: "operator-secret", OPENAI_API_KEY: "operator-secret", GITHUB_TOKEN: "operator-secret" },
    overrides: { KIMI_CODE_HOME: home },
  });
  const env = { ...isolated, ...kimiCodeDriveEnv("http://127.0.0.1:4242/v1"), ...kimiContainmentEnv() };
  // Every KIMI_ name is Kimi configuration, not an operator credential: the isolated environment copies nothing but LANG and TERM from the
  // source. A name outside this list (a MOONSHOT_ variable, another _API_KEY or _TOKEN) would show up here.
  assert.deepEqual(credentialNamesOf(env), [
    "KIMI_CLI_NO_AUTO_UPDATE",
    "KIMI_CODE_HOME",
    "KIMI_CODE_NO_AUTO_UPDATE",
    "KIMI_DISABLE_TELEMETRY",
    "KIMI_MODEL_API_KEY",
    "KIMI_MODEL_BASE_URL",
    "KIMI_MODEL_NAME",
    "KIMI_MODEL_PROVIDER_TYPE",
  ]);
  assert.deepEqual(
    credentialNamesOf(env).filter((name) => name.endsWith("_API_KEY") || name.endsWith("_TOKEN") || name.startsWith("MOONSHOT_")),
    ["KIMI_MODEL_API_KEY"],
    "the fixed key is the only key-shaped name",
  );
  assert.equal(env["KIMI_MODEL_API_KEY"], KIMI_REHEARSAL_KEY);
  assert.equal(JSON.stringify(env).includes("operator-secret"), false, "no operator value enters the environment");
  assert.equal(env["KIMI_CODE_HOME"], home);
});
