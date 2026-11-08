import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, type Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer, type Server as TlsServer } from "node:tls";
import { loadRuntimeConfig, type RuntimeConfig } from "../../src/runtime/config.js";
import { channelPathsOf } from "../../src/runtime/driver/channel.js";
import { secretDirOf } from "../../src/runtime/driver/secret-store.js";
import { realmSandboxName } from "../../src/runtime/openshell.js";
import {
  defaultConnectGateway,
  driverSocketCheck,
  gatewayCheck,
  runtimeChecks,
  runtimeRootsCheck as checkRoots,
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

function directory(mode: number, uid?: number, symbolicLink = false): PathReading {
  return { state: "found", stats: { isDirectory: () => !symbolicLink, isSymbolicLink: () => symbolicLink, isSocket: () => false, mode, ...(uid === undefined ? {} : { uid }) } as Stats };
}

function socket(mode: number, uid?: number): PathReading {
  return { state: "found", stats: { isDirectory: () => false, isSymbolicLink: () => false, isSocket: () => true, mode, ...(uid === undefined ? {} : { uid }) } as Stats };
}

function statFor(modes: Readonly<Record<string, PathReading>>): (path: string) => PathReading {
  return (path) => modes[path] ?? { state: "absent" };
}

// The roots check with a realpath that reports every path as already canonical.
function runtimeRootsCheck(loaded: RuntimeConfig, stat: (path: string) => PathReading, configPath?: string) {
  return checkRoots(loaded, stat, (path: string) => path, configPath);
}

// The longest host socket path the roots check measures under a secretRoot, in bytes.
function longestSocketBytes(secretRoot: string): number {
  const paths = channelPathsOf(secretDirOf(secretRoot, realmSandboxName("daemon")));
  return Math.max(Buffer.byteLength(paths.controlSocket, "utf8"), Buffer.byteLength(paths.sshSocket, "utf8"));
}

// A healthy stat map for config(): the private roots at 0700 and the workspace owned by this account.
function healthyRoots(): Readonly<Record<string, PathReading>> {
  return {
    "/var/lib/realm/secrets": directory(0o40700),
    "/srv/workspace": directory(0o40755, process.getuid?.()),
    "/var/lib/realm/sandboxes": directory(0o40700),
  };
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

void test("runtime-roots fails when a root is absent or mode-wrong", () => {
  const absent = runtimeRootsCheck(config(), statFor({}));
  assert.equal(absent.status, "fail");
  assert.match(absent.detail, /secretRoot is absent/);
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
});

void test("configured root failures retain their diagnostics without suggesting reinitialization or automatic root repair", () => {
  const loaded = config();
  const conditions: readonly { readonly detail: string; readonly reading: PathReading }[] = [
    { detail: "is absent", reading: { state: "absent" } },
    { detail: "cannot be inspected", reading: { state: "unreadable" } },
    { detail: "is a symbolic link", reading: directory(0o120777, undefined, true) },
    { detail: "is not a directory", reading: socket(0o100600) },
  ];
  for (const key of ["secretRoot", "workspaceRoot", "sandboxStateRoot"] as const) {
    const root = loaded[key];
    assert.ok(root);
    for (const condition of conditions) {
      const result = runtimeRootsCheck(loaded, statFor({
        "/var/lib/realm/secrets": directory(0o40700),
        "/srv/workspace": directory(0o40755, process.getuid?.()),
        "/var/lib/realm/sandboxes": directory(0o40700),
        [root]: condition.reading,
      }));
      assert.equal(result.status, "fail", `${key}: ${condition.detail}`);
      assert.equal(result.detail, `${key} ${condition.detail}`);
      const fix = result.fix ?? "";
      assert.doesNotMatch(fix, /realm init/);
      assert.match(fix, /config\.json/);
      assert.match(fix, /policy\.json/);
      assert.match(fix, /stateDir\/run/);
      assert.match(fix, /stateDir\/sessions/);
      assert.match(fix, /does not repair or provision private roots or the workspace/);
    }
  }
});

void test("private mode failures recommend inspected manual recovery without imposing 0700 on the workspace", () => {
  const result = runtimeRootsCheck(config(), statFor({
    "/var/lib/realm/secrets": directory(0o40755),
    "/srv/workspace": directory(0o40755, process.getuid?.()),
    "/var/lib/realm/sandboxes": directory(0o40750),
  }));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /secretRoot mode is 0755/);
  assert.match(result.detail, /sandboxStateRoot mode is 0750/);
  assert.doesNotMatch(result.detail, /workspaceRoot/);
  assert.doesNotMatch(result.fix ?? "", /realm init/);
  assert.match(result.fix ?? "", /0700/);
  assert.match(result.fix ?? "", /ownership/);
  assert.match(result.fix ?? "", /symlink/);
});

void test("omitted healthy private defaults warn, but missing defaults still fail without reinitialization advice", () => {
  const loaded = loadRuntimeConfig({
    image: IMAGE,
    stateDir: "/var/lib/realm/state",
    workspaceRoot: "/srv/workspace",
  });
  const healthyDefaults = {
    "/var/lib/realm/state/secrets": directory(0o40700),
    "/var/lib/realm/state/sandboxes": directory(0o40700),
    "/srv/workspace": directory(0o40755, process.getuid?.()),
  };
  const warning = runtimeRootsCheck(loaded, statFor(healthyDefaults));
  assert.equal(warning.status, "warn");
  assert.match(warning.detail, /secretRoot not named in config\.json/);
  assert.match(warning.detail, /sandboxStateRoot not named in config\.json/);
  assert.doesNotMatch(warning.fix ?? "", /realm init/);
  assert.match(warning.fix ?? "", /stateDir/);
  const failed = runtimeRootsCheck(loaded, statFor({
    ...healthyDefaults,
    "/var/lib/realm/state/secrets": { state: "absent" },
  }));
  assert.equal(failed.status, "fail");
  assert.match(failed.detail, /secretRoot is absent/);
  assert.match(failed.detail, /sandboxStateRoot not named in config\.json/);
  assert.doesNotMatch(failed.fix ?? "", /realm init/);
});

void test("unusual configured paths never become diagnostic text or executable recovery guidance", () => {
  const loaded = loadRuntimeConfig({
    image: IMAGE,
    stateDir: "/var/lib/realm/state",
    workspaceRoot: "/srv/project with spaces",
    secretRoot: "/srv/$(touch SHOULD_NOT_RUN);'private'\nroot",
    sandboxStateRoot: "/srv/`touch ALSO_NOT_RUN`/sandboxes",
  });
  const conditions: readonly PathReading[] = [
    { state: "absent" },
    { state: "unreadable" },
    directory(0o120777, undefined, true),
    socket(0o100600),
    directory(0o40755, (process.getuid?.() ?? 0) + 1),
  ];
  for (const reading of conditions) {
    const result = runtimeRootsCheck(loaded, statFor({
      [loaded.workspaceRoot]: reading,
      [loaded.secretRoot ?? ""]: reading,
      [loaded.sandboxStateRoot ?? ""]: reading,
    }));
    assert.equal(result.status, "fail");
    assert.match(result.detail, /secretRoot/);
    assert.match(result.detail, /workspaceRoot/);
    assert.match(result.detail, /sandboxStateRoot/);
    assert.doesNotMatch(result.fix ?? "", /realm init/);
    for (const path of [loaded.workspaceRoot, loaded.secretRoot, loaded.sandboxStateRoot]) {
      assert.ok(path);
      assert.equal(result.detail.includes(path), false);
      assert.equal((result.fix ?? "").includes(path), false);
    }
    assert.doesNotMatch(result.fix ?? "", /SHOULD_NOT_RUN|ALSO_NOT_RUN/);
  }
});

void test("ONB-04: the channel socket path under secretRoot fits 107 bytes exactly and a byte longer is refused", () => {
  const base = "/srv/x";
  const fitting = base + "a".repeat(107 - longestSocketBytes(base));
  assert.equal(longestSocketBytes(fitting), 107);
  const tooLong = `${fitting}a`;
  assert.equal(longestSocketBytes(tooLong), 108);
  for (const [root, status] of [[fitting, "pass"], [tooLong, "fail"]] as const) {
    const loaded = loadRuntimeConfig({
      image: IMAGE,
      stateDir: "/var/lib/realm/state",
      workspaceRoot: "/srv/workspace",
      secretRoot: root,
      sandboxStateRoot: "/var/lib/realm/sandboxes",
    });
    const result = runtimeRootsCheck(loaded, statFor({
      ...healthyRoots(),
      [root]: directory(0o40700),
    }));
    assert.equal(result.status, status);
    if (status === "fail") {
      assert.equal(result.detail, "secretRoot is too long for a socket path under session daemon");
      assert.equal(result.detail.includes(root), false);
      assert.equal((result.fix ?? "").includes(root), false);
    }
  }
});

void test("ONB-04: a secretRoot or sandboxStateRoot inside the workspace fails as an overlap", () => {
  const loaded = loadRuntimeConfig({ image: IMAGE, stateDir: "/srv/workspace/state", workspaceRoot: "/srv/workspace" });
  const result = runtimeRootsCheck(loaded, statFor({
    "/srv/workspace": directory(0o40755, process.getuid?.()),
    "/srv/workspace/state/secrets": directory(0o40700),
    "/srv/workspace/state/sandboxes": directory(0o40700),
  }));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /secretRoot overlaps workspaceRoot/);
  assert.match(result.detail, /sandboxStateRoot overlaps workspaceRoot/);
  assert.match(result.detail, /stateDir overlaps workspaceRoot/);
  assert.equal(result.detail.includes("/srv"), false);
});

