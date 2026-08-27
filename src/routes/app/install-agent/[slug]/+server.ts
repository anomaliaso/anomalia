import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LAST_BRAND_COOKIE } from '$lib/shell-prefs';
import { PENDING_AGENT_INSTALL_COOKIE, PENDING_AGENT_INSTALL_MAX_AGE } from '$lib/agent-install';

/**
 * Deep link from the public Agent Library to the install flow.
 *
 * The directory at /agents knows the agent but not the brand, so this resolves the brand the
 * same way `/app` does (last one used, else the newest) and lands on Custom Agents with the
 * editor already open on that template.
 *
 * A guest cannot be sent straight back here — login always lands on /app — so the intent is
 * parked in a short-lived cookie instead, and Custom Agents picks it up the first time they
 * open the page.
 */
export const GET: RequestHandler = async ({
  params,
  cookies,
  locals: { supabase, safeGetSession }
}) => {
  const slug = String(params.slug ?? '').trim();
  const { session } = await safeGetSession();

  if (!session) {
    if (slug) {
      cookies.set(PENDING_AGENT_INSTALL_COOKIE, slug, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: PENDING_AGENT_INSTALL_MAX_AGE
      });
    }
    throw redirect(303, '/login?next=onboarding&mode=signup');
  }

  const target = (brand: string) =>
    `/app/${brand}/agents?install=${encodeURIComponent(slug)}`;

  const remembered = cookies.get(LAST_BRAND_COOKIE)?.trim() ?? '';
  if (remembered) {
    const { data } = await supabase
      .from('brands')
      .select('slug')
      .eq('slug', remembered)
      .maybeSingle();
    if (data?.slug) throw redirect(303, target(data.slug));
  }

  const { data: newest } = await supabase
    .from('brands')
    .select('slug')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (newest?.slug) throw redirect(303, target(newest.slug));

  // No brand yet: onboarding first — park the intent so it survives the detour.
  if (slug) {
    cookies.set(PENDING_AGENT_INSTALL_COOKIE, slug, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: PENDING_AGENT_INSTALL_MAX_AGE
    });
  }
  throw redirect(303, '/app');
};
