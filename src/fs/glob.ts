// Glob matcher for credential and allow patterns (D-32, FS-03). A small local matcher with
// no dependency: "*" matches any run of characters inside one path segment, "?" matches
// exactly one character, and a segment that is exactly "**" matches zero or more whole
// segments. Patterns and paths use "/" separators. path.matchesGlob is not used because it
// is experimental in Node 22.

export function matchGlob(pattern: string, relPath: string): boolean {
  const patternSegments = pattern.split("/").filter((segment) => segment !== "" && segment !== ".");
  const pathSegments = relPath.split("/").filter((segment) => segment !== "" && segment !== ".");
  return matchFrom(patternSegments, pathSegments, 0, 0, new Set<number>());
}

// `failed` memoizes (pattern index, path index) states already known not to match, so
// several "**" segments cannot cause exponential work on a long path.
function matchFrom(
  pattern: readonly string[],
  path: readonly string[],
  pi: number,
  si: number,
  failed: Set<number>,
): boolean {
  const key = pi * (path.length + 1) + si;
  if (failed.has(key)) {
    return false;
  }
  const segment = pattern[pi];
  let matched = false;
  if (segment === undefined) {
    matched = si === path.length;
  } else if (segment === "**") {
    for (let next = si; !matched && next <= path.length; next += 1) {
      matched = matchFrom(pattern, path, pi + 1, next, failed);
    }
  } else {
    const name = path[si];
    matched =
      name !== undefined &&
      matchSegment(segment, name) &&
      matchFrom(pattern, path, pi + 1, si + 1, failed);
  }
  if (!matched) {
    failed.add(key);
  }
  return matched;
}

// Single-segment match: "*" any run of characters, "?" exactly one. "*" is the only token
// that spans several characters, so one backtrack point is enough.
function matchSegment(pattern: string, name: string): boolean {
  let p = 0;
  let n = 0;
  let starP = -1;
  let starN = 0;
  while (n < name.length) {
    const token = pattern[p];
    if (token === "*") {
      starP = p;
      starN = n;
      p += 1;
    } else if (token !== undefined && (token === "?" || token === name[n])) {
      p += 1;
      n += 1;
    } else if (starP !== -1) {
      starN += 1;
      p = starP + 1;
      n = starN;
    } else {
      return false;
    }
  }
  while (pattern[p] === "*") {
    p += 1;
  }
  return p === pattern.length;
}
