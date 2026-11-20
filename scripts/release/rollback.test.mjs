// REL-03 shell coverage for the checked-in release workflows (see .planning/phases/20-release-pipeline-hardening/20-VERIFICATION.md).
//
// This file runs the real `run:` blocks of .github/workflows/rollback.yml and .github/workflows/pages.yml under bash.
// `git` and `gh` are fake executables placed first on PATH: they record their argv and answer from fixture fields, and
// they never reach the network. Every step runs in its own bash process with only the environment its checked-in
// `env:` block declares. The harness evaluates the `${{ ... }}` expressions of that block (inputs, github context and
// `steps.<id>.outputs.<name>`) and models $GITHUB_OUTPUT, so a value reaches a later step, the dispatch arguments and
// the Pages checkout `ref` only through the wiring the workflow files actually contain.
//
// Limits, stated plainly. This proves local shell and argv behaviour only. The `gh --jq` and `--json` expressions and
// the GitHub API field names and paths the workflows use are NOT evaluated offline: the fakes return what the jq
// would print, so a wrong expression or field name would not be caught here. The harness ignores `if:`,
// `continue-on-error` and `shell:`, so it does not model conditional steps or the shell GitHub selects. Of the tag
// peeling loop in pages.yml only the lightweight, annotated and chained-annotated cases are exercised; its depth limit
// and the unexpected-object-type branches are not. It does not prove that GitHub executes these workflows, that the
// API answers the way the fakes do, or that a rollback or a Pages deployment works end to end. Those stay
// owner-gated (L4).
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
const ciYml = readFileSync(path.join(workflowsDir, 'ci.yml'), 'utf8');

const ROLLBACK_STEPS = [
  'Validate tags',
  'Validate the known-good documentation source',
  'Mark release as prerelease',
  'Dispatch Pages for the known-good tag',
];
const PAGES_STEPS = ['Validate source ref', 'Verify the source commit'];
const PAGES_CHECKOUT_STEP = 'Checkout source';
const FIELD = '\x1f';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const MOVED_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const TAG_OBJECT_SHA = '1111111111111111111111111111111111111111';
const TAG_OBJECT2_SHA = '2222222222222222222222222222222222222222';
const NOT_ANCESTOR_BASE = 'ffffffffffffffffffffffffffffffffffffffff';
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
const INVALID_SHAS = [
  'abc123',
  SHA.slice(0, 39),
  `${SHA}0`,
  SHA.toUpperCase(),
  'g'.repeat(40),
  'v0.3.3',
  `${SHA.slice(0, 30)}$(touch injected)`,
  `${SHA}; touch injected`,
  `${SHA}\n${SHA}`,
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

// Locates the single step called stepName. No YAML parser: the step starts at its `- name:` line and ends before the
// next line that begins a sibling `- ` item at the same indent.
function stepBounds(lines, stepName) {
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
  return { start, end: nextSibling === -1 ? lines.length : nextSibling };
}

// Extracts the `run: |` block of the single step called stepName.
function readWorkflowRun(workflowText, stepName) {
  const lines = workflowText.split('\n');
  const { start, end } = stepBounds(lines, stepName);

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

// Reads the step's `id:` and its `env:` and `with:` mappings (name to raw, unevaluated value).
function readStepMeta(workflowText, stepName) {
  const lines = workflowText.split('\n');
  const { start, end } = stepBounds(lines, stepName);
  const keyIndent = indentOf(lines[start]) + 2;

  let id;
  const maps = { env: {}, with: {} };
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (indentOf(line) !== keyIndent) {
      continue;
    }
    const idMatch = /^id:\s*(\S+)\s*$/.exec(line.trim());
    if (idMatch) {
      id = idMatch[1];
      continue;
    }
    const key = line.trim().replace(/:$/, '');
    if (line.trim() === `${key}:` && (key === 'env' || key === 'with')) {
      for (let inner = index + 1; inner < end && indentOf(lines[inner]) > keyIndent; inner += 1) {
        const entry = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[inner].trim());
        if (entry) {
          maps[key][entry[1]] = entry[2];
        }
      }
    }
  }
  const uses = lines
    .slice(start + 1, end)
    .map((line) => line.trim())
    .find((line) => line.startsWith('uses:'));
  return { id, env: maps.env, with: maps.with, uses };
}

