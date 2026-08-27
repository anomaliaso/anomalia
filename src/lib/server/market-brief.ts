/**
 * One cohort, two surfaces.
 *
 * The bank has to serve two jobs — positioning a user's video against the market, and briefing the
 * planner before it writes a new one — and both need the same thing: a matched cohort of winners
 * and controls for a given (vertical, form). Building that twice would guarantee the two drift
 * apart, and then "your hook is slower than the market" and "write a hook like the market" would
 * quietly be talking about different markets.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It never touches the judge's prompt. The rubric is fixed and
 * versioned so that a score from this release and one from the next are comparable — that trend
 * line is the whole reason CONTENT_SCORER_VERSION and `release` exist. Feeding market findings into
 * the prompt would rescale history silently at every change. Positioning is a layer ON TOP of an
 * unchanged score: a query, not a new instrument.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/**
 * A winner is clearly above the account's own normal; a control is clearly below.
 *
 * Both are measured against the SAME account's median, so neither depends on follower count. The
 * gap in the middle is deliberate: posts hovering around 1.0 carry no signal in either direction
 * and would only blur the contrast the brief exists to show.
 */
export const WINNER_AT = 1.3;
export const CONTROL_AT = 0.8;

/**
 * Minimum rows before a cohort is allowed to say anything.
 *
 * Matches the benchmark's MIN_COHORT for the same reason: below roughly this many samples the
 * comparison is dominated by noise, and a confident percentile computed on eight rows is worse than
 * no percentile — it gets believed.
 */
export const MIN_BRIEF_COHORT = 20;

/** How specific the cohort managed to be. The caller must be able to tell, and so must the model. */
export type BriefLevel = 'category+form' | 'form' | 'none';

export type BriefPost = {
  hook: string | null;
  durationS: number | null;
  soundIsOriginal: boolean | null;
  outperformance: number;
  topic: string | null;
  url: string | null;
};

export type MarketBrief = {
  level: BriefLevel;
  category: string | null;
  contentForm: string | null;
  /** Rows the cohort rests on. Published so nobody treats n=21 like n=2100. */
  cohortSize: number;
  winners: BriefPost[];
  controls: BriefPost[];
  /** Distributions the positioning layer reads. Empty arrays when nothing is known. */
  winnerHookSeconds: number[];
  winnerDurationsS: number[];
  /** Share of winners riding a sound they did not make. */
  borrowedSoundShare: number | null;
};

export const EMPTY_BRIEF: MarketBrief = {
  level: 'none',
  category: null,
  contentForm: null,
  cohortSize: 0,
  winners: [],
  controls: [],
  winnerHookSeconds: [],
  winnerDurationsS: [],
  borrowedSoundShare: null
};

const COLS =
  'hook_spoken, duration_ms, sound_is_original, outperformance, topic, url, category, content_form, published_at';

function toPost(r: AnyRec): BriefPost {
  return {
    hook: r.hook_spoken ?? null,
    durationS: r.duration_ms == null ? null : Math.round(Number(r.duration_ms) / 100) / 10,
    soundIsOriginal: r.sound_is_original ?? null,
    outperformance: Number(r.outperformance),
    topic: r.topic ?? null,
    url: r.url ?? null
  };
}

/**
 * Recency first, then strength.
 *
 * Short-form patterns rot: a hook that stopped the scroll last spring may be the thing people scroll
 * past now. Ordering purely by outperformance would fill the brief with the best posts of all time
 * and teach last year's playbook forever, so the newest qualifying rows come first and the ranking
 * within them is by margin.
 */
function orderRecentFirst(rows: AnyRec[]): AnyRec[] {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(String(a.published_at ?? '')) || 0;
    const tb = Date.parse(String(b.published_at ?? '')) || 0;
    if (tb !== ta) return tb - ta;
    return Number(b.outperformance) - Number(a.outperformance);
  });
}

