import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { publishApprovedPost, syncDuePosts, type ApprovablePost } from '$lib/server/publish';
import { signApproveToken } from '$lib/server/token';
import { sendEmail, approvalEmailHtml, approvalEmailText, approvalEmailSubject } from '$lib/server/email';
import { EDITOR_POST_COLS, editorActions } from '$lib/server/post-editing';

// Approvals has been merged into Calendar (/calendar). The route stays alive
// only as a redirect so existing links (overview "review plan", bookmarks) keep working.
export const load: PageServerLoad = async ({ params }) => {
  throw redirect(308, `/app/${params.brand}/calendar`);
};

export const actions: Actions = {
  // Shared editor actions: updatePost, reschedule, cancelSchedule, repost, reject, approve.
  ...editorActions,

  approveAll: async ({ params, locals: { supabase, user } }) => {
    const { data: brand } = await supabase
      .from('brands')
      .select('id, timezone')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return {};

    const { data: pending } = await supabase
      .from('posts')
      .select(EDITOR_POST_COLS)
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user');

    let noAccount = false;
    for (const post of pending ?? []) {
      const res = await publishApprovedPost(supabase, post as ApprovablePost, brand.timezone ?? 'Europe/Rome', { by: user?.id });
      if (res.noAccount) noAccount = true;
    }
    return { ok: true, noAccount };
  },

  // Email the brand owner a one-tap approve-all link.
  emailApprove: async ({ params, url, locals: { supabase, safeGetSession, locale } }) => {
    const { session, user } = await safeGetSession();
    if (!session || !user?.email) return fail(400, { error: 'No email on file' });

    const { data: brand } = await supabase
      .from('brands')
      .select('id, name')
      .eq('slug', params.brand)
      .maybeSingle();
    if (!brand) return fail(404, { error: 'Brand not found' });

    const { data: pending } = await supabase
      .from('posts')
      .select('platform, caption, media_url')
      .eq('brand_id', brand.id)
      .eq('status', 'pending_user')
      .order('created_at', { ascending: true });
    if (!pending || pending.length === 0) return { emailed: false, empty: true };

    const token = signApproveToken(brand.id);
    const approveUrl = `${url.origin}/approve/${token}`;
    try {
      await sendEmail({
        to: user.email,
        subject: approvalEmailSubject(locale, brand.name, pending.length),
        html: approvalEmailHtml(locale, brand.name, pending.length, approveUrl, pending, url.origin),
        text: approvalEmailText(locale, brand.name, pending.length, approveUrl, pending)
      });
    } catch (e) {
      return fail(500, { error: e instanceof Error ? e.message : 'Email failed' });
    }
    return { emailed: true, to: user.email };
  }
};
