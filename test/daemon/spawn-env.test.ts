import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchFilteredDaemon, startDetachedDaemon } from "../../src/cli/main.js";

const SENTINEL = "REALM_SENTINEL_MUST_NOT_LEAK";

// The child writes the file through a temporary name and renames it into place, so the path only ever
// holds a complete object. The test reads that path and nothing else.
function script(outPath: string): string {
  return [
    "import { writeFileSync, renameSync } from 'node:fs';",
    `const tmp = ${JSON.stringify(`${outPath}.tmp`)};`,
    `writeFileSync(tmp, JSON.stringify({ sentinel: process.env.${SENTINEL} ?? null, socket: process.env.REALM_DRIVER_SOCKET ?? null, gateway: process.env.REALM_DRIVER_GATEWAY_ENDPOINT ?? null, level: process.env.REALM_LOG_LEVEL ?? null }));`,
    `renameSync(tmp, ${JSON.stringify(outPath)});`,
  ].join("\n");
}

// The socket value holds a closing brace, so the first half of the object already ends with one. The child
// writes the two halves through the temporary file and renames it only when both are written. The delay is the
// real partial-write window in a detached child process; fake timers cannot run inside that child.
function braceScript(outPath: string): string {
  return [
    "import { writeFileSync, appendFileSync, renameSync } from 'node:fs';",
    `const tmp = ${JSON.stringify(`${outPath}.tmp`)};`,
    "const payload = JSON.stringify({ socket: process.env.REALM_DRIVER_SOCKET ?? null });",
    "const cut = payload.indexOf('}') + 1;",
    "writeFileSync(tmp, payload.slice(0, cut));",
    "setTimeout(() => {",
    "  appendFileSync(tmp, payload.slice(cut));",
    `  renameSync(tmp, ${JSON.stringify(outPath)});`,
    "}, 150);",
  ].join("\n");
}

// The child is a real detached process. The renamed file is the signal; the sleep only polls for that file.
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
    REALM_LOG_LEVEL: "error",
    [SENTINEL]: "leak",
    REALM_DRIVER_SECRET_ROOT: "/stale/secrets",
  };
  launchFilteredDaemon(cliEntry, stateDir, source);
  const previous = process.env[SENTINEL];
  const previousGateway = process.env.REALM_DRIVER_GATEWAY_ENDPOINT;
  const previousLevel = process.env.REALM_LOG_LEVEL;
  process.env[SENTINEL] = "leak";
  process.env.REALM_DRIVER_SOCKET = "/run/realm/driver.sock";
  process.env.REALM_DRIVER_GATEWAY_ENDPOINT = "https://127.0.0.1:17671";
  process.env.REALM_LOG_LEVEL = "error";
  try {
    startDetachedDaemon(ompEntry, stateDir);
    const cli = JSON.parse(await waitFor(cliOut)) as { sentinel: string | null; socket: string | null; gateway: string | null; level: string | null };
    const omp = JSON.parse(await waitFor(ompOut)) as { sentinel: string | null; socket: string | null; gateway: string | null; level: string | null };
    assert.equal(cli.sentinel, null);
    assert.equal(cli.socket, "/run/realm/driver.sock");
    assert.equal(cli.gateway, "https://127.0.0.1:17671");
    assert.equal(cli.level, "error");
    assert.equal(omp.sentinel, null);
    assert.equal(omp.socket, "/run/realm/driver.sock");
    assert.equal(omp.gateway, "https://127.0.0.1:17671");
    assert.equal(omp.level, "error");
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
    if (previousLevel === undefined) {
      Reflect.deleteProperty(process.env, "REALM_LOG_LEVEL");
    } else {
      process.env.REALM_LOG_LEVEL = previousLevel;
    }
  }
});

void test("a closing brace inside a string value round-trips through waitFor (Q0-014)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "realm-spawn-brace-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const out = join(dir, "brace-env.json");
  const entry = join(dir, "brace-entry.mjs");
  writeFileSync(entry, braceScript(out));
  const socket = "/run/realm/}.sock";
  launchFilteredDaemon(entry, join(dir, "state"), { PATH: "/usr/bin", REALM_DRIVER_SOCKET: socket });
  const seen = JSON.parse(await waitFor(out)) as { socket: string | null };
  assert.equal(seen.socket, socket);
});
