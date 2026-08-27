-- 0194: cached breakdowns of the posts.design reference wall.
--
-- Internal instrument, service-role only (RLS on, no policy — same posture as market_posts in 0181).
-- Nothing here is user-facing and nothing is published.
--
-- WHAT IS STORED, AND WHAT DELIBERATELY IS NOT. Rows hold the TEXT breakdown of a curated post —
-- beats, timings, transition mechanism, easing, type density, palette roles — plus the attribution
-- that has to travel with it: the brand, the handle, the reference page and the original post.
--
-- The media is NOT stored. posts.design serves `Content-Signal: ai-train=no, use=reference` as an
-- express Art. 4 reservation under Directive (EU) 2019/790, and the posts are third-party brands'
-- work in any case. The clip is fetched once, watched by the judge, and dropped; `market-media.ts`
-- archives harvested video and is deliberately not used on this path. What survives is a
-- description of structure, which is what a director takes from a reference anyway.
--
-- The cache exists because a curated post never changes: watching one twice is pure waste.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects this table.

create table if not exists public.motion_reference_specs (
  -- posts.design media stem — stable, and also the gallery's own item id.
  id text primary key,
  source text not null default 'posts.design',
  slug text not null,

  -- Attribution. Not decoration: it is the line between studying a reference and taking something,
  -- and it is why these columns are not nullable-by-neglect but written on every upsert.
  reference_url text not null,
  source_url text,
  brand text,
  handle text,

  category text,
  style_tags text[] not null default '{}',
  title text,
  post_text text,

  -- Which channel the judge actually watched. A still yields a layout, not a beat sheet.
  medium text check (medium is null or medium in ('video', 'still')),

  -- Bumped when the schema or the study prompt changes: old rows stop being served, none are lost.
  spec_version int not null default 1,
  spec jsonb not null,
  duration_s numeric,

  created_at timestamptz not null default now()
);

create index if not exists motion_reference_specs_version_idx
  on public.motion_reference_specs (spec_version, created_at desc);
create index if not exists motion_reference_specs_category_idx
  on public.motion_reference_specs (category, medium);

alter table public.motion_reference_specs enable row level security;
