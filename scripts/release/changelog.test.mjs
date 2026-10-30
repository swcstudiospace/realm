import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateChangelog } from './changelog.mjs';

const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const SEED_CHANGELOG = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [0.0.1] - 2026-01-01',
  '',
  '### Added',
  '- Seed entry',
  '',
].join('\n');

const SEED_TAIL = '## [0.0.1] - 2026-01-01\n\n### Added\n- Seed entry\n';

let commitCounter = 0;

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30000 });
}

function commit(cwd, subject, file = 'work.txt', body) {
  commitCounter += 1;
  writeFileSync(path.join(cwd, file), `${commitCounter}\n`);
  git(cwd, ['add', '-A']);
  const messages = body === undefined ? [subject] : [subject, body];
  git(cwd, [
    '-c',
    'user.name=test',
    '-c',
    'user.email=test@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    ...messages.flatMap((message) => ['-m', message]),
  ]);
  return git(cwd, ['rev-parse', 'HEAD']).trim();
}

function makeRepo(subjects, changelog = SEED_CHANGELOG) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'changelog-test-'));
  tempRoots.push(root);
  git(root, ['init', '-q']);
  for (const subject of subjects) {
    commit(root, subject);
  }
  writeFileSync(path.join(root, 'CHANGELOG.md'), changelog);
  return root;
}

function readChangelog(root) {
  return readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
}

function normalize(text) {
  return text.replace(/\([0-9a-f]{7,}\)/g, '(SHA)');
}

