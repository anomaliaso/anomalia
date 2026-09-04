import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UI_TOKENS } from './ui-tokens';

/**
 * Il bug che questo test rende impossibile: uno skeleton dipinto con
 * `var(--surface-2, #fff)` — un token mai definito da nessuna parte — e il fallback
 * bianco spedito su tema scuro. Un token usato in uno .svelte deve esistere davvero:
 * o in app.css (UI_TOKENS), o definito da qualche parte nel codice (CSS locale,
 * `style:--x`, prop `--x=` di componente, `setProperty('--x'…)`), o essere nella
 * lista LEGACY_STRAYS qui sotto — il debito già esistente, congelato, che può solo
 * scendere.
 */

const SRC = join(__dirname, '..'); // src/

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const FILES = walk(SRC);
const rel = (p: string) => 'src/' + p.slice(SRC.length + 1).split('\\').join('/');

/** Tutti i custom property davvero DEFINITI nel codice (css, svelte, ts/js). */
function collectDefinitions(): Set<string> {
  const defs = new Set<string>();
  for (const f of FILES) {
    if (!/\.(css|svelte|ts|js)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    // `--x:` (CSS) e `--x=` (prop di componente Svelte / style:--x)
    for (const m of text.matchAll(/(--[a-z0-9_-]+)\s*[:=]/gi)) defs.add(m[1]);
    // token impostati da JS a runtime
    for (const m of text.matchAll(/setProperty\(\s*[`"'](--[a-z0-9_-]+)/gi)) defs.add(m[1]);
  }
  return defs;
}

// Debito pre-esistente al momento dell'introduzione del test (2026-08-21): usi di
// token MAI definiti, che oggi vivono solo del fallback di var(). Congelati qui —
// nomi in stile shadcn (--background, --muted-foreground, --sidebar-*) copiati da
// template, e scorciatoie di pagina (--wash, --mono, --surface). Quando ne ripulisci
// uno (sostituendolo con un token vero di UI_TOKENS), togli la riga: il test fallisce
// apposta se una voce non è più stray, così la lista non mente mai.
const LEGACY_STRAYS = [
  '--bg src/routes/[[lang=locale]]/tools/conversation-gap/+page.svelte',
  '--bg src/routes/[[lang=locale]]/tools/keyword-research/+page.svelte',
  '--bg src/routes/app/[brand]/ads/library/+page.svelte',
  '--bg src/routes/app/[brand]/success/+page.svelte',
  '--border src/lib/components/studio/BrandMemoryPanel.svelte',
  '--border src/routes/app/[brand]/keywords/+page.svelte',
  '--card src/lib/components/studio/FontPicker.svelte',
  '--card src/routes/app/[brand]/settings/facebook/+page.svelte',
  '--card src/routes/app/[brand]/settings/linkedin/+page.svelte',
  '--danger src/lib/components/GrowthReadiness.svelte',
  '--danger src/lib/components/media-generator/MediaGeneratorSeedancePanel.svelte',
  '--danger src/routes/app/[brand]/radar/+page.svelte',
  '--hover src/lib/components/studio/FontPicker.svelte',
  '--ink-muted src/lib/components/media-generator/MediaGeneratorSeedancePanel.svelte',
  '--muted src/lib/components/AdsOverview.svelte',
  '--muted src/routes/app/[brand]/ads/google/+page.svelte',
  '--muted src/routes/app/[brand]/ads/library/+page.svelte',
  '--muted src/routes/app/[brand]/ads/social/+page.svelte',
  '--muted src/routes/app/[brand]/radar/+page.svelte',
  '--muted src/routes/app/[brand]/success/+page.svelte',
  '--muted-fg src/routes/app/[brand]/success/+page.svelte',
  '--panel src/lib/components/AdsOverview.svelte',
  '--sidebar-border src/lib/components/SettingsSidebar.svelte',
  '--sidebar-border src/lib/components/ui/sidebar/sidebar-menu-button.svelte',
  '--sidebar-foreground src/lib/components/DashboardSidebar.svelte',
  '--sidebar-foreground src/lib/components/SettingsSidebar.svelte',
  '--surface src/routes/cli/callback/+page.svelte',
  '--surface src/routes/login/+page.svelte',
  '--surface src/routes/oauth/authorize/+page.svelte',
  '--warn src/lib/components/GrowthReadiness.svelte',
  '--wash src/lib/components/ToolKeywordTable.svelte',
  '--wash src/lib/components/ToolPage.svelte',
  '--wash src/routes/[[lang=locale]]/tools/agent-team/+page.svelte',
  '--wash src/routes/[[lang=locale]]/tools/ai-visibility/+page.svelte',
  '--wash src/routes/[[lang=locale]]/tools/backlink-checker/+page.svelte',
  '--wash src/routes/[[lang=locale]]/tools/heading-audit/+page.svelte',
  '--wash src/routes/[[lang=locale]]/tools/redirect-checker/+page.svelte',
  '--wash src/routes/[[lang=locale]]/tools/robots-tester/+page.svelte',
  '--wash src/routes/[[lang=locale]]/tools/schema-validator/+page.svelte',
  '--wash src/routes/app/[brand]/geo/+page.svelte'
];

describe('ui-tokens', () => {
  it('UI_TOKENS coincide con i token definiti in app.css (nomi, non valori)', () => {
    const css = readFileSync(join(SRC, 'app.css'), 'utf8');
    const inCss = new Set<string>();
    for (const m of css.matchAll(/(^|\n)\s*(--[a-z0-9-]+)\s*:/gi)) inCss.add(m[2]);
    // Confronto in entrambe le direzioni: un token aggiunto in app.css va aggiunto
    // qui; un token rimosso da app.css va rimosso da qui.
    expect([...inCss].sort()).toEqual([...UI_TOKENS].sort());
  });

  it('ogni var(--x) negli .svelte usa un token che esiste (o è debito congelato)', () => {
    const defs = collectDefinitions();
    const strays: string[] = [];
    for (const f of FILES) {
      if (!f.endsWith('.svelte')) continue;
      const text = readFileSync(f, 'utf8');
      const seen = new Set<string>();
      for (const m of text.matchAll(/var\(\s*(--[a-z0-9_-]+)/gi)) {
        const token = m[1];
        if (defs.has(token) || seen.has(token)) continue;
        seen.add(token);
        strays.push(`${token} ${rel(f)}`);
      }
    }
    strays.sort();

    const baseline = new Set(LEGACY_STRAYS);
    const nuovi = strays.filter((s) => !baseline.has(s));
    const actual = new Set(strays);
    const ripuliti = LEGACY_STRAYS.filter((s) => !actual.has(s));

    expect(
      nuovi,
      `Token usati ma MAI definiti (né in app.css né altrove). Usa un token di UI_TOKENS ` +
        `(src/lib/ui-tokens.ts) o definisci il token prima di usarlo — il fallback di var() ` +
        `non è una definizione.`
    ).toEqual([]);
    expect(
      ripuliti,
      'Queste voci non sono più stray: rimuovile da LEGACY_STRAYS in src/lib/ui-tokens.test.ts (il debito può solo scendere).'
    ).toEqual([]);
  });
});
