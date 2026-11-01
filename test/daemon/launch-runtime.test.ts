// The daemon launcher spawns only under Node. Under a Bun host (the compiled Omp binary) process.execPath is not Node,
// so the launcher refuses instead of running that binary against the daemon entry.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchFilteredDaemon, type SpawnDaemon } from "../../src/cli/main.js";
import { RealmError } from "../../src/core/errors.js";

const ENTRY = join("dist", "src", "daemon", "main.js");

function recordingSpawn(spawns: string[]): SpawnDaemon {
  return (file) => {
    spawns.push(file);
    return { unref: () => undefined };
  };
}

function withStateDir(run: (stateDir: string) => void): void {
  const stateDir = mkdtempSync(join(tmpdir(), "realm-launch-"));
  try {
    run(stateDir);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

void test("a Node host spawns the daemon with its own runtime", () => {
  withStateDir((stateDir) => {
    const spawns: string[] = [];
    launchFilteredDaemon(ENTRY, stateDir, {}, recordingSpawn(spawns));
    assert.deepEqual(spawns, [process.execPath]);
  });
});

void test("a Bun host refuses with REALM_NOT_ACTIVE and runs no child", () => {
  withStateDir((stateDir) => {
    const spawns: string[] = [];
    Object.defineProperty(process.versions, "bun", { value: "1.4.0", configurable: true });
    try {
      assert.throws(
        () => {
          launchFilteredDaemon(ENTRY, stateDir, {}, recordingSpawn(spawns));
        },
        (error: unknown) => error instanceof RealmError && error.code === "REALM_NOT_ACTIVE",
      );
    } finally {
      Reflect.deleteProperty(process.versions, "bun");
    }
    assert.deepEqual(spawns, []);
  });
});
