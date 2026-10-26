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
import type { BridgeEvent, BridgePort, ExecutionService, ProbeResult } from "../core/ports.js";
import { INITIAL_REASON, RealmStateMachine, type StateSnapshot } from "../core/state-machine.js";
import { withTimeout } from "../core/timeout.js";
import { LockTable } from "../fs/locks.js";
import { type PinnedRoot, verifyPinnedAt } from "../fs/root.js";
import { realmSandboxName } from "../runtime/openshell.js";
import { controlSocketPath } from "../session/paths.js";
import type { SessionStore } from "../session/store.js";
import { type GateOutcome, gateMutation } from "./mutation-gate.js";

// Code for a port failure that is not a RealmError on the create, start, and probe paths.
// The raw error is dropped: it is never attached as a cause, and its message and stack are
// never copied into a RealmError, because either may hold a secret.
const PORT_FAILURE_CODE: ErrorCode = "OPENSHELL_START_FAILED";

// The typed code of a port failure. A RealmError keeps its code. Any other failure is
// PORT_FAILURE_CODE, the same rule create and enterError follow. The raw error is never kept,
// because its message may hold a secret.
function portFailureCode(error: unknown): ErrorCode {
  return error instanceof RealmError ? error.code : PORT_FAILURE_CODE;
}

// Reason recorded while teardown is in progress.
const STOPPING_REASON = "stopping";

// The single teardown bound (D-28, Q-1). It is the sum of three bounds that teardown stages
// honour in turn: the AgentOS stop backstop (15 s), the container stop grace (10 s), and one
// libpod request bound (5 s). Teardown gives up only after an inner stage has had its own
// bound, so it does not expire while that stage is still within it. Expiry returns
// REALM_STOPPING and leaves the session in stopping, so a repeated destroy resumes teardown.
// The catalogue has no teardown-timeout code, and none is added.
export const TEARDOWN_TIMEOUT_MS = 30_000;

// A port create that is issued and has not settled. Its owner is the create that issued it,
// until a stop or destroy takes it (C1). `attempt` numbers the creates, so an abandoned one can
// tell that a newer create started after it (C2).
interface PendingCreate {
  readonly attempt: number;
  readonly created: Promise<{ readonly containerId: string }>;
}

// A port start that is issued and has not settled. A teardown that begins while it is in flight
// waits for it and stops the container it starts, because a stop that ran before the start took
// effect leaves the container running (F1). `settled` resolves to the typed code of a failed
// start, or null, and never rejects, so waiting on it never throws.
interface PendingStart {
  readonly containerId: string;
  readonly started: Promise<void>;
  readonly settled: Promise<ErrorCode | null>;
}

export interface LifecycleDeps {
  readonly sessionId: string;
  readonly policy: Policy;
  readonly store: SessionStore;
  readonly exec: ExecutionService;
  // The Anda bridge (D-64, D-65). It publishes up, down, and mismatch events, and the
  // controller alone decides the session state from them.
  readonly bridge: BridgePort;
  readonly clock: () => Date;
  // Advisory locks (D-33), owned by this session's id. Session destroy releases the locks
  // the session owns. The daemon passes its shared table in Phase 6; without one the
  // controller owns a table of its own.
  readonly locks?: LockTable;
  // The root bound under policy when the workspace was chosen (D-22). Every create verifies the
  // requested workspace against it, by device, inode, and real path, before any state change. The
  // controller never binds a workspace from a string of its own (FS-02).
  readonly pinnedRoot: PinnedRoot;
  // The teardown bound in milliseconds. The default is TEARDOWN_TIMEOUT_MS.
  readonly teardownTimeoutMs?: number;
}

