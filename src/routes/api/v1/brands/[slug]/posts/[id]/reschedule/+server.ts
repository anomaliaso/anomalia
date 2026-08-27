import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { publishApprovedPost, type ApprovablePost } from '$lib/server/publish';
import { EDITOR_POST_COLS, requireZernioCancellation } from '$lib/server/post-editing';
import { datetimeInputToUtc, formatInZone } from '$lib/server/schedule';

export const POST: RequestHandler = async ({ request, params }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const { scheduled_for } = await request.json();
  if (!scheduled_for) return json({ error: 'scheduled_for is required' }, { status: 400 });

  // A datetime with no offset is the wall clock the caller typed — resolve it in the brand's
  // timezone, not the server's, so "18:00" is 18:00 where the brand lives.
  const tz = (brand.timezone as string) ?? 'Europe/Rome';
  const when = datetimeInputToUtc(String(scheduled_for), tz);
  if (!when) return json({ error: `Invalid scheduled_for: ${scheduled_for}` }, { status: 400 });

  // 1. Load post
  const { data: post } = await supabase
    .from('posts').select(EDITOR_POST_COLS).eq('id', params.id).eq('brand_id', brand.id).maybeSingle();

  if (!post) return json({ error: 'Post not found' }, { status: 404 });

  // 2. Cancel and verify the existing Zernio copy before changing the only local pointers to it.
  try {
    await requireZernioCancellation(supabase, post.id);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  // 3. Update DB with reset
  const { error: updateError } = await supabase
    .from('posts').update({
      scheduled_for: when,
      status: 'approved',
      external_post_id: null,
      published_url: null
    }).eq('id', params.id);

  if (updateError) return json({ error: updateError.message }, { status: 500 });

  // 4. Re-publish to Zernio with new schedule
  const { data: updated } = await supabase
    .from('posts').select(EDITOR_POST_COLS).eq('id', params.id).maybeSingle();

  const localWhen = `${formatInZone(when, tz)} (${tz})`;

  if (updated) {
    try {
      const res = await publishApprovedPost(supabase, updated as ApprovablePost, tz);
      return json({ ok: true, scheduled_for: when, scheduled_for_local: localWhen, noAccount: res.noAccount });
    } catch (e) {
      return json({ error: `Publish failed: ${String(e)}` }, { status: 500 });
    }
  }

  return json({ ok: true, scheduled_for: when, scheduled_for_local: localWhen });
};
