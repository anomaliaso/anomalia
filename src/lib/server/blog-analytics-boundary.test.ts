import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Il confine, tenuto da un test invece che da una convenzione.
 *
 * Il blog di un brand esce da due alberi di rotte: `src/routes/_site` (il dominio del brand) e
 * `src/routes/blog/[site]` (`/blog/<slug>`, che sta sulla NOSTRA origine, insieme a `/app` e alla
 * sessione di chi e' loggato). I tracker di terze parti possono girare solo sul primo: un container
 * GA4 o GTM sul secondo eseguirebbe JavaScript arbitrario con i permessi di anomalia.so, e chi lo
 * amministra non siamo noi.
 *
 * `siteAnalytics` e' l'unica porta per quei tracker, e questo test dice da dove si passa. Se
 * qualcuno lo chiamasse dall'albero sbagliato — o da un terzo albero — qui si rompe, e si rompe
 * prima che il codice arrivi su una pagina pubblica.
 */

const ROUTES = new URL('../../routes', import.meta.url).pathname;
const ALLOWED = ['_site/+layout.server.ts'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('i tracker di un brand non toccano la nostra origine', () => {
  const callers = walk(ROUTES)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.svelte'))
    .filter((f) => /\bsiteAnalytics\b/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(ROUTES.length + 1))
    .sort();

  it('li chiede soltanto l’albero servito sul dominio del brand', () => {
    expect(callers).toEqual(ALLOWED);
  });

  it('l’albero su /blog/<slug> non li nomina nemmeno', () => {
    expect(callers.filter((f) => f.startsWith('blog/'))).toEqual([]);
  });

  /**
   * `brandProfile` alimenta ENTRAMBI gli alberi. Se i tracker finissero li' dentro, arriverebbero
   * su `/blog/<slug>` senza che nessuno lo abbia deciso.
   */
  it('e il profilo condiviso dai due alberi non li porta con se’', () => {
    const blogSite = readFileSync(join(ROUTES, '../lib/server/blog-site.ts'), 'utf8');
    const profile = blogSite.slice(
      blogSite.indexOf('async function brandProfile'),
      blogSite.indexOf('export async function siteAnalytics')
    );
    expect(profile).not.toMatch(/analytics/);
  });
});