void test("ONB-04: derived roots that overlap each other fail", () => {
  const loaded = loadRuntimeConfig({ image: IMAGE, stateDir: "/var/lib/realm/state", workspaceRoot: "/srv/workspace", secretRoot: "/var/lib/realm/state/sandboxes/secrets" });
  const result = runtimeRootsCheck(loaded, statFor({
    "/srv/workspace": directory(0o40755, process.getuid?.()),
    "/var/lib/realm/state/sandboxes/secrets": directory(0o40700),
    "/var/lib/realm/state/sandboxes": directory(0o40700),
  }));
  assert.equal(result.status, "fail");
  assert.match(result.detail, /secretRoot overlaps sandboxStateRoot/);
});

void test("ONB-04: config.json inside workspaceRoot fails and the detail names no path", () => {
  const inside = runtimeRootsCheck(config(), statFor(healthyRoots()), "/srv/workspace/.config/realm/config.json");
  assert.equal(inside.status, "fail");
  assert.match(inside.detail, /config\.json is inside workspaceRoot/);
  assert.equal(inside.detail.includes("/srv"), false);
  assert.equal((inside.fix ?? "").includes("/srv"), false);
  const prefixSibling = runtimeRootsCheck(config(), statFor(healthyRoots()), "/srv/workspace-old/config.json");
  assert.equal(prefixSibling.status, "pass");
  const outside = runtimeRootsCheck(config(), statFor(healthyRoots()), "/home/realm/.config/realm/config.json");
  assert.equal(outside.status, "pass");
});

