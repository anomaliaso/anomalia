-- 0090: Radar search history — one row per radarScan run, so a brand has an auditable
-- record of WHAT was searched (configured feeds + AI-generated Reddit queries), which
-- sources answered, and what the scan yielded (found → fresh → relevant → proposed).
-- Written by the radar (service role); readable by brand members for the Radar/Leads UI.

create table if not exists public.radar_searches (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  created_at timestamptz not null default now(),
  mode text,                       -- 'digest' | 'breaking' (radar prefs at scan time)
  -- Every source queried this scan. Each entry:
  --   { kind, value, items, fromCache?, dynamic?, ok, error? }
  -- kind ∈ gnews_query | rss | subreddit | reddit_query | threads_query | x_community
  -- dynamic=true marks the AI-generated Reddit keyword queries (value = the query text).
  sources jsonb not null default '[]'::jsonb,
  items_found integer not null default 0,     -- unique items after URL dedupe
  items_fresh integer not null default 0,     -- new (not previously seen for this brand)
  items_relevant integer not null default 0,  -- passed the AI relevance verdict
  posts_proposed integer not null default 0,
  comments_proposed integer not null default 0,
  articles_proposed integer not null default 0,
  ms integer                                   -- scan wall-clock duration
);

create index if not exists radar_searches_brand_created_idx
  on public.radar_searches (brand_id, created_at desc);

alter table public.radar_searches enable row level security;

drop policy if exists "radar_searches readable by brand members" on public.radar_searches;
create policy "radar_searches readable by brand members" on public.radar_searches
  for select using (brand_id in (select public.auth_brand_ids()));
