// Daemon startup helper tests (wave 3). The probe and spawn are scripted fakes; no process is
// started and no socket is opened. A test whose probe answers after a few polls gives ensureDaemon a
// generous scaled bound (it returns the moment the daemon answers, so the bound costs nothing), and
// a test that needs the bound to expire runs it on node's mocked time, not on a real wait.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { daemonAnswers, ensureDaemon } from "../../src/daemon/ensure.js";
import type { ControlSelection } from "../../src/daemon/channel.js";
import { scaledMs, testTimeout } from "../support/timing.js";

type EnsureOptions = Parameters<typeof ensureDaemon>[0];
type ProbeResult = Awaited<ReturnType<EnsureOptions["probe"]>>;

const SOCKET = "/state/run/control.sock";
// The selection every daemonAnswers probe in this file is built with. daemonAnswers derives none itself.
const SELECTION: ControlSelection = { workspaceRoot: "/state/workspace", sessionId: "p0123456789ab" };
// The bound for a daemon that answers after a few polls: far above any host stall.
const ANSWER_BOUND_MS = 30_000;

// The probe results a test scripts: an answering daemon, a socket nothing holds, and a socket a daemon holds without answering.
const ANSWERING: ProbeResult = { presence: "answering" };
const ABSENT: ProbeResult = { presence: "absent", code: "REALM_NOT_ACTIVE" };
const STARTING: ProbeResult = { presence: "starting", code: "TOOL_TIMEOUT" };

// A probe that reports one scripted presence per call; the last entry repeats. The probe counts its calls.
function scripted(...sequence: ProbeResult[]): { probe: (path: string) => Promise<ProbeResult>; calls: () => number } {
  let calls = 0;
  return {
    probe: (path) => {
      assert.equal(path, SOCKET);
      const result = sequence[Math.min(calls, sequence.length - 1)] as ProbeResult;
      calls += 1;
      return Promise.resolve(result);
    },
    calls: () => calls,
  };
}

void test("a probe that already finds an answering daemon returns at once with no spawn", async () => {
  const probing = scripted(ANSWERING);
  let spawns = 0;
  await ensureDaemon({
    socketPath: SOCKET,
    probe: probing.probe,
    spawnDaemon: () => {
      spawns += 1;
    },
    timeoutMs: 200,
    pollMs: 10,
  });
  assert.equal(probing.calls(), 1);
  assert.equal(spawns, 0);
});

void test("an absent socket spawns exactly once, however long it stays absent, and returns when the daemon answers", async () => {
  const probing = scripted(ABSENT, ABSENT, ABSENT, ABSENT, ANSWERING);
  let spawns = 0;
  await ensureDaemon({
    socketPath: SOCKET,
    probe: probing.probe,
    spawnDaemon: () => {
      spawns += 1;
    },
    timeoutMs: scaledMs(ANSWER_BOUND_MS),
    pollMs: 5,
  });
  assert.equal(spawns, 1);
  assert.equal(probing.calls(), 5);
});

void test("a daemon that holds the socket but has not answered is never spawned over, and gets the whole bound to answer", async () => {
  // A daemon busy with its startup reap holds requests, so a status probe times out while the socket is alive. Spawning a
  // second daemon would only make it refuse with LOCK_CONFLICT, and the waiting hosts would read that as their start failing.
  const probing = scripted(STARTING, STARTING, STARTING, STARTING, ANSWERING);
  let spawns = 0;
  await ensureDaemon({
    socketPath: SOCKET,
    probe: probing.probe,
    spawnDaemon: () => {
      spawns += 1;
    },
    timeoutMs: scaledMs(ANSWER_BOUND_MS),
    pollMs: 5,
  });
  assert.equal(spawns, 0);
  assert.equal(probing.calls(), 5);
});

void test("a daemon that held the socket and then vanishes is replaced once", async () => {
  const probing = scripted(STARTING, ABSENT, ABSENT, ABSENT, ANSWERING);
  let spawns = 0;
  await ensureDaemon({
    socketPath: SOCKET,
    probe: probing.probe,
    spawnDaemon: () => {
      spawns += 1;
    },
    timeoutMs: scaledMs(ANSWER_BOUND_MS),
    pollMs: 5,
  });
  assert.equal(spawns, 1);
});

// Advances node's mocked setTimeout and Date by stepMs per turn of the event loop until the work settles. The loop yields on
// setImmediate, which the mock does not touch, so the work's promise-only steps run between ticks. The step count bounds it, so
// work that never settles fails the test instead of spinning.
async function advanceUntilSettled(t: TestContext, work: Promise<unknown>, stepMs: number): Promise<void> {
  let settled = false;
  // Read through a function: the callbacks below assign the flag, which the compiler's flow analysis does not see.
  const hasSettled = (): boolean => settled;
  const done = work.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  for (let step = 0; step < 1_000 && !hasSettled(); step += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    t.mock.timers.tick(stepMs);
  }
  assert.ok(hasSettled(), "the wait did not end within 1000 steps");
  await done;
}

