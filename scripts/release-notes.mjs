#!/usr/bin/env node
/**
 * Release notes for the `v*` tags — one markdown body for the GitHub Release.
 *
 *   node scripts/release-notes.mjs <from-ref> [to-ref]
 *
 * Source of truth is the changelog convention the repo already lives by:
 * entries are the `changelog/YYYY-MM-DD-<slug>.md` files ADDED between the two
 * refs (newest first). When a merge carries no new entry, the commit subjects
 * since the last tag are the fallback — they are written as prose anyway.
 * `README.md` is the format guide, not a release note.
 *
 * The core is pure (`buildNotes`) so the unit test exercises the markdown
 * shape; the CLI part only shells out to git. Exits 0 with an empty body when
 * there is nothing to say — the workflow then falls back to its own default.
 */
import { execFileSync } from 'node:child_process';

const CHANGELOG_DIR = 'changelog';
const SKIP_FILES = new Set(['README.md']);

export function buildNotes({ files, commits }) {
  const entries = [...files]
    .filter((f) => !SKIP_FILES.has(f.name))
    .sort((a, b) => b.name.localeCompare(a.name))
    .map(sectionFor)
    .filter(Boolean);

  if (entries.length > 0) return entries.join('\n\n');

  return (commits ?? []).map((subject) => `- ${subject}`).join('\n');
}

function sectionFor({ name, content }) {
  const lines = String(content).trim().split('\n');
  const titleLine = lines.find((l) => l.startsWith('# '));
  if (!titleLine) return null;

  const body = lines.filter((l) => l !== titleLine).join('\n').trim();
  return body ? `## ${titleLine.slice(2).trim()}\n\n${body}` : `## ${titleLine.slice(2).trim()}`;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function addedChangelogFiles(fromRef, toRef, cwd) {
  if (!fromRef) return allChangelogFiles(toRef, cwd);

  const paths = git(
    ['diff', '--name-only', '--diff-filter=A', `${fromRef}..${toRef}`, '--', `${CHANGELOG_DIR}/*.md`],
    cwd
  );
  return toFiles(paths);
}

// First release: no previous tag to diff against. The newest entries tell the story.
function allChangelogFiles(atRef, cwd) {
  const paths = git(['ls-tree', '--name-only', atRef, `${CHANGELOG_DIR}/`], cwd);
  return toFiles(paths).slice(0, 20);
}

function toFiles(paths) {
  return paths
    .split('\n')
    .filter(Boolean)
    .filter((p) => !SKIP_FILES.has(p.split('/').pop()))
    .map((path) => ({ name: path.split('/').pop(), path }));
}

function readFiles(files, cwd, atRef) {
  return files.map((f) => ({ name: f.name, content: git(['show', `${atRef}:${f.path}`], cwd) }));
}

function commitSubjects(from, to, cwd) {
  const range = from ? `${from}..${to}` : to;
  const out = git(['log', '--format=%s', range], cwd);
  return out ? out.split('\n').filter(Boolean) : [];
}

// -- CLI ---------------------------------------------------------------------

const to = process.argv[3] ?? 'HEAD';
const from = process.argv[2] || null;
const cwd = process.cwd();

let fromRef = from;
if (!fromRef) {
  const tags = git(['tag', '-l', 'v*'], cwd).split('\n').filter(Boolean);
  fromRef = tags.length ? tags[tags.length - 1] : null;
}

const files = readFiles(addedChangelogFiles(fromRef, to, cwd), cwd, to);
const commits = files.length ? [] : commitSubjects(fromRef, to, cwd);

const notes = buildNotes({ files, commits });
if (notes) console.log(notes);
