import { describe, expect, it, vi } from 'vitest';
import { createDirectoryCache } from './composio-catalog-cache';

describe('createDirectoryCache', () => {
  it('loads once and serves the cached list within the TTL', async () => {
    const loader = vi.fn(async () => ['a']);
    const cache = createDirectoryCache<string>({ ttlMs: 1000, now: () => 0 });
    expect(await cache.get(loader)).toEqual(['a']);
    expect(await cache.get(loader)).toEqual(['a']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent loads', async () => {
    let resolve!: (v: string[]) => void;
    const loader = vi.fn(() => new Promise<string[]>((r) => (resolve = r)));
    const cache = createDirectoryCache<string>();
    const both = Promise.all([cache.get(loader), cache.get(loader)]);
    resolve(['a']);
    expect(await both).toEqual([['a'], ['a']]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('serves a stale list while it refreshes in the background', async () => {
    let clock = 0;
    const loader = vi.fn(async () => [`v${clock}`]);
    const cache = createDirectoryCache<string>({ ttlMs: 100, now: () => clock });
    expect(await cache.get(loader)).toEqual(['v0']);
    clock = 500;
    // Stale: the caller is answered immediately with the old list, not made to wait.
    expect(await cache.get(loader)).toEqual(['v0']);
    await new Promise((r) => setTimeout(r, 0));
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.peek()).toEqual(['v500']);
  });

  it('reloads after invalidate', async () => {
    const loader = vi.fn(async () => ['a']);
    const cache = createDirectoryCache<string>({ now: () => 0 });
    await cache.get(loader);
    cache.invalidate();
    expect(cache.peek()).toBeUndefined();
    await cache.get(loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
