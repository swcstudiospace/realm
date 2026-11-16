// Release-case behaviour tests for the checked-in release steps of .github/workflows/ci.yml (phase 20, plan 20-03).
//
// The `run:` block of every step under test is extracted from ci.yml at test time (nothing is copied from it), and
// each step runs in its own bash process with only the environment its checked-in `env:` block declares, plus the
// few variables the Actions runner always provides (GITHUB_SHA, GITHUB_OUTPUT, RUNNER_TEMP, GITHUB_WORKSPACE).
// `git` and `gh` are fake executables placed first on PATH: they record their argv and answer from FAKE_* switches,
// and they never reach the network. `$GITHUB_OUTPUT` is modelled as a file, so a step's outputs reach a later step
// only through the wiring ci.yml contains, and the harness evaluates each step's `if:` (the small subset ci.yml uses)
// so a step the workflow would skip is skipped here too. Nothing is published, tagged or pushed.
//
// Step logic only. This proves what the steps do locally: exit status, the values they write to $GITHUB_OUTPUT, the
// exact git/gh commands they attempt and, where a step must refuse, the absence of every mutating command. It does
// NOT evaluate the `gh --jq` and `--json` expressions, the GitHub API semantics or field names: the fake `gh api`
// returns what the jq would print. It is not a real release, and it does not show that GitHub runs these workflows.
//
// `gh attestation verify` is NOT exercised offline. The attestation step is a third-party action, so the tests read
// its subject list and its position in the YAML, evaluate the subject expressions, and nothing more.
//
// NOT COVERED, with the reason:
//   - Attestation creation and `gh attestation verify`: need the attestation service and a real signed artifact.
//   - `Build milestone files`, `Build and pack tarball` and the real pack-smoke checker: need npm ci, a build, the
//     registry and a real tarball. The smoke step is tested with a stub checker; the real checker has its own tests.
//   - `Compute release values`, `Read release plan` and `Dispatch Pages workflow`: not in the 20-03 case list.
//   - The `repair` action: this ci.yml has no `repair` value of `Plan release` (its actions are normal, skip,
//     superseded). A tag without a release is finished by `Plan milestone finish`, and that is what is tested.
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_VERSION_FILES } from './sync-version.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ciYml = readFileSync(path.join(here, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');

const FIELD = '\x1f';
const SHA = '0123456789abcdef0123456789abcdef01234567'; // the commit that triggered the run
const RELEASE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // a release commit on top of SHA
const OTHER_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TOKEN = 'fake-token-value';
const TAG = 'v0.3.5';
const RELEASE_SUBJECT = `chore(release): ${TAG} [skip ci]`;
const ASSETS = ['agent-realm-0.3.5.tgz', 'SHA256SUMS', 'agent-realm-0.3.5.cdx.json'];
const MILESTONE_TAG = 'v0.3.4';
const MILESTONE_ASSETS = ['agent-realm-0.3.4.tgz', 'SHA256SUMS', 'agent-realm-0.3.4.cdx.json'];

const tempRoots = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---- ci.yml extraction (no YAML parser; same approach as rollback.test.mjs) --------------------------------------

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// The text of one job: from its `  <name>:` line to the next job key. Step names repeat across jobs.
function jobText(name) {
  const lines = ciYml.split('\n');
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `job ${name} not found`);
  let end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  if (end === -1) {
    end = lines.length;
  }
  return lines.slice(start, end).join('\n');
}
const buildJob = jobText('build');
const publishJob = jobText('publish');

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
  const siblingPrefix = `${' '.repeat(indentOf(lines[start]))}- `;
  const next = lines.findIndex((line, index) => index > start && line.startsWith(siblingPrefix));
  return { start, end: next === -1 ? lines.length : next };
}

function stepNames(job) {
  return job.split('\n').filter((line) => /^ {6}- name: /.test(line)).map((line) => line.trim().slice('- name: '.length));
}

// The step's run script (`run: |` block, dedented), id, `if:` and declared env (name -> raw value).
function readStep(job, stepName) {
  const lines = job.split('\n');
  const { start, end } = stepBounds(lines, stepName);
  const keyIndent = indentOf(lines[start]) + 2;
  const meta = { id: undefined, ifExpr: undefined, env: {}, script: undefined, text: lines.slice(start, end).join('\n') };
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (indentOf(line) !== keyIndent) {
      continue;
    }
    const trimmed = line.trim();
    const idMatch = /^id:\s*(\S+)$/.exec(trimmed);
    if (idMatch) {
      meta.id = idMatch[1];
    } else if (trimmed.startsWith('if: ')) {
      meta.ifExpr = trimmed.slice(4);
    } else if (trimmed === 'env:') {
      for (let inner = index + 1; inner < end && indentOf(lines[inner]) > keyIndent; inner += 1) {
        const entry = /^([A-Za-z_]\w*):\s*(.*)$/.exec(lines[inner].trim());
        if (entry) {
          meta.env[entry[1]] = entry[2];
        }
      }
    } else if (trimmed === 'run: |') {
      let stop = index + 1;
      while (stop < end && (lines[stop].trim() === '' || indentOf(lines[stop]) > keyIndent)) {
        stop += 1;
      }
      const body = lines.slice(index + 1, stop);
      while (body.length > 0 && body[body.length - 1].trim() === '') {
        body.pop();
      }
      const blockIndent = indentOf(body.find((entry) => entry.trim() !== ''));
      meta.script = body.map((entry) => (entry.trim() === '' ? '' : entry.slice(blockIndent))).join('\n');
      assert.ok(!meta.script.includes('${{'), `step "${stepName}" run block holds an unexpanded expression`);
    }
  }
  return meta;
}

// Evaluates `${{ ... }}` as ci.yml uses it in env: a context lookup or `steps.<id>.outputs.<name>`.
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