void test("ONB-04: a root that is not canonical fails", () => {
  const result = checkRoots(config(), statFor(healthyRoots()), (path) => (path === "/var/lib/realm/secrets" ? `${path}/.` : path));
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "secretRoot is not canonical");
  const unreadable = checkRoots(config(), statFor(healthyRoots()), (path) => {
    if (path === "/srv/workspace") {
      throw new Error("ELOOP");
    }
    return path;
  });
  assert.equal(unreadable.status, "fail");
  assert.equal(unreadable.detail, "workspaceRoot cannot be inspected");
});

void test("ONB-04: a private root owned by another uid fails", (t) => {
  const uid = process.getuid?.();
  if (uid === undefined) {
    t.skip("this platform has no process uid");
    return;
  }
  const result = runtimeRootsCheck(config(), statFor({
    ...healthyRoots(),
    "/var/lib/realm/secrets": directory(0o40700, uid + 1),
  }));
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "secretRoot is not owned by this account");
});

void test("driver-socket passes when the socket is 0600, its parent is 0700, and it accepts a connection", async () => {
  const result = await driverSocketCheck(
    "/run/realm/driver.sock",
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
    "/run/realm/driver.sock",
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
  const absent = await driverSocketCheck("/run/realm/driver.sock", statFor({}));
  assert.equal(absent.status, "fail");
  assert.match(absent.detail, /absent/);
  const parent = await driverSocketCheck(
    "/run/realm/driver.sock",
    statFor({
      "/run/realm/driver.sock": socket(0o10600),
      "/run/realm": directory(0o40755),
    }),
  );
  assert.equal(parent.status, "fail");
  assert.match(parent.detail, /parent mode is 0755/);
});

void test("ONB-04: driver-socket fails for a socket owned by another uid", async (t) => {
  const uid = process.getuid?.();
  if (uid === undefined) {
    t.skip("this platform has no process uid");
    return;
  }
  const result = await driverSocketCheck(
    "/run/realm/driver.sock",
    statFor({ "/run/realm/driver.sock": socket(0o10600, uid + 1), "/run/realm": directory(0o40700, uid) }),
    () => Promise.resolve(),
  );
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "driver socket is not owned by this account");
});

