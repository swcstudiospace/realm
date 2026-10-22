import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION_PATTERN = /^0\.\d+\.\d+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UNRELEASED_HEADING = '## [Unreleased]';
const CATEGORY_ORDER = ['Added', 'Changed', 'Fixed', 'Security', 'Documentation', 'Maintenance'];
const CATEGORY_BY_TYPE = new Map([
  ['feat', 'Added'],
  ['fix', 'Fixed'],
  ['security', 'Security'],
  ['perf', 'Changed'],
  ['refactor', 'Changed'],
  ['docs', 'Documentation'],
  ['test', 'Maintenance'],
  ['build', 'Maintenance'],
  ['ci', 'Maintenance'],
  ['chore', 'Maintenance'],
]);
const CONVENTIONAL_TYPE = /^([a-z]+)(?:\([^)]*\))?!?:/;

function assertVersion(version) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    throw new Error(`version must match 0.<minor>.<patch>, got ${JSON.stringify(version)}`);
  }
}

function isCalendarDate(date) {
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function assertDate(date) {
  if (!isCalendarDate(date)) {
    throw new Error(`date must be a valid YYYY-MM-DD date, got ${JSON.stringify(date)}`);
  }
}

function assertSince(since) {
  if (typeof since !== 'string' || since === '' || since.startsWith('-')) {
    throw new Error(`since must be a git revision that does not start with "-", got ${JSON.stringify(since)}`);
  }
}

function readChangelog(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`cannot read ${file}: ${error.message}`, { cause: error });
  }
}

function findSection(lines, heading) {
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) {
    return null;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith('## ')) {
    end += 1;
  }
  return { start, end };
}

function categoryOf(subject) {
  const match = CONVENTIONAL_TYPE.exec(subject);
  return (match !== null && CATEGORY_BY_TYPE.get(match[1])) || 'Changed';
}

function collectEntries(root, since) {
  const range = since === undefined ? 'HEAD' : `${since}..HEAD`;
  let output;
  try {
    output = execFileSync('git', ['log', '--no-merges', '--format=%h%x09%s', range], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000,
    });
  } catch (error) {
    throw new Error(`git log failed for range "${range}": ${error.message}`, { cause: error });
  }

  const entries = [];
  for (const line of output.split('\n')) {
    if (line === '') {
      continue;
    }
    const tab = line.indexOf('\t');
    if (tab === -1) {
      throw new Error(`unexpected git log output: "${line}"`);
    }
    const sha = line.slice(0, tab);
    const subject = line.slice(tab + 1);
    if (subject.startsWith('chore(release)')) {
      continue;
    }
    entries.push({ sha, subject, category: categoryOf(subject) });
  }
  return entries;
}

function renderBody(entries) {
  const blocks = [];
  for (const category of CATEGORY_ORDER) {
    const items = entries
      .filter((entry) => entry.category === category)
      .map((entry) => `- ${entry.subject} (${entry.sha})`);
    if (items.length > 0) {
      blocks.push([`### ${category}`, ...items]);
    }
  }
  if (blocks.length === 0) {
    blocks.push(['### Changed', '- No user-facing changes recorded.']);
  }
  return blocks.flatMap((block, index) => (index === 0 ? block : ['', ...block]));
}

function notesFrom(bodyLines) {
  const trimmed = [...bodyLines];
  while (trimmed.length > 0 && trimmed[0].trim() === '') {
    trimmed.shift();
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === '') {
    trimmed.pop();
  }
  return trimmed.length === 0 ? '' : `${trimmed.join('\n')}\n`;
}

export function generateChangelog({ root, version, date, since, notesOut }) {
  assertVersion(version);
  assertDate(date);
  if (since !== undefined) {
    assertSince(since);
  }

  const changelogPath = path.join(root, 'CHANGELOG.md');
  const lines = readChangelog(changelogPath).split('\n');
  const existing = findSection(lines, `## [${version}]`);
  if (existing !== null) {
    if (notesOut !== undefined) {
      writeFileSync(notesOut, notesFrom(lines.slice(existing.start + 1, existing.end)), 'utf8');
    }
    return { version, changed: false };
  }

  const unreleased = lines.findIndex((line) => line.trimEnd() === UNRELEASED_HEADING);
  if (unreleased === -1) {
    throw new Error(`${changelogPath} has no "${UNRELEASED_HEADING}" heading`);
  }

  const body = renderBody(collectEntries(root, since));
  const section = [`## [${version}] - ${date}`, '', ...body];
  const rest = lines.slice(unreleased + 1);
  let tail;
  if (rest.length === 0) {
    tail = [''];
  } else if (rest[0].trim() === '') {
    tail = rest;
  } else {
    tail = ['', ...rest];
  }
  const updated = [...lines.slice(0, unreleased + 1), '', ...section, ...tail];
  writeFileSync(changelogPath, updated.join('\n'), 'utf8');

  if (notesOut !== undefined) {
    writeFileSync(notesOut, notesFrom(body), 'utf8');
  }
  return { version, changed: true };
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function isEntrypoint() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isEntrypoint()) {
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        version: { type: 'string' },
        date: { type: 'string' },
        since: { type: 'string' },
        'notes-out': { type: 'string' },
      },
      strict: true,
    });
    const result = generateChangelog({
      root: repoRoot,
      version: values.version,
      date: values.date,
      since: values.since,
      notesOut: values['notes-out'],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
