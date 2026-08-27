/**
 * Post-render video QC — organic UGC vs paid ads.
 *
 * Script review (`ugc-script-review.ts`) kills weak writing before a frame is spent.
 * This module judges the FINISHED clip the way a stranger in a doomscroll would:
 * first 500ms of motion, 2s sound-off, 3s hook, hold, reveal timing, CTA.
 *
 * Model: Gemini Flash, multimodal (hook stills + the clip itself + audio fallback).
 * BEST-EFFORT: returns `{ ok: false }` when ffmpeg/Gemini/key/fetch fail — never throws
 * for expected infra gaps.
 *
 * Rubrics (condensed from Meta video-ad guidance, Elevarus 3s hook test, AdMapix 6-dimension
 * scorecard, Lomero short-form pre-publish protocol):
 *   organic — scroll-stop, native authenticity, reveal before 60%, one soft CTA in the last 10%
 *   ads     — thumb-stop WHO it stops, proof, unmistakable offer, uniqueness, claims safety
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { getBrandContext } from '$lib/server/ai-log';
import { llmConfigured, llmVideoReviewerModel, llmStructured } from '$lib/server/llm';
import { ensureFfmpegPath } from '$lib/server/ffmpeg-bin';
import { UGC_ORGANIC_MAX_DURATION, UGC_AD_DURATION } from '$lib/server/video';
import { isReviewableMediaUrl, isVideoUrl } from '$lib/content-formats';
import { inferCreativeKind, type CreativeKind } from '$lib/server/creative-script';
import type { ReviewCheckpoint } from '$lib/server/video-review-checkpoint';
import { gradeWithCoverage, type CoverageTier } from '$lib/server/coverage';
import { HOOK_TACTIC_IDS, hookTaxonomyBrief } from '$lib/server/hook-tactics';

/** Binary cap before base64 — Gemini inline parts blow up ~4/3. */
const MAX_INLINE_BYTES = 8 * 1024 * 1024;
// Founder clips off a phone routinely land at 40–60MB, and the old 40MB cap silently rejected them:
// the review then fell through to the stills path, which cannot read a video URL, and reported
// `media_extract_failed` — a misleading error for a file it never opened. The cap exists for
// function memory, and ffmpeg shrinks the clip immediately after, so it can be far higher.
const MAX_FETCH_BYTES = 128 * 1024 * 1024;
const MAX_REVIEW_SECONDS = 30;

/**
 * L'INTERRUTTORE DEL GIUDICE AUTOMATICO. Uno solo, e si riaccende con una variabile d'ambiente.
 *
 * Cosa spegne: ogni review che parte DA SOLA — il worker in coda (il cron ogni 5 minuti su
 * `/api/v1/videos/review/work`, rimosso da vercel.json) e i giudizi in linea dentro le pipeline di
 * generazione, quelli che fanno rifare una clip finché il voto non sale.
 *
 * Cosa NON spegne, deliberatamente: quello che una persona chiede a mano —
 * `POST /api/v1/brands/:slug/videos/review` (e il comando CLI), la pagina di review nel browser,
 * il tasto QC del workbench motion, il "richiedi review" in Impostazioni › Media reviewer, e le
 * tool di chat che un utente invoca parlando. Sono uno strumento, non un automatismo.
 *
 * Perché è spento: la rubrica è quella dei VIDEO applicata anche alle immagini. `ORGANIC_DIMENSIONS`
 * è una lista sola, quindi su una grafica ferma vengono comunque giudicate `sound_off`, `hold`,
 * `spoken_craft` e `loop_worthiness` — dimensioni che su un'immagine non vogliono dire niente e
 * deprimono l'`overall` per costruzione. Il risultato misurato su 511 review statiche pronte:
 * 160 `kill` e 284 `fix` contro 67 `ship`, cioè l'87% del nostro stesso lavoro bocciato da un
 * metro che non era fatto per misurarlo. E `anatomy` — l'asse anti-artefatto, dichiarato
 * obbligatorio — risulta compilato in UNA review statica su 511.
 *
 * Quindi: interruttore, non demolizione. Vogliamo un giudice buono più avanti (la rubrica va
 * riscritta per il fermo prima di riaccendere) e nessuna riga di `video_reviews`,
 * `motion_craft_scores` o `posts.qc` viene cancellata: sono l'unica serie storica di qualità che
 * abbiamo, e servono proprio a dire se il prossimo giudice è migliore.
 *
 * NON riguarda `market_video_analyses`: l'analisi del campo (`market-video-analysis.ts`) chiama il
 * giudice per conto suo su contenuti di mercato e scrive in una tabella diversa. Resta accesa.
 */
export const AUTO_VIDEO_REVIEW_ENABLED = env.AUTO_VIDEO_REVIEW === 'on';

export const VIDEO_STANDARDS = ['organic', 'ads'] as const;
export type VideoStandard = (typeof VIDEO_STANDARDS)[number];

export type VideoReviewVerdict = 'ship' | 'fix' | 'kill';
export type IssueSeverity = 'critical' | 'major' | 'nit';

export type VideoReviewDimensionId =
  | 'scroll_stop'
  | 'sound_off'
  | 'hold'
  | 'authenticity'
  | 'anatomy'
  | 'structure'
  | 'spoken_craft'
  | 'cta_soft'
  | 'loop_worthiness'
  | 'audience_signal'
  | 'proof'
  | 'offer'
  | 'uniqueness'
  | 'claims_safe';

// `anatomy` sta in ENTRAMBI gli standard: un braccio in più o una prospettiva impossibile è il
// difetto che smaschera un clip AI in mezzo secondo, e nessuna delle altre dimensioni lo contava —
// authenticity giudica il REGISTRO (spot vs candid), non se il corpo è fisicamente possibile.
// Su footage umano vero la dimensione costa niente (9–10 automatico).
export const ORGANIC_DIMENSIONS: VideoReviewDimensionId[] = [
  'scroll_stop',
  'sound_off',
  'hold',
  'authenticity',
  'anatomy',
  'structure',
  'spoken_craft',
  'cta_soft',
  'loop_worthiness'
];

export const ADS_DIMENSIONS: VideoReviewDimensionId[] = [
  'scroll_stop',
  'sound_off',
  'hold',
  'authenticity',
  'anatomy',
  'structure',
  'spoken_craft',
  'audience_signal',
  'proof',
  'offer',
  'uniqueness',
  'claims_safe'
];

