import type { RequestHandler } from './$types';
import { siteUrl } from '$lib/seo';
import { createAdminClient } from '$lib/server/supabase-admin';

// Crawlers may index the marketing pages; keep them out of the app, API, auth and the
// personalised waitlist confirmation. Points to the sitemap for discovery — plus one Sitemap:
// line per hosted blog so Google finds every per-blog article sitemap (they are not linked from
// the main sitemap, and robots.txt is the crawlable place Google reads them from).
export const GET: RequestHandler = async ({ url }) => {
  const site = siteUrl(url.origin);
  // Only ACTIVE brands that actually published something: ensureBlogSlug hands a blog_slug to
  // every brand, so listing them all turned robots.txt into a public customer roster that grows
  // without bound. A failure here must degrade to the static file, never to a 500.
  // ponytail: 1000 published articles scanned is plenty at our size; page it if that stops holding.
  let blogSitemaps = '';
  try {
    const admin = createAdminClient();
    const { data: published } = await admin
      .from('brand_articles')
      .select('brand_id')
      .eq('status', 'published')
      .limit(1000);
    const brandIds = [...new Set((published ?? []).map((a) => a.brand_id))];
    if (brandIds.length) {
      const { data: blogs } = await admin
        .from('brands')
        .select('blog_slug')
        .in('id', brandIds)
        .eq('status', 'active')
        .not('blog_slug', 'is', null)
        .order('blog_slug')
        .limit(200);
      blogSitemaps = (blogs ?? [])
        .map((b) => `Sitemap: ${site}/blog/${b.blog_slug}/sitemap.xml`)
        .join('\n');
    }
  } catch (e) {
    console.warn('[robots.txt] blog sitemap list failed:', e instanceof Error ? e.message : e);
  }

  const body = `User-agent: *
Allow: /
Disallow: /app
Disallow: /api
Disallow: /auth
Disallow: /approve
Disallow: /waitlist
Disallow: /it/waitlist

Sitemap: ${site}/sitemap.xml
${blogSitemaps}
`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  });
};
