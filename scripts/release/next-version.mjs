import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nextVersion } from './version.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MILESTONE_PATTERN = /^v\d+\.\d+$/;

function readMilestone(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`cannot read or parse ${file}: ${error.message}`, { cause: error });
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${file} must contain a JSON object`);
  }
  if (typeof data.milestone !== 'string' || !MILESTONE_PATTERN.test(data.milestone)) {
    throw new Error(
      `milestone in ${file} must match v<digits>.<digits>, got ${JSON.stringify(data.milestone)}`,
    );
  }
  if (!Number.isInteger(data.minor) || data.minor < 1) {
    throw new Error(`minor in ${file} must be a positive integer, got ${JSON.stringify(data.minor)}`);
  }
  return data;
}

function listTags(cwd) {
  let output;
  try {
    output = execFileSync('git', ['tag', '--list', 'v*'], { cwd, encoding: 'utf8', timeout: 30000 });
  } catch (error) {
    throw new Error(`cannot list git tags in ${cwd}: ${error.message}`, { cause: error });
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function planNextVersion(root) {
  const milestone = readMilestone(path.join(root, 'release', 'milestone.json'));
  return nextVersion({ tags: listTags(root), milestoneMinor: milestone.minor });
}

function isEntrypoint() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isEntrypoint()) {
  try {
    process.stdout.write(`${JSON.stringify(planNextVersion(repoRoot))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
