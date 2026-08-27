import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { getPosts } from '$lib/server/cli-queries';
import { deletePostCancellingZernio } from '$lib/server/post-editing';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const status = url.searchParams.get('status') ?? undefined;
  const posts = await getPosts(supabase, brand.id, status);
  return json(posts);
};

// Bulk-delete posts by status (default: pending_user). Lets the CLI clear a stale queue without
// rejecting posts one by one. Refuses to bulk-delete published posts.
export const DELETE: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const status = url.searchParams.get('status') ?? 'pending_user';
  if (status === 'published') return json({ error: 'Refusing to bulk-delete published posts.' }, { status: 400 });

  // Stessa classe dell'incidente scheduling di luglio 2026: il bulk cancellava anche i post
  // scheduled/approved senza revocare Zernio, che li pubblicava comunque. Quei post passano
  // uno a uno dalla revoca; chi non si riesce a revocare NON viene eliminato.
  if (status === 'scheduled' || status === 'approved') {
    const { data: rows } = await supabase
      .from('posts')
      .select('id')
      .eq('brand_id', brand.id)
      .eq('status', status);
    let deleted = 0;
    const failed: { id: string; error: string }[] = [];
    for (const row of rows ?? []) {
      const res = await deletePostCancellingZernio(supabase, row.id, brand.id);
      if (res.ok) deleted++;
      else failed.push({ id: row.id, error: res.message });
    }
    if (failed.length) return json({ ok: false, deleted, failed }, { status: 502 });
    return json({ ok: true, deleted });
  }

  const { data: deleted, error: delErr } = await supabase
    .from('posts')
    .delete()
    .eq('brand_id', brand.id)
    .eq('status', status)
    .select('id');

  if (delErr) return json({ error: delErr.message }, { status: 500 });
  return json({ ok: true, deleted: deleted?.length ?? 0 });
};
