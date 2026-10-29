// Realm state for the scripted-provider harness (HARN-02, D-1202). startRealmDaemon runs the real
// daemon in the test process over the existing fakes, exactly as test/daemon/e2e.test.ts does, so a
// plugin dialing the control socket sees the same five things a live realm shows: socket presence,
// up, status (snapshot, display, mode), tool, and socket disappearance. startScriptedControlServer
// is the hand-rolled alternative for states the real controller cannot be driven into cheaply.

import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { sendRequest, type ControlReply } from "../../src/daemon/channel.js";
import { startDaemon, type StartedDaemon } from "../../src/daemon/daemon.js";
import type { PolicyMode } from "../../src/contract/validate.js";
import type { PodmanProbeResult } from "../../src/runtime/podman-probe.js";
import { FakeBridge } from "./fake-bridge.js";
import { FakeExecutionService } from "./fake-execution.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";
const CONTROL_TIMEOUT_MS = 5000;
const DONE_WAIT_MS = 5000;

export interface RealmDaemonOptions {
  // The daemon's state directory. policy.json is written beside it (in its parent directory), which
  // must not be inside the workspace: the policy loader refuses a policy file inside a workspace root.
  readonly stateDir: string;
  readonly workspace: string;
  readonly mode: PolicyMode;
}

export interface RealmDaemonFixture {
  readonly socketPath: string;
  readonly policyPath: string;
  // Sends the same { method: "down" } request `realm down` sends, then awaits the daemon's done.
  down(): Promise<void>;
  // The daemon's status reply as the control channel returns it.
  status(): Promise<ControlReply>;
  readonly done: Promise<void>;
}

async function awaitDone(daemon: StartedDaemon): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("daemon done did not resolve"));
    }, DONE_WAIT_MS);
  });
  try {
    await Promise.race([daemon.done, expired]);
  } finally {
    clearTimeout(timer);
  }
}

export async function startRealmDaemon(options: RealmDaemonOptions): Promise<RealmDaemonFixture> {
  const policyDir = dirname(options.stateDir);
  mkdirSync(policyDir, { recursive: true });
  const policyPath = join(policyDir, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ mode: options.mode, workspaceRoots: [options.workspace] }));
  const daemon = await startDaemon({
    runtimeInput: { image: IMAGE, stateDir: options.stateDir, workspaceRoot: options.workspace },
    policyPath,
    sessionId: "sess-harness",
    exec: new FakeExecutionService(),
    bridge: new FakeBridge(),
    clock: () => new Date(CLOCK_ISO),
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    sweep: () => Promise.resolve(0),
    probe: () => Promise.resolve<PodmanProbeResult>({ ok: true, version: "5.0.0" }),
  });
  let downCount = 0;
  return Object.freeze({
    socketPath: daemon.socketPath,
    policyPath,
    done: daemon.done,
    async down(): Promise<void> {
      downCount += 1;
      await sendRequest(
        daemon.socketPath,
        { id: `harness-down-${String(downCount)}`, method: "down" },
        { timeoutMs: CONTROL_TIMEOUT_MS },
      );
      await awaitDone(daemon);
    },
    status(): Promise<ControlReply> {
      return sendRequest(daemon.socketPath, { id: "harness-status", method: "status" }, { timeoutMs: CONTROL_TIMEOUT_MS });
    },
  });
}

// What the scripted server does with one request: reply with this body, never reply (a hung peer),
// or send these raw bytes (a malformed reply).
export type ScriptedReply =
  | { readonly kind: "reply"; readonly result?: unknown; readonly error?: { readonly code: string; readonly causeCode?: string }; readonly delayMs?: number }
  | { readonly kind: "hang" }
  | { readonly kind: "raw"; readonly line: string };

export interface ScriptedControlServer {
  readonly socketPath: string;
  // Methods received, in order.
  readonly requests: readonly string[];
  close(): Promise<void>;
}

// One request line per connection, one reply line, socket ended: the shape of the real daemon channel.
// The script is called with the request's method and params and decides the reply.
export async function startScriptedControlServer(
  socketPath: string,
  script: (method: string, params: unknown) => ScriptedReply,
): Promise<ScriptedControlServer> {
  const requests: string[] = [];
  const sockets = new Set<Socket>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    let text = "";
    socket.on("data", (chunk) => {
      text += String(chunk);
      const end = text.indexOf("\n");
      if (end === -1) {
        return;
      }
      const request = JSON.parse(text.slice(0, end)) as { id: number | string; method: string; params?: unknown };
      requests.push(request.method);
      const scripted = script(request.method, request.params);
      if (scripted.kind === "hang") {
        return;
      }
      const line =
        scripted.kind === "raw"
          ? scripted.line
          : `${JSON.stringify({
              id: request.id,
              ...(scripted.error === undefined ? { result: scripted.result } : { error: scripted.error }),
            })}\n`;
      const send = (): void => {
        socket.end(line);
      };
      if (scripted.kind === "reply" && scripted.delayMs !== undefined) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          send();
        }, scripted.delayMs);
        timers.add(timer);
      } else {
        send();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      resolve();
    });
  });
  return {
    socketPath,
    requests,
    close(): Promise<void> {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      timers.clear();
      for (const socket of sockets) {
        socket.destroy();
      }
      return new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}
