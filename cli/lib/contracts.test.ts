import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { pathFor, type ResourceEndpoint } from './contracts/index.ts';

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

  test('un endpoint di risorsa non compila senza il suo id', () => {
    const onAPost = {
      tool: 'fixture_post_read',
      title: 'Fixture',
      description: 'Fixture',
      method: 'GET',
      pathUnderBrand: '/posts/:id/media',
      resource: 'post',
      input: z.object({}).strict(),
      output: z.object({ status: z.string() }),
      failures: [],
      destructive: false,
    } satisfies ResourceEndpoint;

    expect(pathFor(onAPost, 'demo', 'abc')).toBe('/api/v1/brands/demo/posts/abc/media');
    // @ts-expect-error il tipo rifiuta la chiamata senza id; il throw copre chi arriva da JS
    expect(() => pathFor(onAPost, 'demo')).toThrow(/post/);
  });
});
