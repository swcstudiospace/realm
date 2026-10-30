// Hermetic tests for the pieces of the Omp live harness that need no Omp, strace or Podman: the skip-reason selection and the
// version handling (omp-live.ts), the scripted provider's protocol exercised with a plain fetch client (scripted-provider.ts), the
// profile files and their modes (omp-profile.ts), and the JSONL framing and the session's frame handling against a tiny fake child
// process and a real spawned script (omp-rpc.ts). This file always runs. The live scenarios are in omp-guard.test.ts and run only
// when their gate opens.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { loadPolicyFile } from "../../src/core/policy.js";
import { loadRuntimeConfig } from "../../src/runtime/config.js";
import { readHostRuntime } from "../../src/runtime/host-paths.js";
import {
  EXTENSION_PATH,
  LIVE_OMP_VARIABLE,
  MIN_OMP_VERSION,
  OMP_BIN_VARIABLE,
  OMP_NET_TRACE_VARIABLE,
  OMP_PROMPT_TIMEOUT_MS,
  OMP_READY_TIMEOUT_MS,
  OMP_SCENARIO_TIMEOUT_MS,
  OMP_VERSION_PROBE_TIMEOUT_MS,
  closeWithEvidence,
  collectOmpGateInputs,
  compareOmpVersions,
  createCleanups,
  ompBinary,
  ompSkipReason,
  ompVersion,
  ompVersionOnce,
  parseOmpVersion,
  probeStrace,
  resolveExtensionPath,
  within,
  writeEvidence,
  type CommandRunner,
  type OmpGateInputs,
  type OmpVersion,
  type StraceProbe,
} from "../support/omp-live.js";
import { PROFILE_IMAGE, createOmpProfile, modelsYaml } from "../support/omp-profile.js";
import { pollUntil, scaledMs } from "../support/timing.js";
import {
  JsonlFramer,
  OmpSession,
  ompArgs,
  ompCommand,
  scriptedTurnProblem,
  startOmp,
  summariseFrames,
  toolEndOf,
  toolStartOf,
  turnFailures,
  type OmpChild,
  type OmpExit,
  type OmpFrame,
} from "../support/omp-rpc.js";
import {
  ScriptedProvider,
  completionBody,
  sseBody,
  streamChunks,
  textOfContent,
  type Envelope,
  type TurnPlan,
} from "../support/scripted-provider.js";

// A failure bound for awaits in this file. It never sets the pace of a passing test.
const BOUND_MS = 10_000;

// ---- ompSkipReason -------------------------------------------------------------------------------------------------------------

const EXTENSION = "dist/src/omp/extension.js";

function gate(overrides: Partial<OmpGateInputs> = {}): OmpGateInputs {
  return {
    env: { [LIVE_OMP_VARIABLE]: "1", PATH: "/bin" },
    platform: "linux",
    onPath: () => true,
    exists: () => true,
    version: { kind: "output", stdout: "omp/18.12.6\n" },
    extensionPath: EXTENSION,
    ...overrides,
  };
}

const TRACED_ENV = { [LIVE_OMP_VARIABLE]: "1", [OMP_NET_TRACE_VARIABLE]: "1" };

void test("ompSkipReason is undefined when every prerequisite holds, and the trace is not asked about", () => {
  assert.equal(ompSkipReason(gate()), undefined);
});

void test("ompSkipReason names the opt-in variable first, and only the exact value 1 opens it", () => {
  const nothing = gate({ env: {}, platform: "darwin", onPath: () => false, exists: () => false, version: { kind: "unavailable" } });
  assert.match(ompSkipReason(nothing) ?? "", /REALM_LIVE_OMP=1 is not set/);
  for (const value of ["0", "true", ""]) {
    assert.match(ompSkipReason(gate({ env: { [LIVE_OMP_VARIABLE]: value } })) ?? "", /REALM_LIVE_OMP=1 is not set/);
  }
});

void test("ompSkipReason names the platform second", () => {
  const reason = ompSkipReason(gate({ platform: "darwin", onPath: () => false, version: { kind: "unavailable" } }));
  assert.match(reason ?? "", /Linux only; this host is darwin/);
});

void test("ompSkipReason names a missing Omp executable third, looked up on PATH by name", () => {
  const asked: string[] = [];
  const reason = ompSkipReason(
    gate({
      onPath: (name) => {
        asked.push(name);
        return false;
      },
      version: { kind: "unavailable" },
    }),
  );
  assert.deepEqual(asked, ["omp"]);
  assert.match(reason ?? "", /no Omp executable omp/);
});

void test("ompSkipReason checks REALM_OMP_BIN as a file when it holds a slash, and as a PATH name otherwise", () => {
  const files: string[] = [];
  const byPath = ompSkipReason(
    gate({
      env: { [LIVE_OMP_VARIABLE]: "1", [OMP_BIN_VARIABLE]: "/opt/omp/bin/omp" },
      exists: (path) => {
        files.push(path);
        return false;
      },
      onPath: () => true,
    }),
  );
  assert.deepEqual(files, ["/opt/omp/bin/omp"]);
  assert.match(byPath ?? "", /no Omp executable \/opt\/omp\/bin\/omp/);

  const names: string[] = [];
  const byName = ompSkipReason(
    gate({
      env: { [LIVE_OMP_VARIABLE]: "1", [OMP_BIN_VARIABLE]: "omp-nightly" },
      onPath: (name) => {
        names.push(name);
        return false;
      },
    }),
  );
  assert.deepEqual(names, ["omp-nightly"]);
  assert.match(byName ?? "", /no Omp executable omp-nightly/);
});

void test("ompSkipReason names an Omp that did not report a version, then output with no version, then a version below the minimum", () => {
  assert.match(ompSkipReason(gate({ version: { kind: "unavailable" } })) ?? "", /--version did not run to a successful exit/);
  assert.match(ompSkipReason(gate({ version: { kind: "output", stdout: "omp dev build\n" } })) ?? "", /printed no x\.y\.z version/);
  for (const stdout of ["omp/18.12.5\n", "omp/18.11.99", "omp/17.99.99", "omp/0.0.1"]) {
    assert.match(ompSkipReason(gate({ version: { kind: "output", stdout } })) ?? "", /is older than 18\.12\.6/, stdout);
  }
});

void test("ompSkipReason accepts the minimum version exactly and any newer one", () => {
  assert.equal(MIN_OMP_VERSION, "18.12.6");
  for (const stdout of ["omp/18.12.6", "omp/18.12.7\n", "omp/18.13.0", "omp/19.0.0", "omp/100.0.0-beta.1"]) {
    assert.equal(ompSkipReason(gate({ version: { kind: "output", stdout } })), undefined, stdout);
  }
});

void test("ompSkipReason names a missing built extension after the version", () => {
  const checked: string[] = [];
  const reason = ompSkipReason(
    gate({
      exists: (path) => {
        checked.push(path);
        return false;
      },
    }),
  );
  assert.deepEqual(checked, [EXTENSION]);
  assert.match(reason ?? "", /dist\/src\/omp\/extension\.js is missing; run npm run build/);
});

void test("ompSkipReason asks about the trace last: the opt-in, then strace on PATH, then strace able to trace", () => {
  const missing: StraceProbe = { kind: "missing" };
  const unusable: StraceProbe = { kind: "unusable", detail: "exit 1; stderr ptrace: Operation not permitted" };
  const ready: StraceProbe = { kind: "ready" };
  assert.match(ompSkipReason(gate({ strace: ready })) ?? "", /REALM_OMP_NET_TRACE=1 is not set/);
  assert.match(ompSkipReason(gate({ env: TRACED_ENV, strace: missing })) ?? "", /no strace on PATH/);
  const blocked = ompSkipReason(gate({ env: TRACED_ENV, strace: unusable }));
  assert.match(blocked ?? "", /strace cannot trace on this host/);
  assert.match(blocked ?? "", /Operation not permitted/);
  assert.equal(ompSkipReason(gate({ env: TRACED_ENV, strace: ready })), undefined);
});

