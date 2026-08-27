import type { RequestHandler } from './$types';
import {
  siteUrl,
  MARKETING_PATHS,
  PLAYBOOK_SLUGS,
  STATIC_SITEMAP_PATHS,
  SITEMAP_LOCALES,
  localizedPath
} from '$lib/seo';
import { INSIGHT_SLUGS } from '$lib/data/insights';
import { STYLE_PRESETS } from '$lib/design/presets';
import { createAdminClient } from '$lib/server/supabase-admin';
import { listWallSlugs } from '$lib/server/wall';
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

  const marketingEntries = MARKETING_PATHS.flatMap((path) => {
    const priority =
      path === '/' ? '1.0' : path.startsWith('/insights') || path.startsWith('/tools') ? '0.8' : '0.7';
    return localizedUrlEntries(site, path, priority);
  });

  const staticEntries = STATIC_SITEMAP_PATHS.map(
    (path) => `  <url>
    <loc>${loc(path)}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>`
  );

  const playbookEntries = PLAYBOOK_SLUGS.flatMap((slug) =>
    localizedUrlEntries(site, `/playbooks/${slug}`, '0.6')
  );

  const insightEntries = INSIGHT_SLUGS.flatMap((slug) =>
    localizedUrlEntries(site, `/insights/${slug}`, '0.75', 'monthly')
  );

  const admin = createAdminClient();
  const [{ data: blogs }, { data: talentRows }, { data: agentRows }, wallSlugs] = await Promise.all([
    admin.from('brands').select('blog_slug').not('blog_slug', 'is', null),
    admin.from('talents').select('slug').eq('status', 'active'),
    admin.from('agent_templates').select('slug').eq('status', 'published'),
    listWallSlugs(admin)
  ]);
  const blogEntries = (blogs ?? []).map(
    (b) => `  <url>
    <loc>${site}/blog/${b.blog_slug}/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`
  );

  const talentEntries = (talentRows ?? []).flatMap((t) =>
    localizedUrlEntries(site, `/talents/${t.slug}`, '0.6')
  );

  // Agent Library: /agents is already in MARKETING_PATHS; these are the per-agent pages.
  const agentEntries = (agentRows ?? []).flatMap((a) =>
    localizedUrlEntries(site, `/agents/${a.slug}`, '0.7')
  );

  // Style presets live in code, not in a table — no query, just the library itself.
  // The /styles index is already in MARKETING_PATHS; these are the per-preset pages.
  const styleEntries = STYLE_PRESETS.flatMap((p) =>
    localizedUrlEntries(site, `/styles/${p.slug}`, '0.6', 'monthly')
  );

  // One entry per post on the design wall. `lastmod` is the day it was published to the wall — the
  // page's content does not change after that, and claiming it did would train the crawler to
  // ignore the field.
  const wallEntries = wallSlugs.flatMap((w) => {
    const entries = localizedUrlEntries(site, `/design/${w.slug}`, '0.5', 'monthly');
    if (!w.updatedAt) return entries;
    const day = w.updatedAt.slice(0, 10);
    return entries.map((e) => e.replace('</url>', `  <lastmod>${day}</lastmod>\n  </url>`));
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${marketingEntries.join('\n')}
${staticEntries.join('\n')}
${playbookEntries.join('\n')}
${insightEntries.join('\n')}
${talentEntries.join('\n')}
${agentEntries.join('\n')}
${styleEntries.join('\n')}
${wallEntries.join('\n')}
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