export type VideoReviewIssue = {
  dimension: VideoReviewDimensionId | string;
  severity: IssueSeverity;
  at_s: number | null;
  problem: string;
  fix: string;
};

export type VideoReviewHook = {
  at_s: number;
  type: string;
  line: string;
  visual: string;
  callout: boolean;
  open_loop: boolean;
  promise_match: boolean;
  unique: boolean;
};

export type VideoReview = {
  standard: VideoStandard;
  verdict: VideoReviewVerdict;
  overall: number;
  duration_s: number;
  doomscroll: {
    stops: boolean;
    who: string;
    reason: string;
  };
  hook: VideoReviewHook;
  reveal_at_s: number | null;
  cta_at_s: number | null;
  dead_seconds: number[];
  scores: Partial<Record<VideoReviewDimensionId, number>>;
  weakest_link: VideoReviewDimensionId | string;
  issues: VideoReviewIssue[];
  next_test: string;
  summary: string;
  /** What was said vs what was written on screen — persisted for later calibration. */
  script: {
    spoken: string;
    on_screen: string;
    caption: string;
  };
  /** Short diagnosis stored as its own column (`judgment`) for retrieval. */
  judgment: string;
  /** Tools the agentic judge actually called (web, ad library, brand winners…). */
  research?: {
    tools: string[];
    notes: string[];
  };
  /**
   * How much of the clip the judge actually scored, next to the verdict it produced. A `ship` is
   * only ever issued at full coverage — see `verdictFromScores`.
   *
   * OPTIONAL because reviews persisted before coverage gating existed do not carry it, and a reader
   * of an old row must not be told a field is there when it is not. Every review produced from now
   * on has it; absence means "recorded before we measured this", which is itself an unknown.
   */
  evidence?: VideoReviewEvidence;
};

export type ReviewVideoOpts = {
  standard: VideoStandard;
  brandName?: string | null;
  product?: string | null;
  caption?: string | null;
  language?: string | null;
  /** Spoken script if known — judged against what is actually said. */
  script?: string | null;
  /** Extra stills (carousel slides) reviewed with the cover. */
  slideUrls?: string[] | null;
  /** Intended on-screen copy from the graphic spec / overlays. */
  intendedOnScreen?: string | null;
  kind?: 'video' | 'image' | 'carousel' | 'graphic';
  abortSignal?: AbortSignal;
  checkpoint?: ReviewCheckpoint | null;
  onCheckpoint?: (cp: ReviewCheckpoint) => Promise<void> | void;
};

export type ReviewVideoResult =
  | { ok: true; review: VideoReview }
  | { ok: false; error: string; aborted?: boolean; checkpoint?: ReviewCheckpoint | null };

const REVIEW_SCHEMA = {
  type: 'object' as const,
  properties: {
    doomscroll_stops: {
      type: 'boolean' as const,
      description: 'Would a stranger’s thumb stop in a late-night Reels/TikTok/Stories feed?'
    },
    doomscroll_who: {
      type: 'string' as const,
      description: 'Who specifically would stop — a named person/problem, or “everyone” (too broad).'
    },
    doomscroll_reason: {
      type: 'string' as const,
      description: 'One sentence: why the thumb stops or keeps moving.'
    },
    hook_at_s: { type: 'number' as const, description: 'When the hook substance lands, in seconds.' },
    hook_type: {
      type: 'string' as const,
      // Eighteen named tactics, not seven loose strings. Seven buckets make a brand look "covered"
      // after a month; eighteen labelled cells are what make a coverage map possible at all —
      // see `hook-tactics.ts`. The disambiguation goes in the system prompt, where the model can
      // act on it; repeating it here would blow the schema description budget for nothing.
      description: `One of: ${HOOK_TACTIC_IDS.join(' | ')} | other. See the HOOK TACTICS block in the system prompt for what each one is and what it is NOT.`
    },
    hook_line: { type: 'string' as const, description: 'First spoken or on-screen line, quoted.' },
    hook_visual: { type: 'string' as const, description: 'What the first 500ms–3s SHOW (motion, face, product, text).' },
    hook_callout: {
      type: 'boolean' as const,
      description: 'True if the opening names a specific person or problem (someone flinches).'
    },
    hook_open_loop: {
      type: 'boolean' as const,
      description: 'True if there is a reason to keep watching (stake, contradiction, specific payoff).'
    },
    hook_promise_match: {
      type: 'boolean' as const,
      description: 'True if the opening promise matches what the rest of the clip actually delivers.'
    },
    hook_unique: {
      type: 'boolean' as const,
      description: 'True if a competitor could NOT run this hook word-for-word.'
    },
    reveal_at_s: {
      type: 'number' as const,
      description: 'Timestamp of the sentence a viewer would repeat to a friend. 0 if never.'
    },
    cta_at_s: { type: 'number' as const, description: 'When the first CTA fires. 0 if none.' },
    dead_seconds: {
      type: 'array' as const,
      items: { type: 'number' as const },
      description: 'Start timestamps of consecutive seconds with no visual/audio/info change.'
    },
    scores: {
      type: 'object' as const,
      properties: {
        scroll_stop: { type: 'integer' as const, description: '1–10 first 3s / 500ms motion / doomscroll stop.' },
        sound_off: { type: 'integer' as const, description: '1–10 first 2s work muted.' },
        hold: { type: 'integer' as const, description: '1–10 no dead seconds, reveal before 60%, hook handoff.' },
        authenticity: { type: 'integer' as const, description: '1–10 native UGC vs polished ad / written slogans.' },
        anatomy: {
          type: 'integer' as const,
          description:
            '1–10 physical plausibility: limb/hand/finger count, face coherence, perspective. ANY extra/missing/deformed limb or impossible perspective at any point = 1–3. Real human footage with none of these = 9–10.'
        },
        structure: { type: 'integer' as const, description: '1–10 narrative arc for this standard.' },
        spoken_craft: { type: 'integer' as const, description: '1–10 said-out-loud pacing vs duration.' },
        cta_soft: { type: 'integer' as const, description: 'Organic: one soft CTA in last 10%. Ads: ignore.' },
        loop_worthiness: { type: 'integer' as const, description: 'Organic: save/share/rewatch. Ads: ignore.' },
        audience_signal: { type: 'integer' as const, description: 'Ads: named segment. Organic: ignore.' },
        proof: { type: 'integer' as const, description: 'Ads: demo/screenshot/count, not adjectives.' },
        offer: { type: 'integer' as const, description: 'Ads: what you get + what to do next.' },
        uniqueness: { type: 'integer' as const, description: 'Ads: competitor could not copy this hook.' },
        claims_safe: { type: 'integer' as const, description: 'Ads: no overpromise / undeliverable guarantee.' }
      },
      required: ['scroll_stop', 'sound_off', 'hold', 'authenticity', 'anatomy', 'structure', 'spoken_craft']
    },
    issues: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          dimension: { type: 'string' as const },
          severity: { type: 'string' as const, enum: ['critical', 'major', 'nit'] as const },
          at_s: { type: 'number' as const },
          problem: { type: 'string' as const },
          fix: { type: 'string' as const }
        },
        required: ['dimension', 'severity', 'problem', 'fix']
      }
    },
    weakest_link: { type: 'string' as const, description: 'Dimension id to fix first.' },
    next_test: {
      type: 'string' as const,
      description:
        'One-variable hypothesis: Because [weakness], change [one thing]; judge on [hook rate / hold / CTA].'
    },
    summary: { type: 'string' as const, description: '2–4 sentences. Diagnosis, not a vibe.' },
    script_spoken: {
      type: 'string' as const,
      description: 'Verbatim transcription of spoken words. Empty if silent / still.'
    },
    script_on_screen: {
      type: 'string' as const,
      description: 'All readable on-screen copy (headlines, overlays, slides), one line per block.'
    },
    judgment: { type: 'string' as const, description: 'One-paragraph verdict comment stored for later retrieval.' }
  },
  required: [
    'doomscroll_stops',
    'doomscroll_reason',
    'hook_callout',
    'hook_open_loop',
    'scores',
    'issues',
    'weakest_link',
    'next_test',
    'summary',
    'script_spoken',
    'script_on_screen'
  ]
};

