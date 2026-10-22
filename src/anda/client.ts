// AndaBridge: the HTTP client for Anda Engine that implements BridgePort (ANDA-02, ANDA-03,
// D-61, D-62, D-65). Phase 3 calls one anonymous route, GET /.well-known/information, and
// no other. The request carries no credential, because the RPC route and its credential
// format are undocumented (OQ-P3-10). The version check is the shape check in ./shape.ts,
// because Anda publishes no version surface (OQ-P3-09).
//
// Lifecycle. connect(deadlineMs) retries one handshake with the backoff schedule until the
// deadline, and a shape mismatch rejects at once. On success a background loop probes the
// engine. A failed probe publishes down once per outage and keeps retrying. A probe that
// succeeds again publishes up. A mismatch while monitoring publishes mismatch and stops the
// loop. The bridge never changes the session state: the controller decides on each event
// (D-62, D-65).
// A failed connect leaves the bridge re-callable, so the controller can retry it. A mismatch
// is sticky: a later connect rejects with ANDA_VERSION_MISMATCH and sends nothing. An oversize
// reply (over 64 KiB) is unreachable, not a mismatch, so it is retried and never sticky.
// close() ends the current connection, and a later connect() starts a fresh handshake with its
// own deadline and state. A sticky mismatch still rejects.
//
// Listeners. publish() calls each listener in its own try/catch, so one listener that throws does not
// stop the others. A listener has not received an event when it throws or when the promise it returns
// rejects. That event stays undelivered, and the monitor delivers it again on each tick until one
// delivery succeeds (at-least-once for transitions). A newer event replaces an undelivered one. A
// listener failure never stops the monitor, and snapshot() reports the latest published event even
// while it is undelivered. A mismatch is final: the monitor stops probing and keeps delivering only an
// undelivered mismatch. The monitor promise never rejects, so close() always resolves and no rejection
// escapes as unhandled. A failure of the monitor loop itself is recorded in snapshot() as down with
// ANDA_UNREACHABLE and is not re-published, because the listener may be the cause.
//
// Timers and requests. Each request owns its socket (agent: false) and a per-attempt timer. The timer
// is clamped to the connect budget that remains, and no request is sent once that budget is spent, so
// a connect rejects at its deadline (F1). On expiry, or on close(), the request is destroyed, because
// withTimeout only rejects and cannot cancel work (F-P3-05). A transport that throws synchronously is an
// unreachable attempt (F4). Each connect() owns a lifecycle AbortController. close() aborts it, which
// clears every sleeping timer and every attempt timer synchronously, then waits for an in-flight
// handshake and the monitor loop to exit. No timer survives close.
//
// Errors carry catalogue codes only. A response body is never echoed into an error.

import { type ClientRequest, type IncomingMessage, request as httpRequest, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { computeBackoffDelayMs, type RandomSource } from "../core/backoff.js";
import { type ErrorCode, makeRealmError } from "../core/errors.js";
import type { BridgeEvent, BridgeKind, BridgePort } from "../core/ports.js";
import { errnoOf } from "../fs/canonicalize.js";
import { checkAppInformationShape } from "./shape.js";

export const ANDA_INFORMATION_PATH = "/.well-known/information";

const DEFAULT_REQUEST_TIMEOUT_MS = 2000;
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_BACKOFF_CAP_MS = 30000;
const MAX_INFORMATION_BYTES = 64 * 1024;
// The reason kept when a synchronous transport throw carries no errno code (F4).
const NO_CODE_TRANSPORT_REASON = "transport threw without an errno code";

// Resolves after ms, or as soon as the signal aborts. It never rejects, so a caller checks
// the signal after each wait.
export type SleepFn = (ms: number, signal: AbortSignal) => Promise<void>;

export interface BackoffOptions {
  readonly baseMs: number;
  readonly capMs: number;
}

export interface AndaBridgeOptions {
  readonly url: string;
  // Defaults: Math.random, Date.now, sleepUnlessAborted, 2000 ms per attempt, the Anda schedule
  // (base 500 ms, cap 30000 ms, D-62), and node:http or node:https by URL scheme. Tests inject these.
  readonly random?: RandomSource;
  readonly now?: () => number;
  readonly sleep?: SleepFn;
  readonly requestTimeoutMs?: number;
  readonly backoff?: BackoffOptions;
  readonly transport?: Transport;
}

type AttemptOutcome = "ok" | "unreachable" | "mismatch";
type Listener = (event: BridgeEvent) => void;
// The request function behind one attempt. node:http and node:https both fit it.
type Transport = (options: RequestOptions, onResponse: (res: IncomingMessage) => void) => ClientRequest;

// A transition no listener has received yet. Its at is null while the clock has not stamped it (site 448).
// A stamped event is a BridgeEvent, which fits this shape.
interface Transition {
  readonly kind: BridgeKind;
  readonly code?: ErrorCode;
  readonly at: string | null;
}

export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Accepts http: and https: with no userinfo (the config rule, D-52). Anything else is
// SCHEMA_INVALID.
function parseEngineUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw makeRealmError("SCHEMA_INVALID");
  }
  const schemeOk = url.protocol === "http:" || url.protocol === "https:";
  if (!schemeOk || url.username !== "" || url.password !== "") {
    throw makeRealmError("SCHEMA_INVALID");
  }
  return url;
}

