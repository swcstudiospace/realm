// The files and the start of the built-in runtime channel (phase 9.5, waves 2 and 3). A sandbox's channel directory holds the
// runtime's bootstrap, its server certificate and key, and the control socket the runtime creates. It is bound read-write into the
// container. The descriptor and the supervisor auth bundle sit beside it in the sandbox's secret directory, outside the container.
// Every file is created at 0600 with O_EXCL and O_NOFOLLOW, so a file that exists or a symbolic link is refused, never followed.
//
// The TLS material is an ECDSA P-256 CA and one server leaf for the runtime, made by the openssl CLI through execFile with an
// argument array and no shell. The CA key is removed as soon as the leaf is signed. The runtime is the container's main process,
// so it reads its server key at startup. The driver removes that key only after a TLS handshake with the runtime's listener has
// completed (awaitRuntimeListener), so nothing after the listener is confirmed reads the key from the channel. No key, key path or openssl
// output reaches an error or a log: a failed command is reported with its catalogue code only.

import { execFile } from "node:child_process";
import { connect as tlsConnect } from "node:tls";
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { makeRealmError } from "../../core/errors.js";
import {
  AUTH_FILE_NAME,
  BOOTSTRAP_FILE_NAME,
  CHANNEL_DIR_NAME,
  DESCRIPTOR_FILE_NAME,
  MAIN_EXIT_MARKER_NAME,
  SSH_DIR_NAME,
  TLS_WORK_DIR_NAME,
} from "./secret-store.js";
import { serializeJson, type RuntimeChannel } from "./runtime-channel.js";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
// The validity of the CA and the runtime's leaf. A sandbox lives for the life of its runtime, which is bounded by its delete.
const CERTIFICATE_DAYS = "3650";
const OPENSSL_TIMEOUT_MS = 30_000;
// How long the driver waits for the runtime's listener to complete a TLS handshake after the container starts.
const SOCKET_WAIT_MS = 15_000;
const SOCKET_POLL_MS = 100;
// The longest one handshake probe may run before it counts as not confirmed. A stalled listener does not hold the wait past this.
const HANDSHAKE_PROBE_MS = 1000;
const CA_COMMON_NAME = "realm-sandbox-runtime-ca";
const CA_KEY_NAME = "ca.key";
const LEAF_COMMON_NAME = "realm-sandbox-runtime";
const LEAF_EXTENSIONS = "[ext]\nsubjectAltName = DNS:%SERVER_NAME%\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = serverAuth\n";
// The longest unix socket path a socket address holds: sun_path is 108 bytes with the terminating NUL. A longer path cannot bind.
const UNIX_SOCKET_PATH_MAX_BYTES = 107;
// The supervisor's SSH socket file name, inside the sandbox's SSH directory.
const SSH_SOCKET_NAME = "ssh.sock";

// The host paths of one sandbox's channel. Every path sits under the sandbox's secret directory.
export interface ChannelPaths {
  readonly secretDir: string;
  readonly channelDir: string;
  readonly tlsDir: string;
  readonly bootstrap: string;
  readonly certificate: string;
  readonly privateKey: string;
  readonly controlSocket: string;
  // The supervisor's SSH socket. It sits in the secret directory's ssh/ subdirectory, never under the channel directory or a tmpfs.
  readonly sshSocket: string;
  readonly descriptor: string;
  readonly auth: string;
  readonly mainExitMarker: string;
}

export function channelPathsOf(secretDir: string): ChannelPaths {
  const channelDir = join(secretDir, CHANNEL_DIR_NAME);
  return {
    secretDir,
    channelDir,
    tlsDir: join(secretDir, TLS_WORK_DIR_NAME),
    bootstrap: join(channelDir, BOOTSTRAP_FILE_NAME),
    certificate: join(channelDir, "server.crt"),
    privateKey: join(channelDir, "server.key"),
    controlSocket: join(channelDir, "control.sock"),
    sshSocket: join(secretDir, SSH_DIR_NAME, SSH_SOCKET_NAME),
    descriptor: join(secretDir, DESCRIPTOR_FILE_NAME),
    auth: join(secretDir, AUTH_FILE_NAME),
    mainExitMarker: join(secretDir, MAIN_EXIT_MARKER_NAME),
  };
}

