// Lifecycle controller for one session (D-38, D-28, D-43, RT-07, CORE-06). The controller
// composes the state machine, the session record, the advisory lock table, and the
// execution port. Every ExecutionService call is raced against a budget (D-28). Startup
// calls (create, start, and probe) share policy.startupBudgetMs and map expiry to
// STARTUP_BUDGET_EXCEEDED. Teardown calls (stop and destroy) use the single
// TEARDOWN_TIMEOUT_MS bound. Expiry and any other port failure map to REALM_STOPPING. A call
// that times out is never awaited again, so no operation hangs.
//
// The controller calls the state machine only with checked transitions, which the machine
// enforces. Every operation returns the same snapshot shape: state, reason, and the time of
// the last transition. Repeating an operation changes no state and creates no second
// resource, because the port keys containers by session id.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { Policy } from "../contract/validate.js";
import { type ErrorCode, makeRealmError, RealmError } from "../core/errors.js";
import { createEventBus } from "../core/events.js";
import type { ExecutionService, ProbeResult } from "../core/ports.js";
import { INITIAL_REASON, RealmStateMachine, type StateSnapshot } from "../core/state-machine.js";
import { withTimeout } from "../core/timeout.js";
import { LockTable } from "../fs/locks.js";
import { bindRoot, isInsideRoot, type PinnedRoot } from "../fs/root.js";
import { controlSocketPath } from "../session/paths.js";
import type { SessionStore } from "../session/store.js";

// Code for a port failure that is not a RealmError on the create, start, and probe paths.
// The raw error is dropped: it is never attached as a cause, and its message and stack are
// never copied into a RealmError, because either may hold a secret.
const PORT_FAILURE_CODE: ErrorCode = "OPENSHELL_START_FAILED";

// Reason recorded while teardown is in progress.
const STOPPING_REASON = "stopping";

// The single teardown bound (D-28, Q-1). Expiry returns REALM_STOPPING and leaves the
// session in stopping, so a repeated destroy resumes teardown. The catalogue has no
// teardown-timeout code, and none is added.
const TEARDOWN_TIMEOUT_MS = 5000;

export interface LifecycleDeps {
  readonly sessionId: string;
  readonly policy: Policy;
  readonly store: SessionStore;
  readonly exec: ExecutionService;
  readonly clock: () => Date;
  // Advisory locks (D-33), owned by this session's id. Session destroy releases the locks
  // the session owns. The daemon passes its shared table in Phase 6; without one the
  // controller owns a table of its own.
  readonly locks?: LockTable;
}

export class LifecycleController {
  readonly events = createEventBus();
  private readonly deps: LifecycleDeps;
  private readonly machine: RealmStateMachine;
  private readonly locks: LockTable;
  private readonly hostAttachments = new Set<string>();

  constructor(deps: LifecycleDeps) {
    this.deps = deps;
    this.machine = new RealmStateMachine(deps.sessionId, this.events, deps.clock);
    this.locks = deps.locks ?? new LockTable();
  }

  snapshot(): StateSnapshot {
    return this.machine.snapshot();
  }

  // Binds the workspace, writes the record with containerId null before the port
  // create (RT-07), stores the returned containerId, then starts the container. A
  // RealmError from create or start moves the session to error and returns the snapshot
  // whose reason is the error code. Any other failure moves the session to error and throws
  // OPENSHELL_START_FAILED. A retry from error runs through connecting again.
  // A stored containerId means no second create. While connecting, active, or degraded,
  // create binds the workspace and checks it against the record first: the same workspace
  // changes nothing, and a different one is refused with POLICY_DENIED.
  // The startup budget (policy.startupBudgetMs) starts before bindWorkspace and covers the
  // bind, the record loads and writes, and the port create and start. Each synchronous step
  // is followed by a deadline check, and each port call is raced against the time left.
  // Expiry moves the session to error with STARTUP_BUDGET_EXCEEDED, keeps any containerId
  // already recorded, and creates no second container. A repeat call while connecting,
  // active, or degraded does no startup work, so the budget does not apply to it.
  async create(workspaceRoot: string): Promise<StateSnapshot> {
    const { state } = this.machine.snapshot();
    if (state === "stopping") {
      throw makeRealmError("REALM_STOPPING");
    }

    // One deadline covers the whole startup path after the stopping check (D-28): the
    // workspace bind, the record load and writes, and the port create and start.
    const deadline = performance.now() + this.deps.policy.startupBudgetMs;
    const root = this.bindWorkspace(workspaceRoot);
    const existing = this.deps.store.load(this.deps.sessionId);
    const priorContainerId = existing?.containerId ?? null;
    if (existing !== null && priorContainerId !== null && existing.workspaceRoot !== root.realPath) {
      // One container per session (S-02): a container bound to another workspace is
      // never reused for this one. This check runs before the early return below, so an
      // active session refuses another workspace too.
      throw makeRealmError("POLICY_DENIED");
    }
    if (state === "connecting" || state === "active" || state === "degraded") {
      return this.machine.snapshot();
    }
    const realmId = existing?.realmId ?? randomUUID();

    this.machine.transition("connecting", "creating container");
    let containerId: string | null = priorContainerId;

    // Every store write sits inside the guarded block, so a failed write moves the
    // session to error rather than leaving it stuck in connecting.
    try {
      this.checkDeadline(deadline);
      this.persist(realmId, root, containerId);
      this.checkDeadline(deadline);
      if (containerId === null) {
        const created = await withTimeout(
          this.deps.exec.create({
            idempotencyKey: this.deps.sessionId,
            workspaceRoot: root.realPath,
          }),
          Math.max(0, deadline - performance.now()),
          "STARTUP_BUDGET_EXCEEDED",
        );
        containerId = created.containerId;
        this.persist(realmId, root, containerId);
        this.checkDeadline(deadline);
      }
      await withTimeout(
        this.deps.exec.start(containerId),
        Math.max(0, deadline - performance.now()),
        "STARTUP_BUDGET_EXCEEDED",
      );
    } catch (error: unknown) {
      return this.failCreate(error, realmId, root, containerId);
    }

    this.machine.transition("active", "container running");
    this.persist(realmId, root, containerId);
    return this.machine.snapshot();
  }

