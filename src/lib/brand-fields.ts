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
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

export function sanitizeBrandColors(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((c) => String(c).trim())
    .filter((c) => HEX_COLOR.test(c))
    .slice(0, 8);
}

/**
 * Il colore del tema arriva dal `<meta name="theme-color">` del sito analizzato, e quel meta
 * ammette qualunque colore CSS: `red` è HTML valido e non è un colore che sappiamo usare.
 * Stessa notazione della palette, perché finiscono negli stessi posti.
 */
export function sanitizeThemeColor(input: unknown): string | null {
  const v = String(input ?? '').trim();
  return HEX_COLOR.test(v) ? v : null;
}

/** Un sito digitato a mano diventa un URL cliccabile; vuoto resta null. */
export function normalizeWebsite(raw: string): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/**
 * Nel campo "sito" la gente scrive il proprio handle. `Mariopuggelli1939` e `biohappy` sono in
 * produzione dentro `brands.website` e `brand_kit.source_url`: non sono spazzatura, sono un dato
 * giusto nel campo sbagliato, e `https://Mariopuggelli1939` non è un indirizzo che apre niente.
 *
 * Due forme sole, quelle che non possono essere un dominio: la chiocciola davanti, oppure una
 * parola senza punti e senza schema. Il resto è un sito. Uno spazio dentro non è né l'uno né
 * l'altro (`no celo`), e si butta invece di inventarci un profilo.
 */
const HANDLE_DEFAULT_PLATFORM = 'instagram';

export type WebsiteOrHandle = {
  website: string | null;
  handle: { platform: string; username: string } | null;
};

export function splitWebsiteOrHandle(raw: string): WebsiteOrHandle {
  const v = String(raw ?? '').trim();
  if (!v) return { website: null, handle: null };

  const looksLikeHandle = v.startsWith('@') || (!/^https?:\/\//i.test(v) && !v.includes('.'));
  if (!looksLikeHandle) return { website: normalizeWebsite(v), handle: null };

  const username = v.replace(/^@+/, '').replace(/\/+$/, '').trim();
  if (!username || /\s/.test(username)) return { website: null, handle: null };

  return { website: null, handle: { platform: HANDLE_DEFAULT_PLATFORM, username } };
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

/**
 * Un fuso che il runtime sa risolvere davvero.
 *
 * La colonna `brands.timezone` decide l'ora locale di ogni slot futuro: una stringa che non e' un
 * fuso non fallisce al salvataggio, fallisce piu' tardi, quando qualcosa prova a calcolare un
 * orario. Il `<select>` del browser ne offre quindici e non puo' sbagliare; un tool che riceve una
 * stringa da un agente si'.
 *
 * Chiedere a `Intl` invece di tenere un elenco: cosi' gli alias storici (`Asia/Calcutta`) restano
 * validi, e nessuno deve aggiornare una lista quando IANA ne aggiunge uno.
 */
export function isKnownTimezone(value: unknown): boolean {
  const tz = String(value ?? '').trim();
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Primo logo utilizzabile da `brand_kit.logos` (stringa oppure `{ url }`), saltando le og-image.
 *
 * Sta qui e non in `blog-site.ts` perche` la leggono anche il renderer delle immagini e la
 * composizione grafica, e quel file tira dentro il blog pubblico intero — Marked, il client admin,
 * i referral. Il grafo si chiudeva in cerchio (immagini → blog-site → referrals → crediti →
 * scheduler → director → content-preview → immagini) e restava in piedi solo grazie all'ORDINE in
 * cui i moduli si inizializzavano: togliere un import morto altrove lo faceva cadere. Un ciclo
 * tenuto insieme dall'ordine e` un ciclo, e si taglia dove il pezzo condiviso non ha dipendenze.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const firstLogoUrl = (logos: any): string | null => {
  const arr = Array.isArray(logos) ? logos : [];
  const first = arr.find((l: unknown) => {
    if (!l) return false;
    if (typeof l === 'string') return true;
    if (typeof l === 'object' && l !== null && 'url' in l) {
      const url = (l as { url?: unknown }).url;
      return typeof url === 'string' && !!url && (l as { type?: string }).type !== 'og-image';
    }
    return false;
  });
  return typeof first === 'string' ? first : (first?.url ?? null);
};
