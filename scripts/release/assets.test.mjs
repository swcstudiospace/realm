import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksumLine, productionManifest, productionPackages, verifySbom } from './assets.mjs';

const LOCK = {
  packages: {
    '': { name: 'agent-realm', version: '0.2.0' },
    'node_modules/ajv': { version: '8.20.0' },
    'node_modules/ajv/node_modules/json-schema-traverse': { version: '1.0.0' },
    'node_modules/@types/node': { version: '22.20.5' },
    'node_modules/eslint': { version: '10.13.0', dev: true },
  },
};

function sbom(refs, version = '0.2.0') {
  return { bomFormat: 'CycloneDX', metadata: { component: { version } }, components: refs.map((ref) => ({ 'bom-ref': ref })) };
}

test('checksumLine matches the sha256sum format and rejects a directory in the name', () => {
  assert.equal(checksumLine('a.tgz', Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  a.tgz\n');
  assert.throws(() => checksumLine('dist/a.tgz', Buffer.from('abc')), /must not contain a directory/);
});

test('productionManifest drops devDependencies and scripts and keeps the rest', () => {
  assert.deepEqual(
    productionManifest({ name: 'x', version: '1.0.0', scripts: { test: 't' }, devDependencies: { a: '1' }, dependencies: { b: '2' } }),
    { name: 'x', version: '1.0.0', dependencies: { b: '2' } },
  );
  assert.throws(() => productionManifest({ name: 'x' }), /name and version/);
});

test('productionPackages lists nested and scoped packages and skips dev-only ones', () => {
  assert.deepEqual([...productionPackages(LOCK)].sort(), ['@types/node@22.20.5', 'ajv@8.20.0', 'json-schema-traverse@1.0.0']);
});

test('verifySbom accepts a complete SBOM and rejects an omitted package, a wrong version and a wrong format', () => {
  const complete = ['ajv@8.20.0', 'json-schema-traverse@1.0.0', '@types/node@22.20.5', 'extra@1.0.0'];
  assert.deepEqual(verifySbom({ sbom: sbom(complete), lock: LOCK, version: '0.2.0' }), { components: 4 });
  assert.throws(() => verifySbom({ sbom: sbom(complete.slice(0, 2)), lock: LOCK, version: '0.2.0' }), /omits production packages: @types\/node@22\.20\.5/);
  assert.throws(() => verifySbom({ sbom: sbom(complete, '0.1.3'), lock: LOCK, version: '0.2.0' }), /root version 0\.1\.3 is not 0\.2\.0/);
  assert.throws(() => verifySbom({ sbom: { bomFormat: 'SPDX' }, lock: LOCK, version: '0.2.0' }), /not a CycloneDX/);
});
