# Omp lifecycle runbook: watch the plugin attach, and check what survives an abrupt end

Purpose. Repeat on a real host the checks recorded in `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/LIVE-VERIFICATION.md`: that an Omp session attaches the sandbox by itself, how the write and edit guard behaves in both policy modes, and what survives when Omp, the daemon or the sandbox ends abruptly. The recorded results are the "expected" column below.

What this does not show. Omp's own tools (`bash`, `eval`, and the rest) run on the host even while the realm is active; the extension attaches the sandbox, shows its status and gates only `write` and `edit` (`docs/integration/omp.md`). The model-free checks use a scripted provider, so they are not an LLM-driven run: OMP-05's status is the owner's decision.

## Prerequisites

- **Run this on a dedicated account or VM where no other Realm session exists.** Starting a daemon, even with its own `stateDir`, removes every Realm sandbox on the Podman socket it uses: the startup reap lists every OpenShell-managed container whose sandbox name carries the realm prefix and removes it with `force`, whoever owns it (`src/session/reap.ts:33-39`, `src/runtime/sweep.ts:33-56`). That stops another session's sandbox and erases its files outside `/workspace`. Before step A or B, confirm that the container list (see "Useful probes") is empty and that `ss -xlpn | grep control.sock` prints nothing. If either shows a Realm sandbox or daemon that is not yours, stop.
- The production stack from `docs/integration/openshell.md`: rootless Podman 5.x, the OpenShell 0.1.5 gateway, the Realm compute driver, and the digest-pinned sandbox image.
- A built checkout (`npm ci && npm run build`) or an installed release, and Omp 18.12.6 or later.
- A throwaway check directory `<check-dir>` holding `c/realm/config.json` (`image`, `stateDir`, `workspaceRoot`), `<check-dir>/state` with mode 0700 and a `policy.json` of `{"workspaceRoots":["<workspace>"]}`, and an Omp agent directory `<check-dir>/agent`. `<workspace>` is the pinned workspace root; start Omp in exactly that directory.
- Keep `HOME` as the real home. The OpenShell CLI reads its gateway registration from it (`src/runtime/session-execution.ts:72`).
- Never signal a process you did not start. Do not run the checks inside the agent session that you are working in.

Environment for every command below:

```sh
export XDG_CONFIG_HOME=<check-dir>/c
export PI_CODING_AGENT_DIR=<check-dir>/agent
export XDG_RUNTIME_DIR=/run/user/<uid>
export REALM_DRIVER_STATE_ROOT=<driver state root>
export REALM_DRIVER_SECRET_ROOT=<driver secret root>
export REALM_DRIVER_WORKSPACE_ROOT=<workspace>
```

Useful probes: `realm status` (prints the snapshot, the label and the policy mode), the container list through the Podman API socket (`curl -s --unix-socket "$XDG_RUNTIME_DIR/podman/podman.sock" "http://d/v5.0.0/libpod/containers/json?all=true"`), and the daemon's pid (`ss -xlpn | grep <check-dir>/state/run/control.sock`).

## A. Watch the attach (needs a model account)

Follow steps 1 to 8 of "Live Omp checks (2026-10-28)" in `docs/integration/omp.md`: a pseudo-terminal session, the status item, `realm down`, `/realm-retry`, quit. With a provider key, also ask the model to create a file once the item reads active (the guard allows it), and once after `realm down` (advisory mode: allowed with a notice).

## B. The write guard without a model (scripted provider)

1. Save the provider in the appendix as `scripted-provider.mjs`. It answers a prompt `WRITE <path> <content>` with one call to Omp's own `write` tool, and the follow-up with plain text.
2. Put this in `$PI_CODING_AGENT_DIR/models.yml`:

```yaml
providers:
  stub:
    baseUrl: http://127.0.0.1:18911/v1
    api: openai-completions
    apiKey: dummy
    models:
      - id: scripted
        name: Scripted
        contextWindow: 32000
        maxTokens: 4000
```

