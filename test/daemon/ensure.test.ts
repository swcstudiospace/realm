// Daemon startup helper tests (wave 3). The probe and spawn are scripted fakes; no process is
// started and no socket is opened, so the module runs hermetically with small timeouts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmError } from "../../src/core/errors.js";
import { ensureDaemon } from "../../src/daemon/ensure.js";

const SOCKET = "/state/run/control.sock";

test("a probe that is already true returns at once with no spawn", async () => {
  let probes = 0;
  let spawns = 0;
  await ensureDaemon({
    socketPath: SOCKET,
    probe: async (path) => {
      probes += 1;
      assert.equal(path, SOCKET);
      return true;
    },
    spawnDaemon: () => {
      spawns += 1;
    },
    timeoutMs: 200,
    pollMs: 10,
  });
  assert.equal(probes, 1);
  assert.equal(spawns, 0);
});

test("a probe false then true after one spawn spawns exactly once and returns", async () => {
  let spawned = false;
  let polls = 0;
  let spawns = 0;
  await ensureDaemon({
    socketPath: SOCKET,
    probe: async () => {
      if (!spawned) {
        return false;
      }
      polls += 1;
      return polls >= 3;
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

test("a probe that never turns true throws TOOL_TIMEOUT after the bounded wait", async () => {
  let spawns = 0;
  const timeoutMs = 80;
  const started = Date.now();
  await assert.rejects(
    ensureDaemon({
      socketPath: SOCKET,
      probe: async () => false,
      spawnDaemon: () => {
        spawns += 1;
      },
      timeoutMs,
      pollMs: 10,
    }),
    (error: unknown) => error instanceof RealmError && error.code === "TOOL_TIMEOUT",
  );
  const elapsed = Date.now() - started;
  assert.equal(spawns, 1);
  assert.ok(elapsed >= timeoutMs, `waited ${elapsed}ms, expected at least ${timeoutMs}ms`);
  assert.ok(elapsed < timeoutMs + 2_000, `waited ${elapsed}ms, expected a bounded wait`);
});

test("non-finite or non-positive intervals refuse with SCHEMA_INVALID before any probe", async () => {
  let probes = 0;
  const probe = async (): Promise<boolean> => {
    probes += 1;
    return true;
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
