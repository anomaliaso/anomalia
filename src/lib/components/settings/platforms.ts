import { siInstagram, siTiktok, siFacebook, siX, siThreads, siYoutube, siBluesky, siReddit } from 'simple-icons';

export const PLATFORMS = [
  { key: 'instagram', label: 'Instagram', glyph: 'IG', bg: 'linear-gradient(135deg,#f58529,#dd2a7b,#8134af)' },
  { key: 'tiktok', label: 'TikTok', glyph: 'TT', bg: '#111' },
  { key: 'facebook', label: 'Facebook', glyph: 'f', bg: '#1877f2' },
  { key: 'linkedin', label: 'LinkedIn', glyph: 'in', bg: '#0a66c2' },
  { key: 'x', label: 'X', glyph: 'X', bg: '#0a0a0a' },
  { key: 'threads', label: 'Threads', glyph: '@', bg: '#000000' },
  { key: 'youtube', label: 'YouTube', glyph: 'YT', bg: '#ff0000' },
  { key: 'bluesky', label: 'Bluesky', glyph: 'BS', bg: '#0285ff' },
  { key: 'reddit', label: 'Reddit', glyph: 'RD', bg: '#ff4500' }
] as const;

export const ICONS: Record<string, { path: string; hex: string }> = {
  instagram: siInstagram,
  tiktok: siTiktok,
  facebook: siFacebook,
  x: siX,
  threads: siThreads,
  youtube: siYoutube,
  bluesky: siBluesky,
  reddit: siReddit
};

