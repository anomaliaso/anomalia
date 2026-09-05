// Analytics loader, due tier:
//  1. Anonimo (nessun consenso) — PostHog cookieless: persistenza solo in memoria, niente cookie,
//     niente registrazione di sessione, niente profili. È la modalità aggregata che il Garante
//     tratta come esente da consenso preventivo. Gira su ogni visita.
//  2. Pieno (dopo l'accettazione) — PostHog con cookie persistenti + session recording, più
//     Clarity, che è session-replay per natura e non ha una modalità anonima.
//
// Le chiavi vengono dalle env pubbliche; chiave assente = strumento saltato. Gli script pesanti
// partono alla prima interazione o dopo 10s, per non competere con LCP/TBT su mobile freddo.
//
// Per il tier 1 davvero anonimo va anche acceso "Discard client IP data" nelle impostazioni del
// progetto PostHog.
//
// Sopra i due tier ci sono due guard che vengono PRIMA di tutto (`blocked()`): l'ambiente e chi sta
// guardando. Decidono di NON inizializzare, non di inizializzare e poi disattivare — una volta che
// PostHog è partito il pageview è già andato.

import { browser, dev } from '$app/environment';
import { env } from '$env/dynamic/public';

type PostHog = {
  init: (key: string, opts: object) => void;
  set_config: (opts: object) => void;
  startSessionRecording?: () => void;
  capture?: (event: string, props?: Record<string, unknown>) => void;
  identify?: (id: string, props?: Record<string, unknown>) => void;
};

let posthogScheduled = false;
let posthogReady = false;
let posthogUpgraded = false;
let wantFullAnalytics = false;
let clarityStarted = false;
let metaPixelScheduled = false;
let metaPixelReady = false;
let bookingClicksBound = false;
let selineScheduled = false;
let analyticsOptOut = false;

// Nessun default per pixel e token: erano i NOSTRI, cablati come fallback — un'installazione
// self-hosted caricava il pixel Meta di Anomalia e identificava i propri utenti nel nostro
// progetto Seline. Senza la variabile d'ambiente, quel pezzo non parte. Vale anche per noi:
// PUBLIC_META_PIXEL_ID e PUBLIC_SELINE_TOKEN devono stare nell'env di produzione.
const metaPixelId = () => env.PUBLIC_META_PIXEL_ID?.trim() || '';
const selineToken = () => env.PUBLIC_SELINE_TOKEN?.trim() || '';

