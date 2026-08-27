/**
 * THE COPY PANEL — five named perspectives, and iteration instead of a single verdict.
 *
 * WHAT THE COPY CHIEF ALREADY DID. `reviewCaptions` audits a finished batch for invented facts,
 * platform register, language, clichés and monotony, and rewrites what fails. It is a good gate and
 * it is BINARY: a caption is either flagged or it ships. Which means the whole middle of the
 * distribution — competent, on-brand, entirely forgettable — ships untouched, and that middle is
 * most of what an autopilot produces.
 *
 * WHAT THE PANEL ADDS.
 *
 *   Lo scettico   Ci crederebbe un lettore sveglio, occupato e diffidente?
 *   L'estraneo    Letta a freddo, senza contesto, arriva in tre secondi?
 *   Il concorrente Un rivale potrebbe metterci sopra il proprio logo senza cambiare una parola?
 *   Il buyer      Parla di ciò che lo tiene sveglio, o di ciò di cui il brand è orgoglioso?
 *   L'editor      Ogni parola porta un carico?
 *
 * The competitor test is the sharpest of the five and the one nothing in this codebase did: if a
 * rival could paste their logo on the caption unchanged, it is not positioning, it is decoration.
 * That test alone discards a large share of "fine" output.
 *
 * ITERATE, DO NOT JUST RANK. A caption at 70-84 is a REWRITE CANDIDATE, not a reject: take the
 * panel's single specific objection, fix that one thing, re-score. Two or three passes typically
 * move a 76 into the high 80s. Below 70 it is killed and rewritten from the angle.
 *
 * COST. Round 1 scores the whole batch in one call — the same shape the chief already pays for.
 * Each extra round only carries the captions still in the middle band, and there are at most
 * `COPY_PANEL_MAX_ROUNDS` of them; a batch where everything lands ≥85 or ≤69 costs exactly one
 * call. `COPY_PANEL_ENABLED=false` turns the whole thing off.
 *
 * The pure parts (banding, which captions to carry forward, merging) live here and are tested
 * directly; the prompt and the call live with the batch in `content-preview.ts`.
 *
 * Adapted from Yuzzyuk/marketing-os (`copy.md` panel, MIT) — see `docs/35-marketing-doctrine.md`.
 */

export const PANEL_PERSPECTIVES = ['skeptic', 'stranger', 'competitor', 'buyer', 'editor'] as const;
export type PanelPerspective = (typeof PANEL_PERSPECTIVES)[number];

/** Each perspective scores 0-20; the five sum to 100. */
export const PANEL_MAX_PER_PERSPECTIVE = 20;

/** Below this a caption is killed and rewritten from its angle, not polished. */
export const PANEL_KILL_BELOW = 70;
/** At or above this the caption ships — further passes are polishing, not improving. */
export const PANEL_SHIP_AT = 85;
/** Beyond three passes you are polishing. */
export const COPY_PANEL_MAX_ROUNDS = 3;

export type PanelScores = Record<PanelPerspective, number>;

export type PanelVerdict = {
  index: number;
  scores: PanelScores;
  /** 0-100. Recomputed from `scores` — a model-supplied total is not trusted to add up. */
  total: number;
  /** The ONE thing to fix. A list of five objections produces a rewrite that fixes none of them. */
  objection: string;
  /** The rewrite, when the model supplied one. */
  caption?: string;
};

export type PanelBand = 'ship' | 'iterate' | 'kill';

export function bandOfScore(total: number): PanelBand {
  if (total >= PANEL_SHIP_AT) return 'ship';
  if (total >= PANEL_KILL_BELOW) return 'iterate';
  return 'kill';
}

const clampScore = (n: unknown): number => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.min(PANEL_MAX_PER_PERSPECTIVE, Math.max(0, v));
};

/**
 * Le caption arrivano ai judge dentro un'impalcatura di lista ("0. [reddit · product: X]",
 * "HASHTAGS: (none)") e i modelli ogni tanto la RICOPIANO nella riscrittura — visto dal vivo:
 * una fix del chief spedita con "[reddit | subreddit: r/SaaS | title: …]" in testa alla caption.
 * Metadati in caption pubblicata = il fallimento peggiore di un quality pass. Si strappa in
 * codice a ogni riscrittura applicata (chief e panel), mai con altro prompt.
 */
