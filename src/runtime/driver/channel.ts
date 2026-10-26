// The files and the start of the built-in runtime channel (phase 9.5, wave 2). A sandbox's channel directory holds the runtime's
// bootstrap, its server certificate and key, and the control socket the runtime creates. It is bound read-write into the
// container. The descriptor and the supervisor auth bundle sit beside it in the sandbox's secret directory, outside the container.
// Every file is created at 0600 with O_EXCL and O_NOFOLLOW, so a file that exists or a symbolic link is refused, never followed.
//
// The TLS material is an ECDSA P-256 CA and one server leaf for the runtime, made by the openssl CLI through execFile with an
// argument array and no shell. The CA key lives in a work directory that is removed after the leaf is signed. No key, key path
// or openssl output reaches an error or a log: a failed command is reported with its catalogue code only.

import { execFile } from "node:child_process";
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
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { makeRealmError } from "../../core/errors.js";
import type { LibpodClient } from "../libpod-client.js";
import {
  AUTH_FILE_NAME,
  BOOTSTRAP_FILE_NAME,
  CHANNEL_DIR_NAME,
  DESCRIPTOR_FILE_NAME,
  MAIN_EXIT_MARKER_NAME,
  TLS_WORK_DIR_NAME,
} from "./secret-store.js";
import { RUNTIME_ARGV, serializeJson, type RuntimeChannel } from "./runtime-channel.js";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
// The validity of the CA and the runtime's leaf. A sandbox lives for the life of its runtime, which is bounded by its delete.
const CERTIFICATE_DAYS = "3650";
const OPENSSL_TIMEOUT_MS = 30_000;
const SOCKET_WAIT_MS = 15_000;
const SOCKET_POLL_MS = 100;
const CA_COMMON_NAME = "realm-sandbox-runtime-ca";
const LEAF_COMMON_NAME = "realm-sandbox-runtime";
const LEAF_EXTENSIONS = "[ext]\nsubjectAltName = DNS:%SERVER_NAME%\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = serverAuth\n";

// The host paths of one sandbox's channel. Every path sits under the sandbox's secret directory.
export interface ChannelPaths {
  readonly secretDir: string;
  readonly channelDir: string;
  readonly tlsDir: string;
  readonly bootstrap: string;
  readonly certificate: string;
  readonly privateKey: string;
  readonly controlSocket: string;
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
// returned to the caller as the descriptor's trust anchor. The CA key is removed with the work directory before this returns.
export async function generateRuntimeTls(paths: ChannelPaths, serverName: string): Promise<string> {
  try {
    mkdirSync(paths.tlsDir, { mode: PRIVATE_DIR_MODE });
    chmodSync(paths.tlsDir, PRIVATE_DIR_MODE);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  try {
    const caKey = join(paths.tlsDir, "ca.key");
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
  } catch {
    throw makeRealmError("OPENSHELL_START_FAILED");
  } finally {
    rmSync(paths.tlsDir, { recursive: true, force: true });
  }
}

// Writes the runtime's files once the container exists: the bootstrap into the channel, and the descriptor and the auth bundle
// into the secret directory. Each is written at 0600 and refused when it already exists.
export function writeRuntimeFiles(paths: ChannelPaths, channel: RuntimeChannel): void {
  writePrivateFile(paths.bootstrap, `${serializeJson(channel.bootstrap)}\n`);
  writePrivateFile(paths.descriptor, `${serializeJson(channel.descriptor)}\n`);
  writePrivateFile(paths.auth, `${channel.auth}\n`);
}

// Starts the runtime inside the container, detached, and waits until its control socket exists. A runtime that does not
// create the socket in time is refused; the caller removes the container.
export async function startRuntimeProcess(
  libpod: Pick<LibpodClient, "execDetached">,
  containerId: string,
  controlSocket: string,
): Promise<void> {
  await libpod.execDetached(containerId, RUNTIME_ARGV);
  await waitForSocket(controlSocket);
}

async function waitForSocket(path: string): Promise<void> {
  const deadline = Date.now() + SOCKET_WAIT_MS;
  while (!isSocket(path)) {
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
