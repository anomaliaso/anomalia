import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND_MEDIA_SOURCES, type BrandMediaSource } from './brand-media';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const SRC = join(ROOT, 'src');

const CONSTRAINT = 'add constraint brand_media_source_check';

function sourcesTheDatabaseAllows(): string[] {
  let allowed: string[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const at = sql.lastIndexOf(CONSTRAINT);
    if (at < 0) continue;
    const statement = sql.slice(at, sql.indexOf(';', at));
    allowed = [...statement.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  return allowed;
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsFiles(full));
      continue;
    }
    if (/\.(ts|svelte)$/.test(entry.name) && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

function objectLiteralAfter(text: string, from: number): string | null {
  const open = text.indexOf('{', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  return null;
}

const WRITE_SITES = [
  /insertBrandMedia\s*\(/g,
  /from\(\s*['"]brand_media['"]\s*\)[\s\S]{0,160}?\.insert\s*\(/g
];

function sourcesTheCodeWrites(): Array<{ where: string; value: string }> {
  const written: Array<{ where: string; value: string }> = [];
  for (const file of tsFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of WRITE_SITES) {
      for (const call of text.matchAll(pattern)) {
        const block = objectLiteralAfter(text, call.index + call[0].length);
        if (!block) continue;
        for (const field of block.matchAll(/\bsource:\s*'([^']*)'/g)) {
          const line = text.slice(0, call.index).split('\n').length;
          written.push({ where: `${relative(ROOT, file)}:${line}`, value: field[1] });
        }
      }
    }
  }
  return written;
}

describe('brand_media.source', () => {
  it('lists exactly the values the CHECK constraint admits', () => {
    expect([...BRAND_MEDIA_SOURCES]).toEqual(sourcesTheDatabaseAllows());
  });

  it('is written by the code only with values the database accepts', () => {
    const written = sourcesTheCodeWrites();

    expect(written.length).toBeGreaterThan(3);
    expect(written.filter((w) => !BRAND_MEDIA_SOURCES.includes(w.value as never))).toEqual([]);
  });

  it('does not typecheck a value the constraint would reject', () => {
    // @ts-expect-error 'ai' is what saveRenderedVideoToLibrary wrote, and 23514 is what it got.
    const rejected: BrandMediaSource = 'ai';

    expect(BRAND_MEDIA_SOURCES).not.toContain(rejected);
  });
});
