/**
 * Deterministic quality score for a single piece of published copy — the SPINE of the internal
 * output benchmark. No AI call, no I/O, no clock: same input → same number, forever.
 *
 * WHY DETERMINISTIC AND NOT AN LLM JUDGE.
 * We had an LLM judge for media (`video-review.ts`, rubric → ship/fix/kill), removed on 2026-08-29
 * when its model stopped accepting video. It was richer
 * than anything here, and it is the wrong instrument for a regression benchmark on its own: swap the
 * judge model — as happened when the chat tiers moved to Gemini 3.7 Flash — and every historical
 * score silently becomes incomparable, so the trend line breaks exactly when you most need it. This
 * module is the part of the measurement that CANNOT drift: it costs nothing, so it can be re-run
 * over the entire back-catalogue whenever the rules change, which is what makes a fair before/after
 * possible at all. The judge belongs on top of this as a second, version-pinned layer — never as the
 * only layer. See `benchmark.ts` for how runs are compared.
 *
 * WHAT IT MEASURES. Not "is this good marketing" — nobody can score that without a conversion
 * number. It measures the failure modes an autopilot actually has, the ones that appear the day a
 * prompt or a model changes: the hook collapses into a brand announcement, LLM boilerplate creeps
 * back in, every post starts sounding like last week's, the CTA disappears. Those are detectable
 * from the text alone and they are what regressions look like in practice.
 *
 * LEXICAL *AND* STRUCTURAL. A phrase list only sees the words a generator reaches for. The tells a
 * reader actually clocks first live in the SHAPE: every sentence the same length, every claim
 * hedged, a rhetorical question the copy answers itself, "not just X — but Y". A caption can carry
 * none of the banned phrases and still read as machine-written. So `structural_tells` and
 * `sentence_rhythm` sit alongside `ai_tells`, and they are what catch a regression that swapped the
 * boilerplate for different boilerplate. Structural tells adapted from Yuzzyuk/marketing-os
 * (`slop-patterns.md`, MIT) — see `docs/35-marketing-doctrine.md`.
 *
 * GRADED, NOT BOOLEAN. `article-score.ts` scores blog posts with ok/not-ok checks × weights, which
 * is right for a user-facing checklist ("fix these 3 things"). A benchmark needs resolution instead:
 * a binary index moves in 9-point jumps and cannot see a 3% regression. So every check here returns
 * a 0..1 value and the index is the weighted mean × 100.
 *
 * BUMP `CONTENT_SCORER_VERSION` ON ANY SCORING CHANGE. Samples are stored per version and the
 * aggregation refuses to mix versions — otherwise a rule tweak reads as a product regression.
 */
import { needMarkers, unattributedProof } from '$lib/server/proof-discipline';

/** Bump whenever a check, weight, or word list changes. Never mix versions in one trend line. */
export const CONTENT_SCORER_VERSION = 3;

export type QualityCheckId =
  | 'hook_strength'
  | 'ai_tells'
  | 'structural_tells'
  | 'sentence_rhythm'
  | 'proof_discipline'
  | 'self_repetition'
  | 'specificity'
  | 'cta'
  | 'length_fit'
  | 'readability'
  | 'hashtag_hygiene'
  | 'emoji_hygiene';

export type QualityCheck = {
  id: QualityCheckId;
  /** 0..1 — graded, not boolean. */
  value: number;
  /** Contribution to the 0..100 index. Weights sum to 100. */
  weight: number;
  /** Short human-readable reason, for the "why did the index drop" view. */
  note: string;
};

export type ContentQuality = {
  /** 0..100 weighted mean of the checks. */
  index: number;
  checks: QualityCheck[];
  metrics: {
    words: number;
    chars: number;
    sentences: number;
    hashtags: number;
    emojis: number;
    aiTells: string[];
    /** Max 3-gram Jaccard similarity against the recent posts passed in (0 when none). */
    maxSimilarity: number;
    /** Ids of the structural tells found — see `STRUCTURAL_TELLS`. */
    structuralTells: string[];
    /**
     * Coefficient of variation of sentence length. Human writing varies violently (~0.4–0.6);
     * machine writing metronomes (<0.25). `null` when there are too few sentences to judge.
     */
    sentenceCv: number | null;
    /** Coefficient of variation of paragraph length. `null` under 3 paragraphs. */
    paragraphCv: number | null;
    /** Em-dashes. One per piece is style; three is a signature. */
    emDashes: number;
    /** Claims asserted as measured with nothing behind them — see `proof-discipline.ts`. */
    unattributedProof: string[];
    /** `[NEED: …]` markers: honest gaps in a draft, hard publish blockers downstream. */
    needMarkers: string[];
  };
};

