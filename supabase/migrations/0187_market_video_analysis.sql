-- 0187: what Gemini saw when it watched a trending clip.
--
-- The deterministic scorer reads the caption. This reads the VIDEO — when the hook lands, whether it
-- holds without sound, where the reveal sits, whether a CTA ever appears — none of which is
-- recoverable from text. It is the same judge (video-review.ts) we run on our own output, so our
-- content and the market's are measured with one instrument.
--
-- Service-role only. Deploys do NOT run migrations — apply before shipping code that selects this.

create table if not exists public.market_video_analyses (
  market_post_id uuid primary key references public.market_posts(id) on delete cascade,

  verdict text check (verdict is null or verdict in ('ship', 'fix', 'kill')),
  overall numeric,
  duration_s numeric,

  -- The hook is the most predictive part of short-form, so its pieces get their own columns rather
  -- than living inside the jsonb where nothing can group by them.
  hook_type text,
  hook_at_s numeric,
  hook_line text,
  hook_callout boolean,
  hook_open_loop boolean,

  scroll_stops boolean,
  stops_who text,
  reveal_at_s numeric,
  cta_at_s numeric,
  dead_seconds jsonb,
  weakest_link text,

  -- Per-dimension 0..N scores. This is what gets correlated against outperformance.
  scores jsonb,

  spoken text,
  on_screen text,
  summary text,

  -- The full review, for reading. The columns above are for querying.
  review jsonb,

  analysed_at timestamptz not null default now()
);

create index if not exists market_video_analyses_verdict_idx
  on public.market_video_analyses (verdict, overall desc);
create index if not exists market_video_analyses_hook_idx
  on public.market_video_analyses (hook_type);

alter table public.market_video_analyses enable row level security;

-- Claim marker on the post: set whether the analysis succeeded or not, so a permanently unfetchable
-- clip is not retried on every run.
alter table public.market_posts
  add column if not exists analysed_at timestamptz;
alter table public.market_posts
  add column if not exists analysis_error text;

create index if not exists market_posts_pending_analysis_idx
  on public.market_posts (outperformance desc)
  where analysed_at is null and media_url is not null;
