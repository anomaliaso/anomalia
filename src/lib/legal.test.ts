import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import en from '$lib/i18n/locales/en.json';
import itIT from '$lib/i18n/locales/it.json';
import es from '$lib/i18n/locales/es.json';
import fr from '$lib/i18n/locales/fr.json';

// The legal pages hold ~200 i18n keys that are numbered by section. Inserting the AI Act sections
// renumbered most of them, and a missed rename shows up in production as a raw key printed inside
// a contract. These tests are the safety net for the next renumbering.

const BUNDLES: Record<string, unknown> = { en, it: itIT, es, fr };
const PAGES = [
  'src/routes/[[lang=locale]]/privacy/+page.svelte',
  'src/routes/[[lang=locale]]/terms/+page.svelte',
  'src/routes/[[lang=locale]]/cookies/+page.svelte',
  'src/lib/components/LegalLayout.svelte',
  'src/lib/components/LegalFooter.svelte'
];

function lookup(bundle: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, bundle);
}

/** Every `$_('legal.…')` the legal pages actually render. */
function keysUsedByPages(): string[] {
  const found = new Set<string>();
  for (const page of PAGES) {
    const src = readFileSync(page, 'utf8');
    for (const m of src.matchAll(/\$_\('(legal\.[^']+)'/g)) found.add(m[1]);
  }
  return [...found].sort();
}

describe('legal pages i18n', () => {
  const keys = keysUsedByPages();

  it('renders a substantial, numbered set of keys', () => {
    expect(keys.length).toBeGreaterThan(100);
  });

  for (const locale of Object.keys(BUNDLES)) {
    it(`resolves every key in ${locale}`, () => {
      const missing = keys.filter((k) => typeof lookup(BUNDLES[locale], k) !== 'string');
      expect(missing).toEqual([]);
    });
  }

  for (const doc of ['privacy', 'terms'] as const) {
    it(`numbers ${doc} headings 1..N with no gap or repeat, in every locale`, () => {
      for (const [locale, bundle] of Object.entries(BUNDLES)) {
        const sections = lookup(bundle, `legal.${doc}`) as Record<string, { heading?: string }>;
        const numbers = Object.entries(sections)
          .filter(([k]) => /^s\d+$/.test(k))
          .map(([k, v]) => {
            const declared = Number(k.slice(1));
            const printed = Number(/^\s*(\d+)\./.exec(v.heading ?? '')?.[1]);
            return { locale, key: k, declared, printed };
          });
        // The key number and the number the reader sees must agree.
        expect(numbers.filter((n) => n.declared !== n.printed)).toEqual([]);
        const declared = numbers.map((n) => n.declared).sort((a, b) => a - b);
        expect(declared).toEqual(Array.from({ length: declared.length }, (_, i) => i + 1));
      }
    });
  }

  it('keeps the four locales structurally identical', () => {
    // Sections only — the sibling strings (title, intro, …) would compare character indices.
    const shape = (bundle: unknown, doc: string) =>
      Object.entries(lookup(bundle, `legal.${doc}`) as Record<string, Record<string, unknown>>)
        .filter(([k, v]) => /^s\d+$/.test(k) && v && typeof v === 'object')
        .map(([k, v]) => `${k}:${Object.keys(v).sort().join(',')}`)
        .sort()
        .join('|');
    for (const doc of ['privacy', 'terms']) {
      for (const locale of ['it', 'es', 'fr']) {
        expect(shape(BUNDLES[locale], doc), `${locale} ${doc}`).toBe(shape(en, doc));
      }
    }
  });

  it('states the AI Act blacklist and the Art. 50 labelling duty in every locale', () => {
    for (const [locale, bundle] of Object.entries(BUNDLES)) {
      const terms = lookup(bundle, 'legal.terms') as Record<string, Record<string, string>>;
      const blacklist = Object.values(terms).find((s) => /2024\/1689|AI Act/.test(s.p1 ?? ''));
      expect(blacklist, `${locale}: no AI Act roles section`).toBeTruthy();
      // All eight Art. 5 practices, spelled out.
      const art5 = Object.values(terms).find((s) => typeof s.item8 === 'string' && /5/.test(s.heading ?? ''));
      expect(art5, `${locale}: no Art. 5 list`).toBeTruthy();
      const art50 = Object.values(terms).find((s) => /50/.test(s.heading ?? ''));
      expect(art50, `${locale}: no Art. 50 section`).toBeTruthy();

      const privacy = lookup(bundle, 'legal.privacy.s5') as Record<string, string>;
      expect(privacy.p2, `${locale}: no Art. 22 GDPR statement`).toMatch(/22/);
    }
  });
});
