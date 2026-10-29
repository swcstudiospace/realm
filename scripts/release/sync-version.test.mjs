import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_VERSION_FILES, syncVersion } from './sync-version.mjs';

const tempRoots = [];

const ADAPTER_JSON = [
  'adapters/claude-plugin/.claude-plugin/plugin.json',
  'adapters/muse-code/.muse-plugin/plugin.json',
  'adapters/hermes-agent/plugin.json',
  'adapters/prime-agent/package.json',
];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const PACKAGE = { name: 'agent-realm', private: true, version: '0.0.0', type: 'module' };

const LOCK = {
  name: 'agent-realm',
  version: '0.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'agent-realm', version: '0.0.0', dependencies: { 'left-pad': '1.3.0' } },
    'node_modules/left-pad': { version: '1.3.0' },
  },
};

function makeRoot({ lock = LOCK } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sync-version-test-'));
  tempRoots.push(root);
  writeFileSync(path.join(root, 'package.json'), `${JSON.stringify(PACKAGE, null, 2)}\n`);
  writeFileSync(path.join(root, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  for (const relative of ADAPTER_JSON) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), `${JSON.stringify({ name: 'realm', version: '0.0.0' }, null, 2)}\n`);
  }
  return root;
}

function read(root, name) {
  return readFileSync(path.join(root, name), 'utf8');
}

test('updates the version in package.json and package-lock.json', () => {
  const root = makeRoot();

  const result = syncVersion({ root, version: '0.1.0' });

  assert.deepEqual(result, {
    version: '0.1.0',
    changed: ['package.json', 'package-lock.json', ...ADAPTER_JSON],
  });

  for (const relative of ADAPTER_JSON) {
    assert.equal(JSON.parse(read(root, relative)).version, '0.1.0');
  }

  const packageText = read(root, 'package.json');
  const pkg = JSON.parse(packageText);
  assert.equal(pkg.version, '0.1.0');
  assert.deepEqual(Object.keys(pkg), ['name', 'private', 'version', 'type']);
  assert.equal(packageText, `${JSON.stringify(pkg, null, 2)}\n`);

  const lockText = read(root, 'package-lock.json');
  const lock = JSON.parse(lockText);
  assert.equal(lock.version, '0.1.0');
  assert.equal(lock.packages[''].version, '0.1.0');
  assert.equal(lock.packages['node_modules/left-pad'].version, '1.3.0');
  assert.deepEqual(Object.keys(lock), ['name', 'version', 'lockfileVersion', 'requires', 'packages']);
  assert.equal(lockText, `${JSON.stringify(lock, null, 2)}\n`);
});

test('rejects any version that is not exactly 0.<minor>.<patch> and leaves files unchanged', () => {
  const root = makeRoot();
  const packageBefore = read(root, 'package.json');
  const lockBefore = read(root, 'package-lock.json');

  for (const version of ['1.0.0', '0.1', 'v0.1.0', '0.1.0-rc.1', '0.1.0 ', '0.1.x', '']) {
    assert.throws(() => syncVersion({ root, version }), /version must match 0\.<minor>\.<patch>/);
  }

  assert.equal(read(root, 'package.json'), packageBefore);
  assert.equal(read(root, 'package-lock.json'), lockBefore);
});

test('a second run leaves the bytes of both files unchanged', () => {
  const root = makeRoot();

  syncVersion({ root, version: '0.2.0' });
  const packageAfterFirst = read(root, 'package.json');
  const lockAfterFirst = read(root, 'package-lock.json');

  const second = syncVersion({ root, version: '0.2.0' });

  assert.deepEqual(second, { version: '0.2.0', changed: [] });
  assert.equal(read(root, 'package.json'), packageAfterFirst);
  assert.equal(read(root, 'package-lock.json'), lockAfterFirst);
});

test('throws when package-lock.json has no packages[""] entry and writes nothing', () => {
  const lockWithoutRoot = {
    name: 'agent-realm',
    version: '0.0.0',
    lockfileVersion: 3,
    packages: {
      'node_modules/left-pad': { version: '1.3.0' },
    },
  };
  const root = makeRoot({ lock: lockWithoutRoot });
  const packageBefore = read(root, 'package.json');
  const lockBefore = read(root, 'package-lock.json');

  assert.throws(() => syncVersion({ root, version: '0.1.0' }), /packages\[""\] entry/);

  assert.equal(read(root, 'package.json'), packageBefore);
  assert.equal(read(root, 'package-lock.json'), lockBefore);
});

test('writes nothing when an adapter manifest is missing, malformed or not an object', () => {
  const cases = [
    [(root) => rmSync(path.join(root, ADAPTER_JSON[2])), /cannot read .*hermes-agent[\\/]plugin\.json/],
    [(root) => writeFileSync(path.join(root, ADAPTER_JSON[1]), '{ not json'), /cannot parse .*plugin\.json as JSON/],
    [(root) => writeFileSync(path.join(root, ADAPTER_JSON[3]), '[]\n'), /must contain a JSON object/],
  ];
  for (const [break_, expected] of cases) {
    const root = makeRoot();
    break_(root);
    const packageBefore = read(root, 'package.json');
    const lockBefore = read(root, 'package-lock.json');
    const claudeBefore = read(root, ADAPTER_JSON[0]);

    assert.throws(() => syncVersion({ root, version: '0.2.0' }), expected);

    assert.equal(read(root, 'package.json'), packageBefore);
    assert.equal(read(root, 'package-lock.json'), lockBefore);
    assert.equal(read(root, ADAPTER_JSON[0]), claudeBefore);
  }
});

test('reports only the files whose version changed and keeps every other adapter field', () => {
  const root = makeRoot();
  const claude = path.join(root, ADAPTER_JSON[0]);
  writeFileSync(claude, `${JSON.stringify({ name: 'realm', version: '0.2.0', skills: ['a', 'b'] }, null, 2)}\n`);

  const result = syncVersion({ root, version: '0.2.0' });

  assert.deepEqual(result.changed, ['package.json', 'package-lock.json', ...ADAPTER_JSON.slice(1)]);
  assert.deepEqual(JSON.parse(read(root, ADAPTER_JSON[0])), { name: 'realm', version: '0.2.0', skills: ['a', 'b'] });
  assert.deepEqual(Object.keys(JSON.parse(read(root, ADAPTER_JSON[1]))), ['name', 'version']);
});

test('RELEASE_VERSION_FILES is exactly the set of files syncVersion rewrites', () => {
  const root = makeRoot();

  assert.deepEqual(syncVersion({ root, version: '0.2.0' }).changed, RELEASE_VERSION_FILES);
});

test('the committed release-owned manifests are already in the form the script writes', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  for (const relative of RELEASE_VERSION_FILES) {
    const text = readFileSync(path.join(repoRoot, relative), 'utf8');
    assert.equal(text, `${JSON.stringify(JSON.parse(text), null, 2)}\n`, `${relative} would be reformatted by a release`);
  }
});

test('the command line prints the staged file list for --files and rejects other argument counts', () => {
  const script = fileURLToPath(new URL('./sync-version.mjs', import.meta.url));

  const files = spawnSync(process.execPath, [script, '--files'], { encoding: 'utf8' });
  assert.equal(files.status, 0);
  assert.deepEqual(files.stdout.trimEnd().split('\n'), RELEASE_VERSION_FILES);

  const usage = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /usage: sync-version\.mjs/);
});