export function parseVideoStandard(raw: unknown): VideoStandard | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'organic' || s === 'ugc' || s === 'reel' || s === 'organic_ugc') return 'organic';
  if (s === 'ads' || s === 'ad' || s === 'ugc_ad' || s === 'paid' || s === 'paid_ads') return 'ads';
  return null;
}

/** Paid UGC ads lock 22s. Anything at that length (or flagged) is scored as ads. */
export function inferVideoStandard(opts: {
  ugcAd?: boolean | null;
  durationSeconds?: number | null;
}): VideoStandard {
  if (opts.ugcAd) return 'ads';
  const d = Number(opts.durationSeconds);
  if (Number.isFinite(d) && d >= UGC_AD_DURATION - 1) return 'ads';
  return 'organic';
}

/** Resolve a public mp4 URL from a direct link and/or a brand post. */
export function visualUrlsFromPost(post: {
  media_url?: string | null;
  media_urls?: unknown;
}): string[] {
  const extra = Array.isArray(post.media_urls) ? post.media_urls.map(String) : [];
  const all = [typeof post.media_url === 'string' ? post.media_url : '', ...extra];
  const out: string[] = [];
  for (const raw of all) {
    const u = raw.trim();
    if (!u || !isReviewableMediaUrl(u) || out.includes(u)) continue;
    out.push(u);
  }
  return out;
}

export async function resolveReviewVideoUrl(
  supabase: SupabaseClient,
  brandId: string,
  input: { url?: string | null; postId?: string | null }
): Promise<
  | {
      url: string;
      caption: string;
      product: string;
      slideUrls: string[];
      contentType: string | null;
    }
  | { error: string }