async function fetchSide(
  admin: SupabaseClient,
  opts: { category?: string | null; contentForm?: string | null; side: 'winners' | 'controls'; limit: number }
): Promise<AnyRec[]> {
  let q = admin
    .from('market_posts')
    .select(COLS)
    .eq('category_source', 'gemini')
    .not('outperformance', 'is', null);

  if (opts.contentForm) q = q.eq('content_form', opts.contentForm);
  if (opts.category) q = q.eq('category', opts.category);

  q =
    opts.side === 'winners'
      ? q.gte('outperformance', WINNER_AT).order('outperformance', { ascending: false })
      : q.lte('outperformance', CONTROL_AT).order('outperformance', { ascending: true });

  // Over-fetch: the ranking that matters is recency, applied after the database has narrowed by
  // margin. Asking Postgres to order by date directly would return the newest mediocre rows.
  const { data, error } = await q.limit(Math.max(opts.limit * 6, 60));
  if (error) throw new Error(`market brief query failed: ${error.message}`);
  return (data ?? []) as AnyRec[];
}

function summarise(
  winners: AnyRec[],
  controls: AnyRec[],
  level: BriefLevel,
  category: string | null,
  contentForm: string | null,
  limit: number
): MarketBrief {
  const w = orderRecentFirst(winners);
  const c = orderRecentFirst(controls);
  const withSound = w.filter((r) => r.sound_is_original != null);
  return {
    level,
    category,
    contentForm,
    cohortSize: winners.length + controls.length,
    winners: w.slice(0, limit).map(toPost),
    controls: c.slice(0, limit).map(toPost),
    winnerHookSeconds: [],
    winnerDurationsS: w
      .map((r) => (r.duration_ms == null ? null : Number(r.duration_ms) / 1000))
      .filter((n): n is number => n != null && Number.isFinite(n)),
    borrowedSoundShare: withSound.length
      ? withSound.filter((r) => r.sound_is_original === false).length / withSound.length
      : null
  };
}

/**
 * The cohort, as specific as the data allows and no more.
 *
 * Tries (vertical, form) first, falls back to form alone, and returns `none` below the threshold
 * rather than a brief built on a handful of rows. Measured today: the fullest real (vertical, form)
 * cell is beauty/before_after at 32 rows, while form alone reaches 101 for talking_head — so most
 * calls will land on `form` and climb to `category+form` on their own, cell by cell, as the cron
 * fills the bank. The level is returned, not hidden, because a caller that cannot tell how specific
 * its evidence is will present a general finding as a local one.
 */
export async function briefFor(
  admin: SupabaseClient,
  opts: { category?: string | null; contentForm?: string | null; limit?: number }
): Promise<MarketBrief> {
  const limit = opts.limit ?? 6;
  const form = opts.contentForm ?? null;
  const category = opts.category ?? null;
  if (!form && !category) return EMPTY_BRIEF;

  if (category && form) {
    const [w, c] = await Promise.all([
      fetchSide(admin, { category, contentForm: form, side: 'winners', limit }),
      fetchSide(admin, { category, contentForm: form, side: 'controls', limit })
    ]);
    if (w.length + c.length >= MIN_BRIEF_COHORT && w.length && c.length) {
      return summarise(w, c, 'category+form', category, form, limit);
    }
  }

  if (form) {
    const [w, c] = await Promise.all([
      fetchSide(admin, { contentForm: form, side: 'winners', limit }),
      fetchSide(admin, { contentForm: form, side: 'controls', limit })
    ]);
    if (w.length + c.length >= MIN_BRIEF_COHORT && w.length && c.length) {
      return summarise(w, c, 'form', null, form, limit);
    }
  }

  return { ...EMPTY_BRIEF, category, contentForm: form };
}

// ── Positioning ────────────────────────────────────────────────────────────────────────────────

/** Share of the sample at or below `value`, 0..1. Null on an empty sample — never a confident 0.5. */
export function percentileOf(value: number, sample: number[]): number | null {
  const clean = sample.filter((n) => Number.isFinite(n));
  if (!clean.length) return null;
  return clean.filter((n) => n <= value).length / clean.length;
}

