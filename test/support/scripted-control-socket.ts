// An in-process stand-in daemon on a control socket, for the stall probe (Phase 45, OMPV-02). It answers each NDJSON request line
// with one reply line carrying the request id, after a scripted latency per method. The latency series of a method is consumed in
// request order and its last value repeats; an empty or absent series means no delay.
//
// test/omp/extension.test.ts has a stand-in of its own (startStub) that is entangled with a per-file host-boot recorder and
// answers with no delay, so this probe gets its own small module with scripted latency instead of editing that file. The default
// responder mirrors the shapes startStub answers: status and up answer an active, advisory daemon stamped with the session id of
// the workspace the request names (the client refuses a reply whose session id is not its own), host-boot answers recorded, and
// capability-attach answers mode off. The caller picks the socket path and keeps it under the 108-byte Unix path limit.

import { createServer, type Server, type Socket } from "node:net";
import { rmSync } from "node:fs";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";

export interface ScriptedRequest {
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

// What the stand-in answers: a result, or a catalogue error code.
export type ScriptedReply = { readonly result: unknown } | { readonly error: { readonly code: string } };

export interface ScriptedControlSocketOptions {
  readonly socketPath: string;
  // Reply latency series in milliseconds by method name.
  readonly latenciesMs?: Readonly<Record<string, readonly number[]>>;
  // An override for the reply to a request; undefined falls through to the default responder.
  readonly respond?: (request: ScriptedRequest) => ScriptedReply | undefined;
  // Catalogue codes the up requests are refused with, in request order. undefined entries and requests past the end succeed.
  readonly upRefusals?: readonly (string | undefined)[];
}

export interface ScriptedControlSocket {
  // The method of every request received, in arrival order.
  readonly requests: readonly string[];
  close(): Promise<void>;
}

const AT = "2026-11-19T00:00:00.000Z";
const ACTIVE_STATUS = {
  snapshot: { state: "active", reason: "realm active", lastTransitionAt: AT },
  display: { label: "realm active", reason: "realm active", lastTransitionAt: AT },
  mode: "advisory",
};

// The session id the request names: up names its workspace in workspaceRoot, every other selected request in its selection.
function sessionIdOfRequest(request: ScriptedRequest): string {
  const params = request.params as
    | { readonly workspaceRoot?: string; readonly selection?: { readonly workspaceRoot: string } }
    | undefined;
  const root = params?.workspaceRoot ?? params?.selection?.workspaceRoot;
  if (root === undefined) {
    throw new Error("the request names no workspace");
  }
  return sessionIdOfWorkspace(root);
}

// The default responder: see the header.
export function defaultReply(request: ScriptedRequest): ScriptedReply {
  if (request.method === "host-boot") {
    return { result: { recorded: true } };
  }
  if (request.method === "capability-attach") {
    return { result: { mode: "off" } };
  }
  return { result: { ...ACTIVE_STATUS, sessionId: sessionIdOfRequest(request) } };
}

export function startScriptedControlSocket(options: ScriptedControlSocketOptions): Promise<ScriptedControlSocket> {
  const requests: string[] = [];
  const consumed = new Map<string, number>();
  const timers = new Set<NodeJS.Timeout>();
  const sockets = new Set<Socket>();
  let upSeen = 0;

  const latencyOf = (method: string): number => {
    const series = options.latenciesMs?.[method];
    if (series === undefined || series.length === 0) {
      return 0;
    }
    const index = consumed.get(method) ?? 0;
    consumed.set(method, index + 1);
    return series[Math.min(index, series.length - 1)] ?? 0;
  };

  const replyTo = (request: ScriptedRequest): ScriptedReply => {
    if (request.method === "up") {
      const code = options.upRefusals?.[upSeen];
      upSeen += 1;
      if (code !== undefined) {
        return { error: { code } };
      }
    }
    return options.respond?.(request) ?? defaultReply(request);
  };

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
    socket.on("error", () => undefined);
    let text = "";
    socket.on("data", (chunk) => {
      text += String(chunk);
      const end = text.indexOf("\n");
      if (end === -1) {
        return;
      }
      const request = JSON.parse(text.slice(0, end)) as ScriptedRequest;
      text = text.slice(end + 1);
      requests.push(request.method);
      const reply = replyTo(request);
      const write = (): void => {
        if (!socket.destroyed) {
          socket.end(`${JSON.stringify({ id: request.id, ...reply })}\n`);
        }
      };
      const delay = latencyOf(request.method);
      if (delay <= 0) {
        write();
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        write();
      }, delay);
      timers.add(timer);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.socketPath, () => {
      resolve({
        requests,
        close: () =>
          new Promise<void>((done) => {
            for (const timer of timers) {
              clearTimeout(timer);
            }
            timers.clear();
            for (const socket of sockets) {
              socket.destroy();
            }
            server.close(() => {
              rmSync(options.socketPath, { force: true });
              done();
            });
          }),
      });
    });
  });
}
