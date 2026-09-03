import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const CANONICAL = join(ROOT, '..', 'packages', 'api-contracts', 'src');
const MIRROR = join(ROOT, 'lib', 'contracts');

const sources = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();

describe('mirror dei contratti', () => {
  test('cli/lib/contracts è identico a packages/api-contracts/src', () => {
    expect(existsSync(join(CANONICAL, 'index.ts'))).toBe(true);
    expect(existsSync(join(MIRROR, 'index.ts'))).toBe(true);

    const expected = sources(CANONICAL);
    expect(sources(MIRROR)).toEqual(expected);

    for (const name of expected) {
      expect(readFileSync(join(MIRROR, name), 'utf8'), `${name} è andato in deriva — bun run sync:contracts`).toBe(
        readFileSync(join(CANONICAL, name), 'utf8'),
      );
    }
  });
});
