// Process-level exit tests for the realm CLI entry (src/cli/main.ts). Each test spawns the compiled entry in a fresh Node
// process, so it observes what a shell observes: the exit code, the complete output, and whether the process ends at all.
// The child is started with spawn, never spawnSync: the control socket is served by this test process, whose event loop must
// keep running while the child waits on it.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHECKPOINT_USAGE } from "../../src/cli/checkpoint.js";
import { ERROR_CATALOGUE } from "../../src/core/errors.js";
import { INITIAL_REASON } from "../../src/core/state-machine.js";
import { STATUS_LABELS } from "../../src/core/status.js";
import { decodeRequest, encodeReply, ensureSocketDir, type ControlRequest } from "../../src/daemon/channel.js";
import { selectionOf, type DaemonStatus } from "../../src/daemon/client.js";
import { bindRoot } from "../../src/fs/root.js";
import { checkpointDirOf, controlSocketPath } from "../../src/session/paths.js";
import { writeWorkspaceEntry } from "../../src/session/workspace-registry.js";
import type { StatusValue } from "../../src/tools/dispatch.js";
import { boundedWait, testTimeout } from "../support/timing.js";

// This file runs from dist/test/cli, so three levels up is the package root.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENTRY = join(ROOT, "dist", "src", "cli", "main.js");

const TS = "2026-10-22T00:00:00.000Z";
const CHECKPOINT_ID = "before-edit";
// Every checkpoint refusal exits 1 (refusal() in src/cli/checkpoint.ts), TOOL_TIMEOUT included.
const REFUSED_EXIT = 1;
const QUICK_CHILD_BOUND_MS = 30_000;

const STATUS_VALUE: StatusValue = {
  snapshot: { state: "unbound", reason: INITIAL_REASON, lastTransitionAt: TS },
  display: { label: STATUS_LABELS.disconnected, degraded: false, reason: "no workspace", lastTransitionAt: TS },
};

interface Layout {
  readonly workspace: string;
  readonly stateDir: string;
  readonly sessionId: string;
  readonly configHome: string;
}

// A workspace with one file, a state root outside it, and the runtime config that names the state root. All of it lives under
// one scratch directory, removed when the test ends.
function layoutOf(t: TestContext): Layout {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "realm-cli-exit-")));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const workspace = join(root, "workspace");
  const stateDir = join(root, "state");
  const configHome = join(root, "config");
  mkdirSync(workspace);
  mkdirSync(join(configHome, "realm"), { recursive: true });
  writeFileSync(join(workspace, "a.txt"), "alpha\n");
  writeFileSync(
    join(configHome, "realm", "config.json"),
    JSON.stringify({
      image: `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`,
      stateDir,
      workspaceRoot: workspace,
    }),
  );
  return { workspace, stateDir, sessionId: selectionOf(workspace).sessionId, configHome };
}

// The reply for one control request: status answers as an unbound daemon does for the session; any other method is refused.
function replyTo(request: ControlRequest, sessionId: string): string {
  if (request.method !== "status") {
    return encodeReply({ id: request.id, error: { code: "REALM_NOT_ACTIVE" } });
  }
  const status: DaemonStatus = { ...STATUS_VALUE, mode: "advisory", sessionId };
  return encodeReply({ id: request.id, result: status });
}

// Serves the control socket of stateDir in this process until the test ends.
async function serveStatus(t: TestContext, stateDir: string, sessionId: string): Promise<void> {
  ensureSocketDir(stateDir);
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    let text = "";
    socket.on("data", (chunk) => {
      text += String(chunk);
      const end = text.indexOf("\n");
      if (end === -1) {
        return;
      }
      socket.end(replyTo(decodeRequest(text.slice(0, end)), sessionId));
    });
  });
  t.after(() => {
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(controlSocketPath(stateDir), () => {
      resolve();
    });
  });
}

interface ChildRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

// Runs the built entry with args. Resolves once the process has exited and both of its output streams have closed, so the
// output is whole. A child still running at the bound is killed, and the call rejects.
async function runEntry(args: readonly string[], configHome: string, bound: number): Promise<ChildRun> {
  const child = spawn(process.execPath, [ENTRY, ...args], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: configHome, XDG_CONFIG_HOME: configHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<ChildRun>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
  try {
    return await boundedWait(closed, `realm ${args.join(" ")}`, bound);
  } catch (error: unknown) {
    child.kill("SIGKILL");
    throw error;
  }
}

void test("RES-04: a checkpoint restore whose manifest.json is a FIFO is refused as a non-regular file within 30 seconds", testTimeout(QUICK_CHILD_BOUND_MS), async (t) => {
  const fx = layoutOf(t);
  await serveStatus(t, fx.stateDir, fx.sessionId);
  writeWorkspaceEntry(fx.stateDir, bindRoot(fx.workspace), fx.sessionId);
  // A FIFO where the checkpoint's manifest.json belongs. The restore reads that file before it takes the session lock.
  // A FIFO is not a regular file, so the read is refused at once, without waiting for a writer.
  const checkpoint = checkpointDirOf(fx.stateDir, fx.sessionId, CHECKPOINT_ID);
  mkdirSync(checkpoint, { recursive: true });
  execFileSync("mkfifo", [join(checkpoint, "manifest.json")]);
  const run = await runEntry(
    ["checkpoint", "restore", "--workspace", fx.workspace, "--id", CHECKPOINT_ID],
    fx.configHome,
    QUICK_CHILD_BOUND_MS,
  );
  assert.equal(run.signal, null, "the child was killed instead of exiting on its own");
  assert.equal(run.code, REFUSED_EXIT);
  assert.equal(run.stdout, "POLICY_DENIED\n");
  assert.equal(run.stderr, `${ERROR_CATALOGUE.POLICY_DENIED.reason}\n`);
});

void test("RES-04: a checkpoint create that finishes exits at once with exit 0 and its complete JSON line", testTimeout(QUICK_CHILD_BOUND_MS), async (t) => {
  const fx = layoutOf(t);
  await serveStatus(t, fx.stateDir, fx.sessionId);
  writeWorkspaceEntry(fx.stateDir, bindRoot(fx.workspace), fx.sessionId);
  const run = await runEntry(
    ["checkpoint", "create", "--workspace", fx.workspace, "--id", CHECKPOINT_ID],
    fx.configHome,
    QUICK_CHILD_BOUND_MS,
  );
  assert.equal(run.signal, null, "the child was killed instead of exiting on its own");
  assert.equal(run.code, 0, run.stderr);
  assert.equal(run.stderr, "");
  assert.ok(run.stdout.endsWith("\n"), "the success line is terminated");
  assert.deepEqual(JSON.parse(run.stdout), { command: "create", checkpointId: CHECKPOINT_ID, entries: 1 });
});

void test("a usage refusal writes its full line to stderr and exits 2 at once", testTimeout(QUICK_CHILD_BOUND_MS), async (t) => {
  const fx = layoutOf(t);
  const run = await runEntry(["checkpoint"], fx.configHome, QUICK_CHILD_BOUND_MS);
  assert.equal(run.signal, null, "the child was killed instead of exiting on its own");
  assert.equal(run.code, 2);
  assert.equal(run.stdout, "");
  assert.equal(run.stderr, `${CHECKPOINT_USAGE}\n`);
});
