import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Un @font-face che punta a un file inesistente non rompe niente: il testo resta
 * leggibile sul fallback e nessuno se ne accorge, mentre il font che avevamo scelto
 * non arriva mai. Qui il percorso dichiarato deve esistere davvero in static/.
 */

const ROOT = join(__dirname, '..', '..');
const APP_CSS = readFileSync(join(ROOT, 'src', 'app.css'), 'utf8');

const declaredFontUrls = () =>
  [...APP_CSS.matchAll(/src:\s*url\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);

describe('@font-face di app.css', () => {
  it('dichiara ogni font che serve', () => {
    expect(declaredFontUrls().length).toBeGreaterThanOrEqual(3);
  });

  it('punta solo a file che esistono davvero in static/', () => {
    for (const url of declaredFontUrls()) {
      expect(url.startsWith('/')).toBe(true);
      expect(existsSync(join(ROOT, 'static', url)), `manca static${url}`).toBe(true);
    }
  });

  it('tiene Inter come ripiego dei titoli, non un serif di sistema', () => {
    const serif = APP_CSS.match(/^\s*--serif:\s*([^;]+);/m)?.[1].replace(/\s+/g, ' ');

    expect(serif).toBeDefined();
    expect(serif).toContain('"Inter"');
    expect(serif!.indexOf('"Inter"')).toBeLessThan(serif!.indexOf('sans-serif'));
  });
});