function sectionBody(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  assert.notEqual(start, -1, `heading ${heading} not found`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) {
    end += 1;
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

test('inserts the new section directly after the empty Unreleased heading', () => {
  const root = makeRepo(['feat: add release script']);

  const result = generateChangelog({ root, version: '0.1.0', date: '2026-10-22' });

  assert.deepEqual(result, { version: '0.1.0', changed: true });
  const text = readChangelog(root);
  const lines = text.split('\n');
  const unreleased = lines.indexOf('## [Unreleased]');
  assert.deepEqual(lines.slice(unreleased, unreleased + 3), [
    '## [Unreleased]',
    '',
    '## [0.1.0] - 2026-10-22',
  ]);
  assert.equal(lines.filter((line) => line === '## [Unreleased]').length, 1);
  assert.ok(text.endsWith(`\n${SEED_TAIL}`), 'existing sections must stay unchanged');
});

test('groups entries by category in fixed order and skips chore(release) subjects', () => {
  const root = makeRepo([
    'docs: explain setup',
    'feat: add thing',
    'chore: tidy',
    'fix: correct bug',
    'security: patch token leak',
    'perf: speed up',
    'test: cover edge',
    'build: bump',
    'ci: pin action',
    'random subject',
    'refactor: split module',
    'chore(release): 0.0.9',
  ]);

  generateChangelog({ root, version: '0.1.0', date: '2026-10-22' });

  const text = readChangelog(root);
  assert.equal(
    normalize(sectionBody(text, '## [0.1.0] - 2026-10-22')),
    [
      '### Added',
      '- feat: add thing (SHA)',
      '',
      '### Changed',
      '- refactor: split module (SHA)',
      '- random subject (SHA)',
      '- perf: speed up (SHA)',
      '',
      '### Fixed',
      '- fix: correct bug (SHA)',
      '',
      '### Security',
      '- security: patch token leak (SHA)',
      '',
      '### Documentation',
      '- docs: explain setup (SHA)',
      '',
      '### Maintenance',
      '- ci: pin action (SHA)',
      '- build: bump (SHA)',
      '- test: cover edge (SHA)',
      '- chore: tidy (SHA)',
    ].join('\n'),
  );
  assert.ok(!text.includes('chore(release)'));
});

test('writes the no-changes placeholder under Changed when only release commits exist', () => {
  const root = makeRepo(['chore(release): 0.0.9']);

  generateChangelog({ root, version: '0.1.0', date: '2026-10-22' });

  assert.equal(
    sectionBody(readChangelog(root), '## [0.1.0] - 2026-10-22'),
    '### Changed\n- No user-facing changes recorded.',
  );
});

test('writes notesOut as the section body without its top heading line', () => {
  const root = makeRepo(['feat: add thing']);
  const notesOut = path.join(root, 'release-notes.md');

  generateChangelog({ root, version: '0.1.0', date: '2026-10-22', notesOut });

  assert.equal(normalize(readFileSync(notesOut, 'utf8')), '### Added\n- feat: add thing (SHA)\n');
  assert.ok(readChangelog(root).includes('## [0.1.0] - 2026-10-22\n'));
});

test('limits commits to since..HEAD when since is given', () => {
  const root = makeRepo(['feat: old thing']);
  const since = git(root, ['rev-parse', 'HEAD']).trim();
  commit(root, 'fix: new thing');

  generateChangelog({ root, version: '0.1.0', date: '2026-10-22', since });

  assert.equal(
    normalize(sectionBody(readChangelog(root), '## [0.1.0] - 2026-10-22')),
    '### Fixed\n- fix: new thing (SHA)',
  );
});

test('leaves CHANGELOG.md unchanged when the version heading already exists', () => {
  const existing = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [0.1.0] - 2026-09-01',
    '',
    '### Fixed',
    '- Existing note',
    '',
    '## [0.0.1] - 2026-01-01',
    '',
    '### Added',
    '- Seed entry',
    '',
  ].join('\n');
  const root = makeRepo(['feat: would be new'], existing);
  const notesOut = path.join(root, 'release-notes.md');

  const result = generateChangelog({ root, version: '0.1.0', date: '2026-10-22', notesOut });

  assert.deepEqual(result, { version: '0.1.0', changed: false });
  assert.equal(readChangelog(root), existing);
  assert.equal(readFileSync(notesOut, 'utf8'), '### Fixed\n- Existing note\n');
});

test('is idempotent once the version heading exists', () => {
  const root = makeRepo(['feat: add thing']);
  generateChangelog({ root, version: '0.1.0', date: '2026-10-22' });
  const afterFirst = readChangelog(root);
  commit(root, 'fix: later change');

  const second = generateChangelog({ root, version: '0.1.0', date: '2026-10-22' });

  assert.deepEqual(second, { version: '0.1.0', changed: false });
  assert.equal(readChangelog(root), afterFirst);
});

test('does not treat a longer version heading as the same release', () => {
  const existing = '# Changelog\n\n## [Unreleased]\n\n## [0.1.10] - 2026-09-01\n\n### Fixed\n- Later note\n';
  const root = makeRepo(['feat: add thing'], existing);

  const result = generateChangelog({ root, version: '0.1.1', date: '2026-10-22' });

  assert.deepEqual(result, { version: '0.1.1', changed: true });
  const text = readChangelog(root);
  assert.ok(text.includes('## [0.1.1] - 2026-10-22\n'));
  assert.ok(text.endsWith('## [0.1.10] - 2026-09-01\n\n### Fixed\n- Later note\n'));
});

test('rejects a version that is not exactly 0.<minor>.<patch> and leaves the file unchanged', () => {
  const root = makeRepo(['feat: add thing']);
  const before = readChangelog(root);

  for (const version of ['0.1', 'v0.1.0', '1.0.0', '0.1.0-rc.1', '0.1.x', '']) {
    assert.throws(
      () => generateChangelog({ root, version, date: '2026-10-22' }),
      /version must match 0\.<minor>\.<patch>/,
    );
  }

  assert.equal(readChangelog(root), before);
});

test('rejects a date that is not a valid YYYY-MM-DD calendar date', () => {
  const root = makeRepo(['feat: add thing']);
  const before = readChangelog(root);

  for (const date of ['2026-1-1', '22-10-2026', '2026-02-30', '2026-13-01', '2026-10-22T00:00:00Z']) {
    assert.throws(
      () => generateChangelog({ root, version: '0.1.0', date }),
      /date must be a valid YYYY-MM-DD date/,
    );
  }

  assert.equal(readChangelog(root), before);
});

test('rejects a since value that git could read as an option', () => {
  const root = makeRepo(['feat: add thing']);
  const before = readChangelog(root);

  for (const since of ['--all', '']) {
    assert.throws(
      () => generateChangelog({ root, version: '0.1.0', date: '2026-10-22', since }),
      /since must be a git revision/,
    );
  }

  assert.equal(readChangelog(root), before);
});

test('throws naming the range when git log fails', () => {
  const root = makeRepo(['feat: add thing']);
  const before = readChangelog(root);

  assert.throws(
    () => generateChangelog({ root, version: '0.1.0', date: '2026-10-22', since: 'no-such-ref' }),
    /git log failed for range "no-such-ref\.\.HEAD"/,
  );

  assert.equal(readChangelog(root), before);
});

test('throws when the Unreleased heading is missing', () => {
  const original = '# Changelog\n\n## [0.0.1] - 2026-01-01\n\n### Added\n- Seed entry\n';
  const root = makeRepo(['feat: add thing'], original);

  assert.throws(
    () => generateChangelog({ root, version: '0.1.0', date: '2026-10-22' }),
    /has no "## \[Unreleased\]" heading/,
  );

  assert.equal(readChangelog(root), original);
});

test('throws naming CHANGELOG.md when the file is missing', () => {
  const root = makeRepo(['feat: add thing']);
  rmSync(path.join(root, 'CHANGELOG.md'));

  assert.throws(
    () => generateChangelog({ root, version: '0.1.0', date: '2026-10-22' }),
    /cannot read .*CHANGELOG\.md/,
  );
});

test('leaves out internal planning commits and keeps near-miss scopes and breaking ones', () => {
  const root = makeRepo([
    'docs(planning): record the phase 9 closure',
    'fix(planning): correct a state file',
    'docs(planning-tools): describe the helper',
    'feat(planning)!: change the planning layout',
    'feat(driver): add the compute driver',
  ]);

  generateChangelog({ root, version: '0.2.0', date: '2026-10-29' });

  assert.equal(
    normalize(sectionBody(readChangelog(root), '## [0.2.0] - 2026-10-29')),
    [
      '### Added',
      '- feat(driver): add the compute driver (SHA)',
      '- feat(planning)!: change the planning layout (SHA)',
      '',
      '### Documentation',
      '- docs(planning-tools): describe the helper (SHA)',
    ].join('\n'),
  );
});

test('writes the no-changes placeholder when only planning and release commits exist', () => {
  const root = makeRepo(['docs(planning): record a plan', 'chore(release): v0.0.9 [skip ci]']);

  generateChangelog({ root, version: '0.2.0', date: '2026-10-29' });

  assert.equal(
    sectionBody(readChangelog(root), '## [0.2.0] - 2026-10-29'),
    '### Changed\n- No user-facing changes recorded.',
  );
});

test('classifies scoped and breaking subjects by type and sends other subjects to Changed', () => {
  const root = makeRepo([
    'feat(driver): scoped feature',
    'fix(isolation)!: breaking fix',
    'Fix: capitalised type',
    'feat add colon later: not conventional',
  ]);

  generateChangelog({ root, version: '0.2.0', date: '2026-10-29' });

  assert.equal(
    normalize(sectionBody(readChangelog(root), '## [0.2.0] - 2026-10-29')),
    [
      '### Added',
      '- feat(driver): scoped feature (SHA)',
      '',
      '### Changed',
      '- feat add colon later: not conventional (SHA)',
      '- Fix: capitalised type (SHA)',
      '',
      '### Fixed',
      '- fix(isolation)!: breaking fix (SHA)',
    ].join('\n'),
  );
});

test('lists the commits of a merged branch and not the merge commit itself', () => {
  const root = makeRepo(['feat: base work']);
  const identity = ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false'];
  const since = git(root, ['rev-parse', 'HEAD']).trim();
  const base = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  git(root, ['checkout', '-q', '-b', 'side']);
  commit(root, 'fix: branch work');
  git(root, ['checkout', '-q', base]);
  commit(root, 'docs: mainline work', 'mainline.txt');
  git(root, [...identity, 'merge', '-q', '--no-ff', '-m', 'Merge pull request #6 from x/side', 'side']);

  generateChangelog({ root, version: '0.2.0', date: '2026-10-29', since });

  const body = normalize(sectionBody(readChangelog(root), '## [0.2.0] - 2026-10-29'));
  assert.ok(body.includes('- fix: branch work (SHA)'));
  assert.ok(body.includes('- docs: mainline work (SHA)'));
  assert.ok(!body.includes('Merge pull request'));
  assert.ok(!body.includes('base work'));
});

test('leaves out a reverted feature and its revert and keeps an unrelated feature', () => {
  const root = makeRepo([]);
  const reverted = commit(root, 'feat(driver): add the old driver');
  commit(root, 'feat: add the unrelated feature');
  commit(root, 'Revert "feat(driver): add the old driver"', 'work.txt', `This reverts commit ${reverted}.`);

  generateChangelog({ root, version: '0.2.0', date: '2026-10-29' });

  assert.equal(
    normalize(sectionBody(readChangelog(root), '## [0.2.0] - 2026-10-29')),
    '### Added\n- feat: add the unrelated feature (SHA)',
  );
});

test('pairs a revert with the commit its body names, not with a commit that shares the title', () => {
  const root = makeRepo(['feat: add driver']);
  const since = git(root, ['rev-parse', 'HEAD']).trim();
  const reverted = commit(root, 'feat: add driver', 'driver.txt');
  const unrelated = commit(root, 'feat: add driver', 'driver-copy.txt');
  commit(root, 'Revert "feat: add driver"', 'driver.txt', `This reverts commit ${reverted}.`);

  generateChangelog({ root, version: '0.2.0', date: '2026-10-29', since });

  assert.equal(
    sectionBody(readChangelog(root), '## [0.2.0] - 2026-10-29'),
    `### Added\n- feat: add driver (${unrelated.slice(0, 7)})`,
  );
});
