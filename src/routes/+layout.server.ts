import type { LayoutServerLoad } from './$types';
import { flagEnabled } from '$lib/server/access';
import { isPlanGoEnabled } from '$lib/server/feature-flags';
import { isLocale } from '$lib/i18n/locale';
import { selineSetUser } from '$lib/server/seline';
import { isInternalEmail } from '$lib/server/internal-users';
import { trackingAllowed } from '$lib/analytics';

export const load: LayoutServerLoad = async ({ request, url, locals: { supabase, safeGetSession, locale } }) => {
  // Independent of each other (session lookup vs. flag RPC) — run in parallel.
  const [{ session, user }, waitlistActive] = await Promise.all([
    safeGetSession(),
    // Drives the landing copy: when the waitlist is off, CTAs say "Get started".
    flagEnabled(supabase, 'waitlist', true)
  ]);

  // I due guard degli analytics, decisi qui una volta sola.
  //
  //  1. l'ambiente: fuori dalla produzione vera (dev, `vercel dev`, preview) non si traccia niente;
  //  2. chi sta guardando: le nostre sessioni non vanno registrate né identificate.
  //
  // Il secondo si risolve QUI, non nel browser: la lista di chi è interno vive in $lib/server e al
  // client arriva solo il booleano — gli indirizzi del team non finiscono in un bundle pubblico.
  const internalViewer = isInternalEmail(user?.email);
  const analyticsOptOut = !trackingAllowed(url.hostname) || internalViewer;

  // Seline Profiles: identify authenticated users server-side (adblock-proof). Debounced in
  // $lib/server/seline. Client script still stitches the browser visitor via setUser in identifyUser.
  // Vale anche qui: un guard solo nel browser sarebbe cosmetico, questa chiamata parte dal server.
  if (user?.id && !analyticsOptOut) {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const name =
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      undefined;
    selineSetUser(user.id, {
      ...(user.email ? { email: user.email } : {}),
      ...(name ? { name } : {})
    });
  }

  // Auto-save detected locale to profile on first visit (best-effort, fire-and-forget).
  // This ensures cron emails (weekly recap, scheduler) go out in the user's language
  // even if they never explicitly toggle the language selector.
  if (user && isLocale(locale)) {
    supabase.from('profiles').select('locale').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (!data?.locale) {
        supabase.from('profiles').update({ locale }).eq('id', user.id).then(() => {});
      }
    });
  }

  // Visitor country (Vercel edge header) — gates the cookie banner: EEA/UK/CH require prior
  // consent, everyone else gets full analytics with no banner. Null in dev / non-Vercel →
  // treated as consent-required (safe default). See $lib/consent.initConsentForRegion.
  const country = request.headers.get('x-vercel-ip-country');

  // Resolved server-side (hooks); the root +layout.ts feeds it into the i18n store.
  // planGo: Vercel FEATURE_PLAN_GO — toggle without rebuild via $env/dynamic.
  // `internalViewer` viaggia separato da `analyticsOptOut` perché serve a Sentry, che sui deploy di
  // preview deve restare acceso (vedi setInternalViewer in $lib/analytics). Anche qui al browser
  // arriva solo il booleano, mai la lista degli indirizzi.
  return {
    session,
    waitlistActive,
    locale,
    country,
    analyticsOptOut,
    internalViewer,
    planGo: isPlanGoEnabled()
  };
};
