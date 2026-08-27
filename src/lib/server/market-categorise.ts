/**
 * Catalogue every post in the market bank with Gemini, never with the query that found it.
 *
 * The query is a label about us. `trending:IT` says nothing at all; a "food business" keyword
 * returns a personal trainer talking about meal prep, and that post then sits in the food bucket
 * that `correlateByCategory` groups on. Grouping on a wrong label is worse than not grouping: it
 * produces a confident per-vertical answer out of a mixed pile.
 *
 * So the model decides, and it decides from the content — the caption, and for anything the judge
 * has already watched, the transcript, the on-screen text and its summary. That is strictly more
 * signal than a hashtag, and it is the same signal for a video, a carousel and a plain text post,
 * which is why this runs over the whole bank rather than only over clips.
 *
 * Batched: one call judges up to BATCH_SIZE posts. Cataloguing is cheap next to watching a video,
 * and it must cover everything, so it is priced accordingly.
 */
import { GEMINI_MAX_OUTPUT_TOKENS } from '$lib/server/ai-output-limits';
import { env } from '$env/dynamic/private';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loggedGemini } from '$lib/server/ai-log';
import { geminiFlash, googleGenaiClient } from '$lib/server/gemini';
import type { HarvestError } from '$lib/server/market-harvest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

/**
 * The verticals. FIXED, because the entire purpose is grouping — `correlateByCategory` buckets on
 * this string, and a free-form label produces one bucket per post and therefore no correlation at
 * all. Mirrors the discovery verticals so a harvested post and a trending video land in the same
 * bucket. `other` is deliberate: forcing a bad fit is worse than admitting one.
 */
export const CATEGORIES = [
  'food',
  'fitness',
  'beauty',
  'fashion',
  'interiors',
  'realestate',
  'professional',
  'ecommerce',
  'saas',
  'coaching',
  'travel',
  'automotive',
  'other'
] as const;
export type MarketCategory = (typeof CATEGORIES)[number];

/**
 * How the piece is BUILT, independent of what it is about.
 *
 * This is the axis that answers the question we actually care about — "what kind of content works"
 * — and a vertical can never answer it. A before/after outperforming a talking head is a finding we
 * can act on in any vertical; "food does well" is not.
 */
export const CONTENT_FORMS = [
  'talking_head',
  'voiceover_broll',
  'tutorial',
  'before_after',
  'listicle',
  'skit',
  'product_demo',
  'testimonial',
  'behind_the_scenes',
  'reaction',
  'text_on_screen',
  'photo_carousel',
  'text_post',
  'other'
] as const;
export type ContentForm = (typeof CONTENT_FORMS)[number];

/** One Gemini call per batch. Big enough to be cheap, small enough that one bad row is contained. */
export const BATCH_SIZE = 20;

/** Posts catalogued per run. The cap is the function's wall, not a budget. */
export const MAX_PER_RUN = 400;

export type CatalogueItem = {
  id: string;
  caption?: string | null;
  /** Present when the video judge has already watched it — far better signal than the caption. */
  spoken?: string | null;
  onScreen?: string | null;
  summary?: string | null;
  platform?: string | null;
  formatBucket?: string | null;
};

export type Catalogued = {
  id: string;
  category: MarketCategory;
  content_form: ContentForm;
  topic: string;
};

const SCHEMA = {
  type: 'object' as const,
  properties: {
    items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const, description: 'The id given in the input, copied back verbatim.' },
          category: {
            type: 'string' as const,
            enum: [...CATEGORIES],
            description: 'The business vertical the content serves. "other" when none fits.'
          },
          content_form: {
            type: 'string' as const,
            enum: [...CONTENT_FORMS],
            description: 'How the piece is BUILT, not what it is about.'
          },
          topic: {
            type: 'string' as const,
            description:
              'The specific subject, 2–6 words, in the language of the content. "meal prep for shift workers", not "food".'
          }
        },
        required: ['id', 'category', 'content_form', 'topic']
      }
    }
  },
  required: ['items']
};

/**
 * The text the model judges.
 *
 * Transcript and on-screen text come first when they exist: a caption is marketing copy about the
 * video, the transcript is the video. Truncated per field so one rambling post cannot crowd the
 * other nineteen out of the context.
 */
export function itemText(item: CatalogueItem): string {
  const parts: string[] = [];
  const add = (label: string, v: string | null | undefined, max: number) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    if (s) parts.push(`${label}: ${s.slice(0, max)}`);
  };
  add('SPOKEN', item.spoken, 600);
  add('ON SCREEN', item.onScreen, 300);
  add('SUMMARY', item.summary, 300);
  add('CAPTION', item.caption, 600);
  if (!parts.length) return '';
  const meta = [item.platform, item.formatBucket].filter(Boolean).join('/');
  return `[${item.id}]${meta ? ` (${meta})` : ''}\n${parts.join('\n')}`;
}

/** Items with nothing to read cannot be catalogued — and must not be guessed at from the platform. */
export function catalogable(items: CatalogueItem[]): CatalogueItem[] {
  return items.filter((i) => itemText(i) !== '');
}

