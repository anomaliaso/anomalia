/**
 * I campi del Brand Studio, ripuliti — e ripuliti in UN posto solo.
 *
 * PERCHÉ ESISTE QUESTO FILE. Ognuna di queste tre funzioni era dentro `studio-actions.ts`, cioè
 * dentro il percorso del FORM. Poi la stessa colonna ha smesso di essere scritta solo dal form:
 * la chat la scrive con i suoi tool. Da lì in poi ogni funzione duplicata è una divergenza in
 * attesa, e la divergenza non si vede mai come un errore — si vede come un colore leggermente
 * sbagliato su un'immagine, un hashtag con uno spazio dentro, un sito salvato senza `https://`
 * che nessun link apre. Il form rifiuta, il tool accetta, e a valle nessuno controlla più.
 *
 * Quindi: niente import, nessuna dipendenza, gira ovunque (server, browser, test). Chi scrive uno
 * di questi campi passa da qui, o sta introducendo la seconda versione della stessa regola.
 */

/**
 * La palette del brand. Regex e tetto sono quelli che la UI mostra davvero: 8 swatch, notazione
 * hex. Il tetto conta quanto il formato — senza, un agente ci infila quaranta colori e la
 * direzione visiva smette di dire qualcosa.
 */
export function sanitizeBrandColors(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((c) => String(c).trim())
    .filter((c) => /^#[0-9a-fA-F]{3,8}$/.test(c))
    .slice(0, 8);
}

/** Un sito digitato a mano diventa un URL cliccabile; vuoto resta null. */
export function normalizeWebsite(raw: string): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/**
 * Testo libero ("#brand summer, #Promo!") → tag puliti e deduplicati, uno `#` solo davanti.
 * Spazi e punteggiatura non possono stare in un hashtag: tolti qui, o finiscono in una caption
 * pubblicata così com'erano stati scritti.
 */
export function normalizeHashtags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of String(raw ?? '').split(/[\s,]+/)) {
    const body = tok.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    if (!body) continue;
    const tag = '#' + body;
    const lc = tag.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    out.push(tag);
    if (out.length >= 30) break;
  }
  return out;
}
