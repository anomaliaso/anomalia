import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, loadBrandForUser, checkApiKeyWriteAccess } from '$lib/server/cli-auth';
import { getPosts } from '$lib/server/cli-queries';
import { deletePostCancellingZernio } from '$lib/server/post-editing';
import { recordPostVerdicts } from '$lib/server/post-verdict';
import { createManualPost } from '$lib/server/manual-posting';
import { datetimeInputToUtc, formatInZone } from '$lib/server/schedule';
import { appOrigin } from '$lib/server/app-url';
import { CREATE_POST, statusForFailure } from '@anomalia/api-contracts';

export const GET: RequestHandler = async ({ request, params, url }) => {
  const { supabase, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;

  const status = url.searchParams.get('status') ?? undefined;
  const posts = await getPosts(supabase, brand.id, status);
  return json(posts);
};

export const POST: RequestHandler = async ({ request, params, url }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
  if (error) return error;

  const { brand, error: brandError } = await loadBrandForUser(supabase, params.slug, apiKey);
  if (brandError) return brandError;
  const writeDenied = checkApiKeyWriteAccess(apiKey);
  if (writeDenied) return writeDenied;

  const parsed = CREATE_POST.input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: 'invalid_input', details: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;

  const tz = (brand.timezone as string) ?? 'Europe/Rome';
  const scheduledFor = input.scheduled_for ? datetimeInputToUtc(input.scheduled_for, tz) : null;
  if (input.scheduled_for && !scheduledFor) {
    return json(
      { error: 'invalid_scheduled_for', details: `Not a datetime: ${input.scheduled_for}` },
      { status: statusForFailure(CREATE_POST, 'invalid_scheduled_for') }
    );
  }

  const result = await createManualPost({
    supabase,
    userId: user.id,
    brandId: brand.id,
    timezone: tz,
    input: {
      platforms: input.platforms,
      caption: input.caption,
      platformCaptions: input.platform_captions,
      title: input.title,
      subreddit: input.subreddit,
      linkUrl: input.link_url,
      mode: 'propose',
      scheduledFor: scheduledFor ?? undefined,
      source: 'external'
    }
  });

  if (!result.ok) {
    return json({ error: result.error }, { status: statusForFailure(CREATE_POST, result.error) });
  }

  return json({
    ok: true,
    id: result.id,
    status: result.status,
    scheduled_for: scheduledFor,
    scheduled_for_local: scheduledFor ? `${formatInZone(scheduledFor, tz)} (${tz})` : null,
    slot: result.slot ?? null,
    review_url: `${appOrigin(url)}/app/${brand.slug}/posts/${result.id}`
  });
};

// Bulk-delete posts by status (default: pending_user). Lets the CLI clear a stale queue without
// rejecting posts one by one. Refuses to bulk-delete published posts.
export const DELETE: RequestHandler = async ({ request, params, url }) => {
  const { supabase, user, error, apiKey } = await authenticate(request);
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
      const res = await deletePostCancellingZernio(supabase, row.id, brand.id, user.id);
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

  await recordPostVerdicts(
    supabase,
    (deleted ?? []).map((row) => ({ postId: row.id, brandId: brand.id, actorId: user.id, verdict: 'discarded' as const }))
  );
  return json({ ok: true, deleted: deleted?.length ?? 0 });
};
