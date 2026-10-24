// In-memory libpod stand-in on a Unix socket (D-48, D-54). A helper, not a test file: it
// is exercised by test/runtime/libpod-client.test.ts. Route strings and response field
// paths come from src/runtime/libpod-routes.ts, so the provisional table stays single.
//
// The fake records every request and every socket close, so a test can assert that a
// timed-out request destroyed its socket and was not merely abandoned. Per-route delays,
// one-shot hangs, and one-shot raw replies follow the FakeExecutionService style. The
// container store is exported so the OpenShell fake (plan 03-05) can add a container on
// a successful create.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import {
  LIBPOD_INFO_ROOTLESS_PATH,
  LIBPOD_INFO_VERSION_PATH,
  LIBPOD_LIST_ID_FIELD,
  matchLibpodRoute,
  LIBPOD_API_VERSION_HEADER,
  PING_PATH,
  type LibpodRouteName,
} from "../../src/runtime/libpod-routes.js";

export interface FakeContainer {
  readonly id: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly running: boolean;
}

interface MutableContainer {
  readonly id: string;
  readonly labels: Readonly<Record<string, string>>;
  running: boolean;
}

function snapshot(container: MutableContainer): FakeContainer {
  return { id: container.id, labels: { ...container.labels }, running: container.running };
}

export class FakeContainerStore {
  private readonly table = new Map<string, MutableContainer>();

  add(container: FakeContainer): void {
    if (this.table.has(container.id)) {
      throw new Error(`fake store already holds container ${container.id}`);
    }
    this.table.set(container.id, { id: container.id, labels: { ...container.labels }, running: container.running });
  }

  get(id: string): FakeContainer | undefined {
    const container = this.table.get(id);
    return container === undefined ? undefined : snapshot(container);
  }

  setRunning(id: string, running: boolean): void {
    const container = this.table.get(id);
    if (container === undefined) {
      throw new Error(`fake store holds no container ${id}`);
    }
    container.running = running;
  }

  remove(id: string): boolean {
    return this.table.delete(id);
  }

  list(): FakeContainer[] {
    return [...this.table.values()].map(snapshot);
  }
}

export interface FakeLibpodOptions {
  readonly store?: FakeContainerStore;
  readonly rootless?: boolean;
  readonly version?: string;
  // The API version the fake reports on /_ping. Podman 5.7.1 reports 5.7.1.
  readonly libpodApiVersion?: string;
  // Omits the Libpod-Api-Version header from /_ping, to model a server that reports no version.
  readonly omitApiVersionHeader?: boolean;
}

export interface RecordedRequest {
  readonly seq: number;
  readonly method: string;
  readonly target: string;
  readonly route: LibpodRouteName | null;
}

// A raw reply, used to script malformed bodies and unexpected statuses.
export interface RawReply {
  readonly status: number;
  readonly body?: string;
}

interface Reply {
  readonly status: number;
  readonly body?: string;
}

const NOT_FOUND: Reply = jsonReply(404, { cause: "no such container", message: "no such container", response: 404 });

function jsonReply(status: number, value?: unknown): Reply {
  return value === undefined ? { status } : { status, body: JSON.stringify(value) };
}

// Builds a nested object from a field path, for example ["host", "security", "rootless"].
function nest(path: readonly string[], value: unknown): Record<string, unknown> {
  return path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<string, unknown>;
}

// The label filter terms from the filters query, or null when the query is not valid.
function labelTerms(raw: string | null): string[] | null {
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const label = typeof parsed === "object" && parsed !== null && "label" in parsed ? parsed.label : undefined;
  if (label === undefined) {
    return [];
  }
  if (!Array.isArray(label) || !label.every((term) => typeof term === "string")) {
    return null;
  }
  return label;
}

function matchesLabel(labels: Readonly<Record<string, string>>, term: string): boolean {
  const separator = term.indexOf("=");
  if (separator < 0) {
    return Object.hasOwn(labels, term);
  }
  const key = term.slice(0, separator);
  return Object.hasOwn(labels, key) && labels[key] === term.slice(separator + 1);
}

function write(res: ServerResponse, reply: Reply): void {
  if (reply.body === undefined) {
    res.writeHead(reply.status).end();
    return;
  }
  res.writeHead(reply.status, { "Content-Type": "application/json" }).end(reply.body);
}

export class FakeLibpod {
  readonly store: FakeContainerStore;
  private readonly rootless: boolean;
  private readonly version: string;
  private readonly libpodApiVersion: string;
  private readonly omitApiVersionHeader: boolean;
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly log: RecordedRequest[] = [];
  private readonly socketClosed = new Map<number, Promise<void>>();
  private readonly delays = new Map<LibpodRouteName, number>();
  private readonly hangs = new Set<LibpodRouteName>();
  private readonly scripted = new Map<LibpodRouteName, RawReply>();
  private sequence = 0;

  constructor(options: FakeLibpodOptions = {}) {
    this.store = options.store ?? new FakeContainerStore();
    this.rootless = options.rootless ?? true;
    this.version = options.version ?? "0.0.0-fake";
    this.libpodApiVersion = options.libpodApiVersion ?? "5.7.1";
    this.omitApiVersionHeader = options.omitApiVersionHeader ?? false;
  }