3. Start the provider (`node scripted-provider.mjs 18911 requests.jsonl &`) and Omp in RPC UI mode from `<workspace>`:
   `omp --mode rpc-ui --no-extensions -e <repo>/dist/src/omp/extension.js --model stub/scripted --no-session`.
   Write one JSON object per line on its stdin; read its stdout. Status frames are `extension_ui_request` with `method` `setStatus` and `statusKey` `realm`; notices have `method` `notify`; a tool result is `tool_execution_end`.
4. Send `{"id":"p1","type":"prompt","message":"WRITE guard-active.txt written-while-active"}` once the item reads `● realm active`.
5. Run `realm down`. Send `WRITE guard-advisory.txt written-while-disconnected`.
6. Set `"mode": "fail-closed"` in `<check-dir>/state/policy.json`. Send `/realm-retry`, wait for active, send `WRITE guard-closed-active.txt ok`, run `realm down`, send `WRITE guard-blocked.txt must-not-exist`.

| Step | Expected | Failure sign |
|---|---|---|
| 3, 4 | status moves from `○ realm disconnected · connecting` to `● realm active · container running`; the write succeeds and the file exists | status stays `connecting` beyond the 200 s budget, or ends with a code such as `POLICY_DENIED`, `SCHEMA_INVALID` or `PODMAN_MACHINE_DOWN` (see `SANDBOX-LIFECYCLE-FINDINGS.md`, section 4) |
| 5 | status `○ realm disconnected · REALM_NOT_ACTIVE`; a notice `realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy`; the file exists | the write fails, or no notice appears |
| 6 | the write while active succeeds; the write while disconnected ends with `isError` true and the text `REALM_NOT_ACTIVE`; `guard-blocked.txt` does not exist | the file exists |

The first request that the provider logs lists the tools Omp offered the model: expect Omp's own tools only, with no Realm tool.

## C. Abrupt ends

Start an Omp session as in B (or in a terminal) and wait for active; note the container id and the daemon pid. Then, one case per fresh session, signal only the Omp process you started:

| Action | Expected |
|---|---|
| `kill -HUP <omp pid>` (what a closed terminal sends) | Omp exits with code 129; the daemon pid and the container id are unchanged; `realm status` is active; files written before the signal are in `<workspace>` |
| `kill -KILL <omp pid>` | the same, with Omp ended by the signal |
| start another Omp session | it reaches active in about 10 to 20 s on a quiet host and the container id is unchanged |

Then, with the realm up, write files three ways through `realm mcp` (an MCP client over stdio; the tools are `write` with `{path, content}` and `exec` with `{argv}`): one through `write`, and one `exec` writing to `/workspace` and one to the sandbox's scratch directory. Record `sha256sum` of the workspace files and the container id.

| Action | Expected |
|---|---|
| `kill -KILL <daemon pid>` | the daemon is gone and `realm status` prints `disconnected`; the container is still running and still holds the scratch file; the workspace files are identical |
| `realm up` | one new container with a different id; the `/workspace` file is readable in it; the scratch file is gone; the workspace files are identical |
| `kill -TERM <daemon pid>` | the daemon exits and the container is removed within about 30 s; the workspace files are identical |

## D. Realm's write path under process death