// Evaluates `${{ ... }}` the way the workflows use it: a context lookup, or a step output. A step output that was
// never written evaluates to the empty string, as on GitHub.
function evaluateExpression(value, context, outputs) {
  return value.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_match, expression) => {
    const stepOutput = /^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(expression);
    if (stepOutput) {
      return outputs[stepOutput[1]]?.[stepOutput[2]] ?? '';
    }
    if (!(expression in context)) {
      throw new Error(`unresolvable expression: ${expression}`);
    }
    return context[expression];
  });
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

// The fake git peels `<tag>^{commit}` to the commit, and answers the bare tag name with the annotated tag object when
// the fixture has one.
const GIT_BEHAVIOUR = [
  'case "$1" in',
  '  fetch) exit 0 ;;',
  '  rev-parse)',
  '    if [ -n "$FAKE_TAG_MISSING" ]; then exit 1; fi',
  '    case "${@: -1}" in',
  '      *"^{commit}") echo "${FAKE_TAG_COMMIT:-' + SHA + '}" ;;',
  '      *) echo "${FAKE_TAG_OBJECT:-${FAKE_TAG_COMMIT:-' + SHA + '}}" ;;',
  '    esac',
  '    exit 0 ;;',
  '  merge-base)',
  '    if [ -n "$FAKE_NOT_ANCESTOR" ]; then exit 1; fi',
  '    exit 0 ;;',
  '  *) echo "unexpected fake call: git $*" >&2; exit 99 ;;',
  'esac',
];

