// ExecutionService port (D-39, spec n3 default). Interface only: no runtime values.
//
// The request carries no environment field, so no host environment can reach the
// execution service by type (AUD-02, D-43). Each method returns a Promise because
// D-28 races every call against a timer (src/core/timeout.ts); a synchronous call
// could not be bounded. Phase 3 implements this port, and the lifecycle depends on
// its shape, so changing it is a costly change (D-39).

export interface CreateRequest {
  readonly idempotencyKey: string;
  readonly workspaceRoot: string;
}

export type ProbeResult = "healthy" | "unhealthy";

export interface ExecutionService {
  create(req: CreateRequest): Promise<{ readonly containerId: string }>;
  start(containerId: string): Promise<void>;
  probe(containerId: string): Promise<ProbeResult>;
  stop(containerId: string): Promise<void>;
  destroy(containerId: string): Promise<void>;
}
