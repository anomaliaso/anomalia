/**
 * THE CREATION KIT — the brief an external model reads BEFORE it writes one post.
 *
 * The feature here is SELECTION, not retrieval. Anomalia already holds a library: nine platform
 * playbooks, nineteen post templates, every approved rubric, every past post. Handing all of it
 * over on every turn is the failure mode this tool exists to avoid — it floods the model's context
 * and anchors it on whatever happened to be longest. So the kit answers ONE job (a goal, some
 * platforms, one format) with the smallest set that job needs, and it is capped: past
 * CREATION_KIT_MAX_BYTES the least authoritative sections are dropped and named in `trimmed`.
 *
 * Nothing in here defines a rule of its own. Every section is a selection over a module that
 * already owns its rule — platform limits, the platform playbook, the house voice, the approved
 * rubrics, the owner's rewrites, the brand's own history, the calendar. What this file owns is
 * KIT_SECTIONS: which sections exist, in what order they yield when the budget runs out.
 */
import type { GetCreationKitResult } from '@anomalia/api-contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import POST_TEMPLATES from '$lib/agent-docs/skills/social/references/post-templates.md?raw';
import type { ContentFormat } from '$lib/content-formats';
import {
  PLATFORM_CHAR_LIMITS,
  VIDEO_ONLY_PLATFORMS,
  VISUAL_REQUIRED_PLATFORMS
} from '$lib/platform-limits';
import { houseVoiceFor, ownerCaptionEditPairs } from '$lib/server/content-preview/caption-quality';
import { platformPlaybook, type ContentPrefs } from '$lib/server/content-preview/seed-model';
import { likenessConsented } from '$lib/server/design-visual-refs';
import { currentWeekIndex } from '$lib/server/editorial-plan';
import { openingLine } from '$lib/server/hook-tactics';
import { loadOwnPostHistory, type OwnHistoryRow } from '$lib/server/own-post-history';
import { analyzePostHistory, engagementWeight } from '$lib/server/post-history-insights';
import { loadApprovedRubrics, type Rubric } from '$lib/server/rubrics';
import { SLOT_OCCUPYING_STATUSES } from '$lib/server/schedule';

export const CREATION_KIT_VERSION = 1;

/**
 * The kit's whole payload, serialized. Roughly two thousand tokens: one page of guidance, the size
 * of a good system-prompt section, small enough that reading it before every post is free and
 * large enough to carry a template, a voice and a handful of examples. It is a hard cap, not a
 * target — most kits land well under it.
 */
export const CREATION_KIT_MAX_BYTES = 8192;

/**
 * Per-field ceilings, in one table. They are what makes the budget hold by CONSTRUCTION: trimming
 * whole sections is the backstop, not the mechanism. A brand with a twelve-page "about" and two
 * hundred products still produces the same shaped kit as an empty one.
 */
const CAPS = {
  about: 400,
  audience: 300,
  voice: 2200,
  templateBody: 900,
  hookBody: 400,
  playbook: 1300,
  rubricText: 240,
  editPair: 280,
  winnerOpening: 140,
  shortText: 80,
  products: 5,
  people: 4,
  avoid: 12,
  winners: 3,
  untestedHooks: 3,
  occupied: 8,
  historyScan: 60,
  peopleScan: 50,
  productScan: 200
} as const;

export type KitBrand = {
  id: string;
  name: string;
  timezone: string;
  content_prefs?: ContentPrefs | null;
};

export type KitJob = { goal: string; platforms: string[]; format: ContentFormat };

type Row = Record<string, unknown>;

// ── Template library ─────────────────────────────────────────────────────
// post-templates.md is versioned reference material shipped to the in-app agents. The kit reads
// the same file and hands over exactly one block, so the two never drift into different advice.

type TemplateBlock = { id: string; group: string; name: string; body: string };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseTemplates(markdown: string): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  let group = '';
  let name = '';
  let body: string[] = [];

  const flush = () => {
    if (name) {
      blocks.push({ id: `${slugify(group)}/${slugify(name)}`, group, name, body: body.join('\n').trim() });
    }
    name = '';
    body = [];
  };

  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      flush();
      group = line.slice(3).trim();
      continue;
    }
    if (line.startsWith('### ')) {
      flush();
      name = line.slice(4).trim();
      continue;
    }
    if (name) body.push(line);
  }
  flush();

  return blocks;
}

const TEMPLATES = parseTemplates(POST_TEMPLATES);