> {
  let url = input.url?.trim() ?? '';
  let caption = '';
  let product = '';
  let contentType: string | null = null;
  let slideUrls: string[] = [];
  if (input.postId?.trim()) {
    const { data: post } = await supabase
      .from('posts')
      .select('media_url, media_urls, caption, product_name, content_type')
      .eq('id', input.postId.trim())
      .eq('brand_id', brandId)
      .maybeSingle();
    if (!post) return { error: 'post_not_found' };
    const urls = visualUrlsFromPost(post);
    if (!url) url = urls[0] ?? '';
    slideUrls = urls.filter((u) => u !== url);
    caption = String(post.caption ?? '');
    product = String(post.product_name ?? '');
    contentType = post.content_type ? String(post.content_type) : null;
  }
  if (!url) return { error: 'missing_url' };
  if (!/^https?:\/\//i.test(url)) return { error: 'invalid_url' };
  return { url, caption, product, slideUrls, contentType };
}

export function extraReviewOpts(resolved: {
  url: string;
  slideUrls: string[];
  contentType: string | null;
}): { slideUrls: string[]; kind: CreativeKind } {
  return {
    slideUrls: resolved.slideUrls,
    kind: inferCreativeKind({
      contentType: resolved.contentType,
      mediaUrl: resolved.url,
      mediaUrls: [resolved.url, ...resolved.slideUrls]
    })
  };
}

export function dimensionsFor(standard: VideoStandard): VideoReviewDimensionId[] {
  return standard === 'ads' ? ADS_DIMENSIONS : ORGANIC_DIMENSIONS;
}

export function clampScore(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 1;
  return Math.min(10, Math.max(1, v));
}

function numOrNull(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}

function pickScores(
  raw: Record<string, unknown> | undefined,
  standard: VideoStandard
): Partial<Record<VideoReviewDimensionId, number>> {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out: Partial<Record<VideoReviewDimensionId, number>> = {};
  for (const id of dimensionsFor(standard)) {
    if (src[id] == null) continue;
    out[id] = clampScore(src[id]);
  }
  return out;
}

/**
 * Weighted overall + verdict. The model proposes scores; we own the ship/fix/kill call so a
 * 3/10 hook cannot be labelled “ship”.
 *
 * scroll_stop is the gate (Meta 3s play / thumb-stop). Ads also require a readable offer.
 * Organic also requires the clip not to feel like an ad (authenticity).
 *
 * COVERAGE-GATED (see `coverage.ts`). A dimension the judge did not score used to vanish silently:
 * the weighted mean was taken over whatever came back, so a review that scored 2 of 7 dimensions
 * produced a confident verdict on 2 dimensions. Worse, the two fallbacks pointed in OPPOSITE
 * directions in the same function — `scroll_stop ?? 1` turned a missing score into an instant kill,
 * `offer ?? 10` turned one into a free pass. Now an unscored dimension is an `unknown`: it costs
 * coverage, never score, and under the floor the verdict cannot be `ship`.
 *
 * WHY THE FLOOR LANDS ON `fix`, NOT ON A NULL VERDICT. `ship` on thin evidence publishes a guess;
 * `kill` on thin evidence destroys work over one. `fix` is the only call that stays honest when the
 * judge did not look at enough of the clip — and `evidence.tier` says exactly why.
 */
export type VideoReviewEvidence = {
  /** Share of dimension weight the judge actually scored, 0-100. */
  coverage: number;
  tier: CoverageTier;
  /** Dimensions the judge returned no score for. Named, never summarised away. */
  unknownDimensions: VideoReviewDimensionId[];
  /** One line ready to print next to the verdict. */
  label: string;
};

export function verdictFromScores(
  scores: Partial<Record<VideoReviewDimensionId, number>>,
  standard: VideoStandard,
  issues: VideoReviewIssue[]
): { overall: number; verdict: VideoReviewVerdict; evidence: VideoReviewEvidence } {
  const ids = dimensionsFor(standard);
  const weight = (id: VideoReviewDimensionId): number => {
    if (id === 'scroll_stop') return 2;
    if (id === 'hold') return 1.5;
    if (id === 'offer' && standard === 'ads') return 1.5;
    if (id === 'authenticity' && standard === 'organic') return 1.4;
    return 1;
  };

  const graded = gradeWithCoverage(
    ids.map((id) => {
      const s = scores[id];
      return {
        key: id,
        label: id,
        weight: weight(id),
        // Scores are 1..10; the coverage grader works in 0..1, so a 10 is a full pass.
        ...(s == null ? { verdict: 'unknown' as const } : { verdict: 'pass' as const, value: s / 10 })
      };
    })
  );

  // `overall` stays on the review's own 1..10 scale — it is stored, charted and compared against
  // historical rows, so it must not silently become a 0..100.
  const overall = graded.score === null ? 1 : Math.round(graded.score) / 10;
  const unknownDimensions = graded.unknown as VideoReviewDimensionId[];
  const evidence: VideoReviewEvidence = {
    coverage: graded.coverage,
    tier: graded.tier,
    unknownDimensions,
    label:
      graded.tier === 'full'
        ? `Giudicato su ${graded.coverage}% delle dimensioni.`
        : `Evidenza parziale: ${graded.coverage}% delle dimensioni giudicate. Non giudicate: ${unknownDimensions.join(', ') || 'n/d'}.`
  };

  const stop = scores.scroll_stop;
  const hasCritical = issues.some((i) => i.severity === 'critical');

  // A kill on a GATE dimension survives thin coverage: the judge did look at the hook, and a 2/10
  // hook is the strongest evidence in the review — the rest of the clip cannot rescue it. What must
  // not survive thin coverage is a kill on `overall`, which is an average over whatever came back.
  if (stop != null && stop < 4) return { overall, verdict: 'kill', evidence };
  // Anatomia rotta = gate come il hook: un arto in più visto dal giudice non è migliorabile con
  // note di copy, la clip va rifatta. Il kill entra nel canale remake esistente
  // (reviewNeedsRewrite → formatReviewApplyBrief), quindi il re-render è già cablato e già
  // limitato da VIDEO_QC_REMAKE_MAX.
  if (scores.anatomy != null && scores.anatomy < 4) return { overall, verdict: 'kill', evidence };
  if (standard === 'ads' && scores.offer != null && scores.offer < 4) return { overall, verdict: 'kill', evidence };
  if (graded.tier !== 'ungraded' && overall < 4) return { overall, verdict: 'kill', evidence };

  // Not enough of the clip was judged to publish it. `fix` is the only honest call left.
  if (graded.tier === 'ungraded') return { overall, verdict: 'fix', evidence };

  // A ship must rest on scores that exist AND on complete-enough evidence. Both gates are explicit
  // comparisons against `null` so that "not scored" can never satisfy a bar.
  const gateScore = standard === 'ads' ? scores.offer : scores.authenticity;
  const shipBar =
    graded.tier === 'full' &&
    overall >= 7 &&
    stop != null &&
    stop >= 7 &&
    !hasCritical &&
    gateScore != null &&
    gateScore >= 6 &&
    // Un 4–5 di anatomia (mani dubbie, prospettiva che scricchiola) non uccide ma non spedisce:
    // la media pesata potrebbe assorbirlo, e l'assorbimento è esattamente il bug.
    (scores.anatomy == null || scores.anatomy >= 6);
  return { overall, verdict: shipBar ? 'ship' : 'fix', evidence };
}

export function finalizeVideoReview(
  raw: Record<string, unknown>,
  opts: { standard: VideoStandard; duration_s: number }
): VideoReview {
  const scoresRaw =
    raw.scores && typeof raw.scores === 'object' ? (raw.scores as Record<string, unknown>) : {};
  const scores = pickScores(scoresRaw, opts.standard);
  const issuesRaw = Array.isArray(raw.issues) ? raw.issues : [];
  const issues: VideoReviewIssue[] = issuesRaw
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const r = row as Record<string, unknown>;
      const problem = String(r.problem ?? '').trim();
      const fix = String(r.fix ?? '').trim();
      if (!problem) return null;
      const sev = String(r.severity ?? 'major');
      return {
        dimension: String(r.dimension ?? 'scroll_stop'),
        severity: sev === 'critical' || sev === 'nit' ? sev : 'major',
        at_s: numOrNull(r.at_s),
        problem,
        fix: fix || problem
      } satisfies VideoReviewIssue;
    })
    .filter((x): x is VideoReviewIssue => !!x)
    .slice(0, 8);

  const { overall, verdict, evidence } = verdictFromScores(scores, opts.standard, issues);
  const dead = Array.isArray(raw.dead_seconds)
    ? raw.dead_seconds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0)
    : [];

  // Weakest link among the dimensions that were ACTUALLY scored. The old fallback handed an
  // unscored dimension a 10, which meant the one thing nobody looked at could never be named as the
  // thing to fix first — precisely backwards.
  const weakest =
    String(raw.weakest_link ?? '').trim() ||
    [...dimensionsFor(opts.standard)]
      .filter((id) => scores[id] != null)
      .sort((a, b) => (scores[a] as number) - (scores[b] as number))[0] ||
    'scroll_stop';

  return {
    standard: opts.standard,
    verdict,
    overall,
    evidence,
    duration_s: opts.duration_s,
    doomscroll: {
      stops: asBool(raw.doomscroll_stops),
      who: String(raw.doomscroll_who ?? '').trim() || (asBool(raw.doomscroll_stops) ? 'unclear' : 'nobody'),
      reason: String(raw.doomscroll_reason ?? '').trim()
    },
    hook: {
      at_s: Number(raw.hook_at_s) || 0,
      type: String(raw.hook_type ?? '').trim() || 'other',
      line: String(raw.hook_line ?? '').trim(),
      visual: String(raw.hook_visual ?? '').trim(),
      callout: asBool(raw.hook_callout),
      open_loop: asBool(raw.hook_open_loop),
      promise_match: asBool(raw.hook_promise_match),
      unique: asBool(raw.hook_unique)
    },
    reveal_at_s: numOrNull(raw.reveal_at_s),
    cta_at_s: numOrNull(raw.cta_at_s),
    dead_seconds: dead.slice(0, 12),
    scores,
    weakest_link: weakest,
    issues,
    next_test: String(raw.next_test ?? '').trim(),
    summary: String(raw.summary ?? '').trim(),
    script: {
      spoken: String(raw.script_spoken ?? raw.spoken ?? '').trim(),
      on_screen: String(raw.script_on_screen ?? raw.on_screen ?? '').trim(),
      caption: String(raw.caption ?? '').trim()
    },
    judgment: String(raw.judgment ?? raw.summary ?? '').trim()
  };
}

