# Omp lifecycle runbook: watch the plugin attach, and check what survives an abrupt end

Purpose. The manual sections A–D preserve the historical checks recorded in `.planning/quick/261029-g7m-lifecycle-and-persistence-findings/LIVE-VERIFICATION.md`: attach, the original native-tool guard, and abrupt process endings. Their recorded expectations predate Realm's registered `read`/`write` shadowing; they are not a current four-case pass. For the current registered-write and native-edit checks, use "The gated guard suite" below.

Scope. A disconnected registered Realm `write` is refused in both policy modes, without a host fallback or host advisory notice. The retained native `edit` is a separate advisory host path, exercised by C4 below. The hermetic suite uses a real Omp process and a fake-backed daemon, not the production sandbox; it cannot establish OMPX-05's real `/workspace` and paired-audit acceptance. A scripted provider is not an LLM-driven run. Guard results, production containment/audit evidence and HARN-03 network evidence must remain distinct (`docs/integration/omp.md`).

## Prerequisites for manual sections A–D

- **Run this on a dedicated account or VM where no other Realm session exists.** Starting a daemon, even with its own `stateDir`, removes every Realm sandbox on the Podman socket it uses: the startup reap lists every OpenShell-managed container whose sandbox name carries the realm prefix and removes it with `force`, whoever owns it (`src/session/reap.ts:33-39`, `src/runtime/sweep.ts:33-56`). That stops another session's sandbox and erases its files outside `/workspace`. Before step A or B, confirm that the container list (see "Useful probes") is empty and that `ss -xlpn | grep control.sock` prints nothing. If either shows a Realm sandbox or daemon that is not yours, stop.
- The production stack from `docs/integration/openshell.md`: rootless Podman 5.x, the OpenShell 0.1.5 gateway, the Realm compute driver, and the digest-pinned sandbox image.
- A built checkout (`npm ci && npm run build`) or an installed release, and Omp 18.12.6 or later.
- A throwaway check directory `<check-dir>` holding `c/realm/config.json` (`image`, `stateDir`, `workspaceRoot`), `<check-dir>/state` with mode 0700 and a `policy.json` of `{"workspaceRoots":["<workspace>"]}` (no `mode`, so the default `fail-closed` applies until a step sets another), and an Omp agent directory `<check-dir>/agent`. `<workspace>` is the pinned workspace root; start Omp in exactly that directory.
- Keep `HOME` as the real home. The OpenShell CLI reads its gateway registration from it (`src/runtime/session-execution.ts:72`).
- Never signal a process you did not start. Do not run the checks inside the agent session that you are working in.

Environment for every command below:

```sh
export XDG_CONFIG_HOME=<check-dir>/c
export PI_CODING_AGENT_DIR=<check-dir>/agent
export XDG_RUNTIME_DIR=/run/user/<uid>
```

The secret, workspace and sandbox-state roots come from `<check-dir>/c/realm/config.json`. A stale `REALM_DRIVER_SECRET_ROOT`, `REALM_DRIVER_WORKSPACE_ROOT` or `REALM_DRIVER_STATE_ROOT` variable is ignored.

Useful probes: `realm status` (prints the snapshot, the label and the policy mode), the container list through the Podman API socket (`curl -s --unix-socket "$XDG_RUNTIME_DIR/podman/podman.sock" "http://d/v5.0.0/libpod/containers/json?all=true"`), and the daemon's pid (`ss -xlpn | grep <check-dir>/state/run/control.sock`).

## A. Watch the attach (needs a model account)

Follow steps 1 to 8 of "Live Omp checks (2026-10-28)" in `docs/integration/omp.md`: a pseudo-terminal session, the status item, `realm down`, `/realm-retry`, quit. With a provider key, also ask the model to create a file once the item reads active (the guard allows it), and once after `realm down` (the default fail-closed mode blocks it with `REALM_NOT_ACTIVE`; with the explicit `"mode": "advisory"` in the policy file it is allowed with a notice).

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
5. Run `realm down`. Send `WRITE guard-default.txt must-not-exist`. The policy has no `mode`, so the default `fail-closed` applies.
6. Set `"mode": "advisory"` in `<check-dir>/state/policy.json`. Send `/realm-retry`, wait for active, run `realm down`, send `WRITE guard-advisory.txt written-while-disconnected`.

