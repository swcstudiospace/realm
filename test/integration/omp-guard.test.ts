// The write-guard suite (HARN-02; decisions D-1201, D-1202, D-1203 of phase 12).
//
// Four cases, each with its own temporary profile, in-process daemon and Omp process, against the built Realm plugin
// (dist/src/omp/extension.js), not the spike extension. A scripted provider emits one call, then a final text reply. The
// policy mode is written into the profile and into the daemon's policy file; nothing here relies on the default.
//
//   C1 advisory, realm down: the Realm write is refused with REALM_NOT_ACTIVE and the file is absent. The Realm write goes to
//      the daemon, so with the daemon down the advisory notice does not apply to it.
//   C2 fail-closed, realm down: the write is blocked with REALM_NOT_ACTIVE, the file is absent, and the provider's next
//      request carries that error.
//   C3 realm active: the write proceeds on the host. The offered tool list is recorded, not asserted; Phase 16 owns removal.
//   C4 advisory, realm down: the built-in edit is not refused by the guard. The advisory notice shows and the seeded file
//      is removed on the host.
//
// The plugin reads the mode from the daemon's status, not from the policy file. C2 and C4 therefore attach while the daemon
// is up (so the explicit mode is known) and only then take the realm down, which is what makes the status unreadable. The
// daemon is listening before Omp is spawned, so ensureDaemon never starts a detached daemon (D-1203).
//
// Gate. The file skips, naming the first missing prerequisite, unless REALM_LIVE_OMP=1 and the Omp executable, its version
// and the built extension are present (ompSkipReason). A test never sets the opt-in. Waits resolve from frames; the bounds
// of D-1203 are failure bounds only.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  closeWithEvidence,
  collectOmpGateInputs,
  createCleanups,
  EXTENSION_PATH,
  OMP_PROMPT_TIMEOUT_MS,
  OMP_READY_TIMEOUT_MS,
  OMP_SCENARIO_TIMEOUT_MS,
  ompBinary,
  ompSkipReason,
  parseOmpVersion,
} from "../support/omp-live.js";
import { createOmpProfile, type OmpProfile, type ProfilePolicyMode } from "../support/omp-profile.js";
import { startOmp, type OmpSession, type PromptOutcome, type ToolEnd } from "../support/omp-rpc.js";
import { startRealmDaemon } from "../support/realm-daemon-fixture.js";
import { ScriptedProvider, type RecordedRequest } from "../support/scripted-provider.js";

const ADVISORY_NOTICE = "realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy";
const EVIDENCE_DIR_VARIABLE = "REALM_OMP_EVIDENCE_DIR";
const CLOSE_OPTIONS = { graceMs: 40_000, termMs: 20_000, killMs: 20_000 } as const;

const platform = process.platform;
const OMP_BIN = ompBinary(process.env);
const baseInputs = await collectOmpGateInputs(process.env, { platform, trace: false });
const skip: string | false = ompSkipReason(baseInputs) ?? false;
const ompVersionText = baseInputs.version.kind === "output" ? (parseOmpVersion(baseInputs.version.stdout)?.text ?? "unknown") : "unknown";

interface GuardCase {
  readonly name: string;
  readonly mode: ProfilePolicyMode;
  // down: attach, then remove the realm, then make the call. active: the daemon stays up for the call.
  readonly realm: "down" | "active";
  // The tool the model calls: the Realm write, or the built-in edit.
  readonly tool: "write" | "edit";
  readonly relativePath: string;
  // File content written before the prompt, so the built-in edit has a file to change.
  readonly seed?: string;
}

async function runGuard(
  t: TestContext,
  spec: GuardCase,
): Promise<{ omp: OmpSession; profile: OmpProfile; outcome: PromptOutcome; requests: readonly RecordedRequest[] }> {
  t.diagnostic(`omp/${ompVersionText}`);
  const cleanups = createCleanups();
  t.after(() => cleanups.run());
  const provider = new ScriptedProvider();
  provider.onTurn((turn) => {
    if (turn.lastRole === "tool") {
      return { text: "done" };
    }
    return { call: callOf(spec) };
  });
  const { port } = await provider.start();
  cleanups.add(() => provider.stop());
  const pathValue = process.env["PATH"];
  const profile = createOmpProfile({
    providerPort: port,
    realm: { mode: spec.mode },
    ...(pathValue === undefined ? {} : { path: pathValue }),
  });
  cleanups.add(() => {
    profile.dispose();
  });
  if (spec.seed !== undefined) {
    writeFileSync(join(profile.workspace, spec.relativePath), spec.seed);
  }
  const daemon = await startRealmDaemon({ stateDir: profile.stateDir, workspace: profile.workspace, mode: spec.mode });
  let realmUp = true;
  cleanups.add(async () => {
    if (realmUp) {
      realmUp = false;
      await daemon.down();
    }
  });
  const tmpDir = join(profile.root, "tmp");
  mkdirSync(tmpDir);
  const omp = startOmp({
    bin: OMP_BIN,
    env: { ...profile.env, TMPDIR: tmpDir },
    cwd: profile.workspace,
    extensionPath: EXTENSION_PATH,
  });
  cleanups.add(() =>
    closeWithEvidence({
      evidenceDir: process.env[EVIDENCE_DIR_VARIABLE],
      evidence: {
        [`${spec.name}.frames.jsonl`]: () => omp.frames.map((frame) => JSON.stringify(frame)).join("\n"),
        [`${spec.name}.requests.json`]: () => JSON.stringify(provider.requests, null, 1),
      },
      report: (problem) => {
        t.diagnostic(problem);
      },
      close: () => omp.close(CLOSE_OPTIONS),
    }),
  );
  await omp.ready(OMP_READY_TIMEOUT_MS);
  await omp.waitFor(
    (session) => session.status()?.includes("realm active") === true,
    OMP_READY_TIMEOUT_MS,
    "the plugin's realm active status",
  );
  if (spec.realm === "down") {
    realmUp = false;
    await daemon.down();
  }
  const outcome = await omp.prompt(`${spec.tool} ${spec.relativePath}`, OMP_PROMPT_TIMEOUT_MS);
  return { omp, profile, outcome, requests: provider.requests };
}

