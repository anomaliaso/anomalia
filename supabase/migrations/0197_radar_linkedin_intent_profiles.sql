-- 0197 — Radar/Leads: the LinkedIn source kind, buying intent on each lead, and the per-community
-- profile the drafter reads before it writes.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these columns/tables.

-- 1. linkedin_query was shipped in the UI, the plan gate and the search code, but never added to
--    this CHECK: saving a LinkedIn source failed with 23514, so the kind was unusable end to end.
alter table public.brand_news_sources drop constraint if exists brand_news_sources_kind_check;
alter table public.brand_news_sources add constraint brand_news_sources_kind_check
  check (kind in ('gnews_query', 'rss', 'subreddit', 'threads_query', 'x_community', 'reddit_query', 'linkedin_query'));

-- 2. Intent is NOT relevance. Relevance says "this brand has something to say here"; intent says
--    how close the person is to buying. Someone asking for a recommendation right now and someone
--    venting about the same problem score the same relevance and deserve a different queue slot.
--    seeking_now | comparing | researching | venting | none
alter table public.brand_news_items add column if not exists intent text;

create index if not exists brand_news_items_brand_intent_idx
  on public.brand_news_items (brand_id, intent, created_at desc);

-- 3. One living profile per monitored community, rebuilt nightly from the items already collected
--    in brand_news_items. It is what turns a generic-sounding reply into one written in the
--    register of the place it is going: the words they use, what they already tried, what gets
--    upvoted, what the mods remove.
create table if not exists public.brand_community_profiles (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Matches brand_news_sources.kind / the source_name a scanned item carries (e.g. 'r/marketing',
  -- 'linkedin', 'threads') so the drafter can look a profile up from the item alone.
  platform text not null,              -- reddit | threads | x | linkedin
  community text not null,             -- 'r/smallbusiness', a query, a community id

  demographics text,                   -- who they are, marked as inferred where it is a guess
  psychographics text,                 -- what they want, fear, are embarrassed about
  vocabulary jsonb not null default '[]'::jsonb,   -- the exact phrases they use, quoted
  tried_and_failed jsonb not null default '[]'::jsonb,
  what_lands text,                     -- what gets upvoted / what gets buried, with examples
  rules text,                          -- what gets removed, how strict the mods are
  tone text,                           -- length, register, how people open a post

  items_seen integer not null default 0,           -- how much evidence this profile rests on
  changelog jsonb not null default '[]'::jsonb,    -- dated lines: what changed and why
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (brand_id, platform, community)
);

create index if not exists brand_community_profiles_brand_idx
  on public.brand_community_profiles (brand_id, updated_at desc);

alter table public.brand_community_profiles enable row level security;

-- Readable by the brand's members; written server-side by the radar (service role).
drop policy if exists "community profiles readable by brand members" on public.brand_community_profiles;
create policy "community profiles readable by brand members" on public.brand_community_profiles
  for select using (brand_id in (select public.auth_brand_ids()));
