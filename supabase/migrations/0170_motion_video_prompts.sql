-- 0170: prompt history for Motion video (same cronologia pattern as Media generator).

create table if not exists public.motion_video_prompts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  selected_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists motion_video_prompts_brand_created_idx
  on public.motion_video_prompts (brand_id, created_at desc);

alter table public.motion_video_prompts enable row level security;

drop policy if exists "motion_video_prompts via brand" on public.motion_video_prompts;
create policy "motion_video_prompts via brand" on public.motion_video_prompts
  for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
