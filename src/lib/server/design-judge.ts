/**
 * Grade a harvested post AS DESIGN, and decide whether we are willing to publish it.
 *
 * WHY A SECOND SCORER. `content-quality.ts` scores TEXT with the rubric we grade our own captions
 * with, and `video-review.ts` watches a clip for hook, hold and CTA. Neither has ever looked at a
 * layout. "Which of these posts is beautiful" is a question about type, grid, colour and restraint,
 * and none of it is recoverable from a caption or from a retention curve — so it gets its own
 * column, its own version and its own rubric rather than being folded into `quality_index`, where it
 * would silently change what every existing fit means.
 *
 * WHAT IT LOOKS AT. The POSTER, not the source: one ~80KB WebP instead of a 64MB clip, and it is the
 * exact frame the public will see on the card. Judging a frame the visitor never gets would be
 * grading a different artefact.
 *
 * THE SAFETY GATE IS PART OF THE RUBRIC, NOT A FILTER BOLTED ON AFTER. Publication here is fully
 * automatic — nobody approves a card before it is live — so the model is asked, in the same call, one
 * blunt question: is this something a company is willing to put on its own front page. A beautiful
 * poster for something ugly scores 90 and never publishes, and the reason is stored so a surprising
 * omission is explainable a month later.
 *
 * `is_design` matters as much as the score. Most of the bank is filmed UGC: a phone video of a plate
 * of pasta has no typography to grade, and a rubric forced to produce a number for it will produce
 * one. False here is the honest answer for the majority of rows, and it is the single thing that
 * keeps a design wall from filling up with competent snapshots.
 */
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loggedGemini } from '$lib/server/ai-log';
import { geminiFlash, googleGenaiClient } from '$lib/server/gemini';
import { SUPPORTED, type Locale } from '$lib/i18n/locale';
// The vocabulary is shared with the pages that render it — see the header of `$lib/wall`.
import { DESIGN_AXES, DESIGN_TAGS, type DesignAxis, type DesignTag } from '$lib/wall';
import { WALL_BUCKET } from '$lib/server/wall-media';
import type { HarvestError } from '$lib/server/market-harvest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/**
 * Bump this and every row becomes re-judgeable without a backfill script — the queue is defined as
 * "no verdict under the CURRENT version", so a rubric change re-scores the bank by itself.
 *
 * 2 — the consent clause was rewritten. See `publishable` below: version 1 blocked 19 of the first
 * 86 rows and EVERY ONE of them for "identifiable private individual", which on the trending wall —
 * where the subject is a creator who filmed themselves — is not a consent problem at all.
 *
 * 3 — the scale was anchored. Versions 1 and 2 described the range in words ("most competent work is
 * 55–70") and the judge duly compressed everything good into a single value: of the first seven
 * cards on the wall, SIX scored exactly 68 — Pentagram covers, Nothing product shots and a Linear
 * launch card, all tied. A wall ordered by a score that never varies is not a ranking, it is the
 * order Postgres happened to return. So the bands are now stated as descriptions of WORK, which is
 * the only kind of anchor a grader can actually apply.
 */
export const DESIGN_SCORER_VERSION = 3;

/**
 * The bar for the public wall, 0–100 — CALIBRATED AGAINST THE JUDGE, not chosen in the abstract.
 *
 * The first value here was 72, picked on the reasoning that a wall is judged by its worst card. Then
 * the rubric met thirty real posts from the curated accounts, and the distribution said the number
 * was measuring the wrong thing:
 *
 *     72 ×1   70 ×1   68 ×7   67 ×2   66 ×1   65 ×1   64 ×3   62 ×4   60 ×2   ≤58 ×8
 *
 * Nothing scored above 72. That is the rubric working exactly as written — it tells the model that
 * most competent work is 55–70 and to reserve 80+ for work it would defend in public — but it means
 * the strictness was being applied TWICE: once in the scale handed to the judge, and again in a
 * threshold set as if the scale ran to 100 in practice. A bar of 72 published one card in thirty,
 * and a wall with one card is not a wall.
 *
 * 68 is the top of the observed cluster: roughly the best third of what the judge calls design, on
 * this sample. Raise it as the bank deepens — the absolute number of cards above any bar grows with
 * the corpus, so the bar can afford to move up later and cannot afford to be wrong now.
 *
 * `WALL_MIN_DESIGN_SCORE` moves it without a deploy, which is the point: this is the one number the
 * wall's character depends on, and it should be tunable while looking at the wall.
 */
export const DEFAULT_MIN_DESIGN_SCORE = 68;

export function minDesignScore(): number {
  const raw = Number(env.WALL_MIN_DESIGN_SCORE ?? '');
  return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : DEFAULT_MIN_DESIGN_SCORE;
}

/** Posts judged per run. One image call each — small, because nothing meters this but the cap. */
export const MAX_JUDGEMENTS_PER_RUN = 40;

/**
 * The trending wall's admission rules, mirrored so the queue can ask "could this row ever appear".
 *
 * Duplicated rather than imported because `wall.ts` imports THIS module for `minDesignScore()`, and
 * a cycle between the reader and the judge would be a worse problem than two constants. A test
 * asserts they stay equal — that is the seam that keeps the duplication honest.
 */
export const TRENDING_MIN_OUTPERFORMANCE_FOR_QUEUE = 1.6;
export const TRENDING_WINDOW_DAYS_FOR_QUEUE = 30;
/** Leave room under the worker's wall for the derivative builder that shares the tick. */
export const JUDGE_TIME_BUDGET_MS = 150_000;
/** Inline image ceiling. Posters are ~80KB; anything near this is not a poster. */
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

export type DesignVerdict = {
  isDesign: boolean;
  score: number;
  scores: Record<DesignAxis, number>;
  tags: DesignTag[];
  /** One sentence per site locale. */
  note: Record<Locale, string>;
  publishable: boolean;
  blockReason: string | null;
};

const SCHEMA = {
  type: 'object' as const,
  properties: {
    is_design: {
      type: 'boolean' as const,
      description:
        'True only if the image is a DESIGNED graphic — a layout somebody composed: type set on a surface, a poster, a launch card, an editorial cover, a UI shot, a chart. False for a photo or a video frame that merely happens to look nice.'
    },
    typography: { type: 'integer' as const, description: '1–10. Type choice, spacing, hierarchy. 5 if there is no type.' },
    composition: { type: 'integer' as const, description: '1–10. Grid, balance, use of empty space.' },
    colour: { type: 'integer' as const, description: '1–10. Palette discipline and contrast.' },
    craft: { type: 'integer' as const, description: '1–10. Execution: alignment, resolution, finish, restraint.' },
    originality: { type: 'integer' as const, description: '1–10. Is this a template everyone uses, or a decision somebody made?' },
    score: {
      type: 'integer' as const,
      description:
        '0–100 overall, and the bands are meant literally. ' +
        '90–100: every decision is deliberate and at least one is genuinely surprising — the piece would win something. ' +
        '75–89: assured studio work; it would sit on a curated wall and nobody would ask why. ' +
        '60–74: clean and competent, but the decisions are defaults — a good template, well executed. ' +
        '40–59: template work — a stock image with a headline dropped on it, a layout from a canvas app. ' +
        '0–39: broken — clashing type, no hierarchy, artefacts, unreadable at thumbnail size. ' +
        'USE THE WHOLE RANGE. If several strong pieces are all landing on the same number you are compressing: separate the merely clean from the genuinely well made, and do not be afraid of 85 when the work earns it.'
    },
    tags: {
      type: 'array' as const,
      items: { type: 'string' as const, enum: [...DESIGN_TAGS] },
      description: 'Up to 3, most characteristic first. Only from the list.'
    },
    note_en: { type: 'string' as const, description: 'ONE sentence, max 18 words, on what this piece does well as design. Concrete and specific — name the decision, never "clean and modern". English.' },
    note_it: { type: 'string' as const, description: 'The same sentence in Italian. A real translation, not a transliteration.' },
    note_es: { type: 'string' as const, description: 'The same sentence in Spanish.' },
    note_fr: { type: 'string' as const, description: 'The same sentence in French.' },
    publishable: {
      type: 'boolean' as const,
      description:
        'False for nudity or sexual content, gore or violence, hate or harassment, partisan political content, medical or financial claims, gambling, or anything plainly promoting a scam. ' +
        'On people, the question is NOT "is a face visible" — it is "is this person here without having chosen to be". ' +
        'The account holder who published the post CHOSE to be in it: a creator filming themselves, a founder on camera, a model in a commissioned shoot are all fine, and their face is not a consent problem. ' +
        'False only when someone did not choose: a bystander caught in the background, a child, a person in a private or distressing moment, someone filmed to be mocked, or a screenshot of a private individual’s own post. ' +
        'When in doubt about a BYSTANDER, false. When the only person visible is plainly the author, true.'
    },
    block_reason: {
      type: 'string' as const,
      description: 'Short reason when publishable is false. Empty string when it is true.'
    }
  },
  required: [
    'is_design',
    'typography',
    'composition',
    'colour',
    'craft',
    'originality',
    'score',
    'tags',
    'note_en',
    'note_it',
    'note_es',
    'note_fr',
    'publishable',
    'block_reason'
  ]
};

const PROMPT = [
  'You are the curator of a design wall: a public gallery of the best-looking social posts on the',
  'internet, in the spirit of a curated awards site. You are shown ONE post image and its caption.',
  '',
  'Two separate judgements, and do not let one bleed into the other:',
  '',
  '1. IS IT DESIGN. Did somebody compose this — type on a surface, a poster, a launch card, an',
  '   editorial layout, a product shot art-directed on a grid, a UI screen, a chart? A holiday photo,',
  '   a selfie, a plate of food shot on a phone and a frame grabbed off a filmed clip are NOT design,',
  '   however pleasant they look. Say so: most posts are not design, and that is the expected answer.',
  '',
  '2. HOW GOOD IS IT. Grade the craft, not the subject and not the brand. A famous logo does not earn',
  '   points; a beautiful piece for a boring product keeps all of them. Template work made in a canvas',
  '   app, stock photo with a headline dropped on it, four fonts, drop shadows on everything: those',
  '   are the 30s and 40s. A clean, conventional, correctly-executed piece is the 60s.',
  '',
  '   SPREAD THE GOOD ONES OUT. The failure mode here is not being too generous, it is giving every',
  '   competent piece the same number — a wall ordered by a score that never varies is not a ranking.',
  '   Among pieces you would all call good, ask which one a designer would stop scrolling for, and',
  '   let the gap between them show in the number. 85 is available and it should be used.',
  '',
  'Then the blunt question: would a company put this on its own front page, with attribution to the',
  'original author? Anything sexual, violent, hateful, medically or financially advisory, gambling or',
  'political is not publishable no matter how well made it is.',
  '',
  'On people, read the question carefully, because the obvious reading is the wrong one. A visible',
  'face is not the problem. The creator who filmed themselves and posted it publicly on their own',
  'account is the AUTHOR of this post — we credit them and link to them, and their own face in their',
  'own post is not a consent question. What is not publishable is a person who did not CHOOSE to be',
  'here: a bystander in the background, a child, somebody in a private or distressing moment,',
  'somebody filmed in order to be mocked.',
  '',
  'The note is the only thing a visitor reads in your voice. One sentence, specific about a DECISION',
  'the designer made — "the headline breaks across the fold and the product finishes the line", not',
  '"clean, modern and eye-catching". Never mention scores, never mention this rubric.'
].join('\n');

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

const sentence = (v: unknown): string =>
  String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);

