import type { RequestHandler } from './$types';
import {
  siteUrl,
  MARKETING_PATHS,
  STATIC_SITEMAP_PATHS,
  SITEMAP_LOCALES,
  localizedPath
} from '$lib/seo';
import { INSIGHT_SLUGS } from '$lib/data/insights';
import { createAdminClient } from '$lib/server/supabase-admin';
import { hideMarketing } from '$lib/server/marketing-shell';
import { env } from '$env/dynamic/private';
import type { Locale } from '$lib/i18n/locale';

function alternateLinks(site: string, path: string): string {
  const lines = SITEMAP_LOCALES.map((lang: Locale) => {
    const href = site + localizedPath(path, lang);
    return `      <xhtml:link rel="alternate" hreflang="${lang}" href="${href}"/>`;
  });
  const enHref = site + localizedPath(path, 'en');
  lines.push(`      <xhtml:link rel="alternate" hreflang="x-default" href="${enHref}"/>`);
  return '\n' + lines.join('\n');
}

function localizedUrlEntries(
  site: string,
  path: string,
  priority: string,
  changefreq = 'weekly'
): string[] {
  const alternates = alternateLinks(site, path);
  return SITEMAP_LOCALES.map((lang) => {
    const href = site + localizedPath(path, lang);
    return `  <url>
    <loc>${href}</loc>${alternates}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  });
}

// One <url> per language version of each marketing page, each carrying the full set of
// hreflang alternates (all SUPPORTED locales + x-default) so Google serves the right language.
// Static files (like /llms.txt) are included once without hreflang.
export const GET: RequestHandler = async ({ url }) => {
  const site = siteUrl(url.origin);
  const loc = (p: string) => site + (p === '/' ? '/' : p);
  // Con HIDE_MARKETING le URL del pitch 303-ano in /app: elencarle nel sitemap è un
  // invito a indicizzare dei redirect. Restano solo i blog ospitati, che non sono marketing.
  const appOnly = hideMarketing();

  const marketingEntries = appOnly
    ? []
    : MARKETING_PATHS.flatMap((path) => {
        const priority =
          path === '/' ? '1.0' : path.startsWith('/insights') || path.startsWith('/tools') ? '0.8' : '0.7';
        return localizedUrlEntries(site, path, priority);
      });

  const staticEntries = appOnly
    ? []
    : STATIC_SITEMAP_PATHS.map(
        (path) => `  <url>
    <loc>${loc(path)}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>`
      );

  const insightEntries = appOnly
    ? []
    : INSIGHT_SLUGS.flatMap((slug) => localizedUrlEntries(site, `/insights/${slug}`, '0.75', 'monthly'));

  // The dynamic entries live in Postgres. Only the "admin key not configured" case degrades to a
  // static-only map: it is a structural state (CI smoke tier, minimal self-host), and a permanent
  // 500 would be worse. In production the key exists, so a real query failure still throws and
  // returns 500 — the crawler keeps its last good copy of the sitemap instead of seeing half
  // the dynamic URLs vanish (missing lastmod signals) for exactly one fetch.
  let blogs: { blog_slug: string }[] | null = null;
  let agentRows: { slug: string }[] | null = null;
  if (!appOnly) {
    try {
      const admin = createAdminClient();
      const [blogRes, agentRes] = await Promise.all([
        admin.from('brands').select('blog_slug').not('blog_slug', 'is', null),
        admin.from('agent_templates').select('slug').eq('status', 'published')
      ]);
      blogs = blogRes.data;
      agentRows = agentRes.data;
    } catch (e) {
      if (env.SUPABASE_SERVICE_ROLE_KEY) throw e;
    }
  }
  const blogEntries = (blogs ?? []).map(
    (b) => `  <url>
    <loc>${site}/blog/${b.blog_slug}/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`
  );

  // Agent Library: /agents is already in MARKETING_PATHS; these are the per-agent pages.
  const agentEntries = (agentRows ?? []).flatMap((a) =>
    localizedUrlEntries(site, `/agents/${a.slug}`, '0.7')
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${marketingEntries.join('\n')}
${staticEntries.join('\n')}
${insightEntries.join('\n')}
${agentEntries.join('\n')}
${blogEntries.join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
};
