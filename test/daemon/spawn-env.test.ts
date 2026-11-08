import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import { daemonSpawnEnv } from "../../src/daemon/spawn-env.js";
import { launchFilteredDaemon, runCli, startDetachedDaemon, type ConnectDaemon } from "../../src/cli/main.js";

const SENTINEL = "REALM_SENTINEL_MUST_NOT_LEAK";

// The exact names daemonSpawnEnv keeps, besides the REALM_HOST_PIN_ prefix. The gateway endpoint and its CA are not among them (ONB-04).
const ALLOWED_NAMES = [
  "PATH",
  "HOME",
  "XDG_RUNTIME_DIR",
  "XDG_CONFIG_HOME",
  "REALM_DRIVER_SOCKET",
  "REALM_DRIVER_SUPERVISOR_BINARY",
  "REALM_DRIVER_SUPERVISOR_SHA256",
  "REALM_LOG_LEVEL",
] as const;
const HOST_PIN_NAMES = ["REALM_HOST_PIN_PODMAN_SHA256", "REALM_HOST_PIN_OPENSHELL_VERSION"] as const;
const REFUSED_NAMES = [
  "REALM_DRIVER_GATEWAY_ENDPOINT",
  "REALM_DRIVER_GATEWAY_CA",
  "ANTHROPIC_API_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "REALM_DRIVER_SECRET_ROOT",
  "REALM_DRIVER_STATE_ROOT",
  "REALM_DRIVER_WORKSPACE_ROOT",
  "UNDEFINED_NAME",
] as const;

// What a child wrote about its environment. A value is null when the variable was absent.
type ChildEnv = {
  readonly sentinel: string | null;
  readonly socket: string | null;
  readonly gateway: string | null;
  readonly ca: string | null;
  readonly level: string | null;
  readonly staleSecretRoot: string | null;
};

