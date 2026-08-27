import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const { publishApprovedPost } = await import('$lib/server/publish');

  const { data: post } = await supabase
    .from('posts').select('*').eq('id', params.id).eq('brand_id', brand.id).maybeSingle();

  if (!post) return json({ error: 'Post not found' }, { status: 404 });

  try {
    await publishApprovedPost(supabase, post, brand.timezone as string);
    return json({ ok: true, status: 'published' });
  } catch (e) {
    return json({ error: `Publish failed: ${String(e)}` }, { status: 500 });
  }
};
