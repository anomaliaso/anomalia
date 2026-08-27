-- 0165: persisted video QC scores (organic / ads rubric).
-- One row per (brand, clip URL, standard). Status pending → worker runs Gemini;
-- ready rows power the score ring on PostCard / calendar / workbench.
-- Deploys do NOT run migrations. Apply before shipping code that selects this table.

create table if not exists public.video_reviews (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  post_id uuid references public.posts(id) on delete set null,
  media_url text not null,
  url_hash text not null,
  standard text not null check (standard in ('organic', 'ads')),
  status text not null default 'pending' check (status in ('pending', 'running', 'ready', 'failed')),
  overall numeric,
  verdict text check (verdict is null or verdict in ('ship', 'fix', 'kill')),
  scores jsonb,
  review jsonb,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, url_hash, standard)
);

create index if not exists video_reviews_brand_status_idx
  on public.video_reviews (brand_id, status, created_at);
create index if not exists video_reviews_post_idx
  on public.video_reviews (post_id)
  where post_id is not null;
create index if not exists video_reviews_pending_idx
  on public.video_reviews (status, updated_at)
  where status in ('pending', 'running');

alter table public.video_reviews enable row level security;

drop policy if exists "video_reviews via brand" on public.video_reviews;
create policy "video_reviews via brand" on public.video_reviews for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
