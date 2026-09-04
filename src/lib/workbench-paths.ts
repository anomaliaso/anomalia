import { ADS_SELF_SERVE } from '$lib/ads-fee';

/** Resolve a short label for a brand-app pathname (English path segments). */
export function workbenchTabLabel(
  pathname: string,
  brandBase: string,
  t: (key: string) => string
): string {
  const base = brandBase.endsWith('/') ? brandBase.slice(0, -1) : brandBase;
  let rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  if (!rest || rest === '/') return t('app.shell.tabHome');
  rest = rest.replace(/^\//, '').split('?')[0];
  const seg = rest.split('/')[0] ?? '';

  const map: Record<string, string> = {
    strategy: 'app.hub.strategy.label',
    publish: 'app.hub.publish.label',
    automations: 'app.hub.automations.label',
    web: 'app.hub.web.label',
    brand: 'app.hub.brand.label',
    content: 'app.hub.publish.calendar',
    calendar: 'app.hub.publish.calendar',
    'manual-posting': 'app.hub.publish.manualPosting',
    posts: 'app.post.title',
    campaigns: 'app.hub.publish.campaigns',
    analytics: 'app.hub.publish.analytics',
    ads: 'app.hub.ads.label',
    competitors: 'app.hub.publish.competitors',
    studio: 'app.hub.brand.identity',
    knowledge: 'app.hub.brand.knowledge',
    voice: 'app.hub.brand.voice',
    rubrics: 'app.hub.brand.rubrics',
    ideas: 'app.hub.brand.ideas',
    gtm: 'app.hub.strategy.strategy',
    plan: 'app.hub.strategy.plan',
    radar: 'app.hub.automations.radar',
    leads: 'app.hub.automations.leads',
    agents: 'app.hub.automations.custom',
    seo: 'app.hub.web.seo',
    'seo-geo': 'app.hub.web.seo',
    geo: 'app.hub.web.geo',
    citations: 'app.hub.web.geo',
    keywords: 'app.hub.web.keywords',
    backlinks: 'app.hub.web.backlinks',
    site: 'app.hub.web.blog',
    settings: 'app.nav.settings',
    // Plans proposed by the chat (docs/24 §9) — a document, not the editorial plan above.
    plans: 'chat.plan.tab',
    designer: 'app.hub.designer.label',
    'media-generator': 'app.hub.designer.mediaGenerator',
    'ugc-creator': 'app.hub.designer.ugcCreator',
    'motion-video': 'app.hub.designer.motionVideo',
    media: 'app.hub.designer.mediaLibrary',
    workbench: 'app.home.workbench.title',
  };

  // Ads hub pages would otherwise share one "Ads" tab label.
  if (seg === 'ads' && rest.includes('/google')) return t('app.hub.ads.google');
  if (seg === 'ads' && rest.includes('/social')) return t('app.hub.ads.social');
  if (seg === 'ads' && rest.includes('/library')) return t('app.hub.ads.library');

  const key = map[seg];
  if (key) return t(key);
  // Nested editors e.g. site/edit/…
  if (seg === 'site' && rest.includes('/edit')) return t('app.hub.web.blog');
  return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : t('app.shell.tabHome');
}

export type WorkbenchPageHub =
  | 'strategy'
  | 'publish'
  | 'brand'
  | 'automations'
  | 'web'
  | 'designer'
  | 'ads';

export type WorkbenchPageDef = {
  hub: WorkbenchPageHub;
  /** Path segment under /app/{slug}/ */
  segment: string;
  labelKey: string;
  /** Requires the ads entitlement (Starter and up) — free/Go land on Settings › Ads instead. */
  adsOnly?: boolean;
};

/** All openable workbench pages, grouped by hub (same as the sidebar macros). */
export const WORKBENCH_PAGES: WorkbenchPageDef[] = [
  { hub: 'brand', segment: 'brand', labelKey: 'app.hub.brand.label' },
  { hub: 'brand', segment: 'knowledge', labelKey: 'app.hub.brand.knowledge' },
  { hub: 'brand', segment: 'voice', labelKey: 'app.hub.brand.voice' },
  { hub: 'brand', segment: 'rubrics', labelKey: 'app.hub.brand.rubrics' },
  { hub: 'brand', segment: 'ideas', labelKey: 'app.hub.brand.ideas' },
  { hub: 'strategy', segment: 'strategy', labelKey: 'app.hub.strategy.label' },
  { hub: 'strategy', segment: 'gtm', labelKey: 'app.hub.strategy.strategy' },
  { hub: 'strategy', segment: 'plan', labelKey: 'app.hub.strategy.plan' },
  { hub: 'publish', segment: 'publish', labelKey: 'app.hub.publish.label' },
  { hub: 'publish', segment: 'calendar', labelKey: 'app.hub.publish.calendar' },
  { hub: 'publish', segment: 'manual-posting', labelKey: 'app.hub.publish.manualPosting' },
  { hub: 'publish', segment: 'campaigns', labelKey: 'app.hub.publish.campaigns' },
  { hub: 'publish', segment: 'analytics', labelKey: 'app.hub.publish.analytics' },
  { hub: 'publish', segment: 'competitors', labelKey: 'app.hub.publish.competitors' },
  // Paid lives in its own hub: channels + Meta Ad Library research.
  { hub: 'ads', segment: 'ads/social', labelKey: 'app.hub.ads.social', adsOnly: true },
  { hub: 'ads', segment: 'ads/google', labelKey: 'app.hub.ads.google', adsOnly: true },
  { hub: 'ads', segment: 'ads/library', labelKey: 'app.hub.ads.library', adsOnly: true },
  { hub: 'automations', segment: 'automations', labelKey: 'app.hub.automations.label' },
  { hub: 'automations', segment: 'radar', labelKey: 'app.hub.automations.radar' },
  { hub: 'automations', segment: 'leads', labelKey: 'app.hub.automations.leads' },
  { hub: 'automations', segment: 'agents', labelKey: 'app.hub.automations.custom' },
  // Web hub + Radar/Leads are free (match Go). Ads need Starter or above.
  { hub: 'web', segment: 'web', labelKey: 'app.hub.web.label' },
  { hub: 'web', segment: 'seo', labelKey: 'app.hub.web.seo' },
  { hub: 'web', segment: 'geo', labelKey: 'app.hub.web.geo' },
  { hub: 'web', segment: 'keywords', labelKey: 'app.hub.web.keywords' },
  { hub: 'web', segment: 'backlinks', labelKey: 'app.hub.web.backlinks' },
  { hub: 'web', segment: 'site', labelKey: 'app.hub.web.blog' },
  { hub: 'designer', segment: 'designer', labelKey: 'app.hub.designer.label' },
  { hub: 'designer', segment: 'media-generator', labelKey: 'app.hub.designer.mediaGenerator' },
  { hub: 'designer', segment: 'ugc-creator', labelKey: 'app.hub.designer.ugcCreator' },
  { hub: 'designer', segment: 'motion-video', labelKey: 'app.hub.designer.motionVideo' },
  { hub: 'designer', segment: 'media', labelKey: 'app.hub.designer.mediaLibrary' },
];

export const WORKBENCH_HUBS: WorkbenchPageHub[] = ['brand', 'strategy', 'publish', 'web', 'ads', 'automations', 'designer'];

/**
 * Sotto-pagine di ogni hub (sidebar). Le chiavi combaciano con `app.hub.{hub}.{key}`.
 */
export const HUB_TABS: Partial<Record<WorkbenchPageHub, { key: string; path: string; adsOnly?: boolean }[]>> = {
  brand: [
    { key: 'overview', path: '/brand' },
    { key: 'knowledge', path: '/knowledge' },
    { key: 'voice', path: '/voice' },
    { key: 'rubrics', path: '/rubrics' },
    { key: 'ideas', path: '/ideas' },
  ],
  strategy: [
    { key: 'overview', path: '/strategy' },
    { key: 'strategy', path: '/gtm' },
    { key: 'plan', path: '/plan' },
  ],
  publish: [
    { key: 'overview', path: '/publish' },
    { key: 'calendar', path: '/calendar' },
    { key: 'manualPosting', path: '/manual-posting' },
    { key: 'campaigns', path: '/campaigns' },
    { key: 'analytics', path: '/analytics' },
    { key: 'competitors', path: '/competitors' },
  ],
  // No 'overview' entry: the section is its channels + Meta Ad Library; /ads redirects to social.
  ads: [
    { key: 'social', path: '/ads/social', adsOnly: true },
    { key: 'google', path: '/ads/google', adsOnly: true },
    { key: 'library', path: '/ads/library', adsOnly: true },
  ],
  automations: [
    { key: 'overview', path: '/automations' },
    { key: 'radar', path: '/radar' },
    { key: 'leads', path: '/leads' },
    { key: 'custom', path: '/agents' },
  ],
  web: [
    { key: 'overview', path: '/web' },
    { key: 'seo', path: '/seo' },
    { key: 'geo', path: '/geo' },
    { key: 'keywords', path: '/keywords' },
    { key: 'backlinks', path: '/backlinks' },
    { key: 'blog', path: '/site' },
  ],
  designer: [
    { key: 'overview', path: '/designer' },
    { key: 'mediaGenerator', path: '/media-generator' },
    { key: 'ugcCreator', path: '/ugc-creator' },
    { key: 'motionVideo', path: '/motion-video' },
    { key: 'mediaLibrary', path: '/media' },
  ],
};

export function workbenchPageHref(
  brandSlug: string,
  segment: string,
  _webHubEnabled = true,
  adsEnabled = false
): string {
  // Con ADS_SELF_SERVE spento le pagine ads mostrano un placeholder "prenota una call" per ogni
  // piano: non rimbalzare gli utenti non paganti. Si atterra sulle impostazioni ads, che spiegano
  // il requisito Pro e portano un bottone di upgrade ESPLICITO. Mai /upgrade da qui: apre una
  // sessione Stripe su GET, e un click in sidebar è navigazione, non consenso a pagare. Mai
  // /activate: tratta un brand già abbonato come "fatto" e rimbalza su /success.
  if ((segment === 'ads' || segment.startsWith('ads/')) && !adsEnabled && ADS_SELF_SERVE) {
    return `/app/${brandSlug}/settings/ads`;
  }
  return `/app/${brandSlug}/${segment}`;
}

// La nav del brand: la STRUTTURA pura (path + chiavi i18n), così workbench-paths.test.ts cammina
// l'albero e garantisce che OGNI destinazione dell'inventario (HUB_TABS qui sopra) resti
// raggiungibile — cambia la gerarchia, non l'inventario.

export type NavTeamItem = {
  /** Path sotto /app/{slug} (con lo slash iniziale, come HUB_TABS). Vuoto = la home del brand. */
  path: string;
  labelKey: string;
  /** Altri path che tengono attiva la voce (rotte sorelle/legacy che atterrano qui). */
  also?: string[];
  /** Badge dinamico del layout (stessi contatori della nav legacy). */
  badge?: 'content' | 'leads';
  adsOnly?: boolean;
};

/**
 * LE RIGHE DELLA SIDEBAR, in quest'ordine. Le cinque del mockup più le quattro che non potevano
 * perdere la porta: SEO/GEO e Auto blog (le due volute al posto di «Web»), News Radar, e
 * `/agents`, che dei nove lavori ricorrenti è l'unica superficie rimasta nel browser.
 *
 * Calendario assorbe le approvazioni: /approvals e /content fanno già 308 su /calendar, e la coda
 * è il filtro ?status=.
 */
export const NAV_TEAM_SPACES: NavTeamItem[] = [
  // La home del brand. `/workbench` non è più una voce sua: era la Panoramica, cioè la vista che
  // RIASSUME le altre — ed è esattamente ciò che la home fa. Oggi `/app/<slug>` ci rimanda, quindi
  // sta fra gli `also` o la voce si spegnerebbe appena atterrati.
  { path: '', labelKey: 'app.nav2.home', also: ['/workbench'] },
  { path: '/media', labelKey: 'app.nav2.materials', also: ['/designer'] },
  { path: '/strategy', labelKey: 'app.hub.strategy.label', also: ['/gtm', '/plan'] },
  {
    path: '/calendar',
    labelKey: 'app.hub.publish.calendar',
    badge: 'content',
    also: ['/content', '/approvals', '/publish']
  },
  // SEO e GEO sono una voce sola: la ricerca e la citabilità dai modelli sono la stessa domanda
  // ("ci trovano?") fatta a due motori. `/geo`, `/seo-geo` e `/citations` restano rotte vere —
  // si aprono da qui dentro e da ⌘K — ma non hanno una riga propria. `/web` è la landing del
  // hub e non è mai stata linkata direttamente.
  { path: '/seo', labelKey: 'app.nav2.seoGeo', also: ['/web', '/seo-geo', '/geo', '/citations'] },
  { path: '/site', labelKey: 'app.nav2.site' },
  // Le due che girano da sole, di fila: quello che il prodotto guarda per te, e chi lo guarda.
  // `/agents` è l'UNICA superficie browser dei nove lavori ricorrenti da quando
  // Impostazioni › Autopilot non c'è più: senza questa riga, chi non ha un agente collegato
  // resta senza un modo di spegnere le proprie automazioni.
  { path: '/radar', labelKey: 'app.nav2.newsRadar' },
  { path: '/agents', labelKey: 'app.hub.automations.custom', also: ['/automations'] },
  { path: '/analytics', labelKey: 'app.nav2.results' }
];

/**
 * FUORI DALLA SIDEBAR — le destinazioni che esistono, hanno un'etichetta e si aprono da ⌘K (che
 * dopo la rimozione della modal elenca ogni pagina del brand su disco) e dai link degli agenti,
 * ma NON hanno una riga propria nella barra laterale. Il gruppo «Strumenti» che le raccoglieva è
 * stato tolto: la sidebar sono nove righe e l'ingranaggio, e basta.
 *
 * L'elenco resta perché è ancora l'inventario: `goTargetLabelKey` ci prende le etichette delle
 * scorciatoie `g <lettera>`, e il test lo confronta con HUB_TABS — una pagina nuova che non
 * finisce né qui né fra gli Spazi fa fallire la suite, invece di sparire in silenzio.
 * I banchi del Designer non sono qui: la sezione è fuori dalla nav da prima.
 */
export const NAV_OFF_SIDEBAR: NavTeamItem[] = [
  { path: '/leads', labelKey: 'app.hub.automations.leads', badge: 'leads' },
  { path: '/keywords', labelKey: 'app.hub.web.keywords' },
  { path: '/backlinks', labelKey: 'app.hub.web.backlinks' },
  { path: '/competitors', labelKey: 'app.hub.publish.competitors' },
  { path: '/campaigns', labelKey: 'app.hub.publish.campaigns' },
  { path: '/manual-posting', labelKey: 'app.hub.publish.manualPosting' },
  // Lo Studio del brand: nella legacy è l'unica voce del hub Brand (Settings › Identity).
  { path: '/settings/brand', labelKey: 'app.hub.brand.identity' },
  { path: '/knowledge', labelKey: 'app.hub.brand.knowledge' },
  { path: '/ads/social', labelKey: 'app.hub.ads.social', adsOnly: true },
  { path: '/ads/google', labelKey: 'app.hub.ads.google', adsOnly: true },
  { path: '/ads/library', labelKey: 'app.hub.ads.library', adsOnly: true }
];
