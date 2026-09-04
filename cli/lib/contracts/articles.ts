import { z } from 'zod';
import type { BrandEndpoint } from './index';

const MAX_TITLE = 200;
const MAX_META_TITLE = 70;
const MAX_META_DESCRIPTION = 200;
const MAX_TAGS = 20;

const TaxonomyRef = z.object({ id: z.string(), name: z.string(), slug: z.string() });

const ArticleSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  meta_title: z.string().nullable(),
  meta_description: z.string().nullable(),
  body_md: z.string(),
  status: z.string(),
  language: z.string().nullable(),
  cover_image: z.string().nullable(),
  category: TaxonomyRef.nullable(),
  author: TaxonomyRef.nullable(),
  tags: z.array(TaxonomyRef),
  scheduled_for: z.string().nullable(),
  scheduled_for_local: z.string().nullable(),
  published_at: z.string().nullable(),
  translation_of: z.string().nullable(),
  source: z.string().nullable(),
  version_seq: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable()
});

const GetArticleInputSchema = z
  .object({
    id: z.string().min(1).describe('Article id, from list_articles or the Site page URL')
  })
  .strict();

const UpdateArticleInputSchema = z
  .object({
    id: z.string().min(1).describe('Article id, from list_articles or the Site page URL'),
    title: z.string().min(1).max(MAX_TITLE).optional(),
    body_md: z
      .string()
      .optional()
      .describe(
        'The COMPLETE new markdown body: a replacement, not a diff. Stored exactly as sent — ' +
          'the public blog escapes any raw HTML in it, so markdown is the only markup that renders'
      ),
    meta_title: z.string().max(MAX_META_TITLE).nullable().optional().describe('null clears it'),
    meta_description: z.string().max(MAX_META_DESCRIPTION).nullable().optional().describe('null clears it'),
    category_id: z
      .string()
      .nullable()
      .optional()
      .describe('A category of THIS brand. null clears it; a category of another brand is rejected'),
    author_id: z
      .string()
      .nullable()
      .optional()
      .describe('An author of THIS brand. null clears the byline; an author of another brand is rejected'),
    tag_ids: z
      .array(z.string().min(1))
      .max(MAX_TAGS)
      .optional()
      .describe('The COMPLETE tag set of this brand — it replaces the current one. [] clears every tag'),
    language: z
      .string()
      .min(2)
      .max(5)
      .optional()
      .describe('ISO 639-1 code, e.g. "it". Refused on a translation row: its locale is its identity'),
    scheduled_for: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Publication instant, ISO. Without an offset it is read on the brand clock. Dating a ' +
          'draft approves it, and an approved article auto-publishes at that time — this is the ' +
          'consequential half of the tool. null clears the schedule back to a plain draft'
      )
  })
  .strict();

const GetArticleResultSchema = z.object({ article: ArticleSchema });

const UpdateArticleResultSchema = z.object({
  ok: z.literal(true),
  updated_fields: z.array(z.string()),
  article: ArticleSchema
});

export type Article = z.infer<typeof ArticleSchema>;
export type GetArticleInput = z.infer<typeof GetArticleInputSchema>;
export type UpdateArticleInput = z.infer<typeof UpdateArticleInputSchema>;
export type UpdateArticleResult = z.infer<typeof UpdateArticleResultSchema>;

export const GET_ARTICLE = {
  tool: 'get_article',
  title: 'Read article',
  description:
    'One blog article in full, in any state — draft, planned, approved or published: body, SEO ' +
    'fields, cover, category, tags, author, language, schedule and status. Read it before ' +
    'editing, and read it after to see what changed. Calls no model and spends no credits.',
  method: 'GET',
  pathUnderBrand: '/web/article',
  input: GetArticleInputSchema,
  output: GetArticleResultSchema,
  failures: [{ error: 'article_not_found', status: 404 }],
  destructive: false
} satisfies BrandEndpoint;

export const UPDATE_ARTICLE = {
  tool: 'update_article',
  title: 'Update article',
  description:
    'Write text and metadata you already have onto an article: title, markdown body, meta title, ' +
    'meta description, category, tags, author, language, schedule. Anomalia calls no model and ' +
    'spends no credits — nothing is rewritten, regenerated or reformatted. A field you do not ' +
    'send is left exactly as it was, so changing the title never touches the body, the cover or ' +
    'the description. A published article is refused: what is live is not edited in place.',
  method: 'POST',
  pathUnderBrand: '/web/article',
  input: UpdateArticleInputSchema,
  output: UpdateArticleResultSchema,
  failures: [
    { error: 'article_not_found', status: 404 },
    { error: 'no_changes', status: 400 },
    { error: 'invalid_language', status: 400 },
    { error: 'invalid_scheduled_for', status: 400 },
    { error: 'category_not_found', status: 400 },
    { error: 'author_not_found', status: 400 },
    { error: 'tags_not_found', status: 400 },
    { error: 'article_published', status: 409 },
    { error: 'planned_needs_slot', status: 409 },
    { error: 'translation_locked', status: 409 }
  ],
  destructive: false
} satisfies BrandEndpoint;
