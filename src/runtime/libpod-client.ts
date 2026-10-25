// Closed libpod client over a Unix socket (D-54, RT-03, RT-09). The public surface is the
// five methods below and nothing else: no method takes a path, a route name, or a request
// body from the caller. The route table is libpod-routes.ts (provisional, D-48).
//
// Every request owns its socket. A timer races each request, and when it fires the
// request's socket is destroyed. withTimeout only rejects and cannot cancel, so it is not
// used here (F-P3-05). A transport failure or a timeout gives PODMAN_MACHINE_DOWN, the
// code D-53 gives a socket timeout. A malformed body or an unexpected status gives
// SCHEMA_INVALID, and the response body is never echoed into an error.
//
// The client reads no environment and takes its socket path as an argument. The socket
// grants full engine access as the user (podman.md Q4), so it is never mounted into a
// session container.

import { request as httpRequest } from "node:http";
import { isAbsolute } from "node:path";
import { makeRealmError } from "../core/errors.js";
import {
  API_VERSION_PATTERN,
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
    expectStatus(reply, [204]);
  }
}

async function exchangeRoute(transport: Transport, route: LibpodRoute, call: RouteCall): Promise<HttpReply> {
  checkRouteId(route, call.containerId);
  const apiVersion = await apiVersionOf(transport);
  const target = routeTarget(route, call.containerId, apiVersion, call.query);
  return exchange(transport.socketPath, route.method, target, transport.timeoutMs + (call.graceMs ?? 0));
}

function exchange(socketPath: string, method: string, target: string, timeoutMs: number): Promise<HttpReply> {
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
      { socketPath, method, path: target, agent: false, headers: { "Content-Length": "0" } },
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
    req.end();
  });
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
