import { test } from "node:test";
import assert from "node:assert/strict";
import { ERROR_CATALOGUE } from "../../src/core/errors.js";
import {
  probePodman,
  type CommandOptions,
  type CommandOutcome,
  type ConnectSocket,
  type PodmanProbeResult,
  type RunCommand,
} from "../../src/runtime/podman-probe.js";

const RUNTIME_DIR = "/run/user/1000";
const SOCKET_PATH = "/run/user/1000/podman/podman.sock";
const ENV = { PATH: "/usr/bin", HOME: "/home/tester", XDG_RUNTIME_DIR: RUNTIME_DIR } as const;
const TIMEOUT_MS = 5_000;

// A runCommand fake that answers `podman --version` with the given outcome and records calls.
function versionCommand(outcome: CommandOutcome | Error): {
  run: RunCommand;
  calls: Array<{ file: string; args: readonly string[]; options: CommandOptions }>;
} {
  const calls: Array<{ file: string; args: readonly string[]; options: CommandOptions }> = [];
  const run: RunCommand = async (file, args, options) => {
    calls.push({ file, args, options });
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  };
  return { run, calls };
}

// A connectSocket fake that records every dial and then behaves as scripted.
function socketDialer(behaviour: "connect" | Error | "hang"): {
  connect: ConnectSocket;
  dials: Array<{ socketPath: string; timeoutMs: number }>;
} {
  const dials: Array<{ socketPath: string; timeoutMs: number }> = [];
  const connect: ConnectSocket = async (socketPath, timeoutMs) => {
    dials.push({ socketPath, timeoutMs });
    if (behaviour === "connect") {
      return;
    }
    if (behaviour === "hang") {
      return new Promise<void>(() => undefined);
    }
    throw behaviour;
  };
  return { connect, dials };
}

function failureOf(result: PodmanProbeResult): { code: string; reason: string } {
  if (result.ok) {
    throw new Error("expected a probe failure, got a version");
  }
  return { code: result.code, reason: result.reason };
}

const VERSION_5: CommandOutcome = { exitCode: 0, stdout: "podman version 5.3.1\n" };
const VERSION_49: CommandOutcome = { exitCode: 0, stdout: "podman version 4.9.3\n" };

test("ENOENT from podman --version gives PODMAN_MISSING with a readable reason (RT-02)", async () => {
  const { run, calls } = versionCommand(Object.assign(new Error("spawn podman ENOENT"), { code: "ENOENT" }));
  const { connect, dials } = socketDialer("connect");
  const result = await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: TIMEOUT_MS });
  const failure = failureOf(result);
  assert.equal(failure.code, "PODMAN_MISSING");
  assert.ok(failure.reason.startsWith(ERROR_CATALOGUE.PODMAN_MISSING.reason));
  assert.match(failure.reason, /could not be started/);
  assert.equal(calls.length, 1);
  assert.equal(dials.length, 0, "probing stops at the first failure");
});

test("a non-zero exit from podman --version gives PODMAN_MISSING naming the exit status (RT-02)", async () => {
  const { run } = versionCommand({ exitCode: 127, stdout: "" });
  const { connect, dials } = socketDialer("connect");
  const failure = failureOf(
    await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: TIMEOUT_MS }),
  );
  assert.equal(failure.code, "PODMAN_MISSING");
  assert.match(failure.reason, /exited with status 127/);
  assert.equal(dials.length, 0);
});

test("a podman --version that does not finish in time gives PODMAN_MISSING naming the timeout (RT-02)", async () => {
  const hang: RunCommand = () => new Promise<CommandOutcome>(() => undefined);
  const { connect, dials } = socketDialer("connect");
  const failure = failureOf(
    await probePodman({ runCommand: hang, connectSocket: connect, env: ENV, timeoutMs: 10 }),
  );
  assert.equal(failure.code, "PODMAN_MISSING");
  assert.match(failure.reason, /did not finish within 10 ms/);
  assert.equal(dials.length, 0);
});

test("Podman 4.9.3 gives PODMAN_UNSUPPORTED_VERSION naming the version and the 5.x need (RT-02)", async () => {
  const { run } = versionCommand(VERSION_49);
  const { connect, dials } = socketDialer("connect");
  const failure = failureOf(
    await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: TIMEOUT_MS }),
  );
  assert.equal(failure.code, "PODMAN_UNSUPPORTED_VERSION");
  assert.match(failure.reason, /4\.9\.3/);
  assert.match(failure.reason, /OpenShell requires Podman 5\.x/);
  assert.ok(failure.reason.startsWith(ERROR_CATALOGUE.PODMAN_UNSUPPORTED_VERSION.reason));
  assert.equal(dials.length, 0, "the socket is not probed once the version fails");
});