// URL.hostname keeps the brackets of an IPv6 literal; node:http expects them removed.
function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, "$1");
}

// A 200 body that is not JSON, or whose shape fails the check, is a mismatch.
function classifyBody(text: string): AttemptOutcome {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return "mismatch";
  }
  return checkAppInformationShape(body).ok ? "ok" : "mismatch";
}

// A listener may return a promise, as an async function does. Its rejection is a failed delivery (F2).
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value && typeof value.then === "function"
  );
}

export class AndaBridge implements BridgePort {
  private readonly requestOptions: RequestOptions;
  private readonly transport: Transport;
  private readonly random: RandomSource;
  private readonly now: () => number;
  private readonly sleep: SleepFn;
  private readonly requestTimeoutMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffCapMs: number;
  // The signal of the current connection. connect() replaces it, and close() aborts it.
  private lifecycle = new AbortController();
  private readonly listeners = new Set<Listener>();
  private last: BridgeEvent | null = null;
  // The latest transition that some listener has not received. The monitor delivers it again on its next
  // tick until one delivery succeeds (F3). A newer transition replaces it. A transition the clock could not
  // stamp keeps a null at until the clock works (site 448).
  private undelivered: Transition | null = null;
  // Counts every transition published. A listener failure is recorded only while no newer transition exists.
  private transitions = 0;
  // The errno code of the latest synchronous transport throw, or the fixed reason when it has none (F4).
  private transportFailure: string | null = null;
  private phase: "idle" | "connecting" | "connected" = "idle";
  private mismatched = false;
  // The current handshake and monitor loop. Neither promise ever rejects, so close() can await both.
  private pending: Promise<void> = Promise.resolve();
  private monitor: Promise<void> = Promise.resolve();

  constructor(options: AndaBridgeOptions) {
    const url = parseEngineUrl(options.url);
    this.transport = options.transport ?? (url.protocol === "https:" ? httpsRequest : httpRequest);
    this.requestOptions = {
      hostname: stripBrackets(url.hostname),
      port: url.port,
      path: ANDA_INFORMATION_PATH,
      method: "GET",
      headers: { accept: "application/json" },
      agent: false,
    };
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? sleepUnlessAborted;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.backoffBaseMs = options.backoff?.baseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffCapMs = options.backoff?.capMs ?? DEFAULT_BACKOFF_CAP_MS;
  }

  // One handshake sequence bounded by deadlineMs, measured from the call. Rejects with
  // ANDA_UNREACHABLE on exhaustion and ANDA_VERSION_MISMATCH at once on a shape mismatch.
  // A failed attempt leaves the bridge idle, so a later call starts a fresh handshake with its
  // own deadline. A mismatch is sticky: a later call rejects without sending a request. After
  // close() a call starts a fresh handshake. A call while a handshake or a connection is in
  // place rejects with a plain Error; the controller owns that sequencing.
  async connect(deadlineMs: number): Promise<void> {
    if (this.mismatched) {
      throw makeRealmError("ANDA_VERSION_MISMATCH");
    }
    if (this.phase !== "idle") {
      throw new Error("AndaBridge.connect: a handshake is running or the bridge is already connected");
    }
    if (!Number.isFinite(deadlineMs) || deadlineMs < 0) {
      throw new RangeError("connect deadline must be a finite non-negative number");
    }
    const lifecycle = new AbortController();
    this.lifecycle = lifecycle;
    // A new connection starts with no undelivered event, so an event of an earlier connection is never
    // delivered into this one (F4).
    this.undelivered = null;
    this.phase = "connecting";
    // Phase changes apply only while this connection is still the current one, so a handshake
    // that close() ended cannot change the state of a newer connect.
    const handshake = this.handshake(deadlineMs, lifecycle).then(
      () => {
        if (this.lifecycle === lifecycle && !lifecycle.signal.aborted) {
          this.phase = "connected";
        }
      },
      (error: unknown) => {
        if (this.lifecycle === lifecycle) {
          this.phase = "idle";
        }
        throw error;
      },
    );
    this.pending = handshake.then(
      () => undefined,
      () => undefined,
    );
    await handshake;
  }

