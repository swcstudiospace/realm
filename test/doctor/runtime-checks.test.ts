import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  runChecks,
  type AndaReply,
  type CheckId,
  type CheckResult,
  type DoctorOptions,
  type FetchInformation,
} from "../../src/doctor/checks.js";
import type { CommandOutcome, ConnectSocket, RunCommand } from "../../src/runtime/podman-probe.js";

// Every seam is injected, so no process runs and no socket opens in these tests (RT-02, ANDA-02), except
// the trickle test in the ANDA-02 group, which dials a loopback server through the default Anda transport.
const HOST_ENV: Readonly<Record<string, string>> = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/realm",
  XDG_RUNTIME_DIR: "/run/user/1000",
};
const PODMAN_VERSION = "podman --version";
const PODMAN_5: CommandOutcome = { exitCode: 0, stdout: "podman version 5.0.0\n" };
const PODMAN_4: CommandOutcome = { exitCode: 0, stdout: "podman version 4.9.3\n" };
const OPENSHELL_HELP = "openshell sandbox create --help";
// The flags of the pinned create argv (OQ-P3-12 default: the locally verified 0.1.2 set).
const PINNED_FLAGS = [
  "--name",
  "--policy",
  "--no-auto-providers",
  "--no-keep",
  "--detach",
  "--label",
  "--cpu",
  "--memory",
];
const HELP_ALL: CommandOutcome = {
  exitCode: 0,
  stdout: `${PINNED_FLAGS.map((flag) => `  ${flag} <VALUE>`).join("\n")}\n`,
};
const ENGINE_URL = "http://127.0.0.1:8080";
const SHAPE_OK = JSON.stringify({ engines: [], default_engine: null, start_time_ms: 1 });
const ANDA_OK: AndaReply = { status: 200, text: SHAPE_OK };
const RUNTIME_IDS: readonly CheckId[] = ["podman", "podman-service", "openshell", "anda-bridge"];

type Seams = Omit<DoctorOptions, "policyPath" | "stateDir">;

interface CommandCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

interface HostPlan {
  // Keyed by "file arg arg". A key that is absent models a command that cannot start (ENOENT).
  readonly commands?: Readonly<Record<string, CommandOutcome>>;
  // "connect" accepts the socket; an Error models a refused, missing, or silent socket.
  readonly socket?: "connect" | Error;
  // The engine's reply to GET /.well-known/information, or an Error when no reply arrives.
  readonly engine?: AndaReply | Error;
  readonly andaUrl?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly probeTimeoutMs?: number;
  // defaultTransport leaves fetchInformation unset, so the real Anda transport runs against andaUrl.
  readonly defaultTransport?: boolean;
}

interface Host {
  readonly seams: Seams;
  readonly commandCalls: CommandCall[];
  readonly dials: string[];
  readonly engineCalls: string[];
}

