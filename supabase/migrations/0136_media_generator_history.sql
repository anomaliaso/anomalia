-- 0136: permanent Media generator gallery + prompt history
-- Public media URLs from uploadPostImage / renderVideo are durable; this indexes them per brand
-- so refresh / re-entry restores the grid and cronologia.

create table if not exists public.media_generator_prompts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null,
  kind text not null default 'auto',
  aspect text,
  use_brand_style boolean not null default true,
  media_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists media_generator_prompts_brand_created_idx
  on public.media_generator_prompts (brand_id, created_at desc);

create table if not exists public.media_generator_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prompt_id uuid references public.media_generator_prompts(id) on delete set null,
  kind text not null check (kind in ('image', 'video')),
  url text not null,
  prompt text not null default '',
  aspect text,
  created_at timestamptz not null default now()
);

create index if not exists media_generator_items_brand_created_idx
  on public.media_generator_items (brand_id, created_at desc);
create index if not exists media_generator_items_prompt_idx
  on public.media_generator_items (prompt_id)
  where prompt_id is not null;

alter table public.media_generator_prompts enable row level security;
alter table public.media_generator_items enable row level security;

create policy "media_generator_prompts via brand" on public.media_generator_prompts for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));

create policy "media_generator_items via brand" on public.media_generator_items for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
