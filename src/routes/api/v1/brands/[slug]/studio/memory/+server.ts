import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

// GET: list all memory entries for a brand
// POST: create a new memory entry
// DELETE: delete a memory entry (pass id in body)

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const category = url.searchParams.get('category') ?? undefined;
  const source = url.searchParams.get('source') ?? undefined;
  const threadId = url.searchParams.get('thread_id') ?? undefined;
  const layerParam = url.searchParams.get('layer') ?? undefined;

  const { loadMemoryEntries } = await import('$lib/server/brand-memory');
  const entries = await loadMemoryEntries(supabase, brand.id, {
    ...(category ? { category: category as 'voice' | 'constraint' | 'fact' | 'preference' | 'insight' } : {}),
    ...(source ? { source: source as 'chat' | 'research' | 'onboarding' | 'user' | 'analysis' } : {}),
    ...(threadId
      ? { layer: 'session' as const, threadId }
      : layerParam === 'session'
        ? { layer: 'session' as const }
        : {})
  });

  return json({ entries });
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json();
  const { key, value, category } = body;

  if (!key || !value || !category) {
    return json({ error: 'key, value, and category are required' }, { status: 400 });
  }

  const { writeMemory } = await import('$lib/server/brand-memory');
  const result = await writeMemory(supabase, brand.id, {
    key,
    value,
    category,
    source: 'user',
    confidence: 1.0
  });

  return json({ ok: true, ...result });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json();
  const { id } = body;

  if (!id) return json({ error: 'id is required' }, { status: 400 });

  const { deleteMemory } = await import('$lib/server/brand-memory');
  const failure = await deleteMemory(supabase, brand.id, id);
  if (failure) return json({ error: failure.error }, { status: failure.status });

  return json({ ok: true });
};