// Creates the channel directory at 0700. It must not exist, so a leftover directory is never reused.
export function makeChannelDirectory(paths: ChannelPaths): void {
  try {
    mkdirSync(paths.channelDir, { mode: PRIVATE_DIR_MODE });
    chmodSync(paths.channelDir, PRIVATE_DIR_MODE);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// Writes the CA and the runtime's leaf: the leaf certificate and key into the channel directory, and the CA certificate text
// returned to the caller as the descriptor's trust anchor. The CA key is removed once the leaf is signed, and the TLS work
// directory once the CA certificate has been read. A key or directory that cannot be removed is refused with CLEANUP_FAILED.
export async function generateRuntimeTls(paths: ChannelPaths, serverName: string): Promise<string> {
  try {
    mkdirSync(paths.tlsDir, { mode: PRIVATE_DIR_MODE });
    chmodSync(paths.tlsDir, PRIVATE_DIR_MODE);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  let trustAnchor: string;
  try {
    trustAnchor = await issueLeaf(paths, serverName);
  } catch {
    // The work directory is left for the caller's discard, which removes the secret directory's TLS entries too.
    throw makeRealmError("OPENSHELL_START_FAILED");
  }
  removeKeyFile(join(paths.tlsDir, CA_KEY_NAME));
  removeTlsWorkDirectory(paths.tlsDir);
  return trustAnchor;
}

// Runs the openssl steps in the TLS work directory and returns the CA certificate text. Any failure rejects; the caller maps it.
async function issueLeaf(paths: ChannelPaths, serverName: string): Promise<string> {
  const caKey = join(paths.tlsDir, CA_KEY_NAME);
  const caCert = join(paths.tlsDir, "ca.crt");
  const csr = join(paths.tlsDir, "server.csr");
  const extensions = join(paths.tlsDir, "leaf.ext");
  await runOpenssl([
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-keyout", caKey, "-out", caCert, "-days", CERTIFICATE_DAYS, "-subj", `/CN=${CA_COMMON_NAME}`,
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
  ]);
  await runOpenssl([
    "req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-keyout", paths.privateKey, "-out", csr, "-subj", `/CN=${LEAF_COMMON_NAME}`,
  ]);
  writePrivateFile(extensions, LEAF_EXTENSIONS.replace("%SERVER_NAME%", serverName));
  await runOpenssl([
    "x509", "-req", "-in", csr, "-CA", caCert, "-CAkey", caKey, "-CAcreateserial",
    "-out", paths.certificate, "-days", CERTIFICATE_DAYS, "-extfile", extensions, "-extensions", "ext",
  ]);
  chmodSync(paths.certificate, PRIVATE_FILE_MODE);
  chmodSync(paths.privateKey, PRIVATE_FILE_MODE);
  return readFileSync(caCert, "utf8");
}

// Writes the runtime's files once the container exists: the bootstrap into the channel, and the descriptor and the auth bundle
// into the secret directory. Each is written at 0600 and refused when it already exists.
export function writeRuntimeFiles(paths: ChannelPaths, channel: RuntimeChannel): void {
  writePrivateFile(paths.bootstrap, `${serializeJson(channel.bootstrap)}\n`);
  writePrivateFile(paths.descriptor, `${serializeJson(channel.descriptor)}\n`);
  writePrivateFile(paths.auth, `${channel.auth}\n`);
}

// Refuses a socket path, on the host or in the container, that a unix socket address cannot hold: the control socket and the SSH
// socket. Nothing is written before this check, and the error names no path. A path is refused, never truncated.
export function assertSocketPathsFit(paths: readonly string[]): void {
  if (paths.some((path) => Buffer.byteLength(path, "utf8") > UNIX_SOCKET_PATH_MAX_BYTES)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// What the driver needs to dial the runtime's listener over TLS: the CA certificate it trusts, and the server name its leaf carries.
export interface ListenerTrust {
  readonly caPem: string;
  readonly serverName: string;
}

// Resolves once a TLS handshake with the runtime's listener completes on the control socket. A socket file, or a socket that accepts
// a connection, does not confirm the listener: the runtime binds the socket before it loads its certificate and key, and it removes
// the key once it has read it (boundary_server.rs). A completed handshake proves the runtime has loaded its TLS configuration, so the
// key has been read. A failed or stalled handshake keeps the wait going until the deadline, and then the start is refused.
export async function awaitRuntimeListener(
  controlSocket: string,
  trust: ListenerTrust,
  waitMs: number = SOCKET_WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (!(isSocket(controlSocket) && (await handshakeCompletes(controlSocket, trust, probeBudget(deadline))))) {
    if (Date.now() >= deadline) {
      throw makeRealmError("OPENSHELL_START_FAILED");
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, SOCKET_POLL_MS);
    });
  }
}

function isSocket(path: string): boolean {
  try {
    return lstatSync(path).isSocket();
  } catch {
    return false;
  }
}

// The time one handshake probe may take: the probe bound, and never past the deadline. It is at least one millisecond.
function probeBudget(deadline: number): number {
  return Math.max(1, Math.min(HANDSHAKE_PROBE_MS, deadline - Date.now()));
}

// Dials the control socket with a TLS client that trusts only the given CA, and resolves true once the handshake completes. An
// error, or a handshake still running after timeoutMs, resolves false. The probe connection is closed at once in every case.
function handshakeCompletes(path: string, trust: ListenerTrust, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = tlsConnect({ path, ca: trust.caPem, servername: trust.serverName });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

// Removes one private key file and confirms it is gone. A key that is already absent counts as removed. Any other failure, or a
// key still present afterwards, is CLEANUP_FAILED, and the error names no path.
export function removeKeyFile(path: string): void {
  try {
    unlinkSync(path);
  } catch (error: unknown) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw makeRealmError("CLEANUP_FAILED");
    }
  }
  if (entryPresent(path)) {
    throw makeRealmError("CLEANUP_FAILED");
  }
}

// Removes the TLS work directory and everything in it, then confirms it is gone. A failure is CLEANUP_FAILED, and its message
// names no path: the removal's own error can carry the path, so it is not passed on.
export function removeTlsWorkDirectory(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    throw makeRealmError("CLEANUP_FAILED");
  }
  if (entryPresent(dir)) {
    throw makeRealmError("CLEANUP_FAILED");
  }
}

// True when an entry exists at path. A lookup that fails for any reason other than absence is CLEANUP_FAILED.
function entryPresent(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw makeRealmError("CLEANUP_FAILED");
  }
}

// Runs openssl with an argument array and no shell. A failure is reported with the catalogue code only; the command line and
// its output stay out of the error.
function runOpenssl(args: readonly string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile("openssl", [...args], { timeout: OPENSSL_TIMEOUT_MS, windowsHide: true }, (error) => {
      if (error) {
        reject(makeRealmError("OPENSHELL_START_FAILED"));
      } else {
        resolve();
      }
    });
  });
}

// Creates a new file at 0600 and writes the text. O_EXCL refuses an existing name, and O_NOFOLLOW refuses a symbolic link.
function writePrivateFile(path: string, text: string): void {
  const body = Buffer.from(text, "utf8");
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      PRIVATE_FILE_MODE,
    );
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  try {
    fchmodSync(fd, PRIVATE_FILE_MODE);
    let written = 0;
    while (written < body.length) {
      written += writeSync(fd, body, written, body.length - written);
    }
    fsyncSync(fd);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  } finally {
    closeSync(fd);
  }
}
