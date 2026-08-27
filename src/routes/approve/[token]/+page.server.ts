import type { PageServerLoad, Actions } from './$types';
import { verifyApproveToken } from '$lib/server/token';
import { createAdminClient } from '$lib/server/supabase-admin';
import { publishApprovedPost, type ApprovablePost } from '$lib/server/publish';
import { EDITOR_POST_COLS } from '$lib/server/post-editing';
import { nextOccurrence } from '$lib/server/schedule';

// One-tap email approval — no session. The signed token IS the authorization;
// we use the service-role client to approve + schedule the brand's pending posts.
//
// FIX D: load only returns data; publishing happens on POST (form action) so
// email scanners / link prefetchers cannot trigger approval on GET.
export const load: PageServerLoad = async ({ params }) => {
  const v = verifyApproveToken(params.token);
  if (!v) return { ok: false as const, reason: 'This link is invalid or has expired.' };

  const admin = createAdminClient();
  const { data: brand } = await admin
    .from('brands')
    .select('id, name, slug, timezone')
    .eq('id', v.brandId)
    .maybeSingle();
  if (!brand) return { ok: false as const, reason: 'Brand not found.' };

  // FIX A: use the canonical EDITOR_POST_COLS so scheduled_for, title, link_url,
  // subreddit, content_type etc. are all present (prevents the slot-null collapse).
  // Posts flagged needs_attention (Director __attention / time-sensitive / borderline)
  // are listed but NOT bulk-approvable — one-tap approval must not silently publish them.
  const { data: pending } = await admin
    .from('posts')
    .select(EDITOR_POST_COLS)
    .eq('brand_id', brand.id)
    .eq('status', 'pending_user')
    .order('slot', { ascending: true, nullsFirst: false });

  const approvable = (pending ?? []).filter((p) => !p.needs_attention);
  const excluded = (pending ?? [])
    .filter((p) => p.needs_attention)
    .map((p) => ({ id: p.id, reason: p.attention_reason ?? 'flagged for review' }));

  return {
    ok: true as const,
    brand: brand.name,
    token: params.token,
    posts: approvable,
    count: approvable.length,
    excluded
  };
};

// FIX D: actual approval happens on POST — email prefetch can't trigger this.
export const actions: Actions = {
  approve: async ({ request }) => {
    const data = await request.formData();
    const token = String(data.get('token') ?? '');
    const v = verifyApproveToken(token);
    if (!v) return { ok: false as const, reason: 'This link is invalid or has expired.' };

    const admin = createAdminClient();
    const { data: brand } = await admin
      .from('brands')
      .select('id, name, slug, timezone')
      .eq('id', v.brandId)
      .maybeSingle();
    if (!brand) return { ok: false as const, reason: 'Brand not found.' };

    // Never bulk-publish flagged posts — they need a human review in the app first.
    const { data: pending } = await admin
      .from('posts')
      .select(EDITOR_POST_COLS)
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user')
      .or('needs_attention.is.null,needs_attention.eq.false')
      .order('slot', { ascending: true, nullsFirst: false });

    const { count: excludedCount } = await admin
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user')
      .eq('needs_attention', true);

    let approved = 0;
    let noAccount = false;

    // FIX G: spread posts deterministically in the bulk loop so posts without a
    // concrete scheduled_for don't all collapse onto "tomorrow 09:00". The anchor is the
    // same instant nextOccurrence(null) would pick (today/tomorrow 09:00 brand-tz); the
    // k-th fallback post lands at anchor + k·15min — consistent for every post in the batch.
    const tz = brand.timezone ?? 'Europe/Rome';
    const anchorMs = Date.parse(nextOccurrence(null, tz));
    let spread = 0;
    for (const post of pending ?? []) {
      const p = post as ApprovablePost;
      if (!p.scheduled_for && !(p.slot ?? '').match(/mon|tue|wed|thu|fri|sat|sun/i)) {
        const when = new Date(anchorMs + spread * 15 * 60_000).toISOString();
        spread++;
        // Write the spread instant BEFORE publishing so publishApprovedPost picks it up.
        await admin.from('posts').update({ scheduled_for: when }).eq('id', p.id);
        p.scheduled_for = when;
      }
      const r = await publishApprovedPost(admin, p, tz);
      approved++;
      if (r.noAccount) noAccount = true;
    }

    return { ok: true as const, brand: brand.name, approved, noAccount, excluded: excludedCount ?? 0 };
  }
};
