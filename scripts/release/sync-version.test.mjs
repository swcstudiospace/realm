import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncVersion } from './sync-version.mjs';

const tempRoots = [];

const ADAPTER_JSON = [
  'adapters/claude-plugin/.claude-plugin/plugin.json',
  'adapters/muse-code/.muse-plugin/plugin.json',
  'adapters/prime-agent/package.json',
];
const ADAPTER_YAML = 'adapters/hermes-agent/plugin.yaml';

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
  mkdirSync(path.join(root, 'adapters/hermes-agent'), { recursive: true });
  writeFileSync(path.join(root, ADAPTER_YAML), 'name: realm\nversion: 0.0.0\ndescription: test\n');
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
    changed: ['package.json', 'package-lock.json', ...ADAPTER_JSON, ADAPTER_YAML],
  });

  for (const relative of ADAPTER_JSON) {
    assert.equal(JSON.parse(read(root, relative)).version, '0.1.0');
  }
  assert.match(read(root, ADAPTER_YAML), /^version: 0\.1\.0$/m);
  assert.match(read(root, ADAPTER_YAML), /^name: realm$/m);

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