export function stripJudgeScaffolding(caption: string): string {
  const lines = String(caption ?? '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i].trim();
    // Header di lista ("3. [reddit …]" o "[reddit | …]"), riga HASHTAGS, o vuoto in testa.
    if (/^\d+\.\s*\[/.test(l) || /^\[[^\]]{0,200}\]$/.test(l) || /^HASHTAGS:/i.test(l) || l === '') {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join('\n').trim();
}

/**
 * Normalise one raw verdict.
 *
 * The total is RECOMPUTED from the five scores rather than read: models routinely return a total
 * that does not match the parts, and a caption that ships on a mis-added total is exactly the kind
 * of silent failure this panel exists to catch.
 */
export function normalizeVerdict(raw: unknown): PanelVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const index = Number(r.index);
  if (!Number.isInteger(index) || index < 0) return null;
  const src = (r.scores && typeof r.scores === 'object' ? r.scores : {}) as Record<string, unknown>;
  const scores = Object.fromEntries(PANEL_PERSPECTIVES.map((p) => [p, clampScore(src[p])])) as PanelScores;
  const total = PANEL_PERSPECTIVES.reduce((s, p) => s + scores[p], 0);
  const caption = stripJudgeScaffolding(String(r.caption ?? ''));
  return {
    index,
    scores,
    total,
    objection: String(r.objection ?? '').trim(),
    ...(caption ? { caption } : {})
  };
}

/**
 * Which captions go into the next round.
 *
 * Only the middle band iterates. A `kill` is rewritten in this round and re-enters scoring on the
 * next one; a `ship` is done. A verdict whose rewrite is missing cannot be iterated — there is
 * nothing new to score — so it drops out rather than burning a round on the identical text.
 */
export function toIterate(verdicts: PanelVerdict[], round: number): PanelVerdict[] {
  if (round >= COPY_PANEL_MAX_ROUNDS) return [];
  return verdicts.filter((v) => bandOfScore(v.total) === 'iterate' && !!v.caption);
}

/** Captions that must be replaced outright: the band is `kill` and a rewrite came back. */
export function toReplace(verdicts: PanelVerdict[]): PanelVerdict[] {
  return verdicts.filter((v) => bandOfScore(v.total) === 'kill' && !!v.caption);
}

/**
 * Keep the better of two verdicts for the same caption.
 *
 * An iteration can make a caption WORSE — the model fixes the stated objection and breaks something
 * the panel had already passed. Without this the pipeline would ship the last attempt rather than
 * the best one, which turns a quality pass into a coin flip.
 */
export function bestOf(previous: PanelVerdict | undefined, next: PanelVerdict): PanelVerdict {
  if (!previous) return next;
  return next.total >= previous.total ? next : previous;
}

/** Summary line for the run log — what the panel actually changed, in one place. */
export function panelSummary(verdicts: PanelVerdict[]): string {
  const bands = { ship: 0, iterate: 0, kill: 0 };
  for (const v of verdicts) bands[bandOfScore(v.total)]++;
  const avg = verdicts.length ? Math.round(verdicts.reduce((s, v) => s + v.total, 0) / verdicts.length) : 0;
  return `panel: ${verdicts.length} caption, media ${avg}/100 — ${bands.ship} pronte, ${bands.iterate} da iterare, ${bands.kill} da riscrivere`;
}

/** The schema the model fills. One objection, not a list: a rewrite aimed at five things fixes none. */
export const COPY_PANEL_SCHEMA = {
  type: 'object' as const,
  properties: {
    verdicts: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index: { type: 'integer' as const, description: '0-based index of the caption being judged.' },
          scores: {
            type: 'object' as const,
            properties: {
              skeptic: { type: 'integer' as const, description: '0-20. Lo scettico: un lettore sveglio, occupato e diffidente ci crederebbe? Affonda su superlativi non sostenuti e claim senza prova adiacente.' },
              stranger: { type: 'integer' as const, description: '0-20. L\'estraneo: letta a freddo, senza il resto della pagina, arriva in tre secondi? Affonda se serve il contesto per avere senso.' },
              competitor: { type: 'integer' as const, description: '0-20. Il concorrente: un rivale potrebbe incollarci sopra il proprio logo senza cambiare una parola? Se sì il punteggio è basso — non è posizionamento, è decorazione.' },
              buyer: { type: 'integer' as const, description: '0-20. Il buyer: parla di ciò che lo preoccupa davvero, o di ciò di cui il brand è orgoglioso? Affonda sul secondo.' },
              // L'editor è anche il rilevatore di tell da AI del panel: la cadenza, non solo il peso
              // delle parole — chiude il fallimento "pulito ma riconoscibilmente scritto da un LLM".
              editor: { type: 'integer' as const, description: '0-20. L\'editor: ogni parola porta un carico? Affonda su avverbi, esitazioni, preamboli, riempitivi — e sui tell da AI: più di un trattino em (—), chiusa a tricolon, aperture da template ("Scopri…"), superlativi senza prova accanto, pioggia di emoji.' }
            },
            required: [...PANEL_PERSPECTIVES]
          },
          objection: {
            type: 'string' as const,
            description: 'LA singola obiezione più forte del panel, concreta e azionabile. Una sola: una riscrittura che punta a cinque cose non ne sistema nessuna.'
          },
          caption: {
            type: 'string' as const,
            description: 'La caption riscritta PER INTERO che risolve quella singola obiezione, mantenendo angolo, piattaforma, lingua e fatti. Stringa vuota solo se la caption è già a posto.'
          }
        },
        required: ['index', 'scores', 'objection', 'caption']
      }
    }
  },
  required: ['verdicts']
};
