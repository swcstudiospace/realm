import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^0\.\d+\.\d+$/;

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${file}: ${error.message}`, { cause: error });
  }
}

function parseJson(file, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`cannot parse ${file} as JSON: ${error.message}`, { cause: error });
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function syncVersion({ root, version }) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`version must match 0.<minor>.<patch>, got ${JSON.stringify(version)}`);
  }

  const packagePath = path.join(root, 'package.json');
  const lockPath = path.join(root, 'package-lock.json');
  const packageText = readText(packagePath);
  const lockText = readText(lockPath);
  const pkg = parseJson(packagePath, packageText);
  const lock = parseJson(lockPath, lockText);

  if (!isObject(pkg)) {
    throw new Error(`${packagePath} must contain a JSON object`);
  }
  if (!isObject(lock) || !isObject(lock.packages) || !isObject(lock.packages[''])) {
    throw new Error(`${lockPath} has no packages[""] entry`);
  }

  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;

  const changed = [];
  const updates = [
    { file: packagePath, original: packageText, value: pkg },
    { file: lockPath, original: lockText, value: lock },
  ];
  for (const { file, original, value } of updates) {
    const next = serialize(value);
    if (next !== original) {
      writeFileSync(file, next, 'utf8');
      changed.push(path.basename(file));
    }
  }
  return { version, changed };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function isEntrypoint() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isEntrypoint()) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
      throw new Error('usage: sync-version.mjs <0.minor.patch>');
    }
    const result = syncVersion({ root: repoRoot, version: args[0] });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