Save the script in the appendix as `atomic-kill-test.mjs` and run `node atomic-kill-test.mjs <repo>/dist/src/fs/atomic-write.js`. Expected: for each of the four stages the child ends by SIGKILL, the target keeps `OLD-CONTENT`, one `.target.txt.realm-tmp-*` file holds the new content, and a later clean write by the writer itself leaves that orphan in place (the writer never removes another process's temp file); the no-kill control leaves none. A change in that output means the write path changed.

Who removes the orphan: the sweep in `src/fs/temp-sweep.ts` (`sweepOrphanTempFiles`), which the daemon runs at every start, after the startup reap and before it serves (`runStartupMaintenance`, `src/daemon/daemon.ts`; `docs/integration/runtime-decision.md`, "Startup maintenance (Phase 14, CRASH-04)"). It walks `policy.workspaceRoots`, `<stateDir>/sessions`, `<stateDir>/runtime` and `<stateDir>/audit`. It removes only a regular file named exactly `.<name>.realm-tmp-<16 lowercase hex>`, owned by the daemon's uid, on the root's device, reached through a pinned directory descriptor and never through a symlink, and only once it is older than the 60 s bound (`ORPHAN_TEMP_MIN_AGE_MS`). The sweep and the audit reconciliation share a 10 s start budget (`STARTUP_MAINTENANCE_BUDGET_MS`): a root the sweep does not reach in time is left for the next start and is named, with any unfinished audit log, in the `daemon.log` startup line (`maintenanceComplete=false`). It writes one audit line (`tool: "temp-sweep"`) before each removal. The same start reconciles the audit log: an admission line with no result line gets one `AUDIT_OUTCOME_UNKNOWN` reconciliation line (`src/audit/reconcile.ts`). The daemon writes one line per start to `<stateDir>/daemon.log`, of the form `realm daemon: startup removed <n> container(s) and <m> session record(s); removed <t> orphan temp file(s); reconciled <a> audit admission(s)`, with a `; <f> startup failure(s)` clause when a step failed. Expected: the next daemon start removes the orphan once it is older than 60 s, and the `daemon.log` line counts it; a start inside the first 60 s keeps it and a later start removes it. This expectation is VERIFIED_BY_CODE_READING of the daemon and the sweep, and has not been run live (INFERENCE until it is). The four stages above are also exercised on every test run by `test/fs/atomic-write-sigkill.test.ts` (VERIFIED_BY_CODE_READING of the test, not yet by execution). A kill after the `rename` cannot be hooked; by `rename(2)` atomicity the target then holds either the old or the new bytes and there is no orphan (INFERENCE).

## Cleanup

Run `realm down`, stop the provider and Omp, remove the files you wrote from `<workspace>` and the check directory, and confirm that `realm status` prints `disconnected` and the container list is empty.

## Appendix 1. `scripted-provider.mjs`

```js
// Scripted OpenAI-compatible chat-completions server for a live Omp check. No model, no credentials, no tokens.
// A user prompt "WRITE <path> <content>" is answered with one tool call to Omp's own write tool; the follow-up request
// that carries the tool result is answered with plain text. Everything else is answered with "ack".
import http from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.argv[2] ?? 18911);
const logFile = process.argv[3] ?? "stub-requests.jsonl";
const log = (o) => appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), ...o })}\n`);

function userText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => p?.text ?? "").join("");
  }
  return "";
}

