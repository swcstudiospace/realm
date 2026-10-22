import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { RealmError } from "../../src/core/errors.js";
import { isDirectEntry, podmanSocketPath, resolveConfigPath } from "../../src/runtime/host-paths.js";

test("resolveConfigPath prefers an absolute XDG_CONFIG_HOME, ignores a relative one, and falls back to HOME/.config", () => {
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

test("resolveConfigPath throws SCHEMA_INVALID when neither XDG_CONFIG_HOME nor HOME is absolute", () => {
  const isSchemaInvalid = (error: unknown): boolean =>
    error instanceof RealmError && error.code === "SCHEMA_INVALID";
  assert.throws(() => resolveConfigPath({}), isSchemaInvalid);
  assert.throws(() => resolveConfigPath({ HOME: "relative-home" }), isSchemaInvalid);
  assert.throws(() => resolveConfigPath({ XDG_CONFIG_HOME: "relative/config" }), isSchemaInvalid);
});

test("podmanSocketPath is the rootless API socket under an absolute XDG_RUNTIME_DIR", () => {
  assert.equal(podmanSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }), "/run/user/1000/podman/podman.sock");
});

test("isDirectEntry is true for a symbolic link to the module file, and false for another file, a missing path, or no argv1", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "host-paths-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
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
