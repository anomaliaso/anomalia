import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Pick one hero tail phrase per request, server-side, so SSR and client hydration agree — no
// flash / mismatch. The phrase is fixed for the page load and doesn't cycle. Keep PHRASE_COUNT
// in sync with landing.hero.phrases in the i18n catalogs (en/it).
const PHRASE_COUNT = 5;

/**
 * Did this navigation start on our own pages, rather than being a fresh arrival at the site?
 *
 * Sec-Fetch-Site says it exactly: `none` is a typed URL or bookmark, `cross-site` is an
 * external link or search result, `same-origin` is one of our own pages — including the
 * data request SvelteKit issues for a client-side navigation. Safari below 16.4 omits the
 * header, so fall back to comparing the Referer's origin.
 */
function cameFromThisSite(request: Request, url: URL): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';

  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).origin === url.origin;
  } catch {
    return false; // malformed Referer — treat as a fresh arrival
  }
}

export const load: PageServerLoad = async ({ url, request, locals: { safeGetSession } }) => {
  // Safety net: if OAuth/magic-link bounced to the Site URL root with ?code= (common when
  // redirectTo wasn't allow-listed for www vs apex), hand the code to /auth/callback.
  // Stays ahead of the signed-in check: the code still has to be exchanged for a session.
  if (url.searchParams.has('code') || url.searchParams.has('error_description')) {
    throw redirect(303, `/auth/callback${url.search}`);
  }

  // Already signed in and arriving cold? The pitch isn't the useful surface, and making them
  // hunt for "Sign in" to reach their own dashboard is the whole reason this exists — send
  // them to /app, same as /start does.
  //
  // Only on a cold entry, though. Following a link from inside the site to the home page is a
  // deliberate request to see the home page, so it renders. safeGetSession is memoised per
  // request in hooks.server.ts and the root layout load has already called it, so the check
  // adds no auth round-trip, and anonymous visitors (crawlers included) fall straight through.
  if (!cameFromThisSite(request, url)) {
    const { session, user } = await safeGetSession();
    if (session && user) throw redirect(303, '/app');
  }

  return {
    heroPhrase: Math.floor(Math.random() * PHRASE_COUNT)
  };
};
