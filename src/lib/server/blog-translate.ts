/**
 * Translate a finished article into the blog's extra locales.
 *
 * A translation is a normal brand_articles row linked to its original via translation_of (0129), so
 * it inherits the editor, the score, the scheduling and the publish flow. It REUSES the original's
 * images — which is why translations cost ~1% of an article (see blog-cost.ts) and can be a plan
 * perk instead of a metered add-on.
 *
 * Runs on DeepSeek like all other blog text. The prompt is a translation brief, not a rewrite brief:
 * markdown structure, link URLs and image references must survive byte-for-byte, because the internal
 * links were validated against the brand's real pages and the image URLs point at uploaded assets.
 */
import { swallow } from '$lib/server/swallow';
import type { SupabaseClient } from '@supabase/supabase-js';
import { genaiClient, structured } from './research';
import { PIN_GEMINI } from './xiaomi';
import { BLOG_LOCALE_LANGUAGE, type BlogLocale } from './blog-locales';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = Record<string, any>;

const TRANSLATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const, description: 'The H1, translated naturally (not literally).' },
    slug: { type: 'string' as const, description: 'URL slug in the target language: lowercase, hyphenated, ASCII only, no stop-word padding.' },
    metaTitle: { type: 'string' as const, description: 'SEO title in the target language, under 60 characters.' },
    metaDescription: { type: 'string' as const, description: 'SEO meta description in the target language, 50-155 characters.' },
    bodyMarkdown: {
      type: 'string' as const,
      description:
        'The COMPLETE article translated into the target language. Preserve the Markdown structure exactly: the same heading levels and order, the same lists, and every link and image UNCHANGED — translate only link anchor text and image alt text, NEVER the URLs.'
    }
  },
  required: ['title', 'slug', 'metaTitle', 'metaDescription', 'bodyMarkdown']
};

const SYSTEM =
  'You are a senior localisation editor. You translate marketing and editorial content so it reads as if originally written in the target language — idiomatic, not literal. You never add, remove or soften factual claims, never invent statistics, and never alter a URL.';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);

/**
 * Translate one article into one locale. Idempotent: the unique index on (translation_of, language)
 * means a retried job updates the existing row instead of creating a second copy.
 * Returns the translation's article id, or null if the model failed.
 */
export async function translateArticle(
  admin: SupabaseClient,
  brand: AnyRec,
  articleId: string,
  locale: BlogLocale
): Promise<string | null> {
  const language = BLOG_LOCALE_LANGUAGE[locale];
  const { data: a } = await admin
    .from('brand_articles')
    .select('id, title, meta_title, meta_description, body_md, cover_image, status, scheduled_for, source, source_initiative_id, translation_of')
    .eq('id', articleId)
    .eq('brand_id', brand.id)
    .maybeSingle();
  // Never translate a translation: that would compound drift and the unique index is keyed on the
  // ORIGINAL, so a chain would collide anyway.
  if (!a?.body_md || a.translation_of) return null;

  const prompt = `Translate this blog article into ${language}.

TITLE: ${a.title}
META TITLE: ${a.meta_title ?? ''}
META DESCRIPTION: ${a.meta_description ?? ''}

ARTICLE (Markdown):
${String(a.body_md)}

Requirements:
- Translate into ${language} so it reads as if written by a native ${language} writer for this audience. Idiomatic, not word-for-word.
- Keep the Markdown structure identical: same headings in the same order, same lists, same emphasis.
- Links and images: keep EVERY url byte-for-byte identical. Translate only the anchor text and the image alt text.
- Do not add, drop or hedge any factual claim, statistic or citation. Do not add a translator's note.
- Keep brand names, product names and quoted source titles in their original form.
- The slug must be in ${language}, ASCII, lowercase and hyphenated.
Return JSON.`;

  const out = await structured<AnyRec>(genaiClient(), prompt, TRANSLATION_SCHEMA, SYSTEM, {
    label: 'translate_article',
    brandId: brand.id as string,
    ...PIN_GEMINI
  }).catch((error) => { swallow('genaiClient failed', error); return null; });
  if (!out?.bodyMarkdown || !out?.title) return null;

  const row = {
    brand_id: brand.id,
    translation_of: a.id,
    // Language is stored as the English language name, matching how originals record it.
    language,
    slug: slugify(String(out.slug || out.title)) || `${slugify(String(a.title))}-${locale}`,
    title: String(out.title).slice(0, 200),
    meta_title: String(out.metaTitle ?? '').slice(0, 70) || null,
    meta_description: String(out.metaDescription ?? '').slice(0, 200) || null,
    body_md: String(out.bodyMarkdown),
    // Images are the expensive part and are language-independent — reuse the original's cover.
    cover_image: a.cover_image,
    // A translation is never "more published" than its original: it inherits the status, so approving
    // the original is what makes its languages publishable too, and nothing goes live unreviewed.
    status: a.status === 'published' ? 'published' : a.status,
    scheduled_for: a.scheduled_for,
    source: a.source,
    source_initiative_id: a.source_initiative_id,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await admin
    .from('brand_articles')
    .upsert(row, { onConflict: 'translation_of,language' })
    .select('id')
    .maybeSingle();
  if (error) {
    console.error(`[blog-translate] ${locale} failed for ${articleId}:`, error.message);
    return null;
  }
  return (data?.id as string) ?? null;
}

/**
 * Translate one article into every extra locale the blog is configured for. Sequential rather than
 * parallel: these run inside a background job that also has articles left to write, and DeepSeek
 * rate-limits per key — a fan-out here would starve the writing step.
 * Returns how many translations landed.
 */
export async function translateArticleToBlogLocales(
  admin: SupabaseClient,
  brand: AnyRec,
  articleId: string,
  locales: BlogLocale[]
): Promise<number> {
  let n = 0;
  for (const locale of locales) {
    const id = await translateArticle(admin, brand, articleId, locale).catch((error) => { swallow('translate article', error); return null; });
    if (id) n++;
  }
  return n;
}
