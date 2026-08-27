import { fail, redirect } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import type { Actions, PageServerLoad } from './$types';

const MIN_PASSWORD = 6;

// Reached only after /auth/confirm verified a recovery token and established a (recovery) session.
// No session → the link was bad/expired or opened directly; send them back to start over.
export const load: PageServerLoad = async ({ locals: { safeGetSession } }) => {
  const { session } = await safeGetSession();
  if (!session) throw redirect(303, '/login?error=link');
};

export const actions: Actions = {
  default: async ({ request, locals: { supabase, safeGetSession } }) => {
    const { session } = await safeGetSession();
    if (!session) throw redirect(303, '/login?error=link');

    const data = await request.formData();
    const password = String(data.get('password') ?? '');
    const confirm = String(data.get('confirm') ?? '');

    if (password.length < MIN_PASSWORD) return fail(400, { errorCode: 'weakPassword' });
    if (password !== confirm) return fail(400, { errorCode: 'mismatch' });

    const { error } = await supabase.auth.updateUser({ password });
    if (error) return fail(400, { error: error.message });

    if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');
    throw redirect(303, '/app');
  }
};
