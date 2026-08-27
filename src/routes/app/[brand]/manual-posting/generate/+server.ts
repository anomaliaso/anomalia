import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { remaining } from '$lib/server/usage';
import { generateManualCaptions, normalizePlatforms } from '$lib/server/manual-posting';
import type { ContentPrefs } from '$lib/server/content-preview';

export const POST: RequestHandler = async ({ params, request, locals: { supabase, safeGetSession } }) => {
  const { session } = await safeGetSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, name, plan, timezone, content_prefs')
    .eq('slug', params.brand)
    .maybeSingle();
  if (!brand) return json({ error: 'brand_not_found' }, { status: 404 });

  const budget = await remaining(supabase, brand.id, brand.plan, brand.timezone ?? 'Europe/Rome');
  if (budget.credits.remaining <= 0) return json({ error: 'credits' }, { status: 402 });

  const body = (await request.json().catch(() => null)) as {
    platforms?: unknown;
    brief?: unknown;
    caption?: unknown;
    hasMedia?: unknown;
  } | null;
  const platforms = normalizePlatforms(body?.platforms);
  if (!platforms.length) return json({ error: 'no_platforms' }, { status: 400 });

  const { data: kit } = await supabase
    .from('brand_kit')
    .select('about, target_audience, brand_style, ai_character, ai_context')
    .eq('brand_id', brand.id)
    .maybeSingle();

  try {
    const result = await generateManualCaptions({
      brandId: brand.id,
      brandName: brand.name,
      kit,
      prefs: (brand.content_prefs as ContentPrefs) ?? {},
      input: {
        platforms,
        brief: String(body?.brief ?? ''),
        caption: String(body?.caption ?? ''),
        hasMedia: body?.hasMedia === true
      }
    });
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed';
    if (msg === 'missing_input' || msg === 'no_platforms') return json({ error: msg }, { status: 400 });
    console.error('[manual-posting] generate failed:', e);
    return json({ error: 'failed' }, { status: 500 });
  }
};