export function median(sample: number[]): number | null {
  const s = sample.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type MarketPosition = {
  level: BriefLevel;
  cohortSize: number;
  contentForm: string | null;
  category: string | null;
  /** One line per comparison the cohort could actually support. */
  notes: string[];
  durationS: { yours: number; marketMedian: number; percentile: number } | null;
  borrowedSoundShare: number | null;
};

/**
 * Where this video sits against the matched cohort.
 *
 * Says nothing it cannot support: every field is null and every note absent when the cohort is
 * `none` or the specific distribution is empty. Silence is the correct output of a thin bank — a
 * percentile invented from six rows would be believed exactly as much as a real one.
 */
export function positionAgainst(
  review: { duration_s?: number | null },
  brief: MarketBrief
): MarketPosition {
  const out: MarketPosition = {
    level: brief.level,
    cohortSize: brief.cohortSize,
    contentForm: brief.contentForm,
    category: brief.category,
    notes: [],
    durationS: null,
    borrowedSoundShare: brief.level === 'none' ? null : brief.borrowedSoundShare
  };
  if (brief.level === 'none') return out;

  // `Number(null)` is 0 and 0 is finite, so a missing duration would sail through as a real
  // zero-second video and be reported as "shorter than 100% of the winners". Absence has to be
  // checked before coercion, not after.
  const raw = review.duration_s;
  const yours = raw == null ? NaN : Number(raw);
  const med = median(brief.winnerDurationsS);
  const pct = Number.isFinite(yours) && yours > 0 ? percentileOf(yours, brief.winnerDurationsS) : null;
  if (Number.isFinite(yours) && yours > 0 && med != null && pct != null) {
    out.durationS = { yours, marketMedian: Math.round(med * 10) / 10, percentile: Math.round(pct * 100) / 100 };
    const longer = pct >= 0.5;
    out.notes.push(
      `Durata ${Math.round(yours)}s: più ${longer ? 'lungo' : 'corto'} del ${Math.round(
        (longer ? pct : 1 - pct) * 100
      )}% dei ${brief.contentForm ?? 'video'} che hanno sovraperformato (mediana ${Math.round(med)}s).`
    );
  }

  if (out.borrowedSoundShare != null) {
    out.notes.push(
      `Il ${Math.round(out.borrowedSoundShare * 100)}% di quelli che hanno sovraperformato usa un audio preso da un trend, non proprio.`
    );
  }

  return out;
}

/**
 * The brief as the planner reads it.
 *
 * Winners AND controls, always. A brief of winners alone teaches the average of what became
 * popular — including everything popular content does regardless of whether it caused the
 * popularity. The control is what carries the discriminative signal, and dropping it to save tokens
 * is the single easiest way to make this whole corpus worthless.
 *
 * The cohort size and level are stated in the text, not just in the object, because a model that is
 * told "here is what works" without being told "this rests on 23 posts" will treat it as law.
 */
export function briefToPrompt(brief: MarketBrief): string {
  if (brief.level === 'none') return '';
  const scope =
    brief.level === 'category+form'
      ? `${brief.category} / ${brief.contentForm}`
      : `${brief.contentForm} (tutte le verticali — la cella specifica non ha ancora abbastanza dati)`;

  const line = (p: BriefPost) =>
    `- x${p.outperformance.toFixed(1)}${p.durationS ? ` · ${Math.round(p.durationS)}s` : ''}${
      p.soundIsOriginal === false ? ' · audio da trend' : p.soundIsOriginal ? ' · audio proprio' : ''
    }${p.hook ? ` · hook: "${p.hook}"` : ''}${p.topic ? ` · ${p.topic}` : ''}`;

  return [
    `MERCATO — ${scope}. Base: ${brief.cohortSize} post reali, etichettati contro la mediana del loro stesso account.`,
    '',
    'Hanno sovraperformato:',
    ...brief.winners.map(line),
    '',
    'Non hanno sovraperformato, dagli stessi tipi di account:',
    ...brief.controls.map(line),
    '',
    "Usa il contrasto fra i due gruppi, non il solo primo: ciò che compare in entrambi non spiega niente.",
    brief.level === 'form'
      ? 'La coorte è per forma, non per verticale: trattala come una tendenza generale, non come una regola del settore.'
      : ''
  ]
    .filter(Boolean)
    .join('\n');
}