test("output that does not parse gives PODMAN_UNSUPPORTED_VERSION and never passes (RT-02)", async () => {
  const { run } = versionCommand({ exitCode: 0, stdout: "something else entirely" });
  const { connect, dials } = socketDialer("connect");
  const failure = failureOf(
    await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: TIMEOUT_MS }),
  );
  assert.equal(failure.code, "PODMAN_UNSUPPORTED_VERSION");
  assert.match(failure.reason, /holds no recognisable version/);
  assert.equal(dials.length, 0);
});

test("the raw stdout of podman --version is never echoed into the reason (RT-02)", async () => {
  const { run } = versionCommand({ exitCode: 0, stdout: "SECRET-TOKEN-XYZ" });
  const { connect } = socketDialer("connect");
  const failure = failureOf(
    await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: TIMEOUT_MS }),
  );
  assert.equal(failure.reason.includes("SECRET-TOKEN-XYZ"), false);
});

test("a refused API socket gives PODMAN_MACHINE_DOWN with the systemctl fix (RT-02)", async () => {
  const { run } = versionCommand(VERSION_5);
  const { connect } = socketDialer(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
  const failure = failureOf(
    await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: TIMEOUT_MS }),
  );
  assert.equal(failure.code, "PODMAN_MACHINE_DOWN");
  assert.ok(failure.reason.startsWith(ERROR_CATALOGUE.PODMAN_MACHINE_DOWN.reason));
  assert.match(failure.reason, /systemctl --user start podman\.socket/);
});

test("a missing API socket gives PODMAN_MACHINE_DOWN with the systemctl fix (RT-02)", async () => {
  const { run } = versionCommand(VERSION_5);
  const { connect } = socketDialer(Object.assign(new Error("spawn podman ENOENT"), { code: "ENOENT" }));
  const failure = failureOf(
    await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: TIMEOUT_MS }),
  );
  assert.equal(failure.code, "PODMAN_MACHINE_DOWN");
  assert.match(failure.reason, /systemctl --user start podman\.socket/);
});

test("an API socket that does not answer in time gives PODMAN_MACHINE_DOWN (RT-02)", async () => {
  const { run } = versionCommand(VERSION_5);
  const { connect } = socketDialer("hang");
  const failure = failureOf(
    await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: 10 }),
  );
  assert.equal(failure.code, "PODMAN_MACHINE_DOWN");
  assert.match(failure.reason, /systemctl --user start podman\.socket/);
});

test("an API socket that does not answer names the timeout in the reason (RT-02)", async () => {
  const { run } = versionCommand(VERSION_5);
  const { connect } = socketDialer("hang");
  const failure = failureOf(
    await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: 10 }),
  );
  assert.match(failure.reason, /did not answer a connection within 10 ms/);
});

test("the raw socket error text is never echoed into the reason (RT-02)", async () => {
  const { run } = versionCommand(VERSION_5);
  const { connect } = socketDialer(new Error("EACCES while reading PRIVATE-DETAIL"));
  const failure = failureOf(
    await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: TIMEOUT_MS }),
  );
  assert.equal(failure.reason.includes("PRIVATE-DETAIL"), false);
});

test("no XDG_RUNTIME_DIR gives PODMAN_MACHINE_DOWN without dialing (RT-02)", async () => {
  const { run } = versionCommand(VERSION_5);
  const { connect, dials } = socketDialer("connect");
  const failure = failureOf(
    await probePodman({
      runCommand: run,
      connectSocket: connect,
      env: { PATH: "/usr/bin", HOME: "/home/tester" },
      timeoutMs: TIMEOUT_MS,
    }),
  );
  assert.equal(failure.code, "PODMAN_MACHINE_DOWN");
  assert.match(failure.reason, /XDG_RUNTIME_DIR/);
  assert.equal(dials.length, 0);
});

test("Podman 5.x with a connectable socket passes and dials only the XDG-derived socket (RT-02)", async () => {
  const { run, calls } = versionCommand(VERSION_5);
  const { connect, dials } = socketDialer("connect");
  const result = await probePodman({ runCommand: run, connectSocket: connect, env: ENV, timeoutMs: TIMEOUT_MS });
  assert.deepEqual(result, { ok: true, version: "5.3.1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.file, "podman");
  assert.deepEqual(calls[0]?.args, ["--version"]);
  assert.deepEqual(dials, [{ socketPath: SOCKET_PATH, timeoutMs: TIMEOUT_MS }]);
});

test("the version command receives only PATH, HOME and XDG_RUNTIME_DIR from the environment (RT-02)", async () => {
  const { run, calls } = versionCommand(VERSION_5);
  const { connect } = socketDialer("connect");
  await probePodman({
    runCommand: run,
    connectSocket: connect,
    env: { ...ENV, SECRET_TOKEN: "do-not-pass", LANG: "C" },
    timeoutMs: TIMEOUT_MS,
  });
  assert.deepEqual(calls[0]?.options.env, { PATH: "/usr/bin", HOME: "/home/tester", XDG_RUNTIME_DIR: RUNTIME_DIR });
  assert.equal(calls[0]?.options.timeoutMs, TIMEOUT_MS);
});