void test("ompSkipReason reports the earlier prerequisite even when a later one is also missing", () => {
  const reason = ompSkipReason(gate({ env: TRACED_ENV, exists: () => false, strace: { kind: "missing" } }));
  assert.match(reason ?? "", /extension.*missing/);
});

// ---- Version, binary, extension path -------------------------------------------------------------------------------------------

void test("parseOmpVersion reads the first x.y.z and ignores a prefix or a suffix", () => {
  assert.deepEqual(parseOmpVersion("omp/18.12.6\n"), { major: 18, minor: 12, patch: 6, text: "18.12.6" });
  assert.equal(parseOmpVersion("v22.13.0")?.text, "22.13.0");
  assert.equal(parseOmpVersion("omp/19.0.1-beta.2+build.5")?.text, "19.0.1");
  assert.equal(parseOmpVersion("omp dev"), undefined);
  assert.equal(parseOmpVersion("18.12"), undefined);
  assert.equal(parseOmpVersion(""), undefined);
});

void test("compareOmpVersions orders by major, then minor, then patch", () => {
  const v = (text: string): OmpVersion => {
    const parsed = parseOmpVersion(text);
    assert.ok(parsed !== undefined);
    return parsed;
  };
  assert.equal(compareOmpVersions(v("18.12.6"), v("18.12.6")), 0);
  assert.ok(compareOmpVersions(v("18.12.5"), v("18.12.6")) < 0);
  assert.ok(compareOmpVersions(v("18.13.0"), v("18.12.9")) > 0);
  assert.ok(compareOmpVersions(v("19.0.0"), v("18.99.99")) > 0);
  assert.ok(compareOmpVersions(v("9.0.0"), v("10.0.0")) < 0);
});

void test("ompBinary is REALM_OMP_BIN when set and non-empty, otherwise omp", () => {
  assert.equal(ompBinary({}), "omp");
  assert.equal(ompBinary({ [OMP_BIN_VARIABLE]: "" }), "omp");
  assert.equal(ompBinary({ [OMP_BIN_VARIABLE]: "/opt/omp/bin/omp" }), "/opt/omp/bin/omp");
});

void test("resolveExtensionPath finds dist/src/omp/extension.js from a module in dist/test/<dir>/", () => {
  assert.equal(resolveExtensionPath("file:///work/dist/test/support/omp-live.js"), "/work/dist/src/omp/extension.js");
  assert.equal(EXTENSION_PATH, resolveExtensionPath(import.meta.url));
  assert.ok(EXTENSION_PATH.endsWith(join("src", "omp", "extension.js")));
});

void test("the shared timeouts are the decided bounds", () => {
  assert.equal(OMP_READY_TIMEOUT_MS, 180_000);
  assert.equal(OMP_PROMPT_TIMEOUT_MS, 60_000);
  assert.equal(OMP_SCENARIO_TIMEOUT_MS, 300_000);
});

void test("within resolves with the value, and rejects with the label when the bound passes first", async () => {
  assert.equal(await within(Promise.resolve(7), BOUND_MS, "value"), 7);
  await assert.rejects(within(new Promise<never>(() => undefined), 5, "never settles"), /timed out after 5 ms: never settles/);
});

// ---- Host probes that start nothing real ---------------------------------------------------------------------------------------

void test("ompVersion reports unavailable for a binary that cannot start, and the stdout of one that exits zero", async () => {
  const missing = await ompVersion(join(tmpdir(), "rlv-no-such-omp"), { PATH: "" });
  assert.deepEqual(missing, { kind: "unavailable" });
  const node = await ompVersion(process.execPath, { PATH: "" });
  assert.equal(node.kind, "output");
  assert.ok(parseOmpVersion(node.stdout) !== undefined);
});

void test("probeStrace reports missing when strace is not on PATH", async () => {
  assert.deepEqual(await probeStrace({ PATH: "" }), { kind: "missing" });
});

void test("collectOmpGateInputs starts nothing before the opt-in, so the skip reason is the opt-in", async () => {
  const env = { PATH: "" };
  const inputs = await collectOmpGateInputs(env, { platform: "linux", trace: true });
  assert.deepEqual(inputs.version, { kind: "unavailable" });
  assert.deepEqual(inputs.strace, { kind: "missing" });
  assert.equal(inputs.extensionPath, EXTENSION_PATH);
  assert.match(ompSkipReason(inputs) ?? "", /REALM_LIVE_OMP=1 is not set/);
  const untraced = await collectOmpGateInputs(env, { platform: "linux", trace: false, extensionPath: EXTENSION });
  assert.equal(untraced.strace, undefined);
  assert.equal(untraced.extensionPath, EXTENSION);
});

void test("collectOmpGateInputs with the opt-in but no Omp on PATH reports the missing executable", async () => {
  const env = { [LIVE_OMP_VARIABLE]: "1", PATH: "" };
  const inputs = await collectOmpGateInputs(env, { platform: "linux", trace: false });
  assert.deepEqual(inputs.version, { kind: "unavailable" });
  assert.match(ompSkipReason(inputs) ?? "", /no Omp executable omp/);
});

// ---- Scripted provider -------------------------------------------------------------------------------------------------------

async function startProvider(t: TestContext): Promise<{ provider: ScriptedProvider; baseUrl: string; port: number }> {
  const provider = new ScriptedProvider();
  const { port, baseUrl } = await provider.start();
  t.after(async () => {
    await provider.stop();
  });
  return { provider, baseUrl, port };
}

function post(url: string, body: string): Promise<Response> {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(BOUND_MS) });
}

function chat(baseUrl: string, body: Record<string, unknown>): Promise<Response> {
  return post(`${baseUrl}/chat/completions`, JSON.stringify(body));
}

function parseSse(text: string): { chunks: Record<string, unknown>[]; done: boolean } {
  const events = text.split("\n\n").filter((event) => event !== "");
  const chunks: Record<string, unknown>[] = [];
  let done = false;
  for (const event of events) {
    assert.ok(event.startsWith("data: "), `not an SSE data event: ${event}`);
    const payload = event.slice("data: ".length);
    if (payload === "[DONE]") {
      done = true;
      continue;
    }
    chunks.push(JSON.parse(payload) as Record<string, unknown>);
  }
  return { chunks, done };
}

// The chunk with its per-request fields fixed, so a whole sequence can be compared.
function normalise(chunk: Record<string, unknown>): Record<string, unknown> {
  return { ...chunk, id: "ID", created: 0 };
}

function delta(value: Record<string, unknown>, finish: string | null): Record<string, unknown> {
  return {
    id: "ID",
    object: "chat.completion.chunk",
    created: 0,
    model: "scripted",
    choices: [{ index: 0, delta: value, finish_reason: finish }],
  };
}

const USAGE_CHUNK = {
  id: "ID",
  object: "chat.completion.chunk",
  created: 0,
  model: "scripted",
  choices: [],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const WRITE_TOOL = { type: "function", function: { name: "write", parameters: { type: "object" } } };
const READ_TOOL = { type: "function", function: { name: "read", parameters: { type: "object" } } };

void test("the scripted provider binds loopback on a port the OS picks and serves the model list", async (t) => {
  const { baseUrl, port } = await startProvider(t);
  assert.ok(port > 0);
  assert.equal(baseUrl, `http://127.0.0.1:${String(port)}/v1`);
  const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(BOUND_MS) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await response.json(), { object: "list", data: [{ id: "scripted", object: "model" }] });
});

