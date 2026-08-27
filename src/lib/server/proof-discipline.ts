/**
 * PROOF DISCIPLINE — never invent proof, and mark the hole where proof was wanted.
 *
 * THE RULE. No fabricated statistics, testimonials, customer names, awards or case studies. Not as
 * examples. Not as placeholders. Where a claim needs a number the generator writes `[NEED: cifra
 * di conversione]` and flags it, so a human sees exactly what to supply.
 *
 * WHY THIS IS NOT PEDANTRY HERE. This codebase already forbids inventing URLs in half a dozen
 * prompts, because a broken link is embarrassing. A plausible-looking invented number is worse and
 * we had no rule against it: it is how a client ships a false advertising claim under their own
 * name, on their own account, on a schedule, without ever seeing the sentence first. An autopilot
 * makes that failure mode continuous rather than occasional — which is exactly why the check is
 * deterministic and why the marker BLOCKS publishing rather than merely scoring badly.
 *
 * THE MARKER IS A FEATURE, NOT A DEFECT. `[NEED: …]` in a draft is the system being honest about
 * what it does not know. It must never reach a feed, so `prepublish-check.ts` treats it as a hard
 * stop; but it must also never be silently deleted, because deleting it turns an honest gap back
 * into a fabricated claim.
 *
 * Pure: no clock, no I/O, no randomness. Adapted from Yuzzyuk/marketing-os (`copy.md` /
 * `slop-patterns.md` honesty spine, MIT) — see `docs/35-marketing-doctrine.md`.
 */

/** `[NEED: what is missing]`. Bounded so a stray bracket cannot swallow a whole caption. */
export const NEED_MARKER_RE = /\[NEED:\s*([^\]]{1,120})\]/gi;

/** What the generator said it was missing. Empty when the text carries no marker. */
export function needMarkers(text: string | null | undefined): string[] {
  const out: string[] = [];
  const re = new RegExp(NEED_MARKER_RE.source, 'gi');
  for (let m = re.exec(String(text ?? '')); m; m = re.exec(String(text ?? ''))) out.push(m[1].trim());
  return out;
}

export function hasNeedMarker(text: string | null | undefined): boolean {
  return needMarkers(text).length > 0;
}

/**
 * Remove the markers — for a preview that should read as prose.
 *
 * NEVER call this on the way to publishing. Stripping the marker does not supply the number; it
 * just hides that one was missing, which converts an honest gap into an unsupported claim.
 */
export function stripNeedMarkers(text: string): string {
  return text.replace(new RegExp(NEED_MARKER_RE.source, 'gi'), '').replace(/\s{2,}/g, ' ').trim();
}

// ── Unattributed proof ────────────────────────────────────────────────────────────────────────

export type ProofProblem = { id: 'unattributed_stat' | 'anonymous_testimonial' | 'unbacked_superlative'; quote: string; note: string };

/** Words that turn a number into a claim about the world rather than a description of a product. */
const CLAIM_SHAPED = /\b(dei|delle|degli|del|di|su|clienti|aziende|utenti|persone|casi|studi|team|of|customers|users|businesses|companies|cases)\b/i;

/**
 * An attribution: a source, a study, a date, a named customer, or an explicit method.
 *
 * First-person method statements belong here and are the STRONGEST form of it — "abbiamo analizzato
 * 240 preventivi" is the brand saying where the number came from and staking its name on it, which
 * is precisely what we want more of. Leaving them out flagged exactly the sentences the discipline
 * is trying to encourage.
 */
const ATTRIBUTION =
  /\b(secondo|fonte|studio|ricerca|sondaggio|misurat[oi]|nel 20\d\d|campione|dati (di|del)|abbiamo (analizzat|misurat|contat|testat|seguit|raccolt|osservat)|su \d+ (casi|studi|client|progett)|according to|source|study|survey|measured|based on|per our|sample of|we (analysed|analyzed|measured|counted|tested|tracked))/i;

