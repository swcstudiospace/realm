import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, nextVersion, parseTag } from './version.mjs';

test('parseTag accepts only v<digits>.<digits>.<digits>', () => {
  assert.deepEqual(parseTag('v0.1.3'), { major: 0, minor: 1, patch: 3 });
  assert.deepEqual(parseTag('v1.0.0'), { major: 1, minor: 0, patch: 0 });
  for (const tag of ['0.1.3', 'v0.1', 'v0.1.3-rc.1', 'v0.1.3.4', 'release-v0.1.3', 'v0.x.1', '', undefined]) {
    assert.equal(parseTag(tag), null, `expected ${String(tag)} to be rejected`);
  }
});

test('compareVersions orders by major, then minor, then patch', () => {
  const a = parseTag('v0.2.0');
  const b = parseTag('v0.10.0');
  assert.ok(compareVersions(a, b) < 0);
  assert.ok(compareVersions(b, a) > 0);
  assert.equal(compareVersions(parseTag('v0.1.3'), parseTag('v0.1.3')), 0);
  assert.ok(compareVersions(parseTag('v0.9.9'), parseTag('v1.0.0')) < 0);
});

test('nextVersion starts the milestone at 0.<milestoneMinor>.0 when no tags exist', () => {
  assert.deepEqual(nextVersion({ tags: [], milestoneMinor: 1 }), {
    version: '0.1.0',
    tag: 'v0.1.0',
    previousTag: null,
  });
});

test('nextVersion increments the patch when the latest tag is on the milestone minor', () => {
  assert.deepEqual(nextVersion({ tags: ['v0.1.0', 'v0.1.3'], milestoneMinor: 1 }), {
    version: '0.1.4',
    tag: 'v0.1.4',
    previousTag: 'v0.1.3',
  });
});

test('nextVersion moves to the milestone minor when the latest tag is behind it', () => {
  assert.deepEqual(nextVersion({ tags: ['v0.1.3'], milestoneMinor: 2 }), {
    version: '0.2.0',
    tag: 'v0.2.0',
    previousTag: 'v0.1.3',
  });
});

test('nextVersion chooses the latest tag numerically, not lexically', () => {
  assert.deepEqual(nextVersion({ tags: ['v0.1.9', 'v0.1.10'], milestoneMinor: 1 }), {
    version: '0.1.11',
    tag: 'v0.1.11',
    previousTag: 'v0.1.10',
  });
});

test('nextVersion ignores tags whose major is not 0', () => {
  assert.deepEqual(nextVersion({ tags: ['v1.0.0'], milestoneMinor: 1 }), {
    version: '0.1.0',
    tag: 'v0.1.0',
    previousTag: null,
  });
  assert.deepEqual(nextVersion({ tags: ['v1.9.9', 'v0.1.2', 'v2.0.0'], milestoneMinor: 1 }), {
    version: '0.1.3',
    tag: 'v0.1.3',
    previousTag: 'v0.1.2',
  });
});

test('nextVersion ignores malformed tags', () => {
  const malformed = ['0.1.3', 'v0.1', 'v0.1.3-rc.1', 'v0.1.3.4', 'latest', 'v0.x.1'];
  assert.deepEqual(nextVersion({ tags: malformed, milestoneMinor: 1 }), {
    version: '0.1.0',
    tag: 'v0.1.0',
    previousTag: null,
  });
  assert.deepEqual(nextVersion({ tags: ['v0.1.3', 'v0.9', 'junk'], milestoneMinor: 1 }), {
    version: '0.1.4',
    tag: 'v0.1.4',
    previousTag: 'v0.1.3',
  });
});

test('nextVersion throws when the milestone minor is behind the latest tag', () => {
  assert.throws(
    () => nextVersion({ tags: ['v0.1.0', 'v0.3.0'], milestoneMinor: 2 }),
    /milestone minor 2 is behind latest tag v0\.3\.0 \(minor 3\)/,
  );
});

test('nextVersion throws when the milestone minor is not a positive integer', () => {
  for (const milestoneMinor of [0, -1, 1.5, '1', NaN, undefined, null]) {
    assert.throws(
      () => nextVersion({ tags: [], milestoneMinor }),
      /milestoneMinor must be a positive integer/,
      `expected ${String(milestoneMinor)} to be rejected`,
    );
  }
});

test('nextVersion throws when tags is not an array', () => {
  assert.throws(() => nextVersion({ tags: 'v0.1.0', milestoneMinor: 1 }), /tags must be an array/);
});