void test("a streamed tool call, then the final text, in the exact chunk sequence of the prototype", async (t) => {
  const { provider, baseUrl } = await startProvider(t);
  provider.onTurn(({ userText, toolsOffered, lastRole }) => {
    if (lastRole === "tool") {
      return { text: "done" };
    }
    const match = /^WRITE (\S+) (.*)$/.exec(userText);
    if (match !== null && toolsOffered.includes("write")) {
      return { call: { name: "write", args: { path: match[1], content: match[2] } } };
    }
    return { text: "ack" };
  });

  const first = await chat(baseUrl, {
    model: "scripted",
    stream: true,
    tools: [WRITE_TOOL, READ_TOOL],
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "WRITE a.txt hello world" },
    ],
  });
  assert.equal(first.status, 200);
  assert.match(first.headers.get("content-type") ?? "", /text\/event-stream/);
  const streamed = parseSse(await first.text());
  assert.equal(streamed.done, true);
  assert.deepEqual(streamed.chunks.map(normalise), [
    delta(
      { role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_000001", type: "function", function: { name: "write", arguments: "" } }] },
      null,
    ),
    delta({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ path: "a.txt", content: "hello world" }) } }] }, null),
    delta({}, "tool_calls"),
    USAGE_CHUNK,
  ]);

  const second = await chat(baseUrl, {
    model: "scripted",
    stream: true,
    tools: [WRITE_TOOL],
    messages: [
      { role: "user", content: "WRITE a.txt hello world" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_000001", type: "function", function: { name: "write", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call_000001", content: [{ type: "text", text: "Successfully wrote 11 bytes" }] },
    ],
  });
  const finished = parseSse(await second.text());
  assert.equal(finished.done, true);
  assert.deepEqual(finished.chunks.map(normalise), [
    delta({ role: "assistant", content: "" }, null),
    delta({ content: "done" }, null),
    delta({}, "stop"),
    USAGE_CHUNK,
  ]);

  assert.equal(provider.requests.length, 2);
  const [one, two] = provider.requests;
  assert.deepEqual(
    { stream: one?.stream, model: one?.model, tools: one?.toolsOffered, lastRole: one?.lastRole, user: one?.userText, tool: one?.toolResultText, count: one?.messageCount },
    { stream: true, model: "scripted", tools: ["write", "read"], lastRole: "user", user: "WRITE a.txt hello world", tool: undefined, count: 2 },
  );
  assert.deepEqual(one?.plan, { call: { name: "write", args: { path: "a.txt", content: "hello world" } } });
  assert.deepEqual(
    { lastRole: two?.lastRole, user: two?.userText, tool: two?.toolResultText, tools: two?.toolsOffered, count: two?.messageCount },
    { lastRole: "tool", user: "WRITE a.txt hello world", tool: "Successfully wrote 11 bytes", tools: ["write"], count: 3 },
  );
  assert.deepEqual(two?.plan, { text: "done" });
  assert.deepEqual(provider.failures, []);
});

void test("a non-streamed tool call and a non-streamed text reply", async (t) => {
  const { provider, baseUrl } = await startProvider(t);
  provider.onTurn(({ lastRole }) => (lastRole === "tool" ? { text: "all done" } : { call: { name: "write", args: { path: "b.txt" } } }));

  const call = await chat(baseUrl, { model: "scripted", messages: [{ role: "user", content: "go" }] });
  assert.equal(call.status, 200);
  const callBody = (await call.json()) as Record<string, unknown>;
  assert.deepEqual({ ...callBody, id: "ID", created: 0 }, {
    id: "ID",
    object: "chat.completion",
    created: 0,
    model: "scripted",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_000001", type: "function", function: { name: "write", arguments: JSON.stringify({ path: "b.txt" }) } }],
        },
        finish_reason: "tool_calls",
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });

  const text = await chat(baseUrl, {
    messages: [
      { role: "user", content: [{ type: "text", text: "go " }, { type: "text", text: "again" }] },
      { role: "tool", content: "tool said no" },
    ],
  });
  const textBody = (await text.json()) as Record<string, unknown>;
  assert.deepEqual(textBody["choices"], [{ index: 0, message: { role: "assistant", content: "all done" }, finish_reason: "stop" }]);
  assert.equal(textBody["model"], "scripted");
  const recorded = provider.requests[1];
  assert.equal(recorded?.stream, false);
  assert.equal(recorded.model, undefined);
  assert.equal(recorded.userText, "go again");
  assert.equal(recorded.toolResultText, "tool said no");
  assert.deepEqual(recorded.toolsOffered, []);
});

void test("with no handler every turn answers ack, and a handler replaced later applies to later requests", async (t) => {
  const { provider, baseUrl } = await startProvider(t);
  const body = { messages: [{ role: "user", content: "hi" }] };
  const before = (await (await chat(baseUrl, body)).json()) as { choices: { message: { content: string } }[] };
  assert.equal(before.choices[0]?.message.content, "ack");
  provider.onTurn(() => Promise.resolve({ text: "later" }));
  const after = (await (await chat(baseUrl, body)).json()) as { choices: { message: { content: string } }[] };
  assert.equal(after.choices[0]?.message.content, "later");
  assert.deepEqual(provider.requests.map((request) => request.plan), [{ text: "ack" }, { text: "later" }]);
});

void test("a request with no user message and no messages is answered with an empty user text", async (t) => {
  const { provider, baseUrl } = await startProvider(t);
  const turns: { userText: string; lastRole: string | undefined; count: number }[] = [];
  provider.onTurn((turn) => {
    turns.push({ userText: turn.userText, lastRole: turn.lastRole, count: turn.messages.length });
    return { text: "ok" };
  });
  assert.equal((await chat(baseUrl, {})).status, 200);
  assert.equal((await chat(baseUrl, { messages: [{ role: "system", content: "s" }, "junk", { content: "no role" }] })).status, 200);
  assert.deepEqual(turns, [
    { userText: "", lastRole: undefined, count: 0 },
    { userText: "", lastRole: "system", count: 1 },
  ]);
});