| Step | Expected | Failure sign |
|---|---|---|
| 3, 4 | status moves from `○ realm disconnected · connecting` to `● realm active · container running`; the write succeeds and the file exists | status stays `connecting` beyond the 200 s budget, or ends with a code such as `POLICY_DENIED`, `SCHEMA_INVALID` or `PODMAN_MACHINE_DOWN` (see `SANDBOX-LIFECYCLE-FINDINGS.md`, section 4) |
| 5 | status `○ realm disconnected · REALM_NOT_ACTIVE`; the write ends with `isError` true and the text `REALM_NOT_ACTIVE`; `guard-default.txt` does not exist | the file exists |
| 6 | status `○ realm disconnected · REALM_NOT_ACTIVE`; a notice `realm status unavailable (REALM_NOT_ACTIVE); the write proceeds under advisory policy`; the file exists | the write fails, or no notice appears |

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

Who removes the orphan: the sweep in `src/fs/temp-sweep.ts` (`sweepOrphanTempFiles`), which the daemon runs at every start, after the startup reap and before it serves (`runStartupMaintenance`, `src/daemon/daemon.ts`; `docs/integration/runtime-decision.md`, "Startup maintenance (Phase 14, CRASH-04)"). It walks `policy.workspaceRoots`, `<stateDir>/sessions`, `<stateDir>/runtime` and `<stateDir>/audit`. It removes only a regular file named exactly `.<name>.realm-tmp-<16 lowercase hex>`, owned by the daemon's uid, on the root's device, reached through a pinned directory descriptor and never through a symlink, and only once it is older than the 60 s bound (`ORPHAN_TEMP_MIN_AGE_MS`). The sweep and the audit reconciliation share a 10 s start budget (`STARTUP_MAINTENANCE_BUDGET_MS`): a root the sweep does not reach in time is left for the next start and is named, with any unfinished audit log, in the `daemon.log` startup record (`maintenanceComplete` false). It writes one audit line (`tool: "temp-sweep"`) before each removal. The same start reconciles the audit log: an admission line with no result line gets one `AUDIT_OUTCOME_UNKNOWN` reconciliation line (`src/audit/reconcile.ts`). The daemon writes one JSON object per start to `<stateDir>/daemon.log`, with `event` `daemon.startup` and the report fields (`containersRemoved`, `recordsDeleted`, `tempFilesRemoved`, `auditLinesReconciled`, `failures`). Expected: the next daemon start removes the orphan once it is older than 60 s, and the `daemon.startup` record counts it; a start inside the first 60 s keeps it and a later start removes it. This expectation is VERIFIED_BY_CODE_READING of the daemon and the sweep, and has not been run live (INFERENCE until it is). The four stages above are also exercised on every test run by `test/fs/atomic-write-sigkill.test.ts` (VERIFIED_BY_CODE_READING of the test, not yet by execution). A kill after the `rename` cannot be hooked; by `rename(2)` atomicity the target then holds either the old or the new bytes and there is no orphan (INFERENCE).


## The gated guard suite

The four cases in `test/integration/omp-guard.test.ts` run against the built Realm plugin. Each writes its policy mode explicitly, starts an in-process daemon over `FakeExecutionService` and `FakeBridge`, and drives a real Omp with the scripted provider. C1–C3 call the registered Realm `write`; C4 calls the retained native `edit`. This is not an LLM-driven run. The isolated profile needs no Podman, gateway or image for these fake-backed cases.

