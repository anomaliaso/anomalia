import { handleErrorWithSentry, replayIntegration } from "@sentry/sveltekit";
import * as Sentry from '@sentry/sveltekit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { dropIfInternal, isInternalViewer } from '$lib/analytics';

let sentryReady = false;

function bootSentry() {
  // Guard 1 — l'ambiente. In locale Sentry non parte proprio: niente client, quindi niente
  // tracce, niente log, niente replay, niente sessioni. Prima il campionamento in dev era 1.0,
  // cioè `npm run dev` spediva OGNI transazione all'ingest: quota bruciata, e le 429 di risposta
  // che tornavano indietro sembravano errori dell'applicazione (ci hanno già fatto perdere una
  // diagnosi). Un errore in dev resta comunque visibile: `handleErrorWithSentry()` senza handler
  // custom fa console.error, e `captureException` senza client è un no-op silenzioso.
  // Guard 3 — self-hosted senza PUBLIC_SENTRY_DSN: nessun default nostro, altrimenti ogni fork
  // manderebbe i suoi errori al NOSTRO progetto Sentry. Non configurato → stesso no-op del dev.
  const dsn = env.PUBLIC_SENTRY_DSN;
  if (sentryReady || dev || !dsn) return;
  sentryReady = true;

  Sentry.init({
    dsn,

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

    // Guard 2 — chi sta guardando. Il client si inizializza lo stesso (a questo punto l'identità
    // non è nota: `bootSentry` gira al caricamento del modulo, il layout dice chi è solo
    // all'idratazione), ma ogni evento viene scartato se il visitatore è dei nostri. Valutato a
    // ogni invio, non una volta qui, così un login lato client conta subito.
    beforeSend: dropIfInternal,
    beforeSendTransaction: dropIfInternal,
    beforeSendLog: dropIfInternal
  });
  // ponytail: resta fuori un solo envelope `session` (release health) per caricamento a freddo
  // dello shell app: `browserSessionIntegration` lo manda dentro init, prima che il layout dica
  // chi sta guardando. Niente errori, niente transazioni, niente replay, nessun payload. Sulle
  // pagine marketing non succede nemmeno quello, perché lì l'init è differito al wake. Se anche
  // quel residuo dà fastidio: togliere `BrowserSession` dalle integrazioni di default e
  // riaggiungerla da `setInternalViewer(false)`.
}

function attachReplay() {
  // La registrazione della sessione non si aggiunge nemmeno, per noi: scartare gli eventi dopo
  // basterebbe, ma il replay inizia a bufferizzare il DOM appena è agganciato ed è la cosa che
  // vogliamo evitare per prima. Arriviamo qui alla prima interazione o dopo 8–10s, quindi
  // l'identità è già nota da un pezzo (il layout la imposta all'idratazione).
  if (dev || isInternalViewer()) return;
  bootSentry();
  try {
    Sentry.addIntegration(replayIntegration());
  } catch {
    // ignore — Sentry may already have it, or client not ready
  }
}

if (!dev && typeof window !== 'undefined') {
  // App shell: init Sentry soon (errors matter). Marketing: wait for interaction / idle so
  // the ingest envelope stays off the LCP critical path (PSI network tree).
  const path = window.location.pathname;
  const isApp =
    path === '/app' ||
    path.startsWith('/app/') ||
    path === '/login' ||
    path.startsWith('/login') ||
    path === '/start' ||
    path.startsWith('/start/');

  if (isApp) {
    bootSentry();
  }

  const wake = () => {
    bootSentry();
    attachReplay();
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

// If you have a custom error handler, pass it to `handleErrorWithSentry`
export const handleError = handleErrorWithSentry();
