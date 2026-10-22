import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { syncSite } from './sync-site.mjs';

const roots = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function lines(...rows) {
  return `${rows.join('\n')}\n`;
}

async function writeFixtureFile(root, relPath, contents) {
  const target = join(root, ...relPath.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function makeRoot(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function snapshot(dir) {
  const names = await readdir(dir, { recursive: true });
  const entries = {};
  await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      if ((await stat(path)).isFile()) {
        entries[name] = (await readFile(path)).toString('base64');
      }
    }),
  );
  return entries;
}

const FIXTURE_TEXT = {
  'README.md': lines(
    '# Realm',
    '',
    'Start with [the plan](.planning/STATE.md#progress), [the guide](docs/guide.md), [the license](LICENSE), [the source](src/), [the logo](assets/brand/logo.svg), and [home](https://example.com/realm).',
    '',
    'Jump to [top](#top), [absolute](/already/here), [proto](//cdn.example.com/x.js), or [mail](mailto:team@example.com).',
    '',
    '![logo](assets/brand/logo.svg)',
    '',
    'Code in `[not](rewritten.md)` stays put.',
    '',
    '<img src="assets/brand/logo.svg" alt="Logo">',
    '',
    '[![Licence: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg)](LICENSE)',
    '',
    '[![CI](https://img.shields.io/badge/ci-green.svg)](https://github.com/swcstudiospace/realm/actions) [![Docs](https://img.shields.io/badge/docs-site-purple.svg)](https://swcstudiospace.github.io/realm/) [![Node](https://img.shields.io/badge/node-22-green.svg)](https://nodejs.org) [![npm](https://img.shields.io/badge/npm-package-red.svg)](https://www.npmjs.com/package/agent-realm)',
  ),
  'docs/guide.md': lines(
    '# Guide',
    '',
    'Read [the overview](../README.md#realm) and [the design](design.md).',
  ),
  'docs/design.md': lines('# Design', '', '```md', '[sample](guide.md)', '```', '', 'Done.'),
  'docs/integration/runtime-decision.md': lines('# Runtime decision', '', 'Details.'),
  'docs/empty/notes.txt': 'Not markdown, so the directory produces no page.\n',
  'notes/html.md': lines(
    '# Raw HTML',
    '',
    '<img src="../assets/brand/logo.svg" alt="Logo"> and <a href="../docs/guide.md#intro">guide</a>.',
    '',
    '<a href="https://example.com/x">external</a> <a href="#top">anchor</a> <img src=\'//cdn.example.com/a.png\'>',
    '',
    'Inline `<img src="../assets/brand/logo.svg">` stays.',
    '',
    '<a href="../src/index.ts">source</a>',
  ),
  '.planning/STATE.md': lines(
    '# State',
    '',
    'Prose with {{ braces }} and <Widget kind="x"> plus <img src="pic.png" alt="pic"> and <p>para</p>.',
    '',
    'Code `{{ inline }}` and `<Inline>` survive.',
    '',
    '```html',
    '{{ fenced }} <Fenced>',
    '```',
    '',
    '~~~',
    '<Tilde> {{ tilde }}',
    '~~~',
    '',
    '<!-- keep me -->',
  ),
  '.planning/index.md': lines('# Planning home', '', 'Custom index.'),
  '.agents/GEMINI.md': lines('Plain notes without a heading.'),
  '.github/ISSUE_TEMPLATE/bug_report.md': lines(
    '---',
    'name: Bug report',
    'about: Report a bug',
    '---',
    '',
    '# Bug report template',
    '',
    'Describe {{ the bug }}.',
  ),
  'CONTRIBUTING.md': lines('---', 'title: Contributing guide', '---', '', '# Ignored heading', '', 'Read the rules.'),
  'src/index.ts': lines('export {};'),
  'assets/brand/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
  'node_modules/pkg/README.md': lines('# Vendored'),
};

const STALE_TEXT = {
  'site/content/index.md': lines('# Home'),
  'site/content/.vitepress/config.mts': 'export default {};\n',
  'site/content/overview.md': 'stale\n',
  'site/content/docs/stale.md': 'stale\n',
  'site/content/planning/old.md': 'stale\n',
  'site/content/public/assets/old.svg': 'stale\n',
};