// Host che NON sono la produzione vera. `dev` di $app/environment copre solo `vite dev`: un
// `vercel dev` e ogni deploy di preview girano in modalità build, con le stesse chiavi pubbliche
// della produzione, e finivano nel progetto PostHog dei clienti veri. Inclusa la LAN privata,
// perché la prova sul telefono punta all'IP del Mac, non a localhost.
const NON_PROD_HOST =
  /^(localhost|.+\.localhost|.+\.local|.+\.vercel\.app|0\.0\.0\.0|\[?::1\]?|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

/** True solo se questo hostname è la produzione vera. Logica pura: è la parte che si testa. */
export function isProdHost(hostname: string | null | undefined): boolean {
  const h = (hostname ?? '').trim().toLowerCase();
  return !!h && !NON_PROD_HOST.test(h);
}

/** Guard 1 — l'ambiente. Un solo posto a cui chiedere "qui si traccia?": lo usa anche il root
 * +layout.server.ts, così client e server rispondono uguale. */
export function trackingAllowed(hostname: string | null | undefined): boolean {
  return !dev && isProdHost(hostname);
}

/**
 * Guard 2 — chi sta guardando. Il valore lo calcola il server: al browser arriva solo il booleano,
 * mai la lista degli indirizzi interni.
 * Va impostato nel body dello script del layout, non in un `$effect`: CookieBanner è un figlio e il
 * suo `onMount` gira PRIMA degli effect del genitore, quando PostHog sarebbe già schedulato.
 */
export function setAnalyticsOptOut(value: boolean) {
  analyticsOptOut = value;
}

/**
 * Lo stesso guard 2, ma per Sentry — separato apposta: `analyticsOptOut` è "non produzione OPPURE
 * siamo noi", e gli errori di un deploy di preview li vogliamo vedere. Qui conta solo chi guarda;
 * l'ambiente lo decide `dev` in hooks.client.ts.
 * Letto a ogni invio e non una volta all'init: quando Sentry parte l'identità non è nota, e dopo un
 * login lato client cambia senza ricaricare la pagina.
 */
let internalViewer = false;
export function setInternalViewer(value: boolean) {
  internalViewer = value;
}
export function isInternalViewer(): boolean {
  return internalViewer;
}

/** `beforeSend*` di Sentry: passa l'evento, o `null` se chi guarda è dei nostri. Qui e non inline
 * in hooks.client.ts perché è l'unico ramo che vale la pena testare. */
export function dropIfInternal<T>(x: T): T | null {
  return internalViewer ? null : x;
}

/**
 * L'unico cancello. Nessun tracker si inizializza se scatta un guard — non "parte e poi si
 * disattiva": `opt_out_capturing()` arriverebbe dopo il pageview già spedito. Non tocca il
 * consenso: un tracker zittito e una banner nascosta sono due cose diverse.
 */
function blocked(): boolean {
  return !browser || analyticsOptOut || !trackingAllowed(window.location.hostname);
}

/** Run `fn` on first interaction, or 10s after window load — whichever comes first. */
function whenIdleOrInteract(fn: () => void) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  for (const e of ['scroll', 'pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(e, run, { once: true, passive: true, capture: true });
  }
  const armTimer = () => setTimeout(run, 10000);
  if (document.readyState === 'complete') armTimer();
  else window.addEventListener('load', armTimer, { once: true });
}

/**
 * Meta (Facebook) Pixel. Era fisso in app.html e partiva su OGNI pagina, blog dei brand inclusi,
 * prima di ogni consenso. Ora è una funzione: l'app lo carica deferito, un blog solo dopo
 * l'accettazione. Idempotente; no-op sul server.
 */
export function loadMetaPixel() {
  const pixelId = metaPixelId();
  if (blocked() || metaPixelScheduled || !pixelId) return;
  metaPixelScheduled = true;
  // Click pagato (`fbclid`) → carica SUBITO. Meta conta una Landing Page View solo se PageView
  // parte dopo il click: deferire perde ogni visitatore che arriva e se ne va entro 10s, cioè
  // nasconde i rimbalzi e allena la delivery su un segnale censurato.
  const paidClick = new URLSearchParams(window.location.search).has('fbclid');
  const start = () => {
    if (metaPixelReady) return;
    metaPixelReady = true;
    injectInline(
      `!(function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)})(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`
    );
  };
  if (paidClick) start();
  else whenIdleOrInteract(start);
}

/**
 * Fire a Meta Pixel conversion event (e.g. CompleteRegistration) from the browser. There is no
 * server-side Conversions API half in this repo, so `eventID` buys nothing today — it is there for
 * the day one exists and the two need deduping into one conversion.
 * No-ops on the server or before the pixel has loaded.
 */
export function metaPixelTrack(event: string, params?: Record<string, unknown>, eventID?: string) {
  if (!browser) return;
  const fbq = (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq;
  if (!fbq) return;
  fbq('track', event, params ?? {}, eventID ? { eventID } : undefined);
}

/**
 * Ogni click su "prenota una call" è un `Schedule` di Meta: i piani a pagamento chiudono dopo una
 * call Calendly, non self-serve, quindi la call prenotata — non Purchase — è la conversione che
 * capita abbastanza spesso da allenare la delivery. Un listener delegato copre ogni CTA BOOKING_URL
 * presente e futura.
 *
 * Il pixel carica alla prima interazione e `pointerdown` precede `click`, quindi qui `fbq` esiste
 * già (o il suo stub accoda). Idempotente; no-op sul server.
 * ponytail: click, non prenotazione confermata. Un webhook Calendly → metaCapiEvent sarebbe esatto;
 * si aggiunge se il divario fra click e prenotazione comincia a contare.
 */
export function trackBookingClicks() {
  if (!browser || bookingClicksBound) return;
  bookingClicksBound = true;
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('a[href*="calendly.com"]') : null;
      if (!el) return;
      metaPixelTrack('Schedule');
      track('booking_click', { href: el.getAttribute('href') });
    },
    { capture: true }
  );
}

