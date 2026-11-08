// REL-03 shell coverage for the checked-in release workflows (see .planning/phases/20-release-pipeline-hardening/20-VERIFICATION.md).
//
// This file runs the real `run:` blocks of .github/workflows/rollback.yml and .github/workflows/pages.yml under bash.
// `git` and `gh` are fake executables placed first on PATH: they record their argv and answer from fixture fields, and
// they never reach the network. It proves local shell and argv behaviour only. It does not prove that GitHub executes
// these workflows, that `gh release view --jq` evaluates its expression, or that a rollback or a Pages deployment works
// end to end. Those stay owner-gated (L4).
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workflowsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows');
const rollbackYml = readFileSync(path.join(workflowsDir, 'rollback.yml'), 'utf8');
const pagesYml = readFileSync(path.join(workflowsDir, 'pages.yml'), 'utf8');

const ROLLBACK_STEPS = [
  'Validate tags',
  'Validate the known-good documentation source',
  'Mark release as prerelease',
  'Dispatch Pages for the known-good tag',
];
const FIELD = '\x1f';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const DEFAULT_ENV = {
  TAG: 'v0.3.4',
  DOCS_TAG: 'v0.3.3',
  DEFAULT_BRANCH: 'main',
  GH_TOKEN: 'fake',
  GH_REPO: 'owner/repo',
};
const INVALID_TAGS = [
  '',
  'v1.2',
  '1.2.3',
  'v1.2.3-rc1',
  'v1.2.3 ',
  'v1.2.3\nv1.2.4',
  'v1.2.3; touch injected',
  '$(touch injected)',
  '`touch injected`',
];
const INVALID_SOURCE_REFS = [
  'main',
  'v1.2',
  'refs/heads/main',
  'v1.2.3/../x',
  'v1.2.3 ',
  'v1.2.3$(touch injected)',
  'v1.2.3; touch injected',
];

const tempRoots = [];

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// Extracts the `run: |` block of the single step called stepName. No YAML parser: the step starts at its
// `- name:` line and ends before the next line that begins a sibling `- ` item at the same indent.
function readWorkflowRun(workflowText, stepName) {
  const lines = workflowText.split('\n');
  const starts = [];
  lines.forEach((line, index) => {
    if (line.trim() === `- name: ${stepName}`) {
      starts.push(index);
    }
  });
  if (starts.length !== 1) {
    throw new Error(`expected exactly one step named "${stepName}", found ${starts.length}`);
  }
  const start = starts[0];
  const siblingPrefix = ' '.repeat(indentOf(lines[start])) + '- ';
  const nextSibling = lines.findIndex((line, index) => index > start && line.startsWith(siblingPrefix));
  const end = nextSibling === -1 ? lines.length : nextSibling;

  const runIndex = lines.findIndex((line, index) => index > start && index < end && line.trim() === 'run: |');
  if (runIndex === -1) {
    throw new Error(`step "${stepName}" has no "run: |" block`);
  }
  const runIndent = indentOf(lines[runIndex]);
  let stop = runIndex + 1;
  while (stop < end && (lines[stop].trim() === '' || indentOf(lines[stop]) > runIndent)) {
    stop += 1;
  }
  const body = lines.slice(runIndex + 1, stop);
  while (body.length > 0 && body[body.length - 1].trim() === '') {
    body.pop();
  }
  const firstLine = body.find((line) => line.trim() !== '');
  if (firstLine === undefined) {
    throw new Error(`step "${stepName}" has an empty run block`);
  }
  const blockIndent = indentOf(firstLine);
  const script = body.map((line) => (line.trim() === '' ? '' : line.slice(blockIndent))).join('\n');
  if (script.includes('${{')) {
    throw new Error(`step "${stepName}" run block contains an unexpanded GitHub expression`);
  }
  return script;
}

// Each fake records one line per call: its tool name, then every argv element, separated by 0x1f. Quotes, spaces
// and injected text reach the record unchanged, so the tests see exactly what the workflow passed.
function fakeExecutable(name, behaviour) {
  return [
    '#!/bin/bash',
    `{ printf '%s' '${name}'; for arg in "$@"; do printf '\\037%s' "$arg"; done; printf '\\n'; } >> "$FAKE_RECORD"`,
    ...behaviour,
    '',
  ].join('\n');
}

const GIT_BEHAVIOUR = [
  'case "$1" in',
  '  fetch) exit 0 ;;',
  '  rev-parse)',
  '    if [ -n "$FAKE_TAG_MISSING" ]; then exit 1; fi',
  '    echo ' + SHA + '; exit 0 ;;',
  '  merge-base)',
  '    if [ -n "$FAKE_NOT_ANCESTOR" ]; then exit 1; fi',
  '    exit 0 ;;',
  '  *) echo "unexpected fake call: git $*" >&2; exit 99 ;;',
  'esac',
];