export type ScoreInput = {
  caption: string | null | undefined;
  platform?: string | null;
  /**
   * The brand's other recent captions. Self-repetition is the single most common real failure of
   * an autopilot and it is INVISIBLE post-by-post — it only exists relative to the neighbours.
   */
  recentCaptions?: (string | null | undefined)[];
  /**
   * The brand's register. Some brands genuinely speak formally — enterprise security, regulated
   * finance, medical — and flattening them into the same clipped punchy style everyone else uses is
   * its own tell. THE TEST IS NOT FORMALITY, IT IS EMPTINESS: a formal sentence making a specific,
   * falsifiable claim is fine; a casual sentence that says nothing is not. So `'formal'` halves the
   * penalty on the STYLE tells (tricolon rhythm, em-dash signature, question-then-answer) and leaves
   * every EMPTINESS tell — not-just-X-but-Y, hedged claims, benefit-without-mechanism, demographic
   * audience, reassuring close — at full weight.
   *
   * DELIBERATELY NOT SET BY THE BENCHMARK. `benchmark-store.ts` always scores at the default
   * register, because a fleet index has to measure against ONE fixed rulebook: reading a mutable
   * brand field into the score would make a sample's number change when someone edits a tone
   * setting, which is the same drift the module header rejects for LLM judges. It is set at
   * GENERATION time instead, where the brand's personality is already in hand.
   */
  register?: 'default' | 'formal' | null;
};

// ── Weights (sum = 100) ───────────────────────────────────────────────────────────────────────
// Ordered by how strongly each one moved when we broke things on purpose: the hook and the
// boilerplate density are what a bad prompt change destroys first.
const WEIGHTS: Record<QualityCheckId, number> = {
  hook_strength: 18,
  ai_tells: 13,
  structural_tells: 10,
  self_repetition: 13,
  specificity: 10,
  cta: 9,
  length_fit: 6,
  sentence_rhythm: 6,
  proof_discipline: 6,
  readability: 5,
  hashtag_hygiene: 2,
  emoji_hygiene: 2
};

/**
 * LLM boilerplate, IT + EN. Every entry has been seen in real generated captions. These are matched
 * as substrings on the lowercased text, so keep them phrases — single words produce false hits.
 */
const AI_TELLS = [
  // English
  'in today s fast paced world',
  'in today s digital',
  'in the ever evolving',
  'in an era where',
  'unlock the power',
  'unlock your',
  'elevate your',
  'take it to the next level',
  'game changer',
  'let s dive in',
  'dive into',
  'look no further',
  'the possibilities are endless',
  'we ve got you covered',
  'it s no secret that',
  'when it comes to',
  'at the end of the day',
  'more than just',
  'not only that',
  'stay tuned',
  'that s where we come in',
  // Italian
  'nel mondo di oggi',
  'nell era digitale',
  'in un mondo sempre piu',
  'in un era in cui',
  'scopri come',
  'scopri il potere',
  'porta il tuo',
  'al livello successivo',
  'non e un segreto che',
  'quando si tratta di',
  'le possibilita sono infinite',
  'non cercare oltre',
  'siamo qui per te',
  'ma non finisce qui',
  'e molto altro ancora',
  'resta sintonizzato',
  'ed e qui che entriamo in gioco'
];

/** Openers that mean the hook was skipped: the post starts by talking about itself. */
const WEAK_OPENERS = [
  'siamo',
  'noi di',
  'la nostra',
  'il nostro',
  'benvenuti',
  'oggi vi',
  'oggi parliamo',
  'we are',
  'we re',
  'our new',
  'introducing',
  'welcome to',
  'today we'
];

/**
 * CTA markers, matched at a WORD START on the normalized text (see `CTA_RE`).
 *
 * Word-start matching is not a detail: as plain substrings, `tag` fires inside "vantaggio" and
 * `follow` inside "follow-up" — both common in real captions — and every such hit is a CTA the post
 * does not have. Prefix matching at a word boundary still catches inflections ("comment" →
 * "commenta"), which is why these are stems rather than exact words.
 */
const CTA_MARKERS = [
  // Italian imperatives / prompts
  'scrivici',
  'commenta',
  'salva questo',
  'salva il post',
  'condividi',
  'link in bio',
  'prenota',
  'scarica',
  'iscriviti',
  'provalo',
  'guarda',
  'clicca',
  'contattaci',
  'dimmi',
  'raccontaci',
  'tagga',
  'seguici',
  'richiedi',
  // English
  'comment',
  'save this',
  'share this',
  'book a',
  'download',
  'subscribe',
  'sign up',
  'try it',
  'watch',
  'click',
  'dm us',
  'in dm',
  'send us',
  'tell me',
  'follow us',
  'tag a',
  'get started',
  'learn more'
];

