// The package's own version, read from its manifest on first use and memoised.
//
// The release job rewrites the manifest's version (scripts/release/sync-version.mjs), so a version copied
// into source goes stale at the first release: release 0.2.0 advertised 0.0.0 on both agent surfaces. The
// manifest sits above the source and the compiled layout alike, so the walk up works from either (the same
// approach src/contract/validate.ts takes to find the JSON schemas).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Semantic Versioning 2.0.0 core, with an optional pre-release and build part. A manifest that does not
// carry one is a broken install, and a surface must not advertise a made-up version in its place.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

let memo: string | undefined;

export function packageVersion(): string {
  if (memo !== undefined) {
    return memo;
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      const version: unknown =
        typeof parsed === "object" && parsed !== null && "version" in parsed ? parsed.version : undefined;
      if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
        throw new Error("package.json does not carry a valid version");
      }
      memo = version;
      return version;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("package.json not found above the core module");
    }
    dir = parent;
  }
}