/**
 * Turn whatever the model returned into a verdict, or into nothing.
 *
 * A missing note is fatal on purpose: the note is public text, and a card that renders an empty
 * caption slot is worse than a card that never publishes. Everything else clamps to a defensible
 * value, because a malformed sub-score should not cost us a judgement we already paid for.
 */
export function parseVerdict(raw: unknown): DesignVerdict | null {
  const r = raw as AnyRec;
  if (!r || typeof r !== 'object') return null;

  const noteEn = sentence(r.note_en);
  if (!noteEn) return null;

  const note = {
    en: noteEn,
    it: sentence(r.note_it) || noteEn,
    es: sentence(r.note_es) || noteEn,
    fr: sentence(r.note_fr) || noteEn
  } as Record<Locale, string>;

  const scores = {} as Record<DesignAxis, number>;
  for (const axis of DESIGN_AXES) scores[axis] = clamp(r[axis], 1, 10, 5);

  const tags = Array.isArray(r.tags)
    ? [...new Set(r.tags.map(String))].filter((t): t is DesignTag =>
        (DESIGN_TAGS as readonly string[]).includes(t)
      ).slice(0, 3)
    : [];

  const publishable = r.publishable === true;
  const blockReason = publishable ? null : sentence(r.block_reason) || 'unspecified';

  return {
    isDesign: r.is_design === true,
    score: clamp(r.score, 0, 100, 0),
    scores,
    tags,
    note,
    publishable,
    blockReason
  };
}

