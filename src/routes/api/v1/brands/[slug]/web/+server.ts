import { json } from '@sveltejs/kit';
import type { RequestEvent, RequestHandler } from './$types';
import { authenticate, loadBrandForUser } from '$lib/server/cli-auth';
import { getWeb } from '$lib/server/cli-queries';
import { DELETE as remove } from './article/[id]/+server';
import { POST as optimize } from './article/[id]/optimize/+server';
import { POST as publish } from './article/[id]/publish/+server';
import { POST as unpublish } from './article/[id]/unpublish/+server';
import { POST as generate } from './generate/+server';

// GET ?status=draft|published|scheduled|all — blog articles, DRAFTS INCLUDED.
// (The /articles endpoint next door is the published-only headless read API for external sites.)
export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;
  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  return json(await getWeb(supabase, brand.id, url.searchParams.get('status') ?? undefined));
};

// Ogni azione ha la sua rotta. Questa resta per compatibilità: `action` sceglie a quale inoltrare
// e `id` diventa il segmento di percorso che era già, e nient'altro accade qui.
type ArticleEvent = RequestEvent & { params: RequestEvent['params'] & { id: string } };

const FORWARD: Record<string, (event: ArticleEvent) => Promise<Response>> = {
  generate,
  optimize,
  publish,
  unpublish,
  delete: remove
};

export const POST: RequestHandler = async (event) => {
  const { action, id } = (await event.request.clone().json().catch(() => ({}))) as {
    action?: string;
    id?: string;
  };
  const forward = FORWARD[String(action ?? '')];
  if (!forward) return json({ error: `Unknown action: ${action}` }, { status: 400 });
  if (forward !== generate && !id) return json({ error: 'Missing id' }, { status: 400 });

  return forward({ ...event, params: { ...event.params, id: String(id ?? '') } });
};
