import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_LOCALE, SUPPORTED } from './locale';

/**
 * English is the fallback locale (see `index.ts`), so a key that exists in `en.json` and is
 * missing from `es.json` renders in ENGLISH inside a Spanish page — silently, no error, no
 * warning. That is how 503 keys drifted out of `es.json` and `fr.json` before anyone noticed.
 *
 * The other direction is worse: a key that exists ONLY in `it.json` has no fallback at all, so
 * every non-Italian visitor sees the raw dotted key printed on the page.
 *
 * This test makes both impossible to ship. It compares the FLATTENED key sets — comparing only
 * the top level would have passed happily through the whole drift, since `app`, `chat` and
 * `landing` were present in all four files the entire time.
 */

// The three catalogues each locale ships: the main one plus the `docs` and `tools` sub-catalogues
// that `index.ts` merges in at register time.
const CATALOGUES = ['', 'docs/', 'tools/'] as const;

const load = (dir: string, lang: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`src/lib/i18n/locales/${dir}${lang}.json`, 'utf8'));

/** Every leaf path, dotted. Arrays count as leaves — svelte-i18n hands them back whole. */
function flatten(node: unknown, prefix = '', out: string[] = []): string[] {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) {
    out.push(prefix);
  }
  return out;
}

/**
 * Keys that exist in some locales but not in English, left in place on purpose: nothing in `src/`
 * reads them, they are leftovers from renames, and deleting them belongs to whoever owns that
 * feature. Delete the key from the catalogue and the line from here in the same commit.
 */
const KNOWN_ORPHANS = new Set([
  'weekPlan.planDocEdit', // it.json only — unused
  'app.motionVideo.emptyHint' // es.json + fr.json only — unused
]);

const list = (keys: string[]) => keys.map((k) => `  ${k}`).join('\n');

describe('every locale carries the same keys as English', () => {
  for (const dir of CATALOGUES) {
    const name = dir ? dir.replace('/', '') : 'main';
    const english = new Set(flatten(load(dir, DEFAULT_LOCALE)));

    for (const lang of SUPPORTED.filter((l) => l !== DEFAULT_LOCALE)) {
      it(`${name}/${lang}.json — nothing falls back to English`, () => {
        const own = new Set(flatten(load(dir, lang)));
        const missing = [...english].filter((k) => !own.has(k));
        expect(
          missing,
          `${missing.length} key(s) in ${name}/en.json are missing from ${name}/${lang}.json — a ${lang} visitor sees these in English:\n${list(missing)}`
        ).toEqual([]);
      });

      it(`${name}/${lang}.json — no key English does not have`, () => {
        const own = flatten(load(dir, lang));
        const extra = own.filter((k) => !english.has(k) && !KNOWN_ORPHANS.has(k));
        expect(
          extra,
          `${extra.length} key(s) exist in ${name}/${lang}.json but not in ${name}/en.json — either English is missing them (every other locale then prints the raw key) or they are dead after a rename:\n${list(extra)}`
        ).toEqual([]);
      });
    }
  }
});
