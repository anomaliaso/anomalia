import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guardTool } from '$lib/server/tool-guard';
import { fetchSerpSnapshot, dataforseoConfigured } from '$lib/server/dataforseo';

// Live Google position for one domain on one keyword, plus the actual top 10 it competes with.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const keyword = typeof body?.keyword === 'string' ? body.keyword.trim() : '';
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  const lang = typeof body?.lang === 'string' ? body.lang : null;
  if (!keyword || !url) return json({ error: 'A keyword and a domain are required' }, { status: 400 });
  if (!dataforseoConfigured()) return json({ error: 'Search data is temporarily unavailable.' }, { status: 503 });

  const guard = await guardTool('rank-checker', getClientAddress());
  if (!guard.ok) return guard.response;

  const snapshot = await fetchSerpSnapshot(keyword, url, lang);
  if (!snapshot) return json({ error: 'Could not read that SERP. Try again shortly.' }, { status: 422 });

  return json({ success: true, result: snapshot });
};
