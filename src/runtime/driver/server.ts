// The realm's gRPC listening sockets (phase 9.4, PRD-DRV-01).
// A socket lives in a directory only the realm account can enter, and the socket itself is writable by that account
// alone. Four rules hold before any request is accepted:
//
// - The parent directory is created with mode 0700, or an existing one is set to 0700. It must be a real directory, not
//   a symbolic link, owned by this process's account.
// - The socket is bound under a umask of 0177, so it is created 0600, and then its mode is checked.
// - A path that exists is refused unless it is a socket owned by this account and nothing listens on it. A stale socket
//   is removed; a live one is refused. A regular file, a directory, a symbolic link or a foreign socket is never removed.
// - The server removes its own socket on close, and only when the path is still that socket.

import { Server, ServerCredentials, type ServiceDefinition, type UntypedServiceImplementation } from "@grpc/grpc-js";
import { chmodSync, lstatSync, mkdirSync, unlinkSync, type Stats } from "node:fs";
import { connect } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { makeRealmError } from "../../core/errors.js";

const PARENT_MODE = 0o700;
const SOCKET_MODE = 0o600;
// The umask that makes a newly bound socket 0600: no group or world bits are granted.
const SOCKET_UMASK = 0o177;
const PERMISSION_BITS = 0o777;

// One gRPC service bound on a socket, with its handlers.
export interface BoundService {
  readonly service: ServiceDefinition;
  readonly implementation: UntypedServiceImplementation;
}

export interface SocketServer {
  readonly socketPath: string;
  close(): Promise<void>;
}

// Binds the services on socketPath and resolves once it accepts connections. It refuses before binding when the path
// cannot be the server's own socket. A refusal throws a catalogue error. A bound socket that fails the post-bind check is
// shut down and removed before the error is thrown, so nothing keeps listening on a path that was refused.
export async function startSocketServer(socketPath: string, services: readonly BoundService[]): Promise<SocketServer> {
  if (!isAbsolute(socketPath)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const uid = accountUid();
  prepareParent(dirname(socketPath), uid);
  await clearStaleSocket(socketPath, uid);

  const server = new Server();
  for (const { service, implementation } of services) {
    server.addService(service, implementation);
  }
  await bindSocket(server, socketPath);
  try {
    verifySocket(socketPath, uid);
  } catch (error: unknown) {
    await closeAndRemove(server, socketPath).catch(() => undefined);
    throw error;
  }
  return {
    socketPath,
    close: () => closeAndRemove(server, socketPath),
  };
}

export function accountUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return uid;
}

// Creates the parent directory when it is missing, then holds it to the rules: a real directory, owned by the account,
// set to 0700. A symbolic link or a directory owned by someone else is refused, never followed.
export function prepareParent(parent: string, uid: number): void {
  let stat = statOrNull(parent);
  if (stat === null) {
    try {
      mkdirSync(parent, { mode: PARENT_MODE });
    } catch {
      throw makeRealmError("SCHEMA_INVALID");
    }
    stat = statOrNull(parent);
  }
  if (stat === null || stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== uid) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if ((stat.mode & PERMISSION_BITS) !== PARENT_MODE) {
    chmodSync(parent, PARENT_MODE);
  }
}

// Decides the state of an existing path. A missing path is fine. A socket owned by this account with no listener is a
// stale leftover and is removed. Anything else is refused.
async function clearStaleSocket(socketPath: string, uid: number): Promise<void> {
  const stat = statOrNull(socketPath);
  if (stat === null) {
    return;
  }
  if (!stat.isSocket() || stat.uid !== uid) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if (await isListening(socketPath)) {
    throw makeRealmError("LOCK_CONFLICT");
  }
  unlinkSync(socketPath);
}

// True when a connection to the path succeeds, so a live server owns it. A refused or missing connection means nothing
// listens there.
function isListening(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => {
      probe.destroy();
      resolve(false);
    });
  });
}

// Binds under the restrictive umask, then restores the previous umask whatever happens. The umask is process-wide, so
// it is set only for the bind, and each server binds once, at startup.
async function bindSocket(server: Server, socketPath: string): Promise<void> {
  const previous = process.umask(SOCKET_UMASK);
  try {
    await new Promise<void>((resolve, reject) => {
      server.bindAsync(`unix:${socketPath}`, ServerCredentials.createInsecure(), (error) => {
        if (error !== null) {
          reject(makeRealmError("SCHEMA_INVALID"));
          return;
        }
        resolve();
      });
    });
  } finally {
    process.umask(previous);
  }
}

// Holds the bound path to the rules. A socket that is not 0600 is set to 0600. A path that is not a socket, or that this
// account does not own, is refused; the caller then shuts the server down and removes the path.
function verifySocket(socketPath: string, uid: number): void {
  const stat = statOrNull(socketPath);
  if (stat === null || !stat.isSocket() || stat.uid !== uid) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  if ((stat.mode & PERMISSION_BITS) !== SOCKET_MODE) {
    chmodSync(socketPath, SOCKET_MODE);
  }
}

// Stops accepting, then removes the socket if it is still the one this server bound.
function closeAndRemove(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.tryShutdown((error) => {
      if (error !== undefined) {
        reject(makeRealmError("CLEANUP_FAILED"));
        return;
      }
      const stat = statOrNull(socketPath);
      if (stat !== null && stat.isSocket()) {
        unlinkSync(socketPath);
      }
      resolve();
    });
  });
}

function statOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw makeRealmError("SCHEMA_INVALID");
  }
}