  async start(socketPath: string): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res);
    });
    server.on("connection", (socket) => {
      this.sockets.add(socket);
      socket.once("close", () => {
        this.sockets.delete(socket);
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
  }

  // Destroys open sockets and cancels scheduled replies, so no timer outlives the fake.
  async stop(): Promise<void> {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const socket of this.sockets) {
      socket.destroy();
    }
    const server = this.server;
    this.server = undefined;
    if (server !== undefined && server.listening) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    }
  }

  requests(): readonly RecordedRequest[] {
    return this.log.map((request) => ({ ...request }));
  }

  // Resolves once the socket that carried request seq has closed. Rejects when it stays
  // open for timeoutMs, so a test fails instead of hanging.
  async waitForSocketClose(seq: number, timeoutMs: number): Promise<void> {
    const closed = this.socketClosed.get(seq);
    if (closed === undefined) {
      throw new Error(`fake libpod holds no request with seq ${String(seq)}`);
    }
    let timer: NodeJS.Timeout | undefined;
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`socket for request ${String(seq)} stayed open for ${String(timeoutMs)} ms`));
      }, timeoutMs);
    });
    try {
      await Promise.race([closed, expiry]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Every reply of the route is delayed by ms until the delay is set again. Zero clears it.
  setDelay(route: LibpodRouteName, ms: number): void {
    if (ms === 0) {
      this.delays.delete(route);
    } else {
      this.delays.set(route, ms);
    }
  }

  // The next call of the route gets no reply at all, so the client must time out.
  hangNext(route: LibpodRouteName): void {
    this.hangs.add(route);
  }

  // The next call of the route gets this raw reply instead of the modelled one.
  respondNext(route: LibpodRouteName, reply: RawReply): void {
    this.scripted.set(route, reply);
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    this.sequence += 1;
    const seq = this.sequence;
    const url = new URL(req.url ?? "/", "http://localhost");
    const matched = matchLibpodRoute(req.method ?? "", url.pathname);
    this.log.push({ seq, method: req.method ?? "", target: req.url ?? "", route: matched?.name ?? null });
    const socket = req.socket;
    this.socketClosed.set(
      seq,
      new Promise<void>((resolve) => {
        socket.once("close", () => {
          resolve();
        });
      }),
    );
    if (url.pathname === PING_PATH) {
      res.writeHead(200, this.omitApiVersionHeader ? {} : { [LIBPOD_API_VERSION_HEADER]: this.libpodApiVersion });
      res.end();
      return;
    }
    if (matched === undefined) {
      write(res, jsonReply(404, { message: "page not found" }));
      return;
    }
    const route = matched.name;
    if (this.hangs.delete(route)) {
      return;
    }
    const raw = this.scripted.get(route);
    if (raw !== undefined) {
      this.scripted.delete(route);
      this.later(route, res, raw);
      return;
    }
    this.later(route, res, this.dispatch(route, matched.containerId ?? undefined, url.searchParams));
  }

  private later(route: LibpodRouteName, res: ServerResponse, reply: Reply): void {
    const delay = this.delays.get(route) ?? 0;
    if (delay === 0) {
      write(res, reply);
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!res.destroyed) {
        write(res, reply);
      }
    }, delay);
    this.timers.add(timer);
  }

  private dispatch(route: LibpodRouteName, id: string | undefined, params: URLSearchParams): Reply {
    switch (route) {
      case "info":
        return jsonReply(200, {
          ...nest(LIBPOD_INFO_ROOTLESS_PATH, this.rootless),
          ...nest(LIBPOD_INFO_VERSION_PATH, this.version),
        });
      case "listContainers":
        return this.listRoute(params);
      case "inspectContainer":
        return this.inspectRoute(id);
      case "stopContainer":
        return this.stopRoute(id);
      case "removeContainer":
        return this.removeRoute(id, params);
    }
  }

  private listRoute(params: URLSearchParams): Reply {
    const terms = labelTerms(params.get("filters"));
    if (terms === null) {
      return jsonReply(400, { message: "invalid filters" });
    }
    const all = params.get("all") === "true";
    const visible = this.store
      .list()
      .filter((container) => (all || container.running) && terms.every((term) => matchesLabel(container.labels, term)));
    return jsonReply(
      200,
      visible.map((container) => ({
        [LIBPOD_LIST_ID_FIELD]: container.id,
        Names: [`/${container.id}`],
        Labels: container.labels,
        State: container.running ? "running" : "exited",
      })),
    );
  }

  private inspectRoute(id: string | undefined): Reply {
    const container = id === undefined ? undefined : this.store.get(id);
    if (container === undefined) {
      return NOT_FOUND;
    }
    return jsonReply(200, {
      Id: container.id,
      Name: `/${container.id}`,
      State: { Status: container.running ? "running" : "exited", Running: container.running },
      Config: { Labels: container.labels },
    });
  }

  // Stopping a container that is already stopped answers 304, as libpod does.
  private stopRoute(id: string | undefined): Reply {
    const container = id === undefined ? undefined : this.store.get(id);
    if (container === undefined) {
      return NOT_FOUND;
    }
    if (!container.running) {
      return { status: 304 };
    }
    this.store.setRunning(container.id, false);
    return { status: 204 };
  }

  // A running container is removed only when force is set, otherwise 409 as libpod does.
  private removeRoute(id: string | undefined, params: URLSearchParams): Reply {
    const container = id === undefined ? undefined : this.store.get(id);
    if (container === undefined) {
      return NOT_FOUND;
    }
    if (container.running && params.get("force") !== "true") {
      return jsonReply(409, { message: "container is running" });
    }
    this.store.remove(container.id);
    return { status: 204 };
  }
}