function posthog(): PostHog | undefined {
  return (window as unknown as { posthog?: PostHog }).posthog;
}

function injectInline(code: string) {
  const s = document.createElement('script');
  s.textContent = code;
  document.head.appendChild(s);
}

function upgradePostHog() {
  if (posthogUpgraded || !posthog()) return;
  posthogUpgraded = true;
  posthog()?.set_config({ persistence: 'localStorage+cookie' });
  posthog()?.startSessionRecording?.();
}

async function startClarity() {
  const clarityId = env.PUBLIC_CLARITY_ID;
  if (blocked() || !clarityId || clarityStarted) return;
  clarityStarted = true;
  const { default: Clarity } = await import('@microsoft/clarity');
  Clarity.init(clarityId);
  Clarity.consent();
}

/**
 * Seline — page view senza cookie. Stava in app.html come `<script>` fisso, e un tag nell'HTML non
 * sa né dove gira né chi ha davanti: contava localhost, i preview e noi. Qui passa dagli stessi due
 * guard di tutto il resto. Caricato subito e non al primo click: pesa poco, e la sua unica metrica
 * deferita di 10s si perderebbe. Idempotente; no-op sul server.
 */
export function loadSeline() {
  const token = selineToken();
  if (blocked() || selineScheduled || !token) return;
  selineScheduled = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://cdn.seline.com/seline.js';
  s.dataset.token = token;
  s.dataset.cookieOnIdentify = 'true';
  document.head.appendChild(s);
}

/**
 * Fire a semantic product event (e.g. onboarding steps). Safe to call anywhere: it no-ops on the
 * server and before PostHog has loaded the stub queues the call until the library is ready.
 */
export function track(event: string, props?: Record<string, unknown>) {
  if (!browser) return;
  posthog()?.capture?.(event, props);
}

type SelineBrowser = {
  setUser?: (data: { userId: string } & Record<string, unknown>) => void;
};

function selineBrowser(): SelineBrowser | undefined {
  return (window as unknown as { seline?: SelineBrowser }).seline;
}

/**
 * Lega la sessione anonima a un utente loggato, così gli eventi di prodotto formano un funnel per
 * utente. Solo con un id reale di utente loggato. Identifica anche in Seline lato client, come fa
 * il server via @seline-analytics/node.
 */
export function identifyUser(id: string, props?: Record<string, unknown>) {
  // Il guard vale anche qui: identificare È tracciare, e questa funzione fa partire PostHog da sola.
  if (blocked() || !id) return;
  // Make sure PostHog is scheduled (in the app the consent banner may not have mounted yet).
  startAnonymousAnalytics();
  posthog()?.identify?.(id, props);
  // Client setUser links this browser visitor to the Profile (cookieOnIdentify in app.html).
  selineBrowser()?.setUser?.({ userId: id, ...props });
}

/** Tier 1 — anonymous, cookieless analytics. Safe to call on every page load, no consent needed. */
export function startAnonymousAnalytics() {
  if (blocked() || posthogScheduled) return;
  const key = env.PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthogScheduled = true;

  whenIdleOrInteract(() => {
    if (posthogReady) return;
    posthogReady = true;
    injectInline(POSTHOG_SNIPPET);
    posthog()?.init(key, {
      api_host: 'https://eu.i.posthog.com', // Anomalia project lives on PostHog EU cloud
      persistence: 'memory', // no cookies, no localStorage → anonymous
      person_profiles: 'identified_only',
      disable_session_recording: true,
      capture_pageview: true,
      autocapture: true
    });
    if (wantFullAnalytics) {
      upgradePostHog();
      void startClarity();
    }
  });
}

/** Tier 2 — called once the user accepts. Upgrades PostHog and loads Clarity (still deferred). */
export async function enableFullAnalytics() {
  if (blocked()) return;
  wantFullAnalytics = true;
  startAnonymousAnalytics();
  if (posthogReady) {
    upgradePostHog();
    await startClarity();
  }
}

// Canonical PostHog snippet (https://posthog.com/docs/libraries/js) — the array stub that
// queues calls until the real library finishes loading.
const POSTHOG_SNIPPET =
  '!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);';