  // Starts the session's container (D-38). Start is valid in connecting and error. While
  // connecting, the create in flight owns the start, so the snapshot is returned. In active
  // and degraded it is a no-op. In error it runs create again against the recorded
  // workspace: the session moves through connecting and reuses the stored container. Unbound
  // has no recorded workspace (REALM_UNBOUND), and stopping refuses (REALM_STOPPING).
  async start(): Promise<StateSnapshot> {
    const { state } = this.machine.snapshot();
    if (state === "unbound") {
      throw makeRealmError("REALM_UNBOUND");
    }
    if (state === "stopping") {
      throw makeRealmError("REALM_STOPPING");
    }
    if (state !== "error") {
      return this.machine.snapshot();
    }
    const record = this.deps.store.load(this.deps.sessionId);
    if (record === null) {
      throw makeRealmError("REALM_UNBOUND");
    }
    return this.create(record.workspaceRoot);
  }

  // Probes the container in active or degraded (D-38). A healthy result changes nothing.
  // An unhealthy result moves the session to error with reason "probe failed". Probe never
  // produces degraded: Phase 3 (ANDA-03) does. The probe is bounded by the startup budget,
  // and its expiry maps to STARTUP_BUDGET_EXCEEDED. Any other state returns the snapshot.
  async probe(): Promise<StateSnapshot> {
    const { state } = this.machine.snapshot();
    if (state !== "active" && state !== "degraded") {
      return this.machine.snapshot();
    }
    const containerId = this.deps.store.load(this.deps.sessionId)?.containerId ?? null;
    if (containerId === null) {
      throw makeRealmError("SCHEMA_INVALID");
    }
    let health: ProbeResult;
    try {
      health = await withTimeout(
        this.deps.exec.probe(containerId),
        this.deps.policy.startupBudgetMs,
        "STARTUP_BUDGET_EXCEEDED",
      );
    } catch (error: unknown) {
      return this.enterError(error);
    }
    if (health === "unhealthy") {
      this.machine.transition("error", "probe failed");
      this.writeState();
    }
    return this.machine.snapshot();
  }

  // Host attachments change no state and no record. Attaching the same id twice is
  // the same as attaching it once.
  attach(hostAttachmentId: string): StateSnapshot {
    this.hostAttachments.add(hostAttachmentId);
    return this.machine.snapshot();
  }

  detach(hostAttachmentId: string): StateSnapshot {
    this.hostAttachments.delete(hostAttachmentId);
    return this.machine.snapshot();
  }

  attachments(): readonly string[] {
    return [...this.hostAttachments].sort();
  }

  // Stops the container (D-38). Valid in connecting, active, degraded, and error, moving to
  // stopping and then to unbound. Stopping a stopping session is a no-op that returns the
  // snapshot. Stopping an unbound session makes no port call and changes no state; it clears
  // the host attachments, because the session is unbound. Expiry of the teardown bound, or
  // any other port failure, throws REALM_STOPPING and the session stays in stopping; a
  // repeated destroy resumes teardown.
  async stop(): Promise<StateSnapshot> {
    const { state } = this.machine.snapshot();
    if (state === "unbound") {
      this.hostAttachments.clear();
      return this.machine.snapshot();
    }
    if (state === "stopping") {
      return this.machine.snapshot();
    }
    this.enterStopping();
    await this.stopContainer(this.deps.store.load(this.deps.sessionId)?.containerId ?? null);
    this.machine.transition("unbound", INITIAL_REASON);
    this.writeState();
    this.hostAttachments.clear();
    return this.machine.snapshot();
  }

