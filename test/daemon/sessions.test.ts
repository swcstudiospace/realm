// resolveSelection refusal causes (display-only, fail-closed). Each attach refusal
// keeps code POLICY_DENIED at the same throw site; the cause is a catalogue code only,
// never a path. The ceiling refusal is a PATH_ESCAPE; the admitted-session identity
// mismatch names SANDBOX_NAME_IN_USE because a session id is the sandbox-name
// derivation of its workspace (src/session/paths.ts) and the daemon already refuses
// the analogous recorded/registered identity mismatch with SANDBOX_NAME_IN_USE
// (admitUp collision check in src/daemon/daemon.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Policy } from "../../src/contract/validate.js";
import { RealmError } from "../../src/core/errors.js";
import { bindRoot } from "../../src/fs/root.js";
import { resolveSelection, SessionRegistry, type SessionEntry } from "../../src/daemon/sessions.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";

function policyOf(base: string): Policy {
  return {
    mode: "advisory",
    workspaceRoots: [base],
    credentialAllow: [],
    egressAllow: [],
    shellEnabled: false,
    startupBudgetMs: 1000,
    toolQueueMs: 1000,
  };
}

void test("resolveSelection refuses a workspace outside the ceiling with POLICY_DENIED caused by PATH_ESCAPE", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "sess-base-")));
  const ws = join(base, "ws");
  const sibling = join(base, "sibling");
  mkdirSync(ws);
  mkdirSync(sibling);
  const ceiling = bindRoot(ws);
  const selection = { workspaceRoot: sibling, sessionId: sessionIdOfWorkspace(sibling) };
  assert.throws(
    () => resolveSelection({ selection, policy: policyOf(base), ceiling, registry: new SessionRegistry() }),
    (error: unknown) =>
      error instanceof RealmError && error.code === "POLICY_DENIED" && error.causeCode === "PATH_ESCAPE",
    "the ceiling refusal must carry cause PATH_ESCAPE so Omp paints POLICY_DENIED (cause: PATH_ESCAPE)",
  );
});

void test("resolveSelection refuses an admitted session whose pinned workspace derives to another id with POLICY_DENIED caused by SANDBOX_NAME_IN_USE", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "sess-pin-")));
  const ws = join(base, "ws");
  mkdirSync(ws);
  const pinned = bindRoot(ws);
  const otherId = "p000000000000";
  assert.notEqual(sessionIdOfWorkspace(pinned.realPath), otherId);
  const registry = new SessionRegistry();
  const entry = { sessionId: otherId, pinned } as SessionEntry;
  registry.set(otherId, entry);
  const selection = { workspaceRoot: pinned.realPath, sessionId: otherId };
  assert.throws(
    () => resolveSelection({ selection, policy: policyOf(base), ceiling: pinned, registry }),
    (error: unknown) =>
      error instanceof RealmError &&
      error.code === "POLICY_DENIED" &&
      error.causeCode === "SANDBOX_NAME_IN_USE",
    "the renamed/swapped-pin identity refusal must carry cause SANDBOX_NAME_IN_USE, the catalogue identity-collision code",
  );
});