// The `if:` subset ci.yml uses: `<key> == 'x'`, `<key> != 'x'`, `&&`, `||` and parentheses. Anything else throws, so an
// unsupported `if:` cannot be silently treated as true. The substituted text holds only true/false and operators.
function evaluateCondition(raw, lookup) {
  if (raw === undefined) {
    return true;
  }
  const expression = raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const substituted = expression.replace(/([\w.]+)\s*(==|!=)\s*'([^']*)'/g, (_match, key, operator, literal) => {
    return String((operator === '==') === ((lookup(key) ?? '') === literal));
  });
  if (!/^[\s()&|truefals]+$/.test(substituted)) {
    throw new Error(`unsupported if: ${raw}`);
  }
  return Function(`return (${substituted});`)();
}

function conditionLookup(outputs, needs) {
  return (key) => {
    const stepOutput = /^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(key);
    if (stepOutput) {
      return outputs[stepOutput[1]]?.[stepOutput[2]];
    }
    const need = /^needs\.build\.outputs\.([\w-]+)$/.exec(key);
    if (need) {
      return needs[need[1]];
    }
    throw new Error(`unsupported condition key: ${key}`);
  };
}

// ---- fakes ---------------------------------------------------------------------------------------------------------

// Each fake records one line per call (tool name, then every argv element, 0x1f separated), then answers from FAKE_*
// switches. Unknown subcommands exit 99, so a step that starts an unexpected command fails loudly.
function fakeExecutable(name, behaviour) {
  return [
    '#!/bin/bash',
    `{ printf '%s' '${name}'; for arg in "$@"; do printf '\\037%s' "$arg"; done; printf '\\n'; } >> "$FAKE_RECORD"`,
    behaviour,
    '',
  ].join('\n');
}

// FAKE_REMOTE_TAG_SHA: the tag exists on origin. FAKE_MAIN_SHA: origin's refs/heads/main as `ls-remote` prints it.
// FAKE_TAG_COMMIT / FAKE_TAG_PARENT / FAKE_TAG_SUBJECT: what the local tag peels to, that commit's parent and subject
// (answered only for the commit the step actually asks about). FAKE_ORIGIN_MAIN: refs/remotes/origin/main after a
// fetch. FAKE_ANCESTORS: the refs `merge-base --is-ancestor <ref> refs/remotes/origin/main` accepts; any other ref, or
// any other branch, is not an ancestor. FAKE_DIFF_STATUS: `git diff --quiet`. FAKE_PUSH_STATUS: `git push`.
const GIT_BEHAVIOUR = String.raw`
case "$1" in
  fetch|tag|config|add|commit) exit 0 ;;
  push)
    # The credential must reach git through its environment only; record it for the test.
    printf '%s' "$GIT_CONFIG_VALUE_0" > "$FAKE_RECORD.pushenv"
    [ -n "$FAKE_PUSH_STATUS" ] && exit "$FAKE_PUSH_STATUS"
    exit 0 ;;
  ls-remote)
    case "$*" in
      *--tags*) if [ -n "$FAKE_REMOTE_TAG_SHA" ]; then printf '%s\t%s\n' "$FAKE_REMOTE_TAG_SHA" "$4"; fi ;;
      *) if [ -n "$FAKE_MAIN_SHA" ]; then printf '%s\trefs/heads/main\n' "$FAKE_MAIN_SHA"; fi ;;
    esac
    exit 0 ;;
  rev-parse)
    for last; do :; done
    case "$last" in
      refs/tags/*"^{commit}") [ -n "$FAKE_TAG_COMMIT" ] && { echo "$FAKE_TAG_COMMIT"; exit 0; }; exit 1 ;;
      refs/remotes/origin/main) [ -n "$FAKE_ORIGIN_MAIN" ] && { echo "$FAKE_ORIGIN_MAIN"; exit 0; }; exit 1 ;;
      *"^") [ -n "$FAKE_TAG_PARENT" ] && [ "$last" = "$FAKE_TAG_COMMIT^" ] && { echo "$FAKE_TAG_PARENT"; exit 0; }; exit 1 ;;
    esac
    exit 99 ;;
  log)
    for last; do :; done
    [ "$last" = "$FAKE_TAG_COMMIT" ] && { echo "$FAKE_TAG_SUBJECT"; exit 0; }
    exit 1 ;;
  diff)
    case "$*" in
      *--cached*) [ -n "$FAKE_STAGED_STATUS" ] && exit "$FAKE_STAGED_STATUS"; exit 1 ;;
    esac
    [ -n "$FAKE_DIFF_STATUS" ] && exit "$FAKE_DIFF_STATUS"
    exit 0 ;;
  merge-base)
    [ "$2" = "--is-ancestor" ] && [ "$4" = "refs/remotes/origin/main" ] || exit 99
    for ref in $FAKE_ANCESTORS; do [ "$ref" = "$3" ] && exit 0; done
    exit 1 ;;
  *) echo "unexpected fake call: git $*" >&2; exit 99 ;;
esac
`;

// `gh api --paginate .../releases --jq ...` prints what the jq would: the state line, then the asset names (the jq is
// not evaluated). FAKE_RELEASE_LINES_AFTER_UPLOAD replaces that answer once `gh release upload` has run.
const GH_BEHAVIOUR = String.raw`
case "$1 $2" in
  "api --paginate")
    if [ -n "$FAKE_API_FAILS" ]; then echo "HTTP 502" >&2; exit 1; fi
    lines="$FAKE_RELEASE_LINES"
    if [ -e "$FAKE_RECORD.uploaded" ] && [ -n "$FAKE_RELEASE_LINES_AFTER_UPLOAD" ]; then lines="$FAKE_RELEASE_LINES_AFTER_UPLOAD"; fi
    if [ -n "$lines" ]; then printf '%s\n' "$lines"; fi
    exit 0 ;;
  "release upload") : > "$FAKE_RECORD.uploaded"; exit 0 ;;
  "release create"|"release edit"|"workflow run") exit 0 ;;
  *) echo "unexpected fake call: gh $*" >&2; exit 99 ;;
esac
`;

// Stands in for scripts/check/pack-smoke.mjs, which needs a real tarball and installs it. Records its argv.
const PACK_SMOKE_STUB = [
  "import { appendFileSync } from 'node:fs';",
  "appendFileSync(process.env.FAKE_RECORD, ['pack-smoke', ...process.argv.slice(2)].join('\\x1f') + '\\n');",
  'process.exitCode = Number(process.env.FAKE_SMOKE_STATUS || 0);',
  '',
].join('\n');

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