  // Tears the session down (D-38). When the session is not unbound it stops first (a
  // stopping session resumes its stop), then destroys the container, releases the session's
  // advisory locks (D-33), moves to unbound, and deletes the record last. Expiry of the
  // teardown bound, or any other port failure, throws REALM_STOPPING with the session left
  // in stopping and the record kept, since it holds the only copy of the containerId; a
  // repeated destroy resumes teardown. A session with no record has no container: destroy
  // moves it to unbound with no port call, and a repeat changes nothing. Reaching unbound
  // clears the host attachments.
  async destroy(): Promise<StateSnapshot> {
    const containerId = this.deps.store.load(this.deps.sessionId)?.containerId ?? null;
    if (this.machine.snapshot().state !== "unbound") {
      this.enterStopping();
      await this.stopContainer(containerId);
    }
    try {
      if (containerId !== null) {
        await this.teardownCall(this.deps.exec.destroy(containerId));
      }
    } finally {
      this.locks.releaseOwner(this.deps.sessionId);
    }
    if (this.machine.snapshot().state !== "unbound") {
      this.machine.transition("unbound", INITIAL_REASON);
    }
    this.deps.store.delete(this.deps.sessionId);
    this.hostAttachments.clear();
    return this.machine.snapshot();
  }

  // The requested root must canonicalize, and it must lie inside a policy root. Every
  // policy root must canonicalize too, or the bind fails with POLICY_DENIED (D-22), even
  // when an earlier policy root already contains the workspace.
  private bindWorkspace(requested: string): PinnedRoot {
    const root = bindRoot(requested);
    const policyRoots = this.deps.policy.workspaceRoots.map((entry) => bindRoot(entry));
    if (policyRoots.some((policyRoot) => isInsideRoot(policyRoot, root.realPath))) {
      return root;
    }
    throw makeRealmError("POLICY_DENIED");
  }

  // Throws STARTUP_BUDGET_EXCEEDED once the startup deadline has passed. Synchronous work
  // cannot be interrupted by withTimeout, so each synchronous step is followed by this check.
  private checkDeadline(deadline: number): void {
    if (performance.now() >= deadline) {
      throw makeRealmError("STARTUP_BUDGET_EXCEEDED");
    }
  }

  private failCreate(
    error: unknown,
    realmId: string,
    root: PinnedRoot,
    containerId: string | null,
  ): StateSnapshot {
    if (!(error instanceof RealmError)) {
      this.machine.transition("error", PORT_FAILURE_CODE);
      this.persist(realmId, root, containerId);
      throw makeRealmError(PORT_FAILURE_CODE);
    }
    this.machine.transition("error", error.code);
    this.persist(realmId, root, containerId);
    return this.machine.snapshot();
  }

  // Moves a session to error for a failed port call. A RealmError keeps its code as the
  // reason and returns the snapshot; any other failure is refused as OPENSHELL_START_FAILED,
  // the same rule create follows.
  private enterError(error: unknown): StateSnapshot {
    if (!(error instanceof RealmError)) {
      this.machine.transition("error", PORT_FAILURE_CODE);
      this.writeState();
      throw makeRealmError(PORT_FAILURE_CODE);
    }
    this.machine.transition("error", error.code);
    this.writeState();
    return this.machine.snapshot();
  }

  // Moves to stopping and records it. A session already stopping stays there, so a repeated
  // stop or destroy resumes it instead of failing.
  private enterStopping(): void {
    if (this.machine.snapshot().state === "stopping") {
      return;
    }
    this.machine.transition("stopping", STOPPING_REASON);
    this.writeState();
  }

  // Stops the container within the teardown bound. A session with no container has nothing
  // running to stop. A failure throws REALM_STOPPING, and the caller leaves the session in
  // stopping.
  private async stopContainer(containerId: string | null): Promise<void> {
    if (containerId === null) {
      return;
    }
    await this.teardownCall(this.deps.exec.stop(containerId));
  }

  // Runs one teardown port call within the teardown bound (D-28). Expiry throws
  // REALM_STOPPING. A RealmError from the port keeps its code; any other failure is also
  // reported as REALM_STOPPING, so a raw port error never escapes teardown.
  private async teardownCall(call: Promise<void>): Promise<void> {
    try {
      await withTimeout(call, TEARDOWN_TIMEOUT_MS, "REALM_STOPPING");
    } catch (error: unknown) {
      if (error instanceof RealmError) {
        throw error;
      }
      throw makeRealmError("REALM_STOPPING");
    }
  }

  // Writes the record with the current state, keeping its identity and containerId. A
  // session with no record has nothing that survives a restart, so nothing is written.
  private writeState(): void {
    const record = this.deps.store.load(this.deps.sessionId);
    if (record === null) {
      return;
    }
    this.deps.store.save({ ...record, state: this.machine.snapshot().state });
  }

  // Writes the record with the current state. The record is the only place the
  // containerId survives a restart, so every change of it goes through here.
  private persist(realmId: string, root: PinnedRoot, containerId: string | null): void {
    this.deps.store.save({
      realmId,
      sessionId: this.deps.sessionId,
      workspaceRoot: root.realPath,
      state: this.machine.snapshot().state,
      controlSocketPath: controlSocketPath(this.deps.store.stateDir),
      containerId,
    });
  }
}
