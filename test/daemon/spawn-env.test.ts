import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchFilteredDaemon, startDetachedDaemon } from "../../src/cli/main.js";

const SENTINEL = "REALM_SENTINEL_MUST_NOT_LEAK";

function script(outPath: string): string {
  return [
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync(${JSON.stringify(outPath)}, JSON.stringify({ sentinel: process.env.${SENTINEL} ?? null, socket: process.env.REALM_DRIVER_SOCKET ?? null, gateway: process.env.REALM_DRIVER_GATEWAY_ENDPOINT ?? null }));`,
  ].join("\n");
}

// The child is a real detached process. The file it writes is the signal; the sleep only polls for that file.
async function waitFor(path: string): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (existsSync(path)) {
      return readFileSync(path, "utf8");
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error(`child did not write ${path}`);
}

void test("a sentinel variable does not reach the daemon on the CLI spawn or startDetachedDaemon", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "realm-spawn-env-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const stateDir = join(dir, "state");
  const cliOut = join(dir, "cli-env.json");
  const ompOut = join(dir, "omp-env.json");
  const cliEntry = join(dir, "cli-entry.mjs");
  const ompEntry = join(dir, "omp-entry.mjs");
  writeFileSync(cliEntry, script(cliOut));
  writeFileSync(ompEntry, script(ompOut));
  const source = {
    PATH: "/usr/bin",
    REALM_DRIVER_SOCKET: "/run/realm/driver.sock",
    REALM_DRIVER_GATEWAY_ENDPOINT: "https://127.0.0.1:17671",
    [SENTINEL]: "leak",
    REALM_DRIVER_SECRET_ROOT: "/stale/secrets",
  };
  launchFilteredDaemon(cliEntry, stateDir, source);
  const previous = process.env[SENTINEL];
  const previousGateway = process.env.REALM_DRIVER_GATEWAY_ENDPOINT;
  process.env[SENTINEL] = "leak";
  process.env.REALM_DRIVER_SOCKET = "/run/realm/driver.sock";
  process.env.REALM_DRIVER_GATEWAY_ENDPOINT = "https://127.0.0.1:17671";
  try {
    startDetachedDaemon(ompEntry, stateDir);
    const cli = JSON.parse(await waitFor(cliOut)) as { sentinel: string | null; socket: string | null; gateway: string | null };
    const omp = JSON.parse(await waitFor(ompOut)) as { sentinel: string | null; socket: string | null; gateway: string | null };
    assert.equal(cli.sentinel, null);
    assert.equal(cli.socket, "/run/realm/driver.sock");
    assert.equal(cli.gateway, "https://127.0.0.1:17671");
    assert.equal(omp.sentinel, null);
    assert.equal(omp.socket, "/run/realm/driver.sock");
    assert.equal(omp.gateway, "https://127.0.0.1:17671");
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, SENTINEL);
    } else {
      process.env[SENTINEL] = previous;
    }
    if (previousGateway === undefined) {
      Reflect.deleteProperty(process.env, "REALM_DRIVER_GATEWAY_ENDPOINT");
    } else {
      process.env.REALM_DRIVER_GATEWAY_ENDPOINT = previousGateway;
    }
  }
});
