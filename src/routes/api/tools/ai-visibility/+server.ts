import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guardTool } from '$lib/server/tool-guard';
import { fetchSerpSnapshot, dataforseoConfigured } from '$lib/server/dataforseo';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

// How many keywords we sample. Each one is a live SERP task, so this is the tool's cost
// multiplier — three is enough to show a pattern without turning one run into ten.
const MAX_KEYWORDS = 3;

/**
 * Does Google's AI Overview cite you? Same SERP call as the rank checker, read for a different
 * question: whether an AI Overview appears at all for the query, and which domains it pulls from.
 * That answers the thing every brand now asks — "am I in the AI answer, or just below it?"
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  const lang = typeof body?.lang === 'string' ? body.lang : null;
  const keywords = (typeof body?.keywords === 'string' ? body.keywords : '')
    .split(/[\n,]/).map((k: string) => k.trim()).filter(Boolean).slice(0, MAX_KEYWORDS);
  if (!url || !keywords.length) return json({ error: 'A domain and at least one keyword are required' }, { status: 400 });
  if (!dataforseoConfigured()) return json({ error: 'Search data is temporarily unavailable.' }, { status: 503 });

  const guard = await guardTool('ai-visibility', getClientAddress());
  if (!guard.ok) return guard.response;

  const domain = url.replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0];
  const snapshots = (await Promise.all(keywords.map((k: string) => fetchSerpSnapshot(k, url, lang)))).filter(Boolean);
  if (!snapshots.length) return json({ error: 'Could not read those SERPs. Try again shortly.' }, { status: 422 });

  const rows = snapshots.map((s) => ({
    keyword: s!.keyword,
    hasAiOverview: s!.hasAiOverview,
    cited: s!.aiOverviewSources.includes(domain),
    organicPosition: s!.yourPosition,
    citedSources: s!.aiOverviewSources.slice(0, 8)
  }));

  const withOverview = rows.filter((r) => r.hasAiOverview);
  return json({
    success: true,
    result: {
      domain,
      rows,
      // The gap that matters: queries where an AI Overview exists and someone else is cited.
      aiOverviewCount: withOverview.length,
      citedCount: withOverview.filter((r) => r.cited).length,
      // Who keeps showing up instead of you, across the sampled queries.
      topCompetingSources: Object.entries(
        withOverview.flatMap((r) => r.citedSources).reduce<Record<string, number>>((acc, d) => {
          if (d !== domain) acc[d] = (acc[d] ?? 0) + 1;
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([domain, count]) => ({ domain, count }))
    }
  });
};
