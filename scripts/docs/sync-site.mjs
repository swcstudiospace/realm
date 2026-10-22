// Generates the VitePress content tree (site/content) from the repository's markdown.
//
// Prose sanitizing: outside fenced code blocks and inline code spans, `{{` and `}}`
// are entity-escaped so Vue does not interpolate them, and every tag-like token
// (`<name`, `</name`) whose element name is not in ALLOWED_TAGS has its `<` escaped
// to `&lt;` so it renders as text instead of being compiled as a component.
// HTML comments (`<!--`) and allowlisted tags pass through untouched.
//
// Link rewriting: markdown links, images, reference definitions and src/href attributes of raw HTML tags whose targets point
// inside the repository become generated page routes, `/assets/...` paths for the copied
// assets, or GitHub blob/tree URLs. External, absolute, protocol-relative and pure-anchor
// targets are left as written.
//
// Directory indexes: every generated directory without a source index.md gets a generated
// index.md listing its children (pages and subdirectories) as sorted links.

import { copyFile, mkdir, readFile, readdir, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_URL = 'https://github.com/swcstudiospace/realm';
const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'site', 'coverage']);
const ROOT_OUTPUTS = new Map([
  ['README.md', 'overview.md'],
  ['CHANGELOG.md', 'changelog.md'],
  ['CONTRIBUTING.md', 'contributing.md'],
  ['SECURITY.md', 'security.md'],
  ['AGENTS.md', 'agents.md'],
  ['CLAUDE.md', 'claude.md'],
]);
const DIRECTORY_TITLES = new Map([
  ['docs', 'Docs'],
  ['planning', 'Planning'],
  ['agents', 'Agents'],
  ['github', 'GitHub'],
]);
const RESERVED_OUTPUTS = new Set(['index.md']);

// Everything under contentDir that this script owns and regenerates on each run.
// Generated directory indexes live inside these directories, so they are covered too.
export const GENERATED_ENTRIES = Object.freeze([
  'overview.md',
  'changelog.md',
  'contributing.md',
  'security.md',
  'agents.md',
  'claude.md',
  'docs',
  'planning',
  'agents',
  'github',
  'public',
]);

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'details', 'div', 'em',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol',
  'p', 'picture', 'pre', 'source', 'span', 'strong', 'sub', 'summary', 'sup',
  'svg', 'path', 'g', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
]);

// Private-use marker; control characters are avoided so no-control-regex stays quiet.
const MARK = '\uE000';
const CODE_SLOT = /\uE000(\d+)\uE000/g;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/;
const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const DECLARED_TITLE = /^title[ \t]*:[ \t]*(.*?)[ \t]*$/m;
const INLINE_LINK = /(!?\[[^\]]*\])\(([^\s)]+)([^)]*)\)/g;
const NESTED_IMAGE_LINK = /(\[!\[[^\]]*\]\([^)]*\)\])\(([^\s)]+)([^)]*)\)/g;
const REFERENCE_DEFINITION = /^( {0,3}\[[^\]]+\]:[ \t]*)(\S+)(.*)$/g;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const TAG_START = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/g;
const HTML_TAG = /<([A-Za-z][A-Za-z0-9-]*)(\s[^<>]*)?>/g;
const HTML_URL_ATTRIBUTE = /(\s(?:src|href)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

/**
 * Regenerates the content tree under `contentDir` from the markdown in `repoRoot`.
 * A missing README.md, CHANGELOG.md or assets/ is not an error; the matching output is simply absent.
 * @param {{ repoRoot?: string, contentDir?: string }} [options]
 * @returns {Promise<{ pages: number, indexes: number, assets: number }>}
 */
export async function syncSite({
  repoRoot = DEFAULT_REPO_ROOT,
  contentDir = join(repoRoot, 'site', 'content'),
} = {}) {
  const root = resolve(repoRoot);
  const content = resolve(contentDir);
  const sources = (
    await listFiles(root, (name, absolute) => !SKIPPED_DIRECTORIES.has(name) && absolute !== content)
  ).filter((rel) => rel.endsWith('.md'));
  const pages = planPages(sources);
  const documents = await loadDocuments(root, pages);
  const indexes = planDirectoryIndexes(documents);
  const assets = await listFiles(join(root, 'assets'), () => true);

  const manifestPath = join(dirname(content), MANIFEST_NAME);
  await removePreviousOutputs(content, await readManifest(manifestPath));

  await Promise.all(
    GENERATED_ENTRIES.map((entry) => rm(join(content, entry), { recursive: true, force: true })),
  );
  await mkdir(content, { recursive: true });

  const context = { root, pages };
  await Promise.all([
    ...documents.map((document) =>
      writeRendered(document.output, document.raw, document.source, context, content),
    ),
    ...indexes.map((index) => writeRendered(index.output, index.text, index.output, context, content)),
    ...assets.map((asset) => copyAsset(asset, root, content)),
  ]);
  const written = [
    ...documents.map((document) => document.output),
    ...indexes.map((index) => index.output),
    ...assets.map((asset) => `public/assets/${asset}`),
  ].sort(compareStrings);
  await writeText(manifestPath, `${JSON.stringify({ outputs: written }, null, 2)}\n`);
  return { pages: documents.length, indexes: indexes.length, assets: assets.length };
}

const MANIFEST_NAME = '.sync-manifest.json';

// Outputs recorded by the previous run. A missing or unparseable manifest records nothing,
// and the fixed GENERATED_ENTRIES cleanup still applies.
async function readManifest(manifestPath) {
  let text;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed?.outputs)
      ? parsed.outputs.filter((output) => typeof output === 'string')
      : [];
  } catch {
    return [];
  }
}

