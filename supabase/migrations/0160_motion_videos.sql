-- Motion videos: each row is a Remotion composition as editable TSX source.
-- Preview/export compile this source in the browser; the chat agent edits the source itself.

create table if not exists public.motion_videos (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid,
  title text not null default 'Untitled motion',
  -- Full Remotion composition TSX (React + remotion APIs). Validated/compiled client-side.
  source text not null,
  -- Composition meta mirrored from exports in source (fps/duration/size).
  fps int not null default 30 check (fps > 0 and fps <= 60),
  duration_in_frames int not null default 180 check (duration_in_frames > 0 and duration_in_frames <= 3600),
  width int not null default 1080 check (width > 0 and width <= 4096),
  height int not null default 1080 check (height > 0 and height <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists motion_videos_brand_updated_idx
  on public.motion_videos (brand_id, updated_at desc);

alter table public.motion_videos enable row level security;

drop policy if exists "motion_videos via brand" on public.motion_videos;
create policy "motion_videos via brand" on public.motion_videos
  for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
