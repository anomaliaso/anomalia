/**
 * THE FIVE GEO LEVERS — a weighted citability score, where the technical audit is 10% of it.
 *
 * WHAT WAS WRONG WITH THE OLD NUMBER. `geo.ts` computes `100 − Σ penalties` over a list of
 * technical issues: llms.txt, robots.txt, JSON-LD, meta, response time. All real, all worth fixing,
 * and together they are the SMALLEST of the five things that decide whether a model cites a page.
 * A site can score 95 on that audit and never be named in an answer, because what actually gets
 * lifted is a self-contained paragraph that answers the question and contains a fact the model
 * could not have produced on its own.
 *
 *   Estraibilità   25%  Can a model lift a correct, self-contained answer without the rest of the page?
 *   Evidenza       25%  Does the page contain facts a model could not have invented?
 *   Entità         20%  Does the web have ONE coherent understanding of who this brand is?
 *   Corroborazione 20%  Do other sources say it too? Models weight that above self-description.
 *   Accesso        10%  Crawlers, llms.txt, clean HTML — the old audit, at its real weight.
 *
 * DIAGNOSE THE BINDING CONSTRAINT. One lever usually dominates and fixing the other four moves
 * nothing until it is addressed. The report says which, rather than handing over five to-do lists.
 *
 * ANTI-CITATION SIGNALS. Every positive lever can be present and citation still not happen, because
 * the page carries a disqualifier — a CTA density that reads as a funnel step rather than a
 * reference, an interstitial over the content, an undated claim on a time-sensitive topic. Removing
 * one of those is usually cheaper than adding anything, so they are found and scored separately.
 *
 * PRIORITISATION PRIOR. The one controlled study in this space (Princeton, KDD 2024,
 * arxiv.org/abs/2311.09735) measured visibility lifts per tactic: quotations ~+41%, statistics
 * ~+33%, fluency ~+29%, citing sources ~+27% — and keyword stuffing did nothing in generative
 * engines. Engine behaviour has moved since; the ORDERING (evidence density beats keyword tactics)
 * has held in every replication, and that ordering is what ranks the fixes below.
 *
 * HONESTY. No engine publishes its citation criteria. Everything here is inferred from observed
 * behaviour and published guidance on helpful content, the score is a heuristic, and the report says
 * so every time. We promise improved extractability, evidence density and entity consistency —
 * things actually under the client's control — never citation itself.
 *
 * Pure: no clock, no I/O, no randomness. Adapted from Yuzzyuk/marketing-os (`geo.md`,
 * `geo-engines.md`, MIT) — see `docs/35-marketing-doctrine.md`.
 */
import { gapsSection, gradeWithCoverage, type CoverageSignal, type GradedScore } from '$lib/server/coverage';

export type GeoLeverId = 'extractability' | 'evidence' | 'entity' | 'corroboration' | 'machine_access';

export const GEO_LEVER_WEIGHTS: Record<GeoLeverId, number> = {
  extractability: 25,
  evidence: 25,
  entity: 20,
  corroboration: 20,
  machine_access: 10
};

export const GEO_LEVER_LABELS: Record<GeoLeverId, string> = {
  extractability: 'Estraibilità',
  evidence: 'Specificità ed evidenza',
  entity: 'Chiarezza dell’entità',
  corroboration: 'Corroborazione',
  machine_access: 'Accesso macchina'
};

/** An anti-citation signal: a disqualifier that no amount of positive work compensates for. */
export type AntiCitationSignal = { id: string; note: string; fix: string };

// ── Extractability ────────────────────────────────────────────────────────────────────────────

export type ExtractabilityRead = {
  /** 0..1 */
  value: number;
  questionHeadings: number;
  totalHeadings: number;
  /** Sections whose first 2-3 sentences actually answer the heading, roughly 100-170 words. */
  liftableBlocks: number;
  /** Sections that open with a preamble before the answer. */
  preambleBlocks: number;
  /** Tables and lists — facts a model can lift without parsing prose. */
  structuredFacts: number;
  /** Sections that cannot stand alone: unresolved pronouns, "as mentioned above". */
  danglingSections: number;
  note: string;
};

