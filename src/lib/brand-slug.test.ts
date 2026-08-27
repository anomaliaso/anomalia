import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug, slugWithRandomTail, slugifyBrand } from './brand-slug';

describe('slugify', () => {
  it('kebab-cases and trims punctuation', () => {
    expect(slugify('Latina Coffee Co.')).toBe('latina-coffee-co');
  });
  it('strips accents', () => {
    expect(slugify('Héllo Wörld!!')).toBe('hello-world');
  });
  it('falls back to "brand" when empty', () => {
    expect(slugify('  ---  ')).toBe('brand');
    expect(slugify('')).toBe('brand');
  });
  it('strips a non-Latin name to the shared fallback', () => {
    expect(slugify('يونس بن عمارة')).toBe('brand');
  });
});

describe('slugifyBrand', () => {
  it('keeps a Latin name', () => {
    expect(slugifyBrand('YouDo', 'https://youdo.blog')).toBe('youdo');
  });
  it('uses the site host when the name is not Latin — that is the youdo.blog onboarding abort', () => {
    expect(slugifyBrand('يونس بن عمارة', 'https://youdo.blog')).toBe('youdo');
    expect(slugifyBrand('يونس بن عمارة', 'youdo.blog')).toBe('youdo');
  });
  it('stays on "brand" when there is no usable host', () => {
    expect(slugifyBrand('يونس بن عمارة', null)).toBe('brand');
    expect(slugifyBrand('', '')).toBe('brand');
  });
});

describe('uniqueSlug', () => {
  it('returns the base when free', () => {
    expect(uniqueSlug('latina', [])).toBe('latina');
  });
  it('appends -2 on collision', () => {
    expect(uniqueSlug('latina', ['latina'])).toBe('latina-2');
  });
  it('skips taken numbers', () => {
    expect(uniqueSlug('latina', ['latina', 'latina-2'])).toBe('latina-3');
  });
});

describe('slugWithRandomTail', () => {
  it('appends a random alphanumeric tail', () => {
    expect(slugWithRandomTail('brand')).toMatch(/^brand-[a-z0-9]{4}$/);
  });
  it('differs across calls', () => {
    const tails = new Set(Array.from({ length: 50 }, () => slugWithRandomTail('brand')));
    expect(tails.size).toBeGreaterThan(1);
  });
});
