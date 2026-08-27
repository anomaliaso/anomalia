import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_MODAL_ROUTES, BRAND_PAGE_ROUTES, brandModalTarget } from './workbench-paths';
import {
  SETTINGS_FULL_PAGE_SECTIONS,
  SETTINGS_MODAL_DEFAULT,
  SETTINGS_MODAL_GROUPS,
  SETTINGS_MODAL_SECTIONS,
  SETTINGS_MODAL_WIDE
} from './components/settings/platforms';

/**
 * La tabella dei tier del modal Impostazioni, INCHIODATA: ogni route sotto
 * settings/** è classificata o "modal" (ospitata nell'overlay via shallow
 * routing) o "full" (resta pagina piena, per un motivo tecnico). Il test
 * cammina la directory vera: chi aggiunge una pagina settings nuova DEVE
 * deciderne il tier, non può dimenticarsela.
 */

const SETTINGS_DIR = join(__dirname, '../routes/app/[brand]/settings');

function walkPages(dir: string, prefix = '', out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const relPath = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) walkPages(join(dir, e.name), relPath, out);
    else if (e.name === '+page.svelte' && prefix) out.push(prefix);
  }
  return out;
}

describe('settings modal tiers', () => {
  const routes = walkPages(SETTINGS_DIR).sort();

  it('ogni route settings è classificata (modal o full), nessuna dimenticata', () => {
    const classified = [...SETTINGS_MODAL_SECTIONS, ...SETTINGS_FULL_PAGE_SECTIONS].sort();
    // Se questa assert fallisce hai aggiunto (o rimosso) una pagina settings:
    // decidi il tier in platforms.ts (SETTINGS_MODAL_SECTIONS o SETTINGS_FULL_PAGE_SECTIONS).
    expect(routes).toEqual(classified);
  });

  it('il default è il modal: le esclusioni restano poche e motivate', () => {
    // Non un vincolo estetico: serve a far notare se le esclusioni ricominciano a
    // crescere. Oggi sono solo OAuth intermedi + un drill-down dinamico.
    expect(SETTINGS_FULL_PAGE_SECTIONS.length).toBeLessThanOrEqual(5);
    expect(SETTINGS_MODAL_SECTIONS.length).toBeGreaterThan(routes.length * 0.8);
  });

  it('nessuna route in entrambi i tier', () => {
    const overlap = SETTINGS_MODAL_SECTIONS.filter((s) =>
      (SETTINGS_FULL_PAGE_SECTIONS as readonly string[]).includes(s)
    );
    expect(overlap).toEqual([]);
  });

  it('il glob di SettingsModal risolve ogni sezione modal (chiave [brand] letterale)', () => {
    // ESATTAMENTE il pattern di SettingsModal.svelte: `**` perché `*` non
    // attraversa `/` e le sezioni possono avere due segmenti (`ads/accounts`).
    // Se il pattern o il percorso delle route cambiasse, la modal aprirebbe
    // sezioni vuote: questo test lo dice prima.
    const globbed = import.meta.glob('/src/routes/app/**/settings/**/+page.svelte');
    for (const section of SETTINGS_MODAL_SECTIONS) {
      expect(
        globbed[`/src/routes/app/[brand]/settings/${section}/+page.svelte`],
        `sezione ${section} non risolta dal glob`
      ).toBeTypeOf('function');
    }
  });

  it('il rail elenca TUTTE le sezioni modal, senza doppioni', () => {
    const inGroups = SETTINGS_MODAL_GROUPS.flatMap((g) => g.items.map((i) => i.section));
    expect(new Set(inGroups).size).toBe(inGroups.length);
    // Ogni sezione modal è raggiungibile dal rail: nessuna voce "mancante" che
    // faccia sembrare il modal una versione ridotta delle impostazioni vere.
    for (const s of SETTINGS_MODAL_SECTIONS) {
      expect(inGroups, `sezione ${s} assente dal rail`).toContain(s);
    }
    expect(SETTINGS_MODAL_SECTIONS).toContain(SETTINGS_MODAL_DEFAULT);
  });

  it('ogni voce del rail è una route esistente e classificata', () => {
    for (const g of SETTINGS_MODAL_GROUPS) {
      for (const i of g.items) {
        expect(routes, `voce di rail ${i.section} senza route`).toContain(i.section);
        expect(i.labelKey).toMatch(/^app\./);
      }
    }
  });

  it("il rail rispecchia l'ordine e i gruppi della SettingsSidebar vera", () => {
    // Chi apre il modal deve ritrovare la mappa che già conosce. Se la sidebar
    // cambia ordine, questo test obbliga ad allineare anche il rail.
    expect(SETTINGS_MODAL_GROUPS.map((g) => g.labelKey)).toEqual([
      'app.nav.sectionBrand',
      'app.nav.site',
      'app.settings.ads.nav',
      'app.nav.sectionPublishing',
      'app.nav.workspace',
      'app.nav.sectionAccount'
    ]);
    const brand = SETTINGS_MODAL_GROUPS[0].items.map((i) => i.section);
    expect(brand).toEqual([
      'brand',
      'platforms',
      'hashtags',
      'voice-examples',
      'products',
      'people',
      'library',
      'demo-account'
    ]);
  });

  it('le taglie larghe sono sezioni modal vere', () => {
    for (const s of SETTINGS_MODAL_WIDE) {
      expect(SETTINGS_MODAL_SECTIONS, `wide ${s} non è una sezione modal`).toContain(s);
    }
  });
});

