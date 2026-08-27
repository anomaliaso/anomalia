import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guardTool } from '$lib/server/tool-guard';
import { fetchKeywordSuggestions, dataforseoConfigured } from '$lib/server/dataforseo';
import { scoreOpportunity } from '$lib/server/seo-keyword-strategy';

const FREE_LIMIT = 15;

// Long-tail expansion around one seed keyword — real search volumes, no AI guessing.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const seed = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
  const lang = typeof body?.lang === 'string' ? body.lang : null;
  if (!seed) return json({ error: 'A seed keyword is required' }, { status: 400 });
  if (!dataforseoConfigured()) return json({ error: 'Keyword data is temporarily unavailable.' }, { status: 503 });

  const guard = await guardTool('long-tail', getClientAddress());
  if (!guard.ok) return guard.response;

  const suggestions = await fetchKeywordSuggestions(seed, lang, 40);
  if (!suggestions.length) return json({ error: 'No long-tail variants found for that seed. Try a broader term.' }, { status: 422 });

  // Easiest-first: the point of long-tail is winnable demand, not the biggest number.
  const ranked = suggestions
    .map((m) => ({ ...m, opportunity: scoreOpportunity(m.volume, m.difficulty) }))
    .sort((a, b) => a.difficulty - b.difficulty || b.volume - a.volume);

  return json({
    success: true,
    result: { seed, keywords: ranked.slice(0, FREE_LIMIT), totalFound: ranked.length, lockedCount: Math.max(0, ranked.length - FREE_LIMIT) }
  });
};
