import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  cachedPage,
  cachedBrandPage,
  invalidateBrandPages,
  invalidatePage,
  resetPageCache,
  pageCacheSize
} from './page-cache';

const KEY = { userId: 'u1', slug: 'acme', routeId: '/app/[brand]' };

beforeEach(() => {
  resetPageCache();
  vi.useRealTimers();
});

describe('cachedPage', () => {
  it('runs the loader once and serves the same payload again', async () => {
    const load = vi.fn(async () => ({ n: 1 }));
    expect(await cachedPage(KEY, load)).toEqual({ n: 1 });
    expect(await cachedPage(KEY, load)).toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent loads of the same page into one', async () => {
    const load = vi.fn(async () => ({ n: 1 }));
    await Promise.all([cachedPage(KEY, load), cachedPage(KEY, load), cachedPage(KEY, load)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never serves one user the payload built for another', async () => {
    await cachedPage(KEY, async () => 'mine');
    const other = await cachedPage({ ...KEY, userId: 'u2' }, async () => 'theirs');
    expect(other).toBe('theirs');
  });

  it('keys brand and route apart', async () => {
    await cachedPage(KEY, async () => 'overview');
    expect(await cachedPage({ ...KEY, slug: 'other' }, async () => 'other-brand')).toBe('other-brand');
    expect(await cachedPage({ ...KEY, routeId: '/app/[brand]/geo' }, async () => 'geo')).toBe('geo');
  });

  it('treats a different variant as a different page', async () => {
    await cachedPage({ ...KEY, variant: 'week=0' }, async () => 'w0');
    expect(await cachedPage({ ...KEY, variant: 'week=1' }, async () => 'w1')).toBe('w1');
    expect(await cachedPage({ ...KEY, variant: 'week=0' }, async () => 'nope')).toBe('w0');
  });

  it('expires after the TTL', async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 'v');
    await cachedPage(KEY, load);
    vi.advanceTimersByTime(44_000);
    await cachedPage(KEY, load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await cachedPage(KEY, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed load', async () => {
    const boom = vi.fn(async () => {
      throw new Error('nope');
    });
    await expect(cachedPage(KEY, boom)).rejects.toThrow('nope');
    // The rejection is evicted, so the retry actually re-runs rather than replaying the error.
    await expect(cachedPage(KEY, async () => 'ok')).resolves.toBe('ok');
    expect(boom).toHaveBeenCalledTimes(1);
  });
});

describe('invalidation', () => {
  it('invalidateBrandPages drops every user and route of one brand only', async () => {
    await cachedPage(KEY, async () => 'a');
    await cachedPage({ ...KEY, userId: 'u2' }, async () => 'b');
    await cachedPage({ ...KEY, routeId: '/app/[brand]/geo' }, async () => 'c');
    await cachedPage({ ...KEY, slug: 'keep' }, async () => 'd');

    invalidateBrandPages('acme');

    expect(await cachedPage({ ...KEY, slug: 'keep' }, async () => 'rebuilt')).toBe('d');
    expect(await cachedPage(KEY, async () => 'rebuilt')).toBe('rebuilt');
  });

  it('a slug that only appears in a variant is not mistaken for the brand', async () => {
    await cachedPage({ ...KEY, slug: 'keep', variant: 'q=acme' }, async () => 'kept');
    invalidateBrandPages('acme');
    expect(await cachedPage({ ...KEY, slug: 'keep', variant: 'q=acme' }, async () => 'rebuilt')).toBe('kept');
  });

  it('invalidatePage drops exactly one entry', async () => {
    await cachedPage(KEY, async () => 'a');
    await cachedPage({ ...KEY, routeId: '/app/[brand]/geo' }, async () => 'b');
    invalidatePage(KEY);
    expect(await cachedPage(KEY, async () => 'rebuilt')).toBe('rebuilt');
    expect(await cachedPage({ ...KEY, routeId: '/app/[brand]/geo' }, async () => 'rebuilt')).toBe('b');
  });
});

describe('eviction', () => {
  it('stays bounded when many pages are cached', async () => {
    for (let i = 0; i < 500; i++) {
      await cachedPage({ ...KEY, slug: `brand-${i}` }, async () => i);
    }
    expect(pageCacheSize()).toBeLessThanOrEqual(300);
  });
});

describe('cachedBrandPage', () => {
  const eventFor = (user: { id: string } | null) => ({
    route: { id: '/app/[brand]' },
    locals: { safeGetSession: async () => ({ user }) }
  });

  it('caches per signed-in user', async () => {
    const load = vi.fn(async () => 'payload');
    expect(await cachedBrandPage(eventFor({ id: 'u1' }), 'acme', load)).toBe('payload');
    await cachedBrandPage(eventFor({ id: 'u1' }), 'acme', load);
    expect(load).toHaveBeenCalledTimes(1);

    await cachedBrandPage(eventFor({ id: 'u2' }), 'acme', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache anything for an anonymous request', async () => {
    const load = vi.fn(async () => 'payload');
    await cachedBrandPage(eventFor(null), 'acme', load);
    await cachedBrandPage(eventFor(null), 'acme', load);
    expect(load).toHaveBeenCalledTimes(2);
    expect(pageCacheSize()).toBe(0);
  });
});
