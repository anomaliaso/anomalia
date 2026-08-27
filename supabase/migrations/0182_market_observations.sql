-- 0182: engagement as a TIME SERIES, not a snapshot.
--
-- 0181 upserted `market_posts.metrics` on every sighting, which overwrote the previous reading and
-- threw away the post's trajectory. That was a real defect, not a simplification: without a series
-- the fit compares posts observed at different AGES, and a post seen 2h after publishing has fewer
-- likes than one seen 20h after regardless of how good it is. Age was silently confounding every
-- correlation.
--
-- With a series we can read every post at a COMMON age (see engagementAtAge in market-metrics.ts),
-- which is the only way the label means the same thing for all of them.
--
-- Service-role only. Deploys do NOT run migrations — apply before shipping code that selects this.

create table if not exists public.market_post_observations (
  id uuid primary key default gen_random_uuid(),
  market_post_id uuid not null references public.market_posts(id) on delete cascade,

  observed_at timestamptz not null default now(),
  -- Hours between the post's published_at and this observation. Denormalised on write because it is
  -- what every read wants and published_at never changes.
  age_hours numeric,

  engagement numeric not null,
  metrics jsonb not null default '{}'::jsonb
);

-- Append-only: never update a row here. A correction is a new observation.
create index if not exists market_post_observations_post_idx
  on public.market_post_observations (market_post_id, observed_at desc);
create index if not exists market_post_observations_age_idx
  on public.market_post_observations (market_post_id, age_hours);

alter table public.market_post_observations enable row level security;

-- Track the post's own lifecycle so a first sighting is distinguishable from a re-observation.
alter table public.market_posts
  add column if not exists first_seen_at timestamptz;
alter table public.market_posts
  add column if not exists observation_count int not null default 0;
-- Engagement interpolated to the common comparison age. This — not the raw latest count — is what
-- the fit should use as its numerator once a post has been observed on both sides of that age.
alter table public.market_posts
  add column if not exists engagement_at_ref numeric;

-- Vertical the post was harvested under. Without it the fit averages every niche into one number,
-- and a check that only works for restaurants reads as a universal law.
alter table public.market_posts
  add column if not exists category text;

create index if not exists market_posts_category_idx
  on public.market_posts (category, scorer_version)
  where category is not null;

update public.market_posts set first_seen_at = discovered_at where first_seen_at is null;
