/**
 * DeepSeek: gli id dei modelli, e l'interruttore che si accorge quando la chiave è morta.
 *
 * Qui c'era anche il client strutturato (`deepseekStructured`/`deepseekText`) che faceva il lavoro
 * di sfondo: a $0.14/$0.28 per 1M token costava ~10× meno di Gemini Flash sulle stesse estrazioni.
 * È stato tolto perché il ripiego su Gemini funzionava troppo bene: con la chiave a saldo zero ogni
 * chiamata faceva un tentativo condannato, aspettava il 402 e rifaceva il lavoro su Gemini, senza
 * che niente si rompesse in superficie. Le funzioni sono sparite con quel percorso; restano le
 * costante, che serve ancora alla sonda di citazioni (`citation-probe.ts`): lì DeepSeek non genera
 * niente per noi, è il motore di risposta di cui MISURIAMO le citazioni del brand.
 *
 * L'INTERRUTTORE è la parte che mancava allora. `deepseekConfigured()` guardava solo se la variabile
 * d'ambiente ESISTEVA — "configurata" non ha mai voluto dire "ha credito", ed è per questo che il
 * guasto è durato ore. Un 401/402 dice che la chiave non pagherà nemmeno la prossima chiamata: da
 * quel momento DeepSeek va saltato, non ritentato. Sta qui, in un posto solo, perché ogni call site
 * imparasse la stessa lezione da solo era esattamente il difetto.
 */
import { env } from '$env/dynamic/private';

export const DEEPSEEK_MODEL = env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

// Vale per il processo, non per sempre: su Vercel le funzioni si riciclano di continuo, quindi una
// chiave ricaricata torna viva al prossimo cold start senza che nessuno debba fare niente.
// ponytail: nessun TTL, nessuna ri-prova programmata — il riciclo del processo è già il timer.
let keyIsDead = false;

/** C'è una chiave E non l'abbiamo ancora vista rifiutare per credito o autenticazione. */
export const deepseekAlive = (): boolean => !!env.DEEPSEEK_API_KEY && !keyIsDead;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const statusOf = (v: any): number =>
  typeof v === 'number' ? v : Number(v?.statusCode ?? v?.status ?? v?.response?.status ?? NaN);

/**
 * Da chiamare su OGNI fallimento DeepSeek, passando lo status HTTP o l'errore così com'è (l'AI SDK
 * mette il codice in `statusCode`, a volte dentro `cause`). Solo 401 e 402 spengono il provider:
 * un 429 o un 5xx passano, perché quelli sì che vale la pena ritentare.
 */
export function noteDeepseekFailure(failure: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const status = [failure, (failure as any)?.cause].map(statusOf).find((s) => s === 401 || s === 402);
  if (!status || keyIsDead) return;
  keyIsDead = true;
  console.error(
    `[AI:DeepSeek] HTTP ${status}: chiave esaurita o non valida. DeepSeek è escluso per il resto del processo — ` +
      'nessuna altra chiamata condannata, e nessun motore di risposta misurato senza averlo mai raggiunto.'
  );
}