describe('syncSite', () => {
  let root;
  let contentDir;

  const contentPath = (relPath) => join(contentDir, ...relPath.split('/'));
  const readContent = (relPath) => readFile(contentPath(relPath), 'utf8');

  before(async () => {
    root = await makeRoot('sync-site-');
    contentDir = join(root, 'site', 'content');
    await Promise.all([
      ...Object.entries(FIXTURE_TEXT).map(([rel, text]) => writeFixtureFile(root, rel, text)),
      ...Object.entries(STALE_TEXT).map(([rel, text]) => writeFixtureFile(root, rel, text)),
      writeFixtureFile(root, 'assets/brand/blob.bin', Buffer.from([0, 255, 16, 128])),
    ]);
    await syncSite({ repoRoot: root, contentDir });
  });

  it('maps README.md to overview.md with a title from its first heading', async () => {
    const overview = await readContent('overview.md');
    assert.ok(overview.startsWith('---\ntitle: "Realm"\n---\n\n# Realm\n'));
  });

  it('maps dot-prefixed directories without their leading dot', async () => {
    assert.ok(await exists(contentPath('planning/STATE.md')));
    assert.ok(await exists(contentPath('agents/GEMINI.md')));
    assert.ok(await exists(contentPath('github/ISSUE_TEMPLATE/bug_report.md')));
    assert.equal(await exists(contentPath('.planning')), false);
    assert.equal(await exists(contentPath('.agents')), false);
    assert.equal(await exists(contentPath('.github')), false);
  });

  it('falls back to the file stem for a title when there is no heading', async () => {
    const gemini = await readContent('agents/GEMINI.md');
    assert.ok(gemini.startsWith('---\ntitle: "GEMINI"\n---\n'));
  });

  it('escapes braces and unknown tags in prose but not inside code', async () => {
    const state = await readContent('planning/STATE.md');
    assert.ok(state.includes('Prose with &#123;&#123; braces &#125;&#125; and &lt;Widget kind="x"> plus'));
    assert.ok(state.includes('Code `{{ inline }}` and `<Inline>` survive.'));
    assert.ok(state.includes('{{ fenced }} <Fenced>'));
    assert.ok(state.includes('<Tilde> {{ tilde }}'));
  });

  it('keeps allowlisted tags and HTML comments intact', async () => {
    const state = await readContent('planning/STATE.md');
    assert.ok(
      state.includes(
        '<img src="https://github.com/swcstudiospace/realm/blob/main/.planning/pic.png" alt="pic">',
      ),
    );
    assert.ok(state.includes('<p>para</p>'));
    assert.ok(state.includes('<!-- keep me -->'));
  });

  it('rewrites links to routes, GitHub URLs, and assets, leaving external and anchor links alone', async () => {
    const overview = await readContent('overview.md');
    const expected = [
      '[the plan](/planning/STATE#progress)',
      '[the guide](/docs/guide)',
      '[the license](https://github.com/swcstudiospace/realm/blob/main/LICENSE)',
      '[the source](https://github.com/swcstudiospace/realm/tree/main/src)',
      '[the logo](/assets/brand/logo.svg)',
      '![logo](/assets/brand/logo.svg)',
      '[home](https://example.com/realm)',
      '[top](#top)',
      '[absolute](/already/here)',
      '[proto](//cdn.example.com/x.js)',
      '[mail](mailto:team@example.com)',
      '`[not](rewritten.md)`',
    ];
    for (const fragment of expected) {
      assert.ok(overview.includes(fragment), `missing ${fragment}`);
    }
  });

  it('rewrites links inside generated pages relative to their source directory', async () => {
    const guide = await readContent('docs/guide.md');
    assert.ok(guide.includes('[the overview](/overview#realm)'));
    assert.ok(guide.includes('[the design](/docs/design)'));
    const design = await readContent('docs/design.md');
    assert.ok(design.includes('[sample](guide.md)'));
  });

  it('keeps existing frontmatter and adds a title only when it is absent', async () => {
    const bugReport = await readContent('github/ISSUE_TEMPLATE/bug_report.md');
    assert.ok(
      bugReport.startsWith(
        '---\nname: Bug report\nabout: Report a bug\ntitle: "Bug report template"\n---\n',
      ),
    );
    const contributing = await readContent('contributing.md');
    assert.ok(contributing.startsWith('---\ntitle: Contributing guide\n---\n'));
    assert.equal((contributing.match(/^title:/gm) ?? []).length, 1);
  });

  it('generates a sorted index for a nested directory and links children by route', async () => {
    const integration = await readContent('docs/integration/index.md');
    assert.equal(
      integration,
      '---\ntitle: "integration"\n---\n\n# integration\n\n- [Runtime decision](/docs/integration/runtime-decision)\n',
    );
  });

  it('generates a top-level index whose links point at child pages and child directory indexes', async () => {
    const docsIndex = await readContent('docs/index.md');
    assert.equal(
      docsIndex,
      [
        '---',
        'title: "Docs"',
        '---',
        '',
        '# Docs',
        '',
        '- [Design](/docs/design)',
        '- [Guide](/docs/guide)',
        '- [integration](/docs/integration/)',
        '',
      ].join('\n'),
    );
  });

  it('generates indexes titled GitHub and Agents for the mapped dot-directories', async () => {
    assert.equal(
      await readContent('github/index.md'),
      '---\ntitle: "GitHub"\n---\n\n# GitHub\n\n- [ISSUE_TEMPLATE](/github/ISSUE_TEMPLATE/)\n',
    );
    assert.equal(
      await readContent('github/ISSUE_TEMPLATE/index.md'),
      '---\ntitle: "ISSUE_TEMPLATE"\n---\n\n# ISSUE_TEMPLATE\n\n- [Bug report template](/github/ISSUE_TEMPLATE/bug_report)\n',
    );
    assert.equal(
      await readContent('agents/index.md'),
      '---\ntitle: "Agents"\n---\n\n# Agents\n\n- [GEMINI](/agents/GEMINI)\n',
    );
  });

  it('keeps a source index.md at a generated directory instead of generating one', async () => {
    assert.equal(
      await readContent('planning/index.md'),
      '---\ntitle: "Planning home"\n---\n\n# Planning home\n\nCustom index.\n',
    );
  });

  it('generates no index for a directory that yields no generated pages', async () => {
    assert.equal(await exists(contentPath('empty')), false);
    assert.equal(await exists(contentPath('docs/empty/index.md')), false);
    assert.equal((await readContent('docs/index.md')).includes('/docs/empty/'), false);
  });

  it('does not treat vendored node_modules markdown as a source', async () => {
    assert.equal(await exists(contentPath('node_modules')), false);
  });

  it('copies assets byte for byte', async () => {
    const blob = await readFile(contentPath('public/assets/brand/blob.bin'));
    assert.deepEqual(blob, Buffer.from([0, 255, 16, 128]));
    const logo = await readFile(contentPath('public/assets/brand/logo.svg'));
    const sourceLogo = await readFile(join(root, 'assets', 'brand', 'logo.svg'));
    assert.deepEqual(logo, sourceLogo);
  });

  it('removes stale generated entries and keeps index.md and .vitepress', async () => {
    assert.equal(await exists(contentPath('docs/stale.md')), false);
    assert.equal(await exists(contentPath('planning/old.md')), false);
    assert.equal(await exists(contentPath('public/assets/old.svg')), false);
    assert.equal(await readContent('index.md'), '# Home\n');
    assert.equal(await readContent('.vitepress/config.mts'), 'export default {};\n');
  });

  it('is idempotent: a second run yields identical bytes', async () => {
    const first = await snapshot(contentDir);
    await syncSite({ repoRoot: root, contentDir });
    const second = await snapshot(contentDir);
    assert.deepEqual(second, first);
  });

  it('skips overview.md when README.md is absent and still generates directory indexes', async () => {
    const bare = await makeRoot('sync-site-bare-');
    await writeFixtureFile(bare, 'docs/guide.md', lines('# Guide'));
    const dir = join(bare, 'site', 'content');
    await syncSite({ repoRoot: bare, contentDir: dir });
    assert.equal(await exists(join(dir, 'overview.md')), false);
    assert.equal(await exists(join(dir, 'changelog.md')), false);
    assert.equal(
      await readFile(join(dir, 'docs', 'index.md'), 'utf8'),
      '---\ntitle: "Docs"\n---\n\n# Docs\n\n- [Guide](/docs/guide)\n',
    );
  });

  it('rewrites a raw img src pointing into assets to /assets/', async () => {
    const overview = await readContent('overview.md');
    assert.ok(overview.includes('<img src="/assets/brand/logo.svg" alt="Logo">'));
    const html = await readContent('notes/html.md');
    assert.ok(html.includes('<img src="/assets/brand/logo.svg" alt="Logo">'));
  });

  it('rewrites a raw a href pointing at a repo markdown file to its route', async () => {
    const html = await readContent('notes/html.md');
    assert.ok(html.includes('<a href="/docs/guide#intro">guide</a>'));
  });

  it('sends a raw a href to a non-markdown repo file to its GitHub blob URL and keeps the anchor tag', async () => {
    const html = await readContent('notes/html.md');
    assert.ok(
      html.includes(
        '<a href="https://github.com/swcstudiospace/realm/blob/main/src/index.ts">source</a>',
      ),
    );
    assert.equal(html.includes('&lt;a'), false);
  });

  it('leaves external, anchor and protocol-relative attribute values unchanged', async () => {
    const html = await readContent('notes/html.md');
    assert.ok(html.includes('<a href="https://example.com/x">external</a>'));
    assert.ok(html.includes('<a href="#top">anchor</a>'));
    assert.ok(html.includes('<img src=\'//cdn.example.com/a.png\'>'));
  });

  it('leaves a relative src inside an inline code span alone', async () => {
    const html = await readContent('notes/html.md');
    assert.ok(html.includes('Inline `<img src="../assets/brand/logo.svg">` stays.'));
  });

  it('rewrites the outer target of a nested badge link and keeps the image src', async () => {
    const overview = await readContent('overview.md');
    assert.ok(
      overview.includes(
        '[![Licence: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue.svg)](https://github.com/swcstudiospace/realm/blob/main/LICENSE)',
      ),
    );
    assert.equal(overview.includes('](LICENSE)'), false);
  });

  it('leaves absolute badge links unchanged', async () => {
    const overview = await readContent('overview.md');
    for (const badge of [
      '[![CI](https://img.shields.io/badge/ci-green.svg)](https://github.com/swcstudiospace/realm/actions)',
      '[![Docs](https://img.shields.io/badge/docs-site-purple.svg)](https://swcstudiospace.github.io/realm/)',
      '[![Node](https://img.shields.io/badge/node-22-green.svg)](https://nodejs.org)',
      '[![npm](https://img.shields.io/badge/npm-package-red.svg)](https://www.npmjs.com/package/agent-realm)',
    ]) {
      assert.ok(overview.includes(badge), `missing ${badge}`);
    }
  });
});
