import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { canEnter } from '$lib/server/access';
import { ensureOrgForUser } from '$lib/server/org';
import { canStartNewSlot } from '$lib/server/brand-limits';
import { logOnboardingError } from '$lib/server/onboarding-errors';
import { randomUUID } from 'node:crypto';

// Autosave the in-progress onboarding wizard so a user who leaves mid-flow resumes where they left
// off. The whole client state is stored as an opaque JSON blob. A user can have SEVERAL drafts (one
// per "new brand" they started), so each draft has its own id: the client passes the id it's
// editing, or omits it to create a new one — we return the id so subsequent saves target the same row.
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  if (!(await canEnter(supabase))) return new Response('Forbidden', { status: 403 });

  let body: { id?: unknown; phase?: unknown; draft?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }
  const id = typeof body?.id === 'string' && body.id ? body.id : null;
  const phase = typeof body?.phase === 'string' ? body.phase : null;
  const draft = body?.draft && typeof body.draft === 'object' ? body.draft : {};

  // Update the named draft (RLS scopes it to this user); create a fresh one otherwise.
  if (id) {
    const { error } = await supabase
      .from('onboarding_drafts')
      .update({ phase, draft, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id);
    if (error) {
      await logOnboardingError(supabase, user.id, 'draft_save', error.message, { op: 'update', phase });
      return new Response(error.message, { status: 400 });
    }
    return json({ id });
  }

  // Creating a NEW draft consumes a non-paying slot — refuse past the cap (backstop; the UI already
  // hides "add brand" at the limit). Updates to an existing draft (id present, handled above) are fine.
  if (!(await canStartNewSlot(supabase, user.id, { email: user.email }))) {
    return json({ error: 'slot_limit' }, { status: 403 });
  }
  const orgId = await ensureOrgForUser(supabase, user);
  // Prefer a client-minted brandId (the wizard tags every AI call to it before the first
  // draft save returns). Fall back to generating one so older clients still work — it becomes
  // the real brands.id when onboarding completes.
  const existingBrandId =
    typeof (draft as { brandId?: unknown }).brandId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      (draft as { brandId: string }).brandId
    )
      ? (draft as { brandId: string }).brandId
      : null;
  const brandId = existingBrandId ?? randomUUID();
  const { data, error } = await supabase
    .from('onboarding_drafts')
    .insert({ user_id: user.id, org_id: orgId, phase, draft: { ...draft, brandId } })
    .select('id')
    .single();
  if (error) {
    await logOnboardingError(supabase, user.id, 'draft_save', error.message, { op: 'insert', phase });
    return new Response(error.message, { status: 400 });
  }
  return json({ id: data.id });
};

// Discard a single draft by id (e.g. the user dismisses it from the /app drafts list).
export const DELETE: RequestHandler = async ({ url, locals: { supabase, safeGetSession } }) => {
  const { session, user } = await safeGetSession();
  if (!session || !user) return new Response('Unauthorized', { status: 401 });
  const id = url.searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });
  await supabase.from('onboarding_drafts').delete().eq('id', id).eq('user_id', user.id);
  return new Response(null, { status: 204 });
};