// The fake gh answers what the workflows' --jq expressions would print, because the fakes do not evaluate jq. The
// compare answer is the merge base of <sha>...<branch>: the sha itself when it is an ancestor.
const GH_BEHAVIOUR = [
  'case "$1" in',
  '  api)',
  '    case "$2" in',
  '      repos/*/git/ref/tags/*)',
  '        if [ -n "$FAKE_TAG_MISSING" ]; then echo "Not Found" >&2; exit 1; fi',
  '        if [ -n "$FAKE_TAG_OBJECT" ]; then echo "tag $FAKE_TAG_OBJECT"; else echo "commit ${FAKE_TAG_COMMIT:-' + SHA + '}"; fi',
  '        exit 0 ;;',
  '      repos/*/git/tags/*)',
  '        if [ -n "$FAKE_TAG_OBJECT2" ] && [ "${2##*/}" = "$FAKE_TAG_OBJECT" ]; then echo "tag $FAKE_TAG_OBJECT2"; exit 0; fi',
  '        echo "commit ${FAKE_TAG_COMMIT:-' + SHA + '}"; exit 0 ;;',
  '      repos/*/compare/*)',
  '        if [ -n "$FAKE_COMPARE_FAILS" ]; then echo "compare failed" >&2; exit 1; fi',
  '        if [ -n "$FAKE_NOT_ANCESTOR" ]; then echo ' + NOT_ANCESTOR_BASE + '; exit 0; fi',
  '        spec="${2##*/compare/}"; echo "${spec%%...*}"; exit 0 ;;',
  '      *) echo "unexpected fake call: gh $*" >&2; exit 99 ;;',
  '    esac ;;',
  'esac',
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

// A scratch directory with fake git and gh first on PATH. Fixture fields become FAKE_* switches:
//   tagMissing, ancestor: false, release: 'draft' | 'prerelease' | 'missing', compareFails,
//   tagCommit (the commit the tag peels to), tagObject (makes the tag annotated, naming this tag object), tagObject2
//   (with tagObject: the tag object points at a second tag object, which points at the commit).
function createScratch(fixture) {
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
  if (fixture.compareFails) {
    fakeEnv.FAKE_COMPARE_FAILS = '1';
  }
  if (fixture.release === 'missing') {
    fakeEnv.FAKE_RELEASE_MISSING = '1';
  } else if (fixture.release !== undefined) {
    fakeEnv.FAKE_RELEASE = fixture.release;
  }
  if (fixture.tagCommit !== undefined) {
    fakeEnv.FAKE_TAG_COMMIT = fixture.tagCommit;
  }
  if (fixture.tagObject !== undefined) {
    fakeEnv.FAKE_TAG_OBJECT = fixture.tagObject;
  }
  if (fixture.tagObject2 !== undefined) {
    fakeEnv.FAKE_TAG_OBJECT2 = fixture.tagObject2;
  }
  return { scratch, bin, record, fakeEnv };
}

// The child environment holds only PATH, the caller's env and the FAKE_* fixture switches, so no real GH_TOKEN or
// other host variable reaches it. --noprofile --norc: host startup files would otherwise rewrite PATH ahead of the
// fake tools.
function execScript(ctx, script, env) {
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], {
    cwd: ctx.scratch,
    env: { PATH: `${ctx.bin}${path.delimiter}${process.env.PATH ?? ''}`, ...env, ...ctx.fakeEnv },
    encoding: 'utf8',
    timeout: 30000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Runs one script with the env the caller gives, in a fresh scratch directory.
function runWorkflowStep(script, env = {}, fixture = {}) {
  const ctx = createScratch(fixture);
  const result = execScript(ctx, script, env);
  return { ...result, calls: readCalls(ctx.record), scratch: ctx.scratch };
}

function parseGithubOutput(text) {
  const outputs = {};
  for (const line of text.split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      outputs[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return outputs;
}

// Runs the named steps of one workflow in order, each in its own bash process, until one fails. A step's env comes
// from its checked-in `env:` block, evaluated against context and the outputs of earlier steps. No variable is shared
// between steps except through those outputs.
function runWorkflowSteps(workflowText, stepNames, context, fixture = {}) {
  const ctx = createScratch(fixture);
  const outputFile = path.join(ctx.scratch, 'github-output');
  const outputs = {};
  const ran = [];
  let status = 0;
  let stdout = '';
  let stderr = '';
  for (const name of stepNames) {
    const meta = readStepMeta(workflowText, name);
    const env = {};
    for (const [key, value] of Object.entries(meta.env)) {
      env[key] = evaluateExpression(value, context, outputs);
    }
    writeFileSync(outputFile, '');
    const result = execScript(ctx, readWorkflowRun(workflowText, name), { ...env, GITHUB_OUTPUT: outputFile });
    ran.push(name);
    stdout += result.stdout;
    stderr += result.stderr;
    if (meta.id !== undefined) {
      outputs[meta.id] = parseGithubOutput(readFileSync(outputFile, 'utf8'));
    }
    if (result.status !== 0) {
      status = result.status;
      break;
    }
  }
  return { status, stdout, stderr, calls: readCalls(ctx.record), scratch: ctx.scratch, outputs, ran, context };
}

// The rollback workflow with TAG, DOCS_TAG and DEFAULT_BRANCH as its inputs and default branch.
function runRollback(overrides = {}, fixture = {}) {
  const env = { ...DEFAULT_ENV, ...overrides };
  const context = {
    'inputs.tag': env.TAG,
    'inputs.docs_tag': env.DOCS_TAG,
    'github.token': env.GH_TOKEN,
    'github.repository': env.GH_REPO,
    'github.event.repository.default_branch': env.DEFAULT_BRANCH,
    'github.ref': `refs/heads/${env.DEFAULT_BRANCH}`,
  };
  return runWorkflowSteps(rollbackYml, ROLLBACK_STEPS, context, fixture);
}

// The Pages build job up to its checkout. checkoutRef is the `ref` the Checkout source step would receive, evaluated
// from the checked-in `with:` block, and stays undefined when a validation step stopped the job before checkout.
function runPages({ ref = '', sha = '', branch = 'main', dispatchedRef } = {}, fixture = {}) {
  const context = {
    'inputs.source_ref': ref,
    'inputs.source_sha': sha,
    'github.token': 'fake',
    'github.repository': 'owner/repo',
    'github.event.repository.default_branch': branch,
    'github.ref': dispatchedRef ?? `refs/heads/${branch}`,
  };
  const result = runWorkflowSteps(pagesYml, PAGES_STEPS, context, fixture);
  result.checkoutRef = undefined;
  if (result.status === 0) {
    const checkout = readStepMeta(pagesYml, PAGES_CHECKOUT_STEP);
    result.checkoutRef = evaluateExpression(checkout.with.ref, context, result.outputs);
  }
  return result;
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

// The `-f name=value` pairs of the recorded `gh workflow run pages.yml` call.
function dispatchedInputs(calls) {
  const [call] = callsStarting(calls, 'gh', 'workflow', 'run', 'pages.yml');
  assert.ok(call, 'a gh workflow run pages.yml call must have been recorded');
  const inputs = {};
  call.forEach((part, index) => {
    if (part === '-f') {
      const [name, ...value] = call[index + 1].split('=');
      inputs[name] = value.join('=');
    }
  });
  return { inputs, call };
}

// A Pages run refused during trusted validation: error printed, no source checkout, no injected command.
function assertPagesRefused(result, message) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.ok(result.stderr.includes('::error::'), result.stderr);
  assert.ok(result.stderr.includes(message), result.stderr);
  assert.equal(result.checkoutRef, undefined, 'the source must not be checked out');
  assert.equal(existsSync(path.join(result.scratch, 'injected')), false, 'injected text must never run');
}

test('a valid rollback validates first, then marks the release and dispatches Pages', () => {
  for (const branch of ['main', 'trunk']) {
    const result = runRollback({ DEFAULT_BRANCH: branch });

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
      '-f',
      `source_sha=${SHA}`,
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
    const result = runRollback({ TAG: tag });
    assertRejectedBeforeAnyCommand(result, 'The tag input');
    assertNoMutation(result.calls);
  });
}

for (const docsTag of INVALID_TAGS) {
  test(`rejects the docs_tag input ${JSON.stringify(docsTag)} before any command runs`, () => {
    const result = runRollback({ DOCS_TAG: docsTag });
    assertRejectedBeforeAnyCommand(result, 'The docs_tag input');
    assertNoMutation(result.calls);
  });
}

test('rejects a docs_tag equal to tag before any command runs', () => {
  const result = runRollback({ TAG: 'v1.2.3', DOCS_TAG: 'v1.2.3' });
  assertRejectedBeforeAnyCommand(result, 'must name a different release');
  assertNoMutation(result.calls);
});

test('rejects a docs_tag that does not exist, with no ancestry or release call', () => {
  const result = runRollback({}, { tagMissing: true });

  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('does not exist'), result.stderr);
  assert.deepEqual(callsStarting(result.calls, 'git', 'merge-base'), []);
  assert.deepEqual(callsStarting(result.calls, 'gh', 'release', 'view'), []);
  assertNoMutation(result.calls);
});

test('rejects a docs_tag that is not on the default branch, with no release call', () => {
  const result = runRollback({}, { ancestor: false });

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
    const result = runRollback({}, { release });

    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(message), result.stderr);
    assert.equal(result.outputs['known-good'].sha, undefined, 'no commit output for an unverified source');
    assertNoMutation(result.calls);
  });
}

test('rejects a known-good release that does not exist', () => {
  const result = runRollback({}, { release: 'missing' });

  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('release not found'), result.stderr);
  assert.equal(result.outputs['known-good'].sha, undefined, 'no commit output for an unverified source');
  assertNoMutation(result.calls);
});

