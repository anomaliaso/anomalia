/**
 * Marketing / navbar "Get started" destination.
 * Always `/app` when signed in (dashboard). Guests go to `/app` too — it redirects to
 * `/login` — so the navbar never traps people in the `/start` onboarding funnel.
 * (Guest website → socials still starts from the home URL CTA → `/start`.)
 */
export function marketingStartHref(opts: {
  loggedIn: boolean;
  waitlistActive?: boolean;
}): string {
  if (opts.waitlistActive && !opts.loggedIn) return '/waitlist';
  return '/app';
}
