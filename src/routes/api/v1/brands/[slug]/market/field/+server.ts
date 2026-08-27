import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { createAdminClient } from '$lib/server/supabase-admin';
import { withBrandContext } from '$lib/server/ai-log';
import { runFieldWatch } from '$lib/server/market-field';

// Field watch — cosa gira nel CAMPO del brand e perché.
//   GET  → i topic osservati, il playbook distillato e i post catalogati con il loro teardown
//   POST → forza una passata (scopri → smonta → distilla); di norma la fa il cron giornaliero,
//          che tocca ogni brand una volta a settimana
//
// Una passata fa ricerche su più piattaforme e un teardown per ogni post nuovo.
export const config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20));
  const admin = createAdminClient();

  const [{ data: refs }, { data: links }] = await Promise.all([
    admin.from('brand_market_references').select('field_topics, field_playbook, field_updated_at').eq('brand_id', brand.id).maybeSingle(),
    admin.from('brand_field_posts').select('market_post_id, query, relevance, discovered_at').eq('brand_id', brand.id).order('discovered_at', { ascending: false }).limit(limit)
  ]);

  const ids = (links ?? []).map((l) => l.market_post_id as string);
  const [{ data: posts }, { data: teardowns }] = ids.length
    ? await Promise.all([
        admin.from('market_posts').select('id, platform, url, account_key, content, media_type, engagement, published_at').in('id', ids),
        admin.from('market_teardowns').select('market_post_id, tone_of_voice, communication, format, hook_type, spread_strategy, ragebait, ragebait_levers, why_it_spread, transferable, avoid').in('market_post_id', ids)
      ])
    : [{ data: [] }, { data: [] }];

  const postById = new Map((posts ?? []).map((p) => [p.id as string, p]));
  const teardownById = new Map((teardowns ?? []).map((t) => [t.market_post_id as string, t]));

  return json({
    topics: refs?.field_topics ?? null,
    playbook: refs?.field_playbook ?? null,
    updatedAt: refs?.field_updated_at ?? null,
    posts: (links ?? []).map((l) => ({
      ...(postById.get(l.market_post_id as string) ?? {}),
      query: l.query,
      relevance: l.relevance,
      discoveredAt: l.discovered_at,
      teardown: teardownById.get(l.market_post_id as string) ?? null
    }))
  });
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;
  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  return withBrandContext(brand.id, async () => {
    const out = await runFieldWatch(createAdminClient(), { id: brand.id, name: brand.name });
    return json({ ok: true, ...out });
  });
};
