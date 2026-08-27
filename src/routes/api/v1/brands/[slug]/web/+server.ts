import { swallow } from '$lib/server/swallow';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { getWeb } from '$lib/server/cli-queries';
import { withBrandContext } from '$lib/server/ai-log';
import { createAdminClient } from '$lib/server/supabase-admin';

// Full article generation is a multi-call grounded pass.
export const config = { maxDuration: 300 };

// GET ?status=draft|published|scheduled|all — blog articles, DRAFTS INCLUDED.
// (The /articles endpoint next door is the published-only headless read API for external sites.)
export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  return json(await getWeb(supabase, brand.id, url.searchParams.get('status') ?? undefined));
};

// POST { action: 'generate' | 'optimize' | 'publish' | 'unpublish' | 'delete', topic?, id? }
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const { action, topic, id } = await request.json().catch(() => ({})) as
    { action?: string; topic?: string; id?: string };

  // brand_articles is SELECT-only under RLS — status changes and deletes go through the admin client.
  const admin = createAdminClient();

  // Status changes cost nothing: write scope is enough, no plan/credits gate.
  if (action === 'publish' || action === 'unpublish' || action === 'delete') {
    const write = checkApiKeyWriteAccess(apiKey);
    if (write) return write;
    if (!id) return json({ error: 'Missing id' }, { status: 400 });

    if (action === 'delete') {
      const { error: e } = await admin.from('brand_articles').delete().eq('id', id).eq('brand_id', brand.id);
      if (e) return json({ error: e.message }, { status: 500 });
      return json({ ok: true });
    }

    const publish = action === 'publish';
    const { error: e } = await admin.from('brand_articles')
      .update({ status: publish ? 'published' : 'draft', published_at: publish ? new Date().toISOString() : null })
      .eq('id', id).eq('brand_id', brand.id);
    if (e) return json({ error: e.message }, { status: 500 });

    // Instant indexing on manual publish: IndexNow + Exa, fire-and-forget.
    if (publish) {
      const { data: a } = await admin.from('brand_articles').select('slug').eq('id', id).maybeSingle();
      const { notifyIndexers } = await import('$lib/server/indexing');
      if (a?.slug) void notifyIndexers(admin, brand.id, [a.slug]).catch(swallow('notify indexers'));
    }
    return json({ ok: true, status: publish ? 'published' : 'draft' });
  }

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  return withBrandContext(brand.id, async () => {
    if (action === 'generate') {
      if (!topic) return json({ error: 'Missing topic' }, { status: 400 });
      const { generateArticleFromTopic } = await import('$lib/server/blog-generate');
      const articleId = await generateArticleFromTopic(admin, brand, topic);
      if (!articleId) return json({ error: 'Could not generate the article' }, { status: 502 });
      return json({ ok: true, articleId });
    }

    if (action === 'optimize') {
      if (!id) return json({ error: 'Missing id' }, { status: 400 });
      const { optimizeArticleForScore } = await import('$lib/server/blog-generate');
      await optimizeArticleForScore(admin, brand, id);
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, { status: 400 });
  });
};