const GH_BEHAVIOUR = [
  'case "$1 $2" in',
  '  "release view")',
  '    if [ -n "$FAKE_RELEASE_MISSING" ]; then echo "release not found" >&2; exit 1; fi',
  '    echo "${FAKE_RELEASE:-published}"; exit 0 ;;',
  '  "release edit"|"workflow run") exit 0 ;;',
  '  *) echo "unexpected fake call: gh $*" >&2; exit 99 ;;',
  'esac',
];

function writeExecutable(file, content) {
  writeFileSync(file, content);
  chmodSync(file, 0o755);
}

function readCalls(record) {
  if (!existsSync(record)) {
    return [];
  }
  return readFileSync(record, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split(FIELD));
}

// Runs a bash script with fake git and gh first on PATH, in a scratch directory. The child environment holds only
// PATH, the caller's env and the FAKE_* fixture switches, so no real GH_TOKEN or other host variable reaches it.
function runWorkflowStep(script, env = {}, fixture = {}) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'rollback-test-'));
  tempRoots.push(scratch);
  const bin = path.join(scratch, 'bin');
  mkdirSync(bin);
  writeExecutable(path.join(bin, 'git'), fakeExecutable('git', GIT_BEHAVIOUR));
  writeExecutable(path.join(bin, 'gh'), fakeExecutable('gh', GH_BEHAVIOUR));
  const record = path.join(scratch, 'record');

  const fakeEnv = { FAKE_RECORD: record };
  if (fixture.tagMissing) {
    fakeEnv.FAKE_TAG_MISSING = '1';
  }
  if (fixture.ancestor === false) {
    fakeEnv.FAKE_NOT_ANCESTOR = '1';
  }
  if (fixture.release === 'missing') {
    fakeEnv.FAKE_RELEASE_MISSING = '1';
  } else if (fixture.release !== undefined) {
    fakeEnv.FAKE_RELEASE = fixture.release;
  }

  // --noprofile --norc: host startup files would otherwise rewrite PATH ahead of the fake tools.
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    cwd: scratch,
    env: { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, ...env, ...fakeEnv },
    encoding: 'utf8',
    timeout: 30000,
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: readCalls(record),
    scratch,
  };
}

function rollbackSequence() {
  return ROLLBACK_STEPS.map((step) => readWorkflowRun(rollbackYml, step)).join('\n');
}

function callsStarting(calls, ...prefix) {
  return calls.filter((call) => prefix.every((part, index) => call[index] === part));
}

function assertNoMutation(calls) {
  assert.deepEqual(
    [...callsStarting(calls, 'gh', 'release', 'edit'), ...callsStarting(calls, 'gh', 'workflow', 'run')],
    [],
  );
}

// An input rejected by the format or equality checks: the error is printed, nothing injected runs, and no git or
// gh command is started at all.
function assertRejectedBeforeAnyCommand(result, message) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.ok(result.stderr.includes('::error::'), result.stderr);
  assert.ok(result.stderr.includes(message), result.stderr);
  assert.equal(existsSync(path.join(result.scratch, 'injected')), false, 'injected text must never run');
  assert.deepEqual(result.calls, []);
}

test('a valid rollback validates first, then marks the release and dispatches Pages', () => {
  for (const branch of ['main', 'trunk']) {
    const result = runWorkflowStep(rollbackSequence(), { ...DEFAULT_ENV, DEFAULT_BRANCH: branch });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 7, JSON.stringify(result.calls));
    assert.deepEqual(result.calls[0], [
      'git',
      'fetch',
      '--no-tags',
      'origin',
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
    ]);
    assert.deepEqual(result.calls[1], ['git', 'fetch', '--no-tags', 'origin', '+refs/tags/v0.3.3:refs/tags/v0.3.3']);
    assert.deepEqual(result.calls[2], ['git', 'rev-parse', '--verify', '--quiet', 'refs/tags/v0.3.3^{commit}']);
    assert.deepEqual(result.calls[3], ['git', 'merge-base', '--is-ancestor', SHA, `refs/remotes/origin/${branch}`]);
    assert.deepEqual(result.calls[4].slice(0, 6), [
      'gh',
      'release',
      'view',
      'v0.3.3',
      '--json',
      'isDraft,isPrerelease',
    ]);
    assert.deepEqual(result.calls[5], ['gh', 'release', 'edit', 'v0.3.4', '--prerelease']);
    assert.deepEqual(result.calls[6], [
      'gh',
      'workflow',
      'run',
      'pages.yml',
      '--ref',
      branch,
      '-f',
      'source_ref=v0.3.3',
    ]);

    const editIndex = result.calls.findIndex((call) => call[1] === 'release' && call[2] === 'edit');
    assert.equal(editIndex, 5);
    assert.ok(
      result.calls
        .slice(0, editIndex)
        .every((call) => call[0] === 'git' || (call[1] === 'release' && call[2] === 'view')),
      'only validation calls may precede the mutation',
    );
  }
});

for (const tag of INVALID_TAGS) {
  test(`rejects the tag input ${JSON.stringify(tag)} before any command runs`, () => {
    const result = runWorkflowStep(rollbackSequence(), { ...DEFAULT_ENV, TAG: tag });
    assertRejectedBeforeAnyCommand(result, 'The tag input');
    assertNoMutation(result.calls);
  });
}