export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function buildPrompt(items: CatalogueItem[]): string {
  return [
    'You are cataloguing social posts for a research corpus. For EACH post below return its',
    'business vertical, the structural form of the piece, and a specific topic.',
    '',
    'Rules:',
    '- Judge the CONTENT, not the platform and not any hashtag. A gym owner talking about meal prep',
    '  is fitness, not food.',
    '- `content_form` describes how the piece is BUILT. A tutorial delivered straight to camera is',
    '  a tutorial, not a talking_head — pick the most specific form that fits.',
    '- `topic` must be specific enough to be useful as a search term later, and written in the',
    '  language of the content.',
    '- Use "other" rather than forcing a bad fit.',
    '- Return exactly one entry per input id, copying the id verbatim.',
    '',
    items.map(itemText).join('\n\n')
  ].join('\n');
}

/** Drop anything the model invented or mangled: unknown ids, unknown enum values. */
export function reconcile(items: CatalogueItem[], raw: unknown): Catalogued[] {
  const known = new Set(items.map((i) => i.id));
  const list = (raw as AnyRec)?.items;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Catalogued[] = [];
  for (const r of list as AnyRec[]) {
    const id = String(r?.id ?? '');
    if (!known.has(id) || seen.has(id)) continue;
    const category = String(r?.category ?? '');
    const form = String(r?.content_form ?? '');
    if (!(CATEGORIES as readonly string[]).includes(category)) continue;
    if (!(CONTENT_FORMS as readonly string[]).includes(form)) continue;
    seen.add(id);
    out.push({
      id,
      category: category as MarketCategory,
      content_form: form as ContentForm,
      topic: String(r?.topic ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
    });
  }
  return out;
}

async function judgeBatch(items: CatalogueItem[]): Promise<Catalogued[]> {
  const key = env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY;
  if (!key) throw new Error('gemini_unconfigured');
  const ai = googleGenaiClient();
  const res = await loggedGemini('market.catalogue', () =>
    ai.models.generateContent({
      model: geminiFlash(),
      contents: [{ role: 'user', parts: [{ text: buildPrompt(items) }] }],
      config: { maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS, responseMimeType: 'application/json', responseSchema: SCHEMA }
    })
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse((res.text ?? '').trim());
  } catch {
    return [];
  }
  return reconcile(items, parsed);
}

export type CatalogueResult = {
  considered: number;
  catalogued: number;
  skippedNoText: number;
  errors: HarvestError[];
};

/**
 * Catalogue everything the model has not judged yet.
 *
 * Rows keep whatever category the query gave them until this overwrites it, so the bank is never
 * left with a hole — but `category_source` records which of the two it is, and the fit can be read
 * through that.
 */
export async function catalogueMarketPosts(
  admin: SupabaseClient,
  opts: { limit?: number; deadline?: number } = {}
): Promise<CatalogueResult> {
  const limit = Math.min(opts.limit ?? MAX_PER_RUN, MAX_PER_RUN);
  const errors: CatalogueResult['errors'] = [];

  // `.neq('category_source','gemini')` alone would be wrong: in Postgres a comparison against NULL
  // is NULL, not true, so the rows that have never been catalogued — precisely the queue — would be
  // filtered out and this would only ever re-judge rows that already carry a query-derived label.
  const { data, error } = await admin
    .from('market_posts')
    .select('id, content, platform, format_bucket, market_video_analyses(spoken, on_screen, summary)')
    .or('category_source.is.null,category_source.neq.gemini')
    .order('discovered_at', { ascending: false })
    .limit(limit);
  if (error) {
    return {
      considered: 0,
      catalogued: 0,
      skippedNoText: 0,
      errors: [{ stage: 'catalogue', target: 'queue', message: error.message.slice(0, 300) }]
    };
  }

  const rows = (data ?? []) as AnyRec[];
  const items: CatalogueItem[] = rows.map((r) => {
    const a = Array.isArray(r.market_video_analyses) ? r.market_video_analyses[0] : r.market_video_analyses;
    return {
      id: String(r.id),
      caption: r.content,
      spoken: a?.spoken ?? null,
      onScreen: a?.on_screen ?? null,
      summary: a?.summary ?? null,
      platform: r.platform,
      formatBucket: r.format_bucket
    };
  });

  const usable = catalogable(items);
  let catalogued = 0;

  for (const batch of batches(usable)) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    let judged: Catalogued[] = [];
    try {
      judged = await judgeBatch(batch);
    } catch (e) {
      errors.push({
        stage: 'catalogue',
        target: `batch:${batch.length}`,
        message: (e instanceof Error ? e.message : String(e)).slice(0, 300)
      });
      continue;
    }
    const now = new Date().toISOString();
    for (const j of judged) {
      const { error: upErr } = await admin
        .from('market_posts')
        .update({
          category: j.category,
          content_form: j.content_form,
          topic: j.topic,
          category_source: 'gemini',
          categorised_at: now
        })
        .eq('id', j.id);
      if (upErr) {
        errors.push({ stage: 'catalogue', target: j.id, message: upErr.message.slice(0, 200) });
        continue;
      }
      catalogued++;
    }
  }

  return {
    considered: items.length,
    catalogued,
    skippedNoText: items.length - usable.length,
    errors
  };
}
