-- 0159 internal links: target landing pages (/p/ site pages) as link targets
alter table public.brand_internal_links
  add column if not exists target_site_page_id uuid references public.brand_site_pages(id) on delete cascade;

-- One source article may link at most one landing page (a landing is itself a hub target).
create unique index if not exists brand_internal_links_site_page_uq
  on public.brand_internal_links (source_article_id)
  where target_site_page_id is not null;
