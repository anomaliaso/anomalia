import { describe, expect, it } from 'bun:test';
import { parseKeyValuePairs, resolveByPrefix } from './select.ts';

const items = [
  { id: '3f2a91b0-1111-4aaa-8bbb-000000000001' },
  { id: '3f2a91b0-2222-4aaa-8bbb-000000000002' },
  { id: 'a91c3f20-3333-4aaa-8bbb-000000000003' }
];

describe('resolveByPrefix', () => {
  it('resolves a unique prefix', () => {
    const r = resolveByPrefix(items, 'a91c3f20');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.id).toBe(items[2].id);
  });

  // The important one: two posts sharing a prefix must NOT silently pick the first — that would
  // publish or delete the wrong thing.
  it('refuses an ambiguous prefix instead of guessing', () => {
    const r = resolveByPrefix(items, '3f2a91b0');
    expect(r).toEqual({ ok: false, reason: 'ambiguous', count: 2 });
  });

  it('reports no match, and treats an empty prefix as no match', () => {
    expect(resolveByPrefix(items, 'deadbeef')).toEqual({ ok: false, reason: 'none', count: 0 });
    expect(resolveByPrefix(items, '  ')).toEqual({ ok: false, reason: 'none', count: 0 });
  });

  it('prefers an exact id over a longer id it happens to prefix', () => {
    const both = [{ id: 'ab' }, { id: 'abcdef' }];
    const r = resolveByPrefix(both, 'ab');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.item.id).toBe('ab');
  });
});

describe('parseKeyValuePairs', () => {
  it('splits on the FIRST = so values may contain =', () => {
    expect(parseKeyValuePairs(['x=a=b', 'threads=hello'])).toEqual({ x: 'a=b', threads: 'hello' });
  });

  it('lowercases keys and trims', () => {
    expect(parseKeyValuePairs([' X = testo '])).toEqual({ x: 'testo' });
  });

  it('drops empty values (used to clear a platform override)', () => {
    expect(parseKeyValuePairs(['x='])).toEqual({});
  });

  it('returns null on a malformed pair rather than dropping input silently', () => {
    expect(parseKeyValuePairs(['nope'])).toBeNull();
    expect(parseKeyValuePairs(['=orphan'])).toBeNull();
  });
});
