import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { publishApprovedPost, type ApprovablePost } from '$lib/server/publish';
import { signApproveToken } from '$lib/server/token';
import { sendEmail, approvalEmailHtml, approvalEmailText, approvalEmailSubject } from '$lib/server/email';
import { EDITOR_POST_COLS, deletePostCancellingZernio, editorActions } from '$lib/server/post-editing';

/**
 * Queue UI merged into Calendar. Keep this route as a redirect so old links
 * (?status=, ?row=) and bookmarks still work. Form actions stay here so any
 * lingering POSTs to /content continue to work; calendar owns the primary UI.
 */
export const load: PageServerLoad = async ({ params, url }) => {
  const qs = url.searchParams.toString();
  throw redirect(308, `/app/${params.brand}/calendar${qs ? `?${qs}` : ''}`);
};

export const actions: Actions = {
  updateCaption: async ({ request, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    const caption = String(data.get('caption') ?? '').trim();
    if (!id) return fail(400, { error: 'Missing post' });
    if (!caption) return fail(400, { error: 'Caption cannot be empty' });
    const { error } = await supabase.from('posts').update({ caption }).eq('id', id);
    if (error) return fail(500, { error: error.message });
    return { updated: id };
  },

  // Prima scriveva un publish_log 'canceled' e cancellava la riga SENZA mai revocare Zernio:
  // il log dichiarava una cancellazione inesistente e il post usciva comunque (classe incidente
  // scheduling luglio 2026). Ora la revoca viene prima; se fallisce, il post resta visibile.
  deletePost: async ({ request, locals: { supabase } }) => {
    const data = await request.formData();
    const id = String(data.get('id') ?? '');
    if (!id) return fail(400, { error: 'Missing post' });
    const res = await deletePostCancellingZernio(supabase, id);
    if (!res.ok) return fail(res.status, { error: res.message });
    return { deleted: id, wasScheduled: res.wasScheduled };
  },

  approveWeek: async ({ request, params, locals: { supabase } }) => {
    const form = await request.formData();
    const ids = String(form.get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!ids.length) return {};
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
      .eq('status', 'pending_user')
      .in('id', ids);
    let noAccount = false;
    for (const post of pending ?? []) {
      const res = await publishApprovedPost(
        supabase,
        post as ApprovablePost,
        brand.timezone ?? 'Europe/Rome'
      );
      if (res.noAccount) noAccount = true;
    }
    return { ok: true, noAccount };
  },

  approveAll: async ({ params, locals: { supabase } }) => {
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
      const res = await publishApprovedPost(
        supabase,
        post as ApprovablePost,
        brand.timezone ?? 'Europe/Rome'
      );
      if (res.noAccount) noAccount = true;
    }
    return { ok: true, noAccount };
  },

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
  },

  ...editorActions
};
