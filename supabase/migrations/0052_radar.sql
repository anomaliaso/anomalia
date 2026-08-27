-- Radar: the per-brand instant-marketing engine (traidue's auto-news pattern, generalised).
-- Sources are AI-seeded at onboarding and user-editable in the Studio; items are the deduped
-- stream of scanned news with the relevance verdict attached.
create table if not exists public.brand_news_sources (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  kind text not null check (kind in ('gnews_query', 'rss', 'subreddit')),
  value text not null,          -- the query, the feed URL, or the subreddit name
  lang text,                    -- 'it' | 'en' | null (rss/subreddit carry their own language)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (brand_id, kind, value)
);

create table if not exists public.brand_news_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  url_hash text not null,       -- sha1 of the canonical URL (dedupe key)
  url text not null,
  title text not null,
  snippet text,
  source_name text,
  published_at timestamptz,
  status text not null default 'seen',  -- seen | proposed | posted | skipped
  relevance integer,            -- 0-100 from the filter call
  angle text,                   -- the proposed post angle (when relevant)
  urgency text,                 -- 'breaking' | 'timely' | null
  skip_reason text,             -- transparency: why the filter passed on it
  created_at timestamptz not null default now(),
  unique (brand_id, url_hash)
);
create index if not exists brand_news_items_brand_created_idx on public.brand_news_items (brand_id, created_at desc);

alter table public.brand_news_sources enable row level security;
create policy "news sources via brand" on public.brand_news_sources for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

alter table public.brand_news_items enable row level security;
create policy "news items via brand" on public.brand_news_items for select
  using (brand_id in (select public.auth_brand_ids()));
