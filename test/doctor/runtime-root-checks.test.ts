import { test } from "node:test";
import assert from "node:assert/strict";
import type { Stats } from "node:fs";
import { loadRuntimeConfig, type RuntimeConfig } from "../../src/runtime/config.js";
import { channelPathsOf } from "../../src/runtime/driver/channel.js";
import { secretDirOf } from "../../src/runtime/driver/secret-store.js";
import { realmSandboxName } from "../../src/runtime/openshell.js";
import type { CommandOutcome, RunCommand } from "../../src/runtime/podman-probe.js";
import {
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

void test("ONB-04: a config that does not load is one runtime-roots item whose detail names the problem keys and whose fix names realm init", async () => {
  const report = await runtimeChecks({ env: {}, configProblems: ["image is absent or not a digest-pinned reference", "stateDir is absent or not an absolute path"] });
  assert.equal(report.length, 1);
  const item = report[0];
  assert.ok(item);
  assert.equal(item.id, "runtime-roots");
  assert.equal(item.status, "fail");
  assert.equal(item.detail, "image is absent or not a digest-pinned reference; stateDir is absent or not an absolute path");
  assert.match(item.fix ?? "", /realm init/);
});

void test("ONB-04: an absent config with no problems names the absence", async () => {
  for (const options of [{ env: {} }, { env: {}, configProblems: [] }]) {
    const report = await runtimeChecks(options);
    assert.equal(report.length, 1);
    assert.equal(report[0]?.detail, "runtime config is absent");
  }
});

void test("ONB-04: the one-item report never runs the driver, gateway or roots checks", async () => {
  let calls = 0;
  const report = await runtimeChecks({
    env: { REALM_DRIVER_SOCKET: "/run/realm/driver.sock" },
    configProblems: ["config.json is absent"],
    runCommand: () => {
      calls += 1;
      return connectedGateway();
    },
    connectDriver: () => {
      calls += 1;
      return Promise.resolve();
    },
    stat: (path) => {
      calls += 1;
      return statFor({})(path);
    },
  });
  assert.deepEqual(report.map((item) => item.detail), ["config.json is absent"]);
  assert.equal(calls, 0);
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
    runCommand: connectedGateway,
    probeTimeoutMs: 50,
  });
  const item = report.find((entry) => entry.id === "driver-socket");
  assert.equal(item?.status, "pass");
  const fallback = await runtimeChecks({
    config: config(),
    env: { REALM_DRIVER_SOCKET: "/run/realm/driver.sock" },
    stat: statFor({ "/run/realm/driver.sock": socket(0o10600), "/run/realm": directory(0o40700) }),
    connectDriver: () => Promise.resolve(),
    runCommand: connectedGateway,
    probeTimeoutMs: 50,
  });
  assert.equal(fallback.find((entry) => entry.id === "driver-socket")?.status, "pass");
});

void test("ONB-04: driver-socket with neither driverSocketPath nor REALM_DRIVER_SOCKET fails as unset", async () => {
  const report = await runtimeChecks({ config: config(), env: {}, stat: statFor({}), runCommand: connectedGateway, probeTimeoutMs: 50 });
  const item = report.find((entry) => entry.id === "driver-socket");
  assert.equal(item?.status, "fail");
  assert.equal(item?.detail, "REALM_DRIVER_SOCKET is unset or not absolute");
});

// The reply of a gateway that `openshell status -o json` reports as connected.
function connectedGateway(): Promise<CommandOutcome> {
  return Promise.resolve({ exitCode: 0, stdout: '{"status":"connected","gateway":"realm"}' });
}

interface RecordedCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

// A runner that records each call and answers with the outcome, or rejects with the error.
function recordingRunner(answer: CommandOutcome | Error): { readonly run: RunCommand; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const run: RunCommand = (file, args, options) => {
    calls.push({ file, args, env: options.env });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { run, calls };
}

const GATEWAY_ENV = { PATH: "/usr/bin", HOME: "/home/realm", XDG_RUNTIME_DIR: "/run/user/1000", REALM_SENTINEL_MUST_NOT_LEAK: "leak" };

void test("ONB-04: gateway passes only when openshell status reports connected, and runs nothing else", async () => {
  const runner = recordingRunner({ exitCode: 0, stdout: '{"status":"connected","gateway":"realm"}' });
  const result = await gatewayCheck(GATEWAY_ENV, runner.run, 1000);
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  assert.equal(runner.calls.length, 1);
  const call = runner.calls[0];
  assert.ok(call);
  assert.equal(call.file, "openshell");
  assert.deepEqual(call.args, ["status", "-o", "json"]);
  assert.deepEqual(Object.keys(call.env).sort(), ["HOME", "PATH", "XDG_RUNTIME_DIR"]);
});

void test("ONB-04: gateway fails for not_configured with its own phrase", async () => {
  const result = await gatewayCheck(GATEWAY_ENV, recordingRunner({ exitCode: 0, stdout: '{"status":"not_configured"}' }).run, 1000);
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "no gateway is registered for this account");
  assert.match(result.fix ?? "", /openshell\.md/);
});

void test("ONB-04: gateway fails for another status without echoing it", async () => {
  const result = await gatewayCheck(GATEWAY_ENV, recordingRunner({ exitCode: 0, stdout: '{"status":"degraded"}' }).run, 1000);
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "gateway is not connected");
  assert.equal(result.detail.includes("degraded"), false);
  assert.equal((result.fix ?? "").includes("degraded"), false);
});

void test("ONB-04: gateway fails for output that is not a JSON object with a string status, and never echoes it", async () => {
  for (const stdout of ["Gateway: realm (connected)", "[]", "null", '{"status":1}', '{"state":"connected"}']) {
    const result = await gatewayCheck(GATEWAY_ENV, recordingRunner({ exitCode: 0, stdout }).run, 1000);
    assert.equal(result.status, "fail", stdout);
    assert.equal(result.detail, "gateway status is not JSON", stdout);
    assert.equal(result.detail.includes(stdout), false);
    assert.equal((result.fix ?? "").includes(stdout), false);
  }
});

void test("ONB-04: gateway fails for a non-zero exit, whatever the output says", async () => {
  const result = await gatewayCheck(GATEWAY_ENV, recordingRunner({ exitCode: 1, stdout: '{"status":"connected"} error: boom' }).run, 1000);
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "gateway status exited with status 1");
  assert.equal(result.detail.includes("boom"), false);
});

void test("ONB-04: gateway fails when openshell cannot be started, without the error text or code", async () => {
  const failure = Object.assign(new Error("spawn openshell ENOENT"), { code: "ENOENT" });
  const result = await gatewayCheck(GATEWAY_ENV, recordingRunner(failure).run, 1000);
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "openshell cannot be started");
  assert.equal(result.detail.includes("ENOENT"), false);
  assert.match(result.fix ?? "", /0\.1\.5/);
});

void test("ONB-04: gateway fails when the probe never answers, within its own bound", async () => {
  const started = Date.now();
  const result = await gatewayCheck(GATEWAY_ENV, () => new Promise<CommandOutcome>(() => undefined), 50);
  assert.equal(result.status, "fail");
  assert.equal(result.detail, "gateway status did not answer in time");
  assert.ok(Date.now() - started < 2000);
});