test('the validation step emits the peeled full commit as its sha output, only after every check passed', () => {
  const result = runRollback();

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.outputs['known-good'], { sha: SHA });
});

test('an annotated tag is peeled: the sha output is the commit, never the tag object', () => {
  const result = runRollback({}, { tagCommit: SHA, tagObject: TAG_OBJECT_SHA });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.outputs['known-good'].sha, SHA);
  assert.notEqual(result.outputs['known-good'].sha, TAG_OBJECT_SHA);
  assert.deepEqual(dispatchedInputs(result.calls).inputs, { source_ref: 'v0.3.3', source_sha: SHA });
});

test('a tag that peels to something other than a full commit SHA stops before any mutation', () => {
  const result = runRollback({}, { tagCommit: 'abc123' });

  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes('did not resolve to a full commit SHA'), result.stderr);
  assert.equal(result.outputs['known-good'].sha, undefined);
  assertNoMutation(result.calls);
});

test('the dispatch carries the validated SHA from the step output and the semver tag, never a mutable-tag source', () => {
  const result = runRollback();

  assert.equal(result.status, 0, result.stderr);
  const { inputs, call } = dispatchedInputs(result.calls);
  assert.deepEqual(inputs, { source_ref: 'v0.3.3', source_sha: result.outputs['known-good'].sha });
  assert.equal(inputs.source_sha, SHA);
  assert.deepEqual(call.slice(0, 6), ['gh', 'workflow', 'run', 'pages.yml', '--ref', 'main']);
});

