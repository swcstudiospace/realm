// Lockfile integrity gate (Phase 7 supply-chain item). Builtins only, and it fetches nothing: it reads package-lock.json
// and checks its own claims. Every `packages` entry with a `resolved` URL must carry an `integrity` value that is a
// sha512 SRI string, must resolve to https://registry.npmjs.org and nowhere else, and no entry may be a `link`
// (a `file:` workspace or path dependency) or declare a dependency on a `file:`, `link:` or git source. Re-hashing a
// tarball against its integrity value is deliberately out of scope here; `npm ci` does that on every install.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LOCKFILE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "package-lock.json");

export const ALLOWED_REGISTRY_HOST = "registry.npmjs.org";

const SHA512_SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;
const DEPENDENCY_FIELDS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
// A dependency spec that names a path, a git remote or a tarball URL instead of a registry version or range. An
// `npm:` alias is a registry spec and is not matched.
const NON_REGISTRY_SPEC = /^(?:file:|link:|git\+|git:|git@|github:|gitlab:|bitbucket:|gist:|[a-z][a-z0-9+.-]*:\/\/)/i;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvedViolation(resolved) {
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return `resolved is not a URL: ${resolved}`;
  }
  if (url.protocol !== "https:" || url.host !== ALLOWED_REGISTRY_HOST) {
    return `resolves to ${url.protocol}//${url.host}, not https://${ALLOWED_REGISTRY_HOST}`;
  }
  return undefined;
}

// Returns { checked, violations } for a parsed lockfile. `checked` counts the entries that carry a `resolved` URL.
// Each violation is { entry, reason } where entry is the lockfile key ("" is the root project).
export function checkLockfile(lock) {
  const violations = [];
  if (!isRecord(lock) || !isRecord(lock.packages)) {
    return { checked: 0, violations: [{ entry: "", reason: "lockfile has no packages map (lockfileVersion 2 or 3 required)" }] };
  }
  let checked = 0;
  for (const [entry, meta] of Object.entries(lock.packages)) {
    if (!isRecord(meta)) {
      violations.push({ entry, reason: "entry is not an object" });
      continue;
    }
    if (meta.link === true) {
      violations.push({ entry, reason: `link entry (local path dependency)${typeof meta.resolved === "string" ? ` to ${meta.resolved}` : ""}` });
    } else if (typeof meta.resolved === "string") {
      checked += 1;
      if (typeof meta.integrity !== "string" || meta.integrity === "") {
        violations.push({ entry, reason: "resolved entry has no integrity value" });
      } else if (!SHA512_SRI.test(meta.integrity)) {
        violations.push({ entry, reason: "integrity is not a sha512 SRI value" });
      }
      const reason = resolvedViolation(meta.resolved);
      if (reason !== undefined) {
        violations.push({ entry, reason });
      }
    }
    for (const field of DEPENDENCY_FIELDS) {
      const deps = meta[field];
      if (!isRecord(deps)) {
        continue;
      }
      for (const [name, spec] of Object.entries(deps)) {
        if (typeof spec === "string" && NON_REGISTRY_SPEC.test(spec)) {
          violations.push({ entry, reason: `${field}.${name} is a non-registry dependency: ${spec}` });
        }
      }
    }
  }
  return { checked, violations };
}

export function main(lockPath = DEFAULT_LOCKFILE) {
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    console.error(`lockfile integrity: cannot read ${lockPath}: ${error instanceof Error ? error.message : "unknown error"}`);
    return 1;
  }
  const { checked, violations } = checkLockfile(lock);
  if (violations.length === 0) {
    console.log(`lockfile integrity: ${String(checked)} resolved entries checked, no violations`);
    return 0;
  }
  for (const { entry, reason } of violations) {
    console.error(`lockfile integrity: ${entry === "" ? "(root)" : entry}: ${reason}`);
  }
  console.error(`lockfile integrity: ${String(checked)} resolved entries checked, ${String(violations.length)} violations`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv[2]);
}
