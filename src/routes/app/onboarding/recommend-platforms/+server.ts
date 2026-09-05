import type { RequestHandler } from './$types';
import { canEnter, ownsBrand } from '$lib/server/access';
import { genaiClient } from '$lib/server/research';
import { aiStructured } from '$lib/server/ai-text';
import { localeLanguageName } from '$lib/i18n/locale';
import { logOnboardingError } from '$lib/server/onboarding-errors';
import { withBrandContext } from '$lib/server/ai-log';

// Anomalia's publish-platform recommendation for the socials step. A light, single structured LLM read of
// the already-analyzed brand that returns the 2-4 platforms it should publish on (most important
// first) + a one-line rationale in the user's language. The wizard pre-selects these and badges them
// as "recommended" before the deep research runs. Best-effort: an empty result just means no badge.
// Tetto condiviso, non budget: il lavoro vero di questa rotta sta in ~30s. Su Vercel ogni
// valore distinto di `maxDuration` fa emettere ad adapter-vercel una funzione serverless
// INTERA (~90 MB di node_modules ricopiati), quindi gli scaglioni sono solo tre: 300, 800,
// 1800. Rimetterlo a 30 non rende la rotta più sicura: aggiunge una funzione da 90 MB.
export const config = { maxDuration: 300 };

// Subset of PLATFORM_KEYS the recommender may pick (major publish networks).
const ALLOWED = ['instagram', 'tiktok', 'facebook', 'linkedin', 'x', 'threads', 'youtube'] as const;

const SCHEMA = {
  type: 'object' as const,
  properties: {
    recommended: {
      type: 'array' as const,
      items: { type: 'string' as const, enum: ALLOWED },
      description: '2-4 platforms this brand should publish on, most important first'
    },
    rationale: {
      type: 'string' as const,
      description: 'One short sentence (in the requested language) on why these platforms fit this brand'
    }
  },
  required: ['recommended', 'rationale']
};

export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession, locale } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const body = await request.json().catch(() => ({}));
  const brandId = typeof body?.brandId === 'string' ? body.brandId : null;
  if (brandId && !(await ownsBrand(supabase, brandId))) return new Response('Forbidden', { status: 403 });
  if (!brandId) return new Response('Missing brandId', { status: 400 });
  return withBrandContext(brandId, async () => {
    const profile = body?.profile ?? {};
  const outputLanguage = localeLanguageName(locale);

  try {
    const ai = genaiClient();
    const prompt = `Recommend the best social platforms for this brand to PUBLISH on, choosing ONLY from: ${ALLOWED.join(', ')}.

Brand: ${profile?.name ?? ''}
Category: ${profile?.category ?? ''}
Archetype: ${profile?.site_type ?? ''}
About: ${String(profile?.about ?? '').slice(0, 600)}
Target audience: ${profile?.target_audience ?? ''}

Pick the 2-4 platforms where THIS brand's audience and content format will perform best (most important first). Be realistic for the niche — don't just list the biggest networks. Write the one-line rationale in ${outputLanguage}.`;
    const out = await aiStructured<{ recommended: string[]; rationale: string }>(
      ai,
      prompt,
      SCHEMA,
      'You are a senior social-media strategist. Recommend platforms grounded in the brand and its audience, not generic advice.'
    );
    const recommended = (Array.isArray(out.recommended) ? out.recommended : [])
      .map((p) => String(p).toLowerCase())
      .filter((p) => (ALLOWED as readonly string[]).includes(p));
    return new Response(JSON.stringify({ recommended, rationale: out.rationale ?? '' }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    await logOnboardingError(supabase, user.id, 'recommend_platforms', e, {});
    // Non-fatal: the socials step works without a recommendation.
    return new Response(JSON.stringify({ recommended: [], rationale: '' }), {
      headers: { 'content-type': 'application/json' }
    });
  }
  });
};