function ffRun(bin: string, args: string[]): void {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr ?? '').slice(-300)}`);
}

function probeDuration(bin: string, file: string): number {
  const r = spawnSync(bin, ['-hide_banner', '-i', file], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const m = (r.stderr ?? '').match(/Duration: (\d+):(\d+):([0-9.]+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
}

function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

async function prepareStillFrames(urls: string[]): Promise<ReviewMedia | null> {
  const frames: ReviewMedia['frames'] = [];
  for (const raw of urls) {
    const url = raw.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const buf = await fetchVideoBytes(url);
    if (!buf) continue;
    const mime = sniffImageMime(buf);
    if (!mime) continue;
    frames.push({
      mimeType: mime,
      data: buf.toString('base64'),
      label: frames.length === 0 ? 'COVER still (thumb-stop / mute test)' : `SLIDE ${frames.length + 1}`
    });
    if (frames.length >= 8) break;
  }
  if (!frames.length) return null;
  return { duration: 0, frames };
}

function attachIntendedScript(review: VideoReview, opts: ReviewVideoOpts): VideoReview {
  if (!review.script.spoken && opts.script?.trim()) review.script.spoken = opts.script.trim();
  if (!review.script.on_screen && opts.intendedOnScreen?.trim()) {
    review.script.on_screen = opts.intendedOnScreen.trim();
  }
  if (!review.script.caption && opts.caption?.trim()) review.script.caption = opts.caption.trim();
  if (!review.judgment) review.judgment = review.summary;
  return review;
}

export type VideoFetchResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: 'blocked' | 'not_found' | 'too_large' | 'network'; detail: string };

/**
 * Why the distinction matters: reporting "extract failed" for a clip we were never allowed to
 * download sends everyone chasing the decoder. A bot-protected host (media CDNs commonly fingerprint
 * the TLS handshake, so no header changes it) can be fetched by the user's browser and never by us —
 * the only answer is "upload the file", and the message has to say so.
 */
/** A message the agent can repeat to the user verbatim — each reason has a different way out. */
export function videoFetchError(f: Extract<VideoFetchResult, { ok: false }>): string {
  switch (f.reason) {
    case 'blocked':
      return `media_host_blocked: the host refused the download (${f.detail}). It works in a browser but not from a server — the clip has to be uploaded, not linked.`;
    case 'not_found':
      return `media_not_found: the URL did not return a file (${f.detail}).`;
    case 'too_large':
      return `media_too_large: ${f.detail}.`;
    default:
      return `media_unreachable: ${f.detail}.`;
  }
}

export async function fetchVideoBytesDetailed(url: string): Promise<VideoFetchResult> {
  let res: Response;
  try {
    // Clips are capped at MAX_FETCH_BYTES, so a download that takes longer than this is a stalled
    // connection, not a big file — and it used to be able to hold a whole turn open on its own.
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn('[video-review] clip fetch error:', detail);
    return { ok: false, reason: 'network', detail };
  }
  if (!res.ok) {
    console.warn(`[video-review] clip fetch failed ${res.status}: ${url}`);
    return {
      ok: false,
      reason: res.status === 403 || res.status === 401 ? 'blocked' : 'not_found',
      detail: `HTTP ${res.status}`
    };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_FETCH_BYTES) {
    const detail = `${(bytes.length / 1e6).toFixed(1)}MB > ${MAX_FETCH_BYTES / 1e6}MB`;
    console.warn(`[video-review] clip too large to review: ${detail}`);
    return { ok: false, reason: 'too_large', detail };
  }
  return { ok: true, bytes };
}

export async function fetchVideoBytes(url: string): Promise<Buffer | null> {
  const r = await fetchVideoBytesDetailed(url);
  return r.ok ? r.bytes : null;
}

export type VideoReviewMedia = {
  duration: number;
  videoMp4?: Buffer;
  frames: Array<{ mimeType: string; data: string; label: string }>;
  audioMp3?: Buffer;
};

type ReviewMedia = VideoReviewMedia;

function extractJpeg(bin: string, src: string, stamp: number, out: string): boolean {
  try {
    ffRun(bin, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      Math.max(0, stamp).toFixed(2),
      '-i',
      src,
      '-frames:v',
      '1',
      '-q:v',
      '4',
      out
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prefer a compact mp4 Gemini can watch (fps metadata 4) plus hook stills for the
 * sound-off / 500ms test. Fall back to dense stills + mono audio when the clip won't inline.
 */
/**
 * Gemini inlines the clip into the request, so an un-shrunk MP4 is only worth sending when it is
 * small enough to survive that. Above this, no ffmpeg means no review.
 */
const MAX_RAW_INLINE_MP4 = 18 * 1024 * 1024;

/**
 * Clip length straight from the MP4 `mvhd` atom, for the path where ffmpeg is unavailable. The
 * prompt quotes the duration and derives the reveal deadline from it, so a 0 here would read as a
 * zero-length clip and the review would be nonsense.
 */
export function mp4DurationSeconds(buf: Buffer): number {
  const i = buf.indexOf('mvhd');
  if (i < 0) return 0;
  try {
    const version = buf.readUInt8(i + 4);
    // after 'mvhd': version(1) flags(3), then created/modified, timescale, duration
    const p = i + 8 + (version === 1 ? 16 : 8);
    const timescale = buf.readUInt32BE(p);
    const units = version === 1 ? Number(buf.readBigUInt64BE(p + 4)) : buf.readUInt32BE(p + 4);
    if (!timescale || !Number.isFinite(units)) return 0;
    return units / timescale;
  } catch {
    return 0;
  }
}

export async function prepareReviewMedia(mp4: Buffer): Promise<ReviewMedia | null> {
  const ffmpegPath = await ensureFfmpegPath();
  // The reviewer already hands the model the MP4 itself — the stills are an addition, not the only
  // channel. Losing ffmpeg should cost the labelled timestamps, not the whole review.
  if (!ffmpegPath) {
    if (mp4.byteLength > MAX_RAW_INLINE_MP4) return null;
    const duration = mp4DurationSeconds(mp4);
    if (!duration) return null;
    console.warn('[video-review] no ffmpeg — reviewing the raw clip without extracted stills');
    // Report the REAL length here: the ffmpeg path clamps because it also trims the clip to that
    // length, and this path sends the whole thing. Clamping without trimming would tell the model
    // a 60s clip is 30s and make every timestamp it reasons about wrong.
    return { duration, videoMp4: mp4, frames: [] };
  }
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), 'vid-rev-'));
    const src = join(dir, 'in.mp4');
    writeFileSync(src, mp4);
    const duration = Math.min(MAX_REVIEW_SECONDS, probeDuration(ffmpegPath, src) || 15);

    const hookStamps = [0.12, 0.45, 1.0, 1.8, 3.0]
      .map((t) => Math.min(t, Math.max(0.05, duration - 0.05)))
      .filter((t, i, a) => i === 0 || t - a[i - 1] > 0.15);
    const bodyStamps = [
      Math.max(0.5, duration * 0.45),
      Math.max(0.8, duration * 0.6),
      Math.max(1, duration - 0.35)
    ].filter((t) => t > 3.1 && t < duration);

    const frames: ReviewMedia['frames'] = [];
    const push = (stamp: number, label: string) => {
      const out = join(dir!, `f${frames.length}.jpg`);
      if (!extractJpeg(ffmpegPath, src, stamp, out)) return;
      frames.push({ mimeType: 'image/jpeg', data: readFileSync(out).toString('base64'), label });
    };
    hookStamps.forEach((t, i) => push(t, `HOOK still ${i + 1} @ ${t.toFixed(2)}s (sound-off / thumb-stop)`));
    bodyStamps.forEach((t) =>
      push(t, t >= duration * 0.55 && t <= duration * 0.65 ? `REVEAL-DEADLINE still @ ${t.toFixed(2)}s` : `BODY still @ ${t.toFixed(2)}s`)
    );

    const compact = join(dir, 'rev.mp4');
    let videoMp4: Buffer | undefined;
    try {
      ffRun(ffmpegPath, [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        src,
        '-t',
        duration.toFixed(2),
        '-vf',
        'scale=-2:min(480\\,ih)',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '32',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '64k',
        '-movflags',
        '+faststart',
        compact
      ]);
      const buf = readFileSync(compact);
      if (buf.length > 0 && buf.length <= MAX_INLINE_BYTES) videoMp4 = buf;
    } catch {
      videoMp4 = undefined;
    }

    let audioMp3: Buffer | undefined;
    if (!videoMp4) {
      const mp3 = join(dir, 'a.mp3');
      try {
        ffRun(ffmpegPath, [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          src,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          '64k',
          '-t',
          duration.toFixed(2),
          mp3
        ]);
        audioMp3 = readFileSync(mp3);
      } catch {
        audioMp3 = undefined;
      }
    }

    if (!frames.length && !videoMp4) return null;
    return { duration, videoMp4, frames, audioMp3 };
  } catch {
    return null;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** Shared organic / ads rubric — used by the one-shot judge and the agentic loop. */
export function videoReviewStandardRubric(standard: VideoStandard): string {
  if (standard === 'organic') {
    return `ORGANIC UGC STANDARD (Reels / TikTok / Shorts — this is NOT an ad):