function fakeHost(plan: HostPlan): Host {
  const commandCalls: CommandCall[] = [];
  const dials: string[] = [];
  const engineCalls: string[] = [];
  const commands = plan.commands ?? {};
  const runCommand: RunCommand = (file, args, options) => {
    commandCalls.push({ file, args, env: options.env });
    const reply = commands[[file, ...args].join(" ")];
    if (reply === undefined) {
      return Promise.reject(Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" }));
    }
    return Promise.resolve(reply);
  };
  const socket = plan.socket ?? "connect";
  const connectSocket: ConnectSocket = (socketPath) => {
    dials.push(socketPath);
    return socket === "connect" ? Promise.resolve() : Promise.reject(socket);
  };
  const engine = plan.engine ?? new Error("no engine is listening");
  const fetchInformation: FetchInformation = (url) => {
    engineCalls.push(url);
    return engine instanceof Error ? Promise.reject(engine) : Promise.resolve(engine);
  };
  const seams: Seams = {
    env: plan.env ?? HOST_ENV,
    runCommand,
    connectSocket,
    ...(plan.defaultTransport === true ? {} : { fetchInformation }),
    ...(plan.andaUrl === undefined ? {} : { andaUrl: plan.andaUrl }),
    ...(plan.probeTimeoutMs === undefined ? {} : { probeTimeoutMs: plan.probeTimeoutMs }),
  };
  return { seams, commandCalls, dials, engineCalls };
}

// A temporary base with a state directory at mode 0700 and a policy path that does not exist.
function layout(t: TestContext): { readonly policyPath: string; readonly stateDir: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-runtime-checks-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  mkdirSync(stateDir);
  chmodSync(stateDir, 0o700);
  return { policyPath: join(base, "policy.json"), stateDir };
}

async function runtimeChecks(t: TestContext, host: Host): Promise<readonly CheckResult[]> {
  const { policyPath, stateDir } = layout(t);
  return runChecks({ policyPath, stateDir, ...host.seams });
}

function resultOf(results: readonly CheckResult[], id: CheckId): CheckResult {
  const found = results.find((result) => result.id === id);
  assert.ok(found, `expected a result for ${id}`);
  return found;
}

function fixOf(result: CheckResult): string {
  assert.equal(typeof result.fix, "string", `${result.id} must carry a fix when it is not a pass`);
  return result.fix ?? "";
}

test("RT-02: podman passes on Podman 5.x, with no fix (RT-02)", async (t) => {
  const host = fakeHost({ commands: { [PODMAN_VERSION]: PODMAN_5 } });
  const result = resultOf(await runtimeChecks(t, host), "podman");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  assert.match(result.detail, /5\.0\.0/);
});

test("RT-02: podman fails with PODMAN_MISSING and the install fix when the binary cannot start (RT-02)", async (t) => {
  const host = fakeHost({});
  const result = resultOf(await runtimeChecks(t, host), "podman");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /PODMAN_MISSING/);
  assert.match(fixOf(result), /Install Podman 5\.x yourself/);
  assert.equal(host.dials.length, 0, "no socket is dialed before the version passes");
});

test("RT-02: podman fails with PODMAN_UNSUPPORTED_VERSION and an upgrade fix on Podman 4.9.3 (RT-02)", async (t) => {
  const host = fakeHost({ commands: { [PODMAN_VERSION]: PODMAN_4 } });
  const result = resultOf(await runtimeChecks(t, host), "podman");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /PODMAN_UNSUPPORTED_VERSION/);
  assert.match(result.detail, /4\.9\.3/);
  assert.match(fixOf(result), /Upgrade Podman to 5\.x yourself/);
});

test("RT-02: raw podman --version output is never echoed into the result (RT-02)", async (t) => {
  const host = fakeHost({ commands: { [PODMAN_VERSION]: { exitCode: 0, stdout: "SECRET-TOKEN-XYZ" } } });
  const result = resultOf(await runtimeChecks(t, host), "podman");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /PODMAN_UNSUPPORTED_VERSION/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /SECRET-TOKEN-XYZ/);
});

test("RT-02: podman-service passes when the rootless socket accepts, and dials only the XDG-derived path (RT-02)", async (t) => {
  const host = fakeHost({ commands: { [PODMAN_VERSION]: PODMAN_5 } });
  const result = resultOf(await runtimeChecks(t, host), "podman-service");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  assert.deepEqual(host.dials, ["/run/user/1000/podman/podman.sock"]);
});

test("RT-02: podman-service fails with PODMAN_MACHINE_DOWN and the systemctl fix on a refused socket, never echoing the socket error (RT-02)", async (t) => {
  const refused = Object.assign(new Error("connect ECONNREFUSED PRIVATE-PATH"), { code: "ECONNREFUSED" });
  const host = fakeHost({ commands: { [PODMAN_VERSION]: PODMAN_5 }, socket: refused });
  const results = await runtimeChecks(t, host);
  const result = resultOf(results, "podman-service");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /PODMAN_MACHINE_DOWN/);
  assert.match(fixOf(result), /systemctl --user start podman\.socket/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /ECONNREFUSED|PRIVATE-PATH/);
  assert.equal(resultOf(results, "podman").status, "pass", "the version step passed, so podman passes");
});

test("RT-02: podman-service fails with PODMAN_MACHINE_DOWN and dials nothing when XDG_RUNTIME_DIR is unset (RT-02)", async (t) => {
  const host = fakeHost({
    commands: { [PODMAN_VERSION]: PODMAN_5 },
    env: { PATH: "/usr/bin:/bin", HOME: "/home/realm" },
  });
  const result = resultOf(await runtimeChecks(t, host), "podman-service");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /PODMAN_MACHINE_DOWN/);
  assert.equal(host.dials.length, 0, "no socket path is derived without XDG_RUNTIME_DIR");
});

