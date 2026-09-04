import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MARKETING_PATHS, RETIRED_PAGES, retiredPageTarget } from './seo';
import { SUPPORTED } from './i18n/locale';

/**
 * A retired page is a URL Google already knows. Deleting the route turns it into a 404 and the
 * whole domain pays for it, so every removal lands here with the page that took its job. These
 * tests hold the two ways that promise breaks: a redirect that points at another dead page, and
 * a route file that is deleted without a row.
 */
describe('retired pages', () => {
  it('redirects to a destination that still exists', () => {
    const live = new Set<string>(MARKETING_PATHS);
    for (const [from, to] of Object.entries(RETIRED_PAGES)) {
      expect(live.has(to), `${from} redirects to ${to}, which is not a live marketing page`).toBe(
        true
      );
    }
  });

  it('never redirects to a page that is itself retired', () => {
    for (const [from, to] of Object.entries(RETIRED_PAGES)) {
      expect(RETIRED_PAGES[to], `${from} → ${to} → ${RETIRED_PAGES[to]} is a redirect chain`).toBe(
        undefined
      );
    }
  });

  it('no retired path is still listed in the sitemap', () => {
    const still = Object.keys(RETIRED_PAGES).filter((p) =>
      (MARKETING_PATHS as readonly string[]).includes(p)
    );
    expect(still, 'a retired page must leave MARKETING_PATHS in the same commit').toEqual([]);
  });

  it('keeps the visitor in the locale they arrived in', () => {
    const [from, to] = Object.entries(RETIRED_PAGES)[0];
    expect(retiredPageTarget(from, 'en')).toBe(to);
    expect(retiredPageTarget(`/it${from}`, 'it')).toBe(`/it${to}`);
    expect(retiredPageTarget(`/fr${from}`, 'fr')).toBe(`/fr${to}`);
  });

  it('sends the row-backed children where their root went', () => {
    expect(retiredPageTarget('/design/some-post-slug', 'en')).toBe('/autoposts');
    expect(retiredPageTarget('/it/playbooks/pizzeria', 'it')).toBe('/it/usecases');
    expect(retiredPageTarget('/styles/collage', 'en')).toBe('/autoposts');
    expect(retiredPageTarget('/es/talents/aisha', 'es')).toBe('/es/usecases');
  });

  it('leaves a live page alone, in every locale', () => {
    for (const lang of SUPPORTED) {
      const path = lang === 'en' ? '/pricing' : `/${lang}/pricing`;
      expect(retiredPageTarget(path, lang)).toBe(null);
    }
    expect(retiredPageTarget('/', 'en')).toBe(null);
  });

  it('every retired page really lost its route file', () => {
    for (const from of Object.keys(RETIRED_PAGES)) {
      let exists = true;
      try {
        readFileSync(`src/routes/[[lang=locale]]${from}/+page.svelte`);
      } catch {
        exists = false;
      }
      expect(exists, `${from} still has a route file — it is not retired, remove the row`).toBe(
        false
      );
    }
  });
});