// Only plain relative paths inside contentDir may be deleted: a manifest can never reach
// outside the content tree, and the root index.md and .vitepress/ are always kept.
function isPrunable(output) {
  const segments = output.split('/');
  return (
    output !== 'index.md' &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..') &&
    segments[0] !== '.vitepress'
  );
}

async function removePreviousOutputs(content, previous) {
  const outputs = previous.filter(isPrunable);
  await Promise.all(
    outputs.map((output) => rm(join(content, ...output.split('/')), { force: true })),
  );
  const levels = new Map();
  for (const output of outputs) {
    const segments = output.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const dirs = levels.get(depth) ?? new Set();
      dirs.add(segments.slice(0, depth).join('/'));
      levels.set(depth, dirs);
    }
  }
  // Deepest directories first, so a parent is only tried after its children were removed.
  for (const depth of [...levels.keys()].sort((a, b) => b - a)) {
    await Promise.all(
      [...levels.get(depth)].map((dir) => removeIfEmpty(join(content, ...dir.split('/')))),
    );
  }
}

async function removeIfEmpty(dir) {
  try {
    await rmdir(dir);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) {
      throw error;
    }
  }
}

function planPages(sources) {
  const pages = new Map();
  const claimedBy = new Map();
  for (const source of sources) {
    const output = outputPathFor(source);
    if (RESERVED_OUTPUTS.has(output)) {
      throw new Error(`${source} maps to reserved page ${output}`);
    }
    if (claimedBy.has(output)) {
      throw new Error(`${source} and ${claimedBy.get(output)} both map to ${output}`);
    }
    claimedBy.set(output, source);
    pages.set(source, output);
  }
  return pages;
}

function outputPathFor(source) {
  const rootOutput = ROOT_OUTPUTS.get(source);
  if (rootOutput !== undefined) {
    return rootOutput;
  }
  return source
    .split('/')
    .map((segment) => (segment.startsWith('.') ? segment.slice(1) : segment))
    .join('/');
}

async function loadDocuments(root, pages) {
  return Promise.all(
    [...pages].map(async ([source, output]) => {
      const raw = await readFile(join(root, source), 'utf8');
      return { source, output, raw, title: documentTitle(raw, source) };
    }),
  );
}

// A directory index for each generated directory that has no source index.md of its own.
function planDirectoryIndexes(documents) {
  const outputs = new Set(documents.map((document) => document.output));
  const directories = new Set();
  for (const output of outputs) {
    const segments = output.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      directories.add(segments.slice(0, depth).join('/'));
    }
  }
  return [...directories]
    .sort(compareStrings)
    .filter((dir) => !outputs.has(`${dir}/index.md`))
    .map((dir) => ({
      output: `${dir}/index.md`,
      text: directoryIndexText(directoryTitle(dir), childEntries(dir, documents, directories)),
    }));
}

function childEntries(dir, documents, directories) {
  const prefix = `${dir}/`;
  const entries = [];
  for (const document of documents) {
    if (document.output.startsWith(prefix) && !document.output.slice(prefix.length).includes('/')) {
      entries.push({ label: document.title, href: routeFor(document.output) });
    }
  }
  for (const child of directories) {
    if (child.startsWith(prefix) && !child.slice(prefix.length).includes('/')) {
      entries.push({ label: directoryTitle(child), href: routeFor(`${child}/index.md`) });
    }
  }
  return entries.sort(
    (a, b) => compareStrings(a.label, b.label) || compareStrings(a.href, b.href),
  );
}

function directoryTitle(dir) {
  if (!dir.includes('/') && DIRECTORY_TITLES.has(dir)) {
    return DIRECTORY_TITLES.get(dir);
  }
  return posix.basename(dir);
}

