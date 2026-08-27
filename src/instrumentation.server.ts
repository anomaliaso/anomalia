import * as Sentry from '@sentry/sveltekit';

// Fuori dalla produzione Sentry non parte proprio — stessa scelta di hooks.client.ts, altrimenti
// si spegne metà del rumore e sembra risolto: il server è la metà che manda le transazioni di ogni
// richiesta di `npm run dev`. `captureException` senza client è un no-op, quindi chi lo chiama
// (onboarding-errors, market-errors, …) continua a fare il resto del suo lavoro.
// `$app/environment` non è disponibile così presto nell'entrypoint server, quindi NODE_ENV e
// process.env diretto. Nessun DSN nostro di default: un self-host senza PUBLIC_SENTRY_DSN
// manderebbe altrimenti i suoi errori al NOSTRO progetto Sentry (vedi hooks.client.ts).
if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.PUBLIC_SENTRY_DSN,

    // 10% — 100% traccerebbe ogni richiesta e cresce in fretta.
    tracesSampleRate: 0.1,

    // Enable logs to be sent to Sentry
    enableLogs: true

    // uncomment the line below to enable Spotlight (https://spotlightjs.com)
    // spotlight: import.meta.env.DEV,
  });
}