/**
 * Stessa disciplina, estesa a TUTTE le rotte del brand: la modal non è più solo per le
 * impostazioni. Una rotta nuova sotto /app/[brand]/ senza decisione fa fallire la suite.
 */
describe('brand page tiers', () => {
  const BRAND_DIR = join(__dirname, '../routes/app/[brand]');

  function walkBrandPages(dir: string, prefix = '', out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (rel === 'settings') continue; // classificate dai test qui sopra
        walkBrandPages(join(dir, e.name), rel, out);
      } else if (e.name === '+page.svelte') {
        out.push(prefix || '.');
      }
    }
    return out;
  }

  const routes = walkBrandPages(BRAND_DIR).sort();

  // L'export open (scripts/export-oss.mjs) toglie le superfici di monetizzazione: là la rotta non
  // c'è ma la classificazione resta, e sarebbe un rosso su una copia sana. Solo queste possono
  // mancare — ogni altra assenza è una costante rimasta indietro, e deve continuare a fallire.
  const RIMOVIBILI_DALL_EXPORT = ['activate'];

  it('ogni rotta del brand è classificata (modal o page), nessuna dimenticata', () => {
    const classified = [...BRAND_MODAL_ROUTES, ...BRAND_PAGE_ROUTES]
      .filter((r) => routes.includes(r) || !RIMOVIBILI_DALL_EXPORT.includes(r))
      .sort();
    // Se fallisce: hai aggiunto una pagina sotto /app/[brand]/. Decidi il tier in
    // src/lib/workbench-paths.ts — BRAND_MODAL_ROUTES (default) o BRAND_PAGE_ROUTES
    // (solo con una ragione tecnica, scritta lì accanto).
    expect(routes).toEqual(classified);
  });

  it('nessuna rotta del brand in entrambi i tier', () => {
    const overlap = BRAND_MODAL_ROUTES.filter((r) =>
      (BRAND_PAGE_ROUTES as readonly string[]).includes(r)
    );
    expect(overlap).toEqual([]);
  });

  it('il default è la modal: le pagine piene restano la minoranza motivata', () => {
    expect(BRAND_MODAL_ROUTES.length).toBeGreaterThan(BRAND_PAGE_ROUTES.length);
  });

  it('brandModalTarget riconosce le rotte modal e rifiuta le altre', () => {
    const base = '/app/acme';
    for (const r of BRAND_MODAL_ROUTES) {
      expect(brandModalTarget(`${base}/${r}`, base), r).toBe(r);
    }
    for (const r of BRAND_PAGE_ROUTES) {
      // Le rotte `page` non devono MAI essere catturate dall'intercettazione.
      expect(brandModalTarget(`${base}/${r}`, base), r).toBeNull();
    }
    // La home del brand è la superficie sotto la modal, non un contenuto.
    expect(brandModalTarget(base, base)).toBeNull();
    // Fuori perimetro: altre aree dell'app restano navigazione normale.
    expect(brandModalTarget('/app', base)).toBeNull();
    expect(brandModalTarget('/app/altro/calendar', base)).toBeNull();
    // I settings hanno la loro classificazione, non questa.
    expect(brandModalTarget(`${base}/settings/profile`, base)).toBeNull();
  });

  it('ogni rotta modal del brand è risolvibile dal glob della modal', () => {
    const globbed = import.meta.glob('/src/routes/app/**/+page.svelte');
    for (const r of BRAND_MODAL_ROUTES) {
      expect(
        globbed[`/src/routes/app/[brand]/${r}/+page.svelte`],
        `rotta ${r} non risolta dal glob`
      ).toBeTypeOf('function');
    }
  });
});
