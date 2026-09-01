/**
 * Ritrovare il nostro commento in un thread che non abbiamo pubblicato noi.
 *
 * IL PROBLEMA DI FONDO: il commento lo incolla l'umano, con il suo account, che noi non
 * conosciamo — ed è la scelta giusta, è la ragione per cui gli account sopravvivono. Quindi il
 * commento va RITROVATO nel thread, e l'unico appiglio è il testo che avevamo scritto.
 *
 * Il matcher lavora su shingle di tre parole, non su parole singole: "social media marketing"
 * compare in metà dei commenti di r/SaaS, "before it turns into another" no. E misura il
 * CONTENIMENTO delle shingle della bozza dentro il candidato, non la somiglianza simmetrica —
 * perché chi incolla taglia, aggiunge una riga sua, corregge un refuso: il testo cresce o si
 * accorcia, ma i pezzi che restano sono i nostri.
 */

/** Prima di 48h il punteggio di un commento non si è assestato: guardarlo prima è rumore. */
export const CHECK_AFTER_HOURS = 48;
/** Oltre questa età non si controlla più: il thread è morto e il dato non cambierebbe. */
export const CHECK_BEFORE_DAYS = 14;
/** Lead controllati per run (ogni controllo è una chiamata al lettore di thread). */
export const MAX_CHECKS_PER_RUN = 25;

/**
 * Soglia di contenimento per dire "questo è il nostro commento".
 *
 * 0.35 è basso di proposito: chi incolla riscrive. Il rischio di un falso positivo è basso perché
 * le shingle di tre parole sono specifiche — perché un altro commento ne condivida un terzo con la
 * nostra bozza dovrebbe averla praticamente copiata.
 */
export const MATCH_THRESHOLD = 0.35;

/** Testo confrontabile: via URL, punteggiatura e maiuscole, che l'editing tocca per primi. */
export function normalizeForMatch(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Shingle di N parole. Tre è il punto in cui una frase smette di essere generica. */
export function shingles(text: string, n = 3): Set<string> {
  const words = normalizeForMatch(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (words.length < n) {
    if (words.length) out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i <= words.length - n; i++) out.add(words.slice(i, i + n).join(' '));
  return out;
}

/**
 * Quanta parte della bozza sopravvive nel candidato, da 0 a 1.
 *
 * Contenimento e non Jaccard: un commento in cui l'umano ha aggiunto tre righe sue resta il nostro
 * commento, e Jaccard lo punirebbe per la lunghezza in più.
 */
export function matchScore(draft: string, candidate: string): number {
  const a = shingles(draft);
  if (!a.size) return 0;
  const b = shingles(candidate);
  if (!b.size) return 0;
  let hit = 0;
  for (const s of a) if (b.has(s)) hit++;
  return hit / a.size;
}

export type CommentLike = { body: string; author?: string | null; ups?: number | null; replies?: number | null; permalink?: string | null };

/** Il commento più simile alla bozza, se supera la soglia. Nessun match = null, mai un ripiego. */
export function pickMatch(
  draft: string,
  comments: CommentLike[],
  opts: { handle?: string | null; threshold?: number } = {}
): { comment: CommentLike; score: number; method: 'text' | 'handle' } | null {
  const threshold = opts.threshold ?? MATCH_THRESHOLD;
  const handle = String(opts.handle ?? '').replace(/^u\//, '').trim().toLowerCase();

  // Se il brand ha dichiarato il proprio handle, quello vince sul testo: è un'identità, non una
  // somiglianza. Il testo resta come ripiego per chi non l'ha configurato.
  if (handle) {
    const mine = comments.filter((c) => String(c.author ?? '').toLowerCase() === handle);
    if (mine.length) {
      const best = mine
        .map((c) => ({ comment: c, score: matchScore(draft, c.body) }))
        .sort((x, y) => y.score - x.score)[0];
      return { comment: best.comment, score: best.score, method: 'handle' };
    }
  }

  const scored = comments
    .map((c) => ({ comment: c, score: matchScore(draft, c.body) }))
    .sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (!best || best.score < threshold) return null;
  return { comment: best.comment, score: best.score, method: 'text' };
}

/** Solo Reddit: è l'unica superficie da cui possiamo rileggere i commenti di un thread. */
export function isCheckable(url: string): boolean {
  return /reddit\.com\//i.test(String(url ?? ''));
}