You are asking: would this stop a doomscroll, or is it content the thumb skips?

1. SCROLL-STOP / HOOK (gate) — Meta/TikTok 3-second window; the brain orients in ~500ms.
   - First FRAME must have motion or a high-contrast change at thumbnail size. Static talking-head fade-in = fail.
   - Hook promise lands in ≤3s (TikTok) / ≤4s (Reels). "okay so today…" / logo / shirt-adjust = fail.
   - Specific claim or audience callout. "I cut X by Y doing Z" beats a category intro.
   - Open a loop (stake, contradiction, specific payoff). A fact they already know is skipped.
2. SOUND-OFF — cover the speaker: first 2 seconds must work MUTED (visual curiosity or relevance). Most feed views start muted.
3. HOLD — no dead seconds (consecutive seconds with no visual/audio/info change; a pause before a reveal is OK). Reveal (the sentence you'd repeat to a friend) lands BEFORE 60% of duration. Hook-to-body handoff: if you'd happily scroll at second 4, the open overpromised.
4. AUTHENTICITY — phone-native UGC: handheld, real skin, spoken not written. Kill slogans, "introducing", ad-copy cadence, beauty-filter freeze, burned-in captions/subtitles (we burn those separately). Product-first in the opening line = fail.
5. STRUCTURE — Hook → Problem → Demo → Proof; ONE soft CTA in the FINAL 10% ("save this for…", "anyway try it") — never a mid-video hard sell, never two CTAs. Organic ≤${UGC_ORGANIC_MAX_DURATION}s (~40–48 spoken words).
6. SPOKEN CRAFT — sounds SAID. ~3.3 words/sec. Sparse telegram fragments fail. Rants that overrun the clip fail.
7. LOOP — would someone save, share, or rewatch? Entertaining-but-empty fails this, not scroll-stop.
${videoReviewAnatomyRubric(8)}

Organic CTAs that feel like ads appended to content FAIL cta_soft even if the hook is strong.`;
  }
  return `PAID ADS STANDARD (Meta Feed / Reels / Stories — performance creative, not brand film):
You are asking: would this earn spend? A hook that stops the WRONG people teaches the algorithm to find more of the wrong people.

1. THUMB-STOP / HOOK (gate) — Meta 3-second video play. First 500ms need motion that reads at thumbnail size. No logo intro, no slow pan, no "introducing".
   Four checks (a hook can miss a perfect score; it cannot fail 1 or 4):
   (1) Call out the PERSON or PROBLEM in the first line — who flinches? If nobody, it's a headline.
   (2) Reason to keep watching — open a loop.
   (3) Promise matches the offer — overpromise buys cheap attention and expensive disappointment.
   (4) A competitor could NOT run this hook word-for-word (category hooks cost what everyone pays).
   Judge WHO it stops, not just how many. Broad openings that stop everyone FAIL uniqueness / audience_signal.
2. SOUND-OFF — Facebook/Instagram autoplay muted. Story must read with on-screen visual + text; audio adds value, it is not required to understand the ad.
3. HOLD — no logo intro after a strong open. Handoff from hook to body in the next 3s. Dead seconds kill hold rate.
4. AUTHENTICITY — native UGC signals beat polished production in most DTC feeds (users filter what they recognise as an ad). Phone-native > studio.
5. STRUCTURE — concept/angle before polish. PAS or demo. One job, one CTA. Performance ads with a vague CTA are broken (brand films may score lower on offer — this is a PERFORMANCE review).
6. SPOKEN CRAFT — UGC ads may run to ${UGC_AD_DURATION}s (~55–66 words) for Demo+Proof. Still spoken, not written.
7. AUDIENCE SIGNAL — can you tell who this is for in one viewing? Language/setting/pain that names a segment.
8. PROOF — skeptic-grade: demo, before/after, screenshot, count. Adjectives-only ("amazing", "best") = 0.
9. OFFER — What do I get? What do I do next? If a stranger can't answer both after one viewing, offer is 0–1.
10. UNIQUENESS — mechanism, result, or POV only this brand can say.
11. CLAIMS — no guarantee / rate / outcome the offer cannot back. Specificity and POV, not indefensible promises.

${videoReviewAnatomyRubric(12)}

Safe-zone nit: critical text must not live in the top ~12% or bottom ~25% of 9:16 (UI chrome). Flag as nit unless it hides the hook.`;
}

/**
 * La voce ANATOMY del rubric, condivisa fra organic e ads (e fra giudice one-shot e agentico, che
 * leggono entrambi `videoReviewStandardRubric`). È il gate che ferma il difetto più smascherante
 * dei clip generati: l'arto in più, la mano fusa, la prospettiva impossibile.
 */
function videoReviewAnatomyRubric(n: number): string {
  return `${n}. ANATOMY / PHYSICAL PLAUSIBILITY (gate) — the AI tells that destroy trust in half a second. COUNT, do not vibe-check: in every still and while watching, count arms (exactly 2 per person), hands (exactly 2, each attached to an arm), fingers (5 per visible hand), faces (coherent, no morphing between shots). Hands must keep their shape while gripping or gesturing. Perspective must be one plausible camera: room lines keep a single vanishing scheme, objects scale with distance, reflections match the room, furniture does not bend around the subject. ONE extra/missing/deformed limb, a hand floating without an arm, or an impossible perspective at ANY point = score 1–3 AND a critical issue with its timestamp. Doubtful hands or slightly-off perspective = 4–5. Real human footage with none of these = 9–10.`;
}

function buildPrompt(opts: ReviewVideoOpts, duration: number, hasVideo: boolean): string {
  const standard = opts.standard;
  const cap = standard === 'ads' ? UGC_AD_DURATION : UGC_ORGANIC_MAX_DURATION;
  const lang = opts.language?.trim() || 'Italian';
  const brand = opts.brandName?.trim() || '(unknown brand)';
  const product = opts.product?.trim() || '(unspecified)';
  const caption = opts.caption?.trim() ? `CAPTION / PRIMARY TEXT:\n${opts.caption.trim().slice(0, 800)}` : 'CAPTION: (none)';
  const script = opts.script?.trim()
    ? `INTENDED SPOKEN SCRIPT (compare to what you actually hear):\n${opts.script.trim().slice(0, 1200)}`
    : 'INTENDED SCRIPT: (unknown — transcribe from audio)';

  const watch = hasVideo
    ? `MEDIA: you have (1) stills from the FIRST 3 SECONDS labelled HOOK — use them for the sound-off / 500ms / first-frame test; (2) the actual video — watch it in order for pacing, dead seconds, reveal, CTA. Sample the video densely in the opening.`
    : `MEDIA: stills (hook window, mid, 60% mark, ending) plus audio of the spoken take. Infer motion from still-to-still change. Be harsher on scroll_stop when the first still is a static talking head.`;

  return `You are a ruthless short-form creative director reviewing a FINISHED clip. Generation craft cannot save a clip that fails the scroll-stop test. This is a DIAGNOSIS (which dimension to fix next), not a vibe ("looks good").

STANDARD: ${standard === 'ads' ? 'PAID ADS' : 'ORGANIC UGC'}
CLIP LENGTH: ~${duration.toFixed(1)}s (budget ${standard === 'ads' ? `UGC ad ${cap}s` : `organic ≤${cap}s`})
BRAND: ${brand}
PRODUCT / OFFER: ${product}
${caption}
${script}

WATCH PROTOCOL (do this in order, then score):
1. Freeze on the first still. Would this thumbnail stop you at feed speed?
2. First 2 seconds MUTED — visual only.
3. First 3 seconds with sound — Elevarus four checks (callout, loop, promise match, uniqueness).
4. Timestamp the REVEAL (sentence you'd repeat to a friend). Must be before 60% (${(duration * 0.6).toFixed(1)}s).
5. Hunt dead seconds.
6. Count CTAs and when they fire.
7. Freeze on every still and count limbs: arms, hands, fingers; check faces stay the same person and perspective stays one plausible camera (see ANATOMY in the rubric).

${videoReviewStandardRubric(standard)}

${watch}

${hookTaxonomyBrief()}
Label hook_type with exactly one of those ids (or 'other' when genuinely none fits). Pick by what the opening DOES, not by what it is about, and honour the "NON confondere con" line — collapsing eighteen tactics back into question/claim/stat is the failure mode here.

SCORING: integers 1–10 per dimension. 1 = absent/broken, 5 = average, 8 = would ship, 10 = exceptional. Be a harsh reviewer — most clips are 4–6. Do not inflate because the person is pretty or the footage is AI-smooth.
LANGUAGE: write summary, issues, next_test, doomscroll_reason, hook_line/visual in ${lang} (natural, not translated marketing-speak). Keep dimension ids and enums in English.

next_test MUST be one variable: "Because [weakest_link], change [exactly one thing]; judge on [hook rate / hold / CTR]."

Return JSON.`;
}

async function reviewVideoDirect(
  opts: ReviewVideoOpts,
  media: ReviewMedia
): Promise<ReviewVideoResult> {
  if (!llmConfigured()) return { ok: false, error: 'gemini_unconfigured' };
  try {
    // QC video sul centralino (`llmVideoReviewerModel`): kie ignorava `videoMetadata.fps: 4`
    // e il giudice vedeva ~1 fotogramma al secondo. Qui il file va intero, con gli still.
    const frameNote = media.frames.map((f, i) => `${i + 1}. ${f.label}`).join('\n');
    const prompt = [
      buildPrompt(opts, media.duration, !!media.videoMp4),
      frameNote ? `\nSTILLS (in order):\n${frameNote}` : '',
      media.videoMp4 ? '\nFULL CLIP is attached (watch in order — hook stills above are the opening freeze-frames).' : '',
      !media.videoMp4 && media.audioMp3 ? '\nSPOKEN AUDIO of the take is attached.' : ''
    ]
      .filter(Boolean)
      .join('');
    const parsed = await llmStructured<Record<string, unknown>>({
      prompt,
      schema: REVIEW_SCHEMA,
      images: media.frames.map((f) => ({ mediaType: f.mimeType, data: f.data })),
      file: media.videoMp4
        ? { mediaType: 'video/mp4', data: media.videoMp4.toString('base64') }
        : media.audioMp3
          ? { mediaType: 'audio/mp3', data: media.audioMp3.toString('base64') }
          : undefined,
      model: llmVideoReviewerModel(),
      label: 'video.review'
    });
    if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'model_parse_failed' };
    return {
      ok: true,
      review: attachIntendedScript(
        finalizeVideoReview(parsed, { standard: opts.standard, duration_s: media.duration }),
        opts
      )
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[reviewVideo] failed: ${msg}`);
    if (e instanceof Error && e.name === 'CreditsExhaustedError') throw e;
    return { ok: false, error: 'model_failed' };
  }
}

