// The daemon launcher runs process.execPath only under Node. Under a Bun host (the compiled Omp binary) process.execPath is not
// Node, so the launcher takes a Node from an absolute PATH directory and refuses with REALM_NOT_ACTIVE, spawning nothing, when
// there is none.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { launchFilteredDaemon, startDetachedDaemon, type SpawnDaemon } from "../../src/cli/main.js";
import { RealmError } from "../../src/core/errors.js";
import { pollUntil } from "../support/timing.js";

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

interface SpawnRecord {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
}

function fullRecordingSpawn(records: SpawnRecord[]): SpawnDaemon {
  return (file, args, options) => {
    records.push({ file, args, env: options.env });
    return { unref: () => undefined };
  };
}

function withBunHost(run: () => void): void {
  Object.defineProperty(process.versions, "bun", { value: "1.4.0", configurable: true });
  try {
    run();
  } finally {
    Reflect.deleteProperty(process.versions, "bun");
  }
}

void test("a Bun host with a found Node spawns it with the daemon entry", () => {
  withStateDir((stateDir) => {
    const records: SpawnRecord[] = [];
    const found: (string | undefined)[] = [];
    withBunHost(() => {
      launchFilteredDaemon(
        ENTRY,
        stateDir,
        { PATH: "/opt/node/bin" },
        fullRecordingSpawn(records),
        (pathValue) => {
          found.push(pathValue);
          return "/opt/node/bin/node";
        },
      );
    });
    assert.deepEqual(found, ["/opt/node/bin"]);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.file, "/opt/node/bin/node");
    assert.deepEqual(records[0].args, [ENTRY]);
  });
});

void test("a Bun host whose PATH has only relative entries refuses and spawns nothing", () => {
  withStateDir((stateDir) => {
    const records: SpawnRecord[] = [];
    withBunHost(() => {
      assert.throws(
        () => {
          const relativeOnly = ["", "bin", "./node_modules/.bin"].join(delimiter);
          launchFilteredDaemon(ENTRY, stateDir, { PATH: relativeOnly }, fullRecordingSpawn(records));
        },
        (error: unknown) => error instanceof RealmError && error.code === "REALM_NOT_ACTIVE",
      );
    });
    assert.deepEqual(records, []);
  });
});

void test("a Bun host passes PATH to the child and drops a sentinel", () => {
  withStateDir((stateDir) => {
    const records: SpawnRecord[] = [];
    withBunHost(() => {
      launchFilteredDaemon(
        ENTRY,
        stateDir,
        { PATH: "/opt/node/bin", REALM_SENTINEL_SECRET: "leak" },
        fullRecordingSpawn(records),
        () => "/opt/node/bin/node",
      );
    });
    assert.equal(records[0]?.env.PATH, "/opt/node/bin");
    assert.equal(Object.hasOwn(records[0].env, "REALM_SENTINEL_SECRET"), false);
  });
});

void test("startDetachedDaemon under Bun runs a Node from an absolute PATH directory and refuses with none", async () => {
  const root = mkdtempSync(join(tmpdir(), "realm-launch-bin-"));
  const marker = join(root, "marker");
  const binDir = join(root, "bin");
  const stateDir = join(root, "state");
  const previousPath = process.env.PATH;
  try {
    mkdirSync(binDir);
    const fake = join(binDir, "node");
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\n`, { mode: 0o755 });
    chmodSync(fake, 0o755);
    process.env.PATH = binDir;
    withBunHost(() => {
      startDetachedDaemon(ENTRY, stateDir);
    });
    await pollUntil(() => existsSync(marker) && readFileSync(marker, "utf8").length > 0, "the fake node ran");
    assert.equal(readFileSync(marker, "utf8"), `${ENTRY}\n`);
    rmSync(marker);
    process.env.PATH = "";
    withBunHost(() => {
      assert.throws(
        () => {
          startDetachedDaemon(ENTRY, stateDir);
        },
        (error: unknown) => error instanceof RealmError && error.code === "REALM_NOT_ACTIVE",
      );
    });
    assert.equal(existsSync(marker), false);
  } finally {
    if (previousPath === undefined) {
      Reflect.deleteProperty(process.env, "PATH");
    } else {
      process.env.PATH = previousPath;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
