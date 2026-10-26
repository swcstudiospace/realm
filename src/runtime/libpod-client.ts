// Closed libpod client over a Unix socket (D-54, RT-03, RT-09). The public surface is the methods below and
// nothing else. No method takes a path, a route name, or a raw request body from the caller: create takes a
// typed ContainerSpec, and its body is built here. The route table is libpod-routes.ts (provisional, D-48).
//
// Every request owns its socket. A timer races each request, and when it fires the
// request's socket is destroyed. withTimeout only rejects and cannot cancel, so it is not
// used here (F-P3-05). A transport failure or a timeout gives PODMAN_MACHINE_DOWN, the
// code D-53 gives a socket timeout. A malformed body or an unexpected status gives
// SCHEMA_INVALID, and the response body is never echoed into an error.
//
// The client reads no environment and takes its socket path as an argument. The socket
// grants full engine access as the user (podman.md Q4), so it is never mounted into a
// session container. The client starts no process: the sandbox runtime is the container's main process, named in the create body.

import { request as httpRequest } from "node:http";
import { isAbsolute } from "node:path";
import { makeRealmError } from "../core/errors.js";
import { CHANNEL_MOUNT_OPTIONS, HARDENING_PROFILE, RUNTIME_ARGV, SUPERVISOR_CA_TMPFS_OPTIONS } from "./hardening.js";
import {
  isRealmSandboxName,
  OPENSHELL_ISOLATION_ROLE_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_KEY,
  OPENSHELL_MANAGED_LABEL_VALUE,
  OPENSHELL_SANDBOX_NAME_LABEL_KEY,
  OPENSHELL_SANDBOX_ROLE_VALUE,
} from "./openshell.js";
import {
  API_VERSION_PATTERN,
  CONTAINER_ID_PATTERN,
  checkRouteId,
  LIBPOD_API_VERSION_HEADER,
  LIBPOD_INFO_ROOTLESS_PATH,
  LIBPOD_INFO_VERSION_PATH,
  LIBPOD_LIST_ID_FIELD,
  LIBPOD_ROUTES,
  PING_PATH,
  routeTarget,
  type LibpodRoute,
} from "./libpod-routes.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const LABEL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
// The user-namespace mapping of every sandbox: the realm account is mapped to the workload uid and gid (keep-id).
const WORKLOAD_USER = `${String(HARDENING_PROFILE.workloadUid)}:${String(HARDENING_PROFILE.workloadGid)}`;
const WORKLOAD_USERNS = `uid=${String(HARDENING_PROFILE.workloadUid)},gid=${String(HARDENING_PROFILE.workloadGid)}`;

export interface LibpodClientOptions {
  // Bound for one request, in addition to any grace period the request itself asks for.
  readonly requestTimeoutMs?: number;
}

export interface LibpodInfo {
  readonly rootless: boolean;
  readonly version: string;
}

export interface LibpodContainerSummary {
  readonly id: string;
  // The container's labels as libpod reports them. Absent from a listing that carried none.
  readonly labels?: Readonly<Record<string, string>>;
}

// The raw inspect object. The hardening verifier (D-51) checks its fields and fails
// closed on any that are missing.
export type LibpodInspect = Readonly<Record<string, unknown>>;

// The typed spec a create takes. The create body is built from it and HARDENING_PROFILE, so a caller cannot add
// or change a field. The sandbox name is the container name and the sandbox-name label.
export interface ContainerSpec {
  // Container name and sandbox-name label: a container-name-safe string.
  readonly sandboxName: string;
  // A digest-pinned image reference: name, optional tag, then @sha256:<64 hex>.
  readonly image: string;
  // Absolute host path, bound read-write at the workspace destination.
  readonly workspaceDir: string;
  // Absolute host path, bound read-only at the state destination.
  readonly stateDir: string;
  // Absolute host path, bound read-write at the channel destination. It holds the runtime's bootstrap, TLS files and socket.
  readonly channelDir: string;
}

interface Transport {
  readonly socketPath: string;
  readonly timeoutMs: number;
}

