-- P2 Learning Loop: deterministic visual metadata snapshot per produced post.
--
-- Written by src/lib/server/visual-meta.ts AT POST PERSIST (and by backfillVisualMeta for the
-- historical tail): a zero-cost, deterministic row describing WHAT each post was — genre,
-- subject, asset source, hook, params — so the analytics review can later answer "which visual
-- treatments performed" without re-deriving anything at analysis time. No AI here; the derive
-- step is pure and runs on the post row alone.
create table if not exists public.post_visual_meta (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  platform text,
  format text,
  genre text,
  params jsonb not null default '{}'::jsonb,
  subject_type text,
  product_present boolean not null default false,
  person_present boolean not null default false,
  asset_source text not null default 'ai_generated',
  hook_type text,
  caption_length integer,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (post_id)
);
create index if not exists post_visual_meta_brand_platform_idx on public.post_visual_meta (brand_id, platform);
create index if not exists post_visual_meta_published_idx on public.post_visual_meta (published_at);

alter table public.post_visual_meta enable row level security;
create policy "post_visual_meta_via_brand" on public.post_visual_meta for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
