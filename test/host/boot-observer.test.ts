// The host-side boot observer (BOOT-08): one event stream becomes a log line, a presence marker and a report, each best effort.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { makeRealmError } from "../../src/core/errors.js";
import type { ControlReply, ControlRequest } from "../../src/daemon/channel.js";
import { createBootObserver, type BootObserver } from "../../src/host/boot-observer.js";
import { HOST_BOOT_PHASES, parseHostBootReport, type HostBootReport } from "../../src/host/boot-report.js";
import type { HostBootEvent } from "../../src/host/types.js";
import { createLogger } from "../../src/observe/logger.js";
import { sessionIdOfWorkspace } from "../../src/session/paths.js";
import { boundedWait } from "../support/timing.js";

const SESSION = sessionIdOfWorkspace("/ws/a");
const BOOT_ID = "boot-0123456789";
const STARTED = "2026-11-17T10:00:00.000Z";

// The options createBootObserver takes (the options type itself is not exported).
type BootObserverOptions = Parameters<typeof createBootObserver>[0];

interface Harness {
  readonly observer: BootObserver;
  readonly stateDir: string;
  readonly socketPath: string;
  readonly lines: Record<string, unknown>[];
  readonly diagnostics: string[];
  readonly sent: { readonly socketPath: string; readonly request: ControlRequest; readonly timeoutMs: number }[];
  readonly markerFile: (hostId: string) => string;
}

function harness(overrides: Partial<BootObserverOptions> = {}): Harness {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-boot-observer-"));
  const socketPath = join(stateDir, "control.sock");
  const lines: Record<string, unknown>[] = [];
  const diagnostics: string[] = [];
  const sent: Harness["sent"] = [];
  const logger = createLogger({
    sink: {
      write: (line) => {
        lines.push(JSON.parse(line) as Record<string, unknown>);
        return true;
      },
    },
    level: "debug",
    now: () => new Date(STARTED),
  });
  const observer = createBootObserver({
    hostId: "claude",
    transport: "mcp",
    bootId: BOOT_ID,
    stateDir,
    socketPath,
    logger,
    diagnostics: {
      write: (text) => {
        diagnostics.push(text);
      },
    },
    send: (path, request, timeoutMs): Promise<ControlReply> => {
      sent.push({ socketPath: path, request, timeoutMs });
      return Promise.resolve({ id: request.id, result: { recorded: true } });
    },
    pid: process.pid,
    startedAt: STARTED,
    sessionId: () => SESSION,
    ...overrides,
  });
  return { observer, stateDir, socketPath, lines, diagnostics, sent, markerFile: (hostId) => join(stateDir, "hosts", `${hostId}-active`, `${String(process.pid)}.json`) };
}

function cleanup(h: Harness): void {
  rmSync(h.stateDir, { recursive: true, force: true });
}

// The report a recorded host-boot request carries, parsed through the daemon's own parser.
function reportOf(request: ControlRequest): HostBootReport {
  const params = request.params;
  assert.ok(typeof params === "object" && params !== null && "report" in params, "params carry a report");
  assert.deepEqual(Object.keys(params), ["report"]);
  return parseHostBootReport(params.report);
}

const event = (phase: HostBootEvent["phase"], rest: Partial<HostBootEvent> = {}): HostBootEvent => ({
  phase,
  attempt: 1,
  durationMs: 12,
  state: "active",
  ...rest,
});

