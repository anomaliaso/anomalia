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
  '/cant-afford',
  '/multiple-accounts',
  '/not-working',
  '/autopilot',
  '/grow',
  '/ads',
  '/ai-seo-agent',
  '/ai-blog-writer',
  '/autoblog',
  '/autoposts',
  '/leads-finder',
  '/news-radar',
  '/agents',
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
  '/analytics',
  '/tools',
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
  '/docs/mcp',
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

/** Static files that should appear in the sitemap but aren't marketing HTML pages. */
export const STATIC_SITEMAP_PATHS = [
  '/llms.txt',
  '/homepage.md',
  '/pricing.md',
  '/usecases.md'
] as const;

/** Localized path for any supported marketing locale. */
export function localizedPath(path: string, lang: Locale): string {
  return localePath(path, lang);
}

/**
 * Public pages that no longer exist, and the page that took their job.
 *
 * A deleted route is a 404, and a 404 on a URL Google already knows costs the whole domain, not
 * just that page. So a page leaves the site in two moves that belong to the same commit: its row
 * lands here, and its path leaves MARKETING_PATHS. `src/lib/seo.retired.test.ts` holds both.
 *
 * The destination is chosen, never defaulted to '/': a 301 onto an irrelevant page is worth
 * almost as little as the 404 it replaced.
 */
export const RETIRED_PAGES: Record<string, string> = {
  // Programmatic SEO pages that sell a product Anomalia no longer is, and that 90 days of two
  // analytics systems agree nobody read: zero pageviews each. They were in the sitemap, though,
  // so each one leaves behind a 301 to the live page that makes the same promise today.
  '/ai-vs-human': '/cant-afford',
  '/automation': '/autoposts',
  '/caption-writer': '/autoposts',
  '/content-calendar': '/posting-schedule',
  '/content-ideas': '/autoposts',
  '/no-results': '/not-working',
  '/scheduling': '/posting-schedule',
  '/strategy': '/usecases',
  // The public walls and libraries (0199). The material they showed — post designs, the style
  // library, the talent roster, the industry playbooks — is NOT going anywhere: it stays in the
  // database and in the modules that read it, because its future is inside the product, handed
  // to the customer's own agent over MCP, not on a page the world browses. Only the pages go.
  '/design': '/autoposts',
  '/trending': '/news-radar',
  '/styles': '/autoposts',
  '/talents': '/usecases',
  '/playbooks': '/usecases',
  // Free tools nobody ever opened and Google was never told about: zero pageviews in 90 days
  // (PostHog and Vercel agree) and absent from MARKETING_PATHS since the day they were written.
  // The index still lists the nine that are actually used.
  '/tools/ai-visibility': '/tools/geo-audit',
  '/tools/backlink-checker': '/tools',
  '/tools/broken-links': '/tools/sitemap-analyzer',
  '/tools/competitor-gap': '/tools/keyword-research',
  '/tools/conversation-gap': '/tools',
  '/tools/heading-audit': '/tools',
  '/tools/keyword-difficulty': '/tools/keyword-research',
  '/tools/long-tail': '/tools/keyword-research',
  '/tools/meta-tags': '/tools',
  '/tools/page-speed': '/tools',
  '/tools/rank-checker': '/tools',
  '/tools/redirect-checker': '/tools/sitemap-analyzer',
  '/tools/robots-tester': '/tools/llms-txt-validator',
  '/tools/schema-validator': '/tools',
  '/tools/traffic-estimator': '/tools/keyword-research'
};

/**
 * Retired roots whose children were database rows rather than routes: every `/design/<slug>`,
 * `/playbooks/<slug>`, `/styles/<slug>` and `/talents/<slug>` that Google indexed needs the same
 * 301 as its root, and there were hundreds of them.
 */
const RETIRED_PREFIXES = ['/design/', '/playbooks/', '/styles/', '/talents/'];

/**
 * The 301 destination for a retired page, in the locale the visitor arrived in, or `null` when the
 * path is still live. The locale prefix is stripped before the lookup, so `/it/tools/meta-tags` and
 * `/tools/meta-tags` read the same row and land on the Italian and the English destination.
 */
export function retiredPageTarget(pathname: string, lang: Locale): string | null {
  const seg = pathname.split('/')[1];
  const bare = SUPPORTED.includes(seg as Locale) ? pathname.slice(seg.length + 1) || '/' : pathname;
  const path = bare.replace(/(.)\/$/, '$1');
  const prefix = RETIRED_PREFIXES.find((r) => path.startsWith(r));
  const dest = RETIRED_PAGES[prefix ? prefix.slice(0, -1) : path];

  return dest ? localizedPath(dest, lang) : null;
}

