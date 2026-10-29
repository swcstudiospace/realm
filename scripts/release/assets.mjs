import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Release assets published beside the tarball: SHA256SUMS and a CycloneDX SBOM of the production dependency tree.
//
// `npm sbom --omit dev` is not used: on npm 11.16.0 it drops three packages that package-lock.json reaches from the
// production dependencies (fast-deep-equal, @types/node, undici-types). The SBOM is built from a copy of the manifest
// without devDependencies instead, and verifySbom proves that every production package in the lockfile is listed.

const NODE_MODULES = 'node_modules/';
const SBOM_MAX_BYTES = 16 * 1024 * 1024;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// One `sha256sum --check` line: the digest, two spaces, then the file name without a directory.
export function checksumLine(name, bytes) {
  if (name !== path.basename(name)) {
    throw new Error(`checksum name must not contain a directory, got ${JSON.stringify(name)}`);
  }
  return `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`;
}

// The manifest the SBOM is generated from: everything except devDependencies and scripts.
export function productionManifest(pkg) {
  if (!isObject(pkg) || typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
    throw new Error('package.json needs a string name and version');
  }
  const manifest = { ...pkg };
  delete manifest.devDependencies;
  delete manifest.scripts;
  return manifest;
}

// name@version of every lockfile package that is not dev-only. Optional platform packages are included.
export function productionPackages(lock) {
  if (!isObject(lock) || !isObject(lock.packages)) {
    throw new Error('package-lock.json has no packages object');
  }
  const refs = new Set();
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (location === '' || entry.dev === true) {
      continue;
    }
    const name = location.slice(location.lastIndexOf(NODE_MODULES) + NODE_MODULES.length);
    refs.add(`${name}@${entry.version}`);
  }
  return refs;
}

// Throws unless the SBOM is CycloneDX for the released version and lists every production package of the lockfile.
export function verifySbom({ sbom, lock, version }) {
  if (!isObject(sbom) || sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components)) {
    throw new Error('SBOM is not a CycloneDX document with components');
  }
  if (sbom.metadata?.component?.version !== version) {
    throw new Error(`SBOM root version ${String(sbom.metadata?.component?.version)} is not ${version}`);
  }
  const listed = new Set(sbom.components.map((component) => component['bom-ref']));
  const missing = [...productionPackages(lock)].filter((ref) => !listed.has(ref));
  if (missing.length > 0) {
    throw new Error(`SBOM omits production packages: ${missing.join(', ')}`);
  }
  return { components: sbom.components.length };
}

function npm(args, options) {
  return execFileSync('npm', args, { encoding: 'utf8', maxBuffer: SBOM_MAX_BYTES, ...options });
}

export function writeReleaseAssets({ root, tarball, out }) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lockText = readFileSync(path.join(root, 'package-lock.json'), 'utf8');
  const lock = JSON.parse(lockText);
  mkdirSync(out, { recursive: true });

  writeFileSync(path.join(out, 'SHA256SUMS'), checksumLine(path.basename(tarball), readFileSync(tarball)));

  // The directory name becomes the SBOM root component name, so it must be the package name.
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'realm-sbom-'));
  try {
    const work = path.join(scratch, pkg.name);
    mkdirSync(work);
    writeFileSync(path.join(work, 'package.json'), `${JSON.stringify(productionManifest(pkg), null, 2)}\n`);
    copyFileSync(path.join(root, 'package-lock.json'), path.join(work, 'package-lock.json'));
    npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: work, stdio: ['ignore', 'ignore', 'inherit'] });
    const sbomText = npm(['sbom', '--sbom-format', 'cyclonedx', '--package-lock-only'], { cwd: work, stdio: ['ignore', 'pipe', 'inherit'] });
    const { components } = verifySbom({ sbom: JSON.parse(sbomText), lock, version: pkg.version });
    writeFileSync(path.join(out, `${pkg.name}-${pkg.version}.cdx.json`), sbomText);
    return { version: pkg.version, components };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function isEntrypoint() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--root', '--tarball', '--out'].includes(flag) || value === undefined) {
      throw new Error('usage: assets.mjs [--root <dir>] --tarball <file.tgz> --out <dir>');
    }
    values.set(flag, value);
  }
  if (!values.has('--tarball') || !values.has('--out')) {
    throw new Error('usage: assets.mjs [--root <dir>] --tarball <file.tgz> --out <dir>');
  }
  return { root: path.resolve(values.get('--root') ?? repoRoot), tarball: path.resolve(values.get('--tarball')), out: path.resolve(values.get('--out')) };
}

if (isEntrypoint()) {
  try {
    const result = writeReleaseAssets(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
