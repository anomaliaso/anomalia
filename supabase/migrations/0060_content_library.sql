-- Content Library: a persistent, deduped inventory of the brand's own site pages (blog posts,
-- guides, resources) so the planner and radar can emit Reddit LINK posts pointing at URLs that
-- ACTUALLY EXIST — today link_url is guessed by the model and may hallucinate. relevance_score
-- ranks pages vs the brand's strategy; last_used_at avoids re-sharing the same page in a loop.
--
-- ponytail: one table, no separate usage-tracking table or performance flywheel yet — last_used_at
-- covers "don't repeat". Add brand_page_posts + performance jsonb when there's link-post volume to
-- rank on.
create table if not exists public.brand_pages (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  url text not null,
  url_hash text not null,          -- sha1(url) prefix, for dedup (mirrors brand_news_items)
  title text,
  description text,                -- meta description / og:description
  body_text text,                  -- extracted visible text, capped ~8k chars
  topics text[],                   -- 3-5 topic tags (AI)
  relevance_score integer,         -- 0-100 vs brand strategy (AI)
  last_used_at timestamptz,        -- when a post last linked this page
  last_scanned_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (brand_id, url_hash)
);
create index if not exists brand_pages_brand_rel_idx on public.brand_pages (brand_id, relevance_score desc);

alter table public.brand_pages enable row level security;
create policy "brand pages via brand" on public.brand_pages for select
  using (brand_id in (select public.auth_brand_ids()));
