import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitepress';

const configDir = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(configDir, '..');
const repoRoot = resolve(configDir, '..', '..', '..');

const base = '/realm/';
const siteOrigin = 'https://swcstudiospace.github.io';
const repoUrl = 'https://github.com/swcstudiospace/realm';
const description = 'Realm, the home of AI Generated Code. Agent sandbox for the GSD-Core USSR Stack.';

const OVERVIEW_PAGES = ['overview.md', 'changelog.md', 'contributing.md', 'security.md', 'agents.md', 'claude.md'];

// Sidebar labels that cannot come from the page itself. README.md has an HTML
// <h1> rather than a markdown heading, so its label is set here.
const LABEL_OVERRIDES = { 'overview.md': 'Overview' };

const GROUPS = [
  { text: 'Docs', prefix: 'docs/' },
  { text: 'Planning', prefix: 'planning/' },
  { text: 'Agents', prefix: 'agents/' },
  { text: 'GitHub', prefix: 'github/' },
];

// Every markdown file under the content root, as POSIX-style relative paths.
// A missing or empty content directory yields no pages.
function listMarkdown(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((entry) => entry.split(sep).join('/'))
    .filter((rel) => rel.endsWith('.md') && !rel.startsWith('.vitepress/'))
    .sort();
}

// Frontmatter title, else first level-1 heading outside frontmatter and fenced
// code, else the file stem. Matches the title rule used by scripts/docs/sync-site.mjs.
function pageTitle(rel) {
  const stem = basename(rel, '.md');
  const lines = readFileSync(join(contentDir, rel), 'utf8').split(/\r?\n/);
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      const declared = frontmatterTitle(lines.slice(1, end));
      if (declared !== null) return declared;
      start = end + 1;
    }
  }
  let inFence = false;
  for (const line of lines.slice(start)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^#\s+(.+?)\s*$/.exec(line);
    if (heading) return heading[1];
  }
  return stem;
}

function frontmatterTitle(lines) {
  for (const line of lines) {
    const match = /^title[ \t]*:[ \t]*(.*?)[ \t]*$/.exec(line);
    if (match) {
      const value = match[1].replace(/^(["'])(.*)\1$/, '$2');
      return value === '' ? null : value;
    }
  }
  return null;
}

// docs/index.md is served at /docs/, so index pages link to their directory.
function pageLink(rel) {
  const path = rel.slice(0, -'.md'.length);
  if (path === 'index') return '/';
  if (path.endsWith('/index')) return `/${path.slice(0, -'index'.length)}`;
  return `/${path}`;
}

function toItem(rel) {
  return { text: LABEL_OVERRIDES[rel] ?? pageTitle(rel), link: pageLink(rel) };
}

function buildSidebar() {
  const pages = listMarkdown(contentDir);
  const sidebar = {};

  const project = OVERVIEW_PAGES.filter((rel) => pages.includes(rel)).map(toItem);
  if (project.length > 0) {
    sidebar['/'] = [{ text: 'Project', items: project }];
  }

  for (const group of GROUPS) {
    const items = pages.filter((rel) => rel.startsWith(group.prefix)).map(toItem);
    if (items.length > 0) {
      sidebar[`/${group.prefix}`] = [{ text: group.text, items }];
    }
  }

  return sidebar;
}

export default defineConfig({
  base,
  title: 'Realm',
  description,
  appearance: false,
  cleanUrls: true,
  lastUpdated: false,
  ignoreDeadLinks: false,

  // VitePress resolves these itself and passes them to Vite, so they are set here
  // rather than under vite.* or build.* where they would be overridden.
  outDir: resolve(repoRoot, 'dist/site'),
  cacheDir: resolve(repoRoot, 'node_modules/.vite-site'),

  // Head attributes are emitted verbatim, so the base is applied by hand.
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}assets/brand/logo.svg` }],
    ['meta', { name: 'theme-color', content: '#7137ea' }],
    ['meta', { property: 'og:title', content: 'Realm' }],
    ['meta', { property: 'og:description', content: description }],
    // Social crawlers need an absolute URL for og:image.
    ['meta', { property: 'og:image', content: `${siteOrigin}${base}assets/brand/banner.png` }],
  ],

  themeConfig: {
    siteTitle: 'Realm',
    logo: '/assets/brand/logo.svg',
    nav: [
      { text: 'Overview', link: '/overview' },
      { text: 'Docs', link: '/docs/' },
      { text: 'Planning', link: '/planning/' },
      { text: 'Changelog', link: '/changelog' },
      { text: 'GitHub', link: repoUrl },
    ],
    socialLinks: [{ icon: 'github', link: repoUrl }],
    sidebar: buildSidebar(),
    search: { provider: 'local' },
    footer: {
      message: 'AGPL-3.0-only. Copyright (C) 2026 Spectrum Web Co/swcstudiospace.',
    },
  },
});
