import { describe, expect, it } from 'vitest';
import {
  HUB_TABS,
  NAV_TEAM_SPACES,
  NAV_TEAM_TOOLS,
  WORKBENCH_HUBS
} from './workbench-paths';

/**
 * La nav è un cambio di GERARCHIA, non di inventario: due garanzie, entrambe qui.
 *
 * 1. HUB_TABS resta l'INVENTARIO delle pagine del brand, inchiodato a un letterale. Non
 *    disegna più niente — la sidebar è una sola — ma dice quali destinazioni esistono, ed è
 *    contro quella lista che si misura se il nuovo albero ne ha perso una.
 * 2. Ogni destinazione di quell'inventario resta raggiungibile da Spazi + Strumenti. Si
 *    cammina la lista vera, non un elenco ricopiato a mano.
 */
describe('la nav del brand', () => {
  it("HUB_TABS è l'inventario delle pagine, inchiodato (pin)", () => {
    expect(HUB_TABS).toEqual({
      brand: [
        { key: 'overview', path: '/brand' },
        { key: 'knowledge', path: '/knowledge' },
        { key: 'voice', path: '/voice' },
        { key: 'rubrics', path: '/rubrics' },
        { key: 'ideas', path: '/ideas' }
      ],
      strategy: [
        { key: 'overview', path: '/strategy' },
        { key: 'strategy', path: '/gtm' },
        { key: 'plan', path: '/plan' }
      ],
      publish: [
        { key: 'overview', path: '/publish' },
        { key: 'calendar', path: '/calendar' },
        { key: 'manualPosting', path: '/manual-posting' },
        { key: 'campaigns', path: '/campaigns' },
        { key: 'analytics', path: '/analytics' },
        { key: 'competitors', path: '/competitors' }
      ],
      ads: [
        { key: 'social', path: '/ads/social', adsOnly: true },
        { key: 'google', path: '/ads/google', adsOnly: true },
        { key: 'library', path: '/ads/library', adsOnly: true }
      ],
      automations: [
        { key: 'overview', path: '/automations' },
        { key: 'radar', path: '/radar' },
        { key: 'leads', path: '/leads' },
        { key: 'custom', path: '/agents' }
      ],
      web: [
        { key: 'overview', path: '/web' },
        { key: 'seo', path: '/seo' },
        { key: 'geo', path: '/geo' },
        { key: 'keywords', path: '/keywords' },
        { key: 'backlinks', path: '/backlinks' },
        { key: 'blog', path: '/site' }
      ],
      designer: [
        { key: 'overview', path: '/designer' },
        { key: 'mediaGenerator', path: '/media-generator' },
        { key: 'ugcCreator', path: '/ugc-creator' },
        { key: 'motionVideo', path: '/motion-video' },
        { key: 'mediaLibrary', path: '/media' }
      ]
    });
  });

  it("ogni destinazione dell'inventario resta linkata nell'albero", () => {
    // Le tab NON-overview dei hub che la nav disegnava (il hub Brand è sostituito dalla sola
    // voce Settings › Identity, e gtm/plan vivono nel chrome della Strategia).
    const legacyLinked = [
      ...(['publish', 'web', 'ads', 'automations'] as const).flatMap((hub) =>
        (HUB_TABS[hub] ?? []).filter((t) => t.key !== 'overview').map((t) => t.path)
      ),
      '/settings/brand'
    ];
    /**
     * L'unica destinazione dell'inventario che NON ha una riga sua, per decisione: SEO e GEO
     * sono una voce sola ("ci trovano?", chiesto a due motori). `/geo` resta una rotta vera —
     * si apre da dentro SEO/GEO e da ⌘K, che elenca ogni pagina del brand su disco.
     * Chi ne aggiunge un'altra qui deve sapere perché: una rotta senza riga né riga che ci
     * porti è una pagina che nessuno trova.
     */
    const SENZA_RIGA_PROPRIA = ['/geo'];
    const newTree = new Set([...NAV_TEAM_SPACES, ...NAV_TEAM_TOOLS].map((t) => t.path));
    for (const path of legacyLinked.filter((p) => !SENZA_RIGA_PROPRIA.includes(p))) {
      expect(newTree, `href legacy orfano: ${path}`).toContain(path);
    }
    // …e quella deve almeno accendere la voce che la contiene, o non si sa dove si è.
    const alsoEverywhere = new Set([...NAV_TEAM_SPACES, ...NAV_TEAM_TOOLS].flatMap((t) => t.also ?? []));
    for (const path of SENZA_RIGA_PROPRIA) {
      expect(alsoEverywhere, `${path} non accende nessuna voce`).toContain(path);
    }
  });

  it('il nuovo albero non inventa hub: ogni voce usa chiavi i18n esistenti o nav2', () => {
    for (const t of [...NAV_TEAM_SPACES, ...NAV_TEAM_TOOLS]) {
      expect(t.labelKey).toMatch(/^app\.(hub|nav2)\./);
      expect(t.path === '' || t.path.startsWith('/')).toBe(true);
    }
    // La home apre gli Spazi, ed è la sola voce senza segmento: `path` vuoto = `/app/<slug>`.
    expect(NAV_TEAM_SPACES[0].path).toBe('');
    // Sanità: le liste non si sovrappongono (una pagina, una casa).
    const spaces = NAV_TEAM_SPACES.map((t) => t.path);
    const tools = NAV_TEAM_TOOLS.map((t) => t.path);
    expect(spaces.filter((p) => tools.includes(p))).toEqual([]);
    expect(WORKBENCH_HUBS.length).toBe(7);
  });

  /**
   * Il mockup: cinque destinazioni, in quest'ordine. È l'unica cosa che un test può tenere
   * ferma di una sidebar — l'inventario lo sorveglia il caso qui sopra, l'aspetto nessuno.
   */
  it('gli Spazi sono le cinque voci del mockup, in ordine', () => {
    expect(NAV_TEAM_SPACES.map((t) => [t.path, t.labelKey])).toEqual([
      ['', 'app.nav2.home'],
      ['/media', 'app.nav2.materials'],
      ['/strategy', 'app.hub.strategy.label'],
      ['/calendar', 'app.hub.publish.calendar'],
      ['/analytics', 'app.nav2.results']
    ]);
  });

  it('la Panoramica non è più una voce: ci si arriva dalla home', () => {
    const everywhere = [...NAV_TEAM_SPACES, ...NAV_TEAM_TOOLS];
    expect(everywhere.map((t) => t.path)).not.toContain('/workbench');
    expect(NAV_TEAM_SPACES[0].also).toContain('/workbench');
  });
});
