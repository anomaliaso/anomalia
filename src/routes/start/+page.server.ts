import { redirect } from '@sveltejs/kit';
import { sanitizeWebsiteParam } from '$lib/website-param';
import type { PageServerLoad } from './$types';

// Guest funnel: website → socials → login → /app/onboarding (analyze).
// Already signed in? Dashboard (or authenticated onboarding when a website was typed).
export const load: PageServerLoad = async ({ url, locals: { safeGetSession }, parent }) => {
  const { waitlistActive } = await parent();
  const { session, user } = await safeGetSession();
  const website = sanitizeWebsiteParam(url.searchParams.get('website'));

  if (session && user) {
    if (website) throw redirect(303, `/app/onboarding?website=${encodeURIComponent(website)}`);
    throw redirect(303, '/app');
  }

  if (waitlistActive) throw redirect(303, '/waitlist');

  return { website };
};
