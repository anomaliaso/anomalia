import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guardTool } from '$lib/server/tool-guard';
import { fetchDomainOverview, fetchDomainKeywords, dataforseoConfigured } from '$lib/server/dataforseo';

// Estimated organic traffic for any domain, plus the keywords driving it.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  const lang = typeof body?.lang === 'string' ? body.lang : null;
  if (!url) return json({ error: 'A domain is required' }, { status: 400 });
  if (!dataforseoConfigured()) return json({ error: 'Search data is temporarily unavailable.' }, { status: 503 });

  const guard = await guardTool('traffic-estimator', getClientAddress());
  if (!guard.ok) return guard.response;

  const [overview, topKeywords] = await Promise.all([
    fetchDomainOverview(url, lang),
    fetchDomainKeywords(url, lang, 10)
  ]);
  if (!overview) {
    // Zeros are a real answer ("this domain ranks for nothing"); a null means the lookup itself
    // failed, which is a different message.
    return json({ error: 'Could not read search data for that domain.' }, { status: 422 });
  }

  return json({ success: true, result: { ...overview, topKeywords } });
};