void test("each phase writes one log line, the marker and a valid report", async () => {
  const table: readonly {
    readonly event: HostBootEvent;
    readonly level: string;
    readonly marker: { readonly attach: string; readonly code: string | null } | "removed";
  }[] = [
    { event: event("attached"), level: "debug", marker: { attach: "attached", code: null } },
    { event: event("reattached", { attempt: 2 }), level: "debug", marker: { attach: "attached", code: null } },
    { event: event("refused", { code: "POLICY_DENIED" }), level: "warn", marker: { attach: "failed", code: "POLICY_DENIED" } },
    { event: event("failed", { code: "DAEMON_START_TIMEOUT", state: null }), level: "warn", marker: { attach: "failed", code: "DAEMON_START_TIMEOUT" } },
    { event: event("link-lost", { code: "REALM_NOT_ACTIVE" }), level: "warn", marker: { attach: "failed", code: "REALM_NOT_ACTIVE" } },
    { event: event("closed"), level: "debug", marker: "removed" },
  ];
  assert.deepEqual(table.map((row) => row.event.phase), [...HOST_BOOT_PHASES], "every phase is covered, in vocabulary order");
  for (const row of table) {
    const h = harness();
    try {
      // A marker is present before `closed`, so the removal is observable.
      if (row.marker === "removed") {
        h.observer.observe(event("attached"));
        assert.ok(existsSync(h.markerFile("claude")));
        h.lines.length = 0;
        h.sent.length = 0;
      }
      h.observer.observe(row.event);
      await h.observer.flush(1000);
      const phase = row.event.phase;
      assert.equal(h.lines.length, 1, phase);
      const line = h.lines[0];
      assert.ok(line);
      assert.equal(line["event"], `host.boot.${phase}`);
      assert.equal(line["level"], row.level);
      const keys = ["ts", "level", "event", "correlationId", "hostId", "transport", "phase", "attempt", "durationMs"];
      if (row.event.code !== undefined) {
        keys.push("code");
      }
      if (row.event.state !== null) {
        keys.push("state");
      }
      assert.deepEqual(Object.keys(line).sort(), keys.sort(), phase);
      assert.equal(line["correlationId"], BOOT_ID);
      if (row.marker === "removed") {
        assert.equal(existsSync(h.markerFile("claude")), false);
      } else {
        const record = JSON.parse(readFileSync(h.markerFile("claude"), "utf8")) as Record<string, unknown>;
        assert.deepEqual(record, {
          schemaVersion: 1,
          pid: process.pid,
          startedAt: STARTED,
          sessionId: SESSION,
          attach: row.marker.attach,
          code: row.marker.code,
        });
      }
      assert.equal(h.sent.length, 1, phase);
      const request = h.sent[0]?.request;
      assert.ok(request);
      assert.equal(request.method, "host-boot");
      const report = reportOf(request);
      assert.equal(report.phase, phase);
      assert.equal(report.bootId, BOOT_ID);
      assert.equal(report.hostId, "claude");
      assert.equal(report.transport, "mcp");
      assert.equal(h.sent[0]?.timeoutMs, phase === "closed" ? 1000 : 5000);
      assert.equal(h.sent[0]?.socketPath, h.socketPath);
      assert.deepEqual(h.diagnostics, []);
    } finally {
      cleanup(h);
    }
  }
});

void test("an unlabelled session writes no marker and still reports; a null session id writes no marker", async () => {
  const unlabelled = harness({ hostId: "unlabelled" });
  const unselected = harness({ sessionId: () => null });
  try {
    unlabelled.observer.observe(event("attached"));
    unselected.observer.observe(event("attached"));
    await unlabelled.observer.flush(1000);
    await unselected.observer.flush(1000);
    assert.equal(existsSync(join(unlabelled.stateDir, "hosts")), false);
    assert.equal(existsSync(join(unselected.stateDir, "hosts")), false);
    assert.equal(unlabelled.sent.length, 1);
    assert.equal(unselected.sent.length, 1);
    const sentRequest = unlabelled.sent[0]?.request;
    assert.ok(sentRequest);
    assert.equal(reportOf(sentRequest).hostId, "unlabelled");
  } finally {
    cleanup(unlabelled);
    cleanup(unselected);
  }
});

void test("a presence failure is one diagnostics line with the code; the log line and the report still happen", async () => {
  const h = harness();
  try {
    // A symlink where the hosts directory belongs: the marker cannot be created.
    symlinkSync(tmpdir(), join(h.stateDir, "hosts"));
    h.observer.observe(event("attached"));
    await h.observer.flush(1000);
    assert.deepEqual(h.diagnostics, ["realm: presence marker not updated: PATH_ESCAPE\n"]);
    assert.equal(h.lines.length, 1);
    assert.equal(h.sent.length, 1);
  } finally {
    cleanup(h);
  }
});

