import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionRecord } from "../../src/contract/validate.js";
import { makeRealmError, RealmError, type ErrorCode } from "../../src/core/errors.js";
import {
  REAP_SWEEP_TIMEOUT_MS,
  reapStartupSelective,
  type InspectedCandidate,
  type ReapCandidate,
  type ReapVerdict,
  type SelectiveReapDeps,
} from "../../src/session/reap.js";
import { SessionStore } from "../../src/session/store.js";

const REALM_ID = "7b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";
const REALM_LABELS = { "openshell.managed": "true" };

interface Fixture {
  readonly stateDir: string;
  readonly store: SessionStore;
}

function startFixture(t: TestContext): Promise<Fixture> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-reap-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const stateDir = join(base, "state");
  return Promise.resolve({ stateDir, store: new SessionStore(stateDir) });
}

function recordFor(stateDir: string, sessionId: string, containerId: string | null): SessionRecord {
  return {
    realmId: REALM_ID,
    sessionId,
    workspaceRoot: "/srv/workspace",
    state: "connecting",
    controlSocketPath: join(stateDir, "run", "control.sock"),
    containerId,
  };
}

async function assertCode(work: Promise<unknown>, code: ErrorCode): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RealmError && error.code === code);
}

// ---- Selective reap (Phase 19, D19-1) -----------------------------------------------------------------------------------

// A candidate whose inspection succeeded. The default inspect carries nothing the tests judge; the verdict is injected.
function candidate(containerId: string): ReapCandidate {
  return { containerId, labels: REALM_LABELS, inspection: { ok: true, inspect: {} } };
}

// A candidate whose inspection failed. The reap must reject before it removes anything.
function uninspectable(containerId: string): ReapCandidate {
  return { containerId, labels: REALM_LABELS, inspection: { ok: false, error: makeRealmError("PODMAN_MACHINE_DOWN") } };
}

// The store with each delete logged, so a test can order deletions against removals and the proof.
function loggedStore(store: SessionStore, events: string[]): Pick<SessionStore, "list" | "load" | "delete"> {
  return {
    list: () => store.list(),
    load: (sessionId) => store.load(sessionId),
    delete: (sessionId) => {
      events.push(`delete:${sessionId}`);
      store.delete(sessionId);
    },
  };
}

interface SelectiveOptions {
  readonly store: SessionStore;
  readonly events: string[];
  readonly candidates: readonly ReapCandidate[];
  // Container id to the property its verdict refuses it for. Every other candidate is adopted.
  readonly refuse?: Readonly<Record<string, string>>;
  // Removals that succeed but leave the container listed, so the proof does not confirm them.
  readonly stubborn?: readonly string[];
  // Removals that reject and leave the container listed.
  readonly failRemoval?: readonly string[];
}

// Selective dependencies over a container set the fake engine keeps: a removal drops the id from the listing unless it is
// stubborn, and the proof is the listing after every removal.
function selectiveDeps(options: SelectiveOptions): SelectiveReapDeps {
  const present = new Set(options.candidates.map((entry) => entry.containerId));
  const refuse = options.refuse ?? {};
  const stubborn = options.stubborn ?? [];
  const failRemoval = options.failRemoval ?? [];
  return {
    store: loggedStore(options.store, options.events),
    listCandidates: () => Promise.resolve(options.candidates),
    verdict: (_record, entry: InspectedCandidate): ReapVerdict => {
      const property = refuse[entry.containerId];
      return property === undefined ? { ok: true } : { ok: false, property, causeCode: "OPENSHELL_START_FAILED" };
    },
    remove: (containerId) => {
      options.events.push(`remove:${containerId}`);
      if (failRemoval.includes(containerId)) {
        return Promise.reject(makeRealmError("PODMAN_MACHINE_DOWN"));
      }
      if (!stubborn.includes(containerId)) {
        present.delete(containerId);
      }
      return Promise.resolve();
    },
    listSurvivors: () => {
      options.events.push("proof");
      return Promise.resolve([...present]);
    },
  };
}

