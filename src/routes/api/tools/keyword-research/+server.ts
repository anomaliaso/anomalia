import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { FREE_KEYWORD_LIMIT, researchPublicKeywords } from '$lib/server/keyword-research-public';
import { guardTool } from '$lib/server/tool-guard';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~90s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 90 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  // Counted BEFORE the Gemini + DataForSEO spend, never after.
  const guard = await guardTool('keyword-research', getClientAddress());
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json();
    const input = typeof body?.input === 'string' ? body.input : typeof body?.url === 'string' ? body.url : '';
    if (!input.trim()) {
      return json({ error: 'Website URL or niche keyword is required' }, { status: 400 });
    }

    const research = await researchPublicKeywords(input);
    if (!research) {
      return json(
        { error: 'Could not research keywords for that input. Try a clearer URL or niche.' },
        { status: 422 }
      );
    }

    // Free tier: expose only FREE_KEYWORD_LIMIT rows; keep totalFound so the UI can tease the rest.
    const freeKeywords = research.keywords.slice(0, FREE_KEYWORD_LIMIT);
    return json({
      success: true,
      research: {
        focusSummary: research.focusSummary,
        keywords: freeKeywords,
        totalFound: research.totalFound,
        freeLimit: FREE_KEYWORD_LIMIT,
        lockedCount: Math.max(0, research.totalFound - FREE_KEYWORD_LIMIT),
        source: research.source
      }
    });
  } catch (err) {
    console.error('[keyword-research-api]', err);
    return json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
};