const HOOK_GROUP = 'Hook Formulas';

/**
 * Which templates a job may draw from — the ONE place a format or a platform earns a different
 * answer. First matching row wins; `format: null` matches any format, `platform: null` any
 * platform. `pins` names the block the FORMAT decides on its own, because a requested format is a
 * hard constraint and outranks the goal: a video job asking for a short clip must never come back
 * with a carousel's slide plan. Where `pins` is null the format leaves a real choice, and the goal
 * picks inside the group.
 */
const TEMPLATE_ROUTES: ReadonlyArray<{
  format: ContentFormat | null;
  platform: string | null;
  group: string;
  pins: string | null;
}> = [
  { format: 'carousel', platform: null, group: 'Instagram Templates', pins: 'The Carousel Hook' },
  { format: 'video', platform: null, group: 'Instagram Templates', pins: 'The Reel Script' },
  { format: null, platform: 'x', group: 'Twitter/X Thread Templates', pins: null },
  { format: null, platform: 'twitter', group: 'Twitter/X Thread Templates', pins: null },
  { format: null, platform: null, group: 'LinkedIn Post Templates', pins: null }
];

const FALLBACK_ROUTE = TEMPLATE_ROUTES[TEMPLATE_ROUTES.length - 1];

function routeForJob(job: KitJob) {
  const wanted = new Set(job.platforms.map((p) => p.toLowerCase()));
  return (
    TEMPLATE_ROUTES.find(
      (r) => (r.format === null || r.format === job.format) && (r.platform === null || wanted.has(r.platform))
    ) ?? FALLBACK_ROUTE
  );
}

// ── Goal ranking ─────────────────────────────────────────────────────────
// Word overlap, not meaning. It is deterministic, costs nothing and never calls a model — which is
// the whole point of this endpoint. Short words are dropped because "the" matches everything.

const MIN_GOAL_WORD = 4;
const GOAL_WORD = new RegExp(`[\\p{L}0-9]{${MIN_GOAL_WORD},}`, 'gu');

function goalWords(goal: string): string[] {
  return [...new Set(goal.toLowerCase().match(GOAL_WORD) ?? [])];
}

function goalOverlap(words: string[], text: string): number {
  const hay = text.toLowerCase();
  return words.filter((w) => hay.includes(w)).length;
}