const HEADING_RE = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
const QUESTION_HEAD = /\?|^(come|cosa|perché|perche|quando|quanto|quale|quali|chi|dove|how|what|why|when|which|who|where|is|does|can)\b/i;
const DANGLING = /\b(come (detto|visto) (sopra|prima)|come sopra|vedi sopra|as (mentioned|described) above|see above|questo|quest[oiae])\b/i;

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const words = (t: string): number => (t ? t.split(/\s+/).filter(Boolean).length : 0);

/**
 * Can a model lift a self-contained, correct answer without needing the rest of the page?
 *
 * The fastest real diagnostic is to take one section, read it alone, and ask whether it answers the
 * question. That is what this approximates: heading shape, answer position, block length, and
 * whether the section survives being read in isolation.
 */
export function extractabilityOf(html: string): ExtractabilityRead {
  const sections: Array<{ heading: string; body: string }> = [];
  const matches = [...html.matchAll(HEADING_RE)];
  for (let i = 0; i < matches.length; i++) {
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? html.length) : html.length;
    sections.push({ heading: stripTags(matches[i][2]), body: stripTags(html.slice(start, end)) });
  }

  const totalHeadings = sections.length;
  if (!totalHeadings) {
    return {
      value: 0,
      questionHeadings: 0,
      totalHeadings: 0,
      liftableBlocks: 0,
      preambleBlocks: 0,
      structuredFacts: 0,
      danglingSections: 0,
      note: 'Nessun heading: la pagina è un blocco unico e non c’è niente da sollevare.'
    };
  }

  let questionHeadings = 0;
  let liftableBlocks = 0;
  let preambleBlocks = 0;
  let danglingSections = 0;

  for (const s of sections) {
    if (QUESTION_HEAD.test(s.heading.trim())) questionHeadings++;
    const w = words(s.body);
    // The community-measured sweet spot for a self-contained answer block is ~100-170 words: long
    // enough to be complete, short enough to be lifted whole. A heuristic, not a rule.
    if (w >= 60 && w <= 220) liftableBlocks++;
    // Preamble: the first sentence sets up rather than answers. Approximated by an opening sentence
    // with no verb-of-fact and no number, ahead of a much longer body.
    const first = s.body.split(/(?<=[.!?])\s/)[0] ?? '';
    if (w > 80 && first && !/\d/.test(first) && /^(in questo|qui |prima di|molti |spesso |negli ultimi|in this|before we|many |often )/i.test(first)) {
      preambleBlocks++;
    }
    if (DANGLING.test(s.body.slice(0, 200))) danglingSections++;
  }

  const structuredFacts = (html.match(/<table[\s>]/gi) ?? []).length + (html.match(/<[uo]l[\s>]/gi) ?? []).length;

  // Four components, equally weighted: shape, liftability, structure, standalone-ness.
  const shape = clamp01(questionHeadings / Math.max(3, totalHeadings));
  const liftable = clamp01(liftableBlocks / Math.max(3, totalHeadings));
  const structured = clamp01(structuredFacts / 3);
  const standalone = clamp01(1 - (danglingSections + preambleBlocks) / Math.max(3, totalHeadings));
  const value = shape * 0.3 + liftable * 0.3 + structured * 0.15 + standalone * 0.25;

  return {
    value: clamp01(value),
    questionHeadings,
    totalHeadings,
    liftableBlocks,
    preambleBlocks,
    structuredFacts,
    danglingSections,
    note: `${questionHeadings}/${totalHeadings} heading in forma di domanda, ${liftableBlocks} blocchi sollevabili, ${structuredFacts} tabelle/liste, ${danglingSections + preambleBlocks} sezioni che non reggono da sole.`
  };
}

// ── Evidence density ──────────────────────────────────────────────────────────────────────────

export type EvidenceDensityRead = {
  value: number;
  numbers: number;
  datedClaims: number;
  citedSources: number;
  quotations: number;
  namedEntities: number;
  note: string;
};

/**
 * Models preferentially cite sources containing things they cannot generate themselves.
 *
 * The hard version of this test: **if a page contains no fact a model could not have invented, it
 * will not be cited, no matter how well it ranks.** Generic marketing prose is uncitable by
 * construction.
 */