void test("a bad body is 400, an unknown route is 404, and a throwing handler is 500 and recorded", async (t) => {
  const { provider, baseUrl, port } = await startProvider(t);
  assert.equal((await post(`${baseUrl}/chat/completions`, "{not json")).status, 400);
  assert.equal((await post(`${baseUrl}/chat/completions`, "[1,2]")).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${String(port)}/other`, { signal: AbortSignal.timeout(BOUND_MS) })).status, 404);
  assert.equal((await fetch(`${baseUrl}/chat/completions`, { signal: AbortSignal.timeout(BOUND_MS) })).status, 404);
  assert.equal(provider.requests.length, 0);

  provider.onTurn(() => {
    throw new Error("handler exploded");
  });
  const response = await chat(baseUrl, { messages: [{ role: "user", content: "x" }] });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: { message: "handler exploded" } });
  assert.deepEqual(provider.failures, ["handler exploded"]);
  assert.equal(provider.requests.length, 0);
});

void test("stop closes the listener and an open keep-alive connection, and is safe to repeat; start refuses a second call", async () => {
  const provider = new ScriptedProvider();
  await provider.stop();
  const { baseUrl } = await provider.start();
  await assert.rejects(provider.start(), /already started/);
  const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(BOUND_MS) });
  assert.equal(response.status, 200);
  await provider.stop();
  await provider.stop();
  await assert.rejects(fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(BOUND_MS) }));
});

void test("the encoders are pure: the SSE body is one data event per chunk then [DONE], and textOfContent reads strings and text parts", () => {
  const envelope: Envelope = { id: "chatcmpl-x", created: 5, model: "m", callId: "call_x" };
  const plan: TurnPlan = { text: "hello" };
  const chunks = streamChunks(plan, envelope);
  assert.equal(chunks.length, 4);
  const body = sseBody(chunks);
  assert.ok(body.endsWith("data: [DONE]\n\n"));
  assert.equal(body.split("\n\n").length, 6);
  assert.deepEqual(parseSse(body).chunks, [...chunks]);
  assert.equal((completionBody({ call: { name: "n", args: {} } }, envelope)["choices"] as { finish_reason: string }[])[0]?.finish_reason, "tool_calls");
  assert.equal(textOfContent("plain"), "plain");
  assert.equal(textOfContent([{ text: "a" }, { type: "image" }, "x", { text: "b" }]), "ab");
  assert.equal(textOfContent(undefined), "");
  assert.equal(textOfContent({ text: "no" }), "");
});

// ---- Profile -----------------------------------------------------------------------------------------------------------------

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

void test("a profile without realm holds the provider config, the workspace and exactly the four environment variables", (t) => {
  const profile = createOmpProfile({ providerPort: 18911 });
  t.after(() => {
    profile.dispose();
  });
  assert.ok(profile.root.startsWith(join(realpathSync(tmpdir()), "rlv-")));
  assert.deepEqual(Object.keys(profile.env).sort(), ["HOME", "PATH", "PI_CODING_AGENT_DIR", "XDG_CONFIG_HOME"]);
  assert.equal(profile.env["HOME"], profile.home);
  assert.equal(profile.env["XDG_CONFIG_HOME"], profile.configHome);
  assert.equal(profile.env["PI_CODING_AGENT_DIR"], profile.agentDir);
  assert.equal(profile.workspace, realpathSync(profile.workspace));
  assert.ok(statSync(profile.workspace).isDirectory());
  assert.ok(statSync(profile.home).isDirectory());
  assert.equal(readFileSync(profile.modelsPath, "utf8"), modelsYaml(18911));
  assert.equal(profile.modelsPath, join(profile.agentDir, "models.yml"));
  assert.equal(existsSync(profile.configPath), false);
  assert.equal(existsSync(profile.stateDir), false);
  assert.ok(Buffer.byteLength(profile.socketPath) <= 107);
  assert.equal(profile.socketPath, join(profile.stateDir, "run", "control.sock"));
});

void test("models.yml names the stub provider on the given port with the openai-completions api and a dummy key", () => {
  const yaml = modelsYaml(4321);
  assert.match(yaml, /^providers:\n {2}stub:\n/);
  assert.match(yaml, /baseUrl: http:\/\/127\.0\.0\.1:4321\/v1\n/);
  assert.match(yaml, /api: openai-completions\n/);
  assert.match(yaml, /apiKey: dummy\n/);
  assert.match(yaml, /- id: scripted\n/);
});

void test("the path option replaces the default PATH, and nothing else enters the environment", (t) => {
  const profile = createOmpProfile({ providerPort: 1, path: "/custom/bin:/usr/bin" });
  t.after(() => {
    profile.dispose();
  });
  assert.equal(profile.env["PATH"], "/custom/bin:/usr/bin");
  assert.equal(Object.keys(profile.env).length, 4);
});

for (const mode of ["advisory", "fail-closed"] as const) {
  void test(`a profile with a ${mode} realm writes a config the runtime reads, a policy the loader reads, and private modes`, (t) => {
    const profile = createOmpProfile({ providerPort: 18911, realm: { mode } });
    t.after(() => {
      profile.dispose();
    });
    assert.equal(profile.configPath, join(profile.configHome, "realm", "config.json"));
    assert.equal(profile.policyPath, join(profile.stateDir, "policy.json"));
    assert.equal(modeOf(profile.stateDir), 0o700);
    assert.equal(modeOf(profile.configPath), 0o600);
    assert.equal(modeOf(profile.policyPath), 0o600);

    const config = JSON.parse(readFileSync(profile.configPath, "utf8")) as unknown;
    assert.deepEqual(config, { image: PROFILE_IMAGE, stateDir: profile.stateDir, workspaceRoot: profile.workspace });
    assert.deepEqual(loadRuntimeConfig(config), { image: PROFILE_IMAGE, stateDir: profile.stateDir, workspaceRoot: profile.workspace });
    const host = readHostRuntime(profile.env);
    assert.equal(host.stateDir, profile.stateDir);

    assert.deepEqual(JSON.parse(readFileSync(profile.policyPath, "utf8")), { workspaceRoots: [profile.workspace], mode });
    const policy = loadPolicyFile(profile.policyPath);
    assert.equal(policy.mode, mode);
    assert.deepEqual(policy.workspaceRoots, [profile.workspace]);
  });
}

void test("dispose removes the whole root, twice without error, and a bad port is refused before anything is created", () => {
  const profile = createOmpProfile({ providerPort: 18911, realm: { mode: "advisory" } });
  assert.ok(existsSync(profile.root));
  profile.dispose();
  assert.equal(existsSync(profile.root), false);
  profile.dispose();
  for (const port of [0, -1, 65536, 1.5, Number.NaN]) {
    assert.throws(() => createOmpProfile({ providerPort: port }), RangeError, String(port));
  }
});

// ---- JSONL framing -----------------------------------------------------------------------------------------------------------

void test("JsonlFramer parses one frame per complete line and keeps a partial line for the next push", () => {
  const framer = new JsonlFramer();
  assert.deepEqual(framer.push('{"type":"ready"}\n{"type":"a","n":1}\n'), [
    { kind: "frame", frame: { type: "ready" } },
    { kind: "frame", frame: { type: "a", n: 1 } },
  ]);
  assert.deepEqual(framer.push('{"type":"sp'), []);
  assert.deepEqual(framer.push('lit","text":"x'), []);
  assert.deepEqual(framer.push('y"}\n{"type":"next"}'), [{ kind: "frame", frame: { type: "split", text: "xy" } }]);
  assert.deepEqual(framer.push("\n"), [{ kind: "frame", frame: { type: "next" } }]);
});

void test("JsonlFramer handles a chunk that ends exactly on a newline, one that is a lone newline, and a line split at every byte", () => {
  const frames = '{"type":"one"}\n{"type":"two","text":"héllo"}\n';
  const whole = new JsonlFramer().push(frames);
  assert.equal(whole.length, 2);
  const byChar = new JsonlFramer();
  const collected = Array.from(frames).flatMap((char) => byChar.push(char));
  assert.deepEqual(collected, whole);
  assert.deepEqual(new JsonlFramer().push("\n"), []);
});

void test("JsonlFramer keeps non-JSON lines as text, skips blank lines, strips a carriage return and reads JSON that is not an object as text", () => {
  const framer = new JsonlFramer();
  const parsed = framer.push('Still starting after 13s\n\n   \n{"type":"x"}\r\n42\n[1]\nnull\n"str"\n{broken\n');
  assert.deepEqual(parsed, [
    { kind: "text", line: "Still starting after 13s" },
    { kind: "frame", frame: { type: "x" } },
    { kind: "text", line: "42" },
    { kind: "text", line: "[1]" },
    { kind: "text", line: "null" },
    { kind: "text", line: '"str"' },
    { kind: "text", line: "{broken" },
  ]);
});

void test("JsonlFramer.flush reads a final line with no newline, once", () => {
  const framer = new JsonlFramer();
  assert.deepEqual(framer.push('{"type":"last"}'), []);
  assert.deepEqual(framer.flush(), [{ kind: "frame", frame: { type: "last" } }]);
  assert.deepEqual(framer.flush(), []);
  assert.deepEqual(framer.push("tail without newline"), []);
  assert.deepEqual(framer.flush(), [{ kind: "text", line: "tail without newline" }]);
});

void test("toolStartOf and toolEndOf read the tool frames and ignore the rest", () => {
  assert.deepEqual(toolStartOf({ type: "tool_execution_start", toolCallId: "c1", toolName: "write", args: { path: "a" } }), {
    toolCallId: "c1",
    toolName: "write",
    args: { path: "a" },
  });
  assert.equal(toolStartOf({ type: "tool_execution_end" }), undefined);
  const frame: OmpFrame = {
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "write",
    isError: true,
    result: { content: [{ type: "text", text: "REALM_" }, { type: "image" }, { type: "text", text: "NOT_ACTIVE" }], details: {} },
  };
  assert.deepEqual(toolEndOf(frame), { toolCallId: "c1", toolName: "write", isError: true, text: "REALM_NOT_ACTIVE", frame });
  const bare = toolEndOf({ type: "tool_execution_end" });
  assert.deepEqual({ ...bare, frame: undefined }, { toolCallId: "", toolName: "", isError: false, text: "", frame: undefined });
  assert.equal(toolEndOf({ type: "agent_end" }), undefined);
});

void test("ompArgs and ompCommand build the decided Omp command, with or without a wrapper", () => {
  assert.deepEqual(ompArgs("/ext/extension.js"), [
    "--mode",
    "rpc-ui",
    "--no-extensions",
    "-e",
    "/ext/extension.js",
    "--model",
    "stub/scripted",
    "--no-session",
  ]);
  assert.deepEqual(ompCommand({ bin: "omp", extensionPath: "/ext/extension.js" }), { command: "omp", args: ompArgs("/ext/extension.js") });
  assert.deepEqual(ompCommand({ bin: "omp", extensionPath: "/ext/extension.js", wrap: [] }), { command: "omp", args: ompArgs("/ext/extension.js") });
  assert.deepEqual(ompCommand({ bin: "/opt/omp", extensionPath: "/ext/extension.js", wrap: ["strace", "-f", "-o", "out.txt", "--"] }), {
    command: "strace",
    args: ["-f", "-o", "out.txt", "--", "/opt/omp", ...ompArgs("/ext/extension.js")],
  });
});

// ---- OmpSession against a fake child process -------------------------------------------------------------------------------

// A child process made of three pass-through streams. The test plays Omp: it writes frames to stdout and reads the commands the
// session wrote to stdin. Signals are recorded and may be given a reaction.
class FakeOmp {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly commands: Record<string, unknown>[] = [];
  readonly kills: NodeJS.Signals[] = [];
  readonly exited: Promise<OmpExit>;
  readonly child: OmpChild;
  finish: (exit: OmpExit) => void = () => undefined;
  onKill: (signal: NodeJS.Signals) => void = () => undefined;
  readonly #commandWaiters: { count: number; resolve: () => void }[] = [];
  readonly #commandFramer = new JsonlFramer();

  constructor() {
    this.exited = new Promise<OmpExit>((resolve) => {
      this.finish = resolve;
    });
    this.child = {
      stdin: this.stdin,
      stdout: this.stdout,
      stderr: this.stderr,
      kill: (signal) => {
        this.kills.push(signal);
        this.onKill(signal);
        return true;
      },
    };
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk: string) => {
      for (const entry of this.#commandFramer.push(chunk)) {
        if (entry.kind === "frame") {
          this.commands.push({ ...entry.frame });
        }
      }
      for (const waiter of [...this.#commandWaiters]) {
        if (this.commands.length >= waiter.count) {
          this.#commandWaiters.splice(this.#commandWaiters.indexOf(waiter), 1);
          waiter.resolve();
        }
      }
    });
  }

  session(): OmpSession {
    return new OmpSession(this.child, this.exited);
  }

  emit(frame: Record<string, unknown>): void {
    this.stdout.write(`${JSON.stringify(frame)}\n`);
  }

  emitRaw(text: string): void {
    this.stdout.write(text);
  }

  // Resolves once the session has written `count` commands in total.
  commandsWritten(count: number): Promise<void> {
    return within(
      new Promise<void>((resolve) => {
        if (this.commands.length >= count) {
          resolve();
          return;
        }
        this.#commandWaiters.push({ count, resolve });
      }),
      BOUND_MS,
      `${String(count)} commands on stdin`,
    );
  }
}

void test("frames, nonJsonLines, status, notices and tool accessors follow the frames as they arrive", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  omp.emitRaw("Still starting after 13s — phase: models\n");
  omp.emit({ type: "ready" });
  await session.ready(BOUND_MS);
  assert.deepEqual(session.nonJsonLines, ["Still starting after 13s — phase: models"]);
  assert.equal(session.status(), undefined);

  omp.emit({ type: "extension_ui_request", id: "u1", method: "setStatus", statusKey: "realm", statusText: "○ realm disconnected · REALM_NOT_ACTIVE" });
  omp.emit({ type: "extension_ui_request", id: "u2", method: "setStatus", statusKey: "other", statusText: "not mine" });
  omp.emit({ type: "extension_ui_request", id: "u3", method: "notify", message: "realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy" });
  omp.emit({ type: "extension_ui_request", id: "u4", method: "setStatus", statusKey: "realm", statusText: "● realm active · up" });
  omp.emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "write", args: { path: "a.txt" } });
  omp.emit({
    type: "tool_execution_end",
    toolCallId: "c1",
    toolName: "write",
    isError: false,
    result: { content: [{ type: "text", text: "Successfully wrote 3 bytes" }], details: {} },
  });
  await session.waitFor((s) => s.toolEnds().length === 1, BOUND_MS, "the tool end");
  assert.equal(session.status(), "● realm active · up");
  assert.deepEqual(session.notices(), ["realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy"]);
  assert.deepEqual(session.toolStarts(), [{ toolCallId: "c1", toolName: "write", args: { path: "a.txt" } }]);
  const [end] = session.toolEnds();
  assert.equal(end?.isError, false);
  assert.equal(end.text, "Successfully wrote 3 bytes");
  assert.equal(session.frames.length, 7);

  omp.emit({ type: "extension_ui_request", id: "u5", method: "setStatus", statusKey: "realm" });
  await session.waitFor((s) => s.status() === undefined, BOUND_MS, "the status to clear");
});

void test("a frame split across chunks, and a final frame with no newline, are parsed", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  omp.emitRaw('{"type":"ready","pro');
  omp.emitRaw('tocolVersion":1}\n{"type":"last"}');
  await session.ready(BOUND_MS);
  assert.deepEqual(session.frames, [{ type: "ready", protocolVersion: 1 }]);
  omp.stdout.end();
  await session.waitFor((s) => s.frames.length === 2, BOUND_MS, "the final unterminated frame");
  assert.deepEqual(session.frames[1], { type: "last" });
});

void test("waitFor resolves at once when the predicate already holds, and from the frame that makes it hold", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  await session.waitFor(() => true, BOUND_MS, "already true");
  const waiting = session.waitFor((s) => s.status()?.startsWith("● realm active") === true, BOUND_MS, "active status");
  omp.emit({ type: "extension_ui_request", id: "u1", method: "setStatus", statusKey: "realm", statusText: "● realm active · ok" });
  await waiting;
});

void test("a waitFor timeout rejects with the label, the tail of the frames, the non-JSON count and the stderr tail", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  omp.emit({ type: "ready" });
  omp.emitRaw("noise\n");
  omp.stderr.write("Still starting after 13s\n");
  await session.ready(BOUND_MS);
  await session.waitFor((s) => s.nonJsonLines.length === 1, BOUND_MS, "noise");
  await assert.rejects(session.waitFor(() => false, 15, "a status that never comes"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /timed out after 15 ms while waiting for a status that never comes/);
    assert.match(error.message, /non-JSON lines: 1/);
    assert.match(error.message, /\{"type":"ready"\}/);
    return true;
  });
  assert.match(session.stderr(), /Still starting/);
});

void test("a predicate that throws rejects its wait with that error", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  let calls = 0;
  const waiting = session.waitFor(
    () => {
      calls += 1;
      if (calls > 1) {
        throw new Error("predicate broke");
      }
      return false;
    },
    BOUND_MS,
    "a throwing predicate",
  );
  omp.emit({ type: "ready" });
  await assert.rejects(waiting, /predicate broke/);
});

void test("an exit rejects the waits that are pending and any wait made afterwards, with the exit and the stderr tail", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  omp.stderr.write("fatal: extension failed to load\n");
  const waiting = session.waitFor(() => false, BOUND_MS, "the ready frame");
  await session.waitFor((s) => s.stderr().includes("fatal"), BOUND_MS, "stderr");
  omp.finish({ code: 3, signal: null });
  await assert.rejects(waiting, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Omp exited \(code 3\) while waiting for the ready frame/);
    assert.match(error.message, /fatal: extension failed to load/);
    return true;
  });
  await assert.rejects(session.waitFor(() => false, BOUND_MS, "later"), /Omp had already exited \(code 3\)/);
  await session.waitFor(() => true, BOUND_MS, "a predicate that holds still resolves");
  assert.deepEqual(await session.exited, { code: 3, signal: null });
});

void test("a process that could not start is reported as such", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  const waiting = session.ready(BOUND_MS);
  omp.finish({ code: null, signal: null, error: "spawn omp ENOENT" });
  await assert.rejects(waiting, /Omp exited \(could not start: spawn omp ENOENT\)/);
});

void test("confirm dialogs are auto-confirmed and select, input and editor dialogs are cancelled; notify and setStatus get no answer", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  omp.emit({ type: "extension_ui_request", id: "d1", method: "confirm", title: "t", message: "m" });
  omp.emit({ type: "extension_ui_request", id: "d2", method: "select", title: "t", options: ["a"] });
  omp.emit({ type: "extension_ui_request", id: "d3", method: "input", title: "t" });
  omp.emit({ type: "extension_ui_request", id: "d4", method: "editor", title: "t" });
  omp.emit({ type: "extension_ui_request", id: "d5", method: "notify", message: "n" });
  omp.emit({ type: "extension_ui_request", id: "d6", method: "setStatus", statusKey: "realm", statusText: "s" });
  await omp.commandsWritten(4);
  await session.waitFor((s) => s.frames.length === 6, BOUND_MS, "all six frames");
  assert.deepEqual(omp.commands, [
    { type: "extension_ui_response", id: "d1", confirmed: true },
    { type: "extension_ui_response", id: "d2", cancelled: true },
    { type: "extension_ui_response", id: "d3", cancelled: true },
    { type: "extension_ui_response", id: "d4", cancelled: true },
  ]);
  assert.deepEqual(
    session.dialogs().map((frame) => frame["id"]),
    ["d1", "d2", "d3", "d4"],
  );
});

void test("prompt sends the command and resolves on the terminal agent_end with that prompt's tool frames", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  const pending = session.prompt("WRITE a.txt hi", BOUND_MS);
  await omp.commandsWritten(1);
  assert.deepEqual(omp.commands[0], { id: "p1", type: "prompt", message: "WRITE a.txt hi" });
  omp.emit({ type: "response", id: "p1", command: "prompt", success: true });
  omp.emit({ type: "tool_execution_start", toolCallId: "c1", toolName: "write", args: { path: "a.txt", content: "hi" } });
  omp.emit({ type: "tool_execution_end", toolCallId: "c1", toolName: "write", isError: false, result: { content: [{ type: "text", text: "ok" }] } });
  omp.emit({ type: "agent_end", isTerminal: true });
  const outcome = await pending;
  assert.equal(outcome.id, "p1");
  assert.equal(outcome.status, undefined);
  assert.deepEqual(
    outcome.toolStarts.map((start) => start.toolName),
    ["write"],
  );
  assert.deepEqual(
    outcome.toolEnds.map((end) => [end.toolName, end.isError, end.text]),
    [["write", false, "ok"]],
  );
  assert.equal(outcome.frames.length, 4);
});

void test("prompt ignores a non-terminal agent_end and an agent_end from before it was sent", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  omp.emit({ type: "agent_end" });
  await session.waitFor((s) => s.frames.length === 1, BOUND_MS, "the earlier agent_end");
  let settled = false;
  const pending = session.prompt("second", BOUND_MS).then((outcome) => {
    settled = true;
    return outcome;
  });
  await omp.commandsWritten(1);
  omp.emit({ type: "agent_end", isTerminal: false });
  omp.emit({ type: "prompt_result", id: "p99", status: "completed" });
  omp.emit({ type: "marker" });
  await session.waitFor((s) => s.frames.some((frame) => frame["type"] === "marker"), BOUND_MS, "the marker");
  assert.equal(settled, false);
  omp.emit({ type: "agent_end", isTerminal: true });
  const outcome = await pending;
  assert.equal(outcome.id, "p1");
  assert.equal(outcome.frames.length, 4);
});

void test("a slash command that runs no agent turn settles on its prompt_result, which reports its status", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  const pending = session.prompt("/realm-retry", BOUND_MS);
  await omp.commandsWritten(1);
  omp.emit({ type: "prompt_result", id: "p1", agentInvoked: false, status: "completed", sessionSettled: true });
  const outcome = await pending;
  assert.equal(outcome.status, "completed");
  assert.deepEqual(outcome.toolEnds, []);
});

void test("prompt rejects when Omp refuses the command, and when it times out", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  const refused = session.prompt("first", BOUND_MS);
  await omp.commandsWritten(1);
  omp.emit({ type: "response", id: "p1", command: "prompt", success: false, error: "no model" });
  await assert.rejects(refused, /Omp refused prompt p1: .*no model/);
  await assert.rejects(session.prompt("second", 15), /timed out after 15 ms while waiting for prompt p2 "second"/);
  await omp.commandsWritten(2);
  assert.equal(omp.commands[1]?.["id"], "p2");
});

void test("signal reaches the Omp process, and a write after the process has gone is recorded rather than thrown", async () => {
  const omp = new FakeOmp();
  const session = omp.session();
  assert.equal(session.signal("SIGHUP"), true);
  assert.deepEqual(omp.kills, ["SIGHUP"]);
  omp.stdin.end();
  session.send({ type: "late" });
  await session.waitFor((s) => s.stderr().includes("stdin error"), BOUND_MS, "the recorded stdin error");
});

void test("close ends stdin and returns the exit of a process that leaves on its own, without signals", async () => {
  const omp = new FakeOmp();
  omp.stdin.on("end", () => {
    omp.finish({ code: 0, signal: null });
  });
  const session = omp.session();
  const exit = await within(session.close(), BOUND_MS, "close");
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.deepEqual(omp.kills, []);
  assert.deepEqual(await session.close(), { code: 0, signal: null });
});

void test("close escalates to SIGTERM when stdin is ignored, and stops there when the process leaves", async () => {
  const omp = new FakeOmp();
  omp.onKill = (signal) => {
    if (signal === "SIGTERM") {
      omp.finish({ code: null, signal });
    }
  };
  const exit = await within(omp.session().close({ graceMs: 10, termMs: BOUND_MS }), BOUND_MS, "close");
  assert.deepEqual(exit, { code: null, signal: "SIGTERM" });
  assert.deepEqual(omp.kills, ["SIGTERM"]);
});

void test("close escalates to SIGKILL when SIGTERM is ignored too", async () => {
  const omp = new FakeOmp();
  omp.onKill = (signal) => {
    if (signal === "SIGKILL") {
      omp.finish({ code: null, signal });
    }
  };
  const exit = await within(omp.session().close({ graceMs: 10, termMs: 10, killMs: BOUND_MS }), BOUND_MS, "close");
  assert.deepEqual(exit, { code: null, signal: "SIGKILL" });
  assert.deepEqual(omp.kills, ["SIGTERM", "SIGKILL"]);
});

void test("close rejects, bounded, when the process survives SIGKILL", async () => {
  const omp = new FakeOmp();
  await assert.rejects(omp.session().close({ graceMs: 5, termMs: 5, killMs: 5 }), /Omp is still running after SIGKILL while waiting for close/);
  assert.deepEqual(omp.kills, ["SIGTERM", "SIGKILL"]);
});

// ---- startOmp against a real spawned script --------------------------------------------------------------------------------

// A stand-in for Omp: a node script that prints a ready frame describing how it was started, some noise, answers a prompt with a tool
// call and an agent_end, and leaves when its stdin ends. Run through the wrap option, so no Omp binary is needed.
const FAKE_OMP_SOURCE = `
const out = (frame) => process.stdout.write(JSON.stringify(frame) + "\\n");
out({ type: "ready", argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env).sort() });
process.stdout.write("progress noise\\n");
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const command = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    if (command.type === "prompt") {
      out({ type: "tool_execution_start", toolCallId: "c1", toolName: "write", args: { message: command.message } });
      out({ type: "tool_execution_end", toolCallId: "c1", toolName: "write", isError: true, result: { content: [{ type: "text", text: "blocked" }] } });
      out({ type: "agent_end", isTerminal: true });
    }
    newline = buffer.indexOf("\\n");
  }
});
process.stdin.on("end", () => process.exit(0));
`;

void test("startOmp spawns the wrapped command with exactly the given environment and cwd, and drives it to a clean close", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlv-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const script = join(dir, "fake-omp.cjs");
  writeFileSync(script, FAKE_OMP_SOURCE);
  const session = startOmp({
    bin: "omp-under-test",
    env: { OMP_TEST_MARK: "1" },
    cwd: dir,
    extensionPath: "/ext/extension.js",
    wrap: [process.execPath, script, "--"],
  });
  t.after(async () => {
    await session.close({ graceMs: 100, termMs: 100, killMs: 1000 });
  });
  await session.ready(BOUND_MS);
  const ready = session.frames[0];
  assert.deepEqual(ready?.["argv"], ["--", "omp-under-test", ...ompArgs("/ext/extension.js")]);
  assert.equal(ready["cwd"], dir);
  const names = ready["env"] as string[];
  assert.ok(names.includes("OMP_TEST_MARK"));
  assert.equal(names.includes("HOME"), false);
  await session.waitFor((s) => s.nonJsonLines.length === 1, BOUND_MS, "the noise line");
  assert.deepEqual(session.nonJsonLines, ["progress noise"]);

  const outcome = await session.prompt("WRITE x y", BOUND_MS);
  assert.deepEqual(outcome.toolStarts, [{ toolCallId: "c1", toolName: "write", args: { message: "WRITE x y" } }]);
  assert.deepEqual(
    outcome.toolEnds.map((end) => [end.isError, end.text]),
    [[true, "blocked"]],
  );
  const exit = await within(session.close(), BOUND_MS, "close");
  assert.deepEqual(exit, { code: 0, signal: null });
});

void test("startOmp reports a binary that does not exist through the waits instead of throwing", async () => {
  const session = startOmp({
    bin: "omp-under-test",
    env: {},
    cwd: tmpdir(),
    extensionPath: "/ext/extension.js",
    wrap: [join(tmpdir(), "rlv-no-such-wrapper")],
  });
  await assert.rejects(session.ready(BOUND_MS), /Omp exited \(could not start: .*ENOENT/);
  const exit = await session.exited;
  assert.equal(exit.code, null);
  assert.match(exit.error ?? "", /ENOENT/);
});

// ---- Review round 1: relative binary, one version probe, cleanups, evidence, turn proof, process group -------------------------

void test("ompBinary resolves a path against the given directory once, and leaves a bare name and an absolute path alone", () => {
  assert.equal(ompBinary({ [OMP_BIN_VARIABLE]: "./node_modules/.bin/omp" }, "/work/repo"), "/work/repo/node_modules/.bin/omp");
  assert.equal(ompBinary({ [OMP_BIN_VARIABLE]: "../bin/omp" }, "/work/repo"), "/work/bin/omp");
  assert.equal(ompBinary({ [OMP_BIN_VARIABLE]: "/opt/omp/bin/omp" }, "/work/repo"), "/opt/omp/bin/omp");
  assert.equal(ompBinary({ [OMP_BIN_VARIABLE]: "omp-nightly" }, "/work/repo"), "omp-nightly");
  assert.equal(ompBinary({ [OMP_BIN_VARIABLE]: "" }, "/work/repo"), "omp");
  assert.equal(ompBinary({}, "/work/repo"), "omp");
  // Without a directory the process's working directory is the base.
  assert.equal(ompBinary({ [OMP_BIN_VARIABLE]: "./omp" }), join(process.cwd(), "omp"));
});

void test("collectOmpGateInputs runs a relative REALM_OMP_BIN from the resolved absolute path, and the gate accepts it", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlv-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const executable = join(dir, "omp-relative");
  writeFileSync(executable, "#!/bin/sh\necho omp/18.12.6\n");
  chmodSync(executable, 0o755);
  const env = { [LIVE_OMP_VARIABLE]: "1", [OMP_BIN_VARIABLE]: "./omp-relative", PATH: "/usr/bin:/bin" };
  const inputs = await collectOmpGateInputs(env, { platform: "linux", trace: false, cwd: dir, extensionPath: executable });
  assert.equal(inputs.bin, executable);
  assert.deepEqual(inputs.version, { kind: "output", stdout: "omp/18.12.6\n" });
  assert.equal(ompSkipReason(inputs), undefined);
});

void test("the version probe runs once per binary however often the inputs are collected, and is bounded by the scaled base", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlv-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const counted = join(dir, "omp-counted");
  writeFileSync(counted, "");
  const other = join(dir, "omp-other");
  writeFileSync(other, "");
  const spawned: { file: string; timeoutMs: number }[] = [];
  const runner: CommandRunner = (file, _args, options) => {
    spawned.push({ file, timeoutMs: options.timeoutMs });
    return Promise.resolve({ exitCode: 0, stdout: "omp/18.12.6\n", stderr: "" });
  };
  const env = { [LIVE_OMP_VARIABLE]: "1", [OMP_BIN_VARIABLE]: counted, PATH: "" };
  const first = await collectOmpGateInputs(env, { platform: "linux", trace: false, runner });
  const second = await collectOmpGateInputs(env, { platform: "linux", trace: true, runner });
  const third = await ompVersionOnce(counted, { PATH: "" }, { runner });
  assert.deepEqual(spawned, [{ file: counted, timeoutMs: OMP_VERSION_PROBE_TIMEOUT_MS }]);
  assert.deepEqual(first.version, { kind: "output", stdout: "omp/18.12.6\n" });
  assert.deepEqual(second.version, first.version);
  assert.deepEqual(third, first.version);
  assert.equal(OMP_VERSION_PROBE_TIMEOUT_MS, scaledMs(60_000));
  // Strace is not probed without REALM_OMP_NET_TRACE=1: the trace inputs say so instead of running it.
  assert.deepEqual(second.strace, { kind: "missing" });
  assert.match(ompSkipReason({ ...second, extensionPath: counted }) ?? "", /REALM_OMP_NET_TRACE=1 is not set/);
  // Another binary is its own probe.
  await collectOmpGateInputs({ ...env, [OMP_BIN_VARIABLE]: other }, { platform: "linux", trace: false, runner });
  assert.deepEqual(
    spawned.map((entry) => entry.file),
    [counted, other],
  );
});

void test("createCleanups runs every step in reverse even when one throws, then rejects with that error, or an AggregateError for several", async () => {
  const ran: string[] = [];
  const cleanups = createCleanups();
  cleanups.add(() => {
    ran.push("first");
  });
  cleanups.add(() => {
    ran.push("second");
    throw new Error("second failed");
  });
  cleanups.add(async () => {
    await Promise.resolve();
    ran.push("third");
  });
  await assert.rejects(cleanups.run(), /^Error: second failed$/);
  assert.deepEqual(ran, ["third", "second", "first"]);
  await cleanups.run();
  assert.deepEqual(ran, ["third", "second", "first"], "a second run does nothing");

  const several = createCleanups();
  several.add(() => {
    ran.push("a");
    throw new Error("a failed");
  });
  several.add(() => {
    ran.push("b");
    return Promise.reject(new Error("b failed"));
  });
  several.add(() => {
    ran.push("c");
  });
  await assert.rejects(several.run(), (error: unknown) => error instanceof AggregateError && error.errors.length === 2);
  assert.deepEqual(ran.slice(3), ["c", "b", "a"]);
});

void test("writeEvidence reports instead of throwing: a directory that is a regular file, an unwritable name and a producer that throws", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlv-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  assert.deepEqual(writeEvidence(undefined, { "a.txt": () => "x" }), []);
  assert.deepEqual(writeEvidence("", { "a.txt": () => "x" }), []);

  const asFile = join(dir, "not-a-directory");
  writeFileSync(asFile, "i am a file");
  const blocked = writeEvidence(asFile, { "a.txt": () => "x" });
  assert.equal(blocked.length, 1);
  assert.match(blocked[0] ?? "", /evidence directory .* could not be created/);

  const target = join(dir, "evidence", "nested");
  const mixed = writeEvidence(target, {
    "good.txt": () => "kept",
    "bad.txt": () => {
      throw new Error("cannot produce");
    },
    "missing/sub.txt": () => "no such directory",
  });
  assert.equal(readFileSync(join(target, "good.txt"), "utf8"), "kept");
  assert.equal(mixed.length, 2);
  assert.match(mixed.join("\n"), /evidence file bad\.txt was not written: cannot produce/);
  assert.match(mixed.join("\n"), /evidence file missing\/sub\.txt was not written/);
});

void test("a scenario teardown with an evidence directory that is a regular file still closes Omp, disposes the profile and stops the provider", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlv-")));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const asFile = join(dir, "evidence-is-a-file");
  writeFileSync(asFile, "x");
  const calls: string[] = [];
  const reported: string[] = [];
  const compose = (close: () => Promise<unknown>, evidence: Record<string, () => string>): ReturnType<typeof createCleanups> => {
    // The same composition as Scenario.start of the spike: provider, profile, then Omp with its evidence, run in reverse.
    const cleanups = createCleanups();
    cleanups.add(() => {
      calls.push("stop provider");
      return Promise.resolve();
    });
    cleanups.add(() => {
      calls.push("dispose profile");
    });
    cleanups.add(() =>
      closeWithEvidence({
        evidenceDir: asFile,
        evidence,
        report: (problem) => {
          reported.push(problem);
        },
        close,
      }),
    );
    return cleanups;
  };

  await compose(
    () => {
      calls.push("close omp");
      return Promise.resolve({ code: 0, signal: null });
    },
    { "a.log": () => "x" },
  ).run();
  assert.deepEqual(calls, ["close omp", "dispose profile", "stop provider"]);
  assert.equal(reported.length, 1);
  assert.match(reported[0] ?? "", /could not be created/);

  // An evidence producer that throws does not skip the close either; and a close that fails does not skip the rest.
  calls.length = 0;
  reported.length = 0;
  await assert.rejects(
    compose(
      () => {
        calls.push("close omp");
        return Promise.reject(new Error("close failed"));
      },
      {
        "a.log": () => {
          throw new Error("unreadable");
        },
      },
    ).run(),
    /close failed/,
  );
  assert.deepEqual(calls, ["close omp", "dispose profile", "stop provider"]);
});

function turnEnd(stopReason: string, extra: Record<string, unknown> = {}): OmpFrame {
  return { type: "turn_end", message: { role: "assistant", content: [], stopReason, ...extra }, toolResults: [] };
}

void test("turnFailures names a turn that stopped with error or aborted, and nothing for a turn that stopped normally", () => {
  assert.deepEqual(turnFailures([{ type: "agent_start" }, turnEnd("stop"), turnEnd("toolUse"), { type: "agent_end", isTerminal: true }]), []);
  assert.deepEqual(turnFailures([turnEnd("error", { errorMessage: "provider returned 500" })]), ["a turn ended with stopReason error: provider returned 500"]);
  assert.deepEqual(turnFailures([turnEnd("aborted")]), ["a turn ended with stopReason aborted"]);
  assert.deepEqual(turnFailures([{ type: "turn_end" }, { type: "turn_end", message: "text" }]), []);
});

void test("scriptedTurnProblem proves a turn only when the provider saw the prompt, a turn stopped normally and none failed", () => {
  const seen = [{ userText: "hello" }];
  const answered: OmpFrame[] = [{ type: "agent_start" }, turnEnd("stop"), { type: "agent_end", isTerminal: true }];
  assert.equal(scriptedTurnProblem({ prompt: "hello", requests: seen, frames: answered }), undefined);

  const failed = scriptedTurnProblem({ prompt: "hello", requests: seen, frames: [turnEnd("error", { errorMessage: "boom" })] });
  assert.match(failed ?? "", /stopReason error: boom/);
  assert.match(failed ?? "", /no turn ended with stopReason stop/);
  assert.match(failed ?? "", /1 frames; last 1:/);

  const unseen = scriptedTurnProblem({ prompt: "hello", requests: [{ userText: "something else" }], frames: answered });
  assert.match(unseen ?? "", /received no request for the prompt "hello"/);
  assert.match(scriptedTurnProblem({ prompt: "hello", requests: [], frames: [] }) ?? "", /received no request.*no turn ended with stopReason stop.*0 frames; last 0: \(none\)/);
});

void test("summariseFrames keeps the last frames, clipped", () => {
  const frames: OmpFrame[] = Array.from({ length: 10 }, (_unused, index) => ({ type: "n", index, pad: "x".repeat(500) }));
  const summary = summariseFrames(frames, 2);
  assert.match(summary, /^10 frames; last 2: /);
  assert.match(summary, /"index":8/);
  assert.match(summary, /"index":9/);
  assert.equal(summary.includes('"index":7'), false);
  assert.ok(summary.includes("..."));
});

// A process that ignores end of input and SIGTERM, with a child that does the same and holds the same output pipe.
const STUBBORN_SOURCE = `
const { spawn } = require("node:child_process");
const GRANDCHILD = 'process.on("SIGTERM", () => {}); process.stdout.write(JSON.stringify({ type: "grandchild_up", pid: process.pid }) + "\\\\n"); setInterval(() => {}, 1000);';
process.on("SIGTERM", () => {});
process.stdin.on("data", () => {});
process.stdin.on("end", () => {});
const grandchild = spawn(process.execPath, ["-e", GRANDCHILD], { stdio: ["ignore", "inherit", "inherit"] });
process.stdout.write(JSON.stringify({ type: "ready", pid: process.pid, grandchild: grandchild.pid }) + "\\n");
setInterval(() => {}, 1000);
`;

// Whether the process is running. A zombie that nothing has reaped has exited, so it does not count.
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
  try {
    return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${String(pid)}/stat`, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

