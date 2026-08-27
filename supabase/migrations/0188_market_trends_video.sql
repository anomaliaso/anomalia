-- 0188: the video-first pool — views, resonance, and the winner/control split.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these.

-- Views are reported by Instagram and TikTok and by none of the text surfaces, so this is nullable
-- on purpose: absent means "not measurable here", not "zero".
alter table public.market_posts add column if not exists views bigint;

-- Interactions ÷ views. Outperformance answers "did this beat its account"; this answers a question
-- the account median cannot — whether a clip was PUSHED (many views, same like-rate) or actually
-- LANDED (usual views, far better like-rate). Two different facts, both worth having.
alter table public.market_posts add column if not exists interaction_rate numeric;

create index if not exists market_posts_resonance_idx
  on public.market_posts (platform, interaction_rate desc)
  where interaction_rate is not null;

-- Which side of the comparison a judged clip is on.
--
-- Analysing only winners is the survivorship trap the whole design exists to avoid, and the first
-- version of the analysis walked straight into it. A judge shown nothing but hits learns what hits
-- look like — never what SEPARATES them from the misses of the same account. "Winners open with a
-- question" is worthless if the flops do too.
alter table public.market_video_analyses
  add column if not exists cohort text check (cohort is null or cohort in ('winner', 'control'));

create index if not exists market_video_analyses_cohort_idx
  on public.market_video_analyses (cohort, overall desc);