  // One request per attempt, each bounded by the budget that remains. A request is sent only while the
  // budget is positive, so none is sent at or after the deadline (F1). The loop checks the budget again
  // after every wait, and a wait never outlasts the budget.
  private async handshake(deadlineMs: number, lifecycle: AbortController): Promise<void> {
    const signal = lifecycle.signal;
    const deadlineAt = this.now() + deadlineMs;
    for (let attempt = 0; ; attempt += 1) {
      const remaining = deadlineAt - this.now();
      if (signal.aborted || remaining <= 0) {
        throw makeRealmError("ANDA_UNREACHABLE");
      }
      const outcome = await this.attempt(signal, Math.min(this.requestTimeoutMs, remaining));
      if (signal.aborted) {
        throw makeRealmError("ANDA_UNREACHABLE");
      }
      if (outcome === "ok") {
        this.monitor = this.monitorLoop(lifecycle).catch(() => {
          this.recordMonitorFailure(lifecycle);
        });
        return;
      }
      if (outcome === "mismatch") {
        this.mismatched = true;
        throw makeRealmError("ANDA_VERSION_MISMATCH");
      }
      const left = deadlineAt - this.now();
      if (left <= 0) {
        throw makeRealmError("ANDA_UNREACHABLE");
      }
      const delay = computeBackoffDelayMs(attempt, this.backoffBaseMs, this.backoffCapMs, this.random);
      await this.sleep(Math.min(delay, left), signal);
    }
  }

  snapshot(): BridgeEvent | null {
    return this.last;
  }