void test(
  "close ends a command that ignores end of input and SIGTERM, and the child it started, by signalling the process group",
  { skip: existsSync("/proc/self/stat") ? false : "needs /proc to tell a running process from an exited one" },
  async (t) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "rlv-")));
    t.after(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const script = join(dir, "stubborn.cjs");
    writeFileSync(script, STUBBORN_SOURCE);
    const session = startOmp({ bin: "omp-under-test", env: {}, cwd: dir, extensionPath: "/ext/extension.js", wrap: [process.execPath, script, "--"] });
    const pids: number[] = [];
    t.after(async () => {
      // Safety net for a failing test: nothing may outlive it.
      await session.close({ graceMs: 100, termMs: 100, killMs: scaledMs(2000) }).catch(() => undefined);
      for (const pid of pids) {
        if (isAlive(pid)) {
          process.kill(pid, "SIGKILL");
        }
      }
    });
    await session.ready(scaledMs(BOUND_MS));
    await session.waitFor((s) => s.frames.some((frame) => frame["type"] === "grandchild_up"), scaledMs(BOUND_MS), "the grandchild to start");
    const leader = session.frames.find((frame) => frame["type"] === "ready")?.["pid"];
    const grandchild = session.frames.find((frame) => frame["type"] === "grandchild_up")?.["pid"];
    assert.equal(typeof leader, "number");
    assert.equal(typeof grandchild, "number");
    pids.push(leader as number, grandchild as number);
    assert.ok(isAlive(leader as number) && isAlive(grandchild as number));

    const exit = await within(session.close({ graceMs: scaledMs(100), termMs: scaledMs(100), killMs: scaledMs(5000) }), scaledMs(BOUND_MS), "close");
    assert.equal(exit.signal, "SIGKILL");
    await pollUntil(() => !isAlive(leader as number) && !isAlive(grandchild as number), "the command and its child to be gone", { timeoutMs: BOUND_MS });
  },
);
