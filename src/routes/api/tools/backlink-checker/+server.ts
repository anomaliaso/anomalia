import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { guardTool } from '$lib/server/tool-guard';
import { fetchBacklinkSummary, dataforseoConfigured } from '$lib/server/dataforseo';
import type { Issue } from '$lib/server/seo-tools';

// Backlink profile snapshot. This is the most expensive tool we expose for free (DataForSEO's
// Backlinks API, not Labs), so it carries the tightest per-IP and global daily caps in
// tool-guard — the ceiling is deliberately low enough that a bad day is a rounding error.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const body = await request.json().catch(() => ({}));
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!url) return json({ error: 'A domain is required' }, { status: 400 });
  if (!dataforseoConfigured()) return json({ error: 'Backlink data is temporarily unavailable.' }, { status: 503 });

  const guard = await guardTool('backlink-checker', getClientAddress());
  if (!guard.ok) return guard.response;

  const summary = await fetchBacklinkSummary(url);
  if (!summary) return json({ error: 'Could not read backlink data for that domain.' }, { status: 422 });

  const issues: Issue[] = [];
  if (summary.referringDomains < 10) {
    issues.push({ severity: 'high', title: 'Very few referring domains', detail: `${summary.referringDomains} domains link to you. Referring domains — not raw link count — are what moves rankings.` });
  }
  if (summary.spamScore > 30) {
    issues.push({ severity: 'medium', title: `Spam score ${summary.spamScore}`, detail: 'A meaningful share of your links come from low-quality sources. Worth auditing before it becomes a liability.' });
  }
  if (summary.brokenBacklinks > 0) {
    issues.push({ severity: 'medium', title: `${summary.brokenBacklinks} broken backlinks`, detail: 'These point at pages that no longer resolve — earned authority currently going nowhere. Redirect the dead URLs.' });
  }
  if (summary.backlinks > 0 && summary.dofollow / summary.backlinks < 0.3) {
    issues.push({ severity: 'low', title: 'Mostly nofollow links', detail: 'Under a third of your links pass authority. Not harmful, but the profile is weaker than the raw count suggests.' });
  }

  return json({ success: true, result: { ...summary, issues } });
};
