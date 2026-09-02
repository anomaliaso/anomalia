/**
 * Gli errori accaduti PRIMA che il client Sentry sia arrivato.
 *
 * Sentry non si carica più al primo istante — vale 123 KB gzip del percorso critico, misurati —
 * quindi fra il primo byte e l'idle c'è una finestra senza nessuno che raccolga gli errori. È
 * proprio la finestra in cui l'app si idrata: buttarla via significherebbe smettere di vedere
 * la classe di errori più interessante che abbiamo.
 *
 * Dopo lo svuotamento la coda si spegne per sempre: da lì in poi ci sono gli handler globali di
 * Sentry, e continuare a ricordare vorrebbe dire spedire ogni errore due volte.
 */
const MAX_PENDING = 20;

let pending: unknown[] = [];
let drained = false;

export function rememberError(error: unknown): void {
  if (drained || pending.length >= MAX_PENDING) return;
  pending.push(error);
}

export function drainErrors(): unknown[] {
  drained = true;
  const out = pending;
  pending = [];
  return out;
}

/** Solo per i test: riporta la coda allo stato di una pagina appena aperta. */
export function __resetErrorBufferForTests(): void {
  pending = [];
  drained = false;
}