/** Superlatives that assert a ranking nobody can check. */
const UNBACKED_SUPERLATIVE =
  /\b(il (numero uno|migliore|leader)|la (migliore|numero uno)|leader (di|del) (mercato|settore)|numero 1|#1|best[- ]in[- ]class|world[- ]class|industry[- ]leading|cutting[- ]edge|the leading)\b/i;

/** A quoted testimonial with no name attached is indistinguishable from an invented one. */
const QUOTE_RE = /[«"“]([^»"”]{25,300})[»"”]/g;
const NAMED_ATTRIBUTION = /—\s*\p{Lu}[\p{L}'’]+|,\s*\p{Lu}[\p{L}'’]+\s+\p{Lu}|\bdi\s+\p{Lu}[\p{L}'’]+/u;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Find claims that assert something about the world without saying where it came from.
 *
 * Deliberately narrow. A product spec ("15 slide", "3 formati", "€29/mese") is a description, not a
 * claim about the world, and flagging it would train everyone to ignore the flag. What gets caught
 * is a statistic SHAPED like evidence — a percentage or a count of people/companies/cases — with no
 * source, no study, no date and no named customer anywhere in its sentence.
 */
export function unattributedProof(text: string | null | undefined): ProofProblem[] {
  const body = String(text ?? '');
  if (!body.trim()) return [];
  const out: ProofProblem[] = [];

  for (const sentence of sentencesOf(body)) {
    if (ATTRIBUTION.test(sentence)) continue;

    // A percentage, or a number followed by a population word: both read as measured evidence.
    const stat = sentence.match(/\b\d+([.,]\d+)?\s?%|\b\d{2,}\s+(?:\p{L}+\s+){0,2}(clienti|aziende|utenti|persone|casi|studi|team|customers|users|businesses|companies|cases)\b/iu);
    if (stat && CLAIM_SHAPED.test(sentence)) {
      out.push({
        id: 'unattributed_stat',
        quote: sentence.slice(0, 160),
        note: `"${stat[0]}" è presentato come dato misurato ma la frase non dice da dove viene. O si cita la fonte, o si scrive [NEED: fonte del dato].`
      });
    }

    if (UNBACKED_SUPERLATIVE.test(sentence)) {
      out.push({
        id: 'unbacked_superlative',
        quote: sentence.slice(0, 160),
        note: 'Superlativo di classifica senza niente dietro: dice nulla e segnala che niente di specifico era disponibile.'
      });
    }
  }

  for (let m = QUOTE_RE.exec(body); m; m = QUOTE_RE.exec(body)) {
    const around = body.slice(m.index, Math.min(body.length, m.index + m[0].length + 80));
    if (!NAMED_ATTRIBUTION.test(around)) {
      out.push({
        id: 'anonymous_testimonial',
        quote: m[1].slice(0, 120),
        note: 'Testimonianza fra virgolette senza un nome: indistinguibile da una inventata. O si attribuisce a una persona reale, o si toglie.'
      });
    }
  }

  return out;
}

/**
 * The prompt block. Goes into every generator that can produce a claim — captions, ad copy, video
 * scripts, articles.
 */
export const PROOF_DISCIPLINE_RULE = `PROVE — regola dura, senza eccezioni.
Non inventare MAI statistiche, testimonianze, nomi di clienti, premi o case study. Nemmeno come esempio, nemmeno come segnaposto: un numero plausibile ma falso in un post pubblicato è il modo in cui un cliente si ritrova con una pubblicità ingannevole a suo nome.
Se un'affermazione ha bisogno di un numero che non ti è stato dato, scrivi letteralmente [NEED: cosa serve] al suo posto — per esempio [NEED: cifra di conversione reale] — e vai avanti. Il segnaposto è corretto; il numero inventato no.
Puoi usare SOLO i numeri, i nomi e i risultati presenti nel contesto del brand qui sopra. Se il contesto non ne contiene nessuno, scrivi il post senza dati: specifico sul meccanismo (cosa succede, come), non sui risultati.
Vale anche per i superlativi di classifica ("il numero uno", "leader di mercato"): senza una fonte non si scrivono.`;
