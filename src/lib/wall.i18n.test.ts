import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DESIGN_TAGS, DESIGN_AXES } from './wall';
import { SUPPORTED } from './i18n/locale';

/**
 * The tag list is a FIXED vocabulary rendered through `$_('wall.tags.<id>')`. A tag added in code
 * without its four strings renders the raw key as a filter chip — visible on a public page, in a
 * language the visitor did not ask for. This is the test that makes that impossible to ship.
 */
const catalogue = (lang: string) =>
  JSON.parse(readFileSync(`src/lib/i18n/locales/${lang}.json`, 'utf8')) as Record<string, never>;

describe('the wall strings cover every locale', () => {
  for (const lang of SUPPORTED) {
    it(`${lang} — every design tag has a label`, () => {
      const wall = catalogue(lang).wall as unknown as Record<string, Record<string, string>>;
      expect(wall, `wall block missing in ${lang}.json`).toBeTruthy();
      for (const tag of DESIGN_TAGS) expect(wall.tags?.[tag], `${lang}: wall.tags.${tag}`).toBeTruthy();
    });

    it(`${lang} — every grade axis has a label`, () => {
      const wall = catalogue(lang).wall as unknown as Record<string, Record<string, string>>;
      for (const axis of DESIGN_AXES) expect(wall.axes?.[axis], `${lang}: wall.axes.${axis}`).toBeTruthy();
    });

    it(`${lang} — both pages have their title and description`, () => {
      const meta = catalogue(lang).meta as unknown as Record<string, Record<string, string>>;
      for (const key of ['wallTrending', 'wallDesign']) {
        expect(meta[key]?.title, `${lang}: meta.${key}.title`).toBeTruthy();
        expect(meta[key]?.description, `${lang}: meta.${key}.description`).toBeTruthy();
      }
    });

    it(`${lang} — the copy that carries a placeholder still carries it`, () => {
      const wall = catalogue(lang).wall as unknown as Record<string, Record<string, string>>;
      expect(wall.trending?.metric).toContain('{value}');
      expect(wall.card?.score).toContain('{score}');
      expect(wall.removal).toContain('{email}');
      expect(wall.detail?.credit).toContain('{account}');
    });
  }
});
