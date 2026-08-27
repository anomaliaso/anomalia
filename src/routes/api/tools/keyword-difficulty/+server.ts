import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guardTool } from '$lib/server/tool-guard';
import { fetchKeywordOverview, dataforseoConfigured } from '$lib/server/dataforseo';
import { scoreOpportunity } from '$lib/server/seo-keyword-strategy';

// Difficulty + volume + CPC for up to 10 keywords at once. One DataForSEO Labs task regardless
// of how many keywords are sent, so batching is strictly cheaper than one call per keyword.
const MAX_KEYWORDS = 10;

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const raw = typeof body?.keywords === 'string' ? body.keywords : '';
  const lang = typeof body?.lang === 'string' ? body.lang : null;
  const keywords = raw.split(/[\n,]/).map((k: string) => k.trim()).filter(Boolean).slice(0, MAX_KEYWORDS);
  if (!keywords.length) return json({ error: 'Enter at least one keyword' }, { status: 400 });
  if (!dataforseoConfigured()) return json({ error: 'Keyword data is temporarily unavailable.' }, { status: 503 });

  const guard = await guardTool('keyword-difficulty', getClientAddress());
  if (!guard.ok) return guard.response;

  const metrics = await fetchKeywordOverview(keywords, lang);
  if (!metrics.length) {
    return json({ error: 'No search data for those keywords. Try broader or more common terms.' }, { status: 422 });
  }

  return json({
    success: true,
    result: {
      keywords: metrics
        .map((m) => ({ ...m, opportunity: scoreOpportunity(m.volume, m.difficulty) }))
        .sort((a, b) => b.volume - a.volume),
      // Keywords DataForSEO had nothing for — usually a typo or genuinely zero demand, and
      // saying so is more useful than silently dropping them.
      notFound: keywords.filter((k: string) => !metrics.some((m) => m.keyword.toLowerCase() === k.toLowerCase()))
    }
  });
};
