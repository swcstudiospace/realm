// TOOL-05 ACP stdio entry (G-03). runAcpOverStdio drives the existing adapter over in-memory stdio
// streams. The dispatcher is a stub that rejects with the RealmError a daemon client raises: the in-process
// ToolDispatcher returns refusals as outcomes, so only a client boundary throws. No process starts.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PassThrough, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { ACP_PROTOCOL_VERSION, REALM_TOOL_METHOD } from "../../src/acp/agent.js";
import { runAcpOverStdio } from "../../src/acp/stdio.js";
import { ERROR_CATALOGUE, makeRealmError } from "../../src/core/errors.js";
import type { ToolDispatcher } from "../../src/tools/dispatch.js";

// The version the manifest declares, read here independently of the code under test (the release job rewrites it).
function manifestVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync("package.json", "utf8"));
  assert.ok(typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string");
  return manifest.version;
}

async function runOverStdio(
  t: TestContext,
  dispatcher: Pick<ToolDispatcher, "call">,
  requests: readonly unknown[],
): Promise<Record<string, unknown>[]> {
  // Diagnostics go to process.stderr; capture them so the run stays quiet.
  t.mock.method(process.stderr, "write", (): boolean => true);
  const stdin = new PassThrough();
  let text = "";
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      text += String(chunk);
      callback();
    },
  });
  for (const request of requests) {
    stdin.write(`${JSON.stringify(request)}\n`);
  }
  stdin.end();
  // The promise resolves only when stdin has ended and every request has been answered.
  await runAcpOverStdio({ dispatcher, stdin, stdout });
  stdout.end();
  await finished(stdout);
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

void test("TOOL-05 G-03: runAcpOverStdio answers initialize, then a _realm/tool call that fails with a RealmError showing its code",
{ timeout: 10_000 },
async (t) => {
  const thrown = makeRealmError("OPENSHELL_START_FAILED", "PODMAN_MACHINE_DOWN");
  const dispatcher: Pick<ToolDispatcher, "call"> = { call: () => Promise.reject(thrown) };
  const replies = await runOverStdio(t, dispatcher, [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: ACP_PROTOCOL_VERSION, clientInfo: { name: "probe", version: "0" } },
    },
    { jsonrpc: "2.0", id: 2, method: REALM_TOOL_METHOD, params: { tool: { exec: { argv: ["true"] } } } },
  ]);
  assert.equal(replies.length, 2, "one reply line per request line");
  assert.deepEqual(replies[0], {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: ACP_PROTOCOL_VERSION,
      agentCapabilities: { _meta: { "realm/tool": true } },
      agentInfo: { name: "realm", version: manifestVersion() },
    },
  });
  const entry = ERROR_CATALOGUE["OPENSHELL_START_FAILED"];
  assert.deepEqual(replies[1], {
    jsonrpc: "2.0",
    id: 2,
    error: {
      code: -32603,
      message: `OPENSHELL_START_FAILED: ${entry.reason}`,
      data: { code: "OPENSHELL_START_FAILED", retryable: entry.retryable, causeCode: "PODMAN_MACHINE_DOWN" },
    },
  });
},);