void test("a throwing send and a never-settling send leave observe synchronous and flush within its bound", async () => {
  const throwing = harness({
    send: () => {
      throw makeRealmError("SCHEMA_INVALID");
    },
  });
  const hanging = harness({ send: () => new Promise<ControlReply>(() => undefined) });
  try {
    throwing.observer.observe(event("attached"));
    hanging.observer.observe(event("attached"));
    assert.equal(throwing.lines.length, 1, "the log line was written synchronously");
    const started = Date.now();
    await boundedWait(throwing.observer.flush(50), "flush after a throwing send", 2000);
    await boundedWait(hanging.observer.flush(50), "flush after a hanging send", 2000);
    assert.ok(Date.now() - started < 1500);
    assert.ok(throwing.lines.some((line) => line["event"] === "host.boot.report_failed"));
    assert.deepEqual(throwing.diagnostics, [], "a report failure never reaches diagnostics");
  } finally {
    cleanup(throwing);
    cleanup(hanging);
  }
});

void test("a refused reply is logged at debug with the code only and writes nothing to diagnostics", async () => {
  const h = harness({ send: (_path, request) => Promise.resolve({ id: request.id, error: { code: "SCHEMA_INVALID" } }) });
  try {
    h.observer.observe(event("attached"));
    await h.observer.flush(1000);
    const failure = h.lines.find((line) => line["event"] === "host.boot.report_failed");
    assert.ok(failure);
    assert.equal(failure["level"], "debug");
    assert.equal(failure["failure"], "SCHEMA_INVALID");
    assert.deepEqual(h.diagnostics, []);
  } finally {
    cleanup(h);
  }
});

void test("the ninth concurrent report is dropped and counted", async () => {
  const sent: ControlRequest[] = [];
  const h = harness({
    send: (_path, request) => {
      sent.push(request);
      return new Promise<ControlReply>(() => undefined);
    },
  });
  try {
    for (let n = 0; n < 9; n += 1) {
      h.observer.observe(event("attached"));
    }
    assert.equal(sent.length, 8);
    assert.equal(h.observer.droppedReports(), 1);
    assert.ok(h.lines.some((line) => line["event"] === "host.boot.report_dropped"));
  } finally {
    cleanup(h);
  }
});

void test("an event with attempt 10 is dropped as invalid, not sent", () => {
  const h = harness();
  try {
    h.observer.observe(event("attached", { attempt: 10 }));
    assert.equal(h.sent.length, 0);
    assert.ok(h.lines.some((line) => line["event"] === "host.boot.report_invalid"));
  } finally {
    cleanup(h);
  }
});

void test("no log line, marker or request carries the state directory or the socket path; a token-shaped boot id is redacted in the log", async () => {
  const token = `ghp_${"a1B2c3D4e5".repeat(4).slice(0, 36)}`;
  const h = harness({ bootId: token });
  try {
    h.observer.observe(event("attached"));
    h.observer.observe(event("closed"));
    await h.observer.flush(1000);
    h.observer.observe(event("attached"));
    const everything = JSON.stringify({ lines: h.lines, sent: h.sent.map((entry) => entry.request), marker: existsSync(h.markerFile("claude")) ? readFileSync(h.markerFile("claude"), "utf8") : "" });
    assert.equal(everything.includes(h.stateDir), false);
    assert.equal(everything.includes(h.socketPath), false);
    assert.equal(JSON.stringify(h.lines).includes(token), false, "the logger redacts a token-shaped boot id");
  } finally {
    cleanup(h);
  }
});

void test("the phase vocabulary of the driver's events and of the report is one list", () => {
  // Mutually assignable at the type level: each side is assigned to the other's element type.
  const events: readonly HostBootEvent["phase"][] = HOST_BOOT_PHASES;
  const reports: readonly (typeof HOST_BOOT_PHASES)[number][] = events;
  assert.deepEqual([...reports], ["attached", "refused", "failed", "link-lost", "reattached", "closed"]);
});

void test("closing removes this pid's marker and nothing else in the state directory", async () => {
  const h = harness();
  try {
    h.observer.observe(event("attached"));
    writeFileSync(join(h.stateDir, "keep"), "x");
    h.observer.observe(event("closed"));
    await h.observer.flush(1000);
    assert.equal(existsSync(join(h.stateDir, "keep")), true);
    assert.equal(existsSync(h.markerFile("claude")), false);
  } finally {
    cleanup(h);
  }
});
