// The operator-local start diagnostic (ADR-0003, US-111, AC-34; API-RealmOmpPlugin `startDiagnose`).
// Hermetic: real temporary directories, no daemon, no config file. The AC-34 automated check is
// exit 1 with POLICY_DENIED naming the one missing directory; the start refusal itself stays the
// pathless catalogue code, and these tests pin that the naming lives only in this result.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDiagnoseLine, startDiagnose } from "../../src/daemon/diagnose.js";

const CORRELATION_ID = "corr-diagnose-1";
// The AC-34 remedy wording, asserted by literal (the contract text, not an implementation symbol).
const REMEDY = "Point workspaceRoot at an existing directory owned by the account, or remove the stale config.";

void test("a configured workspace that exists diagnoses as existing; no path and no remedy (AC-33)", () => {
  const base = mkdtempSync(join(tmpdir(), "realm-diagnose-"));
  try {
    const response = startDiagnose(base, CORRELATION_ID);
    assert.equal(response.workspaceRootExists, true);
    assert.equal(response.missingPath, undefined);
    assert.equal(response.remedy, undefined);
    assert.equal(response.correlationId, CORRELATION_ID);
    assert.equal(formatDiagnoseLine(response), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

void test("a nonexistent workspaceRoot names 1 path with 1 remedy (AC-34)", () => {
  const base = mkdtempSync(join(tmpdir(), "realm-diagnose-"));
  try {
    const missing = join(base, "ompos");
    const response = startDiagnose(missing, CORRELATION_ID);
    assert.equal(response.workspaceRootExists, false);
    assert.equal(response.code, "POLICY_DENIED");
    assert.equal(response.missingPath, missing);
    assert.equal(response.missingKind, "absent");
    assert.equal(response.remedy, REMEDY);
    assert.equal(response.correlationId, CORRELATION_ID);
    const line = formatDiagnoseLine(response);
    assert.ok(line !== null, "the missing case renders one stderr fragment");
    assert.ok(line.includes(missing), "the fragment names the one missing directory");
    assert.ok(line.includes("does not exist"), "an absent path reads as does not exist");
    assert.ok(line.includes(REMEDY), "the fragment carries the one remedy");
    const unreadable = formatDiagnoseLine({ ...response, missingKind: "unreadable" });
    assert.ok(unreadable !== null && unreadable.includes("is unreadable"), "an unreadable path reads as is unreadable");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

void test("a regular file is not a directory: denied with the path named, like bindRoot", () => {
  const base = mkdtempSync(join(tmpdir(), "realm-diagnose-"));
  try {
    const file = join(base, "config.json");
    writeFileSync(file, "{}\n", "utf8");
    const response = startDiagnose(file, CORRELATION_ID);
    assert.equal(response.workspaceRootExists, false);
    assert.equal(response.code, "POLICY_DENIED");
    assert.equal(response.missingPath, file);
    assert.equal(response.missingKind, "not-directory");
    assert.equal(response.remedy, REMEDY);
    const line = formatDiagnoseLine(response);
    assert.ok(line !== null && line.includes("is not a directory"), "an existing file reads as is not a directory");
    assert.ok(!line.includes("does not exist"), "an existing file never reads as does not exist");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

void test("an unusable config shape is SCHEMA_INVALID and names no path", () => {
  for (const shape of ["", "   ", "relative/workspace"]) {
    const response = startDiagnose(shape, CORRELATION_ID);
    assert.equal(response.workspaceRootExists, false, `shape ${JSON.stringify(shape)} does not exist`);
    assert.equal(response.code, "SCHEMA_INVALID");
    assert.equal(response.missingPath, undefined);
    assert.equal(response.remedy, undefined);
    assert.equal(formatDiagnoseLine(response), null);
  }
});

void test("the response shape is audit-safe: no field carries anything but the named path", () => {
  const base = mkdtempSync(join(tmpdir(), "realm-diagnose-"));
  try {
    const missing = join(base, "ompos");
    const response = startDiagnose(missing, CORRELATION_ID);
    assert.deepEqual(Object.keys(response).sort(), ["code", "correlationId", "missingKind", "missingPath", "remedy", "workspaceRootExists"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
