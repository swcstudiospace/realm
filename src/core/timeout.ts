// Time-bounded helpers: a promise race against a timer (D-28, QUAL-01) and a Unix-socket dial with a deadline
// (Q0-003). Each clears its timer as soon as it settles, so no timer outlives the call.

import { createConnection, type Socket } from "node:net";
import { makeRealmError, type ErrorCode } from "./errors.js";

// Settles with the work's result, or rejects with the catalogue error for code when ms elapse first.
export function withTimeout<T>(work: Promise<T>, ms: number, code: ErrorCode): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(makeRealmError(code));
    }, ms);
  });
  return Promise.race([work, expiry]).finally(() => {
    clearTimeout(timer);
  });
}

// Resolves after ms. It never rejects and cannot be cancelled; a caller that must stop waiting early uses an
// abort-aware wait instead (sleepUnlessAborted in src/anda/client.ts).
export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Connects to the Unix socket at socketPath. Resolves with the connected socket, which the caller then owns and must
// destroy when it is done with it. Rejects with the socket's own error on refusal or a missing socket, with the socket
// destroyed. Rejects with a RealmError carrying timeoutCode when no connection completes within timeoutMs, with the
// socket destroyed. The socket error is never a RealmError, so a caller tells a timeout from a socket failure by
// instanceof RealmError.
export function dialWithin(socketPath: string, timeoutMs: number, timeoutCode: ErrorCode): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(makeRealmError(timeoutCode));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error: Error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error);
    });
  });
}