// A scratch repository directory: fake git and gh first on PATH, the real sync-version.mjs (so `--files` is the real
// list), a stub pack-smoke, and a release/milestone.json with minor 3.
function createScratch(fixture) {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'release-cases-'));
  tempRoots.push(scratch);
  const bin = path.join(scratch, 'bin');
  const temp = path.join(scratch, 'tmp');
  for (const dir of [bin, temp, path.join(scratch, 'scripts', 'release'), path.join(scratch, 'scripts', 'check'), path.join(scratch, 'release')]) {
    mkdirSync(dir, { recursive: true });
  }
  writeExecutable(path.join(bin, 'git'), fakeExecutable('git', GIT_BEHAVIOUR));
  writeExecutable(path.join(bin, 'gh'), fakeExecutable('gh', GH_BEHAVIOUR));
  copyFileSync(path.join(here, 'sync-version.mjs'), path.join(scratch, 'scripts', 'release', 'sync-version.mjs'));
  writeFileSync(path.join(scratch, 'scripts', 'check', 'pack-smoke.mjs'), PACK_SMOKE_STUB);
  writeFileSync(path.join(scratch, 'release', 'milestone.json'), JSON.stringify({ milestone: 'v3.0', minor: 3 }));
  const fakeEnv = { FAKE_RECORD: path.join(scratch, 'record') };
  for (const [key, value] of Object.entries(fixture.fake ?? {})) {
    if (value !== undefined) {
      fakeEnv[`FAKE_${key}`] = String(value);
    }
  }
  for (const [file, content] of Object.entries(fixture.files ?? {})) {
    mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true });
    writeFileSync(path.join(scratch, file), content);
  }
  const ctx = { scratch, bin, temp, record: fakeEnv.FAKE_RECORD, fakeEnv };
  fixture.setup?.(ctx);
  return ctx;
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

