import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^0\.\d+\.\d+$/;

// Host adapter manifests that carry the release version. JSON manifests hold a top-level
// "version"; the Hermes plugin.yaml holds a top-level "version:" line.
const ADAPTER_JSON_MANIFESTS = [
  'adapters/claude-plugin/.claude-plugin/plugin.json',
  'adapters/muse-code/.muse-plugin/plugin.json',
  'adapters/prime-agent/package.json',
];
const ADAPTER_YAML_MANIFESTS = ['adapters/hermes-agent/plugin.yaml'];

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
    { file: packagePath, original: packageText, next: serialize(pkg) },
    { file: lockPath, original: lockText, next: serialize(lock) },
  ];
  for (const relative of ADAPTER_JSON_MANIFESTS) {
    const file = path.join(root, relative);
    const original = readText(file);
    const manifest = parseJson(file, original);
    if (!isObject(manifest)) {
      throw new Error(`${file} must contain a JSON object`);
    }
    manifest.version = version;
    updates.push({ file, original, next: serialize(manifest) });
  }
  for (const relative of ADAPTER_YAML_MANIFESTS) {
    const file = path.join(root, relative);
    const original = readText(file);
    const matches = original.match(/^version:.*$/gm) ?? [];
    if (matches.length !== 1) {
      throw new Error(`${file} must have exactly one top-level version line`);
    }
    updates.push({ file, original, next: original.replace(/^version:.*$/m, `version: ${version}`) });
  }
  for (const { file, original, next } of updates) {
    if (next !== original) {
      writeFileSync(file, next, 'utf8');
      changed.push(path.relative(root, file));
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
