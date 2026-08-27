-- 0129 blog translations + per-blog locales
--
-- The top tier may have each article translated into up to 3 extra languages (see
-- BLOG_TRANSLATION_LANGUAGES in plans.ts). A translation is a normal brand_articles row — it shares
-- the pipeline, the editor, the scoring and the publish flow — linked back to its original.
--
-- WHY A LINK COLUMN AND NOT A SEPARATE TABLE: translations need every column an article has (slug,
-- meta, body, cover, status, scheduled_for, category, tags). A side table would have duplicated the
-- schema and every query touching it.
--
-- Two consequences the code relies on:
--   1. blogMonthlyUsage() counts ORIGINALS only (translation_of is null), so the monthly ceiling is
--      about how much the brand commissions, not how many languages it ships in.
--   2. The public blog filters by locale, so the 4 language versions never collide in one listing.
--      Without that filter, translations would be duplicate content with no hreflang — actively
--      worse for the SEO the feature exists to serve.

alter table public.brand_articles
  add column if not exists translation_of uuid references public.brand_articles(id) on delete cascade;

-- Every read of a translated article starts from its original ("give me this article's languages"),
-- and the cap query filters on `translation_of is null`.
create index if not exists brand_articles_translation_of_idx
  on public.brand_articles (translation_of) where translation_of is not null;

-- The public blog resolves (brand, locale, slug); the listing filters (brand, locale, status).
create index if not exists brand_articles_brand_language_idx
  on public.brand_articles (brand_id, language);

-- One translation per language per original — a retried job must never create a second Spanish copy.
create unique index if not exists brand_articles_one_translation_per_language
  on public.brand_articles (translation_of, language) where translation_of is not null;

-- Per-blog locale settings live in the existing blog_config jsonb (no new column needed):
--   blog_config.defaultLocale   text   — e.g. 'it'. The bare blog URL redirects here.
--   blog_config.locales         text[] — extra locales the brand publishes in, max 3 on Pro.
-- Documented here because the shape is a contract between blog-settings.ts, the locale param matcher
-- and the public routes, and jsonb keys are otherwise invisible to anyone reading the schema.
