import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAudit } from "../../src/audit/log.js";
import type { Policy } from "../../src/contract/validate.js";
import { RealmError, makeRealmError, type ErrorCode } from "../../src/core/errors.js";
import type { State } from "../../src/core/states.js";
import { LockTable } from "../../src/fs/locks.js";
import { bindRoot, type PinnedRoot } from "../../src/fs/root.js";
import { gateMutation } from "../../src/lifecycle/mutation-gate.js";
import {
  listWorkspaceDir,
  readWorkspaceFile,
  writeWorkspaceFile,
  type WorkspaceDeps,
} from "../../src/tools/workspace.js";

// Real files, real locks, and the real audit log under a temporary base. Nothing is mocked.

const SESSION = "sess-workspace";
const ADVISORY: Policy = {
  mode: "advisory",
  workspaceRoots: [],
  credentialAllow: [],
  egressAllow: [],
  shellEnabled: false,
  startupBudgetMs: 1000,
  toolQueueMs: 2000,
};
const REQUIRED: Policy = { ...ADVISORY, mode: "fail-closed" };

interface Fixture {
  readonly ws: string;
  readonly stateDir: string;
  readonly root: PinnedRoot;
  readonly locks: LockTable;
}

function makeFixture(t: TestContext): Fixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "realm-workspace-")));
  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });
  const ws = join(base, "ws");
  mkdirSync(ws);
  mkdirSync(join(ws, "sub"));
  writeFileSync(join(ws, "doc.txt"), "original");
  writeFileSync(join(ws, "real.txt"), "real");
  symlinkSync(join(ws, "real.txt"), join(ws, "link.txt"));
  writeFileSync(join(base, "outside.txt"), "outside");
  return {
    ws,
    stateDir: join(base, "state"),
    root: bindRoot(ws),
    locks: new LockTable(),
  };
}

function depsFor(
  f: Fixture,
  options: {
    readonly state?: State;
    readonly policy?: Policy;
    readonly credentialAllow?: readonly string[];
    readonly audit?: WorkspaceDeps["audit"];
  } = {},
): WorkspaceDeps {
  const policy = options.policy ?? ADVISORY;
  const state = options.state ?? "active";
  return {
    sessionId: SESSION,
    boundRoot: f.root,
    locks: f.locks,
    credentialAllow: options.credentialAllow ?? [],
    audit: options.audit ?? ((entry) => { appendAudit(f.stateDir, entry); }),
    mutationGate: () => gateMutation(policy, state),
  };
}