/**
 * Does this verdict earn a place on the public design wall? The one rule, in one place.
 *
 * Takes the three fields it actually reads rather than a whole `DesignVerdict`, so the publisher can
 * re-check the bar against columns read back from the row hours later — which is the case that
 * matters, since a row's standing changes after the judge has moved on.
 */
export function meetsWallBar(
  v: { isDesign: boolean; publishable: boolean; score: number },
  min = minDesignScore()
): boolean {
  return v.isDesign && v.publishable && v.score >= min;
}

/** Judge one poster. Throws only on a broken client or a broken call — a bad answer returns null. */
export async function judgeDesign(
  image: { bytes: Buffer; mime: string },
  post: { caption?: string | null; platform?: string | null; account?: string | null }
): Promise<DesignVerdict | null> {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key) throw new Error('gemini_unconfigured');
  if (image.bytes.length > MAX_INLINE_BYTES) throw new Error('image_too_large');

  const ai = googleGenaiClient();
  const context = [
    post.platform ? `PLATFORM: ${post.platform}` : '',
    post.account ? `ACCOUNT: ${post.account}` : '',
    post.caption ? `CAPTION: ${String(post.caption).replace(/\s+/g, ' ').slice(0, 600)}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  const res = await loggedGemini('wall.design_judge', () =>
    ai.models.generateContent({
      model: geminiFlash(),
      contents: [
        {
          role: 'user',
          parts: [
            { text: PROMPT },
            { text: context || 'No caption available.' },
            { inlineData: { mimeType: image.mime, data: image.bytes.toString('base64') } }
          ]
        }
      ],
      config: {
        maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA
      }
    })
  );

  try {
    return parseVerdict(JSON.parse((res.text ?? '').trim()));
  } catch {
    return null;
  }
}

export type JudgeRunResult = {
  considered: number;
  judged: number;
  design: number;
  onWall: number;
  errors: HarvestError[];
};

type QueueRow = {
  id: string;
  platform: string;
  account_key: string | null;
  content: string | null;
  poster_path: string;
};

/**
 * Score everything on the wall's doorstep: a public poster exists, no verdict under the current
 * rubric version, AND the row could actually end up on one of the two pages.
 *
 * THAT LAST CLAUSE WAS MISSING AND IT COST 1,534 CALLS FOR NOTHING. The queue started as "anything
 * with a poster", which is every post the harvest has ever archived — restaurant reels, nail salons,
 * dealership promos. Measured after a day: 1,534 general-harvest rows judged, 127 of them called
 * design, and ZERO clearing the bar. Best score in the whole set: 63. Meanwhile the curated design
 * accounts — 70 rows judged, 9 cards — were queued behind them, competing for the same 30 slots a
 * tick with several thousand rows that could not produce a card if they scored perfectly.
 *
 * So the queue asks the question the walls ask. A row is worth a judge call when it comes from a
 * design source (it exists to be graded), or when it already qualifies for the trending wall (where
 * the verdict is not the score but `publishable` — the safety gate, which trending needs just as
 * much). Anything else is not judged, because there is no page it could reach.
 *
 * Writes the verdict for EVERY row it judges, including the ones that will never be shown. A row
 * that was looked at and rejected must be distinguishable from one that was never looked at —
 * otherwise the queue re-pays for the same rejection every night.
 */
export async function judgeWallQueue(
  admin: SupabaseClient,
  opts: { limit?: number; deadline?: number } = {}
): Promise<JudgeRunResult> {
  const limit = Math.min(opts.limit ?? MAX_JUDGEMENTS_PER_RUN, MAX_JUDGEMENTS_PER_RUN);
  const errors: HarvestError[] = [];

  // `.neq(...)` alone would drop the never-judged rows: in Postgres a comparison against NULL is
  // NULL, not true, and those rows ARE the queue. Same trap `market-categorise.ts` documents.
  // The trending wall's own window, restated here so the queue and the page agree on what "could
  // appear" means. Importing it from `wall.ts` would be a cycle — that module already imports this
  // one for the bar — so the two constants are asserted equal in the tests instead.
  const since = new Date(Date.now() - TRENDING_WINDOW_DAYS_FOR_QUEUE * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('market_posts')
    .select('id, platform, account_key, content, poster_path')
    .not('poster_path', 'is', null)
    .or(`design_scorer_version.is.null,design_scorer_version.neq.${DESIGN_SCORER_VERSION}`)
    // A design source, or already trending. `*` is PostgREST's wildcard inside `like`.
    .or(`query.like.design:*,and(outperformance.gte.${TRENDING_MIN_OUTPERFORMANCE_FOR_QUEUE},published_at.gte.${since})`)
    .order('discovered_at', { ascending: false })
    .limit(limit);

  if (error) {
    return {
      considered: 0,
      judged: 0,
      design: 0,
      onWall: 0,
      errors: [{ stage: 'design_judge', target: 'queue', message: error.message.slice(0, 300) }]
    };
  }

  const rows = (data ?? []) as QueueRow[];
  const min = minDesignScore();
  let judged = 0;
  let design = 0;
  let onWall = 0;

  for (const row of rows) {
    if (opts.deadline && Date.now() > opts.deadline) break;

    const { data: blob, error: dlErr } = await admin.storage.from(WALL_BUCKET).download(row.poster_path);
    if (dlErr || !blob) {
      errors.push({
        stage: 'design_judge',
        target: row.id,
        message: `poster unreadable: ${dlErr?.message?.slice(0, 200) ?? 'missing'}`
      });
      continue;
    }

    let verdict: DesignVerdict | null;
    try {
      verdict = await judgeDesign(
        { bytes: Buffer.from(await blob.arrayBuffer()), mime: 'image/webp' },
        { caption: row.content, platform: row.platform, account: row.account_key }
      );
    } catch (e) {
      errors.push({
        stage: 'design_judge',
        target: row.id,
        message: (e instanceof Error ? e.message : String(e)).slice(0, 300)
      });
      continue;
    }
    if (!verdict) {
      errors.push({ stage: 'design_judge', target: row.id, message: 'unparseable verdict' });
      continue;
    }

    const { error: upErr } = await admin
      .from('market_posts')
      .update({
        is_design: verdict.isDesign,
        design_score: verdict.score,
        design_scores: verdict.scores,
        design_tags: verdict.tags,
        design_note: verdict.note,
        design_publishable: verdict.publishable,
        design_block_reason: verdict.blockReason,
        design_scored_at: new Date().toISOString(),
        design_scorer_version: DESIGN_SCORER_VERSION
      })
      .eq('id', row.id);
    if (upErr) {
      errors.push({ stage: 'design_judge', target: row.id, message: upErr.message.slice(0, 200) });
      continue;
    }

    judged++;
    if (verdict.isDesign) design++;
    if (meetsWallBar(verdict, min)) onWall++;
  }

  return { considered: rows.length, judged, design, onWall, errors };
}

/** The locales the note carries. Exported so a test fails when a new site locale is added here. */
export const NOTE_LOCALES: readonly Locale[] = SUPPORTED;
