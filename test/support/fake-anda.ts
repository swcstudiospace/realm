// Scripted HTTP stand-in for Anda Engine on 127.0.0.1 (ANDA-02, ANDA-03). A helper, not a
// test file: test/anda/handshake.test.ts and test/anda/reconnect.test.ts exercise it. It
// serves one route, and every request is recorded with its method, path, and headers, so a
// test can assert that no credential header was sent. The server also records whether the
// client abandoned a request before the response finished, which is how a test checks that
// a timed-out or closed attempt aborted its socket (F-P3-05).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type ScriptedReply =
  | { readonly kind: "json"; readonly status?: number; readonly body: unknown }
  | { readonly kind: "text"; readonly status?: number; readonly body: string }
  | { readonly kind: "hang" }
  | { readonly kind: "reset" };

export interface RecordedRequest {
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly aborted: boolean;
}

interface MutableRequest {
  method: string | undefined;
  path: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  aborted: boolean;
}

// A well-formed AppInformation body (anda.md Q1, server README). Field names match shape.ts.
export const HEALTHY_INFORMATION = Object.freeze({
  engines: [],
  default_engine: null,
  start_time_ms: 1_700_000_000_000,
});

export class FakeAnda {
  private readonly log: MutableRequest[] = [];
  private reply: ScriptedReply = { kind: "json", body: HEALTHY_INFORMATION };
  private server: Server | undefined;
  private port: number | undefined;
  private readonly waiters = new Set<() => void>();

  // Listens on an ephemeral loopback port. A stopped fake keeps its port, so tests can aim
  // a bridge at a port that refuses connections.
  async start(): Promise<void> {
    if (this.server !== undefined) {
      throw new Error("fake Anda is already running");
    }
    const server = createServer((req, res) => {
      this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    this.port = address.port;
    this.server = server;
  }

  // Drops open connections, then closes the listener. Idempotent.
  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return;
    }
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }

  url(): string {
    if (this.port === undefined) {
      throw new Error("fake Anda has not been started");
    }
    return `http://127.0.0.1:${this.port}`;
  }

  // The reply for every request after this call, until the next call.
  respond(reply: ScriptedReply): void {
    this.reply = reply;
  }

  requests(): readonly RecordedRequest[] {
    return this.log.map((entry) => ({ ...entry, headers: { ...entry.headers } }));
  }

  requestCount(): number {
    return this.log.length;
  }

  // Resolves once predicate holds. It is re-checked on every request arrival and every
  // response close on the server, so a test awaits the event instead of a fixed delay.
  waitUntil(predicate: () => boolean): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = (): void => {
        if (predicate()) {
          this.waiters.delete(check);
          resolve();
        }
      };
      this.waiters.add(check);
      check();
    });
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const entry: MutableRequest = {
      method: req.method,
      path: req.url,
      headers: { ...req.headers },
      aborted: false,
    };
    this.log.push(entry);
    this.notify();
    res.on("close", () => {
      if (!res.writableFinished) {
        entry.aborted = true;
      }
      this.notify();
    });
    const reply = this.reply;
    switch (reply.kind) {
      case "json":
        res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body));
        return;
      case "text":
        res.writeHead(reply.status ?? 200, { "content-type": "text/plain" });
        res.end(reply.body);
        return;
      case "hang":
        return;
      case "reset":
        req.socket.destroy();
        return;
    }
  }

  private notify(): void {
    for (const check of [...this.waiters]) {
      check();
    }
  }
}
