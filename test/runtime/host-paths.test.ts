import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RealmError } from "../../src/core/errors.js";
import { isDirectEntry, podmanSocketPath, readHostRuntime, resolveConfigPath } from "../../src/runtime/host-paths.js";

void test("resolveConfigPath prefers an absolute XDG_CONFIG_HOME, ignores a relative one, and falls back to HOME/.config", () => {
  assert.equal(
    resolveConfigPath({ XDG_CONFIG_HOME: "/xdg/config", HOME: "/home/user" }),
    "/xdg/config/realm/config.json",
  );
  assert.equal(
    resolveConfigPath({ XDG_CONFIG_HOME: "relative/config", HOME: "/home/user" }),
    "/home/user/.config/realm/config.json",
  );
  assert.equal(resolveConfigPath({ HOME: "/home/user" }), "/home/user/.config/realm/config.json");
});

void test("resolveConfigPath throws SCHEMA_INVALID when neither XDG_CONFIG_HOME nor HOME is absolute", () => {
  const isSchemaInvalid = (error: unknown): boolean =>
    error instanceof RealmError && error.code === "SCHEMA_INVALID";
  assert.throws(() => resolveConfigPath({}), isSchemaInvalid);
  assert.throws(() => resolveConfigPath({ HOME: "relative-home" }), isSchemaInvalid);
  assert.throws(() => resolveConfigPath({ XDG_CONFIG_HOME: "relative/config" }), isSchemaInvalid);
});

void test("podmanSocketPath is the rootless API socket under an absolute XDG_RUNTIME_DIR", () => {
  assert.equal(podmanSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }), "/run/user/1000/podman/podman.sock");
});

const IMAGE = `registry.example.com/realm/workload@sha256:${"0".repeat(64)}`;

function configDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "host-paths-config-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

void test("readHostRuntime takes the state directory from the config file, whatever XDG_STATE_HOME names (CLI-01, RT-06)", (t) => {
  const dir = configDir(t);
  const runtimeInput = {
    image: IMAGE,
    workloadArgv: ["/usr/bin/agent"],
    stateDir: "/var/lib/realm/state",
    workspaceRoot: "/srv/workspace",
  };
  mkdirSync(join(dir, "realm"));
  writeFileSync(join(dir, "realm", "config.json"), JSON.stringify(runtimeInput));
  const host = readHostRuntime({ XDG_CONFIG_HOME: dir, XDG_STATE_HOME: "/elsewhere/state" });
  assert.equal(host.stateDir, "/var/lib/realm/state");
  assert.deepEqual(host.runtimeInput, runtimeInput);
});

void test("readHostRuntime refuses a missing config and a config with a relative state directory with SCHEMA_INVALID", (t) => {
  const dir = configDir(t);
  assert.throws(
    () => readHostRuntime({ XDG_CONFIG_HOME: dir }),
    (error) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
  mkdirSync(join(dir, "realm"));
  writeFileSync(
    join(dir, "realm", "config.json"),
    JSON.stringify({ image: IMAGE, workloadArgv: ["/usr/bin/agent"], stateDir: "state", workspaceRoot: "/srv/ws" }),
  );
  assert.throws(
    () => readHostRuntime({ XDG_CONFIG_HOME: dir }),
    (error) => error instanceof RealmError && error.code === "SCHEMA_INVALID",
  );
});

void test("isDirectEntry is true for a symbolic link to the module file, and false for another file, a missing path, or no argv1", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "host-paths-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const moduleFile = join(dir, "module.js");
  const otherFile = join(dir, "other.js");
  const link = join(dir, "link.js");
  const missing = join(dir, "missing.js");
  writeFileSync(moduleFile, "");
  writeFileSync(otherFile, "");
  symlinkSync(moduleFile, link);
  const moduleUrl = pathToFileURL(moduleFile).href;
  assert.equal(isDirectEntry(moduleUrl, link), true);
  assert.equal(isDirectEntry(moduleUrl, otherFile), false);
  assert.equal(isDirectEntry(moduleUrl, missing), false);
  assert.equal(isDirectEntry(moduleUrl, undefined), false);
});
