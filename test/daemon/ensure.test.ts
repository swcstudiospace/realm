// Daemon startup helper tests (wave 3). The probe and spawn are scripted fakes; no process is
// started and no socket is opened, so the module runs hermetically with small timeouts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { daemonAnswers, ensureDaemon } from "../../src/daemon/ensure.js";

const SOCKET = "/state/run/control.sock";

void test("a probe that is already true returns at once with no spawn", async () => {
  let probes = 0;
  let spawns = 0;
  await ensureDaemon({
    socketPath: SOCKET,
    probe: (path) =>
      new Promise<boolean>((resolve) => {
        probes += 1;
        assert.equal(path, SOCKET);
        resolve(true);
      }),
    spawnDaemon: () => {
      spawns += 1;
    },
    timeoutMs: 200,
    pollMs: 10,
  });
  assert.equal(probes, 1);
  assert.equal(spawns, 0);
});

void test("a probe false then true after one spawn spawns exactly once and returns", async () => {
  let spawned = false;
  let polls = 0;
  let spawns = 0;
  await ensureDaemon({
    socketPath: SOCKET,
    probe: () => {
      if (!spawned) {
        return Promise.resolve(false);
      }
      polls += 1;
      return Promise.resolve(polls >= 3);
    },
    spawnDaemon: () => {
      spawns += 1;
      spawned = true;
    },
    timeoutMs: 1_000,
    pollMs: 5,
  });
  assert.equal(spawns, 1);
  assert.equal(polls, 3);
});

void test("a probe that never turns true throws DAEMON_START_TIMEOUT, whose reason names a daemon start and not a tool", async () => {
  let spawns = 0;
  const timeoutMs = 80;
  const started = Date.now();
  await assert.rejects(
    ensureDaemon({
      socketPath: SOCKET,
      probe: () => Promise.resolve(false),
      spawnDaemon: () => {
        spawns += 1;
      },
      timeoutMs,
      pollMs: 10,
    }),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "DAEMON_START_TIMEOUT" &&
      /daemon start/.test(error.reason) &&
      !/tool/i.test(error.reason),
  );
  const elapsed = Date.now() - started;
  assert.equal(spawns, 1);
  assert.ok(elapsed >= timeoutMs, `waited ${String(elapsed)}ms, expected at least ${String(timeoutMs)}ms`);
  assert.ok(elapsed < timeoutMs + 2_000, `waited ${String(elapsed)}ms, expected a bounded wait`);
});

void test("non-finite or non-positive intervals refuse with SCHEMA_INVALID before any probe", async () => {
  let probes = 0;
  const probe = (): Promise<boolean> => {
    probes += 1;
    return Promise.resolve(true);
  };
  const spawnDaemon = (): void => undefined;
  await assert.rejects(
    ensureDaemon({ socketPath: SOCKET, probe, spawnDaemon, timeoutMs: 100, pollMs: 0 }),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  await assert.rejects(
    ensureDaemon({ socketPath: SOCKET, probe, spawnDaemon, timeoutMs: -1, pollMs: 10 }),
    (error: unknown) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  assert.equal(probes, 0);
});

// The probe the CLI and the Omp extension share. A scripted client stands in for the control socket.
interface ScriptedClient {
  readonly client: { status: () => Promise<never>; close: () => void };
  readonly closes: () => number;
}

function scriptedClient(status: () => Promise<never>): ScriptedClient {
  let closed = 0;
  return {
    client: { status, close: () => { closed += 1; } },
    closes: () => closed,
  };
}

void test("daemonAnswers is true when the status request succeeds, and closes the client", async () => {
  let closed = 0;
  const answers = daemonAnswers((path) => {
    assert.equal(path, SOCKET);
    return {
      status: () => Promise.resolve({} as never),
      close: () => { closed += 1; },
    };
  });
  assert.equal(await answers(SOCKET), true);
  assert.equal(closed, 1);
});

void test("daemonAnswers reads every not-yet-answering failure as no daemon yet, so a host that starts the daemon keeps polling", async () => {
  // An absent socket, a request that timed out, and a reply cut short while the daemon is still binding its socket.
  for (const code of ["REALM_NOT_ACTIVE", "TOOL_TIMEOUT", "SCHEMA_INVALID"] as const) {
    const scripted = scriptedClient(() => Promise.reject(new RealmError(code)));
    assert.equal(await daemonAnswers(() => scripted.client)(SOCKET), false, code);
    assert.equal(scripted.closes(), 1, `${code} closes the client`);
  }
});

void test("daemonAnswers propagates any other failure unchanged and still closes the client", async () => {
  const refusal = new RealmError("PODMAN_MISSING");
  const refused = scriptedClient(() => Promise.reject(refusal));
  await assert.rejects(daemonAnswers(() => refused.client)(SOCKET), (error: unknown) => error === refusal);
  assert.equal(refused.closes(), 1);
  const defect = new Error("socket reset");
  const broken = scriptedClient(() => Promise.reject(defect));
  await assert.rejects(daemonAnswers(() => broken.client)(SOCKET), (error: unknown) => error === defect);
  assert.equal(broken.closes(), 1);
});
