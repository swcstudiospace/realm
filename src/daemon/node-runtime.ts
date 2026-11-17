// Where a Bun host (the compiled Omp binary) finds a Node to run the daemon with. process.execPath there is the Omp
// binary, which would read the daemon entry as a prompt, so the daemon needs a real Node taken from the PATH the caller
// handed in. Only an absolute PATH directory counts: a relative or empty entry would let the current directory choose the
// executable. The match must be a regular file (after following symlinks) with an execute bit. Node's version is not probed:
// a Node older than `engines` exits and the daemon log already reports it.

import { statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

// Whether the path is a regular file with an execute bit. A stat error (absent, dangling symlink, no permission) is false.
function isExecutableFile(path: string): boolean {
  try {
    const stats = statSync(path);
    return stats.isFile() && (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

// The first `<dir>/node` for an absolute directory of pathValue that passes the probe, or null. Never throws.
export function findNodeBinary(
  pathValue: string | undefined,
  probe: (path: string) => boolean = isExecutableFile,
): string | null {
  if (pathValue === undefined || pathValue === "") {
    return null;
  }
  for (const dir of pathValue.split(delimiter)) {
    if (dir === "" || !isAbsolute(dir)) {
      continue;
    }
    const candidate = join(dir, "node");
    let usable: boolean;
    try {
      usable = probe(candidate);
    } catch {
      usable = false;
    }
    if (usable) {
      return candidate;
    }
  }
  return null;
}
