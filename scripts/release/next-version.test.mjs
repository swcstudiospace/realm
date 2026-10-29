import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planNextVersion } from './next-version.mjs';

const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function makeRepo({ milestone = { milestone: 'v2.0', minor: 2 }, tags = [] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'next-version-test-'));
  tempRoots.push(root);
  git(root, ['init', '-q']);
  mkdirSync(path.join(root, 'release'));
  writeFileSync(path.join(root, 'release', 'milestone.json'), typeof milestone === 'string' ? milestone : `${JSON.stringify(milestone)}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'chore: seed']);
  for (const tag of tags) {
    git(root, ['tag', tag]);
  }
  return root;
}

test('starts a new milestone at <minor>.0 and names the previous tag', () => {
  const root = makeRepo({ tags: ['v0.1.2', 'v0.1.3'] });

  assert.deepEqual(planNextVersion(root), { version: '0.2.0', tag: 'v0.2.0', previousTag: 'v0.1.3' });
});

test('increments the part within the milestone and ignores tags that are not releases', () => {
  const root = makeRepo({ tags: ['v0.2.0', 'v0.2.9', 'v0.2.10', 'v0.2.11-rc.1', 'v1.5.0', 'vnext'] });

  assert.deepEqual(planNextVersion(root), { version: '0.2.11', tag: 'v0.2.11', previousTag: 'v0.2.10' });
});

test('fails when the milestone minor is behind the latest tag', () => {
  const root = makeRepo({ milestone: { milestone: 'v1.0', minor: 1 }, tags: ['v0.2.0'] });

  assert.throws(() => planNextVersion(root), /milestone minor 1 is behind latest tag v0\.2\.0/);
});

test('rejects an unreadable or invalid release/milestone.json', () => {
  const cases = [
    ['{ not json', /cannot read or parse .*milestone\.json/],
    ['[]', /must contain a JSON object/],
    [{ milestone: '2.0', minor: 2 }, /milestone in .* must match v<digits>\.<digits>/],
    [{ milestone: 'v2.0', minor: 0 }, /minor in .* must be a positive integer/],
    [{ milestone: 'v2.0', minor: '2' }, /minor in .* must be a positive integer/],
  ];
  for (const [milestone, expected] of cases) {
    assert.throws(() => planNextVersion(makeRepo({ milestone })), expected);
  }
});