// The call the scripted provider makes: the Realm write of the case's content, or the built-in edit that removes the seeded file.
function callOf(spec: GuardCase): { name: string; args: Record<string, unknown> } {
  if (spec.tool === "write") {
    return { name: "write", args: { path: spec.relativePath, content: spec.name } };
  }
  return { name: "edit", args: { input: `[${spec.relativePath}#0000]\nREM` } };
}

function toolEndOf(outcome: PromptOutcome, tool: string): ToolEnd {
  const ends = outcome.toolEnds.filter((end) => end.toolName === tool);
  assert.equal(ends.length, 1, `${tool}: expected one tool_execution_end, got ${JSON.stringify(outcome.toolEnds.map((end) => end.toolName))}`);
  const end = ends[0];
  assert.ok(end !== undefined);
  return end;
}

void test(
  "C1: advisory with the realm down refuses the Realm write with REALM_NOT_ACTIVE and the file is absent",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c1", mode: "advisory", realm: "down", tool: "write", relativePath: "c1.txt" };
    const { omp, profile, outcome } = await runGuard(t, spec);
    assert.equal(omp.notices().includes(ADVISORY_NOTICE), false, "the Realm write is not the guard's advisory host path");
    const end = toolEndOf(outcome, "write");
    assert.equal(end.isError, true);
    assert.match(end.text, /REALM_NOT_ACTIVE/);
    assert.equal(existsSync(join(profile.workspace, spec.relativePath)), false);
  },
);

void test(
  "C2: fail-closed with the realm down blocks the write with REALM_NOT_ACTIVE and the next request carries the error",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c2", mode: "fail-closed", realm: "down", tool: "write", relativePath: "c2.txt" };
    const { omp, profile, outcome, requests } = await runGuard(t, spec);
    assert.equal(omp.notices().includes(ADVISORY_NOTICE), false);
    const end = toolEndOf(outcome, "write");
    assert.equal(end.isError, true);
    assert.match(end.text, /REALM_NOT_ACTIVE/);
    assert.equal(existsSync(join(profile.workspace, spec.relativePath)), false);
    const carried = requests.find((request) => request.toolResultText?.includes("REALM_NOT_ACTIVE") === true);
    assert.ok(carried !== undefined, "the provider's next request did not carry REALM_NOT_ACTIVE");
  },
);

void test(
  "C3: with the realm active the write proceeds on the host; the offered tool list is the Phase 16 baseline",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c3", mode: "fail-closed", realm: "active", tool: "write", relativePath: "c3.txt" };
    const { profile, outcome, requests } = await runGuard(t, spec);
    const offered = requests[0]?.toolsOffered ?? [];
    t.diagnostic(`offered tools: ${[...offered].sort().join(", ")}`);
    const end = toolEndOf(outcome, "write");
    assert.equal(end.isError, false, end.text);
    assert.equal(readFileSync(join(profile.workspace, spec.relativePath), "utf8"), spec.name);
  },
);

void test(
  "C4: advisory with the realm down leaves the built-in edit to the host: the advisory notice shows and the file is removed",
  { skip, timeout: OMP_SCENARIO_TIMEOUT_MS },
  async (t) => {
    const spec: GuardCase = { name: "c4", mode: "advisory", realm: "down", tool: "edit", relativePath: "c4.txt", seed: "c4\n" };
    const { omp, profile, outcome } = await runGuard(t, spec);
    assert.deepEqual(omp.notices(), [ADVISORY_NOTICE]);
    const end = toolEndOf(outcome, "edit");
    t.diagnostic(`edit result: ${end.text}`);
    assert.equal(existsSync(join(profile.workspace, spec.relativePath)), false, end.text);
  },
);
