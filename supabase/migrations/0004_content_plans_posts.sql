-- 0004 content: editorial plans + posts + media storage bucket
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-03 via MCP.

create table public.content_plans (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  title text, status text not null default 'proposed', created_at timestamptz not null default now()
);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  plan_id uuid references public.content_plans(id) on delete set null,
  platform text, content_type text not null default 'generated_image', source text not null default 'plan',
  caption text, image_prompt text, media_url text, slot text, scheduled_for timestamptz,
  status text not null default 'pending_user', created_at timestamptz not null default now()
);
create index posts_brand_idx on public.posts (brand_id);
create index posts_plan_idx on public.posts (plan_id);

alter table public.content_plans enable row level security;
alter table public.posts enable row level security;
create policy "content_plans via brand" on public.content_plans for all
  using (brand_id in (select public.auth_brand_ids())) with check (brand_id in (select public.auth_brand_ids()));
create policy "posts via brand" on public.posts for all
  using (brand_id in (select public.auth_brand_ids())) with check (brand_id in (select public.auth_brand_ids()));

insert into storage.buckets (id, name, public) values ('media', 'media', true) on conflict (id) do nothing;
create policy "media insert own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "media update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