// The child writes the file through a temporary name and renames it into place, so the path only ever
// holds a complete object. The test reads that path and nothing else.
function script(outPath: string): string {
  return [
    "import { writeFileSync, renameSync } from 'node:fs';",
    `const tmp = ${JSON.stringify(`${outPath}.tmp`)};`,
    `writeFileSync(tmp, JSON.stringify({ sentinel: process.env.${SENTINEL} ?? null, socket: process.env.REALM_DRIVER_SOCKET ?? null, gateway: process.env.REALM_DRIVER_GATEWAY_ENDPOINT ?? null, ca: process.env.REALM_DRIVER_GATEWAY_CA ?? null, level: process.env.REALM_LOG_LEVEL ?? null, staleSecretRoot: process.env.REALM_DRIVER_SECRET_ROOT ?? null }));`,
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

// The child is a real detached process. The renamed file is the signal: waitFor reads that one path, only once it
// exists, and parses it, so it never sees a partly written object. The sleep only polls for the file.
async function waitFor(path: string): Promise<unknown> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    if (existsSync(path)) {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return parsed;
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
    REALM_DRIVER_GATEWAY_CA: "/run/realm/ca.crt",
    REALM_LOG_LEVEL: "error",
    [SENTINEL]: "leak",
    REALM_DRIVER_SECRET_ROOT: "/stale/secrets",
  };
  launchFilteredDaemon(cliEntry, stateDir, source);
  const restored = [
    SENTINEL,
    "REALM_DRIVER_SOCKET",
    "REALM_DRIVER_GATEWAY_ENDPOINT",
    "REALM_DRIVER_GATEWAY_CA",
    "REALM_LOG_LEVEL",
    "REALM_DRIVER_SECRET_ROOT",
  ] as const;
  const previous = new Map(restored.map((name) => [name, process.env[name]]));
  const assigned = {
    [SENTINEL]: "leak",
    REALM_DRIVER_SOCKET: "/run/realm/driver.sock",
    REALM_DRIVER_GATEWAY_ENDPOINT: "https://127.0.0.1:17671",
    REALM_DRIVER_GATEWAY_CA: "/run/realm/ca.crt",
    REALM_LOG_LEVEL: "error",
    REALM_DRIVER_SECRET_ROOT: "/stale/secrets",
  };
  for (const name of restored) {
    process.env[name] = assigned[name];
  }
  try {
    startDetachedDaemon(ompEntry, stateDir);
    const cli = (await waitFor(cliOut)) as ChildEnv;
    const omp = (await waitFor(ompOut)) as ChildEnv;
    assert.equal(cli.sentinel, null);
    assert.equal(cli.socket, "/run/realm/driver.sock");
    assert.equal(cli.gateway, null);
    assert.equal(cli.ca, null);
    assert.equal(cli.level, "error");
    assert.equal(cli.staleSecretRoot, null);
    assert.equal(omp.sentinel, null);
    assert.equal(omp.socket, "/run/realm/driver.sock");
    assert.equal(omp.gateway, null);
    assert.equal(omp.ca, null);
    assert.equal(omp.level, "error");
    assert.equal(omp.staleSecretRoot, null);
  } finally {
    for (const name of restored) {
      const prior = previous.get(name);
      if (prior === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = prior;
      }
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
  const seen = (await waitFor(out)) as Pick<ChildEnv, "socket">;
  assert.equal(seen.socket, socket);
});

void test("daemonSpawnEnv keeps exactly the allowlisted names and the host-pin prefix", () => {
  const source: Record<string, string | undefined> = {};
  for (const name of [...ALLOWED_NAMES, ...HOST_PIN_NAMES, ...REFUSED_NAMES]) {
    source[name] = `value-of-${name}`;
  }
  source["UNDEFINED_NAME"] = undefined;
  const selected = daemonSpawnEnv(source);
  assert.deepEqual(Object.keys(selected).sort(), [...ALLOWED_NAMES, ...HOST_PIN_NAMES].sort());
  for (const name of REFUSED_NAMES) {
    assert.equal(Object.hasOwn(selected, name), false, `${name} must not be selected`);
  }
});

void test("daemonSpawnEnv skips undefined values and returns a fresh object each call", () => {
  const source = { PATH: "/usr/bin", HOME: undefined, REALM_LOG_LEVEL: "error" };
  const first = daemonSpawnEnv(source);
  const second = daemonSpawnEnv(source);
  assert.deepEqual(first, { PATH: "/usr/bin", REALM_LOG_LEVEL: "error" });
  assert.equal(Object.values(first).every((value) => typeof value === "string"), true);
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
});

void test("ONB-07: a real daemon started by runCli up with the default spawn sees no sentinel and no stale root", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "realm-spawn-cli-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const stateDir = join(dir, "state");
  mkdirSync(stateDir, { mode: 0o700 });
  const out = join(dir, "cli-up-env.json");
  const probeEntry = join(dir, "probe-entry.mjs");
  writeFileSync(probeEntry, script(out));
  // No daemon answers: every status probe reports an absent socket, so runCli spawns the entry once with the
  // default spawn and then runs out of time. The probe entry is not a daemon, so it writes its file and exits.
  const connect: ConnectDaemon = () => ({
    status: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
    up: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
    call: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
    metrics: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
    close: () => undefined,
  });
  const result = await runCli(["up", "--workspace", dir], {
    env: {
      PATH: "/usr/bin",
      HOME: dir,
      XDG_RUNTIME_DIR: dir,
      XDG_CONFIG_HOME: dir,
      REALM_DRIVER_SOCKET: "/run/realm/driver.sock",
      REALM_DRIVER_SECRET_ROOT: "/stale/secrets",
      [SENTINEL]: "leak",
    },
    readConfig: () => ({
      image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
      stateDir,
      workspaceRoot: dir,
    }),
    daemonEntry: probeEntry,
    runCommand: () => Promise.resolve({ exitCode: 0, stdout: "podman version 5.5.0\n" }),
    connectSocket: () => Promise.resolve(),
    connect,
    send: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
    timeoutMs: 400,
  });
  assert.notEqual(result.exitCode, 0);
  const seen = (await waitFor(out)) as ChildEnv;
  assert.equal(seen.sentinel, null);
  assert.equal(seen.staleSecretRoot, null);
  assert.equal(seen.socket, "/run/realm/driver.sock");
});
