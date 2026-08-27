-- 0180: video_renders — kie clip renders tracked out-of-band instead of awaited inline.
--
-- Rendering a clip is the longest thing this codebase waits on: pollJob sat on an invocation for
-- up to ten minutes, which is longer than the function wall used to be at all, so a render slower
-- than the wall could never complete no matter how long kie took. Even now it caps the whole
-- feature at POLL_TIMEOUT_MS regardless of what the clip actually needs.
--
-- None of that waiting buys anything. kie's job is already durable on kie's side: submitting
-- returns a task id, and the result stays fetchable from any process at any time. The wait was
-- only ever a Node process babysitting someone else's queue.
--
-- So the task id gets written down the moment it exists, and a reconciler picks the result up
-- later. `persist_opts` carries what finishing the render needs and cannot re-derive — whether to
-- burn captions, which font, whether to tighten dead space — because the request that computed
-- them is long gone by then. Same reason cover_url is here: it is the frame the clip was animated
-- from, and losing it loses the grounding (product, person, palette, QC) that produced it.

create table if not exists public.video_renders (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null,
  -- The post this clip belongs to. Null for renders not tied to a post yet.
  post_id uuid references public.posts(id) on delete cascade,
  -- Where to report back when it lands. Null for renders not started from a chat.
  thread_id uuid,
  -- kie's handle. The whole point of the table: durable, and enough to recover the result alone.
  task_id text not null,
  model text not null,
  -- `finishing` is a claim, not a phase of the render: downloading the mp4 and billing kie's exact
  -- charge are both non-idempotent, so two overlapping cron ticks must not do them twice. A row is
  -- moved rendering → finishing atomically before that work and back to rendering by the sweep if
  -- the process holding it dies.
  status text not null default 'rendering'
    check (status in ('rendering', 'finishing', 'done', 'failed', 'expired')),
  claimed_at timestamptz,
  duration_seconds integer,
  resolution text,
  cover_url text,
  prompt text,
  -- { captions, fontName, tighten } — see persistMp4.
  persist_opts jsonb not null default '{}'::jsonb,
  media_url text,
  error text,
  -- Counts FAILURES only, never the "kie is still working" checks — a row that fails while storing
  -- the mp4 returns straight to a per-minute cron, so without a cap it would re-download sixty
  -- times inside the age window. Counting the healthy checks too would instead turn this into a
  -- deadline of MAX_ATTEMPTS minutes and kill every clip that legitimately takes longer.
  attempts integer not null default 0,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- The reconciler's two queries: oldest unfinished renders first, and stuck claims to release.
create index if not exists video_renders_pending_idx
  on public.video_renders (submitted_at)
  where status in ('rendering', 'finishing');

create index if not exists video_renders_post_idx on public.video_renders (post_id);
create unique index if not exists video_renders_task_idx on public.video_renders (task_id);

alter table public.video_renders enable row level security;

-- Read-only to the brand's members, via the same auth_brand_ids() predicate chat_jobs uses so
-- shared brands behave identically here. Every write goes through the service role: a user must be
-- able to see that their clip is still rendering, never to mark it done.
drop policy if exists video_renders_select on public.video_renders;
create policy video_renders_select on public.video_renders
  for select
  using (brand_id in (select public.auth_brand_ids()));

-- Posts whose clip has not landed yet must not be publishable as if it had: media_url still holds
-- the cover at that point, so publishing would ship a photo where a video was promised.
alter table public.posts add column if not exists video_render_status text;
comment on column public.posts.video_render_status is
  'rendering | done | failed — set while an out-of-band clip render is outstanding. Publish and approve must refuse a post that is still rendering.';
