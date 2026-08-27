import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { revokePublishedPost } from '$lib/server/publish';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  let reason: string | undefined;
  try {
    const body = await request.json();
    if (typeof body?.reason === 'string' && body.reason.trim()) reason = body.reason.trim();
  } catch {
    // Empty body → no reason.
  }

  const { data: post } = await supabase
    .from('posts')
    .select('id, status')
    .eq('id', params.id)
    .eq('brand_id', brand.id)
    .maybeSingle();

  if (!post) return json({ error: 'Post not found' }, { status: 404 });

  const result = await revokePublishedPost(supabase, post, { reason });
  if (!result.ok) return json({ error: result.error }, { status: 400 });
  // Surface per-account delete failures: the DB row is revoked, but content still live on
  // the platform must be visible to the caller (compliance: never pretend it is gone).
  return json({ ok: true, status: result.status, deleted: result.deleted, failedDeletes: result.failed ?? [] });
};
