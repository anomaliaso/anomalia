import { describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { load } from './+page.server';

type SessionResult = { session: unknown; user: unknown };

const SIGNED_IN: SessionResult = { session: { access_token: 'jwt' }, user: { id: 'u1' } };
const ANON: SessionResult = { session: null, user: null };

const ORIGIN = 'https://anomalia.so';

/** Minimal stand-in for the load event: the landing load reads url, request headers and session. */
function run(path: string, auth: SessionResult, headers: Record<string, string> = {}) {
  const url = new URL(`${ORIGIN}${path}`);
  const event = {
    url,
    request: new Request(url, { headers }),
    locals: { safeGetSession: async () => auth }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Promise.resolve((load as any)(event)).then(
    (data) => ({ data, redirect: null as { status: number; location: string } | null }),
    (err) => {
      if (isRedirect(err)) return { data: null, redirect: { status: err.status, location: err.location } };
      throw err;
    }
  );
}

const toApp = { status: 303, location: '/app' };

describe('landing page load', () => {
  describe('signed in, arriving cold', () => {
    it('redirects a typed URL or bookmark to the dashboard', async () => {
      const { redirect } = await run('/', SIGNED_IN, { 'sec-fetch-site': 'none' });
      expect(redirect).toEqual(toApp);
    });

    it('redirects an external link or search result', async () => {
      const { redirect } = await run('/', SIGNED_IN, { 'sec-fetch-site': 'cross-site' });
      expect(redirect).toEqual(toApp);
    });

    it('redirects from a subdomain such as the blog', async () => {
      const { redirect } = await run('/', SIGNED_IN, { 'sec-fetch-site': 'same-site' });
      expect(redirect).toEqual(toApp);
    });

    it('redirects the localized roots too, since they share this route', async () => {
      for (const path of ['/it', '/fr', '/es']) {
        const { redirect } = await run(path, SIGNED_IN, { 'sec-fetch-site': 'none' });
        expect(redirect, path).toEqual(toApp);
      }
    });

    it('redirects when the browser sends no Sec-Fetch-Site and no Referer', async () => {
      const { redirect } = await run('/', SIGNED_IN);
      expect(redirect).toEqual(toApp);
    });
  });

  describe('signed in, following a link from inside the site', () => {
    it('renders the home page when linked from the app', async () => {
      const { data, redirect } = await run('/', SIGNED_IN, { 'sec-fetch-site': 'same-origin' });
      expect(redirect).toBeNull();
      expect(data.heroPhrase).toBeGreaterThanOrEqual(0);
    });

    it('renders the home page when linked from a marketing page', async () => {
      // e.g. clicking the nav logo on /pricing — still a deliberate request for the home page.
      const { redirect } = await run('/', SIGNED_IN, { 'sec-fetch-site': 'same-origin' });
      expect(redirect).toBeNull();
    });

    it('keeps rendering the home page across a reload', async () => {
      // Chrome reports a reload as same-origin with no Referer. Someone who deliberately
      // navigated to the home page should not be teleported away by pressing refresh.
      const { redirect } = await run('/', SIGNED_IN, { 'sec-fetch-site': 'same-origin' });
      expect(redirect).toBeNull();
    });

    it('renders the localized roots when linked internally', async () => {
      const { redirect } = await run('/it', SIGNED_IN, { 'sec-fetch-site': 'same-origin' });
      expect(redirect).toBeNull();
    });

    it('falls back to the Referer origin when Sec-Fetch-Site is missing (Safari < 16.4)', async () => {
      const internal = await run('/', SIGNED_IN, { referer: `${ORIGIN}/app/acme` });
      expect(internal.redirect).toBeNull();

      const external = await run('/', SIGNED_IN, { referer: 'https://www.google.com/' });
      expect(external.redirect).toEqual(toApp);

      const malformed = await run('/', SIGNED_IN, { referer: 'not a url' });
      expect(malformed.redirect).toEqual(toApp);
    });

    it('trusts Sec-Fetch-Site over Referer when both are present', async () => {
      const { redirect } = await run('/', SIGNED_IN, {
        'sec-fetch-site': 'cross-site',
        referer: `${ORIGIN}/app/acme`
      });
      expect(redirect).toEqual(toApp);
    });
  });

  describe('not signed in', () => {
    it('renders the landing page however the visitor arrived', async () => {
      for (const site of ['none', 'cross-site', 'same-origin', 'same-site']) {
        const { data, redirect } = await run('/', ANON, { 'sec-fetch-site': site });
        expect(redirect, site).toBeNull();
        expect(data.heroPhrase).toBeLessThan(5);
      }
    });

    it('does not treat an unverified session cookie as signed in', async () => {
      // safeGetSession nulls both halves when getUser rejects the JWT; assert on the half-state
      // anyway so a future refactor can't turn a stale cookie into an app redirect.
      const { redirect } = await run('/', { session: { access_token: 'stale' }, user: null }, {
        'sec-fetch-site': 'none'
      });
      expect(redirect).toBeNull();
    });
  });

  it('keeps the OAuth bounce ahead of the signed-in redirect', async () => {
    // A code still has to be exchanged, so ?code= wins whatever the session or entry source.
    for (const auth of [ANON, SIGNED_IN]) {
      const { redirect } = await run('/?code=abc123', auth, { 'sec-fetch-site': 'none' });
      expect(redirect).toEqual({ status: 303, location: '/auth/callback?code=abc123' });
    }
    const { redirect } = await run('/?error_description=denied', ANON);
    expect(redirect).toEqual({ status: 303, location: '/auth/callback?error_description=denied' });
  });
});
