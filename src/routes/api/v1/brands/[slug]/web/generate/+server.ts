import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, gateAiAction } from '$lib/server/cli-auth';
import { withBrandContext } from '$lib/server/ai-log';
import { createAdminClient } from '$lib/server/supabase-admin';

// Full article generation is a multi-call grounded pass.
export const config = { maxDuration: 300 };

// POST { topic } — write a blog article draft. Consumes credits.
export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, apiKey, error } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const { topic } = (await request.json().catch(() => ({}))) as { topic?: string };
  if (!topic) return json({ error: 'Missing topic' }, { status: 400 });

  const gate = await gateAiAction(brand, apiKey);
  if (gate) return gate;

  return withBrandContext(brand.id, async () => {
    const { generateArticleFromTopic } = await import('$lib/server/blog-generate');
    const articleId = await generateArticleFromTopic(createAdminClient(), brand, topic);
    if (!articleId) return json({ error: 'Could not generate the article' }, { status: 502 });

    return json({ ok: true, articleId });
  });
};
