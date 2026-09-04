import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from './platforms';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const routeDir = (section: string) =>
  fileURLToPath(new URL(`../../../routes/app/[brand]/settings/${section}`, import.meta.url));

/** Le quattro che erano rotte e adesso sono sezioni della stessa pagina. */
const MERGED = ['platforms', 'hashtags', 'voice-examples', 'timezone'];

/**
 * `get_brand_settings` / `set_brand_settings` restituiscono UN oggetto: fuso, piattaforme,
 * hashtag, esempi di voce. Finché il browser mostrava quattro pagine e l'MCP un oggetto, citare
 * il contratto era una coincidenza, non una fonte comune. Questi test tengono ferma la
 * corrispondenza — e soprattutto tengono fermo che nessun link punti a una rotta che non c'è
 * più, che è il modo in cui una cancellazione si trasforma in un 404 che nessuno vede.
 */
describe('le impostazioni del brand sono una pagina sola', () => {
  it('non lascia in piedi le quattro rotte che ha inglobato', () => {
    for (const section of MERGED) {
      expect(existsSync(routeDir(section)), `settings/${section} esiste ancora`).toBe(false);
    }
  });

  it('non le lascia nemmeno negli elenchi che disegnano la navigazione', () => {
    const listed = [
      ...SETTINGS_SECTIONS,
      ...SETTINGS_GROUPS.flatMap((g) => g.items.map((i) => i.section))
    ];
    for (const section of MERGED) {
      expect(listed, `${section} è ancora in nav`).not.toContain(section);
    }
  });

  it('mostra le quattro sezioni del contratto nella pagina che resta', () => {
    const page = read('../../../routes/app/[brand]/settings/brand/+page.svelte');

    expect(page).toContain("'brand', 'platforms', 'hashtags', 'voice-examples'");
    expect(page).toContain('<BrandTimezone');
  });

  /**
   * Un rimando o un avviso che punta a una rotta cancellata è un 404 che non fallisce nessun
   * test di import: il link è una stringa. Oggi ne sono stati trovati tre — due avvisi e tre
   * rimandi legacy da `/studio/*`.
   */
  it('non lascia link a rotte cancellate negli avvisi e nei rimandi legacy', () => {
    const sources = [
      read('../../warnings.ts'),
      ...['hashtags', 'platforms', 'voice-examples'].map((s) =>
        read(`../../../routes/app/[brand]/studio/${s}/+page.server.ts`)
      )
    ];

    for (const source of sources) {
      for (const section of MERGED) {
        expect(source, `punta ancora a settings/${section}`).not.toContain(`/settings/${section}`);
      }
    }
  });

  it('manda ogni rimando legacy all’ancora della sua sezione, non in cima alla pagina', () => {
    for (const section of ['hashtags', 'platforms', 'voice-examples']) {
      const source = read(`../../../routes/app/[brand]/studio/${section}/+page.server.ts`);
      // `?query` prima di `#hash`, o il fragment si porta dentro la query.
      expect(source).toContain(`/settings/brand${'${qs ? `?${qs}` : \'\'}'}#${section}`);
    }
  });

  it('ogni ancora usata dai rimandi è una sezione vera di StudioPage', () => {
    const studio = read('../studio/StudioPage.svelte');

    for (const section of ['brand', 'platforms', 'hashtags', 'voice-examples']) {
      expect(studio, `manca <section id="${section}">`).toContain(`<section id="${section}"`);
    }
  });
});