export function evidenceDensityOf(html: string): EvidenceDensityRead {
  const text = stripTags(html);
  const w = Math.max(words(text), 1);

  const numbers = (text.match(/\b\d+([.,]\d+)?\s?(%|€|\$|£|mila|milioni|k\b|x\b)/gi) ?? []).length;
  const datedClaims = (text.match(/\b(20\d\d|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi) ?? []).length;
  const citedSources = (html.match(/<a[^>]+href=["']https?:\/\//gi) ?? []).length;
  const quotations = (html.match(/<blockquote[\s>]/gi) ?? []).length + (text.match(/[«"“][^»"”]{25,}[»"”]/g) ?? []).length;
  // Capitalised tokens that are not sentence-initial: products, companies, people, versions.
  const namedEntities = (text.match(/(?<![.!?]\s)(?<!^)\b[A-ZÀ-Þ][\p{Ll}]{2,}/gu) ?? []).length;

  const per1k = (n: number): number => (n / w) * 1000;
  // Weighted by the Princeton ordering: quotations and statistics move visibility most, cited
  // sources next. Keyword tactics are deliberately absent — they measured at zero.
  const value = clamp01(
    clamp01(per1k(quotations) / 2) * 0.3 +
      clamp01(per1k(numbers) / 8) * 0.3 +
      clamp01(per1k(citedSources) / 6) * 0.2 +
      clamp01(per1k(datedClaims) / 4) * 0.1 +
      clamp01(per1k(namedEntities) / 25) * 0.1
  );

  return {
    value,
    numbers,
    datedClaims,
    citedSources,
    quotations,
    namedEntities,
    note:
      value < 0.3
        ? `Densità di evidenza bassa (${numbers} numeri, ${quotations} citazioni, ${citedSources} fonti su ~${w} parole): un modello può già produrre questo testo da solo, quindi non ha motivo di citarlo.`
        : `${numbers} numeri, ${quotations} citazioni, ${citedSources} fonti collegate, ${datedClaims} riferimenti temporali su ~${w} parole.`
  };
}

// ── Entity clarity ────────────────────────────────────────────────────────────────────────────

export type EntityClarityRead = { value: number; hasOrganization: boolean; hasProduct: boolean; hasCategoryStatement: boolean; brandNamed: boolean; note: string };

/**
 * Does the web have a coherent, consistent understanding of who this brand is?
 *
 * Inconsistent self-description across sources is the most common and most fixable GEO failure. We
 * can only see this page, so this checks the on-page half: schema types, an explicit category
 * statement ("X is a [category] for [audience] that [outcome]"), and the brand actually being named.
 */
export function entityClarityOf(html: string, brandName: string, schemaTypes: string[] = []): EntityClarityRead {
  const text = stripTags(html);
  const types = schemaTypes.map((t) => t.toLowerCase());
  const hasOrganization = types.some((t) => t.includes('organization') || t.includes('localbusiness'));
  const hasProduct = types.some((t) => t.includes('product') || t.includes('service') || t.includes('softwareapplication'));
  const name = brandName.trim();
  const brandNamed = !!name && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);
  // `\b` is ASCII-only in JS, so `\bè` never matches — the copula has to be bounded by whitespace.
  const hasCategoryStatement =
    !!name &&
    new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^.]{0,40}\\s(è|e|is|are)\\s[^.]{0,120}\\s(per|for|che|that)\\s`, 'i').test(text);

  const value = clamp01(
    (hasOrganization ? 0.35 : 0) + (hasProduct ? 0.2 : 0) + (hasCategoryStatement ? 0.3 : 0) + (brandNamed ? 0.15 : 0)
  );

  return {
    value,
    hasOrganization,
    hasProduct,
    hasCategoryStatement,
    brandNamed,
    note: hasCategoryStatement
      ? 'Categoria dichiarata esplicitamente sulla pagina.'
      : 'Manca una frase di categoria esplicita ("X è un [categoria] per [pubblico] che [risultato]") — senza, il modello deve indovinare cosa siamo.'
  };
}

// ── Corroboration ─────────────────────────────────────────────────────────────────────────────

export type CorroborationRead = { value: number; probes: number; mentionRate: number; domainCitedRate: number; note: string };

/**
 * Models weight what OTHER sources say about a brand more than what the brand says about itself.
 *
 * Measured, not inferred: this reads the citation probes. Two different events are tracked, because
 * they are two different facts — the brand being NAMED in an answer, and the brand's own DOMAIN
 * being cited as a source. A brand can be named constantly and never linked, and the fix for each
 * is different.
 */
export function corroborationOf(input: { probes: number; mentioned: number; domainCited: number }): CorroborationRead {
  if (!input.probes) {
    return { value: 0, probes: 0, mentionRate: 0, domainCitedRate: 0, note: 'Nessuna sonda eseguita: la corroborazione non è stata misurata.' };
  }
  const mentionRate = input.mentioned / input.probes;
  const domainCitedRate = input.domainCited / input.probes;
  // Being named matters; being cited as the source matters more, and is rarer.
  const value = clamp01(mentionRate * 0.5 + domainCitedRate * 0.5);
  return {
    value,
    probes: input.probes,
    mentionRate,
    domainCitedRate,
    note: `Su ${input.probes} risposte: nominati nel ${Math.round(mentionRate * 100)}%, dominio citato come fonte nel ${Math.round(domainCitedRate * 100)}%. Sono due eventi diversi e la correzione è diversa: essere nominati si guadagna sulle fonti terze, essere citati sulla pagina.`
  };
}

// ── Anti-citation signals ─────────────────────────────────────────────────────────────────────

/**
 * Disqualifiers. Removing one is often cheaper than adding anything, which is why they are found
 * separately instead of being buried in the lever scores.
 */
export function antiCitationSignalsOf(html: string, opts: { hasNamedAuthor?: boolean } = {}): AntiCitationSignal[] {
  const text = stripTags(html);
  const w = Math.max(words(text), 1);
  const out: AntiCitationSignal[] = [];

  const ctas = (html.match(/<(a|button)[^>]*>(\s*)(iscriviti|registrati|prova|acquista|compra|richiedi|prenota|scarica|inizia|sign up|get started|buy|book|try|download|subscribe)/gi) ?? []).length;
  if (ctas / w > 0.01 && ctas >= 5) {
    out.push({
      id: 'cta_density',
      note: `${ctas} call-to-action su ~${w} parole: la pagina si legge come uno step di funnel, non come un riferimento.`,
      fix: 'Separare la pagina di riferimento da quella di conversione, o ridurre le CTA a una sola nel corpo.'
    });
  }

  if (/(cookie|newsletter|popup|modal|interstitial|overlay)[^>]{0,80}(consent|wall|gate|banner)/i.test(html) || /<dialog[\s>]/i.test(html)) {
    out.push({
      id: 'interstitial',
      note: 'Interstiziale, popup o cookie wall sopra il contenuto principale.',
      fix: 'Il contenuto primario deve essere nel primo HTML servito, senza nulla davanti.'
    });
  }

  if (w < 300) {
    out.push({
      id: 'thin_page',
      note: `~${w} parole: la pagina ripete quello che dicono altre cento pagine e non aggiunge niente da sollevare.`,
      fix: 'Aggiungere il fatto che solo noi possiamo dare: un dato di prima mano, un numero con metodo, un caso reale.'
    });
  }

  if (opts.hasNamedAuthor === false) {
    out.push({
      id: 'no_author',
      note: 'Nessun autore nominato e nessuna identità della fonte sulla pagina.',
      fix: 'Firmare la pagina con una persona reale e collegare una bio verificabile.'
    });
  }

  if (!/\b20\d\d\b/.test(text)) {
    out.push({
      id: 'undated',
      note: 'Nessuna data sulla pagina: su qualunque affermazione sensibile al tempo, questo la rende inaffidabile.',
      fix: 'Esporre data di pubblicazione e ultimo aggiornamento, anche solo nel markup.'
    });
  }

  // Client-side rendered primary content: almost no text against a large HTML payload.
  if (html.length > 2000 && w / (html.length / 100) < 1) {
    out.push({
      id: 'js_gated',
      note: 'Il contenuto principale sembra renderizzato lato client: nell’HTML servito non c’è quasi testo.',
      fix: 'Servire il contenuto primario nell’HTML iniziale (SSR o pre-render).'
    });
  }

  return out;
}

// ── The score ─────────────────────────────────────────────────────────────────────────────────

export type GeoLeverScore = { id: GeoLeverId; label: string; weight: number; value: number | null; note: string };

export type GeoCitability = {
  graded: GradedScore;
  levers: GeoLeverScore[];
  /** The lever actually limiting citation. Fixing the others moves nothing until this is addressed. */
  bindingConstraint: { id: GeoLeverId; label: string; why: string } | null;
  antiSignals: AntiCitationSignal[];
  /** Ranked fixes — evidence density before keyword tactics, per the Princeton ordering. */
  priorities: string[];
  /** The gaps section. Every report ends with one. */
  gaps: string;
  /** The honesty line. Printed every time, not once. */
  disclaimer: string;
};

export const GEO_DISCLAIMER =
  'Nessun motore pubblica i propri criteri di citazione: questo punteggio è un’euristica derivata dal comportamento osservato e dalle linee guida pubbliche sui contenuti utili, non una misura. La citazione non è deterministica — la stessa domanda restituisce fonti diverse fra sessioni e regioni. Promettiamo estraibilità, densità di evidenza e coerenza dell’entità, che sono sotto il controllo del cliente; non promettiamo la citazione.';

/**
 * Combine the five levers under the coverage gate.
 *
 * A lever we could not measure is `null` → `unknown`: it costs coverage, never score. In particular
 * corroboration is unmeasurable without probes, and reporting a citability score that quietly
 * excluded the single most predictive lever would be the exact silent fill `coverage.ts` exists to
 * prevent.
 */
export function geoCitability(input: {
  extractability: number | null;
  evidence: number | null;
  entity: number | null;
  corroboration: number | null;
  machineAccess: number | null;
  notes?: Partial<Record<GeoLeverId, string>>;
  antiSignals?: AntiCitationSignal[];
}): GeoCitability {
  const levers: GeoLeverScore[] = (
    [
      ['extractability', input.extractability],
      ['evidence', input.evidence],
      ['entity', input.entity],
      ['corroboration', input.corroboration],
      ['machine_access', input.machineAccess]
    ] as Array<[GeoLeverId, number | null]>
  ).map(([id, value]) => ({
    id,
    label: GEO_LEVER_LABELS[id],
    weight: GEO_LEVER_WEIGHTS[id],
    value,
    note: input.notes?.[id] ?? ''
  }));

  const signals: CoverageSignal[] = levers.map((l) => ({
    key: l.id,
    label: l.label,
    weight: l.weight,
    ...(l.value === null ? { verdict: 'unknown' as const } : { verdict: 'pass' as const, value: l.value })
  }));
  const graded = gradeWithCoverage(signals);

  // The binding constraint is the measured lever losing the most weighted points — not the lowest
  // raw score, because a 0.4 on a 25% lever costs more than a 0.2 on a 10% one.
  const measured = levers.filter((l) => l.value !== null) as Array<GeoLeverScore & { value: number }>;
  const worst = measured.slice().sort((a, b) => (1 - b.value) * b.weight - (1 - a.value) * a.weight)[0] ?? null;
  const bindingConstraint = worst
    ? {
        id: worst.id,
        label: worst.label,
        why: `${worst.label} sta perdendo ${Math.round((1 - worst.value) * worst.weight)} punti pesati su ${worst.weight}. Finché non si sistema questa, migliorare le altre quattro non muove la citazione.`
      }
    : null;

  const priorities: string[] = [];
  if (worst?.id === 'evidence' || (input.evidence ?? 1) < 0.4) {
    priorities.push(
      'Aggiungere citazioni verificabili e statistiche con fonte e data. È la leva con l’effetto misurato più alto (citazioni ~+41%, statistiche ~+33% nello studio Princeton KDD 2024) e la sola che rende la pagina non riproducibile da un modello.'
    );
  }
  if ((input.extractability ?? 1) < 0.5) {
    priorities.push(
      'Ristrutturare in blocchi risposta-prima: heading in forma di domanda, risposta nelle prime 2-3 frasi, ogni sezione leggibile da sola.'
    );
  }
  if ((input.entity ?? 1) < 0.6) {
    priorities.push(
      'Una sola descrizione canonica ovunque (sito, About, LinkedIn, directory) più una frase di categoria esplicita e lo schema Organization/Product.'
    );
  }
  if ((input.corroboration ?? 1) < 0.4) {
    priorities.push(
      'Lavorare sulle fonti terze che rispondono alle domande target: liste "migliori X per Y", piattaforme di recensioni, pagine di confronto. Il modello pesa quello che dicono gli altri più di quello che diciamo noi.'
    );
  }
  for (const s of input.antiSignals ?? []) priorities.push(`Rimuovere un disqualificante: ${s.note} → ${s.fix}`);
  // Keyword tactics deliberately never appear here: measured at ~zero effect in generative engines.

  return {
    graded,
    levers,
    bindingConstraint,
    antiSignals: input.antiSignals ?? [],
    priorities,
    gaps: gapsSection(graded),
    disclaimer: GEO_DISCLAIMER
  };
}
