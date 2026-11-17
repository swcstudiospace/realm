// HOST-07, env: hostEnvFrom reads only HOME and PATH from the value it is handed, and neither the helper module nor the
// realm host command reads the process environment.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RealmError } from "../../src/core/errors.js";
import { hostEnvFrom, hostLogPath } from "../../src/host/env.js";

function schemaInvalid(error: unknown): boolean {
  return error instanceof RealmError && error.code === "SCHEMA_INVALID";
}

void test("HOST-07: hostEnvFrom takes an absolute HOME, the absolute non-empty PATH entries, and passes the environment through", () => {
  const env = { HOME: "/home-dir", PATH: "/usr/bin::relative/bin:/opt/tool/bin:.", CLAUDE_CONFIG_DIR: "/cfg" };
  const host = hostEnvFrom(env);
  assert.equal(host.home, "/home-dir");
  assert.deepEqual(host.pathDirs, ["/usr/bin", "/opt/tool/bin"]);
  assert.equal(host.env, env);
});

void test("HOST-07: a missing PATH is an empty list of directories", () => {
  assert.deepEqual(hostEnvFrom({ HOME: "/home-dir" }).pathDirs, []);
  assert.deepEqual(hostEnvFrom({ HOME: "/home-dir", PATH: "" }).pathDirs, []);
});

void test("HOST-07: a missing, empty or relative HOME is SCHEMA_INVALID", () => {
  for (const env of [{}, { HOME: "" }, { HOME: "relative/home" }, { HOME: "~" }]) {
    assert.throws(() => hostEnvFrom(env), schemaInvalid, JSON.stringify(env));
  }
});

void test("HOST-07: hostLogPath is host.log in the state directory", () => {
  assert.equal(hostLogPath("/state"), "/state/host.log");
});

void test("HOST-07: neither src/host/env.ts nor src/cli/host.ts reads process.env", () => {
  for (const file of ["../../../src/host/env.ts", "../../../src/cli/host.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.equal(source.includes("process.env"), false, file);
  }
});
