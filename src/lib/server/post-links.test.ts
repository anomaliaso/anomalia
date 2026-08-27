import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { suggestBioUrl, validateBioUrl } from './post-links';

/** Chainable builder answering the post_links week query with the given rows. */
function linksClient(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const builder = {
    select: (cols: string) => {
      calls.push({ table: 'post_links', method: 'select', args: [cols] });
      return builder;
    },
    eq: (...args: unknown[]) => {
      calls.push({ table: 'post_links', method: 'eq', args });
      return builder;
    },
    gte: (...args: unknown[]) => {
      calls.push({ table: 'post_links', method: 'gte', args });
      return builder;
    },
    order: (...args: unknown[]) => {
      calls.push({ table: 'post_links', method: 'order', args });
      return builder;
    },
    limit: (...args: unknown[]) => {
      calls.push({ table: 'post_links', method: 'limit', args });
      return builder;
    },
    then: (resolve: (v: { data: typeof rows; error: null }) => void) => resolve({ data: rows, error: null })
  };
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, calls };
}

describe('suggestBioUrl', () => {
  it('returns the most clicked link of the week (redirect + landing summed)', async () => {
    const { client } = linksClient([
      { code: 'aaa111', target_url: 'https://x.com/post/1', clicks_redirect: 3, clicks_landing: 1 },
      { code: 'bbb222', target_url: 'https://x.com/post/2', clicks_redirect: 10, clicks_landing: 5 },
      { code: 'ccc333', target_url: 'https://x.com/post/3', clicks_redirect: 8, clicks_landing: 0 }
    ]);
    const suggestion = await suggestBioUrl(client, 'brand-1');
    expect(suggestion).toEqual({
      code: 'bbb222',
      url: expect.stringContaining('/l/bbb222'),
      clicks: 15,
      targetUrl: 'https://x.com/post/2'
    });
  });

  it('scopes to the brand and the last 7 days', async () => {
    const { client, calls } = linksClient([{ code: 'aaa111', target_url: 'u', clicks_redirect: 1, clicks_landing: 0 }]);
    const before = Date.now();
    await suggestBioUrl(client, 'brand-4');
    expect(calls).toContainEqual({ table: 'post_links', method: 'eq', args: ['brand_id', 'brand-4'] });
    const gte = calls.find((c) => c.method === 'gte');
    expect(gte?.args[0]).toBe('created_at');
    const since = Date.parse(String(gte?.args[1]));
    expect(since).toBeGreaterThanOrEqual(before - 7 * 24 * 60 * 60 * 1000 - 5000);
    expect(since).toBeLessThanOrEqual(before - 7 * 24 * 60 * 60 * 1000 + 5000);
  });

  it('returns null when the brand has no clicked links this week', async () => {
    const empty = linksClient([]);
    expect(await suggestBioUrl(empty.client, 'brand-1')).toBeNull();

    const zero = linksClient([{ code: 'aaa111', target_url: 'u', clicks_redirect: 0, clicks_landing: 0 }]);
    const suggestion = await suggestBioUrl(zero.client, 'brand-1');
    expect(suggestion).not.toBeNull();
    expect(suggestion?.clicks).toBe(0);
  });
});

describe('validateBioUrl', () => {
  it('accepts http(s) URLs with query strings', () => {
    expect(validateBioUrl('https://x.com/p?utm_source=ig&utm_medium=post')).toEqual({ ok: true, value: 'https://x.com/p?utm_source=ig&utm_medium=post' });
    expect(validateBioUrl('http://example.com')).toEqual({ ok: true, value: 'http://example.com' });
  });

  it('accepts an empty string as clear', () => {
    expect(validateBioUrl('')).toEqual({ ok: true, value: '' });
    expect(validateBioUrl('   ')).toEqual({ ok: true, value: '' });
  });

  it('rejects non-http(s), control chars, overlong and unparsable values', () => {
    expect(validateBioUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateBioUrl('data:text/html,x').ok).toBe(false);
    expect(validateBioUrl('https://x.com/\u0000').ok).toBe(false);
    expect(validateBioUrl('https://x.com/' + 'a'.repeat(600)).ok).toBe(false);
    expect(validateBioUrl('not a url').ok).toBe(false);
  });

  it('rejects missing input', () => {
    expect(validateBioUrl(null).ok).toBe(false);
  });
});
