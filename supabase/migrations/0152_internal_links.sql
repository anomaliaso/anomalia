-- Internal linking registry: records which brand_articles link to which others, so the
-- /api/v1/seo/links/tick cron (and publish-due) can append "See also" blocks in body_md without
-- ever linking the same pair twice. The body append itself happens server-side (service role);
-- this table is the dedup ledger + a surface for the app to inspect/undo the auto-links.
--
-- ponytail: anchor_text is stored for transparency only — we never re-render the body from it.
create table if not exists public.brand_internal_links (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  source_article_id uuid not null references public.brand_articles(id) on delete cascade,
  target_article_id uuid not null references public.brand_articles(id) on delete cascade,
  anchor_text text not null,
  added_at timestamptz not null default now(),
  unique (source_article_id, target_article_id)
);
create index if not exists brand_internal_links_brand_idx on public.brand_internal_links (brand_id);
create index if not exists brand_internal_links_source_idx on public.brand_internal_links (source_article_id);

alter table public.brand_internal_links enable row level security;
create policy "brand internal links via brand" on public.brand_internal_links for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