// Lets every pending promise continue. Only setTimeout is mocked in these tests, so setImmediate runs for real.
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

void test("D19-1: a conforming container named by its record is adopted, its record is kept, and nothing is removed", async (t) => {
  const { stateDir, store } = await startFixture(t);
  store.save(recordFor(stateDir, "session-alpha", "c-adopt"));
  const events: string[] = [];
  const result = await reapStartupSelective(selectiveDeps({ store, events, candidates: [candidate("c-adopt")] }));
  assert.deepEqual(result, {
    adopted: [{ sessionId: "session-alpha", containerId: "c-adopt" }],
    removed: [],
    deleted: [],
    counts: { adopted: 1, removed: 0, deleted: 0 },
  });
  assert.deepEqual(store.list(), ["session-alpha"]);
  assert.deepEqual(events, []);
});

void test("D19-1: a container that fails its verdict is removed with the failing property, after its removal is proven, and its record is deleted", async (t) => {
  for (const property of ["container-id", "running", "cap-drop"]) {
    const { stateDir, store } = await startFixture(t);
    store.save(recordFor(stateDir, "session-alpha", "c-bad"));
    const events: string[] = [];
    const result = await reapStartupSelective(
      selectiveDeps({ store, events, candidates: [candidate("c-bad")], refuse: { "c-bad": property } }),
    );
    assert.deepEqual(result.adopted, []);
    assert.deepEqual(result.removed, [{ containerId: "c-bad", cause: property }]);
    assert.deepEqual(result.deleted, [{ sessionId: "session-alpha", cause: "verdict-failed" }]);
    assert.deepEqual(events, ["remove:c-bad", "proof", "delete:session-alpha"]);
    assert.deepEqual(store.list(), []);
  }
});

void test("D19-1: a removal the proof still lists rejects REALM_STOPPING and deletes no record", async (t) => {
  const { stateDir, store } = await startFixture(t);
  store.save(recordFor(stateDir, "session-alpha", "c-stuck"));
  const events: string[] = [];
  await assertCode(
    reapStartupSelective(
      selectiveDeps({ store, events, candidates: [candidate("c-stuck")], refuse: { "c-stuck": "running" }, stubborn: ["c-stuck"] }),
    ),
    "REALM_STOPPING",
  );
  assert.deepEqual(store.list(), ["session-alpha"]);
  assert.ok(!events.some((event) => event.startsWith("delete:")), "no record is deleted when the reap rejects");
});

void test("D19-1: a removal that rejects and leaves its container listed rejects REALM_STOPPING, and an adopted record is kept", async (t) => {
  const { stateDir, store } = await startFixture(t);
  store.save(recordFor(stateDir, "session-kept", "c-kept"));
  const events: string[] = [];
  await assertCode(
    reapStartupSelective(selectiveDeps({ store, events, candidates: [candidate("c-kept"), candidate("c-broken")], failRemoval: ["c-broken"] })),
    "REALM_STOPPING",
  );
  assert.deepEqual(store.list(), ["session-kept"]);
  assert.ok(!events.some((event) => event.startsWith("delete:")), "no record is deleted when the reap rejects");
});

void test("D19-1: an inspection failure rejects the reap before any container is removed or any record deleted", async (t) => {
  const { stateDir, store } = await startFixture(t);
  store.save(recordFor(stateDir, "session-alpha", "c-named"));
  const events: string[] = [];
  await assertCode(
    reapStartupSelective(
      selectiveDeps({
        store,
        events,
        candidates: [candidate("c-named"), uninspectable("c-unknown")],
        refuse: { "c-named": "running" },
      }),
    ),
    "REALM_STOPPING",
  );
  assert.deepEqual(events, [], "nothing is removed, proven or deleted");
  assert.deepEqual(store.list(), ["session-alpha"]);
});

