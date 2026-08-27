/**
 * IL TEMPO DI VM SI PAGA, E LO PAGA CHI LO USA.
 *
 * Finché la sandbox serviva a calcolare qualcosa dentro un turno — contare righe di un CSV, provare
 * uno script — il suo costo era rumore dentro il costo del turno. Con il render dei motion video in
 * VM diventa un'altra cosa: l'MP4 non lo produce più la CPU dell'utente, che era gratis, ma una
 * macchina che fatturiamo noi, per un minuto o due, a ogni video.
 *
 * Un costo che sostiene il prodotto e non compare da nessuna parte è il modo in cui una feature
 * diventa una perdita che nessuno vede finché non è grande. Quindi si addebita, e si addebita nello
 * STESSO posto di tutto il resto: `ai_calls` con `flatCostUsd`, che è già il registro dei servizi a
 * prezzo fisso (Tavily, le ads) e da cui `getCreditsUsage` legge senza sapere niente di sandbox.
 * Nessun secondo sistema di contabilità.
 *
 * ## Perché a secondi e non a render
 *
 * Un render di sei secondi e uno di novanta non costano uguale, e un prezzo fisso a video o regala
 * i lunghi o rapina i corti. Il tempo di VM è la cosa che paghiamo davvero, quindi è la cosa che si
 * misura — e si misura con l'orologio, non con una stima: `withSandboxBilling` cronometra ciò che
 * è successo, non ciò che pensavamo sarebbe successo.
 *
 * ## Perché si addebita anche quando il render fallisce
 *
 * Perché la macchina è stata accesa comunque. Un render che esplode dopo novanta secondi ci è
 * costato novanta secondi. L'alternativa — non addebitare i fallimenti — è un invito a riprovare
 * all'infinito gratis, e sarebbe la prima cosa che fa un agente in loop. Il fallimento però si
 * vede: la riga porta `ok: false`, quindi in bolletta si distingue.
 */
import { CREDITS_PER_USD } from '$lib/ads-fee';
import { logAiCall } from '$lib/server/ai-log';
import { env } from '$env/dynamic/private';

/**
 * Costo di un secondo di sandbox, in USD, per l'intera macchina.
 *
 * Vercel fattura a vCPU-ora; il default qui è calcolato su 2 vCPU (`SANDBOX_VCPUS`) al listino noto
 * alla data di scrittura. Sta in una variabile perché un prezzo cablato nel codice è un prezzo che
 * resta sbagliato fino al prossimo deploy: `SANDBOX_USD_PER_SECOND` lo corregge in un minuto.
 */
export function sandboxUsdPerSecond(): number {
  const raw = Number(env.SANDBOX_USD_PER_SECOND);
  if (Number.isFinite(raw) && raw > 0) return raw;
  const vcpus = Math.max(1, Number(env.SANDBOX_VCPUS || 2));
  // ~$0.128 per vCPU-ora → 0.0000356 $/s per vCPU.
  return vcpus * 0.0000356;
}

/**
 * Quanto ricarichiamo sopra il costo vivo. 1 = a costo.
 *
 * Non è avidità né sconto: è la manopola che esiste perché un giorno servirà, e senza la quale il
 * prezzo lo si cambia modificando la formula — cioè rischiando di sbagliarla.
 */
export function sandboxMarkup(): number {
  const raw = Number(env.SANDBOX_CREDIT_MARKUP);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/**
 * Secondi di macchina → crediti.
 *
 * Arrotonda per ECCESSO a un credito quando qualcosa è stato speso: un addebito che arrotonda a
 * zero è un addebito che non esiste, e mille render da mezzo credito farebbero mille render gratis.
 * Zero secondi, invece, restano zero.
 */
export function sandboxCredits(seconds: number): number {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  const usd = s * sandboxUsdPerSecond() * sandboxMarkup();
  return Math.max(1, Math.ceil(usd * CREDITS_PER_USD));
}

export type SandboxUse = 'motion_render' | 'motion_stills' | 'agent';

/** Scrive l'addebito nel registro dei crediti. Fire-and-forget come ogni `logAiCall`. */
export function chargeSandboxCredits(opts: {
  brandId: string;
  userId?: string;
  seconds: number;
  use: SandboxUse;
  ok: boolean;
  detail?: string;
  /** Il messaggio del fallimento, quando c'è: senza, il registro dice quanto e non cosa. */
  error?: string;
}): number {
  const credits = sandboxCredits(opts.seconds);
  if (credits <= 0) return 0;
  logAiCall({
    label: `sandbox.${opts.use}`,
    provider: 'sandbox',
    model: opts.use,
    flatCostUsd: credits / CREDITS_PER_USD,
    ms: Math.round(opts.seconds * 1000),
    // `ok` dice com'è andato il render, NON se l'addebito vale: la macchina è stata accesa in
    // entrambi i casi. Serve a distinguerli in bolletta, non a esentare il fallimento.
    ok: opts.ok,
    brandId: opts.brandId,
    userId: opts.userId,
    ...(opts.error ? { error: opts.error.slice(0, 800) } : {}),
    context: `sandbox:${opts.use}:${Math.round(opts.seconds)}s${opts.detail ? `:${opts.detail}` : ''}`
  });
  return credits;
}

/**
 * Cronometra un uso della VM e lo addebita, comunque vada.
 *
 * Il `finally` è il punto: un'eccezione a metà render non deve saltare l'addebito, o il percorso
 * che costa di più diventerebbe l'unico gratuito.
 */
export async function withSandboxBilling<T>(
  opts: { brandId: string; userId?: string; use: SandboxUse; detail?: string },
  fn: () => Promise<T>
): Promise<T> {
  const t0 = Date.now();
  let ok = false;
  // Il PERCHÉ del fallimento, che la prima versione non registrava.
  //
  // Addebitava i secondi e segnava `ok: false`, e basta. In produzione tre render su quattro sono
  // falliti e nel registro non c'era una riga di errore: si vedeva solo che erano durati 245 e 342
  // secondi. Un log che dice QUANTO ma non COSA costringe a indovinare, ed è esattamente la
  // situazione in cui indovinare costa di più.
  let failure: string | undefined;
  try {
    const out = await fn();
    ok = true;
    return out;
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    chargeSandboxCredits({
      brandId: opts.brandId,
      userId: opts.userId,
      seconds: (Date.now() - t0) / 1000,
      use: opts.use,
      ok,
      detail: opts.detail,
      error: failure
    });
  }
}