void test("ONB-04: driver-socket fails when its parent is owned by another uid", async (t) => {
  const uid = process.getuid?.();
  if (uid === undefined) {
    t.skip("this platform has no process uid");
    return;
  }
  const result = await driverSocketCheck(
    "/run/realm/driver.sock",
    statFor({ "/run/realm/driver.sock": socket(0o10600, uid), "/run/realm": directory(0o40700, uid + 1) }),
    () => Promise.resolve(),
  );
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "driver socket parent is not owned by this account");
});

void test("ONB-04: driver-socket fails when the parent is a symbolic link", async () => {
  const result = await driverSocketCheck(
    "/run/realm/driver.sock",
    statFor({ "/run/realm/driver.sock": socket(0o10600), "/run/realm": directory(0o40700, undefined, true) }),
    () => Promise.resolve(),
  );
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "driver socket parent is not a directory");
});

void test("ONB-04: runtimeChecks uses driverSocketPath before REALM_DRIVER_SOCKET", async () => {
  const report = await runtimeChecks({
    config: config(),
    env: { REALM_DRIVER_SOCKET: "/run/absent/driver.sock" },
    driverSocketPath: "/run/realm/driver.sock",
    stat: statFor({ "/run/realm/driver.sock": socket(0o10600), "/run/realm": directory(0o40700) }),
    connectDriver: () => Promise.resolve(),
    connectGateway: () => Promise.resolve(),
    probeTimeoutMs: 50,
  });
  const item = report.find((entry) => entry.id === "driver-socket");
  assert.equal(item?.status, "pass");
  const fallback = await runtimeChecks({
    config: config(),
    env: { REALM_DRIVER_SOCKET: "/run/realm/driver.sock" },
    stat: statFor({ "/run/realm/driver.sock": socket(0o10600), "/run/realm": directory(0o40700) }),
    connectDriver: () => Promise.resolve(),
    connectGateway: () => Promise.resolve(),
    probeTimeoutMs: 50,
  });
  assert.equal(fallback.find((entry) => entry.id === "driver-socket")?.status, "pass");
});

