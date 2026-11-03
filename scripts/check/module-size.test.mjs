import assert from "node:assert/strict";
import { test } from "node:test";
import { checkModuleSizes } from "./module-size.mjs";

const LIMIT = 1000;

function check(files, allowlist = {}) {
  return checkModuleSizes({ files, limit: LIMIT, allowlist }).map(({ file, count, reason }) => ({
    file,
    count,
    reason,
  }));
}

test("a file at or under the limit passes", () => {
  assert.deepEqual(check([{ file: "src/small.ts", count: 10 }, { file: "src/edge.ts", count: LIMIT }]), []);
});

test("a file over the limit that is not allowlisted fails with reason over-limit", () => {
  assert.deepEqual(check([{ file: "src/big.ts", count: LIMIT + 1 }]), [
    { file: "src/big.ts", count: LIMIT + 1, reason: "over-limit" },
  ]);
});

test("an allowlisted file at its ceiling passes", () => {
  assert.deepEqual(check([{ file: "src/legacy.ts", count: 1200 }], { "src/legacy.ts": 1200 }), []);
});

test("an allowlisted file over its ceiling fails with reason grew", () => {
  assert.deepEqual(check([{ file: "src/legacy.ts", count: 1201 }], { "src/legacy.ts": 1200 }), [
    { file: "src/legacy.ts", count: 1201, reason: "grew" },
  ]);
});

test("an allowlisted file at or under the limit fails with reason stale-allowlist", () => {
  assert.deepEqual(check([{ file: "src/split.ts", count: LIMIT }], { "src/split.ts": 1200 }), [
    { file: "src/split.ts", count: LIMIT, reason: "stale-allowlist" },
  ]);
  assert.deepEqual(check([{ file: "src/split.ts", count: 400 }], { "src/split.ts": 400 }), [
    { file: "src/split.ts", count: 400, reason: "stale-allowlist" },
  ]);
});

test("empty input passes", () => {
  assert.deepEqual(check([]), []);
});

test("an allowlist entry whose file is absent from the list fails with reason stale-allowlist and count null", () => {
  assert.deepEqual(check([], { "src/renamed.ts": 1200 }), [{ file: "src/renamed.ts", count: null, reason: "stale-allowlist" }]);
});