test("RT-02: podman-service warns that the socket was not inspected when the version step fails, and dials nothing (RT-02)", async (t) => {
  const host = fakeHost({});
  const result = resultOf(await runtimeChecks(t, host), "podman-service");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /not inspected/);
  assert.notEqual(result.fix, null);
  assert.equal(host.dials.length, 0);
});

test("RT-03: openshell passes when every pinned create flag is listed, and receives only the allowlisted environment (RT-03)", async (t) => {
  const host = fakeHost({
    commands: { [OPENSHELL_HELP]: HELP_ALL },
    env: { ...HOST_ENV, REALM_SECRET: "must-not-pass" },
  });
  const result = resultOf(await runtimeChecks(t, host), "openshell");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  const call = host.commandCalls.find((entry) => entry.file === "openshell");
  assert.ok(call, "openshell must be run");
  assert.deepEqual(call.args, ["sandbox", "create", "--help"]);
  assert.deepEqual(Object.keys(call.env).sort(), ["HOME", "PATH", "XDG_RUNTIME_DIR"]);
});

test("RT-03: openshell warns and names the missing pinned flag when the CLI does not list it, with a fix (RT-03)", async (t) => {
  const withoutNoKeep: CommandOutcome = {
    exitCode: 0,
    stdout: PINNED_FLAGS.filter((flag) => flag !== "--no-keep")
      .map((flag) => `  ${flag} <VALUE>`)
      .join("\n"),
  };
  const host = fakeHost({ commands: { [OPENSHELL_HELP]: withoutNoKeep } });
  const result = resultOf(await runtimeChecks(t, host), "openshell");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /--no-keep/);
  assert.doesNotMatch(result.detail, /--detach|--label/, "only the missing flag is named");
  assert.notEqual(result.fix, null);
});

test("RT-03: openshell fails with the OpenShell 0.1.2 install fix when it cannot be started (RT-03)", async (t) => {
  const host = fakeHost({});
  const result = resultOf(await runtimeChecks(t, host), "openshell");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /cannot be started/);
  assert.match(fixOf(result), /OpenShell 0\.1\.2/);
});

test("RT-03: openshell's failed start names the errno code and never the error message (RT-03)", async (t) => {
  const host = fakeHost({});
  const result = resultOf(await runtimeChecks(t, host), "openshell");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /^openshell cannot be started: ENOENT$/);
});

test("RT-03: openshell fails on a non-zero exit, reports the status only, and never echoes the output (RT-03)", async (t) => {
  const host = fakeHost({ commands: { [OPENSHELL_HELP]: { exitCode: 2, stdout: "error: SECRET-HELP-TEXT" } } });
  const result = resultOf(await runtimeChecks(t, host), "openshell");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /status 2/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /SECRET-HELP-TEXT/);
});

test("ANDA-02: anda-bridge passes on the AppInformation shape with one anonymous GET to the engine (ANDA-02)", async (t) => {
  const host = fakeHost({ andaUrl: ENGINE_URL, engine: ANDA_OK });
  const result = resultOf(await runtimeChecks(t, host), "anda-bridge");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  assert.match(result.detail, /shape check, not a version check/);
  assert.deepEqual(host.engineCalls, [ENGINE_URL]);
});

test("ANDA-02: anda-bridge fails with ANDA_UNREACHABLE and the engine-URL fix when no reply arrives, never echoing the error (ANDA-02)", async (t) => {
  const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8080"), { code: "ECONNREFUSED" });
  const host = fakeHost({ andaUrl: ENGINE_URL, engine: refused });
  const result = resultOf(await runtimeChecks(t, host), "anda-bridge");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /ANDA_UNREACHABLE/);
  assert.match(fixOf(result), /andaUrl/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /ECONNREFUSED/);
});

test("ANDA-02: anda-bridge fails with ANDA_UNREACHABLE on a non-200 status, never echoing the body (ANDA-02)", async (t) => {
  const host = fakeHost({ andaUrl: ENGINE_URL, engine: { status: 503, text: "SECRET-BODY" } });
  const result = resultOf(await runtimeChecks(t, host), "anda-bridge");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /ANDA_UNREACHABLE/);
  assert.match(result.detail, /status 503/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /SECRET-BODY/);
});

