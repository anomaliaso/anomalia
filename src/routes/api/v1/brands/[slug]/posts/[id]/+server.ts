import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { applyPostEdits, deletePostCancellingZernio } from '$lib/server/post-editing';
import { reschedIfNeeded } from '$lib/agent/tools/post-editor-tools';
import { isContentFormat } from '$lib/content-formats';

// Every scalar field the web editor can write. `media_url: null` clears the image (text-only);
// `platform_captions: null` clears the per-platform overrides.
const FIELDS = [
  'caption', 'image_prompt', 'platforms', 'content_type', 'format', 'slot', 'product_name',
  'first_comment', 'title', 'link_url', 'subreddit', 'media_url', 'platform_captions',
  'youtube_thumbnail_url'
] as const;

export const PUT: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const body = await request.json() as Record<string, unknown>;

  const updates: Record<string, unknown> = {};
  for (const f of FIELDS) if (body[f] !== undefined) updates[f] = body[f];

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update' }, { status: 400 });
  }
  // `format` drives the renderer and the publisher — a free-form string here silently produces
  // the wrong media downstream, so only the enum is accepted.
  if (updates.format !== undefined && !isContentFormat(updates.format)) {
    return json({ error: `Invalid format. Use one of: single_image, carousel, text_post, link_post, video` }, { status: 400 });
  }

  // Ownership: applyPostEdits updates by id alone, so scope the row to this brand first.
  const { data: owned } = await supabase
    .from('posts').select('id').eq('id', params.id).eq('brand_id', brand.id).maybeSingle();
  if (!owned) return json({ error: 'Post not found' }, { status: 404 });

  // Shared with the web editor: learns the brand's voice from a caption diff before overwriting.
  const { error: updateError } = await applyPostEdits(supabase, params.id, updates, {
    origin: new URL(request.url).origin,
    by: user.id
  });
  if (updateError) return json({ error: updateError.message }, { status: 500 });

  // An edit on an already-scheduled post must reach Zernio, or the copy that goes out is stale.
  await reschedIfNeeded(supabase, brand.id, params.id, (brand.timezone as string) ?? 'Europe/Rome');

  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  // Only allow deleting pending_user posts
  const { data: post } = await supabase
    .from('posts').select('status').eq('id', params.id).eq('brand_id', brand.id).maybeSingle();

  if (!post) return json({ error: 'Post not found' }, { status: 404 });
  if (post.status !== 'pending_user') {
    return json({ error: 'Can only delete pending posts' }, { status: 400 });
  }

  const res = await deletePostCancellingZernio(supabase, params.id, brand.id, user.id);
  if (!res.ok) return json({ error: res.message }, { status: res.status });
  return json({ ok: true });
};
