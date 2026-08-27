import { describe, expect, it } from 'vitest';
import {
  brandModalTarget,
  HUB_TABS,
  NAV_TEAM_SPACES,
  NAV_TEAM_TOOLS,
  WORKBENCH_HUBS
} from './workbench-paths';

/**
 * La ristrutturazione della nav (FEATURE_NAV_TEAM) è un cambio di GERARCHIA, non di
 * inventario: due garanzie, entrambe qui.
 *
 * 1. Flag OFF = la nav di oggi, byte-identica. HUB_TABS è inchiodata a un letterale:
 *    chi la tocca mentre lavora sotto flag rompe questo test, non la nav dei clienti.
 * 2. Flag ON = ogni destinazione linkata dalla nav legacy resta raggiungibile
 *    nell'albero nuovo (Spazi + Strumenti). Si cammina la lista vera, non un elenco
 *    ricopiato a mano.
 */
describe('nav team (FEATURE_NAV_TEAM)', () => {
  it('flag OFF: HUB_TABS è quella spedita oggi (pin)', () => {
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
      ]
      // Niente `designer`: la sezione è uscita dalla nav (2026-08-22). Le pagine restano su
      // disco — le classifica page-modal-tiers.test.ts, non questo pin.
    });
  });

  it('flag ON: ogni destinazione della nav legacy resta linkata nel nuovo albero', () => {
    // La nav legacy linka le tab NON-overview dei hub renderizzati (il hub Brand è
    // sostituito nel layout dalla sola voce Settings › Identity, e strategy/gtm/plan
    // vivono nel chrome del Calendario — stessa regola in entrambe le nav).
    const legacyLinked = [
      ...(['publish', 'web', 'ads', 'automations'] as const).flatMap((hub) =>
        (HUB_TABS[hub] ?? []).filter((t) => t.key !== 'overview').map((t) => t.path)
      ),
      '/settings/brand'
    ];
    const newTree = new Set([...NAV_TEAM_SPACES, ...NAV_TEAM_TOOLS].map((t) => t.path));
    for (const path of legacyLinked) {
      expect(newTree, `href legacy orfano: ${path}`).toContain(path);
    }
  });

  it('il nuovo albero non inventa hub: ogni voce usa chiavi i18n esistenti o nav2', () => {
    for (const t of [...NAV_TEAM_SPACES, ...NAV_TEAM_TOOLS]) {
      // `app.home.` è ammessa per la Panoramica: riusa la chiave della pillola in topbar
      // (`app.home.workbench.title`) invece di coniarne una seconda per la stessa
      // destinazione — la regola è UNA parola per pillola, titolo della modal e rail.
      expect(t.labelKey).toMatch(/^app\.(hub|nav2|home)\./);
      expect(t.path.startsWith('/')).toBe(true);
    }
    // La Panoramica apre gli Spazi: riassume le altre pagine, non è una di esse.
    expect(NAV_TEAM_SPACES[0].path).toBe('/workbench');
    // Sanità: le liste non si sovrappongono (una pagina, una casa).
    const spaces = NAV_TEAM_SPACES.map((t) => t.path);
    const tools = NAV_TEAM_TOOLS.map((t) => t.path);
    expect(spaces.filter((p) => tools.includes(p))).toEqual([]);
    expect(WORKBENCH_HUBS.length).toBe(6);
  });

  /**
   * La home è solo la chat: il workbench è una rotta sua, e la modal la ospita. Se
   * `workbench` uscisse da BRAND_MODAL_ROUTES, la CTA in topbar e il chip dei post da
   * approvare tornerebbero a navigare via dalla chat invece di aprire l'overlay — un
   * regresso silenzioso, che solo questo test vede.
   */
  it('il workbench si apre nella modal, la home no', () => {
    expect(brandModalTarget('/app/acme/workbench', '/app/acme')).toBe('workbench');
    expect(brandModalTarget('/app/acme/leads', '/app/acme')).toBe('leads');
    // La home resta la superficie sotto la modal, non un contenuto da ospitare.
    expect(brandModalTarget('/app/acme', '/app/acme')).toBeNull();
  });
});