for (const docsTag of INVALID_TAGS) {
  test(`rejects the docs_tag input ${JSON.stringify(docsTag)} before any command runs`, () => {
    const result = runWorkflowStep(rollbackSequence(), { ...DEFAULT_ENV, DOCS_TAG: docsTag });
    assertRejectedBeforeAnyCommand(result, 'The docs_tag input');
    assertNoMutation(result.calls);
  });
}

test('rejects a docs_tag equal to tag before any command runs', () => {
  const result = runWorkflowStep(rollbackSequence(), { ...DEFAULT_ENV, TAG: 'v1.2.3', DOCS_TAG: 'v1.2.3' });
  assertRejectedBeforeAnyCommand(result, 'must name a different release');
  assertNoMutation(result.calls);
});

test('rejects a docs_tag that does not exist, with no ancestry or release call', () => {
  const result = runWorkflowStep(rollbackSequence(), DEFAULT_ENV, { tagMissing: true });

  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('does not exist'), result.stderr);
  assert.deepEqual(callsStarting(result.calls, 'git', 'merge-base'), []);
  assert.deepEqual(callsStarting(result.calls, 'gh', 'release', 'view'), []);
  assertNoMutation(result.calls);
});

test('rejects a docs_tag that is not on the default branch, with no release call', () => {
  const result = runWorkflowStep(rollbackSequence(), DEFAULT_ENV, { ancestor: false });

  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('not on the default branch'), result.stderr);
  assert.deepEqual(callsStarting(result.calls, 'gh', 'release', 'view'), []);
  assertNoMutation(result.calls);
});

for (const [release, message] of [
  ['draft', 'is draft'],
  ['prerelease', 'is prerelease'],
]) {
  test(`rejects a known-good release that is a ${release}`, () => {
    const result = runWorkflowStep(rollbackSequence(), DEFAULT_ENV, { release });

    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(message), result.stderr);
    assertNoMutation(result.calls);
  });
}

test('rejects a known-good release that does not exist', () => {
  const result = runWorkflowStep(rollbackSequence(), DEFAULT_ENV, { release: 'missing' });

  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('release not found'), result.stderr);
  assertNoMutation(result.calls);
});

test('the Mark release step alone runs exactly gh release edit <tag> --prerelease', () => {
  const result = runWorkflowStep(readWorkflowRun(rollbackYml, 'Mark release as prerelease'), {
    TAG: 'v0.3.4',
    GH_TOKEN: 'fake',
    GH_REPO: 'owner/repo',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [['gh', 'release', 'edit', 'v0.3.4', '--prerelease']]);
});

test('the Dispatch step alone runs exactly gh workflow run pages.yml on the default branch', () => {
  const result = runWorkflowStep(readWorkflowRun(rollbackYml, 'Dispatch Pages for the known-good tag'), {
    DOCS_TAG: 'v0.3.3',
    DEFAULT_BRANCH: 'main',
    GH_TOKEN: 'fake',
    GH_REPO: 'owner/repo',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [['gh', 'workflow', 'run', 'pages.yml', '--ref', 'main', '-f', 'source_ref=v0.3.3']]);
});

const PAGES_STEP = 'Validate source ref';

for (const ref of ['', 'v0.3.3']) {
  test(`pages.yml accepts source_ref ${JSON.stringify(ref)} without any command`, () => {
    const result = runWorkflowStep(readWorkflowRun(pagesYml, PAGES_STEP), { SOURCE_REF: ref });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, []);
  });
}

for (const ref of INVALID_SOURCE_REFS) {
  test(`pages.yml rejects source_ref ${JSON.stringify(ref)} before any command`, () => {
    const result = runWorkflowStep(readWorkflowRun(pagesYml, PAGES_STEP), { SOURCE_REF: ref });
    assertRejectedBeforeAnyCommand(result, 'source_ref must be empty or match');
  });
}

test('readWorkflowRun fails loudly when the named step does not exist', () => {
  assert.throws(() => readWorkflowRun(rollbackYml, 'No such step'), /found 0/);
});

test('readWorkflowRun fails loudly when the step name matches more than one step', () => {
  const duplicated = [
    'steps:',
    '  - name: Probe',
    '    run: |',
    '      echo one',
    '  - name: Probe',
    '    run: |',
    '      echo two',
  ].join('\n');
  assert.throws(() => readWorkflowRun(duplicated, 'Probe'), /found 2/);
});

test('readWorkflowRun fails loudly when the step has no run block', () => {
  const plain = ['steps:', '  - name: Plain', '    uses: example/action@v1'].join('\n');
  assert.throws(() => readWorkflowRun(plain, 'Plain'), /has no "run: \|" block/);
});

test('readWorkflowRun refuses a run block that still holds an unexpanded GitHub expression', () => {
  const unexpanded = ['steps:', '  - name: Probe', '    run: |', '      echo "${{ github.ref }}"'].join('\n');
  assert.throws(() => readWorkflowRun(unexpanded, 'Probe'), /unexpanded GitHub expression/);
});