// Runs the named steps of one job in order, each in its own bash process, until one fails. A step whose `if:` is
// false is skipped (listed in `skipped`). `outputs` seeds the outputs of steps that are not run (keyed by step id);
// `needs` seeds needs.build.outputs. Result `outputs` holds the seeds plus everything the run steps wrote.
function runSteps(job, names, { outputs = {}, needs = {}, env = {}, ...fixture } = {}) {
  const ctx = createScratch(fixture);
  const outputFile = path.join(ctx.scratch, 'github-output');
  const state = JSON.parse(JSON.stringify(outputs));
  const context = { 'github.token': TOKEN, 'github.repository': 'owner/repo', 'runner.temp': ctx.temp };
  const ran = [];
  const skipped = [];
  let status = 0;
  let stdout = '';
  let stderr = '';
  for (const name of names) {
    const meta = readStep(job, name);
    if (!evaluateCondition(meta.ifExpr, conditionLookup(state, needs))) {
      skipped.push(name);
      continue;
    }
    const declared = {};
    for (const [key, value] of Object.entries(meta.env)) {
      declared[key] = evaluateExpression(value, context, state);
    }
    writeFileSync(outputFile, '');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c', meta.script], {
      cwd: ctx.scratch,
      env: {
        PATH: `${ctx.bin}${path.delimiter}${process.env.PATH ?? ''}`,
        RUNNER_TEMP: ctx.temp,
        GITHUB_WORKSPACE: ctx.scratch,
        GITHUB_SHA: SHA,
        ...declared,
        ...env,
        GITHUB_OUTPUT: outputFile,
        ...ctx.fakeEnv,
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    ran.push(name);
    stdout += result.stdout;
    stderr += result.stderr;
    if (meta.id !== undefined) {
      state[meta.id] = { ...state[meta.id], ...parseGithubOutput(readFileSync(outputFile, 'utf8')) };
    }
    if (result.status !== 0) {
      status = result.status ?? 1;
      break;
    }
  }
  return { status, stdout, stderr, calls: readCalls(ctx.record), outputs: state, ran, skipped, ctx };
}

// One step that must run: a step the harness skipped on its `if:` would otherwise pass every refusal test vacuously.
function runStep(job, name, options) {
  const result = runSteps(job, [name], options);
  assert.deepEqual(result.skipped, [], `${name} was skipped by its if: condition; fix the seeded outputs`);
  return result;
}

// ---- assertions ----------------------------------------------------------------------------------------------------

function callsStarting(calls, ...prefix) {
  return calls.filter((call) => prefix.every((part, index) => call[index] === part));
}

const MUTATING = [
  ['git', 'tag'],
  ['git', 'push'],
  ['git', 'commit'],
  ['git', 'add'],
  ['git', 'config'],
  ['gh', 'release', 'create'],
  ['gh', 'release', 'upload'],
  ['gh', 'release', 'edit'],
  ['gh', 'workflow', 'run'],
];

function assertNoMutation(calls) {
  for (const prefix of MUTATING) {
    assert.deepEqual(callsStarting(calls, ...prefix), [], `unexpected mutating command: ${prefix.join(' ')}`);
  }
}

function assertRefused(result, pattern) {
  assert.notEqual(result.status, 0, 'the step must exit non-zero');
  assert.match(result.stderr, pattern);
  assertNoMutation(result.calls);
}

// ---- 1. Plan release -----------------------------------------------------------------------------------------------

const published = (...names) => ['published', ...names].join('\n');

function planRelease(fake) {
  return runStep(buildJob, 'Plan release', { outputs: { version: { tag: TAG } }, fake: { MAIN_SHA: SHA, ...fake } });
}

test('Plan release: no tag on origin and main unmoved plans a normal release without asking the release API', () => {
  const result = planRelease({});
  assert.equal(result.status, 0);
  assert.deepEqual(result.outputs.tag_check, { action: 'normal', tag: TAG, version: '0.3.5' });
  assert.deepEqual(callsStarting(result.calls, 'gh'), []);
  assert.deepEqual(callsStarting(result.calls, 'git', 'ls-remote', '--tags', 'origin')[0].slice(-1), [`refs/tags/${TAG}`]);
  assertNoMutation(result.calls);
});

test('Plan release: a published release with every expected asset is skipped and the main check is not reached', () => {
  const result = planRelease({ REMOTE_TAG_SHA: RELEASE_SHA, RELEASE_LINES: published(...ASSETS) });
  assert.equal(result.status, 0);
  assert.equal(result.outputs.tag_check.action, 'skip');
  assert.equal(callsStarting(result.calls, 'git', 'ls-remote', 'origin', 'refs/heads/main').length, 0);
  assertNoMutation(result.calls);
});

test('Plan release: a draft release is an error even when it holds every asset', () => {
  const result = planRelease({ REMOTE_TAG_SHA: RELEASE_SHA, RELEASE_LINES: ['draft', ...ASSETS].join('\n') });
  assertRefused(result, /release is draft, not published/);
  assert.equal(result.outputs.tag_check?.action, undefined, 'no plan is written');
});

test('Plan release: a published release missing assets is an error that names what it lacks', () => {
  const result = planRelease({ REMOTE_TAG_SHA: RELEASE_SHA, RELEASE_LINES: published('agent-realm-0.3.5.tgz') });
  assertRefused(result, /lacks: SHA256SUMS agent-realm-0\.3\.5\.cdx\.json/);
  assert.equal(result.outputs.tag_check?.action, undefined);
});

test('Plan release: an expected asset of another version does not count as present', () => {
  const result = planRelease({ REMOTE_TAG_SHA: RELEASE_SHA, RELEASE_LINES: published('agent-realm-0.3.4.tgz', 'SHA256SUMS', 'agent-realm-0.3.4.cdx.json') });
  assertRefused(result, /lacks: agent-realm-0\.3\.5\.tgz agent-realm-0\.3\.5\.cdx\.json/);
});

test('Plan release: a target tag on origin without a GitHub release is a plan failure', () => {
  const result = planRelease({ REMOTE_TAG_SHA: RELEASE_SHA });
  assertRefused(result, /release is missing, not published/);
  assert.equal(result.outputs.tag_check?.action, undefined);
});

test('Plan release: a failing release listing fails the plan and is not read as "missing"', () => {
  const result = planRelease({ REMOTE_TAG_SHA: RELEASE_SHA, API_FAILS: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputs.tag_check?.action, undefined);
  assertNoMutation(result.calls);
});

test('Plan release: a target that is not a release tag is refused before the release API is called', () => {
  const result = runStep(buildJob, 'Plan release', { outputs: { version: { tag: 'v1.0.0' } }, fake: { MAIN_SHA: SHA, REMOTE_TAG_SHA: RELEASE_SHA } });
  assertRefused(result, /v1\.0\.0 is not a release tag/);
  assert.deepEqual(callsStarting(result.calls, 'gh'), []);
});

test('Plan release: origin/main moved since the triggering SHA is superseded, and no later build step runs for it', () => {
  const result = planRelease({ MAIN_SHA: OTHER_SHA });
  assert.equal(result.status, 0);
  assert.equal(result.outputs.tag_check.action, 'superseded');
  assert.match(result.stdout, new RegExp(`origin/main is ${OTHER_SHA}, not ${SHA}`));
  assertNoMutation(result.calls);
  // Every step that builds or packs the release is gated on action == normal, so none of them runs for this plan.
  const gated = ['Sync package version', 'Generate changelog', 'Build and pack tarball', 'Smoke the release tarball', 'Write release checksums and SBOM', 'Stage release files'];
  for (const action of ['superseded', 'skip']) {
    for (const name of gated) {
      assert.equal(evaluateCondition(readStep(buildJob, name).ifExpr, conditionLookup({ tag_check: { action } }, {})), false, `${name} must not run for ${action}`);
    }
  }
  for (const name of gated) {
    assert.equal(evaluateCondition(readStep(buildJob, name).ifExpr, conditionLookup({ tag_check: { action: 'normal' } }, {})), true, `${name} must run for normal`);
  }
});

test('Plan release: an unreadable origin/main fails the plan instead of assuming it is unmoved', () => {
  const result = planRelease({ MAIN_SHA: undefined });
  assertRefused(result, /Could not read refs\/heads\/main from origin/);
  assert.equal(result.outputs.tag_check?.action, undefined);
});

// ---- 1b. Plan milestone finish (the repair of the latest milestone tag) and 2. Check milestone tag is on main -----

function planMilestone(previousTag, fake = {}) {
  return runStep(buildJob, 'Plan milestone finish', { outputs: { version: { previousTag } }, fake });
}

test('Plan milestone finish: the latest milestone tag with no GitHub release is selected for repair', () => {
  const result = planMilestone(MILESTONE_TAG);
  assert.equal(result.status, 0);
  assert.deepEqual(result.outputs.milestone, { tag: MILESTONE_TAG });
  assertNoMutation(result.calls);
});

for (const [label, lines] of [
  ['a draft release', ['draft', ...MILESTONE_ASSETS].join('\n')],
  ['a published release with assets missing', published('agent-realm-0.3.4.tgz')],
]) {
  test(`Plan milestone finish: ${label} is selected for repair`, () => {
    const result = planMilestone(MILESTONE_TAG, { RELEASE_LINES: lines });
    assert.equal(result.status, 0);
    assert.equal(result.outputs.milestone.tag, MILESTONE_TAG);
  });
}

test('Plan milestone finish: a published release with every asset selects nothing', () => {
  const result = planMilestone(MILESTONE_TAG, { RELEASE_LINES: published(...MILESTONE_ASSETS) });
  assert.equal(result.status, 0);
  assert.equal(result.outputs.milestone?.tag, undefined);
});

test('Plan milestone finish: a tag of an older milestone is never repaired and the release API is not asked', () => {
  for (const previousTag of ['v0.2.9', '']) {
    const result = planMilestone(previousTag);
    assert.equal(result.status, 0);
    assert.equal(result.outputs.milestone?.tag, undefined);
    assert.deepEqual(callsStarting(result.calls, 'gh'), []);
  }
});

test('repair proceeds only when the milestone tag is on origin/main: off main it stops before any build step', () => {
  const chain = ['Plan milestone finish', 'Check milestone tag is on main', 'Build milestone files'];
  const offMain = runSteps(buildJob, chain, { outputs: { version: { previousTag: MILESTONE_TAG } }, fake: { ANCESTORS: '' } });
  assert.notEqual(offMain.status, 0);
  assert.deepEqual(offMain.ran, ['Plan milestone finish', 'Check milestone tag is on main']);
  assert.match(offMain.stderr, new RegExp(`${MILESTONE_TAG} is not an ancestor of origin/main; refusing to build it`));
  assertNoMutation(offMain.calls);

  const onMain = runSteps(buildJob, chain.slice(0, 2), { outputs: { version: { previousTag: MILESTONE_TAG } }, fake: { ANCESTORS: `refs/tags/${MILESTONE_TAG}` } });
  assert.equal(onMain.status, 0);
  assert.deepEqual(callsStarting(onMain.calls, 'git', 'merge-base')[0].slice(1), ['merge-base', '--is-ancestor', `refs/tags/${MILESTONE_TAG}`, 'refs/remotes/origin/main']);
  assert.deepEqual(callsStarting(onMain.calls, 'git', 'fetch')[0].slice(-1), ['+refs/heads/main:refs/remotes/origin/main'], 'main is fetched before the ancestry check');
});

test('Check milestone tag is on main (build): a tag that is not an ancestor of origin/main is refused; one that is passes', () => {
  const refused = runStep(buildJob, 'Check milestone tag is on main', { outputs: { milestone: { tag: MILESTONE_TAG } }, fake: { ANCESTORS: RELEASE_SHA } });
  assertRefused(refused, /is not an ancestor of origin\/main; refusing to build it/);
  const accepted = runStep(buildJob, 'Check milestone tag is on main', { outputs: { milestone: { tag: MILESTONE_TAG } }, fake: { ANCESTORS: `refs/tags/${MILESTONE_TAG}` } });
  assert.equal(accepted.status, 0);
});

function publishMilestoneCheck(content, fake) {
  return runStep(publishJob, 'Check milestone tag is on main', {
    needs: { milestone_tag: MILESTONE_TAG },
    files: { 'tmp/milestone-files/milestone-tag.txt': content },
    fake,
  });
}

test('Check milestone tag is on main (publish): off-main refused with no outputs; on main writes tag and version', () => {
  const refused = publishMilestoneCheck(`${MILESTONE_TAG}\n`, { ANCESTORS: '' });
  assertRefused(refused, /is not an ancestor of origin\/main; refusing to publish it/);
  assert.equal(refused.outputs.milestone?.tag, undefined);
  const accepted = publishMilestoneCheck(`${MILESTONE_TAG}\n`, { ANCESTORS: `refs/tags/${MILESTONE_TAG}` });
  assert.equal(accepted.status, 0);
  assert.deepEqual(accepted.outputs.milestone, { tag: MILESTONE_TAG, version: '0.3.4' });
});

test('Check milestone tag is on main (publish): a milestone-tag.txt that is not a release tag is refused before git is used', () => {
  const result = publishMilestoneCheck('main\n', { ANCESTORS: 'refs/tags/main' });
  assertRefused(result, /does not name a milestone tag/);
  assert.deepEqual(callsStarting(result.calls, 'git'), []);
});

// ---- 3. Check release tag (publish job) ---------------------------------------------------------------------------

const PUBLISH_SEED = { tag_check: { action: 'normal' }, release: { tag: TAG, version: '0.3.5' } };

function checkReleaseTag(fake, steps = ['Check release tag']) {
  return runSteps(publishJob, steps, { outputs: PUBLISH_SEED, fake: { REMOTE_TAG_SHA: RELEASE_SHA, ...fake } });
}

const RELEASE_COMMIT = { TAG_COMMIT: RELEASE_SHA, TAG_PARENT: SHA, TAG_SUBJECT: RELEASE_SUBJECT, ANCESTORS: RELEASE_SHA };

test('Check release tag: a tag absent from origin sets exists=false and asks nothing else', () => {
  const result = checkReleaseTag({ REMOTE_TAG_SHA: undefined });
  assert.equal(result.status, 0);
  assert.equal(result.outputs.remote_tag.exists, 'false');
  assert.deepEqual(callsStarting(result.calls, 'git', 'rev-parse'), []);
});

test('Check release tag: a tag at the triggering commit is reused when it is on origin/main', () => {
  const result = checkReleaseTag({ TAG_COMMIT: SHA, ANCESTORS: SHA });
  assert.equal(result.status, 0);
  assert.equal(result.outputs.remote_tag.exists, 'true');
});

test('Check release tag: a tag at the release commit over the triggering commit is reused after its files are compared', () => {
  const result = checkReleaseTag(RELEASE_COMMIT);
  assert.equal(result.status, 0);
  assert.equal(result.outputs.remote_tag.exists, 'true');
  assert.deepEqual(callsStarting(result.calls, 'git', 'diff')[0].slice(1), ['diff', '--quiet', RELEASE_SHA, '--', 'CHANGELOG.md', ...RELEASE_VERSION_FILES]);
  assert.deepEqual(callsStarting(result.calls, 'git', 'merge-base')[0].slice(1), ['merge-base', '--is-ancestor', RELEASE_SHA, 'refs/remotes/origin/main']);
});

for (const [label, fake, pattern] of [
  ['an unrelated commit', { TAG_COMMIT: OTHER_SHA, TAG_PARENT: RELEASE_SHA, TAG_SUBJECT: RELEASE_SUBJECT, ANCESTORS: OTHER_SHA }, /not this run's release commit/],
  ['the release subject on a commit whose parent is not the triggering commit', { ...RELEASE_COMMIT, TAG_PARENT: OTHER_SHA }, /not this run's release commit/],
  ['the right parent with another subject', { ...RELEASE_COMMIT, TAG_SUBJECT: 'feat: something else' }, /not this run's release commit/],
  ['the right parent with another version in the subject', { ...RELEASE_COMMIT, TAG_SUBJECT: 'chore(release): v0.3.4 [skip ci]' }, /not this run's release commit/],
  ['a commit with no readable parent', { ...RELEASE_COMMIT, TAG_PARENT: undefined }, /not this run's release commit/],
  ['a tag whose commit cannot be read', { TAG_COMMIT: undefined }, /its commit could not be read/],
]) {
  test(`Check release tag: a tag at ${label} is refused (retry-tag mismatch)`, () => {
    const result = checkReleaseTag(fake);
    assertRefused(result, pattern);
    assert.equal(result.outputs.remote_tag?.exists, undefined);
  });
}

test('Check release tag: a release commit whose files differ from the regenerated files is refused', () => {
  const result = checkReleaseTag({ ...RELEASE_COMMIT, DIFF_STATUS: 1 });
  assertRefused(result, /release files at v0\.3\.5 differ/);
  assert.equal(result.outputs.remote_tag?.exists, undefined);
});

test('Check release tag: a correct release commit that is not on origin/main is refused', () => {
  const result = checkReleaseTag({ ...RELEASE_COMMIT, ANCESTORS: '' });
  assertRefused(result, /is not on origin\/main; refusing to publish/);
  assert.equal(result.outputs.remote_tag?.exists, undefined);
});

test('a reused tag skips the commit and the tag-and-push steps and attempts no tag, push or commit', () => {
  const result = checkReleaseTag(RELEASE_COMMIT, ['Check release tag', 'Commit release changes', 'Tag and push release atomically']);
  assert.equal(result.status, 0);
  assert.deepEqual(result.ran, ['Check release tag']);
  assert.deepEqual(result.skipped, ['Commit release changes', 'Tag and push release atomically']);
  assertNoMutation(result.calls);
  // The release step is the one that follows: it runs for a reused tag, even though nothing was pushed.
  assert.equal(evaluateCondition(readStep(publishJob, 'Create GitHub release').ifExpr, conditionLookup(result.outputs, {})), true);
});

test('a tag created by this run: commit, then tag, then one atomic push, and the release step follows', () => {
  const result = checkReleaseTag({ REMOTE_TAG_SHA: undefined }, ['Check release tag', 'Commit release changes', 'Tag and push release atomically']);
  assert.equal(result.status, 0);
  assert.deepEqual(result.ran, ['Check release tag', 'Commit release changes', 'Tag and push release atomically']);
  assert.equal(result.outputs.push.pushed, 'true');
  const git = result.calls.filter((call) => call[0] === 'git').map((call) => call.slice(1, 3).join(' '));
  assert.ok(git.indexOf('commit -m') < git.indexOf('tag -a') && git.indexOf('tag -a') < git.indexOf('push --atomic'), git.join(' | '));
  assert.deepEqual(callsStarting(result.calls, 'git', 'commit')[0].slice(1), ['commit', '-m', RELEASE_SUBJECT]);
  assert.deepEqual(callsStarting(result.calls, 'git', 'add')[0].slice(1), ['add', '--', 'CHANGELOG.md', ...RELEASE_VERSION_FILES]);
  assert.equal(evaluateCondition(readStep(publishJob, 'Create GitHub release').ifExpr, conditionLookup(result.outputs, {})), true);
});

// ---- 4. Smoke the release tarball runs before any remote mutation, and its failure stops the job ------------------

const MUTATING_RUN = /\bgh release (create|upload|edit)\b|\bgh workflow run\b|\bgit (push|tag|commit)\b/;

test('Smoke the release tarball sits after pack and before every later build step; the build job cannot mutate remotely', () => {
  const names = stepNames(buildJob);
  const smoke = names.indexOf('Smoke the release tarball');
  assert.ok(names.indexOf('Build and pack tarball') < smoke);
  for (const later of ['Write release checksums and SBOM', 'Stage release files', 'Upload release files']) {
    assert.ok(smoke < names.indexOf(later), `${later} must follow the smoke`);
  }
  for (const name of names) {
    assert.doesNotMatch(readStep(buildJob, name).script ?? '', MUTATING_RUN, `${name} must not mutate a remote`);
  }
  assert.match(buildJob, /^ {4}permissions:\n {6}contents: read\n {4}\S/m, 'the build job holds only a read grant');
  assert.match(publishJob, /^ {4}needs: build$/m, 'publish, the only job that mutates, needs the build job and so its smoke');
});

test('Smoke the release tarball: no step from the smoke on can continue past a failure', () => {
  const names = stepNames(buildJob);
  for (const name of names.slice(names.indexOf('Smoke the release tarball'))) {
    const { text, ifExpr } = readStep(buildJob, name);
    assert.doesNotMatch(text, /continue-on-error/, name);
    assert.doesNotMatch(ifExpr ?? '', /always\(\)|failure\(\)|cancelled\(\)/, name);
  }
});

test('Smoke the release tarball: a failing smoke exits non-zero with no mutation; a passing one runs the checker on this tarball', () => {
  const smoke = (status) => runStep(buildJob, 'Smoke the release tarball', { outputs: { tag_check: { action: 'normal', version: '0.3.5' } }, fake: { SMOKE_STATUS: status } });
  const failed = smoke(3);
  assert.equal(failed.status, 3);
  assertNoMutation(failed.calls);
  const passed = smoke(0);
  assert.equal(passed.status, 0);
  assert.deepEqual(callsStarting(passed.calls, 'pack-smoke')[0], ['pack-smoke', '--tarball', 'agent-realm-0.3.5.tgz', '--expect-version', '0.3.5']);
});

// ---- 5. Check CHANGELOG.md matches the packed tarball --------------------------------------------------------------

// Packs a real tarball with the system tar (offline): package/CHANGELOG.md with the given text, or without one.
function changelogFixture(workspaceText, packedText) {
  return {
    setup(ctx) {
      const stage = path.join(ctx.scratch, 'stage');
      mkdirSync(path.join(stage, 'package'), { recursive: true });
      writeFileSync(path.join(stage, 'package', packedText === undefined ? 'package.json' : 'CHANGELOG.md'), packedText ?? '{}');
      writeFileSync(path.join(ctx.scratch, 'CHANGELOG.md'), workspaceText);
      const packed = spawnSync('tar', ['-czf', path.join(ctx.scratch, 'agent-realm-0.3.5.tgz'), '-C', stage, 'package'], { encoding: 'utf8' });
      assert.equal(packed.status, 0, packed.stderr);
    },
  };
}

function checkChangelog(workspaceText, packedText) {
  return runStep(publishJob, 'Check CHANGELOG.md matches the packed tarball', { outputs: PUBLISH_SEED, ...changelogFixture(workspaceText, packedText) });
}

test('Check CHANGELOG.md: a byte-identical regenerated copy passes', () => {
  const result = checkChangelog('## [0.3.5] - 2026-11-16\n\n- fix\n', '## [0.3.5] - 2026-11-16\n\n- fix\n');
  assert.equal(result.status, 0);
});

for (const [label, workspace, packed] of [
  ['a changed word', '## [0.3.5]\n- fix\n', '## [0.3.5]\n- fixes\n'],
  ['a missing trailing newline', '## [0.3.5]\n- fix', '## [0.3.5]\n- fix\n'],
  ['CRLF line endings', '## [0.3.5]\r\n- fix\r\n', '## [0.3.5]\n- fix\n'],
]) {
  test(`Check CHANGELOG.md: ${label} between the regenerated and the packed copy is refused`, () => {
    const result = checkChangelog(workspace, packed);
    assertRefused(result, /differs from the copy packed by build; refusing to publish/);
  });
}

test('Check CHANGELOG.md: a tarball with no CHANGELOG.md fails the step', () => {
  const result = checkChangelog('## [0.3.5]\n', undefined);
  assert.notEqual(result.status, 0);
  assertNoMutation(result.calls);
});

// ---- 6. Tag and push release atomically ---------------------------------------------------------------------------

function tagAndPush(fake) {
  return runStep(publishJob, 'Tag and push release atomically', { outputs: PUBLISH_SEED_EXISTS_FALSE, fake });
}
const PUBLISH_SEED_EXISTS_FALSE = { ...PUBLISH_SEED, remote_tag: { exists: 'false' } };

test('Tag and push: an accepted push creates the annotated tag and pushes main and the tag in one atomic call, with no force', () => {
  const result = tagAndPush({});
  assert.equal(result.status, 0);
  assert.equal(result.outputs.push.pushed, 'true');
  const git = result.calls.filter((call) => call[0] === 'git');
  assert.deepEqual(git[0].slice(1), ['tag', '-a', TAG, '-m', `Release ${TAG}`]);
  assert.deepEqual(git[1].slice(1), ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${TAG}`]);
  assert.equal(git.length, 2);
  // The token reaches git only through its environment, never argv.
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`;
  assert.equal(readFileSync(`${result.ctx.record}.pushenv`, 'utf8'), header);
  assert.ok(!readFileSync(result.ctx.record, 'utf8').includes(TOKEN));
  assert.ok(!readFileSync(result.ctx.record, 'utf8').includes(header.split(' ').pop()));
});

test('Tag and push: a rejected push while origin/main has moved exits 0 as superseded and releases nothing', () => {
  const result = tagAndPush({ PUSH_STATUS: 1, ORIGIN_MAIN: OTHER_SHA });
  assert.equal(result.status, 0);
  assert.equal(result.outputs.push?.pushed, undefined, 'pushed is not set, so the release step does not run');
  assert.match(result.stdout, new RegExp(`origin/main moved to ${OTHER_SHA}`));
  assert.equal(callsStarting(result.calls, 'git', 'push').length, 1, 'one push attempt, no retry');
  assert.equal(callsStarting(result.calls, 'git', 'fetch')[0].slice(-1)[0], '+refs/heads/main:refs/remotes/origin/main');
  assert.deepEqual(callsStarting(result.calls, 'gh'), []);
  assert.equal(evaluateCondition(readStep(publishJob, 'Create GitHub release').ifExpr, conditionLookup(result.outputs, {})), false);
});

test('Tag and push: a rejected push while origin/main has not moved fails the job', () => {
  const result = tagAndPush({ PUSH_STATUS: 1, ORIGIN_MAIN: SHA });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Atomic push of main and v0\.3\.5 failed while origin\/main is still/);
  assert.equal(result.outputs.push?.pushed, undefined);
  assert.equal(callsStarting(result.calls, 'git', 'push').length, 1);
  assert.deepEqual(callsStarting(result.calls, 'gh'), []);
});

test('Tag and push: a rejected push with origin/main unreadable fails the job instead of being called superseded', () => {
  const result = tagAndPush({ PUSH_STATUS: 1, ORIGIN_MAIN: undefined });
  assert.notEqual(result.status, 0);
  assert.equal(result.outputs.push?.pushed, undefined);
});

// ---- the release steps that create GitHub releases (milestone repair and this run's release) -----------------------

// Seeds that satisfy each step's `if:`: this run's release runs for a reused tag, the milestone one when build named a tag.
const RELEASE_STEPS = [
  ['Create GitHub release', { ...PUBLISH_SEED, remote_tag: { exists: 'true' } }, {}, TAG, ASSETS],
  ['Create milestone GitHub release', { milestone: { tag: MILESTONE_TAG, version: '0.3.4' } }, { milestone_tag: MILESTONE_TAG }, MILESTONE_TAG, MILESTONE_ASSETS],
];

for (const [step, seed, needs, tag, assets] of RELEASE_STEPS) {
  const run = (fake) => runStep(publishJob, step, { outputs: seed, needs, fake });
  const draftWith = (...names) => ['draft', ...names].join('\n');

  test(`${step}: a published release lacking an asset is refused and nothing is created, uploaded or edited`, () => {
    assertRefused(run({ RELEASE_LINES: published(assets[0]) }), /is published but lacks expected assets/);
  });

  test(`${step}: a published release with every asset is left alone`, () => {
    const result = run({ RELEASE_LINES: published(...assets) });
    assert.equal(result.status, 0);
    assertNoMutation(result.calls);
  });

  test(`${step}: a missing release is created as a draft, filled, and only then published`, () => {
    const result = run({ RELEASE_LINES_AFTER_UPLOAD: draftWith(...assets) });
    assert.equal(result.status, 0);
    const release = result.calls.filter((call) => call[0] === 'gh' && call[1] === 'release');
    assert.deepEqual(release.map((call) => call[2]), ['create', 'upload', 'edit']);
    assert.deepEqual(release[0].slice(3, 6), [tag, '--draft', '--verify-tag']);
    assert.ok(release[2].includes('--draft=false'));
  });

  test(`${step}: a draft left by an earlier attempt is completed without creating a second release`, () => {
    const result = run({ RELEASE_LINES: 'draft', RELEASE_LINES_AFTER_UPLOAD: draftWith(...assets) });
    assert.equal(result.status, 0);
    assert.deepEqual(callsStarting(result.calls, 'gh', 'release', 'create'), []);
    assert.equal(callsStarting(result.calls, 'gh', 'release', 'upload').length, 1);
    assert.equal(callsStarting(result.calls, 'gh', 'release', 'edit').length, 1);
  });

  test(`${step}: an upload that leaves an asset missing is never published`, () => {
    const result = run({ RELEASE_LINES: 'draft', RELEASE_LINES_AFTER_UPLOAD: draftWith(assets[0]) });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lacks expected assets after upload/);
    assert.deepEqual(callsStarting(result.calls, 'gh', 'release', 'edit'), []);
  });
}

// ---- 7. Attest build provenance ------------------------------------------------------------------------------------

// Evaluates the step's `subject-path` lines for one situation. Each line is `${{ <condition> && format('<tpl>', args)
// || '' }}`; a line whose condition is false is empty and is dropped, as the action drops empty lines.
function attestSubjects({ action, milestoneTag, version = '0.3.5', milestoneVersion = '0.3.4', temp = '/runner/temp' }) {
  const lines = readStep(publishJob, 'Attest build provenance').text.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'subject-path: |');
  assert.notEqual(start, -1);
  const block = [];
  for (let index = start + 1; index < lines.length && indentOf(lines[index]) > indentOf(lines[start]); index += 1) {
    block.push(lines[index].trim());
  }
  const values = {
    'steps.tag_check.outputs.action': action,
    'needs.build.outputs.milestone_tag': milestoneTag,
    'steps.release.outputs.version': version,
    'steps.milestone.outputs.version': milestoneVersion,
    'runner.temp': temp,
  };
  const lookup = (key) => {
    assert.ok(key in values, `unknown key ${key}`);
    return values[key];
  };
  const subjects = block.map((line) => {
    const match = /^\$\{\{\s*(.+?)\s*&&\s*format\((.+)\)\s*\|\|\s*''\s*\}\}$/.exec(line);
    assert.ok(match, `unrecognised subject line: ${line}`);
    if (!evaluateCondition(match[1], lookup)) {
      return '';
    }
    const [template, ...args] = match[2].split(/,\s*/);
    return template.slice(1, -1).replace(/\{(\d)\}/g, (_m, index) => lookup(args[Number(index)]));
  });
  return { subjects: subjects.filter((subject) => subject !== ''), lineCount: block.length };
}

const THIS_RUN = ['agent-realm-0.3.5.tgz', '/runner/temp/release-assets/SHA256SUMS', '/runner/temp/release-assets/agent-realm-0.3.5.cdx.json'];
const MILESTONE = ['/runner/temp/milestone-files/agent-realm-0.3.4.tgz', '/runner/temp/milestone-files/SHA256SUMS', '/runner/temp/milestone-files/agent-realm-0.3.4.cdx.json'];

test('Attest build provenance: a normal release attests exactly its tarball, SHA256SUMS and SBOM', () => {
  assert.deepEqual(attestSubjects({ action: 'normal', milestoneTag: '' }).subjects, THIS_RUN);
});

test('Attest build provenance: a milestone repair attests exactly the milestone copies of the three files', () => {
  assert.deepEqual(attestSubjects({ action: 'skip', milestoneTag: MILESTONE_TAG }).subjects, MILESTONE);
});

test('Attest build provenance: a normal release with a milestone repair attests exactly the six subjects', () => {
  const { subjects, lineCount } = attestSubjects({ action: 'normal', milestoneTag: MILESTONE_TAG });
  assert.equal(lineCount, 6);
  assert.deepEqual(subjects, [...THIS_RUN, ...MILESTONE]);
});

test('Attest build provenance: a skipped or superseded run with no repair attests nothing, and the step does not run', () => {
  for (const action of ['skip', 'superseded']) {
    assert.deepEqual(attestSubjects({ action, milestoneTag: '' }).subjects, []);
    assert.equal(evaluateCondition(readStep(publishJob, 'Attest build provenance').ifExpr, conditionLookup({ tag_check: { action } }, { milestone_tag: '' })), false);
  }
  assert.equal(evaluateCondition(readStep(publishJob, 'Attest build provenance').ifExpr, conditionLookup({ tag_check: { action: 'skip' } }, { milestone_tag: MILESTONE_TAG })), true);
});

test('the attestation runs after every read-only guard and before every step that tags, pushes or creates a release', () => {
  const names = stepNames(publishJob);
  const attest = names.indexOf('Attest build provenance');
  const mutating = names.filter((name) => MUTATING_RUN.test(readStep(publishJob, name).script ?? ''));
  assert.deepEqual(mutating, ['Create milestone GitHub release', 'Commit release changes', 'Tag and push release atomically', 'Create GitHub release', 'Dispatch Pages workflow']);
  for (const name of mutating) {
    assert.ok(attest < names.indexOf(name), `${name} must follow the attestation`);
  }
  for (const guard of ['Check milestone tag is on main', 'Read release plan', 'Check CHANGELOG.md matches the packed tarball', 'Check release tag']) {
    assert.ok(names.indexOf(guard) < attest, `${guard} must precede the attestation`);
  }
});