function json(res, value, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function respond(res, req, plan) {
  const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
  const created = Math.floor(Date.now() / 1000);
  const model = req.model ?? "scripted";
  if (req.stream === true) {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (delta, finish = null) =>
      res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    if (plan.call) {
      send({ role: "assistant", content: null, tool_calls: [{ index: 0, id: `call_${id.slice(-6)}`, type: "function", function: { name: plan.call.name, arguments: "" } }] });
      send({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(plan.call.args) } }] });
      send({}, "tool_calls");
    } else {
      send({ role: "assistant", content: "" });
      send({ content: plan.text });
      send({}, "stop");
    }
    res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }
  const message = plan.call
    ? { role: "assistant", content: null, tool_calls: [{ id: "call_x", type: "function", function: { name: plan.call.name, arguments: JSON.stringify(plan.call.args) } }] }
    : { role: "assistant", content: plan.text };
  json(res, { id, object: "chat.completion", created, model, choices: [{ index: 0, message, finish_reason: plan.call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/v1/models")) {
      json(res, { object: "list", data: [{ id: "scripted", object: "model" }] });
      return;
    }
    if (req.method === "POST" && req.url.startsWith("/v1/chat/completions")) {
      let body = "";
      req.on("data", (d) => {
        body += d;
      });
      req.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          json(res, { error: { message: "bad json" } }, 400);
          return;
        }
        const messages = parsed.messages ?? [];
        const tools = (parsed.tools ?? []).map((t) => t?.function?.name);
        const last = messages[messages.length - 1] ?? {};
        const text = userText(messages);
        const match = /WRITE (\S+) ([^\n]*)/.exec(text);
        let plan;
        if (last.role === "tool") plan = { text: "done" };
        else if (match && tools.includes("write")) plan = { call: { name: "write", args: { path: match[1], content: match[2] } } };
        else plan = { text: "ack" };
        log({
          kind: "request",
          stream: parsed.stream === true,
          lastRole: last.role,
          messages: messages.length,
          tools,
          userHead: text.slice(0, 160),
          writeParameters: JSON.stringify((parsed.tools ?? []).find((t) => t?.function?.name === "write")?.function?.parameters ?? null).slice(0, 500),
          plan: plan.call ? `tool_call ${plan.call.name} ${JSON.stringify(plan.call.args)}` : `text ${plan.text}`,
        });
        respond(res, parsed, plan);
      });
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(port, "127.0.0.1", () => log({ kind: "listening", port }));
```

## Appendix 2. `atomic-kill-test.mjs`

```js
// Real process-death test of src/fs/atomic-write.ts (built: dist/src/fs/atomic-write.js). A child process SIGKILLs itself at
// each hookable stage of one atomic write; the parent then inspects the directory. Throwaway directory, outside the repo.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MODULE = pathToFileURL(process.argv[2]).href; // the built <repo>/dist/src/fs/atomic-write.js
const OLD = "OLD-CONTENT";
const sha = (s) => createHash("sha256").update(s).digest("hex");
const root = realpathSync(mkdtempSync(join(tmpdir(), "rk-")));
const child = `
import { atomicWriteFile } from ${JSON.stringify(MODULE)};
const [target, content, killAt, prior] = process.argv.slice(1);
atomicWriteFile(target, content, {
  expectedPriorSha256: prior,
  stageHook: (stage) => { if (stage === killAt) process.kill(process.pid, "SIGKILL"); },
});
console.log("completed");
`;
const rows = [];
try {
  for (const stage of ["after-temp-write", "after-fsync", "before-rename", "after-recheck", "(no kill)"]) {
    const dir = join(root, stage.replace(/[^a-z-]/g, "_"));
    mkdirSync(dir);
    const target = join(dir, "target.txt");
    writeFileSync(target, OLD);
    const content = `NEW-CONTENT-${stage}`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", child, target, content, stage, sha(OLD)], { encoding: "utf8", timeout: 30000 });
    const names = readdirSync(dir).sort();
    const orphans = names.filter((n) => n.includes(".realm-tmp-"));
    rows.push({
      killedAt: stage,
      childExit: r.signal ?? `exit ${r.status}${r.stdout.includes("completed") ? " (completed)" : ""}`,
      target: readFileSync(target, "utf8"),
      orphanTempFiles: orphans.length,
      orphanContent: orphans.length ? readFileSync(join(dir, orphans[0]), "utf8") : null,
    });
    // A later, clean write to the same target: does anything remove the orphan?
    if (orphans.length) {
      const r2 = spawnSync(process.execPath, ["--input-type=module", "-e", child, target, "SECOND-WRITE", "(none)", sha(readFileSync(target, "utf8"))], { encoding: "utf8", timeout: 30000 });
      rows[rows.length - 1].secondWrite = `${r2.stdout.trim() || r2.stderr.trim().slice(0, 80)} -> target ${JSON.stringify(readFileSync(target, "utf8"))}, orphans left ${readdirSync(dir).filter((n) => n.includes(".realm-tmp-")).length}`;
    }
  }
  for (const row of rows) console.log(JSON.stringify(row));
} finally {
  rmSync(root, { recursive: true, force: true });
}
```