function bestByGoal<T>(items: T[], words: string[], text: (item: T) => string): T | undefined {
  let best: T | undefined;
  let bestScore = -1;
  for (const item of items) {
    const score = goalOverlap(words, text(item));
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

// ── Reads ────────────────────────────────────────────────────────────────

type KitSources = {
  kit: Row | null;
  products: Row[];
  people: Row[];
  rubrics: Rubric[];
  history: OwnHistoryRow[];
  weeks: Row[];
  occupied: Row[];
};

async function loadSources(supabase: SupabaseClient, brand: KitBrand): Promise<KitSources> {
  const now = new Date().toISOString();

  const [kit, products, people, rubrics, history, plan, occupied] = await Promise.all([
    supabase.from('brand_kit').select('about, target_audience').eq('brand_id', brand.id).maybeSingle(),
    supabase.from('products').select('id, title, pricing').eq('brand_id', brand.id).limit(CAPS.productScan),
    supabase.from('people').select('id, name, role, kind, consent').eq('brand_id', brand.id).limit(CAPS.peopleScan),
    loadApprovedRubrics(supabase, brand.id),
    loadOwnPostHistory(supabase, brand.id, { limit: CAPS.historyScan }),
    supabase.from('editorial_plans').select('weeks').eq('brand_id', brand.id).eq('status', 'active').maybeSingle(),
    supabase
      .from('posts')
      .select('scheduled_for, platform, platforms, campaign_name, campaign_step')
      .eq('brand_id', brand.id)
      .in('status', [...SLOT_OCCUPYING_STATUSES])
      .gte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(CAPS.occupied)
  ]);

  return {
    kit: kit.data ?? null,
    products: (products.data ?? []) as Row[],
    people: ((people.data ?? []) as Row[]).filter(likenessConsented),
    rubrics,
    history,
    weeks: (plan.data?.weeks ?? []) as Row[],
    occupied: (occupied.data ?? []) as Row[]
  };
}

// ── Sections ─────────────────────────────────────────────────────────────
// Each builder returns `undefined` when it has nothing to say, and the key is then absent from the
// kit. A field that is always empty teaches the reader to stop looking at the kit.

type KitContext = { brand: KitBrand; job: KitJob; prefs: ContentPrefs; sources: KitSources; words: string[] };

function trim(value: unknown, max: number): string | undefined {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : undefined;
}

function buildConstraints({ job, prefs }: KitContext) {
  return {
    platforms: job.platforms.map((platform) => ({
      platform,
      char_limit: PLATFORM_CHAR_LIMITS[platform] ?? null,
      needs_media: VISUAL_REQUIRED_PLATFORMS.has(platform),
      video_only: VIDEO_ONLY_PLATFORMS.has(platform)
    })),
    avoid: (prefs.avoid ?? []).slice(0, CAPS.avoid)
  };
}

function buildBrand({ brand, prefs, sources, words }: KitContext) {
  const products = [...sources.products]
    .sort((a, b) => goalOverlap(words, String(b.title ?? '')) - goalOverlap(words, String(a.title ?? '')))
    .slice(0, CAPS.products)
    .map((p) => ({
      id: String(p.id),
      title: String(p.title ?? '').slice(0, CAPS.shortText),
      ...maybe('pricing', trim(p.pricing, CAPS.shortText))
    }));

  const people = sources.people.slice(0, CAPS.people).map((p) => ({
    id: String(p.id),
    name: String(p.name ?? '').slice(0, CAPS.shortText),
    ...maybe('role', trim(p.role, CAPS.shortText))
  }));

  return {
    name: brand.name,
    ...maybe('language', trim(prefs.language, 32)),
    ...maybe('about', trim(sources.kit?.about, CAPS.about)),
    ...maybe('audience', trim(sources.kit?.target_audience, CAPS.audience)),
    ...maybe('products', products.length ? products : undefined),
    ...maybe('people', people.length ? people : undefined)
  };
}

function buildVoice({ prefs }: KitContext) {
  return { text: houseVoiceFor(prefs).slice(0, CAPS.voice) };
}

function buildRubric({ job, sources, words }: KitContext) {
  const matching = sources.rubrics.filter((r) => r.format === job.format);
  const picked = bestByGoal(matching, words, (r) => `${r.name} ${r.promise} ${r.strategic_role}`);
  if (!picked) return undefined;

  return {
    ...maybe('id', picked.id),
    name: picked.name,
    format: picked.format,
    ...maybe('promise', trim(picked.promise, CAPS.rubricText)),
    ...maybe('cadence', trim(picked.cadence, CAPS.rubricText)),
    ...maybe('art_direction', trim(picked.art_direction, CAPS.rubricText))
  };
}

function buildTemplate({ job, prefs, words }: KitContext) {
  const route = routeForJob(job);
  const candidates = TEMPLATES.filter(
    (t) => t.group === route.group && (route.pins === null || t.name === route.pins)
  );
  const picked = bestByGoal(candidates, words, (t) => `${t.name} ${t.body}`);
  if (!picked) return undefined;

  const hooks = bestByGoal(
    TEMPLATES.filter((t) => t.group === HOOK_GROUP),
    words,
    (t) => `${t.name} ${t.body}`
  );

  return {
    id: picked.id,
    name: picked.name,
    group: picked.group,
    body: picked.body.slice(0, CAPS.templateBody),
    ...maybe(
      'hooks',
      hooks ? { id: hooks.id, name: hooks.name, body: hooks.body.slice(0, CAPS.hookBody) } : undefined
    ),
    playbook: platformPlaybook(job.platforms, prefs).trim().slice(0, CAPS.playbook)
  };
}

function buildCalendar({ sources }: KitContext) {
  const occupied = sources.occupied.slice(0, CAPS.occupied).map((p) => ({
    scheduled_for: String(p.scheduled_for),
    platforms: (Array.isArray(p.platforms) ? (p.platforms as string[]) : [p.platform]).filter(
      (x): x is string => typeof x === 'string' && !!x
    ),
    ...maybe('campaign', trim(p.campaign_name, CAPS.shortText)),
    ...maybe('step', trim(p.campaign_step, CAPS.shortText))
  }));
  return occupied.length ? { occupied } : undefined;
}

function buildWeek({ brand, sources }: KitContext) {
  const index = currentWeekIndex({ weeks: sources.weeks } as never, brand.timezone);
  if (index === null) return undefined;

  const theme = trim(sources.weeks[index]?.theme, CAPS.rubricText);
  return theme ? { index, theme } : undefined;
}

function buildOperatorEdits({ prefs }: KitContext) {
  const pairs = ownerCaptionEditPairs(prefs).map((p) => ({
    before: p.before.slice(0, CAPS.editPair),
    after: p.after.slice(0, CAPS.editPair)
  }));
  return pairs.length ? pairs : undefined;
}

function buildHistory({ job, sources }: KitContext) {
  if (!sources.history.length) return undefined;

  const insights = analyzePostHistory(
    sources.history.map((row) => ({
      content: row.content,
      mediaType: row.media_type,
      publishedAt: row.published_at,
      metrics: row.metrics as never
    }))
  );

  const wanted = new Set(job.platforms.map((p) => p.toLowerCase()));
  const winners = sources.history
    .filter((row) => wanted.has(String(row.platform ?? '').toLowerCase()))
    .sort((a, b) => engagementWeight(b.metrics as never) - engagementWeight(a.metrics as never))
    .slice(0, CAPS.winners)
    .map((row) => ({
      id: row.id,
      platform: String(row.platform ?? ''),
      opening: openingLine(row.content ?? '').slice(0, CAPS.winnerOpening)
    }))
    .filter((w) => !!w.opening);

  return {
    post_count: insights.postCount,
    best_times: insights.bestTimes,
    top_formats: insights.topFormats,
    top_hashtags: insights.topHashtags,
    ...maybe('cadence', insights.cadence || undefined),
    untested_hooks: insights.hooks.untested.slice(0, CAPS.untestedHooks),
    winners
  };
}

/**
 * The sections, ordered by the plan's guidance precedence: hard platform constraints first, then
 * verified brand facts and approved voice, then the rubric, then Anomalia's own template. Evidence
 * comes last because the plan is explicit that past winners are evidence, not instructions — and
 * `precedence` doubles as the yield order, so what a kit loses to the budget is always the least
 * authoritative thing it was carrying. Rank 1 is never dropped.
 */
const KIT_SECTIONS: ReadonlyArray<{
  key: string;
  precedence: number;
  build: (ctx: KitContext) => unknown;
}> = [
  { key: 'constraints', precedence: 1, build: buildConstraints },
  { key: 'brand', precedence: 2, build: buildBrand },
  { key: 'voice', precedence: 3, build: buildVoice },
  { key: 'rubric', precedence: 4, build: buildRubric },
  { key: 'template', precedence: 5, build: buildTemplate },
  { key: 'calendar', precedence: 6, build: buildCalendar },
  { key: 'week', precedence: 7, build: buildWeek },
  { key: 'operator_edits', precedence: 8, build: buildOperatorEdits },
  { key: 'history', precedence: 9, build: buildHistory }
];

function maybe<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : ({ [key]: value } as Record<string, T>);
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

export async function buildCreationKit(
  supabase: SupabaseClient,
  brand: KitBrand,
  job: KitJob
): Promise<GetCreationKitResult> {
  const prefs = (brand.content_prefs ?? {}) as ContentPrefs;
  const sources = await loadSources(supabase, brand);
  const ctx: KitContext = { brand, job, prefs, sources, words: goalWords(job.goal) };

  const sections = new Map<string, unknown>();
  for (const section of KIT_SECTIONS) {
    const value = section.build(ctx);
    if (value !== undefined) sections.set(section.key, value);
  }

  const trimmed: string[] = [];

  // The section map is keyed by string, so the spread is the one place the shape has to be
  // asserted. GetCreationKitResult comes straight from the endpoint contract, so a builder that
  // stops matching what the endpoint declares stops compiling.
  const assemble = () =>
    ({
      job: { goal: job.goal, platforms: job.platforms, format: job.format },
      versions: { kit: CREATION_KIT_VERSION },
      size_bytes: CREATION_KIT_MAX_BYTES,
      budget_bytes: CREATION_KIT_MAX_BYTES,
      trimmed,
      ...Object.fromEntries(sections)
    }) as GetCreationKitResult;

  const yieldOrder = KIT_SECTIONS.filter((s) => s.precedence > 1).sort((a, b) => b.precedence - a.precedence);
  while (byteLength(assemble()) > CREATION_KIT_MAX_BYTES && yieldOrder.length) {
    const victim = yieldOrder.shift()!;
    if (sections.delete(victim.key)) trimmed.push(victim.key);
  }

  return { ...assemble(), size_bytes: byteLength(assemble()) };
}
