// ExecutionService port (D-39, spec n3 default). Interface only: no runtime values.
//
// The request carries no environment field, so no host environment can reach the
// execution service by type (AUD-02, D-43). Each method returns a Promise because
// D-28 races every call against a timer (src/core/timeout.ts); a synchronous call
// could not be bounded. Phase 3 implements this port, and the lifecycle depends on
// its shape, so changing it is a costly change (D-39).

// What the execution service needs to create a sandbox. It carries no host environment.
export interface CreateRequest {
  readonly idempotencyKey: string;
  readonly workspaceRoot: string;
}

// The result of probing a container: it is healthy or it is not.
export type ProbeResult = "healthy" | "unhealthy";

// The execution port: create, start, probe, stop and destroy a session's container. Implemented outside core.
export interface ExecutionService {
  create(req: CreateRequest): Promise<{ readonly containerId: string }>;
  // sandbox is the session's realm sandbox name, always realm-<sessionId>. Callers pass it on every start, probe, stop and destroy.
  start(containerId: string, sandbox: string): Promise<void>;
  probe(containerId: string, sandbox: string): Promise<ProbeResult>;
  stop(containerId: string, sandbox: string): Promise<void>;
  destroy(containerId: string, sandbox: string): Promise<void>;
}