export class LifecycleController {
  readonly events = createEventBus();
  private readonly deps: LifecycleDeps;
  private readonly machine: RealmStateMachine;
  private readonly locks: LockTable;
  private readonly hostAttachments = new Set<string>();
  private unsubscribeBridge: (() => void) | null = null;
  // The handshake the controller started and has not seen settle, or null (ANDA-03).
  private bridgeHandshake: Promise<void> | null = null;
  // True once a handshake the controller started has connected, so the bridge needs no connect.
  private bridgeConnected = false;
  // The port create in flight, or null. Only a create that holds no containerId yet has one (C1).
  private pendingCreate: PendingCreate | null = null;
  // Creates issued so far. An abandoned create compares its attempt with this count (C2).
  private createAttempts = 0;
  // Port starts that have not settled (F1). Every teardown waits for them. A start that outlives
  // the teardown bound is handed to the background through adopt.
  private readonly pendingStarts = new Set<PendingStart>();
  // Background teardown work that outlived its caller: an orphaned create's destroy and the late
  // stop of a start (F1, F2). destroy waits for these before it reads the record. No entry
  // rejects; a failed step is kept in orphanFailure instead.
  private readonly orphans = new Set<Promise<void>>();
  // The code of the last background teardown step that failed. Its container stays recorded, so
  // the next destroy retries it. If that retry fails too, this code is the causeCode of the error
  // that destroy throws, and a retry that succeeds clears it (G-04).
  private orphanFailure: ErrorCode | null = null;
  // The code of the write failure that left the record behind the in-memory state, or null (F7).
  private unpersistedFailure: ErrorCode | null = null;

  constructor(deps: LifecycleDeps) {
    this.deps = deps;
    this.machine = new RealmStateMachine(deps.sessionId, this.events, deps.clock);
    this.locks = deps.locks ?? new LockTable();
  }

  snapshot(): StateSnapshot {
    return this.machine.snapshot();
  }

  // True while the record lags the in-memory state, because its last write failed (F7).
  hasUnpersistedState(): boolean {
    return this.unpersistedFailure !== null;
  }

  // The code of the write failure behind hasUnpersistedState, or null when the record is current.
  unpersistedCause(): ErrorCode | null {
    return this.unpersistedFailure;
  }

  // The CORE-05 gate for a file-mutating call, decided from the current state (D-63). It
  // never waits and writes no audit entry.
  mutationGate(): GateOutcome {
    return gateMutation(this.deps.policy, this.machine.snapshot().state);
  }