interface HttpReply {
  readonly status: number;
  readonly text: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

interface RouteCall {
  readonly containerId?: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly graceMs?: number;
  // A JSON request body, built by this module from a typed spec. Absent for bodyless routes.
  readonly body?: string;
}

export class LibpodClient {
  private readonly transport: Transport;

  constructor(socketPath: string, options: LibpodClientOptions = {}) {
    if (!isAbsolute(socketPath)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    this.transport = Object.freeze({ socketPath, timeoutMs });
  }

  async info(): Promise<LibpodInfo> {
    const reply = await exchangeRoute(this.transport, LIBPOD_ROUTES.info, {});
    expectStatus(reply, [200]);
    const body = parseJson(reply.text);
    const rootless = readPath(body, LIBPOD_INFO_ROOTLESS_PATH);
    const version = readPath(body, LIBPOD_INFO_VERSION_PATH);
    if (typeof rootless !== "boolean" || typeof version !== "string") {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return { rootless, version };
  }

  // Containers, stopped ones included, whose label key has exactly the given value.
  async listContainersByLabel(key: string, value: string): Promise<LibpodContainerSummary[]> {
    if (!LABEL_KEY_PATTERN.test(key)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const filters = JSON.stringify({ label: [`${key}=${value}`] });
    const reply = await exchangeRoute(this.transport, LIBPOD_ROUTES.listContainers, {
      query: { all: "true", filters },
    });
    expectStatus(reply, [200]);
    const body = parseJson(reply.text);
    if (!Array.isArray(body)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return body.map((entry: unknown): LibpodContainerSummary => {
      const id = readPath(entry, [LIBPOD_LIST_ID_FIELD]);
      if (typeof id !== "string" || id === "") {
        throw makeRealmError("SCHEMA_INVALID");
      }
      const raw = readPath(entry, ["Labels"]);
      const labels: Record<string, string> = {};
      if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
          if (typeof value === "string") {
            labels[key] = value;
          }
        }
      }
      return { id, labels };
    });
  }

  // The raw inspect object, or null when the container does not exist.
  async inspectContainer(id: string): Promise<LibpodInspect | null> {
    const reply = await exchangeRoute(this.transport, LIBPOD_ROUTES.inspectContainer, { containerId: id });
    if (isNoSuchContainer(reply)) {
      return null;
    }
    expectStatus(reply, [200]);
    const body = parseJson(reply.text);
    if (!isRecord(body)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return body;
  }

  // Asks the container to stop and gives it timeoutMs to do so. Success is a stop or an
  // already-stopped container. Any other status is an error, so a wrong route cannot
  // report a stop that did not happen.
  async stopContainer(id: string, timeoutMs: number): Promise<void> {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    const graceSeconds = Math.ceil(timeoutMs / 1000);
    const reply = await exchangeRoute(this.transport, LIBPOD_ROUTES.stopContainer, {
      containerId: id,
      query: { timeout: String(graceSeconds) },
      graceMs: timeoutMs,
    });
    expectStatus(reply, [204, 304]);
  }

  // Removes the container. A container that is already gone counts as removed, so a
  // repeated sweep is a no-op. The down sweep verifies zero orphans afterwards (D-68).
  async removeContainer(id: string, options: { readonly force: boolean }): Promise<void> {
    const reply = await exchangeRoute(this.transport, LIBPOD_ROUTES.removeContainer, {
      containerId: id,
      query: { force: String(options.force) },
    });
    if (isNoSuchContainer(reply)) {
      return;
    }
    // Podman 5.7.1 answers 200 with the removed id in a list. 204 is also accepted. The reply body is not read.
    expectStatus(reply, [200, 204]);
  }

  // Creates the container from the typed spec and returns its id. Podman answers 201 with the id. The body is
  // built here from the spec and the hardening profile; a caller cannot add a field.
  async createContainer(spec: ContainerSpec): Promise<string> {
    validateContainerSpec(spec);
    const body = JSON.stringify(containerCreateBody(spec));
    const reply = await exchangeRoute(this.transport, LIBPOD_ROUTES.createContainer, { body });
    if (reply.status === 409) {
      throw makeRealmError("SANDBOX_NAME_IN_USE");
    }
    expectStatus(reply, [201]);
    const id = readPath(parseJson(reply.text), [LIBPOD_LIST_ID_FIELD]);
    if (typeof id !== "string" || !CONTAINER_ID_PATTERN.test(id)) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    return id;
  }

  // Starts a created container. Podman answers 304 when it is already running; that counts as started, as
  // stopContainer counts an already-stopped container. The lifecycle reads the state afterwards.
  async startContainer(id: string): Promise<void> {
    const reply = await exchangeRoute(this.transport, LIBPOD_ROUTES.startContainer, { containerId: id });
    expectStatus(reply, [204, 304]);
  }
}

async function exchangeRoute(transport: Transport, route: LibpodRoute, call: RouteCall): Promise<HttpReply> {
  checkRouteId(route, call.containerId);
  const apiVersion = await apiVersionOf(transport);
  const target = routeTarget(route, call.containerId, apiVersion, call.query);
  return exchange(transport.socketPath, route.method, target, transport.timeoutMs + (call.graceMs ?? 0), call.body);
}

function exchange(socketPath: string, method: string, target: string, timeoutMs: number, body = ""): Promise<HttpReply> {
  return new Promise<HttpReply>((resolve, reject) => {
    let settled = false;
    const settle = (outcome: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      outcome();
    };
    const fail = (): void => {
      settle(() => {
        reject(makeRealmError("PODMAN_MACHINE_DOWN"));
      });
    };
    // agent: false gives each request its own socket, closed when the reply ends.
    const req = httpRequest(
      { socketPath, method, path: target, agent: false, headers: requestHeaders(body) },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            settle(() => {
              reject(makeRealmError("SCHEMA_INVALID"));
            });
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          settle(() => {
            resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8"), headers: res.headers });
          });
        });
        res.on("error", fail);
      },
    );
    req.on("error", fail);
    const timer = setTimeout(() => {
      fail();
      req.destroy();
    }, timeoutMs);
    req.end(body);
  });
}

// A bodyless request keeps the zero Content-Length it always sent. A request with a body is JSON.
function requestHeaders(body: string): Readonly<Record<string, string>> {
  if (body === "") {
    return { "Content-Length": "0" };
  }
  return { "Content-Length": String(Buffer.byteLength(body)), "Content-Type": "application/json" };
}

function expectStatus(reply: HttpReply, allowed: readonly number[]): void {
  if (!allowed.includes(reply.status)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// Podman answers a missing container with a 404 whose JSON cause is "no such container". Any other 404 is
// a wrong route or an unexpected reply, so it is never read as absence. A non-JSON 404 fails in parseJson.
function isNoSuchContainer(reply: HttpReply): boolean {
  if (reply.status !== 404) {
    return false;
  }
  const body = parseJson(reply.text);
  return isRecord(body) && body["cause"] === "no such container";
}

// The API version each transport reported on /_ping. A failed probe is dropped, so the next call asks again.
const apiVersions = new WeakMap<Transport, Promise<string>>();

function apiVersionOf(transport: Transport): Promise<string> {
  const known = apiVersions.get(transport);
  if (known !== undefined) {
    return known;
  }
  const pending = pingApiVersion(transport).catch((error: unknown) => {
    apiVersions.delete(transport);
    throw error;
  });
  apiVersions.set(transport, pending);
  return pending;
}

async function pingApiVersion(transport: Transport): Promise<string> {
  const reply = await exchange(transport.socketPath, "GET", PING_PATH, transport.timeoutMs);
  expectStatus(reply, [200]);
  const version = reply.headers[LIBPOD_API_VERSION_HEADER];
  if (typeof version !== "string" || !API_VERSION_PATTERN.test(version)) {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return version;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

// The digest-pinned image reference the create body accepts: name, optional tag, then @sha256:<64 hex>.
const DIGEST_PINNED_IMAGE = /^[a-z0-9]+(?:[._/-][a-z0-9]+)*(?::[A-Za-z0-9_.-]+)?@sha256:[a-f0-9]{64}$/;
// The options of every tmpfs scratch mount, from the hardening profile's tmpfs paths.
const TMPFS_OPTIONS: readonly string[] = Object.freeze(["nosuid", "nodev"]);
// The CFS period in microseconds. NanoCpus is quota / period, so quota = nanoCpus * period / 1e9.
const CPU_PERIOD_MICROS = 100000;
const WORKSPACE_OPTIONS: readonly string[] = Object.freeze(["noexec", "nosuid", "nodev"]);
const STATE_OPTIONS: readonly string[] = Object.freeze(["ro", "noexec", "nosuid", "nodev"]);

// Validates a spec before any engine request. It is pure: it reads no environment and sends nothing. It fails closed
// on a spec the body must not carry: a sandbox name without the realm prefix or outside the container-id pattern, an
// image outside the digest-pinned form, a host path that is relative or holds a NUL byte, or a host path that names a
// container-engine socket.
export function validateContainerSpec(spec: ContainerSpec): void {
  const socketNames = HARDENING_PROFILE.socketNames;
  const hostPaths = [spec.workspaceDir, spec.stateDir, spec.channelDir];
  const valid =
    isRealmSandboxName(spec.sandboxName) &&
    CONTAINER_ID_PATTERN.test(spec.sandboxName) &&
    DIGEST_PINNED_IMAGE.test(spec.image) &&
    hostPaths.every(
      (path) =>
        isAbsolute(path) && !path.includes("\0") && !path.split("/").some((segment) => socketNames.includes(segment)),
    );
  if (!valid) {
    throw makeRealmError("SCHEMA_INVALID");
  }
}

// The create body. Every field comes from the spec or from HARDENING_PROFILE, so the verifier and the
// create request read the same values. Nothing else is added.
function containerCreateBody(spec: ContainerSpec): Readonly<Record<string, unknown>> {
  const profile = HARDENING_PROFILE;
  // The sandbox container carries the profile's scratch paths and the runtime's CA directory.
  const scratch = [...profile.tmpfs, profile.supervisorCaDestination];
  return {
    name: spec.sandboxName,
    image: spec.image,
    entrypoint: [...RUNTIME_ARGV],
    user: WORKLOAD_USER,
    userns: { nsmode: "keep-id", value: WORKLOAD_USERNS },
    labels: {
      [OPENSHELL_MANAGED_LABEL_KEY]: OPENSHELL_MANAGED_LABEL_VALUE,
      [OPENSHELL_SANDBOX_NAME_LABEL_KEY]: spec.sandboxName,
      [OPENSHELL_ISOLATION_ROLE_LABEL_KEY]: OPENSHELL_SANDBOX_ROLE_VALUE,
    },
    privileged: profile.privileged,
    cap_drop: ["ALL"],
    cap_add: [...profile.capAdd],
    no_new_privileges: profile.securityOpt.includes("no-new-privileges"),
    read_only_filesystem: profile.readonlyRootfs,
    resource_limits: {
      pids: { limit: profile.pidsLimit },
      memory: { limit: profile.memoryBytes },
      cpu: { quota: (profile.nanoCpus * CPU_PERIOD_MICROS) / 1_000_000_000, period: CPU_PERIOD_MICROS },
    },
    netns: { nsmode: profile.networkMode },
    tty: false,
    mounts: [
      ...scratch.map((destination) => ({
        type: "tmpfs",
        destination,
        options: [...(destination === profile.supervisorCaDestination ? SUPERVISOR_CA_TMPFS_OPTIONS : TMPFS_OPTIONS)],
      })),
      { type: "bind", source: spec.workspaceDir, destination: profile.workspaceDestination, options: WORKSPACE_OPTIONS },
      { type: "bind", source: spec.stateDir, destination: profile.stateDestination, options: STATE_OPTIONS },
      { type: "bind", source: spec.channelDir, destination: profile.channelDestination, options: ["rw", ...CHANNEL_MOUNT_OPTIONS] },
    ],
  };
}