void test("a socket that stays absent throws DAEMON_START_TIMEOUT after one spawn, whose reason names a daemon start and not a tool", testTimeout(30_000), async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  let spawns = 0;
  const timeoutMs = 80;
  const pollMs = 10;
  const started = Date.now();
  const waiting = ensureDaemon({
    socketPath: SOCKET,
    probe: scripted(ABSENT).probe,
    spawnDaemon: () => {
      spawns += 1;
    },
    timeoutMs,
    pollMs,
  });
  const rejection = assert.rejects(
    waiting,
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "DAEMON_START_TIMEOUT" &&
      error.causeCode === "REALM_NOT_ACTIVE" &&
      /daemon start/.test(error.reason) &&
      !/tool/i.test(error.reason),
  );
  await advanceUntilSettled(t, waiting, pollMs);
  await rejection;
  const elapsed = Date.now() - started;
  assert.equal(spawns, 1);
  assert.ok(elapsed >= timeoutMs, `waited ${String(elapsed)}ms of mocked time, expected at least ${String(timeoutMs)}ms`);
  assert.ok(elapsed <= timeoutMs + pollMs, `waited ${String(elapsed)}ms of mocked time, expected a bounded wait`);
});

void test("a held socket that never answers throws DAEMON_START_TIMEOUT without any spawn", async () => {
  let spawns = 0;
  await assert.rejects(
    ensureDaemon({
      socketPath: SOCKET,
      probe: scripted(STARTING).probe,
      spawnDaemon: () => {
        spawns += 1;
      },
      timeoutMs: 60,
      pollMs: 10,
    }),
    (error: unknown) => error instanceof RealmError && error.code === "DAEMON_START_TIMEOUT" && error.causeCode === "TOOL_TIMEOUT",
  );
  assert.equal(spawns, 0);
});

void test("DAEMON_START_TIMEOUT carries the code of the last probe as its cause, not the first probe's", async () => {
  // The socket is absent at first, so one daemon is spawned. Then something holds it and cuts each reply short, so the
  // cause is that last reply's code.
  const probing = scripted(ABSENT, { presence: "starting", code: "SCHEMA_INVALID" });
  let spawns = 0;
  await assert.rejects(
    ensureDaemon({
      socketPath: SOCKET,
      probe: probing.probe,
      spawnDaemon: () => {
        spawns += 1;
      },
      timeoutMs: 60,
      pollMs: 10,
    }),
    (error: unknown) =>
      error instanceof RealmError && error.code === "DAEMON_START_TIMEOUT" && error.causeCode === "SCHEMA_INVALID",
  );
  assert.equal(spawns, 1);
});

void test("non-finite or non-positive intervals refuse with SCHEMA_INVALID before any probe", async () => {
  const probing = scripted(ANSWERING);
  const spawnDaemon = (): void => undefined;
  await assert.rejects(
    ensureDaemon({ socketPath: SOCKET, probe: probing.probe, spawnDaemon, timeoutMs: 100, pollMs: 0 }),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  await assert.rejects(
    ensureDaemon({ socketPath: SOCKET, probe: probing.probe, spawnDaemon, timeoutMs: -1, pollMs: 10 }),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.equal(probing.calls(), 0);
});

// The probe the CLI and the Omp extension share. A scripted client stands in for the control socket.
interface ScriptedClient {
  readonly client: { status: () => Promise<never>; close: () => void };
  readonly closes: () => number;
}

function scriptedClient(status: () => Promise<never>): ScriptedClient {
  let closed = 0;
  return {
    client: {
      status,
      close: () => {
        closed += 1;
      },
    },
    closes: () => closed,
  };
}

void test("daemonAnswers reports an answering daemon when the status request succeeds, and closes the client", async () => {
  let closed = 0;
  const answers = daemonAnswers((path, selection) => {
    assert.equal(path, SOCKET);
    assert.deepEqual(selection, SELECTION);
    return {
      status: () => Promise.resolve({} as never),
      close: () => {
        closed += 1;
      },
    };
  }, SELECTION);
  assert.deepEqual(await answers(SOCKET), { presence: "answering" });
  assert.equal(closed, 1);
});

void test("daemonAnswers reports an absent socket for a refused dial", async () => {
  const scripted = scriptedClient(() => Promise.reject(new RealmError("REALM_NOT_ACTIVE")));
  assert.deepEqual(await daemonAnswers(() => scripted.client, SELECTION)(SOCKET), { presence: "absent", code: "REALM_NOT_ACTIVE" });
  assert.equal(scripted.closes(), 1);
});

void test("daemonAnswers reports a daemon that holds the socket but has not answered, for a timeout and for a reply cut short", async () => {
  // A request that timed out (a daemon busy with its startup reap), and a reply cut short while the daemon is still
  // binding its socket. Both mean a daemon is there, so the host waits and never spawns another.
  for (const code of ["TOOL_TIMEOUT", "SCHEMA_INVALID"] as const) {
    const scripted = scriptedClient(() => Promise.reject(new RealmError(code)));
    assert.deepEqual(await daemonAnswers(() => scripted.client, SELECTION)(SOCKET), { presence: "starting", code }, code);
    assert.equal(scripted.closes(), 1, `${code} closes the client`);
  }
});

void test("daemonAnswers propagates any other failure unchanged and still closes the client", async () => {
  const refusal = new RealmError("PODMAN_MISSING");
  const refused = scriptedClient(() => Promise.reject(refusal));
  await assert.rejects(daemonAnswers(() => refused.client, SELECTION)(SOCKET), (error: unknown) => error === refusal);
  assert.equal(refused.closes(), 1);
  const defect = new Error("socket reset");
  const broken = scriptedClient(() => Promise.reject(defect));
  await assert.rejects(daemonAnswers(() => broken.client, SELECTION)(SOCKET), (error: unknown) => error === defect);
  assert.equal(broken.closes(), 1);
});
