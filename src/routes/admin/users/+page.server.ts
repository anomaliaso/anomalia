import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { createAdminClient } from '$lib/server/supabase-admin';

// Chi entra nel prodotto, dopo la call. Strumento interno: etichette in chiaro, niente i18n.
// Il resto gira col client di servizio perché la lista attraversa tutti gli utenti, che è
// esattamente ciò che RLS vieta a un utente — anche a un admin.

const PENDING_LIMIT = 200;
const APPROVED_LIMIT = 40;

async function requireAdmin(locals: RequestEvent['locals']) {
  const { session, user } = await locals.safeGetSession();
  // 404, non 403: l'area admin non annuncia la propria esistenza a chi non lo è.
  if (!session || !user) throw error(404, 'Not found');
  const { data } = await locals.supabase.rpc('is_admin');
  if (data !== true) throw error(404, 'Not found');
  return user;
}

export const load: PageServerLoad = async ({ locals }) => {
  await requireAdmin(locals);
  const admin = createAdminClient();

  const [{ data: pending }, { data: approved }, { data: queued }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, email, full_name, utm, created_at')
      .is('approved_at', null)
      .order('created_at', { ascending: false })
      .limit(PENDING_LIMIT),
    admin
      .from('profiles')
      .select('id, email, full_name, approved_at')
      .not('approved_at', 'is', null)
      .order('approved_at', { ascending: false })
      .limit(APPROVED_LIMIT),
    admin.from('waitlist').select('user_id, created_at')
  ]);

  const queuedAt = new Map((queued ?? []).map((w) => [String(w.user_id), String(w.created_at)]));

  return {
    pending: (pending ?? []).map((p) => ({ ...p, queuedAt: queuedAt.get(String(p.id)) ?? null })),
    approved: approved ?? []
  };
};

export const actions: Actions = {
  approve: async ({ request, locals }) => {
    await requireAdmin(locals);
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'missing_id' });

    const admin = createAdminClient();
    // `is('approved_at', null)` rende il bottone idempotente: due click non spostano una data
    // già scritta, e la prima approvazione resta quella vera.
    const { error: err } = await admin
      .from('profiles')
      .update({ approved_at: new Date().toISOString() })
      .eq('id', id)
      .is('approved_at', null);
    if (err) return fail(500, { error: err.message });
    return { approved: id };
  },

  revoke: async ({ request, locals }) => {
    await requireAdmin(locals);
    const id = String((await request.formData()).get('id') ?? '');
    if (!id) return fail(400, { error: 'missing_id' });

    const admin = createAdminClient();
    const { error: err } = await admin.from('profiles').update({ approved_at: null }).eq('id', id);
    if (err) return fail(500, { error: err.message });
    return { revoked: id };
  }
};
