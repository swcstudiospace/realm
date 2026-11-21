// The persisted Omp plugin toggle operations (ADR-0001, US-112; API-RealmOmpPlugin 1.0.0,
// `getPluginToggle`/`setPluginToggle`; `SC-PluginBoot`, M-2026-006). Hermetic: pure manifest
// in-memory operations, no host, no daemon. AC-36 (default on) and AC-38 (persisted off survives a
// restart) are pinned at the operation boundary: set, serialize, re-parse, and resolve to the same
// value.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getPluginToggle, setPluginToggle } from "../../src/host/boot.js";
import { defaultManifestFor, parseHostPluginManifest } from "../../src/host/manifest.js";

const CORRELATION_ID = "corr-toggle-1";

void test("GET /plugin/toggle: a default install reads on (AC-36)", () => {
  const manifest = defaultManifestFor("omp", "1.0.0");
  const response = getPluginToggle(manifest, CORRELATION_ID);
  assert.equal(response.enabled, true, "no stored setting means on");
  assert.equal(response.correlationId, CORRELATION_ID);
});

void test("PUT /plugin/toggle off persists across a restart: serialize, re-parse, resolve still off (AC-38)", () => {
  const before = defaultManifestFor("omp", "1.0.0");
  const after = setPluginToggle(before, { enabled: false, correlationId: CORRELATION_ID });
  assert.equal(after.hostId, "omp");
  assert.equal(after.boot?.enabled, false);
  // Persistence across restart: the host stores the manifest (JSON); a fresh parse and resolve must
  // still read off, and the re-attach flag must be untouched (orthogonal).
  const revived = parseHostPluginManifest(JSON.parse(JSON.stringify(after)) as unknown);
  const response = getPluginToggle(revived, CORRELATION_ID);
  assert.equal(response.enabled, false, "stored off remains off after restart");
  assert.equal(response.correlationId, CORRELATION_ID);
  assert.equal(revived.boot?.reattach?.enabled, undefined, "reattach stays off unless set");
});

void test("PUT /plugin/toggle on after off round-trips, preserving a set reattach flag", () => {
  const off = setPluginToggle(defaultManifestFor("omp", "1.0.0"), { enabled: false, correlationId: CORRELATION_ID });
  const withReattach = parseHostPluginManifest({ ...off, boot: { ...off.boot, reattach: { enabled: true } } });
  const on = setPluginToggle(withReattach, { enabled: true, correlationId: CORRELATION_ID });
  assert.equal(getPluginToggle(on, CORRELATION_ID).enabled, true);
  assert.equal(on.boot?.reattach?.enabled, true, "the toggle never flips reattach");
});
