import {sequence} from '@sveltejs/kit/hooks';
import { json, redirect, text } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { env as publicEnv } from '$env/dynamic/public';
import type { Handle } from '@sveltejs/kit';
import { pickLocale } from '$lib/i18n/locale';
import { withBrandContext } from '$lib/server/ai-log';
import { createAdminClient } from '$lib/server/supabase-admin';
import { captureReferralCookie } from '$lib/server/referrals';
import { isCsrfForbidden } from '$lib/server/csrf';
import { marketingShellTarget } from '$lib/server/marketing-shell';
import { catalogModelIds } from '$lib/server/chat-model-catalog';

type CookieToSet = { name: string; value: string; options: CookieOptions };

const SESSION_COOKIE_NAME = `sb-${new URL(publicEnv.PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const SESSION_COOKIE_PREFIX = `${SESSION_COOKIE_NAME}.`;
const BASE64_COOKIE_PREFIX = 'base64-';
const BASE64_URL = /^[A-Za-z0-9_-]*$/;

function isSessionCookie(name: string): boolean {
  return name === SESSION_COOKIE_NAME || name.startsWith(SESSION_COOKIE_PREFIX);
}

function isValidSessionCookie(cookie: { name: string; value: string }): boolean {
  if (!isSessionCookie(cookie.name) || !cookie.value.startsWith(BASE64_COOKIE_PREFIX)) return true;
  return BASE64_URL.test(cookie.value.slice(BASE64_COOKIE_PREFIX.length));
}

function validSessionCookies(cookies: { name: string; value: string }[]) {
  if (cookies.every(isValidSessionCookie)) return cookies;
  return cookies.filter(({ name }) => !isSessionCookie(name));
}

// slug → brand id for the AI-credits brand context. Slugs are stable, so a per-instance cache
// with a 10-min TTL amortises the lookup to ~once per brand per instance.
// ponytail: in-memory Map; move to Redis only if instance churn ever makes the hit rate matter.
const brandIdCache = new Map<string, { id: string; at: number }>();
async function brandIdFromSlug(slug: string): Promise<string | null> {
  const hit = brandIdCache.get(slug);
  if (hit && Date.now() - hit.at < 600_000) return hit.id;
  try {
    const { data } = await createAdminClient().from('brands').select('id').eq('slug', slug).maybeSingle();
    if (data?.id) {
      brandIdCache.set(slug, { id: data.id as string, at: Date.now() });
      return data.id as string;
    }
  } catch {
    // no admin env (e.g. local tooling) — routes that need the context set it themselves
  }
  return null;
}

// Replaces kit's built-in CSRF check (disabled in svelte.config.js) so /oauth/token can opt out —
// see $lib/server/csrf for why.
const csrf: Handle = async ({ event, resolve }) => {
  if (isCsrfForbidden(event.request, event.url)) {
    const message = `Cross-site ${event.request.method} form submissions are forbidden`;
    return event.request.headers.get('accept') === 'application/json'
      ? json({ message }, { status: 403 })
      : text(message, { status: 403 });
  }
  return resolve(event);
};

export const handle: Handle = sequence(csrf, Sentry.sentryHandle(), async ({ event, resolve }) => {
  // Il catalogo dei modelli, caldo PRIMA di ogni handler.
  //
  // `resolveChatModel` è sincrono e lo chiamano una dozzina di superfici: renderlo asincrono
  // vorrebbe dire propagare un await fino a ogni `streamText`. Quindi legge una cache — e una
  // cache fredda gli fa scegliere il default dell'env invece di quello che l'operatore ha marcato
  // in Supabase. È già successo: turno partito su `google/gemini-3.8-flash` con la riga marcata su
  // `z-ai/glm-5.3-flash`, senza un errore da nessuna parte. Il difetto più silenzioso possibile,
  // perché il turno riesce — solo sul modello sbagliato.
  //
  // Qui la richiesta non è ancora entrata in nessun handler, e la cache dura 60s: una query al
  // minuto per istanza, e nessun percorso può leggere un catalogo mai caricato.
  await catalogModelIds().catch(() => []);

  // Per-request Supabase client bound to the request cookies (SSR auth).
  event.locals.supabase = createServerClient(publicEnv.PUBLIC_SUPABASE_URL, publicEnv.PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => validSessionCookies(event.cookies.getAll()),
      setAll: (cookiesToSet: CookieToSet[]) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          try {
            // path '/' so the session cookie is valid across the whole app
            event.cookies.set(name, value, { ...options, path: '/' });
          } catch {
            // Supabase's auto token-refresh fires setAll asynchronously; on fast routes
            // that finish before it resolves (e.g. /sitemap.xml) the response is already
            // generated and SvelteKit throws. The set is a no-op then — the refreshed
            // token simply persists on the next request — so swallow it rather than let
            // it surface as an unhandled rejection.
          }
        });
      }
    }
  });

  // getSession() is local (cookie → JWT). getUser() hits GoTrue — cache it across SPA
  // navigations on this isolate so every in-brand click is not a 300–800ms auth RTT.
  let cachedSession: ReturnType<typeof getSession> | null = null;
  const getSession = async () => {
    const {
      data: { session }
    } = await event.locals.supabase.auth.getSession();
    if (!session) return { session: null, user: null };

    const { verifiedUser } = await import('$lib/server/nav-cache');
    const user = await verifiedUser(event.locals.supabase, session);
    if (!user) return { session: null, user: null };

    return { session, user };
  };
  event.locals.safeGetSession = () => (cachedSession ??= getSession());

  // Resolve UI language: /it (or /en) URL prefix > saved cookie > Accept-Language > en.
  // Exposed to load functions via locals and stamped into <html lang> below.
  event.locals.locale = pickLocale(
    event.url.pathname,
    event.cookies.get('locale'),
    event.request.headers.get('accept-language')
  );

  // Meta click id → first-party cookies, written server-side. The browser pixel is deferred (first
  // interaction or 10s, see $lib/analytics) and consent/adblock can drop it entirely, so on an ad
  // click `_fbc` was only ever written for ~2% of visits — leaving every downstream conversion
  // (CompleteRegistration, Purchase, Schedule) unattributable to the ad that paid for it. Writing it
  // here, on the request that actually carries `fbclid`, is independent of all that and survives the
  // days between landing and checkout. Format + 90-day lifetime are Meta's spec, and the pixel reads
  // back these same cookies, so the two halves agree instead of racing.
  // Never on brand blogs: those are the brand's turf and stay tracking-free until the visitor consents.
  const fbclid = event.url.searchParams.get('fbclid');
  const isBlogRoute =
    !!event.route.id &&
    (event.route.id.startsWith('/_site') ||
      event.route.id.startsWith('/blog/[site]') ||
      event.route.id.startsWith('/blog-preview'));
  if (fbclid && !isBlogRoute) {
    // httpOnly:false so the pixel can read/reuse them; `secure` is left to SvelteKit (http on localhost).
    const opts = { path: '/', maxAge: 60 * 60 * 24 * 90, httpOnly: false, sameSite: 'lax' as const };
    // Last click wins (Meta's own attribution model), so a fresh fbclid always overwrites.
    event.cookies.set('_fbc', `fb.1.${Date.now()}.${fbclid}`, opts);
    // The pixel generates `_fbp` itself, but only once it has loaded — seeding it on ad clicks means
    // even a visitor who bounces in under 10s carries a stable browser id the pixel then reuses.
    // ponytail: only on ad clicks, so no new cookie for anyone we don't have to attribute.
    if (!event.cookies.get('_fbp')) {
      event.cookies.set('_fbp', `fb.1.${Date.now()}.${Math.floor(Math.random() * 1e10)}`, opts);
    }
  }

  // Growth referral: `?ref=CODE` → first-party cookie (30d). Captured on marketing/app only —
  // brand blogs stay clean; their Powered-by badge already links to anomalia.so/?ref=….
  if (!isBlogRoute) {
    captureReferralCookie(event.cookies, event.url.searchParams.get('ref'));
  }

  // Self-host: HIDE_MARKETING=1 manda il pitch (homepage, pricing, /start, …) in /app.
  // Prima di reindirizzare, lo stesso safety net della load della homepage: un bounce
  // OAuth/magic-link sul Site URL con ?code= non deve finire in /app e perdere il code.
  const marketingDest = marketingShellTarget(event.route.id);
  if (marketingDest) {
    if (event.url.searchParams.has('code') || event.url.searchParams.has('error_description')) {
      throw redirect(303, `/auth/callback${event.url.search}`);
    }
    // /it → /app terrebbe la lingua solo su QUESTA richiesta (il prefisso sta nel path).
    // La cookie è ciò che /app leggerà al giro dopo, stessa forma del language toggle.
    const loc = event.locals.locale;
    if (loc && loc !== 'en' && !event.cookies.get('locale')) {
      event.cookies.set('locale', loc, { path: '/', maxAge: 31536000, sameSite: 'lax' });
    }
    throw redirect(303, marketingDest);
  }

  const doResolve = () =>
    resolve(event, {
      transformPageChunk: ({ html }) => {
        let out = html.replace('%lang%', event.locals.locale);
        // Keep in sync with +layout.svelte — scopes landing.css away from /app on SSR too.
        if (
          event.url.pathname.startsWith('/app') ||
          event.url.pathname === '/start' ||
          event.url.pathname.startsWith('/start/')
        ) {
          out = out.replace('<html', '<html data-shell="app"');
        }
        return out;
      },
      filterSerializedResponseHeaders: (name) =>
        name === 'content-range' || name === 'x-supabase-api-version'
    });

  // Brand-scoped AI credit attribution: every request under /app/[brand]/… or
  // /api/v1/brands/[slug]/… runs inside withBrandContext, so ANY AI call it triggers
  // (chat tools, post generation, blog actions, radar, leads…) lands in ai_calls with
  // brand_id and bills the right brand — no per-route wrapping needed.
  const slug = event.params.brand ?? event.params.slug;

  // Page-payload cache (see $lib/server/page-cache): anything that can write for this brand
  // drops its cached pages, so the next navigation re-reads. Doing it here — once, on the
  // request — rather than inside each form action means a newly added action cannot forget
  // to invalidate and leave the dashboard showing a stale count. GET/HEAD never mutate, so
  // read navigation keeps its hits.
  if (slug && event.request.method !== 'GET' && event.request.method !== 'HEAD') {
    const { invalidateBrandPages } = await import('$lib/server/page-cache');
    invalidateBrandPages(slug);
  }

  if (slug) {
    const brandId = await brandIdFromSlug(slug);
    if (brandId) return withBrandContext(brandId, doResolve);
  }
  return doResolve();
});
export const handleError = Sentry.handleErrorWithSentry();
