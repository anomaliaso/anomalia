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
  'products',
  'people',
  'library',
  'demo-account',
  'connected-accounts',
  'connectors',
  'ads',
  'ads-accounts',
  'radar',
  'video',
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
  'referrals',
  'danger'
] as const;

/** Former Studio / Identity sections now under Settings → Brand. */
export const SETTINGS_BRAND_SECTIONS = [
  'brand',
  'products',
  'people'
] as const;

/** Blog settings under Settings → Blog. */
export const SETTINGS_BLOG_SECTIONS = [
  'blog-appearance',
  'blog-authors',
  'blog-categories',
  'blog-domain',
  'blog-integrations',
  'search-console'
] as const;

/** Ads settings under Settings → Ads. */
export const SETTINGS_ADS_SECTIONS = ['ads-accounts', 'ads'] as const;

/**
 * La mappa delle impostazioni: STESSO ordine e stessi raggruppamenti della SettingsSidebar
 * vera (src/lib/components/SettingsSidebar.svelte). La leggono il rail del drawer mobile e
 * la palette ⌘K: una lista sola, o le tre divergono al primo cambio.
 * `flag` nasconde la voce quando la feature è spenta, esattamente come nella sidebar.
 */
export type SettingsNavEntry = {
  /** Sezione sotto /app/<slug>/settings/. */
  section: string;
  labelKey: string;
  flag?: 'ads';
};

export const SETTINGS_GROUPS: readonly {
  labelKey: string;
  items: readonly SettingsNavEntry[];
}[] = [
  {
    labelKey: 'app.nav.sectionBrand',
    items: [
      { section: 'brand', labelKey: 'app.studio.tabs.brand' },
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
      { section: 'radar', labelKey: 'app.settings.radar.nav' },
      { section: 'video', labelKey: 'app.settings.video.title' }
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
      { section: 'referrals', labelKey: 'app.settings.referrals.title' },
      { section: 'danger', labelKey: 'app.settings.del.title' }
    ]
  }
] as const;
