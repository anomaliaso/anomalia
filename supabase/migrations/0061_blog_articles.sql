-- Blog articles: full long-form SEO articles the AI writes for the brand (Phase 0 = generate +
-- review + export). Distinct from brand_geo_artifacts (copy-paste GEO fixes / outlines) because an
-- article is a first-class publishable object with its own lifecycle — later phases add hosted
-- publishing (subdomain) and CMS connectors keyed off this row.
create table if not exists public.brand_articles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  slug text not null,
  title text not null,
  meta_title text,
  meta_description text,
  body_md text not null,            -- full article, markdown
  language text,
  status text not null default 'draft',   -- draft | approved | published
  source_initiative_id text,        -- the SEO initiative this came from, if any
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists brand_articles_brand_created_idx on public.brand_articles (brand_id, created_at desc);

alter table public.brand_articles enable row level security;
create policy "brand articles via brand" on public.brand_articles for select
  using (brand_id in (select public.auth_brand_ids()));
