-- 0195: keep the craft verdicts, and what the composition was built from.
--
-- `qc.ts` has scored every clip we render since the day it shipped — craft, content, pleasant,
-- transitions, 1–10 — and thrown the numbers away when the turn ended. `ai_calls` kept the judge
-- call's latency and token count and none of its judgement. So the one question anyone asks about
-- a change to the generator — did the output get better — has never had an answer available.
--
-- The reference wall (0194) is the immediate reason to fix that: a clip built from a studied
-- reference should outscore one built from the craft constant alone, and if it does not, that is
-- worth knowing early rather than believing for a year. But nothing here is specific to it — any
-- later change to the prompt, the model or the craft rules gets a before and after from this table.
--
-- Service-role only (RLS on, no policy — same posture as ai_calls in 0050). Internal instrument.
--
-- Deploys do NOT run migrations. Apply before shipping code that selects these tables.

-- Which wall references a composition was built from. Written by the Motion agent at the end of a
-- turn, for every video that turn touched.
create table if not exists public.motion_video_references (
  brand_id uuid not null references public.brands(id) on delete cascade,
  video_id uuid not null references public.motion_videos(id) on delete cascade,
  -- posts.design media stem — matches motion_reference_specs.id, but deliberately NOT a foreign key:
  -- a reference studied while the spec cache was unavailable is still a fact about this video.
  reference_id text not null,
  created_at timestamptz not null default now(),
  primary key (video_id, reference_id)
);

create index if not exists motion_video_references_reference_idx
  on public.motion_video_references (reference_id);

-- One row per craft judgement.
create table if not exists public.motion_craft_scores (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  video_id uuid not null references public.motion_videos(id) on delete cascade,

  -- How many rewrite passes had already run when this was scored. A first draft and its patched
  -- version are two comparable rows, not one overwriting the other.
  round int not null default 0,

  verdict text not null,
  overall numeric not null,
  craft int,
  content int,
  pleasant int,
  transitions int,
  transitions_broken boolean not null default false,
  weakest_link text,
  duration_s numeric,

  -- The comparison this table exists for. Denormalised on purpose: the link rows can be deleted
  -- with the video, and a score whose provenance vanished is a score that cannot be read.
  reference_ids text[] not null default '{}',
  reference_count int not null default 0,

  created_at timestamptz not null default now()
);

create index if not exists motion_craft_scores_brand_idx
  on public.motion_craft_scores (brand_id, created_at desc);
create index if not exists motion_craft_scores_ab_idx
  on public.motion_craft_scores (reference_count, round, overall);

alter table public.motion_video_references enable row level security;
alter table public.motion_craft_scores enable row level security;
