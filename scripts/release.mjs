#!/usr/bin/env node
/**
 * Bump the human version.
 *
 *   npm run release -- patch    0.2.0 → 0.2.1   fix, nessun cambiamento di comportamento atteso
 *   npm run release -- minor    0.2.0 → 0.3.0   funzionalità nuova, retrocompatibile
 *   npm run release -- major    0.2.0 → 1.0.0   rottura o cambio di prodotto
 *
 * What it does: rewrites the version in `package.json`. That's all — the notes
 * live in their own files (changelog/YYYY-MM-DD-<slug>.md, e quello pubblico in
 * src/lib/content/changelog/), che una release non ha motivo di toccare in massa.
 *
 * What it deliberately does NOT do: commit, tag, or push. Those are decisions with consequences
 * outside this repo, and a release script that performs them by surprise is how a half-finished
 * version ends up tagged. It prints the commands instead.
 *
 * The build half of the release tag (the commit SHA) is automatic and is NOT touched here —
 * see src/lib/release.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(root, 'package.json');

const KINDS = new Set(['major', 'minor', 'patch']);
const kind = (process.argv[2] ?? '').trim();

if (!KINDS.has(kind)) {
  console.error(`Uso: npm run release -- <${[...KINDS].join('|')}>`);
  process.exit(1);
}

// Kept in sync with bumpVersion() in src/lib/release.ts, which is the unit-tested definition.
// Duplicated rather than imported because this script runs on plain node, without the TS pipeline.
function bump(version, how) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  const [major, minor, patch] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  if (how === 'major') return `${major + 1}.0.0`;
  if (how === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const raw = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);
const current = pkg.version;
const next = bump(current, kind);

// Preserve the file's existing indentation and trailing newline rather than reformatting it.
const indentMatch = /^\{\n(\s+)"/.exec(raw);
const indent = indentMatch ? indentMatch[1].length : 2;
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`);

const today = new Date().toISOString().slice(0, 10);

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`);

console.log(`${current} → ${next}`);
console.log(`  package.json  aggiornato`);
console.log('');
console.log('Le note di release sono un file a entry, uno per cambiamento:');
console.log(`  changelog/${today}-<slug>.md                    (interno: perché, prima/dopo, decisioni)`);
console.log(`  src/lib/content/changelog/${today}-<slug>.ts    (pubblico, inglese, se visibile agli utenti)`);
console.log('');
console.log('Scrivi le note, poi:');
console.log(`  git commit -am "release v${next}"`);
console.log('');
console.log('Il merge su main fa il resto: il workflow Release confronta la versione');
console.log(`con i tag v*, crea v${next} se manca e pubblica la GitHub Release con`);
console.log('le note dai changelog. In locale la stessa fonte:');
console.log('  node scripts/release-notes.mjs <ultimo-tag> HEAD');