/**
 * Should we download this and hand it to ffmpeg?
 *
 * Extracted so the decision is testable on its own: it is the line that silently disabled the whole
 * market video bank, and a rule that important should not live only inside a 60-line function.
 */
export function shouldFetchAsVideo(url: string, kind?: 'video' | 'image' | 'carousel' | 'graphic'): boolean {
  if (kind === 'image' || kind === 'carousel' || kind === 'graphic') return false;
  return kind === 'video' || isVideoUrl(url);
}

/**
 * Review a public video URL against organic UGC or paid-ads standards.
 * Prefers the agentic loop (web / ad library / brand winners) and falls back to a one-shot judge.
 */
export async function reviewVideo(url: string, opts: ReviewVideoOpts): Promise<ReviewVideoResult> {
  if (!llmConfigured()) return { ok: false, error: 'gemini_unconfigured' };
  const target = url?.trim();
  if (!target || !/^https?:\/\//i.test(target)) return { ok: false, error: 'invalid_url' };

  const gateBrand = getBrandContext();
  if (gateBrand) {
    const { gateCredits } = await import('$lib/server/credits');
    await gateCredits(gateBrand);
  }

  // `isVideoUrl` sniffs a file extension, and a CDN is not obliged to have one. TikTok's are the
  // rule, not the exception: 107 of 200 stored clip urls carry no extension at all, so every one of
  // them skipped the fetch, fell through to the stills path — which cannot read a video url — and
  // came back as `media_extract_failed`, an error about a file that was never opened.
  //
  // `opts.kind` exists precisely so a caller who KNOWS what it is holding can say so, and it was
  // declared and then never read. When the caller asserts a video, that beats guessing from the
  // string. A wrong assertion still degrades safely: ffmpeg rejects the bytes and we fall through
  // to stills exactly as before.
  const treatAsVideo = shouldFetchAsVideo(target, opts.kind);
  const fetched = treatAsVideo ? await fetchVideoBytesDetailed(target) : null;
  const bytes = fetched?.ok ? fetched.bytes : null;
  let media: ReviewMedia | null = null;
  if (bytes && treatAsVideo) {
    media = await prepareReviewMedia(bytes);
  }
  if (!media) {
    const slides = [
      target,
      ...(Array.isArray(opts.slideUrls) ? opts.slideUrls : [])
    ].filter((u, i, a) => u && a.indexOf(u) === i);
    media = await prepareStillFrames(slides);
  }
  if (!media) {
    if (fetched && !fetched.ok) return { ok: false, error: videoFetchError(fetched) };
    return { ok: false, error: 'media_extract_failed' };
  }

  try {
    const { videoReviewAgentEnabled, reviewVideoWithAgent } = await import('$lib/server/video-review-agent');
    if (videoReviewAgentEnabled()) {
      const agented = await reviewVideoWithAgent({
        url: target,
        opts,
        media,
        brandId: gateBrand,
        abortSignal: opts.abortSignal,
        checkpoint: opts.checkpoint,
        onCheckpoint: opts.onCheckpoint
      });
      if (agented.ok) {
        agented.review = attachIntendedScript(agented.review, opts);
        return agented;
      }
      if (agented.aborted) return agented;
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'CreditsExhaustedError') throw e;
    console.warn('[reviewVideo] agent failed, falling back', e instanceof Error ? e.message : e);
  }

  return reviewVideoDirect(opts, media);
}