Opt in to C1–C4 with `REALM_LIVE_OMP=1`. `REALM_OMP_BIN` optionally names the Omp executable. Each built-Realm guard profile now opts in to `refuseExternalNetwork`: HTTP(S)/ALL_PROXY (upper- and lowercase) point at the already-listening scripted-provider port, with NO_PROXY/no_proxy limited to `127.0.0.1,localhost`. No ambient credentials or proxy configuration are copied into the child. The helper defaults to false, leaving the separate spike's cold/proxy controls unchanged. This is a harness network control, not an OS egress boundary. Parent verification runs this command only after the joined edit wave and build:

```sh
REALM_LIVE_OMP=1 node --test --test-concurrency=1 dist/test/integration/omp-guard.test.js
```

When `REALM_LIVE_OMP` is unset, or Omp is absent, the file skips and names the first missing prerequisite without starting Omp.

| Case | Script and required observable result |
|---|---|
| C1 | Attach advisory, await active, take the daemon down, call registered `write`. `REALM_NOT_ACTIVE`, `isError: true`, absent target, no host advisory notice. |
| C2 | Attach fail-closed, await active, take the daemon down, call registered `write`. `REALM_NOT_ACTIVE`, `isError: true`, absent target, error on the provider's next request. |
| C3 | Keep the daemon active and call registered `write`. `isError: false`, exact host workspace bytes; record the offered tool names. This fake-backed result is not sandbox containment proof. |
| C4 | Set `PI_EDIT_VARIANT=patch` only for this case's Omp child. Begin with absent `c4-created.txt`; attach advisory, await active, take the daemon down, then call native `edit {path:"c4-created.txt",edits:[{op:"create",diff:"c4\n"}]}`. Require the advisory notice, `isError: false`, exact host bytes `c4\n`, and that successful result in the provider's next request. |

C4 uses the installed native patch variant's supported tag-free CREATE, not a fabricated hashline tag. Realm `read` does not register native edit snapshots, and its SHA-256 is not a native snapshot tag. No Realm-read preflight, snapshot registration workaround or weakened validation is needed.

Current recovery evidence (2026-10-31, parent observations): the former C4 failure on an unissued native snapshot tag is historical; tag-free native CREATE passed on Omp 18.12.6. Earlier joined waves stopped first on two spike optional-chain lint findings, then on the helper assertion-narrowing error, then on three cleanup-callback lint findings. Those failures remain historical receipts, not current blockers. The latest parent union passed typecheck/lint, 2,388 tests (2,358 passed, zero failed, 30 stated skips), 282 script tests, docs checks, four gate-closure modules with zero violations, build, pack and the disconnected MCP catalogue-refusal check. The separate actual live run passed 15 independent cases, including C1–C4, but its two network cases failed before warm measurement: the built-Realm cold provider rejected Omp's legitimate enriched user context, recorded no chat request and timed out. Cold failed; it was not a successful warm-up or skip. None of these observations proves the correction below or a built-Realm warm network pass.

### Built-Realm warm registered-write network proof (HARN-03)

The added case in the same guard suite requires **both** `REALM_LIVE_OMP=1` and `REALM_OMP_NET_TRACE=1`, Linux, Omp 18.12.6 or later, the built `dist/src/omp/extension.js`, strace able to trace, and an executable `podman` on PATH. Existing opt-in/platform/Omp/extension/strace skip precedence is preserved; only after those prerequisites hold does missing Podman report `no podman executable on PATH; HARN-03 requires Podman even with a fake-backed daemon`. This is a presence-only PATH inspection using the existing helper: it never starts Podman, requires no gateway/image/socket, and applies only to this network case. C1–C4 retain their fake-backed non-network prerequisites. Parent verification must exercise both the real network case and its missing-Podman named skip. The parent runs it after building, with `EVIDENCE_DIR` naming a private, owned scratch directory:

```sh
REALM_LIVE_OMP=1 REALM_OMP_NET_TRACE=1 \
  REALM_OMP_EVIDENCE_DIR="$EVIDENCE_DIR" \
  node --test --test-concurrency=1 dist/test/integration/omp-guard.test.js
```

