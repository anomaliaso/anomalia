import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createAdminClient } from '$lib/server/supabase-admin';
import { cronAuthorized } from '$lib/server/cron-auth';
import { briefFor, briefToPrompt } from '$lib/server/market-brief';

// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~60s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 60 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

/**
 * GET /api/v1/market/brief?form=talking_head&category=food
 *
 * The matched cohort for a (vertical, form): what beat its own account's median, and what did not.
 *
 * Exposed as its own endpoint on purpose. The same function backs the market block inside a video
 * review, so a caller gets one consistent answer either way — but keeping the cohort reachable on
 * its own means changing how it is built never touches the review, and the score the user has
 * already seen never moves because we widened a bucket.
 *
 * `level` is the field to read first: `category+form` when the specific cell is full enough,
 * `form` when only the general one is, and `none` when neither is — in which case there is no
 * finding here and the right thing to render is nothing.
 */
export const GET: RequestHandler = async ({ request, url }) => {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  try {
    const brief = await briefFor(createAdminClient(), {
      category: url.searchParams.get('category'),
      contentForm: url.searchParams.get('form'),
      limit: Number(url.searchParams.get('limit') ?? '') || undefined
    });

    return json({
      ok: true,
      ...brief,
      // The exact text the planner is given, so what the model reads is inspectable from outside
      // rather than reconstructable only by reading the prompt builder.
      prompt: briefToPrompt(brief),
      notes:
        brief.level === 'none'
          ? ['Coorte troppo magra per dire qualcosa. Nessun percentile è meglio di uno inventato su poche righe.']
          : brief.level === 'form'
            ? ['Coorte per forma, non per verticale: tendenza generale, non regola di settore.']
            : []
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[market/brief]', message);
    return json({ ok: false, error: message }, { status: 500 });
  }
};
