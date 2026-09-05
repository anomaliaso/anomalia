import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { UPDATE_MEMORY_ENTRY } from '@anomalia/api-contracts';

export const PATCH: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = UPDATE_MEMORY_ENTRY.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }

  const { updateMemoryEntry } = await import('$lib/server/brand-memory');
  await updateMemoryEntry(supabase, brand.id, params.id, parsed.data);

  return json({ ok: true });
};

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json().catch(() => ({}));
  if (body?.action !== 'promote') {
    return json({ error: 'Unsupported action' }, { status: 400 });
  }

  const { promoteMemoryToProject } = await import('$lib/server/brand-memory');
  const result = await promoteMemoryToProject(supabase, brand.id, params.id, user.id);
  return json({ ok: true, ...result });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const { deleteMemory } = await import('$lib/server/brand-memory');
  await deleteMemory(supabase, brand.id, params.id);

  return json({ ok: true });
};