const CTA_RE = new RegExp(
  `(^| )(${CTA_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  'g'
);

/**
 * Per-platform caption bands. `sweet` scores 1.0; the score tapers linearly to 0 at `hard`.
 * Numbers are the practical bands the platforms reward, not the API maximums.
 */
type Band = { sweet: [number, number]; hard: [number, number]; tags: [number, number] };
const BANDS: Record<string, Band> = {
  instagram: { sweet: [120, 900], hard: [30, 2200], tags: [3, 10] },
  threads: { sweet: [60, 400], hard: [15, 500], tags: [0, 3] },
  tiktok: { sweet: [50, 250], hard: [15, 2200], tags: [2, 6] },
  linkedin: { sweet: [300, 1600], hard: [80, 3000], tags: [0, 5] },
  facebook: { sweet: [100, 900], hard: [25, 2000], tags: [0, 4] },
  x: { sweet: [70, 260], hard: [15, 280], tags: [0, 2] },
  twitter: { sweet: [70, 260], hard: [15, 280], tags: [0, 2] },
  youtube: { sweet: [100, 1200], hard: [25, 4000], tags: [0, 8] },
  pinterest: { sweet: [80, 450], hard: [20, 500], tags: [0, 6] }
};
const DEFAULT_BAND: Band = { sweet: [100, 900], hard: [25, 2200], tags: [0, 8] };

export function bandFor(platform: string | null | undefined): Band {
  const key = String(platform ?? '')
    .trim()
    .toLowerCase();
  return BANDS[key] ?? DEFAULT_BAND;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Lowercase, strip accents/punctuation, collapse whitespace. Accent folding is what lets one
 * phrase list cover "perché"/"perche" and keeps the AI-tell match stable across generators.
 */
export function normalizeText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordsOf(normalized: string): string[] {
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/** Word 3-grams. Shingles catch reshuffled boilerplate that a bag-of-words comparison misses. */
export function shingles(text: string, n = 3): Set<string> {
  const w = wordsOf(normalizeText(text));
  const out = new Set<string>();
  if (w.length < n) {
    if (w.length) out.add(w.join(' '));
    return out;
  }
  for (let i = 0; i <= w.length - n; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** 1.0 inside `sweet`, tapering linearly to 0 at the `hard` edges, 0 beyond them. */
function bandScore(value: number, sweet: [number, number], hard: [number, number]): number {
  const [sLo, sHi] = sweet;
  const [hLo, hHi] = hard;
  if (value >= sLo && value <= sHi) return 1;
  if (value < sLo) return hLo >= sLo ? 0 : clamp01((value - hLo) / (sLo - hLo));
  return hHi <= sHi ? 0 : clamp01((hHi - value) / (hHi - sHi));
}

/** First line, or the first sentence when the caption is one block. This is what a scroller reads. */
export function hookOf(caption: string): string {
  const firstLine = caption.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const line = firstLine.trim();
  if (line.length <= 160) return line;
  const cut = line.search(/[.!?…]\s/);
  return cut > 0 ? line.slice(0, cut + 1) : line.slice(0, 160);
}

function scoreHook(caption: string): { value: number; note: string } {
  const hook = hookOf(caption);
  if (!hook) return { value: 0, note: 'nessun hook: caption vuota' };
  const norm = normalizeText(hook);
  if (!norm) return { value: 0, note: 'hook senza testo' };

  const reasons: string[] = [];
  let value = 0.25; // a hook that exists but signals nothing

  const opensWeak = WEAK_OPENERS.some((w) => norm.startsWith(w));
  if (opensWeak) {
    reasons.push('apre parlando del brand');
  } else {
    value += 0.15;
  }

  if (/\?/.test(hook)) {
    value += 0.15;
    reasons.push('domanda');
  }
  if (/\d/.test(hook)) {
    value += 0.15;
    reasons.push('numero');
  }
  // Second person = the reader is addressed — the Fekri "call out", from the video-review doctrine
  // that was removed with the judge on 2026-08-29. The rule outlived the file that named it.
  if (/\b(tu|tuo|tua|tuoi|tue|ti|vi|vostro|you|your|yours)\b/.test(norm)) {
    value += 0.15;
    reasons.push('si rivolge al lettore');
  }
  // A stake: negation, prohibition or a cost-of-inaction framing.
  if (/\b(non|mai|smetti|basta|stop|evita|sbagli|errore|never|stop|avoid|mistake|wrong)\b/.test(norm)) {
    value += 0.15;
    reasons.push('posta in gioco');
  }

  // Length: a hook is a line, not a paragraph.
  if (hook.length > 140) {
    value -= 0.2;
    reasons.push('troppo lungo per un hook');
  } else if (hook.length < 12) {
    value -= 0.15;
    reasons.push('troppo corto per dire qualcosa');
  }

  if (opensWeak) value -= 0.2;

  return {
    value: clamp01(value),
    note: reasons.length ? reasons.join(', ') : 'hook generico, nessun segnale'
  };
}

function scoreAiTells(caption: string, words: number): { value: number; note: string; found: string[] } {
  const norm = normalizeText(caption);
  const found = AI_TELLS.filter((t) => norm.includes(t));
  if (!found.length) return { value: 1, note: 'nessun boilerplate', found };
  // Density, not raw count: one tell in a 400-word LinkedIn post is not one tell in a tweet.
  const per100 = (found.length / Math.max(words, 20)) * 100;
  const value = clamp01(1 - per100 / 3);
  return { value, note: `boilerplate: ${found.slice(0, 3).join(' / ')}`, found };
}

// ── Structural tells ──────────────────────────────────────────────────────────────────────────
//
// `AI_TELLS` above is a LEXICAL list: phrases a generator reaches for. It cannot see the tells that
// live in the SHAPE of the text — and those are the ones a reader clocks first. A caption can
// contain none of the banned phrases and still read as machine-written because every sentence is
// the same length, every claim is hedged, and it opens on a rhetorical question it answers itself.
//
// Why this matters more than it sounds: a reader who clocks the copy as AI-written discounts the
// CLAIM, not just the prose. A tell in the hook costs the argument.
//
// Every signal here is computed from the text alone, so it stays deterministic and re-runnable over
// the whole back-catalogue like the rest of this module.

/** Split on sentence terminators, keeping only segments with actual words. */
export function sentencesOf(caption: string): string[] {
  return caption
    .split(/[.!?…]+[\s"'»)\]]*|\r?\n/)
    .map((s) => s.trim())
    .filter((s) => wordsOf(normalizeText(s)).length > 0);
}

/** Blank-line separated blocks. A single-block caption returns one paragraph. */
function paragraphsOf(caption: string): string[] {
  return caption
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Coefficient of variation (stdev / mean). `null` when the sample is too small to mean anything. */
export function coefficientOfVariation(values: number[], min = 4): number | null {
  if (values.length < min) return null;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean <= 0) return null;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * "Not just X, but Y" and its family — the single most recognisable construction in machine copy.
 * Matched on the NORMALIZED text, where punctuation is already whitespace, so an em-dash variant
 * ("It's not just a CRM — it's a growth engine") reads the same as a comma one.
 */
const NOT_JUST_X_BUT_Y = [
  /\bnon e solo\b[\s\S]{0,80}?\b(e|ma)\b/,
  /\bnon si tratta (solo )?di\b[\s\S]{0,80}?\bma\b/,
  /\bnon solo\b[\s\S]{0,60}?\bma anche\b/,
  /\bpiu che un\b[\s\S]{0,60}?\be un\b/,
  /\bnot just\b[\s\S]{0,80}?\b(but|it s)\b/,
  /\bnot only\b[\s\S]{0,60}?\bbut also\b/,
  /\bit s not about\b[\s\S]{0,80}?\bit s about\b/,
  /\bmore than just\b/
];

/**
 * Hedges. Every hedge is a small confession; stack four and the reader stops believing any of it.
 * "Can help you potentially reduce costs by up to 30%" → "Cuts fulfilment cost 31% at [customer]".
 */
const HEDGES = [
  'puo aiutarti a',
  'puo aiutare a',
  'potrebbe aiutarti',
  'potrebbe aiutare',
  'potenzialmente',
  'fino a',
  'in un certo senso',
  'per cosi dire',
  'praticamente',
  'can help you',
  'could help you',
  'may help',
  'might help',
  'potentially',
  'up to',
  'in a way'
];

/** Benefits that are a wish until a mechanism is attached. "Save time" vs "save time by X". */
const BARE_BENEFITS = [
  'risparmia tempo',
  'risparmiare tempo',
  'risparmi tempo',
  'fai crescere il tuo business',
  'aumenta le vendite',
  'aumentare le vendite',
  'ottimizza il tuo lavoro',
  'semplifica il lavoro',
  'save time',
  'saves time',
  'grow your business',
  'increase sales',
  'boost your',
  'streamline your'
];

/** What turns a wish into a claim: a named process, a cause, or a number, in the same sentence. */
const MECHANISM_MARKERS =
  /\b(grazie a|perche|automatizzando|abbinando|senza dover|usando|tramite|sfruttando|by |because|using|through|via )|\d/;

/** Audience named by demographic instead of by state. "For SMBs" tells the reader nothing. */
const DEMOGRAPHIC_AUDIENCE =
  /\bper (le |i |gli )?(pmi|aziende|imprese|startup|professionisti|freelance|manager|imprenditori|team|brand)\b|\bfor (smbs|smes|businesses|startups|professionals|teams|marketers|founders|brands)\b/;

/** A state clause turns a demographic into a person. "for teams that still approve by email". */
const STATE_CLAUSE = /\b(che|who|that|still|ancora|quando|when)\b/;

/** Closings that restate without adding — the reassuring machine sign-off. */
const REASSURING_CLOSE = [
  'ed e questo che fa la differenza',
  'e questo fa la differenza',
  'ed e questo cio che conta',
  'alla fine dei conti',
  'in fin dei conti',
  'il resto viene da se',
  'e questo cambia tutto',
  'and that s what makes all the difference',
  'that s what makes the difference',
  'at the end of the day',
  'and that s the difference',
  'it really is that simple'
];

/**
 * A tricolon: three comma-separated items closed by a conjunction. Fine once — damning as the
 * default rhythm, which is why the first one costs nothing and the pattern is what is penalised.
 */
function tricolonCount(caption: string): number {
  let n = 0;
  for (const raw of caption.split(/[.!?…]+|\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    const commas = (s.match(/,/g) ?? []).length;
    // "a, b e c" carries one comma; the Oxford "a, b, and c" carries two. Both are the same rhythm.
    if (commas < 1 || commas > 2) continue;
    // Turn the CLOSING conjunction into a separator, so both shapes split into three items.
    const flattened = s.replace(/\s+(e|ed|and|o|oppure|or)\s+(?=[^,]*$)/iu, ', ');
    const items = flattened
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean);
    // Three comparable items. Two long clauses with an aside between them are a sentence, not a
    // tricolon — the tell is the drumbeat, not the commas.
    if (items.length === 3 && items.every((i) => wordsOf(normalizeText(i)).length <= 5)) n++;
  }
  return n;
}

/** First sentence is a question the second one immediately answers. "A better way? There is." */
function hasQuestionThenAnswer(caption: string): boolean {
  const trimmed = caption.trim();
  const q = trimmed.search(/\?/);
  if (q < 0 || q > 200) return false;
  const after = trimmed.slice(q + 1).trim();
  if (!after) return false;
  const next = sentencesOf(after)[0] ?? '';
  return wordsOf(normalizeText(next)).length > 0 && wordsOf(normalizeText(next)).length <= 6;
}

type StructuralTell = { id: string; penalty: number; style: boolean; note: string };

/**
 * The catalogue. `style` marks the tells that a genuinely formal brand register can legitimately
 * produce — those are halved (never zeroed) when the caller declares `register: 'formal'`. The rest
 * are emptiness, and emptiness is not a register.
 */
function structuralTellsOf(caption: string, words: number): StructuralTell[] {
  const norm = normalizeText(caption);
  const found: StructuralTell[] = [];
  const per100 = (n: number) => (n / Math.max(words, 20)) * 100;

  if (NOT_JUST_X_BUT_Y.some((re) => re.test(norm))) {
    found.push({ id: 'not_just_x_but_y', penalty: 0.45, style: false, note: '"non è solo X, è Y"' });
  }

  const tricolons = tricolonCount(caption);
  if (tricolons >= 2) {
    found.push({
      id: 'tricolon_rhythm',
      penalty: Math.min(0.3, 0.15 * (tricolons - 1)),
      style: true,
      note: `${tricolons} triadi: il ritmo a tre come default`
    });
  }

  const emDashes = (caption.match(/—/g) ?? []).length;
  if (emDashes >= 2) {
    found.push({
      id: 'em_dash_signature',
      penalty: per100(emDashes) >= 1.5 || emDashes >= 3 ? 0.2 : 0.1,
      style: true,
      note: `${emDashes} trattini em: uno è stile, tre sono una firma`
    });
  }

  if (hasQuestionThenAnswer(caption)) {
    found.push({ id: 'question_then_answer', penalty: 0.2, style: true, note: 'apre con domanda e si risponde da sola' });
  }

  const lastSentence = normalizeText(sentencesOf(caption).slice(-1)[0] ?? '');
  if (lastSentence && REASSURING_CLOSE.some((c) => lastSentence.includes(c))) {
    found.push({ id: 'reassuring_close', penalty: 0.25, style: false, note: 'chiusura rassicurante che non aggiunge nulla' });
  }

  const hedges = HEDGES.filter((h) => norm.includes(h)).length;
  if (hedges) {
    found.push({
      id: 'hedged_claims',
      penalty: Math.min(0.3, 0.15 * hedges),
      style: false,
      note: `${hedges} claim ammorbiditi: ogni hedge è una piccola confessione`
    });
  }

  const bareBenefit = sentencesOf(caption).some((s) => {
    const n = normalizeText(s);
    return BARE_BENEFITS.some((b) => n.includes(b)) && !MECHANISM_MARKERS.test(n);
  });
  if (bareBenefit) {
    found.push({ id: 'benefit_no_mechanism', penalty: 0.2, style: false, note: 'beneficio senza meccanismo: è un desiderio, non un claim' });
  }

  const demographic = sentencesOf(caption).some((s) => {
    const n = normalizeText(s);
    const m = n.match(DEMOGRAPHIC_AUDIENCE);
    if (!m) return false;
    return !STATE_CLAUSE.test(n.slice(m.index ?? 0));
  });
  if (demographic) {
    found.push({ id: 'demographic_audience', penalty: 0.2, style: false, note: 'audience per demografia, non per stato' });
  }

  return found;
}

function scoreStructuralTells(
  caption: string,
  words: number,
  register: 'default' | 'formal'
): { value: number; note: string; found: string[]; emDashes: number } {
  const emDashes = (caption.match(/—/g) ?? []).length;
  const tells = structuralTellsOf(caption, words);
  if (!tells.length) return { value: 1, note: 'nessun tell strutturale', found: [], emDashes };

  const penalty = tells.reduce((s, t) => s + (register === 'formal' && t.style ? t.penalty / 2 : t.penalty), 0);
  return {
    value: clamp01(1 - penalty),
    note: tells
      .slice(0, 3)
      .map((t) => t.note)
      .join(' / '),
    found: tells.map((t) => t.id),
    emDashes
  };
}

/**
 * Rhythm. Human writing varies violently in sentence length and paragraph size; machine writing
 * metronomes — every sentence 12-18 words, every paragraph the same height. No checklist catches
 * this, and it is one of the strongest tells there is, so it gets its own graded check rather than
 * being folded into the structural penalty.
 *
 * Deliberately NEUTRAL (1.0) on short captions: a three-sentence post has no rhythm to read, and
 * scoring one would punish X and Threads for being X and Threads.
 */
function scoreSentenceRhythm(caption: string): {
  value: number;
  note: string;
  sentenceCv: number | null;
  paragraphCv: number | null;
} {
  const sentenceLengths = sentencesOf(caption).map((s) => wordsOf(normalizeText(s)).length);
  const paragraphLengths = paragraphsOf(caption).map((p) => p.length);
  const sentenceCv = coefficientOfVariation(sentenceLengths, 4);
  const paragraphCv = coefficientOfVariation(paragraphLengths, 3);

  if (sentenceCv === null && paragraphCv === null) {
    return { value: 1, note: 'troppo corto per leggere un ritmo', sentenceCv, paragraphCv };
  }

  // CV 0.35+ reads as human variation; 0 is a metronome. Linear in between.
  const sentenceScore = sentenceCv === null ? null : clamp01(sentenceCv / 0.35);
  const paragraphScore = paragraphCv === null ? null : clamp01(paragraphCv / 0.3);

  const value =
    sentenceScore !== null && paragraphScore !== null
      ? sentenceScore * 0.7 + paragraphScore * 0.3
      : (sentenceScore ?? paragraphScore ?? 1);

  const parts: string[] = [];
  if (sentenceCv !== null) parts.push(`frasi cv ${sentenceCv.toFixed(2)}`);
  if (paragraphCv !== null) parts.push(`paragrafi cv ${paragraphCv.toFixed(2)}`);
  return {
    value: clamp01(value),
    note: value >= 0.7 ? `ritmo vario (${parts.join(', ')})` : `ritmo metronomico (${parts.join(', ')})`,
    sentenceCv,
    paragraphCv
  };
}

/**
 * PROOF DISCIPLINE as a graded check.
 *
 * The generators are told never to invent a statistic, a testimonial or a customer name, and to
 * write `[NEED: …]` where a number was wanted instead. A prompt rule that nothing measures is a
 * suggestion, and this is the failure mode with the highest cost per occurrence in the whole
 * product: a plausible invented number published on a schedule under the client's name.
 *
 * The `[NEED:` marker itself is NOT penalised. It is the system being honest about what it does not
 * know, it is caught as a hard publish blocker in `prepublish-check.ts`, and scoring it here would
 * teach the generator to drop the marker and keep the invented number — the exact inversion.
 */
function scoreProofDiscipline(caption: string): { value: number; note: string; problems: string[]; needs: string[] } {
  const problems = unattributedProof(caption);
  const needs = needMarkers(caption);
  if (!problems.length) {
    return {
      value: 1,
      note: needs.length ? `nessun claim non attribuito (${needs.length} segnaposto [NEED] da riempire)` : 'nessun claim non attribuito',
      problems: [],
      needs
    };
  }
  // One unsupported claim is most of the damage; the curve is steep on purpose.
  const value = clamp01(1 - problems.length * 0.45);
  return {
    value,
    note: problems
      .slice(0, 2)
      .map((p) => p.note)
      .join(' / '),
    problems: problems.map((p) => `${p.id}: ${p.quote}`),
    needs
  };
}

function scoreSpecificity(caption: string, words: number): { value: number; note: string } {
  if (!words) return { value: 0, note: 'nessun testo' };
  const numbers = (caption.match(/\d+([.,]\d+)?\s?(%|€|\$|k|mila|min|h|giorni|days|anni|years|x)?/gi) ?? []).length;
  // Capitalised tokens that are NOT sentence-initial: product names, places, people.
  const propers = (caption.match(/(?<![.!?…]\s)(?<!^)\b[A-ZÀ-Þ][\p{Ll}]{2,}/gu) ?? []).length;
  const units = (caption.match(/[%€$]|\b(km|kg|mq|ore|minuti|settimane|mesi|weeks|months|hours)\b/gi) ?? []).length;

  const density = ((numbers + propers + units) / words) * 100;
  // ~3 concrete tokens per 100 words reads as specific; below that it is adjectives.
  const value = clamp01(density / 3);
  return {
    value,
    note: value >= 0.8 ? 'concreto' : `poco concreto (${numbers} numeri, ${propers} nomi propri)`
  };
}

/**
 * A CTA belongs at the end; one buried mid-post is worth less than one that closes.
 *
 * Position is read from where the LAST marker starts, as a fraction of the caption — not by slicing
 * the tail and searching it. Slicing cuts a marker in half whenever the fraction lands inside it,
 * which silently demoted every short caption whose closing sentence WAS the call to action.
 */
function scoreCta(caption: string): { value: number; note: string } {
  const norm = normalizeText(caption);
  if (!norm) return { value: 0, note: 'nessuna CTA' };

  let lastStart = -1;
  CTA_RE.lastIndex = 0;
  for (let m = CTA_RE.exec(norm); m; m = CTA_RE.exec(norm)) {
    // m[1] is the leading space (empty at string start) — point at the marker itself.
    lastStart = m.index + m[1].length;
  }
  if (lastStart < 0) return { value: 0, note: 'nessuna CTA riconoscibile' };

  const position = lastStart / norm.length;
  return position >= 0.5
    ? { value: 1, note: 'CTA in chiusura' }
    : { value: 0.6, note: 'CTA presente ma non in chiusura' };
}

function scoreReadability(caption: string, words: number): { value: number; note: string; sentences: number } {
  const sentences = Math.max(1, (caption.match(/[.!?…]+(\s|$)/g) ?? []).length);
  if (!words) return { value: 0, note: 'nessun testo', sentences };

  const avg = words / sentences;
  // 8–20 words/sentence reads well on a phone; longer is a wall, shorter is staccato.
  let value = bandScore(avg, [8, 20], [3, 34]);

  // A long caption with no line break at all is unreadable in-feed regardless of sentence length.
  const longestBlock = Math.max(...caption.split(/\r?\n\s*\r?\n|\r?\n/).map((b) => b.trim().length), 0);
  if (longestBlock > 600) value = Math.min(value, 0.35);
  else if (longestBlock > 400) value = Math.min(value, 0.7);

  return {
    value: clamp01(value),
    note: `~${Math.round(avg)} parole/frase, blocco max ${longestBlock} char`,
    sentences
  };
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

function scoreEmoji(caption: string, words: number): { value: number; note: string; count: number } {
  const count = (caption.match(EMOJI_RE) ?? []).length;
  if (!count) return { value: 1, note: 'nessuna emoji', count };
  const per100 = (count / Math.max(words, 10)) * 100;
  // Up to ~5 per 100 words is decoration; beyond that it is noise.
  const value = per100 <= 5 ? 1 : clamp01(1 - (per100 - 5) / 10);
  return { value, note: `${count} emoji (${per100.toFixed(1)}/100 parole)`, count };
}

function scoreHashtags(caption: string, band: Band): { value: number; note: string; count: number } {
  const count = (caption.match(/#[\p{L}0-9_]{2,50}/gu) ?? []).length;
  const [lo, hi] = band.tags;
  if (count >= lo && count <= hi) return { value: 1, note: `${count} hashtag`, count };
  if (count < lo) return { value: clamp01(lo === 0 ? 1 : count / lo), note: `solo ${count} hashtag`, count };
  // Over the band: each extra tag past the ceiling costs, hitting 0 at 2× the ceiling.
  const over = count - hi;
  return { value: clamp01(1 - over / Math.max(hi, 4)), note: `${count} hashtag (max consigliato ${hi})`, count };
}

function scoreSelfRepetition(
  caption: string,
  recent: (string | null | undefined)[]
): { value: number; note: string; maxSim: number } {
  const others = recent.map((c) => String(c ?? '').trim()).filter((c) => c.length > 0);
  if (!others.length) return { value: 1, note: 'nessuno storico da confrontare', maxSim: 0 };

  const mine = shingles(caption);
  let maxSim = 0;
  for (const other of others) {
    const sim = jaccard(mine, shingles(other));
    if (sim > maxSim) maxSim = sim;
  }
  // Below 0.20 overlap is normal for one brand voice; 0.55+ is the same post rewritten.
  const value = maxSim <= 0.2 ? 1 : clamp01(1 - (maxSim - 0.2) / 0.35);
  return {
    value,
    note: maxSim <= 0.2 ? 'originale' : `${Math.round(maxSim * 100)}% di sovrapposizione con un post recente`,
    maxSim
  };
}

/**
 * Score one caption. Pure: no clock, no randomness, no network — a sample scored today and the same
 * sample re-scored in six months under the same `CONTENT_SCORER_VERSION` return identical numbers.
 */
export function scoreContentQuality(input: ScoreInput): ContentQuality {
  const caption = String(input.caption ?? '');
  const band = bandFor(input.platform);
  const normalized = normalizeText(caption);
  const words = wordsOf(normalized).length;
  const chars = caption.trim().length;

  const hook = scoreHook(caption);
  const tells = scoreAiTells(caption, words);
  const structural = scoreStructuralTells(caption, words, input.register === 'formal' ? 'formal' : 'default');
  const proof = scoreProofDiscipline(caption);
  const rhythm = scoreSentenceRhythm(caption);
  const repetition = scoreSelfRepetition(caption, input.recentCaptions ?? []);
  const specificity = scoreSpecificity(caption, words);
  const cta = scoreCta(caption);
  const readability = scoreReadability(caption, words);
  const emoji = scoreEmoji(caption, words);
  const hashtags = scoreHashtags(caption, band);
  const lengthValue = bandScore(chars, band.sweet, band.hard);

  const checks: QualityCheck[] = [
    { id: 'hook_strength', value: hook.value, weight: WEIGHTS.hook_strength, note: hook.note },
    { id: 'ai_tells', value: tells.value, weight: WEIGHTS.ai_tells, note: tells.note },
    { id: 'structural_tells', value: structural.value, weight: WEIGHTS.structural_tells, note: structural.note },
    { id: 'sentence_rhythm', value: rhythm.value, weight: WEIGHTS.sentence_rhythm, note: rhythm.note },
    { id: 'proof_discipline', value: proof.value, weight: WEIGHTS.proof_discipline, note: proof.note },
    { id: 'self_repetition', value: repetition.value, weight: WEIGHTS.self_repetition, note: repetition.note },
    { id: 'specificity', value: specificity.value, weight: WEIGHTS.specificity, note: specificity.note },
    { id: 'cta', value: cta.value, weight: WEIGHTS.cta, note: cta.note },
    {
      id: 'length_fit',
      value: lengthValue,
      weight: WEIGHTS.length_fit,
      note: `${chars} char (ideale ${band.sweet[0]}–${band.sweet[1]})`
    },
    { id: 'readability', value: readability.value, weight: WEIGHTS.readability, note: readability.note },
    { id: 'hashtag_hygiene', value: hashtags.value, weight: WEIGHTS.hashtag_hygiene, note: hashtags.note },
    { id: 'emoji_hygiene', value: emoji.value, weight: WEIGHTS.emoji_hygiene, note: emoji.note }
  ];

  // An empty caption is a 0, not a partial score — the hygiene checks would otherwise award it the
  // "no emoji, no hashtag spam" points and hand a broken post a passing grade.
  if (!chars) {
    return {
      index: 0,
      checks: checks.map((c) => ({ ...c, value: 0, note: 'caption vuota' })),
      metrics: {
        words: 0,
        chars: 0,
        sentences: 0,
        hashtags: 0,
        emojis: 0,
        aiTells: [],
        maxSimilarity: 0,
        structuralTells: [],
        sentenceCv: null,
        paragraphCv: null,
        emDashes: 0,
        unattributedProof: [],
        needMarkers: []
      }
    };
  }

  const total = checks.reduce((s, c) => s + c.value * c.weight, 0);
  return {
    index: Math.round(total * 10) / 10,
    checks,
    metrics: {
      words,
      chars,
      sentences: readability.sentences,
      hashtags: hashtags.count,
      emojis: emoji.count,
      aiTells: tells.found,
      maxSimilarity: Math.round(repetition.maxSim * 1000) / 1000,
      structuralTells: structural.found,
      sentenceCv: rhythm.sentenceCv === null ? null : Math.round(rhythm.sentenceCv * 1000) / 1000,
      paragraphCv: rhythm.paragraphCv === null ? null : Math.round(rhythm.paragraphCv * 1000) / 1000,
      emDashes: structural.emDashes,
      unattributedProof: proof.problems,
      needMarkers: proof.needs
    }
  };
}

/** Flatten to `{ check_id: value }` — the shape stored in `content_quality_samples.checks`. */
export function checkValues(q: ContentQuality): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of q.checks) out[c.id] = Math.round(c.value * 1000) / 1000;
  return out;
}
