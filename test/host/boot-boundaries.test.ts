// Who may read presence markers and boot reports, and who may not (BOOT-05, BOOT-06, BOOT-08; threat T-23-20). A marker and a
// self-reported boot are labels: they change a doctor sentence, a metric and a log line, and authorize nothing. So no policy,
// gate, lifecycle or runtime module may import the presence writer, the boot driver or the observer, and the set of modules that
// import presence or the report vocabulary is pinned exactly. Static: it reads source text.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// This test runs from dist/test/host, so the repository root is three levels up.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      found.push(path);
    }
  }
  return found;
}

const SPECIFIER = /\bfrom\s+"(\.{1,2}\/[^"]+)"/g;

// The repository-relative source files that import src/host/<name>.ts, resolved from each import's own directory.
function importersOf(name: string): string[] {
  const target = join(SRC, "host", `${name}.ts`);
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier !== undefined && resolve(dirname(file), specifier.replace(/\.js$/, ".ts")) === target) {
        found.push(relative(ROOT, file));
        break;
      }
    }
  }
  return found.sort();
}

void test("only the observer, the doctor host check and realm host import the presence module", () => {
  assert.deepEqual(importersOf("presence"), ["src/cli/host.ts", "src/doctor/host-checks.ts", "src/host/boot-observer.ts"]);
});

void test("only the daemon recorder, the metrics registry and the observer import the boot report vocabulary", () => {
  assert.deepEqual(importersOf("boot-report"), ["src/daemon/host-boot.ts", "src/host/boot-observer.ts", "src/observe/metrics.ts"]);
});

void test("no policy, gate, lifecycle, runtime or core module imports the boot driver, the observer or presence", () => {
  const forbidden = ["boot-driver", "boot-observer", "presence"];
  const guarded = ["daemon", "tools", "lifecycle", "core", "fs", "runtime"].map((dir) => join(SRC, dir));
  for (const name of forbidden) {
    for (const file of importersOf(name)) {
      const path = join(ROOT, file);
      assert.equal(
        guarded.some((dir) => path.startsWith(`${dir}/`)),
        false,
        `${file} imports host/${name}: authorization must never read a host id or a marker`,
      );
    }
  }
});

void test("the guarded directories exist and hold source, so the boundary test cannot pass on an empty tree", () => {
  for (const dir of ["daemon", "tools", "lifecycle", "core", "fs", "runtime"]) {
    assert.ok(sourceFiles(join(SRC, dir)).length > 0, dir);
  }
});