test('the dispatch step reads the SHA only from the validation step output, never from a re-resolved tag', () => {
  const meta = readStepMeta(rollbackYml, 'Dispatch Pages for the known-good tag');
  assert.equal(meta.env.DOCS_SHA, '${{ steps.known-good.outputs.sha }}');
  assert.equal(readStepMeta(rollbackYml, 'Validate the known-good documentation source').id, 'known-good');
  const script = readWorkflowRun(rollbackYml, 'Dispatch Pages for the known-good tag');
  assert.ok(!/\bgit\b/.test(script), 'the dispatch step must not resolve the tag again');
  assert.ok(!script.includes('source_ref=${DOCS_SHA}'), 'the SHA must not be passed as the tag');
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

test('the Dispatch step alone runs exactly gh workflow run pages.yml on the default branch with the tag and SHA', () => {
  const result = runWorkflowStep(readWorkflowRun(rollbackYml, 'Dispatch Pages for the known-good tag'), {
    DOCS_TAG: 'v0.3.3',
    DOCS_SHA: SHA,
    DEFAULT_BRANCH: 'main',
    GH_TOKEN: 'fake',
    GH_REPO: 'owner/repo',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [
    ['gh', 'workflow', 'run', 'pages.yml', '--ref', 'main', '-f', 'source_ref=v0.3.3', '-f', `source_sha=${SHA}`],
  ]);
});

for (const [label, docsSha] of [['empty', ''], ...INVALID_SHAS.map((value) => [JSON.stringify(value), value])]) {
  test(`the Dispatch step refuses the SHA ${label} before any command`, () => {
    const result = runWorkflowStep(readWorkflowRun(rollbackYml, 'Dispatch Pages for the known-good tag'), {
      DOCS_TAG: 'v0.3.3',
      DOCS_SHA: docsSha,
      DEFAULT_BRANCH: 'main',
      GH_TOKEN: 'fake',
      GH_REPO: 'owner/repo',
    });
    assertRejectedBeforeAnyCommand(result, 'full 40-character SHA');
  });
}

test('the Dispatch step refuses a malformed tag before any command', () => {
  const result = runWorkflowStep(readWorkflowRun(rollbackYml, 'Dispatch Pages for the known-good tag'), {
    DOCS_TAG: 'v0.3.3; touch injected',
    DOCS_SHA: SHA,
    DEFAULT_BRANCH: 'main',
    GH_TOKEN: 'fake',
    GH_REPO: 'owner/repo',
  });
  assertRejectedBeforeAnyCommand(result, 'The docs_tag input');
});

const PAGES_VALIDATE_STEP = 'Validate source ref';
const PAGES_VALIDATE_ENV = { REF: 'refs/heads/main', DEFAULT_BRANCH: 'main' };

for (const [ref, sha] of [
  ['', ''],
  ['v0.3.3', SHA],
]) {
  test(`pages.yml accepts source_ref ${JSON.stringify(ref)} with source_sha ${JSON.stringify(sha)} without any command`, () => {
    const result = runWorkflowStep(readWorkflowRun(pagesYml, PAGES_VALIDATE_STEP), {
      ...PAGES_VALIDATE_ENV,
      SOURCE_REF: ref,
      SOURCE_SHA: sha,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, []);
  });
}

for (const ref of INVALID_SOURCE_REFS) {
  test(`pages.yml rejects source_ref ${JSON.stringify(ref)} before any command`, () => {
    const result = runWorkflowStep(readWorkflowRun(pagesYml, PAGES_VALIDATE_STEP), {
      ...PAGES_VALIDATE_ENV,
      SOURCE_REF: ref,
      SOURCE_SHA: SHA,
    });
    assertRejectedBeforeAnyCommand(result, 'source_ref must be empty or match');
  });
}

for (const sha of INVALID_SHAS) {
  test(`pages.yml rejects source_sha ${JSON.stringify(sha)} before any command or checkout`, () => {
    const result = runPages({ ref: 'v0.3.3', sha });
    assertRejectedBeforeAnyCommand(result, 'source_sha must be empty or a full 40-character');
    assert.equal(result.checkoutRef, undefined);
  });
}

test('pages.yml rejects a source_sha without a source_ref, and a source_ref without a source_sha', () => {
  for (const pair of [
    { ref: '', sha: SHA },
    { ref: 'v0.3.3', sha: '' },
  ]) {
    const result = runPages(pair);
    assertRejectedBeforeAnyCommand(result, 'must be given together or both left empty');
    assert.equal(result.checkoutRef, undefined);
  }
});

test('pages.yml refuses a dispatch from a branch other than the default branch, for a pair and for empty inputs', () => {
  for (const inputs of [{ ref: 'v0.3.3', sha: SHA }, {}]) {
    const result = runPages({ ...inputs, dispatchedRef: 'refs/heads/feature' });
    assertRejectedBeforeAnyCommand(result, "only from the default branch's workflow");
    assert.equal(result.checkoutRef, undefined);
  }
});

test('the normal dispatch with empty source inputs from the default branch runs no command and checks it out', () => {
  for (const branch of ['main', 'trunk']) {
    const result = runPages({ branch });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.outputs.source, { ref: '' });
    assert.equal(result.checkoutRef, '', 'an empty ref makes actions/checkout use the dispatched (default) branch');
  }
});

test('ci.yml still dispatches Pages for a release on the default branch with no source inputs', () => {
  assert.match(ciYml, /gh workflow run pages\.yml --ref main\n/);
  assert.ok(!ciYml.includes('source_sha'), 'the normal release dispatch must not pass a source pair');
  assert.ok(!ciYml.includes('source_ref'), 'the normal release dispatch must not pass a source pair');
});

test('the Mark release step refuses a malformed tag before any command, even if the earlier step were skipped', () => {
  const result = runWorkflowStep(readWorkflowRun(rollbackYml, 'Mark release as prerelease'), {
    TAG: 'v0.3.4; touch injected',
    GH_TOKEN: 'fake',
    GH_REPO: 'owner/repo',
  });
  assertRejectedBeforeAnyCommand(result, 'The tag input');
});

test('no run block of rollback.yml or pages.yml holds a GitHub expression', () => {
  for (const [name, text] of [
    ['rollback.yml', rollbackYml],
    ['pages.yml', pagesYml],
  ]) {
    const lines = text.split('\n');
    let blocks = 0;
    lines.forEach((line, index) => {
      const match = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
      if (!match) {
        return;
      }
      blocks += 1;
      const indent = match[1].length;
      const body = [match[2]];
      for (let next = index + 1; next < lines.length; next += 1) {
        if (lines[next].trim() !== '' && indentOf(lines[next]) <= indent) {
          break;
        }
        body.push(lines[next]);
      }
      assert.ok(!body.join('\n').includes('${{'), `${name}: run block at line ${index + 1} interpolates an expression`);
    });
    assert.ok(blocks > 0, `${name} must have run blocks to scan`);
  }
});

test('a verified pair is checked out as exactly the verified SHA, after trusted validation and without git', () => {
  const result = runPages({ ref: 'v0.3.3', sha: SHA });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.ran, PAGES_STEPS);
  assert.equal(result.checkoutRef, SHA);
  assert.deepEqual(result.outputs.source, { ref: SHA });
  assert.equal(result.calls.length, 3, JSON.stringify(result.calls));
  assert.deepEqual(result.calls[0].slice(0, 3), ['gh', 'api', 'repos/owner/repo/git/ref/tags/v0.3.3']);
  assert.deepEqual(result.calls[1].slice(0, 6), [
    'gh',
    'release',
    'view',
    'v0.3.3',
    '--json',
    'isDraft,isPrerelease',
  ]);
  assert.deepEqual(result.calls[2].slice(0, 3), ['gh', 'api', `repos/owner/repo/compare/${SHA}...main`]);
  assert.deepEqual(callsStarting(result.calls, 'git'), [], 'validation must not need a clone of the selected source');
});

test('pages.yml peels an annotated tag to its commit before comparing it with the supplied SHA', () => {
  const result = runPages({ ref: 'v0.3.3', sha: SHA }, { tagCommit: SHA, tagObject: TAG_OBJECT_SHA });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.checkoutRef, SHA);
  assert.deepEqual(result.calls[1].slice(0, 3), ['gh', 'api', `repos/owner/repo/git/tags/${TAG_OBJECT_SHA}`]);
});

test('pages.yml peels a chain of annotated tags (tag object -> tag object -> commit) to the commit', () => {
  const result = runPages(
    { ref: 'v0.3.3', sha: SHA },
    { tagCommit: SHA, tagObject: TAG_OBJECT_SHA, tagObject2: TAG_OBJECT2_SHA },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.checkoutRef, SHA);
  assert.deepEqual(result.calls[1].slice(0, 3), ['gh', 'api', `repos/owner/repo/git/tags/${TAG_OBJECT_SHA}`]);
  assert.deepEqual(result.calls[2].slice(0, 3), ['gh', 'api', `repos/owner/repo/git/tags/${TAG_OBJECT2_SHA}`]);
});

test('pages.yml refuses the annotated tag object id offered as the commit SHA', () => {
  const result = runPages({ ref: 'v0.3.3', sha: TAG_OBJECT_SHA }, { tagCommit: SHA, tagObject: TAG_OBJECT_SHA });

  assertPagesRefused(result, 'The tag moved or the pair is wrong');
  assert.deepEqual(callsStarting(result.calls, 'gh', 'release'), []);
});

test('a tag retargeted after rollback validated it: Pages refuses and checks nothing out', () => {
  const rollback = runRollback();
  assert.equal(rollback.status, 0, rollback.stderr);
  const { inputs } = dispatchedInputs(rollback.calls);
  assert.equal(inputs.source_sha, SHA);

  // Between the rollback validation and Pages, the tag v0.3.3 is force-moved to another commit.
  const pages = runPages({ ref: inputs.source_ref, sha: inputs.source_sha }, { tagCommit: MOVED_SHA });

  assertPagesRefused(pages, 'The tag moved or the pair is wrong');
  assert.ok(pages.stderr.includes(MOVED_SHA), pages.stderr);
  assert.notEqual(pages.checkoutRef, MOVED_SHA, 'the moved target must never be checked out');
  assert.deepEqual(callsStarting(pages.calls, 'gh', 'release'), [], 'no later check may run on a mismatched pair');
  assert.deepEqual(callsStarting(pages.calls, 'git'), []);
});

test('rollback to Pages end to end: the commit validated by rollback is the commit Pages checks out', () => {
  const rollback = runRollback({}, { tagCommit: SHA, tagObject: TAG_OBJECT_SHA });
  assert.equal(rollback.status, 0, rollback.stderr);
  const { inputs } = dispatchedInputs(rollback.calls);

  const pages = runPages({ ref: inputs.source_ref, sha: inputs.source_sha }, { tagCommit: SHA, tagObject: TAG_OBJECT_SHA });

  assert.equal(pages.status, 0, pages.stderr);
  assert.equal(pages.checkoutRef, rollback.outputs['known-good'].sha);
  assert.equal(pages.checkoutRef, SHA);
});

test('pages.yml refuses a supplied SHA that the tag does not resolve to, before the release or ancestry check', () => {
  const result = runPages({ ref: 'v0.3.3', sha: MOVED_SHA });

  assertPagesRefused(result, 'The tag moved or the pair is wrong');
  assert.deepEqual(callsStarting(result.calls, 'gh', 'release'), []);
  assert.deepEqual(callsStarting(result.calls, 'gh', 'api', `repos/owner/repo/compare/${MOVED_SHA}...main`), []);
});

test('pages.yml refuses a tag that does not exist', () => {
  const result = runPages({ ref: 'v0.3.3', sha: SHA }, { tagMissing: true });

  assertPagesRefused(result, 'does not exist');
  assert.deepEqual(callsStarting(result.calls, 'gh', 'release'), []);
});

for (const [release, message] of [
  ['draft', 'is draft'],
  ['prerelease', 'is prerelease'],
]) {
  test(`pages.yml refuses a source release that is a ${release}, before checkout`, () => {
    const result = runPages({ ref: 'v0.3.3', sha: SHA }, { release });

    assertPagesRefused(result, message);
    assert.deepEqual(callsStarting(result.calls, 'gh', 'api', `repos/owner/repo/compare/${SHA}...main`), []);
  });
}

test('pages.yml refuses a source release that does not exist, before checkout', () => {
  const result = runPages({ ref: 'v0.3.3', sha: SHA }, { release: 'missing' });
  assertPagesRefused(result, 'release not found');
});

test('pages.yml refuses a commit that is not an ancestor of the default branch, before checkout', () => {
  const result = runPages({ ref: 'v0.3.3', sha: SHA }, { ancestor: false });
  assertPagesRefused(result, 'is not on the default branch');
});

test('pages.yml refuses when the ancestry comparison itself fails, before checkout', () => {
  const result = runPages({ ref: 'v0.3.3', sha: SHA }, { compareFails: true });
  assertPagesRefused(result, 'Could not compare');
});

test('pages.yml orders trusted validation before the single source checkout, and checks out only the verified output', () => {
  const names = pagesYml
    .split('\n')
    .map((line) => /^\s+- name: (.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
  assert.ok(names.indexOf('Validate source ref') < names.indexOf('Verify the source commit'));
  assert.ok(names.indexOf('Verify the source commit') < names.indexOf(PAGES_CHECKOUT_STEP));
  assert.equal((pagesYml.match(/uses: actions\/checkout@/g) ?? []).length, 1);

  const checkout = readStepMeta(pagesYml, PAGES_CHECKOUT_STEP);
  assert.match(checkout.uses ?? '', /^uses: actions\/checkout@[0-9a-f]{40}\b/);
  assert.deepEqual(Object.keys(checkout.with).sort(), ['persist-credentials', 'ref']);
  assert.equal(checkout.with.ref, '${{ steps.source.outputs.ref }}');
  assert.equal(checkout.with['persist-credentials'], 'false');
  assert.equal(readStepMeta(pagesYml, 'Verify the source commit').id, 'source');
});

test('pages.yml keeps the build job read-only and the deploy job free of source code', () => {
  const [buildPart, deployPart] = pagesYml.split(/\n {2}deploy:\n/);
  assert.ok(deployPart, 'the deploy job must exist');
  assert.match(buildPart, /permissions:\n {6}contents: read[^\n]*\n {6}pages: read[^\n]*\n {4}steps:/);
  assert.ok(!/(contents|pages|id-token|actions|packages): write/.test(buildPart), 'the build job holds no write grant');
  assert.ok(!deployPart.includes('actions/checkout'), 'the deploy job must not check out source');
  assert.ok(!/^\s+run:/m.test(deployPart), 'the deploy job must not run a shell step');
  assert.ok(!deployPart.includes('source_ref') && !deployPart.includes('source_sha'), 'the deploy job takes no source input');
});

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