function directoryIndexText(title, entries) {
  const items = entries.map((entry) => `- [${escapeLinkText(entry.label)}](${entry.href})`);
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n# ${title}\n\n${items.join('\n')}\n`;
}

function escapeLinkText(text) {
  return text.replace(/[[\]\\]/g, '\\$&');
}

// Route for a generated page: overview.md -> /overview, docs/index.md -> /docs/.
function routeFor(output) {
  const page = output.slice(0, -'.md'.length);
  if (page === 'index') {
    return '/';
  }
  if (page.endsWith('/index')) {
    return `/${page.slice(0, -'index'.length)}`;
  }
  return `/${page}`;
}

async function writeRendered(output, raw, source, context, content) {
  await writeText(join(content, output), await renderPage(raw, source, context));
}

async function copyAsset(asset, root, content) {
  const target = join(content, 'public', 'assets', asset);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, 'assets', asset), target);
}

async function writeText(target, text) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}

async function renderPage(raw, source, context) {
  const { block, body } = splitFrontmatter(raw);
  const titleLine = `title: ${JSON.stringify(documentTitle(raw, source))}`;
  const header = block === null ? `---\n${titleLine}\n---\n\n` : frontmatterWithTitle(block, titleLine);
  const lines = body.split('\n');
  const fenced = markFencedLines(lines);
  const rendered = await Promise.all(
    lines.map((line, index) => (fenced[index] ? line : transformProseLine(line, source, context))),
  );
  return `${header}${rendered.join('\n')}`;
}

function splitFrontmatter(raw) {
  const match = raw.match(FRONTMATTER);
  if (match === null) {
    return { block: null, body: raw };
  }
  return { block: match[1] ?? '', body: raw.slice(match[0].length) };
}

// Frontmatter title, else first level-1 heading outside code, else the source file stem.
function documentTitle(raw, source) {
  const { block, body } = splitFrontmatter(raw);
  const declared = block === null ? null : declaredTitle(block);
  return declared ?? headingTitle(body) ?? posix.basename(source, '.md');
}