void test("ONB-04: driver-socket with neither driverSocketPath nor REALM_DRIVER_SOCKET fails as unset", async () => {
  const report = await runtimeChecks({ config: config(), env: {}, stat: statFor({}), connectGateway: () => Promise.resolve(), probeTimeoutMs: 50 });
  const item = report.find((entry) => entry.id === "driver-socket");
  assert.equal(item?.status, "fail");
  assert.equal(item?.detail, "REALM_DRIVER_SOCKET is unset or not absolute");
});

void test("gateway passes when the endpoint accepts a connection and fails when it does not", async () => {
  const env = { REALM_DRIVER_GATEWAY_ENDPOINT: "https://gateway.example:443", REALM_DRIVER_GATEWAY_CA: "/etc/realm/gateway-ca.pem" };
  const passed = await gatewayCheck(env, () => Promise.resolve(), 50);
  assert.equal(passed.status, "pass");
  assert.equal(passed.fix, null);
  const failed = await gatewayCheck(env, () => Promise.reject(new Error("refused")), 50);
  assert.equal(failed.status, "fail");
  assert.match(failed.detail, /unreachable/);
  const unset = await gatewayCheck({}, () => Promise.resolve(), 50);
  assert.equal(unset.status, "fail");
  assert.match(unset.detail, /unset/);
  const noCa = await gatewayCheck({ REALM_DRIVER_GATEWAY_ENDPOINT: "https://gateway.example:443" }, () => Promise.resolve(), 50);
  assert.equal(noCa.status, "fail");
  assert.match(noCa.detail, /REALM_DRIVER_GATEWAY_CA is unset/);
});

// A self-signed certificate for the loopback address, with its key. Node trusts it when it is given as the CA.
function loopbackCertificate(t: TestContext, name: string): { readonly certPath: string; readonly certPem: string; readonly keyPem: string } {
  const dir = mkdtempSync(join(tmpdir(), "realm-doctor-tls-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
      "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", `/CN=${name}`,
      "-addext", "subjectAltName=IP:127.0.0.1", "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,digitalSignature,keyCertSign",
    ],
    { stdio: "ignore" },
  );
  return { certPath, certPem: readFileSync(certPath, "utf8"), keyPem: readFileSync(keyPath, "utf8") };
}

// A TLS listener on loopback that presents the certificate and closes each connection once the handshake completes.
async function startTlsGateway(t: TestContext, certificate: { readonly certPem: string; readonly keyPem: string }): Promise<number> {
  const server: TlsServer = createTlsServer({ cert: certificate.certPem, key: certificate.keyPem });
  server.on("secureConnection", (socket) => {
    socket.on("error", () => {
      socket.destroy();
    });
    socket.end();
  });
  server.on("tlsClientError", () => undefined);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  t.after(() => {
    server.close();
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the TLS listener has no port");
  }
  return address.port;
}

void test("gateway verifies the presented certificate against REALM_DRIVER_GATEWAY_CA", async (t) => {
  const gateway = loopbackCertificate(t, "gateway");
  const foreign = loopbackCertificate(t, "foreign");
  const port = await startTlsGateway(t, gateway);
  const endpoint = `https://127.0.0.1:${String(port)}`;
  const chains = await gatewayCheck(
    { REALM_DRIVER_GATEWAY_ENDPOINT: endpoint, REALM_DRIVER_GATEWAY_CA: gateway.certPath },
    defaultConnectGateway,
    2000,
  );
  assert.equal(chains.status, "pass");
  const notChaining = await gatewayCheck(
    { REALM_DRIVER_GATEWAY_ENDPOINT: endpoint, REALM_DRIVER_GATEWAY_CA: foreign.certPath },
    defaultConnectGateway,
    2000,
  );
  assert.equal(notChaining.status, "fail");
  assert.match(notChaining.detail, /unreachable/);
});
