import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getThread } from '$lib/server/chat/persistence';
import type { MemoryCategory } from '$lib/server/brand-memory';

/**
 * Cookie-auth session memory for the chat UI.
 * GET  ?thread_id=  — list session memories for this thread
 * PATCH { id, value? } — edit
 * POST  { action: 'promote', id } — promote to project knowledge
 * DELETE { id } — remove
 */

type BrandRow = { id: string; slug: string };

async function resolveBrandAndUser(
  supabase: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  safeGetSession: () => Promise<{ user: User | null } | any>,
  brandSlug: string
): Promise<{ user: User; brand: BrandRow } | Response> {
  const { user } = await safeGetSession();
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { data: brand } = await supabase
    .from('brands')
    .select('id, slug')
    .eq('slug', brandSlug)
    .maybeSingle();
  if (!brand) return json({ error: 'Brand not found' }, { status: 404 });

  return { user, brand: brand as BrandRow };
}

function isResponse(v: unknown): v is Response {
  return typeof Response !== 'undefined' && v instanceof Response;
}

export const GET: RequestHandler = async ({ url, params, locals: { supabase, safeGetSession } }) => {
  const resolved = await resolveBrandAndUser(supabase, safeGetSession, params.brand);
  if (isResponse(resolved)) return resolved;

  const threadId = url.searchParams.get('thread_id');
  if (!threadId) return json({ error: 'thread_id required' }, { status: 400 });

  const thread = await getThread(supabase, threadId, resolved.brand.id, resolved.user.id);
  if (!thread) return json({ error: 'Thread not found' }, { status: 404 });

  const { loadMemoryEntries } = await import('$lib/server/brand-memory');
  const entries = await loadMemoryEntries(supabase, resolved.brand.id, {
    layer: 'session',
    threadId
  });

  return json({ entries });
};

export const PATCH: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const resolved = await resolveBrandAndUser(supabase, safeGetSession, params.brand);
  if (isResponse(resolved)) return resolved;

  const body = await request.json();
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return json({ error: 'id required' }, { status: 400 });

  const { data: row } = await supabase
    .from('brand_memory')
    .select('id, layer')
    .eq('id', id)
    .eq('brand_id', resolved.brand.id)
    .maybeSingle();
  if (!row) return json({ error: 'Not found' }, { status: 404 });

  const patch: { value?: string; category?: MemoryCategory } = {};
  if (typeof body.value === 'string') patch.value = body.value;
  if (
    typeof body.category === 'string' &&
    ['voice', 'constraint', 'fact', 'preference', 'insight'].includes(body.category)
  ) {
    patch.category = body.category as MemoryCategory;
  }
  if (!Object.keys(patch).length) return json({ error: 'nothing to update' }, { status: 400 });

  const { updateMemoryEntry } = await import('$lib/server/brand-memory');
  await updateMemoryEntry(supabase, resolved.brand.id, id, patch);
  return json({ ok: true });
};

export const POST: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const resolved = await resolveBrandAndUser(supabase, safeGetSession, params.brand);
  if (isResponse(resolved)) return resolved;

  const body = await request.json();
  if (body.action !== 'promote') return json({ error: 'Unsupported action' }, { status: 400 });
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return json({ error: 'id required' }, { status: 400 });

  const { promoteMemoryToProject } = await import('$lib/server/brand-memory');
  const result = await promoteMemoryToProject(supabase, resolved.brand.id, id, resolved.user.id);
  return json({ ok: true, ...result });
};

export const DELETE: RequestHandler = async ({ request, params, locals: { supabase, safeGetSession } }) => {
  const resolved = await resolveBrandAndUser(supabase, safeGetSession, params.brand);
  if (isResponse(resolved)) return resolved;

  const body = await request.json();
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return json({ error: 'id required' }, { status: 400 });

  const { data: row } = await supabase
    .from('brand_memory')
    .select('id')
    .eq('id', id)
    .eq('brand_id', resolved.brand.id)
    .maybeSingle();
  if (!row) return json({ error: 'Not found' }, { status: 404 });

  const { deleteMemory } = await import('$lib/server/brand-memory');
  await deleteMemory(supabase, resolved.brand.id, id);
  return json({ ok: true });
};
