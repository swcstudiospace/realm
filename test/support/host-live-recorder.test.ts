// The hermetic test of the Phase 58 wire-recorder ordering fix (KIMV-02, GAP-43-03): the tee in
// test/support/host-live-session.ts must log a message BEFORE forwarding it, so a response the host
// reads and then kills the recorder (SIGKILL, as the legacy kimi client did) is still in the log.
// No host CLI, no Podman, no network beyond loopback: the only processes started are Node and the
// scripts the support module writes itself. The ordering test reads the GENERATED wire-tee.mjs: on
// the pre-fix tee it fails (the tee forwarded each direction with pipe() and logged after), and the
// SIGKILL test shows the tools/list response in the log after the host kills the recorder.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { REALM_TOOL_NAMES, readWireLog, writeFakeMcpServer, writeWireRecorder } from "./host-live-session.js";
import { boundedWait } from "./timing.js";

// A temporary directory removed when the test ends.
function tempDir(t: TestContext, prefix = "rls-recorder-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// The recorder shim in front of the fake MCP server, and the generated tee script next to it.
function recorderWithTee(t: TestContext): { readonly shim: string; readonly wireLog: string; readonly teeSource: string } {
  const dir = tempDir(t);
  const serverLog = join(dir, "server.log");
  const wireLog = join(dir, "wire.log");
  const server = writeFakeMcpServer(join(dir, "bin"), serverLog);
  const shim = writeWireRecorder(join(dir, "bin"), {
    nodePath: process.execPath,
    target: [process.execPath, server],
    logFile: wireLog,
  });
  return { shim, wireLog, teeSource: readFileSync(join(dir, "bin", "wire-tee.mjs"), "utf8") };
}

void test("the wire tee logs before forwarding in both directions (no pipe-forward, tap first)", (t) => {
  const { teeSource } = recorderWithTee(t);
  // The pre-fix tee forwarded with pipe() and logged in a data listener registered after: on the
  // client's close-after-response race the forwarded response could leave the log empty.
  assert.ok(!teeSource.includes("child.stdout.pipe(process.stdout)"), "the tee must not pipe-forward the target's stdout");
  assert.ok(!teeSource.includes("process.stdin.pipe(child.stdin)"), "the tee must not pipe-forward the host's stdin");
  // Both data handlers must log (tap) strictly before forwarding the same chunk.
  const stdoutHandler = teeSource
    .split("\n")
    .find((line) => line.includes('child.stdout.on("data"'));
  assert.ok(stdoutHandler !== undefined, "the tee must install a data handler on the target's stdout");
  assert.ok(
    stdoutHandler.includes('tap("realm-to-host")') &&
      stdoutHandler.indexOf('tap("realm-to-host")') < stdoutHandler.indexOf("process.stdout.write(chunk)"),
    "the target-to-host handler must log the chunk before writing it to the host",
  );
  const stdinHandler = teeSource.split("\n").find((line) => line.includes('process.stdin.on("data"'));
  assert.ok(stdinHandler !== undefined, "the tee must install a data handler on the host's stdin");
  assert.ok(
    stdinHandler.includes('tap("host-to-realm")') &&
      stdinHandler.indexOf('tap("host-to-realm")') < stdinHandler.indexOf("child.stdin.write(chunk)"),
    "the host-to-target handler must log the chunk before writing it to the target",
  );
  // EOF still closes the target's stdin, as pipe() did.
  assert.ok(teeSource.includes("child.stdin.end()"), "the tee must end the target's stdin at EOF");
});

void test("a tools/list response is in the wire log when the host kills the recorder right after reading it", async (t) => {
  const { shim, wireLog } = recorderWithTee(t);
  const host = spawn(shim, [], { stdio: ["pipe", "pipe", "ignore"] });
  host.stdin.on("error", () => {
    // The kill below may close the recorder's stdin first; the kill still ends the run.
  });
  const received: Buffer[] = [];
  let sawToolsList = false;
  host.stdout.on("data", (chunk: Buffer) => {
    received.push(chunk);
    const text = Buffer.concat(received).toString("utf8");
    if (text.includes('"tools"')) {
      sawToolsList = true;
      // The close-after-response race: kill the recorder the moment its response is read.
      host.kill("SIGKILL");
    }
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    host.once("error", reject);
    host.once("close", (code) => {
      resolve(code);
    });
  });
  host.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  try {
    await boundedWait(closed, "the killed recorder run", 30_000);
  } finally {
    host.kill("SIGKILL");
  }
  assert.ok(sawToolsList, "the host read the tools/list response the recorder forwarded");
  const events = readWireLog(wireLog);
  const response = events.find((event) => event.dir === "realm-to-host" && event.kind === "response");
  assert.ok(response !== undefined, "the response the host read is in the wire log, not unseen");
  assert.deepEqual(response.toolNames, [...REALM_TOOL_NAMES]);
});
