import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  FREE_TOPIC_LIMIT,
  researchConversationGap
} from '$lib/server/conversation-gap-public';
import { guardTool } from '$lib/server/tool-guard';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~90s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 90 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

/**
 * Free conversation-gap tool.
 * Main number (range + gap score + confidence) is ungated.
 * Topic/thread list is stripped for anonymous callers — sign-in for the detail.
 */
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const guard = await guardTool('conversation-gap', getClientAddress());
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json().catch(() => ({}));
    const url = typeof body?.url === 'string' ? body.url : typeof body?.input === 'string' ? body.input : '';
    if (!url.trim()) {
      return json({ error: 'A website URL is required' }, { status: 400 });
    }

    let postsPerWeek: number | null = null;
    if (body?.postsPerWeek != null && body.postsPerWeek !== '') {
      const n = Number(body.postsPerWeek);
      if (!Number.isFinite(n) || n <= 0) {
        return json({ error: 'postsPerWeek must be a positive number' }, { status: 400 });
      }
      postsPerWeek = n;
    }

    const research = await researchConversationGap(url, { postsPerWeek });
    if (!research) {
      return json(
        { error: 'Could not estimate conversation demand for that site. Try a clearer homepage URL.' },
        { status: 422 }
      );
    }

    const freeTopics = research.topics.slice(0, FREE_TOPIC_LIMIT);
    return json({
      success: true,
      result: {
        focusSummary: research.focusSummary,
        brandLabel: research.brandLabel,
        demandLow: research.demandLow,
        demandHigh: research.demandHigh,
        confidence: research.confidence,
        gapScore: research.gapScore,
        cadencePostsPerMonth: research.cadencePostsPerMonth,
        cadenceAssumed: research.cadenceAssumed,
        topics: freeTopics,
        totalTopics: research.totalTopics,
        freeLimit: FREE_TOPIC_LIMIT,
        lockedCount: Math.max(0, research.totalTopics - FREE_TOPIC_LIMIT),
        methodNotes: research.methodNotes,
        source: research.source
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    const known = /not reachable|too large|timed out|redirects|resolve|http\(s\)|Could not load|enough content/i.test(
      msg
    );
    if (!known) console.error('[conversation-gap-api]', err);
    return json(
      { error: known ? msg : 'An unexpected error occurred' },
      { status: known ? 400 : 500 }
    );
  }
};
