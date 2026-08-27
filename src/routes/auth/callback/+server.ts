import { redirect } from '@sveltejs/kit';
import { canEnter } from '$lib/server/access';
import { isPlanKey, normalizeCycle } from '$lib/plans';
import { isPlanGoEnabled } from '$lib/server/feature-flags';
import { sanitizeWebsiteParam } from '$lib/website-param';
import { GUEST_ONBOARDING_COOKIE, hasGuestOnboardingCookie } from '$lib/guest-onboarding';
import { takeOAuthReturn } from '$lib/server/oauth';
import type { RequestHandler } from './$types';

// Exchanges the magic-link / OAuth code for a session, then routes by role:
// canEnter → product; else → waitlist.
// "next=onboarding" (pricing / homepage /guest funnel) or the guest-onboarding cookie
// sends the user into new-brand onboarding instead of their last project.
export const GET: RequestHandler = async ({ url, cookies, locals: { supabase } }) => {
  const code = url.searchParams.get('code');

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const oauthReturn = takeOAuthReturn(cookies);
      if (oauthReturn) throw redirect(303, oauthReturn);

      const cliPort = url.searchParams.get('cli_port') ?? '';
      const cliState = url.searchParams.get('cli_state') ?? '';
      if (cliPort) {
        throw redirect(303, `/cli/callback?cli_port=${encodeURIComponent(cliPort)}&cli_state=${encodeURIComponent(cliState)}`);
      }

      if (!(await canEnter(supabase))) throw redirect(303, '/waitlist');

      const guestPending = hasGuestOnboardingCookie(cookies.get(GUEST_ONBOARDING_COOKIE));
      if (url.searchParams.get('next') === 'onboarding' || guestPending) {
        const qs = new URLSearchParams();
        const plan = url.searchParams.get('plan') ?? '';
        if (isPlanKey(plan) && (plan !== 'go' || isPlanGoEnabled())) {
          qs.set('plan', plan);
          qs.set('cycle', normalizeCycle(url.searchParams.get('cycle')));
        }
        const website = sanitizeWebsiteParam(url.searchParams.get('website'));
        if (website) qs.set('website', website);
        throw redirect(303, `/app/onboarding${qs.toString() ? `?${qs}` : ''}`);
      }
      throw redirect(303, '/app');
    }
  }

  throw redirect(303, '/login');
};