The cold warm-up and measured warm run use the **same** isolated profile and fake-backed daemon, with separate Omp processes wrapped in the existing `traceArgv`. Both use the provider-port refusing control. The provider handler has per-run issue, continuation and done phases: issue exactly one registered write, require the next request to carry a tool result, return the final reply, and reject any extra turn. Omp owns its enriched user context; no assertion pins opaque message forwarding bytes, strips reminder tags or substitutes a substring match as the run binding. Binding instead uses the run's request window, unique tool target/arguments, matching RPC start/end call id, successful Realm daemon outcome and metadata (UTF-8 byte length and SHA-256), exact workspace bytes at an initially absent target, and the same result in the provider's continuation. The exchange must finish with a stop frame and no failed or aborted turns. Text-only prompts, the spike extension and native host write results cannot satisfy those assertions. Only after the actual cold write exchange and bounded close succeed is startup/catalog refresh reported as a distinctly skipped subtest with its reason and raw evidence. Failed cold execution remains failed evidence, never a successful cold skip; warm measurement cannot start without successful warm-up.

The ScriptedProvider HTTP listener also refuses `CONNECT` and absolute-URL proxy requests with 403; it never forwards them. Refusals are recorded separately from chat requests and chat failures, so startup discovery cannot consume a scripted turn. CONNECT sockets have a bounded forced close, and stop reclaims all accepted sockets, including incomplete requests and CONNECT peers. Hermetic tests cover refusal without contacting a real loopback target, subsequent normal chats on the same endpoint, half-open/incomplete-peer cleanup, default opt-out and ambient credential/proxy isolation through an actual spawned child. No tests or checks are run by this edit-only worker; parent union verification and actual traced network acceptance remain distinct.

The allowlist is exactly `defaultAllow(stubPort)`: the existing stub port plus the documented discovery ports 11434, 8080, 1234 and 9931 (9931 is llama.cpp's newer default, found in Omp 18.15.0's binary; owner decision on the D-1205 amendment, 2026-11-11). There is no extra proxy listener/port exemption, no external-host exemption and no DNS exemption. The warm trace must show **zero external, zero DNS and zero offenders**, and must include the stub port. This observes attempted socket peers for the whole measured Omp process (including startup/shutdown), not merely the file-writing interval. It does not prove that uncooperative software cannot bypass proxy environment variables.

Evidence names are `built-realm-cold.*` and `built-realm-warm.*`: Omp version, raw `.strace`, RPC `.frames.jsonl`, stderr, `.requests.json`, `.provider-failures.json`, `.proxy-refusals.json` and `.summary.json` with the unchanged allowlist, scope, prompt and call. Summaries retain script phase, whether the registered-write proof completed and whether process close completed; failed execution or close is labelled failed, not skipped. Evidence capture is attempted even if assertions or close fail; capture failures are diagnostics, not invented proof. Parent must retain the actual files, require the completed measured warm subtest and inspect any capture diagnostics before accepting HARN-03.

**Status: one human-approved bounded correction authored; parent tracing pending.** The actual failed built-Realm cold run and unexecuted warm measurement remain the latest network observations. The historical spike warm result (38 external + 6 DNS = 44 offenders), separate cold skip (49 offenders) and separate proxy lever (zero external, zero DNS, seven CONNECT refusals) remain history. A second allowed proxy port or a spike status call is not literal built-Realm warm proof. No network pass, gate clearance or phase closure is claimed here; another failure requires a new explicit decision, not automatic rework.

This is real Omp plus the built extension, but its daemon uses `FakeExecutionService` and `FakeBridge`: it is a **guard/network proof, not production containment or production audit acceptance**. Separate parent evidence established generated-config `init` (fail-closed), `up`/`status` (active), `down` (unbound), and existing production crash/reap/reattach and MCP exec/write/read cases with the temporary rebuilt driver. That does not prove a released installer provisions the production stack, nor does any earlier production pass prove this new measured warm case or OMPX-05's paired production audit requirements.

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
