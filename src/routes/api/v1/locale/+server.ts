import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isLocale } from '$lib/i18n/locale';

// Persists the signed-in user's language choice so transactional emails sent later from
// the cron planner (no request/cookie) go out in their language. Best-effort: the cookie
// set client-side already drives the live UI; this just remembers it server-side.
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
  const { locale } = await request.json().catch(() => ({ locale: null }));
  if (!isLocale(locale)) return json({ ok: false }, { status: 400 });

  const { user } = await safeGetSession();
  if (user) {
    await supabase.from('profiles').update({ locale }).eq('id', user.id);
  }
  return json({ ok: true });
};
