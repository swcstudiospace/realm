// Harness for the capability-token wire and end-to-end tests (CAPT-06, CAPT-07). It starts a real daemon on a real Unix socket in
// a temporary state directory, with the fake runtime seams of the daemon tests, an injected clock, a recording runner and a
// logger that keeps every line. It sends real control requests, attaches as a host, sends tool requests with a chosen
// token, reads the audit file and the daemon log, rotates the keyring, and recomputes or forges a token with the real keys.
// A second workspace lets a test admit two sessions on one daemon.

import { Buffer } from "node:buffer";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { mintToken, TOKEN_PREFIX, type MintClaims } from "../../src/capability/token.js";
import { keyringPathOf, rotateKeyring } from "../../src/capability/keyring.js";
import { validate, type Policy } from "../../src/contract/validate.js";
import { sendRequest, type ControlReply, type ControlSelection } from "../../src/daemon/channel.js";
import { selectionOf } from "../../src/daemon/client.js";
import { startDaemon, type StartedDaemon, type StartDaemonOptions } from "../../src/daemon/daemon.js";
import { createLogger } from "../../src/observe/logger.js";
import type { ToolOutcome } from "../../src/tools/dispatch.js";
import type { PodmanProbeResult } from "../../src/runtime/podman-probe.js";
import { FakeExecutionService } from "./fake-execution.js";
import { boundedWait } from "./timing.js";

export const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;

export interface RigOptions {
  // The capabilityTokens policy member. Absent: the policy omits it, so the default applies (mode enforce, D34-1); a rig that
  // wants the opt-out passes mode off explicitly.
  readonly capabilityTokens?: {
    readonly mode: "off" | "enforce";
    readonly ttlSeconds?: number;
    readonly profiles?: Readonly<Record<string, readonly string[]>>;
  };
  readonly shellEnabled?: boolean;
}

// The environment the CLI entry reads (the runtime config that names this rig's state directory).
export interface CliWorld {
  readonly env: Record<string, string>;
  readonly daemonEntry: string;
}

export interface Rig {
  readonly base: string;
  readonly stateDir: string;
  readonly workspace: string;
  readonly otherWorkspace: string;
  readonly daemon: StartedDaemon;
  readonly socketPath: string;
  readonly policy: Policy;
  // The fake execution service the daemon runs on: a test holds a create, reads the calls the daemon made, or fails one.
  readonly exec: FakeExecutionService;
  // Raw tool objects that reached a dispatcher, in order. A refused token never adds one.
  readonly dispatched: unknown[];
  // Argv of every runner call.
  readonly runs: (readonly string[])[];
  // The injected clock, in milliseconds.
  nowMs(): number;
  setNowMs(ms: number): void;
  selection(workspace?: string): ControlSelection;
  up(workspace?: string): Promise<void>;
  send(method: string, params?: unknown): Promise<ControlReply>;
  // A real capability-attach. Asserts nothing: the caller reads the reply.
  attachReply(host: string, workspace?: string): Promise<ControlReply>;
  // A real capability-attach that must answer mode enforce with a token.
  attach(host: string, workspace?: string): Promise<{ readonly token: string; readonly expiresAt: number }>;
  // A real tool request. `token` is the member to send; omit the property to send none.
  tool(tool: unknown, options?: { readonly token?: unknown; readonly workspace?: string; readonly extra?: Record<string, unknown> }): Promise<ControlReply>;
  logLines(): Record<string, unknown>[];
  logText(): string;
  auditLines(workspace?: string): Record<string, unknown>[];
  auditText(workspace?: string): string;
  keyringText(): string;
  // The key bytes of a kid, read from the keyring file.
  keyOf(kid: string): Buffer;
  // The token the daemon would mint for these claims: the HMAC is deterministic for fixed claims.
  recompute(claims: MintClaims): string;
  // Signs any payload object as given with the key of kid (a test-only forger).
  forge(kid: string, payload: unknown): string;
  // Rotates the keyring file through the keyring module.
  rotate(revokePrevious: boolean): void;
  readonly docPath: string;
  // What runCli needs to dial this rig's daemon: the runtime config names the rig's state directory and workspace root.
  readonly cli: CliWorld;
}

