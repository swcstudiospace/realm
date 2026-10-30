import { test } from "node:test";
import assert from "node:assert/strict";
import type { Stats } from "node:fs";
import { loadRuntimeConfig } from "../../src/runtime/config.js";
import {
  driverSocketCheck,
  gatewayCheck,
  runtimeChecks,
  runtimeRootsCheck,
  type PathReading,
} from "../../src/doctor/runtime-checks.js";

const IMAGE = `ghcr.io/example/realm-agent@sha256:${"a".repeat(64)}`;

function config() {
  return loadRuntimeConfig({
    image: IMAGE,
    stateDir: "/var/lib/realm/state",
    workspaceRoot: "/srv/workspace",
    secretRoot: "/var/lib/realm/secrets",
    sandboxStateRoot: "/var/lib/realm/sandboxes",
  });
}

function directory(mode: number, uid?: number): PathReading {
  return { state: "found", stats: { isDirectory: () => true, isSymbolicLink: () => false, isSocket: () => false, mode, ...(uid === undefined ? {} : { uid }) } as Stats };
}

function socket(mode: number): PathReading {
  return { state: "found", stats: { isDirectory: () => false, isSymbolicLink: () => false, isSocket: () => true, mode } as Stats };
}

function statFor(modes: Readonly<Record<string, PathReading>>): (path: string) => PathReading {
  return (path) => modes[path] ?? { state: "absent" };
}

void test("a missing config is a one-item report whose fix names realm init", async () => {
  const report = await runtimeChecks({ env: {} });
  assert.equal(report.length, 1);
  const item = report[0];
  assert.ok(item);
  assert.equal(item.id, "runtime-roots");
  assert.equal(item.status, "fail");
  assert.match(item.fix ?? "", /realm init/);
});

void test("runtime-roots passes when the three roots are absolute directories at mode 0700", () => {
  const loaded = config();
  const result = runtimeRootsCheck(
    loaded,
    statFor({
      "/var/lib/realm/secrets": directory(0o40700),
      "/srv/workspace": directory(0o40700),
      "/var/lib/realm/sandboxes": directory(0o40700),
    }),
  );
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
});

void test("runtime-roots accepts a workspace at 0755 and rejects one this account does not own", () => {
  const open = runtimeRootsCheck(
    config(),
    statFor({
      "/var/lib/realm/secrets": directory(0o40700),
      "/srv/workspace": directory(0o40755, process.getuid?.()),
      "/var/lib/realm/sandboxes": directory(0o40700),
    }),
  );
  assert.equal(open.status, "pass");
  const foreign = runtimeRootsCheck(
    config(),
    statFor({
      "/var/lib/realm/secrets": directory(0o40700),
      "/srv/workspace": directory(0o40755, (process.getuid?.() ?? 0) + 1),
      "/var/lib/realm/sandboxes": directory(0o40700),
    }),
  );
  assert.equal(foreign.status, "fail");
  assert.match(foreign.detail, /workspaceRoot is not owned by this account/);
});

void test("runtime-roots fails when a root is absent or mode-wrong and names realm init", () => {
  const absent = runtimeRootsCheck(config(), statFor({}));
  assert.equal(absent.status, "fail");
  assert.match(absent.detail, /secretRoot is absent/);
  assert.match(absent.fix ?? "", /realm init/);
  const wrongMode = runtimeRootsCheck(
    config(),
    statFor({
      "/var/lib/realm/secrets": directory(0o40755),
      "/srv/workspace": directory(0o40700),
      "/var/lib/realm/sandboxes": directory(0o40700),
    }),
  );
  assert.equal(wrongMode.status, "fail");
  assert.match(wrongMode.detail, /secretRoot mode is 0755/);
  assert.match(wrongMode.fix ?? "", /realm init/);
});

void test("driver-socket passes when the socket is 0600, its parent is 0700, and it accepts a connection", async () => {
  const result = await driverSocketCheck(
    { REALM_DRIVER_SOCKET: "/run/realm/driver.sock" },
    statFor({
      "/run/realm/driver.sock": socket(0o10600),
      "/run/realm": directory(0o40700),
    }),
    () => Promise.resolve(),
  );
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
});

void test("driver-socket fails when a correctly permissioned socket does not accept a connection", async () => {
  const result = await driverSocketCheck(
    { REALM_DRIVER_SOCKET: "/run/realm/driver.sock" },
    statFor({
      "/run/realm/driver.sock": socket(0o10600),
      "/run/realm": directory(0o40700),
    }),
    () => Promise.reject(new Error("ECONNREFUSED")),
  );
  assert.equal(result.status, "fail");
  assert.match(result.detail, /not accepting connections/);
});

void test("driver-socket fails when the socket is absent or the parent mode is wrong", async () => {
  const absent = await driverSocketCheck({ REALM_DRIVER_SOCKET: "/run/realm/driver.sock" }, statFor({}));
  assert.equal(absent.status, "fail");
  assert.match(absent.detail, /absent/);
  const parent = await driverSocketCheck(
    { REALM_DRIVER_SOCKET: "/run/realm/driver.sock" },
    statFor({
      "/run/realm/driver.sock": socket(0o10600),
      "/run/realm": directory(0o40755),
    }),
  );
  assert.equal(parent.status, "fail");
  assert.match(parent.detail, /parent mode is 0755/);
});

void test("gateway passes when the endpoint accepts a connection and fails when it does not", async () => {
  const passed = await gatewayCheck({ REALM_DRIVER_GATEWAY_ENDPOINT: "https://gateway.example:443" }, () => Promise.resolve(), 50);
  assert.equal(passed.status, "pass");
  assert.equal(passed.fix, null);
  const failed = await gatewayCheck(
    { REALM_DRIVER_GATEWAY_ENDPOINT: "https://gateway.example:443" },
    () => Promise.reject(new Error("refused")),
    50,
  );
  assert.equal(failed.status, "fail");
  assert.match(failed.detail, /unreachable/);
  const unset = await gatewayCheck({}, () => Promise.resolve(), 50);
  assert.equal(unset.status, "fail");
  assert.match(unset.detail, /unset/);
});