function declaredTitle(block) {
  const match = block.match(DECLARED_TITLE);
  if (match === null) {
    return null;
  }
  const value = match[1].replace(/^(["'])(.*)\1$/, '$2');
  return value === '' ? null : value;
}

function headingTitle(body) {
  const lines = body.split('\n');
  return firstHeading(lines, markFencedLines(lines));
}

function frontmatterWithTitle(block, titleLine) {
  if (/^title\s*:/m.test(block)) {
    return `---\n${block}\n---\n`;
  }
  const fields = block === '' ? titleLine : `${block}\n${titleLine}`;
  return `---\n${fields}\n---\n`;
}

// True for every line that is part of a fenced block, including the fence lines.
function markFencedLines(lines) {
  const flags = [];
  let open = null;
  for (const line of lines) {
    if (open === null) {
      const start = FENCE_OPEN.exec(line);
      if (start === null) {
        flags.push(false);
      } else {
        open = { char: start[1][0], length: start[1].length };
        flags.push(true);
      }
      continue;
    }
    flags.push(true);
    const end = FENCE_CLOSE.exec(line);
    if (end !== null && end[1][0] === open.char && end[1].length >= open.length) {
      open = null;
    }
  }
  return flags;
}

function firstHeading(lines, fenced) {
  const index = lines.findIndex((line, position) => !fenced[position] && /^#[ \t]+\S/.test(line));
  if (index === -1) {
    return null;
  }
  const text = plainText(lines[index].replace(/^#[ \t]+/, ''));
  return text === '' ? null : text;
}

function plainText(text) {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}

async function transformProseLine(line, source, context) {
  const masked = maskCodeSpans(line);
  const linked = await rewriteLinks(masked.text, source, context);
  return masked.restore(escapeProse(linked));
}

// Replaces each inline code span with an opaque slot so later passes never see its contents.
function maskCodeSpans(line) {
  const spans = [];
  let text = '';
  let index = 0;
  while (index < line.length) {
    if (line[index] !== '`') {
      text += line[index];
      index += 1;
      continue;
    }
    const runEnd = endOfBacktickRun(line, index);
    const runLength = runEnd - index;
    const closeAt = findBacktickRun(line, runEnd, runLength);
    if (closeAt === -1) {
      text += line.slice(index, runEnd);
      index = runEnd;
      continue;
    }
    spans.push(line.slice(index, closeAt + runLength));
    text += `${MARK}${spans.length - 1}${MARK}`;
    index = closeAt + runLength;
  }
  return {
    text,
    restore: (value) => value.replace(CODE_SLOT, (_, slot) => spans[Number(slot)]),
  };
}

function endOfBacktickRun(line, start) {
  let end = start;
  while (end < line.length && line[end] === '`') {
    end += 1;
  }
  return end;
}

function findBacktickRun(line, from, length) {
  let index = line.indexOf('`', from);
  while (index !== -1) {
    const end = endOfBacktickRun(line, index);
    if (end - index === length) {
      return index;
    }
    index = line.indexOf('`', end);
  }
  return -1;
}

async function rewriteLinks(text, source, context) {
  const badged = await replaceMatches(text, NESTED_IMAGE_LINK, async (match) => {
    const target = await rewriteTarget(match[2], source, context);
    return `${match[1]}(${target}${match[3]})`;
  });
  const inline = await replaceMatches(badged, INLINE_LINK, async (match) => {
    const target = await rewriteTarget(match[2], source, context);
    return `${match[1]}(${target}${match[3]})`;
  });
  const referenced = await replaceMatches(inline, REFERENCE_DEFINITION, async (match) => {
    const target = await rewriteTarget(match[2], source, context);
    return `${match[1]}${target}${match[3]}`;
  });
  return rewriteHtmlAttributes(referenced, source, context);
}

async function rewriteTarget(target, source, { root, pages }) {
  if (
    target === '' ||
    target.includes(MARK) ||
    target.startsWith('<') ||
    target.startsWith('/') ||
    target.startsWith('#') ||
    URI_SCHEME.test(target)
  ) {
    return target;
  }
  const hash = target.indexOf('#');
  const pathPart = hash === -1 ? target : target.slice(0, hash);
  const anchor = hash === -1 ? '' : target.slice(hash);
  const resolved = posix.normalize(posix.join(posix.dirname(source), pathPart));
  if (resolved === '..' || resolved.startsWith('../')) {
    return target;
  }
  const trailingSlash = resolved.endsWith('/');
  const trimmed = resolved.replace(/\/+$/, '');
  const repoPath = trimmed === '.' ? '' : trimmed;

  const output = pages.get(repoPath);
  if (output !== undefined) {
    return `${routeFor(output)}${anchor}`;
  }
  if (repoPath.startsWith('assets/')) {
    return `/${resolved}${anchor}`;
  }
  const isDirectory = trailingSlash || (await isDirectoryPath(join(root, repoPath)));
  return `${REPO_URL}/${isDirectory ? 'tree' : 'blob'}/main/${repoPath}${anchor}`;
}

// Rewrites src and href values on allowlisted raw HTML tags with the markdown link resolver.
async function rewriteHtmlAttributes(text, source, context) {
  return replaceMatches(text, HTML_TAG, async (tag) => {
    if (tag[2] === undefined || !ALLOWED_TAGS.has(tag[1].toLowerCase())) {
      return tag[0];
    }
    const attributes = await replaceMatches(tag[2], HTML_URL_ATTRIBUTE, async (attribute) => {
      let quote = '';
      let value = attribute[4];
      if (attribute[2] !== undefined) {
        quote = '"';
        value = attribute[2];
      } else if (attribute[3] !== undefined) {
        quote = "'";
        value = attribute[3];
      }
      return `${attribute[1]}${quote}${await rewriteTarget(value, source, context)}${quote}`;
    });
    return `<${tag[1]}${attributes}>`;
  });
}

async function isDirectoryPath(absolute) {
  try {
    return (await stat(absolute)).isDirectory();
  } catch {
    return false;
  }
}

function escapeProse(text) {
  return text
    .replaceAll('{{', '&#123;&#123;')
    .replaceAll('}}', '&#125;&#125;')
    .replace(TAG_START, (match, closing, name) =>
      ALLOWED_TAGS.has(name.toLowerCase()) ? match : `&lt;${closing}${name}`,
    );
}

async function replaceMatches(text, pattern, replacer) {
  const matches = [...text.matchAll(pattern)];
  const replacements = await Promise.all(matches.map((match) => replacer(match)));
  let result = '';
  let last = 0;
  matches.forEach((match, index) => {
    result += text.slice(last, match.index) + replacements[index];
    last = match.index + match[0].length;
  });
  return result + text.slice(last);
}

// Lists files under `root` as sorted posix paths relative to it. A missing root yields [].
async function listFiles(root, shouldDescend) {
  const found = [];
  const visit = async (relDir) => {
    const entries = await readdir(relDir === '' ? root : join(root, relDir), { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (shouldDescend(entry.name, join(root, rel))) {
            await visit(rel);
          }
        } else if (entry.isFile()) {
          found.push(rel);
        }
      }),
    );
  };
  try {
    await visit('');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return found.sort(compareStrings);
}

function compareStrings(a, b) {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await syncSite();
}