function policyDocument(workspaces: string, options: RigOptions): Record<string, unknown> {
  return {
    mode: "advisory",
    workspaceRoots: [workspaces],
    ...(options.shellEnabled === undefined ? {} : { shellEnabled: options.shellEnabled }),
    ...(options.capabilityTokens === undefined ? {} : { capabilityTokens: options.capabilityTokens }),
  };
}

export async function startRig(t: TestContext, options: RigOptions = {}): Promise<Rig> {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-capt-")));
  const projects = join(base, "projects");
  const workspace = join(projects, "a");
  const otherWorkspace = join(projects, "b");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(otherWorkspace, { recursive: true });
  writeFileSync(join(workspace, "doc.txt"), "original");
  writeFileSync(join(otherWorkspace, "doc.txt"), "other");
  const stateDir = join(base, "realm");
  const document = policyDocument(projects, options);
  const parsed = validate("policy", document);
  if (!parsed.ok) {
    throw new Error("the harness policy does not validate");
  }
  const policy: Policy = parsed.value;
  const policyPath = join(base, "policy.json");
  writeFileSync(policyPath, JSON.stringify(document));
  mkdirSync(join(base, "config", "realm"), { recursive: true });
  writeFileSync(
    join(base, "config", "realm", "config.json"),
    JSON.stringify({ image: IMAGE, stateDir, workspaceRoot: projects }),
  );

  // The injected clock is frozen at the real time the rig starts, so a token minted by the daemon is also valid by the clock
  // of a client that reads the real one, and a test can recompute a token because the claims do not move.
  const clock = { ms: Math.floor(Date.now() / 1000) * 1000 };
  const lines: string[] = [];
  const dispatched: unknown[] = [];
  const runs: (readonly string[])[] = [];
  const logger = createLogger({
    sink: {
      write: (line) => {
        lines.push(line);
        return true;
      },
    },
    level: "debug",
    now: () => new Date(clock.ms),
  });
  const exec = new FakeExecutionService();
  const daemonOptions: StartDaemonOptions = {
    runtimeInput: { image: IMAGE, stateDir, workspaceRoot: projects },
    policyPath,
    policy,
    exec,
    clock: () => new Date(clock.ms),
    runOpenShell: (argv) => {
      runs.push(argv);
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", truncated: false });
    },
    libpod: {
      info: () => Promise.resolve({ rootless: true, version: "5.0.0" }),
      listContainersByLabel: () => Promise.resolve([]),
      inspectContainer: () => Promise.resolve(null),
      stopContainer: () => Promise.resolve(),
      removeContainer: () => Promise.resolve(),
    },
    probe: () => Promise.resolve<PodmanProbeResult>({ ok: true, version: "5.0.0" }),
    // The doctor probes fail deterministically, so a doctor request runs the real items without a host podman.
    doctorOptions: {
      runCommand: () => Promise.reject(new Error("podman not installed")),
      connectSocket: () => Promise.reject(new Error("connection refused")),
    },
    logger,
  };
  const daemon = await startDaemon(daemonOptions);
  t.after(async () => {
    try {
      await daemon.stop();
    } catch {
      // The test already stopped the daemon.
    }
    try {
      await boundedWait(daemon.done, "daemon done", 15_000);
    } catch {
      // Best effort on the way out.
    }
    rmSync(base, { recursive: true, force: true });
  });

  let nextId = 0;
  const wrapped = new Set<string>();
  const selection = (target: string = workspace): ControlSelection => selectionOf(target);
  const send = (method: string, params?: unknown): Promise<ControlReply> => {
    nextId += 1;
    return sendRequest(daemon.socketPath, params === undefined ? { id: nextId, method } : { id: nextId, method, params });
  };
  const up = async (target: string = workspace): Promise<void> => {
    const reply = await send("up", { workspaceRoot: target });
    if (reply.error !== undefined) {
      throw new Error(`up refused with ${reply.error.code}`);
    }
    const sessionId = selection(target).sessionId;
    const entry = daemon.session(sessionId);
    if (entry === undefined || wrapped.has(sessionId)) {
      return;
    }
    wrapped.add(sessionId);
    const dispatcher = entry.handle.dispatcher;
    const real = dispatcher.call.bind(dispatcher);
    dispatcher.call = (raw: unknown, context?: Parameters<typeof real>[1]): Promise<ToolOutcome> => {
      dispatched.push(raw);
      return real(raw, context);
    };
  };
  const attachReply = (host: string, target: string = workspace): Promise<ControlReply> =>
    send("capability-attach", { selection: selection(target), host });
  const keyOf = (kid: string): Buffer => {
    const file = JSON.parse(readFileSync(keyringPathOf(stateDir), "utf8")) as { keys: { kid: string; key: string }[] };
    const found = file.keys.find((entry) => entry.kid === kid);
    if (found === undefined) {
      throw new Error(`no key ${kid}`);
    }
    return Buffer.from(found.key, "base64url");
  };
  const readLines = (file: string): Record<string, unknown>[] =>
    !existsSync(file)
      ? []
      : readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
  const auditFileOf = (target: string): string => join(stateDir, "audit", `${selection(target).sessionId}.jsonl`);

  return {
    base,
    stateDir,
    workspace,
    otherWorkspace,
    daemon,
    socketPath: daemon.socketPath,
    policy,
    exec,
    dispatched,
    runs,
    docPath: join(workspace, "doc.txt"),
    cli: {
      env: {
        PATH: "/usr/bin",
        HOME: "/root",
        XDG_RUNTIME_DIR: "/run/user/0",
        XDG_CONFIG_HOME: join(base, "config"),
        XDG_STATE_HOME: join(base, "xdg-state"),
      },
      daemonEntry: join(stateDir, "daemon", "daemon.js"),
    },
    nowMs: () => clock.ms,
    setNowMs: (ms) => {
      clock.ms = ms;
    },
    selection,
    up,
    send,
    attachReply,
    attach: async (host, target) => {
      const reply = await attachReply(host, target);
      const result = reply.result;
      if (
        reply.error !== undefined ||
        typeof result !== "object" ||
        result === null ||
        !("token" in result) ||
        typeof result.token !== "string" ||
        !("expiresAt" in result) ||
        typeof result.expiresAt !== "number"
      ) {
        throw new Error("the attach did not answer a token");
      }
      return { token: result.token, expiresAt: result.expiresAt };
    },
    tool: (tool, toolOptions = {}) =>
      send("tool", {
        selection: selection(toolOptions.workspace),
        tool,
        ...("token" in toolOptions ? { token: toolOptions.token } : {}),
        ...toolOptions.extra,
      }),
    logLines: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    logText: () => lines.join("\n"),
    auditLines: (target = workspace) => readLines(auditFileOf(target)),
    auditText: (target = workspace) => (existsSync(auditFileOf(target)) ? readFileSync(auditFileOf(target), "utf8") : ""),
    keyringText: () => readFileSync(keyringPathOf(stateDir), "utf8"),
    keyOf,
    recompute: (claims) => mintToken(keyOf(claims.kid), claims),
    forge: (kid, payload) => {
      const bytes = Buffer.from(JSON.stringify(payload), "utf8");
      const tag = createHmac("sha256", keyOf(kid)).update("realm-capt-v1\u0000").update(bytes).digest();
      return `${TOKEN_PREFIX}.${bytes.toString("base64url")}.${tag.toString("base64url")}`;
    },
    rotate: (revokePrevious) => {
      rotateKeyring(stateDir, { revokePrevious }, { now: () => Math.floor(clock.ms / 1000) });
    },
  };
}