void test("D19-1: a container with no record is removed with cause no-record, and its removal is proven", async (t) => {
  const { store } = await startFixture(t);
  const events: string[] = [];
  const result = await reapStartupSelective(selectiveDeps({ store, events, candidates: [candidate("c-orphan")] }));
  assert.deepEqual(result.removed, [{ containerId: "c-orphan", cause: "no-record" }]);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(events, ["remove:c-orphan", "proof"]);
});

void test("D19-1: a record whose container is not adopted is deleted only after every removal is proven", async (t) => {
  const { stateDir, store } = await startFixture(t);
  // The record names c-old, which no candidate carries. The live container c-new has no record, so the reap removes it.
  store.save(recordFor(stateDir, "session-moved", "c-old"));
  const events: string[] = [];
  const result = await reapStartupSelective(selectiveDeps({ store, events, candidates: [candidate("c-new")] }));
  assert.deepEqual(result.removed, [{ containerId: "c-new", cause: "no-record" }]);
  assert.deepEqual(result.deleted, [{ sessionId: "session-moved", cause: "no-container" }]);
  assert.deepEqual(events, ["remove:c-new", "proof", "delete:session-moved"]);
  assert.deepEqual(store.list(), []);
});

void test("D19-1: a sweep that misses its bound rejects with PODMAN_MACHINE_DOWN, and its late result starts no removal and deletes no record", async (t) => {
  const { stateDir, store } = await startFixture(t);
  store.save(recordFor(stateDir, "session-late", "c-late"));
  const events: string[] = [];
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => {
    t.mock.timers.reset();
  });
  let releaseListing: () => void = () => undefined;
  const listing = new Promise<void>((resolve) => {
    releaseListing = resolve;
  });
  const deps: SelectiveReapDeps = {
    ...selectiveDeps({ store, events, candidates: [candidate("c-late")], refuse: { "c-late": "running" } }),
    listCandidates: async () => {
      await listing;
      return [candidate("c-late")];
    },
  };
  const reaping = reapStartupSelective(deps);
  const rejected = assert.rejects(reaping, (error: unknown) => error instanceof RealmError && error.code === "PODMAN_MACHINE_DOWN");
  t.mock.timers.tick(REAP_SWEEP_TIMEOUT_MS);
  await rejected;
  releaseListing();
  await flush();
  assert.deepEqual(events, [], "the late sweep starts no removal, proof or deletion");
  assert.deepEqual(store.list(), ["session-late"]);
});

void test("D19-1: the reap settles only after every removal and the removal proof have finished", async (t) => {
  const { stateDir, store } = await startFixture(t);
  store.save(recordFor(stateDir, "session-slow", "c-slow"));
  const events: string[] = [];
  let finishRemoval: () => void = () => undefined;
  const removalDone = new Promise<void>((resolve) => {
    finishRemoval = resolve;
  });
  let settled = false;
  const outcome = reapStartupSelective({
    store: loggedStore(store, events),
    listCandidates: () => Promise.resolve([candidate("c-slow")]),
    verdict: (): ReapVerdict => ({ ok: false, property: "running", causeCode: "OPENSHELL_START_FAILED" }),
    remove: async (containerId) => {
      events.push(`remove:${containerId}`);
      await removalDone;
    },
    listSurvivors: () => {
      events.push("proof");
      return Promise.resolve([]);
    },
  }).then((result) => {
    settled = true;
    return result;
  });
  await flush();
  assert.equal(settled, false, "the reap does not settle while the removal is pending");
  assert.deepEqual(events, ["remove:c-slow"]);
  finishRemoval();
  const result = await outcome;
  assert.deepEqual(result.removed, [{ containerId: "c-slow", cause: "running" }]);
  assert.deepEqual(events, ["remove:c-slow", "proof", "delete:session-slow"]);
  assert.deepEqual(store.list(), []);
});