test("ANDA-02: anda-bridge fails with ANDA_VERSION_MISMATCH on a wrong shape, naming the field and never its value (ANDA-02)", async (t) => {
  const wrong = JSON.stringify({ engines: "SECRET-VALUE", default_engine: null, start_time_ms: 1 });
  const host = fakeHost({ andaUrl: ENGINE_URL, engine: { status: 200, text: wrong } });
  const result = resultOf(await runtimeChecks(t, host), "anda-bridge");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /ANDA_VERSION_MISMATCH/);
  assert.match(result.detail, /engines/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /SECRET-VALUE/);
});

test("ANDA-02: anda-bridge fails with ANDA_VERSION_MISMATCH when the body is not JSON (ANDA-02)", async (t) => {
  const host = fakeHost({ andaUrl: ENGINE_URL, engine: { status: 200, text: "<html>not json</html>" } });
  const result = resultOf(await runtimeChecks(t, host), "anda-bridge");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /ANDA_VERSION_MISMATCH/);
  assert.match(fixOf(result), /shape check/);
});

test("ANDA-02: anda-bridge warns that no engine is configured and contacts nothing when andaUrl is absent (ANDA-02)", async (t) => {
  const host = fakeHost({});
  const result = resultOf(await runtimeChecks(t, host), "anda-bridge");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /no Anda Engine URL is configured/);
  assert.notEqual(result.fix, null);
  assert.deepEqual(host.engineCalls, []);
});

test("ANDA-02: anda-bridge refuses an andaUrl with user information, contacts nothing, and never echoes the credential (ANDA-02)", async (t) => {
  const host = fakeHost({ andaUrl: "http://engine-user:secret-pass@127.0.0.1:8080", engine: ANDA_OK });
  const result = resultOf(await runtimeChecks(t, host), "anda-bridge");
  assert.equal(result.status, "fail");
  assert.deepEqual(host.engineCalls, []);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /secret-pass|engine-user/);
});

// The probe must end at its deadline. The server keeps the socket active by sending a byte every 20 ms,
// so the idle timeout never fires, and it ends its own reply after trickleMs so that a probe without a
// deadline finishes with a body that fails the JSON parse instead of hanging the run. This test waits in
// real time on purpose: the socket timers are the behaviour under test, and fake timers do not drive
// Node's socket I/O.
test("ANDA-02: anda-bridge gives up on a server that trickles bytes at the probe deadline (ANDA-02)", async (t) => {
  const trickleMs = 3000;
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    const tick = setInterval(() => response.write("x"), 20);
    const stop = setTimeout(() => {
      clearInterval(tick);
      response.end();
    }, trickleMs);
    response.on("close", () => {
      clearInterval(tick);
      clearTimeout(stop);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  const host = fakeHost({ andaUrl: `http://127.0.0.1:${port}`, defaultTransport: true, probeTimeoutMs: 200 });
  const started = Date.now();
  const result = resultOf(await runtimeChecks(t, host), "anda-bridge");
  const elapsed = Date.now() - started;
  assert.equal(result.status, "fail");
  assert.match(result.detail, /ANDA_UNREACHABLE/);
  assert.ok(elapsed < trickleMs / 2, `the probe must end at its deadline, not after the trickle (took ${elapsed} ms)`);
});

test("RT-02 and ANDA-02: the four runtime items follow the three Phase 2 items, and the Phase 6 control-channel and agentos items follow anda-bridge (D-69, CLI-03)", async (t) => {
  const results = await runtimeChecks(t, fakeHost({}));
  assert.deepEqual(
    results.map((result) => result.id),
    [
      "policy-file",
      "state-dir",
      "session-store",
      "podman",
      "podman-service",
      "openshell",
      "anda-bridge",
      "control-channel",
      "agentos",
    ],
  );
});

test("RT-02 and ANDA-02: a fail or warn always carries a fix, and a pass never does (D-44, RT-02, ANDA-02)", async (t) => {
  const results = await runtimeChecks(t, fakeHost({}));
  for (const id of RUNTIME_IDS) {
    const result = resultOf(results, id);
    if (result.status === "pass") {
      assert.equal(result.fix, null, `${id} passes with no fix`);
    } else {
      assert.notEqual(result.fix, null, `${id} must carry a fix when it is not a pass`);
    }
  }
});
