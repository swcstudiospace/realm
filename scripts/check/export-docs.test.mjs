// Every export of src/core and src/contract is documented: a comment is the nearest non-blank line above its declaration.
// These two directories are the surface the rest of the code, and the callers outside it, read first.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCUMENTED_DIRS = ['src/core', 'src/contract'];
const EXPORT_DECLARATION = /^export (?:async )?(?:function|const|let|class|type|interface|enum)\b/;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function isComment(line) {
  const text = line.trim();
  return text.startsWith('//') || text.startsWith('/*') || text.startsWith('*') || text.endsWith('*/');
}

// The 1-based line numbers of exports whose nearest non-blank line above is not a comment.
function undocumentedExports(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const missing = [];
  lines.forEach((line, index) => {
    if (!EXPORT_DECLARATION.test(line)) {
      return;
    }
    let above = index - 1;
    while (above >= 0 && lines[above].trim() === '') {
      above -= 1;
    }
    if (above < 0 || !isComment(lines[above])) {
      missing.push(index + 1);
    }
  });
  return missing;
}

describe('exports documentation', () => {
  it('documents every export of src/core and src/contract with a leading comment', () => {
    const missing = [];
    for (const dir of DOCUMENTED_DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        for (const line of undocumentedExports(file)) {
          missing.push(`${relative(ROOT, file)}:${String(line)}`);
        }
      }
    }
    assert.deepEqual(missing, []);
  });
});
