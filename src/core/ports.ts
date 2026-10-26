// ExecutionService port (D-39, spec n3 default). Interface only: no runtime values.
//
// The request carries no environment field, so no host environment can reach the
// execution service by type (AUD-02, D-43). Each method returns a Promise because
// D-28 races every call against a timer (src/core/timeout.ts); a synchronous call
// could not be bounded. Phase 3 implements this port, and the lifecycle depends on
// its shape, so changing it is a costly change (D-39).

import type { ErrorCode } from "./errors.js";

export interface CreateRequest {
  readonly idempotencyKey: string;
  readonly workspaceRoot: string;
}

export type ProbeResult = "healthy" | "unhealthy";

export interface ExecutionService {
  create(req: CreateRequest): Promise<{ readonly containerId: string }>;
  // sandbox is the session's realm sandbox name, always realm-<sessionId>. Callers pass it on every start, probe, stop and destroy.
  start(containerId: string, sandbox: string): Promise<void>;
  probe(containerId: string, sandbox: string): Promise<ProbeResult>;
  stop(containerId: string, sandbox: string): Promise<void>;
  destroy(containerId: string, sandbox: string): Promise<void>;
}

// BridgePort (D-64, D-65, ANDA-03). Sits beside ExecutionService and is never merged into
// it (D-39). The bridge publishes BridgeEvent values; the controller alone decides the
// session state (D-62, D-65). Events carry no response body and no credential.

export type BridgeKind = "up" | "down" | "mismatch";

export interface BridgeEvent {
  readonly kind: BridgeKind;
  readonly code?: ErrorCode;
  // ISO 8601 instant, the same format as StateSnapshot.lastTransitionAt (F-P3-04).
  readonly at: string;
}

export interface BridgePort {
  // One handshake attempt sequence bounded by deadlineMs. Rejects when the deadline expires
  // or the handshake fails; the caller maps the rejection to a fixed code.
  connect(deadlineMs: number): Promise<void>;
  // The most recent event published, or null before the first one.
  snapshot(): BridgeEvent | null;
  // Registers a listener and returns the function that removes it.
  subscribe(listener: (event: BridgeEvent) => void): () => void;
  close(): Promise<void>;
}
