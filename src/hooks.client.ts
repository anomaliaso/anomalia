import type { HandleClientError } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { dropIfInternal, isInternalViewer } from '$lib/analytics';
import { drainErrors, rememberError } from '$lib/sentry-buffer';

type SentryModule = typeof import('@sentry/sveltekit');

/**
 * IL CLIENT SENTRY ARRIVA DOPO, E NON PER GUSTO DELL'OTTIMIZZAZIONE.
 *
 * Misurato il 2/9 su due build identici a meno di Sentry: 329 moduli `@sentry/*` valgono
 * **123,4 KB gzip del percorso critico** della pagina chat (611,4 → 488,0), e 74,4 di quei KB
 * stanno dentro `entry/app.js` — il file che OGNI pagina dell'app scarica prima di disegnare
 * qualsiasi cosa. Con un `import` statico quei byte sono sulla strada del primo fotogramma
 * sempre, anche quando non c'è niente da segnalare.
 *
 * Quindi l'import è dinamico e parte a idle (o alla prima interazione, come già faceva il
 * replay). Quel che si perde è la finestra fra il caricamento e l'idle: la copre
 * `$lib/sentry-buffer`, che tiene gli errori da parte e li rigioca appena il client c'è.
 */
let sentryModule: Promise<SentryModule> | null = null;
let sentryReady = false;

function sentryEnabled(): boolean {
  return !dev && !!env.PUBLIC_SENTRY_DSN;
}

async function bootSentry(): Promise<SentryModule | null> {
  // Guard 1 — l'ambiente. In locale Sentry non parte proprio: niente client, quindi niente
  // tracce, niente log, niente replay, niente sessioni. Prima il campionamento in dev era 1.0,
  // cioè `npm run dev` spediva OGNI transazione all'ingest: quota bruciata, e le 429 di risposta
  // che tornavano indietro sembravano errori dell'applicazione (ci hanno già fatto perdere una
  // diagnosi).
  // Guard 3 — self-hosted senza PUBLIC_SENTRY_DSN: nessun default nostro, altrimenti ogni fork
  // manderebbe i suoi errori al NOSTRO progetto Sentry. Non configurato → non si carica nemmeno.
  if (!sentryEnabled()) return null;

  sentryModule ??= import('@sentry/sveltekit');
  const Sentry = await sentryModule;
  if (sentryReady) return Sentry;
  sentryReady = true;

  Sentry.init({
    dsn: env.PUBLIC_SENTRY_DSN,

    // 10% — 100% traccerebbe ogni richiesta e cresce in fretta.
    tracesSampleRate: 0.1,

    // Enable logs to be sent to Sentry
    enableLogs: true,

    // No opportunistic session replay — only record when an error fires (after Replay is attached).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,

    // Enable sending user PII (Personally Identifiable Information)
    // https://docs.sentry.io/platforms/javascript/guides/sveltekit/configuration/options/#sendDefaultPii
    sendDefaultPii: true,

    // Guard 2 — chi sta guardando. Il client si inizializza lo stesso, ma ogni evento viene
    // scartato se il visitatore è dei nostri. Valutato a ogni invio, non una volta qui, così un
    // login lato client conta subito.
    beforeSend: dropIfInternal,
    beforeSendTransaction: dropIfInternal,
    beforeSendLog: dropIfInternal
  });

  // Quello che è successo mentre il modulo era per strada.
  for (const error of drainErrors()) Sentry.captureException(error);

  return Sentry;
}

async function attachReplay(): Promise<void> {
  // La registrazione della sessione non si aggiunge nemmeno, per noi: scartare gli eventi dopo
  // basterebbe, ma il replay inizia a bufferizzare il DOM appena è agganciato ed è la cosa che
  // vogliamo evitare per prima. Arriviamo qui alla prima interazione o dopo 8–10s, quindi
  // l'identità è già nota da un pezzo (il layout la imposta all'idratazione).
  if (dev || isInternalViewer()) return;
  const Sentry = await bootSentry();
  if (!Sentry) return;
  try {
    Sentry.addIntegration(Sentry.replayIntegration());
  } catch {
    // ignore — Sentry may already have it, or client not ready
  }
}

/** Quando il browser non ha di meglio da fare, e comunque non oltre `timeout`. */
function whenIdle(fn: () => void, timeout: number): void {
  const ric = (
    window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }
  ).requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else setTimeout(fn, timeout);
}

if (!dev && typeof window !== 'undefined') {
  // La rete di sicurezza si arma SUBITO, e non costa niente: è la finestra in cui Sentry non c'è
  // ancora. Si spegne da sola al primo `drainErrors`, quando i suoi handler globali prendono il
  // posto — o gli stessi errori partirebbero due volte.
  window.addEventListener('error', (event) => rememberError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => rememberError(event.reason));

  // App shell: init appena il browser è libero (gli errori contano). Marketing: si aspetta
  // l'interazione, così l'envelope verso l'ingest resta fuori dall'albero di rete dell'LCP.
  const path = window.location.pathname;
  const isApp =
    path === '/app' ||
    path.startsWith('/app/') ||
    path === '/login' ||
    path.startsWith('/login') ||
    path === '/start' ||
    path.startsWith('/start/');

  if (isApp) whenIdle(() => void bootSentry(), 3000);

  const wake = () => {
    void attachReplay();
  };
  for (const e of ['scroll', 'pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(e, wake, { once: true, passive: true, capture: true });
  }
  window.addEventListener(
    'load',
    () => {
      setTimeout(wake, isApp ? 10000 : 8000);
    },
    { once: true }
  );
}

/**
 * L'errore che passa da SvelteKit paga il caricamento del modulo, se non è già arrivato: succede
 * una volta sola, e solo quando qualcosa è già andato storto — il momento in cui quei byte
 * valgono davvero. Senza DSN resta il `console.error` di prima.
 */
export const handleError: HandleClientError = async (input) => {
  const Sentry = await bootSentry();
  if (!Sentry) {
    console.error(input.error);
    return;
  }
  // `@sentry/sveltekit` tipa `handleErrorWithSentry` sull'evento del SERVER anche quando lo si
  // usa come hook del client: a runtime legge solo `error` e la rotta, ed è la stessa funzione
  // che stava qui prima: il cast tiene il comportamento identico invece di riscriverne uno.
  const report = Sentry.handleErrorWithSentry() as unknown as HandleClientError;
  return report(input);
};