export const SETTINGS_SECTIONS = [
  'brand',
  'platforms',
  'hashtags',
  'voice-examples',
  'products',
  'people',
  'library',
  'demo-account',
  'connected-accounts',
  'connectors',
  'ads',
  'ads-accounts',
  'autopilot',
  'radar',
  'video',
  'timezone',
  'blog-appearance',
  'blog-authors',
  'blog-categories',
  'blog-domain',
  'blog-integrations',
  'search-console',
  'language',
  'api-keys',
  'team',
  'profile',
  'appearance',
  'billing',
  'usage',
  'referrals',
  'danger'
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Former Studio / Identity sections now under Settings → Brand. */
export const SETTINGS_BRAND_SECTIONS = [
  'brand',
  'platforms',
  'hashtags',
  'voice-examples',
  'products',
  'people'
] as const;

export type SettingsBrandSection = (typeof SETTINGS_BRAND_SECTIONS)[number];

/** Blog settings under Settings → Blog. */
export const SETTINGS_BLOG_SECTIONS = [
  'blog-appearance',
  'blog-authors',
  'blog-categories',
  'blog-domain',
  'blog-integrations',
  'search-console'
] as const;

export type SettingsBlogSection = (typeof SETTINGS_BLOG_SECTIONS)[number];

/** Ads settings under Settings → Ads. */
export const SETTINGS_ADS_SECTIONS = ['ads-accounts', 'ads'] as const;

export type SettingsAdsSection = (typeof SETTINGS_ADS_SECTIONS)[number];


// ─── Modal Impostazioni ────────────────────────────────────────────────────────────────
// Il meccanismo (shallow routing che ospita la +page.svelte VERA) è agnostico al peso
// della pagina: il default è quindi "tutto in modal". Restano fuori solo le rotte con
// un motivo TECNICO dimostrabile, elencate in SETTINGS_FULL_PAGE_SECTIONS.
// Il perimetro è e resta /app/<slug>/settings/** — nessun'altra area del prodotto.

/**
 * Rotte settings che NON possono vivere nel modal, col motivo tecnico:
 * - facebook / linkedin: pagine intermedie OAuth. Il +layout di settings le esclude
 *   già dalla propria shell (`isOauthFlow`) e navigano fuori dal sito.
 * - usage/sessions/[id]: rotta dinamica di drill-down, non una sezione di nav —
 *   non ha un href statico da mettere nel rail, si raggiunge da dentro `usage`.
 * (Anche settings/connect/* è OAuth, ma non ha +page.svelte: non è mai un target.)
 */
export const SETTINGS_FULL_PAGE_SECTIONS = [
  'facebook',
  'linkedin',
  'usage/sessions/[id]'
] as const;

export type SettingsFullPageSection = (typeof SETTINGS_FULL_PAGE_SECTIONS)[number];

/** Tutte le sezioni ospitabili nel modal. */
export const SETTINGS_MODAL_SECTIONS = [
  'brand',
  'platforms',
  'hashtags',
  'voice-examples',
  'products',
  'people',
  'library',
  'demo-account',
  'blog-appearance',
  'blog-authors',
  'blog-categories',
  'blog-domain',
  'blog-integrations',
  'search-console',
  'ads/accounts',
  'ads',
  'connected-accounts',
  'connectors',
  'autopilot',
  'radar',
  'video',
  'publishing',
  'timezone',
  'language',
  'api-keys',
  'team',
  'profile',
  'appearance',
  'billing',
  'usage',
  'referrals',
  'danger'
] as const;

export type SettingsModalSection = (typeof SETTINGS_MODAL_SECTIONS)[number];

/** La sezione su cui si apre il modal (stessa scelta del redirect di /settings). */
export const SETTINGS_MODAL_DEFAULT: SettingsModalSection = 'connected-accounts';

/**
 * Sezioni che vogliono la taglia larga del modal: griglie, anteprime, tabelle e
 * grafici che a 880px si strizzano. Non è un'esclusione, è una misura.
 */
export const SETTINGS_MODAL_WIDE = [
  'brand',
  'platforms',
  'products',
  'people',
  'voice-examples',
  'library',
  'blog-appearance',
  'ads/accounts',
  'ads',
  'video',
  'usage',
  'radar'
] as const;

/**
 * Il rail del modal: STESSO ordine e stessi raggruppamenti della SettingsSidebar vera
 * (src/lib/components/SettingsSidebar.svelte) — chi apre il modal ritrova la mappa che
 * già conosce. Le chiavi i18n sono quelle già esistenti: nessun doppione.
 * `flag` nasconde la voce quando la feature è spenta, esattamente come nella sidebar.
 */
export type SettingsNavEntry = {
  /** Sezione modal, oppure rotta full-page (allora la voce mostra ↗ e naviga davvero). */
  section: string;
  labelKey: string;
  flag?: 'ads' | 'connectors';
};

export const SETTINGS_MODAL_GROUPS: readonly {
  labelKey: string;
  items: readonly SettingsNavEntry[];
}[] = [
  {
    labelKey: 'app.nav.sectionBrand',
    items: [
      { section: 'brand', labelKey: 'app.studio.tabs.brand' },
      { section: 'platforms', labelKey: 'app.studio.tabs.platforms' },
      { section: 'hashtags', labelKey: 'app.studio.tabs.hashtags' },
      { section: 'voice-examples', labelKey: 'app.studio.tabs.voiceExamples' },
      { section: 'products', labelKey: 'app.hub.overview.brand.products' },
      { section: 'people', labelKey: 'app.studio.tabs.people' },
      { section: 'library', labelKey: 'app.hub.web.library' },
      { section: 'demo-account', labelKey: 'app.settings.demoAccount.nav' }
    ]
  },
  {
    labelKey: 'app.nav.site',
    items: [
      { section: 'blog-appearance', labelKey: 'app.settings.blog.appearance' },
      { section: 'blog-authors', labelKey: 'app.settings.blog.authors' },
      { section: 'blog-categories', labelKey: 'app.settings.blog.categories' },
      { section: 'blog-domain', labelKey: 'app.settings.blog.domain' },
      { section: 'blog-integrations', labelKey: 'app.settings.blog.integrations' },
      { section: 'search-console', labelKey: 'app.settings.blog.searchConsole' }
    ]
  },
  {
    labelKey: 'app.settings.ads.nav',
    items: [
      { section: 'ads/accounts', labelKey: 'app.settings.ads.accountsNav', flag: 'ads' },
      { section: 'ads', labelKey: 'app.settings.ads.budgetNav', flag: 'ads' }
    ]
  },
  {
    labelKey: 'app.nav.sectionPublishing',
    items: [
      { section: 'connected-accounts', labelKey: 'app.settings.connectedAccounts' },
      { section: 'connectors', labelKey: 'app.settings.connectors.nav', flag: 'connectors' },
      { section: 'autopilot', labelKey: 'app.settings.autopilot' },
      { section: 'radar', labelKey: 'app.settings.radar.nav' },
      { section: 'video', labelKey: 'app.settings.video.title' },
      { section: 'publishing', labelKey: 'app.settings.publishing.title' },
      { section: 'timezone', labelKey: 'app.settings.postingTimezone' }
    ]
  },
  {
    labelKey: 'app.nav.workspace',
    items: [
      { section: 'language', labelKey: 'app.settings.language' },
      { section: 'api-keys', labelKey: 'app.settings.apiKeys.title' },
      { section: 'team', labelKey: 'app.settings.team.title' }
    ]
  },
  {
    labelKey: 'app.nav.sectionAccount',
    items: [
      { section: 'profile', labelKey: 'app.settings.profile.title' },
      { section: 'appearance', labelKey: 'app.settings.appearance.title' },
      { section: 'billing', labelKey: 'app.settings.billing.title' },
      { section: 'usage', labelKey: 'app.settings.usage.title' },
      { section: 'referrals', labelKey: 'app.settings.referrals.title' },
      { section: 'danger', labelKey: 'app.settings.del.title' }
    ]
  }
] as const;