  // The errno code of the latest synchronous transport throw, or a fixed reason when that error has no code.
  // The raw message is never kept, since it can carry request detail (F4). Null before any such throw.
  lastTransportFailure(): string | null {
    return this.transportFailure;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Ends the current connection. It aborts the lifecycle signal, which clears every timer and ends
  // the in-flight request, then waits for the in-flight handshake and the monitor to exit. The
  // phase returns to idle at once, so a later connect() starts a fresh handshake (ANDA-03).
  async close(): Promise<void> {
    this.lifecycle.abort();
    this.phase = "idle";
    await Promise.all([this.pending, this.monitor]);
  }

  // Probes after each backoff wait. The counter resets on success and grows on failure, so a
  // healthy engine is probed on the short end of the schedule and an outage backs off to cap.
  // The loop watches only the signal of the connection that started it. A listener failure never
  // stops the loop: an event that was not delivered is delivered again on the next tick (F3). A
  // mismatch is final, so the loop stops probing and waits only to deliver an undelivered mismatch.
  private async monitorLoop(lifecycle: AbortController): Promise<void> {
    const signal = lifecycle.signal;
    let attempt = 0;
    let up = true;
    for (;;) {
      const delay = computeBackoffDelayMs(attempt, this.backoffBaseMs, this.backoffCapMs, this.random);
      await this.sleep(delay, signal);
      if (signal.aborted) {
        return;
      }
      if (this.mismatched) {
        this.deliverUndelivered();
        if (this.undelivered === null) {
          return;
        }
        continue;
      }
      const outcome = await this.attempt(signal, this.requestTimeoutMs);
      if (signal.aborted) {
        return;
      }
      this.deliverUndelivered();
      if (outcome === "ok") {
        attempt = 0;
        if (!up) {
          up = true;
          this.publish("up");
        }
      } else if (outcome === "mismatch") {
        this.mismatched = true;
        this.publish("mismatch", "ANDA_VERSION_MISMATCH");
        if (this.undelivered === null) {
          return;
        }
      } else {
        attempt += 1;
        if (up) {
          up = false;
          this.publish("down", "ANDA_UNREACHABLE");
        }
      }
    }
  }

  // One request, settled exactly once. The timer and the abort listener are both cleared in finish, so
  // a settled attempt leaves nothing behind. The timer is the smaller of the request timeout and the
  // budget passed in. The signal is the connection's own. A synchronous throw from the transport is an
  // unreachable attempt. Its errno code becomes the transport reason, and its message is dropped (F4).
  private attempt(signal: AbortSignal, timeoutMs: number): Promise<AttemptOutcome> {
    return new Promise<AttemptOutcome>((resolve) => {
      if (signal.aborted) {
        resolve("unreachable");
        return;
      }
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      let req: ClientRequest | undefined;
      const finish = (outcome: AttemptOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onStop);
        resolve(outcome);
      };
      const onStop = (): void => {
        req?.destroy();
        finish("unreachable");
      };
      try {
        req = this.transport(this.requestOptions, (res) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          res.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_INFORMATION_BYTES) {
              // An oversize reply is not a shape mismatch: it is unreachable, and it sets no sticky state.
              req?.destroy();
              finish("unreachable");
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            finish(res.statusCode === 200 ? classifyBody(text) : "unreachable");
          });
          res.on("error", () => {
            finish("unreachable");
          });
        });
        req.on("error", () => {
          finish("unreachable");
        });
        timer = setTimeout(() => {
          req?.destroy();
          finish("unreachable");
        }, timeoutMs);
        signal.addEventListener("abort", onStop, { once: true });
        req.end();
      } catch (error) {
        req?.destroy();
        this.transportFailure = errnoOf(error) ?? NO_CODE_TRANSPORT_REASON;
        finish("unreachable");
      }
    });
  }

  // Records a transition and delivers it. A newer transition replaces an undelivered one. The transition is
  // stamped on delivery, so while the clock cannot stamp it nothing is delivered and the monitor retries it.
  private publish(kind: BridgeKind, code?: ErrorCode): void {
    this.transitions += 1;
    this.undelivered = code === undefined ? { kind, at: null } : { kind, code, at: null };
    this.deliverUndelivered();
  }

  // Stamps the undelivered transition if the clock allows, records it as the latest event, then calls every
  // listener. A transition that is already stamped keeps its instant, so a redelivery repeats the same event.
  private deliverUndelivered(): void {
    const pending = this.undelivered;
    if (pending === null) {
      return;
    }
    const at = pending.at ?? this.stamp();
    if (at === null) {
      return;
    }
    const event: BridgeEvent =
      pending.code === undefined ? { kind: pending.kind, at } : { kind: pending.kind, code: pending.code, at };
    this.last = event;
    this.deliver(event);
  }

  // Calls every listener with event. A listener that throws, or whose promise rejects, has not received the
  // event, so the event stays undelivered until one delivery succeeds (F2, F3). Each call has its own
  // try/catch, so one failing listener does not stop the others.
  private deliver(event: BridgeEvent): void {
    const owner = this.lifecycle;
    const transition = this.transitions;
    let failed = false;
    for (const listener of [...this.listeners]) {
      try {
        const result: unknown = listener(event);
        if (isPromiseLike(result)) {
          // Handling the rejection here keeps it from escaping as an unhandled rejection. It counts as a failed
          // delivery only while this connection is current and no newer transition has been published.
          result.then(undefined, () => {
            if (this.lifecycle === owner && this.transitions === transition) {
              this.undelivered = event;
            }
          });
        }
      } catch {
        failed = true;
      }
    }
    this.undelivered = failed ? event : null;
  }

  // The monitor stopped without a close, so no further probe runs, and the bridge records that as down
  // with ANDA_UNREACHABLE. Only the connection that owns the monitor may record it, so a superseded or
  // closed connection never writes the snapshot of a newer one (F4). A mismatch is final and is never
  // overwritten. The failure is not published, because the listener that failed may be the cause. This
  // runs on a catch path, so it does not throw. If the clock cannot stamp the record, it stays undelivered
  // and unstamped, the same as a failed delivery (site 448).
  private recordMonitorFailure(lifecycle: AbortController): void {
    if (this.lifecycle !== lifecycle || lifecycle.signal.aborted || this.mismatched) {
      return;
    }
    this.transitions += 1;
    const at = this.stamp();
    if (at === null) {
      this.undelivered = { kind: "down", code: "ANDA_UNREACHABLE", at: null };
      return;
    }
    this.last = { kind: "down", code: "ANDA_UNREACHABLE", at };
  }

  // The current instant as ISO 8601 text, or null when the injected clock throws. The clock may be the component
  // that failed, so no other clock is substituted. The transition then stays unstamped until the clock works (site 448).
  private stamp(): string | null {
    try {
      return new Date(this.now()).toISOString();
    } catch {
      return null;
    }
  }
}
