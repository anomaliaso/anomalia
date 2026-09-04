import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { failuresOf, shown, type ActivityRow, type PlatformRow, type TopPost } from './tally';

type BrandRead = {
  brand: { name: string; slug: string; timezone: string };
};

type Analytics = {
  total: number;
  scheduled: number;
  pending: number;
  failed: number;
  socialPerformance: PlatformRow[];
  topPosts: TopPost[];
  recentActivity: ActivityRow[];
  accounts: number;
};

type SeoRead = {
  metrics: {
    traffic: number | null;
    organicKeywords: number | null;
    keywordsTop10: number | null;
    domainRating: number | null;
    referringDomains: number | null;
    backlinks: number | null;
  };
};

type GeoRead = {
  audit: { tech_score: number | null; share_of_voice: number | null } | null;
  citability: { score?: number } | null;
};

function brandApi(slug: string, path: string): string {
  return `/api/v1/brands/${encodeURIComponent(slug)}${path}`;
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Request failed (${res.status})`;
}

export const load: PageServerLoad = async ({ params, fetch, locals }) => {
  const { session } = await locals.safeGetSession();
  if (!session) {
    redirect(303, '/login');
  }

  const headers = { Authorization: `Bearer ${session.access_token}` };

  const [brandRes, analyticsRes, seoRes, geoRes] = await Promise.all([
    fetch(brandApi(params.brand, ''), { headers }),
    fetch(brandApi(params.brand, '/analytics'), { headers }),
    fetch(brandApi(params.brand, '/seo'), { headers }),
    fetch(brandApi(params.brand, '/geo'), { headers })
  ]);

  if (!brandRes.ok) {
    error(brandRes.status, await readError(brandRes));
  }
  if (!analyticsRes.ok) {
    error(analyticsRes.status, await readError(analyticsRes));
  }

  const { brand } = (await brandRes.json()) as BrandRead;
  const analytics = (await analyticsRes.json()) as Analytics;

  const seo = seoRes.ok ? ((await seoRes.json()) as SeoRead) : null;
  const geo = geoRes.ok ? ((await geoRes.json()) as GeoRead) : null;

  return {
    brand: { slug: params.brand, name: brand.name, timezone: brand.timezone },
    counts: {
      total: analytics.total,
      scheduled: analytics.scheduled,
      pending: analytics.pending,
      failed: analytics.failed,
      accounts: analytics.accounts
    },
    platforms: analytics.socialPerformance,
    topPosts: analytics.topPosts,
    failures: failuresOf(analytics.recentActivity),
    web: shown([
      { label: 'Organic traffic', value: seo?.metrics.traffic },
      { label: 'Ranking keywords', value: seo?.metrics.organicKeywords },
      { label: 'In the top 10', value: seo?.metrics.keywordsTop10 },
      { label: 'Domain rating', value: seo?.metrics.domainRating },
      { label: 'Referring domains', value: seo?.metrics.referringDomains },
      { label: 'Backlinks', value: seo?.metrics.backlinks },
      { label: 'AI share of voice', value: geo?.audit?.share_of_voice },
      { label: 'Citability', value: geo?.citability?.score }
    ])
  };
};