function auditText(f: Fixture): string {
  const file = join(f.stateDir, "audit", `${SESSION}.jsonl`);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function auditLines(f: Fixture): Array<Record<string, unknown>> {
  return auditText(f)
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function assertRejectsWith(action: () => unknown, code: ErrorCode): void {
  assert.throws(action, (error: unknown) => error instanceof RealmError && error.code === code);
}

function sha256Of(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

void test("TOOL-03: a write with a matching ifMatchSha256 replaces the content, returns its sha256 and byte count, and logs admission then result (D-34, D-98, D-90)", (t) => {
  const f = makeFixture(t);
  const result = writeWorkspaceFile(depsFor(f), {
    path: "doc.txt",
    content: "updated",
    ifMatchSha256: sha256Of("original"),
  });
  assert.equal(readFileSync(join(f.ws, "doc.txt"), "utf8"), "updated");
  assert.deepEqual(result, { sha256: sha256Of("updated"), bytes: 7, warning: null });
  assert.deepEqual(readdirSync(f.ws).filter((name) => name.includes(".realm-tmp-")), []);

  const lines = auditLines(f);
  assert.deepEqual(
    lines.map((line) => line["phase"]),
    ["admission", "result"],
  );
  assert.deepEqual(
    lines.map((line) => line["outcome"]),
    ["ok", "ok"],
  );
  assert.equal(lines[1]?.["bytes"], 7);
  assert.equal(lines[1]["sha256"], sha256Of("updated"));
});

void test("TOOL-03: a write with a stale ifMatchSha256 is LOCK_CONFLICT, the file stays byte-identical, and the result line records the code (D-34, D-98)", (t) => {
  const f = makeFixture(t);
  const target = join(f.ws, "doc.txt");
  const before = readFileSync(target);
  assertRejectsWith(
    () =>
      writeWorkspaceFile(depsFor(f), {
        path: "doc.txt",
        content: "stale-overwrite",
        ifMatchSha256: sha256Of("not the current content"),
      }),
    "LOCK_CONFLICT",
  );
  assert.equal(readFileSync(target).equals(before), true);
  assert.deepEqual(readdirSync(f.ws).filter((name) => name.includes(".realm-tmp-")), []);
  assert.equal(f.locks.isHeldBy(target, SESSION), false);

  const lines = auditLines(f);
  assert.deepEqual(
    lines.map((line) => [line["phase"], line["outcome"]]),
    [
      ["admission", "ok"],
      ["result", "LOCK_CONFLICT"],
    ],
  );
  assert.equal("bytes" in (lines[1] ?? {}), false);
  assert.equal("sha256" in (lines[1] ?? {}), false);
});

void test("TOOL-03: a write to a path another owner holds is LOCK_CONFLICT before admission, and that owner keeps the lock (D-89 stage 3, D-34)", (t) => {
  const f = makeFixture(t);
  const target = join(f.ws, "doc.txt");
  f.locks.acquire(target, "other-owner");
  assertRejectsWith(
    () => writeWorkspaceFile(depsFor(f), { path: "doc.txt", content: "blocked" }),
    "LOCK_CONFLICT",
  );
  assert.equal(readFileSync(target, "utf8"), "original");
  assert.equal(f.locks.isHeldBy(target, "other-owner"), true);
  assert.deepEqual(auditLines(f), [], "a lock refusal writes no audit line");
});

void test("TOOL-03: a write whose target is a symlink is PATH_ESCAPE before admission and writes nothing (D-34 step 1, D-89 stage 3)", (t) => {
  const f = makeFixture(t);
  assertRejectsWith(
    () => writeWorkspaceFile(depsFor(f), { path: "link.txt", content: "through the link" }),
    "PATH_ESCAPE",
  );
  assert.equal(readFileSync(join(f.ws, "real.txt"), "utf8"), "real");
  assert.deepEqual(auditLines(f), []);
});

void test("TOOL-03: a write to a credential path is CREDENTIAL_PATH_DENIED before admission and creates nothing (D-31, D-89 stage 3)", (t) => {
  const f = makeFixture(t);
  assertRejectsWith(
    () => writeWorkspaceFile(depsFor(f), { path: ".env", content: "TOKEN=1" }),
    "CREDENTIAL_PATH_DENIED",
  );
  assert.equal(existsSync(join(f.ws, ".env")), false);
  assert.deepEqual(auditLines(f), []);
});

void test("TOOL-03: a write refused by the state gate in required mode is REALM_NOT_ACTIVE, with no audit line and no change (D-89 stage 2, D-63)", (t) => {
  const f = makeFixture(t);
  assertRejectsWith(
    () =>
      writeWorkspaceFile(depsFor(f, { state: "connecting", policy: REQUIRED }), {
        path: "doc.txt",
        content: "refused",
      }),
    "REALM_NOT_ACTIVE",
  );
  assert.equal(readFileSync(join(f.ws, "doc.txt"), "utf8"), "original");
  assert.deepEqual(auditLines(f), []);
});

void test("TOOL-03: a write in a non-active state under advisory policy proceeds and returns the advisory warning (D-98, D-23)", (t) => {
  const f = makeFixture(t);
  const result = writeWorkspaceFile(depsFor(f, { state: "degraded", policy: ADVISORY }), {
    path: "doc.txt",
    content: "advisory",
  });
  assert.equal(readFileSync(join(f.ws, "doc.txt"), "utf8"), "advisory");
  assert.equal(result.warning, "realm is degraded; the write proceeds under advisory policy");
  assert.equal(result.sha256, sha256Of("advisory"));
  assert.deepEqual(
    auditLines(f).map((line) => line["phase"]),
    ["admission", "result"],
  );
});

void test("TOOL-03: a write whose admission line cannot be appended is refused with AUDIT_WRITE_FAILED and nothing executes (S-21, D-89 stage 4)", (t) => {
  const f = makeFixture(t);
  const deps = depsFor(f, {
    audit: () => {
      throw makeRealmError("AUDIT_WRITE_FAILED");
    },
  });
  assertRejectsWith(() => writeWorkspaceFile(deps, { path: "doc.txt", content: "never" }), "AUDIT_WRITE_FAILED");
  assert.equal(readFileSync(join(f.ws, "doc.txt"), "utf8"), "original");
  assert.equal(f.locks.isHeldBy(join(f.ws, "doc.txt"), SESSION), false, "the lock probe releases its path");
});

void test("TOOL-03: a result line that cannot be appended after a write returns AUDIT_WRITE_FAILED and the write is not rolled back (D-89 stage 6, OQ-P4-07)", (t) => {
  const f = makeFixture(t);
  let calls = 0;
  const deps = depsFor(f, {
    audit: (entry) => {
      calls += 1;
      if (calls > 1) {
        throw makeRealmError("AUDIT_WRITE_FAILED");
      }
      appendAudit(f.stateDir, entry);
    },
  });
  assertRejectsWith(() => writeWorkspaceFile(deps, { path: "doc.txt", content: "kept" }), "AUDIT_WRITE_FAILED");
  assert.equal(readFileSync(join(f.ws, "doc.txt"), "utf8"), "kept");
  assert.equal(f.locks.isHeldBy(join(f.ws, "doc.txt"), SESSION), false);
});

void test("TOOL-03: write audit lines carry the byte count and sha256 of the content and never the content (D-42, D-90)", (t) => {
  const f = makeFixture(t);
  const SENTINEL = "WRITE-BODY-SENTINEL-4c1";
  writeWorkspaceFile(depsFor(f), { path: "doc.txt", content: SENTINEL });
  assert.equal(readFileSync(join(f.ws, "doc.txt"), "utf8"), SENTINEL, "the write happened");

  assert.equal(auditText(f).includes(SENTINEL), false, "the content never reaches the audit file");
  const [admission, result] = auditLines(f);
  assert.equal("bytes" in (admission ?? {}), false);
  assert.equal(result?.["bytes"], Buffer.byteLength(SENTINEL, "utf8"));
  assert.equal(result["sha256"], sha256Of(SENTINEL));
  assert.equal("content" in result, false);
});

void test("TOOL-03: the byte count of a write is its UTF-8 length, not its character count (D-42)", (t) => {
  const f = makeFixture(t);
  const content = "é€";
  const result = writeWorkspaceFile(depsFor(f), { path: "doc.txt", content });
  assert.equal(content.length, 2);
  assert.equal(result.bytes, 5);
  assert.equal(auditLines(f)[1]?.["bytes"], 5);
});

void test("TOOL-03: a read returns the Phase 2 result shape and logs admission and result lines with byte count and sha256, never content (D-36, D-42, D-98)", (t) => {
  const f = makeFixture(t);
  const SENTINEL = "READ-BODY-SENTINEL-7d";
  writeFileSync(join(f.ws, "body.txt"), SENTINEL);
  const result = readWorkspaceFile(depsFor(f), { path: "body.txt", maxBytes: 1024 });
  assert.ok(result.status === "found");
  assert.equal(Buffer.from(result.content).toString("utf8"), SENTINEL);
  assert.equal(result.sha256, sha256Of(SENTINEL));
  assert.equal(result.truncated, false);

  assert.equal(auditText(f).includes(SENTINEL), false, "the read content never reaches the audit file");
  const [admission, outcome] = auditLines(f);
  assert.equal(admission?.["phase"], "admission");
  assert.equal("bytes" in admission, false);
  assert.equal(outcome?.["phase"], "result");
  assert.equal(outcome["tool"], "read");
  assert.equal(outcome["bytes"], Buffer.byteLength(SENTINEL, "utf8"));
  assert.equal(outcome["sha256"], sha256Of(SENTINEL));
});

void test("TOOL-03: a read capped at maxBytes returns the capped content, the sha256 of the whole file, and truncated true (D-36, D-98)", (t) => {
  const f = makeFixture(t);
  writeFileSync(join(f.ws, "long.txt"), "abcdefghij");
  const result = readWorkspaceFile(depsFor(f), { path: "long.txt", maxBytes: 4 });
  assert.ok(result.status === "found");
  assert.equal(Buffer.from(result.content).toString("utf8"), "abcd");
  assert.equal(result.truncated, true);
  assert.equal(result.sha256, sha256Of("abcdefghij"));
  assert.equal(auditLines(f)[1]?.["bytes"], 4);
});

void test("TOOL-03: a read of an escaping path is PATH_ESCAPE and a credential path is CREDENTIAL_PATH_DENIED, each logged as its result code (D-36, D-31, D-98)", (t) => {
  const f = makeFixture(t);
  writeFileSync(join(f.ws, ".env"), "TOKEN=1");
  assertRejectsWith(() => readWorkspaceFile(depsFor(f), { path: "../outside.txt", maxBytes: 64 }), "PATH_ESCAPE");
  assertRejectsWith(() => readWorkspaceFile(depsFor(f), { path: ".env", maxBytes: 64 }), "CREDENTIAL_PATH_DENIED");
  assert.deepEqual(
    auditLines(f).map((line) => [line["phase"], line["outcome"]]),
    [
      ["admission", "ok"],
      ["result", "PATH_ESCAPE"],
      ["admission", "ok"],
      ["result", "CREDENTIAL_PATH_DENIED"],
    ],
  );
});

void test("TOOL-03: a credential path is readable when credentialAllow names it (D-31)", (t) => {
  const f = makeFixture(t);
  writeFileSync(join(f.ws, ".env"), "allowed");
  const result = readWorkspaceFile(depsFor(f, { credentialAllow: [".env"] }), { path: ".env", maxBytes: 64 });
  assert.ok(result.status === "found");
  assert.equal(Buffer.from(result.content).toString("utf8"), "allowed");
});

void test("TOOL-03: a read whose admission line cannot be appended runs nothing and returns AUDIT_WRITE_FAILED (S-21, D-89 stage 4)", (t) => {
  const f = makeFixture(t);
  const deps = depsFor(f, {
    audit: () => {
      throw makeRealmError("AUDIT_WRITE_FAILED");
    },
  });
  assertRejectsWith(() => readWorkspaceFile(deps, { path: "doc.txt", maxBytes: 64 }), "AUDIT_WRITE_FAILED");
});

void test("TOOL-03: a list returns the Phase 2 result shape sorted by name, with symlinks reported by link text and never followed (D-36, FS-03)", (t) => {
  const f = makeFixture(t);
  const result = listWorkspaceDir(depsFor(f), { path: "." });
  assert.ok(result.status === "found");
  assert.equal(result.truncated, false);
  assert.deepEqual(result.entries, [
    { name: "doc.txt", kind: "file" },
    { name: "link.txt", kind: "symlink", target: join(f.ws, "real.txt") },
    { name: "real.txt", kind: "file" },
    { name: "sub", kind: "dir" },
  ]);

  const lines = auditLines(f);
  assert.deepEqual(
    lines.map((line) => [line["tool"], line["phase"], line["outcome"]]),
    [
      ["list", "admission", "ok"],
      ["list", "result", "ok"],
    ],
  );
  assert.equal("bytes" in (lines[1] ?? {}), false);
  assert.equal("sha256" in (lines[1] ?? {}), false);
});

void test("TOOL-03: a list of a credential directory is CREDENTIAL_PATH_DENIED and logged as its result code (D-31, D-36)", (t) => {
  const f = makeFixture(t);
  assertRejectsWith(() => listWorkspaceDir(depsFor(f), { path: ".ssh" }), "CREDENTIAL_PATH_DENIED");
  assert.equal(auditLines(f)[1]?.["outcome"], "CREDENTIAL_PATH_DENIED");
});

void test("TOOL-03: a list of an escaping path is PATH_ESCAPE (D-36, FS-01)", (t) => {
  const f = makeFixture(t);
  assertRejectsWith(() => listWorkspaceDir(depsFor(f), { path: "../" }), "PATH_ESCAPE");
});
