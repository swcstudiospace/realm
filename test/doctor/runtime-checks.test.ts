import { after, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks, type CheckId, type CheckResult, type DoctorOptions } from "../../src/doctor/checks.js";
import type { CommandOutcome, ConnectSocket, RunCommand } from "../../src/runtime/podman-probe.js";

// Every seam is injected, so no process runs and no socket opens in these tests (RT-02). PATH names an empty
// directory, so the host-binaries item finds, hashes and runs no real binary.
const EMPTY_PATH_DIR = realpathSync(mkdtempSync(join(tmpdir(), "realm-runtime-empty-path-")));
after(() => {
  rmSync(EMPTY_PATH_DIR, { recursive: true, force: true });
});
const HOST_ENV: Readonly<Record<string, string>> = {
  PATH: EMPTY_PATH_DIR,
  HOME: "/home/realm",
  XDG_RUNTIME_DIR: "/run/user/1000",
};
const PODMAN_VERSION = "podman --version";
const PODMAN_5: CommandOutcome = { exitCode: 0, stdout: "podman version 5.0.0\n" };
const PODMAN_4: CommandOutcome = { exitCode: 0, stdout: "podman version 4.9.3\n" };
const OPENSHELL_HELP = "openshell sandbox create --help";
// The flags of the pinned create argv (the locally verified 0.1.5 set, S-10).
const PINNED_FLAGS = [
  "--name",
  "--policy",
  "--no-auto-providers",
  "--detach",
  "--cpu",
  "--memory",
  "--from",
];
const HELP_ALL: CommandOutcome = {
  exitCode: 0,
  stdout: `${PINNED_FLAGS.map((flag) => `  ${flag} <VALUE>`).join("\n")}\n`,
};
const RUNTIME_IDS: readonly CheckId[] = ["podman", "podman-service", "openshell"];

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
  readonly env?: Readonly<Record<string, string>>;
  // The Yama ptrace scope reader. Absent leaves the real /proc reader in place.
  readonly readPtraceScope?: () => string;
}

interface Host {
  readonly seams: Seams;
  readonly commandCalls: CommandCall[];
  readonly dials: string[];
}

function fakeHost(plan: HostPlan): Host {
  const commandCalls: CommandCall[] = [];
  const dials: string[] = [];
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
  const seams: Seams = {
    env: plan.env ?? HOST_ENV,
    runCommand,
    connectSocket,
    ...(plan.readPtraceScope === undefined ? {} : { readPtraceScope: plan.readPtraceScope }),
  };
  return { seams, commandCalls, dials };
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

void test("RT-02: podman passes on Podman 5.x, with no fix (RT-02)", async (t) => {
  const host = fakeHost({ commands: { [PODMAN_VERSION]: PODMAN_5 } });
  const result = resultOf(await runtimeChecks(t, host), "podman");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  assert.match(result.detail, /5\.0\.0/);
});

void test("RT-02: podman fails with PODMAN_MISSING and the install fix when the binary cannot start (RT-02)", async (t) => {
  const host = fakeHost({});
  const result = resultOf(await runtimeChecks(t, host), "podman");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /PODMAN_MISSING/);
  assert.match(fixOf(result), /Install Podman 5\.x yourself/);
  assert.equal(host.dials.length, 0, "no socket is dialed before the version passes");
});

void test("RT-02: podman fails with PODMAN_UNSUPPORTED_VERSION and an upgrade fix on Podman 4.9.3 (RT-02)", async (t) => {
  const host = fakeHost({ commands: { [PODMAN_VERSION]: PODMAN_4 } });
  const result = resultOf(await runtimeChecks(t, host), "podman");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /PODMAN_UNSUPPORTED_VERSION/);
  assert.match(result.detail, /4\.9\.3/);
  assert.match(fixOf(result), /Upgrade Podman to 5\.x yourself/);
});

void test("RT-02: raw podman --version output is never echoed into the result (RT-02)", async (t) => {
  const host = fakeHost({ commands: { [PODMAN_VERSION]: { exitCode: 0, stdout: "SECRET-TOKEN-XYZ" } } });
  const result = resultOf(await runtimeChecks(t, host), "podman");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /PODMAN_UNSUPPORTED_VERSION/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /SECRET-TOKEN-XYZ/);
});

void test("RT-02: podman-service passes when the rootless socket accepts, and dials only the XDG-derived path (RT-02)", async (t) => {
  const host = fakeHost({ commands: { [PODMAN_VERSION]: PODMAN_5 } });
  const result = resultOf(await runtimeChecks(t, host), "podman-service");
  assert.equal(result.status, "pass");
  assert.equal(result.fix, null);
  assert.deepEqual(host.dials, ["/run/user/1000/podman/podman.sock"]);
});

