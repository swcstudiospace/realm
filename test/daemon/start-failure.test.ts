// Daemon start-failure tests. The startup log is a real file under a temp state directory; the
// probe is a scripted fake. No daemon is started and no socket is opened.

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RealmError } from "../../src/core/errors.js";
import {
  daemonLogPath,
  daemonLogSize,
  daemonStartFailureSince,
  reportingStartFailure,
} from "../../src/daemon/ensure.js";

function scratchStateDir(t: TestContext): string {
  const stateDir = realpathSync(mkdtempSync(join(tmpdir(), "realm-start-failure-")));
  t.after(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });
  return stateDir;
}

void test("a failure line appended after an offset is returned as its code", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), "earlier startup output\n");
  const offset = daemonLogSize(stateDir);
  appendFileSync(daemonLogPath(stateDir), "realm daemon: POLICY_DENIED\n");
  assert.equal(daemonStartFailureSince(stateDir, offset), "POLICY_DENIED");
});

void test("a failure line written before the offset is ignored", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), "realm daemon: POLICY_DENIED\n");
  const offset = daemonLogSize(stateDir);
  assert.equal(daemonStartFailureSince(stateDir, offset), undefined);
});

void test("a failure line without a trailing newline is ignored", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), "realm daemon: POLICY_DENIED");
  assert.equal(daemonStartFailureSince(stateDir, 0), undefined);
});

void test("an uncatalogued failure token is ignored", (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), "realm daemon: NOT_A_CODE\n");
  assert.equal(daemonStartFailureSince(stateDir, 0), undefined);
});

void test("a missing startup log has size 0 and yields no failure code", (t) => {
  const stateDir = scratchStateDir(t);
  assert.equal(daemonLogSize(stateDir), 0);
  assert.equal(daemonStartFailureSince(stateDir, 0), undefined);
});

void test("the wrapper resolves true when the inner probe answers true", async (t) => {
  const stateDir = scratchStateDir(t);
  const probe = reportingStartFailure(() => Promise.resolve(true), stateDir);
  assert.equal(await probe("/state/run/control.sock"), true);
});

void test("the wrapper resolves false on every miss while the log shows no failure line", async (t) => {
  const stateDir = scratchStateDir(t);
  writeFileSync(daemonLogPath(stateDir), "startup output with no failure line\n");
  const probe = reportingStartFailure(() => Promise.resolve(false), stateDir);
  assert.equal(await probe("/state/run/control.sock"), false);
  assert.equal(await probe("/state/run/control.sock"), false);
  assert.equal(await probe("/state/run/control.sock"), false);
});

void test("the wrapper rejects with the daemon's code when a failure line appears after the first miss", async (t) => {
  const stateDir = scratchStateDir(t);
  const probe = reportingStartFailure(() => Promise.resolve(false), stateDir);
  assert.equal(await probe("/state/run/control.sock"), false);
  appendFileSync(daemonLogPath(stateDir), "realm daemon: POLICY_DENIED\n");
  await assert.rejects(
    probe("/state/run/control.sock"),
    (error: unknown) => error instanceof RealmError && error.code === "POLICY_DENIED",
  );
});
