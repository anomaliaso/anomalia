-- 0022 social_post_history: organic posts synced from Zernio (GET /v1/analytics?source=external)
-- for connected accounts. Caption + media + performance, used to build the brand's AI context.
-- Applied to Supabase kszazivzwievqixcnanp on 2026-06-04 via MCP.
create table public.social_post_history (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  platform text,
  zernio_external_post_id text not null,
  platform_post_url text,
  content text,
  media_type text,
  thumbnail_url text,
  media_items jsonb,
  published_at timestamptz,
  metrics jsonb,
  synced_at timestamptz not null default now(),
  unique (brand_id, zernio_external_post_id)
);
create index social_post_history_brand_idx on public.social_post_history (brand_id);
alter table public.social_post_history enable row level security;
create policy "social_post_history via brand" on public.social_post_history for all
  using (brand_id in (select public.auth_brand_ids()))
  with check (brand_id in (select public.auth_brand_ids()));
