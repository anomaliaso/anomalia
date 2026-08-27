import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guardTool } from '$lib/server/tool-guard';
import { fetchKeywordGap, dataforseoConfigured } from '$lib/server/dataforseo';
import { scoreOpportunity } from '$lib/server/seo-keyword-strategy';

const FREE_LIMIT = 10;

// Keywords a competitor ranks for and you don't (or rank worse for) — the highest-intent
// keyword list there is, because someone in your market has already proven the demand converts.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const yourUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  const competitor = typeof body?.competitor === 'string' ? body.competitor.trim() : '';
  const lang = typeof body?.lang === 'string' ? body.lang : null;
  if (!yourUrl || !competitor) return json({ error: 'Both your domain and a competitor domain are required' }, { status: 400 });
  if (!dataforseoConfigured()) return json({ error: 'Search data is temporarily unavailable.' }, { status: 503 });

  const guard = await guardTool('competitor-gap', getClientAddress());
  if (!guard.ok) return guard.response;

  const gap = await fetchKeywordGap(yourUrl, competitor, lang, 50);
  if (!gap.length) {
    return json(
      { error: 'No keyword gap found. Either the domains do not overlap, or one of them has too little search presence.' },
      { status: 422 }
    );
  }

  const ranked = gap
    .map((k) => ({ ...k, opportunity: scoreOpportunity(k.volume, k.difficulty) }))
    .sort((a, b) => b.volume - a.volume);

  return json({
    success: true,
    result: {
      yourDomain: yourUrl,
      competitor,
      keywords: ranked.slice(0, FREE_LIMIT),
      totalFound: ranked.length,
      lockedCount: Math.max(0, ranked.length - FREE_LIMIT),
      // The subset where you're entirely absent is the sharpest version of the finding.
      missingEntirely: ranked.filter((k) => k.yourPosition == null).length
    }
  });
};
