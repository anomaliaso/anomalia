import { describe, it, expect } from 'vitest';
import { getBrandDeferred, getBrandShell, setBrandDeferred, setBrandShell, invalidateBrandShell, invalidateBrandNav } from './nav-cache';

describe('brand shell cache', () => {
  it('returns what was stored for the same user+slug', () => {
    const brand = { id: 'b1', slug: 'acme', name: 'Acme' };
    setBrandShell('user-1', 'acme', { brand, brandRows: [brand] });
    const hit = getBrandShell('user-1', 'acme');
    expect(hit?.brand).toEqual(brand);
    expect(hit?.brandRows).toHaveLength(1);
  });

  it('does not leak across users', () => {
    setBrandShell('user-1', 'acme', { brand: { slug: 'acme' }, brandRows: null });
    expect(getBrandShell('user-2', 'acme')).toBeNull();
  });

  it('invalidateBrandShell drops one slug or all of a user', () => {
    setBrandShell('user-1', 'acme', { brand: { slug: 'acme' }, brandRows: null });
    setBrandShell('user-1', 'other', { brand: { slug: 'other' }, brandRows: null });
    setBrandDeferred('user-1', 'acme', { pendingCount: 3 });
    invalidateBrandShell('user-1', 'acme');
    expect(getBrandShell('user-1', 'acme')).toBeNull();
    expect(getBrandDeferred('user-1', 'acme')).toBeNull();
    expect(getBrandShell('user-1', 'other')).not.toBeNull();
    invalidateBrandShell('user-1');
    expect(getBrandShell('user-1', 'other')).toBeNull();
  });

  it('invalidateBrandNav drops every user copy of a slug', () => {
    setBrandShell('user-1', 'acme', { brand: { slug: 'acme' }, brandRows: null });
    setBrandShell('user-2', 'acme', { brand: { slug: 'acme' }, brandRows: null });
    setBrandDeferred('user-1', 'acme', { pendingCount: 1 });
    setBrandShell('user-1', 'acme-corp', { brand: { slug: 'acme-corp' }, brandRows: null });
    invalidateBrandNav('me');
    expect(getBrandShell('user-1', 'acme')).not.toBeNull();
    invalidateBrandNav('acme');
    expect(getBrandShell('user-1', 'acme')).toBeNull();
    expect(getBrandShell('user-2', 'acme')).toBeNull();
    expect(getBrandDeferred('user-1', 'acme')).toBeNull();
    expect(getBrandShell('user-1', 'acme-corp')).not.toBeNull();
  });

  it('returns cached deferred extras for the same user+slug', () => {
    setBrandDeferred('user-1', 'acme', { pendingCount: 4, studioPct: 80 });
    expect(getBrandDeferred('user-1', 'acme')).toEqual({ pendingCount: 4, studioPct: 80 });
    expect(getBrandDeferred('user-2', 'acme')).toBeNull();
  });
});