void test("RT-02: podman-service fails with PODMAN_MACHINE_DOWN and the systemctl fix on a refused socket, never echoing the socket error (RT-02)", async (t) => {
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

void test("RT-02: podman-service fails with PODMAN_MACHINE_DOWN and dials nothing when XDG_RUNTIME_DIR is unset (RT-02)", async (t) => {
  const host = fakeHost({
    commands: { [PODMAN_VERSION]: PODMAN_5 },
    env: { PATH: EMPTY_PATH_DIR, HOME: "/home/realm" },
  });
  const result = resultOf(await runtimeChecks(t, host), "podman-service");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /PODMAN_MACHINE_DOWN/);
  assert.equal(host.dials.length, 0, "no socket path is derived without XDG_RUNTIME_DIR");
});

void test("RT-02: podman-service warns that the socket was not inspected when the version step fails, and dials nothing (RT-02)", async (t) => {
  const host = fakeHost({});
  const result = resultOf(await runtimeChecks(t, host), "podman-service");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /not inspected/);
  assert.notEqual(result.fix, null);
  assert.equal(host.dials.length, 0);
});

void test("RT-03: openshell passes when every pinned create flag is listed, and receives only the allowlisted environment (RT-03)", async (t) => {
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

void test("RT-03: openshell warns and names the missing pinned flag when the CLI does not list it, with a fix (RT-03)", async (t) => {
  const withoutCpu: CommandOutcome = {
    exitCode: 0,
    stdout: PINNED_FLAGS.filter((flag) => flag !== "--cpu")
      .map((flag) => `  ${flag} <VALUE>`)
      .join("\n"),
  };
  const host = fakeHost({ commands: { [OPENSHELL_HELP]: withoutCpu } });
  const result = resultOf(await runtimeChecks(t, host), "openshell");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /--cpu/);
  assert.doesNotMatch(result.detail, /--detach|--memory/, "only the missing flag is named");
  assert.notEqual(result.fix, null);
});

void test("RT-03: openshell fails with the OpenShell 0.1.5 install fix when it cannot be started (RT-03)", async (t) => {
  const host = fakeHost({});
  const result = resultOf(await runtimeChecks(t, host), "openshell");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /cannot be started/);
  assert.match(fixOf(result), /OpenShell 0\.1\.5/);
});

void test("RT-03: openshell's failed start names the errno code and never the error message (RT-03)", async (t) => {
  const host = fakeHost({});
  const result = resultOf(await runtimeChecks(t, host), "openshell");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /^openshell cannot be started: ENOENT$/);
});

void test("RT-03: openshell fails on a non-zero exit, reports the status only, and never echoes the output (RT-03)", async (t) => {
  const host = fakeHost({ commands: { [OPENSHELL_HELP]: { exitCode: 2, stdout: "error: SECRET-HELP-TEXT" } } });
  const result = resultOf(await runtimeChecks(t, host), "openshell");
  assert.equal(result.status, "fail");
  assert.match(result.detail, /status 2/);
  assert.doesNotMatch(`${result.detail} ${fixOf(result)}`, /SECRET-HELP-TEXT/);
});

void test("RT-02: the three runtime items follow the three Phase 2 items, and the Phase 6 control-channel and agentos items follow openshell (D-69, CLI-03)", async (t) => {
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
      "control-channel",
      "agentos",
      "host-binaries",
      "kernel-hardening",
      "runtime-roots",
      "host-plugins",
    ],
  );
});

void test("RT-02: a fail or warn always carries a fix, and a pass never does (D-44, RT-02)", async (t) => {
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

void test("kernel-hardening: a ptrace scope of 0 warns that same-uid ptrace is unrestricted, with the sysctl fix", async (t) => {
  const result = resultOf(await runtimeChecks(t, fakeHost({ readPtraceScope: () => "0\n" })), "kernel-hardening");
  assert.equal(result.status, "warn");
  assert.match(result.detail, /same-uid ptrace is unrestricted/);
  assert.match(fixOf(result), /kernel\.yama\.ptrace_scope to 1 or higher/);
});

void test("kernel-hardening: a ptrace scope of 1 or more passes with no fix", async (t) => {
  for (const scope of ["1\n", "2", "3\n"]) {
    const result = resultOf(await runtimeChecks(t, fakeHost({ readPtraceScope: () => scope })), "kernel-hardening");
    assert.equal(result.status, "pass", `scope ${scope.trim()} passes`);
    assert.equal(result.fix, null);
  }
});

void test("kernel-hardening: an unreadable or unparseable scope warns with unknown, and never fails", async (t) => {
  const unreadable = (): string => {
    throw Object.assign(new Error("ENOENT: no such file or directory, open the private path"), { code: "ENOENT" });
  };
  for (const reader of [unreadable, () => "", () => "restricted\n", () => "-1"]) {
    const result = resultOf(await runtimeChecks(t, fakeHost({ readPtraceScope: reader })), "kernel-hardening");
    assert.equal(result.status, "warn");
    assert.match(result.detail, /unknown/);
    assert.doesNotMatch(result.detail, /private path/);
    assert.match(fixOf(result), /kernel\.yama\.ptrace_scope to 1 or higher/);
  }
});