  // Verifies the requested workspace against the pinned root, writes the record with containerId
  // null before the port create (RT-07), stores the returned containerId, then starts the
  // container. A
  // RealmError from create or start moves the session to error and returns the snapshot
  // whose reason is the error code. Any other failure moves the session to error and throws
  // OPENSHELL_START_FAILED. A retry from error runs through connecting again.
  // A stored containerId means no second create. Every create verifies the requested workspace
  // against the pinned root first: the same directory changes nothing, and any other is refused
  // with POLICY_DENIED. While connecting, active, or degraded, a record that names another workspace
  // is refused the same way.
  // The startup budget (policy.startupBudgetMs) starts before the pinned-root check and covers the
  // check, the record loads and writes, the port create and start, and the bridge handshake.
  // Each synchronous step is followed by a deadline check, and each port call is raced against
  // the time left.
  // Expiry moves the session to error with STARTUP_BUDGET_EXCEEDED, keeps any containerId
  // already recorded, and creates no second container. A repeat call while connecting,
  // active, or degraded does no startup work, so the budget does not apply to it.
  // A handshake the expired call started keeps running on the bridge's own deadline, and the
  // next startup waits for its outcome (see connectBridge).
  // A stop or destroy that begins during create takes the create over: create then returns the
  // snapshot the teardown left, and it persists and transitions nothing more. A container the port
  // produces for a pending create is destroyed by that teardown (C1). A create given up at the
  // budget keeps its port call, and a container the call later produces is destroyed (C2).
  // A port start still in flight when a teardown begins is waited for, and its container is stopped
  // once the start settles (F1).
  async create(workspaceRoot: string): Promise<StateSnapshot> {
    const { state } = this.machine.snapshot();
    if (state === "stopping") {
      throw makeRealmError("REALM_STOPPING");
    }
    // A startup mismatch is not retryable (D-64). The error keeps its reason, and create and
    // start refuse it until the session is stopped.
    if (state === "error" && this.machine.snapshot().reason === "ANDA_VERSION_MISMATCH") {
      throw makeRealmError("ANDA_VERSION_MISMATCH");
    }

    // One deadline covers the whole startup path after the stopping check (D-28): the
    // pinned-root check, the record load and writes, and the port create and start.
    const deadline = performance.now() + this.deps.policy.startupBudgetMs;
    // The requested path is checked against the pinned directory before any state change (FS-02).
    // The root used from here on is the pinned one, so the record and the port call never see a
    // path string that was resolved again after the check.
    const root = verifyPinnedAt(this.deps.pinnedRoot, workspaceRoot);
    const existing = this.deps.store.load(this.deps.sessionId);
    const priorContainerId = existing?.containerId ?? null;
    const live = state === "connecting" || state === "active" || state === "degraded";
    // A record that names a container, or a live session, binds the workspace (S-02, F5).
    const mustMatch = priorContainerId !== null || live;
    if (existing !== null && mustMatch && existing.workspaceRoot !== root.realPath) {
      // One container per session (S-02): a container bound to another workspace is never reused
      // for this one. This check runs before the early return below, so an active session refuses
      // another workspace too, and so does a create still in flight (F5).
      throw makeRealmError("POLICY_DENIED");
    }
    if (live) {
      return this.machine.snapshot();
    }
    const realmId = existing?.realmId ?? randomUUID();

    this.machine.transition("connecting", "creating container");
    let containerId: string | null = priorContainerId;
    let issuedStart: PendingStart | null = null;

    // Every store write sits inside the guarded block, so a failed write moves the
    // session to error rather than leaving it stuck in connecting. Each await is followed by a
    // state check: a stop that began during the await owns the session, so this create records
    // and transitions nothing more (see failCreate).
    try {
      this.subscribeBridge();
      this.checkDeadline(deadline);
      this.persist(realmId, root, containerId);
      this.checkDeadline(deadline);
      if (containerId === null) {
        const pending = this.issueCreate(root);
        let created: { readonly containerId: string };
        try {
          created = await withTimeout(
            pending.created,
            Math.max(0, deadline - performance.now()),
            "STARTUP_BUDGET_EXCEEDED",
          );
        } catch (error: unknown) {
          // This create gives up at its budget, so a container the port produces later is destroyed.
          // A stop that already took the pending create owns that container instead. A port failure is
          // not adopted: its call has settled, and the error goes to the outer catch, the one place
          // that calls failCreate.
          const owned = this.takePendingCreate();
          if (
            owned !== null &&
            error instanceof RealmError &&
            error.code === "STARTUP_BUDGET_EXCEEDED"
          ) {
            this.adoptOrphan(owned);
          }
          throw error;
        }
        this.takePendingCreate();
        if (this.machine.snapshot().state !== "connecting") {
          // A stop took the create over while it was pending, and it destroys the container this
          // create produced. Nothing is persisted or started here.
          return this.machine.snapshot();
        }
        containerId = created.containerId;
        this.persist(realmId, root, containerId);
        this.checkDeadline(deadline);
      }
      const start = this.issueStart(containerId);
      issuedStart = start;
      await withTimeout(
        start.started,
        Math.max(0, deadline - performance.now()),
        "STARTUP_BUDGET_EXCEEDED",
      );
      if (this.machine.snapshot().state !== "connecting") {
        // A stop began while start was in flight. Its teardown waits for the start and stops the
        // container once the start settles (F1), so nothing more is started here.
        return this.machine.snapshot();
      }
      const remaining = Math.max(0, deadline - performance.now());
      await withTimeout(this.connectBridge(remaining), remaining, "STARTUP_BUDGET_EXCEEDED");
    } catch (error: unknown) {
      // A start the budget gave up on is still in flight. adoptStart keeps its outcome, unless a
      // stop is in progress, which reclaims that start itself.
      if (
        issuedStart !== null &&
        error instanceof RealmError &&
        error.code === "STARTUP_BUDGET_EXCEEDED" &&
        this.machine.snapshot().state !== "stopping"
      ) {
        this.adoptStart(issuedStart);
      }
      return this.failCreate(error, realmId, root, containerId);
    }
    if (this.machine.snapshot().state !== "connecting") {
      // A stop began during the bridge handshake. It closed the bridge and stopped the container.
      return this.machine.snapshot();
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
    // A stop may have taken the session while the probe was in flight. Only the active and degraded
    // states take the outcome of a probe (F4).
    if (health === "unhealthy" && this.isInService()) {
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
    const containerId = this.deps.store.load(this.deps.sessionId)?.containerId ?? null;
    await this.teardownBridgeAndContainer(containerId, this.takePendingCreate());
    // A destroy that finished while this teardown was in flight already reached unbound (F3).
    if (this.machine.snapshot().state === "stopping") {
      this.machine.transition("unbound", INITIAL_REASON);
    }
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
  // clears the host attachments. Adopted creates and starts are waited for first, within the same
  // bound (F2).
  async destroy(): Promise<StateSnapshot> {
    if (this.machine.snapshot().state !== "unbound") {
      this.enterStopping();
      const recorded = this.deps.store.load(this.deps.sessionId)?.containerId ?? null;
      await this.teardownBridgeAndContainer(recorded, this.takePendingCreate());
    }
    // The record is read only after every adopted orphan has settled, because an orphan whose
    // destroy failed records its container there (F2).
    await this.settleOrphans();
    const containerId = this.deps.store.load(this.deps.sessionId)?.containerId ?? null;
    this.releaseBridge();
    try {
      await this.destroyRecorded(containerId);
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

  // Destroys the container the record names. A failed background step left that container
  // recorded, so this call is its retry. A retry that succeeds clears the kept failure. A retry that
  // fails throws its own code with the kept failure as causeCode. A kept failure with no recorded
  // container has nothing left to retry, so it is reported as the cause of REALM_STOPPING.
  private async destroyRecorded(containerId: string | null): Promise<void> {
    const failure = this.orphanFailure;
    if (containerId === null) {
      if (failure !== null) {
        this.orphanFailure = null;
        throw makeRealmError("REALM_STOPPING", failure);
      }
      return;
    }
    try {
      await this.teardownCall(this.deps.exec.destroy(containerId, this.sandboxName()));
    } catch (error: unknown) {
      if (failure !== null && error instanceof RealmError) {
        throw makeRealmError(error.code, failure);
      }
      throw error;
    }
    this.orphanFailure = null;
  }

  // Throws STARTUP_BUDGET_EXCEEDED once the startup deadline has passed. Synchronous work
  // cannot be interrupted by withTimeout, so each synchronous step is followed by this check.
  private checkDeadline(deadline: number): void {
    if (performance.now() >= deadline) {
      throw makeRealmError("STARTUP_BUDGET_EXCEEDED");
    }
  }

  // Connects the bridge for a startup. At most one handshake is kept: while it is in flight,
  // or after it connected, a call returns that handshake instead of calling the bridge again,
  // because the bridge refuses a connect made during a handshake with a plain Error (ANDA-03).
  // The handshake is not raced against the caller's budget here, so it runs to the bridge's
  // own deadline. A retry waits for its outcome under the retry's own budget, which the
  // caller's withTimeout enforces. A handshake that rejects is forgotten, so the next startup
  // starts a fresh one.
  private connectBridge(deadlineMs: number): Promise<void> {
    if (this.bridgeConnected) {
      return Promise.resolve();
    }
    const pending = this.bridgeHandshake;
    if (pending !== null) {
      return pending;
    }
    const handshake = this.deps.bridge.connect(deadlineMs);
    this.bridgeHandshake = handshake;
    // Both branches are handled, so a rejection after the caller's budget expired is never
    // unhandled. Each branch clears the record only while it still names this handshake.
    void handshake.then(
      () => {
        if (this.bridgeHandshake === handshake) {
          this.bridgeHandshake = null;
          this.bridgeConnected = true;
        }
      },
      () => {
        if (this.bridgeHandshake === handshake) {
          this.bridgeHandshake = null;
        }
      },
    );
    return handshake;
  }

  private failCreate(
    error: unknown,
    realmId: string,
    root: PinnedRoot,
    containerId: string | null,
  ): StateSnapshot {
    // The transition is valid only from connecting. A stop that began during the create owns the
    // session now, so this create records nothing more and returns the state the stop left. The
    // stop owns the outcome, so a port failure of the overtaken call is not reported, and the
    // record already names any container that survives. A REALM_STOPPING from the stop call made
    // here still reaches the caller (C1).
    if (this.machine.snapshot().state !== "connecting") {
      if (error instanceof RealmError && error.code === "REALM_STOPPING") {
        throw error;
      }
      return this.machine.snapshot();
    }
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
    // A stop or destroy took the session while the probe was in flight. It owns the outcome, so
    // this failure is not recorded, and the snapshot the teardown left is returned (F4).
    if (!this.isInService()) {
      return this.machine.snapshot();
    }
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

  // Subscribes the bridge listener once, before the first handshake, so no event is lost
  // (D-65). The listener stays subscribed until destroy.
  private subscribeBridge(): void {
    if (this.unsubscribeBridge === null) {
      this.unsubscribeBridge = this.deps.bridge.subscribe((event) => {
        this.onBridgeEvent(event);
      });
    }
  }

  // Applies one bridge event (ANDA-03, D-64). Only active and degraded accept it: active
  // moves to degraded on down, degraded moves to active on up, and either moves to error on
  // mismatch. Connecting belongs to the create flow, which takes the outcome of its own
  // handshake, and every other state discards the event. The guard is an explicit state
  // check, never a caught throw, so a background event cannot raise REALM_INVALID_TRANSITION.
  private onBridgeEvent(event: BridgeEvent): void {
    const { state } = this.machine.snapshot();
    if (state !== "active" && state !== "degraded") {
      return;
    }
    if (event.kind === "mismatch") {
      this.machine.transition("error", "ANDA_VERSION_MISMATCH");
    } else if (event.kind === "down" && state === "active") {
      this.machine.transition("degraded", "ANDA_UNREACHABLE");
    } else if (event.kind === "up" && state === "degraded") {
      this.machine.transition("active", "anda reachable");
    } else {
      return;
    }
    // The listener must not throw. The transition above stays in memory, and a failed write is
    // recorded with its code in unpersistedFailure. The next write persists the current state (F7).
    try {
      this.writeState();
    } catch (error: unknown) {
      this.unpersistedFailure = error instanceof RealmError ? error.code : "WRITE_NOT_ATOMIC";
    }
  }

  // Tears the bridge and the container down together (ANDA-03, D-64). The bridge close is
  // started first, and its abort stops the background probe loop before exec.stop is invoked.
  // exec.stop is not held back until the close completes: stop() must reach exec.stop in the
  // same tick, as the Phase 2 idempotency contract requires. Both calls run under the teardown
  // bound and are awaited together, and a failure of either throws REALM_STOPPING. A create
  // still pending when teardown starts is reclaimed in the same way (C1, C2), and so is a start
  // still in flight, whose container is stopped once the start settles (F1).
  private async teardownBridgeAndContainer(
    containerId: string | null,
    pending: PendingCreate | null,
  ): Promise<void> {
    // Closing the bridge discards any handshake made before it; a later connect starts afresh (ANDA-03).
    this.bridgeHandshake = null;
    this.bridgeConnected = false;
    const closed = this.teardownCall(this.deps.bridge.close());
    const stopped = this.stopContainer(containerId);
    const reclaimed = pending === null ? Promise.resolve() : this.reclaimPendingCreate(pending);
    const started = [...this.pendingStarts].map((start) => this.reclaimPendingStart(start));
    await Promise.all([closed, stopped, reclaimed, ...started]);
  }

  // Removes the bridge listener. Destroy calls it once the bridge and the container have stopped,
  // before the container is destroyed.
  private releaseBridge(): void {
    this.unsubscribeBridge?.();
    this.unsubscribeBridge = null;
  }

  // The sandbox name the realm gives this session. Every stop and destroy passes it, so the session-execution port can
  // delete the session's sandbox without an in-memory name.
  private sandboxName(): string {
    return realmSandboxName(this.deps.sessionId);
  }

  // Stops the container within the teardown bound. A session with no container has nothing
  // running to stop. A failure throws REALM_STOPPING, and the caller leaves the session in
  // stopping.
  private async stopContainer(containerId: string | null): Promise<void> {
    if (containerId === null) {
      return;
    }
    await this.teardownCall(this.deps.exec.stop(containerId, this.sandboxName()));
  }

  // Issues the port create for a startup that has no container yet. The attempt number lets an
  // abandoned create tell that a newer create started after it (C2).
  private issueCreate(root: PinnedRoot): PendingCreate {
    this.createAttempts += 1;
    const pending: PendingCreate = {
      attempt: this.createAttempts,
      created: this.deps.exec.create({
        idempotencyKey: this.deps.sessionId,
        workspaceRoot: root.realPath,
      }),
    };
    this.pendingCreate = pending;
    return pending;
  }

  // Issues the port start for a container and tracks it until it settles (F1). The settled promise
  // never rejects, so the tracking adds no unhandled rejection.
  private issueStart(containerId: string): PendingStart {
    const started = this.deps.exec.start(containerId);
    const settled = started.then(
      () => null,
      (error: unknown) => portFailureCode(error),
    );
    const pending: PendingStart = { containerId, started, settled };
    this.pendingStarts.add(pending);
    void settled.then(() => {
      this.pendingStarts.delete(pending);
    });
    return pending;
  }

  // Takes the pending create, or returns null when another owner already took it. The create
  // that issued it takes it when the port call settles or gives up. A stop or destroy takes it
  // when it arrives while the call is pending. Exactly one owner ever holds it (C1).
  private takePendingCreate(): PendingCreate | null {
    const pending = this.pendingCreate;
    this.pendingCreate = null;
    return pending;
  }

  // Reclaims a pending create for a stop or destroy. It waits for the port call under the
  // teardown bound, then destroys the container the call produced. A call that fails produced
  // nothing. If the bound expires first, the container is left to adoptOrphan and the expiry is
  // REALM_STOPPING.
  private async reclaimPendingCreate(pending: PendingCreate): Promise<void> {
    let containerId: string | null;
    try {
      containerId = await withTimeout(
        pending.created.then(
          (created) => created.containerId,
          (error: unknown) => {
            // The stop took this create over, so it reports nothing. Its failure is kept here.
            this.orphanFailure = portFailureCode(error);
            return null;
          },
        ),
        this.teardownBound(),
        "REALM_STOPPING",
      );
    } catch (error: unknown) {
      this.adoptOrphan(pending);
      throw error;
    }
    if (containerId !== null) {
      await this.destroyUnrecorded(containerId);
    }
  }

  // Waits, within the teardown bound, for a port start that is still in flight, then stops the
  // container the start left running (F1). A start that outlives the bound is handed to the
  // background, and the expiry is REALM_STOPPING.
  private async reclaimPendingStart(start: PendingStart): Promise<void> {
    let failure: ErrorCode | null;
    try {
      failure = await withTimeout(start.settled, this.teardownBound(), "REALM_STOPPING");
    } catch (error: unknown) {
      this.adoptStart(start);
      throw error;
    }
    if (failure !== null) {
      // The stop took this start over, so it reports nothing. Its failure is kept here.
      this.orphanFailure = failure;
    }
    await this.stopStarted(start.containerId);
  }

  // Stops a container that a start left running. When the stop fails, the container is destroyed
  // instead, and the record forgets it, so no later start targets a container that is gone (F1).
  // The stop failure is recovered by that destroy. A destroy failure propagates to the caller with
  // the stop failure as its cause.
  private async stopStarted(containerId: string): Promise<void> {
    try {
      await this.teardownCall(this.deps.exec.stop(containerId, this.sandboxName()));
    } catch (stopError: unknown) {
      try {
        await this.teardownCall(this.deps.exec.destroy(containerId, this.sandboxName()));
      } catch (destroyError: unknown) {
        // The fallback destroy failed too, so both errors are kept: the destroy error is thrown, and
        // the stop error is its cause.
        throw makeRealmError(portFailureCode(destroyError), portFailureCode(stopError));
      }
      this.forgetContainer(containerId);
    }
  }

  // Clears the record's containerId when it names the given container.
  private forgetContainer(containerId: string): void {
    const record = this.deps.store.load(this.deps.sessionId);
    if (record !== null && record.containerId === containerId) {
      this.deps.store.save({ ...record, containerId: null });
    }
  }

  // Hands a start that outlived the teardown bound to the background. Once it settles, its
  // container is stopped, but only while the session is still stopping. A failure is not lost:
  // the record keeps the containerId, and the next destroy retries that container (see adopt).
  private adoptStart(start: PendingStart): void {
    this.pendingStarts.delete(start);
    this.adopt(
      start.settled.then(async (failure) => {
        if (failure !== null) {
          this.orphanFailure = failure;
        }
        if (this.machine.snapshot().state === "stopping") {
          await this.stopStarted(start.containerId);
        }
      }),
    );
  }

  // Tracks background teardown work that outlived its caller. The work leaves the set when it
  // settles. A failure does not reject: it is kept in orphanFailure, so no rejection goes unhandled,
  // and destroy reports it as the cause of its own error (see destroyRecorded).
  private adopt(background: Promise<void>): void {
    const tracked: Promise<void> = background.then(
      () => {
        this.orphans.delete(tracked);
      },
      (error: unknown) => {
        this.orphans.delete(tracked);
        this.orphanFailure = error instanceof RealmError ? error.code : "REALM_STOPPING";
      },
    );
    this.orphans.add(tracked);
  }

  // Waits, within the teardown bound, for every adopted create and start that is still unresolved
  // (F2). Expiry throws REALM_STOPPING and the record is kept, so a repeated destroy waits again.
  private async settleOrphans(): Promise<void> {
    if (this.orphans.size === 0) {
      return;
    }
    await withTimeout(
      Promise.all([...this.orphans]).then(() => undefined),
      this.teardownBound(),
      "REALM_STOPPING",
    );
  }

  // Only the active and degraded states take a probe outcome or a bridge event (F4).
  private isInService(): boolean {
    const { state } = this.machine.snapshot();
    return state === "active" || state === "degraded";
  }

  // Destroys a container that no record names yet. A failed destroy keeps the id in the record
  // when the record names no container, so the next stop or destroy reaches it. The failure is
  // rethrown.
  private async destroyUnrecorded(containerId: string): Promise<void> {
    try {
      await this.teardownCall(this.deps.exec.destroy(containerId, this.sandboxName()));
    } catch (error: unknown) {
      this.recordContainerIfEmpty(containerId);
      throw error;
    }
  }

  // Hands a container that an abandoned create produces to a background destroy (C2). It is
  // destroyed once, when the port call resolves. A call that rejects produced no container, so it
  // leaves nothing to destroy, and its failure is kept as a typed code. The raw error is never kept,
  // because it may hold a secret. A create issued after this one owns the session's
  // container through the shared idempotency key, so it is left alone. A failed background destroy is
  // recorded by destroyUnrecorded and kept by adopt.
  private adoptOrphan(pending: PendingCreate): void {
    this.adopt(
      pending.created.then(
        async (created) => {
          if (pending.attempt === this.createAttempts) {
            await this.destroyUnrecorded(created.containerId);
          }
        },
        (error: unknown) => {
          throw makeRealmError(portFailureCode(error));
        },
      ),
    );
  }

  // Writes containerId into the record when the record names no container. A record that already
  // names one is kept as it is.
  private recordContainerIfEmpty(containerId: string): void {
    const record = this.deps.store.load(this.deps.sessionId);
    if (record !== null && record.containerId === null) {
      this.deps.store.save({ ...record, containerId });
    }
  }

  // The teardown bound for this controller: the injected value, or TEARDOWN_TIMEOUT_MS.
  private teardownBound(): number {
    return this.deps.teardownTimeoutMs ?? TEARDOWN_TIMEOUT_MS;
  }

  // Runs one teardown port call within the teardown bound (D-28). Expiry throws
  // REALM_STOPPING. A RealmError from the port keeps its code; any other failure is also
  // reported as REALM_STOPPING, so a raw port error never escapes teardown.
  private async teardownCall(call: Promise<void>): Promise<void> {
    try {
      await withTimeout(call, this.teardownBound(), "REALM_STOPPING");
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
    this.unpersistedFailure = null;
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
    this.unpersistedFailure = null;
  }
}
