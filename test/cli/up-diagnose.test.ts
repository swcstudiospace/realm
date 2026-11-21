// `realm up` names a missing configured workspaceRoot (ADR-0003, US-111, AC-34). Hermetic: every
// seam is injected; the fake daemon never answers, and the fake daemon.log carries the `daemon.failed`
// POLICY_DENIED line the real daemon entry writes when its ceiling bind refuses the stored path. The
// assertion is the AC-34 contract: exit 1, POLICY_DENIED on stdout, and one stderr line naming the
// one missing directory with its one remedy. The daemon.log line itself stays code-only: this test
// never writes a path into it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type ConnectDaemon, type SendControlRequest } from "../../src/cli/main.js";
import type { SpawnDaemon } from "../../src/daemon/launch.js";
import type { EnvironmentLike } from "../../src/session/paths.js";
import { RealmError } from "../../src/core/errors.js";
// The AC-34 remedy wording, asserted by literal (the contract text, not an implementation symbol).
const REMEDY = "Point workspaceRoot at an existing directory owned by the account, or remove the stale config.";

function okVersion(): Promise<{ exitCode: number; stdout: string }> {
  return Promise.resolve({ exitCode: 0, stdout: "podman version 5.5.0\n" });
}

function acceptConnect(): Promise<void> {
  return Promise.resolve();
}

void test("realm up with a stale configured workspaceRoot: exit 1, POLICY_DENIED, names the directory (AC-34)", async () => {
  const base = mkdtempSync(join(tmpdir(), "realm-up-diagnose-"));
  const configHome = join(base, "config");
  const stateDir = join(configHome, "state");
  const workspace = join(base, "workspace");
  const missing = join(base, "ompos");
  try {
    mkdirSync(join(configHome, "realm"), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      join(configHome, "realm", "config.json"),
      JSON.stringify({
        image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
        stateDir,
        // The stale stored config from the brief: a workspaceRoot that does not exist.
        workspaceRoot: missing,
      }),
      "utf8",
    );
    const env: EnvironmentLike = {
      PATH: "/usr/bin",
      HOME: "/root",
      XDG_RUNTIME_DIR: "/run/user/0",
      XDG_CONFIG_HOME: configHome,
    };
    let connects = 0;
    const connect: ConnectDaemon = () => {
      connects += 1;
      if (connects === 2) {
        // The detached daemon's ceiling bind refused the stored path and the entry wrote its
        // code-only failure line before exiting. Its bytes land after the first probe recorded
        // the log offset, exactly as a real spawn does.
        appendFileSync(
          join(stateDir, "daemon.log"),
          `${JSON.stringify({ ts: "2026-11-21T00:00:00.000Z", level: "error", event: "daemon.failed", code: "POLICY_DENIED" })}\n`,
          "utf8",
        );
      }
      return {
        status: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
        up: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
        call: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
        metrics: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
        close: () => undefined,
      };
    };
    let spawns = 0;
    const spawn: SpawnDaemon = () => {
      spawns += 1;
      return { unref: () => undefined };
    };
    const send: SendControlRequest = () => {
      throw new Error("the start refusal must surface before any control request");
    };
    const result = await runCli(["up"], {
      env,
      cwd: workspace,
      send,
      connect,
      runCommand: okVersion,
      connectSocket: acceptConnect,
      spawn,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "POLICY_DENIED\n");
    assert.equal(spawns, 1, "one daemon spawn, then the refusal surfaces");
    const diagnosis = `realm up: POLICY_DENIED: workspaceRoot ${missing} does not exist. ${REMEDY}`;
    assert.ok(result.stderr.includes(diagnosis), `stderr names the one missing directory: ${result.stderr}`);
    assert.ok(result.stderr.includes("realm: the daemon's startup output is in"), "the log hint still follows");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

void test("realm up with an existing configured workspaceRoot and a healthy daemon names nothing", async () => {
  const base = mkdtempSync(join(tmpdir(), "realm-up-diagnose-"));
  const configHome = join(base, "config");
  const stateDir = join(configHome, "state");
  const workspace = join(base, "workspace");
  try {
    mkdirSync(join(configHome, "realm"), { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(
      join(configHome, "realm", "config.json"),
      JSON.stringify({
        image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
        stateDir,
        workspaceRoot: workspace,
      }),
      "utf8",
    );
    const env: EnvironmentLike = {
      PATH: "/usr/bin",
      HOME: "/root",
      XDG_RUNTIME_DIR: "/run/user/0",
      XDG_CONFIG_HOME: configHome,
    };
    const connect: ConnectDaemon = (_socketPath, selection) => ({
      status: () =>
        Promise.resolve({
          snapshot: { state: "active", reason: "realm active", lastTransitionAt: "2026-11-21T00:00:00.000Z" },
          display: { label: "realm active", reason: "realm active", lastTransitionAt: "2026-11-21T00:00:00.000Z" },
          mode: "advisory",
          sessionId: selection.sessionId,
        }),
      up: () =>
        Promise.resolve({
          snapshot: { state: "active", reason: "realm active", lastTransitionAt: "2026-11-21T00:00:00.000Z" },
          display: { label: "realm active", reason: "realm active", lastTransitionAt: "2026-11-21T00:00:00.000Z" },
          mode: "advisory",
          sessionId: selection.sessionId,
        }),
      call: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
      metrics: () => Promise.reject(new RealmError("REALM_NOT_ACTIVE")),
      close: () => undefined,
    });
    const send: SendControlRequest = (_socketPath, request) =>
      Promise.resolve({ id: request.id, result: { snapshot: { state: "active", reason: "" } } });
    const spawn: SpawnDaemon = () => {
      throw new Error("a daemon already answers: no spawn");
    };
    const result = await runCli(["up"], {
      env,
      cwd: workspace,
      send,
      connect,
      runCommand: okVersion,
      connectSocket: acceptConnect,
      spawn,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "", "no diagnostic is written when nothing is missing");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
