import { env as publicEnv } from '$env/dynamic/public';
import { SUPPORTED, localePath, type Locale } from '$lib/i18n/locale';

// Canonical site origin (no trailing slash). Prefer the configured PUBLIC_APP_URL (also used by
// the cron emails), fall back to the request origin, then to the production domain.
// Production serves www; the apex and the legacy domains 308 here. Keep FALLBACK in sync with the
// live host: a canonical/sitemap URL on a redirecting host is what makes strict crawlers report
// robots.txt as unfetchable.
function fallbackSite(): string {
  return publicEnv.PUBLIC_FALLBACK_APP_URL || 'https://www.anomalia.so';
}

export function siteUrl(reqOrigin?: string): string {
  return (publicEnv.PUBLIC_APP_URL || reqOrigin || fallbackSite()).replace(/\/$/, '');
}

export const SITEMAP_LOCALES: readonly Locale[] = SUPPORTED;

// Indexable marketing pages, in English-canonical form. Locale variants are derived for
// sitemap hreflang alternates. Excludes /waitlist (noindex) and everything under /app.
export const MARKETING_PATHS = [
  '/',
  '/usecases',
  '/pricing',
  '/faq',
  '/privacy',
  '/terms',
  '/cookies',
  '/changelog',
  '/agosto',
  '/no-time',
  '/overwhelmed',
  '/content-ideas',
  '/cant-afford',
  '/multiple-accounts',
  '/not-working',
  '/ai-vs-human',
  '/autopilot',
  '/grow',
  '/ads',
  '/ai-seo-agent',
  '/ai-blog-writer',
  '/autoblog',
  '/autoposts',
  '/leads-finder',
  '/news-radar',
  '/playbooks',
  '/talents',
  '/agents',
  '/styles',
  // The two public walls (0199). Indexed like any other marketing page; the per-post detail
  // pages are added to the sitemap from the database, since they are rows and not routes.
  '/trending',
  '/design',
  '/insights',
  '/cursor-mcp-motion-ads',
  '/compare',
  '/compare/buffer-vs-hootsuite',
  '/compare/buffer-vs-later',
  '/compare/later-vs-predis-ai',
  '/compare/predis-ai-vs-taplio',
  '/compare/hootsuite-vs-sprout-social',
  '/burnout',
  '/consistency',
  '/engagement',
  '/roi',
  '/posting-schedule',
  '/no-results',
  '/scheduling',
  '/analytics',
  '/content-calendar',
  '/automation',
  '/strategy',
  '/caption-writer',
  '/tools/agent-team',
  '/tools/geo-audit',
  '/tools/keyword-research',
  '/tools/sitemap-analyzer',
  '/tools/social-media-roi',
  '/tools/llms-txt-generator',
  '/tools/llms-txt-validator',
  '/tools/caption-length',
  '/tools/best-time-to-post',
  '/docs',
  '/docs/getting-started',
  '/docs/credits',
  '/docs/cli',
  '/docs/api',
  '/docs/api/strategy',
  '/docs/api/analytics',
  '/docs/api/brands',
  '/docs/api/products',
  '/docs/api/posts',
  '/docs/api/studio',
  '/docs/api/editorial-plan',
  '/docs/api/articles',
  '/docs/agents',
  '/docs/brands',
  '/docs/editorial-plan',
  '/docs/studio',
  '/docs/brand-memory',
  '/docs/radar',
  '/docs/gtm-strategy',
  '/docs/thematic-calendar',
  '/docs/weekly-recap',
  '/docs/shopify',
  '/docs/content-library',
  '/docs/seo-advisor',
  '/docs/post-history',
  '/docs/geo-audit',
  '/docs/research',
  '/docs/blog-hosting',
  '/docs/webflow',
  '/docs/wix',
  '/docs/team-invites'
] as const;

/** Dynamic playbook pages — one per profession. */
export const PLAYBOOK_SLUGS = [
  'restaurant',
  'cafe',
  'bakery',
  'pizzeria',
  'ecommerce',
  'fashion-brand',
  'jewelry-store',
  'pet-shop',
  'dental-clinic',
  'chiropractor',
  'nutritionist',
  'mental-health',
  'hair-salon',
  'nail-studio',
  'spa',
  'barbershop',
  'gym',
  'yoga-studio',
  'personal-trainer',
  'crossfit-box',
  'law-firm',
  'real-estate',
  'accountant',
  'cleaning-service',
  'photographer',
  'agency',
  'freelancer',
  'coach',
  'hotel',
  'auto-shop',
  'plumber',
  'electrician'
] as const;

/** Static files that should appear in the sitemap but aren't marketing HTML pages. */
export const STATIC_SITEMAP_PATHS = [
  '/llms.txt',
  '/homepage.md',
  '/pricing.md',
  '/usecases.md'
] as const;

/** Pain / problem landings — linked from footer for crawl paths. */
export const PAIN_PATHS = [
  '/no-time',
  '/overwhelmed',
  '/burnout',
  '/cant-afford',
  '/not-working',
  '/no-results',
  '/consistency',
  '/multiple-accounts'
] as const;

/** Localized path for any supported marketing locale. */
export function localizedPath(path: string, lang: Locale): string {
  return localePath(path, lang);
}

/** @deprecated Prefer localizedPath(path, 'it') */
export function itPath(path: string): string {
  return localePath(path, 'it');
}
