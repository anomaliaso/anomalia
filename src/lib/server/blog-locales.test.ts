import { describe, it, expect } from 'vitest';
import { resolveBlogLocales } from './blog-locales';
import { localeFromLanguageName, isBlogLocale } from '$lib/blog-locales';

// resolveBlogLocales decides which language versions of a blog are SERVED. Getting it wrong either
// hides a brand's articles or serves language versions the plan doesn't include, so the fallbacks and
// the plan clamp both matter more than the happy path.
describe('resolveBlogLocales', () => {
  it('falls back to the brand content language when the blog was never configured', () => {
    // An Italian brand's blog must default to /it, not to /en.
    expect(resolveBlogLocales(null, 'pro', 'Italian').defaultLocale).toBe('it');
    expect(resolveBlogLocales({}, 'pro', 'Spanish').defaultLocale).toBe('es');
  });

  it('falls back to en when there is no config and no content language', () => {
    expect(resolveBlogLocales(null, 'pro', null).defaultLocale).toBe('en');
    expect(resolveBlogLocales({}, 'starter', 'Klingon').defaultLocale).toBe('en');
  });

  it('prefers an explicitly configured default over the content language', () => {
    expect(resolveBlogLocales({ defaultLocale: 'fr' }, 'pro', 'Italian').defaultLocale).toBe('fr');
  });

  it('ignores a junk stored default instead of serving an invalid locale', () => {
    expect(resolveBlogLocales({ defaultLocale: 'zz' }, 'pro', 'Italian').defaultLocale).toBe('it');
    expect(resolveBlogLocales({ defaultLocale: 42 }, 'pro', null).defaultLocale).toBe('en');
  });

  it('clamps extra locales to the plan allowance', () => {
    const cfg = { defaultLocale: 'it', locales: ['en', 'es', 'fr', 'de', 'pt'] };
    expect(resolveBlogLocales(cfg, 'pro').extraLocales).toEqual(['en', 'es', 'fr']); // max 3
  });

  it('serves NO extra locales below the top tier, even with a stored list', () => {
    // A downgrade must stop serving the extras without destroying the setting — so the clamp is on
    // read, and an upgrade restores exactly what the user picked.
    const cfg = { defaultLocale: 'it', locales: ['en', 'es', 'fr'] };
    const starter = resolveBlogLocales(cfg, 'starter');
    expect(starter.extraLocales).toEqual([]);
    expect(starter.maxExtra).toBe(0);
    expect(resolveBlogLocales(cfg, 'pro').extraLocales).toHaveLength(3);
  });

  it('never lists the default locale among the extras', () => {
    const r = resolveBlogLocales({ defaultLocale: 'it', locales: ['it', 'en'] }, 'pro');
    expect(r.extraLocales).toEqual(['en']);
    expect(r.allLocales).toEqual(['it', 'en']);
  });

  it('de-duplicates and drops invalid codes from the stored list', () => {
    const r = resolveBlogLocales({ defaultLocale: 'en', locales: ['it', 'it', 'xx', '', 'ES'] }, 'pro');
    expect(r.extraLocales).toEqual(['it', 'es']); // case-insensitive, deduped, junk dropped
  });

  it('always puts the default first in allLocales — hreflang and the switcher iterate it', () => {
    const r = resolveBlogLocales({ defaultLocale: 'de', locales: ['en'] }, 'pro');
    expect(r.allLocales[0]).toBe('de');
  });
});

describe('localeFromLanguageName', () => {
  it('maps the English language names stored in brand_articles.language', () => {
    expect(localeFromLanguageName('Italian')).toBe('it');
    expect(localeFromLanguageName('  portuguese ')).toBe('pt');
  });

  it('also accepts a bare locale code, since legacy rows stored either form', () => {
    expect(localeFromLanguageName('it')).toBe('it');
  });

  it('returns null for unknown or empty input rather than guessing', () => {
    expect(localeFromLanguageName('Elvish')).toBeNull();
    expect(localeFromLanguageName(null)).toBeNull();
    expect(localeFromLanguageName('')).toBeNull();
  });
});

describe('isBlogLocale', () => {
  it('accepts known locales and rejects path segments that must not be read as languages', () => {
    expect(isBlogLocale('it')).toBe(true);
    // The matcher relies on this: these are real blog paths, not languages.
    for (const seg of ['category', 'tag', 'search', 'author', 'privacy', 'zz', '']) {
      expect(isBlogLocale(seg)).toBe(false);
    }
  });
});
