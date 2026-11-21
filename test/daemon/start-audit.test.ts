// AC-35 (US-111): a daemon start on a fresh state directory has 0 module-load errors and a readable audit
// chain head. Importing audit/chain + audit/log at the top is itself the module-load check (a stale dist
// missing chain.js fails this file before any test runs); this test adds the stronger, non-trivial half:
// after a real hermetic startDaemon with no admissions, the audit chain head is readable and is the genesis
// head (nextSeq 1, prev = 64 zeros) for the fresh, empty audit file the start reconciled. On a broken
// audit-chain read path (readChainHead / verifyAuditFile) this test fails; on a missing chain module it
// cannot even load. Hermetic: real temporary directories, fake libpod/exec, no Podman, no session admitted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUDIT_GENESIS_PREV, readAuditHead, readChainHead, verifyAuditFile } from "../../src/audit/chain.js";
// Imported for the module-load half of AC-35: log.ts and chain.ts must both load with 0 errors.
import "../../src/audit/log.js";
import { sendRequest } from "../../src/daemon/channel.js";
import { startDaemon } from "../../src/daemon/daemon.js";
import { selectionOf } from "../../src/daemon/client.js";
import { FakeExecutionService } from "../support/fake-execution.js";

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;
const CLOCK_ISO = "2026-10-21T09:30:00.000Z";

void test("AC-35: fresh daemon start has 0 module-load errors and the genesis audit head is readable with no admissions", async (t) => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-start-audit-")));
  const workspace = join(base, "ws");
  const stateDir = join(base, "state");
  mkdirSync(workspace, { recursive: true });
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ workspaceRoots: [workspace] }));
  // A fresh chain: the session's audit file exists but holds 0 admissions (0 bytes), so its head is genesis.
  const sessionId = selectionOf(workspace).sessionId;
  const auditFile = join(stateDir, "audit", `${sessionId}.jsonl`);
  mkdirSync(join(stateDir, "audit"), { recursive: true });
  writeFileSync(auditFile, "", "utf8");
  t.after(() => { rmSync(base, { recursive: true, force: true }); });

  // The real start: single-owner bind plus startup maintenance (which reconciles the audit directory).
  // Any module-load error (ERR_MODULE_NOT_FOUND for audit/chain) rejects here and fails the test.
  const daemon = await startDaemon({
    runtimeInput: { image: IMAGE, stateDir, workspaceRoot: workspace },
    policyPath,
    exec: new FakeExecutionService(),
    clock: () => new Date(CLOCK_ISO),
    runOpenShell: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false }),
    // A libpod double whose realm listing is empty, so the startup reap removes nothing.
    libpod: {
      info: () => Promise.resolve({ rootless: true, version: "5.0.0" }),
      listContainersByLabel: () => Promise.resolve([]),
      inspectContainer: () => Promise.resolve(null),
      stopContainer: () => Promise.resolve(),
      removeContainer: () => Promise.resolve(),
    },
    probe: () => Promise.resolve({ ok: true, version: "5.0.0" }),
  });
  t.after(async () => {
    try {
      await daemon.stop();
      await daemon.done;
    } catch {
      // Already stopped, or never served.
    }
  });

  // 0 module-load errors: the daemon started and answers status over its control socket.
  const reply = await sendRequest(
    daemon.socketPath,
    { id: "ac35-status", method: "status", params: { selection: selectionOf(workspace) } },
    { timeoutMs: 5000 },
  );
  assert.equal(reply.error, undefined, "status answers with no error after the fresh start");

  // No admissions happened: the audit file is still the 0-byte genesis file the start reconciled.
  // The chain head read path (readChainHead + full verifier) is exercised on that file after the start.
  const fd = openSync(auditFile, "r");
  try {
    assert.deepEqual(readChainHead(fd), { nextSeq: 1, prevHash: AUDIT_GENESIS_PREV, needsNewline: false });
  } finally {
    closeSync(fd);
  }
  const verified = verifyAuditFile(auditFile);
  assert.equal(verified.ok, true, "the fresh audit chain verifies");
  assert.equal(verified.lines, 0);
  assert.equal(verified.chainedLines, 0);
  assert.equal(verified.head, undefined, "no chained line yet: the head is the genesis prev");
  assert.equal(verified.broken, undefined);
  // readAuditHead agrees there is no chained line to report on an empty (genesis) file.
  assert.deepEqual(readAuditHead(auditFile), { state: "none" });
});
