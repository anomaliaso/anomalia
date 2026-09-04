/**
 * Deterministic article editing. No model runs here and no credit is spent: every field the
 * caller sends is stored as it arrived, and every field it did not send is left untouched.
 *
 * ARTICLE_EDIT_RULES is the only place that says what a status allows. Adding a status is a row,
 * not another `if` scattered over the chat tool, the web editor and the API.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Article } from '@anomalia/api-contracts';
import { BLOG_LOCALE_LANGUAGE, isBlogLocale } from '$lib/blog-locales';
import { resolveScheduleInput } from '$lib/server/clock';
import { formatInZone } from '$lib/server/schedule';

export const ARTICLE_STATUSES = ['draft', 'planned', 'approved', 'published'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

const SCHEDULE_REFUSALS = ['article_published', 'planned_needs_slot'] as const;
export type ScheduleRefusal = (typeof SCHEDULE_REFUSALS)[number];

type ScheduleOutcome = ArticleStatus | 'keep' | ScheduleRefusal;

const ARTICLE_EDIT_RULES: Record<
  ArticleStatus,
  { edit: 'allow' | ScheduleRefusal; schedule: ScheduleOutcome; unschedule: ScheduleOutcome }
> = {
  draft: { edit: 'allow', schedule: 'approved', unschedule: 'draft' },
  planned: { edit: 'allow', schedule: 'keep', unschedule: 'planned_needs_slot' },
  approved: { edit: 'allow', schedule: 'approved', unschedule: 'draft' },
  published: { edit: 'article_published', schedule: 'article_published', unschedule: 'article_published' }
};

const isScheduleRefusal = (value: string): value is ScheduleRefusal =>
  (SCHEDULE_REFUSALS as readonly string[]).includes(value);

const rulesFor = (status: string) => ARTICLE_EDIT_RULES[status as ArticleStatus] ?? ARTICLE_EDIT_RULES.draft;

export function articleEditRefusal(status: string): ScheduleRefusal | null {
  const outcome = rulesFor(status).edit;
  return outcome === 'allow' ? null : outcome;
}

export type SchedulePatch = { scheduled_for: string | null; status?: ArticleStatus };

export function articleScheduleChange(
  status: string,
  when: string | null
): { ok: true; patch: SchedulePatch } | { ok: false; reason: ScheduleRefusal } {
  const outcome = when ? rulesFor(status).schedule : rulesFor(status).unschedule;
  if (isScheduleRefusal(outcome)) return { ok: false, reason: outcome };
  return {
    ok: true,
    patch: outcome === 'keep' ? { scheduled_for: when } : { scheduled_for: when, status: outcome }
  };
}

const ARTICLE_COLUMNS = `
  id, slug, title, meta_title, meta_description, body_md, status, language, cover_image,
  scheduled_for, published_at, translation_of, source, version_seq, created_at, updated_at,
  category:blog_categories(id, name, slug),
  author:blog_authors(id, name, slug),
  tags:brand_article_tags(blog_tags(id, name, slug))
`;

type ArticleRow = Record<string, unknown>;

function toArticle(row: ArticleRow, timezone: string): Article {
  const scheduledFor = (row.scheduled_for as string | null) ?? null;
  const tags = (row.tags as { blog_tags: Article['tags'][number] }[] | null) ?? [];
  return {
    ...(row as unknown as Article),
    category: (row.category as Article['category']) ?? null,
    author: (row.author as Article['author']) ?? null,
    tags: tags.map((t) => t.blog_tags).filter(Boolean),
    scheduled_for: scheduledFor,
    scheduled_for_local: scheduledFor ? `${formatInZone(scheduledFor, timezone)} (${timezone})` : null
  };
}

export async function readArticle(
  client: SupabaseClient,
  brandId: string,
  articleId: string,
  timezone: string
): Promise<Article | null> {
  const { data } = await client
    .from('brand_articles')
    .select(ARTICLE_COLUMNS)
    .eq('id', articleId)
    .eq('brand_id', brandId)
    .maybeSingle();
  return data ? toArticle(data as ArticleRow, timezone) : null;
}

export type ArticlePatch = {
  title?: string;
  body_md?: string;
  meta_title?: string | null;
  meta_description?: string | null;
  category_id?: string | null;
  author_id?: string | null;
  tag_ids?: string[];
  language?: string;
  scheduled_for?: string | null;
};

const DIRECT_COLUMNS = [
  'title',
  'body_md',
  'meta_title',
  'meta_description',
  'category_id',
  'author_id'
] as const;

const BRAND_REFERENCES = {
  category_id: { table: 'blog_categories', failure: 'category_not_found' },
  author_id: { table: 'blog_authors', failure: 'author_not_found' }
} as const;

export type ArticleEditFailure =
  | ScheduleRefusal
  | 'article_not_found'
  | 'no_changes'
  | 'invalid_language'
  | 'invalid_scheduled_for'
  | 'category_not_found'
  | 'author_not_found'
  | 'tags_not_found';

export type ArticleUpdate =
  | { ok: true; updatedFields: string[]; article: Article }
  | { ok: false; error: ArticleEditFailure; details?: unknown };

async function idsOwnedByBrand(
  client: SupabaseClient,
  table: string,
  brandId: string,
  ids: string[]
): Promise<Set<string>> {
  const { data } = await client.from(table).select('id').eq('brand_id', brandId).in('id', ids);
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}

export async function updateArticle(args: {
  client: SupabaseClient;
  brandId: string;
  articleId: string;
  timezone: string;
  patch: ArticlePatch;
}): Promise<ArticleUpdate> {
  const { client, brandId, articleId, timezone, patch } = args;

  const requested = Object.keys(patch).filter((key) => patch[key as keyof ArticlePatch] !== undefined);
  if (!requested.length) return { ok: false, error: 'no_changes' };

  const { data: current } = await client
    .from('brand_articles')
    .select('id, status, translation_of')
    .eq('id', articleId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!current) return { ok: false, error: 'article_not_found' };

  const denied = articleEditRefusal(current.status);
  if (denied) return { ok: false, error: denied };

  const columns: Record<string, unknown> = {};
  for (const column of DIRECT_COLUMNS) {
    if (patch[column] !== undefined) columns[column] = patch[column];
  }

  if (patch.language !== undefined) {
    if (current.translation_of) return { ok: false, error: 'translation_locked' };
    if (!isBlogLocale(patch.language)) return { ok: false, error: 'invalid_language' };
    columns.language = BLOG_LOCALE_LANGUAGE[patch.language];
  }

  if (patch.scheduled_for !== undefined) {
    let when: string | null = null;
    if (patch.scheduled_for !== null) {
      const parsed = resolveScheduleInput(patch.scheduled_for, timezone);
      if ('error' in parsed) return { ok: false, error: 'invalid_scheduled_for', details: parsed };
      when = parsed.utc;
    }
    const change = articleScheduleChange(current.status, when);
    if (!change.ok) return { ok: false, error: change.reason };
    Object.assign(columns, change.patch);
  }

  for (const [field, reference] of Object.entries(BRAND_REFERENCES)) {
    const id = patch[field as keyof typeof BRAND_REFERENCES];
    if (typeof id !== 'string') continue;
    const owned = await idsOwnedByBrand(client, reference.table, brandId, [id]);
    if (!owned.has(id)) return { ok: false, error: reference.failure };
  }

  if (patch.tag_ids?.length) {
    const wanted = new Set(patch.tag_ids);
    const owned = await idsOwnedByBrand(client, 'blog_tags', brandId, [...wanted]);
    if (owned.size !== wanted.size) return { ok: false, error: 'tags_not_found' };
  }

  const { error } = await client
    .from('brand_articles')
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq('id', articleId)
    .eq('brand_id', brandId);
  if (error) throw new Error(error.message);

  if (patch.tag_ids !== undefined) {
    await client.from('brand_article_tags').delete().eq('article_id', articleId);
    if (patch.tag_ids.length) {
      await client
        .from('brand_article_tags')
        .insert(patch.tag_ids.map((tag_id) => ({ article_id: articleId, tag_id })));
    }
  }

  const article = await readArticle(client, brandId, articleId, timezone);
  if (!article) return { ok: false, error: 'article_not_found' };

  const updatedFields = columns.status === undefined ? requested : [...requested, 'status'];
  return { ok: true, updatedFields, article };
}
